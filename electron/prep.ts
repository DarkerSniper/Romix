import { BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrepSource, PrepUpdate } from "../src/shared/api";
import { classifyYtdlpError } from "../src/lib/ytdlpErrors";
import { parseEbur128Summary, progressFromLine, ytdlpProgress } from "../src/lib/ffmpegParse";
import { paths } from "./paths";
import { ffmpegPath, ffprobePath, findRuntime, MIN_NODE_MAJOR, run, spawnLines, YTDLP_BASE_ARGS, ytdlpEnv, ytdlpPath } from "./tools";

/**
 * Background preparation: download the best audio (YouTube) and convert it
 * once to 44.1 kHz float with soxr, measuring EBU R128 loudness in the same
 * pass. Results are cached per source key; two jobs run at a time.
 */

const CONCURRENCY = 2;
const DOWNLOAD_SHARE = 0.7; // progress split: download 0–70 %, convert 70–100 %
const PCM_VERSION = 1;

export interface PcmMeta {
  v: number;
  samples: number;
  lufs: number | null;
  truePeakDb: number | null;
}

interface Job {
  key: string;
  source: PrepSource;
  status: PrepUpdate;
  abort: AbortController;
  done: Promise<PrepUpdate>;
}

const jobs = new Map<string, Job>();
let running = 0;
const queue: Array<() => void> = [];

export function keyFor(source: PrepSource): string {
  if (source.kind === "youtube") return `yt-${source.videoId}`;
  const st = statSync(source.path);
  const h = createHash("sha1").update(`${source.path}|${st.size}|${st.mtimeMs}`).digest("hex").slice(0, 20);
  return `file-${h}`;
}

export const pcmPath = (key: string) => join(paths.pcm, `${key}.wav`);
const metaPath = (key: string) => join(paths.pcm, `${key}.json`);

export async function readPcmMeta(key: string): Promise<PcmMeta | null> {
  try {
    const m = JSON.parse(await readFile(metaPath(key), "utf8")) as PcmMeta;
    return m.v === PCM_VERSION && existsSync(pcmPath(key)) ? m : null;
  } catch {
    return null;
  }
}

function broadcast(u: PrepUpdate) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("romix:prep", u);
}

function update(job: Job, patch: Partial<PrepUpdate>) {
  job.status = { ...job.status, ...patch };
  broadcast(job.status);
}

/** Starts or joins the job for a source. Resolves with the source key immediately. */
export function prepare(source: PrepSource): string {
  if (source.kind === "file" && (!existsSync(source.path) || !statSync(source.path).isFile())) {
    throw new Error("That file no longer exists");
  }
  const key = keyFor(source);
  const existing = jobs.get(key);
  if (existing && existing.status.state !== "error") {
    broadcast(existing.status);
    return key;
  }
  const job: Job = {
    key,
    source,
    status: { key, state: "queued", progress: 0 },
    abort: new AbortController(),
    done: Promise.resolve(null as unknown as PrepUpdate),
  };
  jobs.set(key, job);
  broadcast(job.status);
  job.done = schedule(job);
  return key;
}

export function cancelPrep(key: string) {
  const job = jobs.get(key);
  if (!job || job.status.state === "ready") return;
  job.abort.abort();
  jobs.delete(key);
}

export function statusOf(key: string): PrepUpdate | undefined {
  return jobs.get(key)?.status;
}

/** Forget finished jobs (after the cache is cleared). */
export function resetJobs() {
  for (const j of jobs.values()) j.abort.abort();
  jobs.clear();
}

export function busy(): boolean {
  return [...jobs.values()].some((j) => !["ready", "error"].includes(j.status.state));
}

async function schedule(job: Job): Promise<PrepUpdate> {
  if (running >= CONCURRENCY) await new Promise<void>((r) => queue.push(r));
  running++;
  try {
    if (job.abort.signal.aborted) return job.status;
    await runJob(job);
  } catch (err) {
    if (!job.abort.signal.aborted) update(job, { state: "error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    running--;
    queue.shift()?.();
  }
  return job.status;
}

async function runJob(job: Job) {
  const cached = await readPcmMeta(job.key);
  if (cached) {
    update(job, { state: "ready", progress: 1, durationSec: cached.samples / 44_100 });
    return;
  }

  let input: string;
  if (job.source.kind === "youtube") {
    input = await download(job, job.source.videoId);
  } else {
    input = job.source.path;
  }
  if (job.abort.signal.aborted) return;
  await convert(job, input);
}

function findDownloaded(videoId: string): string | null {
  if (!existsSync(paths.audio)) return null;
  const f = readdirSync(paths.audio).find((n) => n.startsWith(`${videoId}.`) && !/\.(part|ytdl|tmp)$/.test(n) && !n.includes(".part"));
  return f ? join(paths.audio, f) : null;
}

async function download(job: Job, videoId: string): Promise<string> {
  const have = findDownloaded(videoId);
  if (have) {
    update(job, { state: "downloading", progress: DOWNLOAD_SHARE });
    return have;
  }
  if (!existsSync(ytdlpPath())) throw new Error("Romix is still setting up (yt-dlp is missing)");
  const runtime = await findRuntime();
  if (!runtime) throw new Error(`Romix is still setting up (Node ${MIN_NODE_MAJOR}+ is missing)`);

  update(job, { state: "downloading", progress: 0 });
  let finalPath = "";
  const r = await spawnLines(
    ytdlpPath(),
    [
      ...YTDLP_BASE_ARGS,
      "--js-runtimes",
      `node:${runtime.path}`,
      "-f",
      "bestaudio/best",
      "--no-playlist",
      "--no-warnings",
      "--newline",
      "--progress",
      "--progress-template",
      "download:romix %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
      "-P",
      `home:${paths.audio}`,
      "-P",
      `temp:${paths.temp}`,
      "-o",
      `${videoId}.%(ext)s`,
      "--print",
      "after_move:romixfile %(filepath)s",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    {
      env: ytdlpEnv(runtime),
      signal: job.abort.signal,
      onStdout: (line) => {
        const p = ytdlpProgress(line);
        if (p !== null) update(job, { progress: p * DOWNLOAD_SHARE });
        if (line.startsWith("romixfile ")) finalPath = line.slice("romixfile ".length).trim();
      },
    },
  );
  if (r.aborted) throw new Error("Cancelled");
  if (r.code !== 0) throw new Error(classifyYtdlpError(r.stderr).message);
  const file = finalPath && existsSync(finalPath) ? finalPath : findDownloaded(videoId);
  if (!file) throw new Error("The download finished but the file is missing");
  return file;
}

async function probeDuration(file: string): Promise<number> {
  const r = await run(ffprobePath(), ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeoutMs: 30_000 });
  const d = Number(r.stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

export async function probeSamples(file: string): Promise<number> {
  const r = await run(
    ffprobePath(),
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration_ts,sample_rate", "-of", "json", file],
    { timeoutMs: 30_000 },
  );
  const s = JSON.parse(r.stdout || "{}").streams?.[0];
  return Number(s?.duration_ts ?? 0);
}

async function convert(job: Job, input: string) {
  if (!existsSync(ffmpegPath())) throw new Error("Romix is still setting up (FFmpeg is missing)");
  update(job, { state: "converting", progress: DOWNLOAD_SHARE });
  const total = await probeDuration(input);
  if (!(total > 0)) throw new Error("This file has no readable audio");

  const out = pcmPath(job.key);
  const tmp = `${out}.tmp.wav`;
  // One decode: soxr at its highest precision to 44.1 kHz, stereo, float (no quantising yet:
  // dither happens once, in the final render). A side branch measures EBU R128 + true peak.
  const filter =
    "[0:a:0]aresample=resampler=soxr:precision=28:osr=44100,aformat=sample_fmts=flt:channel_layouts=stereo,asplit=2[out][m];" +
    "[m]ebur128=peak=true:framelog=quiet,anullsink";
  const r = await spawnLines(
    ffmpegPath(),
    ["-hide_banner", "-nostdin", "-y", "-i", input, "-vn", "-filter_complex", filter, "-map", "[out]", "-c:a", "pcm_f32le", "-f", "wav", "-progress", "pipe:1", "-nostats", tmp],
    {
      signal: job.abort.signal,
      onStdout: (line) => {
        const p = progressFromLine(line, total);
        if (p !== null) update(job, { progress: DOWNLOAD_SHARE + p * (1 - DOWNLOAD_SHARE) * 0.98 });
      },
    },
  );
  if (r.aborted) {
    await rm(tmp, { force: true });
    throw new Error("Cancelled");
  }
  if (r.code !== 0) {
    await rm(tmp, { force: true });
    throw new Error(/No space left|ENOSPC/i.test(r.stderr) ? "Your disk is full" : "Couldn't convert this audio");
  }

  const samples = await probeSamples(tmp);
  if (!(samples > 0)) throw new Error("Converted audio is empty");
  const loud = parseEbur128Summary(r.stderr);
  await rename(tmp, out);
  const meta: PcmMeta = { v: PCM_VERSION, samples, ...loud };
  await writeFile(metaPath(job.key), JSON.stringify(meta));
  update(job, { state: "ready", progress: 1, durationSec: samples / 44_100 });
}

import { BrowserWindow, net } from "electron";
import { createHash } from "node:crypto";
import { existsSync, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DepId, DepStatus } from "../src/shared/api";
import { paths } from "./paths";
import { ffmpegPath, majorOf, MIN_NODE_MAJOR, nodePath, run, ytdlpPath, resetRuntimeCache } from "./tools";

/**
 * Romix installs its own helpers on first run, into its own folder, and
 * verifies every download against the publisher's SHA-256 checksums:
 *   yt-dlp   – reads YouTube                github.com/yt-dlp/yt-dlp
 *   FFmpeg   – converts audio (with soxr)   github.com/BtbN/FFmpeg-Builds (stable, GPL, shared)
 *   Node.js  – solves YouTube's JS checks   nodejs.org (latest LTS, node.exe only)
 */

const UA = { "User-Agent": "Romix" };

const INFO: Record<DepId, { name: string; purpose: string; approxMB: number }> = {
  ytdlp: { name: "yt-dlp", purpose: "Reads songs from YouTube", approxMB: 24 },
  ffmpeg: { name: "FFmpeg", purpose: "Converts audio to CD quality", approxMB: 87 },
  node: { name: "Node.js", purpose: "Lets yt-dlp pass YouTube's checks", approxMB: 34 },
};

const status = new Map<DepId, DepStatus>();
let installing: Promise<DepStatus[]> | null = null;

function emit() {
  const list = [...status.values()];
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("romix:deps", list);
}

function set(id: DepId, patch: Partial<DepStatus>) {
  status.set(id, { ...status.get(id)!, ...patch });
  emit();
}

async function versionOf(id: DepId): Promise<string | undefined> {
  if (id === "ytdlp") {
    if (!existsSync(ytdlpPath())) return undefined;
    const r = await run(ytdlpPath(), ["--version"], { timeoutMs: 20_000 });
    return r.code === 0 ? r.stdout.trim() : undefined;
  }
  if (id === "ffmpeg") {
    if (!existsSync(ffmpegPath())) return undefined;
    const r = await run(ffmpegPath(), ["-hide_banner", "-version"], { timeoutMs: 20_000 });
    return r.code === 0 ? r.stdout.match(/ffmpeg version n?([\w.-]+)/)?.[1]?.split("-")[0] : undefined;
  }
  if (!existsSync(nodePath())) return undefined;
  const r = await run(nodePath(), ["--version"], { timeoutMs: 10_000 });
  const v = r.stdout.trim();
  return /^v\d+/.test(v) && majorOf(v) >= MIN_NODE_MAJOR ? v : undefined;
}

export async function checkDeps(): Promise<DepStatus[]> {
  for (const id of Object.keys(INFO) as DepId[]) {
    const version = await versionOf(id);
    const prev = status.get(id);
    const busy = prev && ["downloading", "installing"].includes(prev.state);
    if (!busy) {
      status.set(id, { id, ...INFO[id], state: version ? "ready" : "missing", progress: version ? 1 : 0, version });
    }
  }
  emit();
  return [...status.values()];
}

export function allReady(): boolean {
  return [...status.values()].length === 3 && [...status.values()].every((d) => d.state === "ready");
}

/** Installs whatever is missing (idempotent; concurrent calls share one run). */
export function installMissing(): Promise<DepStatus[]> {
  if (!installing) {
    installing = (async () => {
      await checkDeps();
      await mkdir(paths.bin, { recursive: true });
      const todo = [...status.values()].filter((d) => d.state !== "ready");
      await Promise.all(todo.map((d) => installOne(d.id)));
      resetRuntimeCache();
      return checkDeps();
    })().finally(() => {
      installing = null;
    });
  }
  return installing;
}

async function installOne(id: DepId) {
  try {
    set(id, { state: "downloading", progress: 0, error: undefined });
    if (id === "ytdlp") await installYtdlp();
    else if (id === "ffmpeg") await installFfmpeg();
    else await installNode();
    const version = await versionOf(id);
    if (!version) throw new Error("Installed, but it doesn't run");
    set(id, { state: "ready", progress: 1, version });
  } catch (err) {
    set(id, { state: "error", error: friendly(err) });
  }
}

function friendly(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|network|fetch failed|ERR_INTERNET/i.test(m)) return "No internet connection. Check it and try again.";
  if (/ENOSPC/i.test(m)) return "Not enough disk space";
  if (/checksum/i.test(m)) return "The download was damaged. Try again.";
  return m;
}

/* ---------- downloading with progress + checksum ---------- */

async function text(url: string): Promise<string> {
  const r = await net.fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

async function json<T>(url: string): Promise<T> {
  return JSON.parse(await text(url)) as T;
}

/** Streams a download to a temp file inside the app folder, reporting progress, then checks SHA-256. */
async function download(id: DepId, url: string, expectedSha: string, share = 0.9): Promise<string> {
  const r = await net.fetch(url, { headers: UA });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} for ${url}`);
  const total = Number(r.headers.get("content-length")) || INFO[id].approxMB * 1e6;
  const dest = join(paths.temp, `dep-${id}-${Date.now()}`);
  const hash = createHash("sha256");
  const file = createWriteStream(dest);
  let got = 0;
  let lastEmit = 0;
  const reader = r.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      got += value.length;
      if (!file.write(value)) await new Promise((res) => file.once("drain", res));
      if (Date.now() - lastEmit > 120) {
        lastEmit = Date.now();
        set(id, { progress: Math.min(share, (got / total) * share) });
      }
    }
  } finally {
    await new Promise<void>((res) => file.end(res));
  }
  if (hash.digest("hex") !== expectedSha.toLowerCase()) {
    await rm(dest, { force: true });
    throw new Error("checksum mismatch");
  }
  set(id, { state: "installing", progress: share });
  return dest;
}

function sumFor(sums: string, file: string): string {
  const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(` ${file}`) || l.trim().endsWith(`*${file}`));
  if (!line) throw new Error(`No published checksum for ${file}`);
  return line.trim().split(/\s+/)[0];
}

async function unzip(zip: string, into: string) {
  await rm(into, { recursive: true, force: true });
  await mkdir(into, { recursive: true });
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  const r = await run(tar, ["-xf", zip, "-C", into], { timeoutMs: 300_000 });
  if (r.code !== 0) throw new Error("Couldn't unpack the download");
}

/* ---------- the three helpers ---------- */

async function installYtdlp() {
  const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
  const sha = sumFor(await text(`${base}/SHA2-256SUMS`), "yt-dlp.exe");
  const tmp = await download("ytdlp", `${base}/yt-dlp.exe`, sha, 0.98);
  await rm(ytdlpPath(), { force: true });
  await rename(tmp, ytdlpPath());
}

interface GhRelease {
  assets: Array<{ name: string; browser_download_url: string }>;
}

async function installFfmpeg() {
  const rel = await json<GhRelease>("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest");
  const asset = rel.assets
    .map((a) => ({ a, m: a.name.match(/^ffmpeg-n(\d+)\.(\d+)-latest-win64-gpl-shared-\1\.\2\.zip$/) }))
    .filter((x) => x.m)
    .sort((x, y) => Number(y.m![1]) - Number(x.m![1]) || Number(y.m![2]) - Number(x.m![2]))[0]?.a;
  const sums = rel.assets.find((a) => a.name === "checksums.sha256");
  if (!asset || !sums) throw new Error("Couldn't find an FFmpeg build to download");
  const zip = await download("ffmpeg", asset.browser_download_url, sumFor(await text(sums.browser_download_url), asset.name));

  const work = join(paths.temp, "ffmpeg-unpack");
  await unzip(zip, work);
  await rm(zip, { force: true });
  const top = (await readdir(work, { withFileTypes: true })).find((d) => d.isDirectory());
  if (!top) throw new Error("The FFmpeg download was empty");
  const dest = join(paths.bin, "ffmpeg");
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  for (const f of await readdir(join(work, top.name, "bin"))) {
    if (f !== "ffplay.exe") await copyFile(join(work, top.name, "bin", f), join(dest, f));
  }
  if (existsSync(join(work, top.name, "LICENSE.txt"))) await copyFile(join(work, top.name, "LICENSE.txt"), join(dest, "LICENSE.txt"));
  await rm(work, { recursive: true, force: true });

  const conf = await run(ffmpegPath(), ["-hide_banner", "-buildconf"], { timeoutMs: 20_000 });
  if (!conf.stdout.includes("--enable-libsoxr")) throw new Error("This FFmpeg build can't resample at CD quality (no soxr)");
}

async function installNode() {
  const index = await json<Array<{ version: string; lts: string | false; files: string[] }>>("https://nodejs.org/dist/index.json");
  const pick = index.find((r) => r.lts && majorOf(r.version) >= MIN_NODE_MAJOR && r.files.includes("win-x64-zip"));
  if (!pick) throw new Error("Couldn't find a Node.js release to download");
  const name = `node-${pick.version}-win-x64`;
  const zip = await download("node", `https://nodejs.org/dist/${pick.version}/${name}.zip`, sumFor(await text(`https://nodejs.org/dist/${pick.version}/SHASUMS256.txt`), `${name}.zip`));

  const work = join(paths.temp, "node-unpack");
  await unzip(zip, work);
  await rm(zip, { force: true });
  const dest = join(paths.bin, "node");
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  // yt-dlp only needs the node executable itself.
  await copyFile(join(work, name, "node.exe"), join(dest, "node.exe"));
  await copyFile(join(work, name, "LICENSE"), join(dest, "LICENSE")).catch(() => undefined);
  await rm(work, { recursive: true, force: true });
}

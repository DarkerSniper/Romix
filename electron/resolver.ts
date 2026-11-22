import { net } from "electron";
import { existsSync } from "node:fs";
import type { ResolveErrorCode, ResolveResult, ResolvedTrack, YtdlpInfo } from "../src/shared/api";
import { normalizeMeta } from "../src/lib/metadata";
import { classifyYtdlpError } from "../src/lib/ytdlpErrors";
import { getCached, putCached } from "./cache";
import { findRuntime, MIN_NODE_MAJOR, run, YTDLP_BASE_ARGS, ytdlpEnv, ytdlpPath } from "./tools";

const CD_MAX_SEC = 80 * 60;
const CONCURRENCY = 3;
const TIMEOUT_MS = 45_000;
const RETRYABLE: ResolveErrorCode[] = ["timeout", "offline", "unknown"];

/* ---------- tiny concurrency limiter ---------- */
let active = 0;
const waiting: Array<() => void> = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const inflight = new Map<string, Promise<ResolveResult>>();

/** Resolve a YouTube video id to clean track metadata + cover. Deduplicates concurrent calls. */
export function resolve(videoId: string): Promise<ResolveResult> {
  if (!/^[\w-]{11}$/.test(videoId)) return Promise.resolve(fail("unknown", "That video id looks wrong"));
  let p = inflight.get(videoId);
  if (!p) {
    p = resolveUncached(videoId).finally(() => inflight.delete(videoId));
    inflight.set(videoId, p);
  }
  return p;
}

async function resolveUncached(videoId: string): Promise<ResolveResult> {
  const hit = await getCached(videoId);
  if (hit) return { ok: true, track: hit, cached: true };

  let result = await limited(() => fetchOnce(videoId));
  if (!result.ok && RETRYABLE.includes(result.code)) result = await limited(() => fetchOnce(videoId));
  if (result.ok) await putCached(result.track).catch(() => undefined);
  return result;
}

function fail(code: ResolveErrorCode, message: string): ResolveResult {
  return { ok: false, code, message };
}

async function fetchOnce(videoId: string): Promise<ResolveResult> {
  if (!existsSync(ytdlpPath())) return fail("no-ytdlp", "Romix is still setting up (yt-dlp is missing)");
  const runtime = await findRuntime();
  if (!runtime) return fail("no-runtime", `Romix is still setting up (Node ${MIN_NODE_MAJOR}+ is missing)`);

  const args = [
    ...YTDLP_BASE_ARGS,
    "--js-runtimes",
    `node:${runtime.path}`,
    "--dump-json",
    "--no-playlist",
    "--skip-download",
    "--no-warnings",
    "--no-progress",
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
  const r = await run(ytdlpPath(), args, { timeoutMs: TIMEOUT_MS, env: ytdlpEnv(runtime) });
  if (r.timedOut) return fail("timeout", "YouTube took too long to answer. Try again.");
  if (r.code !== 0) {
    const { code, message } = classifyYtdlpError(r.stderr);
    return fail(code, message);
  }

  let info: YtdlpInfo;
  try {
    info = JSON.parse(r.stdout) as YtdlpInfo;
  } catch {
    return fail("unknown", "YouTube sent something Romix couldn't read. Try updating yt-dlp in Settings.");
  }

  if (info.is_live || info.live_status === "is_live" || info.live_status === "is_upcoming") {
    return fail("live", "Live streams can't go on a CD");
  }
  if (!info.duration || info.duration <= 0) return fail("live", "This video has no fixed length");
  if (info.duration > CD_MAX_SEC) return fail("too-long", "This is longer than a whole CD (80 minutes)");

  const meta = normalizeMeta(info);
  const track: ResolvedTrack = {
    videoId,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    durationSec: Math.round(info.duration),
    coverDataUrl: await fetchCover(info),
    webpageUrl: info.webpage_url ?? `https://www.youtube.com/watch?v=${videoId}`,
  };
  return { ok: true, track, cached: false };
}

/** Prefer square album art (YouTube Music), else the largest thumbnail. Returned as a data URL. */
async function fetchCover(info: YtdlpInfo): Promise<string | null> {
  const thumbs = (info.thumbnails ?? []).filter((t) => t.url?.startsWith("https://"));
  if (thumbs.length === 0) return null;
  const sized = thumbs.filter((t) => t.width && t.height);
  const square = sized.filter((t) => t.width === t.height && t.width! >= 200).sort((a, b) => b.width! - a.width!);
  const largest = [...sized].sort((a, b) => b.width! - a.width!);
  const ordered = [square[0], largest[0], ...[...thumbs].sort((a, b) => (b.preference ?? 0) - (a.preference ?? 0))].filter(Boolean);

  for (const t of ordered.slice(0, 4)) {
    try {
      const res = await net.fetch(t!.url);
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "image/jpeg";
      if (!type.startsWith("image/")) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      return `data:${type};base64,${buf.toString("base64")}`;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

import { execFile, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { paths } from "./paths";

/** yt-dlp's YouTube challenge solver needs a modern Node. */
export const MIN_NODE_MAJOR = 22;

export const ytdlpPath = () => join(paths.bin, "yt-dlp.exe");
export const ffmpegPath = () => join(paths.bin, "ffmpeg", "ffmpeg.exe");
export const ffprobePath = () => join(paths.bin, "ffmpeg", "ffprobe.exe");
/** Romix's own Node, downloaded into the app folder on first run. */
export const nodePath = () => join(paths.bin, "node", "node.exe");

/**
 * PATH with unreadable or missing entries removed. yt-dlp walks PATH looking
 * for runtimes and crashes on a broken entry (e.g. a dangling mount point).
 */
export function safePath(extra: string[] = []): string {
  const entries = [...extra, ...(process.env.PATH ?? "").split(delimiter)];
  const ok = new Set<string>();
  for (const e of entries) {
    if (!e) continue;
    try {
      if (statSync(e).isDirectory()) ok.add(e);
    } catch {
      /* skip */
    }
  }
  return [...ok].join(delimiter);
}

export function run(
  file: string,
  args: string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: opts.timeoutMs ?? 45_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: "utf8", env: opts.env ?? process.env },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        resolve({
          code: e ? (typeof e.code === "number" ? e.code : 1) : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? e?.message ?? "",
          timedOut: Boolean(e?.killed),
        });
      },
    );
  });
}

/**
 * Long-running child process with line-by-line output, cancellation and a
 * bounded stderr tail for error messages.
 */
export function spawnLines(
  file: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; signal?: AbortSignal; onStdout?: (line: string) => void; onStderr?: (line: string) => void },
): Promise<{ code: number; stderr: string; aborted: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { env: opts.env ?? process.env, windowsHide: true, signal: opts.signal });
    let tail = "";
    const pipe = (stream: NodeJS.ReadableStream, cb?: (l: string) => void, keep = false) => {
      let buf = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        buf += chunk;
        const lines = buf.split(/\r?\n|\r/);
        buf = lines.pop() ?? "";
        for (const l of lines) {
          cb?.(l);
          if (keep) tail = (tail + l + "\n").slice(-8000);
        }
      });
      stream.on("end", () => {
        if (buf) {
          cb?.(buf);
          if (keep) tail = (tail + buf).slice(-8000);
        }
      });
    };
    pipe(child.stdout!, opts.onStdout);
    pipe(child.stderr!, opts.onStderr, true);
    child.on("error", () => resolve({ code: -1, stderr: tail, aborted: Boolean(opts.signal?.aborted) }));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr: tail, aborted: Boolean(opts.signal?.aborted) }));
  });
}

export function majorOf(version: string): number {
  return Number(version.replace(/^v/, "").split(".")[0]);
}

export interface Runtime {
  path: string;
  version: string;
}

let cached: Runtime | null | undefined;
export const resetRuntimeCache = () => {
  cached = undefined;
};

/** Romix's own Node first; ROMIX_NODE as a developer override. */
export async function findRuntime(): Promise<Runtime | null> {
  if (cached !== undefined) return cached;
  for (const c of [nodePath(), process.env.ROMIX_NODE].filter(Boolean) as string[]) {
    if (!existsSync(c)) continue;
    const v = (await run(c, ["--version"], { timeoutMs: 10_000 })).stdout.trim();
    if (/^v\d+\./.test(v) && majorOf(v) >= MIN_NODE_MAJOR) return (cached = { path: c, version: v });
  }
  return (cached = null);
}

/** Environment for yt-dlp: clean PATH, UTF-8 output, temp and cache inside the app folder. */
export function ytdlpEnv(runtime: Runtime | null): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: safePath(runtime ? [dirname(runtime.path)] : []),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    TEMP: paths.temp,
    TMP: paths.temp,
    // yt-dlp falls back to %USERPROFILE%\.cache otherwise.
    XDG_CACHE_HOME: paths.ytdlpCache,
  };
}

/** Flags every yt-dlp call gets so it never reads user config or writes outside the app folder. */
export const YTDLP_BASE_ARGS = ["--ignore-config", "--cache-dir", paths.ytdlpCache];

export async function ytdlpVersion(): Promise<string | undefined> {
  if (!existsSync(ytdlpPath())) return undefined;
  const r = await run(ytdlpPath(), [...YTDLP_BASE_ARGS, "--version"], { timeoutMs: 15_000, env: ytdlpEnv(null) });
  return r.code === 0 ? r.stdout.trim() : undefined;
}

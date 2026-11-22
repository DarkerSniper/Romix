import { app } from "electron";
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { readSettings } from "./settings";

/** yt-dlp's YouTube challenge solver needs a modern Node. */
export const MIN_NODE_MAJOR = 22;

export function ytdlpPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(base, "bin", "yt-dlp.exe");
}

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
      {
        timeout: opts.timeoutMs ?? 45_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
        env: opts.env ?? process.env,
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        resolve({
          code: e ? (typeof e.code === "number" ? e.code : 1) : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? (e?.message ?? ""),
          timedOut: Boolean(e?.killed),
        });
      },
    );
  });
}

async function nodeVersion(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  const r = await run(path, ["--version"], { timeoutMs: 5000 });
  const v = r.stdout.trim();
  return /^v\d+\./.test(v) ? v : undefined;
}

export function majorOf(version: string): number {
  return Number(version.replace(/^v/, "").split(".")[0]);
}

export interface Runtime {
  path: string;
  version: string;
}

let cached: Runtime | null | undefined;

/** Finds a Node >= MIN_NODE_MAJOR: user-chosen path first, then ROMIX_NODE, then every node on PATH. */
export async function findRuntime(force = false): Promise<Runtime | null> {
  if (cached !== undefined && !force) return cached;
  const candidates: string[] = [];
  const chosen = readSettings().runtimePath;
  if (chosen) candidates.push(chosen);
  if (process.env.ROMIX_NODE) candidates.push(process.env.ROMIX_NODE);
  const where = await run("where.exe", ["node"], { timeoutMs: 5000, env: { ...process.env, PATH: safePath() } });
  candidates.push(...where.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));

  for (const c of [...new Set(candidates)]) {
    const v = await nodeVersion(c);
    if (v && majorOf(v) >= MIN_NODE_MAJOR) return (cached = { path: c, version: v });
  }
  return (cached = null);
}

/** Environment for yt-dlp: clean PATH, UTF-8 output, no user config surprises. */
export function ytdlpEnv(runtime: Runtime | null): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: safePath(runtime ? [dirname(runtime.path)] : []),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

export async function ytdlpVersion(): Promise<string | undefined> {
  if (!existsSync(ytdlpPath())) return undefined;
  const r = await run(ytdlpPath(), ["--version"], { timeoutMs: 15_000, env: ytdlpEnv(null) });
  return r.code === 0 ? r.stdout.trim() : undefined;
}

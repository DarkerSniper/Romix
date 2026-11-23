import { app, BrowserWindow, powerSaveBlocker } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { BurnProgress, BurnRequest, BurnResult, DriveInfo, VerifyReport } from "../src/shared/api";
import { wavDataRange } from "../src/lib/wav";
import { paths } from "./paths";
import { run } from "./tools";
import { renderDisc } from "./render";
import { recordBurn } from "./shelf";

/* ---------- building the helper with Windows' own C# compiler ---------- */

const sourcePath = () =>
  app.isPackaged ? join(process.resourcesPath, "burner", "RomixBurner.cs") : join(app.getAppPath(), "electron", "burner", "RomixBurner.cs");
export const burnerExe = () => join(paths.bin, "burner", "RomixBurner.exe");
const stampPath = () => `${burnerExe()}.source-sha1`;
const sourceHash = () => createHash("sha1").update(readFileSync(sourcePath())).digest("hex");
const csc = () => join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");

/** Version when the built helper matches the current source; undefined means it must be (re)built. */
export async function burnerVersion(): Promise<string | undefined> {
  try {
    if (!existsSync(burnerExe())) return undefined;
    const stamp = (await readFile(stampPath(), "utf8")).trim();
    return stamp === sourceHash() ? `v1 (${stamp.slice(0, 7)})` : undefined;
  } catch {
    return undefined;
  }
}

export async function buildBurner() {
  if (!existsSync(csc())) throw new Error("Windows' .NET Framework 4 compiler wasn't found");
  await mkdir(dirname(burnerExe()), { recursive: true });
  stopHelper();
  const r = await run(
    csc(),
    ["/nologo", "/optimize+", "/target:exe", `/out:${burnerExe()}`, "/r:System.Web.Extensions.dll", "/r:Microsoft.CSharp.dll", "/r:System.Core.dll", sourcePath()],
    { timeoutMs: 120_000 },
  );
  if (r.code !== 0 || !existsSync(burnerExe())) throw new Error(`Couldn't build the burner helper: ${(r.stdout + r.stderr).trim().slice(0, 300)}`);
  await writeFile(stampPath(), sourceHash());
}

/* ---------- talking to the helper (JSON lines over stdin/stdout) ---------- */

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onEvent?: (e: Record<string, unknown>) => void };
let proc: ChildProcessWithoutNullStreams | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function startHelper() {
  if (proc) return proc;
  if (!existsSync(burnerExe())) throw new Error("The burner helper isn't installed yet");
  proc = spawn(burnerExe(), [], { windowsHide: true, cwd: paths.temp, env: { ...process.env, TEMP: paths.temp, TMP: paths.temp } });
  let buf = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const p = typeof msg.id === "number" ? pending.get(msg.id) : undefined;
      if (!p) continue;
      if (msg.event) p.onEvent?.(msg);
      else {
        pending.delete(msg.id as number);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(String(msg.error ?? "The burner helper failed")));
      }
    }
  });
  proc.on("exit", () => {
    proc = null;
    for (const p of pending.values()) p.reject(new Error("cancelled"));
    pending.clear();
  });
  return proc;
}

function stopHelper() {
  proc?.kill();
  proc = null;
}

function request<T>(cmd: string, args: Record<string, unknown> = {}, onEvent?: Pending["onEvent"]): Promise<T> {
  const p = startHelper();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onEvent });
    p.stdin.write(JSON.stringify({ id, cmd, ...args }) + "\n");
  });
}

/* ---------- drive watching ---------- */

let burning = false;
let lastDrives = "";
let watchTimer: NodeJS.Timeout | null = null;

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

export async function listDrives(): Promise<DriveInfo[]> {
  if (!existsSync(burnerExe())) return [];
  return request<DriveInfo[]>("drives");
}

/** Polls the drives every few seconds (paused while burning) and pushes changes to the UI. */
export function startDriveWatch() {
  if (watchTimer) return;
  const tick = async () => {
    if (!burning && existsSync(burnerExe())) {
      try {
        const d = await listDrives();
        const s = JSON.stringify(d);
        if (s !== lastDrives) {
          lastDrives = s;
          broadcast("romix:drives", d);
        }
      } catch {
        /* drive busy or helper restarting: try again next tick */
      }
    }
    watchTimer = setTimeout(tick, 2500);
  };
  void tick();
}

/* ---------- burning ---------- */

const burnDir = () => join(paths.temp, "burn");
let cancelled = false;

const progressListeners = new Set<(p: BurnProgress) => void>();

/** Progress for in-process listeners (the headless burn test); windows get it over IPC. */
export function onBurnProgress(cb: (p: BurnProgress) => void) {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

function progress(p: BurnProgress) {
  broadcast("romix:burn", p);
  progressListeners.forEach((cb) => cb(p));
}

/** Raw PCM (no WAV header) for Windows' burning engine, cached for further copies. */
async function toPcm(wavFile: string): Promise<string> {
  const out = join(burnDir(), basename(wavFile).replace(/\.wav$/, ".pcm"));
  if (existsSync(out)) return out;
  const size = (await stat(wavFile)).size;
  const fh = await open(wavFile, "r");
  const head = Buffer.alloc(Math.min(size, 4096));
  await fh.read(head, 0, head.length, 0);
  await fh.close();
  const { offset, length } = wavDataRange(head, size);
  await mkdir(burnDir(), { recursive: true });
  const tmp = `${out}.part`;
  await new Promise<void>((resolve, reject) => {
    createReadStream(wavFile, { start: offset, end: offset + length - 1 })
      .on("error", reject)
      .pipe(createWriteStream(tmp))
      .on("error", reject)
      .on("finish", () => resolve());
  });
  await rm(out, { force: true });
  await rename(tmp, out);
  return out;
}

export async function burn(req: BurnRequest): Promise<BurnResult> {
  if (burning) return { ok: false, message: "A burn is already running" };
  burning = true;
  cancelled = false;
  const blocker = powerSaveBlocker.start("prevent-app-suspension");
  try {
    progress({ phase: "build", progress: 0 });
    const rendered = await renderDisc({ keys: req.keys, options: req.options, trims: req.trims });
    if (!rendered.ok) return { ok: false, message: rendered.message };
    const pcm: string[] = [];
    for (let i = 0; i < rendered.tracks.length; i++) {
      pcm.push(await toPcm(join(paths.disc, rendered.tracks[i].url.split("/").pop()!)));
      progress({ phase: "build", progress: (i + 1) / rendered.tracks.length });
    }
    if (cancelled) return { ok: false, message: "Cancelled", cancelled: true };

    const gapless = req.options.gapMode !== "gap2";
    const burnResult = await request<{ speed?: number }>(
      "burn",
      { drive: req.driveId, tracks: pcm, gapless, speed: req.speed, eject: false, dryRun: Boolean(req.dryRun) },
      (e) => {
        if (e.phase === "prepare") progress({ phase: "prepare" });
        else if (e.phase === "finish") progress({ phase: "finish" });
        else if (e.phase === "burn" && typeof e.count === "number" && (e.count as number) > 0) {
          const done = ((e.lba as number) - (e.start as number)) / (e.count as number);
          progress({ phase: "burn", progress: Math.max(0, Math.min(1, done)), remainingSec: e.remaining as number });
        }
      },
    );
    if (req.dryRun) return { ok: true, dryRun: true };

    let verify: VerifyReport | undefined;
    if (req.verify) {
      progress({ phase: "verify", progress: 0 });
      // Give the drive a moment to re-read the freshly closed disc's table of contents.
      await new Promise((r) => setTimeout(r, 3000));
      const doVerify = () =>
        request<VerifyReport>("verify", { drive: req.driveId, tracks: pcm, gapless }, (e) => {
          if (e.phase === "verify") progress({ phase: "verify", progress: (e.percent as number) / 100 });
        });
      try {
        verify = await doVerify();
      } catch (e) {
        if (cancelled) throw e;
        await new Promise((r) => setTimeout(r, 5000));
        verify = await doVerify();
      }
    }
    if (req.eject) await request("eject", { drive: req.driveId }).catch(() => undefined);
    const speedX = burnResult.speed ? Math.round(burnResult.speed / 75) : undefined;
    await recordBurn(req, verify, speedX).catch(() => undefined);
    return { ok: true, speedX, verify };
  } catch (e) {
    if (cancelled) return { ok: false, message: "The burn was stopped", cancelled: true };
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    powerSaveBlocker.stop(blocker);
    burning = false;
    if (!req.keepForCopies) void endBurnSession();
  }
}

/** Stops the helper mid-burn. Windows releases the drive; a CD-R stopped this way is unusable. */
export function cancelBurn() {
  if (!burning) return;
  cancelled = true;
  stopHelper();
}

/** Deletes the temporary burn files. Best effort: they're only copies of cached audio. */
export async function endBurnSession() {
  if (burning) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await rm(burnDir(), { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

export async function eject(driveId: string) {
  await request("eject", { drive: driveId });
}

export async function erase(driveId: string): Promise<{ ok: boolean; message?: string }> {
  if (burning) return { ok: false, message: "A burn is running" };
  burning = true;
  try {
    progress({ phase: "erase", progress: 0 });
    await request("erase", { drive: driveId }, (e) => {
      if (typeof e.total === "number" && (e.total as number) > 0) progress({ phase: "erase", progress: (e.elapsed as number) / (e.total as number) });
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    burning = false;
  }
}

/** Disc layout as Windows' engine will write it (no drive needed). Used by the self-test. */
export function layout(pcmFiles: string[], gapless: boolean) {
  return request<{ tracks: Array<{ number: number; startLba: number; sectors: number }>; leadout: number }>("layout", { tracks: pcmFiles, gapless });
}

export { toPcm };

app.on("will-quit", () => {
  stopHelper();
  try {
    // Best effort: leftover burn files are only temp copies of cached audio.
    void rm(burnDir(), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

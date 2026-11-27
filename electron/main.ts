import { paths, audioCacheDirs } from "./paths"; // must be first: keeps all app data inside the app folder
import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, basename } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { rm, mkdir } from "node:fs/promises";
import type { BurnRequest, CacheInfo, DiscRequest, PrepSource, Project, UpdateResult } from "../src/shared/api";
import { burn, cancelBurn, eject, endBurnSession, erase, layout, listDrives, onBurnProgress, startDriveWatch, toPcm } from "./burner";
import { deleteProject, listProjects, loadProject, saveProject } from "./projects";
import { analyze } from "./analyze";
import { listShelf, removeFromShelf } from "./shelf";
import { outputInserts, renderInsertsPdf, renderInsertsPng } from "./insertsOut";
import { buildInsertsHtml } from "../src/lib/inserts";
import { writeFile } from "node:fs/promises";
import { pruneCache, setCachePolicy } from "./cachePrune";
import { registerCoverProtocol, storeCover } from "./covers";
import { buildDiscFile, exportDisc, importDisc, pickDiscFile, shareInfo, writeParts } from "./share";
import { coverFile } from "./covers";
import { readFile } from "node:fs/promises";
import { ffmpegPath } from "./tools";
import type { SavedTrack, ShareData } from "../src/shared/api";
import { resolve } from "./resolver";
import { run, YTDLP_BASE_ARGS, ytdlpEnv, ytdlpPath, ytdlpVersion } from "./tools";
import { checkDeps, installMissing } from "./deps";
import { prepare, cancelPrep, busy, resetJobs, statusOf } from "./prep";
import { renderDisc } from "./render";
import { checkForUpdate, dismissUpdate, initUpdater, installUpdate, openReleasePage, setUpdatePrefs, updateState } from "./updater";
import type { UpdatePrefs } from "../src/shared/api";

const here = dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.VITE_DEV_SERVER_URL;

const TITLEBAR = {
  dark: { color: "#1e1e1e", symbolColor: "#f5f5f7" },
  light: { color: "#ffffff", symbolColor: "#1d1d1f" },
} as const;

// Streams the finished disc audio to the preview player. Must be registered before "ready".
protocol.registerSchemesAsPrivileged([
  { scheme: "romix-audio", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: "romix-cover", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win: BrowserWindow | null = null;

function webPreferences() {
  return { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Romix",
    backgroundColor: TITLEBAR.dark.color,
    show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: { ...TITLEBAR.dark, height: 36 },
    webPreferences: webPreferences(),
  });
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (devUrl && url.startsWith(devUrl)) return;
    e.preventDefault();
  });
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(here, "../dist/index.html"));
}

function registerAudioProtocol() {
  protocol.handle("romix-audio", (req) => {
    const url = new URL(req.url);
    const name = basename(decodeURIComponent(url.pathname));
    // Only finished disc files, by their generated name. Nothing else on disk is reachable.
    if (url.hostname !== "disc" || !/^[a-f0-9]{24}\.wav$/.test(name)) return new Response("Not found", { status: 404 });
    const file = join(paths.disc, name);
    if (!existsSync(file)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString(), { headers: req.headers, bypassCustomProtocolHandlers: true });
  });
}

function dirSize(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  if (!existsSync(dir)) return { bytes, files };
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const s = dirSize(p);
      bytes += s.bytes;
      files += s.files;
    } else {
      bytes += statSync(p).size;
      files++;
    }
  }
  return { bytes, files };
}

function cacheInfo(): CacheInfo {
  return audioCacheDirs.reduce(
    (acc, d) => {
      const s = dirSize(d);
      return { ...acc, bytes: acc.bytes + s.bytes, files: acc.files + s.files };
    },
    { bytes: 0, files: 0, path: join(paths.root, "cache") },
  );
}

/* ---------- IPC ---------- */

ipcMain.handle("romix:resolve", (_e, videoId: unknown) => resolve(String(videoId)));
ipcMain.handle("romix:deps", () => checkDeps());
ipcMain.handle("romix:install-deps", () => installMissing());

ipcMain.handle("romix:prepare", (_e, source: PrepSource) => {
  if (source?.kind === "youtube" && /^[\w-]{11}$/.test(source.videoId)) return prepare({ kind: "youtube", videoId: source.videoId });
  if (source?.kind === "file" && typeof source.path === "string") return prepare({ kind: "file", path: source.path });
  throw new Error("Unknown source");
});
ipcMain.on("romix:cancel-prep", (_e, key: unknown) => cancelPrep(String(key)));
ipcMain.handle("romix:render", async (_e, req: DiscRequest) => {
  const r = await renderDisc(req);
  void pruneCache();
  return r;
});

ipcMain.handle("romix:cache-info", () => cacheInfo());
ipcMain.handle("romix:clear-cache", async () => {
  if (busy()) throw new Error("Wait for songs to finish preparing");
  resetJobs();
  for (const d of audioCacheDirs) {
    await rm(d, { recursive: true, force: true });
    await mkdir(d, { recursive: true });
  }
  return cacheInfo();
});

ipcMain.handle("romix:update-ytdlp", async (): Promise<UpdateResult> => {
  const before = await ytdlpVersion();
  if (!before) return { ok: false, message: "yt-dlp isn't installed yet" };
  const r = await run(ytdlpPath(), [...YTDLP_BASE_ARGS, "-U"], { timeoutMs: 180_000, env: ytdlpEnv(null) });
  const after = await ytdlpVersion();
  if (r.code !== 0) return { ok: false, message: "Couldn't update yt-dlp. Check your connection and try again.", version: after };
  return { ok: true, message: after && after !== before ? `Updated to ${after}` : "yt-dlp is up to date", version: after };
});

ipcMain.handle("romix:update-state", () => updateState());
ipcMain.handle("romix:update-check", () => checkForUpdate());
ipcMain.handle("romix:update-install", () => installUpdate());
ipcMain.handle("romix:update-prefs", (_e, patch: Partial<UpdatePrefs>) => setUpdatePrefs(patch && typeof patch === "object" ? patch : {}));
ipcMain.on("romix:update-dismiss", () => dismissUpdate());
ipcMain.on("romix:update-page", () => openReleasePage());

ipcMain.handle("romix:drives", () => listDrives());
ipcMain.handle("romix:burn", (_e, req: BurnRequest) => burn(req));
ipcMain.on("romix:cancel-burn", () => cancelBurn());
ipcMain.on("romix:end-burn-session", () => void endBurnSession());
ipcMain.handle("romix:eject", (_e, driveId: unknown) => eject(String(driveId)));
ipcMain.handle("romix:erase", (_e, driveId: unknown) => erase(String(driveId)));

ipcMain.handle("romix:analyze", (_e, key: unknown) => analyze(String(key)));
ipcMain.handle("romix:store-cover", (_e, dataUrl: unknown) => storeCover(String(dataUrl)));
ipcMain.handle("romix:shelf", () => listShelf());
ipcMain.handle("romix:shelf-remove", (_e, id: unknown) => removeFromShelf(String(id)));
ipcMain.handle("romix:inserts", (_e, html: unknown, action: unknown, title: unknown, paper: unknown) =>
  outputInserts(String(html), action === "print" ? "print" : "pdf", String(title), paper === "Letter" ? "Letter" : "A4", win),
);
ipcMain.on("romix:cache-policy", (_e, limitGB: unknown, keys: unknown) => setCachePolicy(Number(limitGB) || 5, Array.isArray(keys) ? keys.map(String) : []));

ipcMain.handle("romix:share-info", (_e, tracks: SavedTrack[]) => shareInfo(Array.isArray(tracks) ? tracks : []));
ipcMain.handle("romix:export-disc", (_e, data: ShareData, includeAudio: unknown) => exportDisc(data, includeAudio === true, win));
ipcMain.handle("romix:import-disc", async (_e, path: unknown) => {
  const file = typeof path === "string" && path ? path : await pickDiscFile(win);
  return file ? importDisc(file) : { ok: false, message: "No file chosen" };
});

ipcMain.handle("romix:projects", () => listProjects());
ipcMain.handle("romix:project-load", (_e, id: unknown) => loadProject(String(id)));
ipcMain.handle("romix:project-save", (_e, p: Omit<Project, "updatedAt">) => saveProject(p));
ipcMain.handle("romix:project-delete", (_e, id: unknown) => deleteProject(String(id)));

ipcMain.on("romix:titlebar-theme", (_e, theme: unknown) => {
  const t = theme === "light" ? TITLEBAR.light : TITLEBAR.dark;
  win?.setTitleBarOverlay({ ...t, height: 36 });
  win?.setBackgroundColor(t.color);
});

/* ---------- Self-test: `electron . --selftest` (used by npm run test:live) ---------- */

async function selfTest() {
  const log = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
  const ids = (process.env.ROMIX_SELFTEST_IDS ?? "").split(",").filter(Boolean);

  // 1. Setup from whatever is (or isn't) in the app folder.
  const deps = await installMissing();
  log({ step: "deps", deps: deps.map((d) => ({ id: d.id, state: d.state, version: d.version, error: d.error })) });
  if (!deps.every((d) => d.state === "ready")) return app.exit(1);

  // 2. Metadata.
  for (const id of ids) {
    const r = await resolve(id);
    log({ step: "resolve", id, ok: r.ok, ...(r.ok ? { title: r.track.title, artist: r.track.artist, sec: r.track.durationSec, cached: r.cached } : { code: r.code, message: r.message }) });
  }

  // 3. Prepare (download + convert) the playable ones.
  const keys: string[] = [];
  for (const id of ids) {
    const key = prepare({ kind: "youtube", videoId: id });
    if (!keys.includes(key)) keys.push(key);
  }
  for (;;) {
    const st = keys.map((k) => statusOf(k)!);
    if (st.every((s) => s.state === "ready" || s.state === "error")) {
      st.forEach((s) => log({ step: "prepare", key: s.key, state: s.state, sec: s.durationSec, error: s.error }));
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const ready = keys.filter((k) => statusOf(k)!.state === "ready");

  // 3b. Tempo, key and silence on real songs.
  for (const k of ready) {
    const a = await analyze(k);
    log({ step: "analyze", key: k, bpm: a?.bpm, key_: a?.key, camelot: a?.camelot, musicStart: a && +a.musicStartSec.toFixed(2), silenceAtEnd: a && +(a.durationSec - a.musicEndSec).toFixed(2), peaks: a?.peaks.length });
  }

  // 4. Build the disc in every mode and report the layout.
  for (const options of [
    { gapMode: "none" as const, crossfadeSec: 3, normalize: false },
    { gapMode: "gap2" as const, crossfadeSec: 3, normalize: true },
    { gapMode: "crossfade" as const, crossfadeSec: 3, normalize: true },
  ]) {
    const started = Date.now();
    const r = await renderDisc({ keys: ready, options });
    log({ step: "render", mode: options.gapMode, normalize: options.normalize, ms: Date.now() - started, ...(r.ok ? { totalSamples: r.totalSamples, targetLufs: r.targetLufs, tracks: r.tracks.map((t) => ({ url: t.url, samples: t.samples, pregap: t.pregap, gainDb: t.gainDb })) } : { error: r.message }) });
  }
  const last = await renderDisc({ keys: ready, options: { gapMode: "crossfade", crossfadeSec: 3, normalize: true } });

  // 4b. Burner: drives, and the exact layout Windows' engine would write for this disc.
  const drives = await listDrives();
  log({ step: "drives", drives: drives.map((d) => ({ name: d.name, path: d.path, writesCd: d.writesCd, media: d.media })) });
  for (const options of [
    { gapMode: "crossfade" as const, crossfadeSec: 3, normalize: true },
    { gapMode: "gap2" as const, crossfadeSec: 3, normalize: true },
  ]) {
    const r = await renderDisc({ keys: ready, options });
    if (!r.ok) continue;
    const pcm = [];
    for (const t of r.tracks) pcm.push(await toPcm(join(paths.disc, t.url.split("/").pop()!)));
    const lay = await layout(pcm, options.gapMode !== "gap2");
    // Every track must start exactly where Romix's plan says (plan samples / 588 = sectors).
    const matches = lay.tracks.every((t, i) => t.startLba * 588 === r.tracks[i].startSample && t.sectors * 588 === r.tracks[i].samples);
    log({ step: "layout", mode: options.gapMode, matchesPlan: matches, leadout: lay.leadout, totalSectors: r.totalSamples / 588, tracks: lay.tracks });
    if (!matches) process.exitCode = 1;
  }
  await endBurnSession();
  const dry = drives.find((d) => d.writesCd && d.media?.blank && d.media.supported);
  if (dry && last.ok) {
    const r = await burn({ driveId: dry.id, keys: ready, options: { gapMode: "crossfade", crossfadeSec: 3, normalize: true }, speed: 0, verify: false, eject: false, keepForCopies: false, dryRun: true });
    log({ step: "dry-run", drive: dry.name, ...r });
  } else {
    log({ step: "dry-run", skipped: "no blank CD in a burner" });
  }

  // 4c. Inserts from real songs → PDF: print covers via romix-cover://, booklet pages keep their own sizes.
  {
    const insertTracks = [];
    for (const id of ids) {
      const r = await resolve(id);
      if (!r.ok) continue;
      const hi = r.track.coverDataUrl ? await storeCover(r.track.coverDataUrl).catch(() => undefined) : undefined;
      insertTracks.push({ title: r.track.title, artist: r.track.artist, durationSec: r.track.durationSec, cover: hi ?? "", coverHi: hi, color: "#334455", videoId: id });
    }
    const htmlOut = buildInsertsHtml({ title: "Romix self-test", tracks: insertTracks, front: "ring", format: "booklet", labelKind: "sheet", colorStrip: true, qr: true, labelRing: true, ruler: true, paper: "A4", volume: 1 });
    const pdf = await renderInsertsPdf(htmlOut, "A4");
    const exportsDir = join(paths.root, "exports");
    await mkdir(exportsDir, { recursive: true });
    await writeFile(join(exportsDir, "selftest-inserts.pdf"), pdf);
    const boxes = [...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => `${Math.round((+m[1] * 25.4) / 72)}x${Math.round((+m[2] * 25.4) / 72)}mm`);
    log({ step: "inserts-pdf", bytes: pdf.length, pages: boxes, coversStored: insertTracks.filter((t) => t.coverHi).length, file: join(exportsDir, "selftest-inserts.pdf") });
    // Pictures of each front style with real covers (single format, page 1 only).
    for (const front of ["collage", "ring", "cover"] as const) {
      const one = buildInsertsHtml({ title: "Road Trip", subtitle: "Summer 2026", dedication: "For Mom", tracks: insertTracks, front, format: "single", labelKind: "sheet", colorStrip: true, qr: true, labelRing: true, ruler: true, paper: "A4", volume: 3 });
      await writeFile(join(exportsDir, `selftest-${front}.png`), await renderInsertsPng(one, 210, 297 * 2));
    }
  }

  // 4d. Sharing: build a .romix from real songs (+ one "own" audio file), import it, compare; then tamper and expect a refusal.
  {
    const own = join(paths.temp, "selftest-own.mp3");
    await run(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:a", "libmp3lame", own], { timeoutMs: 60_000 });
    const shared: SavedTrack[] = [];
    for (const id of ids) {
      const r = await resolve(id);
      if (!r.ok) continue;
      const hi = r.track.coverDataUrl ? await storeCover(r.track.coverDataUrl).catch(() => undefined) : undefined;
      shared.push({ title: r.track.title, artist: r.track.artist, durationSec: r.track.durationSec, cover: r.track.coverDataUrl ?? "", coverHi: hi, color: "#334455", source: "youtube", videoId: id, trimStartSec: 2, trimEndSec: r.track.durationSec - 3 });
    }
    shared.push({ title: "My own demo", artist: "Me", durationSec: 6, cover: "", color: "#225577", source: "local", filePath: own });
    const options = { gapMode: "crossfade" as const, crossfadeSec: 4, normalize: true, speedPct: 0 };
    const built = await buildDiscFile({ title: "Shared self-test", options, tracks: shared }, true);
    if (!built.ok) throw new Error(built.message);
    const file = join(paths.root, "exports", "selftest.romix");
    await writeParts(file, built.parts);
    const imported = await importDisc(file);
    const proj = imported.ok ? await loadProject(imported.projectId) : null;
    const ownBack = proj?.tracks.find((t) => t.source === "local");
    const same = (a: Buffer, b: Buffer) => a.length === b.length && a.equals(b);
    const checks = {
      imported: imported.ok,
      songs: `${proj?.tracks.length}/${shared.length}`,
      orderKept: proj?.tracks.map((t) => t.title).join("|") === shared.map((t) => t.title).join("|"),
      optionsKept: JSON.stringify(proj?.options) === JSON.stringify(options),
      trimsKept: proj?.tracks[0]?.trimStartSec === 2,
      printCoversRestored: proj?.tracks.filter((t) => t.coverHi && coverFile(t.coverHi) && existsSync(coverFile(t.coverHi)!)).length,
      ownAudioIdentical: Boolean(ownBack?.filePath && same(await readFile(ownBack.filePath), await readFile(own))),
      ownAudioInsideAppFolder: Boolean(ownBack?.filePath?.startsWith(paths.sharedAudio)),
    };
    // Tamper: flip one byte in the last part (the audio) and expect a clear refusal.
    const bytes = await readFile(file);
    bytes[bytes.length - 100] ^= 0xff;
    const tampered = join(paths.root, "exports", "selftest-tampered.romix");
    await writeFile(tampered, bytes);
    const bad = await importDisc(tampered);
    const notRomix = join(paths.root, "exports", "selftest-fake.romix");
    await writeFile(notRomix, Buffer.from("MZ this is really an exe"));
    const fake = await importDisc(notRomix);
    if (imported.ok) await deleteProject(imported.projectId);
    log({ step: "share", bytes: bytes.length, ...checks, tamperedRefused: !bad.ok && bad.message, fakeRefused: !fake.ok && fake.message });
  }

  // 5. The sandboxed UI can see the bridge and stream disc audio with seeking (HTTP Range).
  const probe = new BrowserWindow({ show: false, webPreferences: webPreferences() });
  await probe.loadFile(join(here, "../dist/index.html"));
  const url = last.ok ? last.tracks[0].url : "";
  const renderer = JSON.parse(
    await probe.webContents.executeJavaScript(`(async () => {
      const full = await fetch(${JSON.stringify(url)});
      const part = await fetch(${JSON.stringify(url)}, { headers: { Range: "bytes=44-1023" } });
      const outside = await fetch("romix-audio://disc/..%2F..%2Fapp%2FPreferences").then(r => r.status).catch(() => "blocked");
      return JSON.stringify({
        bridge: Object.keys(window.romix || {}),
        nodeVisible: typeof require !== "undefined" || typeof process !== "undefined",
        audioStatus: full.status, audioBytes: (await full.arrayBuffer()).byteLength,
        rangeStatus: part.status, rangeBytes: (await part.arrayBuffer()).byteLength,
        pathEscape: outside,
      });
    })()`),
  );
  probe.destroy();
  log({ step: "renderer", ...renderer });
  log({ step: "cache", ...cacheInfo(), outside: false });
  app.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
}

/**
 * `electron . --burntest`: burns a real disc and checks it. Writes ONLY when
 * ROMIX_BURNTEST=write; otherwise it stops after the dry run.
 */
async function burnTest() {
  const log = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
  const ids = (process.env.ROMIX_SELFTEST_IDS ?? "").split(",").filter(Boolean);
  const gapMode = (process.env.ROMIX_BURNTEST_MODE as "none" | "gap2" | "crossfade") || "crossfade";
  await installMissing();
  const keys = ids.map((id) => prepare({ kind: "youtube", videoId: id }));
  while (keys.some((k) => !["ready", "error"].includes(statusOf(k)?.state ?? ""))) await new Promise((r) => setTimeout(r, 300));
  const drive = (await listDrives()).find((d) => d.writesCd);
  log({ step: "drive", drive: drive && { name: drive.name, path: drive.path, media: drive.media } });
  if (!drive?.media?.blank || !drive.media.supported) {
    log({ step: "stop", reason: "Insert a blank CD-R or CD-RW" });
    return app.exit(2);
  }
  const options = { gapMode, crossfadeSec: 3, normalize: true };
  const speed = [...(drive.media.speeds ?? [])].sort((a, b) => a - b)[0] ?? 0;
  const base = { driveId: drive.id, keys, options, speed, verify: true, eject: true, keepForCopies: false };
  log({ step: "dry-run", ...(await burn({ ...base, dryRun: true })) });
  if (process.env.ROMIX_BURNTEST !== "write") return app.exit(0);

  const started = Date.now();
  let last = "";
  const off = onBurnProgress((p) => {
    const key = `${p.phase}:${Math.floor((p.progress ?? 0) * 10)}`;
    if (key === last) return;
    last = key;
    log({ step: "progress", phase: p.phase, pct: Math.round((p.progress ?? 0) * 100), sec: Math.round((Date.now() - started) / 1000) });
  });
  const r = await burn(base);
  off();
  log({ step: "burned", seconds: Math.round((Date.now() - started) / 1000), speedX: speed / 75, ...r });
  app.exit(r.ok && (!r.verify || r.verify.tracks.every((t) => t.ok)) ? 0 : 1);
}

/* ---------- Startup ---------- */

app.whenReady().then(() => {
  registerAudioProtocol();
  registerCoverProtocol();
  if (process.argv.includes("--burntest")) {
    burnTest().catch((err) => {
      process.stderr.write(`burntest failed: ${err instanceof Error ? err.stack : String(err)}\n`);
      app.exit(1);
    });
    return;
  }
  if (process.argv.includes("--selftest")) {
    selfTest().catch((err) => {
      process.stderr.write(`selftest failed: ${err instanceof Error ? err.stack : String(err)}\n`);
      app.exit(1);
    });
    return;
  }
  createWindow();
  // Opened by double-clicking a .romix file: import it once the window is ready.
  const startFile = discFileArg(process.argv);
  if (startFile) win!.webContents.once("did-finish-load", () => void openDiscFile(startFile));
  // First run (or a helper went missing): install into the app folder straight away,
  // then start watching the CD drive.
  void checkDeps().then(async (list) => {
    if (list.some((d) => d.state !== "ready")) await installMissing();
    startDriveWatch();
  });
  void initUpdater();
});
// Headless test modes open and close hidden windows (PDF rendering, UI probe); they exit explicitly.
const headless = process.argv.includes("--selftest") || process.argv.includes("--burntest");
app.on("window-all-closed", () => {
  if (!headless) app.quit();
});

/* ---------- Opening .romix files from outside (double-click) ---------- */

function discFileArg(argv: string[]): string | undefined {
  return argv.slice(1).find((a) => a.toLowerCase().endsWith(".romix") && existsSync(a));
}

async function openDiscFile(path: string) {
  const r = await importDisc(path);
  win?.webContents.send("romix:disc-imported", r);
}

// One Romix at a time: a second launch (e.g. double-clicking a .romix file) hands its file to this window.
if (!headless) {
  if (!app.requestSingleInstanceLock()) app.quit();
  app.on("second-instance", (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    const f = discFileArg(argv);
    if (f) void openDiscFile(f);
  });
}

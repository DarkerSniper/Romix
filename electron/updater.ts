import { app, BrowserWindow, net, shell } from "electron";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { UpdateKind, UpdatePrefs, UpdateState } from "../src/shared/api";
import { assetName, checksumFor, compareVersions, digestSha, pickUpdate, type GhAsset, type GhRelease } from "../src/lib/releases";

import { paths } from "./paths";
import { run } from "./tools";
import { isBurning } from "./burner";

/**
 * Romix updates itself from its public GitHub releases:
 *   check    → GitHub's release list (at most once a day on launch, or from Settings)
 *   download → data/updates, verified against the release's checksums.txt (or GitHub's own digest)
 *   install  → installer copy: run the new installer silently, which keeps data/ and restarts Romix
 *              portable copy: unpack, then a small script swaps the app files once Romix has closed
 * Nothing is written outside Romix's own folder.
 */

const REPO = "DarkerSniper/Romix";
// ROMIX_UPDATE_FEED points the check at a local copy of the release list (used by the update test).
const FEED = process.env.ROMIX_UPDATE_FEED || `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const UA = { "User-Agent": "Romix", Accept: "application/vnd.github+json" };
const DAY = 24 * 3600 * 1000;

const appDir = dirname(process.execPath);
/** Where the installer last installed Romix (electron-builder keeps it under a key derived from the appId). */
function registeredInstallDir(): string | undefined {
  try {
    const out = execFileSync("reg.exe", ["query", "HKCU\\Software\\3b624e67-0fae-5a0c-8703-ce884f7a89d9", "/v", "InstallLocation"], { encoding: "utf8", windowsHide: true });
    return /InstallLocation\s+REG_\w+\s+(.+)/.exec(out)?.[1].trim();
  } catch {
    return undefined;
  }
}
const sameDir = (a?: string) => Boolean(a) && a!.replace(/[\\/]+$/, "").toLowerCase() === appDir.replace(/[\\/]+$/, "").toLowerCase();
// The installer always reinstalls into the folder it registered (its /D= switch can't take paths with spaces),
// so it's only used when that's this copy's folder. Any other copy updates by swapping its own files.
const kind: UpdateKind = !app.isPackaged ? "dev" : existsSync(join(appDir, "Uninstall Romix.exe")) && sameDir(registeredInstallDir()) ? "installer" : "portable";
const updatesDir = join(paths.root, "updates");
const prefsFile = join(paths.userData, "update.json");
const pendingFile = join(updatesDir, "pending.json");

interface Stored extends UpdatePrefs {
  lastCheck?: number;
}

// While Romix is itself a preview (before 1.0), previews are offered by default: every release so far is one.
const defaults: Stored = { auto: true, previews: compareVersions(app.getVersion(), "1.0.0") < 0 };

let stored: Stored = { ...defaults };
let release: GhRelease | undefined;
let state: UpdateState = { current: app.getVersion(), kind, phase: "idle", progress: 0, prefs: pickPrefs(stored) };
let busy: Promise<UpdateState> | null = null;

function pickPrefs(s: Stored): UpdatePrefs {
  return { auto: s.auto, previews: s.previews };
}

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("romix:update", state);
}

async function save() {
  await writeFile(prefsFile, JSON.stringify(stored, null, 2));
}

export const updateState = () => state;

/** Loads prefs, reports how the last update went, clears old downloads, then checks if it's been a day. */
export async function initUpdater() {
  try {
    stored = { ...defaults, ...JSON.parse(await readFile(prefsFile, "utf8")) };
  } catch {
    /* first run */
  }
  set({ prefs: pickPrefs(stored), lastCheck: stored.lastCheck });

  try {
    const p = JSON.parse(await readFile(pendingFile, "utf8")) as { version: string };
    set({ lastUpdate: { version: p.version, ok: compareVersions(app.getVersion(), p.version) >= 0 } });
  } catch {
    /* no update was attempted */
  }
  // Leftovers from the last update (the downloaded installer may still be closing: ignore what's locked).
  const clean = async () => {
    for (const f of await readdir(updatesDir).catch(() => [])) await removeTree(join(updatesDir, f)).catch(() => {});
  };
  await clean();
  // The installer that just reopened Romix may still be finishing: try again later, unless an update is under way by then.
  setTimeout(() => {
    if (!busy) void clean();
  }, 90_000);

  if (stored.auto && Date.now() - (stored.lastCheck ?? 0) > DAY) void checkForUpdate(true);
}

export async function setUpdatePrefs(patch: Partial<UpdatePrefs>): Promise<UpdateState> {
  if (typeof patch.auto === "boolean") stored.auto = patch.auto;
  if (typeof patch.previews === "boolean") stored.previews = patch.previews;
  await save();
  set({ prefs: pickPrefs(stored) });
  // Turning previews on or off changes which version is on offer.
  if ("previews" in patch && state.lastCheck) return checkForUpdate();
  return state;
}

export function dismissUpdate() {
  set({ dismissed: true });
}

export function openReleasePage() {
  const url = state.available?.url ?? `https://github.com/${REPO}/releases`;
  if (url.startsWith(`https://github.com/${REPO}/`)) void shell.openExternal(url);
}

function friendly(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|ERR_INTERNET|ERR_NAME|ERR_CONNECTION|fetch failed|network/i.test(m)) return "No internet connection.";
  if (/HTTP 403|HTTP 429/.test(m)) return "GitHub is busy. Try again in a little while.";
  if (/ENOSPC/i.test(m)) return "Not enough disk space.";
  if (/checksum/i.test(m)) return "The download was damaged. Try again.";
  return m;
}

/** Asks GitHub for the newest release. `quiet` checks don't show errors (e.g. offline at launch). */
export function checkForUpdate(quiet = false): Promise<UpdateState> {
  if (busy) return busy;
  busy = (async () => {
    set({ phase: "checking", error: undefined });
    try {
      const r = await net.fetch(FEED, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const list = (await r.json()) as GhRelease[];
      stored.lastCheck = Date.now();
      await save();
      release = kind === "dev" ? pickUpdate(list, app.getVersion(), { previews: stored.previews, kind: "installer" }) : pickUpdate(list, app.getVersion(), { previews: stored.previews, kind });
      if (!release) {
        set({ phase: "none", available: undefined, lastCheck: stored.lastCheck });
      } else {
        const version = release.tag_name.replace(/^v/, "");
        const asset = release.assets.find((a) => a.name === assetName(kind === "portable" ? "portable" : "installer", version));
        set({
          phase: "available",
          lastCheck: stored.lastCheck,
          dismissed: state.available?.version === version ? state.dismissed : false,
          available: {
            version,
            name: release.name || `Romix ${version}`,
            notes: release.body ?? "",
            url: release.html_url,
            prerelease: release.prerelease,
            publishedAt: release.published_at ?? "",
            bytes: asset?.size ?? 0,
          },
        });
      }
    } catch (err) {
      set(quiet ? { phase: state.available ? "available" : "idle" } : { phase: "error", error: friendly(err) });
    }
    return state;
  })().finally(() => (busy = null));
  return busy;
}

/** Only Romix's own release downloads (or the test feed's) are ever fetched. */
function trustedUrl(url: string): boolean {
  if (url.startsWith(`https://github.com/${REPO}/releases/download/`)) return true;
  return Boolean(process.env.ROMIX_UPDATE_FEED) && url.startsWith(new URL(FEED).origin + "/");
}

async function expectedSha(asset: GhAsset): Promise<string> {
  const sums = release!.assets.find((a) => a.name === "checksums.txt");
  if (sums && trustedUrl(sums.browser_download_url)) {
    const r = await net.fetch(sums.browser_download_url, { headers: { "User-Agent": "Romix" } });
    if (r.ok) {
      const sha = checksumFor(await r.text(), asset.name);
      if (sha) return sha;
    }
  }
  const sha = digestSha(asset);
  if (!sha) throw new Error("This release has no checksum, so Romix won't install it. Download it from the release page instead.");
  return sha;
}

async function download(asset: GhAsset): Promise<string> {
  if (!trustedUrl(asset.browser_download_url)) throw new Error("Unexpected download address");
  const sha = await expectedSha(asset);
  await mkdir(updatesDir, { recursive: true });
  const dest = join(updatesDir, asset.name);
  const r = await net.fetch(asset.browser_download_url, { headers: { "User-Agent": "Romix" } });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const total = Number(r.headers.get("content-length")) || asset.size || 1;
  const hash = createHash("sha256");
  const file = createWriteStream(dest);
  let got = 0, last = 0;
  const reader = r.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      got += value.length;
      if (!file.write(value)) await new Promise((res) => file.once("drain", res));
      if (Date.now() - last > 150) {
        last = Date.now();
        set({ progress: Math.min(0.99, got / total) });
      }
    }
  } finally {
    await new Promise<void>((res) => file.end(res));
  }
  if (hash.digest("hex") !== sha) {
    await rm(dest, { force: true });
    throw new Error("checksum mismatch");
  }
  set({ progress: 1 });
  return dest;
}

/** Downloads + verifies the new version, then hands over to the installer (or swap script) and quits. */
export function installUpdate(): Promise<UpdateState> {
  if (busy) return busy;
  busy = (async () => {
    if (kind === "dev" || !release || !state.available) {
      openReleasePage();
      return state;
    }
    if (isBurning()) {
      set({ phase: "error", error: "Finish burning first, then update." });
      return state;
    }
    const version = state.available.version;
    const asset = release.assets.find((a) => a.name === assetName(kind, version));
    try {
      if (!asset) throw new Error("This release has no download for your copy of Romix.");
      set({ phase: "downloading", progress: 0, error: undefined });
      const file = await download(asset);
      if (isBurning()) throw new Error("Finish burning first, then update.");
      set({ phase: "installing" });
      await writeFile(pendingFile, JSON.stringify({ version, from: app.getVersion(), at: Date.now() }));
      if (kind === "installer") launchInstaller(file);
      else await launchSwap(file, version);
      // Give the helper a moment to start, then close so it can replace Romix's files.
      setTimeout(() => app.quit(), 400);
    } catch (err) {
      await rm(pendingFile, { force: true }).catch(() => {});
      set({ phase: "error", error: friendly(err) });
    }
    return state;
  })().finally(() => (busy = null));
  return busy;
}

/** The NSIS installer, silently, into its registered folder (this one). `--updated` keeps data/; `--force-run` reopens Romix afterwards. */
function launchInstaller(file: string) {
  spawn(file, ["/S", "--updated", "--force-run"], { detached: true, stdio: "ignore" }).unref();
}

/**
 * Deletes a file or folder. Unpacked copies of Romix contain resources/app.asar, which Electron's own fs
 * treats as a folder and can't delete, so folders are removed by Windows' rmdir.
 */
async function removeTree(p: string) {
  if (!existsSync(p)) return;
  if (!statSync(p).isDirectory()) return rm(p, { force: true });
  const cmd = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
  await run(cmd, ["/d", "/c", "rmdir", "/s", "/q", p], { timeoutMs: 120_000 });
  if (existsSync(p)) throw new Error("Couldn't clear the previous update");
}

/** Unpacks the new ZIP, then a script waits for Romix to close, swaps the app files (never data/), and restarts it. */
async function launchSwap(zip: string, version: string) {
  const staging = join(updatesDir, `new-${version}`);
  await removeTree(staging);
  await mkdir(staging, { recursive: true });
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  const r = await run(tar, ["-xf", zip, "-C", staging], { timeoutMs: 300_000 });
  if (r.code !== 0 || !existsSync(join(staging, "Romix.exe"))) throw new Error("Couldn't unpack the update");
  await rm(zip, { force: true });

  const script = join(updatesDir, "swap.ps1");
  await writeFile(script, SWAP_PS1, "utf8");
  const ps = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const started = join(updatesDir, "swap.started");
  await rm(started, { force: true });
  const q = (s: string) => `"${s}"`; // Windows paths can't contain quotes
  const cmdLine = [q(ps), "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", q(script),
    "-ProcId", String(process.pid), "-AppDir", q(appDir), "-Staging", q(staging), "-Backup", q(join(updatesDir, "old")),
    "-Log", q(join(paths.logs, "update.log")), "-Started", q(started)].join(" ");
  // The script has to outlive Romix. Children Romix starts normally are closed with it, and a detached PowerShell
  // gets no console and exits at once, so Windows Script Host (a windowed program, fine detached) starts it hidden.
  const vbs = join(updatesDir, "swap.vbs");
  await writeFile(vbs, `CreateObject("WScript.Shell").Run "${cmdLine.replace(/"/g, '""')}", 0, False\r\n`, "utf8");
  const wscript = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe");
  spawn(wscript, ["//B", "//Nologo", vbs], { detached: true, stdio: "ignore" }).unref();
  // Only close Romix once the script is running and waiting for it.
  for (let i = 0; i < 100 && !existsSync(started); i++) await new Promise((r) => setTimeout(r, 150));
  if (!existsSync(started)) throw new Error("Couldn't start the updater");
}

/**
 * Replaces only the items the new version ships (Romix.exe, resources, locales, DLLs…), so a portable copy
 * unzipped into a shared folder never touches anything else there. Old items are moved aside first and put
 * back if anything fails.
 */
const SWAP_PS1 = String.raw`param([int]$ProcId, [string]$AppDir, [string]$Staging, [string]$Backup, [string]$Log, [string]$Started)
$ErrorActionPreference = 'Stop'
function Note($m) { try { Add-Content -LiteralPath $Log -Value ((Get-Date).ToString('u') + ' ' + $m) } catch {} }
Note ('portable update started, waiting for Romix (' + $ProcId + ') to close')
Set-Content -LiteralPath $Started -Value 'ok'
try { Wait-Process -Id $ProcId -Timeout 60 -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Milliseconds 500
$items = @(Get-ChildItem -LiteralPath $Staging -Force | Where-Object { $_.Name -ine 'data' })
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
$moved = @()
try {
  foreach ($i in $items) {
    $t = Join-Path $AppDir $i.Name
    if (Test-Path -LiteralPath $t) {
      for ($n = 0; ; $n++) {
        try { Move-Item -LiteralPath $t -Destination (Join-Path $Backup $i.Name) -Force; break }
        catch { if ($n -ge 60) { throw }; Start-Sleep -Milliseconds 500 }
      }
      $moved += $i.Name
    }
  }
  foreach ($i in $items) { Move-Item -LiteralPath $i.FullName -Destination (Join-Path $AppDir $i.Name) -Force }
  Note 'portable update installed'
} catch {
  Note ('portable update failed: ' + $_)
  foreach ($n in $moved) {
    $t = Join-Path $AppDir $n
    if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue }
    Move-Item -LiteralPath (Join-Path $Backup $n) -Destination $t -Force -ErrorAction SilentlyContinue
  }
}
Start-Process -FilePath (Join-Path $AppDir 'Romix.exe') -WorkingDirectory $AppDir
`;

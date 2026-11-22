import "./paths"; // must be first: keeps all app data inside the project folder
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ToolStatus, UpdateResult } from "../src/shared/api";
import { resolve } from "./resolver";
import { findRuntime, majorOf, MIN_NODE_MAJOR, run, YTDLP_BASE_ARGS, ytdlpEnv, ytdlpPath, ytdlpVersion } from "./tools";
import { writeSettings } from "./settings";

const here = dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.VITE_DEV_SERVER_URL;

const TITLEBAR = {
  dark: { color: "#1e1e1e", symbolColor: "#f5f5f7" },
  light: { color: "#ffffff", symbolColor: "#1d1d1f" },
} as const;

let win: BrowserWindow | null = null;

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
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win?.show());

  // Never navigate away or open new Electron windows; real links go to the browser.
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

async function toolStatus(): Promise<ToolStatus> {
  const [version, runtime] = await Promise.all([ytdlpVersion(), findRuntime()]);
  return {
    ytdlp: { found: Boolean(version), version, path: ytdlpPath() },
    runtime: runtime
      ? { found: true, version: runtime.version, path: runtime.path, minMajor: MIN_NODE_MAJOR }
      : { found: false, minMajor: MIN_NODE_MAJOR },
  };
}

ipcMain.handle("romix:resolve", (_e, videoId: unknown) => resolve(String(videoId)));
ipcMain.handle("romix:tools", () => toolStatus());

ipcMain.handle("romix:update-ytdlp", async (): Promise<UpdateResult> => {
  const before = await ytdlpVersion();
  if (!before) return { ok: false, message: "yt-dlp is missing. Run npm run fetch-bins." };
  const r = await run(ytdlpPath(), [...YTDLP_BASE_ARGS, "-U"], { timeoutMs: 180_000, env: ytdlpEnv(null) });
  const after = await ytdlpVersion();
  if (r.code !== 0) return { ok: false, message: "Couldn't update yt-dlp. Check your connection and try again.", version: after };
  return { ok: true, message: after && after !== before ? `Updated to ${after}` : "yt-dlp is up to date", version: after };
});

ipcMain.handle("romix:choose-runtime", async () => {
  const result = await dialog.showOpenDialog(win!, {
    title: "Choose node.exe",
    properties: ["openFile"],
    filters: [{ name: "Node.js", extensions: ["exe"] }],
  });
  const picked = result.filePaths[0];
  if (!result.canceled && picked) {
    const r = await run(picked, ["--version"], { timeoutMs: 5000 });
    const v = r.stdout.trim();
    if (/^v\d+\./.test(v) && majorOf(v) >= MIN_NODE_MAJOR) {
      writeSettings({ runtimePath: picked });
      await findRuntime(true);
    } else {
      await dialog.showMessageBox(win!, {
        type: "warning",
        message: `That isn't Node ${MIN_NODE_MAJOR} or newer`,
        detail: v ? `It reports ${v}.` : "It didn't report a Node version.",
      });
    }
  }
  return toolStatus();
});

ipcMain.on("romix:titlebar-theme", (_e, theme: unknown) => {
  const t = theme === "light" ? TITLEBAR.light : TITLEBAR.dark;
  win?.setTitleBarOverlay({ ...t, height: 36 });
  win?.setBackgroundColor(t.color);
});

/**
 * `electron . --selftest` resolves ROMIX_SELFTEST_IDS through the real
 * pipeline (runtime discovery, yt-dlp, covers, cache), prints JSON and exits.
 * Used by `npm run test:live`; no window is shown.
 */
async function selfTest() {
  const ids = (process.env.ROMIX_SELFTEST_IDS ?? "").split(",").filter(Boolean);
  const tools = await toolStatus();
  const results = [];
  for (const id of ids) {
    const started = Date.now();
    const r = await resolve(id);
    results.push(
      r.ok
        ? { id, ok: true, cached: r.cached, ms: Date.now() - started, title: r.track.title, artist: r.track.artist, durationSec: r.track.durationSec, cover: r.track.coverDataUrl ? r.track.coverDataUrl.slice(0, 22) + `… (${Math.round(r.track.coverDataUrl.length / 1024)} KB)` : null }
        : { id, ok: false, code: r.code, message: r.message },
    );
  }
  // Load the built UI in a hidden, fully sandboxed window and confirm the bridge is wired.
  const probe = new BrowserWindow({
    show: false,
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  await probe.loadFile(join(here, "../dist/index.html"));
  const renderer = JSON.parse(
    await probe.webContents.executeJavaScript(
      `(async () => JSON.stringify({ bridge: Object.keys(window.romix || {}), shell: document.documentElement.dataset.shell, theme: document.documentElement.dataset.theme, appMounted: document.querySelector(".app") !== null, nodeVisible: typeof require !== "undefined" || typeof process !== "undefined", ytdlpFromUi: (await window.romix.tools()).ytdlp.version }))()`,
    ),
  );
  probe.destroy();

  process.stdout.write(JSON.stringify({ tools, results, renderer }, null, 2) + "\n");
  app.exit(0);
}

if (process.argv.includes("--selftest")) {
  app.whenReady().then(() =>
    selfTest().catch((err) => {
      process.stderr.write(`selftest failed: ${err instanceof Error ? err.stack : String(err)}\n`);
      app.exit(1);
    }),
  );
} else {
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}

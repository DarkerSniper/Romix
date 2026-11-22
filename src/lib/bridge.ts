import type { DepStatus, PrepUpdate, RomixBridge } from "../shared/api";
import { mockMetadata } from "./mock";

declare global {
  interface Window {
    romix?: RomixBridge;
  }
}

/** True inside the Electron desktop shell; false in the plain browser preview. */
export const isDesktop = typeof window !== "undefined" && Boolean(window.romix);

/* ---------- Browser preview stand-in (design work only: no real audio) ---------- */

const prepListeners = new Set<(u: PrepUpdate) => void>();
const READY_DEPS: DepStatus[] = [
  { id: "ytdlp", name: "yt-dlp", purpose: "Reads songs from YouTube", approxMB: 24, state: "ready", progress: 1, version: "preview" },
  { id: "ffmpeg", name: "FFmpeg", purpose: "Converts audio to CD quality", approxMB: 87, state: "ready", progress: 1, version: "preview" },
  { id: "node", name: "Node.js", purpose: "Lets yt-dlp pass YouTube's checks", approxMB: 34, state: "ready", progress: 1, version: "preview" },
];

const mockBridge: RomixBridge = {
  async resolve(videoId) {
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 900));
    const meta = mockMetadata(videoId);
    return {
      ok: true,
      cached: false,
      track: { videoId, title: meta.title, artist: meta.artist, durationSec: meta.durationSec, coverDataUrl: meta.cover, webpageUrl: `https://www.youtube.com/watch?v=${videoId}` },
    };
  },
  deps: async () => READY_DEPS,
  installDeps: async () => READY_DEPS,
  onDepsUpdate: () => () => {},
  async prepare(source) {
    const key = source.kind === "youtube" ? `yt-${source.videoId}` : `file-${source.path}`;
    let p = 0;
    const tick = () => {
      p = Math.min(1, p + 0.08 + Math.random() * 0.1);
      const state = p >= 1 ? "ready" : p < 0.7 ? "downloading" : "converting";
      prepListeners.forEach((cb) => cb({ key, state, progress: p }));
      if (p < 1) setTimeout(tick, 180);
    };
    setTimeout(tick, 200);
    return key;
  },
  cancelPrep: () => {},
  onPrepUpdate: (cb) => {
    prepListeners.add(cb);
    return () => prepListeners.delete(cb);
  },
  renderDisc: async () => ({ ok: false, message: "Disc preview plays in the desktop app" }),
  pathForFile: (file) => file.name,
  cacheInfo: async () => ({ bytes: 0, files: 0, path: "" }),
  clearCache: async () => ({ bytes: 0, files: 0, path: "" }),
  updateYtdlp: async () => ({ ok: false, message: "Available in the desktop app" }),
  setTitleBarTheme: () => {},
};

export const bridge: RomixBridge = isDesktop ? window.romix! : mockBridge;

import type { BurnProgress, DepStatus, DriveInfo, PrepUpdate, Project, ProjectSummary, RomixBridge } from "../shared/api";
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

  drives: async () => [PREVIEW_DRIVE],
  onDrivesUpdate: () => () => {},
  async burn(req) {
    const phases: Array<[BurnProgress["phase"], number]> = [["build", 6], ["prepare", 4], ["burn", 40], ["finish", 4]];
    if (req.verify) phases.push(["verify", 24]);
    for (const [phase, steps] of phases) {
      for (let i = 0; i <= steps; i++) {
        if (burnCancelled) {
          burnCancelled = false;
          return { ok: false, message: "The burn was stopped", cancelled: true };
        }
        burnListeners.forEach((cb) => cb({ phase, progress: i / steps, remainingSec: phase === "burn" ? Math.round((steps - i) * 4) : undefined }));
        await new Promise((r) => setTimeout(r, 70));
      }
    }
    return { ok: true, speedX: 16, verify: req.verify ? { offset: 0, tracks: req.keys.map((_, i) => ({ track: i + 1, ok: true, differentSamples: 0, unreadableSectors: 0 })) } : undefined };
  },
  onBurnProgress: (cb) => {
    burnListeners.add(cb);
    return () => burnListeners.delete(cb);
  },
  cancelBurn: () => {
    burnCancelled = true;
  },
  endBurnSession: () => {},
  eject: async () => {},
  erase: async () => ({ ok: true }),

  async analyze(key) {
    // Deterministic fake analysis so the preview can show badges, trimming and sorting.
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const dur = 180 + (h % 180);
    const peaks = Array.from({ length: 600 }, (_, i) => {
      const edge = Math.min(1, i / 30, (600 - i) / 40);
      return Math.round(Math.max(0, edge) * (0.35 + 0.5 * Math.abs(Math.sin(i / 9 + h))) * 1000) / 1000;
    });
    return { bpm: 80 + (h % 90), key: null, camelot: `${(h % 12) + 1}${h % 2 ? "A" : "B"}`, durationSec: dur, musicStartSec: 0.8 + (h % 4), musicEndSec: dur - 1 - (h % 6), peaks };
  },
  storeCover: async (dataUrl) => dataUrl,
  listShelf: async () => [],
  removeFromShelf: async () => {},
  outputInserts: async () => ({ ok: false, message: "Printing and PDFs work in the desktop app" }),
  setCachePolicy: () => {},

  listProjects: async () => previewProjects().map(summarize),
  loadProject: async (id) => previewProjects().find((p) => p.id === id) ?? null,
  async saveProject(p) {
    const full: Project = { ...p, updatedAt: Date.now() };
    writePreviewProjects([full, ...previewProjects().filter((x) => x.id !== p.id)]);
    return summarize(full);
  },
  deleteProject: async (id) => writePreviewProjects(previewProjects().filter((p) => p.id !== id)),
};

/* Browser preview helpers */
const burnListeners = new Set<(p: BurnProgress) => void>();
let burnCancelled = false;
const PREVIEW_DRIVE: DriveInfo = {
  id: "preview",
  name: "Preview CD burner",
  path: "E:\\",
  writesCd: true,
  media: { present: true, type: "CD-R", blank: true, supported: true, lastLeadout: 359_849, speeds: [600, 1200, 1800, 3600] },
};
function summarize(p: Project): ProjectSummary {
  return { id: p.id, title: p.title, updatedAt: p.updatedAt, songs: p.tracks.length, durationSec: p.tracks.reduce((n, t) => n + t.durationSec, 0), covers: p.tracks.slice(0, 4).map((t) => t.cover) };
}
function previewProjects(): Project[] {
  try {
    return JSON.parse(localStorage.getItem("romix.previewProjects") ?? "[]") as Project[];
  } catch {
    return [];
  }
}
function writePreviewProjects(list: Project[]) {
  try {
    localStorage.setItem("romix.previewProjects", JSON.stringify(list));
  } catch {
    /* preview only */
  }
}

export const bridge: RomixBridge = isDesktop ? window.romix! : mockBridge;

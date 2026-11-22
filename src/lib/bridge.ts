import type { RomixBridge, ToolStatus } from "../shared/api";
import { mockMetadata } from "./mock";

declare global {
  interface Window {
    romix?: RomixBridge;
  }
}

/** True inside the Electron desktop shell; false in the plain browser preview. */
export const isDesktop = typeof window !== "undefined" && Boolean(window.romix);

const browserTools: ToolStatus = {
  ytdlp: { found: false, path: "" },
  runtime: { found: false, minMajor: 22 },
};

/** Browser preview stand-in: invented songs after a short delay, so the UI can be designed without yt-dlp. */
const mockBridge: RomixBridge = {
  async resolve(videoId) {
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 900));
    const meta = mockMetadata(videoId);
    return {
      ok: true,
      cached: false,
      track: {
        videoId,
        title: meta.title,
        artist: meta.artist,
        durationSec: meta.durationSec,
        coverDataUrl: meta.cover,
        webpageUrl: `https://www.youtube.com/watch?v=${videoId}`,
      },
    };
  },
  tools: async () => browserTools,
  updateYtdlp: async () => ({ ok: false, message: "Available in the desktop app" }),
  chooseRuntime: async () => browserTools,
  setTitleBarTheme: () => {},
};

export const bridge: RomixBridge = isDesktop ? window.romix! : mockBridge;

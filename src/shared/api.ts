/**
 * Contract between the Electron main process and the renderer, exposed on
 * `window.romix` by electron/preload.ts. Plain data only (structured-clone safe).
 */

export type ResolveErrorCode =
  | "private"
  | "unavailable"
  | "age"
  | "members"
  | "live"
  | "too-long"
  | "offline"
  | "bot-check"
  | "timeout"
  | "no-ytdlp"
  | "no-runtime"
  | "unknown";

export interface ResolvedTrack {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
  /** Thumbnail as a data URL (any aspect ratio; the renderer squares it). Null if it couldn't be fetched. */
  coverDataUrl: string | null;
  webpageUrl: string;
}

export type ResolveResult =
  | { ok: true; track: ResolvedTrack; cached: boolean }
  | { ok: false; code: ResolveErrorCode; message: string };

export interface ToolStatus {
  ytdlp: { found: boolean; version?: string; path: string };
  runtime: { found: boolean; version?: string; path?: string; minMajor: number };
}

export interface UpdateResult {
  ok: boolean;
  message: string;
  version?: string;
}

export interface RomixBridge {
  resolve(videoId: string): Promise<ResolveResult>;
  tools(): Promise<ToolStatus>;
  updateYtdlp(): Promise<UpdateResult>;
  /** Opens a file picker for node.exe. Returns the new status (unchanged if cancelled or invalid). */
  chooseRuntime(): Promise<ToolStatus>;
  setTitleBarTheme(theme: "dark" | "light"): void;
}

/** Minimal subset of yt-dlp's --dump-json output that Romix reads. */
export interface YtdlpInfo {
  id: string;
  title?: string;
  track?: string | null;
  artist?: string | null;
  artists?: string[] | null;
  creator?: string | null;
  album?: string | null;
  channel?: string | null;
  uploader?: string | null;
  duration?: number | null;
  is_live?: boolean | null;
  live_status?: string | null;
  availability?: string | null;
  webpage_url?: string;
  thumbnails?: Array<{ url: string; width?: number; height?: number; preference?: number }>;
}

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

/* ---------- Built-in setup: helper programs Romix downloads into its own folder ---------- */

export type DepId = "ytdlp" | "ffmpeg" | "node";

export interface DepStatus {
  id: DepId;
  name: string;
  purpose: string;
  approxMB: number;
  state: "missing" | "downloading" | "installing" | "ready" | "error";
  progress: number;
  version?: string;
  error?: string;
}

export interface UpdateResult {
  ok: boolean;
  message: string;
  version?: string;
}

/* ---------- Milestone 3: preparing audio and building the disc ---------- */

/** What to prepare: a YouTube video or a local audio file. */
export type PrepSource = { kind: "youtube"; videoId: string } | { kind: "file"; path: string };

export type PrepState = "queued" | "downloading" | "converting" | "ready" | "error";

export interface PrepUpdate {
  /** Stable id of the source ("yt-<id>" or "file-<hash>"). */
  key: string;
  state: PrepState;
  /** 0–1 across download + convert. */
  progress: number;
  error?: string;
  /** Set when ready: duration of the converted audio. */
  durationSec?: number;
}

export interface DiscRequest {
  keys: string[];
  options: { gapMode: "none" | "gap2" | "crossfade"; crossfadeSec: number; normalize: boolean };
}

export interface RenderedTrack {
  key: string;
  /** Streamable URL of the exact audio that will be burned (romix-audio://disc/…). */
  url: string;
  samples: number;
  pregap: number;
  startSample: number;
  gainDb: number;
}

export type RenderResult =
  | { ok: true; tracks: RenderedTrack[]; totalSamples: number; targetLufs: number | null }
  | { ok: false; message: string };

export interface CacheInfo {
  bytes: number;
  files: number;
  path: string;
}

export interface RomixBridge {
  resolve(videoId: string): Promise<ResolveResult>;
  /** Starts (or joins) preparing a source. Progress arrives through onPrepUpdate. Returns the source key. */
  prepare(source: PrepSource): Promise<string>;
  cancelPrep(key: string): void;
  onPrepUpdate(cb: (u: PrepUpdate) => void): () => void;
  renderDisc(req: DiscRequest): Promise<RenderResult>;
  /** Absolute path of a dropped file (desktop only). */
  pathForFile(file: File): string;
  cacheInfo(): Promise<CacheInfo>;
  clearCache(): Promise<CacheInfo>;
  /** Current state of the helper programs (checks the app folder). */
  deps(): Promise<DepStatus[]>;
  /** Downloads and installs whatever is missing into the app folder. */
  installDeps(): Promise<DepStatus[]>;
  onDepsUpdate(cb: (list: DepStatus[]) => void): () => void;
  updateYtdlp(): Promise<UpdateResult>;
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

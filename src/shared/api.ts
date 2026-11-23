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

export type DepId = "ytdlp" | "ffmpeg" | "node" | "burner";

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
  options: { gapMode: "none" | "gap2" | "crossfade"; crossfadeSec: number; normalize: boolean; speedPct?: number };
  /** Per-song trims (seconds into the song). Missing = untrimmed. */
  trims?: Record<string, TrackTrim>;
}

export interface TrackTrim {
  startSec: number;
  endSec: number;
}

/* ---------- Milestone 5: analysis ---------- */

export interface TrackAnalysis {
  bpm: number | null;
  /** "A minor" */
  key: string | null;
  /** DJ-style Camelot code, e.g. "8A" */
  camelot: string | null;
  durationSec: number;
  /** Where the music actually starts and ends (silence excluded). */
  musicStartSec: number;
  musicEndSec: number;
  /** Waveform peaks (0–1) for the trim editor. */
  peaks: number[];
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

/* ---------- Milestone 4: burning ---------- */

export interface DriveMedia {
  present: boolean;
  /** "none" | "CD-R" | "CD-RW" | "CD-ROM" | "DVD" | "other" */
  type: string;
  blank?: boolean;
  erasable?: boolean;
  /** Can Windows' engine write audio to this disc in one pass? */
  supported?: boolean;
  /** Last sector where the disc's lead-out may start: the usable capacity. */
  lastLeadout?: number;
  /** Write speeds the drive offers for this disc, in sectors per second (75 = 1x). */
  speeds?: number[];
}

export interface DriveInfo {
  id: string;
  name: string;
  path: string;
  writesCd: boolean;
  media?: DriveMedia;
  error?: string;
}

export interface BurnRequest {
  driveId: string;
  keys: string[];
  options: DiscRequest["options"];
  trims?: DiscRequest["trims"];
  /** What to record on the Shelf after a successful burn. */
  record?: { title: string; tracks: SavedTrack[] };
  /** Sectors per second; 0 = the drive's fastest. */
  speed: number;
  verify: boolean;
  eject: boolean;
  /** Keep the prepared burn files for another copy. */
  keepForCopies: boolean;
  /** Check everything (disc, capacity, layout) without writing. */
  dryRun?: boolean;
}

export interface BurnProgress {
  phase: "build" | "prepare" | "burn" | "finish" | "verify" | "erase";
  /** 0–1 within the phase, when known. */
  progress?: number;
  remainingSec?: number;
}

export interface VerifyReport {
  /** Combined write+read offset of the drive, in samples (normal: a few hundred). */
  offset: number;
  tracks: Array<{ track: number; ok: boolean; differentSamples: number; unreadableSectors: number }>;
}

export type BurnResult =
  | { ok: true; speedX?: number; verify?: VerifyReport; dryRun?: boolean }
  | { ok: false; message: string; cancelled?: boolean };

/* ---------- Saved projects ---------- */

export interface SavedTrack {
  title: string;
  artist: string;
  durationSec: number;
  cover: string;
  color: string;
  source: "youtube" | "local";
  videoId?: string;
  filePath?: string;
  url?: string;
  trimStartSec?: number;
  trimEndSec?: number;
}

export interface Project {
  id: string;
  title: string;
  updatedAt: number;
  options: DiscRequest["options"];
  tracks: SavedTrack[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: number;
  songs: number;
  durationSec: number;
  covers: string[];
}

export interface ShelfEntry {
  id: string;
  /** Identifies "the same disc" so repeat copies add to one entry. */
  signature: string;
  burnedAt: number;
  title: string;
  tracks: SavedTrack[];
  options: DiscRequest["options"];
  copies: number;
  verified: "ok" | "issues" | "skipped";
  speedX?: number;
}

export type InsertAction = "pdf" | "print";

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

  drives(): Promise<DriveInfo[]>;
  onDrivesUpdate(cb: (drives: DriveInfo[]) => void): () => void;
  burn(req: BurnRequest): Promise<BurnResult>;
  onBurnProgress(cb: (p: BurnProgress) => void): () => void;
  /** Stops a burn in progress. A CD-R stopped mid-burn can't be used again. */
  cancelBurn(): void;
  /** Deletes prepared burn files once no more copies are wanted. */
  endBurnSession(): void;
  eject(driveId: string): Promise<void>;
  erase(driveId: string): Promise<{ ok: boolean; message?: string }>;

  /** Tempo, key, silence and waveform for a prepared song (cached). */
  analyze(key: string): Promise<TrackAnalysis | null>;
  listShelf(): Promise<ShelfEntry[]>;
  removeFromShelf(id: string): Promise<void>;
  /** Saves the inserts page as a PDF (file dialog) or prints it. */
  outputInserts(html: string, action: InsertAction, title: string, paper: "A4" | "Letter"): Promise<{ ok: boolean; message: string; path?: string }>;
  /** Cache size limit and the songs on the open disc (never pruned). */
  setCachePolicy(limitGB: number, activeKeys: string[]): void;

  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<Project | null>;
  saveProject(p: Omit<Project, "updatedAt">): Promise<ProjectSummary>;
  deleteProject(id: string): Promise<void>;
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

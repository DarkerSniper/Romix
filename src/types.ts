export type TrackSource = "youtube" | "local";
export type TrackStatus = "resolving" | "ready" | "error";

export interface Track {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  /** Image URL or data URI for the cover / thumbnail. */
  cover: string;
  /** Print-resolution cover (romix-cover:// URL), when available. */
  coverHi?: string;
  /** Dominant colour of the cover, used for tints and the ambient background. */
  color: string;
  source: TrackSource;
  status: TrackStatus;
  /** YouTube video id, for duplicate detection. */
  videoId?: string;
  url?: string;
  error?: string;
  /** Key of the prepared audio (download + conversion) for this song. */
  sourceKey?: string;
  /** Local files: absolute path on disk (desktop only). */
  filePath?: string;
  /** Trimmed range within the song, in seconds. */
  trimStartSec?: number;
  trimEndSec?: number;
}

export type GapMode = "none" | "gap2" | "crossfade";

export interface DiscOptions {
  gapMode: GapMode;
  crossfadeSec: number;
  normalize: boolean;
  /** Optional slight speed-up to fit the disc (0–2 %, pitch kept). */
  speedPct?: number;
}

export type Page = "disc" | "projects" | "shelf" | "inserts" | "settings";

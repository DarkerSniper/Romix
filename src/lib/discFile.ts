/**
 * The .romix shared-disc file: one self-contained file with a disc's songs,
 * order, trims, options and covers (and optionally the sender's own audio files).
 *
 *   bytes 0–7   magic "ROMIXDSC"
 *   bytes 8–9   format version (uint16 LE)
 *   bytes 10–13 manifest length (uint32 LE)
 *   …           manifest (UTF-8 JSON)
 *   …           blobs (covers, audio), back to back; the manifest gives each
 *               one's offset (from the start of the blob area), length, type and SHA-256
 *
 * Reading is strict: the file is data only (songs, settings, pictures, audio).
 * Everything is type-checked and size-limited before Romix uses it.
 */

import { sanitizeDesign, type InsertDesign } from "./insertDesign";

export const MAGIC = "ROMIXDSC";
export const FORMAT_VERSION = 1;
const HEADER = 14;

export const LIMITS = {
  fileBytes: 2_000_000_000,
  manifestBytes: 4_000_000,
  tracks: 200,
  blobs: 600,
  coverBytes: 25_000_000,
  audioBytes: 600_000_000,
  text: 300,
} as const;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const AUDIO_EXT = ["mp3", "flac", "wav", "m4a", "ogg", "opus", "aac"] as const;

export interface BlobRef {
  blob: number;
}

export interface SharedTrack {
  title: string;
  artist: string;
  durationSec: number;
  color: string;
  source: "youtube" | "local";
  videoId?: string;
  trimStartSec?: number;
  trimEndSec?: number;
  /** Small cover for the interface. */
  cover?: BlobRef;
  /** Print-resolution cover. */
  coverHi?: BlobRef;
  coverPx?: number;
  /** The sender's own audio file, when they chose to include it. */
  audio?: BlobRef & { ext: string };
}

export interface BlobEntry {
  offset: number;
  length: number;
  type: string;
  sha256: string;
}

export interface DiscManifest {
  format: "romix-disc";
  version: number;
  createdAt: number;
  app: string;
  disc: {
    title: string;
    options: { gapMode: "none" | "gap2" | "crossfade"; crossfadeSec: number; normalize: boolean; speedPct?: number };
    /** The inserts design; its pictures are "blob:N" references to parts of the file. */
    inserts?: InsertDesign;
  };
  tracks: SharedTrack[];
  blobs: BlobEntry[];
}

/* ---------- writing ---------- */

/** Builds the file from a manifest (whose blob table is filled in here) and the blob bytes, in order. */
export function encodeDisc(manifest: Omit<DiscManifest, "blobs">, blobs: Array<{ type: string; sha256: string; bytes: Uint8Array }>): Uint8Array[] {
  let offset = 0;
  const table: BlobEntry[] = blobs.map((b) => {
    const e = { offset, length: b.bytes.length, type: b.type, sha256: b.sha256 };
    offset += b.bytes.length;
    return e;
  });
  const json = new TextEncoder().encode(JSON.stringify({ ...manifest, blobs: table }));
  const head = new Uint8Array(HEADER);
  head.set(new TextEncoder().encode(MAGIC), 0);
  const view = new DataView(head.buffer);
  view.setUint16(8, FORMAT_VERSION, true);
  view.setUint32(10, json.length, true);
  // Returned as parts so large audio never has to be copied into one buffer.
  return [head, json, ...blobs.map((b) => b.bytes)];
}

/* ---------- reading ---------- */

export class DiscFileError extends Error {}

const fail = (msg: string): never => {
  throw new DiscFileError(msg);
};

const str = (v: unknown, field: string, max: number = LIMITS.text): string => {
  if (typeof v !== "string") fail(`${field} is missing`);
  return (v as string).slice(0, max);
};
const num = (v: unknown, field: string, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) fail(`${field} is out of range`);
  return v as number;
};
const optNum = (v: unknown, field: string, min: number, max: number) => (v === undefined || v === null ? undefined : num(v, field, min, max));

function blobRef(v: unknown, blobCount: number, field: string): BlobRef | undefined {
  if (v === undefined || v === null) return undefined;
  const b = (v as BlobRef).blob;
  if (!Number.isInteger(b) || b < 0 || b >= blobCount) fail(`${field} points to a missing part`);
  return { blob: b };
}

/** Reads and validates the header and manifest. Blobs are checked against the file size here and hashed by the caller. */
export function decodeManifest(head: Uint8Array, fileSize: number): { manifest: DiscManifest; blobStart: number } {
  if (fileSize > LIMITS.fileBytes) fail("This file is too large");
  if (head.length < HEADER) fail("This isn't a Romix disc file");
  if (new TextDecoder().decode(head.slice(0, 8)) !== MAGIC) fail("This isn't a Romix disc file");
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const version = view.getUint16(8, true);
  if (version > FORMAT_VERSION) fail("This disc was shared from a newer Romix. Update Romix to open it.");
  const len = view.getUint32(10, true);
  if (len === 0 || len > LIMITS.manifestBytes) fail("This disc file is damaged");
  if (head.length < HEADER + len) fail("This disc file is incomplete");

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(head.slice(HEADER, HEADER + len)));
  } catch {
    return fail("This disc file is damaged");
  }
  if (raw.format !== "romix-disc") fail("This isn't a Romix disc file");

  const blobStart = HEADER + len;
  const blobArea = fileSize - blobStart;
  const rawBlobs = Array.isArray(raw.blobs) ? raw.blobs : fail("This disc file is damaged");
  if (rawBlobs.length > LIMITS.blobs) fail("This disc file has too many parts");
  const blobs: BlobEntry[] = rawBlobs.map((b: Record<string, unknown>, i: number) => {
    const offset = b.offset, length = b.length;
    if (typeof offset !== "number" || typeof length !== "number" || !Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 1) fail("This disc file is damaged");
    if ((offset as number) + (length as number) > blobArea) fail("This disc file is incomplete");
    const type = str(b.type, `part ${i} type`, 40);
    const sha256 = str(b.sha256, `part ${i} checksum`, 64);
    if (!/^[a-f0-9]{64}$/.test(sha256)) fail("This disc file is damaged");
    return { offset: offset as number, length: length as number, type, sha256 };
  });

  const disc = (raw.disc ?? {}) as Record<string, unknown>;
  const o = (disc.options ?? {}) as Record<string, unknown>;
  const gapMode = o.gapMode === "none" || o.gapMode === "gap2" || o.gapMode === "crossfade" ? o.gapMode : "gap2";

  const rawTracks = Array.isArray(raw.tracks) ? raw.tracks : fail("This disc has no songs");
  if (rawTracks.length === 0) fail("This disc has no songs");
  if (rawTracks.length > LIMITS.tracks) fail("This disc has too many songs");

  const tracks: SharedTrack[] = rawTracks.map((t: Record<string, unknown>, i: number) => {
    const field = `song ${i + 1}`;
    const source = t.source === "local" ? "local" : "youtube";
    const videoId = t.videoId === undefined ? undefined : str(t.videoId, `${field} link`, 11);
    if (videoId !== undefined && !/^[\w-]{11}$/.test(videoId)) fail(`${field} has an invalid YouTube link`);
    if (source === "youtube" && !videoId) fail(`${field} is missing its YouTube link`);
    const cover = blobRef(t.cover, blobs.length, `${field} cover`);
    const coverHi = blobRef(t.coverHi, blobs.length, `${field} cover`);
    for (const ref of [cover, coverHi]) if (ref && !(IMAGE_TYPES as readonly string[]).includes(blobs[ref.blob].type)) fail(`${field} cover isn't a picture`);
    for (const ref of [cover, coverHi]) if (ref && blobs[ref.blob].length > LIMITS.coverBytes) fail(`${field} cover is too large`);
    let audio: SharedTrack["audio"];
    if (t.audio !== undefined && t.audio !== null) {
      const a = t.audio as Record<string, unknown>;
      const ref = blobRef(a, blobs.length, `${field} audio`)!;
      const ext = str(a.ext, `${field} audio type`, 5).toLowerCase();
      if (!(AUDIO_EXT as readonly string[]).includes(ext)) fail(`${field} audio type isn't supported`);
      if (blobs[ref.blob].length > LIMITS.audioBytes) fail(`${field} audio is too large`);
      audio = { blob: ref.blob, ext };
    }
    if (source === "local" && !audio) {
      // A local song without its audio can't be prepared; keep it so the receiver sees what's missing.
    }
    const duration = num(t.durationSec, `${field} length`, 0.5, 6 * 3600);
    const trimStartSec = optNum(t.trimStartSec, `${field} trim`, 0, duration);
    const trimEndSec = optNum(t.trimEndSec, `${field} trim`, 0, duration + 1);
    const color = typeof t.color === "string" && /^(#[0-9a-f]{3,8}|hsl\([\d.\s%,]+\))$/i.test(t.color) ? t.color : "#888888";
    return {
      title: str(t.title, `${field} title`) || "Untitled",
      artist: str(t.artist, `${field} artist`) || "Unknown artist",
      durationSec: duration,
      color,
      source,
      videoId,
      trimStartSec,
      trimEndSec,
      cover,
      coverHi,
      coverPx: optNum(t.coverPx, `${field} cover size`, 1, 20000),
      audio,
    };
  });

  // The inserts design: every picture must be one of the file's image parts.
  const blobImage = (u: unknown) => {
    const m = typeof u === "string" ? /^blob:(\d+)$/.exec(u) : null;
    const b = m ? blobs[Number(m[1])] : undefined;
    return b && (IMAGE_TYPES as readonly string[]).includes(b.type) && b.length <= LIMITS.coverBytes ? (u as string) : undefined;
  };
  const inserts = disc.inserts ? sanitizeDesign(disc.inserts, blobImage, tracks.map((_, i) => `n:${i}`)) : undefined;

  return {
    blobStart,
    manifest: {
      format: "romix-disc",
      version,
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
      app: typeof raw.app === "string" ? raw.app.slice(0, 60) : "",
      disc: {
        title: str(disc.title, "disc title") || "Shared disc",
        options: {
          gapMode,
          crossfadeSec: optNum(o.crossfadeSec, "crossfade", 1, 8) ?? 3,
          normalize: o.normalize === true,
          speedPct: optNum(o.speedPct, "speed", 0, 3) ?? 0,
        },
        inserts,
      },
      tracks,
      blobs,
    },
  };
}

/** Plain list of the disc's YouTube links, for messages and email. */
export function linksText(title: string, tracks: Array<{ title: string; artist: string; videoId?: string }>): string {
  const lines = tracks.filter((t) => t.videoId).map((t, i) => `${i + 1}. ${t.title} · ${t.artist}\nhttps://music.youtube.com/watch?v=${t.videoId}`);
  return `${title}\n\n${lines.join("\n\n")}\n`;
}

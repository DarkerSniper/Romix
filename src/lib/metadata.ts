import type { YtdlpInfo } from "../shared/api";

/**
 * Turns yt-dlp metadata into a clean { title, artist, album }.
 *
 * YouTube Music "song" uploads carry real track/artist fields. Music videos
 * usually don't, so we fall back to parsing "Artist - Title (Official Video)".
 */

/** Bracketed video-ish noise: (Official Video), [Lyrics], (Official Video Remastered 2011), (HD)… */
const BRACKET_NOISE =
  /\s*[([]\s*(?:official\s+)?(?:music\s+|lyrics?\s+)?(?:video|audio|visuali[sz]er|lyrics?|mv|m\/v|hd|hq|4k|clip|explicit|clean)(?:\s+(?:video|version))?(?:\s+(?:remaster(?:ed)?|hd|4k))?(?:\s+\d{4})?\s*[)\]]/gi;

/** Trailing unbracketed noise: "… M/V", "… Official Music Video". */
const TRAILING_NOISE = /\s+(?:m\/v|mv|official\s+(?:music\s+)?video|official\s+audio|lyric\s+video)\s*$/i;

const SEPARATOR = /\s+[-–—]\s+/;

export function cleanTitle(s: string): string {
  return s.replace(BRACKET_NOISE, "").replace(TRAILING_NOISE, "").replace(/\s{2,}/g, " ").trim();
}

/** "Queen - Topic" → "Queen", "EdSheeranVEVO" → "EdSheeran", "Adele Official" → "Adele". */
export function cleanChannel(s: string): string {
  return s
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\s+official(?:\s+(?:channel|youtube))?$/i, "")
    .trim();
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  for (const v of values) if (v && v.trim()) return v.trim();
  return undefined;
}

export interface NormalizedMeta {
  title: string;
  artist: string;
  album?: string;
}

export function normalizeMeta(info: YtdlpInfo): NormalizedMeta {
  const album = firstNonEmpty(info.album);
  const listedArtist = info.artists?.length ? info.artists.join(", ") : firstNonEmpty(info.artist, info.creator);

  if (info.track && info.track.trim()) {
    return {
      title: cleanTitle(info.track),
      artist: listedArtist ?? cleanChannel(firstNonEmpty(info.channel, info.uploader) ?? "Unknown artist"),
      album,
    };
  }

  const raw = firstNonEmpty(info.title) ?? "Untitled";
  const parts = raw.split(SEPARATOR);
  if (parts.length >= 2) {
    const artist = parts[0].trim();
    const title = cleanTitle(parts.slice(1).join(" - "));
    if (artist && title) return { title, artist: listedArtist ?? artist, album };
  }

  return {
    title: cleanTitle(raw) || raw,
    artist: listedArtist ?? cleanChannel(firstNonEmpty(info.channel, info.uploader) ?? "Unknown artist"),
    album,
  };
}

import type { DiscOptions, Track } from "../types";

/** Red Book audio CD limits. */
export const CD_MAX_SEC = 80 * 60;
/** Past this some older players struggle (74-minute discs / tight tolerances). */
export const CD_SAFE_SEC = 74 * 60;

export function formatTime(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Total playing time of the disc, including gaps or minus crossfade overlap. */
export function discLength(tracks: Track[], opts: DiscOptions): number {
  const sum = tracks.reduce((acc, t) => acc + t.durationSec, 0);
  const joins = Math.max(0, tracks.length - 1);
  if (opts.gapMode === "gap2") return sum + joins * 2;
  if (opts.gapMode === "crossfade") return Math.max(0, sum - joins * opts.crossfadeSec);
  return sum;
}

export type CapacityLevel = "ok" | "tight" | "over";

export function capacityLevel(sec: number): CapacityLevel {
  if (sec > CD_MAX_SEC) return "over";
  if (sec > CD_SAFE_SEC) return "tight";
  return "ok";
}

const YT_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"];

export type ParsedLink =
  | { ok: true; videoId: string; url: string }
  | { ok: false; input: string; reason: string };

/** Accepts youtube.com/watch, music.youtube.com/watch, youtu.be and /shorts links. */
export function parseYouTubeLink(raw: string): ParsedLink {
  const input = raw.trim();
  let url: URL;
  try {
    url = new URL(input.startsWith("http") ? input : `https://${input}`);
  } catch {
    return { ok: false, input, reason: "That isn't a link" };
  }
  if (!YT_HOSTS.includes(url.hostname)) {
    return { ok: false, input, reason: "Only YouTube and YouTube Music links work" };
  }
  let id: string | null = null;
  if (url.hostname === "youtu.be") id = url.pathname.slice(1).split("/")[0] || null;
  else if (url.pathname.startsWith("/shorts/")) id = url.pathname.split("/")[2] || null;
  else id = url.searchParams.get("v");

  if (!id) {
    if (url.searchParams.get("list")) {
      return { ok: false, input, reason: "Playlist links aren't supported, add songs one by one" };
    }
    return { ok: false, input, reason: "Couldn't find a song in that link" };
  }
  if (!/^[\w-]{11}$/.test(id)) return { ok: false, input, reason: "That video id looks wrong" };
  return { ok: true, videoId: id, url: `https://music.youtube.com/watch?v=${id}` };
}

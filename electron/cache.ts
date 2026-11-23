import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedTrack } from "../src/shared/api";
import { paths } from "./paths";

// v3: covers are the largest available (for printing, preferring yt-dlp's best-ranked thumbnail), so older entries are refetched.
const VERSION = 4;
const dir = () => paths.trackCache;
const safeId = (id: string) => id.replace(/[^\w-]/g, "_");

interface Entry {
  v: number;
  savedAt: number;
  track: ResolvedTrack;
}

export async function getCached(videoId: string): Promise<ResolvedTrack | null> {
  try {
    const entry = JSON.parse(await readFile(join(dir(), `${safeId(videoId)}.json`), "utf8")) as Entry;
    return entry.v === VERSION ? entry.track : null;
  } catch {
    return null;
  }
}

export async function putCached(track: ResolvedTrack): Promise<void> {
  await mkdir(dir(), { recursive: true });
  const path = join(dir(), `${safeId(track.videoId)}.json`);
  const entry: Entry = { v: VERSION, savedAt: Date.now(), track };
  await writeFile(`${path}.tmp`, JSON.stringify(entry));
  await rename(`${path}.tmp`, path);
}

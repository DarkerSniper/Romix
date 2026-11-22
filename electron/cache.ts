import { app } from "electron";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedTrack } from "../src/shared/api";

const VERSION = 1;
const dir = () => join(app.getPath("userData"), "cache", "tracks");
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

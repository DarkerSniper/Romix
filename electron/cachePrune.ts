import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./paths";
import { busy } from "./prep";
import { listProjects, loadProject } from "./projects";

/**
 * Keeps the audio cache under a size limit. Never touches the songs on the open
 * disc or in saved projects; removes finished-disc builds first (they're quick to
 * rebuild), then other songs' audio, oldest first.
 */
let limitBytes = 5e9;
let activeKeys = new Set<string>();
let running = false;

export function setCachePolicy(limitGB: number, keys: string[]) {
  limitBytes = Math.max(1, limitGB) * 1e9;
  activeKeys = new Set(keys);
  void pruneCache();
}

interface Entry {
  path: string;
  size: number;
  mtime: number;
  key?: string;
}

function list(dir: string, keyOf?: (name: string) => string | undefined): Entry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    try {
      const st = statSync(join(dir, name));
      return st.isFile() ? [{ path: join(dir, name), size: st.size, mtime: st.mtimeMs, key: keyOf?.(name) }] : [];
    } catch {
      return [];
    }
  });
}

/** Keys of songs in saved projects (YouTube songs; local files are kept via the open disc). */
async function projectKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const s of await listProjects()) {
    const p = await loadProject(s.id);
    for (const t of p?.tracks ?? []) if (t.videoId) keys.add(`yt-${t.videoId}`);
  }
  return keys;
}

export async function pruneCache(): Promise<number> {
  if (running || busy()) return 0;
  running = true;
  try {
    const protectedKeys = new Set([...activeKeys, ...(await projectKeys())]);
    const discFiles = list(paths.disc);
    const pcmFiles = list(paths.pcm, (n) => n.replace(/(\.analysis)?\.(wav|json)$/, ""));
    const audioFiles = list(paths.audio, (n) => `yt-${n.replace(/\.[^.]+$/, "")}`);
    let total = [...discFiles, ...pcmFiles, ...audioFiles].reduce((n, e) => n + e.size, 0);
    if (total <= limitBytes) return 0;

    const recent = Date.now() - 10 * 60_000; // never delete what was just made
    const candidates = [
      ...discFiles.filter((e) => e.mtime < recent).sort((a, b) => a.mtime - b.mtime),
      ...[...pcmFiles, ...audioFiles].filter((e) => e.key && !protectedKeys.has(e.key) && e.mtime < recent).sort((a, b) => a.mtime - b.mtime),
    ];
    let freed = 0;
    for (const e of candidates) {
      if (total <= limitBytes * 0.9) break;
      try {
        rmSync(e.path, { force: true });
        total -= e.size;
        freed += e.size;
      } catch {
        /* in use: skip */
      }
    }
    return freed;
  } finally {
    running = false;
  }
}

import { BrowserWindow, dialog, shell } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ImportResult, ShareData, ShareInfo, SavedTrack } from "../src/shared/api";
import { AUDIO_EXT, DiscFileError, LIMITS, decodeManifest, encodeDisc, type SharedTrack } from "../src/lib/discFile";
import { paths } from "./paths";
import { coverFile, storeCoverBytes } from "./covers";
import { saveProject } from "./projects";

/**
 * Sharing discs as single .romix files: export with covers (and optionally the
 * sender's own audio), import as a new saved disc. See src/lib/discFile.ts.
 */

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const audioType: Record<string, string> = { mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", opus: "audio/opus", aac: "audio/aac" };

async function localAudio(t: SavedTrack): Promise<{ path: string; ext: string; size: number } | null> {
  if (t.source !== "local" || !t.filePath) return null;
  const ext = extname(t.filePath).slice(1).toLowerCase();
  if (!(AUDIO_EXT as readonly string[]).includes(ext)) return null;
  try {
    const st = await stat(t.filePath);
    return st.isFile() ? { path: t.filePath, ext, size: st.size } : null;
  } catch {
    return null;
  }
}

/** What sharing this disc involves (for the Share sheet). */
export async function shareInfo(tracks: SavedTrack[]): Promise<ShareInfo> {
  let localSongs = 0, localBytes = 0, missingLocal = 0;
  for (const t of tracks) {
    if (t.source !== "local") continue;
    const a = await localAudio(t);
    if (a) {
      localSongs++;
      localBytes += a.size;
    } else missingLocal++;
  }
  return { youtubeSongs: tracks.filter((t) => t.source === "youtube" && t.videoId).length, localSongs, localBytes, missingLocal };
}

export async function exportDisc(data: ShareData, includeAudio: boolean, parent: BrowserWindow | null): Promise<{ ok: boolean; message: string; path?: string }> {
  const built = await buildDiscFile(data, includeAudio);
  if (!built.ok) return built;
  const exportsDir = join(paths.root, "exports");
  await mkdir(exportsDir, { recursive: true });
  const safe = data.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim() || "Romix disc";
  const opts = { title: "Share disc", defaultPath: join(exportsDir, `${safe}.romix`), filters: [{ name: "Romix disc", extensions: ["romix"] }] };
  const pick = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  if (pick.canceled || !pick.filePath) return { ok: false, message: "Not saved" };
  await writeParts(pick.filePath, built.parts);
  shell.showItemInFolder(pick.filePath);
  const note = built.skippedLocal ? ` (${built.skippedLocal} of your own ${built.skippedLocal === 1 ? "song isn't" : "songs aren't"} included)` : "";
  return { ok: true, message: `Shared disc saved${note}`, path: pick.filePath };
}

/** The .romix file's bytes (as parts), without asking where to save it. */
export async function buildDiscFile(data: ShareData, includeAudio: boolean): Promise<{ ok: true; parts: Uint8Array[]; skippedLocal: number } | { ok: false; message: string }> {
  if (!data.tracks.length) return { ok: false, message: "This disc has no songs" };
  const blobs: Array<{ type: string; sha256: string; bytes: Buffer }> = [];
  const index = new Map<string, number>();
  const add = (bytes: Buffer, type: string) => {
    const h = sha256(bytes);
    const at = index.get(h);
    if (at !== undefined) return at;
    blobs.push({ type, sha256: h, bytes });
    index.set(h, blobs.length - 1);
    return blobs.length - 1;
  };
  const dataUrl = (u?: string) => {
    const m = u && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(u);
    return m ? { type: m[1].toLowerCase(), bytes: Buffer.from(m[2], "base64") } : null;
  };

  const tracks: SharedTrack[] = [];
  let skippedLocal = 0;
  for (const t of data.tracks) {
    const audio = includeAudio ? await localAudio(t) : null;
    if (t.source === "local" && !audio) {
      skippedLocal++;
      continue;
    }
    if (audio && audio.size > LIMITS.audioBytes) return { ok: false, message: `"${t.title}" is too large to include` };
    const small = dataUrl(t.cover);
    const hiPath = t.coverHi ? coverFile(t.coverHi) : null;
    const hi = hiPath && existsSync(hiPath) ? await readFile(hiPath) : null;
    tracks.push({
      title: t.title,
      artist: t.artist,
      durationSec: t.durationSec,
      color: t.color,
      source: t.source,
      videoId: t.videoId,
      trimStartSec: t.trimStartSec,
      trimEndSec: t.trimEndSec,
      cover: small ? { blob: add(small.bytes, small.type) } : undefined,
      coverHi: hi ? { blob: add(hi, hiPath!.endsWith(".png") ? "image/png" : hiPath!.endsWith(".webp") ? "image/webp" : "image/jpeg") } : undefined,
      coverPx: t.coverPx,
      audio: audio ? { blob: add(await readFile(audio.path), audioType[audio.ext]), ext: audio.ext } : undefined,
    });
  }
  if (!tracks.length) return { ok: false, message: "Nothing to share: this disc only has your own audio files. Turn on “Include my audio files”." };

  const parts = encodeDisc(
    { format: "romix-disc", version: 1, createdAt: Date.now(), app: "Romix", disc: { title: data.title, options: data.options }, tracks },
    blobs,
  );
  return { ok: true, parts, skippedLocal };
}

/** Writes the file parts (head, manifest, blobs) without copying them into one buffer. */
export async function writeParts(path: string, parts: Uint8Array[]) {
  const tmp = `${path}.part`;
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(tmp);
    out.on("error", reject);
    for (const p of parts) out.write(p);
    out.end(resolve);
  });
  await rename(tmp, path);
}

/** Reads a .romix file, checks every part, and saves it as a new disc in Saved projects. */
export async function importDisc(path: string): Promise<ImportResult> {
  try {
    if (!path.toLowerCase().endsWith(".romix")) return { ok: false, message: "That isn't a Romix disc file (.romix)" };
    const size = (await stat(path)).size;
    const fh = await open(path, "r");
    try {
      const headLen = Math.min(size, LIMITS.manifestBytes + 14);
      const head = Buffer.alloc(headLen);
      await fh.read(head, 0, headLen, 0);
      const { manifest, blobStart } = decodeManifest(head, size);

      const read = async (i: number) => {
        const b = manifest.blobs[i];
        const buf = Buffer.alloc(b.length);
        await fh.read(buf, 0, b.length, blobStart + b.offset);
        if (sha256(buf) !== b.sha256) throw new DiscFileError("This disc file is damaged (a part doesn't match its checksum)");
        return buf;
      };

      const tracks: SavedTrack[] = [];
      let missingLocal = 0;
      for (const t of manifest.tracks) {
        let filePath: string | undefined;
        if (t.source === "local") {
          if (!t.audio) {
            missingLocal++;
            continue;
          }
          const buf = await read(t.audio.blob);
          await mkdir(paths.sharedAudio, { recursive: true });
          filePath = join(paths.sharedAudio, `${sha256(buf).slice(0, 32)}.${t.audio.ext}`);
          if (!existsSync(filePath)) await writeFile(filePath, buf);
        }
        const smallBuf = t.cover ? await read(t.cover.blob) : null;
        const cover = smallBuf ? `data:${manifest.blobs[t.cover!.blob].type};base64,${smallBuf.toString("base64")}` : "";
        const coverHi = t.coverHi ? await storeCoverBytes(await read(t.coverHi.blob), manifest.blobs[t.coverHi.blob].type) : undefined;
        tracks.push({
          title: t.title,
          artist: t.artist,
          durationSec: t.durationSec,
          cover: cover || "",
          coverHi,
          coverPx: t.coverPx,
          color: t.color,
          source: t.source,
          videoId: t.videoId,
          filePath,
          url: t.videoId ? `https://music.youtube.com/watch?v=${t.videoId}` : undefined,
          trimStartSec: t.trimStartSec,
          trimEndSec: t.trimEndSec,
        });
      }
      if (!tracks.length) return { ok: false, message: "This shared disc has no songs Romix can use" };

      const id = randomUUID();
      await saveProject({ id, title: manifest.disc.title, options: manifest.disc.options, tracks });
      return { ok: true, projectId: id, title: manifest.disc.title, songs: tracks.length, missingLocal };
    } finally {
      await fh.close();
    }
  } catch (e) {
    return { ok: false, message: e instanceof DiscFileError ? e.message : "Couldn't open that disc file" };
  }
}

/** Lets the user pick a .romix file. */
export async function pickDiscFile(parent: BrowserWindow | null): Promise<string | null> {
  const opts = { title: "Open shared disc", properties: ["openFile" as const], filters: [{ name: "Romix disc", extensions: ["romix"] }] };
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : (r.filePaths[0] ?? null);
}

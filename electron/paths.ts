import { app } from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Everything Romix writes lives inside its own folder, never in AppData/Temp:
 *   dev:       <project>/.data
 *   installed: <folder containing Romix.exe>/data   (portable)
 *
 * Must be imported before anything else in main so Chromium never creates
 * its default profile under %APPDATA%.
 */
export const dataRoot = app.isPackaged ? join(dirname(process.execPath), "data") : join(app.getAppPath(), ".data");

export const paths = {
  root: dataRoot,
  /** Helper programs Romix downloads on first run (yt-dlp, FFmpeg, Node). */
  bin: app.isPackaged ? join(dataRoot, "bin") : join(app.getAppPath(), "bin"),
  userData: join(dataRoot, "app"),
  session: join(dataRoot, "app", "session"),
  logs: join(dataRoot, "logs"),
  crashDumps: join(dataRoot, "crash-dumps"),
  temp: join(dataRoot, "tmp"),
  trackCache: join(dataRoot, "cache", "tracks"),
  ytdlpCache: join(dataRoot, "cache", "yt-dlp"),
  /** Original downloads, untouched (Opus/AAC). */
  audio: join(dataRoot, "cache", "audio"),
  /** Decoded + resampled to 44.1 kHz float, with loudness measurements. */
  pcm: join(dataRoot, "cache", "pcm"),
  /** Final per-track 16-bit files exactly as they will be burned. */
  disc: join(dataRoot, "cache", "disc"),
  /** Saved discs (one JSON file each). Not a cache: never cleared automatically. */
  projects: join(dataRoot, "projects"),
  /** Print-resolution covers (and your own cover images), referenced by saved discs. */
  covers: join(dataRoot, "covers"),
  /** Audio files that arrived inside shared discs (.romix) from other people. */
  sharedAudio: join(dataRoot, "shared-audio"),
};

/** Audio caches that "Clear cache" empties (song metadata cache is kept: it's tiny). */
export const audioCacheDirs = [paths.audio, paths.pcm, paths.disc];

for (const p of Object.values(paths)) mkdirSync(p, { recursive: true });

app.setPath("userData", paths.userData);
app.setPath("sessionData", paths.session);
app.setPath("logs", paths.logs);
app.setPath("crashDumps", paths.crashDumps);
app.setPath("temp", paths.temp);

// Child processes (yt-dlp, node) inherit these, so their temp files stay in the project too.
process.env.TEMP = paths.temp;
process.env.TMP = paths.temp;

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
  userData: join(dataRoot, "app"),
  session: join(dataRoot, "app", "session"),
  logs: join(dataRoot, "logs"),
  crashDumps: join(dataRoot, "crash-dumps"),
  temp: join(dataRoot, "tmp"),
  trackCache: join(dataRoot, "cache", "tracks"),
  ytdlpCache: join(dataRoot, "cache", "yt-dlp"),
};

for (const p of Object.values(paths)) mkdirSync(p, { recursive: true });

app.setPath("userData", paths.userData);
app.setPath("sessionData", paths.session);
app.setPath("logs", paths.logs);
app.setPath("crashDumps", paths.crashDumps);
app.setPath("temp", paths.temp);

// Child processes (yt-dlp, node) inherit these, so their temp files stay in the project too.
process.env.TEMP = paths.temp;
process.env.TMP = paths.temp;

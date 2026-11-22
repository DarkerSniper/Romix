import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";

export interface Settings {
  /** User-chosen node.exe for yt-dlp's JavaScript challenges. */
  runtimePath?: string;
}

const file = () => join(app.getPath("userData"), "settings.json");

export function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...patch };
  mkdirSync(dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, file());
  return next;
}

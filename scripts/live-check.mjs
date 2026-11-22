// End-to-end check against live YouTube: builds the Electron code, then runs
// the real resolver in headless self-test mode. Run: npm run test:live
// Optional: ROMIX_NODE=<path to node.exe 22+> if it isn't on PATH.
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electron = require("electron"); // path to electron.exe

const ids = process.argv[2] ?? [
  "kJQP7kiw5Fk", // Luis Fonsi - Despacito (music video, no track fields)
  "fJ9rUzIMcZQ", // Queen – Bohemian Rhapsody (Official Video Remastered)
  "9bZkp7q19f0", // PSY - GANGNAM STYLE M/V (non-Latin title)
  "dQw4w9WgXcA", // blocked from some regions: exercises the error path
  "kJQP7kiw5Fk", // repeat: must come from cache
].join(",");

execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--mode", "electron", "--logLevel", "error"], { stdio: "inherit" });

const r = spawnSync(electron, [".", "--selftest"], {
  env: { ...process.env, ROMIX_SELFTEST_IDS: ids, ELECTRON_ENABLE_LOGGING: "0" },
  encoding: "utf8",
  timeout: 300_000,
});
process.stdout.write(r.stdout);
if (r.status !== 0) {
  process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}

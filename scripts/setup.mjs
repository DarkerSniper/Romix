// One-step setup that keeps every download cache inside the project:
//   npm cache      → .cache/npm
//   Electron zip   → .cache/electron   (Electron's installer only reads an env var for this)
// then fetches the checksum-verified yt-dlp into ./bin.
// Run: npm run setup
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  npm_config_cache: join(root, ".cache", "npm"),
  electron_config_cache: join(root, ".cache", "electron"),
};

function step(label, command) {
  console.log(`\n▸ ${label}`);
  // Fixed command strings only (no user input), so running through the shell is safe.
  const r = spawnSync(command, { cwd: root, env, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

step("Installing packages", "npm install --no-fund --no-audit");
step("Fetching yt-dlp", `"${process.execPath}" scripts/fetch-bins.mjs`);
console.log("\nDone. Start the app with: npm run app");

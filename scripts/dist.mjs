// Builds the Windows installer and portable ZIP into ./release.
// Every download cache electron-builder uses stays inside the project (.cache).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  ELECTRON_BUILDER_CACHE: join(root, ".cache", "electron-builder"),
  electron_config_cache: join(root, ".cache", "electron"),
  npm_config_cache: join(root, ".cache", "npm"),
  TEMP: join(root, ".cache", "tmp"),
  TMP: join(root, ".cache", "tmp"),
  // No code-signing certificate: build unsigned (Windows SmartScreen will warn on first run).
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
};

function run(label, cmd) {
  console.log(`\n▸ ${label}`);
  const r = spawnSync(cmd, { cwd: root, env, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("Type-check and build", `"${process.execPath}" node_modules/typescript/bin/tsc --noEmit`);
run("Bundle app", `"${process.execPath}" node_modules/vite/bin/vite.js build --mode electron --logLevel warn`);
run("Package installer and ZIP", `"${process.execPath}" node_modules/electron-builder/cli.js --win --publish never`);
// checksums.txt goes up with every release: Romix's updater won't install a download that doesn't match it.
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const files = [`Romix-Setup-${version}.exe`, `Romix-${version}-x64.zip`];
const sums = files.map((f) => `${createHash("sha256").update(readFileSync(join(root, "release", f))).digest("hex")}  ${f}`);
writeFileSync(join(root, "release", "checksums.txt"), sums.join("\n") + "\n");
console.log("\n▸ checksums.txt\n" + sums.join("\n"));
console.log("\nDone: see the release folder.");

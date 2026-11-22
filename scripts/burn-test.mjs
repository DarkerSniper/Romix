// Real-hardware burn test. Needs a blank CD-R or CD-RW in the burner.
//   npm run test:burn            → checks the disc and does a dry run (writes nothing)
//   npm run test:burn -- write   → burns 3 songs (~11 min), then reads every track back to verify
// Optional: ROMIX_BURNTEST_MODE=none|gap2|crossfade (default crossfade)
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");
const write = process.argv.includes("write");

execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--mode", "electron", "--logLevel", "error"], { cwd: root, stdio: "inherit" });

const child = spawn(electron, [".", "--burntest"], {
  cwd: root,
  env: {
    ...process.env,
    ROMIX_BURNTEST: write ? "write" : "dry",
    ROMIX_SELFTEST_IDS: process.env.ROMIX_SELFTEST_IDS ?? "fJ9rUzIMcZQ,kJQP7kiw5Fk,jNQXAC9IVRw",
  },
});
child.stdout.on("data", (d) => process.stdout.write(d.toString().split(/\r?\n/).filter((l) => l.startsWith("{")).map((l) => l + "\n").join("")));
child.stderr.on("data", (d) => {
  const s = d.toString();
  if (/burntest failed|Error/.test(s)) process.stderr.write(s);
});
child.on("exit", (code) => process.exit(code ?? 1));

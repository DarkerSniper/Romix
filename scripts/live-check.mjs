// End-to-end check against live YouTube: builds the app, then runs the real
// main-process pipeline headless (`electron . --selftest`): first-run setup of
// any missing helper tools, metadata, download, conversion, disc building in
// every mode, and audio streaming into the sandboxed UI. Finally it inspects
// every finished disc file with ffprobe. Run: npm run test:live
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");

const ids = process.argv[2] ?? [
  "jNQXAC9IVRw", // 19 s: quick download
  "fJ9rUzIMcZQ", // Queen – Bohemian Rhapsody
  "kJQP7kiw5Fk", // Luis Fonsi – Despacito
  "dQw4w9WgXcA", // blocked from some regions: error path
].join(",");

execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--mode", "electron", "--logLevel", "error"], { cwd: root, stdio: "inherit" });

const started = Date.now();
const r = spawnSync(electron, [".", "--selftest"], { cwd: root, env: { ...process.env, ROMIX_SELFTEST_IDS: ids }, encoding: "utf8", timeout: 900_000 });
const lines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
for (const l of lines) console.log(JSON.stringify(l));
if (r.status !== 0) {
  console.error(r.stderr.split(/\r?\n/).filter((l) => !/GPU|command_buffer|INFO:CONSOLE/.test(l)).join("\n"));
  process.exit(r.status ?? 1);
}
console.log(`\nself-test took ${Math.round((Date.now() - started) / 1000)} s`);

// Inspect the final crossfade+loudness render: must be exact Red Book PCM, sector aligned.
const ffprobe = join(root, "bin", "ffmpeg", "ffprobe.exe");
const renders = lines.filter((l) => l.step === "render" && l.tracks);
let bad = 0;
for (const render of renders) {
  for (const t of render.tracks) {
    const file = join(root, ".data", "cache", "disc", t.url.split("/").pop());
    const s = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels,duration_ts", "-of", "json", file], { encoding: "utf8" })).streams[0];
    const ok = s.codec_name === "pcm_s16le" && s.sample_rate === "44100" && s.channels === 2 && Number(s.duration_ts) === t.samples && t.samples % 588 === 0;
    if (!ok) bad++;
    console.log(`${ok ? "OK " : "BAD"} ${render.mode.padEnd(9)} ${s.codec_name} ${s.sample_rate} Hz ${s.channels}ch ${s.duration_ts} samples (${t.samples / 588} sectors) gain ${t.gainDb} dB`);
  }
}
if (bad) {
  console.error(`${bad} file(s) failed the format check`);
  process.exit(1);
}

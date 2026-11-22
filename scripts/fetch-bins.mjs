// Downloads the official yt-dlp.exe into ./bin and verifies it against the
// release's published SHA-256 checksums. Run with: npm run fetch-bins
import { createHash } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(root, "bin");
const BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const FILE = "yt-dlp.exe";

async function get(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "romix-fetch-bins" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sums = (await get(`${BASE}/SHA2-256SUMS`)).toString("utf8");
const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(` ${FILE}`));
if (!line) throw new Error(`No checksum listed for ${FILE}`);
const expected = line.split(/\s+/)[0].toLowerCase();

console.log(`Downloading ${FILE}…`);
const bin = await get(`${BASE}/${FILE}`);
const actual = createHash("sha256").update(bin).digest("hex");
if (actual !== expected) throw new Error(`Checksum mismatch for ${FILE}: expected ${expected}, got ${actual}`);

await mkdir(binDir, { recursive: true });
const tmp = join(binDir, `${FILE}.part`);
await writeFile(tmp, bin);
await rename(tmp, join(binDir, FILE));
console.log(`OK ${FILE} (${(bin.length / 1e6).toFixed(1)} MB, sha256 ${actual.slice(0, 12)}…) → bin/`);

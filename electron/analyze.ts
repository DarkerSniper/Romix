import { open, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TrackAnalysis } from "../src/shared/api";
import { detectBpm, detectKey, findSilence } from "../src/lib/analysis";
import { wavDataRange } from "../src/lib/wav";
import { paths } from "./paths";
import { pcmPath } from "./prep";

/**
 * Per-song analysis from the prepared 44.1 kHz float audio: tempo, key, where
 * the music starts and ends, and a waveform for the trim editor. Cached next to
 * the audio; analyses run one at a time to keep the app responsive.
 */
const VERSION = 1;
const PEAKS = 600;
const cachePath = (key: string) => join(paths.pcm, `${key}.analysis.json`);

let chain: Promise<unknown> = Promise.resolve();
const inflight = new Map<string, Promise<TrackAnalysis | null>>();

export function analyze(key: string): Promise<TrackAnalysis | null> {
  let p = inflight.get(key);
  if (!p) {
    p = (chain = chain.then(() => analyzeNow(key))) as Promise<TrackAnalysis | null>;
    p.finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

async function analyzeNow(key: string): Promise<TrackAnalysis | null> {
  try {
    const cached = JSON.parse(await readFile(cachePath(key), "utf8")) as TrackAnalysis & { v: number };
    if (cached.v === VERSION) return cached;
  } catch {
    /* not analysed yet */
  }

  const file = pcmPath(key);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return null;
  }
  const fh = await open(file, "r");
  try {
    const head = Buffer.alloc(Math.min(size, 4096));
    await fh.read(head, 0, head.length, 0);
    const { offset, length } = wavDataRange(head, size);
    const frames = Math.floor(length / 8); // stereo float32
    const SR = 44_100;

    // Mono at full rate for silence + peaks, and a 22.05 kHz copy of the middle minute for tempo/key.
    const mono = new Float32Array(frames);
    const chunk = Buffer.alloc(8 * 65_536);
    for (let f = 0; f < frames; ) {
      const n = Math.min(65_536, frames - f);
      await fh.read(chunk, 0, n * 8, offset + f * 8);
      for (let i = 0; i < n; i++) mono[f + i] = (chunk.readFloatLE(i * 8) + chunk.readFloatLE(i * 8 + 4)) / 2;
      f += n;
    }

    const midStart = Math.max(0, Math.floor(frames / 2 - 30 * SR));
    const midEnd = Math.min(frames, midStart + 60 * SR);
    const half = new Float32Array(Math.floor((midEnd - midStart) / 2));
    for (let i = 0; i < half.length; i++) half[i] = (mono[midStart + 2 * i] + mono[midStart + 2 * i + 1]) / 2;

    const bpm = detectBpm(half, SR / 2);
    const k = detectKey(half, SR / 2);
    const silence = findSilence(mono, SR);

    const peaks: number[] = [];
    const per = Math.max(1, Math.floor(frames / PEAKS));
    for (let b = 0; b < PEAKS && b * per < frames; b++) {
      let m = 0;
      for (let i = b * per; i < Math.min(frames, (b + 1) * per); i += 4) m = Math.max(m, Math.abs(mono[i]));
      peaks.push(Math.round(Math.min(1, m) * 1000) / 1000);
    }

    const result: TrackAnalysis & { v: number } = {
      v: VERSION,
      bpm,
      key: k?.name ?? null,
      camelot: k?.camelot ?? null,
      durationSec: frames / SR,
      musicStartSec: silence.start / SR,
      musicEndSec: silence.end / SR,
      peaks,
    };
    await writeFile(cachePath(key), JSON.stringify(result));
    return result;
  } finally {
    await fh.close();
  }
}

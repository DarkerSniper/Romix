/**
 * Music analysis on decoded mono audio: tempo (BPM), musical key, and silent
 * intros/outros. Pure TypeScript, no dependencies, unit-tested on synthetic
 * signals. Good on steady pop/dance music; less reliable on rubato or live music.
 */

/* ---------- FFT (radix-2, in place) ---------- */

export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/* ---------- Tempo ---------- */

/**
 * Onset-strength envelope (spectral flux of short frames), then autocorrelation
 * over 60–200 BPM with a gentle preference for the 90–140 range where most
 * songs are counted, to avoid half/double-time picks.
 */
export function detectBpm(mono: Float32Array, sampleRate: number): number | null {
  const hop = 256;
  const frame = 1024;
  const frames = Math.floor((mono.length - frame) / hop);
  if (frames < 64) return null;
  const env = new Float64Array(frames);
  const re = new Float64Array(frame), im = new Float64Array(frame);
  let prev = new Float64Array(frame / 2);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < frame; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);
      re[i] = mono[f * hop + i] * w;
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float64Array(frame / 2);
    let flux = 0;
    for (let k = 1; k < frame / 2; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = mag[k] - prev[k];
      if (d > 0) flux += d;
    }
    env[f] = flux;
    prev = mag;
  }
  // Remove the slow trend so only beats remain.
  const mean = env.reduce((a, b) => a + b, 0) / frames;
  for (let i = 0; i < frames; i++) env[i] = Math.max(0, env[i] - mean);
  // Smooth sharp onsets over a few frames so fractional beat lags score fairly.
  for (let pass = 0; pass < 2; pass++) {
    const src = env.slice();
    for (let i = 2; i < frames - 2; i++) env[i] = (src[i - 2] + 4 * src[i - 1] + 6 * src[i] + 4 * src[i + 1] + src[i + 2]) / 16;
  }

  const fps = sampleRate / hop;
  /** Autocorrelation of the beat curve at a fractional lag (in frames). */
  const ac = (lag: number) => {
    const l0 = Math.floor(lag), frac = lag - l0;
    if (l0 + 1 >= frames) return 0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < frames; i++) s += env[i] * (env[i + l0] * (1 - frac) + env[i + l0 + 1] * frac);
    return s / (frames - l0);
  };

  // 1) Pick the tempo region, preferring the 90–140 range (decides half/double time).
  let best = 0, coarse = 0;
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = ac((60 / bpm) * fps) * weight;
    if (score > best) {
      best = score;
      coarse = bpm;
    }
  }
  if (!coarse) return null;

  // 2) Refine without the preference: line up four beats ahead, which sharpens the peak.
  let refined = coarse, top = -1;
  for (let bpm = coarse * 0.95; bpm <= coarse * 1.05; bpm += 0.05) {
    const lag = (60 / bpm) * fps;
    const score = ac(lag) + ac(2 * lag) + ac(3 * lag) + ac(4 * lag);
    if (score > top) {
      top = score;
      refined = bpm;
    }
  }
  return Math.round(refined * 10) / 10;
}

/* ---------- Key ---------- */

const NOTES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
// Krumhansl–Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface MusicalKey {
  tonic: number; // 0 = C
  mode: "major" | "minor";
  name: string; // "A minor"
  camelot: string; // "8A"
}

/** Camelot wheel code, used by DJs: neighbours on the wheel mix smoothly. */
export function camelot(tonic: number, mode: "major" | "minor"): string {
  // Major: C=8B, G=9B…; minor: A=8A, E=9A…  (each fifth up = +1)
  const ref = mode === "major" ? 0 : 9;
  const steps = (((tonic - ref) * 7) % 12 + 12) % 12;
  return `${((steps + 7) % 12) + 1}${mode === "major" ? "B" : "A"}`;
}

function pearson(a: number[], b: number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / 12, mb = b.reduce((x, y) => x + y, 0) / 12;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return n / Math.sqrt(da * db || 1);
}

export function detectKey(mono: Float32Array, sampleRate: number): MusicalKey | null {
  const size = 8192;
  const chroma = new Array(12).fill(0);
  const re = new Float64Array(size), im = new Float64Array(size);
  let frames = 0;
  for (let start = 0; start + size <= mono.length; start += size / 2) {
    for (let i = 0; i < size; i++) {
      re[i] = mono[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < size / 2; k++) {
      const hz = (k * sampleRate) / size;
      if (hz < 55 || hz > 2000) continue;
      const midi = 69 + 12 * Math.log2(hz / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += Math.hypot(re[k], im[k]);
    }
    frames++;
  }
  if (!frames || chroma.every((c) => c === 0)) return null;
  let best = -2, tonic = 0, mode: "major" | "minor" = "major";
  for (let t = 0; t < 12; t++) {
    for (const [m, profile] of [["major", MAJOR], ["minor", MINOR]] as const) {
      const rotated = profile.map((_, i) => profile[(i - t + 12) % 12]);
      const r = pearson(chroma, rotated);
      if (r > best) {
        best = r;
        tonic = t;
        mode = m;
      }
    }
  }
  return { tonic, mode, name: `${NOTES[tonic]} ${mode}`, camelot: camelot(tonic, mode) };
}

/* ---------- Silence ---------- */

/**
 * Finds where the music starts and ends (in samples), ignoring quiet hiss below
 * `thresholdDb`. Keeps a short margin so attacks and fade-out tails aren't clipped.
 */
export function findSilence(mono: Float32Array, sampleRate: number, thresholdDb = -55, marginSec = 0.25): { start: number; end: number } {
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const thresh = Math.pow(10, thresholdDb / 20);
  const loud = (from: number) => {
    let sum = 0;
    for (let i = from; i < from + win && i < mono.length; i++) sum += mono[i] * mono[i];
    return Math.sqrt(sum / win) > thresh;
  };
  let start = 0;
  while (start < mono.length && !loud(start)) start += win;
  let end = mono.length;
  while (end > start && !loud(Math.max(0, end - win))) end -= win;
  if (start >= mono.length) return { start: 0, end: mono.length }; // all silent: leave alone
  const m = Math.round(marginSec * sampleRate);
  return { start: Math.max(0, start - m), end: Math.min(mono.length, end + m) };
}

/* ---------- Flow ordering ---------- */

export interface FlowItem {
  id: string;
  bpm: number | null;
  camelot: string | null;
}

/** Steps around the Camelot wheel (0 = same key, 1 = neighbour), plus 1 for switching A/B. */
export function camelotDistance(a: string | null, b: string | null): number {
  if (!a || !b) return 3;
  const na = Number(a.slice(0, -1)), nb = Number(b.slice(0, -1));
  const ring = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
  return ring + (a.slice(-1) === b.slice(-1) ? 0 : 1);
}

/** Tempo distance as a fraction, treating half/double time as close (e.g. 70 vs 140). */
export function tempoDistance(a: number | null, b: number | null): number {
  if (!a || !b) return 0.3;
  return Math.min(...[b, b * 2, b / 2].map((x) => Math.abs(Math.log2(x / a))));
}

export const transitionCost = (a: FlowItem, b: FlowItem) => camelotDistance(a.camelot, b.camelot) + 6 * tempoDistance(a.bpm, b.bpm);

/**
 * Orders songs so each transition is as smooth as possible. Keeps the current
 * opener, builds a nearest-neighbour path, then improves it with 2-opt.
 */
export function flowOrder(items: FlowItem[]): string[] {
  if (items.length < 3) return items.map((i) => i.id);
  const n = items.length;
  const cost = (i: number, j: number) => transitionCost(items[i], items[j]);
  const path = [0];
  const used = new Set([0]);
  while (path.length < n) {
    const last = path[path.length - 1];
    let best = -1;
    for (let j = 0; j < n; j++) if (!used.has(j) && (best < 0 || cost(last, j) < cost(last, best))) best = j;
    path.push(best);
    used.add(best);
  }
  const total = (p: number[]) => p.slice(1).reduce((s, v, i) => s + cost(p[i], v), 0);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++)
      for (let k = i + 1; k < n; k++) {
        const cand = [...path.slice(0, i), ...path.slice(i, k + 1).reverse(), ...path.slice(k + 1)];
        if (total(cand) + 1e-9 < total(path)) {
          path.splice(0, n, ...cand);
          improved = true;
        }
      }
  }
  return path.map((i) => items[i].id);
}

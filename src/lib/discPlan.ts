import type { DiscOptions } from "../types";

/** Red Book audio: 44.1 kHz, 16-bit stereo. One sector = 2352 bytes = 588 stereo samples = 1/75 s. */
export const SAMPLE_RATE = 44_100;
export const SECTOR_SAMPLES = 588;
export const GAP_SAMPLES = 2 * SAMPLE_RATE; // 150 sectors
export const TRUE_PEAK_CEILING_DB = -1;

export interface PlanInput {
  key: string;
  /** Length of the converted source at 44.1 kHz, in samples. */
  samples: number;
  /** Integrated loudness (EBU R128). Null when unmeasurable (e.g. silence). */
  lufs: number | null;
  /** True peak in dBTP. */
  truePeakDb: number | null;
}

export interface PlannedTrack {
  key: string;
  index: number;
  /** Samples skipped at the start (already played inside the previous track's crossfade/borrow). */
  trimStart: number;
  /** Overlap mixed with the start of the next track. */
  crossfadeOut: number;
  /** Samples of the next track appended after the crossfade so the boundary lands on a sector. */
  borrowFromNext: number;
  /** Silence appended to reach a sector boundary (only before a gap and at the end of the disc). */
  silencePad: number;
  /** Silence before this track (2 s in gap mode, never on track 1). */
  pregap: number;
  gainDb: number;
  /** Final length of this track's audio, always a whole number of sectors. */
  samples: number;
  /** Where the track's audio starts on the disc (after its pregap), in samples from the start of track 1. */
  startSample: number;
}

export interface DiscPlan {
  tracks: PlannedTrack[];
  totalSamples: number;
  targetLufs: number | null;
}

const toSector = (n: number) => (SECTOR_SAMPLES - (n % SECTOR_SAMPLES)) % SECTOR_SAMPLES;

/**
 * Loudness target for "even out loudness": the disc's median loudness, lowered
 * if any song would need more gain than its true peak allows. Gain only, no
 * limiting, so dynamics are untouched and nothing clips.
 */
export function loudnessTarget(inputs: PlanInput[]): number | null {
  const measured = inputs.filter((t) => t.lufs !== null && Number.isFinite(t.lufs));
  if (measured.length === 0) return null;
  const sorted = measured.map((t) => t.lufs!).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  const ceiling = Math.min(
    ...measured.map((t) => t.lufs! + (TRUE_PEAK_CEILING_DB - (t.truePeakDb ?? TRUE_PEAK_CEILING_DB))),
  );
  return Math.min(median, ceiling);
}

export function planDisc(inputs: PlanInput[], opts: DiscOptions): DiscPlan {
  const target = opts.normalize ? loudnessTarget(inputs) : null;
  const xfadeWanted = opts.gapMode === "crossfade" ? Math.round(opts.crossfadeSec * SAMPLE_RATE) : 0;

  const tracks: PlannedTrack[] = [];
  let trimNext = 0;
  let cursor = 0;

  inputs.forEach((t, i) => {
    const next = inputs[i + 1];
    const trimStart = Math.min(trimNext, t.samples);
    const own = t.samples - trimStart;

    // Never let a crossfade eat more than half of either song.
    const crossfadeOut = next && xfadeWanted ? Math.max(0, Math.min(xfadeWanted, Math.floor(own / 2), Math.floor(next.samples / 2))) : 0;

    const pad = toSector(own);
    const continuous = next && opts.gapMode !== "gap2";
    // Continuous playback: move the boundary forward into the next song instead of inserting silence.
    const borrowFromNext = continuous ? Math.min(pad, Math.max(0, next.samples - crossfadeOut)) : 0;
    const silencePad = pad - borrowFromNext;

    const pregap = i > 0 && opts.gapMode === "gap2" ? GAP_SAMPLES : 0;
    cursor += pregap;

    const gainDb = target !== null && t.lufs !== null && Number.isFinite(t.lufs) ? round2(target - t.lufs) : 0;
    const samples = own + borrowFromNext + silencePad;

    tracks.push({ key: t.key, index: i, trimStart, crossfadeOut, borrowFromNext, silencePad, pregap, gainDb, samples, startSample: cursor });
    cursor += samples;
    trimNext = crossfadeOut + borrowFromNext;
  });

  return { tracks, totalSamples: cursor, targetLufs: target };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Stable cache key for one rendered track: changes only when its audio would change. */
export function renderKey(t: PlannedTrack, nextKey: string | undefined): string {
  return [t.key, t.trimStart, t.crossfadeOut, t.borrowFromNext, t.silencePad, t.gainDb.toFixed(2), t.crossfadeOut || t.borrowFromNext ? nextKey : ""].join("|");
}

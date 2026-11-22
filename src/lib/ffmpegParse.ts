/** Parsers for ffmpeg output. Pure, so they're unit-tested against real samples. */

export interface Loudness {
  lufs: number | null;
  truePeakDb: number | null;
}

/** Reads the "Summary:" block printed by the ebur128 filter at the end of a run. */
export function parseEbur128Summary(stderr: string): Loudness {
  const at = stderr.lastIndexOf("Summary:");
  const block = at >= 0 ? stderr.slice(at) : "";
  const num = (re: RegExp) => {
    const m = block.match(re);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };
  let lufs = num(/I:\s*(-?[\d.]+|-?inf|nan)\s*LUFS/i);
  // ebur128 reports -70 LUFS (its gate) for silence: treat as unmeasurable.
  if (lufs !== null && lufs <= -69.9) lufs = null;
  const truePeak = block.slice(block.search(/True peak:/i));
  const pm = /True peak:/i.test(block) ? truePeak.match(/Peak:\s*(-?[\d.]+|-?inf)\s*dBFS/i) : null;
  const truePeakDb = pm && Number.isFinite(Number(pm[1])) ? Number(pm[1]) : null;
  return { lufs, truePeakDb };
}

/** `-progress pipe:1` emits key=value lines; out_time_us is the position in microseconds. */
export function progressFromLine(line: string, totalSec: number): number | null {
  const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
  if (!m || !(totalSec > 0)) return null;
  return Math.max(0, Math.min(1, Number(m[1]) / 1e6 / totalSec));
}

/** Our yt-dlp progress template: "romix <downloaded> <total> <estimate>" (NA when unknown). */
export function ytdlpProgress(line: string): number | null {
  const m = line.match(/^romix (\S+) (\S+) (\S+)/);
  if (!m) return null;
  const done = Number(m[1]);
  const total = Number(m[2]) || Number(m[3]);
  if (!Number.isFinite(done) || !(total > 0)) return null;
  return Math.max(0, Math.min(1, done / total));
}

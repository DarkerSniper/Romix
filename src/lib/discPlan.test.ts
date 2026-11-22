import { describe, expect, it } from "vitest";
import { GAP_SAMPLES, SECTOR_SAMPLES, loudnessTarget, planDisc, type PlanInput } from "./discPlan";

const s = (sec: number) => Math.round(sec * 44_100);
const track = (key: string, samples: number, lufs: number | null = -14, tp: number | null = -2): PlanInput => ({ key, samples, lufs, truePeakDb: tp });
const opts = (gapMode: "none" | "gap2" | "crossfade", normalize = false, crossfadeSec = 3) => ({ gapMode, normalize, crossfadeSec });

describe("planDisc", () => {
  const inputs = [track("a", s(200) + 100), track("b", s(180) + 333), track("c", s(240) + 7)];

  it.each(["none", "gap2", "crossfade"] as const)("every track is a whole number of sectors (%s)", (mode) => {
    const plan = planDisc(inputs, opts(mode));
    for (const t of plan.tracks) expect(t.samples % SECTOR_SAMPLES).toBe(0);
    expect(plan.totalSamples % SECTOR_SAMPLES).toBe(0);
  });

  it("gapless: no silence between songs, boundaries borrow from the next song", () => {
    const plan = planDisc(inputs, opts("none"));
    const [a, b, c] = plan.tracks;
    expect(a.silencePad).toBe(0);
    expect(b.silencePad).toBe(0);
    expect(b.trimStart).toBe(a.borrowFromNext);
    expect(c.trimStart).toBe(b.borrowFromNext);
    // Only the last track may end in silence.
    expect(c.borrowFromNext).toBe(0);
    // No audio lost or duplicated: total = all source samples + final pad.
    const source = inputs.reduce((n, t) => n + t.samples, 0);
    expect(plan.totalSamples).toBe(source + c.silencePad);
  });

  it("2s gaps: silence pads, 150-sector pregaps, nothing borrowed", () => {
    const plan = planDisc(inputs, opts("gap2"));
    expect(plan.tracks.map((t) => t.pregap)).toEqual([0, GAP_SAMPLES, GAP_SAMPLES]);
    expect(GAP_SAMPLES % SECTOR_SAMPLES).toBe(0);
    expect(plan.tracks.every((t) => t.borrowFromNext === 0 && t.trimStart === 0)).toBe(true);
    expect(plan.tracks[1].startSample).toBe(plan.tracks[0].samples + GAP_SAMPLES);
  });

  it("crossfade: overlap is mixed into the earlier track and skipped in the next", () => {
    const plan = planDisc(inputs, opts("crossfade", false, 3));
    const [a, b] = plan.tracks;
    expect(a.crossfadeOut).toBe(s(3));
    expect(b.trimStart).toBe(a.crossfadeOut + a.borrowFromNext);
    const source = inputs.reduce((n, t) => n + t.samples, 0);
    const overlaps = plan.tracks.reduce((n, t) => n + t.crossfadeOut, 0);
    expect(plan.totalSamples).toBe(source - overlaps + plan.tracks[2].silencePad);
  });

  it("crossfade never takes more than half of a short song", () => {
    const plan = planDisc([track("a", s(4)), track("b", s(60))], opts("crossfade", false, 8));
    expect(plan.tracks[0].crossfadeOut).toBe(Math.floor(s(4) / 2));
  });

  it("no gain when loudness evening is off", () => {
    const plan = planDisc([track("a", s(10), -8), track("b", s(10), -20)], opts("none", false));
    expect(plan.tracks.map((t) => t.gainDb)).toEqual([0, 0]);
  });
});

describe("loudnessTarget", () => {
  it("uses the median when every song has headroom", () => {
    expect(loudnessTarget([track("a", 1, -10, -6), track("b", 1, -14, -6), track("c", 1, -18, -6)])).toBe(-14);
  });

  it("lowers the target so the quietest song can be raised without clipping", () => {
    // c at -20 LUFS peaks at -3 dBTP: it can rise at most 2 dB → -18.
    const target = loudnessTarget([track("a", 1, -9, -0.5), track("b", 1, -12, -1.5), track("c", 1, -20, -3)])!;
    expect(target).toBe(-18);
  });

  it("gains never push any song above -1 dBTP", () => {
    const inputs = [track("a", s(10), -7, -0.2), track("b", s(10), -16, -4), track("c", s(10), -11, -1.1)];
    const plan = planDisc(inputs, opts("none", true));
    plan.tracks.forEach((t, i) => expect(inputs[i].truePeakDb! + t.gainDb).toBeLessThanOrEqual(-1 + 1e-9));
  });

  it("ignores unmeasurable tracks", () => {
    expect(loudnessTarget([track("a", 1, null, null)])).toBeNull();
    const plan = planDisc([track("a", s(5), null, null), track("b", s(5), -14, -3)], opts("none", true));
    expect(plan.tracks[0].gainDb).toBe(0);
  });
});

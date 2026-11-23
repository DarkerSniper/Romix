import { describe, expect, it } from "vitest";
import { camelot, camelotDistance, detectBpm, detectKey, findSilence, flowOrder, tempoDistance, transitionCost } from "./analysis";

const SR = 22_050;

/** Kick-like clicks at a given tempo, with a little noise so it isn't trivially periodic. */
function clicks(bpm: number, seconds: number): Float32Array {
  const out = new Float32Array(SR * seconds);
  const period = (60 / bpm) * SR;
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  for (let i = 0; i < out.length; i++) out[i] = rnd();
  for (let t = 0; t < out.length; t += period) {
    for (let i = 0; i < 600 && t + i < out.length; i++) out[Math.floor(t) + i] += Math.sin((2 * Math.PI * 60 * i) / SR) * Math.exp(-i / 120);
  }
  return out;
}

/** A sustained chord built from MIDI notes, with harmonics. */
function chord(midis: number[], seconds: number): Float32Array {
  const out = new Float32Array(SR * seconds);
  for (const m of midis) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    for (let h = 1; h <= 3; h++) for (let i = 0; i < out.length; i++) out[i] += (Math.sin((2 * Math.PI * f * h * i) / SR) / h) * 0.1;
  }
  return out;
}

const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe("detectBpm", () => {
  it.each([90, 100, 120, 128, 140])("finds %i BPM", (bpm) => {
    expect(detectBpm(clicks(bpm, 20), SR)).toBeCloseTo(bpm, -0.5); // within ±1.5
  });
  it("prefers the counted tempo over half time for fast songs", () => {
    const got = detectBpm(clicks(174, 20), SR)!;
    expect([87, 174].some((b) => Math.abs(got - b) < 2)).toBe(true);
  });
  it("returns null for very short audio", () => {
    expect(detectBpm(new Float32Array(1000), SR)).toBeNull();
  });
});

describe("detectKey", () => {
  it("C major (I–IV–V–I)", () => {
    const audio = concat(chord([48, 60, 64, 67], 2), chord([53, 65, 69, 72], 2), chord([55, 67, 71, 74], 2), chord([48, 60, 64, 67], 2));
    expect(detectKey(audio, SR)?.name).toBe("C major");
  });
  it("A minor (i–iv–v–i)", () => {
    const audio = concat(chord([45, 57, 60, 64], 2), chord([50, 62, 65, 69], 2), chord([52, 64, 67, 71], 2), chord([45, 57, 60, 64], 2));
    expect(detectKey(audio, SR)?.name).toBe("A minor");
  });
  it("G major", () => {
    const audio = concat(chord([43, 55, 59, 62], 2), chord([48, 60, 64, 67], 2), chord([50, 62, 66, 69], 2), chord([43, 55, 59, 62], 2));
    expect(detectKey(audio, SR)?.name).toBe("G major");
  });
});

describe("camelot", () => {
  it.each([
    [0, "major", "8B"], [7, "major", "9B"], [5, "major", "7B"], [11, "major", "1B"],
    [9, "minor", "8A"], [4, "minor", "9A"], [2, "minor", "7A"], [0, "minor", "5A"],
  ] as const)("%i %s → %s", (tonic, mode, code) => {
    expect(camelot(tonic, mode)).toBe(code);
  });
  it("distances", () => {
    expect(camelotDistance("8A", "8A")).toBe(0);
    expect(camelotDistance("8A", "9A")).toBe(1);
    expect(camelotDistance("12A", "1A")).toBe(1);
    expect(camelotDistance("8A", "8B")).toBe(1);
    expect(camelotDistance("8A", "2A")).toBe(6);
  });
  it("tempo distance treats double time as close", () => {
    expect(tempoDistance(70, 140)).toBe(0);
    expect(tempoDistance(120, 128)).toBeLessThan(0.1);
  });
});

describe("findSilence", () => {
  it("finds the music inside silent padding, keeping a small margin", () => {
    const pad = new Float32Array(SR * 3);
    const music = chord([60, 64, 67], 5);
    const { start, end } = findSilence(concat(pad, music, pad), SR, -55, 0.25);
    expect(start / SR).toBeCloseTo(2.75, 1);
    expect(end / SR).toBeCloseTo(8.25, 1);
  });
  it("leaves all-silent audio alone", () => {
    expect(findSilence(new Float32Array(SR), SR)).toEqual({ start: 0, end: SR });
  });
});

describe("flowOrder", () => {
  it("keeps the opener and makes every transition smoother than a shuffled order", () => {
    const items = [
      { id: "a", bpm: 120, camelot: "8A" },
      { id: "b", bpm: 175, camelot: "3B" },
      { id: "c", bpm: 122, camelot: "9A" },
      { id: "d", bpm: 170, camelot: "2B" },
      { id: "e", bpm: 124, camelot: "10A" },
    ];
    const order = flowOrder(items);
    expect(order[0]).toBe("a");
    expect(new Set(order).size).toBe(5);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    const cost = (o: string[]) => o.slice(1).reduce((s, id, i) => s + transitionCost(byId[o[i]], byId[id]), 0);
    expect(cost(order)).toBeLessThan(cost(items.map((i) => i.id)));
    expect(order.slice(0, 3)).toEqual(["a", "c", "e"]);
  });
});

import { describe, expect, it } from "vitest";
import { barLines, type LineStats } from "./coverArt";

const bar = (n: number): LineStats[] => Array.from({ length: n }, () => ({ mean: 4, max: 20 }));
const picture = (n: number): LineStats[] => Array.from({ length: n }, (_, i) => ({ mean: 90 + (i % 7), max: 230 }));

describe("barLines (letterbox detection)", () => {
  it("finds a baked-in black bar", () => {
    expect(barLines([...bar(22), ...picture(158)])).toBe(22);
  });
  it("ignores pictures without bars", () => {
    expect(barLines(picture(180))).toBe(0);
  });
  it("doesn't crop a dark photo that has bright detail near the edge", () => {
    expect(barLines([...bar(1), { mean: 10, max: 200 }, ...picture(178)])).toBe(0);
  });
  it("never crops more than 30 % from one side", () => {
    expect(barLines([...bar(150), ...picture(30)])).toBe(54);
  });
  it("ignores a hairline under 2 %", () => {
    expect(barLines([...bar(2), ...picture(178)])).toBe(0);
  });
});

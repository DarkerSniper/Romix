import { describe, expect, it } from "vitest";
import { wavDataRange } from "./wav";

function header(chunks: Array<[string, number, number?]>): Uint8Array {
  const parts: number[] = [];
  const str = (s: string) => [...s].forEach((c) => parts.push(c.charCodeAt(0)));
  const u32 = (n: number) => parts.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
  str("RIFF");
  u32(0);
  str("WAVE");
  for (const [id, size, bodyLen] of chunks) {
    str(id);
    u32(size);
    for (let i = 0; i < (bodyLen ?? size) + (size % 2); i++) parts.push(0);
  }
  return new Uint8Array(parts);
}

describe("wavDataRange", () => {
  it("finds data right after fmt", () => {
    const h = header([["fmt ", 16], ["data", 2352, 0]]);
    expect(wavDataRange(h, h.length + 2352)).toEqual({ offset: 44, length: 2352 });
  });
  it("skips LIST chunks (ffmpeg metadata), including odd-sized padding", () => {
    const h = header([["fmt ", 16], ["LIST", 27], ["data", 4704, 0]]);
    expect(wavDataRange(h, h.length + 4704)).toEqual({ offset: 12 + 24 + 36 + 8, length: 4704 });
  });
  it("uses the file size when the data size is unknown", () => {
    const h = header([["fmt ", 16], ["data", 0xffffffff, 0]]);
    expect(wavDataRange(h, 1000).length).toBe(1000 - 44);
  });
  it("rejects non-WAV input", () => {
    expect(() => wavDataRange(new Uint8Array(16), 16)).toThrow();
  });
});

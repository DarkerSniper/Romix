import { describe, expect, it } from "vitest";
import { parseEbur128Summary, progressFromLine, ytdlpProgress } from "./ffmpegParse";

const SUMMARY = `[Parsed_ebur128_2 @ 0000020c3d] t: 251.9  TARGET:-23 LUFS    M: -10.1 S: -9.8
[Parsed_ebur128_2 @ 0000020c3d] Summary:

  Integrated loudness:
    I:          -9.4 LUFS
    Threshold: -19.7 LUFS

  Loudness range:
    LRA:         4.8 LU
    Threshold: -29.7 LUFS
    LRA low:   -12.4 LUFS
    LRA high:   -7.6 LUFS

  True peak:
    Peak:        0.7 dBFS
`;

describe("parseEbur128Summary", () => {
  it("reads integrated loudness and true peak", () => {
    expect(parseEbur128Summary(SUMMARY)).toEqual({ lufs: -9.4, truePeakDb: 0.7 });
  });
  it("treats silence as unmeasurable", () => {
    const silent = SUMMARY.replace("-9.4 LUFS", "-70.0 LUFS").replace("0.7 dBFS", "-inf dBFS");
    expect(parseEbur128Summary(silent)).toEqual({ lufs: null, truePeakDb: null });
  });
  it("returns nulls when there is no summary", () => {
    expect(parseEbur128Summary("random output")).toEqual({ lufs: null, truePeakDb: null });
  });
});

describe("progress parsers", () => {
  it("ffmpeg -progress", () => {
    expect(progressFromLine("out_time_us=125000000", 250)).toBe(0.5);
    expect(progressFromLine("out_time_ms=500000000", 250)).toBe(1);
    expect(progressFromLine("speed=40x", 250)).toBeNull();
  });
  it("yt-dlp template", () => {
    expect(ytdlpProgress("romix 2500 10000 NA")).toBe(0.25);
    expect(ytdlpProgress("romix 2500 NA 5000")).toBe(0.5);
    expect(ytdlpProgress("romix NA NA NA")).toBeNull();
    expect(ytdlpProgress("[download] 50%")).toBeNull();
  });
});

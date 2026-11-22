import { describe, expect, it } from "vitest";
import { cleanChannel, cleanTitle, normalizeMeta } from "./metadata";

describe("cleanTitle", () => {
  it.each([
    ["Bohemian Rhapsody (Official Video Remastered)", "Bohemian Rhapsody"],
    ["Shape of You (Official Music Video)", "Shape of You"],
    ["Blinding Lights [Official Audio]", "Blinding Lights"],
    ["Levitating (Lyrics)", "Levitating"],
    ["Hello (Official Lyric Video)", "Hello"],
    ["Time (HD)", "Time"],
    ["GANGNAM STYLE(강남스타일) M/V", "GANGNAM STYLE(강남스타일)"],
    ["Halo (Visualizer)", "Halo"],
    ["Heroes (Remastered 2017)", "Heroes (Remastered 2017)"],
    ["Strobe (Club Edit)", "Strobe (Club Edit)"],
    ["Despacito ft. Daddy Yankee", "Despacito ft. Daddy Yankee"],
    ["Midnight City (feat. Someone) (Official Video)", "Midnight City (feat. Someone)"],
  ])("%s → %s", (input, expected) => {
    expect(cleanTitle(input)).toBe(expected);
  });
});

describe("cleanChannel", () => {
  it.each([
    ["Queen - Topic", "Queen"],
    ["EdSheeranVEVO", "EdSheeran"],
    ["Adele Official", "Adele"],
    ["Daft Punk", "Daft Punk"],
  ])("%s → %s", (input, expected) => {
    expect(cleanChannel(input)).toBe(expected);
  });
});

describe("normalizeMeta", () => {
  it("prefers YouTube Music track and artists fields", () => {
    expect(
      normalizeMeta({ id: "x", title: "ignored", track: "Get Lucky", artists: ["Daft Punk", "Pharrell Williams"], album: "Random Access Memories" }),
    ).toEqual({ title: "Get Lucky", artist: "Daft Punk, Pharrell Williams", album: "Random Access Memories" });
  });

  it("splits Artist - Title from real music video titles", () => {
    expect(normalizeMeta({ id: "kJQP7kiw5Fk", title: "Luis Fonsi - Despacito ft. Daddy Yankee", channel: "LuisFonsiVEVO" })).toEqual({
      title: "Despacito ft. Daddy Yankee",
      artist: "Luis Fonsi",
      album: undefined,
    });
    expect(normalizeMeta({ id: "fJ9rUzIMcZQ", title: "Queen – Bohemian Rhapsody (Official Video Remastered)", channel: "Queen Official" })).toEqual({
      title: "Bohemian Rhapsody",
      artist: "Queen",
      album: undefined,
    });
    expect(normalizeMeta({ id: "9bZkp7q19f0", title: "PSY - GANGNAM STYLE(강남스타일) M/V", channel: "officialpsy" }).title).toBe(
      "GANGNAM STYLE(강남스타일)",
    );
  });

  it("falls back to the channel when the title has no artist", () => {
    expect(normalizeMeta({ id: "x", title: "Nightcall (Official Video)", channel: "Kavinsky - Topic" })).toEqual({
      title: "Nightcall",
      artist: "Kavinsky",
      album: undefined,
    });
  });

  it("keeps hyphens inside the song title", () => {
    expect(normalizeMeta({ id: "x", title: "Artist - Song - Live at Wembley" }).title).toBe("Song - Live at Wembley");
  });

  it("survives empty metadata", () => {
    expect(normalizeMeta({ id: "x" })).toEqual({ title: "Untitled", artist: "Unknown artist", album: undefined });
  });
});

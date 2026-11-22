import { describe, expect, it } from "vitest";
import { discLength, formatTime, parseYouTubeLink } from "./cd";
import { classifyYtdlpError } from "./ytdlpErrors";
import type { Track } from "../types";

describe("parseYouTubeLink", () => {
  it.each([
    ["https://music.youtube.com/watch?v=kJQP7kiw5Fk&si=abc", "kJQP7kiw5Fk"],
    ["https://www.youtube.com/watch?v=9bZkp7q19f0&list=RD9bZkp7q19f0", "9bZkp7q19f0"],
    ["https://youtu.be/fJ9rUzIMcZQ?t=10", "fJ9rUzIMcZQ"],
    ["youtube.com/shorts/JGwWNGJdvx8", "JGwWNGJdvx8"],
    ["m.youtube.com/watch?v=JGwWNGJdvx8", "JGwWNGJdvx8"],
  ])("accepts %s", (url, id) => {
    const r = parseYouTubeLink(url);
    expect(r.ok && r.videoId).toBe(id);
  });

  it.each([
    ["https://open.spotify.com/track/abc", "Only YouTube"],
    ["https://www.youtube.com/playlist?list=PL123", "Playlist"],
    ["https://www.youtube.com/watch?v=short", "video id"],
    ["not a link at all", "isn't a link"],
  ])("rejects %s", (url, reason) => {
    const r = parseYouTubeLink(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });
});

describe("formatTime and discLength", () => {
  const t = (s: number) => ({ durationSec: s }) as Track;
  it("formats minutes and hours", () => {
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3725)).toBe("1:02:05");
  });
  it("adds gaps and subtracts crossfades between songs", () => {
    const tracks = [t(100), t(100), t(100)];
    expect(discLength(tracks, { gapMode: "none", crossfadeSec: 3, normalize: false })).toBe(300);
    expect(discLength(tracks, { gapMode: "gap2", crossfadeSec: 3, normalize: false })).toBe(304);
    expect(discLength(tracks, { gapMode: "crossfade", crossfadeSec: 3, normalize: false })).toBe(294);
  });
});

describe("classifyYtdlpError", () => {
  it.each([
    ["ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "private"],
    ["ERROR: [youtube] dQw4w9WgXcA: This video is unavailable", "unavailable"],
    ["ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.", "age"],
    ["ERROR: [youtube] abc: Sign in to confirm you’re not a bot", "bot-check"],
    ["ERROR: [youtube] abc: The uploader has not made this video available in your country", "unavailable"],
    ["ERROR: [youtube] abc: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>", "offline"],
    ["ERROR: [youtube] abc: Join this channel to get access to members-only content", "members"],
    ["ERROR: something brand new", "unknown"],
  ])("%s → %s", (stderr, code) => {
    expect(classifyYtdlpError(stderr).code).toBe(code);
  });
});

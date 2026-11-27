import { describe, expect, it } from "vitest";
import { checksumFor, compareVersions, digestSha, parseVersion, pickUpdate, type GhRelease } from "./releases";

const rel = (tag: string, opts: Partial<GhRelease> = {}, files?: string[]): GhRelease => {
  const v = tag.replace(/^v/, "");
  return {
    tag_name: tag,
    name: `Romix ${v}`,
    body: "",
    html_url: `https://github.com/DarkerSniper/Romix/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    published_at: "2026-11-27T00:00:00Z",
    assets: (files ?? [`Romix-Setup-${v}.exe`, `Romix-${v}-x64.zip`, "checksums.txt"]).map((name) => ({
      name,
      size: 1,
      browser_download_url: `https://github.com/DarkerSniper/Romix/releases/download/${tag}/${name}`,
    })),
    ...opts,
  };
};

describe("versions", () => {
  it("parses with or without v and pre-release tags", () => {
    expect(parseVersion("v1.2.3")?.nums).toEqual([1, 2, 3]);
    expect(parseVersion("0.6.0-beta.2")?.pre).toBe("beta.2");
    expect(parseVersion("latest")).toBeUndefined();
  });
  it("orders like semver", () => {
    expect(compareVersions("0.6.0", "0.5.9")).toBeGreaterThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v0.5.0", "0.5.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
  });
});

describe("pickUpdate", () => {
  const list = [rel("v0.5.0", { prerelease: true }), rel("v0.6.0", { prerelease: true }), rel("v0.5.5"), rel("v0.7.0", { draft: true })];
  it("offers the newest non-draft release", () => {
    expect(pickUpdate(list, "0.5.0", { previews: true, kind: "installer" })?.tag_name).toBe("v0.6.0");
  });
  it("skips previews unless asked", () => {
    expect(pickUpdate(list, "0.5.0", { previews: false, kind: "installer" })?.tag_name).toBe("v0.5.5");
  });
  it("offers nothing when up to date", () => {
    expect(pickUpdate(list, "0.6.0", { previews: true, kind: "portable" })).toBeUndefined();
  });
  it("needs a download for this kind of install", () => {
    const onlyZip = [rel("v0.6.0", {}, ["Romix-0.6.0-x64.zip"])];
    expect(pickUpdate(onlyZip, "0.5.0", { previews: true, kind: "installer" })).toBeUndefined();
    expect(pickUpdate(onlyZip, "0.5.0", { previews: true, kind: "portable" })?.tag_name).toBe("v0.6.0");
  });
});

describe("checksums", () => {
  const sha = "a".repeat(64);
  it("reads sha256sum lines (text and binary mode)", () => {
    const sums = `${sha}  Romix-Setup-0.6.0.exe\r\n${"B".repeat(64)} *Romix-0.6.0-x64.zip\n`;
    expect(checksumFor(sums, "Romix-Setup-0.6.0.exe")).toBe(sha);
    expect(checksumFor(sums, "Romix-0.6.0-x64.zip")).toBe("b".repeat(64));
    expect(checksumFor(sums, "Romix-0.6.0-x64.zip.bak")).toBeUndefined();
  });
  it("reads GitHub digests", () => {
    expect(digestSha({ name: "x", size: 1, browser_download_url: "", digest: `sha256:${sha}` })).toBe(sha);
    expect(digestSha({ name: "x", size: 1, browser_download_url: "", digest: null })).toBeUndefined();
  });
});

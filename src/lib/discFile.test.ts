import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DiscFileError, decodeManifest, encodeDisc, linksText, LIMITS, MAGIC, type DiscManifest } from "./discFile";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const cover = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4]);
const audio = new Uint8Array(1000).fill(7);
const base: Omit<DiscManifest, "blobs"> = {
  format: "romix-disc",
  version: 1,
  createdAt: 1,
  app: "Romix test",
  disc: { title: "Road Trip", options: { gapMode: "crossfade", crossfadeSec: 4, normalize: true, speedPct: 0 } },
  tracks: [
    { title: "Despacito", artist: "Luis Fonsi", durationSec: 282, color: "#aa3322", source: "youtube", videoId: "kJQP7kiw5Fk", cover: { blob: 0 }, coverHi: { blob: 0 }, trimStartSec: 1, trimEndSec: 280 },
    { title: "My demo", artist: "Me", durationSec: 60, color: "#112233", source: "local", audio: { blob: 1, ext: "mp3" } },
  ],
};
const blobs = [
  { type: "image/jpeg", sha256: sha(cover), bytes: cover },
  { type: "audio/mpeg", sha256: sha(audio), bytes: audio },
];
const file = (manifest = base) => join(encodeDisc(manifest, blobs));

/** Rewrites the manifest inside an encoded file (for tampering tests). */
function withManifest(bytes: Uint8Array, edit: (m: Record<string, unknown>) => void): Uint8Array {
  const len = new DataView(bytes.buffer).getUint32(10, true);
  const m = JSON.parse(new TextDecoder().decode(bytes.slice(14, 14 + len)));
  edit(m);
  const json = new TextEncoder().encode(JSON.stringify(m));
  const head = bytes.slice(0, 14);
  new DataView(head.buffer).setUint32(10, json.length, true);
  return join([head, json, bytes.slice(14 + len)]);
}

const decode = (b: Uint8Array) => decodeManifest(b, b.length);

describe(".romix disc file", () => {
  it("round-trips a disc: songs, order, trims, options, covers and included audio", () => {
    const bytes = file();
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe(MAGIC);
    const { manifest, blobStart } = decode(bytes);
    expect(manifest.disc.title).toBe("Road Trip");
    expect(manifest.disc.options).toEqual({ gapMode: "crossfade", crossfadeSec: 4, normalize: true, speedPct: 0 });
    expect(manifest.tracks.map((t) => t.title)).toEqual(["Despacito", "My demo"]);
    expect(manifest.tracks[0]).toMatchObject({ videoId: "kJQP7kiw5Fk", trimStartSec: 1, trimEndSec: 280, cover: { blob: 0 } });
    expect(manifest.tracks[1].audio).toEqual({ blob: 1, ext: "mp3" });
    const b1 = manifest.blobs[1];
    expect(sha(bytes.slice(blobStart + b1.offset, blobStart + b1.offset + b1.length))).toBe(b1.sha256);
  });

  it("rejects files that aren't Romix discs, or are damaged or cut short", () => {
    expect(() => decode(new TextEncoder().encode("PK\u0003\u0004 not a disc at all"))).toThrow(DiscFileError);
    const bytes = file();
    expect(() => decode(bytes.slice(0, 20))).toThrow(/incomplete/);
    expect(() => decode(bytes.slice(0, bytes.length - 10))).toThrow(/incomplete/);
    const broken = bytes.slice();
    broken[20] = 0x7b; // corrupt the JSON
    expect(() => decode(broken)).toThrow(DiscFileError);
  });

  it("asks for a newer Romix when the format is newer", () => {
    const bytes = file();
    new DataView(bytes.buffer).setUint16(8, 99, true);
    expect(() => decode(bytes)).toThrow(/newer Romix/);
  });

  it("refuses tampered parts: pointers outside the file, non-picture covers, unsupported audio", () => {
    expect(() => decode(withManifest(file(), (m) => ((m.blobs as Array<{ length: number }>)[0].length = 10_000_000)))).toThrow(/incomplete/);
    expect(() => decode(withManifest(file(), (m) => ((m.tracks as Array<{ cover: unknown }>)[0].cover = { blob: 9 })))).toThrow(/missing part/);
    expect(() => decode(withManifest(file(), (m) => ((m.blobs as Array<{ type: string }>)[0].type = "text/html")))).toThrow(/isn't a picture/);
    expect(() => decode(withManifest(file(), (m) => ((m.tracks as Array<{ audio: unknown }>)[1].audio = { blob: 1, ext: "exe" })))).toThrow(/isn't supported/);
    expect(() => decode(withManifest(file(), (m) => ((m.tracks as Array<{ videoId: string }>)[0].videoId = "../../etc")))).toThrow(/invalid YouTube link/);
  });

  it("limits and cleans what it reads", () => {
    const long = "x".repeat(5000);
    const { manifest } = decode(withManifest(file(), (m) => {
      (m.disc as { title: string }).title = long;
      (m.tracks as Array<{ color: string }>)[0].color = "url(javascript:alert(1))";
    }));
    expect(manifest.disc.title.length).toBe(LIMITS.text);
    expect(manifest.tracks[0].color).toBe("#888888");
    expect(() => decode(withManifest(file(), (m) => (m.tracks = [])))).toThrow(/no songs/);
    expect(() => decode(withManifest(file(), (m) => ((m.tracks as Array<{ durationSec: number }>)[0].durationSec = -5)))).toThrow(/out of range/);
  });

  it("copies a plain list of links", () => {
    const text = linksText("Road Trip", base.tracks);
    expect(text).toContain("1. Despacito · Luis Fonsi\nhttps://music.youtube.com/watch?v=kJQP7kiw5Fk");
    expect(text).not.toContain("My demo"); // local songs have no link
  });
});

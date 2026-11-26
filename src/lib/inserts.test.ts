import { describe, expect, it } from "vitest";
import { PAPER, SIZES, buildInsertsHtml, insertPages, listenUrl, mainArtist, qrSvg, volumeLabel, type InsertInput } from "./inserts";

const tracks = Array.from({ length: 12 }, (_, i) => ({
  title: `Song ${i + 1}`,
  artist: i < 9 ? "Queen" : "Bowie",
  durationSec: 200 + i,
  cover: "data:image/png;base64,AA",
  coverHi: `romix-cover://c/${"a".repeat(31)}${i % 10}.jpg`,
  color: "#223344",
  videoId: `abcdefghij${i % 10}`,
}));

const base: InsertInput = {
  title: "Road Trip",
  tracks,
  front: "collage",
  format: "single",
  labelKind: "sheet",
  colorStrip: false,
  qr: false,
  labelRing: false,
  ruler: false,
  paper: "A4",
};
const html = (patch: Partial<InsertInput> = {}) => buildInsertsHtml({ ...base, ...patch });

describe("sizes", () => {
  it("real jewel-case sizes", () => {
    expect(SIZES.front).toEqual({ w: 120, h: 120 });
    expect(SIZES.booklet).toEqual({ w: 240, h: 120 });
    expect([SIZES.back.w, SIZES.back.h, SIZES.back.spine]).toEqual([151, 118, 6.5]);
    expect(SIZES.label.d).toBe(118);
    expect(SIZES.label.hole).toEqual({ sheet: 41, printable: 22 });
    expect(SIZES.bleed).toBe(3);
  });

  it("every layout fits on both papers, including bleed and crop marks", () => {
    const m = SIZES.bleed + 1 + 5; // bleed + gap + crop mark length
    for (const p of Object.values(PAPER)) {
      // single: front + back stacked on a portrait page
      expect(15 + SIZES.front.h + 15 + SIZES.back.h + m).toBeLessThan(p.h);
      expect(SIZES.back.w + 2 * m).toBeLessThan(p.w);
      // booklet spread on a landscape page
      expect(SIZES.booklet.w + 2 * m).toBeLessThan(p.h);
      // booklet page 3: back card + label on a portrait page
      expect(14 + SIZES.back.h + 16 + SIZES.label.d + m).toBeLessThan(p.h);
    }
  });

  it("booklet uses two landscape pages then a portrait page", () => {
    expect(insertPages({ format: "booklet", paper: "A4" })).toEqual([{ w: 297, h: 210 }, { w: 297, h: 210 }, { w: 210, h: 297 }]);
    expect(insertPages({ format: "single", paper: "Letter" })).toEqual([{ w: 215.9, h: 279.4 }, { w: 215.9, h: 279.4 }]);
    expect(html({ format: "booklet" })).toContain("@page land { size: 297mm 210mm");
    expect(html({ format: "booklet" })).toContain("width:240mm;height:120mm");
  });
});

describe("content", () => {
  it("uses print-resolution covers and bleeds the artwork 3 mm", () => {
    const h = html();
    expect(h).toContain("romix-cover://c/");
    expect(h).toContain(".bleed { position: absolute; inset: -3mm");
  });

  it("each front style renders", () => {
    expect(html({ front: "ring" }).match(/<clipPath id="s\d+">/g)?.length).toBe(12);
    expect(html({ front: "wave", waveform: [0.2, 0.8, 0.5] }).match(/<rect x=/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html({ front: "wave" })).toContain('class="type"'); // falls back without audio data
    expect(html({ front: "cover", customCover: "romix-cover://c/" + "b".repeat(32) + ".png" })).toContain("b".repeat(32));
  });

  it("your own image works in every design, and on the label unless turned off", () => {
    const mine = `romix-cover://c/${"c".repeat(32)}.jpg`;
    const front = (h: string) => h.slice(h.indexOf('class="piece front"'), h.indexOf('class="piece back"'));
    // collage: first tile; cover: full bleed; ring: centre label; wave/type: background with a dark wash
    expect(front(html({ front: "collage", customCover: mine })).indexOf(mine)).toBeLessThan(front(html({ front: "collage", customCover: mine })).indexOf("romix-cover://c/aaa"));
    expect(front(html({ front: "cover", customCover: mine }))).toContain(mine);
    expect(front(html({ front: "ring", customCover: mine }))).toContain('clip-path="url(#hub)"');
    expect(front(html({ front: "ring" }))).not.toContain("#hub");
    for (const f of ["wave", "type"] as const) {
      const h = front(html({ front: f, customCover: mine, waveform: [0.5, 0.7] }));
      expect(h).toContain(mine);
      expect(h).toContain("bleed scrim");
    }
    const label = (h: string) => h.slice(h.indexOf('class="piece label'));
    expect(label(html({ customCover: mine }))).toContain(mine);
    expect(label(html({ customCover: mine, customOnLabel: false }))).not.toContain(mine);
  });

  it("QR code only when asked and when there are YouTube songs", () => {
    expect(html()).not.toContain('class="qr"');
    expect(html({ qr: true })).toContain('class="qr"');
    expect(html({ qr: true, tracks: tracks.map((t) => ({ ...t, videoId: undefined })) })).not.toContain('class="qr"');
    expect(listenUrl(tracks)).toMatch(/^https:\/\/www\.youtube\.com\/watch_videos\?video_ids=abcdefghij0,abcdefghij1/);
    expect(qrSvg("https://example.com", 15)).toContain('width="15mm"');
  });

  it("label: hole size by kind, optional titles around the edge", () => {
    expect(html({ labelKind: "sheet" })).toContain("width:41mm;height:41mm");
    expect(html({ labelKind: "printable" })).toContain("width:22mm;height:22mm");
    expect(html()).not.toContain('class="label-ring"');
    expect(html({ labelRing: true })).toContain("<textPath");
  });

  it("options: colour strip, ruler, volume, dedication", () => {
    expect(html({ colorStrip: true })).toContain('class="strip h"');
    expect(html({ ruler: true })).toContain("exactly 10 cm");
    expect(volumeLabel(7)).toBe("Vol. 07");
    expect(html({ volume: 7 })).toContain("Vol. 07");
    expect(html({ dedication: "For Mom" })).toContain("For Mom");
    expect(html({ format: "booklet", dedication: "For Mom" })).toContain('class="dedication big"');
  });

  it("escapes everything you can type", () => {
    const evil = `<script>x</script>"&'`;
    const h = html({ title: evil, subtitle: evil, spineText: evil, dedication: evil, tracks: tracks.map((t) => ({ ...t, title: evil })) });
    expect(h).not.toContain("<script>x");
    expect(h).toContain("&lt;script&gt;");
  });

  it("names the main artist, or Various artists", () => {
    expect(mainArtist(tracks)).toBe("Queen");
    expect(mainArtist(tracks.map((t, i) => ({ ...t, artist: `A${i}` })))).toBe("Various artists");
  });
});

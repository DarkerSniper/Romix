import { describe, expect, it } from "vitest";
import { PAPER, SIZES, buildInsertsHtml, insertPages, listenUrl, mainArtist, qrSvg, volumeLabel, type InsertInput } from "./inserts";
import { defaultDesign, defaultLook, songKey, type InsertDesign } from "./insertDesign";

const tracks = Array.from({ length: 12 }, (_, i) => ({
  title: `Song ${i + 1}`,
  artist: i < 9 ? "Queen" : "Bowie",
  durationSec: 200 + i,
  cover: "data:image/png;base64,AA",
  coverHi: `romix-cover://c/${"a".repeat(31)}${i % 10}.jpg`,
  color: "#223344",
  videoId: `abcdefghij${i % 10}`,
}));

const baseDesign: InsertDesign = { ...defaultDesign(), colorStrip: false, qr: false, ruler: false };
const base: InsertInput = { title: "Road Trip", tracks, design: baseDesign, paper: "A4" };
/** Text fields go on the input, design fields on the design. */
const html = (patch: Partial<InsertInput> = {}, design: Partial<InsertDesign> = {}) => buildInsertsHtml({ ...base, ...patch, design: { ...baseDesign, ...design } });

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
    expect(html({}, { format: "booklet" })).toContain("@page land { size: 297mm 210mm");
    expect(html({}, { format: "booklet" })).toContain("width:240mm;height:120mm");
  });
});

describe("content", () => {
  it("uses print-resolution covers and bleeds the artwork 3 mm", () => {
    const h = html();
    expect(h).toContain("romix-cover://c/");
    expect(h).toContain('class="layer" style="inset:-3mm -3mm -3mm -3mm');
  });

  it("each front style renders", () => {
    expect(html({}, { front: "ring" }).match(/<clipPath id="s\d+">/g)?.length).toBe(12);
    expect(html({ waveform: [0.2, 0.8, 0.5] }, { front: "wave" }).match(/<rect x=/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html({}, { front: "wave" })).toContain('class="type"'); // falls back without audio data
    expect(front(html({}, { front: "pictures" })).match(/class="tile"/g)?.length).toBe(4); // a grid of 4 covers by default
  });

  it("the booklet's front doesn't bleed into its back panel", () => {
    const h = html({}, { format: "booklet" });
    expect(h).toContain('class="panel right front');
    expect(h).toContain('class="layer" style="inset:-3mm -3mm -3mm 0');
    expect(h).toContain('class="layer" style="inset:-3mm 0 -3mm -3mm');
  });

  it("QR code only when asked and when there are YouTube songs", () => {
    expect(html()).not.toContain('class="qr"');
    expect(html({}, { qr: true })).toContain('class="qr"');
    expect(html({ tracks: tracks.map((t) => ({ ...t, videoId: undefined })) }, { qr: true })).not.toContain('class="qr"');
    expect(listenUrl(tracks)).toMatch(/^https:\/\/www\.youtube\.com\/watch_videos\?video_ids=abcdefghij0,abcdefghij1/);
    expect(qrSvg("https://example.com", 15)).toContain('width="15mm"');
  });

  it("label: hole size by kind, optional titles around the edge", () => {
    expect(html({}, { labelKind: "sheet" })).toContain("width:41mm;height:41mm");
    expect(html({}, { labelKind: "printable" })).toContain("width:22mm;height:22mm");
    expect(html()).not.toContain('class="label-ring"');
    expect(html({}, { labelRing: true })).toContain("<textPath");
  });

  it("options: colour strip, ruler, volume, dedication", () => {
    expect(html({}, { colorStrip: true })).toContain('class="strip h"');
    expect(html({}, { ruler: true })).toContain("exactly 10 cm");
    expect(volumeLabel(7)).toBe("Vol. 07");
    expect(html({ volume: 7 })).toContain("Vol. 07");
    expect(html({ dedication: "For Mom" })).toContain("For Mom");
    expect(html({ dedication: "For Mom" }, { format: "booklet" })).toContain('class="dedication big"');
  });
});

const front = (h: string) => h.slice(h.indexOf('class="piece front'), h.indexOf('class="piece back"'));
const backCard = (h: string) => h.slice(h.indexOf('class="back-main'), h.indexOf('class="piece label'));
const labelOf = (h: string) => h.slice(h.indexOf('class="piece label'));

describe("custom looks", () => {
  const mine = `romix-cover://c/${"c".repeat(32)}.jpg`;
  const withImage: Partial<InsertDesign> = { images: [{ id: "a", src: mine, w: 2000, h: 2000 }] };

  it("any part can carry several pictures, yours or the songs'", () => {
    const back = { ...defaultLook("back", "pictures", tracks), layout: "cols2" as const, tiles: [{ ref: { own: "a" } }, { ref: { song: songKey(tracks[5]) } }] };
    const h = backCard(html({}, { ...withImage, sections: { back } }));
    expect(h.match(/class="tile"/g)?.length).toBe(2);
    expect(h).toContain(mine);
    expect(h).toContain(tracks[5].coverHi);
  });

  it("a song's picture follows the song, wherever it moves", () => {
    const label = { ...defaultLook("label", "pictures", tracks), tiles: [{ ref: { song: songKey(tracks[7]) } }] };
    const reordered = [...tracks].reverse();
    expect(labelOf(html({ tracks: reordered }, { sections: { label } }))).toContain(tracks[7].coverHi);
  });

  it("backgrounds and text colours aren't just white", () => {
    const back = { ...defaultLook("back", "pictures", tracks), bg: "#1a2b3c" };
    const h = backCard(html({}, { sections: { back } }));
    expect(h).toContain("background:#1a2b3c");
    expect(h).toContain("--ink:#ffffff"); // automatic: white on a dark background
    const light = backCard(html({}, { sections: { back: { ...back, bg: "#f3ede1", ink: "#2b2620", accent: "#9a5b2e" } } }));
    expect(light).toContain("--ink:#2b2620;--accent:#9a5b2e");
  });

  it("a wash over the pictures keeps text readable", () => {
    const back = { ...defaultLook("back", "pictures", tracks), layout: "grid4" as const, wash: 0.5 };
    expect(backCard(html({}, { sections: { back } }))).toContain('class="wash"');
    expect(backCard(html({}, { sections: { back: { ...back, wash: 0 } } }))).not.toContain('class="wash"');
  });

  it("a framed copy is used only while the tile keeps its shape", () => {
    const framed = `romix-cover://c/${"f".repeat(32)}.jpg`;
    const front1 = { ...defaultLook("front", "pictures", tracks), layout: "one" as const, tiles: [{ ref: { own: "a" }, framed, aspect: 1 }] };
    expect(front(html({}, { ...withImage, sections: { front: front1 } }))).toContain(framed);
    const wide = { ...front1, layout: "rows2" as const }; // now 2:1, the square framing doesn't fit
    const h = front(html({}, { ...withImage, sections: { front: wide } }));
    expect(h).not.toContain(framed);
    expect(h).toContain(mine);
  });

  it("font, title band and position", () => {
    expect(html({}, { font: "serif" })).toContain("font-family: Georgia");
    expect(front(html({}, { titlePos: "top" }))).toContain('class="band top"');
    expect(front(html({}, { titlePos: "hidden" }))).not.toContain('class="band');
    expect(front(html({}, { band: "light" }))).toContain("background:rgba(255,255,255,.8)");
  });

  it("the preview outlines the part you're editing, the print doesn't", () => {
    expect(html({ highlight: "spine" }).match(/class="spine inked[^"]* hl"/g)?.length).toBe(2);
    expect(html()).not.toMatch(/ hl"/);
  });

  it("your image in the ring's centre", () => {
    expect(front(html({}, { ...withImage, front: "ring", ringCentre: { ref: { own: "a" } } }))).toContain('clip-path="url(#hub)"');
    expect(front(html({}, { front: "ring" }))).not.toContain("#hub");
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

import { describe, expect, it } from "vitest";
import { PAPER, SIZES, buildInsertsHtml, mainArtist } from "./inserts";

const tracks = Array.from({ length: 12 }, (_, i) => ({ title: `Song ${i + 1}`, artist: i < 9 ? "Queen" : "Bowie", durationSec: 200 + i, cover: "data:image/png;base64,AA", color: "#223344" }));

describe("inserts", () => {
  it("pieces are real jewel-case sizes and fit on both paper sizes", () => {
    expect(SIZES.front).toEqual({ w: 120, h: 120 });
    expect(SIZES.back.w).toBe(151);
    expect(SIZES.back.h).toBe(118);
    for (const p of Object.values(PAPER)) {
      expect(SIZES.back.w + 20).toBeLessThan(p.w); // room for crop marks
      expect(14 + SIZES.front.h + 16 + SIZES.back.h + 10).toBeLessThan(p.h);
      expect(SIZES.label.d + 20).toBeLessThan(p.w);
    }
  });

  it("writes exact millimetre sizes into the page", () => {
    const html = buildInsertsHtml({ title: "Road Trip", tracks, layout: "collage", paper: "A4" });
    expect(html).toContain("size: 210mm 297mm");
    expect(html).toContain("width:120mm;height:120mm");
    expect(html).toContain("width:151mm;height:118mm");
    expect(html).toContain("width:118mm;height:118mm");
    expect(html.match(/<li>/g)?.length).toBe(12);
  });

  it("escapes titles so they can't break the page", () => {
    const html = buildInsertsHtml({ title: `<script>x</script> & "mix"`, tracks, layout: "type", paper: "Letter" });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("names the main artist, or Various artists", () => {
    expect(mainArtist(tracks)).toBe("Queen");
    expect(mainArtist(tracks.map((t, i) => ({ ...t, artist: `A${i}` })))).toBe("Various artists");
  });
});

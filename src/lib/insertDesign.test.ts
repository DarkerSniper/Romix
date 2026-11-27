import { describe, expect, it } from "vitest";
import {
  AUTO,
  applyPreset,
  copyLookToAll,
  defaultDesign,
  defaultLook,
  designImages,
  inkFor,
  layoutRects,
  layoutsFor,
  localImageUrl,
  remapDesign,
  sanitizeDesign,
  songKey,
  tileShape,
  toHex,
  type InsertDesign,
} from "./insertDesign";

const img = (c: string) => `romix-cover://c/${c.repeat(32)}.jpg`;
const tracks = [
  { title: "A", artist: "x", cover: "", coverHi: img("1"), color: "hsl(210, 50%, 40%)", videoId: "aaaaaaaaaaa" },
  { title: "B", artist: "x", cover: "", coverHi: img("2"), color: "#f0c", filePath: "D:\\music\\b.flac" },
];
const keys = tracks.map(songKey);

function sample(): InsertDesign {
  return {
    ...defaultDesign(),
    images: [{ id: "mine", src: img("a"), w: 3000, h: 2000 }],
    sections: {
      back: { ...defaultLook("back", "pictures", tracks), layout: "cols2", tiles: [{ ref: { own: "mine" }, framed: img("b"), aspect: 0.55, crop: { zoom: 1.4, panX: 0.2, panY: 0, rotate: 90 } }, { ref: { song: keys[1] } }] },
    },
  };
}

describe("layouts", () => {
  it("tiles always fill their part exactly", () => {
    for (const l of ["one", "cols2", "rows2", "big3", "grid4", "grid6", "grid9", "stack"] as const) {
      const area = layoutRects(l, 5).reduce((n, r) => n + r.w * r.h, 0);
      expect(area).toBeCloseTo(1, 6);
    }
    expect(layoutRects("none")).toEqual([]);
    expect(layoutRects("strip", 6)).toHaveLength(6);
    expect(layoutRects("stack", 99)).toHaveLength(8); // capped
  });

  it("each part only offers layouts that fit it", () => {
    expect(layoutsFor("spine")).toEqual(["none", "one", "stack"]);
    expect(layoutsFor("label")).not.toContain("strip");
  });

  it("tile shapes follow the real piece sizes", () => {
    const look = { ...defaultLook("front", "pictures", tracks), layout: "rows2" as const };
    expect(tileShape("front", look, 0).aspect).toBeCloseTo(2, 2);
    const spine = { ...defaultLook("spine", "pictures", tracks), layout: "one" as const };
    expect(tileShape("spine", spine, 0).aspect).toBeLessThan(0.1);
  });
});

describe("colours", () => {
  it("reads every colour Romix stores", () => {
    expect(toHex("#ABCDEF")).toBe("#abcdef");
    expect(toHex("#f0c")).toBe("#ff00cc");
    expect(toHex("hsl(0, 100%, 50%)")).toBe("#ff0000");
    expect(toHex("red")).toBeUndefined();
  });

  it("automatic text colour reads on the background or the pictures", () => {
    const look = defaultLook("back", "pictures", tracks);
    expect(inkFor({ ...look, bg: "#ffffff" })).toBe("#111111");
    expect(inkFor({ ...look, bg: "#101010" })).toBe("#ffffff");
    expect(inkFor({ ...look, bg: "#ffffff", layout: "grid4", wash: 0.5 })).toBe("#ffffff");
    expect(inkFor({ ...look, layout: "grid4", wash: -0.6 })).toBe("#111111");
    expect(inkFor({ ...look, ink: "#123456" })).toBe("#123456");
  });

  it("presets colour every part and keep the pictures", () => {
    const d = applyPreset(sample(), "dark", tracks);
    for (const s of Object.values(d.sections)) expect(s!.bg).toBe("#111111");
    expect(d.sections.back!.tiles[0].ref).toEqual({ own: "mine" });
    const songs = applyPreset(defaultDesign(), "songs", tracks);
    expect(songs.sections.front!.bg).toBe(toHex(tracks[0].color));
    const cream = applyPreset(defaultDesign(), "cream", tracks);
    expect(cream.sections.back!.ink).toBe("#2b2620");
  });

  it("copies one part's colours to the rest", () => {
    const d = sample();
    d.sections.label = { ...defaultLook("label", "pictures", tracks), bg: "#334455", ink: "#eeeeee", accent: "#ff9f0a" };
    const out = copyLookToAll(d, "label", tracks);
    expect(out.sections.spine).toMatchObject({ bg: "#334455", ink: "#eeeeee", accent: "#ff9f0a" });
    expect(out.sections.back!.layout).toBe("cols2"); // pictures untouched
  });
});

describe("saved designs are checked before use", () => {
  it("a saved design comes back exactly", () => {
    const d = sample();
    expect(sanitizeDesign(JSON.parse(JSON.stringify(d)), localImageUrl, keys)).toEqual({ ...d, ringCentre: undefined, title: undefined, subtitle: undefined, spine: undefined, dedication: undefined, volume: undefined });
  });

  it("drops anything unknown, out of range or pointing elsewhere", () => {
    const bad = {
      front: "<script>",
      font: "Comic Sans",
      volume: 1e9,
      title: "x".repeat(5000),
      images: [{ id: "ok", src: img("c") }, { id: "web", src: "https://evil.example/x.jpg" }, { id: "file", src: "file:///C:/Windows/win.ini" }],
      sections: {
        back: { bg: "url(javascript:1)", layout: "nonsense", gap: 99, wash: -7, ink: "expression(1)", tiles: [{ ref: { own: "web" } }, { ref: { song: "yt:someoneelse" } }, { ref: { own: "ok" }, framed: "https://evil.example/f.jpg", aspect: 1 }] },
        spine: { layout: "grid9" },
        hacker: { bg: "#000000" },
      },
    };
    const d = sanitizeDesign(bad, localImageUrl, keys)!;
    expect(d.front).toBe("pictures");
    expect(d.font).toBe("sans");
    expect(d.volume).toBe(999);
    expect(d.title!.length).toBe(300);
    expect(d.images.map((i) => i.id)).toEqual(["ok"]);
    const back = d.sections.back!;
    expect(back).toMatchObject({ bg: "#ffffff", layout: "none", gap: 4, wash: -1, ink: AUTO });
    expect(back.tiles).toEqual([{}, {}, { ref: { own: "ok" } }]);
    expect(d.sections.spine!.layout).toBe("none"); // grid9 doesn't fit a spine
    expect("hacker" in d.sections).toBe(false);
    expect(sanitizeDesign("nope", localImageUrl, keys)).toBeUndefined();
  });

  it("only Romix's own picture files (or inline pictures in the preview)", () => {
    expect(localImageUrl(img("d"))).toBe(img("d"));
    expect(localImageUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(localImageUrl("data:text/html;base64,AAAA")).toBeUndefined();
    expect(localImageUrl("romix-cover://c/../../secret.jpg")).toBeUndefined();
  });
});

describe("moving designs between computers", () => {
  it("lists and swaps every picture, and renumbers songs", () => {
    const d = sample();
    expect(designImages(d).sort()).toEqual([img("a"), img("b")].sort());
    const out = remapDesign(d, (u) => `blob:${u === img("a") ? 0 : 1}`, (k) => (k === keys[1] ? "n:0" : undefined));
    expect(out.images[0].src).toBe("blob:0");
    expect(out.sections.back!.tiles[0]).toMatchObject({ ref: { own: "mine" }, framed: "blob:1" });
    expect(out.sections.back!.tiles[1].ref).toEqual({ song: "n:0" });
  });

  it("removing a picture also clears the tiles that used it", () => {
    const out = remapDesign(sample(), (u) => (u === img("a") ? undefined : u));
    expect(out.images).toEqual([]);
    expect(out.sections.back!.tiles[0]).toEqual({});
  });

  it("a song left out of a share leaves its tile on automatic", () => {
    const out = remapDesign(sample(), (u) => u, () => undefined);
    expect(out.sections.back!.tiles[1]).toEqual({});
  });
});

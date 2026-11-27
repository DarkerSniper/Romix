/**
 * The saved look of a disc's printed inserts: which pictures go where, colours,
 * type and text. Stored with the disc (current disc, saved projects, Shelf
 * entries and shared .romix files) and turned into print pages by inserts.ts.
 *
 * Every piece of the insert is a "section" with its own background colour,
 * picture layout (fixed layouts, so art always fits the bleed, spines and hole),
 * wash, text colour and accent.
 */

export type SectionId = "front" | "back" | "spine" | "label" | "bookletBack" | "insideLeft" | "insideRight";
export type FrontMode = "pictures" | "ring" | "wave" | "type";
export type LayoutId = "none" | "one" | "cols2" | "rows2" | "big3" | "grid4" | "grid6" | "grid9" | "strip" | "stack";
export type FontId = "sans" | "serif" | "mono" | "condensed";
export type TitlePos = "bottom" | "top" | "center" | "hidden";
export type BandStyle = "dark" | "light" | "none";
export type TitleSize = "s" | "m" | "l";
export type PresetId = "classic" | "dark" | "cream" | "songs";

/** How an image is framed: zoom ≥ 1 over "fill the shape", pan −1…1 of the spare room, rotation in quarter turns. */
export interface CoverCrop {
  zoom: number;
  panX: number;
  panY: number;
  rotate: 0 | 90 | 180 | 270;
}
export const DEFAULT_CROP: CoverCrop = { zoom: 1, panX: 0, panY: 0, rotate: 0 };

/** A picture: one of your own images (by id) or a song's cover (by its song key, so it follows the song when you reorder). */
export type ImageRef = { own: string } | { song: string };

/** A song's identity on the disc: its YouTube id or its file. */
export const songKey = (t: { videoId?: string; filePath?: string; title?: string }) => (t.videoId ? `yt:${t.videoId}` : t.filePath ? `file:${t.filePath}` : `t:${t.title ?? ""}`);

export interface Tile {
  /** Empty = automatic: the songs' covers in order. */
  ref?: ImageRef;
  /** A copy framed for this tile's shape (made in the framing editor). */
  framed?: string;
  crop?: CoverCrop;
  /** Width ÷ height the framed copy was made for; it's only used while the tile still has that shape. */
  aspect?: number;
}

export interface OwnImage {
  id: string;
  /** The original image (romix-cover:// URL in the app). */
  src: string;
  /** Pixel size, for print-resolution hints. */
  w: number;
  h: number;
}

export interface SectionLook {
  bg: string;
  layout: LayoutId;
  /** Tiles in a strip or stack (2–8). */
  count: number;
  tiles: Tile[];
  /** Space between pictures in mm, and its colour. */
  gap: number;
  gapColor: string;
  /** −1 (lighten) … 0 … 1 (darken) over the pictures, so text stays readable. */
  wash: number;
  ink: string;
  accent: string;
}

export interface InsertDesign {
  v: 1;
  front: FrontMode;
  format: "single" | "booklet";
  labelKind: "sheet" | "printable";
  /** Text overrides; empty = the disc's own. */
  title?: string;
  subtitle?: string;
  spine?: string;
  dedication?: string;
  /** Volume number: undefined = automatic (its place on the Shelf), null = none. */
  volume?: number | null;
  colorStrip: boolean;
  qr: boolean;
  labelRing: boolean;
  ruler: boolean;
  font: FontId;
  titlePos: TitlePos;
  band: BandStyle;
  titleSize: TitleSize;
  images: OwnImage[];
  sections: Partial<Record<SectionId, SectionLook>>;
  /** The round centre of the Ring design. */
  ringCentre?: Tile;
}

export const AUTO = "auto";

export const SECTION_LABEL: Record<SectionId, string> = {
  front: "Front cover",
  back: "Back card",
  spine: "Spines",
  label: "Disc label",
  bookletBack: "Booklet back",
  insideLeft: "Inside left",
  insideRight: "Inside right",
};

export const sectionsFor = (format: InsertDesign["format"]): SectionId[] =>
  format === "booklet" ? ["front", "bookletBack", "insideLeft", "insideRight", "back", "spine", "label"] : ["front", "back", "spine", "label"];

export const LAYOUT_LABEL: Record<LayoutId, string> = {
  none: "No pictures",
  one: "One picture",
  cols2: "Two, side by side",
  rows2: "Two, stacked",
  big3: "One large, two small",
  grid4: "Grid of 4",
  grid6: "Grid of 6",
  grid9: "Grid of 9",
  strip: "Strip along the top",
  stack: "Column of pictures",
};

export function layoutsFor(id: SectionId): LayoutId[] {
  if (id === "spine") return ["none", "one", "stack"];
  if (id === "label") return ["none", "one", "cols2", "rows2", "big3", "grid4", "grid6", "grid9"];
  return ["none", "one", "cols2", "rows2", "big3", "grid4", "grid6", "grid9", "strip"];
}

export const FONT_STACK: Record<FontId, string> = {
  sans: `"SF Pro Text", -apple-system, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`,
  serif: `Georgia, "Times New Roman", serif`,
  mono: `Consolas, "Cascadia Mono", "Courier New", monospace`,
  condensed: `"Bahnschrift Condensed", Bahnschrift, "Arial Narrow", sans-serif`,
};
export const FONT_LABEL: Record<FontId, string> = { sans: "Sans", serif: "Serif", mono: "Mono", condensed: "Condensed" };

/* ---------- geometry ---------- */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Strip height as a share of the section. */
export const STRIP_SHARE = 0.28;

const grid = (cols: number, rows: number): Rect[] =>
  Array.from({ length: cols * rows }, (_, i) => ({ x: (i % cols) / cols, y: Math.floor(i / cols) / rows, w: 1 / cols, h: 1 / rows }));

/** Tile positions as shares (0–1) of the section's printed area. */
export function layoutRects(layout: LayoutId, count = 4): Rect[] {
  const n = Math.max(2, Math.min(8, Math.round(count)));
  switch (layout) {
    case "none":
      return [];
    case "one":
      return grid(1, 1);
    case "cols2":
      return grid(2, 1);
    case "rows2":
      return grid(1, 2);
    case "big3":
      return [{ x: 0, y: 0, w: 2 / 3, h: 1 }, { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 }, { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 }];
    case "grid4":
      return grid(2, 2);
    case "grid6":
      return grid(3, 2);
    case "grid9":
      return grid(3, 3);
    case "strip":
      return Array.from({ length: n }, (_, i) => ({ x: i / n, y: 0, w: 1 / n, h: STRIP_SHARE }));
    case "stack":
      return Array.from({ length: n }, (_, i) => ({ x: 0, y: i / n, w: 1, h: 1 / n }));
  }
}

/** The printed area of each section in mm, including the bleed on its outer edges. */
export function sectionBox(id: SectionId): { w: number; h: number } {
  switch (id) {
    case "front":
      return { w: 126, h: 126 };
    case "back":
      return { w: 138, h: 124 };
    case "spine":
      return { w: 9.5, h: 124 };
    case "label":
      return { w: 118, h: 118 };
    default:
      return { w: 123, h: 126 };
  }
}

/** Shape (width ÷ height) and printed width (mm) of one tile. */
export function tileShape(id: SectionId, look: SectionLook, i: number): { aspect: number; widthMm: number } {
  const box = sectionBox(id);
  const r = layoutRects(look.layout, look.count)[i] ?? { x: 0, y: 0, w: 1, h: 1 };
  const w = Math.max(1, r.w * box.w - look.gap), h = Math.max(1, r.h * box.h - look.gap);
  return { aspect: w / h, widthMm: w };
}

/* ---------- colours ---------- */

/** Any colour Romix stores (#rgb, #rrggbb, hsl()) as #rrggbb, or undefined. */
export function toHex(c?: string): string | undefined {
  if (!c) return undefined;
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return `#${m[1].toLowerCase()}`;
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase();
  const h = /^hsl\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*\)$/i.exec(c);
  if (!h) return undefined;
  const hue = Number(h[1]) % 360, s = Number(h[2]) / 100, l = Number(h[3]) / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

/** Black or white, whichever reads better on this background. */
export const readableOn = (bg?: string) => (luminance(toHex(bg) ?? "#1c1c1e") > 0.6 ? "#111111" : "#ffffff");

const isHex = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/** The text colour a section actually uses. */
export function inkFor(look: SectionLook): string {
  if (look.ink !== AUTO && isHex(look.ink)) return look.ink;
  if (look.layout !== "none" && look.layout !== "strip") return look.wash < 0 ? "#111111" : "#ffffff";
  return readableOn(look.bg);
}
export const accentFor = (look: SectionLook) => (look.accent !== AUTO && isHex(look.accent) ? look.accent : inkFor(look));

/** The overlay colour for a wash value. */
export function washColor(wash: number): string | null {
  if (Math.abs(wash) < 0.01) return null;
  return wash > 0 ? `rgba(0,0,0,${(wash * 0.8).toFixed(3)})` : `rgba(255,255,255,${(-wash * 0.85).toFixed(3)})`;
}

/* ---------- defaults ---------- */

export function defaultDesign(): InsertDesign {
  return {
    v: 1,
    front: "pictures",
    format: "single",
    labelKind: "sheet",
    colorStrip: true,
    qr: true,
    labelRing: false,
    ruler: true,
    font: "sans",
    titlePos: "bottom",
    band: "dark",
    titleSize: "m",
    images: [],
    sections: {},
  };
}

const look = (bg: string, layout: LayoutId = "none", extra: Partial<SectionLook> = {}): SectionLook => ({
  bg,
  layout,
  count: 4,
  tiles: [],
  gap: 0,
  gapColor: "#000000",
  wash: 0,
  ink: AUTO,
  accent: AUTO,
  ...extra,
});

/** What a section looks like before you change it (today's classic insert). */
export function defaultLook(id: SectionId, mode: FrontMode, tracks: Array<{ color?: string }>): SectionLook {
  const first = toHex(tracks[0]?.color) ?? "#1c1c1e";
  switch (id) {
    case "front":
      if (mode === "pictures") return look("#111111", tracks.length >= 4 ? "grid4" : "one");
      if (mode === "ring") return look("#111111");
      return look(first);
    case "label":
      return look("#ffffff", "one");
    default:
      return look("#ffffff");
  }
}

export const lookOf = (d: InsertDesign, id: SectionId, tracks: Array<{ color?: string }>) => d.sections[id] ?? defaultLook(id, d.front, tracks);

/** Sections whose text sits straight on the pictures (so a wash helps). */
export const textOnPictures = (id: SectionId, mode: FrontMode) => !(id === "label" || (id === "front" && (mode === "pictures" || mode === "ring")));

export const PRESET_LABEL: Record<PresetId, string> = { classic: "Classic", dark: "Dark", cream: "Cream paper", songs: "Song colours" };

/** Applies a colour scheme to every section, keeping the pictures. */
export function applyPreset(d: InsertDesign, preset: PresetId, tracks: Array<{ color?: string }>): InsertDesign {
  const colours = tracks.map((t) => toHex(t.color)).filter((c): c is string => Boolean(c));
  const song = (i: number) => colours.length ? colours[i % colours.length] : "#1c1c1e";
  const sections: InsertDesign["sections"] = {};
  sectionsFor("booklet").forEach((id, i) => {
    const cur = lookOf(d, id, tracks);
    const scheme: Pick<SectionLook, "bg" | "ink" | "accent"> =
      preset === "dark"
        ? { bg: "#111111", ink: AUTO, accent: AUTO }
        : preset === "cream"
          ? { bg: "#f3ede1", ink: "#2b2620", accent: "#9a5b2e" }
          : preset === "songs"
            ? { bg: song(i), ink: AUTO, accent: AUTO }
            : { ...defaultLook(id, d.front, tracks), ink: AUTO, accent: AUTO };
    // Text on pictures keeps choosing its own colour.
    if (cur.layout !== "none" && cur.layout !== "strip") scheme.ink = AUTO;
    sections[id] = { ...cur, ...scheme };
  });
  return { ...d, sections };
}

/** Copies one section's colours (not its pictures) to every other section. */
export function copyLookToAll(d: InsertDesign, from: SectionId, tracks: Array<{ color?: string }>): InsertDesign {
  const src = lookOf(d, from, tracks);
  const sections: InsertDesign["sections"] = { ...d.sections };
  for (const id of sectionsFor("booklet")) {
    if (id === from) continue;
    const cur = lookOf(d, id, tracks);
    sections[id] = { ...cur, bg: src.bg, ink: src.ink, accent: src.accent, wash: cur.layout === "none" ? cur.wash : src.wash, gapColor: src.gapColor };
  }
  return { ...d, sections };
}

/* ---------- pictures ---------- */

export interface PictureTrack {
  cover: string;
  coverHi?: string;
  videoId?: string;
  filePath?: string;
  title?: string;
}
const art = (t?: PictureTrack) => t?.coverHi || t?.cover || "";

/** The original picture a reference points at (before framing). */
export function refSource(ref: ImageRef | undefined, d: InsertDesign, tracks: PictureTrack[], autoIndex: number): string {
  if (ref && "own" in ref) return d.images.find((x) => x.id === ref.own)?.src ?? "";
  if (ref && "song" in ref) return art(tracks.find((t) => songKey(t) === ref.song));
  return tracks.length ? art(tracks[autoIndex % tracks.length]) : "";
}

/** What a tile prints: its framed copy while the tile still has that shape, else the picture filling the tile. */
export function tileSource(tile: Tile | undefined, d: InsertDesign, tracks: PictureTrack[], autoIndex: number, aspect: number): { src: string; framed: boolean } {
  if (tile?.framed && tile.aspect && Math.abs(tile.aspect / aspect - 1) < 0.03) return { src: tile.framed, framed: true };
  return { src: refSource(tile?.ref, d, tracks, autoIndex), framed: false };
}

/* ---------- reading saved designs safely ---------- */

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const clampNum = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined);
const colour = (v: unknown, fallback: string) => (isHex(v) ? v.toLowerCase() : fallback);
const inkValue = (v: unknown) => (v === AUTO ? AUTO : isHex(v) ? v.toLowerCase() : AUTO);

export const DESIGN_LIMITS = { images: 60, tiles: 9, text: 300, dedication: 160 } as const;
const LAYOUTS: LayoutId[] = ["none", "one", "cols2", "rows2", "big3", "grid4", "grid6", "grid9", "strip", "stack"];
const SECTIONS: SectionId[] = ["front", "back", "spine", "label", "bookletBack", "insideLeft", "insideRight"];

/**
 * Checks a stored or shared design field by field. `image` vets every picture
 * reference (returning the URL to use, or undefined to drop it); `songs` are the
 * disc's song keys. Anything unknown or out of range is dropped.
 */
export function sanitizeDesign(raw: unknown, image: (url: unknown) => string | undefined, songs: string[]): InsertDesign | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const d = defaultDesign();

  const images: OwnImage[] = [];
  for (const x of Array.isArray(r.images) ? r.images.slice(0, DESIGN_LIMITS.images) : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" && /^[\w-]{1,40}$/.test(o.id) ? o.id : undefined;
    const src = image(o.src);
    if (id && src && !images.some((i) => i.id === id)) images.push({ id, src, w: clampNum(o.w, 1, 30000, 1000), h: clampNum(o.h, 1, 30000, 1000) });
  }
  const ref = (v: unknown): ImageRef | undefined => {
    const o = (v ?? {}) as Record<string, unknown>;
    if (typeof o.own === "string" && images.some((i) => i.id === o.own)) return { own: o.own };
    if (typeof o.song === "string" && songs.includes(o.song)) return { song: o.song };
    return undefined;
  };
  const crop = (v: unknown): CoverCrop | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const c = v as Record<string, unknown>;
    return { zoom: clampNum(c.zoom, 1, 4, 1), panX: clampNum(c.panX, -1, 1, 0), panY: clampNum(c.panY, -1, 1, 0), rotate: ([0, 90, 180, 270] as const).find((x) => x === c.rotate) ?? 0 };
  };
  const tile = (v: unknown): Tile => {
    const o = (v ?? {}) as Record<string, unknown>;
    const t: Tile = {};
    const rf = ref(o.ref);
    if (rf) t.ref = rf;
    const framed = o.framed !== undefined ? image(o.framed) : undefined;
    const aspect = clampNum(o.aspect, 0.01, 100, NaN);
    if (framed && Number.isFinite(aspect)) {
      t.framed = framed;
      t.aspect = aspect;
      t.crop = crop(o.crop);
    }
    return t;
  };

  const sections: InsertDesign["sections"] = {};
  const rs = (r.sections ?? {}) as Record<string, unknown>;
  for (const id of SECTIONS) {
    const s = rs[id] as Record<string, unknown> | undefined;
    if (!s || typeof s !== "object") continue;
    const layout = pick(s.layout, layoutsFor(id), "none");
    sections[id] = {
      bg: colour(s.bg, "#ffffff"),
      layout: LAYOUTS.includes(layout) ? layout : "none",
      count: Math.round(clampNum(s.count, 2, 8, 4)),
      tiles: (Array.isArray(s.tiles) ? s.tiles.slice(0, DESIGN_LIMITS.tiles) : []).map(tile),
      gap: clampNum(s.gap, 0, 4, 0),
      gapColor: colour(s.gapColor, "#000000"),
      wash: clampNum(s.wash, -1, 1, 0),
      ink: inkValue(s.ink),
      accent: inkValue(s.accent),
    };
  }

  const vol = r.volume === null ? null : r.volume === undefined ? undefined : Math.round(clampNum(r.volume, 1, 999, 1));
  return {
    v: 1,
    front: pick(r.front, ["pictures", "ring", "wave", "type"] as const, d.front),
    format: pick(r.format, ["single", "booklet"] as const, d.format),
    labelKind: pick(r.labelKind, ["sheet", "printable"] as const, d.labelKind),
    title: text(r.title, DESIGN_LIMITS.text),
    subtitle: text(r.subtitle, DESIGN_LIMITS.text),
    spine: text(r.spine, DESIGN_LIMITS.text),
    dedication: text(r.dedication, DESIGN_LIMITS.dedication),
    volume: vol,
    colorStrip: typeof r.colorStrip === "boolean" ? r.colorStrip : d.colorStrip,
    qr: typeof r.qr === "boolean" ? r.qr : d.qr,
    labelRing: typeof r.labelRing === "boolean" ? r.labelRing : d.labelRing,
    ruler: typeof r.ruler === "boolean" ? r.ruler : d.ruler,
    font: pick(r.font, ["sans", "serif", "mono", "condensed"] as const, d.font),
    titlePos: pick(r.titlePos, ["bottom", "top", "center", "hidden"] as const, d.titlePos),
    band: pick(r.band, ["dark", "light", "none"] as const, d.band),
    titleSize: pick(r.titleSize, ["s", "m", "l"] as const, d.titleSize),
    images,
    sections,
    ringCentre: r.ringCentre ? tile(r.ringCentre) : undefined,
  };
}

/** Every image URL a design uses (your originals and framed copies). */
export function designImages(d: InsertDesign): string[] {
  const out = new Set<string>();
  for (const i of d.images) out.add(i.src);
  for (const s of Object.values(d.sections)) for (const t of s?.tiles ?? []) if (t.framed) out.add(t.framed);
  if (d.ringCentre?.framed) out.add(d.ringCentre.framed);
  return [...out];
}

/** A copy with every image URL passed through `f`, and song keys through `song` (undefined = that song is gone). */
export function remapDesign(d: InsertDesign, f: (url: string) => string | undefined, song: (key: string) => string | undefined = (k) => k): InsertDesign {
  const images = d.images.flatMap((i) => {
    const src = f(i.src);
    return src ? [{ ...i, src }] : [];
  });
  const ref = (r?: ImageRef): ImageRef | undefined => {
    if (!r) return undefined;
    if ("own" in r) return images.some((i) => i.id === r.own) ? r : undefined;
    const n = song(r.song);
    return n === undefined ? undefined : { song: n };
  };
  const tile = (t: Tile): Tile => {
    const rf = ref(t.ref);
    const framed = t.framed ? f(t.framed) : undefined;
    // A framed copy belongs to its picture: if the picture is gone, so is the framing.
    const keepFrame = framed && (rf || !t.ref);
    return { ...(rf ? { ref: rf } : {}), ...(keepFrame ? { framed, aspect: t.aspect, crop: t.crop } : {}) };
  };
  const sections: InsertDesign["sections"] = {};
  for (const [id, s] of Object.entries(d.sections) as Array<[SectionId, SectionLook]>) sections[id] = { ...s, tiles: s.tiles.map(tile) };
  return { ...d, images, sections, ringCentre: d.ringCentre ? tile(d.ringCentre) : undefined };
}

/** Image URLs Romix itself stores: its cover files, or (browser preview) inline pictures. */
export function localImageUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  if (/^romix-cover:\/\/c\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(v)) return v;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 12_000_000) return v;
  return undefined;
}

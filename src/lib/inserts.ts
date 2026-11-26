import qrcode from "qrcode-generator";
import { formatDiscTime, formatTime } from "./cd";

/**
 * Printable jewel-case inserts at real sizes, as one self-contained HTML page.
 *   Front cover 120 × 120 mm (or a 240 × 120 mm fold-out booklet)
 *   Back tray card 151 × 118 mm with two 6.5 mm spines
 *   Disc label Ø 118 mm: 41 mm hole (label sheets) or 22 mm hub (printable discs)
 * Artwork extends 3 mm past the cut lines (bleed); crop marks sit outside the bleed.
 */
export const SIZES = {
  front: { w: 120, h: 120 },
  booklet: { w: 240, h: 120 },
  back: { w: 151, h: 118, spine: 6.5 },
  label: { d: 118, hole: { sheet: 41, printable: 22 } },
  bleed: 3,
  safe: 5,
} as const;

export const PAPER = {
  A4: { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 },
} as const;

export type Paper = keyof typeof PAPER;
export type FrontStyle = "collage" | "cover" | "ring" | "wave" | "type";

export interface InsertTrack {
  title: string;
  artist: string;
  durationSec: number;
  cover: string;
  /** Print-resolution cover, preferred when present. */
  coverHi?: string;
  color?: string;
  videoId?: string;
}

export interface InsertInput {
  title: string;
  /** Line under the title; defaults to the main artist. */
  subtitle?: string;
  /** Spine text; defaults to "title · subtitle". */
  spineText?: string;
  dedication?: string;
  volume?: number | null;
  tracks: InsertTrack[];
  front: FrontStyle;
  /**
   * Your own image. Every front style uses it: one cover = full bleed, collage =
   * first tile, ring = centre label, waveform/type = background.
   */
  customCover?: string;
  /** Also fill the disc label with your image (default: yes when you have one). */
  customOnLabel?: boolean;
  format: "single" | "booklet";
  labelKind: "sheet" | "printable";
  colorStrip: boolean;
  qr: boolean;
  labelRing: boolean;
  ruler: boolean;
  paper: Paper;
  dateLabel?: string;
  /** Whole-disc loudness envelope (0–1) for the waveform style. */
  waveform?: number[];
}

/* ---------- helpers ---------- */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const attr = (s: string) => esc(s);
const art = (t?: InsertTrack) => t?.coverHi || t?.cover || "";

/** Most common artist, or "Various artists". */
export function mainArtist(tracks: { artist: string }[]): string {
  const counts = new Map<string, number>();
  for (const t of tracks) counts.set(t.artist, (counts.get(t.artist) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top && top[1] / Math.max(1, tracks.length) >= 0.6 ? top[0] : "Various artists";
}

/** Readable text colour on a background colour. */
export function inkOn(bg?: string): string {
  const m = bg?.match(/^#([0-9a-f]{6})$/i);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111" : "#fff";
}

export const volumeLabel = (v?: number | null) => (v && v > 0 ? `Vol. ${String(v).padStart(2, "0")}` : "");

/** A YouTube link that plays the disc's YouTube songs in order (up to 50). */
export function listenUrl(tracks: InsertTrack[]): string | null {
  const ids = tracks.map((t) => t.videoId).filter((v): v is string => Boolean(v && /^[\w-]{11}$/.test(v)));
  return ids.length ? `https://www.youtube.com/watch_videos?video_ids=${ids.slice(0, 50).join(",")}` : null;
}

/** QR code as an SVG at the given size (mm), black modules on white with a quiet zone. */
export function qrSvg(text: string, sizeMm: number): string {
  const q = qrcode(0, "L");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const quiet = 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const box = n + quiet * 2;
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges"><rect width="${box}" height="${box}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** Corner crop marks for a w×h piece at (x, y), outside the 3 mm bleed. */
function cropMarks(x: number, y: number, w: number, h: number): string {
  const len = 5, gap = SIZES.bleed + 1;
  const out: string[] = [];
  for (const [cx, sx] of [[x, -1], [x + w, 1]] as const)
    for (const [cy, sy] of [[y, -1], [y + h, 1]] as const) {
      out.push(`<div class="crop h" style="left:${sx < 0 ? cx - gap - len : cx + gap}mm;top:${cy}mm;width:${len}mm"></div>`);
      out.push(`<div class="crop v" style="left:${cx}mm;top:${sy < 0 ? cy - gap - len : cy + gap}mm;height:${len}mm"></div>`);
    }
  return out.join("");
}

/** Fold mark at x between y-top and y-bottom pieces (short dashed ticks outside the piece). */
const foldMarks = (x: number, y: number, h: number) =>
  `<div class="fold" style="left:${x}mm;top:${y - SIZES.bleed - 7}mm"></div><div class="fold" style="left:${x}mm;top:${y + h + SIZES.bleed + 2}mm"></div>`;

/** Flat colour blocks, one per song, sized by length. */
function strip(tracks: InsertTrack[], vertical: boolean): string {
  const total = tracks.reduce((n, t) => n + t.durationSec, 0) || 1;
  const blocks = tracks.map((t) => `<i style="flex:${t.durationSec / total};background:${attr(t.color || "#888")}"></i>`).join("");
  return `<div class="strip ${vertical ? "v" : "h"}">${blocks}</div>`;
}

/* ---------- front designs (120 × 120 trim; art fills the bleed) ---------- */

const R = 56, RI = 17, C = 60;
const pt = (r: number, a: number) => `${(C + r * Math.sin(a)).toFixed(3)} ${(C - r * Math.cos(a)).toFixed(3)}`;
function sector(a0: number, a1: number, ro: number, ri: number): string {
  const span = Math.min(a1 - a0, Math.PI * 2 - 1e-4);
  const large = span > Math.PI ? 1 : 0;
  return `M${pt(ro, a0)} A${ro} ${ro} 0 ${large} 1 ${pt(ro, a0 + span)} L${pt(ri, a0 + span)} A${ri} ${ri} 0 ${large} 0 ${pt(ri, a0)}Z`;
}

/** Romix's disc visual: each song a slice of its cover, sized by length. Your image becomes the centre label. */
function ringArt(tracks: InsertTrack[], centre?: string): string {
  const total = tracks.reduce((n, t) => n + t.durationSec, 0) || 1;
  const pad = tracks.length > 1 ? 0.012 : 0;
  const ri = centre ? 25 : RI; // a bigger hub, like a record's label, when it carries your image
  let acc = 0;
  const defs: string[] = [];
  const slices: string[] = [];
  tracks.forEach((t, i) => {
    const a0 = (acc / total) * Math.PI * 2 + pad / 2;
    acc += t.durationSec;
    const a1 = (acc / total) * Math.PI * 2 - pad / 2;
    const mid = (a0 + a1) / 2, span = a1 - a0;
    const size = Math.min(R * 2.4, R * (0.95 + span / Math.PI));
    const [cx, cy] = pt((R + ri) / 2, mid).split(" ").map(Number);
    defs.push(`<clipPath id="s${i}"><path d="${sector(a0, a1, R, ri)}"/></clipPath>`);
    slices.push(
      `<g clip-path="url(#s${i})"><rect width="120" height="120" fill="${attr(t.color || "#444")}"/>${art(t) ? `<image href="${attr(art(t))}" x="${(cx - size / 2).toFixed(2)}" y="${(cy - size / 2).toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" preserveAspectRatio="xMidYMid slice"/>` : ""}</g>`,
    );
  });
  const hub = centre
    ? `<clipPath id="hub"><circle cx="60" cy="60" r="${ri - 0.8}"/></clipPath><circle cx="60" cy="60" r="${ri - 0.2}" fill="#111"/><image clip-path="url(#hub)" href="${attr(centre)}" x="${60 - ri}" y="${60 - ri}" width="${ri * 2}" height="${ri * 2}" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="60" cy="60" r="${ri - 0.6}" fill="#111"/>`;
  return `<svg class="ring" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid meet"><defs>${defs.join("")}</defs><circle cx="60" cy="60" r="${R + 1.2}" fill="#2a2a2c"/>${slices.join("")}${hub}<circle cx="60" cy="60" r="4.5" fill="#000" stroke="#333" stroke-width="0.3"/></svg>`;
}

function waveArt(levels: number[], ink: string): string {
  const n = levels.length;
  const w = 110 / n;
  const bars = levels.map((v, i) => {
    const h = Math.max(0.4, Math.min(1, v) * 34);
    return `<rect x="${(5 + i * w).toFixed(3)}" y="${(60 - h / 2).toFixed(3)}" width="${(w * 0.62).toFixed(3)}" height="${h.toFixed(3)}" rx="${(w * 0.3).toFixed(3)}"/>`;
  });
  return `<svg class="wave" viewBox="0 0 120 120" fill="${ink}">${bars.join("")}</svg>`;
}

function frontArt(input: InsertInput): string {
  const title = esc(input.title);
  const sub = esc(input.subtitle?.trim() || mainArtist(input.tracks));
  const vol = esc(volumeLabel(input.volume));
  const band = `<div class="band"><div class="band-title">${title}</div><div class="band-sub">${sub}${vol ? ` · ${vol}` : ""}</div></div>`;
  const own = input.customCover;
  const covers = [...(own ? [own] : []), ...input.tracks.map(art).filter(Boolean)];
  const first = input.tracks[0];
  // Your image as a background, with a dark wash so text and the waveform stay readable.
  const ownBackground = own ? `<div class="bleed"><img src="${attr(own)}" alt=""></div><div class="bleed scrim"></div>` : "";

  if (input.front === "type" || (input.front === "wave" && !input.waveform?.length)) {
    const bg = first?.color ?? "#1c1c1e";
    const ink = own ? "#fff" : inkOn(bg);
    return `${own ? ownBackground : `<div class="bleed" style="background:${attr(bg)}"></div>`}<div class="type" style="color:${ink}">${vol ? `<div class="type-vol">${vol}</div>` : ""}<div class="type-title">${title}</div><div class="type-sub">${sub}</div></div>`;
  }
  if (input.front === "wave") {
    const bg = first?.color ?? "#1c1c1e";
    const ink = own ? "#fff" : inkOn(bg);
    return `${own ? ownBackground : `<div class="bleed" style="background:${attr(bg)}"></div>`}${waveArt(input.waveform!, ink)}<div class="wave-text" style="color:${ink}"><div class="type-title small">${title}</div><div class="type-sub">${sub}</div></div>${vol ? `<div class="corner-vol" style="color:${ink}">${vol}</div>` : ""}`;
  }
  if (input.front === "ring") {
    return `<div class="bleed" style="background:#111"></div><div class="ring-wrap">${ringArt(input.tracks, own)}</div>${band}`;
  }
  if (input.front === "cover" || covers.length < 4) {
    const src = covers[0] || "";
    return `<div class="bleed">${src ? `<img src="${attr(src)}" alt="">` : ""}</div>${band}`;
  }
  return `<div class="bleed grid">${covers.slice(0, 4).map((c) => `<img src="${attr(c)}" alt="">`).join("")}</div>${band}`;
}

/* ---------- other pieces ---------- */

function trackRows(tracks: InsertTrack[]): string {
  return tracks
    .map((t, i) => `<li><span class="n">${i + 1}</span><span class="t">${esc(t.title)}<span class="a"> · ${esc(t.artist)}</span></span><span class="d">${formatTime(t.durationSec)}</span></li>`)
    .join("");
}

function backCard(input: InsertInput): string {
  const title = esc(input.title);
  const sub = esc(input.subtitle?.trim() || mainArtist(input.tracks));
  const total = input.tracks.reduce((n, t) => n + t.durationSec, 0);
  const vol = esc(volumeLabel(input.volume));
  const spine = esc(input.spineText?.trim() || `${input.title} · ${input.subtitle?.trim() || mainArtist(input.tracks)}`);
  const url = input.qr ? listenUrl(input.tracks) : null;
  const dedication = input.format === "single" && input.dedication?.trim() ? `<p class="dedication">${esc(input.dedication.trim())}</p>` : "";
  const spineHtml = (left: boolean) => `<div class="spine${left ? " left" : ""}"><span>${spine}${vol ? ` · ${vol}` : ""}</span></div>`;
  return `
    ${spineHtml(true)}
    <div class="back-main">
      ${input.colorStrip ? strip(input.tracks, false) : ""}
      <div class="back-title">${title}</div><div class="back-sub">${sub}</div>
      <ol>${trackRows(input.tracks)}</ol>
      ${dedication}
      <div class="back-foot">
        <span>${input.tracks.length} tracks · ${formatDiscTime(total)}${vol ? ` · ${vol}` : ""}${input.dateLabel ? ` · ${esc(input.dateLabel)}` : ""}</span>
        ${url ? `<span class="qr-box">${qrSvg(url, 15)}<span class="qr-cap">Scan to listen</span></span>` : ""}
      </div>
    </div>
    ${spineHtml(false)}`.replace(/\n\s*/g, "");
}

function labelPiece(input: InsertInput): string {
  const d = SIZES.label.d;
  const hole = SIZES.label.hole[input.labelKind];
  const src = (input.customCover && input.customOnLabel !== false ? input.customCover : "") || art(input.tracks[0]);
  const title = esc(input.title);
  const sub = esc(input.subtitle?.trim() || mainArtist(input.tracks));
  const total = input.tracks.reduce((n, t) => n + t.durationSec, 0);
  const vol = esc(volumeLabel(input.volume));
  let ring = "";
  if (input.labelRing && input.tracks.length) {
    const text = esc(input.tracks.map((t, i) => `${i + 1} ${t.title}`).join("  ·  "));
    const r = d / 2 - 4.2;
    const circumference = 2 * Math.PI * r;
    // Natural spacing, centred at the top; only long tracklists are shrunk and fitted to the whole ring.
    const natural = 2.4 * 0.55 * text.length;
    const fits = natural <= circumference * 0.92;
    const fs = fits ? 2.4 : Math.max(1.4, (circumference * 0.95) / (text.length * 0.55));
    const fit = fits ? "" : ` textLength="${(circumference * 0.97).toFixed(1)}" lengthAdjust="spacing"`;
    // Path starts at the bottom and runs clockwise, so 50 % along it is the top of the disc.
    ring = `<svg class="label-ring" viewBox="0 0 ${d} ${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${r + 0.6}" fill="none" stroke="rgba(0,0,0,.62)" stroke-width="${fs + 2}"/><path id="ringpath" d="M ${d / 2} ${d / 2 + r} a ${r} ${r} 0 1 1 0 -${2 * r} a ${r} ${r} 0 1 1 0 ${2 * r}" fill="none"/><text font-size="${fs.toFixed(2)}" fill="#fff" letter-spacing="0.1"><textPath href="#ringpath" startOffset="50%" text-anchor="middle"${fit}>${text}</textPath></text></svg>`;
  }
  return `
    ${src ? `<img src="${attr(src)}" alt="">` : ""}
    ${ring}
    <div class="lt"><b>${title}</b><span>${sub}</span></div>
    <div class="hole" style="width:${hole}mm;height:${hole}mm;margin:-${hole / 2}mm 0 0 -${hole / 2}mm"></div>
    <div class="lb">${input.tracks.length} tracks · ${formatDiscTime(total)}${vol ? ` · ${vol}` : ""}${input.dateLabel ? ` · ${esc(input.dateLabel)}` : ""}</div>`.replace(/\n\s*/g, "");
}

function bookletOutsideLeft(input: InsertInput): string {
  const total = input.tracks.reduce((n, t) => n + t.durationSec, 0);
  const url = input.qr ? listenUrl(input.tracks) : null;
  return `<div class="panel-inner">
    ${input.colorStrip ? strip(input.tracks, true) : ""}
    <div class="panel-center">
      <div class="back-title">${esc(input.title)}</div>
      <div class="back-sub">${input.tracks.length} tracks · ${formatDiscTime(total)}${volumeLabel(input.volume) ? ` · ${esc(volumeLabel(input.volume))}` : ""}</div>
      ${url ? `<div class="qr-big">${qrSvg(url, 26)}<span class="qr-cap">Scan to listen</span></div>` : ""}
    </div></div>`.replace(/\n\s*/g, "");
}

function bookletInside(input: InsertInput): { left: string; right: string } {
  const sub = esc(input.subtitle?.trim() || mainArtist(input.tracks));
  const left = input.dedication?.trim()
    ? `<div class="panel-inner center"><p class="dedication big">${esc(input.dedication.trim())}</p></div>`
    : `<div class="panel-inner center"><div class="type-title small dark">${esc(input.title)}</div><div class="back-sub">${sub}</div></div>`;
  const right = `<div class="panel-inner"><div class="back-title">Tracklist</div><ol class="roomy">${trackRows(input.tracks)}</ol></div>`;
  return { left, right };
}

function ruler(x: number, y: number): string {
  const ticks = Array.from({ length: 11 }, (_, i) => `<i style="left:${i * 10}mm;height:${i % 5 === 0 ? 3 : 1.8}mm"></i>`).join("");
  return `<div class="ruler" style="left:${x}mm;top:${y}mm">${ticks}<span>Size check: this line should measure exactly 10 cm. If it doesn't, print at 100 % ("actual size").</span></div>`;
}

/* ---------- pages ---------- */

export interface PageSize {
  w: number;
  h: number;
}

/** Page sizes in order (portrait, or landscape for the booklet spreads). */
export function insertPages(input: Pick<InsertInput, "format" | "paper">): PageSize[] {
  const p = PAPER[input.paper];
  const portrait = { w: p.w, h: p.h };
  const landscape = { w: p.h, h: p.w };
  return input.format === "booklet" ? [landscape, landscape, portrait] : [portrait, portrait];
}

export function buildInsertsHtml(input: InsertInput): string {
  const paper = PAPER[input.paper];
  const { front, booklet, back, label, bleed } = SIZES;
  const pages: string[] = [];
  const piece = (cls: string, x: number, y: number, w: number, h: number, body: string, style = "") =>
    `<div class="piece ${cls}" style="left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm;${style}">${body}</div>`;
  const caption = (x: number, y: number, text: string) => `<div class="caption" style="left:${x}mm;top:${y}mm">${text}</div>`;

  // Captions sit clear of the crop marks: page headings at the very top, or offset to the right of corner marks.
  const labelCaption = input.labelKind === "printable" ? "Disc label · for printable discs (print straight onto the disc)" : "Disc label · for round CD label sheets or cutting";
  if (input.format === "single") {
    const fx = (paper.w - front.w) / 2, fy = 15;
    const bx = (paper.w - back.w) / 2, by = fy + front.h + 15;
    pages.push(
      `<div class="page">${caption(fx, 3, "Front cover (top) and back tray card (bottom) · cut on the marks, fold the tray card along its spines")}` +
        `${piece("front", fx, fy, front.w, front.h, frontArt(input))}${cropMarks(fx, fy, front.w, front.h)}` +
        `${piece("back", bx, by, back.w, back.h, backCard(input))}${cropMarks(bx, by, back.w, back.h)}</div>`,
    );
    const lx = (paper.w - label.d) / 2, ly = 22;
    pages.push(
      `<div class="page">${caption(lx + 10, ly - 12, labelCaption)}${piece("label", lx, ly, label.d, label.d, labelPiece(input))}${cropMarks(lx, ly, label.d, label.d)}${input.ruler ? ruler((paper.w - 100) / 2, ly + label.d + 20) : ""}</div>`,
    );
  } else {
    const W = paper.h, H = paper.w; // landscape
    const sx = (W - booklet.w) / 2, sy = (H - booklet.h) / 2 - 8;
    const inside = bookletInside(input);
    pages.push(
      `<div class="page land">${caption(sx, sy - bleed - 8, "Booklet, outside · cut on the marks, fold in the middle (front cover on the right)")}` +
        piece("booklet", sx, sy, booklet.w, booklet.h, `<div class="panel left">${bookletOutsideLeft(input)}</div><div class="panel right front">${frontArt(input)}</div>`) +
        `${cropMarks(sx, sy, booklet.w, booklet.h)}${foldMarks(sx + booklet.w / 2, sy, booklet.h)}${input.ruler ? ruler((W - 100) / 2, sy + booklet.h + 16) : ""}</div>`,
    );
    pages.push(
      `<div class="page land">${caption(sx, sy - bleed - 8, "Booklet, inside · print this page on the back of the previous one (double-sided, flip on the short edge)")}` +
        piece("booklet inside", sx, sy, booklet.w, booklet.h, `<div class="panel left plain">${inside.left}</div><div class="panel right plain">${inside.right}</div>`) +
        `${cropMarks(sx, sy, booklet.w, booklet.h)}${foldMarks(sx + booklet.w / 2, sy, booklet.h)}</div>`,
    );
    const bx = (paper.w - back.w) / 2, by = 14;
    const lx = (paper.w - label.d) / 2, ly = by + back.h + 16;
    pages.push(
      `<div class="page">${caption(bx, by - bleed - 7, "Back tray card · fold along the spines")}${piece("back", bx, by, back.w, back.h, backCard(input))}${cropMarks(bx, by, back.w, back.h)}` +
        `${caption(lx + 10, ly - 10.5, labelCaption)}${piece("label", lx, ly, label.d, label.d, labelPiece(input))}${cropMarks(lx, ly, label.d, label.d)}</div>`,
    );
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(input.title)} inserts</title><style>
@page { size: ${paper.w}mm ${paper.h}mm; margin: 0 }
@page land { size: ${paper.h}mm ${paper.w}mm; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { background: #fff; color: #111; font-family: "SF Pro Text", -apple-system, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { position: relative; width: ${paper.w}mm; height: ${paper.h}mm; overflow: hidden; break-after: page; background: #fff }
.page.land { page: land; width: ${paper.h}mm; height: ${paper.w}mm }
.page:last-child { break-after: auto }
.piece { position: absolute; background: #fff }
.crop { position: absolute; background: #000 } .crop.h { height: 0.15mm } .crop.v { width: 0.15mm }
.fold { position: absolute; width: 0; height: 5mm; border-left: 0.2mm dashed #000 }
.caption { position: absolute; font-size: 2.4mm; color: #888; white-space: nowrap }
.bleed { position: absolute; inset: -${bleed}mm; overflow: hidden }
.bleed img { width: 100%; height: 100%; object-fit: cover; display: block }
.bleed.grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr }
.bleed.scrim { background: rgba(0,0,0,.45) }
.front, .panel.front { overflow: visible }
.band { position: absolute; left: -${bleed}mm; right: -${bleed}mm; bottom: -${bleed}mm; padding: 5mm ${SIZES.safe + bleed}mm ${5 + bleed}mm; background: rgba(0,0,0,.62); color: #fff }
.band-title { font-size: 6mm; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1 }
.band-sub { font-size: 3.4mm; opacity: .82; margin-top: 1mm }
.type { position: absolute; inset: 0; padding: 10mm; display: flex; flex-direction: column; justify-content: flex-end }
.type-title { font-size: 13mm; font-weight: 700; letter-spacing: -0.03em; line-height: 1 } .type-title.small { font-size: 8mm } .type-title.dark { color: #111 }
.type-sub { font-size: 4.2mm; margin-top: 2.5mm; opacity: .75 }
.type-vol, .corner-vol { font-size: 3.2mm; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; opacity: .8 }
.type-vol { margin-bottom: auto } .corner-vol { position: absolute; right: ${SIZES.safe + 2}mm; top: ${SIZES.safe + 2}mm }
.wave { position: absolute; inset: 0; width: 100%; height: 100% }
.wave-text { position: absolute; left: ${SIZES.safe + 3}mm; right: ${SIZES.safe + 3}mm; bottom: ${SIZES.safe + 3}mm }
.ring-wrap { position: absolute; inset: 0 } .ring { width: 100%; height: 100% }
.back { display: grid; grid-template-columns: ${back.spine}mm 1fr ${back.spine}mm; overflow: hidden }
.spine { display: flex; align-items: center; justify-content: center; border-left: 0.1mm solid #ddd; border-right: 0.1mm solid #ddd }
.spine span { writing-mode: vertical-rl; font-size: 2.8mm; font-weight: 600; white-space: nowrap; overflow: hidden; max-height: 112mm }
.spine.left span { transform: rotate(180deg) }
.back-main { position: relative; padding: 7mm 8mm 6mm; display: flex; flex-direction: column; min-width: 0 }
.strip { display: flex; overflow: hidden } .strip i { display: block }
.strip.h { position: absolute; left: 0; right: 0; top: 0; height: 2.6mm; flex-direction: row }
.strip.v { position: absolute; left: -${bleed}mm; top: -${bleed}mm; bottom: -${bleed}mm; width: ${8 + bleed}mm; flex-direction: column }
.back-title { font-size: 4.6mm; font-weight: 700; letter-spacing: -0.01em }
.back-sub { font-size: 2.8mm; color: #666; margin: 0.6mm 0 3.2mm }
ol { list-style: none; flex: 1 }
li { display: grid; grid-template-columns: 5mm 1fr auto; gap: 1.5mm; font-size: ${input.tracks.length > 22 ? 2.3 : input.tracks.length > 16 ? 2.7 : 3.1}mm; line-height: 1.45 }
ol.roomy li { font-size: ${input.tracks.length > 18 ? 2.7 : 3.3}mm; line-height: 1.6 }
li .n { color: #999; text-align: right } li .a { color: #888 } li .d { color: #666; font-variant-numeric: tabular-nums }
li .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.dedication { font-size: 2.9mm; font-style: italic; color: #444; margin: 2mm 0 0; line-height: 1.4 }
.dedication.big { font-size: 5.2mm; line-height: 1.35; color: #222; text-align: center }
.back-foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 3mm; font-size: 2.4mm; color: #888; border-top: 0.15mm solid #e5e5e5; padding-top: 1.8mm; margin-top: 2mm }
.qr-box, .qr-big { display: flex; flex-direction: column; align-items: center; gap: 0.6mm; color: #666 }
.qr-cap { font-size: 1.9mm } .qr-big { margin-top: 8mm } .qr-big .qr-cap { font-size: 2.6mm }
.label { border-radius: 50%; border: 0.15mm solid #ccc; overflow: hidden }
.label > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover }
.label .label-ring { position: absolute; inset: 0; width: 100%; height: 100% }
.label .hole { position: absolute; left: 50%; top: 50%; border-radius: 50%; background: #fff; border: 0.15mm solid #ccc }
.label .lt { position: absolute; left: 0; right: 0; top: 13mm; padding: 2.6mm 22mm 2.8mm; text-align: center; color: #fff; background: rgba(0,0,0,.62) }
.label .lt b { display: block; font-size: 5mm; letter-spacing: -0.02em; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.label .lt span { display: block; font-size: 2.8mm; opacity: .85; margin-top: 0.6mm }
.label .lb { position: absolute; left: 0; right: 0; bottom: 15mm; padding: 1.8mm 24mm; text-align: center; color: #fff; font-size: 2.6mm; background: rgba(0,0,0,.62) }
.booklet { display: grid; grid-template-columns: 1fr 1fr; overflow: visible }
.panel { position: relative; overflow: visible }
.panel.plain { overflow: hidden }
.panel.right.plain, .panel.left.plain { border: 0 }
.panel-inner { position: absolute; inset: 0; padding: ${SIZES.safe + 3}mm ${SIZES.safe + 4}mm; display: flex; flex-direction: column }
.panel-inner.center { justify-content: center; align-items: center; text-align: center }
.panel-center { margin: auto; text-align: center; display: flex; flex-direction: column; align-items: center }
.ruler { position: absolute; width: 100mm; height: 3mm; border-top: 0.2mm solid #000 }
.ruler i { position: absolute; top: 0; width: 0.2mm; background: #000 }
.ruler span { position: absolute; top: 4.5mm; left: 0; width: 160mm; font-size: 2.3mm; color: #666 }
</style></head><body>${pages.join("")}</body></html>`;
}

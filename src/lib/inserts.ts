import { formatDiscTime, formatTime } from "./cd";

/**
 * Printable jewel-case inserts at real sizes, as one self-contained HTML page.
 *   Front cover 120 × 120 mm · Back tray card 151 × 118 mm (two 6.5 mm spines) ·
 *   Disc label Ø 118 mm with a 41 mm centre hole. Crop marks around each piece.
 */
export const SIZES = {
  front: { w: 120, h: 120 },
  back: { w: 151, h: 118, spine: 6.5 },
  label: { d: 118, hole: 41 },
} as const;

export const PAPER = {
  A4: { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 },
} as const;

export type Paper = keyof typeof PAPER;
export type InsertLayout = "collage" | "cover" | "type";

export interface InsertTrack {
  title: string;
  artist: string;
  durationSec: number;
  cover: string;
  color?: string;
}

export interface InsertInput {
  title: string;
  tracks: InsertTrack[];
  layout: InsertLayout;
  paper: Paper;
  /** Shown small on the back and the label. */
  dateLabel?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Most common artist, or "Various artists". */
export function mainArtist(tracks: InsertTrack[]): string {
  const counts = new Map<string, number>();
  for (const t of tracks) counts.set(t.artist, (counts.get(t.artist) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top && top[1] / Math.max(1, tracks.length) >= 0.6 ? top[0] : "Various artists";
}

/** Readable text colour on a background colour (hex or hsl). */
function inkOn(bg?: string): string {
  const m = bg?.match(/^#([0-9a-f]{6})$/i);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111" : "#fff";
}

/** Corner crop marks for a w×h piece placed at (x, y), all in mm. */
function cropMarks(x: number, y: number, w: number, h: number): string {
  const len = 5, gap = 2;
  const lines: string[] = [];
  for (const [cx, sx] of [[x, -1], [x + w, 1]] as const)
    for (const [cy, sy] of [[y, -1], [y + h, 1]] as const) {
      lines.push(`<div class="crop h" style="left:${sx < 0 ? cx - gap - len : cx + gap}mm;top:${cy}mm;width:${len}mm"></div>`);
      lines.push(`<div class="crop v" style="left:${cx}mm;top:${sy < 0 ? cy - gap - len : cy + gap}mm;height:${len}mm"></div>`);
    }
  return lines.join("");
}

function frontArt(input: InsertInput): string {
  const covers = input.tracks.map((t) => t.cover).filter(Boolean);
  const title = esc(input.title);
  const artist = esc(mainArtist(input.tracks));
  if (input.layout === "type") {
    const bg = input.tracks[0]?.color ?? "#1c1c1e";
    return `<div class="type" style="background:${bg};color:${inkOn(bg)}"><div class="type-title">${title}</div><div class="type-artist">${artist}</div></div>`;
  }
  if (input.layout === "cover" || covers.length < 4) {
    return `<img class="full" src="${covers[0] ?? ""}" alt=""><div class="band"><div class="band-title">${title}</div><div class="band-artist">${artist}</div></div>`;
  }
  return `<div class="grid">${covers.slice(0, 4).map((c) => `<img src="${c}" alt="">`).join("")}</div><div class="band"><div class="band-title">${title}</div><div class="band-artist">${artist}</div></div>`;
}

export function buildInsertsHtml(input: InsertInput): string {
  const paper = PAPER[input.paper];
  const { front, back, label } = SIZES;
  const total = input.tracks.reduce((n, t) => n + t.durationSec, 0);
  const title = esc(input.title);
  const artist = esc(mainArtist(input.tracks));
  const date = input.dateLabel ? esc(input.dateLabel) : "";
  // Long tracklists shrink so they always fit on the tray card.
  const listSize = input.tracks.length > 22 ? 2.3 : input.tracks.length > 16 ? 2.7 : 3.1;

  const fx = (paper.w - front.w) / 2, fy = 14;
  const bx = (paper.w - back.w) / 2, by = fy + front.h + 16;
  const lx = (paper.w - label.d) / 2, ly = 20;

  const rows = input.tracks
    .map((t, i) => `<li><span class="n">${i + 1}</span><span class="t">${esc(t.title)}<span class="a"> · ${esc(t.artist)}</span></span><span class="d">${formatTime(t.durationSec)}</span></li>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} inserts</title><style>
@page { size: ${paper.w}mm ${paper.h}mm; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { background: #fff; color: #111; font-family: "SF Pro Text", -apple-system, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { position: relative; width: ${paper.w}mm; height: ${paper.h}mm; overflow: hidden; page-break-after: always; background: #fff }
.page:last-child { page-break-after: auto }
.piece { position: absolute; overflow: hidden; background: #fff }
.crop { position: absolute; background: #000 }
.crop.h { height: 0.15mm } .crop.v { width: 0.15mm }
.caption { position: absolute; font-size: 2.4mm; color: #888 }
.front img.full { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover }
.front .grid { position: absolute; inset: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr }
.front .grid img { width: 100%; height: 100%; object-fit: cover; display: block }
.front .band { position: absolute; left: 0; right: 0; bottom: 0; padding: 5mm 6mm; background: rgba(0,0,0,.62); color: #fff }
.band-title { font-size: 6mm; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1 }
.band-artist { font-size: 3.4mm; opacity: .8; margin-top: 1mm }
.type { position: absolute; inset: 0; padding: 10mm; display: flex; flex-direction: column; justify-content: flex-end }
.type-title { font-size: 13mm; font-weight: 700; letter-spacing: -0.03em; line-height: 1 }
.type-artist { font-size: 4.2mm; margin-top: 3mm; opacity: .75 }
.back { display: grid; grid-template-columns: ${back.spine}mm 1fr ${back.spine}mm }
.spine { display: flex; align-items: center; justify-content: center; border-left: 0.1mm solid #ddd; border-right: 0.1mm solid #ddd }
.spine span { writing-mode: vertical-rl; font-size: 2.8mm; font-weight: 600; white-space: nowrap; overflow: hidden; max-height: 110mm }
.spine.left span { transform: rotate(180deg) }
.back-main { padding: 7mm 8mm; display: flex; flex-direction: column }
.back-title { font-size: 4.6mm; font-weight: 700; letter-spacing: -0.01em }
.back-artist { font-size: 2.8mm; color: #666; margin: 0.6mm 0 3.5mm }
ol { list-style: none; flex: 1 }
li { display: grid; grid-template-columns: 5mm 1fr auto; gap: 1.5mm; font-size: ${listSize}mm; line-height: 1.45 }
li .n { color: #999; text-align: right } li .a { color: #888 } li .d { color: #666; font-variant-numeric: tabular-nums }
li .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.back-foot { display: flex; justify-content: space-between; font-size: 2.4mm; color: #888; border-top: 0.15mm solid #e5e5e5; padding-top: 1.8mm; margin-top: 2mm }
.label { border-radius: 50%; border: 0.15mm solid #ccc }
.label img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .9 }
.label .hole { position: absolute; left: 50%; top: 50%; width: ${label.hole}mm; height: ${label.hole}mm; margin: -${label.hole / 2}mm 0 0 -${label.hole / 2}mm; border-radius: 50%; background: #fff; border: 0.15mm solid #ccc }
/* Text sits on dark bands (like the front cover) so it reads on light and dark covers alike; the round label crops the band ends. */
.label .lt { position: absolute; left: 0; right: 0; top: 13mm; padding: 2.6mm 22mm 2.8mm; text-align: center; color: #fff; background: rgba(0,0,0,.62) }
.label .lt b { display: block; font-size: 5mm; letter-spacing: -0.02em; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis } .label .lt span { display: block; font-size: 2.8mm; opacity: .85; margin-top: 0.6mm }
.label .lb { position: absolute; left: 0; right: 0; bottom: 15mm; padding: 1.8mm 24mm; text-align: center; color: #fff; font-size: 2.6mm; background: rgba(0,0,0,.62) }
.label.no-art { background: #f2f2f2 }
</style></head><body>
<div class="page">
  <div class="caption" style="left:${fx}mm;top:${fy - 7}mm">Front cover · cut on the marks</div>
  <div class="piece front" style="left:${fx}mm;top:${fy}mm;width:${front.w}mm;height:${front.h}mm">${frontArt(input)}</div>
  ${cropMarks(fx, fy, front.w, front.h)}
  <div class="caption" style="left:${bx}mm;top:${by - 7}mm">Back tray card · fold along the spines</div>
  <div class="piece back" style="left:${bx}mm;top:${by}mm;width:${back.w}mm;height:${back.h}mm">
    <div class="spine left"><span>${title} · ${artist}</span></div>
    <div class="back-main">
      <div class="back-title">${title}</div><div class="back-artist">${artist}</div>
      <ol>${rows}</ol>
      <div class="back-foot"><span>${input.tracks.length} tracks · ${formatDiscTime(total)}</span><span>${date}</span></div>
    </div>
    <div class="spine"><span>${title} · ${artist}</span></div>
  </div>
  ${cropMarks(bx, by, back.w, back.h)}
</div>
<div class="page">
  <div class="caption" style="left:${lx}mm;top:${ly - 7}mm">Disc label · for round CD label sheets or cutting</div>
  <div class="piece label${input.tracks[0]?.cover ? "" : " no-art"}" style="left:${lx}mm;top:${ly}mm;width:${label.d}mm;height:${label.d}mm">
    ${input.tracks[0]?.cover ? `<img src="${input.tracks[0].cover}" alt="">` : ""}
    <div class="lt"><b>${title}</b><span>${artist}</span></div>
    <div class="hole"></div>
    <div class="lb">${input.tracks.length} tracks · ${formatDiscTime(total)}${date ? ` · ${date}` : ""}</div>
  </div>
  ${cropMarks(lx, ly, label.d, label.d)}
</div>
</body></html>`;
}

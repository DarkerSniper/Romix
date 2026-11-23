/**
 * Squares a thumbnail (YouTube video thumbnails are 16:9) by centre-cropping,
 * picks a representative colour for the disc slice tint, and keeps a large
 * copy for printing (a 12 cm cover needs ~1400 px to print sharply).
 */
const UI_SIZE = 512;
const PRINT_MAX = 1500;

export interface LineStats {
  mean: number;
  max: number;
}

/**
 * How many lines from the edge are a solid black bar: dark on average and with
 * no bright detail. Capped at 30 %, and ignored if it's under 2 % (dark artwork
 * shouldn't be cropped).
 */
export function barLines(lines: LineStats[]): number {
  const cap = Math.floor(lines.length * 0.3);
  let n = 0;
  while (n < cap && lines[n].mean < 16 && lines[n].max < 48) n++;
  return n >= Math.ceil(lines.length * 0.02) ? n : 0;
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Cover image failed to load"));
    img.src = src;
  });
}

export interface ProcessedCover {
  /** 512 px, for the interface. */
  cover: string;
  color: string;
  /** Square, as large as the source allows (up to 1500 px), for printing. */
  print: string;
  /** Pixel size of the print copy. */
  printSize: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The picture area without baked-in black bars (cinema-style video thumbnails). */
function contentBox(img: HTMLImageElement): Box {
  const scale = Math.min(1, 320 / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const lum = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const rows: LineStats[] = [], cols: LineStats[] = [];
  for (let y = 0; y < h; y++) {
    let sum = 0, max = 0;
    for (let x = 0; x < w; x++) { const l = lum((y * w + x) * 4); sum += l; max = Math.max(max, l); }
    rows.push({ mean: sum / w, max });
  }
  for (let x = 0; x < w; x++) {
    let sum = 0, max = 0;
    for (let y = 0; y < h; y++) { const l = lum((y * w + x) * 4); sum += l; max = Math.max(max, l); }
    cols.push({ mean: sum / h, max });
  }
  const top = barLines(rows), bottom = barLines([...rows].reverse());
  const left = barLines(cols), right = barLines([...cols].reverse());
  return {
    x: left / scale,
    y: top / scale,
    w: (w - left - right) / scale,
    h: (h - top - bottom) / scale,
  };
}

function square(img: HTMLImageElement, box: Box, size: number): HTMLCanvasElement {
  const side = Math.min(box.w, box.h);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, box.x + (box.w - side) / 2, box.y + (box.h - side) / 2, side, side, 0, 0, size, size);
  return canvas;
}

export async function processCover(dataUrl: string): Promise<ProcessedCover> {
  const img = await load(dataUrl);
  const box = contentBox(img);
  const ui = square(img, box, UI_SIZE);
  const printSize = Math.round(Math.min(PRINT_MAX, Math.min(box.w, box.h)));
  const print = square(img, box, printSize);
  return {
    cover: ui.toDataURL("image/jpeg", 0.9),
    color: dominantColor(ui.getContext("2d")!),
    print: print.toDataURL("image/jpeg", 0.93),
    printSize,
  };
}

/** Saturation-weighted average of a downsampled image, so a coloured subject beats a grey background. */
function dominantColor(src: CanvasRenderingContext2D): string {
  const n = 24;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src.canvas, 0, 0, n, n);
  const { data } = ctx.getImageData(0, 0, n, n);
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i < data.length; i += 4) {
    const R = data[i], G = data[i + 1], B = data[i + 2];
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const sat = max === 0 ? 0 : (max - min) / max;
    const light = max / 255;
    const weight = 0.05 + sat * sat * (light > 0.12 ? 1 : 0.2);
    r += R * weight; g += G * weight; b += B * weight; w += weight;
  }
  const hex = (v: number) => Math.round(v / w).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

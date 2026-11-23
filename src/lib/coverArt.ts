/**
 * Squares a thumbnail (YouTube video thumbnails are 16:9) by centre-cropping,
 * picks a representative colour for the disc slice tint, and keeps a large
 * copy for printing (a 12 cm cover needs ~1400 px to print sharply).
 */
const UI_SIZE = 512;
const PRINT_MAX = 1500;

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

function square(img: HTMLImageElement, size: number): HTMLCanvasElement {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  return canvas;
}

export async function processCover(dataUrl: string): Promise<ProcessedCover> {
  const img = await load(dataUrl);
  const ui = square(img, UI_SIZE);
  const printSize = Math.min(PRINT_MAX, Math.min(img.naturalWidth, img.naturalHeight));
  const print = square(img, printSize);
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

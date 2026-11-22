/**
 * Squares a thumbnail (YouTube video thumbnails are 16:9) by centre-cropping,
 * and picks a representative colour for the disc slice tint.
 */
const SIZE = 512;

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Cover image failed to load"));
    img.src = src;
  });
}

export interface ProcessedCover {
  cover: string;
  color: string;
}

export async function processCover(dataUrl: string): Promise<ProcessedCover> {
  const img = await load(dataUrl);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);

  return { cover: canvas.toDataURL("image/jpeg", 0.9), color: dominantColor(ctx) };
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

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { motion } from "framer-motion";
import { RotateCw } from "lucide-react";
import { DEFAULT_CROP, type CoverCrop } from "../lib/insertDesign";

export type { CoverCrop };
export { DEFAULT_CROP };

/** Scale that makes the (turned) image just cover a w×h box. */
function coverScale(img: HTMLImageElement, crop: CoverCrop, w: number, h: number) {
  const turned = crop.rotate % 180 !== 0;
  const iw = turned ? img.naturalHeight : img.naturalWidth, ih = turned ? img.naturalWidth : img.naturalHeight;
  return { iw, ih, scale: Math.max(w / iw, h / ih) * crop.zoom };
}

/** Draws the framed image into a w×h box. Used for both the live view and the final image, so they match exactly. */
export function drawCrop(ctx: CanvasRenderingContext2D, w: number, h: number, img: HTMLImageElement, crop: CoverCrop) {
  const { iw, ih, scale } = coverScale(img, crop, w, h);
  const spareX = (iw * scale - w) / 2, spareY = (ih * scale - h) / 2;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(w / 2 + crop.panX * spareX, h / 2 + crop.panY * spareY);
  ctx.rotate((crop.rotate * Math.PI) / 180);
  ctx.drawImage(img, (-img.naturalWidth * scale) / 2, (-img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
  ctx.restore();
}

/** Source pixels across the box's width for this framing (what it can print at, before resampling). */
export const croppedPixels = (img: HTMLImageElement, crop: CoverCrop, aspect: number) => {
  const { scale } = coverScale(img, crop, aspect, 1);
  return aspect / scale;
};

interface CoverEditorProps {
  /** The original image (data URL or romix-cover:// URL). */
  src: string;
  initial?: CoverCrop;
  /** Width ÷ height of the spot it fills (1 = square). */
  aspect?: number;
  /** Printed width of that spot in mm, for the sharpness hint. */
  widthMm?: number;
  /** Shows a round mask (disc label, ring centre). */
  round?: boolean;
  /** What the picture is for, e.g. "Front cover · tile 2". */
  place?: string;
  onApply: (result: { dataUrl: string; crop: CoverCrop; px: number; aspect: number }) => void;
  onClose: () => void;
}

const VIEW = 340;
/** Framed copies are kept at up to 300 dpi: sharper doesn't print any better. */
const MAX_DPI = 300;

export function CoverEditor({ src, initial, aspect = 1, widthMm = 120, round = false, place, onApply, onClose }: CoverEditorProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CoverCrop>(initial ?? DEFAULT_CROP);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; crop: CoverCrop } | null>(null);
  // The view keeps the spot's shape inside a VIEW × VIEW square (thin spines stay at least 24 px wide).
  const viewW = aspect >= 1 ? VIEW : Math.max(24, VIEW * aspect);
  const viewH = aspect >= 1 ? Math.max(24, VIEW / aspect) : VIEW;

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(viewW * dpr);
    c.height = Math.round(viewH * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    drawCrop(ctx, viewW, viewH, img, crop);
  }, [img, crop, viewW, viewH]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Spare room (view pixels) to either side at the current zoom, for turning drags into pan amounts. */
  const spare = () => {
    if (!img) return { x: 1, y: 1 };
    const turned = crop.rotate % 180 !== 0;
    const iw = turned ? img.naturalHeight : img.naturalWidth, ih = turned ? img.naturalWidth : img.naturalHeight;
    const scale = Math.max(viewW / iw, viewH / ih) * crop.zoom;
    return { x: Math.max(0.0001, (iw * scale - viewW) / 2), y: Math.max(0.0001, (ih * scale - viewH) / 2) };
  };
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, crop };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    if (!drag.current) return;
    const s = spare();
    const d = drag.current;
    setCrop({ ...d.crop, panX: clamp(d.crop.panX + (e.clientX - d.x) / s.x), panY: clamp(d.crop.panY + (e.clientY - d.y) / s.y) });
  };
  const onKeys = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    setCrop((c) => ({ ...c, panX: clamp(c.panX + d[0]), panY: clamp(c.panY + d[1]) }));
  };

  const px = img ? croppedPixels(img, crop, aspect) : 0;
  const dpi = Math.round(px / (widthMm / 25.4));

  const apply = () => {
    if (!img) return;
    const w = Math.max(64, Math.round(Math.min(px, (widthMm / 25.4) * MAX_DPI, 3000)));
    const h = Math.max(16, Math.round(w / aspect));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    drawCrop(c.getContext("2d")!, w, h, img, crop);
    onApply({ dataUrl: c.toDataURL("image/jpeg", 0.92), crop, px: w, aspect });
  };

  // Close on the backdrop only when the click started there too, so a drag that ends outside the frame doesn't discard the framing.
  const downOnBackdrop = useRef(false);
  const printed = `${Math.round(widthMm)} mm`;

  return (
    <motion.div
      className="sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="sheet cover-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Frame picture"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="sheet-title">Frame picture</h2>
        <p className="sheet-sub">{place ? `${place}. ` : ""}Drag to position. The frame is exactly what prints.</p>

        <div className="crop-stage">
          <canvas
            ref={canvas}
            className={`crop-view${round ? " is-round" : ""}`}
            style={{ width: viewW, height: viewH }}
            tabIndex={0}
            role="img"
            aria-label="Picture framing. Drag or use the arrow keys to move the picture."
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => (drag.current = null)}
            onKeyDown={onKeys}
            onWheel={(e) => setCrop((c) => ({ ...c, zoom: Math.max(1, Math.min(4, c.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06))) }))}
          />
        </div>

        <div className="crop-controls">
          <label className="slider crop-zoom">
            <span>Zoom</span>
            <input type="range" min={1} max={4} step={0.01} value={crop.zoom} onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })} />
          </label>
          <button className="icon-btn" aria-label="Rotate 90 degrees" title="Rotate" onClick={() => setCrop({ ...crop, rotate: ((crop.rotate + 90) % 360) as CoverCrop["rotate"], panX: 0, panY: 0 })}>
            <RotateCw size={15} />
          </button>
        </div>

        <p className={`form-note crop-res ${dpi < 200 ? "is-warning" : ""}`}>
          {img ? `Prints at about ${dpi} dpi, ${printed} wide${dpi < 200 ? ". It may look soft: zoom out or use a larger picture." : "."}` : "Loading…"}
        </p>

        <div className="sheet-actions">
          <button className="btn" onClick={() => setCrop(DEFAULT_CROP)}>
            Reset
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={apply} disabled={!img}>
            Use this
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}


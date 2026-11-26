import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { motion } from "framer-motion";
import { RotateCw } from "lucide-react";

/** How your image is framed: zoom ≥ 1 over "fill the square", pan −1…1 of the spare room, rotation in quarter turns. */
export interface CoverCrop {
  zoom: number;
  panX: number;
  panY: number;
  rotate: 0 | 90 | 180 | 270;
}

export const DEFAULT_CROP: CoverCrop = { zoom: 1, panX: 0, panY: 0, rotate: 0 };

/** Draws the framed image into a size×size square. Used for both the live view and the final image, so they match exactly. */
export function drawCrop(ctx: CanvasRenderingContext2D, size: number, img: HTMLImageElement, crop: CoverCrop) {
  const turned = crop.rotate % 180 !== 0;
  const w = turned ? img.naturalHeight : img.naturalWidth;
  const h = turned ? img.naturalWidth : img.naturalHeight;
  const scale = (size / Math.min(w, h)) * crop.zoom;
  const spareX = (w * scale - size) / 2, spareY = (h * scale - size) / 2;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(size / 2 + crop.panX * spareX, size / 2 + crop.panY * spareY);
  ctx.rotate((crop.rotate * Math.PI) / 180);
  ctx.drawImage(img, (-img.naturalWidth * scale) / 2, (-img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
  ctx.restore();
}

/** Source pixels across the square for this framing (what it can print at, before resampling). */
export const croppedPixels = (img: HTMLImageElement, crop: CoverCrop) => Math.min(img.naturalWidth, img.naturalHeight) / crop.zoom;

interface CoverEditorProps {
  /** The original image (data URL or romix-cover:// URL). */
  src: string;
  initial?: CoverCrop;
  onApply: (result: { dataUrl: string; crop: CoverCrop; px: number }) => void;
  onClose: () => void;
}

const VIEW = 340;
const OUT_MAX = 1500;

export function CoverEditor({ src, initial, onApply, onClose }: CoverEditorProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CoverCrop>(initial ?? DEFAULT_CROP);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; crop: CoverCrop } | null>(null);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = VIEW * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    drawCrop(ctx, VIEW, img, crop);
  }, [img, crop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Spare room (view pixels) to either side at the current zoom, for turning drags into pan amounts. */
  const spare = () => {
    if (!img) return { x: 1, y: 1 };
    const turned = crop.rotate % 180 !== 0;
    const w = turned ? img.naturalHeight : img.naturalWidth, h = turned ? img.naturalWidth : img.naturalHeight;
    const scale = (VIEW / Math.min(w, h)) * crop.zoom;
    return { x: Math.max(0.0001, (w * scale - VIEW) / 2), y: Math.max(0.0001, (h * scale - VIEW) / 2) };
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

  const px = img ? croppedPixels(img, crop) : 0;
  const dpi = Math.round(Math.min(OUT_MAX, px) / (120 / 25.4));

  const apply = () => {
    if (!img) return;
    const size = Math.max(64, Math.round(Math.min(OUT_MAX, px)));
    const c = document.createElement("canvas");
    c.width = c.height = size;
    drawCrop(c.getContext("2d")!, size, img, crop);
    onApply({ dataUrl: c.toDataURL("image/jpeg", 0.92), crop, px: size });
  };

  // Close on the backdrop only when the click started there too, so a drag that ends outside the square doesn't discard the framing.
  const downOnBackdrop = useRef(false);

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
        aria-label="Edit cover image"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="sheet-title">Your cover image</h2>
        <p className="sheet-sub">Drag to position. The square is exactly what prints.</p>

        <canvas
          ref={canvas}
          className="crop-view"
          style={{ width: VIEW, height: VIEW }}
          tabIndex={0}
          role="img"
          aria-label="Cover framing. Drag or use the arrow keys to move the image."
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          onKeyDown={onKeys}
          onWheel={(e) => setCrop((c) => ({ ...c, zoom: Math.max(1, Math.min(4, c.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06))) }))}
        />

        <div className="crop-controls">
          <label className="slider crop-zoom">
            <span>Zoom</span>
            <input type="range" min={1} max={4} step={0.01} value={crop.zoom} onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })} />
          </label>
          <button className="icon-btn" aria-label="Rotate 90 degrees" title="Rotate" onClick={() => setCrop({ ...crop, rotate: (((crop.rotate + 90) % 360) as CoverCrop["rotate"]), panX: 0, panY: 0 })}>
            <RotateCw size={15} />
          </button>
        </div>

        <p className={`form-note crop-res ${dpi < 200 ? "is-warning" : ""}`}>
          {img ? `${Math.round(px)} × ${Math.round(px)} px · prints at about ${dpi} dpi on a 12 cm cover${dpi < 200 ? ". It may look soft: zoom out or use a larger image." : "."}` : "Loading…"}
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

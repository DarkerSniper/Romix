import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { motion } from "framer-motion";
import type { Track } from "../types";
import type { TrackAnalysis } from "../shared/api";
import { formatTime } from "../lib/cd";

interface TrimSheetProps {
  track: Track;
  analysis: TrackAnalysis | undefined;
  onApply: (startSec: number, endSec: number) => void;
  onClose: () => void;
}

const MIN_LEN = 5; // seconds kept at the very least

/** Trim a song's start and end on its waveform. */
export function TrimSheet({ track, analysis, onApply, onClose }: TrimSheetProps) {
  const dur = analysis?.durationSec ?? track.durationSec;
  const [start, setStart] = useState(track.trimStartSec ?? 0);
  const [end, setEnd] = useState(track.trimEndSec ?? dur);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<"start" | "end" | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toSec = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((clientX - r.left) / r.width) * dur));
  };
  const move = (e: RPointerEvent) => {
    if (!drag.current) return;
    const s = toSec(e.clientX);
    if (drag.current === "start") setStart(Math.min(s, end - MIN_LEN));
    else setEnd(Math.max(s, start + MIN_LEN));
  };
  const handleKeys = (which: "start" | "end") => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 0.5;
    const d = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    if (!d) return;
    e.preventDefault();
    if (which === "start") setStart((v) => Math.max(0, Math.min(end - MIN_LEN, v + d)));
    else setEnd((v) => Math.min(dur, Math.max(start + MIN_LEN, v + d)));
  };

  const peaks = analysis?.peaks ?? [];
  const pct = (s: number) => `${(s / dur) * 100}%`;
  const saved = dur - (end - start);

  return (
    <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="sheet trim-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Trim ${track.title}`}
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="trim-head">
          <img src={track.cover} alt="" className="trim-cover" />
          <div>
            <div className="sheet-title">{track.title}</div>
            <div className="sheet-sub">{track.artist}</div>
          </div>
        </div>

        <div className="wave" ref={box} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
          {peaks.length ? (
            <svg viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" aria-hidden="true">
              {peaks.map((p, i) => (
                <rect key={i} x={i} y={50 - p * 48} width={0.7} height={Math.max(1, p * 96)} />
              ))}
            </svg>
          ) : (
            <div className="wave-loading">Reading the waveform…</div>
          )}
          <div className="wave-cut" style={{ left: 0, width: pct(start) }} />
          <div className="wave-cut" style={{ left: pct(end), right: 0 }} />
          {(["start", "end"] as const).map((w) => (
            <div
              key={w}
              className="wave-handle"
              style={{ left: pct(w === "start" ? start : end) }}
              role="slider"
              tabIndex={0}
              aria-label={w === "start" ? "Start of the song" : "End of the song"}
              aria-valuemin={0}
              aria-valuemax={Math.round(dur)}
              aria-valuenow={Math.round(w === "start" ? start : end)}
              aria-valuetext={formatTime(w === "start" ? start : end)}
              onKeyDown={handleKeys(w)}
              onPointerDown={(e) => {
                drag.current = w;
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={move}
              onPointerUp={() => (drag.current = null)}
            />
          ))}
        </div>

        <div className="trim-times">
          <span>Starts {formatTime(start)}</span>
          <span>
            {formatTime(end - start)} long{saved >= 1 ? ` · saves ${formatTime(saved)}` : ""}
          </span>
          <span>Ends {formatTime(end)}</span>
        </div>

        <div className="sheet-actions trim-actions">
          <button
            className="btn"
            disabled={!analysis}
            onClick={() => {
              setStart(analysis!.musicStartSec);
              setEnd(analysis!.musicEndSec);
            }}
            title="Cut silence at the start and end"
          >
            Auto
          </button>
          <button
            className="btn"
            onClick={() => {
              setStart(0);
              setEnd(dur);
            }}
          >
            Reset
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onApply(start, end)}>
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

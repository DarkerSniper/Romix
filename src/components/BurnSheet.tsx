import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import type { Track } from "../types";
import { Disc } from "./Disc";
import { formatTime } from "../lib/cd";

const STEPS = ["Downloading best audio", "Converting to CD audio", "Burning", "Verifying disc"];

interface BurnSheetProps {
  tracks: Track[];
  totalSec: number;
  title: string;
  onClose: () => void;
}

/**
 * Simulated burn flow. Real work (yt-dlp, ffmpeg, IMAPI2/cdrdao) arrives in
 * milestones 2–4; this shows the UX and is clearly labelled as a demo.
 */
export function BurnSheet({ tracks, totalSec, title, onClose }: BurnSheetProps) {
  const [{ step, progress }, setState] = useState({ step: 0, progress: 0 });
  const done = step >= STEPS.length;

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      const inc = 0.02 + Math.random() * 0.025;
      setState((s) => (s.progress >= 1 ? { step: s.step + 1, progress: 0 } : { step: s.step, progress: Math.min(1, s.progress + inc) }));
    }, 60);
    return () => clearInterval(id);
  }, [done]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const overall = done ? 1 : (step + progress) / STEPS.length;

  return (
    <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Burning disc"
        initial={{ y: 40, scale: 0.96, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 20, scale: 0.98, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="demo-badge">Demo, no disc is written yet</span>
        <div className="sheet-disc">
          <Disc tracks={tracks} totalSec={totalSec} hoveredId={null} onHover={() => {}} spinning={!done} compact />
        </div>
        <h2 className="sheet-title">{done ? "Your disc is ready" : title}</h2>
        <p className="sheet-sub">
          {tracks.length} songs · {formatTime(totalSec)}
        </p>

        <div className="progress" aria-valuenow={Math.round(overall * 100)} role="progressbar">
          <motion.div className="progress-fill" animate={{ width: `${overall * 100}%` }} transition={{ ease: "linear", duration: 0.1 }} />
        </div>

        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? "is-done" : i === step ? "is-active" : ""}>
              <span className="step-dot">{i < step ? <Check size={11} strokeWidth={3} /> : null}</span>
              {s}
              {i === step && !done && <span className="step-pct">{Math.round(progress * 100)}%</span>}
            </li>
          ))}
        </ol>

        <button className={done ? "btn btn-primary" : "btn"} onClick={onClose}>
          {done ? "Done" : "Cancel"}
        </button>
      </motion.div>
    </motion.div>
  );
}

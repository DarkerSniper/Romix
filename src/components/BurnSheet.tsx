import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, AlertCircle } from "lucide-react";
import type { Track } from "../types";
import { Disc } from "./Disc";
import { formatTime } from "../lib/cd";

const STEPS = ["Preparing songs", "Building disc audio", "Burning", "Verifying disc"];
const DEMO_FROM = 2; // burning and verifying arrive in milestone 4

interface BurnSheetProps {
  tracks: Track[];
  totalSec: number;
  title: string;
  /** 0–1 across all songs' download + conversion. */
  prepProgress: number;
  prepError: string | null;
  /** Builds the final disc audio. Resolves to an error message, or null when done. */
  buildDisc: () => Promise<string | null>;
  onClose: () => void;
}

export function BurnSheet({ tracks, totalSec, title, prepProgress, prepError, buildDisc, onClose }: BurnSheetProps) {
  const [step, setStep] = useState(0);
  const [demo, setDemo] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const building = useRef(false);
  const done = step >= STEPS.length;

  // Step 1: wait for every song to be prepared.
  useEffect(() => {
    if (step === 0 && prepError) setError(prepError);
    if (step === 0 && !prepError && prepProgress >= 1) setStep(1);
  }, [step, prepProgress, prepError]);

  // Step 2: build the final disc audio.
  useEffect(() => {
    if (step !== 1 || building.current) return;
    building.current = true;
    void buildDisc().then((err) => {
      building.current = false;
      if (err) setError(err);
      else setStep(2);
    });
  }, [step, buildDisc]);

  // Steps 3–4: simulated until milestone 4.
  useEffect(() => {
    if (step < DEMO_FROM || done) return;
    const id = setInterval(() => {
      setDemo((p) => {
        if (p >= 1) {
          setStep((s) => s + 1);
          return 0;
        }
        return Math.min(1, p + 0.035);
      });
    }, 60);
    return () => clearInterval(id);
  }, [step, done]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stepProgress = step === 0 ? prepProgress : step === 1 ? 0.5 : demo;
  const overall = done ? 1 : (step + stepProgress) / STEPS.length;

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
        <span className="demo-badge">Burning is a demo until the next update. Preparing and building are real.</span>
        <div className="sheet-disc">
          <Disc tracks={tracks} totalSec={totalSec} hoveredId={null} onHover={() => {}} spinning={step >= DEMO_FROM && !done && !error} compact />
        </div>
        <h2 className="sheet-title">{error ? "Something went wrong" : done ? "Your disc is ready" : title}</h2>
        <p className="sheet-sub">{error ?? `${tracks.length} songs · ${formatTime(totalSec)}`}</p>

        <div className="progress" aria-valuenow={Math.round(overall * 100)} role="progressbar">
          <motion.div className={`progress-fill ${error ? "is-error" : ""}`} animate={{ width: `${overall * 100}%` }} transition={{ ease: "linear", duration: 0.1 }} />
        </div>

        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? "is-done" : i === step ? (error ? "is-error" : "is-active") : ""}>
              <span className="step-dot">{i < step ? <Check size={11} strokeWidth={3} /> : i === step && error ? <AlertCircle size={11} /> : null}</span>
              {s}
              {i >= DEMO_FROM && <span className="step-demo">demo</span>}
              {i === step && !done && !error && i !== 1 && <span className="step-pct">{Math.round(stepProgress * 100)}%</span>}
            </li>
          ))}
        </ol>

        <button className={done ? "btn btn-primary" : "btn"} onClick={onClose}>
          {done ? "Done" : error ? "Close" : "Cancel"}
        </button>
      </motion.div>
    </motion.div>
  );
}

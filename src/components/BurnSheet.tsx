import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, AlertCircle, Minus, Plus } from "lucide-react";
import type { Track } from "../types";
import type { BurnProgress, BurnResult, DiscRequest, DriveInfo } from "../shared/api";
import { Disc } from "./Disc";
import { formatDiscTime, formatTime } from "../lib/cd";
import { bridge } from "../lib/bridge";
import { burners, discCapacitySec, discLabel, discState, speedX } from "../lib/drives";
import type { BurnPrefs } from "../lib/burnPrefs";

type Phase = "setup" | "waiting" | "running" | "between" | "done" | "error";

interface BurnSheetProps {
  tracks: Track[];
  keys: string[];
  options: DiscRequest["options"];
  totalSec: number;
  title: string;
  prepProgress: number;
  prepError: string | null;
  drives: DriveInfo[] | null;
  prefs: BurnPrefs;
  onClose: () => void;
  onToast: (m: string) => void;
}

const STEP_OF: Record<BurnProgress["phase"], number> = { build: 1, prepare: 2, burn: 2, finish: 2, verify: 3, erase: 0 };

export function BurnSheet({ tracks, keys, options, totalSec, title, prepProgress, prepError, drives, prefs, onClose, onToast }: BurnSheetProps) {
  const list = burners(drives);
  const [driveId, setDriveId] = useState<string | undefined>(list[0]?.id);
  const drive = list.find((d) => d.id === driveId) ?? list[0];
  const state = discState(drive);
  const speeds = useMemo(() => [...new Set(drive?.media?.speeds ?? [])].sort((a, b) => a - b), [drive]);

  const [speedChoice, setSpeedChoice] = useState<string>(prefs.speed);
  const [copies, setCopies] = useState(1);
  const [copy, setCopy] = useState(1);
  const [verify, setVerify] = useState(prefs.verify);
  const [phase, setPhase] = useState<Phase>("setup");
  const [progress, setProgress] = useState<BurnProgress | null>(null);
  const [result, setResult] = useState<BurnResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const [erasing, setErasing] = useState(false);
  const running = useRef(false);

  const capacity = discCapacitySec(drive);
  const fits = !capacity || totalSec <= capacity;
  const speed = speedChoice === "best" ? (speeds[0] ?? 0) : speedChoice === "fastest" ? 0 : Number(speedChoice);
  const canBurn = state === "ready" && fits && keys.length > 0;

  useEffect(() => bridge.onBurnProgress(setProgress), []);

  const run = async (n: number) => {
    if (running.current) return;
    running.current = true;
    setPhase("running");
    setProgress({ phase: "build", progress: 0 });
    const more = n < copies;
    const r = await bridge.burn({ driveId: drive!.id, keys, options, speed, verify, eject: prefs.eject || more, keepForCopies: more });
    running.current = false;
    setResult(r);
    if (!r.ok) {
      setError(r.message);
      setPhase("error");
      bridge.endBurnSession();
    } else if (more) {
      setPhase("between");
    } else {
      setPhase("done");
      bridge.endBurnSession();
    }
  };

  // Wait for every song to finish preparing, then burn.
  useEffect(() => {
    if (phase !== "waiting") return;
    if (prepError) {
      setError(prepError);
      setPhase("error");
    } else if (prepProgress >= 1) void run(copy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, prepProgress, prepError]);

  // Between copies: start as soon as a fresh blank disc is in the drive.
  useEffect(() => {
    if (phase === "between" && state === "ready") {
      setCopy((c) => c + 1);
      void run(copy + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, state]);

  const close = () => {
    if (phase === "running") return setConfirmStop(true);
    bridge.endBurnSession();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const eraseDisc = async () => {
    setConfirmErase(false);
    setErasing(true);
    const r = await bridge.erase(drive!.id);
    setErasing(false);
    onToast(r.ok ? "Disc erased" : (r.message ?? "Couldn't erase the disc"));
  };

  const step = phase === "waiting" ? 0 : phase === "running" && progress ? STEP_OF[progress.phase] : phase === "done" || phase === "between" ? 4 : 0;
  const steps = ["Preparing songs", "Building disc audio", "Burning", ...(verify ? ["Checking the disc"] : [])];
  const stepProgress = phase === "waiting" ? prepProgress : (progress?.progress ?? 0);
  const overall = phase === "done" ? 1 : Math.min(1, (step + stepProgress) / steps.length);
  const verified = result?.ok ? result.verify : undefined;
  const badTracks = verified?.tracks.filter((t) => !t.ok) ?? [];

  return (
    <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={phase === "setup" ? close : undefined}>
      <motion.div
        className="sheet burn-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Burn disc"
        initial={{ y: 40, scale: 0.96, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 20, scale: 0.98, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-disc">
          <Disc tracks={tracks} totalSec={totalSec} hoveredId={null} onHover={() => {}} spinning={phase === "running" && (progress?.phase === "burn" || progress?.phase === "verify")} compact />
        </div>
        <h2 className="sheet-title">
          {phase === "done" ? (badTracks.length ? "Burned, with problems" : "Your disc is ready") : phase === "error" ? "The burn didn't finish" : phase === "between" ? `Copy ${copy} of ${copies} done` : title}
        </h2>
        <p className="sheet-sub">
          {phase === "error"
            ? error
            : phase === "between"
              ? "Insert the next blank disc. Burning starts automatically."
              : `${tracks.length} songs · ${formatTime(totalSec)}${copies > 1 && phase !== "setup" ? ` · copy ${copy} of ${copies}` : ""}`}
        </p>

        {phase === "setup" && (
          <>
            <div className="form">
              <div className="form-row">
                <span className="form-label">Burner</span>
                {list.length > 1 ? (
                  <select value={drive?.id} onChange={(e) => setDriveId(e.target.value)}>
                    {list.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.path.replace(/\\$/, "")})
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="form-value">{drive ? `${drive.name} (${drive.path.replace(/\\$/, "")})` : "None found"}</span>
                )}
              </div>
              <div className="form-row">
                <span className="form-label">Disc</span>
                <span className={`form-value disc-status is-${state}`}>
                  <i className="status-dot" />
                  {discLabel(drive)}
                </span>
              </div>
              <div className="form-row">
                <span className="form-label">Speed</span>
                <select value={speedChoice} onChange={(e) => setSpeedChoice(e.target.value)} disabled={!speeds.length}>
                  <option value="best">Best quality{speeds[0] ? ` (${speedX(speeds[0])}x)` : ""}</option>
                  {speeds.slice(1).map((s) => (
                    <option key={s} value={String(s)}>
                      {speedX(s)}x
                    </option>
                  ))}
                  <option value="fastest">Fastest</option>
                </select>
              </div>
              <div className="form-row">
                <span className="form-label">Copies</span>
                <span className="stepper">
                  <button className="icon-btn" aria-label="Fewer copies" onClick={() => setCopies((c) => Math.max(1, c - 1))} disabled={copies <= 1}>
                    <Minus size={13} />
                  </button>
                  <span className="stepper-value">{copies}</span>
                  <button className="icon-btn" aria-label="More copies" onClick={() => setCopies((c) => Math.min(20, c + 1))} disabled={copies >= 20}>
                    <Plus size={13} />
                  </button>
                </span>
              </div>
              <label className="form-row toggle-row">
                <span className="form-label">Check the disc after burning</span>
                <span className="toggle">
                  <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
                  <span className="toggle-track" aria-hidden="true">
                    <span className="toggle-thumb" />
                  </span>
                </span>
              </label>
            </div>

            <p className="form-note">
              {state === "no-burner"
                ? "Romix couldn't find a CD burner on this PC."
                : state === "no-disc"
                  ? "Insert a blank CD-R or CD-RW."
                  : state === "not-blank"
                    ? "This disc already has something on it. Insert a blank CD-R."
                    : state === "unsupported"
                      ? "Audio CDs need a CD-R or CD-RW. DVDs won't work."
                      : !fits
                        ? `This disc holds ${formatDiscTime(capacity)} but your mix is ${formatDiscTime(totalSec)}.`
                        : prepProgress < 1
                          ? "Songs are still preparing. Burning starts as soon as they're ready."
                          : "Ready to burn."}
            </p>

            {state === "not-blank-rw" &&
              (confirmErase ? (
                <div className="confirm">
                  <span>Erase everything on this CD-RW?</span>
                  <button className="btn" onClick={() => setConfirmErase(false)}>
                    Keep it
                  </button>
                  <button className="btn btn-danger" onClick={eraseDisc}>
                    Erase
                  </button>
                </div>
              ) : (
                <button className="btn erase-btn" onClick={() => setConfirmErase(true)} disabled={erasing}>
                  {erasing ? `Erasing… ${Math.round((progress?.phase === "erase" ? (progress.progress ?? 0) : 0) * 100)}%` : "Erase this CD-RW"}
                </button>
              ))}

            <div className="sheet-actions">
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => setPhase("waiting")} disabled={!canBurn}>
                {copies > 1 ? `Burn ${copies} copies` : "Burn"}
              </button>
            </div>
          </>
        )}

        {(phase === "waiting" || phase === "running" || phase === "between" || phase === "done" || phase === "error") && (
          <>
            <div className="progress" aria-valuenow={Math.round(overall * 100)} role="progressbar">
              <motion.div className={`progress-fill ${phase === "error" ? "is-error" : ""}`} animate={{ width: `${overall * 100}%` }} transition={{ ease: "linear", duration: 0.15 }} />
            </div>
            <ol className="steps">
              {steps.map((s, i) => (
                <li key={s} className={i < step ? "is-done" : i === step ? (phase === "error" ? "is-error" : phase === "running" || phase === "waiting" ? "is-active" : "") : ""}>
                  <span className="step-dot">{i < step ? <Check size={11} strokeWidth={3} /> : i === step && phase === "error" ? <AlertCircle size={11} /> : null}</span>
                  {s}
                  {i === step && (phase === "running" || phase === "waiting") && (
                    <span className="step-pct">
                      {progress?.phase === "prepare" && i === 2
                        ? "Starting…"
                        : progress?.phase === "finish" && i === 2
                          ? "Finishing…"
                          : `${Math.round(stepProgress * 100)}%${progress?.remainingSec && i === 2 ? ` · ${formatTime(progress.remainingSec)} left` : ""}`}
                    </span>
                  )}
                </li>
              ))}
            </ol>

            {phase === "done" && verified && (
              <p className={`verify-note ${badTracks.length ? "is-bad" : ""}`}>
                {badTracks.length
                  ? `Track${badTracks.length > 1 ? "s" : ""} ${badTracks.map((t) => t.track).join(", ")} didn't read back exactly. The disc may skip there. Try a slower speed or another blank.`
                  : `Checked: all ${verified.tracks.length} tracks match exactly.`}
              </p>
            )}

            {confirmStop ? (
              <div className="confirm">
                <span>Stop now? This CD-R won't be usable.</span>
                <button className="btn" onClick={() => setConfirmStop(false)}>
                  Keep burning
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    setConfirmStop(false);
                    bridge.cancelBurn();
                  }}
                >
                  Stop
                </button>
              </div>
            ) : (
              <div className="sheet-actions">
                {phase === "between" && (
                  <button
                    className="btn"
                    onClick={() => {
                      bridge.endBurnSession();
                      setPhase("done");
                    }}
                  >
                    Stop after {copy}
                  </button>
                )}
                <button className={phase === "done" ? "btn btn-primary" : "btn"} onClick={close}>
                  {phase === "done" ? "Done" : phase === "error" ? "Close" : phase === "between" ? "Close" : "Stop"}
                </button>
              </div>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

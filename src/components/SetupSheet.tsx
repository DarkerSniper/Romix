import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, AlertCircle } from "lucide-react";
import type { DepStatus } from "../shared/api";
import { bridge } from "../lib/bridge";
import { BrandMark } from "./BrandMark";

/**
 * First-run setup. Romix downloads the helper programs it needs into its own
 * folder; this sheet says what's missing, shows progress, and closes itself.
 */
export function SetupSheet({ deps, onRetry }: { deps: DepStatus[]; onRetry: () => void }) {
  const failed = deps.some((d) => d.state === "error");
  const totalMB = deps.filter((d) => d.state !== "ready").reduce((n, d) => n + d.approxMB, 0);
  const overall = deps.length ? deps.reduce((n, d) => n + d.progress, 0) / deps.length : 0;

  return (
    <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="sheet setup-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Setting up Romix"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        <BrandMark size={36} />
        <h2 className="sheet-title setup-title">Setting up Romix</h2>
        <p className="setup-sub">
          Romix needs a few free tools to read YouTube and make CD audio. They're downloading now
          {totalMB ? ` (about ${totalMB} MB)` : ""} and stay inside Romix's own folder.
        </p>

        <ul className="deps">
          {deps.map((d) => (
            <li key={d.id} className={`dep is-${d.state}`}>
              <span className="dep-icon" aria-hidden="true">
                {d.state === "ready" ? <Check size={12} strokeWidth={3} /> : d.state === "error" ? <AlertCircle size={14} /> : null}
              </span>
              <div className="dep-text">
                <div className="dep-name">
                  {d.name}
                  {d.version && d.state === "ready" && <span className="dep-version">{d.version}</span>}
                </div>
                <div className="dep-purpose">{d.state === "error" ? d.error : d.purpose}</div>
              </div>
              <span className="dep-state">
                {d.state === "ready"
                  ? "Ready"
                  : d.state === "error"
                    ? "Failed"
                    : d.state === "installing"
                      ? "Installing…"
                      : d.state === "downloading"
                        ? `${Math.round(d.progress * 100)}%`
                        : "Waiting"}
              </span>
            </li>
          ))}
        </ul>

        <div className="progress" role="progressbar" aria-valuenow={Math.round(overall * 100)}>
          <motion.div className="progress-fill" animate={{ width: `${overall * 100}%` }} transition={{ ease: "linear", duration: 0.15 }} />
        </div>

        {failed && (
          <button className="btn btn-primary setup-retry" onClick={onRetry}>
            Try again
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Tracks the helper programs; starts installing anything missing. */
export function useDeps() {
  const [deps, setDeps] = useState<DepStatus[]>([]);
  useEffect(() => {
    const off = bridge.onDepsUpdate(setDeps);
    void bridge.deps().then((list) => {
      setDeps(list);
      if (list.some((d) => d.state === "missing")) void bridge.installDeps();
    });
    return off;
  }, []);
  const ready = deps.length > 0 && deps.every((d) => d.state === "ready");
  return { deps, ready, retry: () => void bridge.installDeps() };
}

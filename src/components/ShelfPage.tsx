import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, AlertCircle } from "lucide-react";
import type { ShelfEntry } from "../shared/api";
import { bridge } from "../lib/bridge";
import { formatDiscTime } from "../lib/cd";

interface ShelfPageProps {
  onBurnAgain: (e: ShelfEntry) => void;
  onOpen: (e: ShelfEntry) => void;
  onPrint: (e: ShelfEntry) => void;
}

/** Every disc you've burned, as jewel cases on shelves. */
export function ShelfPage({ onBurnAgain, onOpen, onPrint }: ShelfPageProps) {
  const [items, setItems] = useState<ShelfEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = () => void bridge.listShelf().then(setItems);
  useEffect(load, []);

  if (items && items.length === 0) {
    return (
      <div className="placeholder">
        <h1>Your shelf is empty</h1>
        <p>Every disc you burn lands here, so you can burn it again or print its inserts later.</p>
      </div>
    );
  }

  const rows: ShelfEntry[][] = [];
  (items ?? []).forEach((e, i) => (i % 5 === 0 ? rows.push([e]) : rows[rows.length - 1].push(e)));
  const sel = items?.find((e) => e.id === selected);

  return (
    <div className="shelf">
      <h1 className="settings-title">Shelf</h1>
      {rows.map((row, r) => (
        <div key={r} className="shelf-row">
          <div className="shelf-cases">
            {row.map((e) => (
              <motion.button
                key={e.id}
                className={`case ${selected === e.id ? "is-selected" : ""}`}
                onClick={() => {
                  setSelected(selected === e.id ? null : e.id);
                  setConfirmRemove(false);
                }}
                whileHover={{ y: -4 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                aria-label={`${e.title}, burned ${new Date(e.burnedAt).toLocaleDateString()}`}
              >
                <span className="case-hinge" />
                <img src={e.tracks[0]?.cover} alt="" draggable={false} />
                {e.copies > 1 && <span className="case-copies">×{e.copies}</span>}
              </motion.button>
            ))}
          </div>
          <div className="shelf-board" />
        </div>
      ))}

      {sel && (
        <motion.div className="shelf-detail" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="shelf-detail-main">
            <div className="project-title">{sel.title}</div>
            <div className="project-meta">
              {sel.tracks.length} songs · {formatDiscTime(sel.tracks.reduce((n, t) => n + t.durationSec, 0))} · burned{" "}
              {new Date(sel.burnedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              {sel.copies > 1 ? ` · ${sel.copies} copies` : ""}
              {sel.speedX ? ` · ${sel.speedX}x` : ""}
            </div>
            <div className={`shelf-verify is-${sel.verified}`}>
              {sel.verified === "ok" ? <Check size={12} strokeWidth={3} /> : sel.verified === "issues" ? <AlertCircle size={12} /> : null}
              {sel.verified === "ok" ? "Checked: every track matched" : sel.verified === "issues" ? "Some tracks didn't read back exactly" : "Not checked after burning"}
            </div>
          </div>
          {confirmRemove ? (
            <div className="project-confirm-actions">
              <span className="project-meta">Remove from the shelf?</span>
              <button className="link-btn muted" onClick={() => setConfirmRemove(false)}>
                Cancel
              </button>
              <button
                className="link-btn danger"
                onClick={async () => {
                  await bridge.removeFromShelf(sel.id);
                  setSelected(null);
                  setConfirmRemove(false);
                  load();
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="shelf-actions">
              <button className="btn" onClick={() => onPrint(sel)}>
                Print inserts
              </button>
              <button className="btn" onClick={() => onOpen(sel)}>
                Open
              </button>
              <button className="btn btn-primary" onClick={() => onBurnAgain(sel)}>
                Burn again
              </button>
              <button className="link-btn muted" onClick={() => setConfirmRemove(true)}>
                Remove
              </button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

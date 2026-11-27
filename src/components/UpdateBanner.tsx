import { Fragment, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { UpdateState } from "../shared/api";
import { bridge } from "../lib/bridge";

/** Live update state from the main process. */
export function useUpdateState(): UpdateState | null {
  const [s, setS] = useState<UpdateState | null>(null);
  useEffect(() => {
    const off = bridge.onUpdateState(setS);
    void bridge.updateState().then(setS);
    return off;
  }, []);
  return s;
}

const mb = (b: number) => (b > 0 ? ` · ${Math.round(b / 1e6)} MB` : "");

/** Slim bar above the page when a new Romix is out, and while it downloads. */
export function UpdateBanner({ state, onNotes }: { state: UpdateState | null; onNotes: () => void }) {
  const a = state?.available;
  const show = Boolean(a) && !state!.dismissed && ["available", "downloading", "installing", "error"].includes(state!.phase);
  return (
    <AnimatePresence initial={false}>
      {show && a && state && (
        <motion.div className="update-banner" role="status" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
          {state.phase === "downloading" ? (
            <>
              <span className="update-text">Downloading Romix {a.version}…</span>
              <span className="update-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(state.progress * 100)}%` }} />
              </span>
              <span className="update-hint">{Math.round(state.progress * 100)}%</span>
            </>
          ) : state.phase === "installing" ? (
            <span className="update-text">Installing Romix {a.version}. Romix will close and reopen…</span>
          ) : (
            <>
              <span className="update-text">
                {state.phase === "error" ? `Couldn't update: ${state.error}` : `Romix ${a.version} is available`}
                {state.phase !== "error" && <span className="update-hint">{(a.prerelease ? " · Preview" : "") + mb(a.bytes)}</span>}
              </span>
              <span className="spacer" />
              <button className="link-btn" onClick={onNotes}>
                What's new
              </button>
              <button className="btn" onClick={() => void bridge.dismissUpdate()}>
                Later
              </button>
              <button className="btn btn-primary" onClick={() => void bridge.installUpdate()}>
                {state.phase === "error" ? "Try Again" : state.kind === "dev" ? "Open Release Page" : "Update"}
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** **bold** and `code` inside a line of release notes. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>,
  );
}

/** Just enough Markdown for release notes: headings, bullets (two levels), quotes and paragraphs. Rendered as text, never as HTML. */
function Notes({ md }: { md: string }) {
  const blocks: ReactNode[] = [];
  let list: { text: string; sub: string[] }[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={blocks.length}>
        {list.map((li, i) => (
          <li key={i}>
            {inline(li.text)}
            {li.sub.length > 0 && <ul>{li.sub.map((s, j) => <li key={j}>{inline(s)}</li>)}</ul>}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bullet = /^(\s*)[-*] (.*)$/.exec(line);
    if (bullet) {
      if (bullet[1].length >= 2 && list.length) list[list.length - 1].sub.push(bullet[2]);
      else list.push({ text: bullet[2], sub: [] });
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = /^#{1,6} (.*)$/.exec(line);
    if (h) blocks.push(<h3 key={blocks.length}>{h[1]}</h3>);
    else if (line.startsWith("> ")) blocks.push(<p key={blocks.length} className="notes-quote">{inline(line.slice(2))}</p>);
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="release-notes">{blocks}</div>;
}

export function UpdateNotesSheet({ state, onClose }: { state: UpdateState; onClose: () => void }) {
  const a = state.available!;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const date = a.publishedAt ? new Date(a.publishedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
  return (
    <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="sheet update-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`What's new in Romix ${a.version}`}
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="sheet-title">{a.name}</h2>
        <p className="sheet-sub">
          You have {state.current}
          {date && ` · Released ${date}`}
        </p>
        <Notes md={a.notes || "No notes for this release."} />
        <div className="sheet-actions">
          <button className="link-btn" onClick={() => bridge.openReleasePage()}>
            View on GitHub
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onClose();
              void bridge.installUpdate();
            }}
          >
            {state.kind === "dev" ? "Open Release Page" : "Update"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ShareData, ShareInfo } from "../shared/api";
import { bridge, isDesktop } from "../lib/bridge";
import { linksText } from "../lib/discFile";

interface ShareSheetProps {
  data: ShareData;
  onClose: () => void;
  onToast: (m: string) => void;
}

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

/** Share a disc: a single .romix file (with covers, optionally your own audio), or a plain list of links. */
export function ShareSheet({ data, onClose, onToast }: ShareSheetProps) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [includeAudio, setIncludeAudio] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void bridge.shareInfo(data.tracks).then(setInfo);
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyLinks = async () => {
    try {
      await navigator.clipboard.writeText(linksText(data.title, data.tracks));
      onToast(`Copied ${info?.youtubeSongs ?? ""} links`);
    } catch {
      onToast("Couldn't copy to the clipboard");
    }
  };

  const save = async () => {
    setBusy(true);
    const r = await bridge.exportDisc(data, includeAudio);
    setBusy(false);
    onToast(r.message);
    if (r.ok) onClose();
  };

  const own = info?.localSongs ?? 0;
  return (
    <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="sheet share-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${data.title}`}
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="share-covers" aria-hidden="true">
          {data.tracks.slice(0, 4).map((t, i) => (
            <img key={i} src={t.cover} alt="" style={{ zIndex: 4 - i, transform: `translateX(${i * 14}px) rotate(${(i - 1.5) * 4}deg)` }} />
          ))}
        </div>
        <h2 className="sheet-title">Share “{data.title}”</h2>
        <p className="sheet-sub">
          {data.tracks.length} songs. The other person opens it in Romix and gets the same songs, order, trims and settings.
        </p>

        <div className="form">
          {own > 0 && (
            <label className="form-row toggle-row">
              <span className="form-label">
                Include my audio files
                <span className="form-sub">
                  {own} of your own {own === 1 ? "song" : "songs"}, {mb(info!.localBytes)}. Only share music you have the right to.
                </span>
              </span>
              <span className="toggle">
                <input type="checkbox" checked={includeAudio} onChange={(e) => setIncludeAudio(e.target.checked)} />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
              </span>
            </label>
          )}
          <div className="form-row">
            <span className="form-label">
              In the file
              <span className="form-sub">
                {info?.youtubeSongs ?? 0} YouTube {info?.youtubeSongs === 1 ? "song" : "songs"} and covers
                {own > 0 ? (includeAudio ? `, plus ${own} of your own` : `. Your ${own} own ${own === 1 ? "song is" : "songs are"} left out`) : ""}
                {info?.missingLocal ? `. ${info.missingLocal} own ${info.missingLocal === 1 ? "song's file is" : "songs' files are"} missing and can't be shared` : ""}.
              </span>
            </span>
          </div>
        </div>

        <div className="sheet-actions share-actions">
          {(info?.youtubeSongs ?? 0) > 0 && (
            <button className="btn" onClick={() => void copyLinks()} title="A plain list of the YouTube links, for messages or email">
              Copy links
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !isDesktop}>
            {busy ? "Saving…" : "Save .romix file…"}
          </button>
        </div>
        {!isDesktop && <p className="form-note">Saving shared discs works in the desktop app.</p>}
      </motion.div>
    </motion.div>
  );
}

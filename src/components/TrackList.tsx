import { Reorder, useDragControls, AnimatePresence } from "framer-motion";
import { AlertCircle, GripVertical, X, Clock } from "lucide-react";
import type { Track } from "../types";
import { formatTime } from "../lib/cd";

interface TrackListProps {
  tracks: Track[];
  onReorder: (next: Track[]) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

export function TrackList({ tracks, onReorder, onRemove, onRetry, hoveredId, onHover }: TrackListProps) {
  if (tracks.length === 0) {
    return (
      <div className="list-empty">
        <p className="list-empty-title">No songs yet</p>
        <p className="list-empty-body">Paste YouTube Music links above, or drag audio files into the window.</p>
      </div>
    );
  }

  return (
    <>
      <div className="list-head" aria-hidden="true">
        <span className="col-num">#</span>
        <span />
        <span>Title</span>
        <span className="col-time"><Clock size={12} /></span>
        <span />
      </div>
      <Reorder.Group axis="y" values={tracks} onReorder={onReorder} className="track-list" as="ol">
        <AnimatePresence initial={false}>
          {tracks.map((t, i) => (
            <TrackRow key={t.id} track={t} index={i} hovered={hoveredId === t.id} onHover={onHover} onRemove={onRemove} onRetry={onRetry} />
          ))}
        </AnimatePresence>
      </Reorder.Group>
    </>
  );
}

interface RowProps {
  track: Track;
  index: number;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

function TrackRow({ track: t, index, hovered, onHover, onRemove, onRetry }: RowProps) {
  const controls = useDragControls();
  const resolving = t.status === "resolving";
  const failed = t.status === "error";

  return (
    <Reorder.Item
      value={t}
      dragListener={false}
      dragControls={controls}
      className={`track ${hovered ? "is-hover" : ""} ${failed ? "is-error" : ""}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      whileDrag={{ boxShadow: "var(--shadow-pop)", zIndex: 5 }}
      transition={{ type: "spring", stiffness: 600, damping: 45 }}
      onMouseEnter={() => onHover(t.id)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="track-num">
        <span className="num-text">{index + 1}</span>
        {!resolving && (
          <button className="track-grip" aria-label={`Drag to reorder ${t.title}`} onPointerDown={(e) => controls.start(e)}>
            <GripVertical size={14} />
          </button>
        )}
      </span>
      {resolving ? (
        <div className="track-cover skeleton" />
      ) : failed ? (
        <div className="track-cover track-cover-error" aria-hidden="true">
          <AlertCircle size={16} />
        </div>
      ) : (
        <img className="track-cover" src={t.cover} alt="" draggable={false} />
      )}
      <div className="track-meta">
        {resolving ? (
          <>
            <div className="skeleton skeleton-line" style={{ width: "55%" }} />
            <div className="skeleton skeleton-line" style={{ width: "30%" }} />
          </>
        ) : failed ? (
          <>
            <div className="track-title">{t.error}</div>
            <div className="track-artist">
              <span className="track-url">{t.url}</span>
              <button className="link-btn" onClick={() => onRetry(t.id)}>
                Retry
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="track-title">{t.title}</div>
            <div className="track-artist">
              {t.source === "local" && <span className="source-tag">FILE</span>}
              {t.artist}
            </div>
          </>
        )}
      </div>
      <span className="track-time">{resolving || failed ? "" : formatTime(t.durationSec)}</span>
      <button className="icon-btn track-remove" aria-label={`Remove ${t.title || "song"}`} onClick={() => onRemove(t.id)}>
        <X size={13} />
      </button>
    </Reorder.Item>
  );
}

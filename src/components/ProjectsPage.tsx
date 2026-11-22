import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ProjectSummary } from "../shared/api";
import { bridge } from "../lib/bridge";
import { formatTime } from "../lib/cd";

interface ProjectsPageProps {
  currentId: string | null;
  /** True when the open disc has songs that would be replaced. */
  hasWork: boolean;
  onOpen: (id: string) => void;
}

function ago(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ProjectsPage({ currentId, hasWork, onOpen }: ProjectsPageProps) {
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "open" | "delete" } | null>(null);

  const load = () => void bridge.listProjects().then(setItems);
  useEffect(load, []);

  const open = (id: string) => {
    if (hasWork && id !== currentId) setConfirm({ id, kind: "open" });
    else onOpen(id);
  };

  const remove = async (id: string) => {
    await bridge.deleteProject(id);
    setConfirm(null);
    load();
  };

  if (items && items.length === 0) {
    return (
      <div className="placeholder">
        <h1>No saved discs yet</h1>
        <p>Save a disc from the New disc page to burn more copies later or keep working on it.</p>
      </div>
    );
  }

  return (
    <div className="projects">
      <h1 className="settings-title">Saved projects</h1>
      <div className="project-grid">
        {(items ?? []).map((p) => (
          <motion.div key={p.id} className={`project ${p.id === currentId ? "is-current" : ""}`} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <button className="project-art" onClick={() => open(p.id)} aria-label={`Open ${p.title}`}>
              <div className={`collage n${Math.min(4, p.covers.length)}`}>
                {p.covers.slice(0, 4).map((c, i) => (
                  <img key={i} src={c} alt="" draggable={false} />
                ))}
              </div>
            </button>
            <div className="project-title">{p.title}</div>
            <div className="project-meta">
              {p.songs} {p.songs === 1 ? "song" : "songs"} · {formatTime(p.durationSec)} · {ago(p.updatedAt)}
            </div>
            {confirm?.id === p.id ? (
              <div className="project-confirm">
                <span>{confirm.kind === "open" ? "Replace the disc you're working on?" : "Delete this saved disc?"}</span>
                <span className="project-confirm-actions">
                  <button className="link-btn muted" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                  {confirm.kind === "open" ? (
                    <button className="link-btn" onClick={() => onOpen(p.id)}>
                      Open
                    </button>
                  ) : (
                    <button className="link-btn danger" onClick={() => remove(p.id)}>
                      Delete
                    </button>
                  )}
                </span>
              </div>
            ) : (
              <div className="project-actions">
                <button className="link-btn" onClick={() => open(p.id)}>
                  Open
                </button>
                <button className="link-btn muted" onClick={() => setConfirm({ id: p.id, kind: "delete" })}>
                  Delete
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

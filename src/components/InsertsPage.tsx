import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary, SavedTrack, ShelfEntry } from "../shared/api";
import { bridge, isDesktop } from "../lib/bridge";
import { buildInsertsHtml, PAPER, type InsertLayout, type Paper } from "../lib/inserts";

export interface InsertSource {
  title: string;
  tracks: SavedTrack[];
}

interface InsertsPageProps {
  current: InsertSource;
  /** Preselected source, e.g. from the Shelf ("shelf:<id>"). */
  initial?: string;
  onToast: (m: string) => void;
}

const LAYOUTS: Array<{ id: InsertLayout; label: string }> = [
  { id: "collage", label: "Collage" },
  { id: "cover", label: "One cover" },
  { id: "type", label: "Type only" },
];

export function InsertsPage({ current, initial, onToast }: InsertsPageProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  const [sourceId, setSourceId] = useState(initial ?? "current");
  const [source, setSource] = useState<InsertSource>(current);
  const [layout, setLayout] = useState<InsertLayout>("collage");
  const [paper, setPaper] = useState<Paper>(() => (navigator.language === "en-US" ? "Letter" : "A4"));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void bridge.listProjects().then(setProjects);
    void bridge.listShelf().then(setShelf);
  }, []);

  useEffect(() => {
    if (sourceId === "current") setSource(current);
    else if (sourceId.startsWith("project:")) void bridge.loadProject(sourceId.slice(8)).then((p) => p && setSource({ title: p.title, tracks: p.tracks }));
    else if (sourceId.startsWith("shelf:")) {
      const e = shelf.find((x) => x.id === sourceId.slice(6));
      if (e) setSource({ title: e.title, tracks: e.tracks });
    }
  }, [sourceId, current, shelf]);

  const html = useMemo(
    () =>
      buildInsertsHtml({
        title: source.title,
        tracks: source.tracks.map((t) => ({ title: t.title, artist: t.artist, durationSec: t.durationSec, cover: t.cover, color: t.color })),
        layout,
        paper,
        dateLabel: new Date().toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      }),
    [source, layout, paper],
  );

  const out = async (action: "pdf" | "print") => {
    if (!source.tracks.length) return onToast("This disc has no songs yet");
    setBusy(true);
    const r = await bridge.outputInserts(html, action, source.title, paper);
    setBusy(false);
    onToast(r.message);
  };

  const p = PAPER[paper];

  return (
    <div className="inserts">
      <div className="inserts-side">
        <h1 className="settings-title">Inserts</h1>
        <p className="settings-hint inserts-intro">A front cover, a back tray card with the tracklist, and a round disc label, at real CD case sizes with cut marks.</p>

        <div className="form">
          <div className="form-row">
            <span className="form-label">Disc</span>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="current">Current disc</option>
              {projects.length > 0 && (
                <optgroup label="Saved projects">
                  {projects.map((x) => (
                    <option key={x.id} value={`project:${x.id}`}>
                      {x.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {shelf.length > 0 && (
                <optgroup label="Shelf">
                  {shelf.map((x) => (
                    <option key={x.id} value={`shelf:${x.id}`}>
                      {x.title} ({new Date(x.burnedAt).toLocaleDateString()})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div className="form-row">
            <span className="form-label">Layout</span>
            <div className="segmented" role="radiogroup" aria-label="Insert layout">
              {LAYOUTS.map((l) => (
                <button key={l.id} role="radio" aria-checked={layout === l.id} className={layout === l.id ? "is-active" : ""} onClick={() => setLayout(l.id)}>
                  {layout === l.id && <span className="seg-pill" />}
                  <span className="seg-label">{l.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="form-row">
            <span className="form-label">Paper</span>
            <div className="segmented" role="radiogroup" aria-label="Paper size">
              {(Object.keys(PAPER) as Paper[]).map((k) => (
                <button key={k} role="radio" aria-checked={paper === k} className={paper === k ? "is-active" : ""} onClick={() => setPaper(k)}>
                  {paper === k && <span className="seg-pill" />}
                  <span className="seg-label">{k}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="form-note">Print at 100 % ("actual size"), not "fit to page", so the pieces come out the right size.</p>
        <div className="sheet-actions">
          <button className="btn" onClick={() => void out("print")} disabled={busy || !isDesktop}>
            Print…
          </button>
          <button className="btn btn-primary" onClick={() => void out("pdf")} disabled={busy || !isDesktop}>
            Save as PDF
          </button>
        </div>
        {!isDesktop && <p className="form-note">Printing and PDFs work in the desktop app.</p>}
      </div>

      <Preview html={html} widthMm={p.w} heightMm={p.h * 2} />
    </div>
  );
}

const PX_PER_MM = 96 / 25.4;

/** Shows the print page at true size, scaled down to fit the column. */
function Preview({ html, widthMm, heightMm }: { html: string; widthMm: number; heightMm: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const w = widthMm * PX_PER_MM, h = heightMm * PX_PER_MM;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // clientWidth includes the 16 px padding on each side.
    const ro = new ResizeObserver(() => setScale(Math.min(1, (el.clientWidth - 34) / w)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return (
    <div className="inserts-preview" ref={ref} aria-label="Print preview">
      <div style={{ width: w * scale, height: h * scale }}>
        <iframe title="Inserts preview" srcDoc={html} sandbox="" style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
      </div>
    </div>
  );
}

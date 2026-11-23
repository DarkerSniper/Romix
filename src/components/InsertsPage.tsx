import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary, SavedTrack, ShelfEntry } from "../shared/api";
import { bridge, isDesktop } from "../lib/bridge";
import { buildInsertsHtml, insertPages, listenUrl, mainArtist, PAPER, type FrontStyle, type Paper } from "../lib/inserts";

export interface InsertSource {
  title: string;
  tracks: SavedTrack[];
  /** Prepared-audio keys per track (for the waveform); YouTube songs can be derived. */
  keys?: Array<string | undefined>;
}

interface InsertsPageProps {
  current: InsertSource;
  /** Preselected source, e.g. from the Shelf ("shelf:<id>"). */
  initial?: string;
  onToast: (m: string) => void;
}

const FRONTS: Array<{ id: FrontStyle; label: string }> = [
  { id: "collage", label: "Collage" },
  { id: "cover", label: "One cover" },
  { id: "ring", label: "Ring (Romix disc)" },
  { id: "wave", label: "Waveform" },
  { id: "type", label: "Type only" },
];

const WAVE_BARS = 180;

/** Whole-disc loudness envelope from each song's analysed waveform, each song's share sized by its length. */
async function discWaveform(src: InsertSource): Promise<number[] | undefined> {
  const total = src.tracks.reduce((n, t) => n + t.durationSec, 0);
  if (!total) return undefined;
  const out: number[] = [];
  let any = false;
  for (let i = 0; i < src.tracks.length; i++) {
    const t = src.tracks[i];
    const key = src.keys?.[i] ?? (t.videoId ? `yt-${t.videoId}` : undefined);
    const a = key ? await bridge.analyze(key).catch(() => null) : null;
    const bins = Math.max(1, Math.round((t.durationSec / total) * WAVE_BARS));
    for (let b = 0; b < bins; b++) {
      if (!a?.peaks.length) {
        out.push(0.05);
        continue;
      }
      any = true;
      const from = Math.floor((b / bins) * a.peaks.length), to = Math.max(from + 1, Math.floor(((b + 1) / bins) * a.peaks.length));
      out.push(Math.max(...a.peaks.slice(from, to)));
    }
  }
  return any ? out : undefined;
}

export function InsertsPage({ current, initial, onToast }: InsertsPageProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  const [sourceId, setSourceId] = useState(initial ?? "current");
  const [source, setSource] = useState<InsertSource>(current);
  const [front, setFront] = useState<FrontStyle>("collage");
  const [format, setFormat] = useState<"single" | "booklet">("single");
  const [labelKind, setLabelKind] = useState<"sheet" | "printable">("sheet");
  const [paper, setPaper] = useState<Paper>(() => (navigator.language === "en-US" ? "Letter" : "A4"));
  const [title, setTitle] = useState(current.title);
  const [subtitle, setSubtitle] = useState("");
  const [spine, setSpine] = useState("");
  const [dedication, setDedication] = useState("");
  const [useVolume, setUseVolume] = useState(true);
  const [volume, setVolume] = useState(1);
  const [colorStrip, setColorStrip] = useState(true);
  const [qr, setQr] = useState(true);
  const [labelRing, setLabelRing] = useState(false);
  const [ruler, setRuler] = useState(true);
  const [customCover, setCustomCover] = useState<string | undefined>();
  const [waveform, setWaveform] = useState<number[] | undefined>();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void bridge.listProjects().then(setProjects);
    void bridge.listShelf().then(setShelf);
  }, []);

  // Load the chosen disc, and reset the text to its own.
  useEffect(() => {
    const apply = (s: InsertSource) => {
      setSource(s);
      setTitle(s.title);
      setSubtitle("");
      setSpine("");
    };
    if (sourceId === "current") apply(current);
    else if (sourceId.startsWith("project:")) void bridge.loadProject(sourceId.slice(8)).then((p) => p && apply({ title: p.title, tracks: p.tracks }));
    else if (sourceId.startsWith("shelf:")) {
      const e = shelf.find((x) => x.id === sourceId.slice(6));
      if (e) apply({ title: e.title, tracks: e.tracks });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, shelf]);

  // Volume number: the disc's place on the Shelf (or the next number for a new disc).
  useEffect(() => {
    const ordered = [...shelf].sort((a, b) => a.burnedAt - b.burnedAt);
    const at = sourceId.startsWith("shelf:") ? ordered.findIndex((e) => e.id === sourceId.slice(6)) : -1;
    setVolume(at >= 0 ? at + 1 : shelf.length + 1);
  }, [sourceId, shelf]);

  useEffect(() => {
    let live = true;
    setWaveform(undefined);
    if (front === "wave") void discWaveform(source).then((w) => live && setWaveform(w));
    return () => {
      live = false;
    };
  }, [front, source]);

  const input = {
    title: title.trim() || source.title,
    subtitle: subtitle.trim() || undefined,
    spineText: spine.trim() || undefined,
    dedication: dedication.trim() || undefined,
    volume: useVolume ? volume : null,
    tracks: source.tracks.map((t) => ({ title: t.title, artist: t.artist, durationSec: t.durationSec, cover: t.cover, coverHi: t.coverHi, color: t.color, videoId: t.videoId })),
    front,
    customCover,
    format,
    labelKind,
    colorStrip,
    qr,
    labelRing,
    ruler,
    paper,
    dateLabel: new Date().toLocaleDateString(undefined, { month: "short", year: "numeric" }),
    waveform,
  };
  const html = useMemo(() => buildInsertsHtml(input), [JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps

  const softCovers = source.tracks.filter((t) => !t.coverHi).length;
  const hasYouTube = Boolean(listenUrl(input.tracks));

  const out = async (action: "pdf" | "print") => {
    if (!source.tracks.length) return onToast("This disc has no songs yet");
    setBusy(true);
    const r = await bridge.outputInserts(html, action, input.title, paper);
    setBusy(false);
    onToast(r.message);
  };

  const pickImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return onToast("Choose an image file");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setCustomCover(await bridge.storeCover(String(reader.result)));
        setFront("cover");
      } catch (e) {
        onToast(e instanceof Error ? e.message : "Couldn't use that image");
      }
    };
    reader.readAsDataURL(file);
  };

  const pages = insertPages({ format, paper });
  const toggle = (label: string, value: boolean, set: (v: boolean) => void, hint?: string, disabled = false) => (
    <label className="form-row toggle-row" title={hint}>
      <span className={`form-label ${disabled ? "is-disabled" : ""}`}>{label}</span>
      <span className="toggle">
        <input type="checkbox" checked={value && !disabled} disabled={disabled} onChange={(e) => set(e.target.checked)} />
        <span className="toggle-track" aria-hidden="true">
          <span className="toggle-thumb" />
        </span>
      </span>
    </label>
  );
  const seg = <T extends string>(value: T, set: (v: T) => void, opts: Array<[T, string]>, label: string) => (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {opts.map(([id, text]) => (
        <button key={id} role="radio" aria-checked={value === id} className={value === id ? "is-active" : ""} onClick={() => set(id)}>
          {value === id && <span className="seg-pill" />}
          <span className="seg-label">{text}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="inserts">
      <div className="inserts-side">
        <h1 className="settings-title">Inserts</h1>
        <p className="settings-hint inserts-intro">Front cover, back tray card and disc label at real CD case sizes, with 3 mm bleed and cut marks.</p>

        <h2 className="settings-heading">Design</h2>
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
            <span className="form-label">Front</span>
            <select value={front} onChange={(e) => setFront(e.target.value as FrontStyle)}>
              {FRONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          {front === "cover" && (
            <div className="form-row">
              <span className="form-label">Image</span>
              <span className="form-actions">
                {customCover && (
                  <button className="link-btn muted" onClick={() => setCustomCover(undefined)}>
                    Use song cover
                  </button>
                )}
                <button className="btn small-btn" onClick={() => fileInput.current?.click()}>
                  {customCover ? "Change…" : "Your image…"}
                </button>
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
              </span>
            </div>
          )}
          <div className="form-row">
            <span className="form-label">Format</span>
            {seg(format, setFormat, [["single", "Single cover"], ["booklet", "Fold-out booklet"]], "Front format")}
          </div>
          <div className="form-row">
            <span className="form-label">Disc label</span>
            {seg(labelKind, setLabelKind, [["sheet", "Label sheet"], ["printable", "Printable disc"]], "Disc label type")}
          </div>
          <div className="form-row">
            <span className="form-label">Paper</span>
            {seg(paper, setPaper, (Object.keys(PAPER) as Paper[]).map((k) => [k, k]), "Paper size")}
          </div>
        </div>
        {front === "wave" && !waveform && <p className="form-note">The waveform needs the songs' audio. It appears once they're prepared (otherwise the cover falls back to Type only).</p>}

        <h2 className="settings-heading">Text</h2>
        <div className="form">
          <label className="form-row">
            <span className="form-label">Title</span>
            <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="form-row">
            <span className="form-label">Subtitle</span>
            <input className="form-input" value={subtitle} placeholder={mainArtist(source.tracks)} onChange={(e) => setSubtitle(e.target.value)} />
          </label>
          <label className="form-row">
            <span className="form-label">Spine</span>
            <input className="form-input" value={spine} placeholder={`${input.title} · ${subtitle || mainArtist(source.tracks)}`} onChange={(e) => setSpine(e.target.value)} />
          </label>
          <label className="form-row">
            <span className="form-label">Dedication</span>
            <input className="form-input" value={dedication} placeholder="For Mom, summer 2026" maxLength={160} onChange={(e) => setDedication(e.target.value)} />
          </label>
          <div className="form-row">
            <span className="form-label">Volume number</span>
            <span className="form-actions">
              {useVolume && <input className="form-input narrow" type="number" min={1} max={999} value={volume} onChange={(e) => setVolume(Math.max(1, Number(e.target.value) || 1))} aria-label="Volume number" />}
              <span className="toggle">
                <input type="checkbox" checked={useVolume} onChange={(e) => setUseVolume(e.target.checked)} aria-label="Show a volume number" />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
              </span>
            </span>
          </div>
        </div>

        <h2 className="settings-heading">Extras</h2>
        <div className="form">
          {toggle("Song colour strip", colorStrip, setColorStrip, "A row of each song's colour, sized by its length")}
          {toggle("QR code to listen", qr, setQr, hasYouTube ? "Scanning it plays the disc's songs on YouTube" : "Only for YouTube songs", !hasYouTube)}
          {toggle("Song titles around the label", labelRing, setLabelRing)}
          {toggle("Size check ruler", ruler, setRuler, "A 10 cm line to check the printer didn't scale the page")}
        </div>

        {softCovers > 0 && (
          <p className="form-note is-warning">
            {softCovers} {softCovers === 1 ? "cover was" : "covers were"} added before print-quality covers and may print soft. Re-adding {softCovers === 1 ? "that song" : "those songs"} fetches a sharper copy.
          </p>
        )}
        <p className="form-note">
          Print at 100 % ("actual size"), not "fit to page".{format === "booklet" ? " The booklet's inside goes on the back of page 1: print double-sided, flipping on the short edge (try plain paper first)." : ""}
        </p>
        <div className="sheet-actions inserts-actions">
          <button className="btn" onClick={() => void out("print")} disabled={busy || !isDesktop}>
            Print…
          </button>
          <button className="btn btn-primary" onClick={() => void out("pdf")} disabled={busy || !isDesktop}>
            Save as PDF
          </button>
        </div>
        {!isDesktop && <p className="form-note">Printing and PDFs work in the desktop app.</p>}
      </div>

      <Preview html={html} widthMm={Math.max(...pages.map((p) => p.w))} heightMm={pages.reduce((n, p) => n + p.h, 0)} />
    </div>
  );
}

const PX_PER_MM = 96 / 25.4;

/** Shows the print pages at true size, scaled down to fit the column. */
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

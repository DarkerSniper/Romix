import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { CoverEditor } from "./CoverEditor";
import type { Project, ProjectSummary, SavedTrack, ShelfEntry } from "../shared/api";
import { bridge, isDesktop } from "../lib/bridge";
import { buildInsertsHtml, insertPages, listenUrl, mainArtist, PAPER, type InsertInput, type Paper } from "../lib/inserts";
import {
  AUTO,
  FONT_LABEL,
  LAYOUT_LABEL,
  PRESET_LABEL,
  SECTION_LABEL,
  applyPreset,
  copyLookToAll,
  defaultDesign,
  defaultLook,
  layoutRects,
  layoutsFor,
  lookOf,
  refSource,
  remapDesign,
  sectionBox,
  sectionsFor,
  songKey,
  textOnPictures,
  tileShape,
  tileSource,
  toHex,
  type FontId,
  type FrontMode,
  type ImageRef,
  type InsertDesign,
  type LayoutId,
  type PresetId,
  type SectionId,
  type SectionLook,
  type Tile,
} from "../lib/insertDesign";

export interface InsertSource {
  title: string;
  tracks: SavedTrack[];
  /** Prepared-audio keys per track (for the waveform); YouTube songs can be derived. */
  keys?: Array<string | undefined>;
  design?: InsertDesign;
}

interface InsertsPageProps {
  current: InsertSource;
  /** The saved project the open disc belongs to, if any. */
  currentProjectId: string | null;
  /** The open disc's design changed (it's saved with the disc). */
  onCurrentDesign: (d: InsertDesign) => void;
  onSaveCurrent: () => void;
  /** Preselected source, e.g. from the Shelf ("shelf:<id>"). */
  initial?: string;
  onToast: (m: string) => void;
}

const FRONTS: Array<{ id: FrontMode; label: string }> = [
  { id: "pictures", label: "Pictures" },
  { id: "ring", label: "Ring (Romix disc)" },
  { id: "wave", label: "Waveform" },
  { id: "type", label: "Type only" },
];

const WAVE_BARS = 180;
const PAPER_KEY = "romix.insertsPaper";
const BASE_SWATCHES = ["#ffffff", "#f3ede1", "#e6e6e8", "#8e8e93", "#1c1c1e", "#000000"];

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

const readPaper = (): Paper => {
  try {
    const v = localStorage.getItem(PAPER_KEY);
    if (v === "A4" || v === "Letter") return v;
  } catch {
    /* default below */
  }
  return navigator.language === "en-US" ? "Letter" : "A4";
};

/** Reads a picked file as a data URL and its pixel size. */
function readImage(file: File): Promise<{ dataUrl: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that image"));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => resolve({ dataUrl, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error("That image couldn't be opened"));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/** Which tile is being framed: a section tile, or the Ring design's centre. */
type Framing = { section: SectionId; index: number; centre?: boolean };

export function InsertsPage({ current, currentProjectId, onCurrentDesign, onSaveCurrent, initial, onToast }: InsertsPageProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  const [sourceId, setSourceId] = useState(initial && initial !== `project:${currentProjectId}` ? initial : "current");
  const [other, setOther] = useState<{ source: InsertSource; project?: Project; shelfId?: string } | null>(null);
  const [otherDesign, setOtherDesign] = useState<InsertDesign | undefined>();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [paper, setPaperState] = useState<Paper>(readPaper);
  const [section, setSection] = useState<SectionId>("front");
  const [tileAt, setTileAt] = useState<number | "centre">(0);
  const [framing, setFraming] = useState<Framing | null>(null);
  const [waveform, setWaveform] = useState<number[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const isCurrent = sourceId === "current";
  const source = isCurrent ? current : (other?.source ?? { title: "", tracks: [] });
  const design = (isCurrent ? current.design : otherDesign) ?? defaultDesign();
  const tracks = source.tracks;

  useEffect(() => {
    void bridge.listProjects().then(setProjects);
    void bridge.listShelf().then(setShelf);
  }, []);

  // Load a saved project or Shelf disc, with its own design.
  useEffect(() => {
    setOther(null);
    setOtherDesign(undefined);
    setSaveState("idle");
    if (sourceId.startsWith("project:")) {
      void bridge.loadProject(sourceId.slice(8)).then((p) => {
        if (!p) return;
        setOther({ source: { title: p.title, tracks: p.tracks }, project: p });
        setOtherDesign(p.inserts);
      });
    } else if (sourceId.startsWith("shelf:")) {
      const e = shelf.find((x) => x.id === sourceId.slice(6));
      if (e) {
        setOther({ source: { title: e.title, tracks: e.tracks }, shelfId: e.id });
        setOtherDesign(e.inserts);
      }
    }
  }, [sourceId, shelf]);

  /* ---------- changing and saving the design ---------- */

  // Edits on a saved project or Shelf disc save to it on their own (shortly after you stop changing things).
  const pending = useRef<{ design: InsertDesign; target: NonNullable<typeof other> } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    setSaveState("saving");
    try {
      if (p.target.project) await bridge.saveProject({ ...p.target.project, inserts: p.design });
      else if (p.target.shelfId) await bridge.setShelfInserts(p.target.shelfId, p.design);
      setSaveState("saved");
    } catch {
      setSaveState("idle");
      onToast("Couldn't save the inserts");
    }
  }, [onToast]);
  useEffect(() => () => void flush(), [flush, sourceId]);

  const latest = useRef(design);
  latest.current = design;
  const update = (fn: (d: InsertDesign) => InsertDesign) => {
    const next = fn(latest.current);
    latest.current = next;
    if (isCurrent) return onCurrentDesign(next);
    if (!other) return;
    setOtherDesign(next);
    pending.current = { design: next, target: other };
    setSaveState("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
  };
  const set = <K extends keyof InsertDesign>(key: K, value: InsertDesign[K]) => update((d) => ({ ...d, [key]: value }));

  const setPaper = (p: Paper) => {
    setPaperState(p);
    try {
      localStorage.setItem(PAPER_KEY, p);
    } catch {
      /* this session only */
    }
  };

  // Keep the chosen section valid for the format.
  const sections = sectionsFor(design.format);
  const sec = sections.includes(section) ? section : "front";
  const look = lookOf(design, sec, tracks);
  const setLook = (patch: Partial<SectionLook>) =>
    update((d) => ({ ...d, sections: { ...d.sections, [sec]: { ...lookOf(d, sec, tracks), ...patch } } }));
  const setTile = (i: number | "centre", tile: Tile) => {
    if (i === "centre") return set("ringCentre", tile);
    const tiles = [...look.tiles];
    while (tiles.length <= i) tiles.push({});
    tiles[i] = tile;
    setLook({ tiles });
  };

  /* ---------- volume number: automatic = the disc's place on the Shelf ---------- */
  const autoVolume = useMemo(() => {
    const ordered = [...shelf].sort((a, b) => a.burnedAt - b.burnedAt);
    const at = sourceId.startsWith("shelf:") ? ordered.findIndex((e) => e.id === sourceId.slice(6)) : -1;
    return at >= 0 ? at + 1 : shelf.length + 1;
  }, [sourceId, shelf]);
  const volume = design.volume === null ? null : (design.volume ?? autoVolume);

  useEffect(() => {
    let live = true;
    setWaveform(undefined);
    if (design.front === "wave") void discWaveform(source).then((w) => live && setWaveform(w));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.front, source.tracks]);

  const input: InsertInput = {
    title: design.title?.trim() || source.title,
    subtitle: design.subtitle?.trim() || undefined,
    spineText: design.spine?.trim() || undefined,
    dedication: design.dedication?.trim() || undefined,
    volume,
    tracks: tracks.map((t) => ({ title: t.title, artist: t.artist, durationSec: t.durationSec, cover: t.cover, coverHi: t.coverHi, color: t.color, videoId: t.videoId, filePath: t.filePath })),
    design,
    paper,
    dateLabel: new Date().toLocaleDateString(undefined, { month: "short", year: "numeric" }),
    waveform,
  };
  const key = JSON.stringify(input);
  const previewHtml = useMemo(() => buildInsertsHtml({ ...input, highlight: sec }), [key, sec]); // eslint-disable-line react-hooks/exhaustive-deps

  const softCovers = tracks.filter((t) => !t.coverHi || (t.coverPx ?? 0) < 1000).length;
  const sharpest = Math.max(0, ...tracks.map((t) => t.coverPx ?? 0));
  const hasYouTube = Boolean(listenUrl(input.tracks));

  const out = async (action: "pdf" | "print") => {
    if (!tracks.length) return onToast("This disc has no songs yet");
    setBusy(true);
    const r = await bridge.outputInserts(buildInsertsHtml(input), action, input.title, paper);
    setBusy(false);
    onToast(r.message);
  };

  /* ---------- your pictures ---------- */

  const addImages = async (files: File[]) => {
    const ok = files.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (!ok.length) return onToast("Choose JPG, PNG or WebP pictures");
    const added: InsertDesign["images"] = [];
    for (const f of ok) {
      try {
        const { dataUrl, w, h } = await readImage(f);
        added.push({ id: crypto.randomUUID(), src: await bridge.storeCover(dataUrl), w, h });
      } catch (e) {
        onToast(e instanceof Error ? e.message : "Couldn't use that picture");
      }
    }
    if (!added.length) return;
    update((d) => ({ ...d, images: [...d.images, ...added] }));
    if (ok.length > added.length) return;
    onToast(added.length === 1 ? "Picture added. Click a tile to place it." : `${added.length} pictures added. Click a tile to place them.`);
  };
  const removeImage = (id: string) => {
    const gone = design.images.find((i) => i.id === id)?.src;
    update((d) => remapDesign(d, (u) => (u === gone ? undefined : u)));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropping(false);
    void addImages([...e.dataTransfer.files]);
  };

  /* ---------- front design, layouts ---------- */

  const setFront = (mode: FrontMode) =>
    update((d) => {
      const cur = d.sections.front;
      if (!cur) return { ...d, front: mode };
      const def = defaultLook("front", mode, tracks);
      return { ...d, front: mode, sections: { ...d.sections, front: { ...cur, layout: def.layout, bg: mode === "pictures" ? cur.bg : def.bg } } };
    });

  const setLayout = (layout: LayoutId) => {
    const patch: Partial<SectionLook> = { layout };
    // Text sitting on pictures needs a wash to stay readable.
    if (look.layout === "none" && layout !== "none" && layout !== "strip" && textOnPictures(sec, design.front) && look.wash === 0) patch.wash = 0.45;
    setLook(patch);
    setTileAt(0);
  };

  const pictureChoices: Array<{ ref: ImageRef; src: string; label: string }> = [
    ...tracks.map((t) => ({ ref: { song: songKey(t) } as ImageRef, src: t.cover || t.coverHi || "", label: `${t.title} · ${t.artist}` })),
    ...design.images.map((i, n) => ({ ref: { own: i.id } as ImageRef, src: i.src, label: `Your picture ${n + 1}` })),
  ];
  const sameRef = (a?: ImageRef, b?: ImageRef) => Boolean((!a && !b) || (a && b && JSON.stringify(a) === JSON.stringify(b)));

  const rects = layoutRects(look.layout, look.count);
  const ringCentre = sec === "front" && design.front === "ring";
  const at: number | "centre" = tileAt === "centre" ? (ringCentre ? "centre" : 0) : Math.min(tileAt, Math.max(0, rects.length - 1));
  const currentTile: Tile | undefined = at === "centre" ? design.ringCentre : look.tiles[at];
  const showTiles = rects.length > 0 || ringCentre;

  const framingInfo = (() => {
    if (!framing) return null;
    const lk = lookOf(design, framing.section, tracks);
    const tile = framing.centre ? design.ringCentre : lk.tiles[framing.index];
    const src = refSource(tile?.ref, design, tracks, framing.index);
    const shape = framing.centre ? { aspect: 1, widthMm: 50 } : tileShape(framing.section, lk, framing.index);
    const round = Boolean(framing.centre) || (framing.section === "label" && lk.layout === "one");
    const count = layoutRects(lk.layout, lk.count).length;
    const place = framing.centre ? "Ring centre" : `${SECTION_LABEL[framing.section]}${count > 1 ? ` · picture ${framing.index + 1}` : ""}`;
    return { tile, src, shape, round, place };
  })();
  const applyFraming = async (r: { dataUrl: string; crop: Tile["crop"]; aspect: number }) => {
    if (!framing || !framingInfo) return;
    const f = framing;
    try {
      const framed = await bridge.storeCover(r.dataUrl);
      // Framing an automatic tile pins it to the song it showed.
      const autoSong = tracks.length ? tracks[f.index % tracks.length] : undefined;
      const ref = framingInfo.tile?.ref ?? (autoSong ? ({ song: songKey(autoSong) } as ImageRef) : undefined);
      const tile: Tile = { ref, framed, crop: r.crop, aspect: r.aspect };
      if (f.centre) set("ringCentre", tile);
      else
        update((d) => {
          const lk = lookOf(d, f.section, tracks);
          const tiles = [...lk.tiles];
          while (tiles.length <= f.index) tiles.push({});
          tiles[f.index] = tile;
          return { ...d, sections: { ...d.sections, [f.section]: { ...lk, tiles } } };
        });
      setFraming(null);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't save the framing");
    }
  };

  /* ---------- small controls ---------- */

  const pages = insertPages({ format: design.format, paper });
  const toggle = (label: string, value: boolean, onChange: (v: boolean) => void, hint?: string, disabled = false) => (
    <label className="form-row toggle-row" title={hint}>
      <span className={`form-label ${disabled ? "is-disabled" : ""}`}>{label}</span>
      <span className="toggle">
        <input type="checkbox" checked={value && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track" aria-hidden="true">
          <span className="toggle-thumb" />
        </span>
      </span>
    </label>
  );
  const seg = <T extends string>(value: T, onChange: (v: T) => void, opts: Array<[T, string]>, label: string) => (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {opts.map(([id, text]) => (
        <button key={id} role="radio" aria-checked={value === id} className={value === id ? "is-active" : ""} onClick={() => onChange(id)}>
          {value === id && <span className="seg-pill" />}
          <span className="seg-label">{text}</span>
        </button>
      ))}
    </div>
  );
  const songColours = [...new Set(tracks.map((t) => toHex(t.color)).filter((c): c is string => Boolean(c)))].slice(0, 8);
  const colourRow = (value: string, onChange: (c: string) => void, label: string, auto?: boolean) => (
    <span className="swatches" role="group" aria-label={label}>
      {auto && (
        <button className={`swatch-auto ${value === AUTO ? "is-active" : ""}`} onClick={() => onChange(AUTO)} title="Picks black or white for contrast">
          Auto
        </button>
      )}
      {(auto ? [] : [...BASE_SWATCHES, ...songColours.filter((c) => !BASE_SWATCHES.includes(c))]).map((c) => (
        <button key={c} className={`swatch ${value === c ? "is-active" : ""}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} title={c} />
      ))}
      <input type="color" className={`swatch-custom ${auto && value !== AUTO ? "is-active" : ""}`} value={value === AUTO ? "#000000" : value} onChange={(e) => onChange(e.target.value)} aria-label={`Custom ${label.toLowerCase()}`} title="Any colour" />
    </span>
  );

  const statusLine = isCurrent
    ? currentProjectId
      ? "Part of this disc. Save the disc (Ctrl+S) to keep changes."
      : "Part of this disc. Kept when you save the disc."
    : saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? `Saved to ${other?.shelfId ? "this Shelf disc" : "this project"}`
        : `Changes save to ${sourceId.startsWith("shelf:") ? "this Shelf disc" : "this project"} automatically`;

  const others = projects.filter((x) => x.id !== currentProjectId);

  return (
    <div className="inserts">
      <div className="inserts-side">
        <h1 className="settings-title">Inserts</h1>
        <p className="settings-hint inserts-intro">Front cover, back tray card and disc label at real CD case sizes, with 3 mm bleed and cut marks. The design is saved with the disc.</p>

        <h2 className="settings-heading">Disc</h2>
        <div className="form">
          <div className="form-row">
            <span className="form-label">
              Disc
              <span className="design-hint">{statusLine}</span>
            </span>
            <select
              value={sourceId}
              onChange={(e) => {
                void flush();
                setSourceId(e.target.value);
              }}
            >
              <option value="current">Current disc</option>
              {others.length > 0 && (
                <optgroup label="Saved projects">
                  {others.map((x) => (
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
          {isCurrent && tracks.length > 0 && (
            <div className="form-row">
              <span className="form-label">{currentProjectId ? "Saved project" : "Not saved yet"}</span>
              <button className="btn small-btn" onClick={onSaveCurrent}>
                {currentProjectId ? "Save" : "Save disc"}
              </button>
            </div>
          )}
        </div>

        <h2 className="settings-heading">Design</h2>
        <div className="form">
          <div className="form-row">
            <span className="form-label">Front</span>
            <select value={design.front} onChange={(e) => setFront(e.target.value as FrontMode)}>
              {FRONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <span className="form-label">Format</span>
            {seg(design.format, (v) => set("format", v), [["single", "Single cover"], ["booklet", "Fold-out booklet"]], "Front format")}
          </div>
          <div className="form-row">
            <span className="form-label">Disc label</span>
            {seg(design.labelKind, (v) => set("labelKind", v), [["sheet", "Label sheet"], ["printable", "Printable disc"]], "Disc label type")}
          </div>
          <div className="form-row">
            <span className="form-label">Paper</span>
            {seg(paper, setPaper, (Object.keys(PAPER) as Paper[]).map((k) => [k, k]), "Paper size")}
          </div>
          <div className="form-row">
            <span className="form-label">
              Colours
              <span className="design-hint">For every part, keeping your pictures</span>
            </span>
            <span className="preset-row">
              {(Object.keys(PRESET_LABEL) as PresetId[]).map((p) => (
                <button key={p} className="btn small-btn" onClick={() => update((d) => applyPreset(d, p, tracks))}>
                  {PRESET_LABEL[p]}
                </button>
              ))}
            </span>
          </div>
        </div>
        {design.front === "wave" && !waveform && <p className="form-note">The waveform needs the songs' audio. It appears once they're prepared (otherwise the cover falls back to Type only).</p>}

        <h2 className="settings-heading">Your pictures</h2>
        <div
          className={`picture-library ${dropping ? "is-dropping" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
        >
          {design.images.map((i, n) => (
            <span key={i.id} className="library-item">
              <img src={i.src} alt={`Your picture ${n + 1}`} />
              <button className="library-remove" onClick={() => removeImage(i.id)} aria-label={`Remove picture ${n + 1}`} title="Remove">
                <X size={11} />
              </button>
            </span>
          ))}
          <button className="library-add" onClick={() => fileInput.current?.click()}>
            {design.images.length ? "Add…" : "Add pictures, or drop them here"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(e) => {
              void addImages([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>

        <h2 className="settings-heading">Each part</h2>
        <div className="section-chips" role="tablist" aria-label="Part of the insert">
          {sections.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={sec === id}
              className={`chip ${sec === id ? "is-active" : ""}`}
              onClick={() => {
                setSection(id);
                setTileAt(0);
              }}
            >
              {SECTION_LABEL[id]}
            </button>
          ))}
        </div>
        <div className="form">
          <div className="form-row">
            <span className="form-label">Background</span>
            {colourRow(look.bg, (c) => setLook({ bg: c }), "Background colour")}
          </div>
          <div className="form-row">
            <span className="form-label">Pictures</span>
            <select value={look.layout} onChange={(e) => setLayout(e.target.value as LayoutId)} aria-label="Picture layout">
              {layoutsFor(sec).map((l) => (
                <option key={l} value={l}>
                  {LAYOUT_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
          {(look.layout === "strip" || look.layout === "stack") && (
            <label className="form-row">
              <span className="form-label">How many</span>
              <span className="slider">
                <input type="range" min={2} max={8} step={1} value={look.count} onChange={(e) => setLook({ count: Number(e.target.value) })} />
                {look.count}
              </span>
            </label>
          )}
        </div>

        {showTiles && (
          <div className="tile-editor">
            <TileMap section={sec} design={design} look={look} tracks={tracks} selected={at} ringCentre={ringCentre} onSelect={setTileAt} />
            <div className="tile-picker">
              <p className="tile-picker-title">{at === "centre" ? "Ring centre" : rects.length > 1 ? `Picture ${at + 1} of ${rects.length}` : "Picture"}</p>
              <div className="tile-choices" role="listbox" aria-label="Choose a picture">
                <button
                  role="option"
                  aria-selected={!currentTile?.ref}
                  className={`tile-choice auto ${!currentTile?.ref ? "is-active" : ""}`}
                  onClick={() => setTile(at, {})}
                  title={at === "centre" ? "No picture in the centre" : "Automatic: the songs' covers in order"}
                >
                  {at === "centre" ? "None" : "Auto"}
                </button>
                {pictureChoices.map((c, n) => (
                  <button key={n} role="option" aria-selected={sameRef(currentTile?.ref, c.ref)} className={`tile-choice ${sameRef(currentTile?.ref, c.ref) ? "is-active" : ""}`} onClick={() => setTile(at, { ref: c.ref })} title={c.label}>
                    {c.src ? <img src={c.src} alt="" /> : <span className="tile-empty" />}
                  </button>
                ))}
              </div>
              <div className="tile-actions">
                <button
                  className="link-btn"
                  onClick={() => setFraming(at === "centre" ? { section: "front", index: 0, centre: true } : { section: sec, index: at })}
                  disabled={at === "centre" ? !currentTile?.ref : !tracks.length && !currentTile?.ref}
                >
                  Frame…
                </button>
                {currentTile?.framed && (
                  <button className="link-btn muted" onClick={() => setTile(at, currentTile.ref ? { ref: currentTile.ref } : {})}>
                    Reset framing
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="form">
          {rects.length > 0 && (
            <label className="form-row">
              <span className="form-label">Wash over pictures</span>
              <span className="slider wash-slider">
                <span>Lighten</span>
                <input type="range" min={-1} max={1} step={0.05} value={look.wash} onChange={(e) => setLook({ wash: Number(e.target.value) })} aria-label="Wash: lighten or darken the pictures" />
                <span>Darken</span>
              </span>
            </label>
          )}
          {rects.length > 1 && (
            <div className="form-row">
              <span className="form-label">Space between</span>
              <span className="form-actions">
                <span className="slider">
                  <input type="range" min={0} max={4} step={0.25} value={look.gap} onChange={(e) => setLook({ gap: Number(e.target.value) })} aria-label="Space between pictures (mm)" />
                  {look.gap} mm
                </span>
                {look.gap > 0 && <input type="color" className="swatch-custom" value={look.gapColor} onChange={(e) => setLook({ gapColor: e.target.value })} aria-label="Colour of the space between pictures" title="Colour" />}
              </span>
            </div>
          )}
          <div className="form-row">
            <span className="form-label">Text colour</span>
            {colourRow(look.ink, (c) => setLook({ ink: c }), "Text colour", true)}
          </div>
          <div className="form-row">
            <span className="form-label">
              Accent
              <span className="design-hint">Track numbers</span>
            </span>
            {colourRow(look.accent, (c) => setLook({ accent: c }), "Accent colour", true)}
          </div>
          <div className="form-row">
            <span className="form-label" />
            <button className="link-btn" onClick={() => update((d) => copyLookToAll(d, sec, tracks))}>
              Use these colours for every part
            </button>
          </div>
        </div>

        <h2 className="settings-heading">Type</h2>
        <div className="form">
          <div className="form-row">
            <span className="form-label">Font</span>
            <select value={design.font} onChange={(e) => set("font", e.target.value as FontId)}>
              {(Object.keys(FONT_LABEL) as FontId[]).map((f) => (
                <option key={f} value={f}>
                  {FONT_LABEL[f]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <span className="form-label">Front title</span>
            {seg(design.titlePos, (v) => set("titlePos", v), [["bottom", "Bottom"], ["top", "Top"], ["center", "Centre"], ["hidden", "Hidden"]], "Front title position")}
          </div>
          <div className="form-row">
            <span className="form-label">
              Title band
              <span className="design-hint">Behind the title on the front and label</span>
            </span>
            {seg(design.band, (v) => set("band", v), [["dark", "Dark"], ["light", "Light"], ["none", "None"]], "Title band")}
          </div>
          <div className="form-row">
            <span className="form-label">Title size</span>
            {seg(design.titleSize, (v) => set("titleSize", v), [["s", "Small"], ["m", "Medium"], ["l", "Large"]], "Title size")}
          </div>
        </div>

        <h2 className="settings-heading">Text</h2>
        <div className="form">
          <label className="form-row">
            <span className="form-label">Title</span>
            <input className="form-input" value={design.title ?? ""} placeholder={source.title} onChange={(e) => set("title", e.target.value || undefined)} />
          </label>
          <label className="form-row">
            <span className="form-label">Subtitle</span>
            <input className="form-input" value={design.subtitle ?? ""} placeholder={mainArtist(tracks)} onChange={(e) => set("subtitle", e.target.value || undefined)} />
          </label>
          <label className="form-row">
            <span className="form-label">Spine</span>
            <input className="form-input" value={design.spine ?? ""} placeholder={`${input.title} · ${design.subtitle || mainArtist(tracks)}`} onChange={(e) => set("spine", e.target.value || undefined)} />
          </label>
          <label className="form-row">
            <span className="form-label">Dedication</span>
            <input className="form-input" value={design.dedication ?? ""} placeholder="For Mom, summer 2026" maxLength={160} onChange={(e) => set("dedication", e.target.value || undefined)} />
          </label>
          <div className="form-row">
            <span className="form-label">Volume number</span>
            <span className="form-actions">
              {volume !== null && (
                <input className="form-input narrow" type="number" min={1} max={999} value={volume} onChange={(e) => set("volume", Math.max(1, Number(e.target.value) || 1))} aria-label="Volume number" />
              )}
              <span className="toggle">
                <input type="checkbox" checked={volume !== null} onChange={(e) => set("volume", e.target.checked ? undefined : null)} aria-label="Show a volume number" />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
              </span>
            </span>
          </div>
        </div>

        <h2 className="settings-heading">Extras</h2>
        <div className="form">
          {toggle("Song colour strip", design.colorStrip, (v) => set("colorStrip", v), "A row of each song's colour, sized by its length")}
          {toggle("QR code to listen", design.qr, (v) => set("qr", v), hasYouTube ? "Scanning it plays the disc's songs on YouTube" : "Only for YouTube songs", !hasYouTube)}
          {toggle("Song titles around the label", design.labelRing, (v) => set("labelRing", v))}
          {toggle("Size check ruler", design.ruler, (v) => set("ruler", v), "A 10 cm line to check the printer didn't scale the page")}
        </div>

        {softCovers > 0 && (design.front === "pictures" || design.front === "ring") && (
          <p className="form-note is-warning">
            {softCovers} of {tracks.length} covers will print a little soft at CD size
            {sharpest > 0 ? ` (music-video stills top out around ${Math.round(sharpest / (120 / 25.4))} dpi; album art is sharper)` : ""}. For a crisp front, use your own pictures, more and smaller tiles, or Ring, where each cover is shown smaller.
          </p>
        )}
        <p className="form-note">
          Print at 100 % ("actual size"), not "fit to page".{design.format === "booklet" ? " The booklet's inside goes on the back of page 1: print double-sided, flipping on the short edge (try plain paper first)." : ""}
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

      <Preview html={previewHtml} widthMm={Math.max(...pages.map((p) => p.w))} heightMm={pages.reduce((n, p) => n + p.h, 0)} />

      <AnimatePresence>
        {framing && framingInfo?.src && (
          <CoverEditor
            key={`${framing.section}-${framing.index}-${framing.centre ? "c" : ""}`}
            src={framingInfo.src}
            initial={framingInfo.tile?.framed ? framingInfo.tile.crop : undefined}
            aspect={framingInfo.shape.aspect}
            widthMm={framingInfo.shape.widthMm}
            round={framingInfo.round}
            place={framingInfo.place}
            onApply={(r) => void applyFraming(r)}
            onClose={() => setFraming(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** A small map of the part's layout: click a tile to choose its picture. */
function TileMap({
  section,
  design,
  look,
  tracks,
  selected,
  ringCentre,
  onSelect,
}: {
  section: SectionId;
  design: InsertDesign;
  look: SectionLook;
  tracks: SavedTrack[];
  selected: number | "centre";
  ringCentre: boolean;
  onSelect: (i: number | "centre") => void;
}) {
  const box = sectionBox(section);
  const scale = Math.min(150 / box.w, 130 / box.h);
  const w = Math.max(14, box.w * scale), h = box.h * scale;
  const rects = layoutRects(look.layout, look.count);
  const centreSrc = design.ringCentre?.ref || design.ringCentre?.framed ? tileSource(design.ringCentre, design, tracks, 0, 1).src : "";
  return (
    <div className={`tile-map ${section === "label" ? "is-round" : ""}`} style={{ width: w, height: h, background: look.bg }} aria-label={`${SECTION_LABEL[section]} layout`}>
      {rects.map((r, i) => {
        const { src } = tileSource(look.tiles[i], design, tracks, i, tileShape(section, look, i).aspect);
        return (
          <button
            key={i}
            className={`tile-cell ${selected === i ? "is-active" : ""}`}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, backgroundImage: src ? `url("${src}")` : undefined }}
            onClick={() => onSelect(i)}
            aria-label={`Picture ${i + 1}`}
            aria-pressed={selected === i}
          />
        );
      })}
      {ringCentre && (
        <button
          className={`tile-cell centre ${selected === "centre" ? "is-active" : ""}`}
          style={{ backgroundImage: centreSrc ? `url("${centreSrc}")` : undefined }}
          onClick={() => onSelect("centre")}
          aria-label="Ring centre"
          aria-pressed={selected === "centre"}
          title="Ring centre"
        />
      )}
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

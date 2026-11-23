import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Upload, Shuffle } from "lucide-react";
import type { DiscOptions, Page, Track } from "./types";
import { CD_MAX_SEC, capacityLevel, discLength, formatDiscTime, formatTime, parseYouTubeLink } from "./lib/cd";
import { initialTracks } from "./lib/mock";
import { makeCover } from "./lib/covers";
import { processCover } from "./lib/coverArt";
import { bridge, isDesktop } from "./lib/bridge";
import { Disc } from "./components/Disc";
import { TrackList } from "./components/TrackList";
import { LinkInput } from "./components/LinkInput";
import { OptionsBar } from "./components/OptionsBar";
import { Sidebar } from "./components/Sidebar";
import { BurnSheet } from "./components/BurnSheet";
import { SettingsPage } from "./components/SettingsPage";
import { useTheme } from "./lib/theme";
import { usePlayer } from "./lib/player";
import { Transport } from "./components/Transport";
import { SetupSheet, useDeps } from "./components/SetupSheet";
import type { PrepSource, PrepUpdate, SavedTrack, ShelfEntry, TrackAnalysis, TrackTrim } from "./shared/api";
import { ProjectsPage } from "./components/ProjectsPage";
import { ShelfPage } from "./components/ShelfPage";
import { InsertsPage } from "./components/InsertsPage";
import { TrimSheet } from "./components/TrimSheet";
import { useDrives } from "./lib/drives";
import { useBurnPrefs } from "./lib/burnPrefs";
import { flowOrder } from "./lib/analysis";

function audioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(a.duration);
    a.onerror = () => reject(new Error("Unreadable audio file"));
    a.src = url;
  });
}

interface Toast {
  message: string;
  action?: { label: string; run: () => void };
}

const CACHE_KEY = "romix.cacheLimitGB";
const readCacheLimit = () => {
  try {
    return Number(localStorage.getItem(CACHE_KEY)) || 5;
  } catch {
    return 5;
  }
};

/** A row's saved form (projects, shelf). */
const toSaved = (t: Track): SavedTrack => ({
  title: t.title,
  artist: t.artist,
  durationSec: t.durationSec,
  cover: t.cover,
  coverHi: t.coverHi,
  color: t.color,
  source: t.source,
  videoId: t.videoId,
  filePath: t.filePath,
  url: t.url,
  trimStartSec: t.trimStartSec,
  trimEndSec: t.trimEndSec,
});

export default function App() {
  const theme = useTheme();
  const [page, setPage] = useState<Page>("disc");
  const [title, setTitle] = useState("Untitled mix");
  // The browser preview starts with sample songs; the real app starts with an empty disc.
  const [tracks, setTracks] = useState<Track[]>(() => (isDesktop ? [] : initialTracks()));
  const [options, setOptions] = useState<DiscOptions>({ gapMode: "gap2", crossfadeSec: 3, normalize: false, speedPct: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [burning, setBurning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToastState] = useState<Toast | null>(null);
  const [prep, setPrep] = useState<Record<string, PrepUpdate>>({});
  const [analysis, setAnalysis] = useState<Record<string, TrackAnalysis>>({});
  const [trimId, setTrimId] = useState<string | null>(null);
  const [insertSource, setInsertSource] = useState<string | undefined>(undefined);
  const [cacheLimitGB, setCacheLimitState] = useState(readCacheLimit);
  const setup = useDeps();
  const player = usePlayer();
  const drives = useDrives();
  const [burnPrefs, setBurnPrefs] = useBurnPrefs();
  const [projectId, setProjectId] = useState<string | null>(null);

  const setToast = useCallback((m: string | null, action?: Toast["action"]) => setToastState(m ? { message: m, action } : null), []);
  const setCacheLimit = (gb: number) => {
    setCacheLimitState(gb);
    try {
      localStorage.setItem(CACHE_KEY, String(gb));
    } catch {
      /* session only */
    }
  };

  /* ---------- effective lengths (trims + speed) ---------- */

  const speed = 1 + (options.speedPct ?? 0) / 100;
  const effDuration = useCallback(
    (t: Track) => ((t.trimEndSec ?? t.durationSec) - (t.trimStartSec ?? 0)) / speed,
    [speed],
  );
  const ready = useMemo(() => tracks.filter((t) => t.status === "ready"), [tracks]);
  const effReady = useMemo(() => ready.map((t) => ({ ...t, durationSec: effDuration(t) })), [ready, effDuration]);
  const discTracks = useMemo(() => tracks.map((t) => (t.status === "ready" ? { ...t, durationSec: effDuration(t) } : t)), [tracks, effDuration]);
  const totalSec = discLength(effReady, options);
  const level = capacityLevel(totalSec);

  const trims = useMemo(() => {
    const out: Record<string, TrackTrim> = {};
    for (const t of ready) if (t.sourceKey && (t.trimStartSec !== undefined || t.trimEndSec !== undefined)) out[t.sourceKey] = { startSec: t.trimStartSec ?? 0, endSec: t.trimEndSec ?? 1e9 };
    return out;
  }, [ready]);

  /* ---------- preparing + analysis ---------- */

  useEffect(() => bridge.onPrepUpdate((u) => setPrep((p) => ({ ...p, [u.key]: u }))), []);

  const prepOf = (t: Track) => (t.sourceKey ? prep[t.sourceKey] : undefined);
  const pendingIds = useMemo(
    () => new Set(ready.filter((t) => prepOf(t)?.state !== "ready").map((t) => t.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, prep],
  );
  const prepProgress = ready.length ? ready.reduce((n, t) => n + (prepOf(t)?.progress ?? 0), 0) / ready.length : 0;
  const prepError = ready.map((t) => prepOf(t)).find((p) => p?.state === "error")?.error ?? null;
  const allPrepared = ready.length > 0 && pendingIds.size === 0;

  const startPrep = useCallback(
    async (rowId: string, source: PrepSource) => {
      try {
        const key = await bridge.prepare(source);
        setTracks((prev) => prev.map((t) => (t.id === rowId ? { ...t, sourceKey: key } : t)));
      } catch (e) {
        setToast(e instanceof Error ? e.message : "Couldn't prepare that song");
      }
    },
    [setToast],
  );

  // Any ready song that hasn't started preparing yet starts now.
  useEffect(() => {
    for (const t of tracks) {
      if (t.status !== "ready" || t.sourceKey) continue;
      if (t.videoId) void startPrep(t.id, { kind: "youtube", videoId: t.videoId });
      else if (t.filePath) void startPrep(t.id, { kind: "file", path: t.filePath });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.map((t) => `${t.id}:${t.status}:${t.sourceKey ?? ""}`).join(",")]);

  // Analyse each song once it's prepared (tempo, key, silence, waveform).
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const t of ready) {
      const k = t.sourceKey;
      if (!k || prep[k]?.state !== "ready" || analysis[k] || asked.current.has(k)) continue;
      asked.current.add(k);
      void bridge.analyze(k).then((a) => a && setAnalysis((m) => ({ ...m, [k]: a })));
    }
  }, [ready, prep, analysis]);

  // Keep the cache under its limit without touching the songs on this disc.
  const activeKeys = ready.map((t) => t.sourceKey).filter(Boolean) as string[];
  useEffect(() => {
    bridge.setCachePolicy(cacheLimitGB, activeKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheLimitGB, activeKeys.join("|")]);

  /* ---------- preview ---------- */

  const discSignature = ready.map((t) => t.sourceKey).join("|") + JSON.stringify(options) + JSON.stringify(trims);
  useEffect(() => {
    player.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discSignature]);

  const buildDisc = useCallback(async (): Promise<string | null> => {
    const keys = ready.map((t) => t.sourceKey).filter(Boolean) as string[];
    if (keys.length !== ready.length) return "Some songs aren't ready yet";
    player.setStatus("building");
    const r = await bridge.renderDisc({ keys, options, trims });
    if (!r.ok) {
      player.setStatus("idle");
      return r.message;
    }
    player.load({ tracks: r.tracks, totalSamples: r.totalSamples });
    return null;
  }, [ready, options, trims, player]);

  const requestPreview = async () => {
    if (!isDesktop) return setToast("Disc preview plays in the desktop app");
    if (ready.length === 0) return setToast("Add some songs first");
    if (!allPrepared) return setToast(`Preparing songs: ${ready.length - pendingIds.size} of ${ready.length} ready`);
    const err = await buildDisc();
    if (err) return setToast(err);
    await player.play(0);
  };

  const playingTrack = player.disc && player.index >= 0 ? player.disc.tracks[player.index] : null;
  const playingId = playingTrack ? (ready.find((t) => t.sourceKey === playingTrack.key)?.id ?? null) : null;
  const playhead =
    playingTrack && playingId ? { id: playingId, fraction: Math.max(0, (player.position - playingTrack.startSample) / playingTrack.samples) } : null;

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToastState(null), toast.action ? 6000 : 2600);
    return () => clearTimeout(id);
  }, [toast]);

  /* ---------- adding songs ---------- */

  const resolveTrack = useCallback(async (rowId: string, videoId: string) => {
    const patch = (p: Partial<Track>) => setTracks((prev) => prev.map((t) => (t.id === rowId ? { ...t, ...p } : t)));
    let res;
    try {
      res = await bridge.resolve(videoId);
    } catch {
      return patch({ status: "error", error: "Something went wrong. Try again." });
    }
    if (!res.ok) return patch({ status: "error", error: res.message });
    const { track } = res;
    let art: { cover: string; color: string; print?: string } = makeCover(track.title + track.artist);
    if (track.coverDataUrl) art = await processCover(track.coverDataUrl).catch(() => art);
    // Keep a print-resolution copy as a file in Romix's folder (for sharp inserts).
    const coverHi = art.print ? await bridge.storeCover(art.print).catch(() => undefined) : undefined;
    patch({ status: "ready", title: track.title, artist: track.artist, durationSec: track.durationSec, url: track.webpageUrl, cover: art.cover, coverHi, color: art.color, error: undefined });
  }, []);

  const addLinks = useCallback(
    (lines: string[]): string[] => {
      const errors: string[] = [];
      const existing = new Set(tracks.map((t) => t.videoId).filter(Boolean));
      const added: Track[] = [];
      for (const line of lines) {
        const parsed = parseYouTubeLink(line);
        if (!parsed.ok) {
          errors.push(`${parsed.reason}: ${parsed.input}`);
          continue;
        }
        if (existing.has(parsed.videoId)) {
          errors.push(`Already on the disc: ${line}`);
          continue;
        }
        existing.add(parsed.videoId);
        added.push({ id: crypto.randomUUID(), videoId: parsed.videoId, url: parsed.url, source: "youtube", status: "resolving", title: "", artist: "", durationSec: 0, cover: "", color: "" });
      }
      if (added.length) {
        setTracks((prev) => [...prev, ...added]);
        added.forEach((t) => void resolveTrack(t.id, t.videoId!));
      }
      return errors;
    },
    [tracks, resolveTrack],
  );

  const retryTrack = (id: string) => {
    const t = tracks.find((x) => x.id === id);
    if (!t) return;
    if (t.status === "error" && t.videoId) {
      setTracks((prev) => prev.map((p) => (p.id === id ? { ...p, status: "resolving", error: undefined } : p)));
      void resolveTrack(id, t.videoId);
    } else if (t.videoId) void startPrep(id, { kind: "youtube", videoId: t.videoId });
    else if (t.filePath) void startPrep(id, { kind: "file", path: t.filePath });
  };

  const addFiles = useCallback(
    async (files: FileList) => {
      const audio = [...files].filter((f) => f.type.startsWith("audio/") || /\.(mp3|flac|wav|m4a|ogg|opus|aac)$/i.test(f.name));
      if (audio.length === 0) return setToast("Only audio files can go on the disc");
      for (const f of audio) {
        const url = URL.createObjectURL(f);
        try {
          const durationSec = await audioDuration(url);
          URL.revokeObjectURL(url);
          const name = f.name.replace(/\.[^.]+$/, "");
          const [artist, title] = name.includes(" - ") ? name.split(" - ", 2) : ["Local file", name];
          const filePath = bridge.pathForFile(f);
          setTracks((prev) => [...prev, { id: crypto.randomUUID(), title, artist, durationSec, source: "local", status: "ready", filePath, ...makeCover(name) }]);
        } catch {
          URL.revokeObjectURL(url);
          setToast(`Couldn't read ${f.name}`);
        }
      }
    },
    [setToast],
  );

  const removeTrack = (id: string) => {
    setHoveredId(null);
    const gone = tracks.find((t) => t.id === id);
    if (gone?.sourceKey && !tracks.some((t) => t.id !== id && t.sourceKey === gone.sourceKey)) bridge.cancelPrep(gone.sourceKey);
    setTracks((prev) => prev.filter((t) => t.id !== id));
  };

  /* ---------- fitting and flow ---------- */

  const silenceSavingSec = ready.reduce((n, t) => {
    const a = t.sourceKey ? analysis[t.sourceKey] : undefined;
    if (!a || t.trimStartSec !== undefined || t.trimEndSec !== undefined) return n;
    return n + (a.musicStartSec + (a.durationSec - a.musicEndSec)) / speed;
  }, 0);
  const speedSavingSec = (options.speedPct ?? 0) >= 2 ? 0 : totalSec - totalSec * (speed / 1.02);

  const trimSilenceAll = () => {
    const before = tracks;
    setTracks((prev) =>
      prev.map((t) => {
        const a = t.sourceKey ? analysis[t.sourceKey] : undefined;
        if (!a || t.trimStartSec !== undefined || t.trimEndSec !== undefined) return t;
        return { ...t, trimStartSec: a.musicStartSec, trimEndSec: a.musicEndSec };
      }),
    );
    setToast(`Trimmed silence, saved ${formatTime(silenceSavingSec)}`, { label: "Undo", run: () => setTracks(before) });
  };

  const sortForFlow = () => {
    const missing = ready.filter((t) => !t.sourceKey || !analysis[t.sourceKey]);
    if (missing.length) return setToast(`Listening to the songs first: ${ready.length - missing.length} of ${ready.length} done`);
    const order = flowOrder(ready.map((t) => ({ id: t.id, bpm: analysis[t.sourceKey!].bpm, camelot: analysis[t.sourceKey!].camelot })));
    const before = tracks;
    const byId = new Map(tracks.map((t) => [t.id, t]));
    setTracks([...order.map((id) => byId.get(id)!), ...tracks.filter((t) => t.status !== "ready")]);
    setToast("Sorted so tempos and keys flow smoothly", { label: "Undo", run: () => setTracks(before) });
  };

  /* ---------- projects and shelf ---------- */

  const loadDisc = useCallback(
    (data: { title: string; options: DiscOptions; tracks: SavedTrack[] }, id: string | null) => {
      player.reset();
      setTracks(data.tracks.map((t) => ({ ...t, id: crypto.randomUUID(), status: "ready" as const })));
      setTitle(data.title);
      setOptions({ speedPct: 0, ...data.options });
      setProjectId(id);
      setPage("disc");
    },
    [player],
  );

  const saveProject = useCallback(async () => {
    if (ready.length === 0) return setToast("Add some songs before saving");
    const id = projectId ?? crypto.randomUUID();
    await bridge.saveProject({ id, title, options, tracks: ready.map(toSaved) });
    setProjectId(id);
    setToast("Saved");
  }, [ready, projectId, title, options, setToast]);

  const openProject = useCallback(
    async (id: string) => {
      const p = await bridge.loadProject(id);
      if (!p) return setToast("That saved disc couldn't be opened");
      loadDisc(p, p.id);
    },
    [loadDisc, setToast],
  );

  const openShelf = (e: ShelfEntry, burnNow: boolean) => {
    loadDisc({ title: e.title, options: e.options, tracks: e.tracks }, null);
    if (burnNow) setBurning(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveProject]);

  const startBurn = () => {
    if (ready.length === 0) return setToast("Add some songs first");
    if (level === "over") return setToast(`The disc is ${formatDiscTime(totalSec - CD_MAX_SEC)} too long. Trim, speed up or remove a song.`);
    if (tracks.some((t) => t.status === "resolving")) return setToast("Wait for all songs to finish loading");
    if (tracks.some((t) => t.status === "error")) return setToast("Retry or remove the songs that couldn't load");
    player.pause();
    setBurning(true);
  };

  const trimTrack = tracks.find((t) => t.id === trimId);

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      {isDesktop && <div className="drag-strip" aria-hidden="true" />}
      <Sidebar page={page} onNavigate={setPage} theme={theme.resolved} onToggleTheme={theme.toggle} drives={drives} />

      <main className="main">
        {page === "settings" ? (
          <SettingsPage
            pref={theme.pref}
            onChange={theme.setPref}
            onToast={setToast}
            burnPrefs={burnPrefs}
            setBurnPrefs={setBurnPrefs}
            cacheLimitGB={cacheLimitGB}
            setCacheLimitGB={setCacheLimit}
          />
        ) : page === "projects" ? (
          <ProjectsPage currentId={projectId} hasWork={tracks.length > 0} onOpen={(id) => void openProject(id)} />
        ) : page === "shelf" ? (
          <ShelfPage
            onBurnAgain={(e) => openShelf(e, true)}
            onOpen={(e) => openShelf(e, false)}
            onPrint={(e) => {
              setInsertSource(`shelf:${e.id}`);
              setPage("inserts");
            }}
          />
        ) : page === "inserts" ? (
          <InsertsPage key={insertSource ?? "current"} current={{ title, tracks: ready.map(toSaved), keys: ready.map((t) => t.sourceKey) }} initial={insertSource} onToast={setToast} />
        ) : (
          <>
            <header className="header">
              <button className="btn header-save" onClick={() => void saveProject()} title="Save this disc (Ctrl+S)">
                {projectId ? "Save" : "Save disc"}
              </button>
              <div>
                <p className="eyebrow">Audio CD</p>
                <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Disc title" />
                <p className="subtitle">
                  {ready.length} {ready.length === 1 ? "song" : "songs"}, {formatDiscTime(totalSec)} of 80:00
                  {(options.speedPct ?? 0) > 0 && (
                    <>
                      {" · "}sped up {options.speedPct}%{" "}
                      <button className="link-btn" onClick={() => setOptions({ ...options, speedPct: 0 })}>
                        Undo
                      </button>
                    </>
                  )}
                </p>
              </div>
            </header>

            <LinkInput onSubmit={addLinks} />

            {level === "over" && (
              <motion.div className="fit-banner" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="status">
                <span className="fit-text">
                  {formatDiscTime(totalSec - CD_MAX_SEC)} too long for a CD.
                </span>
                {silenceSavingSec >= 1 && (
                  <button className="btn" onClick={trimSilenceAll}>
                    Trim silence (saves {formatTime(silenceSavingSec)})
                  </button>
                )}
                {(options.speedPct ?? 0) < 2 && (
                  <button className="btn" onClick={() => setOptions({ ...options, speedPct: 2 })} title="Plays 2% faster. Pitch stays the same, but it's a subtle change to the sound.">
                    Speed up 2% (saves {formatTime(speedSavingSec)})
                  </button>
                )}
                <span className="fit-hint">or remove a song</span>
              </motion.div>
            )}

            <div className="workspace">
              <section className="disc-stage">
                <Disc tracks={discTracks} totalSec={totalSec} hoveredId={hoveredId} onHover={setHoveredId} pendingIds={pendingIds} playhead={playhead} />
                <Transport player={player} trackTitle={playingId ? tracks.find((t) => t.id === playingId)?.title : undefined} onPlayRequest={() => void requestPreview()} />
                <div className="legend">
                  <span><i className="dot cap-ok" /> Fits</span>
                  <span><i className="dot cap-tight" /> Over 74 min, some older players struggle</span>
                  <span><i className="dot cap-over" /> Too long</span>
                </div>
              </section>

              <section className="list-pane">
                <TrackList
                  tracks={tracks}
                  onReorder={setTracks}
                  onRemove={removeTrack}
                  onRetry={retryTrack}
                  hoveredId={hoveredId}
                  onHover={setHoveredId}
                  prep={prep}
                  playingId={playingId}
                  analysis={analysis}
                  onTrim={setTrimId}
                  headerAction={
                    ready.length >= 3 ? (
                      <button className="link-btn flow-btn" onClick={sortForFlow} title="Reorder so tempos and keys move smoothly from song to song">
                        <Shuffle size={11} /> Sort for flow
                      </button>
                    ) : undefined
                  }
                />
              </section>
            </div>

            <footer className="footer">
              <OptionsBar options={options} onChange={setOptions} />
              <div className="footer-actions">
                <button className={`btn btn-primary ${level === "over" ? "is-over" : ""}`} onClick={startBurn}>
                  Burn
                </button>
              </div>
            </footer>
          </>
        )}
      </main>

      <AnimatePresence>
        {dragging && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="drop-card">
              <Upload size={28} />
              <p>Drop audio files to add them to the disc</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {trimTrack && (
          <TrimSheet
            track={trimTrack}
            analysis={trimTrack.sourceKey ? analysis[trimTrack.sourceKey] : undefined}
            onClose={() => setTrimId(null)}
            onApply={(start, end) => {
              const a = trimTrack.sourceKey ? analysis[trimTrack.sourceKey] : undefined;
              const full = a?.durationSec ?? trimTrack.durationSec;
              const untouched = start < 0.05 && end > full - 0.05;
              setTracks((prev) =>
                prev.map((t) => (t.id === trimTrack.id ? { ...t, trimStartSec: untouched ? undefined : start, trimEndSec: untouched ? undefined : end } : t)),
              );
              setTrimId(null);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {burning && (
          <BurnSheet
            tracks={effReady}
            keys={ready.map((t) => t.sourceKey).filter(Boolean) as string[]}
            options={options}
            trims={trims}
            record={{ title, tracks: ready.map(toSaved) }}
            totalSec={totalSec}
            title={title}
            prepProgress={allPrepared ? 1 : Math.min(0.999, prepProgress)}
            prepError={prepError}
            drives={drives}
            prefs={burnPrefs}
            onClose={() => setBurning(false)}
            onToast={setToast}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{isDesktop && setup.deps.length > 0 && !setup.ready && <SetupSheet deps={setup.deps} onRetry={setup.retry} />}</AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div className="toast" role="status" initial={{ opacity: 0, y: 16, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 8, x: "-50%" }}>
            {toast.message}
            {toast.action && (
              <button
                className="link-btn toast-action"
                onClick={() => {
                  toast.action!.run();
                  setToastState(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

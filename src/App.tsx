import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Upload } from "lucide-react";
import type { DiscOptions, Page, Track } from "./types";
import { CD_MAX_SEC, capacityLevel, discLength, formatTime, parseYouTubeLink } from "./lib/cd";
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
import { Placeholder } from "./components/Placeholder";
import { SettingsPage } from "./components/SettingsPage";
import { useTheme } from "./lib/theme";
import { usePlayer } from "./lib/player";
import { Transport } from "./components/Transport";
import { SetupSheet, useDeps } from "./components/SetupSheet";
import type { PrepSource, PrepUpdate } from "./shared/api";

function audioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(a.duration);
    a.onerror = () => reject(new Error("Unreadable audio file"));
    a.src = url;
  });
}

export default function App() {
  const theme = useTheme();
  const [page, setPage] = useState<Page>("disc");
  const [title, setTitle] = useState("Untitled mix");
  // The browser preview starts with sample songs; the real app starts with an empty disc.
  const [tracks, setTracks] = useState<Track[]>(() => (isDesktop ? [] : initialTracks()));
  const [options, setOptions] = useState<DiscOptions>({ gapMode: "gap2", crossfadeSec: 3, normalize: false });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [burning, setBurning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [prep, setPrep] = useState<Record<string, PrepUpdate>>({});
  const setup = useDeps();
  const player = usePlayer();

  const ready = useMemo(() => tracks.filter((t) => t.status === "ready"), [tracks]);
  const totalSec = discLength(ready, options);
  const level = capacityLevel(totalSec);

  // Live preparation progress from the main process.
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

  // Any ready song that hasn't started preparing yet (e.g. the browser preview's sample songs) starts now.
  useEffect(() => {
    for (const t of tracks) {
      if (t.status !== "ready" || t.sourceKey) continue;
      if (t.videoId) void startPrep(t.id, { kind: "youtube", videoId: t.videoId });
      else if (t.filePath) void startPrep(t.id, { kind: "file", path: t.filePath });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.map((t) => `${t.id}:${t.status}:${t.sourceKey ?? ""}`).join(",")]);

  // Any change to the order, songs or options makes the built disc stale.
  const discSignature = ready.map((t) => t.sourceKey).join("|") + JSON.stringify(options);
  useEffect(() => {
    player.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discSignature]);

  /** Builds the final disc audio (cached per track) and loads it into the preview player. */
  const buildDisc = useCallback(async (): Promise<string | null> => {
    const keys = ready.map((t) => t.sourceKey).filter(Boolean) as string[];
    if (keys.length !== ready.length) return "Some songs aren't ready yet";
    player.setStatus("building");
    const r = await bridge.renderDisc({ keys, options });
    if (!r.ok) {
      player.setStatus("idle");
      return r.message;
    }
    player.load({ tracks: r.tracks, totalSamples: r.totalSamples });
    return null;
  }, [ready, options, player]);

  const requestPreview = async () => {
    if (!isDesktop) return setToast("Disc preview plays in the desktop app");
    if (ready.length === 0) return setToast("Add some songs first");
    if (!allPrepared) return setToast(`Preparing songs: ${ready.length - pendingIds.size} of ${ready.length} ready`);
    const err = await buildDisc();
    if (err) return setToast(err);
    await player.play(0);
  };

  // Map the player's position onto the disc ring and the track list.
  const playingTrack = player.disc && player.index >= 0 ? player.disc.tracks[player.index] : null;
  const playingId = playingTrack ? (ready.find((t) => t.sourceKey === playingTrack.key)?.id ?? null) : null;
  const playhead =
    playingTrack && playingId
      ? { id: playingId, fraction: Math.max(0, (player.position - playingTrack.startSample) / playingTrack.samples) }
      : null;

  const startPrep = useCallback(async (rowId: string, source: PrepSource) => {
    try {
      const key = await bridge.prepare(source);
      setTracks((prev) => prev.map((t) => (t.id === rowId ? { ...t, sourceKey: key } : t)));
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Couldn't prepare that song");
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  /** Fetches real metadata (desktop) or mock data (browser) and fills in the row. */
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
    let art = makeCover(track.title + track.artist);
    if (track.coverDataUrl) art = await processCover(track.coverDataUrl).catch(() => art);
    patch({
      status: "ready",
      title: track.title,
      artist: track.artist,
      durationSec: track.durationSec,
      url: track.webpageUrl,
      cover: art.cover,
      color: art.color,
      error: undefined,
    });
    // Preparing (download + convert) starts from the effect that watches for ready songs.
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
        added.push({
          id: crypto.randomUUID(),
          videoId: parsed.videoId,
          url: parsed.url,
          source: "youtube",
          status: "resolving",
          title: "",
          artist: "",
          durationSec: 0,
          cover: "",
          color: "",
        });
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
    } else if (t.videoId) {
      void startPrep(id, { kind: "youtube", videoId: t.videoId });
    } else if (t.filePath) {
      void startPrep(id, { kind: "file", path: t.filePath });
    }
  };

  const addFiles = useCallback(async (files: FileList) => {
    const audio = [...files].filter((f) => f.type.startsWith("audio/") || /\.(mp3|flac|wav|m4a|ogg|opus|aac)$/i.test(f.name));
    if (audio.length === 0) {
      setToast("Only audio files can go on the disc");
      return;
    }
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
  }, []);

  const removeTrack = (id: string) => {
    setHoveredId(null);
    const gone = tracks.find((t) => t.id === id);
    // Stop preparing it unless another row uses the same audio.
    if (gone?.sourceKey && !tracks.some((t) => t.id !== id && t.sourceKey === gone.sourceKey)) bridge.cancelPrep(gone.sourceKey);
    setTracks((prev) => prev.filter((t) => t.id !== id));
  };

  const startBurn = () => {
    if (ready.length === 0) return setToast("Add some songs first");
    if (level === "over") return setToast(`The disc is ${formatTime(totalSec - CD_MAX_SEC)} too long. Remove a song or switch to crossfade.`);
    if (tracks.some((t) => t.status === "resolving")) return setToast("Wait for all songs to finish loading");
    if (tracks.some((t) => t.status === "error")) return setToast("Retry or remove the songs that couldn't load");
    if (!isDesktop) return setToast("Burning works in the desktop app");
    player.pause();
    setBurning(true);
  };

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
      <Sidebar page={page} onNavigate={setPage} theme={theme.resolved} onToggleTheme={theme.toggle} />

      <main className="main">
        {page === "settings" ? (
          <SettingsPage pref={theme.pref} onChange={theme.setPref} onToast={setToast} />
        ) : page !== "disc" ? (
          <Placeholder page={page} />
        ) : (
          <>
            <header className="header">
              <div>
                <p className="eyebrow">Audio CD</p>
                <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Disc title" />
                <p className="subtitle">
                  {ready.length} {ready.length === 1 ? "song" : "songs"}, {formatTime(totalSec)} of 80:00
                </p>
              </div>
            </header>

            <LinkInput onSubmit={addLinks} />

            <div className="workspace">
              <section className="disc-stage">
                <Disc tracks={tracks} totalSec={totalSec} hoveredId={hoveredId} onHover={setHoveredId} pendingIds={pendingIds} playhead={playhead} />
                <Transport
                  player={player}
                  trackTitle={playingId ? tracks.find((t) => t.id === playingId)?.title : undefined}
                  onPlayRequest={() => void requestPreview()}
                />
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
        {burning && (
          <BurnSheet
            tracks={ready}
            totalSec={totalSec}
            title={title}
            prepProgress={allPrepared ? 1 : Math.min(0.999, prepProgress)}
            prepError={prepError}
            buildDisc={buildDisc}
            onClose={() => setBurning(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{isDesktop && setup.deps.length > 0 && !setup.ready && <SetupSheet deps={setup.deps} onRetry={setup.retry} />}</AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 16, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 8, x: "-50%" }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

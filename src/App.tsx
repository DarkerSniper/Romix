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

  const ready = useMemo(() => tracks.filter((t) => t.status === "ready"), [tracks]);
  const totalSec = discLength(ready, options);
  const level = capacityLevel(totalSec);

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
    if (!t?.videoId) return;
    setTracks((prev) => prev.map((p) => (p.id === id ? { ...p, status: "resolving", error: undefined } : p)));
    void resolveTrack(id, t.videoId);
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
        const name = f.name.replace(/\.[^.]+$/, "");
        const [artist, title] = name.includes(" - ") ? name.split(" - ", 2) : ["Local file", name];
        setTracks((prev) => [
          ...prev,
          { id: crypto.randomUUID(), title, artist, durationSec, source: "local", status: "ready", url, ...makeCover(name) },
        ]);
      } catch {
        URL.revokeObjectURL(url);
        setToast(`Couldn't read ${f.name}`);
      }
    }
  }, []);

  const removeTrack = (id: string) => {
    setHoveredId(null);
    setTracks((prev) => prev.filter((t) => t.id !== id));
  };

  const startBurn = () => {
    if (ready.length === 0) return setToast("Add some songs first");
    if (level === "over") return setToast(`The disc is ${formatTime(totalSec - CD_MAX_SEC)} too long. Remove a song or switch to crossfade.`);
    if (tracks.some((t) => t.status === "resolving")) return setToast("Wait for all songs to finish loading");
    if (tracks.some((t) => t.status === "error")) return setToast("Retry or remove the songs that couldn't load");
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
                <Disc tracks={tracks} totalSec={totalSec} hoveredId={hoveredId} onHover={setHoveredId} />
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
                />
              </section>
            </div>

            <footer className="footer">
              <OptionsBar options={options} onChange={setOptions} />
              <div className="footer-actions">
                <button className="btn" onClick={() => setToast("Disc preview arrives in milestone 3")}>
                  Preview
                </button>
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
        {burning && <BurnSheet tracks={ready} totalSec={totalSec} title={title} onClose={() => setBurning(false)} />}
      </AnimatePresence>

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

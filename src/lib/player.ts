import { useEffect, useRef, useState, useCallback } from "react";
import type { RenderedTrack } from "../shared/api";
import { SAMPLE_RATE } from "./discPlan";

export interface LoadedDisc {
  tracks: RenderedTrack[];
  totalSamples: number;
}

/**
 * Plays the rendered disc sample-accurately with Web Audio: each track is
 * scheduled to start exactly where the previous one ends (plus its pregap),
 * so gapless and crossfaded transitions sound exactly as they'll be burned.
 * Only the current and next track are decoded at a time.
 */
class DiscEngine {
  private ctx: AudioContext | null = null;
  private disc: LoadedDisc | null = null;
  private buffers = new Map<number, Promise<AudioBuffer>>();
  private sources: AudioBufferSourceNode[] = [];
  private timers: number[] = [];
  private session = 0;
  private t0 = 0;
  private base = 0;
  playing = false;

  load(disc: LoadedDisc) {
    this.stop();
    this.disc = disc;
    this.buffers.clear();
  }

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "playback" });
    return this.ctx;
  }

  private buffer(i: number): Promise<AudioBuffer> {
    let b = this.buffers.get(i);
    if (!b) {
      const url = this.disc!.tracks[i].url;
      b = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`Couldn't load track ${i + 1}`);
          return r.arrayBuffer();
        })
        .then((ab) => this.context().decodeAudioData(ab));
      this.buffers.set(i, b);
    }
    // Keep memory bounded: only the current and next track stay decoded.
    for (const k of this.buffers.keys()) if (k < i - 1 || k > i + 1) this.buffers.delete(k);
    return b;
  }

  indexAt(sample: number): number {
    const tracks = this.disc?.tracks ?? [];
    for (let i = tracks.length - 1; i >= 0; i--) if (sample >= tracks[i].startSample - tracks[i].pregap) return i;
    return 0;
  }

  position(): number {
    if (!this.disc) return 0;
    if (!this.playing || !this.ctx) return this.base;
    const p = this.base + (this.ctx.currentTime - this.t0) * SAMPLE_RATE;
    return Math.min(p, this.disc.totalSamples);
  }

  async play(from = this.base) {
    if (!this.disc) return;
    const ctx = this.context();
    if (ctx.state === "suspended") await ctx.resume();
    this.clearScheduled();
    const session = ++this.session;
    this.base = Math.max(0, Math.min(from, this.disc.totalSamples - 1));
    this.t0 = ctx.currentTime + 0.12;
    this.playing = true;

    const i = this.indexAt(this.base);
    const t = this.disc.tracks[i];
    const offset = Math.max(0, this.base - t.startSample);
    const when = this.t0 + Math.max(0, t.startSample - this.base) / SAMPLE_RATE;
    await this.schedule(i, offset, when, session);
  }

  private async schedule(i: number, offset: number, when: number, session: number) {
    const disc = this.disc!;
    const ctx = this.context();
    const buf = await this.buffer(i);
    if (session !== this.session) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(Math.max(when, ctx.currentTime), offset / SAMPLE_RATE);
    this.sources.push(src);

    const end = when + (disc.tracks[i].samples - offset) / SAMPLE_RATE;
    const next = disc.tracks[i + 1];
    if (next) {
      const nextWhen = end + next.pregap / SAMPLE_RATE;
      void this.buffer(i + 1); // start decoding early
      // Schedule the next track a few seconds before it's due.
      const lead = Math.max(0, (nextWhen - ctx.currentTime - 4) * 1000);
      this.timers.push(window.setTimeout(() => void this.schedule(i + 1, 0, nextWhen, session), lead));
    } else {
      this.timers.push(
        window.setTimeout(() => {
          if (session === this.session) this.stop();
        }, Math.max(0, (end - ctx.currentTime) * 1000) + 50),
      );
    }
  }

  pause() {
    if (!this.playing) return;
    this.base = this.position();
    this.playing = false;
    this.session++;
    this.clearScheduled();
  }

  stop() {
    this.session++;
    this.playing = false;
    this.base = 0;
    this.clearScheduled();
  }

  private clearScheduled() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    this.sources = [];
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  seek(sample: number) {
    if (this.playing) void this.play(sample);
    else this.base = Math.max(0, Math.min(sample, (this.disc?.totalSamples ?? 1) - 1));
  }
}

export type PlayerStatus = "idle" | "building" | "ready";

export function usePlayer() {
  const engine = useRef(new DiscEngine());
  const [disc, setDisc] = useState<LoadedDisc | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);

  // Smooth position updates while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const e = engine.current;
      setPosition(e.position());
      if (!e.playing) {
        setPlaying(false);
        setPosition(e.position());
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => () => engine.current.stop(), []);

  const load = useCallback((d: LoadedDisc) => {
    engine.current.load(d);
    setDisc(d);
    setStatus("ready");
    setPosition(0);
    setPlaying(false);
  }, []);

  const reset = useCallback(() => {
    engine.current.stop();
    setDisc(null);
    setStatus("idle");
    setPlaying(false);
    setPosition(0);
  }, []);

  const play = useCallback(async (from?: number) => {
    await engine.current.play(from);
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    engine.current.pause();
    setPlaying(false);
    setPosition(engine.current.position());
  }, []);

  const seek = useCallback((sample: number) => {
    engine.current.seek(sample);
    setPosition(sample);
  }, []);

  const index = disc ? engine.current.indexAt(position) : -1;

  const skip = useCallback(
    (dir: 1 | -1) => {
      if (!disc) return;
      const i = engine.current.indexAt(engine.current.position());
      const cur = disc.tracks[i];
      // "Previous" restarts the current track unless we're within its first 3 seconds.
      const target = dir === -1 && engine.current.position() - cur.startSample > 3 * SAMPLE_RATE ? i : Math.max(0, Math.min(disc.tracks.length - 1, i + dir));
      const s = disc.tracks[target].startSample;
      engine.current.seek(s);
      setPosition(s);
    },
    [disc],
  );

  return { disc, status, setStatus, playing, position, index, load, reset, play, pause, seek, skip };
}

import { Pause, Play, SkipBack, SkipForward, Loader2 } from "lucide-react";
import { SAMPLE_RATE } from "../lib/discPlan";
import { formatTime } from "../lib/cd";
import type { usePlayer } from "../lib/player";

interface TransportProps {
  player: ReturnType<typeof usePlayer>;
  trackTitle?: string;
  onPlayRequest: () => void;
}

/** Disc preview controls: previous, play/pause, next, position and a scrubber across the whole disc. */
export function Transport({ player, trackTitle, onPlayRequest }: TransportProps) {
  const { disc, playing, position, index, status } = player;
  const total = disc?.totalSamples ?? 0;
  const building = status === "building";

  return (
    <div className="transport">
      <div className="transport-row">
        <button className="icon-btn transport-btn" aria-label="Previous track" onClick={() => player.skip(-1)} disabled={!disc}>
          <SkipBack size={15} />
        </button>
        <button
          className="transport-play"
          aria-label={playing ? "Pause preview" : "Play disc preview"}
          onClick={() => (playing ? player.pause() : disc ? void player.play() : onPlayRequest())}
          disabled={building}
        >
          {building ? <Loader2 size={16} className="spin" /> : playing ? <Pause size={16} /> : <Play size={16} className="play-nudge" />}
        </button>
        <button className="icon-btn transport-btn" aria-label="Next track" onClick={() => player.skip(1)} disabled={!disc}>
          <SkipForward size={15} />
        </button>
        <div className="transport-info">
          <div className="transport-title">
            {building ? "Building disc audio…" : disc && index >= 0 ? `${index + 1}. ${trackTitle ?? ""}` : "Preview the disc"}
          </div>
          <div className="transport-time">
            {disc ? `${formatTime(position / SAMPLE_RATE)} / ${formatTime(total / SAMPLE_RATE)}` : "Exactly as it will be burned"}
          </div>
        </div>
      </div>
      <input
        className="scrubber"
        type="range"
        min={0}
        max={Math.max(1, total)}
        step={SAMPLE_RATE / 10}
        value={Math.min(position, total)}
        onChange={(e) => player.seek(Number(e.target.value))}
        disabled={!disc}
        aria-label="Position on the disc"
        style={{ ["--fill" as string]: `${total ? (position / total) * 100 : 0}%` }}
      />
    </div>
  );
}

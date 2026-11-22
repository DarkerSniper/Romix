import { useId, useMemo, useRef } from "react";
import type { Track } from "../types";
import { CD_MAX_SEC, capacityLevel, formatTime } from "../lib/cd";
import { useSprungArcs, type Arc } from "./useSprungArcs";

const VIEW = 400;
const C = VIEW / 2;
const R_OUT = 176;
const R_IN = 78;
const R_CAP = 192;
const PAD = 0.012; // radians between slices

interface DiscProps {
  tracks: Track[];
  totalSec: number;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  spinning?: boolean;
  compact?: boolean;
}

function point(r: number, a: number): [number, number] {
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

/** Annular sector from angle a0 to a1 (radians, clockwise from 12 o'clock). */
function sectorPath(a0: number, a1: number, rOut: number, rIn: number): string {
  const span = Math.min(a1 - a0, Math.PI * 2 - 1e-4);
  if (span <= 0) return "";
  const end = a0 + span;
  const large = span > Math.PI ? 1 : 0;
  const [x0, y0] = point(rOut, a0);
  const [x1, y1] = point(rOut, end);
  const [x2, y2] = point(rIn, end);
  const [x3, y3] = point(rIn, a0);
  return `M${x0} ${y0} A${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${rIn} ${rIn} 0 ${large} 0 ${x3} ${y3}Z`;
}

export function Disc({ tracks, totalSec, hoveredId, onHover, spinning, compact }: DiscProps) {
  const uid = useId().replace(/:/g, "");
  const ready = tracks.filter((t) => t.status === "ready");
  const sum = ready.reduce((a, t) => a + t.durationSec, 0);

  const targets = useMemo(() => {
    const map = new Map<string, Arc>();
    if (sum === 0) return map;
    const pad = ready.length > 1 ? PAD : 0;
    let acc = 0;
    for (const t of ready) {
      const a0 = (acc / sum) * Math.PI * 2;
      acc += t.durationSec;
      const a1 = (acc / sum) * Math.PI * 2;
      map.set(t.id, { a0: a0 + pad / 2, a1: a1 - pad / 2 });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready.map((t) => `${t.id}:${t.durationSec}`).join("|")]);

  const arcs = useSprungArcs(targets);
  // Remember tracks after removal so their slice can animate closed.
  const seen = useRef(new Map<string, Track>());
  for (const t of tracks) seen.current.set(t.id, t);
  for (const id of seen.current.keys()) if (!arcs.has(id) && !targets.has(id)) seen.current.delete(id);
  const byId = seen.current;
  const hovered = hoveredId ? byId.get(hoveredId) : undefined;
  const level = capacityLevel(totalSec);
  const capFrac = Math.min(1, totalSec / CD_MAX_SEC);
  const capLen = 2 * Math.PI * R_CAP;

  return (
    <div className={`disc ${spinning ? "is-spinning" : ""} ${compact ? "is-compact" : ""}`}>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="disc-svg" role="img" aria-label={`Disc with ${ready.length} songs, ${formatTime(totalSec)} long`}>
        <defs>
          {/* A single faint specular highlight, as on a real polycarbonate disc. */}
          <linearGradient id={`${uid}-hl`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.14" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          {[...arcs.entries()].map(([id, arc]) => (
            <clipPath id={`${uid}-clip-${id}`} key={id}>
              <path d={sectorPath(arc.a0, arc.a1, R_OUT, R_IN)} />
            </clipPath>
          ))}
        </defs>

        {!compact && (
          <g className="disc-capacity">
            <circle cx={C} cy={C} r={R_CAP} className="cap-track" />
            <circle
              cx={C}
              cy={C}
              r={R_CAP}
              className={`cap-fill cap-${level}`}
              strokeDasharray={`${capFrac * capLen} ${capLen}`}
              transform={`rotate(-90 ${C} ${C})`}
            />
          </g>
        )}

        <g className="disc-body">
          <circle cx={C} cy={C} r={R_OUT + 4} className="disc-base" />

          {[...arcs.entries()].map(([id, arc]) => {
            const t = byId.get(id);
            if (!t) return null;
            const mid = (arc.a0 + arc.a1) / 2;
            const isHover = hoveredId === id;
            const dim = hoveredId !== null && !isHover;
            const lift = isHover ? 5 : 0;
            const dx = Math.sin(mid) * lift;
            const dy = -Math.cos(mid) * lift;
            // Centre the cover on the slice so each slice reads as its own artwork.
            const span = arc.a1 - arc.a0;
            const size = Math.min(R_OUT * 2.4, R_OUT * (0.95 + span / Math.PI));
            const [cx, cy] = point((R_OUT + R_IN) / 2 + (span > Math.PI ? -R_IN : 0), mid);
            return (
              <g
                key={id}
                className={`slice ${dim ? "is-dim" : ""}`}
                style={{ transform: `translate(${dx}px, ${dy}px)` }}
                onMouseEnter={() => onHover(id)}
                onMouseLeave={() => onHover(null)}
              >
                <g clipPath={`url(#${uid}-clip-${id})`}>
                  <rect x="0" y="0" width={VIEW} height={VIEW} fill={t.color} />
                  <image
                    href={t.cover}
                    x={cx - size / 2}
                    y={cy - size / 2}
                    width={size}
                    height={size}
                    preserveAspectRatio="xMidYMid slice"
                  />
                </g>
              </g>
            );
          })}

          <circle cx={C} cy={C} r={R_OUT + 4} fill={`url(#${uid}-hl)`} className="disc-highlight" />
          <circle cx={C} cy={C} r={R_OUT + 4} className="disc-rim" />
          <circle cx={C} cy={C} r={R_IN - 2} className="disc-hub" />
          {compact && <circle cx={C} cy={C} r={44} className="disc-mirror" />}
          <circle cx={C} cy={C} r={R_IN - 2} className="disc-hub-edge" />
          <circle cx={C} cy={C} r={compact ? 24 : 13} className="disc-hole" />
        </g>
      </svg>

      {!compact && (
        <div className="disc-center">
          {hovered ? (
            <>
              <img src={hovered.cover} alt="" className="center-cover" />
              <div className="center-title">{hovered.title}</div>
              <div className="center-sub">
                {formatTime(hovered.durationSec)} · {Math.round((hovered.durationSec / Math.max(1, sum)) * 100)}%
              </div>
            </>
          ) : ready.length === 0 ? (
            <div className="center-empty">Add songs to start your disc</div>
          ) : (
            <>
              <div className="center-label">{ready.length} {ready.length === 1 ? "song" : "songs"}</div>
              <div className="center-total">{formatTime(totalSec)}</div>
              <div className={`center-left cap-text-${level}`}>
                {level === "over"
                  ? `${formatTime(totalSec - CD_MAX_SEC)} too long`
                  : `${formatTime(CD_MAX_SEC - totalSec)} left`}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

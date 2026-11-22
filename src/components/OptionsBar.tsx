import { motion } from "framer-motion";
import type { DiscOptions, GapMode } from "../types";

interface OptionsBarProps {
  options: DiscOptions;
  onChange: (next: DiscOptions) => void;
}

const MODES: Array<{ id: GapMode; label: string }> = [
  { id: "none", label: "Gapless" },
  { id: "gap2", label: "2s gap" },
  { id: "crossfade", label: "Crossfade" },
];

export function OptionsBar({ options, onChange }: OptionsBarProps) {
  return (
    <div className="options">
      <div className="segmented" role="radiogroup" aria-label="Transitions between songs">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={options.gapMode === m.id}
            className={options.gapMode === m.id ? "is-active" : ""}
            onClick={() => onChange({ ...options, gapMode: m.id })}
          >
            {options.gapMode === m.id && (
              <motion.span layoutId="seg-pill" className="seg-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
            )}
            <span className="seg-label">{m.label}</span>
          </button>
        ))}
      </div>

      {options.gapMode === "crossfade" && (
        <label className="slider">
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={options.crossfadeSec}
            onChange={(e) => onChange({ ...options, crossfadeSec: Number(e.target.value) })}
          />
          <span>{options.crossfadeSec}s</span>
        </label>
      )}

      <label className="toggle">
        <input
          type="checkbox"
          checked={options.normalize}
          onChange={(e) => onChange({ ...options, normalize: e.target.checked })}
        />
        <span className="toggle-track" aria-hidden="true">
          <span className="toggle-thumb" />
        </span>
        Even out loudness
      </label>
    </div>
  );
}

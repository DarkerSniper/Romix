import type { ThemePref } from "../lib/theme";

const OPTIONS: Array<{ id: ThemePref; label: string }> = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "auto", label: "Auto" },
];

/** Miniature window drawn in the target theme's own colours. */
function Thumb({ kind }: { kind: ThemePref }) {
  const pane = (x: number, w: number, dark: boolean) => (
    <g>
      <rect x={x} y="0" width={w} height="56" fill={dark ? "#1e1e1e" : "#ffffff"} />
      <rect x={x} y="0" width="22" height="56" fill={dark ? "#262626" : "#f5f5f7"} />
      <rect x={x + 28} y="9" width="28" height="5" rx="2" fill={dark ? "#f5f5f7" : "#1d1d1f"} />
      <circle cx={x + 44} cy="36" r="13" fill={dark ? "#2c2c2e" : "#e9e9ee"} />
      <path d={`M${x + 44} 23 A13 13 0 0 1 ${x + 57} 36 L${x + 44} 36Z`} fill="#0a84ff" />
      <rect x={x + 62} y="24" width="16" height="3" rx="1.5" fill={dark ? "#636366" : "#aeaeb2"} />
      <rect x={x + 62} y="32" width="12" height="3" rx="1.5" fill={dark ? "#636366" : "#aeaeb2"} />
    </g>
  );
  return (
    <svg viewBox="0 0 88 56" className="theme-thumb" aria-hidden="true">
      <defs>
        <clipPath id="half-left">
          <rect x="0" y="0" width="44" height="56" />
        </clipPath>
      </defs>
      {kind === "auto" ? (
        <>
          {pane(0, 88, false)}
          <g clipPath="url(#half-left)">{pane(0, 88, true)}</g>
        </>
      ) : (
        pane(0, 88, kind === "dark")
      )}
    </svg>
  );
}

export function SettingsPage({ pref, onChange }: { pref: ThemePref; onChange: (p: ThemePref) => void }) {
  return (
    <div className="settings">
      <h1 className="settings-title">Settings</h1>

      <section className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-label">Appearance</div>
            <div className="settings-hint">Auto follows your Windows setting.</div>
          </div>
          <div className="theme-options" role="radiogroup" aria-label="Appearance">
            {OPTIONS.map((o) => (
              <button
                key={o.id}
                role="radio"
                aria-checked={pref === o.id}
                className={`theme-option ${pref === o.id ? "is-active" : ""}`}
                onClick={() => onChange(o.id)}
              >
                <Thumb kind={o.id} />
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <p className="settings-later">Burner, burn speed, verify after burning, CD-Text and the download cache arrive in milestone 4.</p>
    </div>
  );
}

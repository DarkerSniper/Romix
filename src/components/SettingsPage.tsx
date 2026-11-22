import { useEffect, useState } from "react";
import type { ThemePref } from "../lib/theme";
import type { CacheInfo, DepStatus } from "../shared/api";
import { bridge, isDesktop } from "../lib/bridge";

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

interface SettingsPageProps {
  pref: ThemePref;
  onChange: (p: ThemePref) => void;
  onToast: (msg: string) => void;
}

const formatBytes = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : b > 0 ? `${Math.round(b / 1e3)} KB` : "Empty";

export function SettingsPage({ pref, onChange, onToast }: SettingsPageProps) {
  const [deps, setDeps] = useState<DepStatus[]>([]);
  const [cache, setCache] = useState<CacheInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    const off = bridge.onDepsUpdate(setDeps);
    void bridge.deps().then(setDeps);
    void bridge.cacheInfo().then(setCache);
    return off;
  }, []);

  const update = async () => {
    setUpdating(true);
    const r = await bridge.updateYtdlp();
    setUpdating(false);
    onToast(r.message);
    setDeps(await bridge.deps());
  };

  const clear = async () => {
    setClearing(true);
    try {
      setCache(await bridge.clearCache());
      onToast("Audio cache cleared. Songs will be prepared again when needed.");
    } catch {
      onToast("Wait for songs to finish preparing, then try again");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="settings">
      <h1 className="settings-title">Settings</h1>

      <h2 className="settings-heading">Appearance</h2>
      <section className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-label">Theme</div>
            <div className="settings-hint">Auto follows your Windows setting.</div>
          </div>
          <div className="theme-options" role="radiogroup" aria-label="Theme">
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

      <h2 className="settings-heading">Helper tools</h2>
      <section className="settings-group">
        {!isDesktop ? (
          <div className="settings-row">
            <div className="settings-hint">Available in the desktop app.</div>
          </div>
        ) : (
          deps.map((d, i) => (
            <div key={d.id} className={`settings-row ${i ? "settings-row-sep" : ""}`}>
              <div className="settings-text">
                <div className="settings-label">{d.name}</div>
                <div className={`settings-hint ${d.state === "error" ? "is-warning" : ""}`}>
                  {d.state === "ready" ? `${d.version} · ${d.purpose}` : d.state === "error" ? d.error : d.state === "missing" ? "Missing" : `Installing… ${Math.round(d.progress * 100)}%`}
                </div>
              </div>
              {d.id === "ytdlp" && (
                <button className="btn" onClick={update} disabled={updating || d.state !== "ready"} title="YouTube changes often. Update if songs stop loading.">
                  {updating ? "Updating…" : "Update"}
                </button>
              )}
            </div>
          ))
        )}
      </section>

      <h2 className="settings-heading">Storage</h2>
      <section className="settings-group">
        <div className="settings-row">
          <div className="settings-text">
            <div className="settings-label">Audio cache</div>
            <div className="settings-hint">
              {isDesktop ? `${cache ? formatBytes(cache.bytes) : "Checking…"} · Downloads and CD audio, kept in Romix's folder` : "Available in the desktop app."}
            </div>
          </div>
          {isDesktop && (
            <button className="btn" onClick={clear} disabled={clearing || !cache?.bytes}>
              {clearing ? "Clearing…" : "Clear"}
            </button>
          )}
        </div>
      </section>

      <p className="settings-later">Burner, burn speed, verify after burning, CD-Text and the download cache arrive in milestone 4.</p>
    </div>
  );
}

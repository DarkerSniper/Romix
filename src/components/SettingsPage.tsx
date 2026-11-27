import { useEffect, useState } from "react";
import type { ThemePref } from "../lib/theme";
import type { CacheInfo, DepStatus, UpdateState } from "../shared/api";
import { bridge, isDesktop } from "../lib/bridge";
import type { BurnPrefs } from "../lib/burnPrefs";

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
  burnPrefs: BurnPrefs;
  setBurnPrefs: (patch: Partial<BurnPrefs>) => void;
  cacheLimitGB: number;
  setCacheLimitGB: (gb: number) => void;
  update: UpdateState | null;
  onUpdateNotes: () => void;
}

const formatBytes = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : b > 0 ? `${Math.round(b / 1e3)} KB` : "Empty";

function sinceText(t?: number) {
  if (!t) return "";
  const min = Math.round((Date.now() - t) / 60000);
  return min < 1 ? "Checked just now" : min < 60 ? `Checked ${min} min ago` : min < 60 * 24 ? `Checked ${Math.round(min / 60)} h ago` : `Checked ${new Date(t).toLocaleDateString()}`;
}

function updateHint(u: UpdateState): string {
  switch (u.phase) {
    case "checking":
      return "Checking…";
    case "none":
      return `You're up to date · ${sinceText(u.lastCheck)}`;
    case "available":
      return `Romix ${u.available!.version} is available${u.available!.prerelease ? " (preview)" : ""}`;
    case "downloading":
      return `Downloading ${u.available?.version}… ${Math.round(u.progress * 100)}%`;
    case "installing":
      return "Installing…";
    case "error":
      return u.error ?? "Couldn't check for updates";
    default:
      return sinceText(u.lastCheck) || "Not checked yet";
  }
}

export function SettingsPage({ pref, onChange, onToast, burnPrefs, setBurnPrefs, cacheLimitGB, setCacheLimitGB, update: upd, onUpdateNotes }: SettingsPageProps) {
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

      <h2 className="settings-heading">Updates</h2>
      <section className="settings-group">
        <div className="settings-row">
          <div className="settings-text">
            <div className="settings-label">Romix {upd?.current ?? ""}</div>
            <div className={`settings-hint ${upd?.phase === "error" ? "is-warning" : ""}`}>{upd ? updateHint(upd) : "…"}</div>
          </div>
          <div className="settings-actions">
            {upd?.available && (upd.phase === "available" || upd.phase === "error") && (
              <>
                <button className="link-btn" onClick={onUpdateNotes}>
                  What's new
                </button>
                <button className="btn btn-primary" onClick={() => void bridge.installUpdate()}>
                  {upd.kind === "dev" ? "Open Release Page" : "Update"}
                </button>
              </>
            )}
            <button className="btn" onClick={() => void bridge.checkForUpdate()} disabled={!upd || upd.phase === "checking" || upd.phase === "downloading" || upd.phase === "installing"}>
              Check for Updates
            </button>
          </div>
        </div>
        <label className="settings-row settings-row-sep">
          <div className="settings-text">
            <div className="settings-label">Check automatically</div>
            <div className="settings-hint">Once a day when Romix opens. Nothing is downloaded until you choose Update.</div>
          </div>
          <span className="toggle">
            <input type="checkbox" checked={upd?.prefs.auto ?? true} disabled={!upd} onChange={(e) => void bridge.setUpdatePrefs({ auto: e.target.checked })} />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
          </span>
        </label>
        <label className="settings-row settings-row-sep">
          <div className="settings-text">
            <div className="settings-label">Include previews</div>
            <div className="settings-hint">Get new versions before they're fully tested.</div>
          </div>
          <span className="toggle">
            <input type="checkbox" checked={upd?.prefs.previews ?? false} disabled={!upd} onChange={(e) => void bridge.setUpdatePrefs({ previews: e.target.checked })} />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
          </span>
        </label>
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

      <h2 className="settings-heading">Burning</h2>
      <section className="settings-group">
        <div className="settings-row">
          <div className="settings-text">
            <div className="settings-label">Default speed</div>
            <div className="settings-hint">Best quality burns at the slowest speed the disc supports, which older car stereos read most reliably.</div>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Default burn speed">
            {(["best", "fastest"] as const).map((s) => (
              <button key={s} role="radio" aria-checked={burnPrefs.speed === s} className={burnPrefs.speed === s ? "is-active" : ""} onClick={() => setBurnPrefs({ speed: s })}>
                {burnPrefs.speed === s && <span className="seg-pill" />}
                <span className="seg-label">{s === "best" ? "Best quality" : "Fastest"}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="settings-row settings-row-sep">
          <div className="settings-text">
            <div className="settings-label">Check the disc after burning</div>
            <div className="settings-hint">Reads every track back and compares it bit for bit with what was written.</div>
          </div>
          <span className="toggle">
            <input type="checkbox" checked={burnPrefs.verify} onChange={(e) => setBurnPrefs({ verify: e.target.checked })} />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
          </span>
        </label>
        <label className="settings-row settings-row-sep">
          <div className="settings-text">
            <div className="settings-label">Eject when done</div>
          </div>
          <span className="toggle">
            <input type="checkbox" checked={burnPrefs.eject} onChange={(e) => setBurnPrefs({ eject: e.target.checked })} />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
          </span>
        </label>
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
        <div className="settings-row settings-row-sep">
          <div className="settings-text">
            <div className="settings-label">Keep the cache under</div>
            <div className="settings-hint">Older audio is removed automatically. Songs on the open disc and in saved projects are always kept.</div>
          </div>
          <select value={cacheLimitGB} onChange={(e) => setCacheLimitGB(Number(e.target.value))} aria-label="Cache size limit">
            {[2, 5, 10, 20, 50].map((g) => (
              <option key={g} value={g}>
                {g} GB
              </option>
            ))}
          </select>
        </div>
      </section>

    </div>
  );
}

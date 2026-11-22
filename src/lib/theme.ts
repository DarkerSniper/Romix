import { useCallback, useEffect, useState } from "react";
import "./bridge";

export type ThemePref = "dark" | "light" | "auto";
export type ResolvedTheme = "dark" | "light";

/** Keep in sync with the inline boot script in index.html. */
export const THEME_KEY = "romix.theme";
export const DEFAULT_THEME: ThemePref = "dark";

const media = () => window.matchMedia("(prefers-color-scheme: light)");

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "dark" || v === "light" || v === "auto") return v;
  } catch {
    /* storage unavailable: fall back to default */
  }
  return DEFAULT_THEME;
}

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref === "auto") return media().matches ? "light" : "dark";
  return pref;
}

function apply(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  // Desktop: keep the native window controls in step with the theme.
  window.romix?.setTitleBarTheme(theme);
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readPref()));

  useEffect(() => {
    const update = () => {
      const r = resolve(pref);
      setResolved(r);
      apply(r);
    };
    update();
    if (pref !== "auto") return;
    const mq = media();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [pref]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* not persisted, still applied for this session */
    }
  }, []);

  /** Quick switch between light and dark (leaves auto). */
  const toggle = useCallback(() => setPref(resolved === "dark" ? "light" : "dark"), [resolved, setPref]);

  return { pref, resolved, setPref, toggle };
}

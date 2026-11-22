import { useCallback, useState } from "react";

export interface BurnPrefs {
  /** "best" = the slowest speed the disc supports (most reliable for older players). */
  speed: "best" | "fastest";
  verify: boolean;
  eject: boolean;
}

const KEY = "romix.burnPrefs";
const DEFAULTS: BurnPrefs = { speed: "best", verify: true, eject: true };

function read(): BurnPrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<BurnPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

/** Burn defaults, remembered in Romix's own profile folder. */
export function useBurnPrefs() {
  const [prefs, setState] = useState<BurnPrefs>(read);
  const set = useCallback((patch: Partial<BurnPrefs>) => {
    setState((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* still applies for this session */
      }
      return next;
    });
  }, []);
  return [prefs, set] as const;
}

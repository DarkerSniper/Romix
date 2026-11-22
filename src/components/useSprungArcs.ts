import { useEffect, useRef, useState } from "react";

export interface Arc {
  a0: number;
  a1: number;
}

/**
 * Animates a keyed set of arcs toward their targets with critically-damped
 * easing. New keys grow in from their start angle; removed keys shrink to
 * their midpoint and are then dropped. Returns the arcs to draw this frame.
 */
export function useSprungArcs(targets: Map<string, Arc>, stiffness = 11): Map<string, Arc> {
  const current = useRef(new Map<string, Arc>());
  const [, force] = useState(0);
  const raf = useRef<number>();
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  useEffect(() => {
    let last = performance.now();
    for (const [key, t] of targets) {
      if (!current.current.has(key)) current.current.set(key, { a0: t.a0, a1: t.a0 });
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = 1 - Math.exp(-dt * stiffness);
      let moving = false;

      for (const [key, cur] of current.current) {
        const target = targetsRef.current.get(key);
        const mid = (cur.a0 + cur.a1) / 2;
        const goal = target ?? { a0: mid, a1: mid };
        const a0 = cur.a0 + (goal.a0 - cur.a0) * k;
        const a1 = cur.a1 + (goal.a1 - cur.a1) * k;
        const settled = Math.abs(goal.a0 - a0) < 1e-4 && Math.abs(goal.a1 - a1) < 1e-4;
        if (!target && a1 - a0 < 1e-3) {
          current.current.delete(key);
          continue;
        }
        current.current.set(key, settled ? { ...goal } : { a0, a1 });
        if (!settled) moving = true;
      }

      force((n) => n + 1);
      raf.current = moving ? requestAnimationFrame(tick) : undefined;
    };

    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [targets, stiffness]);

  return current.current;
}

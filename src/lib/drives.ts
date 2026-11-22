import { useEffect, useState } from "react";
import type { DriveInfo } from "../shared/api";
import { bridge } from "./bridge";
import { formatDiscTime } from "./cd";

/** Live list of CD drives and the discs in them. */
export function useDrives() {
  const [drives, setDrives] = useState<DriveInfo[] | null>(null);
  useEffect(() => {
    const off = bridge.onDrivesUpdate(setDrives);
    void bridge.drives().then(setDrives).catch(() => setDrives([]));
    return off;
  }, []);
  return drives;
}

export const burners = (drives: DriveInfo[] | null) => (drives ?? []).filter((d) => d.writesCd && !d.error);

/** Usable seconds on the disc (lead-out limit minus the standard 2 s first pregap). */
export const discCapacitySec = (d?: DriveInfo) => (d?.media?.lastLeadout ? d.media.lastLeadout / 75 : 0);

export type DiscState = "no-burner" | "no-disc" | "ready" | "not-blank-rw" | "not-blank" | "unsupported";

export function discState(d?: DriveInfo): DiscState {
  if (!d) return "no-burner";
  const m = d.media;
  if (!m?.present) return "no-disc";
  if (m.type === "CD-RW" && !m.blank) return "not-blank-rw";
  if (!m.blank) return "not-blank";
  if (!m.supported || (m.type !== "CD-R" && m.type !== "CD-RW")) return "unsupported";
  return "ready";
}

export function discLabel(d?: DriveInfo): string {
  switch (discState(d)) {
    case "no-burner":
      return "No CD burner found";
    case "no-disc":
      return "No disc";
    case "not-blank-rw":
      return "CD-RW with data";
    case "not-blank":
      return `${d!.media!.type} isn't blank`;
    case "unsupported":
      return `${d!.media!.type} can't be used`;
    case "ready":
      return `Blank ${d!.media!.type} · ${formatDiscTime(discCapacitySec(d))}`;
  }
}

export const speedX = (sectorsPerSecond: number) => Math.round(sectorsPerSecond / 75);

/**
 * Picking the update to offer from GitHub's release list. Pure, so it's unit-tested.
 */

export interface GhAsset {
  name: string;
  size: number;
  browser_download_url: string;
  /** "sha256:<hex>", published by GitHub for assets uploaded since mid-2025. */
  digest?: string | null;
}

export interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GhAsset[];
}

type Parsed = { nums: [number, number, number]; pre: string };

/** "v1.2.3" or "1.2.3-beta.1" → parts; undefined if it isn't a version. */
export function parseVersion(v: string): Parsed | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "" } : undefined;
}

/** Semver order: >0 when a is newer. A version with a pre-release tag is older than the same version without one. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  const xa = pa.pre.split("."), xb = pb.pre.split(".");
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]) ? Number(xa[i]) : NaN, nb = /^\d+$/.test(xb[i]) ? Number(xb[i]) : NaN;
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

/** File names electron-builder gives each kind of download. */
export const assetName = (kind: "installer" | "portable", version: string) =>
  kind === "installer" ? `Romix-Setup-${version}.exe` : `Romix-${version}-x64.zip`;

/** The newest release that's newer than `current` and has a download for this kind of install. */
export function pickUpdate(releases: GhRelease[], current: string, opts: { previews: boolean; kind: "installer" | "portable" }): GhRelease | undefined {
  return releases
    .filter((r) => !r.draft && (opts.previews || !r.prerelease) && parseVersion(r.tag_name))
    .filter((r) => compareVersions(r.tag_name, current) > 0)
    .filter((r) => r.assets.some((a) => a.name === assetName(opts.kind, r.tag_name.replace(/^v/, ""))))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
}

/** SHA-256 for a file from a `sha256sum`-style checksums.txt ("<hex>  <name>" or "<hex> *<name>"). */
export function checksumFor(sums: string, file: string): string | undefined {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (m && m[2] === file) return m[1].toLowerCase();
  }
  return undefined;
}

/** GitHub's own "sha256:<hex>" asset digest, if it has one. */
export function digestSha(a: GhAsset): string | undefined {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(a.digest ?? "");
  return m ? m[1].toLowerCase() : undefined;
}

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BurnRequest, ShelfEntry, VerifyReport } from "../src/shared/api";
import { paths } from "./paths";

/** History of burned discs, kept in <app folder>/data/shelf.json. */
const file = () => join(paths.root, "shelf.json");

export async function listShelf(): Promise<ShelfEntry[]> {
  try {
    return (JSON.parse(await readFile(file(), "utf8")) as ShelfEntry[]).sort((a, b) => b.burnedAt - a.burnedAt);
  } catch {
    return [];
  }
}

async function save(list: ShelfEntry[]) {
  const tmp = `${file()}.tmp`;
  await writeFile(tmp, JSON.stringify(list));
  await rename(tmp, file());
}

/** Records a successful burn. Further copies of the same disc within a few hours add to its count. */
export async function recordBurn(req: BurnRequest, verify: VerifyReport | undefined, speedX: number | undefined) {
  if (!req.record) return;
  const list = await listShelf();
  const signature = JSON.stringify([req.record.title, req.keys, req.options, req.trims ?? {}]);
  const verified: ShelfEntry["verified"] = !verify ? "skipped" : verify.tracks.every((t) => t.ok) ? "ok" : "issues";
  const recent = list.find((e) => e.signature === signature && Date.now() - e.burnedAt < 6 * 3600_000);
  if (recent) {
    recent.copies += 1;
    recent.burnedAt = Date.now();
    if (verified === "issues") recent.verified = "issues";
  } else {
    list.push({
      id: randomUUID(),
      signature,
      burnedAt: Date.now(),
      title: req.record.title,
      tracks: req.record.tracks,
      options: req.options,
      copies: 1,
      verified,
      speedX,
    });
  }
  await save(list);
}

export async function removeFromShelf(id: string) {
  await save((await listShelf()).filter((e) => e.id !== id));
}

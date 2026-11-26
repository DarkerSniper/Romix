import { net, protocol } from "electron";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { paths } from "./paths";

/**
 * Print-resolution covers and your own cover images, stored once as files in
 * <app folder>/data/covers (named by content hash) and referenced as
 * romix-cover://c/<hash>.jpg, so saved discs stay small.
 */
const MAX_BYTES = 25 * 1024 * 1024;

export async function storeCover(dataUrl: string): Promise<string> {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error("Unsupported image");
  return storeCoverBytes(Buffer.from(m[2], "base64"), m[1].toLowerCase());
}

/** Path on disk of a romix-cover:// URL (or null if it isn't one of ours). */
export function coverFile(url: string): string | null {
  const m = /^romix-cover:\/\/c\/([a-f0-9]{32}\.(jpg|png|webp))$/.exec(url);
  return m ? join(paths.covers, m[1]) : null;
}

export async function storeCoverBytes(buf: Buffer, kind: string): Promise<string> {
  if (buf.length > MAX_BYTES) throw new Error("That image is too large (over 25 MB)");
  const ext = kind.includes("png") ? "png" : kind.includes("webp") ? "webp" : "jpg";
  const name = `${createHash("sha1").update(buf).digest("hex").slice(0, 32)}.${ext}`;
  const file = join(paths.covers, name);
  if (!existsSync(file)) {
    await mkdir(paths.covers, { recursive: true });
    await writeFile(file, buf);
  }
  return `romix-cover://c/${name}`;
}

export function registerCoverProtocol() {
  protocol.handle("romix-cover", (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
    if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) return new Response("Not found", { status: 404 });
    const file = join(paths.covers, name);
    if (!existsSync(file)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true });
  });
}

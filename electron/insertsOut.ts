import { BrowserWindow, dialog, shell } from "electron";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InsertAction } from "../src/shared/api";
import { paths } from "./paths";

/**
 * Turns the inserts page into a PDF (saved where the user picks, defaulting to
 * <app folder>/data/exports) or sends it to the printer. The page is loaded in a
 * hidden, sandboxed window with no preload, so it can't reach anything.
 */
/** Loads the inserts page in a hidden window; the callback prints or renders it. */
async function withInsertsWindow<T>(html: string, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  await mkdir(paths.temp, { recursive: true });
  const tmp = join(paths.temp, `inserts-${Date.now()}.html`);
  await writeFile(tmp, html, "utf8");
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    await win.loadFile(tmp);
    return await fn(win);
  } finally {
    win.destroy();
    await rm(tmp, { force: true });
  }
}

/** A picture of the inserts page (all pages stacked), for the self-test to inspect. */
export async function renderInsertsPng(html: string, widthMm: number, heightMm: number): Promise<Buffer> {
  await mkdir(paths.temp, { recursive: true });
  const tmp = join(paths.temp, `inserts-shot-${Date.now()}.html`);
  await writeFile(tmp, html, "utf8");
  const w = Math.ceil((widthMm * 96) / 25.4), h = Math.ceil((heightMm * 96) / 25.4);
  const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, javascript: false } });
  try {
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 600));
    return (await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h })).toPNG();
  } finally {
    win.destroy();
    await rm(tmp, { force: true });
  }
}

/** The inserts as PDF bytes (pages keep their own sizes, so booklet spreads stay landscape). */
export function renderInsertsPdf(html: string, paper: "A4" | "Letter"): Promise<Buffer> {
  return withInsertsWindow(html, (win) => win.webContents.printToPDF({ pageSize: paper, printBackground: true, margins: { marginType: "none" }, preferCSSPageSize: true }));
}

export async function outputInserts(html: string, action: InsertAction, title: string, paper: "A4" | "Letter", parent: BrowserWindow | null) {
  if (action === "print") {
    return withInsertsWindow(html, async (win) => {
      const ok = await new Promise<boolean>((resolve) => win.webContents.print({ silent: false, printBackground: true, margins: { marginType: "none" } }, (success) => resolve(success)));
      return { ok, message: ok ? "Sent to the printer" : "Printing was cancelled" };
    });
  }
  const pdf = await renderInsertsPdf(html, paper);
  const exports = join(paths.root, "exports");
  await mkdir(exports, { recursive: true });
  const safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim() || "Romix";
  const opts = { title: "Save inserts as PDF", defaultPath: join(exports, `${safe} - inserts.pdf`), filters: [{ name: "PDF", extensions: ["pdf"] }] };
  const pick = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  if (pick.canceled || !pick.filePath) return { ok: false, message: "Not saved" };
  await writeFile(pick.filePath, pdf);
  shell.showItemInFolder(pick.filePath);
  return { ok: true, message: "Inserts saved as PDF", path: pick.filePath };
}

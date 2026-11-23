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
export async function outputInserts(html: string, action: InsertAction, title: string, paper: "A4" | "Letter", parent: BrowserWindow | null) {
  await mkdir(paths.temp, { recursive: true });
  const tmp = join(paths.temp, `inserts-${Date.now()}.html`);
  await writeFile(tmp, html, "utf8");
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    await win.loadFile(tmp);
    if (action === "print") {
      const ok = await new Promise<boolean>((resolve) => win.webContents.print({ silent: false, printBackground: true, margins: { marginType: "none" } }, (success) => resolve(success)));
      return { ok, message: ok ? "Sent to the printer" : "Printing was cancelled" };
    }
    const pdf = await win.webContents.printToPDF({ pageSize: paper, printBackground: true, margins: { marginType: "none" }, preferCSSPageSize: true });
    const exports = join(paths.root, "exports");
    await mkdir(exports, { recursive: true });
    const safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim() || "Romix";
    const opts = { title: "Save inserts as PDF", defaultPath: join(exports, `${safe} - inserts.pdf`), filters: [{ name: "PDF", extensions: ["pdf"] }] };
    const pick = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
    if (pick.canceled || !pick.filePath) return { ok: false, message: "Not saved" };
    await writeFile(pick.filePath, pdf);
    shell.showItemInFolder(pick.filePath);
    return { ok: true, message: "Inserts saved as PDF", path: pick.filePath };
  } finally {
    win.destroy();
    await rm(tmp, { force: true });
  }
}

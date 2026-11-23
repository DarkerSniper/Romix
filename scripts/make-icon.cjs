// Renders build/icon.png (1024 px) from the Romix mark, using Electron itself.
// Run: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require("electron");
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const SIZE = 1024;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect x="64" y="64" width="896" height="896" rx="200" fill="#1c1c1e"/>
  <g transform="translate(192 192) scale(10)">
    <path fill="#f5f5f7" d="M57.98 17A30 30 0 1 1 32 2V25A7 7 0 1 0 38.06 28.5Z"/>
    <path fill="#f5f5f7" opacity="0.32" d="M33.5 2.04A30 30 0 0 1 57.23 15.7L39.4 26A7 7 0 0 0 33.5 25.16Z"/>
  </g>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const out = join(__dirname, "..", "build");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "icon.png"), img.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log("build/icon.png written");
  app.exit(0);
});

import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { BurnProgress, DepStatus, DriveInfo, ImportResult, PrepUpdate, RomixBridge, UpdateState } from "../src/shared/api";

// The only surface the UI gets. No Node, no raw ipcRenderer, no file system.
const bridge: RomixBridge = {
  resolve: (videoId) => ipcRenderer.invoke("romix:resolve", videoId),

  deps: () => ipcRenderer.invoke("romix:deps"),
  installDeps: () => ipcRenderer.invoke("romix:install-deps"),
  onDepsUpdate: (cb) => {
    const h = (_e: unknown, list: DepStatus[]) => cb(list);
    ipcRenderer.on("romix:deps", h);
    return () => ipcRenderer.removeListener("romix:deps", h);
  },

  prepare: (source) => ipcRenderer.invoke("romix:prepare", source),
  cancelPrep: (key) => ipcRenderer.send("romix:cancel-prep", key),
  onPrepUpdate: (cb) => {
    const h = (_e: unknown, u: PrepUpdate) => cb(u);
    ipcRenderer.on("romix:prep", h);
    return () => ipcRenderer.removeListener("romix:prep", h);
  },
  renderDisc: (req) => ipcRenderer.invoke("romix:render", req),
  pathForFile: (file) => webUtils.getPathForFile(file),

  cacheInfo: () => ipcRenderer.invoke("romix:cache-info"),
  clearCache: () => ipcRenderer.invoke("romix:clear-cache"),
  updateYtdlp: () => ipcRenderer.invoke("romix:update-ytdlp"),
  updateState: () => ipcRenderer.invoke("romix:update-state"),
  checkForUpdate: () => ipcRenderer.invoke("romix:update-check"),
  installUpdate: () => ipcRenderer.invoke("romix:update-install"),
  setUpdatePrefs: (patch) => ipcRenderer.invoke("romix:update-prefs", patch),
  dismissUpdate: () => ipcRenderer.send("romix:update-dismiss"),
  openReleasePage: () => ipcRenderer.send("romix:update-page"),
  onUpdateState: (cb) => {
    const h = (_e: unknown, s: UpdateState) => cb(s);
    ipcRenderer.on("romix:update", h);
    return () => ipcRenderer.removeListener("romix:update", h);
  },
  setTitleBarTheme: (theme) => ipcRenderer.send("romix:titlebar-theme", theme),

  drives: () => ipcRenderer.invoke("romix:drives"),
  onDrivesUpdate: (cb) => {
    const h = (_e: unknown, d: DriveInfo[]) => cb(d);
    ipcRenderer.on("romix:drives", h);
    return () => ipcRenderer.removeListener("romix:drives", h);
  },
  burn: (req) => ipcRenderer.invoke("romix:burn", req),
  onBurnProgress: (cb) => {
    const h = (_e: unknown, p: BurnProgress) => cb(p);
    ipcRenderer.on("romix:burn", h);
    return () => ipcRenderer.removeListener("romix:burn", h);
  },
  cancelBurn: () => ipcRenderer.send("romix:cancel-burn"),
  endBurnSession: () => ipcRenderer.send("romix:end-burn-session"),
  eject: (driveId) => ipcRenderer.invoke("romix:eject", driveId),
  erase: (driveId) => ipcRenderer.invoke("romix:erase", driveId),

  analyze: (key) => ipcRenderer.invoke("romix:analyze", key),
  storeCover: (dataUrl) => ipcRenderer.invoke("romix:store-cover", dataUrl),
  listShelf: () => ipcRenderer.invoke("romix:shelf"),
  removeFromShelf: (id) => ipcRenderer.invoke("romix:shelf-remove", id),
  setShelfInserts: (id, design) => ipcRenderer.invoke("romix:shelf-inserts", id, design),
  outputInserts: (html, action, title, paper) => ipcRenderer.invoke("romix:inserts", html, action, title, paper),
  setCachePolicy: (limitGB, keys) => ipcRenderer.send("romix:cache-policy", limitGB, keys),

  shareInfo: (tracks) => ipcRenderer.invoke("romix:share-info", tracks),
  exportDisc: (data, includeAudio) => ipcRenderer.invoke("romix:export-disc", data, includeAudio),
  importDisc: (path) => ipcRenderer.invoke("romix:import-disc", path),
  onDiscImported: (cb) => {
    const h = (_e: unknown, r: ImportResult) => cb(r);
    ipcRenderer.on("romix:disc-imported", h);
    return () => ipcRenderer.removeListener("romix:disc-imported", h);
  },

  listProjects: () => ipcRenderer.invoke("romix:projects"),
  loadProject: (id) => ipcRenderer.invoke("romix:project-load", id),
  saveProject: (p) => ipcRenderer.invoke("romix:project-save", p),
  deleteProject: (id) => ipcRenderer.invoke("romix:project-delete", id),
};

contextBridge.exposeInMainWorld("romix", bridge);

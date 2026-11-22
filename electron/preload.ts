import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DepStatus, PrepUpdate, RomixBridge } from "../src/shared/api";

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
  setTitleBarTheme: (theme) => ipcRenderer.send("romix:titlebar-theme", theme),
};

contextBridge.exposeInMainWorld("romix", bridge);

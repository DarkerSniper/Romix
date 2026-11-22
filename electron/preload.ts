import { contextBridge, ipcRenderer } from "electron";
import type { RomixBridge } from "../src/shared/api";

// The only surface the UI gets. No Node, no ipcRenderer, no file system.
const bridge: RomixBridge = {
  resolve: (videoId) => ipcRenderer.invoke("romix:resolve", videoId),
  tools: () => ipcRenderer.invoke("romix:tools"),
  updateYtdlp: () => ipcRenderer.invoke("romix:update-ytdlp"),
  chooseRuntime: () => ipcRenderer.invoke("romix:choose-runtime"),
  setTitleBarTheme: (theme) => ipcRenderer.send("romix:titlebar-theme", theme),
};

contextBridge.exposeInMainWorld("romix", bridge);

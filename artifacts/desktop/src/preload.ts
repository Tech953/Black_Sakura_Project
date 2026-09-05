import { contextBridge, ipcRenderer } from "electron";
import type {
  RendererIpc,
} from "./desktop-bridge";
import { createEngramDesktopBridge } from "./desktop-bridge";

contextBridge.exposeInMainWorld(
  "engram",
  createEngramDesktopBridge(ipcRenderer as unknown as RendererIpc),
);

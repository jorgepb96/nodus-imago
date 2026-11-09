import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ImagoApi } from "../shared/imago";
const api: ImagoApi = {
  call: (command, ...args) =>
    ipcRenderer.invoke("imago:call", command, args[0]),
  onChange: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("imago:changed", handler);
    return () => ipcRenderer.removeListener("imago:changed", handler);
  },
  setAppIcon: (dataUrl) => ipcRenderer.invoke("imago:app-icon", dataUrl),
  onDrop: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof listener>[0],
    ) => listener(payload);
    ipcRenderer.on("imago:dropped", handler);
    return () => ipcRenderer.removeListener("imago:dropped", handler);
  },
};
contextBridge.exposeInMainWorld("imago", api);
// The isolated preload receives native File objects directly from trusted drop
// events. Paths are never accepted from renderer-provided strings or exposed to UI.
window.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (!event.isTrusted || !event.dataTransfer?.files.length) return;
  event.preventDefault();
  const target = document
    .querySelector("[data-drop-target]")
    ?.getAttribute("data-drop-target");
  const paths = Array.from(event.dataTransfer.files)
    .map((file) => webUtils.getPathForFile(file))
    .filter(Boolean);
  if (target && paths.length) ipcRenderer.send("imago:drop", { target, paths });
});

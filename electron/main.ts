import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  session,
  safeStorage,
} from "electron";
import { Worker } from "node:worker_threads";
import path from "node:path";
import fs from "node:fs/promises";
import { validateCommand } from "../shared/validation";
import { IMAGE_EXTENSIONS } from "./import/images";
import { Secrets } from "./secrets/store";
import { ApiProviders } from "./ai/apiProviders";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "imago",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
if (process.env.IMAGO_USER_DATA)
  app.setPath("userData", path.resolve(process.env.IMAGO_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();
let window: BrowserWindow | null = null,
  worker: Worker,
  nextId = 0,
  closing = false;
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
function call(command: string, input?: unknown): Promise<any> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, command, input });
  });
}
const appIconPath = () => path.join(app.getPath("userData"), "last-app-icon.png");
let currentAppIcon: ReturnType<typeof nativeImage.createFromBuffer> | null = null;

function applyAppIcon(image: ReturnType<typeof nativeImage.createFromBuffer>) {
  if (image.isEmpty()) return;
  currentAppIcon = image;
  // The running app icon is a macOS Dock feature in Nodus. The packaged
  // window icon remains static on Windows/Linux, where setIcon can crash some
  // Electron builds under Linux/X11.
  if (process.platform === "darwin" && app.dock) app.dock.setIcon(image);
}

async function restoreAppIcon() {
  try {
    const image = nativeImage.createFromBuffer(await fs.readFile(appIconPath()));
    if (!image.isEmpty()) applyAppIcon(image);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.warn("[app-icon] No se pudo restaurar el icono:", error);
  }
}

async function persistAppIcon(image: ReturnType<typeof nativeImage.createFromBuffer>) {
  const file = appIconPath(),
    temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, image.toPNG());
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    console.warn("[app-icon] No se pudo guardar el icono:", error);
  }
}

function internalFileRequest(command: string) {
  return [
    "csvPreview",
    "queryImage",
    "nodusImport",
    "notionImport",
    "restore",
  ].includes(command);
}
app.whenReady().then(async () => {
  await restoreAppIcon();
  const root = path.join(app.getPath("userData"), "collection");
  await fs.mkdir(root, { recursive: true });
  const secrets = new Secrets(path.join(app.getPath("userData"), "secrets"), {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        safeStorage.getSelectedStorageBackend() !== "basic_text"),
    encrypt: (key) => safeStorage.encryptString(key),
    decrypt: (data) => safeStorage.decryptString(data),
  });
  const providers = new ApiProviders(secrets),
    completionAborts = new Map<number, AbortController>();
  worker = new Worker(path.join(__dirname, "worker.cjs"), {
    workerData: {
      root,
      script: app.isPackaged
        ? path.join(process.resourcesPath, "runtime", "inference.py")
        : path.join(app.getAppPath(), "runtime", "inference.py"),
    },
  });
  let notified = 0;
  worker.on("message", (message) => {
    if (message.event === "complete") {
      const abort = new AbortController();
      completionAborts.set(message.completionId, abort);
      void providers
        .complete(message.input, abort.signal)
        .then(
          (result) =>
            worker.postMessage({
              event: "completionReply",
              completionId: message.completionId,
              ok: true,
              result,
            }),
          (error) =>
            worker.postMessage({
              event: "completionReply",
              completionId: message.completionId,
              ok: false,
              error: error.message,
              fatal: !!error.fatal,
            }),
        )
        .finally(() => completionAborts.delete(message.completionId));
      return;
    }
    if (message.event === "abortCompletion") {
      completionAborts.get(message.completionId)?.abort();
      return;
    }
    if (message.event === "changed") {
      if (Date.now() - notified > 250) {
        notified = Date.now();
        window?.webContents.send("imago:changed");
      }
      return;
    }
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    message.ok ? p.resolve(message.result) : p.reject(new Error(message.error));
  });
  worker.on("error", (error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  });
  worker.on("exit", () => {
    for (const p of pending.values())
      p.reject(new Error("El servicio local se ha detenido. Reinicia Imago."));
    pending.clear();
  });
  const dev =
    process.env.IMAGO_DEV_URL === "http://127.0.0.1:5173"
      ? "http://127.0.0.1:5173"
      : null;
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    callback({
      cancel:
        /^https?:|^wss?:/i.test(url) &&
        !(
          dev &&
          (url.startsWith(dev + "/") || url.startsWith("ws://127.0.0.1:5173/"))
        ),
    });
  });
  protocol.handle("imago", async (request) => {
    try {
      const u = new URL(request.url),
        parts = u.pathname.split("/").filter(Boolean);
      if (
        u.hostname !== "asset" ||
        parts.length !== 2 ||
        !["thumb", "preview"].includes(parts[1]) ||
        !/^[a-z0-9-]{1,200}$/i.test(parts[0])
      )
        return new Response(null, { status: 404 });
      const local = await call("_asset", { id: parts[0], variant: parts[1] });
      return new Response(await fs.readFile(local), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, max-age=86400",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  ipcMain.handle("imago:app-icon", async (event, dataUrl: unknown) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Origen IPC no autorizado.");
    if (
      typeof dataUrl !== "string" ||
      !dataUrl.startsWith("data:image/png;base64,") ||
      dataUrl.length > 8_000_000
    )
      throw new Error("Icono de aplicación no válido.");
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) throw new Error("Icono de aplicación no válido.");
    applyAppIcon(image);
    await persistAppIcon(image);
    return true;
  });
  ipcMain.on("imago:drop", async (event, input) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return;
    try {
      if (
        !input ||
        typeof input.target !== "string" ||
        !Array.isArray(input.paths) ||
        input.paths.length > 100000 ||
        input.paths.some(
          (p: unknown) => typeof p !== "string" || p.length > 10000,
        )
      )
        throw new Error("Archivos arrastrados no válidos.");
      const result =
        input.target === "search"
          ? { queryImage: await call("queryImage", { file: input.paths[0] }) }
          : {
              plan: await call("imagePreview", {
                databaseId: input.target,
                paths: input.paths,
              }),
            };
      event.sender.send("imago:dropped", result);
    } catch (error) {
      event.sender.send("imago:dropped", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  ipcMain.handle(
    "imago:call",
    async (event, command: string, input: unknown) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Origen IPC no autorizado.");
      const safe = validateCommand(command, input);
      if (command === "modelLicense") {
        const model = await call("_modelInfo", safe);
        const filename = model.license.startsWith("Apache")
          ? "Apache-2.0.txt"
          : model.license.startsWith("LFM")
            ? "LFM-Open-License-1.0.txt"
            : "MIT-llama.txt";
        const directory = app.isPackaged
          ? path.join(process.resourcesPath, "legal", "dependencies")
          : path.join(app.getAppPath(), "legal");
        return {
          label: model.label,
          text: await fs.readFile(path.join(directory, filename), "utf8"),
          source:
            model.id === "llama-runtime"
              ? `https://github.com/${model.repository}/releases/tag/${model.revision}`
              : `https://huggingface.co/${model.repository}/tree/${model.revision}`,
        };
      }
      if (command === "credentialsStatus") return providers.keyStatus();
      if (command === "setApiKey") {
        const data = safe as any;
        secrets.set(data.provider, data.key);
        return;
      }
      if (command === "clearApiKey") {
        secrets.clear((safe as any).provider);
        return;
      }
      if (command === "listProviderModels") {
        const settings = await call("_settings");
        return providers.list(
          (safe as any).provider,
          settings.apiProfiles,
          settings.remoteEnabled,
          new AbortController().signal,
        );
      }
      if (internalFileRequest(command)) {
        const filters =
          command === "csvPreview"
            ? [{ name: "CSV", extensions: ["csv", "tsv", "txt"] }]
            : command === "queryImage"
              ? [{ name: "Imágenes", extensions: IMAGE_EXTENSIONS }]
              : command === "nodusImport"
                ? [
                    {
                      name: "SQLite de Nodus",
                      extensions: ["sqlite", "db", "sqlite3"],
                    },
                  ]
                : [
                    {
                      name:
                        command === "restore" ? "Copia Imago" : "Notion ZIP",
                      extensions: command === "restore" ? ["imago"] : ["zip"],
                    },
                  ];
        const result = await dialog.showOpenDialog(window, {
          properties: ["openFile"],
          filters,
        });
        if (result.canceled) return null;
        return call(command, { file: result.filePaths[0] });
      }
      if (command === "imagePreview") {
        const data = safe as any;
        const result = await dialog.showOpenDialog(window, {
          properties:
            data.source === "folder"
              ? ["openDirectory"]
              : ["openFile", "multiSelections"],
          filters: [{ name: "Imágenes", extensions: IMAGE_EXTENSIONS }],
        });
        if (result.canceled) return null;
        return call(command, { ...data, paths: result.filePaths });
      }
      if (command === "relinkImage") {
        const result = await dialog.showOpenDialog(window, {
          properties: ["openFile"],
        });
        if (result.canceled) return false;
        return call(command, {
          ...(safe as object),
          file: result.filePaths[0],
        });
      }
      if (command === "importModel") {
        const result = await dialog.showOpenDialog(window, {
          properties: ["openDirectory"],
        });
        if (result.canceled) return false;
        return call(command, {
          ...(safe as object),
          directory: result.filePaths[0],
        });
      }
      if (command === "backup" || command === "export") {
        const data = safe as any;
        const ext = command === "backup" ? "imago" : data.format;
        const result = await dialog.showSaveDialog(window, {
          defaultPath:
            command === "backup" ? "Nodus Imago.imago" : "export." + ext,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        });
        if (result.canceled || !result.filePath) return false;
        return call(command, { ...data, file: result.filePath });
      }
      return call(command, safe);
    },
  );
  function createWindow() {
    window = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 1000,
      minHeight: 680,
      title: "Nodus Imago",
      backgroundColor: "#fafafa",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("closed", () => {
      window = null;
    });
    if (dev) void window.loadURL(dev);
    else void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  createWindow();
  app.on("activate", () => {
    if (!window) createWindow();
  });
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (closing || !worker) return;
  event.preventDefault();
  closing = true;
  void call("_close").finally(() => app.exit());
  setTimeout(() => app.exit(), 3000).unref();
});

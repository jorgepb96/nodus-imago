import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  protocol,
  session,
  safeStorage,
  shell,
} from "electron";
import { Worker } from "node:worker_threads";
import path from "node:path";
import fs from "node:fs/promises";
import { validateCommand } from "../shared/validation";
import { IMAGE_EXTENSIONS } from "./import/images";
import { Secrets } from "./secrets/store";
import { ApiProviders } from "./ai/apiProviders";
import { Gazetteer } from "./geo/gazetteer";
import { isMapTileRequest } from "./geo/mapRequests";
import { externalHttpsUrl } from "../shared/externalLinks";
import { PROVIDERS } from "../shared/aiConfig";
import { DesktopBackups } from "./export/desktopBackups";
import { Updates } from "./updates";
import { autoUpdater } from "electron-updater";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
let backups: DesktopBackups | undefined;
let updates: Updates | undefined;
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
// The artwork revision is part of the filename so a persisted icon from an
// older logo design can never override the current packaged app icon.
const appIconPath = () =>
  path.join(app.getPath("userData"), "last-app-icon-camera-lens-tile-v5.png");
let currentAppIcon: ReturnType<typeof nativeImage.createFromBuffer> | null =
  null;

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
    const image = nativeImage.createFromBuffer(
      await fs.readFile(appIconPath()),
    );
    if (!image.isEmpty()) {
      applyAppIcon(image);
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.warn("[app-icon] No se pudo restaurar el icono:", error);
  }
  // Set the approved artwork before creating the window or waiting for the
  // renderer/worker. A fresh profile must never depend on a later UI update.
  const file = nativeTheme.shouldUseDarkColors ? "icon-dark.png" : "icon.png";
  const directory = app.isPackaged
    ? path.join(process.resourcesPath, "icons")
    : path.join(app.getAppPath(), "build");
  const image = nativeImage.createFromBuffer(
    await fs.readFile(path.join(directory, file)),
  );
  applyAppIcon(image);
  await persistAppIcon(image);
}

async function persistAppIcon(
  image: ReturnType<typeof nativeImage.createFromBuffer>,
) {
  const file = appIconPath(),
    temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
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
  const places = new Gazetteer(
    path.join(app.getAppPath(), "electron/assets/gazetteer/cities.tsv.gz"),
  );
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
  const approvedEndpoints = new Set<string>();
  const providers = new ApiProviders(secrets, fetch, async (provider, base) => {
      const entry = provider + "|" + base;
      if (approvedEndpoints.has(entry)) return true;
      if (!window) return false;
      const result = await dialog.showMessageBox(window, {
        type: "question",
        title: "Autorizar destino de la clave",
        message: `${PROVIDERS[provider].label}: ${base}`,
        detail:
          "Este destino difiere del endpoint oficial. Se enviará la clave guardada a esta dirección. Autorízalo solo si reconoces el servidor. La autorización dura esta sesión.",
        buttons: ["Cancelar", "Autorizar destino"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) return false;
      approvedEndpoints.add(entry);
      return true;
    }),
    completionAborts = new Map<number, AbortController>();
  worker = new Worker(path.join(__dirname, "worker.cjs"), {
    workerData: {
      root,
      script: app.isPackaged
        ? path.join(process.resourcesPath, "runtime", "inference.py")
        : path.join(app.getAppPath(), "runtime", "inference.py"),
    },
  });
  let notified = 0,
    trailing: ReturnType<typeof setTimeout> | undefined;
  worker.on("message", (message) => {
    if (message.event === "complete") {
      const abort = new AbortController();
      completionAborts.set(message.completionId, abort);
      void (
        message.input?.embedding === true
          ? providers.embed(message.input, abort.signal)
          : providers.complete(message.input, abort.signal)
      )
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
      // At most one refresh every 250 ms, but never drop the last one: a job
      // finishing right after another change must still reach the interface.
      const send = () => {
        notified = Date.now();
        trailing = undefined;
        window?.webContents.send("imago:changed");
      };
      const wait = 250 - (Date.now() - notified);
      if (wait <= 0) send();
      else trailing ??= setTimeout(send, wait);
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
  backups = new DesktopBackups(app.getPath("userData"), secrets, {
    write: (file, application) => call("_writeBackup", { file, application }),
    verify: (file) => call("_verifyBackup", { file }),
    restore: (file, replace) => call("_restoreBackup", { file, replace }),
    cancel: () => call("_cancelBackup"),
    lockRestore: () => call("_beginRestore"),
    unlockRestore: () => call("_endRestore"),
    updates: () => updates?.status().preferences ?? { automaticChecks: true, autoDownload: true, beta: false },
    applyUpdates: async (preferences) => updates?.configure(preferences),
    client: async () =>
      window
        ? window.webContents.executeJavaScript(
            `Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('imago.')))`,
          )
        : JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "client-layout.json"), "utf8")),
    applyClient: async (client) => {
      if (window)
        await window.webContents.executeJavaScript(
          `for(const k of Object.keys(localStorage))if(k.startsWith('imago.'))localStorage.removeItem(k);for(const [k,v] of Object.entries(${JSON.stringify(client)}))if(k.startsWith('imago.')&&typeof v==='string')localStorage.setItem(k,v);`,
        );
    },
    changed: () => window?.webContents.send("imago:changed"),
  });
  let updateLock = false;
  let packageType = "AppImage";
  if (process.platform === "linux")
    packageType = await fs
      .readFile(path.join(process.resourcesPath, "package-type"), "utf8")
      .then((x) => x.trim())
      .catch(() => "AppImage");
  updates = new Updates(autoUpdater, {
    userData: app.getPath("userData"),
    version: app.getVersion(),
    packaged: app.isPackaged,
    disabled: process.env.IMAGO_DISABLE_UPDATES === "1",
    platform: process.platform,
    arch: process.arch,
    packageType,
    changed: () => window?.webContents.send("imago:changed"),
    canInstall: async () => {
      if (!app.isPackaged)
        throw Error("Instala la versión empaquetada para actualizar.");
      if (process.platform === "darwin") {
        const bundle = path.dirname(
          path.dirname(path.dirname(process.execPath)),
        );
        const signature = await promisify(execFile)("/usr/bin/codesign", [
          "-dv",
          "--verbose=4",
          bundle,
        ]).catch(() => ({ stdout: "", stderr: "" }));
        if (
          !/Authority=Developer ID Application:/.test(
            signature.stdout + signature.stderr,
          )
        )
          throw Error(
            "Esta compilación de prueba de macOS no está firmada para actualización nativa. La instalación automática se validará con la release firmada.",
          );
      }
    },
    prepare: async (password, backup) => {
      await call("_beginRestore");
      updateLock = true;
      if (backup) await backups!.create(undefined, "before-update", password);
    },
    recovery: async () => {
      const status = await backups!.status();
      return {
        configured: !!status.folder,
        ready: !!status.folder && status.passwordStored,
      };
    },
    finish: async (success) => {
      if (success) {
        await backups!.close();
        await call("_close");
        closing = true;
      } else if (closing) {
        app.relaunch();
        app.exit();
      } else if (updateLock) {
        updateLock = false;
        await call("_endRestore");
      }
    },
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
        !isMapTileRequest(url, details.resourceType) &&
        !(
          dev &&
          (url.startsWith(dev + "/") || url.startsWith("ws://127.0.0.1:5173/"))
        ),
    });
  });
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://tile.openstreetmap.org/*"] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      headers["User-Agent"] =
        `Nodus-Imago/${app.getVersion()} (+https://github.com/jorgepb96/nodus-imago)`;
      // Chromium honours the tile server's caching headers. Keep the default cache.
      callback({ requestHeaders: headers });
    },
  );
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
      if (command === "openExternalLink") {
        const url = externalHttpsUrl((safe as { url: string }).url);
        if (!url) throw new Error("Solo se permiten enlaces HTTPS válidos.");
        await shell.openExternal(url);
        return;
      }
      if (command === "searchPlaces")
        return places.search((safe as { query: string }).query);
      if (command === "openMapAttribution") {
        await shell.openExternal("https://www.openstreetmap.org/copyright");
        return;
      }
      if (command === "modelLicense") {
        const model = await call("_modelInfo", safe);
        const filename =
          model.id === "harrier-oss-v1-0.6b-q8_0"
            ? "MIT-harrier.txt"
            : model.license.startsWith("Apache")
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
      if (command === "reloadInterface") { setTimeout(() => window?.webContents.reload(), 100); return; }
      // Deterministic banner coverage in the unpackaged E2E profile, as in
      // Nodus; a packaged build never reads this variable.
      const simulated = !app.isPackaged && process.env.IMAGO_E2E_UPDATE_STATUS;
      if (simulated && ["updateStatus", "updateCheck", "updateInstall"].includes(command)) {
        const [status, errorCode] = simulated.split(":");
        return {
          ...updates!.status(),
          status,
          errorCode: errorCode || undefined,
          version: "0.2.0",
          progress: status === "downloading" ? 42 : status === "downloaded" ? 100 : null,
          message: "",
        };
      }
      if (command === "updateStatus") return updates!.status();
      if (command === "updateConfigure") return updates!.configure(safe as any);
      if (command === "updateCheck") return updates!.check();
      if (command === "updateDownload") {
        await updates!.download();
        return;
      }
      if (command === "updateInstall") {
        // As in Nodus, "Instalar y reiniciar" is the confirmation itself.
        await updates!.install((safe as any)?.password);
        return;
      }
      if (command.startsWith("backup") && command !== "backup") {
        const b = backups!,
          data = safe as any;
        if (command === "backupStatus") return b.status();
        if (command === "backupConfigure") return b.configure(data);
        if (command === "backupSetPassword")
          return b.setPassword(data.password);
        if (command === "backupChooseFolder") {
          const result = await dialog.showOpenDialog(window, {
            properties: ["openDirectory", "createDirectory"],
          });
          return result.canceled ? null : b.folder(result.filePaths[0]);
        }
        if (command === "backupRun") {
          const result = await dialog.showSaveDialog(window, {
            defaultPath: path.join(
              (await b.status()).folder || app.getPath("documents"),
              "Nodus Imago - " +
                new Date().toISOString().slice(0, 10) +
                ".imago",
            ),
            filters: [{ name: "Copia Imago", extensions: ["imago"] }],
          });
          return result.canceled || !result.filePath
            ? null
            : b.create(result.filePath, "manual", data?.password);
        }
        if (command === "backupPickRestore") {
          const result = await dialog.showOpenDialog(window, {
            properties: ["openFile"],
            filters: [{ name: "Copia Imago", extensions: ["imago"] }],
          });
          return result.canceled ? null : b.pick(result.filePaths[0]);
        }
        if (command === "backupInspect")
          return b.inspect(data.token, data.password);
        if (command === "backupVerify") return b.verify(data.id, data.password);
        if (command === "backupArchive")
          return b.archive(data.id, data.archived);
        if (command === "backupReveal") {
          const file = data.id ? b.file(data.id) : (await b.status()).folder;
          if (file) shell.showItemInFolder(file);
          return;
        }
        if (command === "backupRestore") {
          const status = await call("status");
          if (status.databases) {
            if (!data.replace)
              throw Error("Confirma la sustitución de la colección actual.");
            const answer = await dialog.showMessageBox(window, {
              type: "warning",
              title: "Restaurar colección",
              message:
                "Se sustituirá la colección actual por la copia comprobada.",
              detail:
                "Antes se creará una copia cifrada y verificada de la colección actual en la carpeta configurada. Las claves actuales se conservan.",
              buttons: ["Cancelar", "Crear copia y restaurar"],
              defaultId: 0,
              cancelId: 0,
            });
            if (answer.response !== 1) return null;
          }
          return b.restore(
            data.token,
            data.password,
            !!status.databases,
            data.restoreCredentials,
          );
        }
      }
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
      if (
        command === "backup" ||
        command === "export" ||
        command === "agreementExport"
      ) {
        const data = safe as any;
        const ext = command === "backup" ? "imago" : data.format;
        const result = await dialog.showSaveDialog(window, {
          defaultPath:
            command === "backup"
              ? "Nodus Imago.imago"
              : command === "agreementExport"
                ? "Nodus Imago - concordancia." + ext
                : "export." + ext,
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
    let layoutSaved = false;
    window.on("close", (event) => {
      if (layoutSaved || closing || !window) return;
      event.preventDefault();
      const target = window;
      void target.webContents.executeJavaScript(`Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('imago.')))`)
        .then(client => fs.writeFile(path.join(app.getPath("userData"), "client-layout.json"), JSON.stringify(client), {mode: 0o600}))
        .catch(() => {})
        .finally(() => { layoutSaved = true; if (!target.isDestroyed()) target.close(); });
    });
    window.on("closed", () => {
      window = null;
    });
    if (dev) void window.loadURL(dev);
    else void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  createWindow();
  window!.webContents.once("did-finish-load", () => {
    backups?.start();
    updates?.start();
  });
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
  updates?.close();
  void (async () => {
    await backups?.close();
    await call("_close");
  })().finally(() => app.exit());
  setTimeout(() => app.exit(), 30000).unref();
});

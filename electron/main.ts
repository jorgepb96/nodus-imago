import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  session,
  safeStorage,
  shell,
} from "electron";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import { chatTurnSchema, validateCommand } from "../shared/validation";
import { IMAGE_EXTENSIONS } from "./import/images";
import { Secrets } from "./secrets/store";
import { ApiProviders } from "./ai/apiProviders";
import { ChatRunner } from "./chat/turn";
import { runCalc, sandboxScript } from "./chat/sandbox";
import { McpHost } from "./mcp/server";
import { McpTunnel } from "./mcp/tunnel";
import { isMcpTunnelDiagnosticsUrl } from "../shared/mcpTunnel";
import { commonsQuery, parseCommons } from "../shared/commons";
import {
  AUTHORITY_SOURCES,
  fitsKind,
  iconclassItemUrl,
  iconclassSearchUrl,
  parseIconclassItem,
  parseIconclassSearch,
  parseWikidataEntities,
  rankIconclass,
  parseWikidataSearch,
  wikidataEntitiesUrl,
  wikidataSearchUrl,
  type AuthorityKind,
  type AuthorityLink,
  type AuthoritySource,
} from "../shared/authority";
import { HeritageFinder } from "./heritage/finder";

import { platesHtml } from "./export/plates";
import { metres } from "../shared/viewpoints";
import { Gazetteer } from "./geo/gazetteer";
import { isCommonsImageRequest, isMapTileRequest } from "./geo/mapRequests";
import { externalHttpsUrl } from "../shared/externalLinks";
import { PROVIDERS, remoteProvider } from "../shared/aiConfig";
import { closestAspect, restorationRequest } from "../shared/restoration";
import { DesktopBackups } from "./export/desktopBackups";
import { Updates } from "./updates";
import { Announcements } from "./announcements";
import { autoUpdater } from "electron-updater";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
/** Wikimedia asks automated clients to name themselves and a way to find them. */
const WIKIMEDIA_USER_AGENT = "NodusImago/0.1 (https://github.com/jorgepb96/nodus-imago)";

/** A JSON answer from a Wikimedia or Iconclass API, waiting when asked to slow down (429). */
async function wikimediaJson(url: string, source: AuthoritySource) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": WIKIMEDIA_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new Error(source === "iconclass" ? "No se pudo conectar con Iconclass." : "No se pudo conectar con Wikidata.");
    });
    if (response.status === 429 && attempt < 3) {
      const wait = Math.min(30, Number(response.headers.get("retry-after")) || 5 * (attempt + 1));
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    if (!response.ok) throw new Error(`${AUTHORITY_SOURCES[source]}: HTTP ${response.status}`);
    return response.json();
  }
}

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
let announcements: Announcements | undefined;
let chats: ChatRunner | undefined;
let mcp: McpHost | undefined;
let tunnel: McpTunnel | undefined;
let restorationAbort: AbortController | null = null;
/** Prepared image files by «id/variant?revision», so repeat loads skip the worker. */
const assetPaths = new Map<string, string>();
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
/** Interface language, for the labels Wikidata answers with. */
async function interfaceLanguage(): Promise<"es" | "en"> {
  const status = (await call("status")) as { settings: { language: string } };
  return status.settings.language === "en" ? "en" : "es";
}
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
  const heritageFinder = new HeritageFinder(() => places);
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
  // A test driver (Playwright attaches through remote debugging) never sees
  // the first-run introduction unless a test asks for it.
  if (
    (app.commandLine.hasSwitch("remote-debugging-port") || app.commandLine.hasSwitch("inspect")) &&
    process.env.IMAGO_FORCE_WELCOME !== "1"
  )
    process.env.IMAGO_AUTOMATED = "1";
  worker = new Worker(path.join(__dirname, "worker.cjs"), {
    workerData: {
      root,
      gazetteer: path.join(app.getAppPath(), "electron/assets/gazetteer/cities.tsv.gz"),
      script: app.isPackaged
        ? path.join(process.resourcesPath, "runtime", "inference.py")
        : path.join(app.getAppPath(), "runtime", "inference.py"),
    },
  });
  let notified = 0,
    trailing: ReturnType<typeof setTimeout> | undefined,
    pendingScope: "jobs" | "data" = "jobs";
  worker.on("message", (message) => {
    if (message.event === "complete") {
      const abort = new AbortController();
      completionAborts.set(message.completionId, abort);
      void (
        message.input?.embedding === true
          ? providers.embed(message.input, abort.signal)
          : message.input?.stream === true
            ? providers.completeStream(
                message.input,
                (text) =>
                  worker.postMessage({
                    event: "completionDelta",
                    completionId: message.completionId,
                    text,
                  }),
                abort.signal,
              )
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
    if (message.event === "cellStream") {
      window?.webContents.send("imago:cell-stream", message.delta);
      return;
    }
    if (message.event === "abortCompletion") {
      completionAborts.get(message.completionId)?.abort();
      return;
    }
    if (message.event === "changed") {
      // At most one refresh every 250 ms, but never drop the last one: a job
      // finishing right after another change must still reach the interface.
      // Coalesced notifications keep the widest scope: data over jobs.
      if (message.scope !== "jobs") pendingScope = "data";
      const send = () => {
        notified = Date.now();
        trailing = undefined;
        const scope = pendingScope;
        pendingScope = "jobs";
        window?.webContents.send("imago:changed", scope);
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
  announcements = new Announcements({
    userData: app.getPath("userData"),
    version: app.getVersion(),
    // Electron's network stack, so the system proxy applies.
    fetch: net.fetch.bind(net) as typeof fetch,
    changed: () => window?.webContents.send("imago:changed", "announcements"),
    url: process.env.IMAGO_ANNOUNCEMENTS_URL || undefined,
    // An automated run asks no public server unless it points at its own file.
    disabled:
      process.env.IMAGO_DISABLE_ANNOUNCEMENTS === "1" ||
      (process.env.IMAGO_AUTOMATED === "1" && !process.env.IMAGO_ANNOUNCEMENTS_URL),
  });
  updates = new Updates(autoUpdater, {
    userData: app.getPath("userData"),
    version: app.getVersion(),
    packaged: app.isPackaged,
    disabled: process.env.IMAGO_DISABLE_UPDATES === "1",
    platform: process.platform,
    arch: process.arch,
    packageType,
    changed: () => window?.webContents.send("imago:changed", "jobs"),
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
        // From here the service refuses work: the window must stop asking.
        closing = true;
        window?.webContents.send("imago:closing");
        await call("_close");
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
  // Every permission is refused, except writing plain text to the clipboard
  // from the app's own page («Copiar», «Copiar cita», «Copiar los pies»).
  const appPage = dev ?? pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
  const allowed = (permission: string, url: string | undefined) =>
    permission === "clipboard-sanitized-write" && !!url && url.startsWith(appPage);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
    callback(allowed(permission, wc?.getURL())),
  );
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed(permission, wc?.getURL()));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    callback({
      cancel:
        /^https?:|^wss?:/i.test(url) &&
        !isMapTileRequest(url, details.resourceType) &&
        !isCommonsImageRequest(url, details.resourceType) &&
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
      // A restored version: imago://restoration/<id>; what changed in it: imago://restoration/<id>/changes.
      if (u.hostname === "restoration" && (parts.length === 1 || (parts.length === 2 && parts[1] === "changes")) && /^[a-z0-9-]{1,200}$/i.test(parts[0])) {
        const file = await call(parts[1] ? "_restorationDiff" : "_restorationFile", { id: parts[0] });
        return new Response(await fs.readFile(file), {
          headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" },
        });
      }
      if (
        u.hostname !== "asset" ||
        parts.length !== 2 ||
        !["thumb", "preview", "full"].includes(parts[1]) ||
        !/^[a-z0-9-]{1,200}$/i.test(parts[0])
      )
        return new Response(null, { status: 404 });
      // An image already prepared is read straight from disk: asking the
      // worker again queued thumbnails behind imports and indexing, and they
      // showed blank for a while. Only versioned URLs (?v=revision) are
      // remembered, so a turned or cropped image is looked up afresh.
      const versioned = u.searchParams.has("v"),
        cacheKey = `${parts[0]}/${parts[1]}?${u.searchParams.get("v")}`;
      let bytes: Buffer | null = null;
      const known = versioned ? assetPaths.get(cacheKey) : undefined;
      if (known) bytes = await fs.readFile(known).catch(() => null);
      if (!bytes) {
        const local: string = await call("_asset", { id: parts[0], variant: parts[1] });
        bytes = await fs.readFile(local);
        if (versioned) {
          if (assetPaths.size >= 20_000) assetPaths.delete(assetPaths.keys().next().value!);
          assetPaths.set(cacheKey, local);
        }
      }
      return new Response(new Uint8Array(bytes), {
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
  chats = new ChatRunner(call, providers, sandboxScript(__dirname), (delta) =>
    window?.webContents.send("imago:chat-delta", delta),
  );
  // The local MCP server: off and read only until the user changes it in Settings.
  mcp = new McpHost({
    file: path.join(app.getPath("userData"), "mcp.json"),
    version: app.getVersion(),
    context: {
      call: (command, input) => (closing ? Promise.reject(new Error("Imago se está cerrando.")) : call(command, input)),
      changed: () => window?.webContents.send("imago:changed", "data"),
      calc: (code, json, timeoutMs) =>
        runCalc(sandboxScript(__dirname), code, json, new AbortController().signal, { timeoutMs }),
    },
    onStatus: () => window?.webContents.send("imago:changed", "mcp"),
  });
  // ChatGPT through OpenAI's tunnel: only when the user set it up, and only while the server is on.
  tunnel = new McpTunnel({
    root: path.join(app.getPath("userData"), "mcp-tunnel"),
    version: app.getVersion(),
    key: {
      get: () => secrets.get("mcptunnel"),
      set: (value) => secrets.set("mcptunnel", value),
      clear: () => secrets.clear("mcptunnel"),
    },
    server: { status: () => mcp!.status(), turnOn: () => mcp!.configure({ enabled: true }) },
    // Electron's network stack, so the system proxy applies.
    fetch: net.fetch.bind(net) as typeof fetch,
    onStatus: () => window?.webContents.send("imago:changed", "mcp"),
  });
  void mcp.start().then(() => tunnel!.startIfConfigured());
  const trusted = (event: Electron.IpcMainInvokeEvent) =>
    !!window &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame;
  ipcMain.handle("imago:chat-send", async (event, input: unknown) => {
    if (!trusted(event)) throw new Error("Origen IPC no autorizado.");
    return chats!.run(chatTurnSchema.parse(input));
  });
  ipcMain.handle("imago:chat-cancel", async (event, id: unknown) => {
    if (!trusted(event)) throw new Error("Origen IPC no autorizado.");
    if (typeof id === "string") chats!.cancel(id);
  });
  // While Imago closes (quitting, or installing an update) the service stops
  // answering. The window is still on screen for a moment and keeps asking —
  // a refresh, a thumbnail list —; those requests simply wait for the app to
  // go instead of showing «Imago se está cerrando.» as an error.
  const untilClosed = () => new Promise<never>(() => {});
  const answer = async (event: Electron.IpcMainInvokeEvent, command: string, input: unknown) => {
    if (closing) return untilClosed();
    try {
      return await handleCall(event, command, input);
    } catch (error) {
      if (closing) return untilClosed();
      throw error;
    }
  };
  const handleCall = async (event: Electron.IpcMainInvokeEvent, command: string, input: unknown) => {
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
      if (command === "announcementsList") return announcements!.list();
      if (command === "announcementsMarkRead") return announcements!.markRead((safe as { id: string }).id);
      if (command === "announcementsClear") return announcements!.clear();
      if (command === "announcementsConfigure") return announcements!.configure((safe as { enabled: boolean }).enabled);
      if (command === "announcementsRefresh") {
        const refresh = await announcements!.refresh("manual");
        return { ...announcements!.list(), refresh };
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
      if (command === "mcpStatus") return mcp!.status();
      if (command === "mcpConfigure") {
        const before = mcp!.status();
        const after = await mcp!.configure(safe as any);
        // The tunnel follows the server: off with it, and onto a new port.
        if (!after.config.enabled) await tunnel!.stop();
        else if (!before.running || before.port !== after.port) void tunnel!.restartIfConfigured();
        return after;
      }
      if (command === "mcpRegenerateToken") {
        const after = await mcp!.regenerateToken();
        void tunnel!.restartIfConfigured();
        return after;
      }
      if (command === "mcpTunnelStatus") return tunnel!.status();
      if (command === "mcpTunnelConnect") return tunnel!.connect(safe as any);
      if (command === "mcpTunnelDisconnect") return tunnel!.disconnect();
      if (command === "mcpTunnelForget") return tunnel!.forget();
      if (command === "mcpTunnelDiagnostics") {
        const url = tunnel!.status().uiUrl;
        if (!url || !isMcpTunnelDiagnosticsUrl(url)) throw new Error("El túnel no está conectado.");
        await shell.openExternal(url);
        return;
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
        const settings = await call("_settings");
        if (!settings.remoteEnabled && data.key.trim() && remoteProvider(data.provider, settings.apiProfiles))
          throw new Error("Activa «Permitir APIs remotas» en Ajustes para introducir claves de API.");
        secrets.set(data.provider, data.key);
        return;
      }
      if (command === "clearApiKey") {
        secrets.clear((safe as any).provider);
        return;
      }
      if (command === "restorationRun") {
        const data = safe as any,
          settings = await call("_settings");
        restorationAbort?.abort();
        const abort = (restorationAbort = new AbortController());
        try {
          const source = await call("_restorationInput", { assetId: data.assetId, region: data.region, baseId: data.baseId });
          // The instructions, then what is known about the photograph.
          const prompt = restorationRequest(data.prompt, data.context ?? "");
          const result = await providers.editImage(
            {
              choice: { provider: data.provider, model: data.model },
              profiles: settings.apiProfiles,
              remoteEnabled: settings.remoteEnabled,
              prompt,
              image: Buffer.from(source.image, "base64"),
              mimeType: source.mimeType,
              aspect: closestAspect(source.sent[0], source.sent[1]),
            },
            abort.signal,
          );
          return await call("_restorationStore", {
            assetId: data.assetId,
            provider: data.provider,
            model: data.model,
            task: data.task,
            prompt,
            region: data.region,
            crop: source.crop,
            result: result.toString("base64"),
            baseId: data.baseId ?? null,
            keepDetail: data.keepDetail,
          });
        } finally {
          if (restorationAbort === abort) restorationAbort = null;
        }
      }
      if (command === "authoritySearch") {
        // Only the text being searched is sent, and only when the user asks.
        const data = safe as { source: AuthoritySource; query: string; kind?: AuthorityKind | null };
        const language = await interfaceLanguage();
        const get = (url: string) => wikimediaJson(url, data.source);
        if (data.source === "iconclass") {
          const notations = parseIconclassSearch(await get(iconclassSearchUrl(data.query)));
          // The texts, eight requests at a time.
          const items: (AuthorityLink | null)[] = [];
          for (let i = 0; i < notations.length; i += 8)
            items.push(...(await Promise.all(notations.slice(i, i + 8).map((n) => get(iconclassItemUrl(n)).then(parseIconclassItem, () => null)))));
          return rankIconclass(items.filter((x): x is AuthorityLink => !!x), data.query);
        }
        const ids = parseWikidataSearch(await get(wikidataSearchUrl(data.query, language)));
        if (!ids.length) return [];
        return parseWikidataEntities(await get(wikidataEntitiesUrl(ids, language)), ids, language)
          .filter((link) => fitsKind(link, data.kind))
          .slice(0, 6);
      }
      if (command === "heritageCandidates") {
        // One-off lookups (new names an AI suggests). Only the names are sent.
        const data = safe as { items: { optionId: string; label: string }[] };
        const towns = await heritageFinder.towns(data.items);
        return heritageFinder.wikidata(data.items, await interfaceLanguage(), towns);
      }
      if (command === "commonsNearby") {
        // Only the place's coordinates are sent, and only when the user asks.
        const data = safe as { latitude: number; longitude: number; radius?: number };
        const response = await fetch(commonsQuery(data.latitude, data.longitude, data.radius), {
          headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
          signal: AbortSignal.timeout(20_000),
        }).catch(() => {
          throw new Error("No se pudo conectar con Wikimedia Commons.");
        });
        if (!response.ok) throw new Error(`Wikimedia Commons: HTTP ${response.status}`);
        return parseCommons(await response.json(), data, metres);
      }
      if (command === "annotationsExport") {
        const data = safe as { databaseId: string };
        const collection = await call("_annotationsW3c", data);
        const target = await dialog.showSaveDialog(window, {
          defaultPath: path.join(app.getPath("documents"), `${String(collection.label).replace(/[\\/:*?"<>|]/g, "-")} - anotaciones.jsonld`),
          filters: [{ name: "JSON-LD", extensions: ["jsonld", "json"] }],
        });
        if (target.canceled || !target.filePath) return null;
        await fs.writeFile(target.filePath, JSON.stringify(collection, null, 2));
        return { file: target.filePath, total: collection.total };
      }
      if (command === "tropyImport") {
        const result = await dialog.showOpenDialog(window, {
          properties: ["openFile"],
          filters: [{ name: "Tropy JSON-LD", extensions: ["json", "jsonld"] }],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        return call("_tropyImport", { file: result.filePaths[0] });
      }
      if (command === "saveCsv") {
        const data = safe as { fileName: string; text: string };
        const target = await dialog.showSaveDialog(window, {
          defaultPath: path.join(app.getPath("documents"), data.fileName.replace(/[\\/:*?"<>|]/g, "-") + ".csv"),
          filters: [{ name: "CSV", extensions: ["csv"] }],
        });
        if (target.canceled || !target.filePath) return null;
        // With a byte-order mark, so spreadsheets read accents correctly.
        await fs.writeFile(target.filePath, "\ufeff" + data.text, "utf8");
        return target.filePath;
      }
      if (command === "methodologyData") {
        const data = await call("_methodologyData", safe);
        return {
          ...data,
          environment: {
            app: app.getVersion(),
            platform: process.platform,
            arch: process.arch,
            electron: process.versions.electron,
            chromium: process.versions.chrome,
          },
        };
      }
      if (command === "methodologyPdf") {
        const data = safe as { html: string; fileName: string; annex: string | null };
        const target = await dialog.showSaveDialog(window, {
          defaultPath: path.join(app.getPath("documents"), data.fileName.replace(/[\\/:*?"<>|]/g, "-") + ".pdf"),
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (target.canceled || !target.filePath) return null;
        // Printed from a file in a hidden window with JavaScript off: the
        // logo and charts are inline, and nothing in the page runs.
        const folder = path.join(app.getPath("temp"), `imago-report-${randomUUID()}`);
        await fs.mkdir(folder, { recursive: true });
        const page = path.join(folder, "report.html");
        await fs.writeFile(page, data.html, "utf8");
        const printer = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
        try {
          await printer.loadFile(page);
          const pdf = await printer.webContents.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true });
          await fs.writeFile(target.filePath, pdf);
        } finally {
          // Destroyed on the next tick: tearing it down at once races Chromium's own cleanup.
          setImmediate(() => {
            if (!printer.isDestroyed()) printer.destroy();
            void fs.rm(folder, { recursive: true, force: true });
          });
        }
        let annex: string | null = null;
        if (data.annex) {
          annex = target.filePath.replace(/\.pdf$/i, "") + ".json";
          await fs.writeFile(annex, data.annex, "utf8");
        }
        return { file: target.filePath, annex };
      }
      if (command === "platesExport") {
        const data = safe as { rowIds: string[]; template: string; title: string; label: string; listTitle: string; start: number };
        const target = await dialog.showSaveDialog(window, {
          defaultPath: path.join(app.getPath("documents"), (data.title || "Laminas").replace(/[\\/:*?"<>|]/g, "-") + ".pdf"),
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (target.canceled || !target.filePath) return null;
        const prepared = await call("_platesPrepare", { rowIds: data.rowIds, template: data.template });
        const page = path.join(prepared.folder, "plates.html");
        await fs.writeFile(page, platesHtml({ ...data, items: prepared.items }));
        const printer = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
        try {
          await printer.loadFile(page);
          const pdf = await printer.webContents.printToPDF({ pageSize: "A4", printBackground: false, preferCSSPageSize: true });
          await fs.writeFile(target.filePath, pdf);
        } finally {
          printer.destroy();
          await fs.rm(prepared.folder, { recursive: true, force: true });
        }
        return { file: target.filePath, figures: prepared.items.length };
      }
      if (command === "restorationCancel") {
        restorationAbort?.abort();
        return;
      }
      if (command === "restorationExport") {
        const data = safe as any;
        const result = await dialog.showSaveDialog(window, {
          defaultPath: path.join(app.getPath("pictures"), `restauracion-${data.id.slice(0, 8)}.${data.format === "jpeg" ? "jpg" : "png"}`),
          filters: [data.format === "jpeg" ? { name: "JPEG", extensions: ["jpg", "jpeg"] } : { name: "PNG", extensions: ["png"] }],
        });
        if (result.canceled || !result.filePath) return null;
        await call("_restorationExport", { id: data.id, target: result.filePath, format: data.format, watermark: data.watermark });
        return result.filePath;
      }
      if (command === "imageModelCatalog") {
        const settings = await call("_settings");
        return providers.imageCatalog(
          settings.apiProfiles,
          settings.remoteEnabled,
          !!(safe as any).refresh,
          new AbortController().signal,
        );
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
    };
  ipcMain.handle("imago:call", answer);
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
      // A hung or crashed page never answers: close anyway after a moment,
      // keeping the layout saved the last time.
      const layout = target.webContents.isCrashed()
        ? Promise.reject(new Error("crashed"))
        : Promise.race([
            target.webContents.executeJavaScript(`Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('imago.')))`),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
          ]);
      void layout
        .then(client => fs.writeFile(path.join(app.getPath("userData"), "client-layout.json"), JSON.stringify(client), {mode: 0o600}))
        .catch(() => {})
        .finally(() => { layoutSaved = true; if (!target.isDestroyed()) target.close(); });
    });
    window.on("closed", () => {
      window = null;
    });
    // If the page's process dies (out of memory, a GPU fault…), load it again
    // instead of leaving a blank window: the collection lives in this process.
    let lastReload = 0;
    window.webContents.on("render-process-gone", (_event, details) => {
      console.error("Renderer gone:", details.reason, details.exitCode);
      if (closing || details.reason === "clean-exit" || !window || window.isDestroyed()) return;
      if (Date.now() - lastReload < 10_000) return;
      lastReload = Date.now();
      window.webContents.reload();
    });
    if (dev) void window.loadURL(dev);
    else void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  createWindow();
  window!.webContents.once("did-finish-load", () => {
    backups?.start();
    updates?.start();
    announcements?.start();
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
  // Calls left unanswered from here are the closing, not errors to show.
  window?.webContents.send("imago:closing");
  updates?.close();
  announcements?.close();
  chats?.cancelAll();
  void (async () => {
    tunnel?.killSync();
    await mcp?.stop().catch(() => {});
    await backups?.close();
    await call("_close");
  })().finally(() => app.exit());
  setTimeout(() => app.exit(), 30000).unref();
});

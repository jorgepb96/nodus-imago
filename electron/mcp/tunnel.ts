// ChatGPT through OpenAI's Secure MCP Tunnel, adapted from Nodus Research.
// Imago downloads the official tunnel-client from its GitHub releases, checks
// its size and SHA-256, runs its doctor and keeps `tunnel-client run` alive
// while Imago is open. The client only connects outwards to OpenAI and talks to
// the local MCP server with the same bearer token; nothing listens on the
// Internet. The runtime key is kept in the system's encrypted store, and
// neither it nor the token ever goes on a command line or to the window.
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import AdmZip from "adm-zip";
import {
  classifyMcpTunnelFailure,
  isIgnorableLocalMcpOAuthDoctorFailure,
  isValidMcpTunnelId,
  mcpTunnelAssetName,
  sanitizeMcpTunnelDiagnostic,
  type McpTunnelConnectInput,
  type McpTunnelErrorCode,
  type McpTunnelStatus,
} from "../../shared/mcpTunnel";
import type { McpStatus } from "../../shared/mcp";

export const MCP_TUNNEL_RELEASE_API = "https://api.github.com/repos/openai/tunnel-client/releases/latest";
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const DOCTOR_TIMEOUT_MS = 45_000;
const READY_TIMEOUT_MS = 25_000;
const TAG = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

type Config = { tunnelId: string; enabled: boolean };
type Runtime = { tag: string; assetName: string; sha256: string; executable: string };
type Asset = { name: string; browser_download_url: string; size: number; digest?: string | null };
type Release = { tag_name: string; assets: Asset[] };
type Child = ChildProcessByStdio<null, Readable, Readable>;

export type McpTunnelOptions = {
  /** userData/mcp-tunnel: settings, the verified client and its health file. */
  root: string;
  version: string;
  /** The runtime key, in the system's encrypted store. */
  key: { get(): string | null; set(value: string): void; clear(): void };
  /** The local MCP server the client forwards to. */
  server: { status(): McpStatus; turnOn(): Promise<McpStatus> };
  fetch?: typeof fetch;
  platform?: string;
  arch?: string;
  onStatus?: () => void;
};

/** OpenAI only lets these addresses serve the client. */
function trustedReleaseUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.startsWith("/openai/tunnel-client/releases/download/");
  } catch {
    return false;
  }
}

export class McpTunnel {
  private state: McpTunnelStatus = {
    configured: false,
    enabled: false,
    hasApiKey: false,
    phase: "not_configured",
    tunnelId: null,
    clientVersion: null,
    installProgress: null,
    uiUrl: null,
    errorCode: null,
    errorDetail: null,
  };
  private child: Child | null = null;
  private logs = "";
  private generation = 0;
  private lifecycle: Promise<unknown> = Promise.resolve();
  private installing: Promise<Runtime> | null = null;
  private fetch: typeof fetch;
  private platform: string;
  private arch: string;

  constructor(private options: McpTunnelOptions) {
    this.fetch = options.fetch ?? fetch;
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
  }

  // ── Files ──────────────────────────────────────────────────────────────────
  private file(name: string) {
    return path.join(this.options.root, name);
  }
  private binaryName() {
    return this.platform === "win32" ? "tunnel-client.exe" : "tunnel-client";
  }
  private readJson<T>(file: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch {
      return null;
    }
  }
  private config(): Config | null {
    const parsed = this.readJson<Partial<Config>>(this.file("config.json"));
    if (!parsed || typeof parsed.tunnelId !== "string" || !isValidMcpTunnelId(parsed.tunnelId)) return null;
    return { tunnelId: parsed.tunnelId, enabled: parsed.enabled === true };
  }
  private writeConfig(config: Config) {
    fs.mkdirSync(this.options.root, { recursive: true });
    fs.writeFileSync(this.file("config.json"), JSON.stringify(config, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(this.file("config.json"), 0o600);
    } catch {
      /* Best effort on Windows. */
    }
  }
  /** The installed client, only if it is exactly where Imago put it. */
  private runtime(): Runtime | null {
    const parsed = this.readJson<Runtime>(this.file("runtime.json"));
    if (
      !parsed ||
      !TAG.test(parsed.tag) ||
      !/^[0-9a-f]{64}$/.test(parsed.sha256) ||
      parsed.assetName !== mcpTunnelAssetName(parsed.tag, this.platform, this.arch)
    )
      return null;
    const expected = path.join(this.options.root, "runtime", parsed.tag, this.binaryName());
    if (path.resolve(parsed.executable) !== path.resolve(expected)) return null;
    try {
      const stat = fs.lstatSync(expected),
        root = fs.realpathSync(this.options.root);
      if (!stat.isFile() || stat.isSymbolicLink() || !fs.realpathSync(expected).startsWith(root + path.sep)) return null;
    } catch {
      return null;
    }
    return parsed;
  }
  private hasKey() {
    try {
      return !!this.options.key.get();
    } catch {
      return false;
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  status(): McpTunnelStatus {
    const config = this.config(),
      hasApiKey = this.hasKey();
    const current = {
      ...this.state,
      configured: !!(config && hasApiKey),
      enabled: config?.enabled === true,
      hasApiKey,
      tunnelId: config?.tunnelId ?? null,
      clientVersion: this.runtime()?.tag.replace(/^v/, "") ?? this.state.clientVersion,
    };
    if (!current.configured && !["installing", "checking", "error"].includes(current.phase))
      return { ...current, phase: "not_configured", uiUrl: null };
    return current;
  }
  private set(patch: Partial<McpTunnelStatus>) {
    this.state = { ...this.state, ...patch };
    this.options.onStatus?.();
    return this.status();
  }
  private fail(code: McpTunnelErrorCode, detail: string) {
    return this.set({ phase: "error", installProgress: null, uiUrl: null, errorCode: code, errorDetail: sanitizeMcpTunnelDiagnostic(detail, this.secrets()) });
  }
  private idle() {
    return this.set({ phase: this.config() ? "stopped" : "not_configured", uiUrl: null, installProgress: null, errorCode: null, errorDetail: null });
  }
  private secrets() {
    let key = "";
    try {
      key = this.options.key.get() ?? "";
    } catch {
      /* No store: nothing to hide. */
    }
    return [key, this.options.server.status().token];
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.then(work, work);
    this.lifecycle = next.catch(() => {});
    return next;
  }

  // ── The official client ───────────────────────────────────────────────────
  private async get(url: string) {
    const response = await this.fetch(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `NodusImago/${this.options.version}` },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`HTTP status ${response.status} al descargar de ${new URL(url).hostname}.`);
    return response;
  }
  private async digest(release: Release, asset: Asset) {
    const direct = asset.digest?.match(/^sha256:([0-9a-f]{64})$/i)?.[1];
    if (direct) return direct.toLowerCase();
    const sums = release.assets.find((a) => a.name === "SHA256SUMS.txt");
    if (!sums || !trustedReleaseUrl(sums.browser_download_url)) throw new Error("La versión oficial no publica una suma SHA-256 verificable.");
    const text = await (await this.get(sums.browser_download_url)).text();
    const match = text
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i))
      .find((m) => m?.[2] === asset.name);
    if (!match) throw new Error(`SHA-256 ausente para ${asset.name}.`);
    return match[1].toLowerCase();
  }
  private async latest() {
    const release = (await (await this.get(MCP_TUNNEL_RELEASE_API)).json()) as Release;
    if (!TAG.test(release.tag_name)) throw new Error("La versión publicada del cliente de túnel no es válida.");
    const wanted = mcpTunnelAssetName(release.tag_name, this.platform, this.arch);
    if (!wanted) throw new Error(`Plataforma no soportada: ${this.platform}-${this.arch}.`);
    const asset = release.assets.find((a) => a.name === wanted);
    if (!asset) throw new Error(`OpenAI no ofrece tunnel-client ${wanted} en la versión actual.`);
    if (!trustedReleaseUrl(asset.browser_download_url)) throw new Error("La descarga no procede de la publicación oficial de OpenAI en GitHub.");
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ARCHIVE_BYTES) throw new Error(`Tamaño no válido para ${wanted}.`);
    return { release, asset, sha256: await this.digest(release, asset) };
  }
  private async download(asset: Asset, sha256: string, target: string) {
    const response = await this.get(asset.browser_download_url);
    const length = Number(response.headers.get("content-length") ?? asset.size);
    if (!Number.isFinite(length) || length <= 0 || length > MAX_ARCHIVE_BYTES) throw new Error("El archivo oficial supera el tamaño permitido.");
    if (!response.body) throw new Error("La descarga oficial no devolvió contenido.");
    const handle = await fsp.open(target, "w", 0o600),
      hash = createHash("sha256");
    let received = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        received += chunk.length;
        if (received > MAX_ARCHIVE_BYTES) throw new Error("La descarga oficial supera el tamaño permitido.");
        hash.update(chunk);
        await handle.write(chunk);
        this.set({ installProgress: Math.max(0, Math.min(0.95, received / asset.size)) });
      }
    } finally {
      await handle.close();
    }
    if (received !== asset.size) throw new Error(`Descarga incompleta: ${received} de ${asset.size} bytes.`);
    const actual = hash.digest("hex");
    if (actual !== sha256) throw new Error(`Fallo de integridad SHA-256 (${actual}).`);
  }
  private install(): Promise<Runtime> {
    this.installing ??= (async () => {
      this.set({ phase: "installing", installProgress: 0, errorCode: null, errorDetail: null, uiUrl: null });
      await fsp.mkdir(this.options.root, { recursive: true });
      const { release, asset, sha256 } = await this.latest();
      const current = this.runtime();
      if (current?.tag === release.tag_name && current.sha256 === sha256) {
        this.set({ clientVersion: release.tag_name.replace(/^v/, ""), installProgress: 1 });
        return current;
      }
      const partial = this.file(`${asset.name}.download`);
      await fsp.rm(partial, { force: true });
      try {
        await this.download(asset, sha256, partial);
        // Since v0.0.21 the package also carries cloudflared and its manifest,
        // which tunnel-client runs from its own folder: every file at the top
        // of the verified archive is installed, nothing outside it.
        const entries = new AdmZip(partial).getEntries().filter((e) => !e.isDirectory);
        if (!entries.some((e) => e.entryName === this.binaryName()))
          throw new Error(`El paquete verificado no contiene ${this.binaryName()}.`);
        const directory = path.join(this.options.root, "runtime", release.tag_name);
        await fsp.rm(directory, { recursive: true, force: true });
        await fsp.mkdir(directory, { recursive: true });
        let total = 0;
        for (const entry of entries) {
          const name = entry.entryName;
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) continue;
          total += entry.header.size;
          if (entry.header.size < 0 || total > 4 * MAX_ARCHIVE_BYTES) throw new Error("El archivo oficial supera el tamaño permitido.");
          const target = path.join(directory, name),
            temporary = `${target}.tmp-${process.pid}`,
            program = /^(tunnel-client|cloudflared)(\.exe)?$/.test(name);
          await fsp.writeFile(temporary, entry.getData(), { mode: program ? 0o700 : 0o600 });
          if (this.platform !== "win32") await fsp.chmod(temporary, program ? 0o700 : 0o600);
          await fsp.rename(temporary, target);
        }
        const executable = path.join(directory, this.binaryName());
        const runtime: Runtime = { tag: release.tag_name, assetName: asset.name, sha256, executable };
        await fsp.writeFile(this.file("runtime.json"), JSON.stringify(runtime, null, 2), { mode: 0o600 });
        this.set({ clientVersion: release.tag_name.replace(/^v/, ""), installProgress: 1 });
        return runtime;
      } finally {
        await fsp.rm(partial, { force: true });
      }
    })().finally(() => {
      this.installing = null;
    });
    return this.installing;
  }

  // ── Running it ─────────────────────────────────────────────────────────────
  /** Every credential goes in the environment, never in argv. */
  private environment(config: Config, apiKey: string): NodeJS.ProcessEnv {
    // The port the server is really on, never the setting alone.
    const live = this.options.server.status();
    if (!live.running || !live.port || !live.token) throw new Error("El servidor MCP local no está activo.");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CONTROL_PLANE_API_KEY: apiKey,
      CONTROL_PLANE_TUNNEL_ID: config.tunnelId,
      MCP_SERVER_URL: `http://127.0.0.1:${live.port}/mcp`,
      IMAGO_MCP_AUTHORIZATION: `Bearer ${live.token}`,
      MCP_EXTRA_HEADERS: "Authorization: env:IMAGO_MCP_AUTHORIZATION",
      MCP_DISCOVERY_EXTRA_HEADERS: "Authorization: env:IMAGO_MCP_AUTHORIZATION",
      // Imago uses a static bearer token: no OAuth discovery (tunnel-client ≥ 0.0.21; older ones ignore it).
      MCP_OAUTH_DISCOVERY: "disabled",
      HEALTH_LISTEN_ADDR: "127.0.0.1:0",
      HEALTH_URL_FILE: this.file("health.url"),
      LOG_FORMAT: "json",
      LOG_LEVEL: "info",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  }
  private doctor(executable: string, env: NodeJS.ProcessEnv) {
    this.set({ phase: "checking", installProgress: null, errorCode: null, errorDetail: null });
    return new Promise<void>((resolve, reject) => {
      const child = spawn(executable, ["doctor", "--json", "--explain"], { cwd: path.dirname(executable), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout = (stdout + c.toString("utf8")).slice(-32_000)));
      child.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString("utf8")).slice(-32_000)));
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("El diagnóstico del túnel agotó el tiempo de espera."));
      }, DOCTOR_TIMEOUT_MS);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        if (code === 0 || (env.MCP_SERVER_URL && isIgnorableLocalMcpOAuthDoctorFailure(stdout, env.MCP_SERVER_URL))) resolve();
        else reject(new Error(sanitizeMcpTunnelDiagnostic([stdout, stderr].filter(Boolean).join("\n") || `doctor exited with ${code ?? signal ?? "unknown"}`, this.secrets())));
      });
    });
  }
  private async ready(child: Child) {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(this.logs || "tunnel-client exited before becoming ready");
      const base = await fsp.readFile(this.file("health.url"), "utf8").then((v) => v.trim()).catch(() => "");
      if (base) {
        try {
          if ((await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(1_500) })).ok) return base;
        } catch {
          /* Starting up; retry. */
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(this.logs || "tunnel-client did not become ready in time");
  }
  private async stopChild() {
    const child = this.child;
    this.child = null;
    this.generation++;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([new Promise<void>((r) => child.once("exit", () => r())), new Promise<void>((r) => setTimeout(r, 2_500))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  private async launch(config: Config, runtime: Runtime, apiKey: string) {
    const env = this.environment(config, apiKey);
    await this.doctor(runtime.executable, env);
    await this.stopChild();
    await fsp.rm(this.file("health.url"), { force: true });
    this.logs = "";
    const generation = ++this.generation;
    const child = spawn(runtime.executable, ["run"], { cwd: path.dirname(runtime.executable), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    const log = (c: Buffer) => (this.logs = (this.logs + c.toString("utf8")).slice(-32_000));
    child.stdout.on("data", log);
    child.stderr.on("data", log);
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (generation === this.generation) this.fail("client_stopped", this.logs || `tunnel-client exited with ${code ?? signal ?? "unknown"}`);
    });
    this.set({ phase: "connecting", uiUrl: null, errorCode: null, errorDetail: null });
    try {
      const base = await this.ready(child);
      return this.set({ phase: "connected", clientVersion: runtime.tag.replace(/^v/, ""), installProgress: null, uiUrl: `${base}/ui`, errorCode: null, errorDetail: null });
    } catch (error) {
      await this.stopChild();
      throw error;
    }
  }
  private async connectConfigured(update: boolean) {
    const config = this.config();
    let apiKey: string | null = null;
    try {
      apiKey = this.options.key.get();
    } catch (error) {
      return this.fail("secure_storage", String((error as Error)?.message ?? error));
    }
    if (!config) return this.fail("invalid_tunnel_id", "Tunnel ID ausente o inválido.");
    if (!apiKey) return this.fail("missing_api_key", "Falta la clave de ejecución.");
    let server = this.options.server.status();
    if (!server.config.enabled) return this.idle();
    if (!server.running) server = await this.options.server.turnOn();
    if (!server.running) return this.fail("local_server", server.error ?? "El servidor MCP local no está activo.");
    let runtime: Runtime;
    try {
      runtime = (update ? null : this.runtime()) ?? (await this.install());
    } catch (error) {
      const detail = String((error as Error)?.message ?? error),
        code = classifyMcpTunnelFailure(detail);
      return this.fail(code === "integrity_failed" || code === "unsupported_platform" ? code : "download_failed", detail);
    }
    try {
      return await this.launch(config, runtime, apiKey);
    } catch (error) {
      const detail = String((error as Error)?.message ?? error);
      return this.fail(classifyMcpTunnelFailure(detail), detail);
    }
  }

  // ── What the window asks ───────────────────────────────────────────────────
  /** Saves the tunnel and key, turns the MCP server on, checks for the latest client and connects. */
  connect(input: McpTunnelConnectInput): Promise<McpTunnelStatus> {
    return this.serial(async () => {
      const tunnelId = typeof input?.tunnelId === "string" ? input.tunnelId.trim() : "";
      if (!isValidMcpTunnelId(tunnelId)) return this.fail("invalid_tunnel_id", "Se esperaba tunnel_ seguido de 32 caracteres hexadecimales.");
      const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      if (apiKey)
        try {
          this.options.key.set(apiKey);
        } catch (error) {
          return this.fail("secure_storage", String((error as Error)?.message ?? error));
        }
      if (!this.hasKey()) return this.fail("missing_api_key", "Falta la clave de ejecución.");
      this.writeConfig({ tunnelId, enabled: true });
      const server = this.options.server.status();
      if (!server.config.enabled || !server.running) await this.options.server.turnOn();
      return this.connectConfigured(true);
    });
  }
  /** After the MCP server starts with Imago. */
  startIfConfigured(): Promise<McpTunnelStatus> {
    return this.serial(async () => {
      const config = this.config();
      if (!config?.enabled || !this.options.server.status().config.enabled) return this.idle();
      return this.connectConfigured(false);
    });
  }
  /** After the port or the token changed: the client must use the new ones. */
  restartIfConfigured(): Promise<McpTunnelStatus> {
    return this.serial(async () => {
      await this.stopChild();
      const config = this.config();
      if (!config?.enabled || !this.options.server.status().config.enabled) return this.idle();
      return this.connectConfigured(false);
    });
  }
  /** Stops the client but keeps the choice to reconnect with Imago (the MCP server was turned off). */
  stop(): Promise<McpTunnelStatus> {
    return this.serial(async () => {
      await this.stopChild();
      return this.idle();
    });
  }
  /** Stops the client and stops reconnecting with Imago. */
  disconnect(): Promise<McpTunnelStatus> {
    return this.serial(async () => {
      await this.stopChild();
      const config = this.config();
      if (config) this.writeConfig({ ...config, enabled: false });
      return this.idle();
    });
  }
  /** Removes the tunnel id and the key from this computer. */
  forget(): Promise<McpTunnelStatus> {
    return this.serial(async () => {
      await this.stopChild();
      this.options.key.clear();
      await fsp.rm(this.file("config.json"), { force: true });
      this.state = { ...this.state, phase: "not_configured", uiUrl: null, installProgress: null, errorCode: null, errorDetail: null };
      this.options.onStatus?.();
      return this.status();
    });
  }
  /** Electron's before-quit cannot wait. */
  killSync() {
    this.generation++;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
}

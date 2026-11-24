// The local MCP server, adapted from Nodus Research: Streamable HTTP on
// 127.0.0.1 only, a bearer token, Host/Origin checks against DNS rebinding,
// one in-memory session per client, idle sessions closed. Off until the user
// turns it on; read only until the user grants write access. Its settings
// live beside the collection, not in it, so backups never carry the token.
import fs from "node:fs";
import path from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  MCP_DEFAULT_CONFIG,
  MCP_PATH,
  mcpEndpoint,
  type McpAccess,
  type McpActivity,
  type McpConfig,
  type McpStatus,
} from "../../shared/mcp";
import { registerImagoTools, type ImagoMcpContext } from "./tools";

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const SESSION_SWEEP_MS = 5 * 60 * 1000;
const ACTIVITY_LIMIT = 50;

const INSTRUCTIONS = [
  "Nodus Imago is a local-first app for visual research databases: databases of records (often photographs) with typed properties, images, annotations and semantic search over both the records' text and the images themselves.",
  "Start with imago_get_overview, then imago_list_databases and imago_get_database to learn the properties before reading or writing records. Databases and properties can be named by id or by exact name.",
  "Read records with imago_query_records (filters, sorts, literal or semantic search, paging) or imago_get_record; search across databases with imago_search; look at photographs with imago_get_image and find similar ones with imago_find_similar_images.",
  "For figures use imago_summarize_property, imago_compute_statistic, imago_count_values and imago_timeline; for anything else imago_run_calculation runs JavaScript over every record in an isolated process.",
  "Semantic search only finds what Imago has indexed. When a result reports a warning that nothing is indexed, an empty result says nothing about the collection: relay the warning instead of reporting absence.",
  "Access is set by the user in Imago. Read only by default; with write access, tools can create and change databases, properties, records, options and annotations, through Imago's own rules. Each call that changes values is one step of Imago's history (imago_undo reverts it). Deleting records, properties or databases cannot be undone: ask the user first.",
  "All data stays on this computer. Do not claim a value, image or relation that an Imago tool did not return.",
].join("\n");

type Session = { server: McpServer; transport: StreamableHTTPServerTransport; lastActivity: number };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type McpHostOptions = {
  /** JSON file with the settings and the token (userData/mcp.json). */
  file: string;
  version: string;
  /** The service and the window, as the tools need them. */
  context: Omit<ImagoMcpContext, "access" | "activity" | "version">;
  /** The status changed (started, stopped, a call, a session): the settings refresh. */
  onStatus?: () => void;
  /** Tests listen on a free port instead of the configured one. */
  listenPort?: number;
};

export class McpHost {
  private config: McpConfig & { token: string };
  private http: Server | null = null;
  private sessions = new Map<string, Session>();
  private sweep: ReturnType<typeof setInterval> | null = null;
  private port: number | null = null;
  private error: string | null = null;
  private activity: McpActivity[] = [];
  private lifecycle: Promise<void> = Promise.resolve();
  idleTtlMs = 30 * 60 * 1000;

  constructor(private options: McpHostOptions) {
    this.config = this.read();
  }

  private read(): McpConfig & { token: string } {
    let stored: Partial<McpConfig & { token: string }> = {};
    try {
      stored = JSON.parse(fs.readFileSync(this.options.file, "utf8"));
    } catch {
      /* First run, or an unreadable file: the defaults (off, read only). */
    }
    const port = Number.isSafeInteger(stored.port) && stored.port! >= 1024 && stored.port! <= 65535 ? stored.port! : MCP_DEFAULT_CONFIG.port;
    return {
      enabled: stored.enabled === true,
      port,
      // Anything but an explicit grant reads as read only.
      access: stored.access === "write" ? "write" : "read",
      token: typeof stored.token === "string" && stored.token.length >= 32 ? stored.token : "",
    };
  }

  private write() {
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
    const temporary = `${this.options.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.options.file);
  }

  private ensureToken() {
    if (this.config.token) return;
    this.config.token = randomBytes(32).toString("base64url");
    this.write();
  }

  access(): McpAccess {
    return this.config.access;
  }

  status(): McpStatus {
    const { token, ...config } = this.config;
    return {
      config,
      running: !!this.http,
      port: this.port,
      url: this.port ? mcpEndpoint(this.port) : null,
      error: this.error,
      token,
      sessions: this.sessions.size,
      activity: [...this.activity],
    };
  }

  /** Changes the settings. Turning access down or up closes every session, so clients list the tools again. */
  configure(patch: Partial<McpConfig>): Promise<McpStatus> {
    return this.serial(async () => {
      if (patch.port !== undefined && (!Number.isSafeInteger(patch.port) || patch.port < 1024 || patch.port > 65535))
        throw new Error("El puerto debe ser un número entre 1024 y 65535.");
      const before = { ...this.config };
      this.config = {
        ...this.config,
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.port !== undefined ? { port: patch.port } : {}),
        ...(patch.access !== undefined ? { access: patch.access } : {}),
      };
      this.write();
      if (!this.config.enabled) await this.stopNow();
      else if (!this.http || before.port !== this.config.port) {
        await this.stopNow();
        await this.startNow();
      } else if (before.access !== this.config.access) await this.closeSessions();
      this.options.onStatus?.();
      return this.status();
    });
  }

  /** A new token: every client must be configured again. */
  regenerateToken(): Promise<McpStatus> {
    return this.serial(async () => {
      this.config.token = randomBytes(32).toString("base64url");
      this.write();
      await this.closeSessions();
      this.options.onStatus?.();
      return this.status();
    });
  }

  /** Starts the server if the user turned it on. */
  start(): Promise<void> {
    return this.serial(() => (this.config.enabled ? this.startNow() : Promise.resolve()));
  }

  stop(): Promise<void> {
    return this.serial(() => this.stopNow());
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.then(work, work);
    this.lifecycle = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  private async startNow() {
    if (this.http) return;
    this.ensureToken();
    const server = createServer((req, res) => void this.handle(req, res));
    try {
      this.port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.options.listenPort ?? this.config.port, "127.0.0.1", () => {
          server.off("error", reject);
          const address = server.address();
          if (!address || typeof address === "string") reject(new Error("Dirección no disponible."));
          else resolve(address.port);
        });
      });
      this.http = server;
      this.error = null;
      this.sweep = setInterval(() => this.sweepIdle(), SESSION_SWEEP_MS);
      this.sweep.unref?.();
    } catch (error) {
      server.close();
      this.port = null;
      this.error =
        (error as NodeJS.ErrnoException).code === "EADDRINUSE"
          ? `El puerto ${this.config.port} ya está en uso. Elige otro o cierra la aplicación que lo usa.`
          : String((error as Error)?.message ?? error);
    }
    this.options.onStatus?.();
  }

  private async stopNow() {
    const server = this.http;
    this.http = null;
    this.port = null;
    if (this.sweep) clearInterval(this.sweep);
    this.sweep = null;
    await this.closeSessions();
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    this.options.onStatus?.();
  }

  private async closeSessions() {
    const open = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(open.map((s) => s.server.close()));
  }

  /** Closes sessions left idle (a client that died without saying goodbye). */
  sweepIdle(now = Date.now()) {
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity <= this.idleTtlMs) continue;
      this.sessions.delete(id);
      void session.server.close().catch(() => {});
    }
  }

  private allowedHosts(port: number) {
    return ["127.0.0.1", "localhost", `127.0.0.1:${port}`, `localhost:${port}`];
  }

  private isLocal(req: IncomingMessage, port: number) {
    if (!req.headers.host || !this.allowedHosts(port).includes(req.headers.host)) return false;
    // Native clients send no Origin; a browser always does, and only this origin is let in.
    const origin = req.headers.origin;
    return !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
  }

  private hasToken(req: IncomingMessage) {
    const header = req.headers.authorization;
    if (!this.config.token || !header?.startsWith("Bearer ")) return false;
    const given = Buffer.from(header.slice(7), "utf8"),
      wanted = Buffer.from(this.config.token, "utf8");
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }

  private reply(res: ServerResponse, status: number, message: string) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
  }

  private async body(req: IncomingMessage) {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += data.length;
      if (size > MAX_REQUEST_BYTES) throw new HttpError(413, "La petición MCP es demasiado grande.");
      chunks.push(data);
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) throw new HttpError(400, "La petición MCP necesita un cuerpo JSON.");
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "El cuerpo de la petición MCP no es JSON válido.");
    }
  }

  private makeServer() {
    const server = new McpServer({ name: "nodus-imago", version: this.options.version }, { instructions: INSTRUCTIONS });
    registerImagoTools(
      server,
      {
        ...this.options.context,
        version: this.options.version,
        access: () => this.config.access,
        activity: (entry) => {
          this.activity.unshift(entry);
          this.activity.length = Math.min(this.activity.length, ACTIVITY_LIMIT);
          this.options.onStatus?.();
        },
      },
      { write: this.config.access === "write" },
    );
    return server;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const port = this.port;
    if (!port) return this.reply(res, 503, "El servidor MCP de Imago se está cerrando.");
    if ((req.url ?? "").split("?")[0] !== MCP_PATH) return this.reply(res, 404, "No encontrado.");
    if (!this.isLocal(req, port)) return this.reply(res, 403, "Origen o Host no autorizado para el servidor MCP local.");
    if (!this.hasToken(req)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="Nodus Imago MCP"');
      return this.reply(res, 401, "El servidor MCP de Imago necesita un token bearer válido.");
    }
    try {
      const body = req.method === "POST" ? await this.body(req) : undefined;
      const header = req.headers["mcp-session-id"],
        sessionId = Array.isArray(header) ? header[0] : header;
      const existing = sessionId ? this.sessions.get(sessionId) : undefined;
      if (existing) {
        existing.lastActivity = Date.now();
        await existing.transport.handleRequest(req, res, body);
        return;
      }
      // After a restart, a change of access or a new token the client still
      // holds an old id: 404 makes it start a new session on its own.
      if (sessionId) return this.reply(res, 404, "La sesión MCP ya no existe. Inicia una nueva.");
      if (req.method !== "POST" || !isInitializeRequest(body))
        return this.reply(res, 400, "Se necesita una inicialización MCP o una sesión válida.");
      let session: Session | null = null;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableDnsRebindingProtection: true,
        allowedHosts: this.allowedHosts(port),
        allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
        onsessioninitialized: (id) => {
          if (session) this.sessions.set(id, session);
          this.options.onStatus?.();
        },
      });
      const server = this.makeServer();
      session = { server, transport, lastActivity: Date.now() };
      transport.onclose = () => {
        if (transport.sessionId) this.sessions.delete(transport.sessionId);
        this.options.onStatus?.();
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof HttpError) return this.reply(res, error.status, error.message);
      console.error("[mcp] request failed", error);
      this.reply(res, 500, "Error interno del servidor MCP de Imago.");
    }
  }
}

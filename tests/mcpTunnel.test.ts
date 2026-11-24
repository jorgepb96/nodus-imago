// ChatGPT through OpenAI's Secure MCP Tunnel: the pure helpers, and the whole
// life of the client — download from a stand-in GitHub, SHA-256 check, doctor,
// run, reconnect, crash, disconnect and forget — with a stand-in tunnel-client
// that really calls Imago's local MCP server with the token it was given.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import {
  classifyMcpTunnelFailure,
  isIgnorableLocalMcpOAuthDoctorFailure,
  isMcpTunnelDiagnosticsUrl,
  isValidMcpTunnelId,
  mcpTunnelAssetName,
  sanitizeMcpTunnelDiagnostic,
} from "../shared/mcpTunnel";
import { McpTunnel, MCP_TUNNEL_RELEASE_API } from "../electron/mcp/tunnel";
import { McpHost } from "../electron/mcp/server";

test("tunnel ids are accepted only in OpenAI's documented form", () => {
  assert.equal(isValidMcpTunnelId("tunnel_0123456789abcdef0123456789abcdef"), true);
  assert.equal(isValidMcpTunnelId(" tunnel_0123456789abcdef0123456789abcdef "), true);
  assert.equal(isValidMcpTunnelId("tunnel_0123456789ABCDEF0123456789ABCDEF"), false);
  assert.equal(isValidMcpTunnelId("tunnel_../../runtime"), false);
  assert.equal(isValidMcpTunnelId("tunnel_short"), false);
});

test("every desktop target selects the exact official asset", () => {
  const tag = "v0.0.10";
  assert.equal(mcpTunnelAssetName(tag, "darwin", "arm64"), "tunnel-client-v0.0.10-darwin-arm64.zip");
  assert.equal(mcpTunnelAssetName(tag, "darwin", "x64"), "tunnel-client-v0.0.10-darwin-amd64.zip");
  assert.equal(mcpTunnelAssetName(tag, "linux", "x64"), "tunnel-client-v0.0.10-linux-amd64.zip");
  assert.equal(mcpTunnelAssetName(tag, "win32", "x64"), "tunnel-client-v0.0.10-windows-amd64.zip");
  assert.equal(mcpTunnelAssetName(tag, "freebsd", "x64"), null);
  assert.equal(mcpTunnelAssetName(tag, "linux", "ia32"), null);
});

test("failures become stable categories; diagnostics hide keys and tokens", () => {
  assert.equal(classifyMcpTunnelFailure("HTTP 401 unauthorized: incorrect API key"), "api_key_rejected");
  assert.equal(classifyMcpTunnelFailure("403 forbidden: Tunnels Read + Use permission required"), "permission_denied");
  assert.equal(classifyMcpTunnelFailure("tunnel not found (404)"), "tunnel_not_found");
  assert.equal(classifyMcpTunnelFailure("MCP probe to 127.0.0.1 refused"), "local_server");
  assert.equal(classifyMcpTunnelFailure("TLS certificate error contacting proxy"), "network");
  assert.equal(classifyMcpTunnelFailure("Fallo de integridad SHA-256 (abc)."), "integrity_failed");
  const clean = sanitizeMcpTunnelDiagnostic("key sk-proj-abcdefghijklmnop and Bearer abcdefghijklmnopqrstu and mysecret\u0007", ["mysecret"]);
  assert.ok(!clean.includes("sk-proj") && !clean.includes("abcdefghijklmnopqrstu") && !clean.includes("mysecret") && !clean.includes("\u0007"));
  assert.equal(isMcpTunnelDiagnosticsUrl("http://127.0.0.1:5555/ui"), true);
  assert.equal(isMcpTunnelDiagnosticsUrl("http://evil.example/ui"), false);
  assert.equal(isMcpTunnelDiagnosticsUrl("file:///etc/passwd"), false);
});

test("only the expected local OAuth-metadata doctor failure is tolerated", () => {
  const url = "http://127.0.0.1:4329/mcp";
  const report = {
    result: "fail",
    failed_checks: ["oauth_metadata"],
    checks: [
      { id: "mcp_target", status: "PASS", summary: url },
      { id: "mcp_server_reachable", status: "PASS", summary: `HTTP 401 from ${url}` },
      { id: "oauth_metadata", status: "FAIL", evidence: ["http://127.0.0.1:4329/.well-known/oauth-protected-resource/mcp", "HTTP 404"] },
    ],
  };
  assert.equal(isIgnorableLocalMcpOAuthDoctorFailure(JSON.stringify(report), url), true);
  report.failed_checks.push("health_listener");
  assert.equal(isIgnorableLocalMcpOAuthDoctorFailure(JSON.stringify(report), url), false);
  report.failed_checks.pop();
  report.checks[2].evidence![1] = "HTTP 500";
  assert.equal(isIgnorableLocalMcpOAuthDoctorFailure(JSON.stringify(report), url), false);
  assert.equal(isIgnorableLocalMcpOAuthDoctorFailure(JSON.stringify(report).replaceAll("127.0.0.1", "mcp.example.com"), "http://mcp.example.com/mcp"), false);
});

// ── The client's whole life ─────────────────────────────────────────────────
const TUNNEL = "tunnel_0123456789abcdef0123456789abcdef";
const KEY = "sk-runtime-0123456789abcdef";
/** Stands in for OpenAI's binary: doctor and run, talking MCP to Imago with the header it was told to use. */
const FAKE_CLIENT = `#!/usr/bin/env node
const fs = require("fs"), http = require("http"), path = require("path");
const env = process.env;
fs.appendFileSync(path.join(path.dirname(env.HEALTH_URL_FILE), "calls.log"), JSON.stringify({ argv: process.argv.slice(2), oauth: env.MCP_OAUTH_DISCOVERY }) + "\\n");
const header = /^Authorization: env:(\\w+)$/.exec(env.MCP_EXTRA_HEADERS || "");
const auth = header ? env[header[1]] : "";
async function mcp() {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: auth };
  const init = await fetch(env.MCP_SERVER_URL, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "fake-tunnel", version: "1" } } }) });
  if (init.status !== 200) throw new Error("MCP " + init.status + " from " + env.MCP_SERVER_URL);
  const session = init.headers.get("mcp-session-id");
  await init.text();
  await fetch(env.MCP_SERVER_URL, { method: "POST", headers: { ...headers, "mcp-session-id": session }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  const list = await fetch(env.MCP_SERVER_URL, { method: "POST", headers: { ...headers, "mcp-session-id": session }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
  const text = await list.text();
  const json = JSON.parse(text.startsWith("{") ? text : text.split("\\n").find((l) => l.startsWith("data:")).slice(5));
  return json.result.tools.map((t) => t.name);
}
if (process.argv[2] === "doctor") {
  if (env.CONTROL_PLANE_API_KEY !== "${KEY}") { console.log("HTTP 401 unauthorized: incorrect API key " + env.CONTROL_PLANE_API_KEY); process.exit(1); }
  mcp().then(() => { console.log(JSON.stringify({ result: "pass" })); process.exit(0); }, (e) => { console.log(String(e.message)); process.exit(1); });
} else if (process.argv[2] === "run") {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/readyz") return res.end("ok");
    if (req.url === "/probe") { try { res.end(JSON.stringify(await mcp())); } catch (e) { res.statusCode = 502; res.end(String(e.message)); } return; }
    res.end("diagnostics");
  });
  server.listen(0, "127.0.0.1", () => fs.writeFileSync(env.HEALTH_URL_FILE, "http://127.0.0.1:" + server.address().port));
  process.on("SIGTERM", () => process.exit(0));
}
`;

let root = "";
let host: McpHost;
let zip: Buffer;
const skip = process.platform === "win32";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-tunnel-"));
  await fs.writeFile(path.join(root, "mcp.json"), JSON.stringify({ enabled: true, port: 4329 }));
  host = new McpHost({ file: path.join(root, "mcp.json"), version: "t", listenPort: 0, context: { call: async () => null, changed: () => {} } });
  await host.start();
  const archive = new AdmZip();
  archive.addFile("tunnel-client", Buffer.from(FAKE_CLIENT));
  archive.addFile("cloudflared", Buffer.from("#!/bin/sh\nexit 0\n"));
  archive.addFile("cloudflared-manifest.json", Buffer.from("{}"));
  archive.addFile("docs/inner.txt", Buffer.from("not at the top: skipped"));
  zip = archive.toBuffer();
});
const made: McpTunnel[] = [];
after(async () => {
  // A failed assertion must not leave a client running.
  for (const tunnel of made) tunnel.killSync();
  await host?.stop();
  await fs.rm(root, { recursive: true, force: true });
});

function github(options: { digest?: string; url?: string; fail?: boolean } = {}) {
  const tag = "v0.0.99",
    name = mcpTunnelAssetName(tag, process.platform, process.arch)!;
  const url = options.url ?? `https://github.com/openai/tunnel-client/releases/download/${tag}/${name}`;
  const calls: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    const target = String(input);
    calls.push(target);
    if (options.fail) throw new Error("getaddrinfo ENOTFOUND api.github.com");
    if (target === MCP_TUNNEL_RELEASE_API)
      return new Response(JSON.stringify({ tag_name: tag, assets: [{ name, browser_download_url: url, size: zip.length, digest: `sha256:${options.digest ?? createHash("sha256").update(zip).digest("hex")}` }] }));
    if (target === url) return new Response(new Uint8Array(zip), { headers: { "content-length": String(zip.length) } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fake, calls };
}
function store() {
  let value: string | null = null;
  return { get: () => value, set: (v: string) => void (value = v), clear: () => void (value = null), peek: () => value };
}
async function make(name: string, extra: Partial<ConstructorParameters<typeof McpTunnel>[0]> = {}) {
  const key = store();
  const tunnel = new McpTunnel({
    root: path.join(root, name),
    version: "t",
    key,
    server: { status: () => host.status(), turnOn: () => host.configure({ enabled: true }) },
    fetch: github().fake,
    ...extra,
  });
  made.push(tunnel);
  return { tunnel, key, dir: path.join(root, name) };
}
const probe = async (uiUrl: string) => {
  const response = await fetch(uiUrl.replace(/\/ui$/, "/probe"));
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()) as string[];
};

test("tunnel: refuses a bad id, a missing key and an unavailable secure store", { skip }, async () => {
  const { tunnel } = await make("refusals");
  assert.equal((await tunnel.connect({ tunnelId: "tunnel_bad", apiKey: KEY })).errorCode, "invalid_tunnel_id");
  assert.equal((await tunnel.connect({ tunnelId: TUNNEL })).errorCode, "missing_api_key");
  const locked = await make("locked", {
    key: { get: () => null, set: () => { throw new Error("El almacén seguro del sistema no está disponible; la clave no se ha guardado."); }, clear: () => {} },
  });
  const status = await locked.tunnel.connect({ tunnelId: TUNNEL, apiKey: KEY });
  assert.equal(status.errorCode, "secure_storage");
  await assert.rejects(fs.access(path.join(locked.dir, "config.json")), "nothing saved without the key");
});

test("tunnel: downloads and verifies the client, connects and forwards to Imago with the token", { skip }, async () => {
  const { fake, calls } = github();
  const { tunnel, key, dir } = await make("life", { fetch: fake });
  const status = await tunnel.connect({ tunnelId: TUNNEL, apiKey: KEY });
  assert.equal(status.phase, "connected", JSON.stringify(status));
  assert.equal(status.configured, true);
  assert.equal(status.clientVersion, "0.0.99");
  assert.ok(isMcpTunnelDiagnosticsUrl(status.uiUrl!));
  assert.equal(key.peek(), KEY);
  assert.ok(calls.includes(MCP_TUNNEL_RELEASE_API));
  const tools = await probe(status.uiUrl!);
  assert.ok(tools.includes("imago_get_overview"), "the client reaches Imago's tools with the bearer token");
  assert.ok(!tools.includes("imago_create_records"), "and with the access the user chose (read only)");

  // Credentials only in the environment, never in argv or in the window's status.
  const log = await fs.readFile(path.join(dir, "calls.log"), "utf8");
  assert.ok(!log.includes(KEY) && !log.includes(host.status().token));
  assert.ok(log.includes('"doctor"') && log.includes('"run"'));
  assert.ok(log.includes('"oauth":"disabled"'), "OAuth discovery is off for the static token");
  const shown = JSON.stringify(tunnel.status());
  assert.ok(!shown.includes(KEY) && !shown.includes(host.status().token));
  const config = await fs.stat(path.join(dir, "config.json"));
  assert.equal(config.mode & 0o777, 0o600);
  assert.ok(!(await fs.readFile(path.join(dir, "config.json"), "utf8")).includes(KEY), "the key is not in the config file");
  const installed = path.join(dir, "runtime", "v0.0.99");
  assert.deepEqual((await fs.readdir(installed)).sort(), ["cloudflared", "cloudflared-manifest.json", "tunnel-client"]);
  assert.equal((await fs.stat(path.join(installed, "cloudflared"))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(installed, "cloudflared-manifest.json"))).mode & 0o777, 0o600);
  await assert.rejects(fs.access(path.join(installed, "docs")), "only files at the top of the archive");

  // A new token: the client restarts and uses it.
  const before = host.status().token;
  await host.regenerateToken();
  assert.notEqual(host.status().token, before);
  const restarted = await tunnel.restartIfConfigured();
  assert.equal(restarted.phase, "connected");
  assert.ok((await probe(restarted.uiUrl!)).includes("imago_get_overview"));

  // Disconnect: the client stops and stays off when Imago starts again.
  const off = await tunnel.disconnect();
  assert.equal(off.phase, "stopped");
  assert.equal(off.enabled, false);
  await assert.rejects(fetch(restarted.uiUrl!.replace(/\/ui$/, "/readyz")));
  assert.equal((await tunnel.startIfConfigured()).phase, "stopped");

  // Reconnect with the stored key; the verified client is reused.
  const again = await tunnel.connect({ tunnelId: TUNNEL });
  assert.equal(again.phase, "connected");

  // The client dies: Imago says so.
  (tunnel as unknown as { child: { kill(signal: string): void } }).child.kill("SIGKILL");
  for (let i = 0; i < 50 && tunnel.status().phase !== "error"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(tunnel.status().errorCode, "client_stopped");

  // Back, then the MCP server is turned off: the tunnel stops with it but keeps its choice.
  assert.equal((await tunnel.restartIfConfigured()).phase, "connected");
  await host.configure({ enabled: false });
  const stopped = await tunnel.stop();
  assert.equal(stopped.phase, "stopped");
  assert.equal(stopped.enabled, true);
  assert.equal((await tunnel.startIfConfigured()).phase, "stopped", "nothing starts while the server is off");
  await host.configure({ enabled: true });
  assert.equal((await tunnel.startIfConfigured()).phase, "connected");

  // Forget: key and tunnel id leave this computer.
  const forgotten = await tunnel.forget();
  assert.equal(forgotten.phase, "not_configured");
  assert.equal(forgotten.hasApiKey, false);
  assert.equal(key.peek(), null);
  await assert.rejects(fs.access(path.join(dir, "config.json")));
});

test("tunnel: a rejected key, a tampered download and an unsupported system are explained", { skip }, async () => {
  const rejected = await make("rejected");
  const status = await rejected.tunnel.connect({ tunnelId: TUNNEL, apiKey: "sk-wrong-0123456789abcdef" });
  assert.equal(status.errorCode, "api_key_rejected");
  assert.ok(!status.errorDetail!.includes("sk-wrong-0123456789abcdef"), "the detail never repeats the key");

  const tampered = await make("tampered", { fetch: github({ digest: "0".repeat(64) }).fake });
  assert.equal((await tampered.tunnel.connect({ tunnelId: TUNNEL, apiKey: KEY })).errorCode, "integrity_failed");
  await assert.rejects(fs.access(path.join(tampered.dir, "runtime.json")), "an unverified client is never installed");

  const foreign = await make("foreign", { fetch: github({ url: "https://evil.example/tunnel-client.zip" }).fake });
  assert.equal((await foreign.tunnel.connect({ tunnelId: TUNNEL, apiKey: KEY })).errorCode, "download_failed");

  const offline = await make("offline", { fetch: github({ fail: true }).fake });
  assert.equal((await offline.tunnel.connect({ tunnelId: TUNNEL, apiKey: KEY })).errorCode, "download_failed");

  const bsd = await make("bsd", { platform: "freebsd" });
  assert.equal((await bsd.tunnel.connect({ tunnelId: TUNNEL, apiKey: KEY })).errorCode, "unsupported_platform");
});

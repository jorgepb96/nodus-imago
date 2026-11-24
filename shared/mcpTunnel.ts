// OpenAI's Secure MCP Tunnel, as Nodus Research uses it: the official
// outbound-only tunnel-client connects ChatGPT to the local MCP server without
// opening a port or publishing it. These helpers are pure, so they stay
// unit-tested without a network or the client itself.

export type McpTunnelPhase = "not_configured" | "stopped" | "installing" | "checking" | "connecting" | "connected" | "error";

export type McpTunnelErrorCode =
  | "invalid_tunnel_id"
  | "missing_api_key"
  | "secure_storage"
  | "unsupported_platform"
  | "download_failed"
  | "integrity_failed"
  | "api_key_rejected"
  | "permission_denied"
  | "tunnel_not_found"
  | "network"
  | "local_server"
  | "client_stopped"
  | "unknown";

/** What the window sees. Neither the runtime key nor the bearer token ever crosses this boundary. */
export interface McpTunnelStatus {
  configured: boolean;
  enabled: boolean;
  hasApiKey: boolean;
  phase: McpTunnelPhase;
  tunnelId: string | null;
  clientVersion: string | null;
  installProgress: number | null;
  /** The client's local diagnostics page, while it runs. */
  uiUrl: string | null;
  errorCode: McpTunnelErrorCode | null;
  /** Redacted, for support: never holds the key or the token. */
  errorDetail: string | null;
}

export interface McpTunnelConnectInput {
  tunnelId: string;
  /** Optional when a key is already stored. */
  apiKey?: string;
}

export const MCP_TUNNEL_ID_PATTERN = /^tunnel_[0-9a-f]{32}$/;

export function isValidMcpTunnelId(value: string): boolean {
  return MCP_TUNNEL_ID_PATTERN.test(value.trim());
}

export function mcpTunnelPlatformSlug(platform: string, arch: string): string | null {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform === "win32" ? "windows" : null;
  const cpu = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : null;
  return os && cpu ? `${os}-${cpu}` : null;
}

export function mcpTunnelAssetName(tag: string, platform: string, arch: string): string | null {
  const slug = mcpTunnelPlatformSlug(platform, arch);
  return slug ? `tunnel-client-${tag}-${slug}.zip` : null;
}

/** Doctor or runtime output as a stable code the window explains in its language. */
export function classifyMcpTunnelFailure(detail: string): McpTunnelErrorCode {
  const normalized = detail.toLowerCase();
  if (/checksum|sha-?256|digest|integrity|integridad/.test(normalized)) return "integrity_failed";
  if (/401|invalid api key|incorrect api key|authentication|unauthori[sz]ed/.test(normalized)) return "api_key_rejected";
  if (/403|permission|forbidden|read\s*\+\s*use|tunnels? use|access required/.test(normalized)) return "permission_denied";
  if (/tunnel[^\n]*(?:not found|does not exist|unknown)|(?:tunnel_|\/v1\/tunnels?)[^\n]*\b404\b|\b404\b[^\n]*(?:tunnel_|\/v1\/tunnels?)/.test(normalized))
    return "tunnel_not_found";
  if (/unsupported (?:platform|architecture)|(?:platform|architecture) (?:is )?not supported|plataforma no soportada|no ofrece tunnel-client/.test(normalized))
    return "unsupported_platform";
  if (/mcp[^\n]*(?:401|403|refused|unreachable|failed)|127\.0\.0\.1|localhost/.test(normalized)) return "local_server";
  if (/enotfound|econnreset|etimedout|timeout|network|dns|certificate|tls|proxy/.test(normalized)) return "network";
  if (/download|descarga|github|release|http status/.test(normalized)) return "download_failed";
  if (/exited|stopped|terminated|signal/.test(normalized)) return "client_stopped";
  return "unknown";
}

interface DoctorCheck {
  id?: unknown;
  status?: unknown;
  summary?: unknown;
  evidence?: unknown;
}
interface DoctorReport {
  result?: unknown;
  failed_checks?: unknown;
  checks?: unknown;
}

/**
 * tunnel-client's doctor fails whenever a local HTTP MCP target publishes no
 * OAuth metadata. Imago uses a static Bearer header instead, so that one
 * failure — and only that one, against the expected local URL — is not a
 * reason to stop. Any other failed check still blocks the start.
 */
export function isIgnorableLocalMcpOAuthDoctorFailure(output: string, expectedMcpServerUrl: string): boolean {
  let expected: URL;
  try {
    expected = new URL(expectedMcpServerUrl);
  } catch {
    return false;
  }
  if (expected.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(expected.hostname)) return false;
  let report: DoctorReport;
  try {
    report = JSON.parse(output.trim()) as DoctorReport;
  } catch {
    return false;
  }
  if (
    report.result !== "fail" ||
    !Array.isArray(report.failed_checks) ||
    report.failed_checks.length !== 1 ||
    report.failed_checks[0] !== "oauth_metadata" ||
    !Array.isArray(report.checks)
  )
    return false;
  const checks = report.checks.filter((value): value is DoctorCheck => Boolean(value) && typeof value === "object");
  const byId = (id: string) => checks.find((check) => check.id === id);
  const target = byId("mcp_target"),
    reachable = byId("mcp_server_reachable"),
    oauth = byId("oauth_metadata");
  if (
    target?.status !== "PASS" ||
    target.summary !== expectedMcpServerUrl ||
    reachable?.status !== "PASS" ||
    oauth?.status !== "FAIL" ||
    !Array.isArray(oauth.evidence)
  )
    return false;
  let metadataUrl = false,
    notFound = false;
  for (const item of oauth.evidence) {
    if (typeof item !== "string") continue;
    if (/^HTTP 404$/i.test(item.trim())) notFound = true;
    try {
      const url = new URL(item);
      if (url.origin === expected.origin && url.pathname.startsWith("/.well-known/oauth-protected-resource")) metadataUrl = true;
    } catch {
      /* Non-URL evidence such as "HTTP 404" is read above. */
    }
  }
  return metadataUrl && notFound;
}

/** Keys, tokens and control characters out of a diagnostic, and only its tail. */
export function sanitizeMcpTunnelDiagnostic(value: string, secrets: string[] = []): string {
  let clean = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) ? " " : character;
  }).join("");
  for (const secret of secrets) if (secret) clean = clean.split(secret).join("<redacted>");
  clean = clean
    .replace(/(?:sk|sess|key)-[A-Za-z0-9_-]{12,}/g, "<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi, "Bearer <redacted>")
    .trim();
  return clean.slice(-1_500);
}

/** The client's diagnostics page: only its own loopback address. */
export function isMcpTunnelDiagnosticsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && /^\d+$/.test(url.port) && url.pathname === "/ui";
  } catch {
    return false;
  }
}

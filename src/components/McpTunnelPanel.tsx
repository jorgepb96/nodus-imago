// ChatGPT through OpenAI's Secure MCP Tunnel, with the guided steps Nodus
// shows: create a tunnel and a runtime key at OpenAI, connect, then add Imago
// as a plugin in ChatGPT. The key is sent once and never shown again.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, ExternalLink, Eye, EyeOff, Link2, Lock, Settings2, ShieldCheck, Square } from "lucide-react";
import { isValidMcpTunnelId, type McpTunnelErrorCode, type McpTunnelStatus } from "../../shared/mcpTunnel";
import type { Perform } from "./Properties";
import { Button, Spinner } from "./ui";
import { useT } from "../i18n";

const OPENAI_TUNNELS_URL = "https://platform.openai.com/settings/organization/tunnels";
const OPENAI_RUNTIME_KEYS_URL = "https://platform.openai.com/settings/organization/api-keys";
const CHATGPT_PLUGINS_URL = "https://chatgpt.com/plugins";

const ERRORS: Record<McpTunnelErrorCode, string> = {
  invalid_tunnel_id: "El ID debe empezar por tunnel_ y contener los 32 caracteres que muestra OpenAI.",
  missing_api_key: "Falta la clave de ejecución de OpenAI.",
  secure_storage: "El almacén seguro del sistema no está disponible: Imago no guarda la clave sin cifrar.",
  unsupported_platform: "OpenAI todavía no ofrece el cliente de túnel para este sistema.",
  download_failed: "No se pudo descargar el cliente oficial. Comprueba la conexión a Internet e inténtalo de nuevo.",
  integrity_failed: "La descarga no superó la comprobación de seguridad y no se ha ejecutado.",
  api_key_rejected: "OpenAI rechazó la clave. Crea una clave de ejecución nueva y vuelve a pegarla.",
  permission_denied: "Tu cuenta necesita permisos Tunnels Read + Use en la organización de OpenAI.",
  tunnel_not_found: "OpenAI no encuentra ese túnel en la organización asociada a la clave.",
  network: "No se puede alcanzar OpenAI. Revisa la conexión, el proxy o el cortafuegos.",
  local_server: "Imago no pudo conectar el túnel con su servidor MCP local.",
  client_stopped: "El cliente del túnel se detuvo. Pulsa Volver a conectar.",
  unknown: "No se pudo completar la conexión. Abre el detalle técnico o inténtalo de nuevo.",
};

const WORKING = ["installing", "checking", "connecting"];

export function McpTunnelPanel({ perform }: { perform: Perform }) {
  const t = useT(),
    [tunnel, setTunnel] = useState<McpTunnelStatus | null>(null),
    [tunnelId, setTunnelId] = useState(""),
    [apiKey, setApiKey] = useState(""),
    [showKey, setShowKey] = useState(false),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const next = await window.imago.call("mcpTunnelStatus");
    setTunnel(next);
    setTunnelId((current) => current || next.tunnelId || "");
  }, []);
  useEffect(() => {
    void load();
    return window.imago.onChange((scope) => {
      if (scope === "mcp") void load();
    });
  }, [load]);
  if (!tunnel) return null;
  const act = (work: () => Promise<McpTunnelStatus>) =>
    void perform(async () => {
      setBusy(true);
      try {
        setTunnel(await work());
      } finally {
        setBusy(false);
      }
    });
  const open = (url: string) => void perform(() => window.imago.call("openExternalLink", { url }));
  const working = busy || WORKING.includes(tunnel.phase),
    connected = tunnel.phase === "connected",
    failed = tunnel.phase === "error",
    validId = isValidMcpTunnelId(tunnelId);
  const phase =
    tunnel.phase === "installing"
      ? t("Descargando el cliente oficial…")
      : tunnel.phase === "checking"
        ? t("Comprobando permisos y conexión…")
        : tunnel.phase === "connecting"
          ? t("Abriendo el túnel seguro…")
          : connected
            ? t("Conectado")
            : failed
              ? t("Necesita atención")
              : t("Sin conectar");
  return (
    <div className="mcp-tunnel" data-testid="mcp-tunnel">
      <div className={`mcp-tunnel-status ${connected ? "connected" : failed ? "failed" : ""}`} data-testid="mcp-tunnel-status">
        <span className="mcp-tunnel-icon">{connected ? <Check size={17} /> : <Lock size={17} />}</span>
        <div>
          <div className="mcp-tunnel-title">
            <strong>{connected ? t("Conectado a ChatGPT") : t("Túnel seguro de OpenAI")}</strong>
            <span data-testid="mcp-tunnel-phase">{phase}</span>
          </div>
          <p>{t("Conecta ChatGPT sin publicar tu servidor ni abrir puertos. Imago usa el túnel seguro oficial de OpenAI.")}</p>
          {tunnel.clientVersion && <small>tunnel-client {tunnel.clientVersion}</small>}
          {tunnel.phase === "installing" && tunnel.installProgress != null && (
            <div className="mcp-tunnel-progress">
              <span style={{ width: `${Math.round(tunnel.installProgress * 100)}%` }} />
            </div>
          )}
        </div>
      </div>

      {connected ? (
        <>
          <Step number={1} title={t("Activa el modo desarrollador si es necesario")}>
            {t("En ChatGPT, ve a Configuración → Seguridad e inicio de sesión y activa Modo desarrollador. Si ya está activo, continúa con el siguiente paso.")}
          </Step>
          <Step number={2} title={t("Abre el configurador de complementos")}>
            {t("En la configuración de ChatGPT, abre Complementos, pulsa Añadir complemento e introduce un nombre, por ejemplo «Nodus Imago».")}
            <Button primary onClick={() => open(CHATGPT_PLUGINS_URL)}>
              <ExternalLink size={15} />
              {t("Abrir configuración de ChatGPT")}
            </Button>
          </Step>
          <Step number={3} title={t("Selecciona el túnel de Imago")}>
            {t("Cuando ChatGPT solicite la conexión, elige Túnel y selecciona el túnel que acabas de configurar; no introduzcas la URL local.")}
          </Step>
          <Step number={4} title={t("Configura la autenticación")}>
            {t("En Autenticación, selecciona Sin autenticación. No pegues ahí la clave de ejecución de OpenAI ni el token MCP local.")}
          </Step>
          <Step number={5} title={t("Confirma y termina")}>
            {t("Marca Entiendo y quiero continuar y guarda el complemento. Imago estará disponible en los chats donde actives el complemento, con los permisos elegidos arriba.")}
          </Step>
          <div className="row">
            {tunnel.uiUrl && (
              <Button onClick={() => void perform(() => window.imago.call("mcpTunnelDiagnostics"))}>
                <Settings2 size={15} />
                {t("Abrir diagnóstico")}
              </Button>
            )}
            <Button data-testid="mcp-tunnel-disconnect" disabled={busy} onClick={() => act(() => window.imago.call("mcpTunnelDisconnect"))}>
              <Square size={14} />
              {t("Desconectar")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Step number={1} title={t("Crea un túnel en OpenAI")}>
            {t("Abre la página de túneles, pulsa Create y copia el identificador que empieza por tunnel_.")}
            <Button onClick={() => open(OPENAI_TUNNELS_URL)}>
              <ExternalLink size={15} />
              {t("Abrir túneles de OpenAI")}
            </Button>
            <label className="mcp-tunnel-field">
              {t("ID del túnel")}
              <input
                data-testid="mcp-tunnel-id"
                className={tunnelId && !validId ? "invalid" : ""}
                spellCheck={false}
                placeholder="tunnel_0123456789abcdef0123456789abcdef"
                value={tunnelId}
                onChange={(e) => setTunnelId(e.target.value.trim())}
              />
            </label>
            {tunnelId && !validId && <p className="error">{t(ERRORS.invalid_tunnel_id)}</p>}
          </Step>
          <Step number={2} title={t("Crea una clave de ejecución")}>
            {t("La clave necesita permisos Tunnels Read + Use. Imago la guarda cifrada en el almacén seguro de este dispositivo y nunca vuelve a mostrarla.")}
            <Button onClick={() => open(OPENAI_RUNTIME_KEYS_URL)}>
              <ExternalLink size={15} />
              {t("Crear clave de ejecución")}
            </Button>
            <label className="mcp-tunnel-field">
              {t("Clave de ejecución")}
              <span className="row">
                <input
                  data-testid="mcp-tunnel-key"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={tunnel.hasApiKey ? t("Ya hay una clave guardada; déjalo vacío para conservarla.") : t("Pega aquí la clave nueva")}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <Button icon aria-label={showKey ? t("Ocultar") : t("Mostrar")} onClick={() => setShowKey((v) => !v)}>
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </Button>
              </span>
            </label>
          </Step>
          <Step number={3} title={t("Conecta Imago")}>
            {t("Imago activará el servidor MCP, descargará y verificará el cliente oficial y mantendrá la conexión mientras la aplicación esté abierta.")}
            <Button
              primary
              data-testid="mcp-tunnel-connect"
              disabled={working || !validId || (!apiKey.trim() && !tunnel.hasApiKey)}
              onClick={() =>
                act(async () => {
                  const next = await window.imago.call("mcpTunnelConnect", { tunnelId, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
                  if (next.hasApiKey) setApiKey("");
                  return next;
                })
              }
            >
              {working ? <Spinner /> : <Link2 size={15} />}
              {working ? phase : tunnel.configured ? t("Volver a conectar") : t("Conectar con ChatGPT")}
            </Button>
          </Step>
        </>
      )}

      {failed && tunnel.errorCode && (
        <div className="mcp-tunnel-error" data-testid="mcp-tunnel-error">
          <p>{t(ERRORS[tunnel.errorCode])}</p>
          {tunnel.errorDetail && (
            <details>
              <summary>{t("Ver detalle técnico")}</summary>
              <pre>{tunnel.errorDetail}</pre>
            </details>
          )}
        </div>
      )}

      <p className="mcp-tunnel-privacy" data-testid="mcp-tunnel-privacy">
        <ShieldCheck size={14} />
        {t("Cuando uses Imago desde ChatGPT, OpenAI recibirá las consultas y los resultados que ChatGPT solicite, incluidas las imágenes que pida. Tu colección permanece en este equipo y el servidor local no se publica en Internet.")}
      </p>

      {tunnel.configured && !connected && (
        <Button
          className="mcp-tunnel-forget"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t("Imago eliminará de este equipo el ID del túnel y la clave de ejecución guardada. Podrás configurarlos otra vez cuando quieras.")))
              act(async () => {
                const next = await window.imago.call("mcpTunnelForget");
                setTunnelId("");
                setApiKey("");
                return next;
              });
          }}
        >
          {t("Borrar conexión guardada")}
        </Button>
      )}
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="mcp-tunnel-step" data-testid="mcp-tunnel-step">
      <span>{number}</span>
      <div>
        <h4>{title}</h4>
        <div className="mcp-tunnel-step-body">{children}</div>
      </div>
    </section>
  );
}

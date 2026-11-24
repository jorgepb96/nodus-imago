// The local MCP server, as Nodus offers it: off until turned on, read only
// until the user grants write access in a confirmation window, the address
// and token to copy into a client, and the last calls a client made.
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, Lock, Pencil, Plug, RefreshCw, ShieldAlert } from "lucide-react";
import { MCP_DEFAULT_PORT, mcpEndpoint, type McpAccess, type McpConfig, type McpStatus } from "../../shared/mcp";
import type { Perform } from "./Properties";
import { Button, Modal } from "./ui";
import { useT } from "../i18n";
import { McpTunnelPanel } from "./McpTunnelPanel";

type ClientTab = "chatgpt" | "claude" | "code" | "generic";

export function McpSettings({ perform }: { perform: Perform }) {
  const t = useT(),
    [status, setStatus] = useState<McpStatus | null>(null),
    [port, setPort] = useState(String(MCP_DEFAULT_PORT)),
    [showToken, setShowToken] = useState(false),
    [copied, setCopied] = useState<string | null>(null),
    [tab, setTab] = useState<ClientTab>("claude"),
    [confirmWrite, setConfirmWrite] = useState(false),
    [understood, setUnderstood] = useState(false);
  const load = useCallback(async () => {
    const next = await window.imago.call("mcpStatus");
    setStatus(next);
    setPort(String(next.config.port));
  }, []);
  useEffect(() => {
    void load();
    return window.imago.onChange((scope) => {
      if (scope === "mcp") void load();
    });
  }, [load]);
  const configure = (patch: Partial<McpConfig>) => {
    // Shown at once; the answer (or a refusal, through load) settles it.
    setStatus((current) => (current ? { ...current, config: { ...current.config, ...patch } } : current));
    void perform(async () => {
      try {
        setStatus(await window.imago.call("mcpConfigure", patch));
      } catch (error) {
        await load();
        throw error;
      }
    });
  };
  const chooseAccess = (access: McpAccess) => {
    if (access === "write" && status?.config.access !== "write") {
      setUnderstood(false);
      setConfirmWrite(true);
    } else if (access === "read") configure({ access: "read" });
  };
  const copy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
  };
  if (!status) return null;
  const { config } = status;
  const url = status.url ?? mcpEndpoint(config.port);
  const token = status.token || "<token>";
  const claudeDesktop = JSON.stringify(
    { mcpServers: { "nodus-imago": { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization: Bearer ${token}`] } } },
    null,
    2,
  );
  const claudeCode = `claude mcp add --transport http nodus-imago ${url} --header "Authorization: Bearer ${token}"`;
  const commitPort = () => {
    const value = Number(port);
    if (Number.isInteger(value) && value >= 1024 && value <= 65535) {
      if (value !== config.port) configure({ port: value });
    } else setPort(String(config.port));
  };
  return (
    <section className="settings-section mcp-settings" data-testid="mcp-settings">
      <div className="settings-card-heading">
        <span>
          <Plug size={21} />
        </span>
        <div>
          <h2>{t("Servidor MCP")}</h2>
          <p>
            {t(
              "Conecta asistentes de IA (Claude, ChatGPT, Cursor…) con tus bases de datos mediante el protocolo MCP. Solo escucha en este ordenador y pide un token.",
            )}
          </p>
        </div>
      </div>

      <label className="setting-row">
        <span>
          <strong>{t("Activar servidor MCP")}</strong>
          <p className="hint">{t("Mientras esté apagado, ningún programa puede conectarse.")}</p>
        </span>
        <input
          type="checkbox"
          data-testid="mcp-enabled"
          checked={config.enabled}
          onChange={(e) => configure({ enabled: e.target.checked })}
        />
      </label>
      <div className="setting-row">
        <strong>{t("Estado")}</strong>
        <span data-testid="mcp-state">
          {status.running ? (
            <span className="badge completed">
              {t("Activo")} · {status.sessions} {status.sessions === 1 ? t("cliente") : t("clientes")}
            </span>
          ) : status.error ? (
            <span className="badge failed">{status.error}</span>
          ) : (
            <span className="badge">{t("Apagado")}</span>
          )}
        </span>
      </div>

      <div className="mcp-access" role="radiogroup" aria-label={t("Permisos del cliente MCP")}>
        <button
          type="button"
          role="radio"
          data-testid="mcp-access-read"
          aria-checked={config.access === "read"}
          className={config.access === "read" ? "active" : ""}
          onClick={() => chooseAccess("read")}
        >
          <Lock size={17} />
          <span>
            <strong>{t("Solo lectura")}</strong>
            <small>{t("Recomendado. Consulta bases, propiedades, celdas, estadísticas, búsquedas e imágenes, sin cambiar nada.")}</small>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          data-testid="mcp-access-write"
          aria-checked={config.access === "write"}
          className={config.access === "write" ? "active write" : ""}
          onClick={() => chooseAccess("write")}
        >
          <Pencil size={17} />
          <span>
            <strong>{t("Lectura y escritura")}</strong>
            <small>{t("Además crea y modifica bases de datos, propiedades, registros, opciones y anotaciones.")}</small>
          </span>
        </button>
      </div>

      <label className="setting-row">
        <span>
          <strong>{t("Puerto local")}</strong>
          <p className="hint">{t("Solo en 127.0.0.1. Cámbialo si otra aplicación ya lo usa.")}</p>
        </span>
        <input
          type="number"
          data-testid="mcp-port"
          min={1024}
          max={65535}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          onBlur={commitPort}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </label>

      <h3 className="mcp-subheading">{t("Datos de conexión")}</h3>
      <div className="mcp-value">
        <span>{t("URL del servidor")}</span>
        <code data-testid="mcp-url">{url}</code>
        <Button icon aria-label={t("Copiar")} onClick={() => void copy("url", url)}>
          {copied === "url" ? <Check size={15} /> : <Copy size={15} />}
        </Button>
      </div>
      <div className="mcp-value">
        <span>{t("Token")}</span>
        <code data-testid="mcp-token">{status.token ? (showToken ? status.token : "•".repeat(24)) : t("Se crea al activar el servidor.")}</code>
        <Button icon aria-label={showToken ? t("Ocultar") : t("Mostrar")} disabled={!status.token} onClick={() => setShowToken((v) => !v)}>
          {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
        </Button>
        <Button icon aria-label={t("Copiar")} disabled={!status.token} onClick={() => void copy("token", status.token)}>
          {copied === "token" ? <Check size={15} /> : <Copy size={15} />}
        </Button>
      </div>
      <div className="row">
        <Button
          data-testid="mcp-regenerate"
          disabled={!status.token}
          onClick={() => {
            if (window.confirm(t("¿Crear un token nuevo? Los clientes conectados dejarán de funcionar hasta que copies el nuevo.")))
              void perform(async () => setStatus(await window.imago.call("mcpRegenerateToken")));
          }}
        >
          <RefreshCw size={15} />
          {t("Regenerar token")}
        </Button>
      </div>

      <div className="segmented mcp-clients" role="tablist">
        {(
          [
            ["chatgpt", "ChatGPT"],
            ["claude", "Claude Desktop"],
            ["code", "Claude Code"],
            ["generic", t("Otro cliente")],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "chatgpt" && <McpTunnelPanel perform={perform} />}
      {tab === "claude" && (
        <div className="mcp-client">
          <p className="hint">{t("Añade esto a claude_desktop_config.json (Ajustes → Desarrollador → Editar configuración) y reinicia Claude. Necesita Node.js.")}</p>
          <pre className="mono" data-testid="mcp-claude-config">{claudeDesktop}</pre>
          <Button onClick={() => void copy("claude", claudeDesktop)}>
            {copied === "claude" ? <Check size={15} /> : <Copy size={15} />}
            {t("Copiar configuración")}
          </Button>
        </div>
      )}
      {tab === "code" && (
        <div className="mcp-client">
          <p className="hint">{t("Ejecuta esta orden en un terminal:")}</p>
          <pre className="mono">{claudeCode}</pre>
          <Button onClick={() => void copy("code", claudeCode)}>
            {copied === "code" ? <Check size={15} /> : <Copy size={15} />}
            {t("Copiar orden")}
          </Button>
        </div>
      )}
      {tab === "generic" && (
        <div className="mcp-client">
          <p className="hint">
            {t("Usa el transporte Streamable HTTP con la URL de arriba y la cabecera «Authorization: Bearer <token>». El servidor no se publica en Internet: para ChatGPT usa la pestaña ChatGPT, que conecta mediante el túnel seguro de OpenAI.")}
          </p>
        </div>
      )}

      <h3 className="mcp-subheading">{t("Actividad reciente")}</h3>
      {status.activity.length ? (
        <ul className="mcp-activity" data-testid="mcp-activity">
          {status.activity.slice(0, 15).map((entry, i) => (
            <li key={`${entry.at}-${i}`}>
              <time>{new Date(entry.at).toLocaleTimeString()}</time>
              <code>{entry.tool}</code>
              {entry.write && <span className="badge running">{t("escritura")}</span>}
              <span className={`badge ${entry.ok ? "completed" : "failed"}`} title={entry.error}>
                {entry.ok ? t("correcto") : t("error")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t("Ningún cliente ha usado todavía el servidor en esta sesión.")}</p>
      )}

      {confirmWrite && (
        <Modal title={t("Permitir escritura al cliente MCP")} icon={ShieldAlert} onClose={() => setConfirmWrite(false)}>
          <div className="modal-body stack" data-testid="mcp-write-confirm">
            <p>{t("Cualquier programa que tenga el token podrá cambiar tus datos de Imago sin preguntarte en cada paso. Podrá:")}</p>
            <ul className="mcp-write-list">
              <li>{t("crear, renombrar y eliminar bases de datos;")}</li>
              <li>{t("añadir, configurar, convertir y eliminar propiedades de cualquier tipo;")}</li>
              <li>{t("crear, editar y eliminar registros y sus valores;")}</li>
              <li>{t("importar imágenes de este ordenador, anotarlas y lanzar los análisis de IA configurados (pueden usar una API de pago).")}</li>
            </ul>
            <p className="hint">
              {t("Los cambios de valores quedan en el historial y se pueden deshacer. Eliminar registros, propiedades o bases de datos no se puede deshacer: haz una copia de seguridad antes. Puedes volver a solo lectura en cualquier momento.")}
            </p>
            <label className="check-label">
              <input type="checkbox" data-testid="mcp-write-understood" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              {t("Entiendo los riesgos y quiero permitir la escritura")}
            </label>
          </div>
          <footer>
            <Button onClick={() => setConfirmWrite(false)}>{t("Cancelar")}</Button>
            <Button
              primary
              data-testid="mcp-write-allow"
              disabled={!understood}
              onClick={() => {
                setConfirmWrite(false);
                configure({ access: "write" });
              }}
            >
              {t("Permitir escritura")}
            </Button>
          </footer>
        </Modal>
      )}
    </section>
  );
}

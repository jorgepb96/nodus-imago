// The database chat, adapted from Nodus Research's Research chat: the same
// header (history, model, Fast/Extended, context), history with folders,
// message cards and composer. It reads only the databases chosen for the
// conversation; exact figures come from calculations run in an isolated
// process. Used as a section of its own and as a panel beside a database.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Database,
  Layers,
  Maximize2,
  MessageSquare,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import type { Settings } from "../../../shared/imago";
import type { DatabaseSummary } from "../../../shared/databases";
import { PROVIDERS, type ModelChoice } from "../../../shared/aiConfig";
import {
  parseChatSegments,
  readableAnswer,
  type ChartSpec,
  type ChatConversationSummary,
  type ChatFolder,
  type ChatMessage,
  type ChatMode,
} from "../../../shared/chat";
import { useT, formatNumber } from "../../i18n";
import { Modal, Button } from "../ui";
import { CriteriaPopover, CriteriaSelect } from "../CriteriaSelect";
import { BarList, ColumnChart, LineChart } from "../charts";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatSidebar } from "./ChatSidebar";
import { endRun, startRun, useChatRuns } from "./chatRuns";
import "./chat.css";

const STARTERS = [
  "Resume esta base de datos en tres puntos.",
  "¿Cuántos registros hay por década? Muéstralo en un gráfico.",
  "¿Qué lugares y temas aparecen con más frecuencia?",
  "¿Qué propiedades tienen más valores vacíos?",
];
const encode = (choice: ModelChoice) => `${choice.provider}|${choice.model}`;
const decode = (value: string): ModelChoice => {
  const [provider, ...rest] = value.split("|");
  return { provider: provider as ModelChoice["provider"], model: rest.join("|") };
};
const stored = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
};
const store = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Preferences are a convenience. */
  }
};

/** The chat models: those listed in each provider's settings. */
export function chatModelChoices(settings: Settings): ModelChoice[] {
  return Object.entries(settings.apiProfiles).flatMap(([provider, profile]) =>
    (profile?.models ?? []).map((model) => ({ provider: provider as ModelChoice["provider"], model })),
  );
}

export function ChatView({
  settings,
  databases,
  initialDatabaseIds,
  compact = false,
  onClose,
  onExpand,
  onOpenSettings,
}: {
  settings: Settings;
  databases: DatabaseSummary[];
  initialDatabaseIds?: string[];
  /** The panel beside a database: narrower, history closed by default. */
  compact?: boolean;
  onClose?: () => void;
  onExpand?: () => void;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const api = window.imago;
  const runs = useChatRuns();
  const prefix = compact ? "imago.chat.panel." : "imago.chat.";
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(() => stored(prefix + "history", !compact));
  const [contextOpen, setContextOpen] = useState(() => stored(prefix + "context", false));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newFolderId, setNewFolderId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const valid = useCallback((ids: string[]) => ids.filter((id) => databases.some((d) => d.id === id)), [databases]);
  const [selection, setSelection] = useState<string[]>(() =>
    initialDatabaseIds?.length ? initialDatabaseIds : databases[0] ? [databases[0].id] : [],
  );
  const choices = useMemo(() => chatModelChoices(settings), [settings]);
  const [model, setModel] = useState<ModelChoice | null>(() => stored<ModelChoice | null>("imago.chat.model", null));
  const [mode, setMode] = useState<ChatMode>(() => stored<ChatMode>("imago.chat.mode", "fast"));
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ChatConversationSummary[] | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<ChatFolder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contextTrigger = useRef<HTMLButtonElement>(null);
  const activeRef = useRef<string | null>(null);
  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  const chosenModel = model && choices.some((c) => encode(c) === encode(model)) ? model : (choices[0] ?? null);
  const databaseIds = valid(selection);
  const run = activeId ? runs.get(activeId) : undefined;
  const sending = !!run;
  const runningIds = useMemo(() => new Set(runs.keys()), [runs]);

  const refreshList = useCallback(async () => {
    const list = await api.call("chatList", { includeArchived: showArchived });
    setConversations(list.conversations);
    setFolders(list.folders);
    setArchivedCount(list.archivedCount);
  }, [api, showArchived]);
  useEffect(() => {
    void refreshList().catch(() => {});
  }, [refreshList]);
  // A panel beside a database follows that database while no chat is open.
  const initialKey = (initialDatabaseIds ?? []).join(",");
  const [followed, setFollowed] = useState(initialKey);
  if (initialKey !== followed) {
    setFollowed(initialKey);
    if (!activeId && initialDatabaseIds?.length) setSelection(initialDatabaseIds);
  }

  const open = useCallback(
    async (id: string) => {
      setError(null);
      const chat = await api.call("chatGet", { id });
      setActiveId(chat.id);
      setMessages(chat.messages);
      if (chat.databaseIds.length) setSelection(chat.databaseIds);
      if (chat.model) setModel(chat.model);
      setMode(chat.mode);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    },
    [api],
  );
  const startNew = (folderId: string | null = null) => {
    setActiveId(null);
    setMessages([]);
    setNewFolderId(folderId);
    setError(null);
    if (compact && initialDatabaseIds?.length) setSelection(initialDatabaseIds);
    inputRef.current?.focus();
  };

  // Keep the newest text in view while it streams, unless the reader scrolled up.
  useEffect(() => {
    if (atBottom) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, run?.content, atBottom]);

  const send = async (text?: string, regenerate = false) => {
    const question = (text ?? input).trim();
    if (!chosenModel || !databaseIds.length || sending) return;
    if (!regenerate && !question) return;
    setError(null);
    let id = activeId;
    try {
      if (!id) {
        const created = await api.call("chatCreate", {
          databaseIds,
          folderId: newFolderId,
          model: chosenModel,
          mode,
        });
        id = created.id;
        setActiveId(id);
        setNewFolderId(null);
      }
      const now = new Date().toISOString();
      if (regenerate)
        setMessages((current) => {
          const next = [...current];
          while (next.length && next[next.length - 1].role === "assistant") next.pop();
          return next;
        });
      else {
        setMessages((current) => [...current, { id: `local-${now}`, role: "user", content: question, createdAt: now }]);
        setInput("");
      }
      setAtBottom(true);
      startRun(id, question, regenerate);
      void refreshList();
      try {
        await api.chatSend({
          conversationId: id,
          question: regenerate ? "" : question,
          databaseIds,
          model: chosenModel,
          mode,
          regenerate,
        });
      } finally {
        endRun(id);
      }
      if (activeRef.current === id) {
        const chat = await api.call("chatGet", { id });
        if (activeRef.current === id) setMessages(chat.messages);
      }
      await refreshList();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const copy = async (message: ChatMessage) => {
    await navigator.clipboard.writeText(message.role === "assistant" ? readableAnswer(message.content) : message.content);
    setCopied(message.id);
    setTimeout(() => setCopied((current) => (current === message.id ? null : current)), 1500);
  };

  const shown: ChatMessage[] = run
    ? [...messages, { id: "streaming", role: "assistant", content: run.content, createdAt: "" }]
    : messages;
  const lastId = shown[shown.length - 1]?.id;
  const contextLabel = databaseIds.length === 1 ? databases.find((d) => d.id === databaseIds[0])?.name ?? "" : t("{n} bases de datos").replace("{n}", String(databaseIds.length));

  const picker = (
    <div className="chat-context-picker">
      <p className="chat-context-intro">{t("El chat solo lee las bases de datos que marques aquí.")}</p>
      <div className="chat-context-list" role="group" aria-label={t("Bases de datos del chat")}>
        {databases.map((database) => {
          const checked = selection.includes(database.id);
          return (
            <label key={database.id} className={`chat-context-option ${checked ? "is-on" : ""}`}>
              <input
                type="checkbox"
                checked={checked}
                disabled={sending}
                onChange={(event) =>
                  setSelection((current) =>
                    event.target.checked ? [...current, database.id] : current.filter((id) => id !== database.id),
                  )
                }
              />
              <Database size={14} />
              <span>
                <strong>{database.name}</strong>
                <small>
                  {formatNumber(database.rowCount, 0)} {t("registros")}
                </small>
              </span>
            </label>
          );
        })}
      </div>
      {!databaseIds.length && <p className="chat-context-empty">{t("Elige al menos una base de datos.")}</p>}
      <p className="chat-context-note">
        <ShieldCheck size={14} />
        {t("Las cifras exactas se calculan con código que se ejecuta en un entorno aislado de este ordenador, sin acceso a tus archivos ni a internet. Al modelo solo se le envían el resumen de las bases de datos, algunos registros de ejemplo y los resultados de los cálculos.")}
      </p>
    </div>
  );

  return (
    <div className={`research-chat-surface chat-view ${compact ? "is-compact" : ""}`} data-testid={compact ? "chat-panel" : "chat-view"}>
      <header className="research-assistant-header">
        <button
          type="button"
          className="chat-header-button"
          data-testid="chat-history-toggle"
          aria-label={t("Historial de chats")}
          data-tooltip={t("Historial de chats")}
          aria-expanded={historyOpen}
          onClick={() => {
            setHistoryOpen(!historyOpen);
            store(prefix + "history", !historyOpen);
          }}
        >
          <Clock size={16} />
        </button>
        <div className="chat-title">
          <MessageSquare size={18} className="research-accent-text" />
          <span>{t("Chat")}</span>
        </div>
        <div className="chat-model" data-testid="chat-model">
          <CriteriaSelect
            label={t("Modelo del chat")}
            options={choices.map((choice) => ({
              value: encode(choice),
              label: choice.model,
              description: choice.provider === "local" ? "" : t(PROVIDERS[choice.provider].label),
            }))}
            values={chosenModel ? [encode(chosenModel)] : []}
            placeholder={t("Sin modelo seleccionado")}
            disabled={sending || !choices.length}
            onChange={(values) => {
              if (!values[0]) return;
              const next = decode(values[0]);
              setModel(next);
              store("imago.chat.model", next);
            }}
          />
        </div>
        <div className="segmented chat-mode" role="group" aria-label={t("Profundidad de la respuesta")}>
          {(["fast", "extended"] as const).map((value) => (
            <button
              key={value}
              type="button"
              disabled={sending}
              className={mode === value ? "active" : ""}
              aria-pressed={mode === value}
              data-tooltip={t(
                value === "fast"
                  ? "Menos registros de ejemplo y hasta 2 cálculos por respuesta."
                  : "Más registros de ejemplo, más valores por propiedad y hasta 4 cálculos por respuesta.",
              )}
              onClick={() => {
                setMode(value);
                store("imago.chat.mode", value);
              }}
            >
              {t(value === "fast" ? "Rápido" : "Ampliado")}
            </button>
          ))}
        </div>
        <button
          ref={contextTrigger}
          type="button"
          className={`chat-context-trigger ${contextOpen ? "is-open" : ""}`}
          data-testid="chat-context-toggle"
          aria-expanded={contextOpen}
          data-tooltip={t("Bases de datos que lee el chat")}
          onClick={() => {
            setContextOpen(!contextOpen);
            if (!compact) store(prefix + "context", !contextOpen);
          }}
        >
          <Layers size={15} />
          <span className="chat-context-label">{databaseIds.length ? contextLabel : t("Contexto")}</span>
          <span className="chat-context-count">{databaseIds.length}</span>
        </button>
        <span className="chat-header-spacer" />
        {compact && onExpand && (
          <button type="button" className="chat-header-icon" aria-label={t("Abrir en la sección Chat")} data-tooltip={t("Abrir en la sección Chat")} onClick={onExpand}>
            <Maximize2 size={15} />
          </button>
        )}
        {compact && onClose && (
          <button type="button" className="chat-header-icon" aria-label={t("Cerrar el chat")} data-tooltip={t("Cerrar el chat")} onClick={onClose}>
            <X size={16} />
          </button>
        )}
      </header>
      {compact && contextOpen && (
        <CriteriaPopover anchor={contextTrigger} onClose={() => setContextOpen(false)} width={340} label={t("Bases de datos del chat")} className="chat-context-popover">
          {picker}
        </CriteriaPopover>
      )}
      <div className="chat-body">
        <aside hidden={!historyOpen} className="research-chat-history" data-testid="chat-history">
          <ChatSidebar
            conversations={conversations}
            folders={folders}
            activeId={activeId}
            runningIds={runningIds}
            archivedCount={archivedCount}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived(!showArchived)}
            onNewConversation={startNew}
            onOpenConversation={(id) => void open(id).catch((e) => setError(String(e?.message ?? e)))}
            onRename={async (c, title) => {
              await api.call("chatUpdate", { ids: [c.id], title });
              await refreshList();
            }}
            onPin={async (c, pinned) => {
              await api.call("chatUpdate", { ids: [c.id], pinned });
              await refreshList();
            }}
            onArchive={async (list, archived) => {
              await api.call("chatUpdate", { ids: list.map((c) => c.id), archived });
              await refreshList();
            }}
            onDelete={setDeleting}
            onMove={async (list, folderId) => {
              await api.call("chatUpdate", { ids: list.map((c) => c.id), folderId });
              await refreshList();
            }}
            onFolderSave={async (folder) => {
              const saved = await api.call("chatFolderSave", folder);
              await refreshList();
              return saved;
            }}
            onFolderDelete={setDeletingFolder}
          />
        </aside>
        <section className="chat-main">
          <div className="chat-scroll-frame">
            <div
              ref={scrollRef}
              className="chat-scroll"
              onScroll={(event) => {
                const el = event.currentTarget;
                setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
              }}
            >
              {shown.length === 0 && (
                <div className="research-empty-state">
                  <span className="chat-empty-mark">
                    <MessageSquare size={22} />
                  </span>
                  <p>
                    {t("Pregunta a tus bases de datos de imágenes. El chat responde con cifras, tablas y gráficos calculados sobre tus registros.")}
                  </p>
                  {!choices.length ? (
                    <div className="chat-setup">
                      <p>
                        {t("Para usar el chat, añade al menos un modelo de un proveedor en Ajustes › Proveedores de IA. También puedes conectar Ollama o LM Studio para usar un modelo en este ordenador.")}
                      </p>
                      <Button onClick={onOpenSettings}>
                        <SettingsIcon size={14} />
                        {t("Abrir Ajustes")}
                      </Button>
                    </div>
                  ) : (
                    <div className="chat-suggestions">
                      {STARTERS.map((starter) => (
                        <button
                          key={starter}
                          type="button"
                          className="suggestion-chip"
                          disabled={sending || !chosenModel || !databaseIds.length}
                          onClick={() => void send(t(starter))}
                        >
                          {t(starter)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {shown.map((message) => (
                <div key={message.id} className={`msg-in chat-message-row ${message.role === "user" ? "is-user" : ""}`}>
                  <div
                    className={`research-message chat-message ${message.role === "user" ? "research-accent-solid" : message.error ? "is-error" : "is-assistant"}`}
                    data-testid={message.role === "user" ? "chat-user-message" : "chat-assistant-message"}
                  >
                    <div className="chat-message-actions">
                      {message.role === "assistant" && message.id === lastId && message.id !== "streaming" && !message.error && (
                        <button type="button" aria-label={t("Regenerar respuesta")} data-tooltip={t("Regenerar respuesta")} disabled={sending} onClick={() => void send(undefined, true)}>
                          <RefreshCw size={13} />
                        </button>
                      )}
                      {message.id !== "streaming" && message.content.trim() && !message.error && (
                        <button type="button" aria-label={t("Copiar")} data-tooltip={copied === message.id ? t("Copiado") : t("Copiar")} onClick={() => void copy(message)}>
                          {copied === message.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      )}
                    </div>
                    {message.role === "user" ? (
                      message.content
                    ) : message.error ? (
                      <>
                        {t(message.content)}
                        {message.id === lastId && !sending && (
                          <button type="button" className="chat-retry" onClick={() => void send(undefined, true)}>
                            <RefreshCw size={12} /> {t("Reintentar")}
                          </button>
                        )}
                      </>
                    ) : message.content ? (
                      <div className={message.id === "streaming" ? "stream-body" : undefined}>
                        <AnswerBody text={message.content} />
                        {message.id === "streaming" && <span aria-hidden className="stream-caret" />}
                      </div>
                    ) : message.id === "streaming" ? (
                      <span className="chat-typing-indicator" role="status" aria-label={t("Generando…")}>
                        <span className="chat-typing-dot" />
                        <span className="chat-typing-dot" />
                        <span className="chat-typing-dot" />
                      </span>
                    ) : null}
                    {message.interrupted && <p className="chat-aborted">{t("Respuesta detenida.")}</p>}
                    {message.model && !compact && <p className="chat-message-meta">{message.model}</p>}
                  </div>
                </div>
              ))}
            </div>
            {!atBottom && shown.length > 0 && (
              <button
                type="button"
                className="chat-jump"
                aria-label={t("Bajar al final")}
                data-tooltip={t("Bajar al final")}
                onClick={() => {
                  setAtBottom(true);
                  scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                }}
              >
                <ArrowDown size={18} />
              </button>
            )}
          </div>
          <footer className="research-composer-footer">
            {error && (
              <p className="chat-error" role="alert">
                {t(error)}
              </p>
            )}
            <div className="research-composer-shell">
              <div className="research-composer">
                <textarea
                  ref={inputRef}
                  className="research-composer-input"
                  aria-label={t("Pregunta sobre tus bases de datos…")}
                  placeholder={t("Pregunta sobre tus bases de datos…")}
                  rows={1}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    const el = event.target;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(224, el.scrollHeight)}px`;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                {sending ? (
                  <button
                    type="button"
                    className="research-composer-send research-composer-stop"
                    aria-label={t("Detener generación")}
                    data-tooltip={t("Detener generación")}
                    onClick={() => activeId && void api.chatCancel(activeId)}
                  >
                    <Square size={16} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="research-composer-send"
                    data-testid="chat-send"
                    aria-label={t("Enviar")}
                    data-tooltip={!chosenModel ? t("Elige un modelo") : !databaseIds.length ? t("Elige al menos una base de datos.") : t("Enviar")}
                    disabled={!input.trim() || !chosenModel || !databaseIds.length}
                    onClick={() => void send()}
                  >
                    <ArrowUp size={23} />
                  </button>
                )}
              </div>
            </div>
            <div className="research-composer-shortcuts">
              <kbd className="composer-kbd">Enter</kbd>
              <span>{t("para enviar")}</span>
              <span className="composer-dot">·</span>
              <kbd className="composer-kbd">Shift</kbd>
              <span>+</span>
              <kbd className="composer-kbd">Enter</kbd>
              <span>{t("salto de línea")}</span>
            </div>
          </footer>
        </section>
        {!compact && contextOpen && (
          <aside className="research-chat-context" data-testid="chat-context">
            <div className="chat-context-head">
              <h2>{t("Ámbito")}</h2>
              <button
                type="button"
                className="chat-header-icon"
                aria-label={t("Ocultar el ámbito")}
                data-tooltip={t("Ocultar el ámbito")}
                onClick={() => {
                  setContextOpen(false);
                  store(prefix + "context", false);
                }}
              >
                <X size={14} />
              </button>
            </div>
            {picker}
          </aside>
        )}
      </div>
      {deleting && (
        <Modal title={t("Eliminar chats")} onClose={() => setDeleting(null)}>
          <div className="modal-body">
            <p>
              {deleting.length === 1
                ? t("Se eliminará «{name}» con todos sus mensajes. No se puede deshacer.").replace("{name}", deleting[0].title)
                : t("Se eliminarán {n} chats con todos sus mensajes. No se puede deshacer.").replace("{n}", String(deleting.length))}
            </p>
          </div>
          <footer>
            <Button onClick={() => setDeleting(null)}>{t("Cancelar")}</Button>
            <Button
              className="danger"
              onClick={() =>
                void (async () => {
                  const ids = deleting.map((c) => c.id);
                  setDeleting(null);
                  await api.call("chatDelete", { ids });
                  if (activeId && ids.includes(activeId)) startNew();
                  await refreshList();
                })().catch((e) => setError(String(e?.message ?? e)))
              }
            >
              {t("Eliminar")}
            </Button>
          </footer>
        </Modal>
      )}
      {deletingFolder && (
        <Modal title={t("Eliminar carpeta")} onClose={() => setDeletingFolder(null)}>
          <div className="modal-body">
            <p>
              {t("Se eliminará «{name}» con sus subcarpetas. Sus chats no se borran: vuelven al historial general.").replace("{name}", deletingFolder.name)}
            </p>
          </div>
          <footer>
            <Button onClick={() => setDeletingFolder(null)}>{t("Cancelar")}</Button>
            <Button
              className="danger"
              onClick={() =>
                void (async () => {
                  const id = deletingFolder.id;
                  setDeletingFolder(null);
                  await api.call("chatFolderDelete", { id });
                  await refreshList();
                })().catch((e) => setError(String(e?.message ?? e)))
              }
            >
              {t("Eliminar")}
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

/** Indented JSON that keeps short lists and pairs on one line. */
function compactJson(value: unknown, indent = ""): string {
  const flat = JSON.stringify(value);
  if (flat === undefined) return "null";
  if (flat.length <= 72 || value === null || typeof value !== "object") return flat;
  const next = indent + "  ";
  if (Array.isArray(value)) return `[\n${value.map((v) => next + compactJson(v, next)).join(",\n")}\n${indent}]`;
  return `{\n${Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${next}${JSON.stringify(k)}: ${compactJson(v, next)}`)
    .join(",\n")}\n${indent}}`;
}

/** An answer: Markdown, charts and the calculations it ran. */
function AnswerBody({ text }: { text: string }) {
  const segments = parseChatSegments(text);
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === "chart" ? (
          <ChatChart key={i} spec={segment.spec} />
        ) : segment.kind === "calc" ? (
          <CalcCard key={i} code={segment.code} result={segment.result} />
        ) : (
          <ChatMarkdown key={i} text={segment.text} />
        ),
      )}
    </>
  );
}

function ChatChart({ spec }: { spec: ChartSpec }) {
  return (
    <figure className="chat-chart stat-viz">
      {spec.title && <figcaption>{spec.title}</figcaption>}
      {spec.type === "column" ? (
        <ColumnChart items={spec.items} label={spec.title ?? ""} />
      ) : spec.type === "line" ? (
        <LineChart labels={spec.items.map((i) => i.label)} series={[{ label: spec.title ?? "", values: spec.items.map((i) => i.value) }]} label={spec.title ?? ""} />
      ) : (
        <BarList items={spec.items.slice(0, 40)} />
      )}
    </figure>
  );
}

function CalcCard({ code, result }: { code: string; result: { ok: boolean; result?: string; error?: string; ms?: number } | null }) {
  const t = useT();
  let pretty = result?.result ?? "";
  try {
    if (result?.ok && pretty) pretty = compactJson(JSON.parse(pretty));
  } catch {
    /* Shown as it came. */
  }
  if (pretty.length > 6000) pretty = pretty.slice(0, 6000) + "\n…";
  return (
    <details className={`chat-calc ${result ? (result.ok ? "is-ok" : "is-failed") : "is-pending"}`} data-testid="chat-calc">
      <summary>
        <Calculator size={14} />
        <span>
          {result
            ? result.ok
              ? t("Cálculo en el entorno aislado")
              : t("El cálculo ha fallado")
            : t("Calculando…")}
        </span>
        {result?.ms != null && <small>{formatNumber(result.ms, 0)} ms</small>}
        <ChevronDown size={14} className="chat-calc-chevron" />
      </summary>
      <div className="chat-calc-body">
        <span className="chat-calc-label">{t("Código")}</span>
        <pre>
          <code>{code}</code>
        </pre>
        {result && (
          <>
            <span className="chat-calc-label">{t(result.ok ? "Resultado" : "Error")}</span>
            <pre>
              <code>{result.ok ? pretty : t(result.error ?? "")}</code>
            </pre>
          </>
        )}
      </div>
    </details>
  );
}

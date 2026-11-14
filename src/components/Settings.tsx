import { UpdateSettings } from "./UpdateSettings";
import { BackupSettings } from "./BackupSettings";
import { ModelPreparation } from "./ModelPreparation";
import { useState, useEffect } from "react";
import {
  Download,
  FolderOpen,
  ShieldCheck,
  Trash2,
  HardDrive,
  Cpu,
  CircleCheck,
  Palette,
  RefreshCw,
  Database,
  Upload,
  Pause,
  Play,
  X,
  KeyRound,
  Sparkles,
  Clock3,
  Search,
  Info,
  Link2,
  Plus,
} from "lucide-react";
import type { Status, Settings as SettingsType, Job } from "../../shared/imago";
import type { DatabaseDetail } from "../../shared/databases";
import { Button, Modal } from "./ui";
import type { Perform } from "./Properties";
import { THEMES } from "../theme/themes.mjs";
import { useT } from "../i18n";
import { DEFAULT_EMBEDDING_API } from "../../shared/embeddingApi";
import { PROVIDERS } from "../../shared/aiConfig";
import { ApiSettings } from "./ApiSettings";
import { ModelPicker } from "./ModelPicker";
export function Jobs({
  jobs,
  perform,
  onChanged,
}: {
  jobs: Job[];
  perform: Perform;
  onChanged: () => void;
}) {
  const t = useT(),
    labels: Record<string, string> = {
      images: "Importar imágenes",
      index: "Indexar imágenes",
      analyze: "Analizar",
      download: "Descargar",
      prepare: "Preparar modelos",
    },
    states: Record<string, string> = {
      queued: "En espera",
      running: "En curso",
      paused: "Pausada",
      completed: "Completada",
      failed: "Fallida",
      cancelled: "Cancelada",
    };
  return (
    <div className="job-list">
      {jobs.map((j) => (
        <div className="job" key={j.id}>
          <div className="row">
            <strong>
              {t(labels[j.kind] ?? j.kind)}
              {j.label && <small className="job-label">{t(j.label)}</small>}
            </strong>
            <span className={"badge " + j.state}>{t(states[j.state])}</span>
            <span className="spacer" />
            {["running", "queued"].includes(j.state) && (
              <Button
                icon
                aria-label={t("Pausar")}
                onClick={() =>
                  void perform(async () => {
                    await window.imago.call("controlJob", {
                      id: j.id,
                      action: "pause",
                    });
                    onChanged();
                  })
                }
              >
                <Pause size={14} />
              </Button>
            )}
            {["paused", "failed"].includes(j.state) && (
              <Button
                icon
                aria-label={t("Reanudar")}
                onClick={() =>
                  void perform(async () => {
                    await window.imago.call("controlJob", {
                      id: j.id,
                      action: "resume",
                    });
                    onChanged();
                  })
                }
              >
                <Play size={14} />
              </Button>
            )}
            {!["completed", "cancelled"].includes(j.state) && (
              <Button
                icon
                aria-label={t("Cancelar")}
                onClick={() =>
                  void perform(async () => {
                    await window.imago.call("controlJob", {
                      id: j.id,
                      action: "cancel",
                    });
                    onChanged();
                  })
                }
              >
                <X size={14} />
              </Button>
            )}
          </div>
          <progress value={j.done} max={Math.max(1, j.total)} />
          <div className="row muted">
            <span>
              {j.done.toLocaleString()} / {j.total.toLocaleString()} ·{" "}
              {j.skipped} omitidos · {j.failed} errores
            </span>
            <span className="spacer" />
            <span>
              {Math.round(
                (Date.parse(j.updatedAt) - Date.parse(j.createdAt)) / 1000,
              )}{" "}
              s
            </span>
          </div>
          {j.message && (
            <small className={j.state === "failed" || j.failed ? "danger" : "muted"}>{t(j.message)}</small>
          )}
        </div>
      ))}
      {!jobs.length && (
        <p className="muted">{t("No hay tareas en esta cola.")}</p>
      )}
    </div>
  );
}
export function Settings({
  status,
  onChanged,
  perform,
  notify,
  initialTab = "api",
  details = [],
  onReplayWelcome,
  onReplayTour,
}: {
  onReplayWelcome?: () => void;
  onReplayTour?: () => void;
  status: Status;
  onChanged: () => void;
  perform: Perform;
  notify: (s: string) => void;
  initialTab?: string;
  details?: DatabaseDetail[];
}) {
  const t = useT(),
    [tab, setTab] = useState(initialTab),
    [settingsSearch, setSettingsSearch] = useState(""),
    [python, setPython] = useState(status.settings.python),
    [groupName, setGroupName] = useState(""),
    [groupColumns, setGroupColumns] = useState<string[]>([]);
  const [license, setLicense] = useState<{
    label: string;
    text: string;
    source: string;
  } | null>(null);
  const update = (patch: Partial<SettingsType>) =>
    void perform(async () => {
      await window.imago.call("updateSettings", patch);
      onChanged();
    });
  const s = status.settings;
  useEffect(() => setTab(initialTab), [initialTab]);
  const navigation = [
    {
      group: "INTELIGENCIA ARTIFICIAL",
      items: [
        { id: "api", label: "Proveedores", Icon: KeyRound },
        { id: "tasks", label: "Modelos IA", Icon: Sparkles },
        { id: "models", label: "Modelos locales", Icon: Download },
      ],
    },
    {
      group: "APLICACIÓN",
      items: [
        { id: "appearance", label: "Interfaz", Icon: Palette },
        { id: "performance", label: "Rendimiento", Icon: Cpu },
        {id:"updates",label:"Actualizaciones y novedades",Icon:RefreshCw},
      ],
    },
    {
      group: "DATOS",
      items: [
        {
          id: "equivalences",
          label: "Equivalencias de campos",
          Icon: Link2,
        },
        { id: "storage", label: "Almacenamiento y copias", Icon: HardDrive },
        { id: "jobs", label: "Colas y tareas", Icon: Clock3 },
      ],
    },
  ];
  return (
    <div className="settings-page">
      <aside className="settings-navigation">
        <h1>{t("Ajustes")}</h1>
        <p>Nodus Imago v0.1.0</p>
        <div className="settings-search">
          <Search size={16} />
          <input
            aria-label={t("Buscar en ajustes")}
            placeholder={t("Buscar en ajustes…")}
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
          />
        </div>
        {navigation.map((group) => (
          <div className="settings-nav-group" key={group.group}>
            <h3>{t(group.group)}</h3>
            {group.items
              .filter((item) =>
                t(item.label)
                  .toLowerCase()
                  .includes(settingsSearch.toLowerCase()),
              )
              .map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={tab === id ? "active" : ""}
                  onClick={() => setTab(id)}
                >
                  <Icon size={17} />
                  {t(label)}
                </button>
              ))}
          </div>
        ))}
      </aside>
      <div className="settings-content">
        {tab === "updates" && <UpdateSettings perform={perform} />}
        {tab === "tasks" && (
          <div className="settings-section">
            <div className="settings-card-heading">
              <span>
                <Sparkles size={21} />
              </span>
              <div>
                <h2>{t("Modelos de IA por tarea")}</h2>
                <p>{t("Selecciona modelos independientes para descripción, clasificación y recuperación.")}</p>
              </div>
            </div>
            <label className="setting-row">
              <strong>{t("Descripción visual")}</strong>
              <ModelPicker
                value={s.descriptionModel}
                settings={s}
                models={status.models}
                onChange={(v) => {
                  if (v) update({ descriptionModel: v });
                }}
              />
            </label>
            <label className="setting-row">
              <strong>{t("Clasificación de columnas")}</strong>
              <ModelPicker
                value={s.classificationModel}
                settings={s}
                models={status.models}
                onChange={(v) => {
                  if (v) update({ classificationModel: v });
                }}
              />
            </label>
            <label className="setting-row">
              <strong>{t("Búsqueda multimodal")}</strong>
              <span>
                {s.embeddingModel === "api-embedding"
                  ? `${PROVIDERS[(s.embeddingApi ?? DEFAULT_EMBEDDING_API).provider].label} · ${(s.embeddingApi ?? DEFAULT_EMBEDDING_API).model}`
                  : s.embeddingModel === "harrier-oss-v1-0.6b-q8_0"
                    ? "Harrier OSS v1 · local"
                    : t("EmbeddingGemma 2 · local")}
              </span>
            </label>
            <p className="hint">
              {t(
                "Puedes elegir otro modelo e instrucciones para cada propiedad desde su configuración. Los modelos de API solo se usan al habilitarlos y encolar una tarea expresamente.",
              )}
            </p>
          </div>
        )}
        {tab === "api" && (
          <ApiSettings
            status={status}
            perform={perform}
            onChanged={onChanged}
          />
        )}
        {tab === "models" && (
          <div className="settings-section">
            <div className="section-heading">
              <h2>{t("Modelos locales")}</h2>
              <span className="badge">{t("Opcional")}</span>
            </div>
            <p className="muted">
              {t(
                "Las bases de datos y la búsqueda literal funcionan sin modelos. Las descargas solo comienzan al pulsar Descargar.",
              )}
            </p>
            <ModelPreparation status={status} perform={perform} onChanged={onChanged}/>
            {status.models.filter(m => !m.experimental || m.id === s.embeddingModel || m.id === s.visionModel || m.id === s.descriptionModel.model || m.id === s.classificationModel.model).map((m) => (
              <article className="model-card" key={m.id}>
                <div className="row">
                  <div className="model-icon">
                    {m.task === "embedding" ? (
                      <Database size={21} />
                    ) : (
                      <Cpu size={21} />
                    )}
                  </div>
                  <div>
                    <h3>{t(m.label)}</h3>
                    <span className="muted">
                      {m.task === "embedding"
                        ? t(m.id === "harrier-oss-v1-0.6b-q8_0" ? "Embeddings textuales · 0,6B" : "Embeddings de texto e imagen")
                        : m.task === "runtime"
                          ? t("Motor nativo de LFM3 · CPU / Metal")
                          : t("Descripción y clasificación")}{" "}
                      · {t(m.license)}
                    </span>
                  </div>
                  <span className="spacer" />
                  <span className={"badge " + (m.verified ? "safe" : "")}>
                    {t(
                      m.verified
                        ? "Archivos verificados"
                        : m.installed
                          ? "Verificar integridad"
                          : "No instalado",
                    )}
                  </span>
                </div>
                <div className="model-details">
                  <span>
                    {t("Tamaño de descarga")}: {m.estimatedGB.toFixed(2)} GB
                  </span>
                  {m.unavailableReason && <span role="status">{t(m.unavailableReason)}</span>}
                  {m.experimental && <span>{t("Experimental · requiere Python opcional")}</span>}
                  <span>{m.repository}</span>
                  <span className="mono">{m.revision.slice(0, 12)}</span>
                </div>
                <div className="row wrap">
                  {!m.installed && (
                    <Button
                      primary
                      disabled={m.available === false}
                      onClick={() =>
                        void perform(async () => {
                          if (!window.confirm(`${t(m.label)} · ${m.estimatedGB.toFixed(3)} GB · ${t(m.license)}\n${status.root}/models\n${t("¿Autorizar esta descarga?")}`)) return;
                          await window.imago.call("downloadModel", {
                            id: m.id,
                          });
                          onChanged();
                          notify("Descarga añadida a la cola.");
                        })
                      }
                    >
                      <Download size={14} />
                      {t("Descargar")}
                    </Button>
                  )}
                  <Button
                    onClick={() =>
                      void perform(async () => {
                        await window.imago.call("importModel", { id: m.id });
                        onChanged();
                      })
                    }
                  >
                    <FolderOpen size={14} />
                    {t("Importar desde disco")}
                  </Button>
                  <Button
                    onClick={() =>
                      void perform(async () =>
                        setLicense(
                          await window.imago.call("modelLicense", { id: m.id }),
                        ),
                      )
                    }
                  >
                    {t("Licencia y procedencia")}
                  </Button>
                  {m.installed && (
                    <Button
                      onClick={() =>
                        void perform(async () => {
                          await window.imago.call("verifyModel", { id: m.id });
                          onChanged();
                        })
                      }
                    >
                      <ShieldCheck size={14} />
                      {t("Verificar integridad")}
                    </Button>
                  )}
                  {!!m.files && (
                    <Button
                      icon
                      aria-label={t("Eliminar")}
                      onClick={() => {
                        if (
                          !window.confirm(
                            t(
                              "¿Eliminar los archivos descargados de este modelo? Podrás descargarlo de nuevo.",
                            ),
                          )
                        )
                          return;
                        void perform(async () => {
                          await window.imago.call("deleteModel", { id: m.id });
                          onChanged();
                        });
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              </article>
            ))}
            <p className="hint">
              {t(
                "LFM3-VL-2B usa la licencia LFM Open License 1.0, con condiciones para organizaciones de gran facturación. Los pesos se descargan por separado. Florence-2 Base (MIT) queda pendiente de integración.",
              )}
            </p>
          </div>
        )}
        {tab === "appearance" && (
          <div className="settings-section">
            <h2>{t("Apariencia")}</h2>
            <label className="setting-row">
              <strong>{t("Apariencia")}</strong>
              <select
                value={s.mode}
                onChange={(e) =>
                  update({ mode: e.target.value as SettingsType["mode"] })
                }
              >
                <option value="system">{t("Sistema")}</option>
                <option value="light">{t("Claro")}</option>
                <option value="dark">{t("Oscuro")}</option>
              </select>
            </label>
            <label className="setting-row">
              <strong>{t("Idioma")}</strong>
              <select
                value={s.language}
                onChange={(e) =>
                  update({ language: e.target.value as "es" | "en" })
                }
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </label>
            <div className="setting-row">
              <span>
                <strong>{t("Introducción y recorrido")}</strong>
                <p className="hint">
                  {t("Vuelve a ver la presentación de Nodus Imago o el recorrido guiado por la interfaz.")}
                </p>
              </span>
              <div className="row">
                <Button onClick={onReplayWelcome}>{t("Ver la introducción")}</Button>
                <Button onClick={onReplayTour}>{t("Hacer el recorrido")}</Button>
              </div>
            </div>
            <h3>{t("Paleta")}</h3>
            <div className="palette-grid">
              <button
                onClick={() => update({ theme: "default" })}
                className={s.theme === "default" ? "active" : ""}
              >
                <i style={{ background: "#6366f1" }} />
                Nodus
              </button>
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  className={s.theme === theme.id ? "active" : ""}
                  onClick={() => update({ theme: theme.id })}
                >
                  <i style={{ background: theme.anchors.accent }} />
                  {theme.label}
                </button>
              ))}
            </div>
            <label className="setting-row">
              <strong>{t("Personalizado")}</strong>
              <input
                aria-label={t("Color")}
                type="color"
                value={s.accent}
                onChange={(e) =>
                  update({ theme: "custom", accent: e.target.value })
                }
              />
            </label>
          </div>
        )}
        {tab === "equivalences" && (
          <div className="settings-section">
            <div className="settings-card-heading">
              <span>
                <Link2 size={21} />
              </span>
              <div>
                <h2>{t("Equivalencias de campos")}</h2>
                <p>
                  {t(
                    "Agrupa columnas de bases distintas que representan el mismo campo. Después podrás filtrar por el grupo desde Búsqueda.",
                  )}
                </p>
              </div>
            </div>
            <div className="equivalence-list">
              {s.fieldEquivalences.map((group) => (
                <div className="row equivalence-item" key={group.id}>
                  <strong>{group.name}</strong>
                  <span className="muted">
                    {group.columnIds
                      .map((id) => {
                        const column = details
                          .flatMap((database) => database.columns)
                          .find((candidate) => candidate.id === id);
                        return column
                          ? `${column.name}`
                          : id.slice(0, 8);
                      })
                      .join(" · ")}
                  </span>
                  <span className="spacer" />
                  <Button
                    icon
                    aria-label={t("Eliminar")}
                    onClick={() =>
                      update({
                        fieldEquivalences: s.fieldEquivalences.filter(
                          (candidate) => candidate.id !== group.id,
                        ),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              {!s.fieldEquivalences.length && (
                <p className="muted">{t("Todavía no hay grupos.")}</p>
              )}
            </div>
            <div className="stack equivalence-form">
              <label>
                {t("Nombre del grupo")}
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder={t("Lugar, Autor, Fecha…")}
                />
              </label>
              <label>
                {t("Columnas equivalentes")}
                <select
                  multiple
                  value={groupColumns}
                  onChange={(e) =>
                    setGroupColumns(
                      Array.from(e.target.selectedOptions).map(
                        (option) => option.value,
                      ),
                    )
                  }
                >
                  {details.map((database) => (
                    <optgroup key={database.database.id} label={database.database.name}>
                      {database.columns
                        .filter((column) =>
                          [
                            "title",
                            "rich_text",
                            "text",
                            "ai",
                            "url",
                            "email",
                            "location",
                          ].includes(column.type),
                        )
                        .map((column) => (
                          <option key={column.id} value={column.id}>
                            {column.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <div className="row">
                <Button
                  primary
                  disabled={!groupName.trim() || groupColumns.length < 2}
                  onClick={() =>
                    update({
                      fieldEquivalences: [
                        ...s.fieldEquivalences,
                        {
                          id: crypto.randomUUID(),
                          name: groupName.trim(),
                          columnIds: groupColumns,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={14} />
                  {t("Añadir grupo")}
                </Button>
                <span className="hint">
                  {t("Selecciona al menos dos columnas.")}
                </span>
              </div>
            </div>
          </div>
        )}
        {tab === "storage" && (
          <div className="settings-section">
            <h2>{t("Almacenamiento")}</h2>
            <div className="notice">
              <HardDrive />
              <div>
                <strong>{t("Colección local")}</strong>
                <p className="mono">{status.root}</p>
              </div>
            </div>
            <div className="stat-grid">
              <div>
                <b>{status.databases.toLocaleString()}</b>
                <span>{t("bases de datos")}</span>
              </div>
              <div>
                <b>{status.rows.toLocaleString()}</b>
                <span>{t("registros")}</span>
              </div>
              <div>
                <b>{status.images.toLocaleString()}</b>
                <span>{t("imágenes")}</span>
              </div>
            </div>
            <BackupSettings perform={perform} onChanged={onChanged} notify={notify} />
            <div className="row">
              <Button
                onClick={() =>
                  void perform(async () => {
                    const n = await window.imago.call("rebuildText");
                    notify(`${n} registros reindexados.`);
                  })
                }
              >
                <RefreshCw size={15} />
                {t("Reconstruir índice literal")}
              </Button>
              <Button
                disabled={!status.semanticReady}
                title={
                  status.semanticReady
                    ? undefined
                    : t(
                        "Instala un modelo local de embeddings o configura uno por API.",
                      )
                }
                onClick={() =>
                  void perform(async () => {
                    await window.imago.call("indexImages", {});
                    onChanged();
                  })
                }
              >
                {t("Indexar imágenes y fichas")}
              </Button>
            </div>
          </div>
        )}
        {tab === "performance" && (
          <div className="settings-section">
            <h2>{t("Rendimiento")}</h2>
            <p className="muted">
              {status.platform} · {status.memoryGB} GB RAM · {status.cpus} CPU
            </p>
            <label className="setting-row">
              <strong>{t("Rendimiento")}</strong>
              <select
                value={s.profile}
                onChange={(e) =>
                  update({ profile: e.target.value as SettingsType["profile"] })
                }
              >
                <option value="light">{t("Ligero")} · 1 CPU</option>
                <option value="balanced">{t("Equilibrado")} · 2 CPU</option>
                <option value="advanced">{t("Avanzado")} · 4 CPU</option>
              </select>
            </label>
            <label className="setting-row">
              <span>
                <strong>{t("Trabajos simultáneos")}</strong>
                <p className="hint">
                  {t(
                    "Varias columnas pueden procesarse en paralelo. Se limita según el perfil y la memoria del equipo.",
                  )}
                </p>
              </span>
              <select
                aria-label={t("Trabajos simultáneos")}
                value={s.parallelJobs}
                onChange={(e) =>
                  update({ parallelJobs: Number(e.target.value) })
                }
              >
                {[1, 2, 3, 4].map((n) => (
                  <option value={n} key={n}>
                    {n} trabajos
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-row">
              <strong>{t("Dimensiones")}</strong>
              <select
                value={s.dimensions}
                disabled={s.embeddingModel === "harrier-oss-v1-0.6b-q8_0"}
                onChange={(e) =>
                  update({
                    dimensions: Number(e.target.value) as 256 | 512 | 768,
                  })
                }
              >
                {[256, 512, 768].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              {t(
                "Cambiar las dimensiones crea un índice independiente. Los vectores anteriores se conservan. La indexación omite los originales ya procesados con la misma configuración.",
              )}
            </p>
            <label className="setting-row">
              <strong>{t("Dispositivo")}</strong>
              <select
                value={s.device}
                onChange={(e) =>
                  update({ device: e.target.value as SettingsType["device"] })
                }
              >
                <option value="cpu">CPU</option>
                <option value="mps">{t("Metal · experimental")}</option>
                <option value="cuda">{t("CUDA · experimental")}</option>
              </select>
            </label>
            <label>
              {t("Entorno Python")}
              <div className="row">
                <input
                  value={python}
                  onChange={(e) => setPython(e.target.value)}
                  placeholder={t("/ruta/al/entorno/bin/python")}
                />
                <Button onClick={() => update({ python })}>
                  {t("Guardar")}
                </Button>
                <Button
                  onClick={() =>
                    void perform(async () => {
                      await window.imago.call("updateSettings", { python });
                      const r = await window.imago.call("probeExperimentalPython");
                      notify(
                        `Python listo · torch ${r.torch} · torchvision ${r.torchvision} · transformers ${r.transformers} · sentence-transformers ${r.sentence_transformers} · Pillow ${r.pillow}`,
                      );
                      onChanged();
                    })
                  }
                >
                  {t("Comprobar")}
                </Button>
              </div>
            </label>
          </div>
        )}
        {tab === "jobs" && (
          <div className="settings-section">
            <h2>{t("Tareas")}</h2>
            <Jobs jobs={status.jobs} perform={perform} onChanged={onChanged} />
          </div>
        )}
        <div className="settings-legal">
          <ShieldCheck size={14} /> AGPL-3.0-only · {t("Sin cuentas")} ·{" "}
          {t("Sin telemetría")} ·{" "}
          {t(s.remoteEnabled ? "APIs opcionales activadas" : "IA local")}
        </div>
        {license && (
          <Modal
            wide
            title={"Licencia · " + license.label}
            onClose={() => setLicense(null)}
          >
            <div className="modal-body">
              <p className="mono">{license.source}</p>
              <pre className="license-text">{license.text}</pre>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}

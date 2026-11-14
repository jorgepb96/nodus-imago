import { useEffect, useState } from "react";
import {
  Cpu,
  ShieldCheck,
  Download,
  RefreshCw,
  Database,
  KeyRound,
} from "lucide-react";
import type { ModelPreparation as Plan } from "../../shared/modelPreparation";
import type { Status } from "../../shared/imago";
import {
  ONNX_ID,
  HARRIER_ID,
  LEGACY_EMBEDDING_ID,
} from "../../shared/embeddingBackends";
import {
  API_EMBEDDING_ID,
  DEFAULT_EMBEDDING_API,
  EMBEDDING_API_DIMENSIONS,
  EMBEDDING_API_MODELS,
  EMBEDDING_API_PROVIDERS,
  embeddingApiMultimodal,
  embeddingApiResizable,
  type EmbeddingApiChoice,
} from "../../shared/embeddingApi";
import { PROVIDERS } from "../../shared/aiConfig";
import { Button, Spinner, Modal } from "./ui";
import { CriteriaSelect } from "./CriteriaSelect";
import type { Perform } from "./Properties";
import { useT } from "../i18n";

export function ModelPreparation({
  status,
  perform,
  onChanged,
}: {
  status: Status;
  perform: Perform;
  onChanged: () => void;
}) {
  const t = useT(),
    [plan, setPlan] = useState<Plan | null>(null),
    [consent, setConsent] = useState(false),
    [error, setError] = useState("");
  const [license, setLicense] = useState<{
    label: string;
    text: string;
    source: string;
  } | null>(null);
  const signature = JSON.stringify([
    status.settings.embeddingModel,
    status.settings.dimensions,
    status.models.map((m) => [m.id, m.verified, m.bytes]),
    status.jobs.map((j) => [j.id, j.state, j.done]),
  ]);
  useEffect(() => {
    let disposed = false;
    void window.imago
      .call("modelPreparation")
      .then((value) => {
        if (!disposed) {
          setPlan(value);
          setError("");
        }
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [signature]);
  const jobs = status.jobs.filter(
    (j) =>
      j.kind === "prepare" &&
      ["queued", "running", "paused", "failed"].includes(j.state),
  );
  const api = status.settings.embeddingModel === API_EMBEDDING_ID,
    indexing = status.jobs.some(
      (j) => j.kind === "index" && ["queued", "running"].includes(j.state),
    ),
    pending = status.autoIndex.pending;
  return (
    <section
      className="settings-section model-preparation"
      aria-label={t("Preparar búsqueda local")}
    >
      <div className="settings-card-heading">
        <span>
          <Cpu size={21} />
        </span>
        <div>
          <h2>{t(api ? "Búsqueda semántica" : "Búsqueda local sin Python")}</h2>
          <p>
            {t(
              "Elige el modelo y prepara sus dependencias. La búsqueda literal funciona sin descargar nada.",
            )}
          </p>
        </div>
      </div>
      <div className="prep-field">
        <span>{t("Modelo de embeddings")}</span>
        <CriteriaSelect
          label={t("Modelo de embeddings")}
          values={[status.settings.embeddingModel]}
          options={[
            {
              value: ONNX_ID,
              label: "EmbeddingGemma 2 · ONNX Q8",
              disabled: status.platform === "darwin x64",
              description: t("Texto e imagen · CPU integrado"),
            },
            {
              value: HARRIER_ID,
              label: "Harrier OSS v1 0.6B Q8_0",
              description: t(
                "1024 dimensiones · imágenes mediante descripciones locales de LFM3",
              ),
            },
            {
              value: API_EMBEDDING_ID,
              label: t("Proveedor por API"),
              description: t(
                "Gemini Embedding 2 (texto e imagen), OpenAI, OpenRouter, Ollama, LM Studio u otro compatible · para equipos modestos",
              ),
            },
            {
              value: LEGACY_EMBEDDING_ID,
              label: t("Compatibilidad PyTorch (experimental)"),
              description: t("Requiere Python instalado por separado"),
            },
          ]}
          onChange={(values) => {
            setConsent(false);
            void perform(async () => {
              await window.imago.call("updateSettings", {
                embeddingModel: values[0],
              });
              onChanged();
            });
          }}
        />
      </div>
      <div className="prep-options">
        {api && (
          <EmbeddingApiPanel
            status={status}
            perform={perform}
            onChanged={onChanged}
          />
        )}
        {status.settings.embeddingModel === ONNX_ID && (
          <label className="setting-row">
            <span>
              <strong>{t("Detalle visual de las imágenes")}</strong>
              <p className="hint">
                {t(
                  "EmbeddingGemma 2 ve cada imagen con un número de fichas visuales. Menos fichas indexan mucho más rápido en CPU con una pérdida pequeña de precisión. Cambiarlo crea un índice nuevo.",
                )}
              </p>
            </span>
            <select
              aria-label={t("Detalle visual de las imágenes")}
              value={status.settings.visionBudget ?? 280}
              onChange={(e) =>
                void perform(async () => {
                  await window.imago.call("updateSettings", {
                    visionBudget: Number(e.target.value) as 70 | 140 | 280,
                  });
                  onChanged();
                })
              }
            >
              <option value={280}>{t("Alto · 280 fichas · referencia")}</option>
              <option value={140}>
                {t("Medio · 140 fichas · unas 2× más rápido")}
              </option>
              <option value={70}>
                {t("Rápido · 70 fichas · unas 5× más rápido")}
              </option>
            </select>
          </label>
        )}
        <AutoIndexToggle
          status={status}
          perform={perform}
          onChanged={onChanged}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {!plan ? (
        <Spinner />
      ) : (
        <>
          {plan.embeddingModel === HARRIER_ID && (
            <div className="notice">
              <Cpu size={18} />
              <p>
                {t(
                  "Harrier procesa texto. Para buscar imágenes, LFM3 genera descripciones locales que se indexan con un contrato independiente. Necesita más memoria y tiempo; no es equivalente al embedding visual de EmbeddingGemma.",
                )}
              </p>
            </div>
          )}
          {plan.runtime === "python-experimental" && (
            <div className="notice">
              <Cpu size={18} />
              <p>
                {t(
                  "Este modo conserva los índices antiguos y necesita el entorno Python opcional. No forma parte de la preparación sin Python.",
                )}
              </p>
            </div>
          )}
          {!!plan.priorVectors && (
            <div className="notice">
              <Database size={18} />
              <p>
                {plan.priorVectors.toLocaleString()}{" "}
                {t(
                  "vectores pertenecen a otro contrato. Se conservan, pero no se mezclan con el índice activo. Vuelve a indexar para usar este modelo.",
                )}
              </p>
            </div>
          )}
          <div className="prep-summary">
            <dl>
              <div>
                <dt>{t("Runtime")}</dt>
                <dd>
                  {plan.runtime === "api"
                    ? t("Proveedor externo")
                    : plan.runtime === "onnx-cpu"
                      ? "ONNX Runtime 1.30.0 · CPU"
                      : plan.runtime === "llama-cpu"
                        ? "llama.cpp · CPU"
                        : t("Python externo · experimental")}
                </dd>
              </div>
              <div>
                <dt>{t("Dimensiones")}</dt>
                <dd>{plan.activeDimensions}</dd>
              </div>
              {plan.runtime !== "api" && (
                <>
                  <div>
                    <dt>{t("Descarga pendiente")}</dt>
                    <dd>{(plan.remainingBytes / 1e6).toFixed(1)} MB</dd>
                  </div>
                  <div>
                    <dt>{t("Espacio libre")}</dt>
                    <dd>{(plan.freeBytes / 1e9).toFixed(1)} GB</dd>
                  </div>
                </>
              )}
            </dl>
            {!!plan.requirements.length && (
              <ul className="preparation-dependencies">
                {plan.requirements.map((model) => (
                  <li key={model.id}>
                    <span
                      className={
                        "prep-dependency-icon" +
                        (model.verified ? " verified" : "")
                      }
                    >
                      {model.verified ? (
                        <ShieldCheck size={17} />
                      ) : (
                        <Download size={17} />
                      )}
                    </span>
                    <div>
                      <strong>{t(model.label)}</strong>
                      <small>
                        {t(model.license)} · {model.estimatedGB.toFixed(3)} GB ·{" "}
                        {model.repository} · {model.revision.slice(0, 12)}
                      </small>
                    </div>
                    <Button
                      onClick={() =>
                        void perform(async () => {
                          setLicense(
                            await window.imago.call("modelLicense", {
                              id: model.id,
                            }),
                          );
                        })
                      }
                    >
                      {t("Licencia y procedencia")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {plan.runtime !== "api" && (
              <p className="prep-destination">
                {t("Destino")}: <span className="mono">{plan.destination}</span>
              </p>
            )}
          </div>
          {api && !status.semanticReady ? (
            <div className="prep-status warning" role="status">
              <KeyRound size={18} />
              <div>
                <strong>{t("Falta activar el proveedor")}</strong>
                <p>
                  {t(
                    "Activa el uso opcional de APIs y guarda la clave del proveedor en «Proveedores» para indexar y buscar con este modelo.",
                  )}
                </p>
              </div>
            </div>
          ) : plan.ready ? (
            <div className="prep-status ready" role="status">
              <ShieldCheck size={18} />
              <div>
                <strong>
                  {t(
                    indexing
                      ? "Indexando…"
                      : pending || !status.rows
                        ? "Listo para indexar"
                        : "Índice al día",
                  )}
                </strong>
                <p>
                  {indexing
                    ? t("Sigue el progreso en Colas y tareas.")
                    : !status.rows
                      ? t("Importa imágenes o fichas para empezar.")
                      : pending
                        ? `${pending.toLocaleString()} ${t("elementos pendientes (imágenes y fichas nuevas o editadas).")}`
                        : t(
                            "Todas las imágenes y fichas tienen su vector para este modelo.",
                          )}
                </p>
              </div>
              {(indexing || pending > 0) && (
                <Button
                  primary
                  disabled={!status.rows || indexing}
                  onClick={() =>
                    void perform(async () => {
                      await window.imago.call("indexImages", {});
                      onChanged();
                    })
                  }
                >
                  {t("Indexar imágenes y fichas")}
                </Button>
              )}
            </div>
          ) : (
            <div className="prep-status" role="status">
              <Download size={18} />
              <div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  {t(
                    "He revisado las licencias y autorizo estas descargas al destino indicado.",
                  )}
                </label>
                {plan.freeBytes < plan.remainingBytes + 64 * 2 ** 20 && (
                  <p role="alert">
                    {t("No hay espacio suficiente para preparar el modelo.")}
                  </p>
                )}
              </div>
              <Button
                primary
                disabled={
                  !consent ||
                  !plan.supported ||
                  plan.runtime === "python-experimental" ||
                  plan.freeBytes < plan.remainingBytes + 64 * 2 ** 20 ||
                  jobs.some((j) => ["queued", "running"].includes(j.state))
                }
                onClick={() =>
                  void perform(async () => {
                    await window.imago.call("prepareModels", { consent: true });
                    onChanged();
                  })
                }
              >
                <Download size={15} />
                {t("Preparar búsqueda semántica")}
              </Button>
            </div>
          )}
          {jobs.map((job) => (
            <article className="job" key={job.id}>
              <strong>{t(job.label)}</strong>
              <progress value={job.done} max={job.total || 1} />
              <p>
                {job.message ? t(job.message) : ""} · {job.done}/{job.total}
              </p>
              <div className="row">
                {(["running", "queued"].includes(job.state)
                  ? ["pause", "cancel"]
                  : ["resume", "cancel"]
                ).map((action) => (
                  <Button
                    key={action}
                    onClick={() =>
                      void perform(async () => {
                        await window.imago.call("controlJob", {
                          id: job.id,
                          action: action as "pause" | "resume" | "cancel",
                        });
                        onChanged();
                      })
                    }
                  >
                    {t(
                      action === "pause"
                        ? "Pausar"
                        : action === "resume"
                          ? "Reanudar"
                          : "Cancelar",
                    )}
                  </Button>
                ))}
              </div>
            </article>
          ))}
        </>
      )}
      {license && (
        <Modal title={license.label} wide onClose={() => setLicense(null)}>
          <div className="modal-body">
            <p className="muted">{license.source}</p>
            <pre className="license-text">{license.text}</pre>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** Provider, model and size of an API embedding model, with a connection test. */
function EmbeddingApiPanel({
  status,
  perform,
  onChanged,
}: {
  status: Status;
  perform: Perform;
  onChanged: () => void;
}) {
  const t = useT(),
    saved = status.settings.embeddingApi ?? DEFAULT_EMBEDDING_API,
    [draft, setDraft] = useState<EmbeddingApiChoice>(saved),
    [probe, setProbe] = useState<string>("");
  const savedKey = JSON.stringify(saved);
  useEffect(() => setDraft(JSON.parse(savedKey)), [savedKey]);
  const save = (next: EmbeddingApiChoice) =>
    void perform(async () => {
      await window.imago.call("updateSettings", { embeddingApi: next });
      onChanged();
    });
  const multimodal = embeddingApiMultimodal(draft),
    local = draft.provider === "ollama" || draft.provider === "lmstudio";
  return (
    <div className="embedding-api">
      <div className="embedding-api-fields">
        <label>
          <span>{t("Proveedor")}</span>
          <select
            value={draft.provider}
            onChange={(e) => {
              const provider = e.target.value as EmbeddingApiChoice["provider"];
              const next = {
                ...draft,
                provider,
                model: EMBEDDING_API_MODELS[provider][0],
              };
              setDraft(next);
              save(next);
            }}
          >
            {EMBEDDING_API_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDERS[p].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("Modelo")}</span>
          <input
            list="embedding-api-models"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            onBlur={() =>
              draft.model.trim() &&
              save({ ...draft, model: draft.model.trim() })
            }
          />
          <datalist id="embedding-api-models">
            {EMBEDDING_API_MODELS[draft.provider].filter(Boolean).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>
          <span>{t("Dimensiones")}</span>
          <select
            value={draft.dimensions}
            onChange={(e) => {
              const next = { ...draft, dimensions: Number(e.target.value) };
              setDraft(next);
              save(next);
            }}
          >
            {[...new Set([...EMBEDDING_API_DIMENSIONS, draft.dimensions])]
              .sort((a, b) => a - b)
              .map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
          </select>
        </label>
        <Button
          onClick={() =>
            void perform(async () => {
              setProbe("");
              const result = await window.imago.call(
                "embeddingApiProbe",
                draft,
              );
              if (result.dimensions !== draft.dimensions) {
                const next = { ...draft, dimensions: result.dimensions };
                setDraft(next);
                save(next);
              }
              setProbe(
                `${t("Conexión correcta")} · ${result.dimensions} ${t("dimensiones")} · ${result.ms} ms`,
              );
            })
          }
        >
          <RefreshCw size={14} />
          {t("Probar conexión")}
        </Button>
      </div>
      {probe && (
        <p className="embedding-api-probe" role="status">
          <ShieldCheck size={14} /> {probe}
        </p>
      )}
      <p className="hint">
        {multimodal
          ? t(
              "Texto e imagen en el mismo espacio: cada imagen se envía como JPEG de 1536 px como máximo, en lotes de seis.",
            )
          : t(
              "Solo texto: los registros se buscan por su ficha. Si LFM3 está instalado, las imágenes se describen en local y se indexa esa descripción.",
            )}{" "}
        {!embeddingApiResizable(draft) &&
          t(
            "Este proveedor devuelve su tamaño propio: usa «Probar conexión» para ajustarlo.",
          )}
      </p>
      <div className="notice">
        <ShieldCheck size={18} />
        <p>
          {local
            ? t(
                "Ollama y LM Studio se ejecutan en este equipo: los datos no salen de él.",
              )
            : t(
                "Al indexar se envían al proveedor el texto de cada ficha y, con modelos multimodales, sus imágenes; al buscar, cada consulta. Requiere activar las APIs y guardar la clave en «Proveedores». Cambiar de modelo crea un índice nuevo; los anteriores se conservan.",
              )}
        </p>
      </div>
    </div>
  );
}

/** Opt-in/out of automatic indexing, kept apart for local and remote models. */
function AutoIndexToggle({
  status,
  perform,
  onChanged,
}: {
  status: Status;
  perform: Perform;
  onChanged: () => void;
}) {
  const t = useT(),
    api = status.settings.embeddingModel === API_EMBEDDING_ID,
    state = status.autoIndex;
  return (
    <label className="setting-row">
      <span>
        <strong>{t("Indexar automáticamente lo nuevo y lo editado")}</strong>
        <p className="hint">
          {t(
            api
              ? "Desactivado por defecto con APIs: cada indexación envía fichas e imágenes al proveedor y puede tener coste."
              : "Unos segundos después de importar o editar, se indexa solo lo pendiente. Si la tarea fuese larga (más de 15 minutos), se pide confirmación. Una indexación pausada o fallida no se reanuda sola.",
          )}
        </p>
      </span>
      <input
        type="checkbox"
        aria-label={t("Indexar automáticamente lo nuevo y lo editado")}
        checked={state.enabled}
        onChange={(e) =>
          void perform(async () => {
            await window.imago.call("updateSettings", {
              autoIndex: {
                ...status.settings.autoIndex,
                [api ? "api" : "local"]: e.target.checked,
              },
            });
            onChanged();
          })
        }
      />
    </label>
  );
}

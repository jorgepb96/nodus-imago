// Restoration workshop: choose an image (or a region marked on it), a task
// and an image model, and get a restored version. The original is never
// changed; each version is kept apart, with the model and instructions that
// produced it, and can be downloaded with a mark saying it was edited by AI.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brush,
  Download,
  ImageIcon,
  Palette,
  PenLine,
  Plus,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Square,
  Star,
  Trash2,
  Wand2,
} from "lucide-react";
import type { DatabaseSummary } from "../../shared/databases";
import type { ImageAnnotation, Settings } from "../../shared/imago";
import type { CompareItem } from "../../shared/compare";
import { PROVIDERS, type ApiProvider } from "../../shared/aiConfig";
import {
  IMAGE_API,
  SUGGESTED_IMAGE_MODELS,
  TASK_HELP,
  TASK_LABELS,
  decodeImageModel,
  encodeImageModel,
  restorationPrompt,
  type Restoration,
  type RestorationTask,
  type Watermark,
  type WatermarkPosition,
} from "../../shared/restoration";
import { useT } from "../i18n";
import { Button, Modal } from "./ui";
import { ImagePicker } from "./CompareView";

const TASK_ICONS: Record<RestorationTask, React.ReactNode> = {
  restore: <Sparkles size={16} />,
  repair: <Brush size={16} />,
  sharpen: <ScanLine size={16} />,
  colorize: <Palette size={16} />,
  custom: <PenLine size={16} />,
};
const preview = (id: string, revision?: string) =>
  `imago://asset/${id}/preview${revision ? "?v=" + encodeURIComponent(revision) : ""}`;

export function RestorationsView({
  settings,
  databases,
  seed,
  onSeedUsed,
  onSettings,
  onOpenSettings,
}: {
  settings: Settings;
  databases: DatabaseSummary[];
  seed: string | null;
  onSeedUsed: () => void;
  onSettings: (patch: Partial<Settings>) => Promise<void>;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const api = window.imago;
  const language = settings.language === "en" ? "en" : "es";
  const [source, setSource] = useState<CompareItem | null>(null);
  const [regions, setRegions] = useState<ImageAnnotation[]>([]);
  const [regionId, setRegionId] = useState<string>("");
  const [task, setTask] = useState<RestorationTask>("restore");
  const [prompt, setPrompt] = useState(() => restorationPrompt("restore", language, false));
  const [edited, setEdited] = useState(false);
  const [model, setModel] = useState<string>(() => localStorage.getItem("imago.restoration.model") ?? "");
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [versions, setVersions] = useState<Restoration[]>([]);
  const [current, setCurrent] = useState<Restoration | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState<Restoration | null>(null);
  const [deleting, setDeleting] = useState<Restoration | null>(null);

  useEffect(() => {
    void api
      .call("credentialsStatus")
      .then((s) => setKeys(s.providers))
      .catch(() => {});
  }, [api]);
  const choose = useCallback(
    async (assetId: string) => {
      const [item] = await api.call("compareItems", { assetIds: [assetId] });
      setSource(item ?? null);
      setRegionId("");
      setCurrent(null);
      setError(null);
      if (!item) return;
      setRegions(await api.call("annotationsList", { assetId }));
      setVersions(await api.call("restorationsList", { assetId }));
    },
    [api],
  );
  useEffect(() => {
    if (!seed) return;
    onSeedUsed();
    void choose(seed);
  }, [seed, onSeedUsed, choose]);
  const region = regions.find((r) => r.id === regionId) ?? null;
  // The instructions follow the task until the user writes their own.
  useEffect(() => {
    if (!edited) setPrompt(restorationPrompt(task, language, !!region));
  }, [task, language, region, edited]);

  const models = useMemo(() => {
    const favorites = settings.favoriteImageModels ?? [];
    const list = new Set<string>([...favorites, ...(settings.imageModels ?? [])]);
    for (const [provider, suggested] of Object.entries(SUGGESTED_IMAGE_MODELS))
      if (keys[provider] || settings.apiProfiles[provider as ApiProvider]?.models?.length)
        for (const m of suggested ?? []) list.add(encodeImageModel(provider as ApiProvider, m));
    return [...list]
      .filter((v) => decodeImageModel(v))
      .sort((a, b) => Number(favorites.includes(b)) - Number(favorites.includes(a)) || a.localeCompare(b));
  }, [settings, keys]);
  const chosen = models.includes(model) ? model : (models[0] ?? "");
  const choice = decodeImageModel(chosen);
  const remoteBlocked = !!choice && !settings.remoteEnabled && !["ollama", "lmstudio"].includes(choice.provider) && !(choice.provider === "custom" && /127\.0\.0\.1|localhost/.test(settings.apiProfiles.custom?.baseUrl ?? ""));
  const toggleFavorite = (value: string) => {
    const favorites = settings.favoriteImageModels ?? [];
    void onSettings({
      favoriteImageModels: favorites.includes(value) ? favorites.filter((f) => f !== value) : [...favorites, value],
    });
  };

  const run = async () => {
    if (!source || !choice) return;
    setRunning(true);
    setError(null);
    try {
      const result = await api.call("restorationRun", {
        assetId: source.assetId,
        region: region ? { x: region.x, y: region.y, w: region.w, h: region.h } : null,
        provider: choice.provider,
        model: choice.model,
        task,
        prompt: prompt.trim(),
      });
      setVersions(await api.call("restorationsList", { assetId: source.assetId }));
      setCurrent(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="restoration-page" data-testid="restorations-view">
      <aside className="restoration-side">
        <h1>
          <Wand2 size={18} />
          {t("Restauraciones")}
        </h1>
        <p className="hint">
          {t("Crea versiones restauradas o coloreadas con un modelo de imagen. El original no se modifica: cada versión se guarda aparte, con el modelo y las instrucciones que la produjeron.")}
        </p>
        <section>
          <h2>{t("1. Imagen")}</h2>
          {source ? (
            <div className="restoration-source">
              <img src={preview(source.assetId, source.revision)} alt={source.title} />
              <span>
                <strong>{source.title}</strong>
                <small>{[source.date, source.databaseName].filter(Boolean).join(" · ")}</small>
              </span>
            </div>
          ) : null}
          <Button onClick={() => setPicking(true)} data-testid="restoration-pick">
            <ImageIcon size={14} />
            {t(source ? "Cambiar imagen" : "Elegir imagen")}
          </Button>
        </section>
        {source && (
          <>
            <section>
              <h2>{t("2. Zona")}</h2>
              <select aria-label={t("Zona")} value={regionId} onChange={(e) => setRegionId(e.target.value)}>
                <option value="">{t("Imagen completa")}</option>
                {regions.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {`${t("Zona")} ${i + 1}${r.note ? ` · ${r.note.slice(0, 40)}` : ""}`}
                  </option>
                ))}
              </select>
              <p className="hint">
                {regions.length
                  ? t("Con una zona se envía solo ese recorte y el resultado se pega en su sitio; el resto de la imagen no cambia.")
                  : t("Para restaurar solo una parte, márcala antes con «Anotar» en el visor de la ficha.")}
              </p>
            </section>
            <section>
              <h2>{t("3. Tarea")}</h2>
              <div className="restoration-tasks" role="radiogroup" aria-label={t("Tarea")}>
                {(Object.keys(TASK_LABELS) as RestorationTask[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={task === key}
                    className={task === key ? "is-selected" : ""}
                    onClick={() => {
                      setTask(key);
                      setEdited(key === "custom");
                      if (key === "custom") setPrompt("");
                    }}
                  >
                    {TASK_ICONS[key]}
                    <span>
                      <strong>{t(TASK_LABELS[key])}</strong>
                      <small>{t(TASK_HELP[key])}</small>
                    </span>
                  </button>
                ))}
              </div>
              <label className="restoration-prompt">
                {t("Instrucciones para el modelo")}
                <textarea
                  rows={5}
                  value={prompt}
                  placeholder={t("Describe qué debe hacer el modelo con la imagen.")}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setEdited(true);
                  }}
                />
              </label>
              {edited && task !== "custom" && (
                <button type="button" className="link-button" onClick={() => setEdited(false)}>
                  {t("Volver a las instrucciones de la tarea")}
                </button>
              )}
            </section>
            <section>
              <h2>{t("4. Modelo")}</h2>
              {models.length ? (
                <ul className="restoration-models" role="radiogroup" aria-label={t("Modelo de imagen")}>
                  {models.map((value) => {
                    const m = decodeImageModel(value)!,
                      favorite = (settings.favoriteImageModels ?? []).includes(value);
                    return (
                      <li key={value} className={chosen === value ? "is-selected" : ""}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={chosen === value}
                          onClick={() => {
                            setModel(value);
                            localStorage.setItem("imago.restoration.model", value);
                          }}
                        >
                          <span>
                            <strong>{m.model}</strong>
                            <small>{t(PROVIDERS[m.provider].label)}</small>
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`restoration-star ${favorite ? "is-on" : ""}`}
                          aria-pressed={favorite}
                          aria-label={t(favorite ? "Quitar de favoritos" : "Marcar como favorito")}
                          data-tooltip={t(favorite ? "Quitar de favoritos" : "Marcar como favorito")}
                          onClick={() => toggleFavorite(value)}
                        >
                          <Star size={14} fill={favorite ? "currentColor" : "none"} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="hint">{t("No hay modelos de imagen. Configura la clave de OpenAI, Gemini u OpenRouter en Ajustes, o añade un modelo.")}</p>
              )}
              <div className="row">
                <Button onClick={() => setAdding(true)}>
                  <Plus size={14} />
                  {t("Añadir modelo")}
                </Button>
                <Button onClick={onOpenSettings}>{t("Proveedores")}</Button>
              </div>
            </section>
            <div className="restoration-run">
              {choice && (
                <p className="restoration-privacy">
                  <ShieldAlert size={14} />
                  {t("La imagen (o el recorte) se envía a {p} para procesarla.").replace("{p}", t(PROVIDERS[choice.provider].label))}
                </p>
              )}
              {remoteBlocked && <p className="restoration-error">{t("Las APIs remotas están desactivadas en Ajustes.")}</p>}
              {running ? (
                <Button onClick={() => void api.call("restorationCancel")}>
                  <Square size={13} fill="currentColor" />
                  {t("Detener")}
                </Button>
              ) : (
                <Button primary disabled={!choice || !prompt.trim() || remoteBlocked} onClick={() => void run()} data-testid="restoration-run">
                  <Wand2 size={15} />
                  {t(region ? "Restaurar la zona" : "Restaurar la imagen")}
                </Button>
              )}
              {error && <p className="restoration-error">{t(error)}</p>}
            </div>
          </>
        )}
      </aside>
      <section className="restoration-main">
        {!source ? (
          <div className="restoration-empty">
            <Wand2 size={32} />
            <h2>{t("Taller de restauración")}</h2>
            <p>
              {t("Elige una imagen de cualquier base de datos, o pulsa «Restaurar con IA» en la ficha de un registro. Puedes restaurar la imagen entera o una zona que hayas marcado.")}
            </p>
            <Button primary onClick={() => setPicking(true)}>
              <ImageIcon size={14} />
              {t("Elegir imagen")}
            </Button>
          </div>
        ) : (
          <>
            <BeforeAfter
              before={preview(source.assetId, source.revision)}
              after={current ? `imago://restoration/${current.id}` : null}
              region={current?.region ?? region}
              running={running}
            />
            <div className="restoration-versions">
              <h2>
                {t("Versiones de esta imagen")} <span>{versions.length}</span>
              </h2>
              {!versions.length && <p className="hint">{t("Todavía no hay versiones restauradas de esta imagen.")}</p>}
              <ul>
                {versions.map((v) => (
                  <li key={v.id} className={current?.id === v.id ? "is-selected" : ""}>
                    <button type="button" onClick={() => setCurrent(v)} data-testid="restoration-version">
                      <img src={`imago://restoration/${v.id}`} alt="" />
                      <span>
                        <strong>{t(TASK_LABELS[v.task])}</strong>
                        <small>
                          {v.model} · {new Date(v.createdAt).toLocaleString(language === "en" ? "en-GB" : "es-ES", { dateStyle: "short", timeStyle: "short" })}
                        </small>
                        {v.region && <small>{t("Zona")}</small>}
                      </span>
                    </button>
                    <span className="restoration-version-actions">
                      <button type="button" aria-label={t("Descargar")} data-tooltip={t("Descargar")} onClick={() => setExporting(v)}>
                        <Download size={14} />
                      </button>
                      <button type="button" aria-label={t("Eliminar")} data-tooltip={t("Eliminar")} onClick={() => setDeleting(v)}>
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>
      {picking && (
        <ImagePicker
          databases={databases}
          taken={[]}
          room={1}
          title={t("Elegir la imagen que quieres restaurar")}
          action={t("Elegir")}
          onClose={() => setPicking(false)}
          onAdd={(ids) => {
            setPicking(false);
            void choose(ids[0]);
          }}
        />
      )}
      {adding && (
        <AddModel
          onClose={() => setAdding(false)}
          onAdd={(value) => {
            setAdding(false);
            setModel(value);
            void onSettings({ imageModels: [...new Set([...(settings.imageModels ?? []), value])] });
          }}
        />
      )}
      {exporting && (
        <ExportDialog
          version={exporting}
          watermark={settings.watermark ?? { enabled: true, text: t("Editada con IA"), position: "bottom-right" }}
          onClose={() => setExporting(null)}
          onExport={async (format, watermark) => {
            await onSettings({ watermark });
            await api.call("restorationExport", { id: exporting.id, format, watermark });
            setExporting(null);
          }}
        />
      )}
      {deleting && (
        <Modal icon={Trash2} title={t("Eliminar versión")} onClose={() => setDeleting(null)}>
          <div className="modal-body">
            <p>{t("Se eliminará esta versión restaurada. La imagen original no cambia.")}</p>
          </div>
          <footer>
            <Button onClick={() => setDeleting(null)}>{t("Cancelar")}</Button>
            <Button
              className="danger"
              onClick={() =>
                void (async () => {
                  const v = deleting;
                  setDeleting(null);
                  await api.call("restorationDelete", { id: v.id });
                  if (current?.id === v.id) setCurrent(null);
                  setVersions(await api.call("restorationsList", { assetId: v.assetId }));
                })()
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

/** The original and the restored version, with a divider to drag. */
function BeforeAfter({
  before,
  after,
  region,
  running,
}: {
  before: string;
  after: string | null;
  region: { x: number; y: number; w: number; h: number } | null;
  running: boolean;
}) {
  const t = useT();
  const [split, setSplit] = useState(0.5);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const move = (clientX: number) => {
    const box = frame.current!.getBoundingClientRect();
    setSplit(Math.min(1, Math.max(0, (clientX - box.left) / box.width)));
  };
  return (
    <div className="before-after-wrap">
      <div
        ref={frame}
        className={`before-after ${after ? "has-after" : ""}`}
        data-testid="before-after"
        onPointerDown={(e) => {
          if (!after) return;
          drag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e.clientX);
        }}
        onPointerMove={(e) => drag.current && move(e.clientX)}
        onPointerUp={() => (drag.current = false)}
      >
        <img src={before} alt={t("Original")} draggable={false} />
        {after && <img className="after" src={after} alt={t("Versión restaurada")} draggable={false} style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }} />}
        {region && !after && (
          <span
            className="before-after-region"
            style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
          />
        )}
        {after && (
          <>
            <span className="before-after-line" style={{ left: `${split * 100}%` }} />
            <span className="before-after-label left">{t("Original")}</span>
            <span className="before-after-label right">{t("Restaurada")}</span>
          </>
        )}
        {running && (
          <span className="before-after-running" role="status">
            <span className="chat-typing-indicator">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </span>
            {t("El modelo está procesando la imagen…")}
          </span>
        )}
      </div>
      {after && <p className="hint">{t("Arrastra sobre la imagen para mover la línea entre el original y la versión restaurada.")}</p>}
    </div>
  );
}

function AddModel({ onClose, onAdd }: { onClose: () => void; onAdd: (value: string) => void }) {
  const t = useT();
  const providers = (Object.keys(IMAGE_API) as ApiProvider[]).filter((p) => PROVIDERS[p]);
  const [provider, setProvider] = useState<ApiProvider>("openai");
  const [model, setModel] = useState("");
  return (
    <Modal icon={Plus} title={t("Añadir modelo de imagen")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (model.trim()) onAdd(encodeImageModel(provider, model.trim()));
        }}
      >
        <div className="modal-body">
          <label>
            {t("Proveedor")}
            <select value={provider} onChange={(e) => setProvider(e.target.value as ApiProvider)}>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {t(PROVIDERS[p].label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Identificador del modelo")}
            <input autoFocus value={model} placeholder={SUGGESTED_IMAGE_MODELS[provider]?.[0] ?? "model-id"} onChange={(e) => setModel(e.target.value)} />
          </label>
          <p className="hint">{t("El modelo debe poder recibir una imagen y devolver otra.")}</p>
        </div>
        <footer>
          <Button type="button" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button primary disabled={!model.trim()}>
            {t("Añadir")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function ExportDialog({
  version,
  watermark,
  onClose,
  onExport,
}: {
  version: Restoration;
  watermark: Watermark;
  onClose: () => void;
  onExport: (format: "png" | "jpeg", watermark: Watermark) => Promise<void>;
}) {
  const t = useT();
  const [mark, setMark] = useState(watermark);
  const [format, setFormat] = useState<"png" | "jpeg">("jpeg");
  const [busy, setBusy] = useState(false);
  return (
    <Modal icon={Download} title={t("Descargar versión restaurada")} onClose={onClose}>
      <div className="modal-body restoration-export">
        <div className="restoration-export-preview">
          <img src={`imago://restoration/${version.id}`} alt="" />
          {mark.enabled && mark.text.trim() && <span className={`watermark-preview ${mark.position}`}>{mark.text}</span>}
        </div>
        <label className="check-label">
          <input type="checkbox" checked={mark.enabled} onChange={(e) => setMark({ ...mark, enabled: e.target.checked })} />
          {t("Añadir una marca de agua en una esquina")}
        </label>
        {mark.enabled && (
          <>
            <label>
              {t("Texto de la marca")}
              <input value={mark.text} maxLength={80} onChange={(e) => setMark({ ...mark, text: e.target.value })} />
            </label>
            <label>
              {t("Esquina")}
              <select value={mark.position} onChange={(e) => setMark({ ...mark, position: e.target.value as WatermarkPosition })}>
                <option value="bottom-right">{t("Abajo a la derecha")}</option>
                <option value="bottom-left">{t("Abajo a la izquierda")}</option>
                <option value="top-right">{t("Arriba a la derecha")}</option>
                <option value="top-left">{t("Arriba a la izquierda")}</option>
              </select>
            </label>
          </>
        )}
        <label>
          {t("Formato")}
          <select value={format} onChange={(e) => setFormat(e.target.value as "png" | "jpeg")}>
            <option value="jpeg">JPEG</option>
            <option value="png">PNG</option>
          </select>
        </label>
        {!mark.enabled && <p className="hint">{t("Sin marca, conviene indicar en el pie o en la cita que la imagen ha sido modificada con IA.")}</p>}
      </div>
      <footer>
        <Button onClick={onClose}>{t("Cancelar")}</Button>
        <Button
          primary
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onExport(format, mark).finally(() => setBusy(false));
          }}
        >
          <Download size={14} />
          {t("Descargar")}
        </Button>
      </footer>
    </Modal>
  );
}

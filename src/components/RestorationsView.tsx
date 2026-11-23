// Restoration workshop: choose an image (or a region marked on it), a task
// and an image model, and get a restored version. The original is never
// changed; each version is kept apart, with the model and instructions that
// produced it, and can be downloaded with a mark saying it was edited by AI.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brush,
  CornerDownRight,
  Download,
  ImageIcon,
  Palette,
  PenLine,
  Plus,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  SquareDashed,
  Star,
  Trash2,
  Wand2,
  X,
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
  restorationContext,
  restorationPrompt,
  restorationRequest,
  type Restoration,
  type RestorationCheck,
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
type Region = { x: number; y: number; w: number; h: number };
/** The run button: [whole image, region]. */
const RUN_LABELS: Record<RestorationTask, [string, string]> = {
  restore: ["Restaurar la imagen", "Restaurar la zona"],
  repair: ["Reparar la imagen", "Reparar la zona"],
  sharpen: ["Mejorar la imagen", "Mejorar la zona"],
  colorize: ["Colorear la imagen", "Colorear la zona"],
  custom: ["Procesar la imagen", "Procesar la zona"],
};
const readBool = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
};
const saveBool = (key: string, value: boolean) => {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* Only a convenience. */
  }
};
const CHECK_TEXT: Record<RestorationCheck["level"], { label: string; help: string }> = {
  faithful: { label: "Fiel", help: "El modelo ha respetado la forma y la posición de todo lo que se ve." },
  changed: { label: "Con retoques visibles", help: "Revisa en «Cambios» las zonas marcadas en rojo antes de usar esta versión." },
  different: {
    label: "Muy retocada",
    help: "El modelo ha reconstruido zonas grandes: caras, rasgos o detalles pueden no ser los reales. Revisa «Cambios» y úsala con cautela.",
  },
};

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
  const [drawn, setDrawn] = useState<Region | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [baseId, setBaseId] = useState<string>("");
  const [note, setNote] = useState("");
  const [fields, setFields] = useState<{ label: string; value: string }[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [useRecord, setUseRecord] = useState(() => readBool("imago.restoration.record", true));
  const [keepDetail, setKeepDetail] = useState(() => readBool("imago.restoration.keepDetail", true));
  const [check, setCheck] = useState<RestorationCheck | null>(null);
  const [changes, setChanges] = useState(false);
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
      setDrawn(null);
      setDrawing(false);
      setBaseId("");
      setNote("");
      setExcluded(new Set());
      setCurrent(null);
      setError(null);
      if (!item) return;
      setRegions(await api.call("annotationsList", { assetId }));
      setVersions(await api.call("restorationsList", { assetId }));
      setFields(await api.call("restorationContext", { assetId }).catch(() => []));
    },
    [api],
  );
  useEffect(() => {
    if (!seed) return;
    onSeedUsed();
    void choose(seed);
  }, [seed, onSeedUsed, choose]);
  const region: Region | null = regionId === "drawn" ? drawn : (regions.find((r) => r.id === regionId) ?? null);
  const base = versions.find((v) => v.id === baseId) ?? null;
  const context = restorationContext({ note, fields: useRecord ? fields.filter((f) => !excluded.has(f.label)) : [] }, language, task);
  // The selected version's faithfulness, measured against what it started from.
  useEffect(() => {
    setCheck(current?.check ?? null);
    setChanges(false);
    if (!current || current.check) return;
    let live = true;
    void api
      .call("restorationCheck", { id: current.id })
      .then((c) => live && setCheck(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, current]);
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
    // Favourites first, then the order in which they were added and suggested
    // (the recommended model of each provider comes first).
    return [...list].filter((v) => decodeImageModel(v)).sort((a, b) => Number(favorites.includes(b)) - Number(favorites.includes(a)));
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
        context,
        baseId: base?.id ?? null,
        keepDetail: task === "colorize" ? keepDetail : undefined,
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
          {t("Restauración IA")}
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
          {source && versions.length > 0 && (
            <label className="restoration-field">
              {t("Partir de")}
              <select value={baseId} onChange={(e) => setBaseId(e.target.value)} data-testid="restoration-base">
                <option value="">{t("El original")}</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {`${t(TASK_LABELS[v.task])} · ${new Date(v.createdAt).toLocaleString(language === "en" ? "en-GB" : "es-ES", { dateStyle: "short", timeStyle: "short" })}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
        {source && (
          <>
            <section>
              <h2>{t("2. Zona")}</h2>
              <div className="restoration-zone">
                <select aria-label={t("Zona")} value={regionId} onChange={(e) => setRegionId(e.target.value)} data-testid="restoration-zone">
                  <option value="">{t("Imagen completa")}</option>
                  {drawn && <option value="drawn">{t("Zona dibujada")}</option>}
                  {regions.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      {`${t("Anotación")} ${i + 1}${r.note ? ` · ${r.note.slice(0, 40)}` : ""}`}
                    </option>
                  ))}
                </select>
                <Button className={drawing ? "is-on" : ""} aria-pressed={drawing} onClick={() => setDrawing(!drawing)} data-testid="restoration-draw">
                  <SquareDashed size={14} />
                  {t(drawing ? "Arrastra sobre la imagen…" : "Dibujar zona")}
                </Button>
              </div>
              <p className="hint">
                {region
                  ? t("Solo se envía ese recorte y el resultado se pega en su sitio, con el tono de lo que lo rodea; el resto de la imagen no cambia.")
                  : t("Para arreglar solo una parte (una mancha, una rotura, una cara), dibuja un recuadro sobre la imagen.")}
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
              {task === "colorize" && (
                <label className="check-label restoration-keep">
                  <input
                    type="checkbox"
                    checked={keepDetail}
                    onChange={(e) => {
                      setKeepDetail(e.target.checked);
                      saveBool("imago.restoration.keepDetail", e.target.checked);
                    }}
                    data-testid="restoration-keep-detail"
                  />
                  <span>
                    {t("Conservar la luz y los detalles")}
                    <small>{t("Del modelo solo se toma el color: nada puede moverse, añadirse ni suavizarse.")}</small>
                  </span>
                </label>
              )}
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
              <h2>{t("4. Contexto")}</h2>
              <label className="restoration-prompt">
                {t("Lo que sabes de la foto (opcional)")}
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={note}
                  placeholder={t("Lugar, fecha, quiénes son, colores reales (la fachada era ocre, el uniforme azul marino)…")}
                  onChange={(e) => setNote(e.target.value)}
                  data-testid="restoration-note"
                />
              </label>
              {fields.length > 0 && (
                <div className="restoration-record">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={useRecord}
                      onChange={(e) => {
                        setUseRecord(e.target.checked);
                        saveBool("imago.restoration.record", e.target.checked);
                      }}
                      data-testid="restoration-use-record"
                    />
                    {t("Usar los datos del registro")}
                  </label>
                  {useRecord && (
                    <ul>
                      {fields.map((f) => (
                        <li key={f.label}>
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={!excluded.has(f.label)}
                              onChange={(e) =>
                                setExcluded((all) => {
                                  const next = new Set(all);
                                  if (e.target.checked) next.delete(f.label);
                                  else next.add(f.label);
                                  return next;
                                })
                              }
                            />
                            <span>
                              <strong>{f.label}</strong>
                              <small>{f.value}</small>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <p className="hint">{t("Ayuda al modelo a elegir colores y detalles verosímiles. Se le pide que no añada nada que no se vea.")}</p>
              <details className="restoration-sent">
                <summary>{t("Ver lo que se envía")}</summary>
                <pre>{restorationRequest(prompt, context) || "—"}</pre>
              </details>
            </section>
            <section>
              <h2>{t("5. Modelo")}</h2>
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
                  {t(context ? "La imagen (o el recorte) y el contexto se envían a {p} para procesarla." : "La imagen (o el recorte) se envía a {p} para procesarla.").replace("{p}", t(PROVIDERS[choice.provider].label))}
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
                  {t(RUN_LABELS[task][region ? 1 : 0])}
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
            <h2>{t("Restauración IA")}</h2>
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
            {current && (
              <div className="restoration-view" role="tablist" aria-label={t("Vista")}>
                <button type="button" role="tab" aria-selected={!changes} className={!changes ? "is-selected" : ""} onClick={() => setChanges(false)}>
                  {t("Comparar")}
                </button>
                <button type="button" role="tab" aria-selected={changes} className={changes ? "is-selected" : ""} onClick={() => setChanges(true)} data-testid="restoration-changes">
                  {t("Cambios")}
                </button>
                {check && (
                  <span className={`restoration-check ${check.level}`} data-testid="restoration-check" data-tooltip={t(CHECK_TEXT[check.level].help)}>
                    {check.level === "faithful" ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                    <strong>{t(CHECK_TEXT[check.level].label)}</strong>
                    <span>{`${Math.round(check.similarity * 100)} %`}</span>
                  </span>
                )}
              </div>
            )}
            <BeforeAfter
              before={
                current?.baseId && versions.some((v) => v.id === current.baseId)
                  ? `imago://restoration/${current.baseId}`
                  : !current && base
                    ? `imago://restoration/${base.id}`
                    : preview(source.assetId, source.revision)
              }
              beforeLabel={t((current ? current.baseId && versions.some((v) => v.id === current.baseId) : base) ? "Partida" : "Original")}
              after={current ? `imago://restoration/${current.id}${changes ? "/changes" : ""}` : null}
              only={changes}
              region={current ? current.region : region}
              running={running}
              drawing={drawing}
              onDraw={(box) => {
                setDrawn(box);
                setRegionId("drawn");
                setDrawing(false);
                setCurrent(null);
              }}
            />
            {current && check && (
              <div className={`restoration-verdict ${check.level}`}>
                <p>
                  {t(CHECK_TEXT[check.level].help)}{" "}
                  {changes &&
                    t(
                      current.baseId
                        ? "En rojo, lo que ha cambiado de forma o de detalle respecto a la versión de partida; los cambios de tono o de color no se marcan."
                        : "En rojo, lo que ha cambiado de forma o de detalle respecto al original; los cambios de tono o de color no se marcan.",
                    )}
                </p>
                {current.notes?.map((n) => (
                  <p key={n} className="restoration-error">
                    {t(n)}
                  </p>
                ))}
                <div className="row">
                  <Button
                    onClick={() => {
                      setBaseId(current.id);
                      setCurrent(null);
                    }}
                    data-testid="restoration-continue"
                  >
                    <CornerDownRight size={14} />
                    {t("Seguir desde esta versión")}
                  </Button>
                </div>
                <details className="restoration-sent">
                  <summary>{t("Instrucciones y contexto que se enviaron")}</summary>
                  <pre>{current.prompt}</pre>
                </details>
              </div>
            )}
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
                        {(v.region || v.baseId) && <small>{[v.region ? t("Zona") : "", v.baseId ? t("sobre otra versión") : ""].filter(Boolean).join(" · ")}</small>}
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

/**
 * The original and the restored version, with a divider to drag; or only the
 * version (what changed). A region can be drawn on the image: boxes are laid
 * over the picture itself, not its letterboxed frame.
 */
function BeforeAfter({
  before,
  beforeLabel,
  after,
  only,
  region,
  running,
  drawing,
  onDraw,
}: {
  before: string;
  beforeLabel: string;
  after: string | null;
  only: boolean;
  region: Region | null;
  running: boolean;
  drawing: boolean;
  onDraw: (box: Region) => void;
}) {
  const t = useT();
  const [split, setSplit] = useState(0.5);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setFrameSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Where the picture sits inside the frame (object-fit: contain).
  const scale = natural ? Math.min(frameSize.w / natural.w, frameSize.h / natural.h) : 0;
  const stage = natural
    ? { left: (frameSize.w - natural.w * scale) / 2, top: (frameSize.h - natural.h * scale) / 2, width: natural.w * scale, height: natural.h * scale }
    : null;
  const at = (clientX: number, clientY: number) => {
    const box = frame.current!.getBoundingClientRect();
    const s = stage!;
    return {
      x: Math.min(1, Math.max(0, (clientX - box.left - s.left) / s.width)),
      y: Math.min(1, Math.max(0, (clientY - box.top - s.top) / s.height)),
    };
  };
  const move = (clientX: number) => {
    const box = frame.current!.getBoundingClientRect();
    setSplit(Math.min(1, Math.max(0, (clientX - box.left) / box.width)));
  };
  const shown = draft
    ? { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) }
    : region;
  const comparing = !!after && !only;
  return (
    <div className="before-after-wrap">
      <div
        ref={frame}
        className={`before-after ${comparing ? "has-after" : ""} ${drawing ? "is-drawing" : ""}`}
        data-testid="before-after"
        onPointerDown={(e) => {
          if (drawing && stage) {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = at(e.clientX, e.clientY);
            setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            return;
          }
          if (!comparing) return;
          drag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draft) {
            const p = at(e.clientX, e.clientY);
            setDraft({ ...draft, x1: p.x, y1: p.y });
          } else if (drag.current) move(e.clientX);
        }}
        onPointerUp={() => {
          drag.current = false;
          if (!draft) return;
          const box = { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) };
          setDraft(null);
          if (box.w >= 0.02 && box.h >= 0.02) onDraw(box);
        }}
      >
        {!only && <img src={before} alt={t("Original")} draggable={false} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
        {after && (
          <img
            className="after"
            src={after}
            alt={t("Versión restaurada")}
            draggable={false}
            onLoad={(e) => only && setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={comparing ? { clipPath: `inset(0 0 0 ${split * 100}%)` } : undefined}
          />
        )}
        {stage && shown && (!after || draft) && (
          <span
            className="before-after-region"
            data-testid="restoration-region"
            style={{
              left: stage.left + shown.x * stage.width,
              top: stage.top + shown.y * stage.height,
              width: shown.w * stage.width,
              height: shown.h * stage.height,
            }}
          />
        )}
        {comparing && (
          <>
            <span className="before-after-line" style={{ left: `${split * 100}%` }} />
            <span className="before-after-label left">{beforeLabel}</span>
            <span className="before-after-label right">{t("Restaurada")}</span>
          </>
        )}
        {drawing && !draft && <span className="before-after-hint">{t("Arrastra para marcar la zona que quieres arreglar")}</span>}
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
      {comparing && <p className="hint">{t("Arrastra sobre la imagen para mover la línea entre el original y la versión restaurada.")}</p>}
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

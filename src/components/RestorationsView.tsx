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
  RefreshCw,
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
  ZoomIn,
  ZoomOut,
  ChevronLeft,
} from "lucide-react";
import type { DatabaseSummary } from "../../shared/databases";
import type { ImageAnnotation, Settings } from "../../shared/imago";
import type { CompareItem } from "../../shared/compare";
import { PROVIDERS, type ApiProvider, type ImageCatalogModel } from "../../shared/aiConfig";
import {
  IMAGE_API,
  SUGGESTED_IMAGE_MODELS,
  TASK_HELP,
  TASK_LABELS,
  RESTORATION_TASKS,
  COLOR_STYLES,
  colorPrompt,
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
  type ColorStyle,
  taskLabel,
} from "../../shared/restoration";
import { PRICE_LIMITS, STYLE_LABELS, UPSCALE_SERVICES, estimateCost, formatCost, type ApiUpscaleModel, type UpscaleService } from "../../shared/upscaleApi";
import { useT } from "../i18n";
import { Button, Modal } from "./ui";
import { ImagePicker } from "./CompareView";
import { SectionSideResize, useSectionSideWidth } from "./SectionSide";
import { asLanguage, LANGUAGE_LOCALES } from "../../shared/language";

const TASK_ICONS: Record<Exclude<RestorationTask, "upscale">, React.ReactNode> = {
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
const RUN_LABELS: Record<Exclude<RestorationTask, "upscale">, [string, string]> = {
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

/**
 * What the workshop was showing and the run in progress, kept while the app
 * is open: the request goes on in the main process when the section is left,
 * and coming back shows the same image, the waiting state and then its result.
 */
type Memory = {
  assetId: string | null;
  regionId: string;
  drawn: Region | null;
  baseId: string;
  note: string;
  task: Exclude<RestorationTask, "upscale">;
  colorStyle: ColorStyle;
  currentId: string | null;
  pending: { assetId: string; promise: Promise<Restoration> } | null;
};
const blank = (task: Memory["task"]): Memory => ({ assetId: null, regionId: "", drawn: null, baseId: "", note: "", task, colorStyle: "period", currentId: null, pending: null });
/** Restoration and colourising are two sections, each with its own session. */
const memories: Record<"restore" | "colorize", Memory> = { restore: blank("restore"), colorize: blank("colorize") };
const remember = (mode: "restore" | "colorize", patch: Partial<Memory>) => void Object.assign(memories[mode], patch);
/** Services (fal.ai, Replicate) share the model list with the AI providers. */
const SERVICE_PROVIDERS = ["fal", "replicate"] as const;
type ServiceProvider = (typeof SERVICE_PROVIDERS)[number];
const isService = (p: string): p is ServiceProvider => (SERVICE_PROVIDERS as readonly string[]).includes(p);
/** A model of the list: an AI provider's image model or a service's specialised one. */
function decodeChoice(value: string): { provider: ApiProvider | ServiceProvider; model: string } | null {
  const [provider, ...rest] = value.split("|");
  const model = rest.join("|").trim();
  if (isService(provider) && model) return { provider, model };
  return decodeImageModel(value);
}
const providerLabel = (p: string) => (isService(p) ? UPSCALE_SERVICES[p as UpscaleService].label : PROVIDERS[p as ApiProvider].label);

export function RestorationsView({
  settings,
  databases,
  seed,
  onSeedUsed,
  onSettings,
  onOpenSettings,
  onBack,
  mode = "restore",
}: {
  settings: Settings;
  databases: DatabaseSummary[];
  /** Restoration (restore, repair, sharpen…) or colourising, each a section of its own. */
  mode?: "restore" | "colorize";
  /** An image to open, optionally from one of its versions and with a task (from a record or the workshop). */
  seed: { assetId: string; baseId?: string | null; task?: "restore" | "colorize" } | null;
  onSeedUsed: () => void;
  onSettings: (patch: Partial<Settings>) => Promise<void>;
  onOpenSettings: () => void;
  /** Back to the workshop, when it was opened from there. */
  onBack?: () => void;
}) {
  const t = useT();
  const api = window.imago;
  const memory = memories[mode];
  const colorMode = mode === "colorize";
  const store = colorMode ? "imago.colorize" : "imago.restoration";
  const [sideWidth, resizeSide] = useSectionSideWidth();
  const language = asLanguage(settings.language);
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
  const [task, setTask] = useState<Exclude<RestorationTask, "upscale">>(colorMode ? "colorize" : "restore");
  const [prompt, setPrompt] = useState(() => restorationPrompt("restore", language, false));
  const [edited, setEdited] = useState(false);
  const [model, setModel] = useState<string>(() => localStorage.getItem(`${store}.model`) ?? "");
  const [colorStyle, setColorStyle] = useState<ColorStyle>(memory.colorStyle);
  /** The services' models for this use, when they have a key; null while unknown. */
  const [serviceModels, setServiceModels] = useState<ApiUpscaleModel[] | null>(null);
  const [kind, setKind] = useState<"all" | "specialised" | "instructed">(() => (localStorage.getItem(`${store}.kind`) as never) ?? "all");
  const [priceLimit, setPriceLimit] = useState<number | null>(null);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  /** The image models of the providers with a saved key, from their catalogues; null while unknown. */
  const [catalog, setCatalog] = useState<ImageCatalogModel[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [modelProvider, setModelProvider] = useState<string>(() => localStorage.getItem(`${store}.provider`) ?? "");
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
  const loadCatalog = useCallback(
    (refresh = false) => {
      setCatalogLoading(true);
      void api
        .call("imageModelCatalog", { refresh })
        .then(setCatalog)
        .catch(() => setCatalog([]))
        .finally(() => setCatalogLoading(false));
    },
    [api],
  );
  useEffect(() => loadCatalog(), [loadCatalog]);
  // The services' restorers or colourisers, for the ones with a key.
  const loadServices = useCallback(
    (refresh = false) =>
      void api
        .call("upscaleServicesStatus")
        .then((status) =>
          status.fal || status.replicate
            ? api.call("upscaleApiCatalog", { refresh, task: colorMode ? "colorize" : "restore" }).then((list) => list.filter((m) => m.service !== "stability" && status[m.service]))
            : [],
        )
        .then(setServiceModels)
        .catch(() => setServiceModels([])),
    [api, colorMode],
  );
  useEffect(() => loadServices(), [loadServices]);
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
    void choose(seed.assetId).then(() => {
      if (seed.baseId) setBaseId(seed.baseId);
      if (seed.task) {
        setTask(seed.task);
        setEdited(false);
      }
    });
  }, [seed, onSeedUsed, choose]);
  /** Waits for a run, wherever it was started from, and shows its result. */
  const follow = useCallback(
    (pending: NonNullable<typeof memory.pending>) => {
      setRunning(true);
      setError(null);
      void pending.promise
        .then(async (result) => {
          setVersions(await api.call("restorationsList", { assetId: pending.assetId }));
          setCurrent(result);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          if (memory.pending === pending) remember(mode, { pending: null });
          setRunning(false);
        });
    },
    [api, memory, mode],
  );
  // Coming back to the section: the same image, choices and run in progress.
  useEffect(() => {
    if (seed || !memory.assetId) return;
    const saved = { ...memory };
    void choose(saved.assetId!).then(async () => {
      setRegionId(saved.regionId);
      setDrawn(saved.drawn);
      setBaseId(saved.baseId);
      setNote(saved.note);
      setTask(saved.task);
      setColorStyle(saved.colorStyle);
      const list = await api.call("restorationsList", { assetId: saved.assetId! });
      setCurrent(list.find((v) => v.id === saved.currentId) ?? null);
      if (saved.pending && saved.pending.assetId === saved.assetId) follow(saved.pending);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!source) return;
    remember(mode, { assetId: source.assetId, regionId, drawn, baseId, note, task, colorStyle, currentId: current?.id ?? null });
  });
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
    if (!edited) setPrompt(colorMode ? colorPrompt(colorStyle, language, !!region) : restorationPrompt(task, language, !!region));
  }, [task, language, region, edited, colorMode, colorStyle]);

  // The models: the image models of the AI providers with a saved key (their
  // suggested ones while the catalogues are read), the ones added by hand,
  // the favourites, and the services' models made for this use. Favourites
  // first, then the recommended ones, then by provider and name.
  const services = useMemo(() => new Map((serviceModels ?? []).map((m) => [`${m.service}|${m.id}`, m])), [serviceModels]);
  const { models, names } = useMemo(() => {
    const favorites = settings.favoriteImageModels ?? [];
    const list = new Set<string>([...favorites, ...(settings.imageModels ?? [])]);
    const names = new Map<string, string>();
    if (catalog)
      for (const m of catalog) {
        const value = encodeImageModel(m.provider, m.model);
        list.add(value);
        if (m.name) names.set(value, m.name);
      }
    else
      for (const [provider, suggested] of Object.entries(SUGGESTED_IMAGE_MODELS))
        if (keys[provider]) for (const m of suggested ?? []) list.add(encodeImageModel(provider as ApiProvider, m));
    for (const [value, m] of services) {
      list.add(value);
      names.set(value, m.name);
    }
    // A service model of the other section (a colouriser in restoration) is left out, favourite or not.
    for (const value of [...list]) if (isService(value.split("|")[0]) && !services.has(value)) list.delete(value);
    const label = (value: string) => t(providerLabel(decodeChoice(value)!.provider));
    const models = [...list]
      .filter((v) => decodeChoice(v))
      .sort(
        (a, b) =>
          Number(favorites.includes(b)) - Number(favorites.includes(a)) ||
          Number(!!services.get(b)?.recommended) - Number(!!services.get(a)?.recommended) ||
          label(a).localeCompare(label(b), undefined, { sensitivity: "base" }) ||
          (names.get(a) ?? decodeChoice(a)!.model).localeCompare(names.get(b) ?? decodeChoice(b)!.model, undefined, { sensitivity: "base", numeric: true }),
      );
    return { models, names };
  }, [settings, keys, catalog, services, t]);
  const modelProviders = [...new Set(models.map((v) => decodeChoice(v)!.provider))].sort((a, b) =>
    t(providerLabel(a)).localeCompare(t(providerLabel(b)), undefined, { sensitivity: "base" }),
  );
  /** Cost of one image with a service model (what is sent: at most about 2 megapixels). */
  const costOf = (value: string) => {
    const m = services.get(value);
    if (!m) return null;
    const mp = Math.min(2.1, ((source?.width ?? 1200) * (source?.height ?? 1200)) / 1e6);
    return estimateCost(m.price, mp);
  };
  const instructed = (value: string) => !services.has(value) || !!services.get(value)?.instructed;
  const providerFilter = modelProviders.includes(modelProvider as ApiProvider) ? modelProvider : "";
  const query = modelSearch.trim().toLowerCase();
  const visibleModels = models.filter((value) => {
    const m = decodeChoice(value)!;
    const cost = costOf(value);
    return (
      (!providerFilter || m.provider === providerFilter) &&
      (kind === "all" || (kind === "instructed") === instructed(value)) &&
      (priceLimit === null || (cost !== null && cost <= priceLimit)) &&
      (!query || `${m.model} ${names.get(value) ?? ""} ${t(providerLabel(m.provider))}`.toLowerCase().includes(query))
    );
  });
  const chosen = models.includes(model) ? model : (models[0] ?? "");
  const choice = decodeChoice(chosen);
  /** A specialised service model: it restores or colourises on its own and reads no instructions. */
  const specialised = !!choice && !instructed(chosen);
  const remoteBlocked = !!choice && !settings.remoteEnabled && !["ollama", "lmstudio"].includes(choice.provider) && !(choice.provider === "custom" && /127\.0\.0\.1|localhost/.test(settings.apiProfiles.custom?.baseUrl ?? ""));
  const toggleFavorite = (value: string) => {
    const favorites = settings.favoriteImageModels ?? [];
    void onSettings({
      favoriteImageModels: favorites.includes(value) ? favorites.filter((f) => f !== value) : [...favorites, value],
    });
  };

  const run = async () => {
    if (!source || !choice) return;
    const promise = api.call("restorationRun", {
        assetId: source.assetId,
        region: region ? { x: region.x, y: region.y, w: region.w, h: region.h } : null,
        provider: choice.provider,
        model: choice.model,
        task,
        // A specialised model reads no instructions; the task's own are recorded with the version.
        prompt: prompt.trim() || (colorMode ? colorPrompt("period", language, !!region) : restorationPrompt(task === "custom" ? "restore" : task, language, !!region)),
        context: specialised ? undefined : context,
        baseId: base?.id ?? null,
        keepDetail: task === "colorize" ? keepDetail : undefined,
      });
    const pending = { assetId: source.assetId, promise };
    remember(mode, { pending });
    follow(pending);
  };

  return (
    <div className="restoration-page" data-testid="restorations-view">
      <aside className="restoration-side" style={{ width: sideWidth }}>
        {onBack && (
          <button type="button" className="link-button workshop-back" onClick={onBack} data-testid="back-to-workshop">
            <ChevronLeft size={14} />
            {t("Volver al Taller")}
          </button>
        )}
        <h1>
          {colorMode ? <Palette size={18} /> : <Wand2 size={18} />}
          {t(colorMode ? "Colorización IA" : "Restauración IA")}
        </h1>
        <p className="hint">
          {t(
            colorMode
              ? "Añade colores verosímiles a una foto en blanco y negro con un modelo de imagen. El original no se modifica: cada versión se guarda aparte, marcada como coloreada con IA."
              : "Crea versiones restauradas con un modelo de imagen. El original no se modifica: cada versión se guarda aparte, con el modelo y las instrucciones que la produjeron.",
          )}
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
                    {`${t(taskLabel(v.task))} · ${new Date(v.createdAt).toLocaleString(LANGUAGE_LOCALES[language], { dateStyle: "short", timeStyle: "short" })}`}
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
              <h2>{t(colorMode ? "3. Colores" : "3. Tarea")}</h2>
              {colorMode ? (
                <div className="restoration-tasks" role="radiogroup" aria-label={t("Estilo de color")}>
                  {COLOR_STYLES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={colorStyle === c.id}
                      className={colorStyle === c.id ? "is-selected" : ""}
                      onClick={() => {
                        setColorStyle(c.id);
                        setEdited(c.id === "custom");
                        if (c.id === "custom") setPrompt("");
                      }}
                      data-testid={`color-style-${c.id}`}
                    >
                      <Palette size={16} />
                      <span>
                        <strong>{t(c.label)}</strong>
                        <small>{t(c.help)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
              <div className="restoration-tasks" role="radiogroup" aria-label={t("Tarea")}>
                {RESTORATION_TASKS.filter((key) => key !== "colorize").map((key) => (
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
              )}
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
              {specialised ? (
                <p className="hint restoration-specialised">
                  {t(colorMode ? "El modelo elegido es un colorizador especializado: colorea siempre a su manera y no lee instrucciones ni contexto." : "El modelo elegido es un restaurador especializado: restaura siempre a su manera y no lee instrucciones ni contexto.")}
                </p>
              ) : (
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
              )}
              {edited && !specialised && task !== "custom" && !(colorMode && colorStyle === "custom") && (
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
              {models.length > 0 && (
                <>
                  <div className="restoration-kinds" role="radiogroup" aria-label={t("Tipo de modelo")}>
                    {(
                      [
                        ["all", "Todos", "Todos los modelos de los proveedores y servicios que has configurado."],
                        ["specialised", "Especializados", colorMode ? "Modelos hechos solo para colorear: baratos y previsibles, no leen instrucciones." : "Modelos hechos solo para restaurar: baratos y previsibles, no leen instrucciones."],
                        ["instructed", "Siguen instrucciones", "Modelos generales de imagen que hacen lo que les pides por escrito, con el contexto del registro."],
                      ] as const
                    ).map(([k, label, help]) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kind === k}
                        className={kind === k ? "is-selected" : ""}
                        data-tooltip={t(help)}
                        onClick={() => {
                          setKind(k);
                          localStorage.setItem(`${store}.kind`, k);
                        }}
                      >
                        {t(label)}
                      </button>
                    ))}
                  </div>
                  <div className="restoration-model-tools">
                    <input
                      type="search"
                      aria-label={t("Buscar modelo…")}
                      placeholder={t("Buscar modelo…")}
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      data-testid="restoration-model-search"
                    />
                    <select
                      aria-label={t("Proveedor")}
                      value={providerFilter}
                      onChange={(e) => {
                        setModelProvider(e.target.value);
                        localStorage.setItem(`${store}.provider`, e.target.value);
                      }}
                      data-testid="restoration-model-provider"
                    >
                      <option value="">{t("Todos los proveedores")}</option>
                      {modelProviders.map((p) => (
                        <option key={p} value={p}>
                          {t(providerLabel(p))}
                        </option>
                      ))}
                    </select>
                    {services.size > 0 && (
                      <select aria-label={t("Precio máximo")} value={priceLimit ?? ""} onChange={(e) => setPriceLimit(e.target.value ? Number(e.target.value) : null)} data-testid="restoration-price">
                        <option value="">{t("Cualquier precio")}</option>
                        {PRICE_LIMITS.map((p) => (
                          <option key={p} value={p}>
                            {`${t("Hasta")} ${formatCost(p, language)}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              )}
              {(catalogLoading || serviceModels === null) && <p className="hint">{t("Consultando los catálogos de los proveedores…")}</p>}
              {models.length ? (
                <ul className="restoration-models" role="radiogroup" aria-label={t("Modelo de imagen")}>
                  {!visibleModels.length && (
                    <li className="restoration-models-empty">{t(priceLimit !== null ? "Ningún modelo con precio conocido cuesta tan poco. Sube el límite o quítalo." : "No hay modelos que coincidan.")}</li>
                  )}
                  {visibleModels.map((value) => {
                    const m = decodeChoice(value)!,
                      service = services.get(value),
                      cost = costOf(value),
                      favorite = (settings.favoriteImageModels ?? []).includes(value);
                    return (
                      <li key={value} className={chosen === value ? "is-selected" : ""}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={chosen === value}
                          data-tooltip={service?.recommended ? t(service.recommended) : service?.description}
                          onClick={() => {
                            setModel(value);
                            localStorage.setItem(`${store}.model`, value);
                          }}
                        >
                          <span>
                            <strong title={m.model}>
                              {service ? t(service.name) : m.model}
                              {service?.recommended && <em className="restoration-recommended">{t("Recomendado")}</em>}
                            </strong>
                            <small>
                              {[
                                t(providerLabel(m.provider)),
                                service ? t(service.instructed ? "Sigue instrucciones" : "Especializado") : names.get(value),
                                service && service.style !== "unknown" ? t(STYLE_LABELS[service.style]) : "",
                                service ? (cost === null ? t("precio desconocido") : `~${formatCost(cost, language)}`) : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </small>
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
                <p className="hint">{t("No hay modelos de imagen. Configura la clave de OpenAI, Gemini u OpenRouter en Ajustes, o la de fal.ai o Replicate en Escalado IA, o añade un modelo.")}</p>
              )}
              <div className="row">
                <Button onClick={() => setAdding(true)}>
                  <Plus size={14} />
                  {t("Añadir modelo")}
                </Button>
                <Button onClick={onOpenSettings}>{t("Proveedores")}</Button>
                <Button
                  icon
                  aria-label={t("Actualizar modelos")}
                  data-tooltip={t("Actualizar modelos")}
                  disabled={catalogLoading}
                  onClick={() => {
                    loadCatalog(true);
                    loadServices(true);
                  }}
                >
                  <RefreshCw size={14} />
                </Button>
              </div>
            </section>
            <div className="restoration-run">
              {choice && (
                <p className="restoration-privacy">
                  <ShieldAlert size={14} />
                  {t(context && !specialised ? "La imagen (o el recorte) y el contexto se envían a {p} para procesarla." : "La imagen (o el recorte) se envía a {p} para procesarla.").replace("{p}", t(providerLabel(choice.provider)))}
                </p>
              )}
              {remoteBlocked && <p className="restoration-error">{t("Las APIs remotas están desactivadas en Ajustes.")}</p>}
              {running ? (
                <Button onClick={() => void api.call("restorationCancel")}>
                  <Square size={13} fill="currentColor" />
                  {t("Detener")}
                </Button>
              ) : (
                <Button primary disabled={!choice || (!specialised && !prompt.trim()) || remoteBlocked} onClick={() => void run()} data-testid="restoration-run">
                  <Wand2 size={15} />
                  {t(RUN_LABELS[task][region ? 1 : 0])}
                </Button>
              )}
              {error && <p className="restoration-error">{t(error)}</p>}
            </div>
          </>
        )}
      </aside>
      <SectionSideResize width={sideWidth} onResize={resizeSide} />
      <section className="restoration-main">
        {!source ? (
          <div className="restoration-empty">
            {colorMode ? <Palette size={32} /> : <Wand2 size={32} />}
            <h2>{t(colorMode ? "Colorización IA" : "Restauración IA")}</h2>
            <p>
              {t(
                colorMode
                  ? "Elige una foto en blanco y negro de cualquier base de datos, o ábrela desde el Taller. Puedes colorear la imagen entera o una zona que hayas marcado."
                  : "Elige una imagen de cualquier base de datos, o pulsa «Restaurar con IA» en la ficha de un registro. Puedes restaurar la imagen entera o una zona que hayas marcado.",
              )}
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
                        <strong>{t(taskLabel(v.task))}</strong>
                        <small>
                          {v.model} · {new Date(v.createdAt).toLocaleString(LANGUAGE_LOCALES[language], { dateStyle: "short", timeStyle: "short" })}
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
          equivalences={settings.fieldEquivalences ?? []}
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
          onExport={async (format, watermark, extra) => {
            await onSettings({ watermark });
            await api.call("restorationExport", { id: exporting.id, format, watermark, ...extra });
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
 * The original and the processed version, with a divider to drag; or only
 * the version (what changed). A region can be drawn on the image: boxes are
 * laid over the picture itself, not its letterboxed frame. With `zoomable`,
 * the wheel (or the buttons) zooms into both at once and dragging away from
 * the divider moves the view, so fine detail can be compared.
 */
export function BeforeAfter({
  before,
  beforeLabel,
  after,
  afterLabel = "Restaurada",
  only,
  region,
  running,
  runningLabel = "El modelo está procesando la imagen…",
  drawing,
  drawHint = "Arrastra para marcar la zona que quieres arreglar",
  compareHint = "Arrastra sobre la imagen para mover la línea entre el original y la versión restaurada.",
  beforeRegion = null,
  pixelated = false,
  zoomable = false,
  progress = null,
  onDraw,
}: {
  before: string;
  beforeLabel: string;
  after: string | null;
  afterLabel?: string;
  only: boolean;
  region: Region | null;
  running: boolean;
  runningLabel?: string;
  drawing: boolean;
  drawHint?: string;
  compareHint?: string;
  /** Show only this part of the «before» image, enlarged to fill the frame (a region that was upscaled). */
  beforeRegion?: Region | null;
  /** Enlarge the «before» image without smoothing, so its real pixels can be seen against the result. */
  pixelated?: boolean;
  zoomable?: boolean;
  /** 0-1 while running, when known. */
  progress?: number | null;
  onDraw: (box: Region) => void;
}) {
  const t = useT();
  const [split, setSplit] = useState(0.5);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<null | { mode: "split" } | { mode: "pan"; x: number; y: number; vx: number; vy: number }>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setFrameSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // A new picture or drawing starts from the whole image.
  useEffect(() => setView({ zoom: 1, x: 0, y: 0 }), [before, beforeRegion?.x, beforeRegion?.y, drawing]);
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
  /** Keeps the view inside the picture. */
  const clamp = (v: { zoom: number; x: number; y: number }) => {
    const zoom = Math.min(16, Math.max(1, v.zoom));
    const maxX = 0,
      minX = frameSize.w - frameSize.w * zoom,
      maxY = 0,
      minY = frameSize.h - frameSize.h * zoom;
    return { zoom, x: Math.min(maxX, Math.max(minX, v.x)), y: Math.min(maxY, Math.max(minY, v.y)) };
  };
  const zoomAt = (factor: number, px = frameSize.w / 2, py = frameSize.h / 2) =>
    setView((v) => {
      const zoom = Math.min(16, Math.max(1, v.zoom * factor));
      const k = zoom / v.zoom;
      return clamp({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
    });
  // The wheel zooms (a listener of its own: React's is passive and cannot stop the page scrolling).
  useEffect(() => {
    const el = frame.current;
    if (!el || !zoomable) return;
    const wheel = (e: WheelEvent) => {
      if (drawing) return;
      e.preventDefault();
      const box = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - box.left, e.clientY - box.top);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  const shown = draft
    ? { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) }
    : region;
  const comparing = !!after && !only;
  const transform = view.zoom !== 1 ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0" } : undefined;
  const smooth = view.zoom >= 3 ? "pixelated" : undefined;
  const beforeImage =
    beforeRegion && stage ? (
      // The region of the original, laid exactly over where the enlarged result sits.
      <span className="before-after-crop" style={{ left: stage.left, top: stage.top, width: stage.width, height: stage.height }}>
        <img
          src={before}
          alt={t("Original")}
          draggable={false}
          style={{
            width: `${100 / beforeRegion.w}%`,
            height: `${100 / beforeRegion.h}%`,
            left: `${(-beforeRegion.x / beforeRegion.w) * 100}%`,
            top: `${(-beforeRegion.y / beforeRegion.h) * 100}%`,
            imageRendering: pixelated ? "pixelated" : undefined,
          }}
        />
      </span>
    ) : beforeRegion ? null : (
      <img
        src={before}
        alt={t("Original")}
        draggable={false}
        style={{ imageRendering: pixelated ? "pixelated" : undefined }}
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
    );
  return (
    <div className="before-after-wrap">
      <div
        ref={frame}
        className={`before-after ${comparing ? "has-after" : ""} ${drawing ? "is-drawing" : ""} ${view.zoom > 1 ? "is-zoomed" : ""}`}
        data-testid="before-after"
        onPointerDown={(e) => {
          if (drawing && stage) {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = at(e.clientX, e.clientY);
            setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            return;
          }
          const box = e.currentTarget.getBoundingClientRect();
          const nearLine = Math.abs(e.clientX - box.left - split * box.width) < 28;
          // Zoomed in, dragging away from the divider moves the view.
          if (view.zoom > 1 && (!comparing || !nearLine)) {
            drag.current = { mode: "pan", x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
          if (!comparing) return;
          drag.current = { mode: "split" };
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draft) {
            const p = at(e.clientX, e.clientY);
            setDraft({ ...draft, x1: p.x, y1: p.y });
          } else if (drag.current?.mode === "split") move(e.clientX);
          else if (drag.current?.mode === "pan") {
            const d = drag.current;
            setView((v) => clamp({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
          }
        }}
        onPointerUp={() => {
          drag.current = null;
          if (!draft) return;
          const box = { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) };
          setDraft(null);
          if (box.w >= 0.02 && box.h >= 0.02) onDraw(box);
        }}
        onDoubleClick={(e) => {
          if (!zoomable || drawing) return;
          const box = e.currentTarget.getBoundingClientRect();
          if (view.zoom > 1) setView({ zoom: 1, x: 0, y: 0 });
          else zoomAt(4, e.clientX - box.left, e.clientY - box.top);
        }}
      >
        {!only && (
          <div className="before-after-layer">
            <div className="before-after-content" style={transform}>
              {beforeImage}
            </div>
          </div>
        )}
        {after && (
          <div className="before-after-layer" style={comparing ? { clipPath: `inset(0 0 0 ${split * 100}%)` } : undefined}>
            <div className="before-after-content" style={transform}>
              <img
                className="after"
                src={after}
                alt={t(afterLabel)}
                draggable={false}
                style={{ imageRendering: smooth }}
                onLoad={(e) => (only || beforeRegion) && setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />
            </div>
          </div>
        )}
        {stage && shown && (!after || draft) && view.zoom === 1 && (
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
            <span className="before-after-label right">{t(afterLabel)}</span>
          </>
        )}
        {zoomable && natural && !drawing && (
          <span className="before-after-zoom" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label={t("Alejar")} data-tooltip={t("Alejar")} disabled={view.zoom <= 1} onClick={() => zoomAt(1 / 1.6)}>
              <ZoomOut size={14} />
            </button>
            <button type="button" className="before-after-zoom-value" onClick={() => setView({ zoom: 1, x: 0, y: 0 })} data-tooltip={t("Ver entera")}>
              {view.zoom === 1 ? t("Ajustar") : `${Math.round(view.zoom * 100)} %`}
            </button>
            <button type="button" aria-label={t("Acercar")} data-tooltip={t("Acercar")} disabled={view.zoom >= 16} onClick={() => zoomAt(1.6)}>
              <ZoomIn size={14} />
            </button>
          </span>
        )}
        {drawing && !draft && <span className="before-after-hint">{t(drawHint)}</span>}
        {running && (
          <span className="before-after-running" role="status">
            <span className="chat-typing-indicator">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </span>
            {t(runningLabel)}
            {progress !== null && (
              <span className="before-after-progress" aria-hidden>
                <i style={{ width: `${Math.round(progress * 100)}%` }} />
              </span>
            )}
          </span>
        )}
      </div>
      {comparing && <p className="hint">{t(compareHint)}{zoomable ? " " + t("Usa la rueda o doble clic para ampliar el detalle.") : ""}</p>}
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

export function ExportDialog({
  version,
  watermark,
  title = "Descargar versión restaurada",
  generative = true,
  onClose,
  onExport,
}: {
  version: { id: string };
  title?: string;
  watermark: Watermark;
  /** Made with AI: without a mark, the caption should say so. */
  generative?: boolean;
  onClose: () => void;
  onExport: (format: "png" | "jpeg", watermark: Watermark, extra: { xmp: boolean; history: boolean }) => Promise<void>;
}) {
  const t = useT();
  const [mark, setMark] = useState(watermark);
  const [format, setFormat] = useState<"png" | "jpeg">("jpeg");
  const [xmp, setXmp] = useState(true);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal icon={Download} title={t(title)} onClose={onClose}>
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
        <label className="check-label" data-tooltip={t("Escribe en el propio archivo (XMP) qué se le ha hecho, desde qué original y con qué herramientas: lo leen Lightroom, Bridge, Photoshop y los gestores de archivo.")}>
          <input type="checkbox" checked={xmp} onChange={(e) => setXmp(e.target.checked)} />
          {t("Guardar en el archivo cómo se ha obtenido (metadatos XMP)")}
        </label>
        <label className="check-label" data-tooltip={t("Un archivo .json junto a la imagen con cada paso, sus valores y las huellas SHA-256 del original y del resultado.")}>
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
          {t("Añadir el historial completo en un archivo aparte (JSON)")}
        </label>
        {!mark.enabled && generative && <p className="hint">{t("Sin marca, conviene indicar en el pie o en la cita que la imagen ha sido modificada con IA.")}</p>}
      </div>
      <footer>
        <Button onClick={onClose}>{t("Cancelar")}</Button>
        <Button
          primary
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onExport(format, mark, { xmp, history }).finally(() => setBusy(false));
          }}
        >
          <Download size={14} />
          {t("Descargar")}
        </Button>
      </footer>
    </Modal>
  );
}

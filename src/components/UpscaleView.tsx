// AI upscaling: choose one image (or a region of it) or several, a scale and
// how creative the model may be, and get enlarged versions made on this
// computer with Kandinsky ImageSR 2.0. The run goes through the AI queue; the
// original is never changed and each version is kept apart, marked as made
// with AI, with the model and parameters that produced it.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cloud,
  Cpu,
  KeyRound,
  Monitor,
  Download,
  ImageIcon,
  ImageUpscale,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Square,
  SquareDashed,
  Trash2,
  X,
} from "lucide-react";
import type { DatabaseSummary } from "../../shared/databases";
import type { ImageAnnotation, Job, Settings } from "../../shared/imago";
import type { CompareItem } from "../../shared/compare";
import {
  TASK_LABELS,
  type Restoration,
  type RestorationCheck,
} from "../../shared/restoration";
import {
  CREATIVITY_MAX,
  OUTPUT_LIMITS,
  PROFILE_LABELS,
  estimateSeconds,
  formatDuration,
  planUpscale,
  type UpscaleScale,
  type UpscaleStatus,
} from "../../shared/upscale";
import { useT } from "../i18n";
import { ApiModelPicker, ServiceSetupModal } from "./UpscaleApi";
import { UPSCALE_SERVICES, estimateCost, formatCost, modelKey, type ApiUpscaleModel, type UpscaleService } from "../../shared/upscaleApi";
import { Button, Modal } from "./ui";
import { ImagePicker } from "./CompareView";
import { SectionSideResize, useSectionSideWidth } from "./SectionSide";
import { BeforeAfter, ExportDialog } from "./RestorationsView";
import { asLanguage, LANGUAGE_LOCALES } from "../../shared/language";

type Region = { x: number; y: number; w: number; h: number };
const preview = (id: string, revision?: string) =>
  `imago://asset/${id}/preview${revision ? "?v=" + encodeURIComponent(revision) : ""}`;
const CHECK_TEXT: Record<
  RestorationCheck["level"],
  { label: string; help: string }
> = {
  faithful: {
    label: "Fiel",
    help: "La versión ampliada conserva la forma y la posición de todo lo que se ve en el original.",
  },
  changed: {
    label: "Con detalle añadido",
    help: "El modelo ha reconstruido detalle visible: revisa en «Cambios» las zonas marcadas en rojo antes de usarla.",
  },
  different: {
    label: "Muy reinterpretada",
    help: "El modelo ha cambiado zonas grandes: con creatividad alta puede inventar rasgos o texturas. Revisa «Cambios» o baja la creatividad.",
  },
};
const CREATIVITY_HINT = (level: number) =>
  level === 0
    ? "Mínima: lo más fiel al original que permite el modelo. Recomendado para fuentes."
    : level <= 3
      ? "Baja: algo más de nitidez y textura, con riesgo bajo de inventar detalle."
      : level <= 5
        ? "Media: el modelo reconstruye textura con libertad. Compara con el original."
        : "Alta: el modelo inventa textura y detalle que no están en la fuente. No la uses como documento.";

/**
 * What the section was showing, kept while the app is open: leaving it for
 * another section and coming back finds the same images, settings and the
 * run in progress (the run itself goes on in the queue either way).
 */
const memory: {
  sources: CompareItem[];
  active: number;
  regionId: string;
  drawn: Region | null;
  baseId: string;
  jobId: string | null;
  currentId: string | null;
} = {
  sources: [],
  active: 0,
  regionId: "",
  drawn: null,
  baseId: "",
  jobId: null,
  currentId: null,
};
const remember = (patch: Partial<typeof memory>) =>
  void Object.assign(memory, patch);

export function UpscaleView({
  settings,
  databases,
  jobs,
  seed,
  onSeedUsed,
  onSettings,
  onOpenSettings,
  onOpenProviders,
}: {
  settings: Settings;
  databases: DatabaseSummary[];
  jobs: Job[];
  seed: string | null;
  onSeedUsed: () => void;
  onSettings: (patch: Partial<Settings>) => Promise<void>;
  onOpenSettings: () => void;
  /** Settings › Providers, where remote APIs are allowed and keys kept. */
  onOpenProviders?: () => void;
}) {
  const t = useT();
  const api = window.imago;
  const [sideWidth, resizeSide] = useSectionSideWidth();
  const language = asLanguage(settings.language);
  const prefs = settings.upscale ?? {};
  const [status, setStatus] = useState<UpscaleStatus | null>(null);
  const [sources, setSources] = useState<CompareItem[]>(memory.sources);
  const [active, setActive] = useState(memory.active);
  const [regions, setRegions] = useState<ImageAnnotation[]>([]);
  const [regionId, setRegionId] = useState(memory.regionId);
  const [drawn, setDrawn] = useState<Region | null>(memory.drawn);
  const [drawing, setDrawing] = useState(false);
  const [bases, setBases] = useState<Restoration[]>([]);
  const [baseId, setBaseId] = useState(memory.baseId);
  const [scale, setScale] = useState<UpscaleScale>(prefs.scale ?? 2);
  const [creativity, setCreativity] = useState(prefs.creativity ?? 0);
  const [fit, setFit] = useState(prefs.fit ?? true);
  const [maxOutputSide, setMaxOutputSide] = useState(
    prefs.maxOutputSide ?? 8192,
  );
  const [versions, setVersions] = useState<Restoration[]>([]);
  const [current, setCurrent] = useState<Restoration | null>(null);
  const [check, setCheck] = useState<RestorationCheck | null>(null);
  const [changes, setChanges] = useState(false);
  const [jobId, setJobId] = useState<string | null>(memory.jobId);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState<Restoration | null>(null);
  const [deleting, setDeleting] = useState<Restoration | null>(null);
  const source = sources[active] ?? null;
  const single = sources.length === 1;
  useEffect(() => {
    remember({
      sources,
      active,
      regionId,
      drawn,
      baseId,
      jobId,
      currentId: current?.id ?? memory.currentId,
    });
  });
  // Coming back: the annotations, versions and the version shown are read again.
  useEffect(() => {
    const item = memory.sources[memory.active];
    if (item) {
      void Promise.all([
        api.call("annotationsList", { assetId: item.assetId }).then(setRegions),
        api.call("restorationsList", { assetId: item.assetId }).then(setBases),
        api.call("upscalesList", { assetId: item.assetId }).then((list) => {
          setVersions(list);
          setCurrent(
            list.find((v) => v.id === memory.currentId) ?? list[0] ?? null,
          );
        }),
        // The run in the queue for these images, even if it was queued as the view closed.
        api.call("upscaleActive").then((run) => {
          if (run && run.items.some((i) => memory.sources.some((s) => s.assetId === i.assetId))) setJobId(run.id);
        }),
      ]).catch(() => {});
      return;
    }
    // After a restart (or from elsewhere): a run still in the queue brings its images back.
    void api
      .call("upscaleActive")
      .then(async (run) => {
        if (!run || memory.sources.length) return;
        const items = await api.call("compareItems", {
          assetIds: [...new Set(run.items.map((i) => i.assetId))],
        });
        if (!items.length) return;
        setSources(items);
        setActive(0);
        setJobId(run.id);
        const first = run.items[0];
        if (items.length === 1 && first.region) {
          setDrawn(first.region);
          setRegionId("drawn");
        }
        const [annotations, restored, list] = await Promise.all([
          api.call("annotationsList", { assetId: items[0].assetId }),
          api.call("restorationsList", { assetId: items[0].assetId }),
          api.call("upscalesList", { assetId: items[0].assetId }),
        ]);
        setRegions(annotations);
        setBases(restored);
        setVersions(list);
        setCurrent(list[0] ?? null);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadStatus = useCallback(
    () =>
      void api
        .call("upscaleStatus", {})
        .then(setStatus)
        .catch(() => {}),
    [api],
  );
  useEffect(() => loadStatus(), [loadStatus]);
  // Where to upscale: this computer (Kandinsky) or an online service.
  const [engine, setEngine] = useState<"local" | "api">(prefs.engine ?? "local");
  const [keys, setKeys] = useState<Record<UpscaleService, boolean>>({ fal: false, replicate: false, stability: false });
  const [catalog, setCatalog] = useState<ApiUpscaleModel[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    void api.call("upscaleServicesStatus").then(setKeys).catch(() => {});
  }, [api]);
  const anyKey = Object.values(keys).some(Boolean);
  const keySignature = JSON.stringify(keys);
  useEffect(() => {
    if (engine !== "api" || !anyKey) return;
    setCatalogLoading(true);
    void api
      .call("upscaleApiCatalog", {})
      .then(setCatalog)
      .catch(() => {})
      .finally(() => setCatalogLoading(false));
  }, [api, engine, anyKey, keySignature]);
  const favorites = prefs.favorites ?? [];
  const maxPrice = prefs.maxPrice ?? null;
  const usableModels = catalog.filter((m) => keys[m.service]);
  const apiModel = usableModels.find((m) => modelKey(m) === prefs.apiModel) ?? usableModels.find((m) => m.recommended) ?? usableModels[0] ?? null;
  // The installation advances through the queue: follow it.
  const preparing = status?.preparing
    ? jobs.find((j) => j.id === status.preparing)
    : undefined;
  useEffect(() => {
    if (
      status?.preparing &&
      (!preparing ||
        ["completed", "failed", "cancelled"].includes(preparing.state))
    )
      loadStatus();
  }, [status?.preparing, preparing?.state, preparing, loadStatus]);

  const loadVersions = useCallback(
    async (assetId: string) => {
      const list = await api.call("upscalesList", { assetId });
      setVersions(list);
      return list;
    },
    [api],
  );
  const focus = async (item: CompareItem | null) => {
    setRegionId("");
    setDrawn(null);
    setDrawing(false);
    setBaseId("");
    setCurrent(null);
    setError(null);
    if (!item) return;
    const [annotations, restored] = await Promise.all([
      api.call("annotationsList", { assetId: item.assetId }),
      api.call("restorationsList", { assetId: item.assetId }),
    ]);
    setRegions(annotations);
    setBases(restored);
    const list = await loadVersions(item.assetId);
    setCurrent(list[0] ?? null);
  };
  const choose = async (assetIds: string[]) => {
    const items = await api.call("compareItems", { assetIds });
    setSources(items);
    setActive(0);
    await focus(items[0] ?? null);
  };
  useEffect(() => {
    if (!seed) return;
    onSeedUsed();
    void choose([seed]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, onSeedUsed]);

  // The job this view queued: its progress, and the new versions as they arrive.
  const job = jobId ? jobs.find((j) => j.id === jobId) : undefined;
  const running = !!job && ["queued", "running"].includes(job.state);
  useEffect(() => {
    if (!job || !source) return;
    void loadVersions(source.assetId).then((list) => {
      if (job.done > 0 || job.state === "completed")
        setCurrent((c) =>
          list[0] && (!c || list[0].createdAt > c.createdAt) ? list[0] : c,
        );
    });
    if (job.state === "completed" || job.state === "cancelled")
      void api.call("upscaleStatus", {}).then(setStatus);
    if (job.state === "failed")
      setError(job.message ?? "El escalado ha fallado.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.done, job?.state]);
  const tile = /tesela (\d+)\/(\d+)/.exec(job?.message ?? "");
  const progress =
    job && running
      ? Math.min(
          1,
          (job.done + (tile ? Number(tile[1]) / Number(tile[2]) : 0)) /
            Math.max(1, job.total),
        )
      : null;

  useEffect(() => {
    setCheck(null);
    setChanges(false);
    if (!current) return;
    let live = true;
    void api
      .call("restorationCheck", { id: current.id })
      .then((c) => live && setCheck(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, current]);

  const region: Region | null = !single
    ? null
    : regionId === "drawn"
      ? drawn
      : (regions.find((r) => r.id === regionId) ?? null);
  const base = bases.find((v) => v.id === baseId) ?? null;
  // What the run will do: sizes, tiles, time on this computer.
  const plans = useMemo(
    () =>
      sources.map((s, i) => {
        const [w, h] =
          i === active && base
            ? [base.width, base.height]
            : [s.width ?? 1, s.height ?? 1];
        const r = i === active ? region : null;
        return planUpscale(
          Math.max(1, Math.round(w * (r?.w ?? 1))),
          Math.max(1, Math.round(h * (r?.h ?? 1))),
          scale,
          { maxOutputSide, fit },
        );
      }),
    [sources, active, base, region, scale, maxOutputSide, fit],
  );
  const plan = plans[active];
  /** The active image's plan at another scale (for the scale buttons). */
  const planAt = (s: UpscaleScale) => {
    const item = sources[active];
    if (!item) return null;
    const [w, h] = base ? [base.width, base.height] : [item.width ?? 1, item.height ?? 1];
    return planUpscale(Math.max(1, Math.round(w * (region?.w ?? 1))), Math.max(1, Math.round(h * (region?.h ?? 1))), s, { maxOutputSide, fit });
  };
  const profile = status?.profile ?? "balanced";
  const perTile = status
    ? (status.measured[profile] ?? status.recommendation.secondsPerTile)
    : 40;
  const tiles = plans.reduce((s, p) => s + p.tiles, 0);
  const seconds = estimateSeconds(tiles, perTile, 25);
  const long = engine === "local" && seconds > 20 * 60;
  const outputMP = plan ? (plan.output[0] * plan.output[1]) / 1e6 : 1;
  const apiCosts = apiModel ? plans.map((p) => estimateCost(apiModel.price, (p.output[0] * p.output[1]) / 1e6)) : [];
  const apiTotal = apiCosts.some((c) => c === null) ? null : apiCosts.reduce((a: number, c) => a + (c ?? 0), 0);

  const save = (patch: Partial<NonNullable<Settings["upscale"]>>) =>
    void onSettings({ upscale: { ...settings.upscale, ...patch } });
  const run = async () => {
    if (!sources.length) return;
    setError(null);
    try {
      const id = await api.call("upscaleEnqueue", {
        items: sources.map((s, i) => ({
          assetId: s.assetId,
          region:
            i === active && region
              ? { x: region.x, y: region.y, w: region.w, h: region.h }
              : null,
          baseId: i === active && base ? base.id : null,
        })),
        scale,
        creativity,
        fit,
        maxOutputSide,
        engine: engine === "api" && apiModel ? { kind: "api", service: apiModel.service, model: apiModel.id, name: apiModel.name } : { kind: "local" },
      });
      // Kept outside the view too: leaving the section right after pressing must not lose it.
      remember({ jobId: id });
      setJobId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString(LANGUAGE_LOCALES[language], {
      dateStyle: "short",
      timeStyle: "short",
    });
  const runLabel = !single
    ? t("Escalar {n} imágenes ×{s}")
        .replace("{n}", String(sources.length))
        .replace("{s}", String(scale))
    : t(region ? "Escalar la zona ×{s}" : "Escalar la imagen ×{s}").replace(
        "{s}",
        String(scale),
      );

  const summary = (v: Restoration) => {
    const p = v.params;
    if (!p) return v.prompt;
    // Online: the service and model, and what it cost (estimated).
    if (p.engine === "api")
      return [`${p.name ?? p.model} (${p.service})`, `×${p.scale}`, `${p.input[0]}×${p.input[1]} → ${p.output[0]}×${p.output[1]} px`, p.cost != null ? `~${p.cost.toFixed(3)} $` : "", formatDuration(p.seconds, language)]
        .filter(Boolean)
        .join(" · ");
    return [
      `×${p.scale}`,
      `${t("creatividad")} ${p.creativity}/${CREATIVITY_MAX}`,
      `${t(p.profile ? PROFILE_LABELS[p.profile] : "")} (${p.device.toUpperCase()}, ${p.dtype})`,
      `${p.input[0]}×${p.input[1]} → ${p.output[0]}×${p.output[1]} px`,
      formatDuration(p.seconds, language),
    ].join(" · ");
  };

  return (
    <div className="restoration-page upscale-page" data-testid="upscale-view">
      <aside className="restoration-side" style={{ width: sideWidth }}>
        <h1>
          <ImageUpscale size={18} />
          {t("Escalado IA")}
        </h1>
        <p className="hint">
          {t(
            "Amplía imágenes ×2 o ×4 con Kandinsky ImageSR 2.0, en este equipo. El original no se modifica: cada versión se guarda aparte, marcada como modificada con IA, con el modelo y los parámetros usados.",
          )}
        </p>
        <section>
          <h2>{t("¿Dónde quieres ampliarla?")}</h2>
          <div className="upscale-engines" role="radiogroup" aria-label={t("¿Dónde quieres ampliarla?")}>
            <button
              type="button"
              role="radio"
              aria-checked={engine === "local"}
              className={engine === "local" ? "is-selected" : ""}
              onClick={() => {
                setEngine("local");
                save({ engine: "local" });
              }}
              data-testid="upscale-engine-local"
            >
              <Monitor size={18} />
              <span>
                <strong>{t("En este ordenador")}</strong>
                <small>{t("Gratis y privado: la imagen no sale de tu equipo. Hay que descargar el modelo una vez y en ordenadores normales tarda varios minutos por imagen.")}</small>
                <em className={status?.ready ? "is-ok" : ""}>{t(status?.ready ? "Instalado" : "Sin instalar")}</em>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={engine === "api"}
              className={engine === "api" ? "is-selected" : ""}
              onClick={() => {
                setEngine("api");
                save({ engine: "api" });
              }}
              data-testid="upscale-engine-api"
            >
              <Cloud size={18} />
              <span>
                <strong>{t("Con un servicio de internet")}</strong>
                <small>{t("Rápido (segundos) y funciona en cualquier ordenador. Se paga por imagen, desde menos de un céntimo, y la imagen se envía al servicio.")}</small>
                <em className={anyKey ? "is-ok" : ""}>{t(anyKey ? "Configurado" : "Sin configurar")}</em>
              </span>
            </button>
          </div>
        </section>
        {engine === "api" && !settings.remoteEnabled && (
          <div className="upscale-install">
            <strong>{t("Los servicios de internet están desactivados")}</strong>
            <small>{t("Para usarlos, activa «Permitir APIs remotas» en Ajustes › Proveedores.")}</small>
            <Button onClick={onOpenProviders ?? onOpenSettings}>
              <Settings2 size={14} />
              {t("Abrir Proveedores")}
            </Button>
          </div>
        )}
        {engine === "api" && settings.remoteEnabled && !anyKey && (
          <div className="upscale-install" data-testid="upscale-setup-card">
            <strong>{t("Falta configurar un servicio")}</strong>
            <small>{t("Necesitas una cuenta y una clave del servicio. Te guiamos paso a paso.")}</small>
            <Button primary onClick={() => setSetup(true)} data-testid="upscale-setup-open">
              <Cloud size={14} />
              {t("Configurar un servicio")}
            </Button>
          </div>
        )}
        {engine === "api" && settings.remoteEnabled && anyKey && (
          <section>
            <div className="upscale-section-head">
              <h2>{t("Modelo")}</h2>
              <Button icon aria-label={t("Servicios y claves")} data-tooltip={t("Servicios y claves")} onClick={() => setSetup(true)} data-testid="upscale-setup-open">
                <KeyRound size={14} />
              </Button>
            </div>
            {catalogLoading && !catalog.length ? (
              <p className="hint">{t("Consultando los modelos de los servicios…")}</p>
            ) : (
              <ApiModelPicker
                models={catalog}
                keys={keys}
                chosen={apiModel ? modelKey(apiModel) : ""}
                favorites={favorites}
                maxPrice={maxPrice}
                outputMP={outputMP}
                onChoose={(m) => save({ apiModel: modelKey(m) })}
                onFavorite={(k) => save({ favorites: favorites.includes(k) ? favorites.filter((f) => f !== k) : [...favorites, k] })}
                onMaxPrice={(v) => save({ maxPrice: v })}
              />
            )}
          </section>
        )}
        {setup && <ServiceSetupModal keys={keys} onKeys={setKeys} onClose={() => setSetup(false)} />}
        {engine === "local" && status && !status.ready && (
          <div className="upscale-install" data-testid="upscale-install">
            <strong>
              {t(
                preparing
                  ? "Instalando el modelo de escalado…"
                  : "El modelo de escalado no está instalado",
              )}
            </strong>
            {preparing ? (
              <>
                <span className="upscale-bar">
                  <i
                    style={{
                      width: `${Math.round((preparing.done / Math.max(1, preparing.total)) * 100)}%`,
                    }}
                  />
                </span>
                <small>{preparing.message ?? t("En cola")}</small>
              </>
            ) : (
              <small>
                {t(
                  "Es opcional y se descarga desde Ajustes › Modelos locales ({gb} GB).",
                ).replace("{gb}", (status.diskBytes / 1e9).toFixed(1))}
              </small>
            )}
            <Button
              onClick={onOpenSettings}
              data-testid="upscale-open-settings"
            >
              <Settings2 size={14} />
              {t("Abrir Modelos locales")}
            </Button>
          </div>
        )}
        <section>
          <h2>{t("1. Imágenes")}</h2>
          {single && source && (
            <div className="restoration-source">
              <img
                src={preview(source.assetId, source.revision)}
                alt={source.title}
              />
              <span>
                <strong>{source.title}</strong>
                <small>
                  {[
                    source.date,
                    source.databaseName,
                    source.width && source.height
                      ? `${source.width}×${source.height} px`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
            </div>
          )}
          {sources.length > 1 && (
            <ul className="upscale-batch" aria-label={t("Imágenes elegidas")}>
              {sources.map((s, i) => (
                <li
                  key={s.assetId}
                  className={i === active ? "is-selected" : ""}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActive(i);
                      void focus(s);
                    }}
                  >
                    <img src={preview(s.assetId, s.revision)} alt="" />
                    <span>
                      <strong>{s.title}</strong>
                      <small>{`${plans[i].input[0]}×${plans[i].input[1]} → ${plans[i].output[0]}×${plans[i].output[1]} · ${plans[i].tiles} ${t(plans[i].tiles === 1 ? "tesela" : "teselas")}`}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="upscale-remove"
                    aria-label={t("Quitar")}
                    data-tooltip={t("Quitar")}
                    onClick={() => {
                      const next = sources.filter((_, j) => j !== i);
                      setSources(next);
                      const to = Math.min(active, next.length - 1);
                      setActive(Math.max(0, to));
                      void focus(next[to] ?? null);
                    }}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button onClick={() => setPicking(true)} data-testid="upscale-pick">
            <ImageIcon size={14} />
            {t(sources.length ? "Cambiar imágenes" : "Elegir imágenes")}
          </Button>
          {single && bases.length > 0 && (
            <label className="restoration-field">
              {t("Partir de")}
              <select
                value={baseId}
                onChange={(e) => setBaseId(e.target.value)}
                data-testid="upscale-base"
              >
                <option value="">{t("El original")}</option>
                {bases.map((v) => (
                  <option key={v.id} value={v.id}>
                    {`${t(TASK_LABELS[v.task])} · ${when(v.createdAt)}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
        {sources.length > 0 && (
          <>
            {single && (
              <section>
                <h2>{t("2. Zona")}</h2>
                <div className="restoration-zone">
                  <select
                    aria-label={t("Zona")}
                    value={regionId}
                    onChange={(e) => setRegionId(e.target.value)}
                    data-testid="upscale-zone"
                  >
                    <option value="">{t("Imagen completa")}</option>
                    {drawn && (
                      <option value="drawn">{t("Zona dibujada")}</option>
                    )}
                    {regions.map((r, i) => (
                      <option key={r.id} value={r.id}>
                        {`${t("Anotación")} ${i + 1}${r.note ? ` · ${r.note.slice(0, 40)}` : ""}`}
                      </option>
                    ))}
                  </select>
                  <Button
                    className={drawing ? "is-on" : ""}
                    aria-pressed={drawing}
                    onClick={() => setDrawing(!drawing)}
                    data-testid="upscale-draw"
                  >
                    <SquareDashed size={14} />
                    {t(drawing ? "Arrastra sobre la imagen…" : "Dibujar zona")}
                  </Button>
                </div>
                <p className="hint">
                  {t(
                    region
                      ? "Solo se amplía esa zona, que se guarda como una versión aparte de ese detalle. Es mucho más rápido que la imagen entera."
                      : "Para ampliar un detalle (una inscripción, una cara, un rótulo), dibuja un recuadro: tarda mucho menos.",
                  )}
                </p>
              </section>
            )}
            <section>
              <h2>{t(single ? "3. Escala" : "2. Escala")}</h2>
              {engine === "api" && apiModel && apiModel.scales?.length === 0 && (
                <p className="hint">{t("Este modelo decide el tamaño final; Imago lo ajusta a la escala elegida.")}</p>
              )}
              <div
                className="upscale-scale"
                role="radiogroup"
                aria-label={t("Escala")}
              >
                {([2, 4] as UpscaleScale[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scale === s}
                    className={scale === s ? "is-selected" : ""}
                    onClick={() => setScale(s)}
                    data-testid={`upscale-scale-${s}`}
                  >
                    <strong>×{s}</strong>
                    <small>
                      {(() => {
                      const p = planAt(s);
                      return p ? `${p.output[0]}×${p.output[1]} px` : "";
                    })()}
                    </small>
                  </button>
                ))}
              </div>
            </section>
            {engine === "local" && (
            <section>
              <h2>{t(single ? "4. Creatividad" : "3. Creatividad")}</h2>
              <div className="upscale-creativity">
                <input
                  type="range"
                  min={0}
                  max={CREATIVITY_MAX}
                  step={1}
                  value={creativity}
                  aria-label={t("Creatividad")}
                  onChange={(e) => setCreativity(Number(e.target.value))}
                  data-testid="upscale-creativity"
                />
                <output>{creativity}</output>
              </div>
              <div className="upscale-creativity-ends">
                <span>{t("Fiel")}</span>
                <span>{t("Creativa")}</span>
              </div>
              <p className={`hint ${creativity >= 6 ? "upscale-warn" : ""}`}>
                {t(CREATIVITY_HINT(creativity))}
              </p>
            </section>
            )}
            <details className="upscale-advanced">
              <summary>{t("Opciones avanzadas")}</summary>
              {engine === "local" && (
              <label className="check-label restoration-keep">
                <input
                  type="checkbox"
                  checked={fit}
                  onChange={(e) => {
                    setFit(e.target.checked);
                    save({ fit: e.target.checked });
                  }}
                  data-testid="upscale-fit"
                />
                <span>
                  {t("Ahorrar teselas")}
                  <small>
                    {t(
                      "Si la imagen pasa por poco del tamaño de una tesela, se reduce como mucho un 12 % para procesar menos teselas: mucho más rápido y casi sin diferencia.",
                    )}
                  </small>
                </span>
              </label>
              )}
              <label className="restoration-field">
                {t("Tamaño máximo del resultado")}
                <select
                  value={maxOutputSide}
                  onChange={(e) => {
                    setMaxOutputSide(Number(e.target.value));
                    save({ maxOutputSide: Number(e.target.value) });
                  }}
                >
                  {OUTPUT_LIMITS.map((n) => (
                    <option key={n} value={n}>{`${n} px`}</option>
                  ))}
                </select>
              </label>
              {engine === "local" && (
              <p className="hint">
                <Cpu size={12} /> {t("Perfil de memoria")}:{" "}
                <strong>{t(PROFILE_LABELS[profile])}</strong>
                {status?.choice === "auto"
                  ? ` (${t("automático")})`
                  : ""} ·{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={onOpenSettings}
                >
                  {t("cambiar")}
                </button>
              </p>
              )}
            </details>
            <div className="restoration-run">
              {plan && (
                <div
                  className={`upscale-estimate ${long ? "is-long" : ""}`}
                  data-testid="upscale-estimate"
                >
                  <span>
                    {single
                      ? `${plan.input[0]}×${plan.input[1]} → ${plan.output[0]}×${plan.output[1]} px`
                      : t("{n} imágenes").replace(
                          "{n}",
                          String(sources.length),
                        )}
                  </span>
                  <span>
                    {engine === "api"
                      ? apiModel
                        ? `${apiModel.name} · ${apiTotal === null ? t("precio desconocido") : `~${formatCost(apiTotal)}${sources.length > 1 ? ` ${t("en total")}` : ""}`} · ${t("unos segundos por imagen")}`
                        : t("Elige un modelo")
                      : `${tiles} ${t(tiles === 1 ? "tesela" : "teselas")} · ~${formatDuration(seconds, language)} ${t("en este equipo")}`}
                  </span>
                  {engine === "local" && plan.reason === "tiles" && single && (
                    <small>
                      {t(
                        "Reducida al {p} % para usar {a} teselas en lugar de {b}.",
                      )
                        .replace("{p}", String(Math.round(plan.reduced * 100)))
                        .replace("{a}", String(plan.tiles))
                        .replace("{b}", String(plan.tilesAtFullSize))}
                    </small>
                  )}
                  {plan.reason === "limit" && single && (
                    <small>
                      {t(
                        "Se reduce la entrada para no pasar del tamaño máximo del resultado.",
                      )}
                    </small>
                  )}
                  {long && (
                    <small>
                      {t(
                        "Va a tardar mucho: prueba ×2, una zona o menos imágenes. Puedes seguir trabajando mientras tanto.",
                      )}
                    </small>
                  )}
                </div>
              )}
              {engine === "api" ? (
                <p className="restoration-privacy">
                  <ShieldAlert size={14} />
                  {t("La imagen se envía a {s} para procesarla. Hazlo solo con imágenes que puedas compartir con un tercero.").replace(
                    "{s}",
                    apiModel ? UPSCALE_SERVICES[apiModel.service].label : t("el servicio"),
                  )}
                </p>
              ) : (
                <p className="restoration-privacy">
                  <ShieldCheck size={14} />
                  {t("Se procesa en este equipo: la imagen no sale de él.")}
                </p>
              )}
              {running ? (
                <Button
                  onClick={() =>
                    job &&
                    void api.call("controlJob", {
                      id: job.id,
                      action: "cancel",
                    })
                  }
                  data-testid="upscale-stop"
                >
                  <Square size={13} fill="currentColor" />
                  {t("Detener")}
                </Button>
              ) : (
                <Button
                  primary
                  disabled={engine === "api" ? !apiModel || !settings.remoteEnabled : !status?.ready}
                  onClick={() => void run()}
                  data-testid="upscale-run"
                >
                  <ImageUpscale size={15} />
                  {runLabel}
                </Button>
              )}
              {running && job?.message && (
                <p className="hint upscale-progress-text">{job.message}</p>
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
            <ImageUpscale size={32} />
            <h2>{t("Escalado IA")}</h2>
            <p>
              {t(
                "Elige una o varias imágenes de cualquier base de datos, o pulsa «Escalar con IA» en la ficha de un registro. Puedes ampliar la imagen entera o solo un detalle.",
              )}
            </p>
            <Button primary onClick={() => setPicking(true)}>
              <ImageIcon size={14} />
              {t("Elegir imágenes")}
            </Button>
          </div>
        ) : (
          <>
            {current && (
              <div
                className="restoration-view"
                role="tablist"
                aria-label={t("Vista")}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={!changes}
                  className={!changes ? "is-selected" : ""}
                  onClick={() => setChanges(false)}
                >
                  {t("Comparar")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={changes}
                  className={changes ? "is-selected" : ""}
                  onClick={() => setChanges(true)}
                  data-testid="upscale-changes"
                >
                  {t("Cambios")}
                </button>
                {check && (
                  <span
                    className={`restoration-check ${check.level}`}
                    data-testid="upscale-check"
                    data-tooltip={t(CHECK_TEXT[check.level].help)}
                  >
                    {check.level === "faithful" ? (
                      <ShieldCheck size={14} />
                    ) : (
                      <ShieldAlert size={14} />
                    )}
                    <strong>{t(CHECK_TEXT[check.level].label)}</strong>
                    <span>{`${Math.round(check.similarity * 100)} %`}</span>
                  </span>
                )}
              </div>
            )}
            <BeforeAfter
              before={
                current?.baseId && bases.some((v) => v.id === current.baseId)
                  ? `imago://restoration/${current.baseId}`
                  : !current && base
                    ? `imago://restoration/${base.id}`
                    : preview(source.assetId, source.revision)
              }
              beforeLabel={t("Original")}
              after={
                current
                  ? `imago://restoration/${current.id}${changes ? "/changes" : ""}`
                  : null
              }
              afterLabel={
                current?.params
                  ? `Escalada ×${current.params.scale}`
                  : "Escalada"
              }
              only={changes}
              region={current ? null : region}
              beforeRegion={current?.region ?? null}
              running={running}
              runningLabel={
                job?.message && running
                  ? job.message
                  : "Escalando en este equipo…"
              }
              progress={progress}
              drawing={drawing}
              drawHint="Arrastra para marcar el detalle que quieres ampliar"
              compareHint="Arrastra la línea para comparar el original con la versión ampliada."
              zoomable
              onDraw={(box) => {
                setDrawn(box);
                setRegionId("drawn");
                setDrawing(false);
                setCurrent(null);
              }}
            />
            {current && (
              <div
                className={`restoration-verdict ${check?.level ?? "faithful"}`}
              >
                <p>
                  {check ? t(CHECK_TEXT[check.level].help) : ""}{" "}
                  {changes &&
                    t(
                      "En rojo, lo que ha cambiado de forma o de detalle respecto al original, a la misma escala; el aumento de nitidez se marca poco.",
                    )}
                </p>
                <p className="upscale-params" data-testid="upscale-params">
                  <strong>Kandinsky ImageSR 2.0</strong> · {summary(current)}
                  {current.region ? ` · ${t("zona")}` : ""}
                </p>
              </div>
            )}
            <div className="restoration-versions">
              <h2>
                {t("Versiones ampliadas de esta imagen")}{" "}
                <span>{versions.length}</span>
              </h2>
              {!versions.length && (
                <p className="hint">
                  {t("Todavía no hay versiones ampliadas de esta imagen.")}
                </p>
              )}
              <ul>
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className={current?.id === v.id ? "is-selected" : ""}
                  >
                    <button
                      type="button"
                      onClick={() => setCurrent(v)}
                      data-testid="upscale-version"
                    >
                      <img src={`imago://restoration/${v.id}`} alt="" />
                      <span>
                        <strong>
                          {v.params
                            ? `×${v.params.scale} · ${t("creatividad")} ${v.params.creativity}`
                            : t("Escalado IA")}
                          {v.region ? ` · ${t("zona")}` : ""}
                        </strong>
                        <small>{`${v.width}×${v.height} px · ${when(v.createdAt)}`}</small>
                        {v.baseId && <small>{t("sobre otra versión")}</small>}
                      </span>
                    </button>
                    <span className="restoration-version-actions">
                      <button
                        type="button"
                        aria-label={t("Descargar")}
                        data-tooltip={t("Descargar")}
                        onClick={() => setExporting(v)}
                      >
                        <Download size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={t("Eliminar")}
                        data-tooltip={t("Eliminar")}
                        onClick={() => setDeleting(v)}
                      >
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
          room={100}
          equivalences={settings.fieldEquivalences ?? []}
          title={t("Elegir las imágenes que quieres ampliar")}
          action={t("Elegir")}
          onClose={() => setPicking(false)}
          onAdd={(ids) => {
            setPicking(false);
            void choose(ids);
          }}
        />
      )}
      {exporting && (
        <ExportDialog
          version={exporting}
          title={t("Descargar versión ampliada")}
          watermark={
            settings.watermark ?? {
              enabled: true,
              text: t("Editada con IA"),
              position: "bottom-right",
            }
          }
          onClose={() => setExporting(null)}
          onExport={async (format, watermark) => {
            await onSettings({ watermark });
            await api.call("restorationExport", {
              id: exporting.id,
              format,
              watermark,
            });
            setExporting(null);
          }}
        />
      )}
      {deleting && (
        <Modal
          icon={Trash2}
          title={t("Eliminar versión")}
          onClose={() => setDeleting(null)}
        >
          <div className="modal-body">
            <p>
              {t(
                "Se eliminará esta versión ampliada. La imagen original no cambia.",
              )}
            </p>
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
                  const list = await loadVersions(v.assetId);
                  if (current?.id === v.id) setCurrent(list[0] ?? null);
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

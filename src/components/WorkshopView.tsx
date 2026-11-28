// The image workshop: one place to treat a source image (or a version of it)
// with conventional tools, ready-made recipes and the AI engines, and to save
// the result as a new version of the same record. Nothing is written until
// «Save version»; the original is never changed.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Contrast,
  Download,
  FileText,
  History,
  ImageIcon,
  ImageUpscale,
  Layers,
  Moon,
  Palette,
  Redo2,
  RotateCcw,
  Save,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  SunDim,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import type { DatabaseSummary } from "../../shared/databases";
import type { Settings } from "../../shared/imago";
import type { CompareItem } from "../../shared/compare";
import {
  GROUP_LABELS,
  RECIPES,
  autoPlan,
  type AutoStep,
  TOOLS,
  defaultOp,
  opLabel,
  recipeOps,
  versionLabel,
  type ImageVersion,
  type RecipeId,
  type ToolGroup,
  type WorkshopAnalysis,
  type WorkshopOp,
  type WorkshopTool,
} from "../../shared/workshop";
import { formatNumber, useT } from "../i18n";
import { Button, Modal } from "./ui";
import { ImagePicker } from "./CompareView";
import { SectionSideResize, useSectionSideWidth } from "./SectionSide";
import { BeforeAfter, ExportDialog } from "./RestorationsView";
import { StraightenEditor, ToolControls } from "./WorkshopTools";
import { asLanguage, LANGUAGE_LOCALES } from "../../shared/language";
import { REDO_KEYS, UNDO_KEYS, useUndoKeys } from "../undoKeys";
import { tExport, tLabel } from "../workshopLabels";

type AiKind = "restore" | "colorize" | "upscale";
const RECIPE_ICONS: Record<RecipeId, React.ReactNode> = {
  book: <BookOpen size={15} />,
  faded: <SunDim size={15} />,
  inscription: <FileText size={15} />,
  dark: <Moon size={15} />,
  negative: <Contrast size={15} />,
  page: <Layers size={15} />,
};
const preview = (id: string, revision?: string) => `imago://asset/${id}/preview${revision ? "?v=" + encodeURIComponent(revision) : ""}`;

/** The session, kept while the app is open: leaving the section and coming back finds it as it was. */
const memory: {
  source: CompareItem | null;
  versionId: string | null;
  ops: WorkshopOp[];
  past: WorkshopOp[][];
  future: WorkshopOp[][];
} = { source: null, versionId: null, ops: [], past: [], future: [] };
const remember = (patch: Partial<typeof memory>) => void Object.assign(memory, patch);
const session = `w${Math.random().toString(36).slice(2, 10)}`;

export function WorkshopView({
  settings,
  databases,
  seed,
  onSeedUsed,
  onSettings,
  onOpenAi,
}: {
  settings: Settings;
  databases: DatabaseSummary[];
  /** Open this image (and version) when the section is shown from a record or the viewer. */
  seed: { assetId: string; versionId?: string | null } | null;
  onSeedUsed: () => void;
  onSettings: (patch: Partial<Settings>) => Promise<void>;
  onOpenAi: (kind: AiKind, assetId: string, versionId: string | null) => void;
}) {
  const t = useT();
  const api = window.imago;
  const language = asLanguage(settings.language);
  const [sideWidth, resizeSide] = useSectionSideWidth();
  const [source, setSource] = useState<CompareItem | null>(memory.source);
  const [versionId, setVersionId] = useState<string | null>(memory.versionId);
  const [versions, setVersions] = useState<ImageVersion[]>([]);
  const [ops, setOps] = useState<WorkshopOp[]>(memory.ops);
  const [past, setPast] = useState<WorkshopOp[][]>(memory.past);
  const [future, setFuture] = useState<WorkshopOp[][]>(memory.future);
  /** The tool being adjusted: a new step (index null) or an existing one. */
  const [draft, setDraft] = useState<{ index: number | null; op: WorkshopOp } | null>(null);
  const [result, setResult] = useState<{ url: string; histogram: number[]; width: number; height: number } | null>(null);
  const [inputView, setInputView] = useState<{ url: string; histogram: number[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A word for the researcher that is not an error (nothing to fix, a value guessed). */
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"compare" | "side" | "result">("compare");
  const [open, setOpen] = useState<ToolGroup | "recipes" | "ai" | null>("recipes");
  const [analysis, setAnalysis] = useState<WorkshopAnalysis | null | "loading">(null);
  /** The automatic mode's proposal, until accepted or discarded. */
  const [auto, setAuto] = useState<AutoStep[] | null>(null);
  const [integrity, setIntegrity] = useState<boolean | null>(null);
  const [picking, setPicking] = useState(false);
  const [choosingVersion, setChoosingVersion] = useState(false);
  const [guard, setGuard] = useState<{ then: () => void } | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<ImageVersion | null>(null);
  const [deleting, setDeleting] = useState<ImageVersion | null>(null);
  const seq = useRef(0);
  useEffect(() => remember({ source, versionId, ops, past, future }));

  const version = versions.find((v) => v.id === versionId) ?? null;
  const baseUrl = source ? (version ? `imago://restoration/${version.id}` : preview(source.assetId, source.revision)) : null;
  const pending = ops.length > 0;
  /** A saved version with nothing pending: compared at full size with what it was made from. */
  const reviewing = !!source && !!version && !pending && !draft && !auto;
  const parent = version?.parentId ? (versions.find((v) => v.id === version.parentId) ?? null) : null;
  const parentUrl = source && version ? (parent ? `imago://restoration/${parent.id}` : `imago://asset/${source.assetId}/full${source.revision ? "?v=" + encodeURIComponent(source.revision) : ""}`) : null;
  /** The operations shown: the session's, with the tool being adjusted in its place. */
  const shown = useMemo(() => {
    if (auto) return [...ops, ...auto.filter((x) => x.on).flatMap((x) => x.ops)];
    if (!draft) return ops;
    if (draft.index === null) return [...ops, draft.op];
    return ops.map((o, i) => (i === draft.index ? draft.op : o));
  }, [ops, draft, auto]);
  /** Before the tool being adjusted: what its handles and histogram are drawn on. */
  const before = useMemo(() => (draft ? ops.slice(0, draft.index ?? ops.length) : null), [ops, draft]);
  const geometryEditing = draft && (draft.op.tool === "straighten" || draft.op.tool === "crop");

  const loadVersions = useCallback(async (assetId: string) => setVersions(await api.call("workshopVersions", { assetId })), [api]);
  useEffect(() => {
    if (!source) return;
    void loadVersions(source.assetId);
    setIntegrity(null);
    void api.call("workshopIntegrity", { assetId: source.assetId }).then((r) => setIntegrity(r.ok)).catch(() => setIntegrity(null));
  }, [api, source, loadVersions]);

  // The preview follows the operations (a moment after the last change).
  useEffect(() => {
    if (!source) return;
    const id = ++seq.current;
    setError(null);
    if (!shown.length) {
      setResult(null);
      setBusy(false);
      return;
    }
    const timer = setTimeout(() => {
      setBusy(true);
      const slowTimer = setTimeout(() => id === seq.current && setSlow(true), 1200);
      void api
        .call("workshopPreview", { session, assetId: source.assetId, versionId, ops: geometryEditing ? (before ?? []) : shown })
        .then((r) => {
          if (id !== seq.current) return;
          if (geometryEditing) setInputView({ url: `imago://workshop/${r.name}`, histogram: r.histogram });
          else setResult({ url: `imago://workshop/${r.name}`, histogram: r.histogram, width: r.width, height: r.height });
        })
        .catch((e) => id === seq.current && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          clearTimeout(slowTimer);
          if (id === seq.current) setBusy(false), setSlow(false);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [api, source, versionId, shown, geometryEditing, before]);
  // The histogram of what a levels or curve step receives.
  useEffect(() => {
    if (!source || !draft || !["levels", "curve"].includes(draft.op.tool)) return;
    let live = true;
    void api
      .call("workshopPreview", { session: session + "i", assetId: source.assetId, versionId, ops: before ?? [], maxSide: 900 })
      .then((r) => live && setInputView({ url: `imago://workshop/${r.name}`, histogram: r.histogram }))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, source, versionId, draft?.op.tool, draft?.index, before]);

  const commit = (next: WorkshopOp[]) => {
    setPast((p) => [...p.slice(-40), ops]);
    setFuture([]);
    setOps(next);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [ops, ...f]);
    setOps(past[past.length - 1]);
    setPast(past.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, ops]);
    setOps(future[0]);
    setFuture(future.slice(1));
  };
  useUndoKeys({ undo, redo, enabled: !!source && !draft && !auto });
  const runAuto = async () => {
    const a = await analyze();
    if (!a) return;
    const plan = autoPlan(a);
    setNotice(plan.length ? null : "No se aprecian problemas evidentes en esta imagen: los tonos, la nitidez y la inclinación parecen correctos.");
    if (plan.length) setAuto(plan);
  };
  const acceptAuto = () => {
    if (!auto) return;
    const chosen = auto.filter((x) => x.on).flatMap((x) => x.ops);
    if (chosen.length) commit([...ops, ...chosen]);
    setAuto(null);
  };
  const reason = (x: AutoStep) => Object.entries(x.values ?? {}).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, typeof v === "number" ? formatNumber(v, 1) : v), t(x.reason));
  const applyDraft = () => {
    if (!draft) return;
    commit(draft.index === null ? [...ops, draft.op] : ops.map((o, i) => (i === draft.index ? draft.op : o)));
    setDraft(null);
    setInputView(null);
  };
  const startTool = (tool: WorkshopTool) => {
    setDraft({ index: null, op: defaultOp(tool) });
    setInputView(null);
  };
  const analyze = useCallback(async () => {
    if (!source) return null;
    setAnalysis("loading");
    try {
      const a = await api.call("workshopAnalyze", { assetId: source.assetId, versionId });
      setAnalysis(a);
      return a;
    } catch (e) {
      setAnalysis(null);
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [api, source, versionId]);
  const runRecipe = async (id: RecipeId) => {
    const a = analysis && analysis !== "loading" ? analysis : await analyze();
    if (!a) return;
    const steps = recipeOps(id, a);
    if (id === "page") {
      setDraft({ index: null, op: steps[0] });
      return;
    }
    commit([...ops, ...steps]);
    setNotice(id === "book" && !a.screen ? "No se aprecia una trama regular en esta imagen: se ha aplicado un tamaño típico (4 px). Ajústalo en «Quitar trama de impresión» del historial." : null);
  };

  /** Asks before losing unsaved work; then does what was asked. */
  const guarded = (then: () => void) => (pending || draft || auto ? setGuard({ then }) : then());
  const reset = () => {
    setOps([]);
    setPast([]);
    setFuture([]);
    setDraft(null);
    setAuto(null);
    setNotice(null);
    setResult(null);
    setInputView(null);
    setAnalysis(null);
  };
  const choose = async (assetId: string, version: string | null = null) => {
    const [item] = await api.call("compareItems", { assetIds: [assetId] });
    setSource(item ?? null);
    setVersionId(version);
    reset();
    if (item) {
      const list = await api.call("workshopVersions", { assetId });
      setVersions(list);
      // With derived versions, the researcher chooses where to start (never the newest by default).
      if (list.length && version === null) setChoosingVersion(true);
    }
  };
  useEffect(() => {
    if (!seed) return;
    onSeedUsed();
    guarded(() => void choose(seed.assetId, seed.versionId ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const save = async () => {
    if (!source || !ops.length) return;
    setSaving(true);
    setError(null);
    try {
      const v = await api.call("workshopSave", { assetId: source.assetId, versionId, ops });
      await loadVersions(source.assetId);
      // Work goes on from the version just saved.
      setVersionId(v.id);
      setOps([]);
      setPast([]);
      setFuture([]);
      setResult(null);
      return v;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const when = (iso: string) => new Date(iso).toLocaleString(LANGUAGE_LOCALES[language], { dateStyle: "short", timeStyle: "short" });
  const groups = (Object.keys(GROUP_LABELS) as ToolGroup[]).map((g) => ({ group: g, tools: TOOLS.filter((x) => x.tool !== "grayscale" || g === "inspect").filter((x) => x.group === g) }));
  const toolInfo = (tool: WorkshopTool) => TOOLS.find((x) => x.tool === tool)!;
  const label = versionLabel([...(version?.ops ?? []), ...ops]);

  const section = (id: ToolGroup | "recipes" | "ai", title: string, icon: React.ReactNode, body: React.ReactNode) => (
    <div key={id} className={`workshop-group ${open === id ? "is-open" : ""}`}>
      <button type="button" className="workshop-group-head" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
        {icon}
        <span>{t(title)}</span>
        {open === id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open === id && <div className="workshop-group-body">{body}</div>}
    </div>
  );

  return (
    <div className="restoration-page workshop-page" data-testid="workshop-view">
      <aside className="restoration-side workshop-side" style={{ width: sideWidth }}>
        <h1>
          <SlidersHorizontal size={18} />
          {t("Taller de imágenes")}
        </h1>
        {!source && (
          <p className="hint">
            {t("Trata una imagen con herramientas convencionales, recetas para problemas típicos de las fotos antiguas o inteligencia artificial, y guarda el resultado como una versión del mismo registro. El original nunca cambia.")}
          </p>
        )}
        {source && (
          <div className="workshop-source">
            <img src={baseUrl ?? ""} alt="" />
            <span>
              <strong>{source.title}</strong>
              <small>{[source.databaseName, version ? `${t("Parte de")}: ${tLabel(t, version.label)}` : t("Parte del original")].filter(Boolean).join(" · ")}</small>
            </span>
          </div>
        )}
        <div className="row workshop-source-actions">
          <Button onClick={() => guarded(() => setPicking(true))} data-testid="workshop-pick">
            <ImageIcon size={14} />
            {t(source ? "Cambiar imagen" : "Elegir imagen")}
          </Button>
          {source && versions.length > 0 && (
            <Button onClick={() => guarded(() => setChoosingVersion(true))} data-testid="workshop-version">
              <History size={14} />
              {t("Cambiar versión")}
            </Button>
          )}
        </div>

        {source && !draft && !auto && (
          <button type="button" className="workshop-auto" onClick={() => void runAuto()} disabled={analysis === "loading"} data-testid="workshop-auto">
            <Sparkles size={18} />
            <span>
              <strong>{t(analysis === "loading" ? "Analizando la imagen…" : "Mejora automática")}</strong>
              <small>{t("Detecta qué le pasa a la imagen y propone cómo arreglarlo. Tú decides qué aceptar.")}</small>
            </span>
          </button>
        )}
        {source && auto && (
          <div className="workshop-editor workshop-auto-plan" data-testid="workshop-auto-plan">
            <h2>
              <Sparkles size={15} />
              {t("Mejora automática")}
            </h2>
            <p className="hint">{t("Esto es lo que se ha detectado. La vista previa muestra los arreglos marcados; desmarca los que no quieras.")}</p>
            <ul>
              {auto.map((x, i) => (
                <li key={x.id}>
                  <label className="check-label">
                    <input type="checkbox" checked={x.on} onChange={(e) => setAuto(auto.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} />
                    <span>
                      <strong>{t(x.label)}</strong>
                      <small>{reason(x)}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="row workshop-editor-actions">
              <Button onClick={() => setAuto(null)}>{t("Descartar")}</Button>
              <Button primary onClick={acceptAuto} disabled={!auto.some((x) => x.on)} data-testid="workshop-auto-accept">
                {t("Aceptar")}
              </Button>
            </div>
            <p className="hint">{t("Después podrás cambiar o quitar cada paso en el historial, o deshacerlo todo.")}</p>
          </div>
        )}
        {source && !draft && !auto && (
          <div className="workshop-groups">
            {section(
              "recipes",
              "Recetas",
              <Sparkles size={15} />,
              <div className="workshop-recipes">
                {RECIPES.map((r) => (
                  <button key={r.id} type="button" onClick={() => void runRecipe(r.id)} data-testid={`workshop-recipe-${r.id}`}>
                    {RECIPE_ICONS[r.id]}
                    <span>
                      <strong>{t(r.label)}</strong>
                      <small>{t(r.help)}</small>
                    </span>
                  </button>
                ))}
              </div>,
            )}
            {groups.map(({ group, tools }) =>
              section(
                group,
                GROUP_LABELS[group],
                <SlidersHorizontal size={15} />,
                <ul className="workshop-tools">
                  {tools.map((x) => (
                    <li key={x.tool}>
                      <button type="button" onClick={() => startTool(x.tool)} data-testid={`workshop-tool-${x.tool}`}>
                        <strong>{t(x.label)}</strong>
                        <small>{t(x.help)}</small>
                      </button>
                    </li>
                  ))}
                </ul>,
              ),
            )}
            {section(
              "ai",
              "Inteligencia artificial",
              <Wand2 size={15} />,
              <ul className="workshop-tools">
                {(
                  [
                    ["restore", "Restauración IA", "Quita polvo, arañazos y manchas; repara roturas.", <Wand2 key="r" size={14} />],
                    ["colorize", "Colorización IA", "Añade colores verosímiles a una foto en blanco y negro.", <Palette key="c" size={14} />],
                    ["upscale", "Escalado IA", "Amplía ×2 o ×4 en este ordenador o con un servicio.", <ImageUpscale key="u" size={14} />],
                  ] as const
                ).map(([kind, title, help]) => (
                  <li key={kind}>
                    <button
                      type="button"
                      data-testid={`workshop-ai-${kind}`}
                      onClick={() => {
                        const go = (v: string | null) => onOpenAi(kind, source.assetId, v);
                        // The AI works on a saved image: pending steps are saved first.
                        if (pending) void save().then((v) => v && go(v.id));
                        else go(versionId);
                      }}
                    >
                      <strong>{t(title)}</strong>
                      <small>{t(help)}</small>
                    </button>
                  </li>
                ))}
                {pending && <li className="hint">{t("Los pasos pendientes se guardarán antes como versión: la IA trabaja sobre ella.")}</li>}
              </ul>,
            )}
          </div>
        )}

        {source && draft && (
          <div className="workshop-editor" data-testid="workshop-editor">
            <h2>
              {t(toolInfo(draft.op.tool).label)}
              <button type="button" className="link-button" onClick={() => (setDraft(null), setInputView(null))} aria-label={t("Cancelar")}>
                <X size={14} />
              </button>
            </h2>
            <p className="hint">{t(toolInfo(draft.op.tool).help)}</p>
            <ToolControls op={draft.op} onChange={(op) => setDraft({ ...draft, op })} histogram={inputView?.histogram ?? result?.histogram ?? null} analysis={analysis} onAnalyze={() => void analyze().then((a) => a?.screen && draft.op.tool === "descreen" && setDraft({ ...draft, op: { ...draft.op, period: a.screen.period } }))} />
            <div className="row workshop-editor-actions">
              <Button onClick={() => (setDraft(null), setInputView(null))}>{t("Cancelar")}</Button>
              <Button primary onClick={applyDraft} data-testid="workshop-apply">
                {t(draft.index === null ? "Aplicar" : "Actualizar paso")}
              </Button>
            </div>
          </div>
        )}

        {source && (
          <div className="workshop-save">
            {error && <p className="restoration-error">{t(error)}</p>}
            {notice && (
              <p className="workshop-notice" role="status">
                {t(notice)}
                <button type="button" className="link-button" aria-label={t("Cerrar")} onClick={() => setNotice(null)}>
                  <X size={13} />
                </button>
              </p>
            )}
            <Button primary disabled={!pending || saving || !!draft || !!auto} onClick={() => void save()} data-testid="workshop-save">
              <Save size={15} />
              {t(saving ? "Guardando…" : "Guardar versión")}
            </Button>
            <small className="hint">
              {pending ? t("Cambios sin guardar: se guardarán como una versión nueva de esta imagen.") : t("Sin cambios pendientes.")}
            </small>
          </div>
        )}
      </aside>
      <SectionSideResize width={sideWidth} onResize={resizeSide} />
      <section className="restoration-main workshop-main">
        {!source ? (
          <div className="restoration-empty">
            <SlidersHorizontal size={32} />
            <h2>{t("Taller de imágenes")}</h2>
            <p>{t("Elige una imagen de cualquier base de datos, o pulsa «Abrir en el Taller» en la ficha de un registro.")}</p>
            <Button primary onClick={() => setPicking(true)}>
              <ImageIcon size={14} />
              {t("Elegir imagen")}
            </Button>
          </div>
        ) : (
          <>
            <div className="workshop-bar">
              <strong className="workshop-title">
                {source.title} <span>{tLabel(t, label)}</span>
              </strong>
              <div className="restoration-view" role="tablist" aria-label={t("Vista")}>
                {(
                  [
                    ["compare", "Antes / después"],
                    ["side", "Lado a lado"],
                    ["result", "Resultado"],
                  ] as const
                ).map(([m, l]) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "is-selected" : ""} onClick={() => setMode(m)}>
                    {t(l)}
                  </button>
                ))}
              </div>
              {integrity !== null && (
                <span className={`restoration-check ${integrity ? "faithful" : "different"}`} data-tooltip={t(integrity ? "El archivo original es idéntico al importado (SHA-256 comprobado)." : "No se ha podido comprobar el archivo original: puede haberse movido o modificado fuera de Imago.")}>
                  {integrity ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                  <strong>{t(integrity ? "Original preservado" : "Original no verificado")}</strong>
                </span>
              )}
            </div>

            {geometryEditing && draft?.op.tool === "straighten" ? (
              inputView || baseUrl ? (
                <StraightenEditor image={inputView?.url ?? baseUrl!} op={draft.op} onChange={(op) => setDraft({ ...draft, op })} />
              ) : null
            ) : geometryEditing && draft?.op.tool === "crop" ? (
              <BeforeAfter
                before={inputView?.url ?? baseUrl!}
                beforeLabel={t("Original")}
                after={null}
                only={false}
                region={{ x: draft.op.x, y: draft.op.y, w: draft.op.w, h: draft.op.h }}
                running={busy}
                drawing
                drawHint="Arrastra el recuadro que quieres conservar"
                onDraw={(box) => setDraft({ ...draft, op: { tool: "crop", ...box } })}
              />
            ) : mode === "side" && (result || reviewing) ? (
              <div className="workshop-side-by-side">
                <figure>
                  <img src={reviewing ? parentUrl! : baseUrl!} alt="" />
                  <figcaption>{reviewing ? (parent ? tLabel(t, parent.label) : t("Original")) : version ? tLabel(t, version.label) : t("Original")}</figcaption>
                </figure>
                <figure>
                  <img src={reviewing ? baseUrl! : result!.url} alt="" />
                  <figcaption>{reviewing ? tLabel(t, version!.label) : t("Resultado")}</figcaption>
                </figure>
              </div>
            ) : (
              <BeforeAfter
                before={reviewing ? parentUrl! : baseUrl!}
                beforeLabel={reviewing ? (parent ? tLabel(t, parent.label) : t("Original")) : t(version ? "Partida" : "Original")}
                after={reviewing ? baseUrl : (result?.url ?? null)}
                afterLabel={reviewing ? tLabel(t, version!.label) : "Resultado"}
                only={mode === "result" && (!!result || reviewing)}
                region={null}
                running={busy && slow}
                runningLabel="Procesando a tamaño completo…"
                drawing={false}
                compareHint="Arrastra la línea para comparar la imagen de partida con el resultado."
                zoomable
                onDraw={() => {}}
              />
            )}

            <div className="workshop-history" data-testid="workshop-history">
              <div className="workshop-history-chips">
                <span className="workshop-chip is-base">{version ? tLabel(t, version.label) : t("Original")}</span>
                {ops.map((op, i) => (
                  <span key={i} className={`workshop-chip ${draft?.index === i ? "is-editing" : ""}`}>
                    <button type="button" onClick={() => setDraft({ index: i, op })} data-tooltip={t("Cambiar este paso")}>
                      {t(opLabel(op))}
                    </button>
                    <button type="button" aria-label={t("Quitar este paso")} data-tooltip={t("Quitar este paso")} onClick={() => commit(ops.filter((_, j) => j !== i))}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {draft?.index === null && <span className="workshop-chip is-editing">{t(opLabel(draft.op))}…</span>}
                {auto?.filter((x) => x.on).map((x) => (
                  <span key={x.id} className="workshop-chip is-editing">
                    {t(x.label)}…
                  </span>
                ))}
              </div>
              <div className="row">
                <Button icon aria-label={t("Deshacer")} aria-keyshortcuts="Meta+Z Control+Z" data-tooltip={`${t("Deshacer")} (${UNDO_KEYS})`} disabled={!past.length || !!draft || !!auto} onClick={undo}>
                  <Undo2 size={14} />
                </Button>
                <Button icon aria-label={t("Rehacer")} aria-keyshortcuts="Meta+Shift+Z Control+Y" data-tooltip={`${t("Rehacer")} (${REDO_KEYS})`} disabled={!future.length || !!draft || !!auto} onClick={redo}>
                  <Redo2 size={14} />
                </Button>
                <Button icon aria-label={t("Volver a la imagen de partida")} data-tooltip={t("Volver a la imagen de partida")} disabled={!ops.length} onClick={() => commit([])}>
                  <RotateCcw size={14} />
                </Button>
              </div>
            </div>

            <div className="restoration-versions">
              <h2>
                {t("Versiones de esta imagen")} <span>{versions.length}</span>
              </h2>
              {!versions.length && <p className="hint">{t("Todavía no hay versiones: el original es la única imagen de este registro.")}</p>}
              <ul>
                {versions.map((v) => (
                  <li key={v.id} className={versionId === v.id ? "is-selected" : ""}>
                    <button type="button" onClick={() => guarded(() => (setVersionId(v.id), reset()))} data-tooltip={v.ops.map((o) => t(opLabel(o))).join(" → ")} data-testid="workshop-version-item">
                      <img src={`imago://restoration/${v.id}`} alt="" />
                      <span>
                        <strong>
                          <em className={`workshop-badge ${v.ai ? "is-ai" : ""}`}>{tLabel(t, v.label)}</em>
                        </strong>
                        <small>{`${v.width}×${v.height} px · ${when(v.createdAt)}`}</small>
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
          title={t("Elegir la imagen que quieres tratar")}
          action={t("Elegir")}
          onClose={() => setPicking(false)}
          onAdd={(ids) => {
            setPicking(false);
            void choose(ids[0]);
          }}
        />
      )}
      {choosingVersion && source && (
        <Modal icon={History} title={t("¿Desde qué versión quieres trabajar?")} onClose={() => setChoosingVersion(false)} wide>
          <div className="modal-body">
            <p className="hint">{t("Esta imagen tiene versiones derivadas. Elige de cuál partir; el resultado será una versión nueva y la de partida no cambia.")}</p>
            <ul className="workshop-version-picker">
              <li>
                <button type="button" className={versionId === null ? "is-selected" : ""} onClick={() => (setVersionId(null), reset(), setChoosingVersion(false))}>
                  <img src={preview(source.assetId, source.revision)} alt="" />
                  <span>
                    <strong>{t("Original")}</strong>
                    <small>{t("Fuente digital inalterada")}</small>
                  </span>
                </button>
              </li>
              {versions.map((v) => (
                <li key={v.id}>
                  <button type="button" className={versionId === v.id ? "is-selected" : ""} onClick={() => (setVersionId(v.id), reset(), setChoosingVersion(false))}>
                    <img src={`imago://restoration/${v.id}`} alt="" />
                    <span>
                      <strong>{tLabel(t, v.label)}</strong>
                      <small>{`${v.width}×${v.height} px · ${when(v.createdAt)}`}</small>
                      <small>{v.ops.map((o) => t(opLabel(o))).join(" → ")}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Modal>
      )}
      {guard && (
        <Modal icon={Save} title={t("Hay cambios sin guardar")} onClose={() => setGuard(null)}>
          <div className="modal-body">
            <p>{t("Puedes guardarlos como una versión nueva antes de seguir, o descartarlos.")}</p>
          </div>
          <footer>
            <Button onClick={() => setGuard(null)}>{t("Cancelar")}</Button>
            <Button className="danger" onClick={() => (reset(), guard.then(), setGuard(null))}>
              {t("Descartar cambios")}
            </Button>
            <Button primary onClick={() => void save().then(() => (guard.then(), setGuard(null)))}>
              {t("Guardar versión")}
            </Button>
          </footer>
        </Modal>
      )}
      {exporting && (
        <ExportDialog
          version={exporting}
          title={t("Descargar versión")}
          generative={exporting.ai}
          watermark={{
            enabled: settings.watermark?.enabled ?? exporting.ai,
            position: settings.watermark?.position ?? "bottom-right",
            // The mark says what this version is: «Sin trama digitalmente», «Escalada ×4 mediante IA»…
            text: tExport(t, exporting.ops),
          }}
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
            <p>{t("Se eliminará esta versión. El original y las demás versiones no cambian.")}</p>
          </div>
          <footer>
            <Button onClick={() => setDeleting(null)}>{t("Cancelar")}</Button>
            <Button
              className="danger"
              onClick={() =>
                void (async () => {
                  const v = deleting;
                  setDeleting(null);
                  try {
                    await api.call("restorationDelete", { id: v.id });
                    if (versionId === v.id) setVersionId(v.parentId);
                    await loadVersions(v.assetId);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
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

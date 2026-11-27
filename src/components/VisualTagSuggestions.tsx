import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { PROVIDERS, type ModelChoice, type VisionCatalogModel } from "../../shared/aiConfig";
import type { DatabaseColumn } from "../../shared/databases";
import type { Region } from "../../shared/imageRotation";
import { mergeVisualTagReview, type VisualTagReviewItem, type VisualTagSuggestion } from "../../shared/visualTags";
import { useT } from "../i18n";
import { CriteriaSelect } from "./CriteriaSelect";
import { Button } from "./ui";

const modelKey = ({ provider, model }: ModelChoice) => `${provider}|${model}`;
type Review = {
  imageVersion: string;
  choice: ModelChoice;
  regions: VisualTagReviewItem[];
};
const handles = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type ProposalGrip = (typeof handles)[number] | "move";

export function VisualTagSuggestions({
  assetId, dictionary, model, onModelChange, onApplied, onPreview, thumbnail,
  stage, showBoxes, position, point, reshape, undoVersion,
}: {
  assetId: string;
  dictionary: DatabaseColumn | null;
  model: string;
  onModelChange: (model: string) => void;
  onApplied: () => Promise<void>;
  onPreview: (region: VisualTagSuggestion) => void;
  thumbnail: (region: VisualTagSuggestion) => ReactNode;
  stage: HTMLDivElement | null;
  showBoxes: boolean;
  position: (region: Region) => CSSProperties;
  point: (event: { clientX: number; clientY: number }) => { x: number; y: number };
  reshape: (region: Region, grip: ProposalGrip, dx: number, dy: number, from: { x: number; y: number }) => Region;
  undoVersion: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<VisionCatalogModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"suggest" | "apply" | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [activeRegion, setActiveRegion] = useState<number | null>(null);
  const drag = useRef<{ id: number; grip: ProposalGrip; start: Region; from: { x: number; y: number } } | null>(null);
  const approvalBatches = useRef<Map<number, string[]>[]>([]);
  const handledUndo = useRef(undoVersion);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const labels = new Map(dictionary?.options.map((o) => [o.id, o.label]));
  const options = useMemo(() => (models ?? []).map(({ choice, name }) => ({
    value: modelKey(choice),
    label: name,
    description: choice.provider === "local" ? "Local" : `${PROVIDERS[choice.provider].label} · ${choice.model}`,
  })), [models]);
  const selected = models?.find(({ choice }) => modelKey(choice) === model) ?? models?.[0];
  const checkedCount = review?.regions.reduce((count, item) => count + item.checked.length, 0) ?? 0;
  const pendingCount = review?.regions.reduce((count, { region, applied }) => count + region.optionIds.length - applied.length, 0) ?? 0;
  const allChecked = pendingCount > 0 && checkedCount === pendingCount;
  const changeRegion = (id: number, update: (item: VisualTagReviewItem) => VisualTagReviewItem) =>
    setReview((current) => current && { ...current, regions: current.regions.map((item) => item.id === id ? update(item) : item) });

  useEffect(() => {
    if (undoVersion === handledUndo.current) return;
    handledUndo.current = undoVersion;
    const batch = approvalBatches.current.pop();
    if (!batch) return;
    setReview((current) => current && ({
      ...current,
      regions: current.regions.map((item) => {
        const tags = batch.get(item.id);
        return tags ? { ...item, checked: [...new Set([...item.checked, ...tags])], applied: item.applied.filter((tag) => !tags.includes(tag)) } : item;
      }),
    }));
    setAdded(null);
  }, [undoVersion]);

  const toggle = async () => {
    setOpen(!open);
    if (open || models !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      setModels(await window.imago.call("visualTagModels"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const suggest = async () => {
    if (!dictionary?.options.length || !selected || busy) return;
    const { choice } = selected;
    setBusy("suggest");
    setError(null);
    setAdded(null);
    try {
      const answer = await window.imago.call("visualTagSuggest", { assetId, dictionaryId: dictionary.id, choice });
      const previous = review?.imageVersion === answer.imageVersion ? review : null;
      const regions = mergeVisualTagReview(previous?.regions ?? [], answer.regions, choice, !!previous);
      setReview({ imageVersion: answer.imageVersion, choice, regions });
      if (!previous) approvalBatches.current = [];
      setActiveRegion((id) => regions.some((item) => item.id === id && item.applied.length < item.region.optionIds.length)
        ? id : regions.find((item) => item.applied.length < item.region.optionIds.length)?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!dictionary || !review || !checkedCount || busy) return;
    setBusy("apply");
    setError(null);
    try {
      const count = await window.imago.call("visualTagApplySuggestions", {
        assetId, dictionaryId: dictionary.id, imageVersion: review.imageVersion, choice: review.choice,
        regions: review.regions.flatMap(({ region, checked, choice }) =>
          checked.length ? [{ ...region, choice, optionIds: region.optionIds.filter((id) => checked.includes(id)) }] : [],
        ),
      });
      if (count) approvalBatches.current.push(new Map(review.regions.filter((item) => item.checked.length).map((item) => [item.id, item.checked])));
      const regions = review.regions.map((item) => ({
        ...item, applied: [...item.applied, ...item.checked], checked: [],
      }));
      setReview({ ...review, regions });
      if (!regions.some((item) => item.id === activeRegion && item.applied.length < item.region.optionIds.length)) {
        setActiveRegion(regions.find((item) => item.applied.length < item.region.optionIds.length)?.id ?? null);
      }
      setAdded(count);
      if (count) await onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const updateBox = (event: { clientX: number; clientY: number }) => {
    const moving = drag.current;
    if (!moving) return;
    const to = point(event);
    const next = reshape(moving.start, moving.grip, to.x - moving.from.x, to.y - moving.from.y, moving.from);
    changeRegion(moving.id, (item) => ({ ...item, region: { ...item.region, ...next } }));
  };

  return (
    <div className="viewer-tag-suggestions" data-testid="viewer-tag-suggestions">
      <button type="button" className="viewer-annotate" aria-expanded={open} onClick={() => void toggle()}>
        <Sparkles size={14} /> {t("Sugerir con IA")} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="viewer-tag-suggestion-controls">
          <CriteriaSelect
            label={t("Modelo de visión")}
            options={options}
            values={selected ? [modelKey(selected.choice)] : []}
            onChange={([value]) => onModelChange(value ?? "")}
            placeholder={t(loading ? "Cargando modelos…" : "Seleccionar modelo…")}
            disabled={loading || !!busy || !options.length}
          />
          {models && !models.length && <p className="viewer-empty">{t("No hay modelos de visión disponibles. Comprueba los modelos instalados o tus proveedores de IA en Ajustes.")}</p>}
          {!dictionary?.options.length && <p className="viewer-empty">{t("Elige un diccionario activo que contenga etiquetas.")}</p>}
          {selected?.remote && <small className="muted">{t("Al sugerir, se envían la imagen y el diccionario al proveedor del modelo.")}</small>}
          <Button type="button" disabled={!selected || !dictionary?.options.length || !!busy} onClick={() => void suggest()} data-testid="viewer-tag-suggest-run">
            {busy === "suggest" ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            {t(busy === "suggest" ? "Analizando imagen…" : review ? "Volver a sugerir" : "Sugerir etiquetas")}
          </Button>
          {error && <p className="annotation-error" role="alert">{t(error)}</p>}
          {added !== null && (
            <p className="viewer-empty" role="status">
              {added === 1
                ? t("Se ha guardado una región.")
                : added ? t("Se han guardado {n} regiones.").replace("{n}", String(added)) : t("Las regiones seleccionadas ya estaban etiquetadas.")}
            </p>
          )}
          {review && !review.regions.length && <p className="viewer-empty">{t("El modelo no identificó etiquetas del diccionario en esta imagen.")}</p>}
          {!!review?.regions.length && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={allChecked}
                  disabled={!!busy || !pendingCount}
                  onChange={(e) => {
                    const check = e.target.checked;
                    setReview({ ...review, regions: review.regions.map((item) => ({
                      ...item, checked: check ? item.region.optionIds.filter((tag) => !item.applied.includes(tag)) : [],
                    })) });
                  }}
                />
                {t("Seleccionar todas")}
              </label>
              <ul className="viewer-tag-proposals">
                {review.regions.map(({ id: regionId, region, checked, applied, newTags }, index) => (
                  <li key={regionId} className={regionId === activeRegion ? "is-active" : ""}>
                    <button type="button" className="viewer-tag-proposal-crop" aria-label={t("Ver región sugerida {n}").replace("{n}", String(index + 1))} onClick={() => {
                      setActiveRegion(regionId);
                      onPreview(region);
                    }}>
                      {thumbnail(region)}
                    </button>
                    <div className="viewer-tag-proposal-choices">
                      {region.optionIds.map((id) => (
                        <label className="check-label" key={id}>
                          <input
                            type="checkbox"
                            checked={checked.includes(id) || applied.includes(id)}
                            disabled={!!busy || applied.includes(id)}
                            onChange={(e) => {
                              const next = e.target.checked ? [...checked, id] : checked.filter((tag) => tag !== id);
                              changeRegion(regionId, (item) => ({ ...item, checked: next }));
                            }}
                          />
                          <span>{labels.get(id) ?? id}</span>
                          {applied.includes(id) ? <small>{t("Guardada")}</small> : newTags.includes(id) && <small>{t("Nueva")}</small>}
                        </label>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              {showBoxes && review.regions.some((item) => item.id === activeRegion && item.applied.length < item.region.optionIds.length) && (
                <small className="muted">{t("Arrastra el recuadro sugerido o sus bordes para ajustarlo.")}</small>
              )}
              <Button type="button" primary disabled={!checkedCount || !!busy} onClick={() => void apply()} data-testid="viewer-tag-suggest-apply">
                {busy === "apply" && <Loader2 size={14} className="spin" />}
                {t("Añadir etiquetas seleccionadas")} ({checkedCount})
              </Button>
            </>
          )}
        </div>
      )}
      {open && stage && showBoxes && review && createPortal(
        review.regions.filter(({ region, applied }) => applied.length < region.optionIds.length).map(({ id, region }) => {
          const active = id === activeRegion && !busy;
          return (
            <div
              key={id}
              className={`viewer-proposal-box${active ? " is-active" : ""}${busy ? "" : " is-editable"}`}
              style={position(region)}
              data-testid="viewer-proposal-box"
              onPointerDown={(event) => {
                if (busy || event.button !== 0) return;
                event.stopPropagation();
                setActiveRegion(id);
                const grip = (event.target as HTMLElement).closest<HTMLElement>("[data-grip]")?.dataset.grip as ProposalGrip | undefined;
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { id, grip: grip ?? "move", start: region, from: point(event) };
              }}
              onPointerMove={(event) => {
                if (!drag.current) return;
                event.stopPropagation();
                updateBox(event);
              }}
              onPointerUp={(event) => {
                if (!drag.current) return;
                event.stopPropagation();
                updateBox(event);
                drag.current = null;
              }}
              onPointerCancel={() => {
                const moving = drag.current;
                drag.current = null;
                if (moving) changeRegion(moving.id, (item) => ({ ...item, region: { ...item.region, ...moving.start } }));
              }}
            >
              {active && handles.map((grip) => <span key={grip} className={`crop-grip is-${grip}`} data-grip={grip} />)}
            </div>
          );
        }),
        stage,
      )}
    </div>
  );
}

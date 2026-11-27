import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { ModelChoice } from "../../shared/aiConfig";
import type { DatabaseColumn } from "../../shared/databases";
import type { Region } from "../../shared/imageRotation";
import { mergeVisualTagReview, type VisualTagReviewItem, type VisualTagSuggestion } from "../../shared/visualTags";
import { useT } from "../i18n";
import { useVisionModels, VisionModelPicker } from "./VisionModelPicker";
import { Button } from "./ui";
import { VisionProposalBoxes, type ProposalGeometry } from "./VisionProposalBoxes";

type Review = {
  imageVersion: string;
  choice: ModelChoice;
  regions: VisualTagReviewItem[];
};
export function VisualTagSuggestions({
  assetId, dictionary, model, onModelChange, onApplied, onPreview, thumbnail,
  active, stage, showBoxes, position, point, reshape, undoVersion,
}: {
  assetId: string;
  dictionary: DatabaseColumn | null;
  model: string;
  onModelChange: (model: string) => void;
  onApplied: () => Promise<void>;
  onPreview: (region: VisualTagSuggestion) => void;
  thumbnail: (region: VisualTagSuggestion) => ReactNode;
  active: boolean;
  undoVersion: number;
} & ProposalGeometry) {
  const t = useT();
  const [busy, setBusy] = useState<"suggest" | "apply" | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [activeRegion, setActiveRegion] = useState<number | null>(null);
  const approvalBatches = useRef<Map<number, string[]>[]>([]);
  const handledUndo = useRef(undoVersion);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const catalogue = useVisionModels(active, model);
  const { selected } = catalogue;
  const feedback = error ?? catalogue.error;
  const labels = new Map(dictionary?.options.map((o) => [o.id, o.label]));
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

  return (
    <div className="viewer-tag-suggestions" data-testid="viewer-tag-suggestions">
      <VisionModelPicker catalogue={catalogue} onChange={onModelChange} disabled={!!busy} />
      <Button type="button" disabled={!selected || !dictionary?.options.length || !!busy} onClick={() => void suggest()} data-testid="viewer-tag-suggest-run">
        {busy === "suggest" ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
        {t(busy === "suggest" ? "Analizando imagen…" : review ? "Volver a sugerir" : "Sugerir etiquetas")}
      </Button>
      {!catalogue.loading && !catalogue.options.length && !catalogue.error && <p className="viewer-empty">{t("No hay modelos de visión disponibles. Comprueba los modelos instalados o tus proveedores de IA en Ajustes.")}</p>}
      {!dictionary?.options.length && <p className="viewer-empty">{t("Elige un diccionario activo que contenga etiquetas.")}</p>}
      {selected?.remote && <small className="muted">{t("Al sugerir, se envían la imagen y el diccionario al proveedor del modelo.")}</small>}
      {feedback && <p className="annotation-error" role="alert">{t(feedback)}</p>}
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
      {active && review && (
        <VisionProposalBoxes
          stage={stage} showBoxes={showBoxes} position={position} point={point} reshape={reshape}
          boxes={review.regions.filter(({ region, applied }) => applied.length < region.optionIds.length)}
          selected={activeRegion} onSelect={setActiveRegion} busy={!!busy}
          onChange={(id, region) => changeRegion(id, (item) => ({ ...item, region: { ...item.region, ...region } }))}
        />
      )}
    </div>
  );
}

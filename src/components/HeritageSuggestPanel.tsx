import { useState, type ReactNode } from "react";
import { ExternalLink, Loader2, Sparkles, Square, Trash2 } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { ImageAnnotation } from "../../shared/imago";
import type { Region } from "../../shared/imageRotation";
import { foldText, type HeritageCandidate, type HeritageRegionSuggestion } from "../../shared/heritage";
import { regionOverlap } from "../../shared/visualTags";
import { useT } from "../i18n";
import { refreshHeritage } from "../heritageStore";
import { Button } from "./ui";
import { useVisionModels, VisionModelPicker } from "./VisionModelPicker";
import { VisionProposalBoxes, type ProposalGeometry } from "./VisionProposalBoxes";

type Item = HeritageRegionSuggestion & { id: number; checked: boolean; candidates?: HeritageCandidate[]; chosen?: number };
const sameElement = (a: HeritageRegionSuggestion, b: HeritageRegionSuggestion) =>
  a.optionId || b.optionId ? a.optionId === b.optionId : foldText(`${a.name} ${a.place ?? ""}`) === foldText(`${b.name} ${b.place ?? ""}`);

export function HeritageSuggestPanel({
  column, assetId, dictionarySize, inCell, marks, active, model, onModelChange, allowNew, onAllowNewChange,
  zones, drawing, onDraw, onRemoveZone, onAdded, onPreview, thumbnail, ...geometry
}: {
  column: DatabaseColumn;
  assetId: string;
  dictionarySize: number;
  inCell: string[];
  marks: ImageAnnotation[];
  active: boolean;
  model: string;
  onModelChange: (model: string) => void;
  allowNew: boolean;
  onAllowNewChange: (allow: boolean) => void;
  zones: Region[];
  drawing: boolean;
  onDraw: (on: boolean) => void;
  onRemoveZone: (index: number) => void;
  onAdded: () => Promise<void> | void;
  onPreview: (region: Region) => void;
  thumbnail: (region: Region) => ReactNode;
} & ProposalGeometry) {
  const t = useT();
  const catalogue = useVisionModels(active, model);
  const [whole, setWhole] = useState(true);
  const [review, setReview] = useState<{ imageVersion: string; items: Item[]; searched: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState<"suggest" | "save" | "lookup" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const [saveMarks, setSaveMarks] = useState(true);
  const items = review?.items.filter((item) => allowNew || item.optionId) ?? [];
  const chosen = items.filter((item) => item.checked);
  const update = (id: number, change: Partial<Item>) => {
    setReview((current) => current && { ...current, items: current.items.map((item) => item.id === id ? { ...item, ...change } : item) });
  };
  const feedback = error ?? catalogue.error;

  const analyze = async () => {
    const choice = catalogue.selected?.choice;
    if (!choice || busy || (!whole && !zones.length) || (!dictionarySize && !allowNew)) return;
    onDraw(false);
    setBusy("suggest");
    setError(null);
    setAdded(null);
    try {
      const answer = await window.imago.call("heritageSuggest", { assetId, columnId: column.id, whole, zones, choice, allowNew });
      const results: Item[] = [];
      const previous = review?.imageVersion === answer.imageVersion ? review.items : [];
      const consumed = new Set<number>();
      let nextId = Math.max(0, ...previous.map((item) => item.id));
      const suggestions = answer.targets.flatMap((target) => target.suggestions)
        .sort((a, b) => Number(!a.box) - Number(!b.box));
      for (const suggestion of suggestions) {
        const box = suggestion.box;
        if (results.some((item) => sameElement(item, suggestion) &&
          (!box || !item.box || regionOverlap(item.box, box) >= 0.65))) continue;
        if (suggestion.optionId && inCell.includes(suggestion.optionId) &&
          (!box || marks.some((mark) => mark.optionId === suggestion.optionId && mark.kind !== "point" && regionOverlap(mark, box) >= 0.8))) continue;
        const prior = previous.find((item) => !consumed.has(item.id) && sameElement(item, suggestion) &&
          (!box || !item.box || regionOverlap(item.box, box) >= 0.6));
        if (prior) consumed.add(prior.id);
        results.push(prior ?? { ...suggestion, id: ++nextId, checked: !!suggestion.optionId && suggestion.confidence !== "low" });
      }
      results.sort((a, b) => Number(!a.box) - Number(!b.box));
      setReview({ imageVersion: answer.imageVersion, searched: answer.known, items: results.slice(0, 100) });
      setSelected(results.find((item) => item.box)?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const lookup = async (item: Item) => {
    setBusy("lookup");
    setError(null);
    try {
      const [answer] = await window.imago.call("heritageCandidates", {
        items: [{ optionId: String(item.id), label: item.place ? `${item.name} - ${item.place}` : item.name }],
      });
      if (answer?.error) setError(answer.error);
      update(item.id, { candidates: answer?.candidates ?? [], chosen: -1 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!review || !chosen.length || busy) return;
    setBusy("save");
    setError(null);
    try {
      const count = await window.imago.call("heritageApplySuggestions", {
        columnId: column.id, assetId, imageVersion: review.imageVersion, allowNew,
        items: chosen.map(({ optionId, name, place, box, candidates, chosen: candidate }) => ({
          optionId, name, place, box: saveMarks ? box : null, link: candidates?.[candidate ?? -1]?.link ?? null,
        })),
      });
      const saved = new Set(chosen.map((item) => item.id));
      setReview({ ...review, items: review.items.filter((item) => !saved.has(item.id)) });
      setAdded(count);
      refreshHeritage(column.id);
      await onAdded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="viewer-tag-suggestions" data-testid="heritage-suggest">
      <VisionModelPicker catalogue={catalogue} disabled={!!busy} onChange={onModelChange} />
      <Button type="button" disabled={!!busy || !catalogue.selected || (!whole && !zones.length) || (!allowNew && !dictionarySize)}
        onClick={() => void analyze()} data-testid="heritage-suggest-run">
        {busy === "suggest" ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
        {t(busy === "suggest" ? "Analizando imagen…" : review ? "Volver a sugerir" : "Sugerir patrimonio")}
      </Button>
      <label className="check-label">
        <input type="checkbox" checked={allowNew} disabled={!!busy} onChange={(event) => onAllowNewChange(event.target.checked)} />
        {t("Sugerir elementos fuera del diccionario")}
      </label>
      {!catalogue.loading && !catalogue.options.length && !catalogue.error && <p className="viewer-empty">{t("No hay modelos de visión disponibles. Comprueba los modelos instalados o tus proveedores de IA en Ajustes.")}</p>}
      {!dictionarySize && !allowNew && <p className="viewer-empty">{t("Añade elementos al diccionario o permite sugerencias fuera de él.")}</p>}
      {catalogue.selected?.remote && <small className="muted">{t("Al sugerir, se envían la imagen, el diccionario y el contexto de la ficha al proveedor del modelo.")}</small>}
      <div className="heritage-suggest-zones">
        <label className="check-label">
          <input type="checkbox" checked={whole} disabled={!!busy} onChange={(event) => setWhole(event.target.checked)} />
          {t("Imagen completa")}
        </label>
        {zones.map((_, i) => (
          <span className="heritage-zone-chip" key={i}>
            <Square size={11} /> {t("Zona")} {i + 1}
            <button type="button" aria-label={t("Quitar la zona")} disabled={!!busy} onClick={() => onRemoveZone(i)}><Trash2 size={11} /></button>
          </span>
        ))}
        <button type="button" className={`heritage-zone-draw${drawing ? " is-on" : ""}`} aria-pressed={drawing}
          disabled={!!busy || zones.length >= 6} onClick={() => onDraw(!drawing)}>
          <Square size={12} /> {t(drawing ? "Arrastra sobre la imagen…" : "Dibujar zona")}
        </button>
      </div>
      {feedback && <p className="annotation-error" role="alert">{t(feedback)}</p>}
      {review && review.searched < dictionarySize && <small className="muted">{t("Entradas consultadas del diccionario")} {review.searched}/{dictionarySize}</small>}
      {added !== null && <p className="viewer-empty" role="status">{t("Elementos añadidos: {n}").replace("{n}", String(added))}</p>}
      {review && !items.length && added === null && <p className="viewer-empty">{t("No hay propuestas nuevas para esta foto.")}</p>}
      {!!items.length && (
        <>
          <label className="check-label">
            <input type="checkbox" checked={items.length === chosen.length} disabled={!!busy} onChange={(event) => {
              const checked = event.target.checked;
              const shown = new Set(items.map((item) => item.id));
              setReview((current) => current && { ...current, items: current.items.map((item) => shown.has(item.id) ? { ...item, checked } : item) });
            }} />
            {t("Seleccionar todas")}
          </label>
          <ul className="viewer-tag-proposals">
            {items.map((item) => (
              <li className={item.id === selected ? "is-active" : ""} key={item.id}>
                {item.box && (
                  <button type="button" className="viewer-tag-proposal-crop" aria-label={t("Ver en la imagen")} onClick={() => {
                    setSelected(item.id);
                    onPreview(item.box!);
                  }}>{thumbnail(item.box)}</button>
                )}
                <div className="viewer-tag-proposal-choices">
                  <label className="check-label">
                    <input type="checkbox" checked={item.checked} disabled={!!busy} onChange={(event) => update(item.id, { checked: event.target.checked })} />
                    <span>{item.place ? `${item.name} - ${item.place}` : item.name}</span>
                    {!item.optionId && <small>{t("Nuevo")}</small>}
                  </label>
                  <small className="muted">{t(item.confidence === "high" ? "el modelo está seguro" : item.confidence === "low" ? "el modelo duda" : "probable")}</small>
                  {!item.optionId && (
                    <div className="heritage-suggestion-link">
                      {item.candidates ? (
                        item.candidates.length ? <>
                          <select aria-label={t("Otro candidato")} disabled={!!busy} value={item.chosen ?? -1}
                            onChange={(event) => update(item.id, { chosen: Number(event.target.value) })}>
                            <option value={-1}>{t("Sin enlace a Wikidata")}</option>
                            {item.candidates.map((candidate, index) => <option key={candidate.link.id} value={index}>{candidate.link.label} ({candidate.link.id})</option>)}
                          </select>
                          {(item.chosen ?? -1) >= 0 && <button type="button" aria-label={t("Abrir en el navegador")}
                            onClick={() => void window.imago.call("openExternalLink", { url: item.candidates![item.chosen!].link.uri })}><ExternalLink size={12} /></button>}
                        </> : <small className="muted">{t("Sin candidatos en Wikidata: se creará sin enlace.")}</small>
                      ) : <button type="button" className="heritage-zone-draw" disabled={!!busy} onClick={() => void lookup(item)}>{t("Buscar en Wikidata")}</button>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {items.some((item) => item.box) && (
            <>
              {geometry.showBoxes && <small className="muted">{t("Arrastra el recuadro sugerido o sus bordes para ajustarlo.")}</small>}
              <label className="check-label">
                <input type="checkbox" checked={saveMarks} disabled={!!busy} onChange={(event) => setSaveMarks(event.target.checked)} />
                {t("Guardar cada zona como marca del elemento")}
              </label>
            </>
          )}
          <Button type="button" primary disabled={!chosen.length || !!busy} onClick={() => void apply()} data-testid="heritage-suggest-apply">
            {busy === "save" && <Loader2 size={14} className="spin" />}
            {t("Añadir seleccionados")} ({chosen.length})
          </Button>
        </>
      )}
      {active && (
        <VisionProposalBoxes {...geometry} busy={!!busy} testId="viewer-heritage-proposal-box"
          boxes={items.flatMap((item) => item.box ? [{ id: item.id, region: item.box }] : [])}
          selected={selected} onSelect={setSelected} onChange={(id, box) => update(id, { box })} />
      )}
    </div>
  );
}

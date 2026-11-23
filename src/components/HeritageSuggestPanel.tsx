// Heritage elements suggested by a vision model for the photograph shown:
// the whole image and/or zones drawn on it. Names the property already has
// are matched to it; new ones are looked up in Wikidata (only the names, only
// when asked). The researcher adds one, several or all of them; a zone can
// stay as the element's mark. Nothing is saved before that.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ExternalLink, Loader2, Sparkles, Square, Trash2 } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { ModelChoice } from "../../shared/aiConfig";
import type { HeritageCandidate, HeritageSuggestion } from "../../shared/heritage";
import { heritageScheme, typeFromInstances, typology } from "../../shared/heritage";
import { formatNumber, useLanguage, useT } from "../i18n";
import { refreshHeritage } from "../heritageStore";
import { HeritageIcon } from "./HeritageIcon";

type Box = { x: number; y: number; w: number; h: number };
type Item = HeritageSuggestion & {
  key: string;
  zone: Box | null;
  zoneIndex: number | null;
  candidates: HeritageCandidate[];
  chosen: number;
  selected: boolean;
};

export function HeritageSuggestPanel({
  column,
  rowId,
  assetId,
  inCell,
  zones,
  drawing,
  onDraw,
  onRemoveZone,
  onBack,
  onAdded,
}: {
  column: DatabaseColumn;
  rowId: string;
  assetId: string;
  inCell: string[];
  /** Zones drawn on the image for the model. */
  zones: Box[];
  drawing: boolean;
  onDraw: (on: boolean) => void;
  onRemoveZone: (index: number) => void;
  onBack: () => void;
  onAdded: () => Promise<void> | void;
}) {
  const t = useT(),
    language = useLanguage();
  const scheme = heritageScheme(column.config);
  const [whole, setWhole] = useState(true);
  const [models, setModels] = useState<{ label: string; choice: ModelChoice }[]>([]);
  const [model, setModel] = useState(0);
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marks, setMarks] = useState(true);
  const labels = useMemo(() => new Map(column.options.map((o) => [o.id, o.label])), [column.options]);

  // The models chosen in Settings to classify and to describe images.
  useEffect(() => {
    void window.imago
      .call("status")
      .then((status) => {
        const list = [
          { label: t("Modelo de clasificación"), choice: status.settings.classificationModel },
          { label: t("Modelo de descripción"), choice: status.settings.descriptionModel },
        ].filter((m, i, all) => m.choice?.model && all.findIndex((x) => x.choice.model === m.choice.model && x.choice.provider === m.choice.provider) === i);
        setModels(list);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analyze = async () => {
    const choice = models[model]?.choice;
    if (!choice) return;
    setBusy(t("El modelo está mirando la imagen…"));
    setError(null);
    setItems(null);
    try {
      const answer = await window.imago.call("heritageSuggest", { assetId, columnId: column.id, whole, zones, choice });
      const found: Item[] = answer.targets.flatMap((target) => {
        // The zone comes back as a copy: found by its position, not by identity.
        const zoneIndex = target.zone ? zones.findIndex((z) => z.x === target.zone!.x && z.y === target.zone!.y) : null;
        return target.suggestions.map((s, i) => ({
          ...s,
          key: `${zoneIndex ?? "all"}-${i}-${s.name}`,
          zone: target.zone,
          zoneIndex,
          candidates: [],
          chosen: 0,
          // What the model itself doubts is shown unticked.
          selected: !!s.optionId && !inCell.includes(s.optionId) && s.confidence !== "low",
        }));
      });
      // The same element named for the whole image and for a zone appears once, with its zone.
      const unique = new Map<string, Item>();
      for (const item of found) {
        const id = item.optionId ?? `${item.name}|${item.place ?? ""}`.toLocaleLowerCase();
        const seen = unique.get(id);
        if (!seen || (!seen.zone && item.zone)) unique.set(id, item);
      }
      let list = [...unique.values()];
      // New names: their Wikidata candidates (only the names are sent).
      const fresh = list.filter((i) => !i.optionId);
      if (fresh.length) {
        setBusy(t("Buscando en Wikidata los elementos nuevos…"));
        for (let i = 0; i < fresh.length; i += 10) {
          const chunk = fresh.slice(i, i + 10);
          const candidates = await window.imago.call("heritageCandidates", {
            items: chunk.map((item) => ({ optionId: item.key.replace(/[^\w-]/g, "").slice(0, 150) || "x", label: item.place ? `${item.name} - ${item.place}` : item.name })),
          });
          chunk.forEach((item, j) => {
            item.candidates = candidates[j]?.candidates ?? [];
            item.selected = item.candidates[0]?.confidence === "high";
          });
        }
        list = list.map((item) => fresh.find((f) => f.key === item.key) ?? item);
      }
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const add = async (which: Item[]) => {
    setBusy(t("Añadiendo…"));
    setError(null);
    try {
      for (const item of which) {
        const link = item.candidates[item.chosen]?.link ?? null;
        const optionId =
          item.optionId ??
          (await window.imago.call("heritageAddElement", {
            columnId: column.id,
            label: item.place ? `${item.name} - ${item.place}` : item.name,
            link,
          }));
        await window.imago.call("heritageAddToRows", {
          columnId: column.id,
          optionId,
          items: [{ rowId, ...(marks && item.zone ? { assetId, box: item.zone } : {}) }],
        });
      }
      window.dispatchEvent(new CustomEvent("imago:reload-detail"));
      refreshHeritage(column.id);
      setItems((all) => all?.filter((i) => !which.includes(i)) ?? null);
      await onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const selectable = (items ?? []).filter((i) => !(i.optionId && inCell.includes(i.optionId)));
  const chosen = selectable.filter((i) => i.selected);
  const set = (key: string, change: Partial<Item>) => setItems((all) => all?.map((i) => (i.key === key ? { ...i, ...change } : i)) ?? null);

  return (
    <section className="heritage-suggest" data-testid="heritage-suggest">
      <button type="button" className="detail-back" onClick={onBack}>
        <ArrowLeft size={14} />
        {t("Volver al patrimonio de la foto")}
      </button>
      <h2>
        <Sparkles size={15} /> {t("Sugerir con IA")}
      </h2>
      <div className="heritage-suggest-scope">
        <label className="check-label">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
          {t("Imagen completa")}
        </label>
        <div className="heritage-suggest-zones">
          {zones.map((_, i) => (
            <span key={i} className="heritage-zone-chip">
              <Square size={11} /> {t("Zona")} {i + 1}
              <button type="button" aria-label={t("Quitar la zona")} onClick={() => onRemoveZone(i)}>
                <Trash2 size={11} />
              </button>
            </span>
          ))}
          <button type="button" className={`heritage-zone-draw ${drawing ? "is-on" : ""}`} aria-pressed={drawing} onClick={() => onDraw(!drawing)}>
            <Square size={12} /> {t(drawing ? "Arrastra sobre la imagen…" : "Dibujar zona")}
          </button>
        </div>
        <label>
          {t("Modelo")}
          <select value={model} onChange={(e) => setModel(Number(e.target.value))} disabled={!models.length}>
            {models.map((m, i) => (
              <option key={i} value={i}>
                {m.label} · {m.choice.provider === "local" ? t("local") : m.choice.provider} · {m.choice.model}
              </option>
            ))}
          </select>
        </label>
        {models[model]?.choice.provider !== "local" && models.length > 0 && (
          <p className="hint">{t("Este modelo es de un proveedor externo: la imagen o la zona se envían a su servicio.")}</p>
        )}
        <button
          type="button"
          className="viewer-annotate is-on"
          disabled={!!busy || (!whole && !zones.length) || !models.length}
          onClick={() => void analyze()}
          data-testid="heritage-suggest-run"
        >
          {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
          {t("Analizar")}
        </button>
      </div>
      {busy && <p className="detail-status" role="status">{busy}</p>}
      {error && <p className="annotation-error">{t(error)}</p>}
      {items && !items.length && !busy && <p className="viewer-empty">{t("El modelo no ha reconocido ningún elemento concreto. Prueba con zonas más ajustadas o con otro modelo.")}</p>}
      {items && items.length > 0 && (
        <>
          <ul className="heritage-suggest-list">
            {items.map((item) => {
              const already = !!item.optionId && inCell.includes(item.optionId);
              const c = item.candidates[item.chosen];
              const typed = c && typeFromInstances(c.link.instances);
              const info = typed && typology(scheme, typed.group, typed.type, language);
              return (
                <li key={item.key} className={already ? "is-done" : ""}>
                  <label className="check-label">
                    <input type="checkbox" disabled={already} checked={already || item.selected} onChange={(e) => set(item.key, { selected: e.target.checked })} />
                    <span className="heritage-suggest-name">
                      <strong>{item.optionId ? labels.get(item.optionId) : item.place ? `${item.name} - ${item.place}` : item.name}</strong>
                      <small>
                        {[
                          item.zoneIndex !== null ? `${t("Zona")} ${item.zoneIndex + 1}` : t("Imagen completa"),
                          t(item.confidence === "high" ? "el modelo está seguro" : item.confidence === "low" ? "el modelo duda" : "probable"),
                          already ? t("ya está en la foto") : item.optionId ? t("ya está en tu lista") : t("nuevo"),
                        ].join(" · ")}
                      </small>
                    </span>
                  </label>
                  {!item.optionId && (
                    <div className="heritage-suggest-wikidata">
                      {c ? (
                        <>
                          {info && <HeritageIcon name={info.icon} size={12} />}
                          <span>
                            {c.link.label} <small>({c.link.id}{c.link.description ? ` · ${c.link.description}` : ""})</small>
                          </span>
                          <span className={`heritage-confidence ${c.confidence}`}>{t(c.confidence === "high" ? "Alta" : c.confidence === "medium" ? "Media" : "Baja")}</span>
                          {item.candidates.length > 1 && (
                            <select aria-label={t("Otro candidato")} value={item.chosen} onChange={(e) => set(item.key, { chosen: Number(e.target.value) })}>
                              {item.candidates.map((x, i) => (
                                <option key={x.link.id} value={i}>
                                  {x.link.label} ({x.link.id})
                                </option>
                              ))}
                              <option value={item.candidates.length}>{t("Sin enlace a Wikidata")}</option>
                            </select>
                          )}
                          <button type="button" aria-label={t("Abrir en el navegador")} onClick={() => void window.imago.call("openExternalLink", { url: c.link.uri })}>
                            <ExternalLink size={12} />
                          </button>
                        </>
                      ) : (
                        <small className="muted">{t("Sin candidatos en Wikidata: se creará sin enlace.")}</small>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <label className="check-label">
            <input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} />
            {t("Guardar cada zona como marca del elemento")}
          </label>
          <div className="heritage-suggest-actions">
            <button type="button" className="viewer-annotate is-on" disabled={!!busy || !chosen.length} onClick={() => void add(chosen)}>
              <Check size={14} /> {t("Añadir seleccionados")} ({formatNumber(chosen.length, 0)})
            </button>
            <button type="button" className="viewer-annotate" disabled={!!busy || !selectable.length} onClick={() => void add(selectable)}>
              {t("Añadir todos")} ({formatNumber(selectable.length, 0)})
            </button>
          </div>
        </>
      )}
    </section>
  );
}

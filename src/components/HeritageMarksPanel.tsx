// The heritage elements a photograph shows, beside the image in the viewer:
// those in the record's heritage property, each marked with a point, a
// rectangle or not at all; choosing the element of a new mark; and marks of
// elements no longer in the record (hidden, kept until deleted).
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Crosshair, Plus, ScanSearch, Square, Trash2, X } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { ImageAnnotation } from "../../shared/imago";
import { foldText, heritageScheme, typology } from "../../shared/heritage";
import { useLanguage, useT } from "../i18n";
import { useHeritage } from "../heritageStore";
import { HeritageIcon } from "./HeritageIcon";

export type MarkDraft = { kind: "point" | "rect"; x: number; y: number; w: number; h: number };

export function HeritageMarksPanel({
  column,
  dictionary,
  inCell,
  marks,
  draft,
  selected,
  onChoose,
  onCreate,
  onCancel,
  onFocus,
  onDelete,
  onPropagate,
  thumbnail,
}: {
  column: DatabaseColumn;
  dictionary: DatabaseColumn["options"];
  /** Elements in the record's cell. */
  inCell: string[];
  /** Marks of this image that name an element of this property. */
  marks: ImageAnnotation[];
  /** A mark drawn and waiting for its element. */
  draft: MarkDraft | null;
  selected: string | null;
  onChoose: (optionId: string) => void;
  onCreate: (label: string) => void;
  onCancel: () => void;
  onFocus: (mark: ImageAnnotation) => void;
  onDelete: (mark: ImageAnnotation) => void;
  thumbnail: (mark: ImageAnnotation) => ReactNode;
  /** Looks for this element in the other photographs. */
  onPropagate: (optionId: string, markId?: string) => void;
}) {
  const t = useT(),
    language = useLanguage();
  const elements = useHeritage(column.id);
  const scheme = heritageScheme(column.config);
  const [query, setQuery] = useState("");
  const labels = useMemo(() => new Map(column.options.map((o) => [o.id, o.label])), [column.options]);
  const iconOf = (id: string) => typology(scheme, elements[id]?.group ?? null, elements[id]?.type ?? null, language)?.icon;
  const needle = foldText(query);
  const choices = useMemo(() => {
    const matches = dictionary.filter((o) => !needle || foldText(o.label).includes(needle));
    return [...matches.filter((o) => inCell.includes(o.id)), ...matches.filter((o) => !inCell.includes(o.id))].slice(0, 40);
  }, [dictionary, needle, inCell]);
  const hidden = marks.filter((m) => m.optionId && !inCell.includes(m.optionId));

  return (
    <section className="heritage-marks" data-testid="heritage-marks">
      {draft && (
        <div className="heritage-chooser" data-testid="heritage-chooser">
          <p>
            {draft.kind === "point" ? <Crosshair size={13} /> : <Square size={13} />}{" "}
            {t("¿Qué elemento es?")}
            <button type="button" className="heritage-chooser-close" aria-label={t("Cancelar")} onClick={onCancel}>
              <X size={13} />
            </button>
          </p>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Buscar elemento")}
            aria-label={t("Buscar elemento")}
          />
          <ul>
            {choices.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => onChoose(o.id)}>
                  <HeritageIcon name={iconOf(o.id)} size={13} />
                  <span>{o.label}</span>
                  {inCell.includes(o.id) && <small>{t("en la ficha")}</small>}
                </button>
              </li>
            ))}
            {query.trim() && !dictionary.some((o) => foldText(o.label) === needle) && (
              <li>
                <button type="button" onClick={() => onCreate(query.trim())}>
                  <Plus size={13} />
                  <span>
                    {t("Crear")} «{query.trim()}»
                  </span>
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
      {!inCell.length && !draft && (
        <p className="viewer-empty">
          {t("Pulsa «Patrimonio» y marca un edificio, monumento u obra con un punto o un rectángulo. También puedes añadirlo en la celda sin marcarlo.")}
        </p>
      )}
      {!!inCell.length && <div className="viewer-tag-counts">
        {inCell.map((id) => {
          const option = column.options.find((entry) => entry.id === id);
          const count = marks.filter((m) => m.optionId === id).length;
          return <span key={id} className="chip" style={{ "--chip": option?.color } as CSSProperties}>
            <HeritageIcon name={iconOf(id)} size={11} /> {option?.label ?? id}
            {count > 1 && <b className="visual-tags-count">×{count}</b>}
          </span>;
        })}
      </div>}
      {!!inCell.length && <ul className="viewer-list">
        {inCell.flatMap((id) => {
          const regions = marks.filter((mark) => mark.optionId === id);
          const option = column.options.find((entry) => entry.id === id);
          return (regions.length ? regions : [null]).map((mark) => {
            const name = (
              <span className="viewer-item-text">
                <span className="viewer-tag-name" style={{ "--chip": option?.color } as CSSProperties}>
                  <HeritageIcon name={iconOf(id)} size={14} />
                  {option?.label ?? id}
                </span>
                {!mark && <small className="muted">{t("sin marcar")}</small>}
              </span>
            );
            return (
              <li key={mark?.id ?? id} className={selected && selected === mark?.id ? "is-selected" : ""}>
                {mark ? (
                  <button type="button" className="viewer-item" onClick={() => onFocus(mark)}>
                    {mark.kind === "point" ? <Crosshair size={16} className="heritage-card-point" /> : thumbnail(mark)}
                    {name}
                  </button>
                ) : <div className="viewer-item">{name}</div>}
                <span className="viewer-item-actions">
                  <button type="button" aria-label={t("Buscar en otras fotos")}
                    data-tooltip={t("Buscar este elemento en otras fotos")} onClick={() => onPropagate(id, mark?.id)}>
                    <ScanSearch size={13} />
                  </button>
                  {mark && <button type="button" aria-label={t("Quitar la marca")}
                    data-tooltip={t("Quitar la marca")} onClick={() => onDelete(mark)}><Trash2 size={13} /></button>}
                </span>
              </li>
            );
          });
        })}
      </ul>}
      {hidden.length > 0 && (
        <details className="heritage-hidden-marks">
          <summary>{t("{n} marcas de elementos quitados de la ficha (ocultas)").replace("{n}", String(hidden.length))}</summary>
          <ul>
            {hidden.map((m) => (
              <li key={m.id}>
                <span>{labels.get(m.optionId!) ?? t("Elemento eliminado")}</span>
                <button type="button" aria-label={t("Eliminar")} data-tooltip={t("Eliminar")} onClick={() => onDelete(m)}>
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

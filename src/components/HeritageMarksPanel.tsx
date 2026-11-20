// The heritage elements a photograph shows, beside the image in the viewer:
// those in the record's heritage property, each marked with a point, a
// rectangle or not at all; choosing the element of a new mark; and marks of
// elements no longer in the record (hidden, kept until deleted).
import { useMemo, useState } from "react";
import { Crosshair, Plus, Square, Trash2, X } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { ImageAnnotation } from "../../shared/imago";
import { foldText, heritageScheme, typology } from "../../shared/heritage";
import { useLanguage, useT } from "../i18n";
import { useHeritage } from "../heritageStore";
import { HeritageIcon } from "./HeritageIcon";

export type MarkDraft = { kind: "point" | "rect"; x: number; y: number; w: number; h: number };

export function HeritageMarksPanel({
  column,
  inCell,
  marks,
  draft,
  selected,
  onChoose,
  onCreate,
  onCancel,
  onFocus,
  onDelete,
}: {
  column: DatabaseColumn;
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
    const matches = column.options.filter((o) => !needle || foldText(o.label).includes(needle));
    return [...matches.filter((o) => inCell.includes(o.id)), ...matches.filter((o) => !inCell.includes(o.id))].slice(0, 40);
  }, [column.options, needle, inCell]);
  const hidden = marks.filter((m) => m.optionId && !inCell.includes(m.optionId));

  return (
    <section className="heritage-marks" data-testid="heritage-marks">
      <h2>
        {t("Patrimonio en esta foto")} <span>{inCell.length}</span>
      </h2>
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
            {query.trim() && !column.options.some((o) => foldText(o.label) === needle) && (
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
      <ul className="heritage-marks-list">
        {inCell.map((id) => {
          const own = marks.filter((m) => m.optionId === id);
          return (
            <li key={id}>
              <span className="heritage-marks-name">
                <HeritageIcon name={iconOf(id)} size={14} />
                {labels.get(id) ?? id}
              </span>
              {own.length ? (
                own.map((m) => (
                  <span key={m.id} className={`heritage-mark-chip ${selected === m.id ? "is-selected" : ""}`}>
                    <button type="button" onClick={() => onFocus(m)} data-tooltip={t("Ver en la imagen")}>
                      {m.kind === "point" ? <Crosshair size={12} /> : <Square size={12} />}
                    </button>
                    <button type="button" aria-label={t("Quitar la marca")} data-tooltip={t("Quitar la marca")} onClick={() => onDelete(m)}>
                      <Trash2 size={11} />
                    </button>
                  </span>
                ))
              ) : (
                <small className="muted">{t("sin marcar")}</small>
              )}
            </li>
          );
        })}
      </ul>
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

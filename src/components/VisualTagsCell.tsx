// A record's «Etiquetas visuales»: its tags, most frequent first, with their
// colour, icon and appearances (Persona ×5). Filled from the regions drawn in
// the viewer, so it is read here, not edited; a record without tags says
// whether its images were reviewed.
import type { DatabaseColumn } from "../../shared/databases";
import { decodeMultiSelect } from "../../shared/databases";
import { optionIconValue } from "../../shared/databaseIcons";
import type { RowVisualTags } from "../../shared/visualTags";
import { useT } from "../i18n";
import { OptionIcon } from "./DatabaseIcon";
import { DEFAULT_OPTION_COLOR } from "./OptionEditMenu";

export function VisualTagsCell({
  column,
  value,
  tags,
  compact = false,
}: {
  column: DatabaseColumn;
  value: string | null;
  tags?: RowVisualTags;
  compact?: boolean;
}) {
  const t = useT();
  const ids = decodeMultiSelect(value);
  if (!ids.length)
    return (
      <span className="visual-tags-cell is-empty" data-testid="visual-tags-cell">
        <span className="muted">{tags?.review === "empty" ? t("Revisada, sin elementos") : t("Sin revisar")}</span>
      </span>
    );
  return (
    <span className={`visual-tags-cell chips${compact ? " is-compact" : ""}`} data-testid="visual-tags-cell" data-tooltip={t("Se rellena desde «Etiquetado» en el visor de la imagen")}>
      {ids.map((id) => {
        const option = column.options.find((o) => o.id === id);
        if (!option) return null;
        const n = tags?.counts[id] ?? 1;
        return (
          <span key={id} className="chip" style={{ "--chip": option.color ?? DEFAULT_OPTION_COLOR } as React.CSSProperties}>
            <OptionIcon value={optionIconValue(column.config, id)} size={11} />
            {option.label}
            {n > 1 && <b className="visual-tags-count">×{n}</b>}
          </span>
        );
      })}
    </span>
  );
}

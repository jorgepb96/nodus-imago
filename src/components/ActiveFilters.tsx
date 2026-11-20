// What a calculation is made over: the filters, filter groups and search box
// active in the database view, written out so a figure is never read
// without knowing which records it counts.
import { Filter, Search } from "lucide-react";
import type { DatabaseColumn, DatabaseDetail } from "../../shared/databases";
import type { PropertyFilter, PropertyFilterGroup, SearchInput } from "../../shared/imago";
import { FILTER_LABELS, filterNeedsValue, isFilterReady } from "../../shared/viewCriteria";
import { heritageScheme, isHeritageColumn, typology } from "../../shared/heritage";
import { useLanguage, useT } from "../i18n";

function valueLabel(column: DatabaseColumn | undefined, op: PropertyFilter["op"], value: string, language: string) {
  if (!column) return value;
  if (isHeritageColumn(column) && (op === "heritage_group" || op === "heritage_type")) {
    const [group, type] = value.split("/");
    const info = typology(heritageScheme(column.config), group, type ?? null, language);
    return (op === "heritage_type" ? info?.type : info?.group) ?? value;
  }
  return column.options.find((o) => o.id === value)?.label ?? value;
}

export function ActiveFilters({ detail, search, records }: { detail: DatabaseDetail; search: SearchInput; records?: number }) {
  const t = useT(),
    language = useLanguage();
  const describe = (f: PropertyFilter) => {
    const column = detail.columns.find((c) => c.id === f.columnId);
    const values = filterNeedsValue(f.op) ? (Array.isArray(f.value) ? f.value : [f.value]).map((v) => valueLabel(column, f.op, v, language)) : [];
    const joined = f.op === "between" ? values.join(" – ") : values.join(", ");
    return [column?.name ?? f.columnId, t(FILTER_LABELS[f.op]).toLocaleLowerCase(), joined].filter(Boolean).join(" ");
  };
  const flatten = (groups: PropertyFilterGroup[] = []): string[] =>
    groups.flatMap((g) => {
      const inner = [...g.filters.filter(isFilterReady).map(describe), ...flatten(g.groups)];
      return inner.length ? [`(${inner.join(g.logic === "or" ? ` ${t("o")} ` : ` ${t("y")} `)})`] : [];
    });
  const parts = [...(search.filters ?? []).filter(isFilterReady).map(describe), ...flatten(search.filterGroups)];
  const query = search.query?.trim();
  const joiner = search.filterLogic === "or" ? ` ${t("o")} ` : ` · `;
  return (
    <p className={`active-filters ${parts.length || query ? "is-filtered" : ""}`} data-testid="active-filters">
      <Filter size={13} aria-hidden="true" />
      {typeof records === "number" && (
        <span>
          <b>{records.toLocaleString()}</b> {t("registros")} ·{" "}
        </span>
      )}
      {parts.length || query ? (
        <>
          <span>{t("Filtros activos")}:</span>
          {parts.length > 0 && <span className="active-filters-list">{parts.join(joiner)}</span>}
          {query && (
            <span className="active-filters-query">
              <Search size={12} aria-hidden="true" /> «{query}»
            </span>
          )}
        </>
      ) : (
        <span>{t("Sin filtros: toda la base de datos")}</span>
      )}
    </p>
  );
}

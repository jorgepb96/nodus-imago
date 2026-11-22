// What a calculation is made over: the filters, filter groups and search box
// active in the database view, written out so a figure is never read
// without knowing which records it counts. Linked records and people are
// named by their titles, and long lists of values are shortened.
import { useEffect, useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";
import type { DatabaseColumn, DatabaseDetail } from "../../shared/databases";
import type { PropertyFilter, PropertyFilterGroup, SearchInput } from "../../shared/imago";
import { FILTER_LABELS, filterKind, filterNeedsValue, isFilterReady } from "../../shared/viewCriteria";
import { heritageScheme, isHeritageColumn, typology } from "../../shared/heritage";
import { useLanguage, useT } from "../i18n";

/** Values shown per condition before «and N more». */
const SHOWN_VALUES = 8;

function valueLabel(
  column: DatabaseColumn | undefined,
  op: PropertyFilter["op"],
  value: string,
  language: string,
  titles: Map<string, string>,
) {
  if (!column) return value;
  if (isHeritageColumn(column) && (op === "heritage_group" || op === "heritage_type")) {
    const [group, type] = value.split("/");
    const info = typology(heritageScheme(column.config), group, type ?? null, language);
    return (op === "heritage_type" ? info?.type : info?.group) ?? value;
  }
  return column.options.find((o) => o.id === value)?.label ?? titles.get(`${column.id}:${value}`) ?? value;
}

/** Every ready condition, groups included. */
const allFilters = (filters: PropertyFilter[] = [], groups: PropertyFilterGroup[] = []): PropertyFilter[] => [
  ...filters.filter(isFilterReady),
  ...groups.flatMap((g) => allFilters(g.filters, g.groups)),
];

export function ActiveFilters({ detail, search, records }: { detail: DatabaseDetail; search: SearchInput; records?: number }) {
  const t = useT(),
    language = useLanguage(),
    [expanded, setExpanded] = useState(false);
  // Relations and people are stored by id: ask for their titles, per property.
  const wanted = useMemo(() => {
    const byColumn = new Map<string, Set<string>>();
    for (const f of allFilters(search.filters, search.filterGroups)) {
      const column = detail.columns.find((c) => c.id === f.columnId);
      if (!column || !filterNeedsValue(f.op) || !["relation", "person"].includes(filterKind(column))) continue;
      const set = byColumn.get(column.id) ?? byColumn.set(column.id, new Set()).get(column.id)!;
      for (const v of Array.isArray(f.value) ? f.value : [f.value]) if (v) set.add(String(v));
    }
    return [...byColumn].map(([columnId, values]) => ({ columnId, values: [...values].slice(0, 1000) }));
  }, [detail.columns, search.filters, search.filterGroups]);
  const wantedKey = JSON.stringify(wanted);
  const [titles, setTitles] = useState(() => new Map<string, string>());
  useEffect(() => {
    if (!wanted.length) return;
    let alive = true;
    void Promise.all(
      wanted.map(({ columnId, values }) =>
        window.imago
          .call("propertyChoices", { columnIds: [columnId], query: "", offset: 0, selected: values })
          .then((result) => result.selections.map((s) => [`${columnId}:${s.value}`, s.label] as [string, string]))
          .catch(() => [] as [string, string][]),
      ),
    ).then((lists) => alive && setTitles(new Map(lists.flat())));
    return () => {
      alive = false;
    };
    // The key carries the values asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  // Some condition has more values than are shown at first.
  const long = allFilters(search.filters, search.filterGroups).some(
    (f) => f.op !== "between" && filterNeedsValue(f.op) && Array.isArray(f.value) && f.value.length > SHOWN_VALUES + 1,
  );
  const describe = (f: PropertyFilter) => {
    const column = detail.columns.find((c) => c.id === f.columnId);
    const values = filterNeedsValue(f.op)
      ? (Array.isArray(f.value) ? f.value : [f.value]).map((v) => valueLabel(column, f.op, String(v), language, titles))
      : [];
    let joined: string;
    if (f.op === "between") joined = values.join(" – ");
    else if (!expanded && values.length > SHOWN_VALUES + 1) {
      joined = `${values.slice(0, SHOWN_VALUES).join(", ")} ${t("y {n} más").replace("{n}", (values.length - SHOWN_VALUES).toLocaleString())}`;
    } else joined = values.join(", ");
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
          {long && (
            <button type="button" className="active-filters-more" onClick={() => setExpanded(!expanded)}>
              {t(expanded ? "Ver menos" : "Ver todos")}
            </button>
          )}
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

import type { DatabaseColumn } from "./databases";
import { rollupResultKind } from "./databases";
import { comparableType, formulaValueKind } from "./databaseFormula";
import type {
  PropertyFilter,
  PropertyFilterGroup,
  PropertyFilterOp,
  ViewSort,
} from "./imago";

export const FILTER_LABELS: Record<PropertyFilterOp, string> = {
  contains: "Contiene",
  not_contains: "No contiene",
  starts_with: "Empieza por",
  ends_with: "Termina en",
  equals: "Es igual a",
  not_equals: "No es igual a",
  gt: "Mayor que",
  gte: "Mayor o igual que",
  lt: "Menor que",
  lte: "Menor o igual que",
  between: "Está entre",
  any: "Es cualquiera de",
  all: "Incluye todos",
  none: "No es ninguno de",
  empty: "Está vacío",
  not_empty: "No está vacío",
  checked: "Está marcado",
  unchecked: "No está marcado",
  relative_date: "Fecha relativa",
  has_coordinates: "Tiene coordenadas",
  no_coordinates: "No tiene coordenadas",
};
export const RELATIVE_DATES = [
  ["today", "Hoy"],
  ["yesterday", "Ayer"],
  ["tomorrow", "Mañana"],
  ["this_week", "Esta semana"],
  ["last_week", "La semana pasada"],
  ["next_week", "La próxima semana"],
  ["this_month", "Este mes"],
  ["last_month", "El mes pasado"],
  ["next_month", "El próximo mes"],
  ["this_year", "Este año"],
  ["last_7", "Últimos 7 días"],
  ["last_30", "Últimos 30 días"],
  ["last_90", "Últimos 90 días"],
] as const;
export const SORT_META = [
  ["$title", "Título"],
  ["$created", "Fecha de incorporación"],
  ["$modified", "Última modificación"],
  ["$images", "Número de imágenes"],
  ["$position", "Orden original"],
] as const;
export function filterKind(
  column: DatabaseColumn,
):
  | "text"
  | "number"
  | "date"
  | "time"
  | "options"
  | "checkbox"
  | "files"
  | "relation"
  | "person"
  | "location" {
  if (
    column.type === "location" ||
    column.type === "person" ||
    column.type === "relation" ||
    column.type === "time"
  )
    return column.type;
  if (["created_by", "last_edited_by"].includes(column.type)) return "person";
  if (["attachment", "files", "ai_image"].includes(column.type)) return "files";
  if (column.type === "formula") {
    const result = formulaValueKind(column.config.formula);
    if (result === "boolean") return "checkbox";
    if (result === "date" || result === "number" || result === "person")
      return result;
  }
  if (column.type === "rollup" && column.config.rollupFunction) {
    const result = rollupResultKind(column.config.rollupFunction);
    if (result === "number" || result === "date") return result;
  }
  const type = comparableType(column);
  if (type === "number" || type === "date" || type === "checkbox") return type;
  if (type === "select" || type === "multi_select") return "options";
  return "text";
}
export function filterOperators(column: DatabaseColumn): PropertyFilterOp[] {
  const empty: PropertyFilterOp[] = ["empty", "not_empty"];
  switch (filterKind(column)) {
    case "checkbox":
      return ["checked", "unchecked"];
    case "number":
      return [
        "equals",
        "not_equals",
        "gt",
        "gte",
        "lt",
        "lte",
        "between",
        ...empty,
      ];
    case "date":
      return [
        "equals",
        "not_equals",
        "lt",
        "lte",
        "gt",
        "gte",
        "between",
        "relative_date",
        ...empty,
      ];
    case "time":
      return ["equals", "not_equals", "lt", "gt", "between", ...empty];
    case "options":
      return [
        "any",
        ...(column.type === "multi_select" ? ["all" as const] : []),
        "none",
        ...empty,
      ];
    case "files":
      return [...empty, "equals", "gt", "gte", "lt", "lte", "between"];
    case "person":
    case "relation":
      return ["any", "all", "none", ...empty];
    case "location":
      return [
        "contains",
        "not_contains",
        "equals",
        "not_equals",
        "any",
        "none",
        "has_coordinates",
        "no_coordinates",
        ...empty,
      ];
    default:
      return [
        "contains",
        "not_contains",
        "equals",
        "not_equals",
        "starts_with",
        "ends_with",
        "any",
        "none",
        ...empty,
      ];
  }
}
export function filterNeedsValue(op: PropertyFilterOp) {
  return ![
    "empty",
    "not_empty",
    "checked",
    "unchecked",
    "has_coordinates",
    "no_coordinates",
  ].includes(op);
}
export function isFilterReady(filter: PropertyFilter) {
  if (filter.disabled) return false;
  if (!filterNeedsValue(filter.op)) return true;
  if (filter.op === "between")
    return (
      Array.isArray(filter.value) &&
      filter.value.length === 2 &&
      filter.value.every((value) => value.trim() !== "")
    );
  return Array.isArray(filter.value)
    ? filter.value.length > 0
    : filter.value.trim() !== "";
}
export function activeFilterCount(
  filters: PropertyFilter[],
  groups: PropertyFilterGroup[] = [],
): number {
  return (
    filters.filter(isFilterReady).length +
    groups.reduce(
      (total, group) => total + activeFilterCount(group.filters, group.groups),
      0,
    )
  );
}
export function relativeDateRange(
  preset: string,
  now = new Date(),
): [string, string] {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start = new Date(day),
    end = new Date(day);
  const shift = (date: Date, count: number) =>
    date.setDate(date.getDate() + count);
  if (preset === "yesterday") {
    shift(start, -1);
    shift(end, -1);
  } else if (preset === "tomorrow") {
    shift(start, 1);
    shift(end, 1);
  } else if (["this_week", "last_week", "next_week"].includes(preset)) {
    shift(
      start,
      -((day.getDay() + 6) % 7) +
        (preset === "last_week" ? -7 : preset === "next_week" ? 7 : 0),
    );
    end = new Date(start);
    shift(end, 6);
  } else if (["this_month", "last_month", "next_month"].includes(preset)) {
    start = new Date(
      day.getFullYear(),
      day.getMonth() +
        (preset === "last_month" ? -1 : preset === "next_month" ? 1 : 0),
      1,
    );
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  } else if (preset === "this_year") {
    start = new Date(day.getFullYear(), 0, 1);
    end = new Date(day.getFullYear(), 11, 31);
  } else if (["last_7", "last_30", "last_90"].includes(preset))
    shift(start, -(Number(preset.slice(5)) - 1));
  else if (preset !== "today") throw new Error("Intervalo relativo no válido.");
  const iso = (date: Date) =>
    `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return [iso(start), iso(end)];
}
export type ViewCriteria = {
  filters: PropertyFilter[];
  logic: "and" | "or";
  groups: PropertyFilterGroup[];
  sorts: ViewSort[];
};
export function pruneViewCriteria(
  criteria: ViewCriteria,
  columns: Set<string>,
): ViewCriteria {
  const exists = (id: string) =>
    columns.has(id) || SORT_META.some(([key]) => key === id);
  const filters = (items: PropertyFilter[]) =>
    items.flatMap((item) => {
      if (item.columnIds) {
        const ids = item.columnIds.filter(exists);
        return ids.length
          ? [{ ...item, columnId: ids[0], columnIds: ids }]
          : [];
      }
      return exists(item.columnId) ? [item] : [];
    });
  const groups = (items: PropertyFilterGroup[]): PropertyFilterGroup[] =>
    items.map((item) => ({
      ...item,
      filters: filters(item.filters),
      groups: groups(item.groups ?? []),
    }));
  return {
    ...criteria,
    filters: filters(criteria.filters),
    groups: groups(criteria.groups),
    sorts: criteria.sorts.filter((item) => exists(item.columnId)),
  };
}
/** Local UI preferences are bounded and validated before reaching IPC. */
export function restoreViewCriteria(raw: string | null): ViewCriteria {
  const empty: ViewCriteria = {
    filters: [],
    logic: "and",
    groups: [],
    sorts: [],
  };
  if (!raw) return empty;
  try {
    const value = JSON.parse(raw);
    let budget = 150;
    const readFilters = (items: unknown): PropertyFilter[] => {
      if (!Array.isArray(items)) return [];
      const result: PropertyFilter[] = [];
      for (const item of items.slice(0, 100)) {
        if (budget <= 0) break;
        if (
          !item ||
          typeof item.columnId !== "string" ||
          !item.columnId.length ||
          item.columnId.length > 200 ||
          !Object.hasOwn(FILTER_LABELS, item.op)
        )
          continue;
        if (
          typeof item.value !== "string" &&
          !(
            Array.isArray(item.value) &&
            item.value.every((value: unknown) => typeof value === "string")
          )
        )
          continue;
        const ids = Array.isArray(item.columnIds)
          ? (item.columnIds
              .filter(
                (id: unknown) =>
                  typeof id === "string" && id.length > 0 && id.length <= 200,
              )
              .slice(0, 100) as string[])
          : undefined;
        result.push({
          columnId: item.columnId,
          op: item.op,
          value:
            typeof item.value === "string"
              ? item.value.slice(0, 10000)
              : item.value
                  .slice(0, 1000)
                  .map((value: string) => value.slice(0, 10000)),
          ...(typeof item.id === "string" &&
          item.id.length &&
          item.id.length <= 200
            ? { id: item.id }
            : {}),
          ...(item.disabled === true ? { disabled: true } : {}),
          ...(typeof item.databaseId === "string" &&
          item.databaseId.length &&
          item.databaseId.length <= 200
            ? { databaseId: item.databaseId }
            : {}),
          ...(typeof item.groupId === "string" &&
          item.groupId.length &&
          item.groupId.length <= 200
            ? { groupId: item.groupId }
            : {}),
          ...(ids?.length ? { columnIds: ids } : {}),
        });
        budget--;
      }
      return result;
    };
    const readGroups = (
      items: unknown,
      depth: number,
    ): PropertyFilterGroup[] => {
      if (depth > 2 || !Array.isArray(items)) return [];
      const result: PropertyFilterGroup[] = [];
      for (const item of items.slice(0, 20)) {
        if (budget <= 0) break;
        if (
          !item ||
          typeof item.id !== "string" ||
          !item.id.length ||
          item.id.length > 200
        )
          continue;
        budget--;
        result.push({
          id: item.id,
          logic: item.logic === "or" ? "or" : "and",
          filters: readFilters(item.filters),
          groups: readGroups(item.groups, depth + 1),
        });
      }
      return result;
    };
    const filters = readFilters(value.filters),
      groups = readGroups(value.groups, 0);
    return {
      filters,
      logic: value.logic === "or" ? "or" : "and",
      groups,
      sorts: Array.isArray(value.sorts)
        ? value.sorts
            .slice(0, 8)
            .filter(
              (item: ViewSort) =>
                item &&
                typeof item.columnId === "string" &&
                item.columnId.length > 0 &&
                item.columnId.length <= 200 &&
                ["asc", "desc"].includes(item.direction),
            )
            .map((item: ViewSort) => ({
              columnId: item.columnId,
              direction: item.direction,
            }))
        : [],
    };
  } catch {
    return empty;
  }
}

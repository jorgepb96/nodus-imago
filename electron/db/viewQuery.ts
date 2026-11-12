import type Database from "better-sqlite3";
import type { DatabaseColumn } from "../../shared/databases";
import {
  databasePropertyPlainText,
  decodeDatabaseDate,
  decodeDatabaseLocation,
  decodeDatabasePeople,
} from "../../shared/databaseProperties";
import { validCoordinates } from "../../shared/places";
import {
  filterKind,
  filterOperators,
  isFilterReady,
  relativeDateRange,
} from "../../shared/viewCriteria";
import type {
  PropertyFilter,
  PropertyFilterGroup,
  SearchInput,
  ViewSort,
} from "../../shared/imago";

const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
export const fold = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
export function installViewFunctions(db: Database.Database) {
  db.function("imago_fold", { deterministic: true }, fold);
  db.function(
    "imago_text",
    { deterministic: true },
    (type: unknown, raw: unknown) =>
      databasePropertyPlainText(String(type), raw == null ? null : String(raw)),
  );
  db.function("imago_number", { deterministic: true }, (raw: unknown) =>
    raw === "true"
      ? 1
      : raw === "false"
        ? 0
        : raw == null ||
            String(raw).trim() === "" ||
            !Number.isFinite(Number(raw))
          ? null
          : Number(raw),
  );
  db.function(
    "imago_date",
    { deterministic: true },
    (raw: unknown) =>
      decodeDatabaseDate(raw == null ? null : String(raw))?.start ?? null,
  );
  db.function("imago_people", { deterministic: true }, (raw: unknown) =>
    JSON.stringify(decodeDatabasePeople(raw == null ? null : String(raw))),
  );
  db.function("imago_coordinates", { deterministic: true }, (raw: unknown) =>
    validCoordinates(decodeDatabaseLocation(raw == null ? null : String(raw)))
      ? 1
      : 0,
  );
  // Natural alphabetical ordering: an identifier such as IMG2 precedes IMG10.
  db.function("imago_sort_text", { deterministic: true }, (raw: unknown) =>
    fold(raw).replace(/\d+/g, (digits) => digits.padStart(24, "0")),
  );
}

export function metaColumn(id: string, databaseId = ""): DatabaseColumn | null {
  const type =
    id === "$created"
      ? "created_time"
      : id === "$modified"
        ? "last_edited_time"
        : id === "$images" || id === "$position"
          ? "number"
          : id === "$title"
            ? "title"
            : null;
  return type
    ? { id, databaseId, name: id, type, position: 0, config: {}, options: [] }
    : null;
}
export function rawValue(column: DatabaseColumn) {
  const id = quote(column.id);
  if (column.id === "$created") return "r.created_at";
  if (column.id === "$modified") return "r.updated_at";
  if (column.id === "$position") return "r.position";
  if (column.id === "$images")
    return "(SELECT count(*) FROM image_assets a WHERE a.row_id=r.id)";
  if (column.id === "$title")
    return "(SELECT c.value_text FROM db_cells c JOIN db_columns p ON p.id=c.column_id WHERE c.row_id=r.id AND p.type='title' LIMIT 1)";
  const stored = `(SELECT c.value_text FROM db_cells c WHERE c.row_id=r.id AND c.column_id=${id})`;
  if (column.type === "created_time") return `coalesce(${stored},r.created_at)`;
  if (column.type === "last_edited_time")
    return `coalesce(${stored},r.updated_at)`;
  if (column.type === "unique_id")
    return `coalesce(${stored},${quote(String(column.config.uniqueIdPrefix ?? ""))}||r.id)`;
  return stored;
}
function valueExpression(column: DatabaseColumn) {
  const raw = rawValue(column),
    id = quote(column.id),
    kind = filterKind(column);
  if (kind === "files")
    return `(SELECT count(*) FROM image_assets a WHERE a.row_id=r.id AND a.column_id=${id})`;
  if (kind === "relation")
    return `(SELECT count(*) FROM db_relations a WHERE a.row_id=r.id AND a.column_id=${id})`;
  if (kind === "number" || kind === "checkbox") return `imago_number(${raw})`;
  if (kind === "date")
    return ["created_time", "last_edited_time"].includes(column.type)
      ? `date(${raw},'localtime')`
      : `substr(imago_date(${raw}),1,10)`;
  if (kind === "options") return raw;
  return `imago_text(${quote(column.type)},${raw})`;
}
type Clause = { sql: string; applies: string };
export function compileViewFilters(
  input: SearchInput,
  resolve: (id: string) => DatabaseColumn,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const columnCondition = (
    column: DatabaseColumn,
    filter: PropertyFilter,
  ): string => {
    const { op } = filter,
      kind = filterKind(column),
      raw = rawValue(column),
      expr = valueExpression(column);
    if (
      !filterOperators(column).includes(op) &&
      !["contains", "empty", "not_empty", "equals", "gte", "lte"].includes(op)
    )
      throw new Error("Esta condición no corresponde al tipo de propiedad.");
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    const bind = (value: unknown) => {
      params.push(value);
      return "?";
    };
    const empty =
      kind === "files" || kind === "relation"
        ? `${expr}=0`
        : column.type === "multi_select"
          ? `json_array_length(CASE WHEN json_valid(${raw}) THEN ${raw} ELSE '[]' END)=0`
          : kind === "person"
            ? `json_array_length(imago_people(${raw}))=0`
            : `(${expr} IS NULL OR ${expr}='')`;
    if (op === "empty") return empty;
    if (op === "not_empty") return `NOT (${empty})`;
    if (op === "has_coordinates" || op === "no_coordinates")
      return `imago_coordinates(${raw})=${op === "has_coordinates" ? 1 : 0}`;
    if (op === "checked" || op === "unchecked")
      return `coalesce(${expr},0)${op === "checked" ? "<>" : "="}0`;
    if (op === "relative_date") {
      const [start, end] = relativeDateRange(values[0]);
      return `${expr} BETWEEN ${bind(start)} AND ${bind(end)}`;
    }
    if (["any", "all", "none"].includes(op)) {
      const wanted = bind(JSON.stringify([...new Set(values)]));
      let match: string;
      if (column.type === "multi_select" || kind === "person") {
        const source =
          kind === "person"
            ? `imago_people(${raw})`
            : `CASE WHEN json_valid(${raw}) THEN ${raw} ELSE '[]' END`;
        const item =
          kind === "person" ? "json_extract(j.value,'$.id')" : "j.value";
        match =
          op === "all"
            ? `NOT EXISTS(SELECT 1 FROM json_each(${wanted}) wanted WHERE NOT EXISTS(SELECT 1 FROM json_each(${source}) j WHERE ${item}=wanted.value))`
            : `EXISTS(SELECT 1 FROM json_each(${source}) j JOIN json_each(${wanted}) wanted ON ${item}=wanted.value)`;
      } else if (kind === "relation") {
        const membership = `EXISTS(SELECT 1 FROM db_relations d WHERE d.row_id=r.id AND d.column_id=${quote(column.id)} AND d.target_id=wanted.value)`;
        match =
          op === "all"
            ? `NOT EXISTS(SELECT 1 FROM json_each(${wanted}) wanted WHERE NOT (${membership}))`
            : `EXISTS(SELECT 1 FROM json_each(${wanted}) wanted WHERE ${membership})`;
      } else {
        match =
          op === "all"
            ? `NOT EXISTS(SELECT 1 FROM json_each(${wanted}) wanted WHERE imago_fold(${expr})<>imago_fold(wanted.value))`
            : `imago_fold(${expr}) IN(SELECT imago_fold(value) FROM json_each(${wanted}))`;
      }
      return op === "none" ? `NOT coalesce((${match}),0)` : match;
    }
    if (["contains", "not_contains", "starts_with", "ends_with"].includes(op)) {
      const escaped = escapeLike(fold(values[0]));
      const pattern =
        op === "starts_with"
          ? escaped + "%"
          : op === "ends_with"
            ? "%" + escaped
            : "%" + escaped + "%";
      const positive = `imago_fold(${expr}) LIKE ${bind(pattern)} ESCAPE '\\'`;
      return op === "not_contains" ? `NOT coalesce((${positive}),0)` : positive;
    }
    const numeric =
      kind === "number" || kind === "files" || kind === "relation";
    const operand = (value: string) => {
      if (numeric) {
        const n = Number(value);
        if (!Number.isFinite(n) || !value.trim())
          throw new Error("Filtro numérico no válido.");
        return n;
      }
      return kind === "date" || kind === "time" || kind === "options"
        ? value
        : fold(value);
    };
    const comparable =
      numeric || ["date", "time", "options"].includes(kind)
        ? expr
        : `imago_fold(${expr})`;
    if (op === "between") {
      const from = operand(values[0]),
        to = operand(values[1]);
      if (
        typeof from === "number" && typeof to === "number"
          ? from > to
          : String(from) > String(to)
      )
        throw new Error(
          "El inicio del intervalo debe ser anterior o igual al final.",
        );
      return `${comparable} BETWEEN ${bind(from)} AND ${bind(to)}`;
    }
    const symbol = {
      equals: "=",
      not_equals: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    }[op as "equals"];
    if (!symbol) throw new Error("Condición de filtro no válida.");
    return `${comparable} ${symbol} ${bind(operand(values[0]))}`;
  };
  const leaf = (filter: PropertyFilter): Clause => {
    const source = filter.columnIds ?? [filter.columnId];
    const columns = source.flatMap((id) => {
      try {
        return [metaColumn(id, filter.databaseId) ?? resolve(id)];
      } catch (error) {
        if (filter.columnIds) return [];
        throw error;
      }
    });
    if (!columns.length) return { applies: "1", sql: "0" };
    if (
      filter.databaseId &&
      columns.some((column) => column.databaseId !== filter.databaseId)
    )
      throw new Error("Filtro de otra base de datos.");
    const negative = [
      "empty",
      "not_contains",
      "not_equals",
      "none",
      "no_coordinates",
    ].includes(filter.op);
    const clauses = columns.map((column) => {
      const scope =
        filter.columnIds || filter.databaseId ? column.databaseId : "";
      const applies = scope ? `r.database_id=${quote(scope)}` : "1";
      return { applies, sql: columnCondition(column, filter) };
    });
    if (clauses.length === 1) return clauses[0];
    return {
      applies: "(" + clauses.map((part) => part.applies).join(" OR ") + ")",
      sql:
        "(" +
        clauses
          .map((part) =>
            negative
              ? `(NOT (${part.applies}) OR coalesce((${part.sql}),0))`
              : `((${part.applies}) AND coalesce((${part.sql}),0))`,
          )
          .join(negative ? " AND " : " OR ") +
        ")",
    };
  };
  const group = (
    filters: PropertyFilter[],
    groups: PropertyFilterGroup[],
    logic: "and" | "or",
  ): Clause => {
    const children = [
      ...filters.filter(isFilterReady).map(leaf),
      ...groups.map((item) =>
        group(item.filters, item.groups ?? [], item.logic),
      ),
    ].filter((item) => item.applies !== "0");
    if (!children.length) return { sql: "1", applies: "0" };
    return {
      applies: "(" + children.map((child) => child.applies).join(" OR ") + ")",
      sql:
        "(" +
        children
          .map((child) =>
            logic === "or"
              ? `((${child.applies}) AND coalesce((${child.sql}),0))`
              : `(NOT (${child.applies}) OR coalesce((${child.sql}),0))`,
          )
          .join(logic === "or" ? " OR " : " AND ") +
        ")",
    };
  };
  const result = group(
    input.filters ?? [],
    input.filterGroups ?? [],
    input.filterLogic ?? "and",
  );
  return {
    sql:
      result.applies === "0"
        ? ""
        : `(NOT (${result.applies}) OR ${result.sql})`,
    params,
  };
}

export function compileViewSorts(
  sorts: ViewSort[],
  resolve: (id: string) => DatabaseColumn,
) {
  return sorts
    .map((sort) => {
      const column = metaColumn(sort.columnId) ?? resolve(sort.columnId),
        raw = rawValue(column),
        kind = filterKind(column);
      let expr = valueExpression(column);
      if (kind === "date") expr = `julianday(imago_date(${raw}))`;
      else if (kind === "options") {
        expr =
          column.type === "multi_select"
            ? `(SELECT min(o.position) FROM db_select_options o JOIN json_each(CASE WHEN json_valid(${raw}) THEN ${raw} ELSE '[]' END) j ON j.value=o.id WHERE o.column_id=${quote(column.id)})`
            : `(SELECT o.position FROM db_select_options o WHERE o.column_id=${quote(column.id)} AND o.id=${raw})`;
      } else if (!["number", "checkbox", "files", "relation"].includes(kind))
        expr = `imago_sort_text(${expr})`;
      return `(${expr} IS NULL OR ${expr}='') ASC,${expr} ${sort.direction === "desc" ? "DESC" : "ASC"}`;
    })
    .concat("r.position ASC,r.id ASC")
    .join(",");
}

export function propertyChoices(
  db: Database.Database,
  columnIds: string[],
  query: string,
  offset: number,
  resolve: (id: string) => DatabaseColumn,
  selected: string[] = [],
) {
  const parts = columnIds.map((id) => {
    const column = resolve(id),
      raw = "c.value_text",
      col = quote(column.id),
      kind = filterKind(column);
    if (kind === "relation")
      return `SELECT d.target_id value,coalesce(NULLIF(t.value_text,''),NULLIF(d.label,''),d.target_id) label FROM db_relations d LEFT JOIN db_columns p ON p.database_id=(SELECT database_id FROM db_rows WHERE id=d.target_id) AND p.type='title' LEFT JOIN db_cells t ON t.row_id=d.target_id AND t.column_id=p.id WHERE d.column_id=${col}`;
    if (kind === "person")
      return `SELECT json_extract(j.value,'$.id') value,json_extract(j.value,'$.label') label FROM db_cells c,json_each(imago_people(${raw})) j WHERE c.column_id=${col}`;
    if (kind === "options") {
      if (column.type === "multi_select")
        return `SELECT o.id value,o.label label FROM db_cells c,json_each(CASE WHEN json_valid(${raw}) THEN ${raw} ELSE '[]' END) j JOIN db_select_options o ON o.id=j.value WHERE c.column_id=${col}`;
      return `SELECT o.id value,o.label label FROM db_cells c JOIN db_select_options o ON o.id=c.value_text WHERE c.column_id=${col}`;
    }
    return `SELECT imago_text(${quote(column.type)},${raw}) value,imago_text(${quote(column.type)},${raw}) label FROM db_cells c WHERE c.column_id=${col}`;
  });
  const rows = db
    .prepare(
      `SELECT value,label,count(*) count FROM (${parts.join(" UNION ALL ")}) WHERE value IS NOT NULL AND length(value) BETWEEN 1 AND 10000 AND length(label)<=10000 AND imago_fold(label) LIKE ? ESCAPE '\\' GROUP BY value,label ORDER BY count DESC,imago_sort_text(label),value LIMIT 51 OFFSET ?`,
    )
    .all("%" + escapeLike(fold(query)) + "%", offset) as {
    value: string;
    label: string;
    count: number;
  }[];
  const selections = selected.length
    ? (db
        .prepare(
          `SELECT value,label,count(*) count FROM (${parts.join(" UNION ALL ")}) WHERE value IN (SELECT value FROM json_each(?)) GROUP BY value,label`,
        )
        .all(JSON.stringify(selected)) as {
        value: string;
        label: string;
        count: number;
      }[])
    : [];
  return { choices: rows.slice(0, 50), selections, more: rows.length > 50 };
}

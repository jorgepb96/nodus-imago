// The local MCP server: what it is set to, what it reports, and how a cell is
// shown to (and read back from) a connected model. Pure, so the conversions
// stay unit-tested without the app.
import type { DatabaseColumn, DatabaseRow } from "./databases";
import { decodeCheckbox, decodeMultiSelect, decodeNumber, encodeMultiSelect, encodeNumber } from "./databases";
import {
  decodeDatabaseButton,
  decodeDatabaseDate,
  decodeDatabaseLocation,
  decodeDatabasePeople,
  encodeDatabaseDate,
  encodeDatabaseLocation,
  encodeDatabasePeople,
} from "./databaseProperties";
import { decodeHistoricalDate, encodeHistoricalDate, parseHistoricalDate } from "./historicalDate";

/** Read only, or read and write (granted by the user after a confirmation). */
export type McpAccess = "read" | "write";
/** Next to Nodus Research (4319) without sharing its port. */
export const MCP_DEFAULT_PORT = 4329;
export const MCP_PATH = "/mcp";

export type McpConfig = {
  enabled: boolean;
  port: number;
  access: McpAccess;
};
export const MCP_DEFAULT_CONFIG: McpConfig = { enabled: false, port: MCP_DEFAULT_PORT, access: "read" };

/** One tool call, as the settings show it: no arguments, nothing from the data. */
export type McpActivity = {
  at: string;
  tool: string;
  ok: boolean;
  write: boolean;
  error?: string;
};

export type McpStatus = {
  config: McpConfig;
  running: boolean;
  port: number | null;
  url: string | null;
  error: string | null;
  /** The bearer token; shown in the settings so the user can copy it. */
  token: string;
  sessions: number;
  activity: McpActivity[];
};

export function mcpEndpoint(port: number) {
  return `http://127.0.0.1:${port}${MCP_PATH}`;
}

/** The same comparison Imago uses for option labels: NFKC, trimmed, lower case. */
export const optionKey = (label: string) => label.normalize("NFKC").trim().toLowerCase();

/** Types whose value Imago works out itself, or that hold files: never written by a model. */
export const MCP_READ_ONLY_TYPES = new Set([
  "formula",
  "rollup",
  "comparison",
  "unique_id",
  "created_time",
  "last_edited_time",
  "created_by",
  "last_edited_by",
  "attachment",
  "files",
  "ai_image",
  "button",
]);

const parseIds = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

/**
 * A cell as plain JSON for a model: labels instead of option ids, numbers as
 * numbers, dates as their parts. `images` are the record's images, for the
 * properties that hold them.
 */
export function mcpCellValue(
  column: DatabaseColumn,
  row: DatabaseRow & { images?: { id: string; columnId: string; fileName: string }[] },
): unknown {
  const raw = row.cells[column.id] ?? null;
  switch (column.type) {
    case "number":
      return decodeNumber(raw);
    case "checkbox":
      return decodeCheckbox(raw);
    case "select":
    case "status":
      return raw ? (column.options.find((o) => o.id === raw)?.label ?? null) : null;
    case "multi_select":
      return decodeMultiSelect(raw)
        .map((id) => column.options.find((o) => o.id === id)?.label)
        .filter((label): label is string => !!label);
    case "date": {
      const value = decodeDatabaseDate(raw);
      if (!value) return null;
      return value.end || value.includeTime ? { start: value.start, end: value.end, includeTime: value.includeTime } : value.start;
    }
    case "historical_date": {
      const value = decodeHistoricalDate(raw);
      return value ? { text: value.text, start: value.start, end: value.end, certainty: value.certainty } : null;
    }
    case "person":
    case "created_by":
    case "last_edited_by":
      return decodeDatabasePeople(raw).map((p) => p.label);
    case "location": {
      const value = decodeDatabaseLocation(raw);
      return value
        ? {
            name: value.name,
            address: value.address,
            latitude: value.latitude,
            longitude: value.longitude,
            ...(value.bearing != null ? { bearing: value.bearing } : {}),
          }
        : null;
    }
    case "relation":
      return parseIds(raw);
    case "rollup":
      return row.rollups?.[column.id] ?? raw;
    case "attachment":
    case "files":
    case "ai_image": {
      const images = (row.images ?? []).filter((image) => image.columnId === column.id);
      if (images.length) return images.map((image) => ({ imageId: image.id, fileName: image.fileName }));
      return (row.attachments?.[column.id] ?? []).map((a) => ({ imageId: a.id, fileName: a.fileName }));
    }
    case "button":
      return decodeDatabaseButton(raw).clicks;
    default:
      return raw;
  }
}

/** Labels a value names that the property does not have yet (select, status, multi_select). */
export function mcpMissingOptions(column: DatabaseColumn, value: unknown): string[] {
  if (!["select", "status", "multi_select"].includes(column.type)) return [];
  const known = new Set(column.options.flatMap((o) => [o.id, optionKey(o.label)]));
  const missing = new Map<string, string>();
  for (const label of optionInputs(value))
    if (!known.has(label) && !known.has(optionKey(label)) && !missing.has(optionKey(label))) missing.set(optionKey(label), label.trim());
  return [...missing.values()];
}

function optionInputs(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((v) => v.trim());
  if (typeof value === "string")
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  return [String(value)];
}

const textOf = (value: unknown, what: string): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error(`${what}: se esperaba un texto.`);
};

/**
 * What a model wrote, as the raw text Imago stores for the property. Options
 * are matched by label or id (they must exist: add the missing ones first);
 * relations take record ids.
 */
export function mcpEncodeValue(column: DatabaseColumn, value: unknown): string | null {
  const what = `«${column.name}» (${column.type})`;
  if (MCP_READ_ONLY_TYPES.has(column.type))
    throw new Error(`${what}: Imago calcula o adjunta este valor; no se puede escribir.`);
  if (value === null || value === undefined || value === "") return null;
  switch (column.type) {
    case "number": {
      const n = typeof value === "number" ? value : decodeNumber(textOf(value, what).replace(",", "."));
      if (n == null || !Number.isFinite(n)) throw new Error(`${what}: número no válido.`);
      return encodeNumber(n);
    }
    case "checkbox": {
      if (typeof value === "boolean") return value ? "1" : "0";
      const text = optionKey(textOf(value, what));
      if (["1", "true", "sí", "si", "yes", "x"].includes(text)) return "1";
      if (["0", "false", "no"].includes(text)) return "0";
      throw new Error(`${what}: se esperaba verdadero o falso.`);
    }
    case "select":
    case "status":
    case "multi_select": {
      const inputs = optionInputs(value);
      const ids = inputs.map((input) => {
        const option =
          column.options.find((o) => o.id === input) ?? column.options.find((o) => optionKey(o.label) === optionKey(input));
        if (!option) throw new Error(`${what}: la opción «${input}» no existe.`);
        return option.id;
      });
      if (column.type !== "multi_select") {
        if (ids.length > 1) throw new Error(`${what}: admite una sola opción.`);
        return ids[0] ?? null;
      }
      return encodeMultiSelect([...new Set(ids)]);
    }
    case "date": {
      if (typeof value === "object" && !Array.isArray(value)) {
        const v = value as { start?: unknown; end?: unknown; includeTime?: unknown };
        if (typeof v.start !== "string") throw new Error(`${what}: falta «start».`);
        return encodeDatabaseDate({
          start: v.start,
          end: typeof v.end === "string" ? v.end : null,
          includeTime: Boolean(v.includeTime) || v.start.includes("T"),
        });
      }
      const text = textOf(value, what).trim();
      if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(text))
        throw new Error(`${what}: usa el formato AAAA-MM-DD (para fechas aproximadas, una propiedad de fecha histórica).`);
      return encodeDatabaseDate({ start: text, end: null, includeTime: text.includes("T") });
    }
    case "historical_date": {
      if (typeof value === "object" && !Array.isArray(value)) {
        const v = value as { text?: unknown; start?: unknown; end?: unknown };
        const text = typeof v.text === "string" ? v.text.trim() : "";
        if (!text) throw new Error(`${what}: falta «text».`);
        const year = (n: unknown) => (typeof n === "number" && Number.isInteger(n) ? n : null);
        if (year(v.start) != null || year(v.end) != null) {
          const [start, end] = [year(v.start), year(v.end)];
          if (start != null && end != null && start > end) throw new Error(`${what}: el año inicial debe ser anterior o igual al final.`);
          return encodeHistoricalDate({ text, start, end, certainty: "exact", manual: true });
        }
        value = text;
      }
      const text = textOf(value, what).trim();
      const parsed = parseHistoricalDate(text);
      return encodeHistoricalDate({ text, start: parsed?.start ?? null, end: parsed?.end ?? null, certainty: parsed?.certainty ?? "exact" });
    }
    case "person": {
      const names = Array.isArray(value) ? value.map((v) => textOf(v, what)) : textOf(value, what).split(",");
      return encodeDatabasePeople(names.map((label) => ({ id: "", label: label.trim(), kind: "person" as const })));
    }
    case "location": {
      if (typeof value === "object" && !Array.isArray(value)) {
        const v = value as Record<string, unknown>;
        if (typeof v.name !== "string" || !v.name.trim()) throw new Error(`${what}: falta «name».`);
        const coordinate = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
        return encodeDatabaseLocation({
          name: v.name,
          address: typeof v.address === "string" ? v.address : null,
          latitude: coordinate(v.latitude),
          longitude: coordinate(v.longitude),
          ...(coordinate(v.bearing) != null ? { bearing: coordinate(v.bearing)! } : {}),
        });
      }
      return encodeDatabaseLocation({ name: textOf(value, what), address: null, latitude: null, longitude: null });
    }
    case "relation": {
      const ids = (Array.isArray(value) ? value : [value]).map((v) => textOf(v, what).trim()).filter(Boolean);
      return ids.length ? JSON.stringify([...new Set(ids)]) : null;
    }
    default:
      return textOf(value, what);
  }
}

/**
 * A filter value as the view query reads it: option labels become option ids
 * and people their ids; other values pass unchanged.
 */
export function mcpFilterValue(column: DatabaseColumn, value: string | string[]): string | string[] {
  const one = (input: string) => {
    if (["select", "status", "multi_select"].includes(column.type)) {
      const option =
        column.options.find((o) => o.id === input) ?? column.options.find((o) => optionKey(o.label) === optionKey(input));
      if (!option) throw new Error(`«${column.name}»: la opción «${input}» no existe.`);
      return option.id;
    }
    if (["person", "created_by", "last_edited_by"].includes(column.type) && !input.includes(":"))
      return `person:${input.toLocaleLowerCase()}`;
    return input;
  };
  return Array.isArray(value) ? value.map(one) : one(value);
}

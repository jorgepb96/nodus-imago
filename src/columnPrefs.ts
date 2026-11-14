// How a database's table looks on this device: column widths, hidden and
// frozen columns, wrapped text and the calculation shown under each column.
// The column order is data (saved with the database); these are view
// preferences, so they stay in this window's storage, one entry per database.
import { useCallback, useEffect, useState } from "react";
import type { DatabaseColumn, RollupFunction } from "../shared/databases";

export type ColumnPrefs = {
  widths: Record<string, number>;
  hidden: string[];
  /** Columns up to and including this one stay visible while scrolling. */
  freezeThrough: string | null;
  wrap: string[];
  calc: Record<string, RollupFunction>;
  /** Timeline: the property that dates records (null: detected) and its scale. */
  timelineColumn?: string | null;
  timelineBucket?: "auto" | "year" | "decade";
  /** Statistics: the saved statistic last open. */
  statistic?: string | null;
};
export const EMPTY_PREFS: ColumnPrefs = {
  widths: {},
  hidden: [],
  freezeThrough: null,
  wrap: [],
  calc: {},
};
const key = (id: string) => `imago.tableView.${id}`;
const legacyWidths = (id: string) => `imago.columnWidths.${id}`;

export function readColumnPrefs(databaseId: string): ColumnPrefs {
  try {
    const stored = localStorage.getItem(key(databaseId));
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ColumnPrefs>;
      return {
        widths: parsed.widths ?? {},
        hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
        freezeThrough: parsed.freezeThrough ?? null,
        wrap: Array.isArray(parsed.wrap) ? parsed.wrap : [],
        calc: parsed.calc ?? {},
        timelineColumn: parsed.timelineColumn ?? null,
        timelineBucket: parsed.timelineBucket ?? "auto",
        statistic: parsed.statistic ?? null,
      };
    }
    // Widths saved before the other preferences existed.
    const widths = JSON.parse(localStorage.getItem(legacyWidths(databaseId)) ?? "{}");
    return { ...EMPTY_PREFS, widths };
  } catch {
    return { ...EMPTY_PREFS };
  }
}

export function useColumnPrefs(databaseId: string | null) {
  const [prefs, setPrefs] = useState<ColumnPrefs>(EMPTY_PREFS);
  useEffect(() => {
    setPrefs(databaseId ? readColumnPrefs(databaseId) : EMPTY_PREFS);
  }, [databaseId]);
  /** Update in memory; `persist` (the default) also writes it to storage. */
  const update = useCallback(
    (change: (current: ColumnPrefs) => ColumnPrefs, persist = true) => {
      setPrefs((current) => {
        const next = change(current);
        if (persist && databaseId)
          try {
            localStorage.setItem(key(databaseId), JSON.stringify(next));
            localStorage.removeItem(legacyWidths(databaseId));
          } catch {
            /* Storage may be unavailable; the change still applies now. */
          }
        return next;
      });
    },
    [databaseId],
  );
  return [prefs, update] as const;
}

/** The title always shows: it is how a record is opened and recognised. */
export const canHide = (column: DatabaseColumn) => column.type !== "title";

export function visibleColumns(columns: DatabaseColumn[], prefs: ColumnPrefs) {
  const hidden = new Set(prefs.hidden);
  return columns.filter((c) => !canHide(c) || !hidden.has(c.id));
}

/** Calculations that make sense for a property type, in menu order. */
export function calculationsFor(column: DatabaseColumn): RollupFunction[] {
  const common: RollupFunction[] = [
    "count",
    "count_values",
    "count_empty",
    "count_unique",
    "percent_not_empty",
    "percent_empty",
  ];
  if (column.type === "checkbox")
    return ["count", "checked", "unchecked", "percent_checked", "percent_unchecked"];
  if (column.type === "number")
    return [...common, "sum", "average", "median", "min", "max", "range"];
  if (["date", "created_time", "last_edited_time"].includes(column.type))
    return [...common, "earliest_date", "latest_date", "date_range"];
  if (["attachment", "files", "relation", "button", "ai_image"].includes(column.type))
    return ["count", "count_values", "count_empty", "percent_not_empty", "percent_empty"];
  return common;
}

/** Types a property can be converted to from the column menu. */
export const CONVERTIBLE_TYPES = [
  "text",
  "rich_text",
  "number",
  "date",
  "time",
  "select",
  "status",
  "multi_select",
  "checkbox",
  "url",
  "email",
  "phone",
  "location",
] as const;

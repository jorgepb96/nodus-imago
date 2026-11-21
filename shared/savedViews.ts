// Views a researcher saves on a database: a kind of view (table, gallery,
// map…) with its filters and sort. They are not copies: the records stay in
// the same database, the view only remembers how to look at them.
import type { PropertyFilter, PropertyFilterGroup, ViewSort } from "./imago";

/** The views of a database, in tab order. */
export const DATABASE_VIEWS = ["table", "gallery", "map", "tree", "timeline", "stats", "variants", "network", "visualmap"] as const;
export type DatabaseViewId = (typeof DATABASE_VIEWS)[number];

export type SavedViewCriteria = {
  filters: PropertyFilter[];
  filterLogic: "and" | "or";
  filterGroups: PropertyFilterGroup[];
  sorts: ViewSort[];
};
export type SavedView = {
  id: string;
  databaseId: string;
  name: string;
  view: DatabaseViewId;
  criteria: SavedViewCriteria;
  position: number;
  createdAt: string;
  updatedAt: string;
};
/** How a saved view appears in a database's list of hidden views. */
export const savedViewKey = (id: string) => `saved:${id}`;
/** The key of a view in a database's preferences: a built-in id or «saved:<id>». */
export const viewKeyOf = (view: DatabaseViewId | SavedView) => (typeof view === "string" ? view : savedViewKey(view.id));
export const savedIdOf = (key: string | null | undefined) => (key?.startsWith("saved:") ? key.slice(6) : null);

/** Tab colours: no colour by default, or a hue in a pastel or a normal tone. */
export const VIEW_COLOR_HUES = ["gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink"] as const;
export type ViewColorHue = (typeof VIEW_COLOR_HUES)[number];
export const VIEW_COLOR_TONES = ["pastel", "normal"] as const;
export type ViewColorTone = (typeof VIEW_COLOR_TONES)[number];
export type ViewColor = `${ViewColorTone}:${ViewColorHue}`;
export const isViewColor = (value: unknown): value is ViewColor => {
  if (typeof value !== "string") return false;
  const [tone, hue] = value.split(":");
  return (VIEW_COLOR_TONES as readonly string[]).includes(tone) && (VIEW_COLOR_HUES as readonly string[]).includes(hue);
};

/**
 * The tabs in the order the researcher chose: the keys in `order` first (those
 * still offered), then any view not placed yet, in its natural order.
 */
export function orderViewKeys(order: readonly string[] | undefined, keys: readonly string[]): string[] {
  const offered = new Set(keys);
  const placed = [...new Set(order ?? [])].filter((key) => offered.has(key));
  const seen = new Set(placed);
  return [...placed, ...keys.filter((key) => !seen.has(key))];
}

/** Moves `key` before or after `target`; returns the full new order. */
export function moveViewKey(
  order: readonly string[] | undefined,
  keys: readonly string[],
  key: string,
  target: string,
  side: "before" | "after",
): string[] {
  const current = orderViewKeys(order, keys);
  if (key === target || !current.includes(key) || !current.includes(target)) return current;
  const rest = current.filter((k) => k !== key);
  const at = rest.indexOf(target) + (side === "after" ? 1 : 0);
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}

type Criteria = Pick<SavedViewCriteria, "filters" | "filterLogic" | "filterGroups">;
const isEmpty = (c: Criteria) => !c.filters.length && !c.filterGroups.length;
/** One side as conditions that can be joined with AND at the top level. */
function andParts(c: Criteria, id: string): { filters: PropertyFilter[]; groups: PropertyFilterGroup[] } {
  if (isEmpty(c)) return { filters: [], groups: [] };
  if (c.filterLogic === "and" || c.filters.length + c.filterGroups.length === 1)
    return { filters: c.filters, groups: c.filterGroups };
  return { filters: [], groups: [{ id, logic: "or", filters: c.filters, groups: c.filterGroups }] };
}
/**
 * The records a view shows when its data come from a saved view: those the
 * source keeps AND those the researcher's own filters keep. Without a source,
 * the researcher's criteria are returned unchanged.
 */
export function combineCriteria(source: Criteria | null | undefined, own: Criteria): Criteria {
  if (!source || isEmpty(source)) return { filters: own.filters, filterLogic: own.filterLogic, filterGroups: own.filterGroups };
  const a = andParts(source, "data-source"),
    b = andParts(own, "own-filters");
  return { filters: [...a.filters, ...b.filters], filterLogic: "and", filterGroups: [...a.groups, ...b.groups] };
}

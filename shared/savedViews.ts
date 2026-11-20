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

// The visual map of a database: every record with an indexed image placed on
// a plane by visual similarity, coloured by one of its properties.
export type VisualMapPoint = {
  rowId: string;
  assetId: string;
  title: string;
  x: number;
  y: number;
  /** Index in `legend` (categories) or a year (dates); null without a value. */
  value: number | null;
  /** Whether the record matches the view's filters and search. */
  shown: boolean;
};
export type VisualMap = {
  points: VisualMapPoint[];
  /** Records of the database, and those without an indexed image. */
  records: number;
  missing: number;
  mode: "none" | "category" | "year";
  /** Categories, most frequent first; the last may be «Otros». */
  legend: { label: string; count: number }[];
  years: { min: number; max: number } | null;
  /** The layout was calculated now rather than read from the store. */
  computed: boolean;
};
/** At most eight colours; the rest share «Otros». */
export const VISUAL_MAP_CATEGORIES = 8;

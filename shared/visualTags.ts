// Visual tags: regions drawn on an image, each naming what it shows with a
// tag («Persona», «Automóvil»). The tags are the options of one special
// multi-select property per database, «Etiquetas visuales», which Imago fills
// from the regions: every record lists its tags, most frequent first, and how
// many times each appears. Each region keeps where it came from (by hand
// today; a detector later), its confidence and whether it was validated.
import type { DatabaseColumn } from "./databases";

export const VISUAL_TAGS_NAME = "Etiquetas visuales";
export type VisualTagSource = "manual" | "ai";
export type VisualTagState = "pending" | "validated" | "rejected";
export type VisualTagRegion = {
  id: string;
  assetId: string;
  optionId: string;
  /** Where it is, as fractions of the image as shown (turned and cropped). */
  x: number;
  y: number;
  w: number;
  h: number;
  source: VisualTagSource;
  /** The model that proposed it, for regions found automatically. */
  model: string | null;
  confidence: number | null;
  state: VisualTagState;
  createdAt: string;
  updatedAt: string;
};
/** unreviewed: nobody looked yet; empty: looked, nothing to tag; tagged: at least one validated region. */
export type VisualReview = "unreviewed" | "empty" | "tagged";
/** A record's visual tags: appearances of each tag (validated regions) and its review. */
export type RowVisualTags = { counts: Record<string, number>; review: VisualReview };

export const isVisualTagsColumn = (c: Pick<DatabaseColumn, "type" | "config">) => c.type === "multi_select" && c.config.visualTags === true;

/** «Persona ×5, Automóvil ×2»: a record's tags with their appearances. */
export function visualTagsText(column: Pick<DatabaseColumn, "options">, tags: RowVisualTags | undefined, ids: string[]): string {
  return ids
    .map((id) => {
      const label = column.options.find((o) => o.id === id)?.label;
      if (!label) return "";
      const n = tags?.counts[id] ?? 1;
      return n > 1 ? `${label} ×${n}` : label;
    })
    .filter(Boolean)
    .join(", ");
}

/** How a database's images were tagged: review coverage, regions by source and state, and each tag. */
export type VisualTagsSummary = {
  columnId: string | null;
  columnName: string | null;
  images: number;
  reviewed: number;
  /** Images reviewed with nothing to tag. */
  reviewedEmpty: number;
  regions: { source: string; state: string; n: number }[];
  /** Each tag: its validated regions (appearances), the records and the images that hold it. */
  tags: { id: string; label: string; color: string | null; appearances: number; records: number; images: number }[];
};

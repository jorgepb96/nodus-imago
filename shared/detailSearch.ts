// A match of a searched detail; see electron/ai/detailSearch.ts.
export type DetailMatch = {
  assetId: string;
  rowId: string;
  title: string;
  databaseName: string;
  revision?: string;
  /** Cosine similarity with the detail (0–1). */
  score: number;
  /** The part of the image where the detail was found; null: the whole image. */
  box: { x: number; y: number; w: number; h: number } | null;
};

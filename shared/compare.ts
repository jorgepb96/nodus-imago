// What a comparison board holds; see electron/db/compare.ts.
export type CompareItem = {
  assetId: string;
  rowId: string;
  title: string;
  databaseId: string;
  databaseName: string;
  fileName: string;
  width: number;
  height: number;
  revision?: string;
  /** The record's date, from the property that most often holds one. */
  date: string | null;
  /** The year that stands for that date (the middle of a period). */
  year: number | null;
};
export type CompareBoard = { id: string; name: string; assetIds: string[]; createdAt: string; updatedAt: string };


// A value proposed for a record from its visually similar records; see
// electron/db/suggest.ts.
export type NeighbourSuggestion = {
  rowId: string;
  assetId: string;
  title: string;
  /** The value to store if accepted, and how it reads. */
  value: string;
  display: string;
  /** 0–1: agreement among the neighbours and how similar they are. */
  confidence: number;
  /** For dates: the range of the neighbours' years (20th–80th percentile). */
  spread?: [number, number];
  evidence: { rowId: string; assetId: string; value: string; similarity: number }[];
};
export const confidenceLevel = (c: number): "high" | "medium" | "low" => (c >= 0.7 ? "high" : c >= 0.45 ? "medium" : "low");

// Variants of an image across records; see electron/db/variants.ts.
import type { CompareItem } from "./compare";

export type Sensitivity = "strict" | "balanced" | "broad";
/**
 * How close two images must be. `bits`: most differing bits of the 128-bit
 * fingerprint; `cosine`: least similarity of the image vectors (null: vectors
 * are not used).
 */
export const SENSITIVITY: Record<Sensitivity, { bits: number; cosine: number | null }> = {
  strict: { bits: 8, cosine: null },
  balanced: { bits: 16, cosine: 0.93 },
  broad: { bits: 24, cosine: 0.88 },
};
export type VariantMember = CompareItem & {
  contentHash: string;
  /** identical: the same file; near: a copy or another scan; similar: a crop or retouched version. */
  match: "identical" | "near" | "similar";
};
export type VariantFamily = {
  id: string;
  members: VariantMember[];
  firstYear: number | null;
  lastYear: number | null;
  databases: string[];
};
export type VariantStatus = { images: number; missing: number; vectors: number };

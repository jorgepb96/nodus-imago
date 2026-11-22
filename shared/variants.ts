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
  // Vector candidates are then checked on the pixels (electron/db/cropMatch).
  balanced: { bits: 16, cosine: 0.9 },
  broad: { bits: 24, cosine: 0.86 },
};
export type VariantMember = CompareItem & {
  contentHash: string;
  /** identical: the same file; near: a copy or another scan; similar: a crop
   * or retouched version; confirmed: linked only by the researcher. */
  match: "identical" | "near" | "similar" | "confirmed";
};
export type VariantFamily = {
  id: string;
  members: VariantMember[];
  firstYear: number | null;
  lastYear: number | null;
  databases: string[];
};
export type VariantStatus = { images: number; missing: number; vectors: number };

/** What a researcher decided about two images: the same photograph or not. */
export type VariantVerdict = "same" | "different";
/** The researcher's name for how two versions of a photograph relate. */
export const VARIANT_KINDS = ["copy", "crop", "retouch", "reproduction", "other_take"] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];
export type ImageVariantMember = VariantMember & {
  /** auto: found by detection (or the same file); confirmed: only by a verdict. */
  origin: "auto" | "confirmed";
  verdict: VariantVerdict | null;
  kind: VariantKind | null;
};
/** The versions of one image: those kept and those the researcher rejected. */
export type ImageVariants = {
  assetId: string;
  contentHash: string;
  members: ImageVariantMember[];
  rejected: ImageVariantMember[];
};
/** Which property gives each part of an appearance, per database (null: detected). */
export type AppearanceFields = { work?: string | null; page?: string | null; caption?: string | null };
/** A reproduction of a photograph: a record of its family, or one added by hand. */
export type ImageAppearance = {
  id: string;
  manual: boolean;
  assetId: string | null;
  rowId: string | null;
  databaseId: string | null;
  databaseName: string | null;
  title: string | null;
  revision?: string;
  work: string | null;
  /** The work's author and year, from a related source record. */
  workDetail: string | null;
  author: string | null;
  year: number | null;
  date: string | null;
  page: string | null;
  caption: string | null;
  note: string | null;
  /** How the record's image relates to the one on screen ("self": it is that record). */
  match: VariantMember["match"] | "self" | null;
  /** The properties used, so the settings show what was detected. */
  fields?: { work: string | null; page: string | null; caption: string | null };
};
export type ManualAppearance = {
  id: string;
  contentHash: string;
  work: string;
  author: string | null;
  year: number | null;
  page: string | null;
  caption: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

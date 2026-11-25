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
/** One file is a crop of another: `inner` is the crop's content hash, `rect` its place in the wider file. */
export type CropPlacement = { inner: string; rect: { x: number; y: number; w: number; h: number }; kept: number };

/** A use of a photograph in its circulation: a record of its family or a reproduction added by hand. */
export type CirculationEntry = {
  /** The appearance's id (a record, a record and one of its works, or a manual one). */
  id: string;
  manual: boolean;
  assetId: string | null;
  contentHash: string | null;
  rowId: string | null;
  title: string | null;
  databaseName: string | null;
  revision?: string;
  work: string | null;
  workDetail: string | null;
  page: string | null;
  figure: string | null;
  caption: string | null;
  note: string | null;
  /** When the work printed it (the source's year, or the year given by hand). */
  publicationYear: number | null;
  /** The date of this print or scan (the record's date). */
  copyDate: string | null;
  copyYear: number | null;
  /** How it relates to the image on screen. */
  match: VariantMember["match"] | "self" | null;
  kind: VariantKind | null;
  /** The part of the wider image it keeps, when one is a crop of the other. */
  crop: { of: "this" | "other"; rect: CropPlacement["rect"]; kept: number } | null;
  /** The caption differs from the previous use that had one. */
  captionChanged: boolean;
  previousCaption: string | null;
  /** «Procede de»: the entry it was reproduced from, as the researcher said. */
  parent: string | null;
  /** An earlier entry whose image this one is a crop of: a likely source. */
  suggestedParent: string | null;
  /** Depth in the branches drawn by «Procede de». */
  depth: number;
};
/** Where a photograph went: its taking, every use in date order, and what stands out. */
export type ImageCirculation = {
  capture: {
    date: string | null;
    year: number | null;
    photographer: string | null;
    place: string | null;
    /** work: from the photographic work; record: from the record on screen. */
    from: "work" | "record";
    workId: string | null;
    workTitle: string | null;
  };
  entries: CirculationEntry[];
  firstPublication: string | null;
  /** Years between the taking and the first publication. */
  gapYears: number | null;
  /** Distinct captions among the uses. */
  captions: number;
};

/** The work (a record in a works database) a record is linked to, with every record linked to it. */
export type WorkLink = {
  workId: string;
  title: string;
  databaseId: string;
  databaseName: string;
  /** The relation from the record's database to the works database. */
  columnId: string;
  /** The records linked to the work (its prints, scans and reproductions). */
  reproductions: string[];
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
  /** The figure or plate number, from the link to the work. */
  figure?: string | null;
  /** When the work printed it: the source's year, or the year given by hand. */
  publicationYear?: number | null;
  /** The date of this print or scan: the record's date. */
  copyYear?: number | null;
  copyDate?: string | null;
  contentHash?: string | null;
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

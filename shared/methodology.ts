// The methodology report: what a study made with Imago rests on, so that
// another researcher can reproduce it or judge it. The collection gathers the
// facts (electron/export/methodology.ts); this file describes them and turns
// them into a printable document (shared/methodologyHtml.ts).
import type { DatabaseKind } from "./databases";
import type { StatResult, StatSpec } from "./statistics";
import type { CirculationSummary } from "./variants";

export type MethodologyOption = {
  label: string;
  /** Records holding the option. */
  count: number;
  /** The definition the AI was given for it, when there is one. */
  definition?: string;
  /** An authority it is linked to (Wikidata, Getty, Iconclass). */
  authority?: string;
};
export type MethodologyProperty = {
  id: string;
  name: string;
  type: string;
  /** Records with a value. */
  filled: number;
  ai: boolean;
  /** A relation: the database it links to. */
  relation?: { target: string; twoWay: boolean; place: boolean };
  /** A rollup: the relation and the related property (or link field) it shows. */
  rollup?: { relation: string; target: string; fn: string };
  /** The vocabulary of a select, multi-select or status property. */
  options?: MethodologyOption[];
  /** Options left out of the list because there are too many. */
  moreOptions?: number;
};
export type MethodologyDatabase = {
  id: string;
  name: string;
  kind: DatabaseKind | null;
  records: number;
  images: number;
  recordsWithImages: number;
  properties: MethodologyProperty[];
  /** SHA-256 of the records' values and image files: the same data gives the same hash. */
  fingerprint: string;
};
/** A model that produced or can produce values, with where it came from. */
export type MethodologyModel = {
  /** As Imago names it: a repository, «provider/model» or a catalogue id. */
  model: string;
  label?: string;
  revision?: string;
  license?: string;
  task: "embedding" | "vision" | "description" | "classification" | "restoration" | "property";
  /** local: runs on the computer; api: an external provider. */
  where: "local" | "api";
  /** Values written with it (AI properties, accepted proposals, restorations). */
  uses: number;
};
export type MethodologyPrompt = { hash: string; text: string; count: number };
export type MethodologyAiProperty = {
  database: string;
  name: string;
  type: string;
  /** The ready-made task (preset), or null for the researcher's own instructions. */
  preset: string | null;
  instructions: string | null;
  criteria: string | null;
  definitions: { label: string; text: string }[];
  tags: string[];
  maxTags: number | null;
  freeTags: boolean;
  /** The images property it looks at. */
  source: string | null;
  /** The model set for the property, or null when it follows Settings. */
  configuredModel: string | null;
  /** Values written by the AI, by model and revision. */
  writes: { model: string; revision: string; count: number }[];
  /** The exact instructions those values were written with. */
  prompts: MethodologyPrompt[];
  proposals: { accepted: number; rejected: number; pending: number };
  /** Values the AI wrote that the researcher changed afterwards. */
  corrected: number;
  /** Records whose value was written by the AI and not changed since. */
  kept: number;
};
export type MethodologyAgreement = {
  name: string;
  database: string;
  createdAt: string;
  units: number;
  complete: number;
  raters: { label: string; model: string }[];
  reference: string | null;
  mode: string;
  fleiss: number | null;
  alpha: number | null;
  unanimity: number | null;
  /** Share of units where every model matches the reference. */
  allMatchReference: number | null;
  anyMatchesReference: number | null;
  notes: string;
};
/** A filter as the report reads it: property, operator and value in words. */
export type MethodologyFilter = { property: string; op: string; value: string; group?: number };
export type MethodologyView = {
  database: string;
  name: string;
  view: string;
  logic: "and" | "or";
  filters: MethodologyFilter[];
  sorts: { property: string; desc: boolean }[];
};
export type MethodologyStatistic = {
  database: string;
  name: string;
  spec: StatSpec;
  /** Names of the properties it uses. */
  properties: string[];
  result: StatResult | null;
  error?: string;
};
export type MethodologyData = {
  format: "nodus.imago.methodology/1";
  generatedAt: string;
  language: "es" | "en";
  accent: string;
  environment: { app: string; platform: string; arch: string; electron: string; chromium: string };
  databases: MethodologyDatabase[];
  /** SHA-256 over every database's fingerprint. */
  fingerprint: string;
  models: MethodologyModel[];
  aiProperties: MethodologyAiProperty[];
  review: {
    proposals: { accepted: number; rejected: number; pending: number };
    aiWrites: number;
    aiCorrected: number;
    manualEdits: number;
    variantVerdicts: { same: number; different: number; kinds: Record<string, number> };
    heritage: { accepted: number; rejected: number; pending: number };
    authorities: number;
    linkDetails: number;
    works: number;
    manualAppearances: number;
    annotations: number;
    undone: number;
  };
  agreement: MethodologyAgreement[];
  /** The circulation of the photographs (variant families at balanced sensitivity), with how many sources the researcher set. */
  circulation: (CirculationSummary & { origins: number }) | null;
  variants: {
    sensitivity: { name: string; bits: number; cosine: number | null }[];
    images: number;
    fingerprinted: number;
    miniature: number;
  };
  index: {
    model: string;
    label: string | null;
    revision: string | null;
    dimensions: number;
    visionBudget: number | null;
    images: number;
    imagesIndexed: number;
    records: number;
    recordsIndexed: number;
    stale: number;
  };
  views: MethodologyView[];
  statistics: MethodologyStatistic[];
  restorations: { provider: string; model: string; task: string; count: number }[];
  settings: { profile: string; device: string; parallelJobs: number; apiDelayMs: number; remoteEnabled: boolean };
};

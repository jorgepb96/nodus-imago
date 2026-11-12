import { z } from "zod";
import { isDatabaseColumnType } from "./databases";
import { FILTER_LABELS } from "./viewCriteria";
import { externalHttpsUrl } from "./externalLinks";
import type { PropertyFilterGroup, PropertyFilterOp } from "./imago";
const id = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(300);
const ids = z.array(id).max(100000);
const type = z.string().refine(isDatabaseColumnType);
const value = z.string().max(1_000_000).nullable();
export const providerSchema = z.enum([
  "anthropic",
  "openai",
  "openrouter",
  "gemini",
  "groq",
  "cerebras",
  "deepseek",
  "xiaomi",
  "ollama",
  "lmstudio",
  "custom",
]);
const choice = z
  .object({ provider: z.enum(["local", ...providerSchema.options]), model: id })
  .strict();
const filter = z
  .object({
    id: id.optional(),
    disabled: z.boolean().optional(),
    databaseId: id.optional(),
    columnId: id,
    columnIds: z.array(id).min(1).max(100).optional(),
    groupId: id.optional(),
    op: z.enum(
      Object.keys(FILTER_LABELS) as [PropertyFilterOp, ...PropertyFilterOp[]],
    ),
    value: z.union([
      z.string().max(10000),
      z.array(z.string().max(10000)).max(1000),
    ]),
  })
  .strict();
const sort = z
  .object({ columnId: id, direction: z.enum(["asc", "desc"]) })
  .strict();
function groupSchema(depth: number): z.ZodType<PropertyFilterGroup> {
  return z
    .object({
      id,
      logic: z.enum(["and", "or"]),
      filters: z.array(filter).max(100),
      groups:
        depth < 2
          ? z
              .array(groupSchema(depth + 1))
              .max(20)
              .optional()
          : z.array(z.never()).max(0).optional(),
    })
    .strict();
}
const groups = z
  .array(groupSchema(0))
  .max(20)
  .refine((items) => {
    const count = (items: PropertyFilterGroup[]): number =>
      items.reduce(
        (n, item) => n + item.filters.length + 1 + count(item.groups ?? []),
        0,
      );
    return count(items) <= 150;
  }, "Demasiadas condiciones de filtro.");
export const searchSchema = z
  .object({
    databaseIds: ids.optional(),
    query: z.string().max(10000).optional(),
    mode: z.enum(["literal", "semantic", "hybrid"]).optional(),
    match: z.enum(["words", "phrase", "partial"]).optional(),
    filters: z.array(filter).max(100).optional(),
    filterLogic: z.enum(["and", "or"]).optional(),
    filterGroups: groups.optional(),
    sorts: z.array(sort).max(8).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(100000000).optional(),
    sortColumn: id.optional(),
    descending: z.boolean().optional(),
    imageToken: id.optional(),
    similarAssetId: id.optional(),
    semanticWeight: z.number().min(0).max(1).optional(),
  })
  .strict();
export const settingsSchema = z
  .object({
    embeddingModel: z.enum(["embeddinggemma2-onnx", "harrier-oss-v1-0.6b-q8_0", "embeddinggemma2"]),
    mode: z.enum(["light", "dark", "system"]),
    theme: z.string().max(100),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    language: z.enum(["es", "en"]),
    profile: z.enum(["light", "balanced", "advanced"]),
    dimensions: z.union([z.literal(256), z.literal(512), z.literal(768)]),
    python: z.string().min(1).max(2000),
    device: z.enum(["cpu", "mps", "cuda"]),
    visionModel: id,
    descriptionModel: choice,
    classificationModel: choice,
    remoteEnabled: z.boolean(),
    apiProfiles: z.partialRecord(
      providerSchema,
      z
        .object({
          baseUrl: z.string().max(2000),
          models: z.array(id).max(10000),
        })
        .strict(),
    ),
    apiDelayMs: z.number().int().min(0).max(60000),
    parallelJobs: z.number().int().min(1).max(4),
    fieldEquivalences: z
      .array(
        z
          .object({
            id,
            name,
            columnIds: z.array(id).min(1).max(100),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const schemas: Record<string, z.ZodTypeAny> = {
  inferenceDiagnostics: z.undefined(),
  modelPreparation: z.undefined(),
  prepareModels: z.object({ consent: z.literal(true) }).strict(),
  probeExperimentalPython: z.undefined(),
  openExternalLink: z
    .object({
      url: z
        .string()
        .max(4000)
        .refine((value) => externalHttpsUrl(value) !== null),
    })
    .strict(),
  agreementRun: searchSchema
    .pick({ filters: true, filterLogic: true, filterGroups: true })
    .extend({
      databaseId: id,
      config: z
        .object({
          raters: z
            .array(
              z
                .object({
                  columnId: id,
                  label: name,
                  model: z.string().max(1000),
                  prompt: z.string().max(30000),
                })
                .strict(),
            )
            .min(1)
            .max(8),
          referenceId: id.optional(),
          mode: z.enum(["nominal", "multilabel"]),
          delimiter: z.string().max(10),
          ignoreCase: z.boolean(),
          emptySetValid: z.boolean(),
          imagesOnly: z.boolean(),
          cohort: z.enum(["pairwise", "complete"]),
          aliases: z
            .array(
              z
                .object({
                  columnId: id,
                  from: z.string().trim().min(1).max(500),
                  to: z.string().trim().min(1).max(500),
                })
                .strict(),
            )
            .max(500),
          weight: z.enum(["none", "linear", "quadratic"]),
          categoryOrder: z.array(z.string().trim().min(1).max(500)).max(100),
          notes: z.string().max(30000),
        })
        .strict(),
    })
    .strict(),
  agreementList: z.object({ databaseId: id }).strict(),
  agreementSave: z.object({ token: id, name }).strict(),
  agreementLoad: z.object({ id }).strict(),
  agreementDelete: z.object({ id }).strict(),
  agreementExport: z
    .object({ token: id, format: z.enum(["json", "csv"]) })
    .strict(),
  mapRecords: searchSchema
    .pick({ filters: true, filterLogic: true, filterGroups: true, sorts: true })
    .extend({ databaseId: id, columnId: id })
    .strict(),
  propertyChoices: z
    .object({
      columnIds: z.array(id).min(1).max(100),
      query: z.string().max(300).optional(),
      offset: z.number().int().min(0).max(100000).optional(),
      selected: z.array(z.string().max(10000)).max(1000).optional(),
    })
    .strict(),
  searchPlaces: z.object({ query: z.string().trim().max(200) }).strict(),
  openMapAttribution: z.undefined(),
  status: z.undefined(),
  listDatabases: z.undefined(),
  createDatabase: z.object({ name }).strict(),
  renameDatabase: z.object({ id, name }).strict(),
  deleteDatabase: z.object({ id }).strict(),
  detail: z.object({ id }).strict(),
  addColumn: z
    .object({
      databaseId: id,
      name,
      type,
      config: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  updateColumn: z
    .object({
      id,
      name: name.optional(),
      config: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  deleteColumn: z.object({ id }).strict(),
  saveOptions: z
    .object({
      columnId: id,
      options: z
        .array(
          z
            .object({
              id: id.optional(),
              label: name,
              color: z
                .string()
                .regex(/^#[0-9a-f]{6}$/i)
                .nullable(),
            })
            .strict(),
        )
        .max(10000),
    })
    .strict(),
  createRow: z.object({ databaseId: id }).strict(),
  createRows: z
    .object({
      databaseId: id,
      count: z.number().int().min(1).max(1000),
    })
    .strict(),
  getRow: z.object({ id }).strict(),
  setCell: z.object({ rowId: id, columnId: id, value }).strict(),
  deleteRows: z.object({ ids }).strict(),
  search: searchSchema,
  csvPreview: z.undefined(),
  csvImport: z
    .object({
      token: id,
      name,
      types: z.array(type).max(500),
      headers: z.array(name).max(500),
    })
    .strict(),
  imagePreview: z
    .object({
      databaseId: id,
      columnId: id.optional(),
      referenceColumnId: id.optional(),
      source: z.enum(["files", "folder"]),
      pattern: z.string().max(200).optional(),
      partial: z.boolean().optional(),
    })
    .strict(),
  rematchImages: z
    .object({
      token: id,
      referenceColumnId: id.optional(),
      pattern: z.string().max(200).optional(),
      partial: z.boolean().optional(),
    })
    .strict(),
  importImages: z
    .object({
      token: id,
      storage: z.enum(["copy", "link"]),
      createUnmatched: z.boolean(),
      columnId: id.optional(),
      assignments: z
        .array(z.object({ pathToken: id, rowId: id.nullable() }).strict())
        .max(100000),
    })
    .strict(),
  queryImage: z.undefined(),
  setPrimary: z.object({ id }).strict(),
  deleteImage: z.object({ id }).strict(),
  reassignImage: z.object({ id, rowId: id, columnId: id }).strict(),
  deleteImages: z.object({ ids }).strict(),
  reassignImages: z
    .object({ ids, rowId: id, columnId: id.optional() })
    .strict(),
  relinkImage: z.object({ id }).strict(),
  export: z
    .object({
      databaseId: id,
      format: z.enum(["csv", "json", "xlsx"]),
      rowIds: ids.optional(),
    })
    .strict(),
  backup: z.undefined(),
  restore: z.undefined(),
  notionImport: z.undefined(),
  nodusImport: z.undefined(),
  probeRuntime: z.undefined(),
  updateSettings: settingsSchema.partial(),
  jobs: z.undefined(),
  controlJob: z
    .object({ id, action: z.enum(["pause", "resume", "cancel"]) })
    .strict(),
  pauseAllJobs: z.undefined(),
  rebuildText: z.undefined(),
  indexImages: z.object({ databaseIds: ids.optional() }).strict(),
  downloadModel: z.object({ id }).strict(),
  importModel: z.object({ id }).strict(),
  deleteModel: z.object({ id }).strict(),
  verifyModel: z.object({ id }).strict(),
  modelLicense: z.object({ id }).strict(),
  analyze: z
    .object({
      rowIds: ids.optional(),
      databaseId: id.optional(),
      columnIds: ids,
      language: z.string().max(100),
      detailed: z.boolean(),
    })
    .strict(),
  provenance: z.object({ rowId: id }).strict(),
  proposals: z.undefined(),
  reviewProposals: z
    .object({ ids, action: z.enum(["accept", "reject"]) })
    .strict(),
  undo: z.undefined(),
  credentialsStatus: z.undefined(),
  setApiKey: z
    .object({ provider: providerSchema, key: z.string().max(10000) })
    .strict(),
  clearApiKey: z.object({ provider: providerSchema }).strict(),
  listProviderModels: z.object({ provider: providerSchema }).strict(),
  savedSearches: z.undefined(),
  saveSearch: z.object({ name, input: searchSchema }).strict(),
  removeSearch: z.object({ id }).strict(),
};
export function validateCommand(command: string, input: unknown) {
  if (!Object.hasOwn(schemas, command))
    throw new Error("Operación no permitida");
  return schemas[command].parse(input);
}

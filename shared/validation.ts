import { z } from "zod";
import { isDatabaseColumnType } from "./databases";
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
    databaseId: id.optional(),
    columnId: id,
    columnIds: z.array(id).min(1).max(100).optional(),
    groupId: id.optional(),
    op: z.enum(["contains", "equals", "gte", "lte", "any", "all", "empty"]),
    value: z.union([z.string().max(10000), z.array(z.string()).max(1000)]),
  })
  .strict();
export const searchSchema = z
  .object({
    databaseIds: ids.optional(),
    query: z.string().max(10000).optional(),
    mode: z.enum(["literal", "semantic", "hybrid"]).optional(),
    match: z.enum(["words", "phrase", "partial"]).optional(),
    filters: z.array(filter).max(100).optional(),
    filterLogic: z.enum(["and", "or"]).optional(),
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

import { z } from "zod";
import { DATABASE_VIEWS } from "./savedViews";
import { backupPreferencesSchema } from "./backups";
import { updatePreferencesSchema } from "./updates";
import { isDatabaseColumnType } from "./databases";
import { isDatabaseIconValue } from "./databaseIcons";
import { FILTER_LABELS } from "./viewCriteria";
import { externalHttpsUrl } from "./externalLinks";
import type { PropertyFilterGroup, PropertyFilterOp } from "./imago";
const id = z.string().min(1).max(200);
const authorityLink = z
  .object({
    source: z.enum(["wikidata", "iconclass"]),
    id: z.string().min(1).max(80),
    label: z.string().max(500),
    description: z.string().max(1000).nullable(),
    uri: z.string().url().max(300),
    ulan: z.string().max(40).nullable().optional(),
    tgn: z.string().max(40).nullable().optional(),
    aat: z.string().max(40).nullable().optional(),
    iconclass: z.string().max(120).nullable().optional(),
    coordinates: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).nullable().optional(),
    born: z.number().int().nullable().optional(),
    died: z.number().int().nullable().optional(),
    kind: z.enum(["person", "place", "subject", "other"]).optional(),
    instances: z.array(z.string().regex(/^Q\d+$/)).max(20).optional(),
    partOf: z.array(z.string().regex(/^Q\d+$/)).max(20).optional(),
  })
  .strict();
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
const chatMode = z.enum(["fast", "extended"]);
/** One chat turn, checked in the main process before anything is sent. */
export const chatTurnSchema = z
  .object({
    conversationId: id,
    question: z.string().max(20000),
    databaseIds: z.array(id).min(1).max(50),
    model: choice,
    mode: chatMode,
    regenerate: z.boolean().optional(),
  })
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
  .object({
    columnId: id,
    direction: z.enum(["asc", "desc"]),
    empty: z.enum(["first", "last"]).optional(),
    by: z.enum(["label", "count"]).optional(),
  })
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
    semanticSources: z.enum(["both", "images", "text"]).optional(),
    semanticLimit: z.number().int().min(1).max(5000).optional(),
  })
  .strict();
const chart = z.enum(["bar", "column", "line", "heatmap", "table"]).optional();
const limit = z.number().int().min(2).max(60).optional();
/** Heritage properties: count elements, their types or their groups; parts in their wholes. */
const heritageLevel = z.enum(["element", "type", "group"]).optional();
const includeParts = z.boolean().optional();
export const statSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("frequency"), columnId: id, limit, chart, heritageLevel, includeParts }).strict(),
  z
    .object({
      kind: z.literal("crosstab"),
      rowColumnId: id,
      colColumnId: id,
      limit,
      measure: z.enum(["count", "row", "residual"]).optional(),
      chart,
      heritageLevel,
      includeParts,
    })
    .strict(),
  z.object({ kind: z.literal("cooccurrence"), columnId: id, limit, chart, heritageLevel, includeParts }).strict(),
  z
    .object({
      kind: z.literal("trend"),
      yearColumnId: id,
      seriesColumnId: id.nullable().optional(),
      bucket: z.enum(["year", "decade"]).optional(),
      limit,
      chart,
      heritageLevel,
      includeParts,
    })
    .strict(),
  z
    .object({
      kind: z.literal("numeric"),
      columnId: id,
      bins: z.number().int().min(2).max(60).optional(),
      chart,
    })
    .strict(),
]);
export const automationRuleSchema = z
  .object({
    id,
    name,
    databaseId: id,
    enabled: z.boolean(),
    trigger: z.enum(["created", "changed", "manual", "schedule"]),
    watchColumnId: id.nullable(),
    intervalMinutes: z.number().int().min(5).max(525600),
    filters: z.array(filter).max(30),
    filterGroups: groups.optional(),
    filterLogic: z.enum(["and", "or"]).optional(),
    actions: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("set"),
              columnId: id,
              value,
              overwrite: z.boolean(),
            })
            .strict(),
          z
            .object({
              kind: z.literal("copy"),
              columnId: id,
              sourceColumnId: id,
              overwrite: z.boolean(),
            })
            .strict(),
          z
            .object({
              kind: z.literal("analyze"),
              columnIds: z.array(id).min(1).max(30),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(10),
  })
  .strict();
export const settingsSchema = z
  .object({
    embeddingModel: z.enum([
      "embeddinggemma2-onnx",
      "harrier-oss-v1-0.6b-q8_0",
      "embeddinggemma2",
      "api-embedding",
    ]),
    embeddingApi: z
      .object({
        provider: z.enum(["gemini", "openai", "openrouter", "ollama", "lmstudio", "custom"]),
        model: z.string().trim().min(1).max(300),
        dimensions: z.number().int().min(64).max(4096),
      })
      .strict()
      .optional(),
    visionBudget: z.union([z.literal(70), z.literal(140), z.literal(280)]).optional(),
    indexQualityChosen: z.boolean().optional(),
    autoIndex: z
      .object({ local: z.boolean().optional(), api: z.boolean().optional() })
      .strict()
      .optional(),
    /** Introduction and guided tour already seen (their version). */
    welcomeVersion: z.number().int().min(0).max(1000).optional(),
    whatsNewVersion: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/).optional(),
    tourVersion: z.number().int().min(0).max(1000).optional(),
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
    imageModels: z.array(z.string().max(400)).max(200).optional(),
    citationTemplates: z.record(id, z.string().max(1000)).optional(),
    favoriteImageModels: z.array(z.string().max(400)).max(200).optional(),
    aiUserPresets: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            name: z.string().trim().min(1).max(120),
            prompt: z.string().trim().min(1).max(8000),
            output: z.enum(["text", "tags"]),
          })
          .strict(),
      )
      .max(200)
      .optional(),
    watermark: z
      .object({
        enabled: z.boolean(),
        text: z.string().max(80),
        position: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]),
      })
      .strict()
      .optional(),
    parallelJobs: z.number().int().min(1).max(4),
    apiParallel: z.number().int().min(1).max(50).optional(),
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
  updateStatus:z.undefined(),updateConfigure:updatePreferencesSchema,updateCheck:z.undefined(),updateDownload:z.undefined(),updateInstall:z.union([z.undefined(),z.object({password:z.string().min(8).max(1024).optional()}).strict()]),
  reloadInterface:z.undefined(),
  backupStatus:z.undefined(), backupChooseFolder:z.undefined(), backupRun:z.union([z.undefined(),z.object({password:z.string().min(8).max(1024).optional()}).strict()]), backupPickRestore:z.undefined(),
  backupConfigure:backupPreferencesSchema,
  backupSetPassword:z.object({password:z.string().min(8).max(1024)}).strict(),
  backupInspect:z.object({token:id,password:z.string().max(1024).optional()}).strict(),
  backupRestore:z.object({token:id,password:z.string().max(1024).optional(),replace:z.boolean(),restoreCredentials:z.boolean()}).strict(),
  backupVerify:z.object({id,password:z.string().max(1024).optional()}).strict(),
  backupArchive:z.object({id,archived:z.boolean()}).strict(),
  backupReveal:z.object({id:id.optional()}).strict(),
  embeddingApiProbe: z
    .object({
      provider: z.enum(["gemini", "openai", "openrouter", "ollama", "lmstudio", "custom"]),
      model: z.string().trim().min(1).max(300),
      dimensions: z.number().int().min(64).max(4096),
    })
    .strict(),
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
          placeholdersMissing: z.boolean().optional(),
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
    .extend({ databaseId: id, columnId: id, fallbackColumnId: id.nullable().optional() })
    .strict(),
  heritageMap: searchSchema
    .pick({ filters: true, filterLogic: true, filterGroups: true, sorts: true })
    .extend({ databaseId: id, columnId: id, includeParts: z.boolean() })
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
  createDatabase: z.object({ name, kind: z.enum(["images", "sources", "custom"]).optional() }).strict(),
  convertToRelation: z
    .object({
      id,
      targetDatabaseId: id,
      matchColumnId: id.nullable().optional(),
      keepCopy: z.boolean().optional(),
      createMissing: z.boolean().optional(),
      inverseName: z.string().trim().max(200).nullable().optional(),
      apply: z.boolean(),
    })
    .strict(),
  pairRelation: z.object({ columnId: id, name: z.string().trim().max(200) }).strict(),
  unpairRelation: z.object({ columnId: id }).strict(),
  linkedRecords: z.object({ rowId: id }).strict(),
  setDatabaseKind: z.object({ id, kind: z.enum(["images", "sources", "custom"]).nullable() }).strict(),
  setDatabaseIcon: z
    .object({ id, icon: z.string().max(40).refine(isDatabaseIconValue, "Icono desconocido.").nullable() })
    .strict(),
  renameDatabase: z.object({ id, name }).strict(),
  reorderDatabases: z.object({ ids: z.array(id).min(1).max(10000) }).strict(),
  deleteDatabase: z.object({ id }).strict(),
  detail: z.object({ id }).strict(),
  pageDocument: z.object({ rowId: id, columnId: id }).strict(),
  automationList: z.object({ databaseId: id }).strict(),
  automationHistory: z.object({ databaseId: id }).strict(),
  automationSave: automationRuleSchema,
  automationDelete: z.object({ id }).strict(),
  automationRun: z.object({ id }).strict(),
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
  convertColumn: z
    .object({ id, type, apply: z.boolean() })
    .strict(),
  duplicateColumn: z
    .object({ id, copy: z.string().trim().min(1).max(40).optional() })
    .strict(),
  columnSummary: z
    .object({
      search: searchSchema,
      columnId: id,
      fn: z.enum([
        "show", "show_unique", "count", "count_values", "count_empty", "count_unique",
        "percent_empty", "percent_not_empty", "sum", "average", "median", "min", "max",
        "range", "earliest_date", "latest_date", "date_range", "checked", "unchecked",
        "percent_checked", "percent_unchecked",
      ]),
    })
    .strict(),
  reorderColumns: z
    .object({ databaseId: id, columnIds: z.array(id).min(1).max(500) })
    .strict(),
  statisticsList: z.object({ databaseId: id }).strict(),
  statisticSave: z
    .object({ id: id.optional(), databaseId: id, name, spec: statSpec })
    .strict(),
  statisticDelete: z.object({ id }).strict(),
  savedViewsList: z.object({ databaseId: id }).strict(),
  savedViewSave: z
    .object({
      id: id.optional(),
      databaseId: id,
      name,
      view: z.enum(DATABASE_VIEWS),
      criteria: z
        .object({
          filters: z.array(filter).max(100),
          filterLogic: z.enum(["and", "or"]),
          filterGroups: groups,
          sorts: z.array(sort).max(8),
        })
        .strict(),
    })
    .strict(),
  savedViewDelete: z.object({ id }).strict(),
  statisticCompute: z.object({ search: searchSchema, spec: statSpec }).strict(),
  detailSearch: z
    .object({
      assetId: id,
      region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.01).max(1) }).strict(),
      databaseIds: z.array(id).max(50).optional(),
      inside: z.boolean().optional(),
    })
    .strict(),
  neighbourSuggestions: z.object({ databaseId: id, columnId: id, limit: z.number().int().min(1).max(5000).optional() }).strict(),
  neighbourSuggestionsApply: z
    .object({ items: z.array(z.object({ rowId: id, columnId: id, value: z.string().max(100000) }).strict()).min(1).max(5000) })
    .strict(),
  restorationsList: z.object({ assetId: id.optional() }).strict(),
  restorationDelete: z.object({ id }).strict(),
  restorationRun: z
    .object({
      assetId: id,
      region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.005).max(1), h: z.number().min(0.005).max(1) }).strict().nullable(),
      provider: providerSchema,
      model: z.string().trim().min(1).max(300),
      task: z.enum(["restore", "repair", "sharpen", "colorize", "custom"]),
      prompt: z.string().trim().min(1).max(8000),
    })
    .strict(),
  restorationCancel: z.undefined(),
  annotationsExport: z.object({ databaseId: id }).strict(),
  tropyImport: z.undefined(),
  iiifImport: z.object({ url: z.string().url().max(2000).refine((u) => u.startsWith("https://")), perCanvas: z.boolean() }).strict(),
  platesExport: z
    .object({
      rowIds: z.array(id).min(1).max(500),
      template: z.string().max(1000),
      title: z.string().max(300),
      label: z.string().max(40),
      listTitle: z.string().max(200),
      start: z.number().int().min(1).max(100000),
    })
    .strict(),
  authoritySearch: z
    .object({ source: z.enum(["wikidata", "iconclass"]), query: z.string().trim().min(1).max(250), kind: z.enum(["person", "place", "subject"]).nullable().optional() })
    .strict(),
  authorityLinks: z.object({ columnId: id }).strict(),
  authoritySet: z
    .object({
      columnId: id,
      items: z
        .array(
          z
            .object({
              optionId: id,
              link: authorityLink.nullable(),
            })
            .strict(),
        )
        .max(2000),
    })
    .strict(),
  authorityLocate: z.object({ columnId: id, name: z.string().trim().min(1).max(120) }).strict(),
  heritageElements: z.object({ columnId: id }).strict(),
  heritageSave: z
    .object({
      columnId: id,
      items: z
        .array(
          z
            .object({
              optionId: id,
              parentId: id.nullable(),
              group: z.string().max(40).nullable(),
              type: z.string().max(40).nullable(),
              latitude: z.number().min(-90).max(90).nullable(),
              longitude: z.number().min(-180).max(180).nullable(),
              coordSource: z.enum(["wikidata", "osm", "town", "manual"]).nullable(),
              osm: z.string().max(80).nullable().optional(),
            })
            .strict(),
        )
        .max(5000),
    })
    .strict(),
  heritageCandidates: z
    .object({ items: z.array(z.object({ optionId: id, label: z.string().trim().min(1).max(500) }).strict()).min(1).max(20) })
    .strict(),
  heritageApplyLinks: z
    .object({
      columnId: id,
      items: z
        .array(
          z
            .object({
              optionId: id,
              link: authorityLink,
              group: z.string().max(40).nullable().optional(),
              type: z.string().max(40).nullable().optional(),
              parentId: id.nullable().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(5000),
    })
    .strict(),
  heritageAddElement: z.object({ columnId: id, label: z.string().trim().min(1).max(500), link: authorityLink.nullable() }).strict(),
  heritageSuggest: z
    .object({
      assetId: id,
      columnId: id,
      whole: z.boolean(),
      zones: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }).strict()).max(6),
      choice: z.object({ provider: z.string().min(1).max(40), model: z.string().min(1).max(300) }).strict(),
    })
    .strict(),
  heritageRowsWith: z.object({ columnId: id, optionId: id, rowIds: z.array(id).max(500) }).strict(),
  heritageAddToRows: z
    .object({
      columnId: id,
      optionId: id,
      items: z.array(z.object({ rowId: id, assetId: id.optional(), box: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }).strict().nullable().optional() }).strict()).min(1).max(500),
    })
    .strict(),
  heritageInferTypes: z.object({ columnId: id }).strict(),
  heritageApplyPlaces: z
    .object({
      columnId: id,
      items: z
        .array(
          z
            .object({
              optionId: id,
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
              osm: z.string().regex(/^(node|way|relation)\/\d+$/).nullable().optional(),
              town: z.boolean().optional(),
              group: z.string().max(40).nullable().optional(),
              type: z.string().max(40).nullable().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(5000),
    })
    .strict(),
  heritageIdentifyStart: z.object({ columnId: id, source: z.enum(["wikidata", "osm", "town"]) }).strict(),
  heritageJobs: z.object({ columnId: id }).strict(),
  heritageProposals: z.object({ columnId: id, source: z.enum(["wikidata", "osm", "town"]) }).strict(),
  heritageProposalUpdate: z.object({ id, chosen: z.number().int().min(0).max(20).optional(), accepted: z.boolean().optional() }).strict(),
  heritageProposalsAccept: z.object({ ids: z.array(id).max(5000), accepted: z.boolean() }).strict(),
  heritageProposalsDismiss: z.object({ ids: z.array(id).max(5000) }).strict(),
  heritageProposalsApply: z.object({ columnId: id, source: z.enum(["wikidata", "osm", "town"]) }).strict(),
  heritageLinkBatches: z.object({ columnId: id }).strict(),
  heritageRevertBatch: z.object({ id }).strict(),
  valueClusters: z.object({ columnId: id }).strict(),
  valueCounts: z.object({ columnId: id }).strict(),
  valueMerge: z
    .object({ columnId: id, groups: z.array(z.object({ members: z.array(z.string().min(1).max(2000)).min(2).max(500), target: z.string().trim().min(1).max(500) }).strict()).min(1).max(1000) })
    .strict(),
  commonsNearby: z
    .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), radius: z.number().min(10).max(10000).optional() })
    .strict(),
  restorationExport: z
    .object({
      id,
      format: z.enum(["png", "jpeg"]),
      watermark: z.object({ enabled: z.boolean(), text: z.string().max(80), position: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]) }).strict(),
    })
    .strict(),
  variantsStatus: z.object({ databaseIds: z.array(id).max(50).optional() }).strict(),
  variantsPrepare: z.object({ databaseIds: z.array(id).max(50).optional() }).strict(),
  variantFamilies: z
    .object({
      databaseIds: z.array(id).max(50).optional(),
      sensitivity: z.enum(["strict", "balanced", "broad"]),
      // The records of the view on screen (data source and filters): only
      // their images are grouped. Without it, every image in databaseIds.
      search: searchSchema.optional(),
    })
    .strict(),
  variantsOf: z.object({ assetId: id, sensitivity: z.enum(["strict", "balanced", "broad"]).optional() }).strict(),
  imageVariants: z.object({ assetId: id, sensitivity: z.enum(["strict", "balanced", "broad"]).optional() }).strict(),
  variantVerdict: z
    .object({
      assetId: id,
      otherAssetId: id,
      verdict: z.enum(["same", "different"]).nullable(),
      kind: z.enum(["copy", "crop", "retouch", "reproduction", "other_take"]).nullable().optional(),
    })
    .strict(),
  imageAppearances: z
    .object({
      assetId: id,
      sensitivity: z.enum(["strict", "balanced", "broad"]).optional(),
      fields: z
        .record(id, z.object({ work: id.nullable().optional(), page: id.nullable().optional(), caption: id.nullable().optional() }).strict())
        .refine((value) => Object.keys(value).length <= 50, "Demasiadas bases de datos.")
        .optional(),
    })
    .strict(),
  appearanceSave: z
    .object({
      id: id.optional(),
      assetId: id,
      work: z.string().trim().min(1).max(500),
      author: z.string().max(500).nullable().optional(),
      year: z.number().int().min(0).max(3000).nullable().optional(),
      page: z.string().max(100).nullable().optional(),
      caption: z.string().max(4000).nullable().optional(),
      note: z.string().max(4000).nullable().optional(),
    })
    .strict(),
  appearanceDelete: z.object({ id }).strict(),
  boardsList: z.undefined(),
  boardGet: z.object({ id }).strict(),
  boardSave: z
    .object({ id: id.optional(), name: z.string().max(200).optional(), assetIds: z.array(id).max(6).optional() })
    .strict(),
  boardDelete: z.object({ id }).strict(),
  compareItems: z.object({ assetIds: z.array(id).max(6) }).strict(),
  annotationsList: z
    .object({ assetId: id.optional(), rowId: id.optional() })
    .strict()
    .refine((v) => !!v.assetId !== !!v.rowId),
  annotationSave: z
    .object({
      id: id.optional(),
      assetId: id,
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().min(0).max(1),
      h: z.number().min(0).max(1),
      note: z.string().max(20000),
      tags: z.array(z.string().max(120)).max(50),
      color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
      kind: z.enum(["rect", "point"]).optional(),
      optionId: id.nullable().optional(),
    })
    .strict(),
  annotationDelete: z.object({ id }).strict(),
  annotationTags: z.object({ databaseId: id }).strict(),
  chatList: z.object({ includeArchived: z.boolean().optional() }).strict(),
  chatGet: z.object({ id }).strict(),
  chatCreate: z
    .object({
      title: z.string().max(300).optional(),
      databaseIds: z.array(id).max(50),
      folderId: id.nullable().optional(),
      model: choice.nullable().optional(),
      mode: chatMode.optional(),
    })
    .strict(),
  chatUpdate: z
    .object({
      ids: z.array(id).min(1).max(5000),
      title: z.string().max(300).optional(),
      folderId: id.nullable().optional(),
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
      databaseIds: z.array(id).max(50).optional(),
      model: choice.nullable().optional(),
      mode: chatMode.optional(),
    })
    .strict(),
  chatDelete: z.object({ ids: z.array(id).min(1).max(5000) }).strict(),
  chatFolderSave: z
    .object({
      id: id.optional(),
      parentId: id.nullable().optional(),
      name: z.string().trim().max(120).optional(),
      color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
      icon: z.string().max(40).nullable().optional(),
    })
    .strict(),
  chatFolderDelete: z.object({ id }).strict(),
  timelineCandidates: z.object({ databaseId: id }).strict(),
  timeline: z.object({ search: searchSchema, columnId: id }).strict(),
  visualMap: z.object({ search: searchSchema, colorColumnId: id.nullable().optional() }).strict(),
  network: z
    .object({
      search: searchSchema,
      columnIds: z.array(id).min(2).max(3),
      minWeight: z.number().int().min(1).max(10000).optional(),
      maxNodes: z.number().int().min(10).max(200).optional(),
      yearColumnId: id.nullable().optional(),
      from: z.number().int().min(-3000).max(2200).nullable().optional(),
      to: z.number().int().min(-3000).max(2200).nullable().optional(),
    })
    .strict(),
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
      nullMarkersAsEmpty: z.boolean().optional(),
      kind: z.enum(["images", "sources", "custom"]).optional(),
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
  rotateImage: z.object({ id, direction: z.enum(["left", "right"]) }).strict(),
  cropImage: z
    .object({
      id,
      crop: z
        .object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          w: z.number().min(0).max(1),
          h: z.number().min(0).max(1),
        })
        .strict()
        .nullable(),
    })
    .strict(),
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
  clearJobs: z.undefined(),
  resumePausedJobs: z.undefined(),
  rebuildText: z.undefined(),
  indexImages: z.object({ databaseIds: ids.optional() }).strict(),
  startIndexing: z.object({ visionBudget: z.union([z.literal(70), z.literal(140), z.literal(280)]) }).strict(),
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
      task: z.enum(["describe", "transcribe"]).optional(),
      overwrite: z.boolean().optional(),
    })
    .strict(),
  provenance: z.object({ rowId: id }).strict(),
  proposals: z.undefined(),
  reviewProposals: z
    .object({ ids, action: z.enum(["accept", "reject"]) })
    .strict(),
  undo: z.object({ scope: z.enum(["all", "proposals"]) }).strict(),
  redo: z.object({ scope: z.enum(["all", "proposals"]) }).strict(),
  historyState: z.object({ scope: z.enum(["all", "proposals"]) }).strict(),
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

// What a model connected through MCP can do in Imago. Every tool goes through
// the same service commands as the window (and the same validation), so its
// changes keep Imago's rules and its history: Deshacer reverts them too.
// Write tools are offered only when the user has granted write access, and
// each one checks that access again when it runs.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateCommand } from "../../shared/validation";
import {
  COLUMN_TYPES,
  columnTypeHasOptions,
  ROLLUP_FUNCTIONS,
  type DatabaseColumn,
  type DatabaseDetail,
  type DatabaseSummary,
} from "../../shared/databases";
import { filterOperators } from "../../shared/viewCriteria";
import { importedOptionColor } from "../../shared/databaseCsv";
import type { CalcOutcome } from "../../shared/chat";
import type { ImagePlan, Page, RecordRow, SearchInput } from "../../shared/imago";
import {
  MCP_READ_ONLY_TYPES,
  mcpCellValue,
  mcpEncodeValue,
  mcpFilterValue,
  mcpMissingOptions,
  optionKey,
  type McpAccess,
  type McpActivity,
} from "../../shared/mcp";

export interface ImagoMcpContext {
  /** A service command (the worker in the app, the service itself in tests). */
  call: (command: string, input?: unknown) => Promise<any>;
  /** The access the user has granted now. */
  access: () => McpAccess;
  /** Data changed: the window refreshes what it shows. */
  changed: () => void;
  /** Runs code over the data in the isolated calculation process. */
  calc?: (code: string, json: string, timeoutMs: number) => Promise<CalcOutcome>;
  version: string;
  activity?: (entry: McpActivity) => void;
}

/** A refusal the model can act on (a wrong name, a missing permission). */
class ToolError extends Error {}

const MAX_TEXT = 4000;
const clip = (value: unknown) =>
  typeof value === "string" && value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) + "…" : value;

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value ?? null, null, 1) }] };
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

const FILTER_OPS = [
  "contains", "not_contains", "starts_with", "ends_with", "equals", "not_equals", "gt", "gte", "lt", "lte",
  "between", "any", "all", "none", "empty", "not_empty", "checked", "unchecked", "relative_date",
  "has_coordinates", "no_coordinates",
] as const;
const SUMMARY_FNS = [
  "count", "count_values", "count_empty", "count_unique", "percent_empty", "percent_not_empty", "sum", "average",
  "median", "min", "max", "range", "earliest_date", "latest_date", "date_range", "checked", "unchecked",
  "percent_checked", "percent_unchecked", "show_unique",
] as const;
const COLUMN_TYPE_IDS = COLUMN_TYPES.map((t) => t.id) as [string, ...string[]];

const databaseRef = z.string().min(1).max(300).describe("Database id, short id (DB-XXXX) or exact name.");
const propertyRef = z.string().min(1).max(300).describe("Property id or exact name.");
const filtersSchema = z
  .array(
    z.object({
      property: propertyRef,
      op: z.enum(FILTER_OPS),
      value: z
        .union([z.string().max(10000), z.array(z.string().max(10000)).max(1000)])
        .optional()
        .describe("Option labels for select/status/multi_select, names for people, years for historical dates, ISO dates for dates; two values for «between»."),
    }),
  )
  .max(50)
  .optional()
  .describe("Conditions on properties. imago_get_database lists the operators each property accepts.");
const textSearchSchema = z
  .object({
    text: z.string().min(1).max(2000),
    mode: z.enum(["literal", "semantic", "hybrid"]).optional().describe("literal: exact words; semantic: meaning (embeddings, also over images); hybrid: both. Default literal."),
    match: z.enum(["words", "phrase", "partial"]).optional().describe("Literal matching: all words (default), the exact phrase, or partial words."),
    semanticSources: z.enum(["both", "images", "text"]).optional().describe("What a semantic query is compared with."),
  })
  .optional();

export function registerImagoTools(server: McpServer, ctx: ImagoMcpContext, options: { write: boolean }) {
  const run = (command: string, input?: unknown): Promise<any> =>
    command.startsWith("_") ? ctx.call(command, input) : ctx.call(command, validateCommand(command, input));

  /** One tool: errors become a readable refusal, writes check access and refresh the window. */
  const handler =
    <A,>(name: string, kind: "read" | "write", fn: (args: A) => Promise<unknown>, raw = false) =>
    async (args: A) => {
      const write = kind === "write";
      try {
        if (write && ctx.access() !== "write")
          throw new ToolError("Imago no permite escribir a este cliente: el usuario solo ha concedido lectura en Ajustes → Servidor MCP.");
        const result = await fn(args);
        ctx.activity?.({ at: new Date().toISOString(), tool: name, ok: true, write });
        return raw ? (result as ReturnType<typeof json>) : json(result);
      } catch (error) {
        ctx.activity?.({
          at: new Date().toISOString(),
          tool: name,
          ok: false,
          write,
          error: String((error as Error)?.message ?? error).slice(0, 300),
        });
        return failure(error);
      } finally {
        if (write) ctx.changed();
      }
    };

  // ── Lookups ────────────────────────────────────────────────────────────────
  const listDatabases = (): Promise<DatabaseSummary[]> => run("listDatabases");
  const detailCache = new Map<string, Promise<DatabaseDetail>>();
  const detailOf = (id: string, fresh = false): Promise<DatabaseDetail> => {
    if (fresh || !detailCache.has(id)) detailCache.set(id, run("detail", { id }));
    return detailCache.get(id)!;
  };
  async function resolveDatabase(ref: string): Promise<DatabaseDetail> {
    const list = await listDatabases(),
      text = ref.trim();
    const exact = list.find((d) => d.id === text) ?? list.find((d) => d.shortId.toLowerCase() === text.toLowerCase());
    const named = exact ? [exact] : list.filter((d) => optionKey(d.name) === optionKey(text));
    if (named.length > 1)
      throw new ToolError(`Hay varias bases de datos llamadas «${ref}»; usa su id: ${named.map((d) => d.id).join(", ")}.`);
    if (!named.length)
      throw new ToolError(
        `No existe la base de datos «${ref}». Disponibles: ${list.slice(0, 40).map((d) => `«${d.name}» (${d.id})`).join(", ") || "ninguna"}.`,
      );
    return detailOf(named[0].id, true);
  }
  function resolveProperty(detail: DatabaseDetail, ref: string): DatabaseColumn {
    const text = ref.trim();
    const byId = detail.columns.find((c) => c.id === text);
    if (byId) return byId;
    const named = detail.columns.filter((c) => optionKey(c.name) === optionKey(text));
    if (named.length > 1)
      throw new ToolError(`«${detail.database.name}» tiene varias propiedades llamadas «${ref}»; usa su id: ${named.map((c) => c.id).join(", ")}.`);
    if (!named.length)
      throw new ToolError(
        `«${detail.database.name}» no tiene la propiedad «${ref}». Propiedades: ${detail.columns.map((c) => `«${c.name}»`).join(", ")}.`,
      );
    return named[0];
  }
  async function getRecord(id: string): Promise<RecordRow> {
    const row: RecordRow | null = await run("getRow", { id }).catch(() => null);
    if (!row) throw new ToolError(`No existe el registro «${id}».`);
    return row;
  }

  /** Property names as keys; a repeated name gets its position so nothing is lost. */
  function keysOf(columns: DatabaseColumn[]) {
    const seen = new Map<string, number>();
    return columns.map((c) => {
      const n = (seen.get(c.name) ?? 0) + 1;
      seen.set(c.name, n);
      return n === 1 ? c.name : `${c.name} (${n})`;
    });
  }
  function describeColumn(c: DatabaseColumn, databases: DatabaseSummary[]) {
    const { width: _width, fitContent: _fit, ...config } = c.config ?? {};
    const target = c.config.relationTargetDatabaseId
      ? databases.find((d) => d.id === c.config.relationTargetDatabaseId)
      : undefined;
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      writable: !MCP_READ_ONLY_TYPES.has(c.type),
      ...(columnTypeHasOptions(c.type) ? { options: c.options.map((o) => ({ id: o.id, label: o.label, color: o.color })) } : {}),
      ...(target ? { relationTarget: { id: target.id, name: target.name } } : {}),
      ...(Object.keys(config).length ? { config } : {}),
      filterOperators: filterOperators(c),
    };
  }
  function recordOut(
    row: RecordRow,
    columns: DatabaseColumn[],
    { only, images = true }: { only?: Set<string>; images?: boolean } = {},
  ) {
    const keys = keysOf(columns),
      values: Record<string, unknown> = {};
    columns.forEach((column, i) => {
      if (only && !only.has(column.id)) return;
      values[keys[i]] = clip(mcpCellValue(column, row));
    });
    return {
      id: row.id,
      title: row.title,
      databaseId: row.databaseId,
      databaseName: row.databaseName,
      ...(row.score != null ? { score: Math.round(row.score * 1000) / 1000 } : {}),
      ...(row.snippet ? { snippet: row.snippet } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      values,
      ...(images
        ? {
            images: row.images.map((a) => ({
              imageId: a.id,
              fileName: a.fileName,
              width: a.width,
              height: a.height,
              ...(a.description ? { description: clip(a.description) } : {}),
            })),
          }
        : { imageCount: row.images.length }),
    };
  }
  /** A view's conditions with property names and option labels turned into ids. */
  function compileFilters(detail: DatabaseDetail, filters: z.infer<typeof filtersSchema>) {
    return (filters ?? []).map((f, i) => {
      const column = resolveProperty(detail, f.property);
      return {
        id: `mcp-${i}`,
        columnId: column.id,
        op: f.op,
        value: f.value == null ? "" : mcpFilterValue(column, f.value),
      };
    });
  }
  function searchInput(
    detail: DatabaseDetail,
    args: { filters?: z.infer<typeof filtersSchema>; filterLogic?: "and" | "or"; search?: z.infer<typeof textSearchSchema> },
  ): SearchInput {
    return {
      databaseIds: [detail.database.id],
      filters: compileFilters(detail, args.filters),
      filterLogic: args.filterLogic ?? "and",
      ...(args.search
        ? {
            query: args.search.text,
            mode: args.search.mode ?? "literal",
            match: args.search.match,
            semanticSources: args.search.semanticSources,
          }
        : {}),
    };
  }
  function coverage(page: Page, mode: string | undefined) {
    if (!mode || mode === "literal") return {};
    const warning =
      !page.indexed && !page.textIndexed
        ? "Nothing is indexed for the current embedding model: an empty or poor semantic result does NOT mean the collection lacks the topic. Suggest indexing in Imago, or use a literal search."
        : undefined;
    return { indexedImages: page.indexed ?? 0, indexedRecords: page.textIndexed ?? 0, ...(warning ? { warning } : {}) };
  }
  /** Records as ids → plain values, across databases. */
  async function rowsOut(rows: RecordRow[], images = true) {
    const out = [];
    for (const row of rows) out.push(recordOut(row, (await detailOf(row.databaseId)).columns, { images }));
    return out;
  }
  type Cell = { rowId: string; columnId: string; value: string | null };
  /**
   * Values by property name as the cells Imago stores, for several records of
   * one database. Every name is checked and every value encoded before
   * anything is written; option labels that do not exist yet are added first
   * (or refused when createOptions is false).
   */
  async function encodeValues(databaseId: string, list: Record<string, unknown>[], createOptions: boolean) {
    let detail = await detailOf(databaseId, true);
    const missing = new Map<string, Map<string, string>>();
    for (const values of list)
      for (const [ref, value] of Object.entries(values ?? {})) {
        const column = resolveProperty(detail, ref);
        for (const label of mcpMissingOptions(column, value))
          (missing.get(column.id) ?? missing.set(column.id, new Map()).get(column.id)!).set(optionKey(label), label);
      }
    if (missing.size && !createOptions) {
      const [columnId, labels] = [...missing][0];
      throw new ToolError(
        `«${detail.columns.find((c) => c.id === columnId)!.name}» no tiene las opciones ${[...labels.values()].map((m) => `«${m}»`).join(", ")}. Créalas con createMissingOptions o imago_update_property.`,
      );
    }
    for (const [columnId, labels] of missing) {
      const column = detail.columns.find((c) => c.id === columnId)!;
      await run("saveOptions", {
        columnId,
        options: [
          ...column.options.map((o) => ({ id: o.id, label: o.label, color: o.color })),
          ...[...labels.values()].map((label, i) => ({ label, color: importedOptionColor(column.options.length + i) })),
        ],
      });
    }
    if (missing.size) detail = await detailOf(databaseId, true);
    const out: { columnId: string; name: string; value: string | null }[][] = [];
    for (const values of list) {
      const cells = [];
      for (const [ref, value] of Object.entries(values ?? {})) {
        const column = resolveProperty(detail, ref);
        cells.push({
          columnId: column.id,
          name: column.name,
          value: mcpEncodeValue(column, column.type === "relation" ? await relationIds(column, value) : value),
        });
      }
      out.push(cells);
    }
    return out;
  }
  /** Writes cells as one Undo step; one refused cell writes none. */
  const writeCells = (cells: Cell[]) => (cells.length ? run("_mcpSetCells", { cells }) : Promise.resolve(0));
  /** Relation targets by record id or, failing that, by exact title in the related database. */
  async function relationIds(column: DatabaseColumn, value: unknown): Promise<unknown> {
    if (value == null || value === "") return value;
    const target = column.config.relationTargetDatabaseId;
    const items = (Array.isArray(value) ? value : [value]).map(String);
    const ids: string[] = [];
    for (const item of items) {
      const row: RecordRow | null = await run("getRow", { id: item }).catch(() => null);
      if (row) {
        ids.push(row.id);
        continue;
      }
      if (!target) throw new ToolError(`«${column.name}»: no existe el registro «${item}».`);
      const page: Page = await run("search", { databaseIds: [target], query: item, mode: "literal", match: "phrase", limit: 200 });
      const hits = page.rows.filter((r) => optionKey(r.title) === optionKey(item));
      if (hits.length !== 1)
        throw new ToolError(
          hits.length
            ? `«${column.name}»: varios registros se titulan «${item}»; usa su id.`
            : `«${column.name}»: ningún registro de la base relacionada se titula «${item}».`,
        );
      ids.push(hits[0].id);
    }
    return ids;
  }
  async function fetchAll(input: SearchInput, cap = 100_000): Promise<RecordRow[]> {
    const rows: RecordRow[] = [];
    for (let offset = 0; offset < cap; offset += 200) {
      const page: Page = await run("search", { ...input, limit: 200, offset });
      rows.push(...page.rows);
      if (page.rows.length < 200 || rows.length >= page.total) break;
    }
    return rows;
  }

  // ── Reading ────────────────────────────────────────────────────────────────
  server.registerTool(
    "imago_get_overview",
    {
      title: "Imago overview",
      description:
        "Start here. Returns the Imago version, how many databases, records and images the collection holds, how much is indexed for semantic search, the access this client has (read or write), the property types and how values are written. Call imago_list_databases next.",
      inputSchema: {},
      annotations: READ,
    },
    handler("imago_get_overview", "read", async () => {
      const status = await run("status");
      return {
        app: "Nodus Imago",
        version: ctx.version,
        access: ctx.access(),
        collection: {
          databases: status.databases,
          records: status.rows,
          images: status.images,
          indexedImages: status.indexed,
          indexedRecords: status.textIndexed,
          semanticSearchReady: status.semanticReady,
          embeddingModel: status.settings?.embeddingModel,
          language: status.settings?.language,
        },
        propertyTypes: COLUMN_TYPES.map((t) => ({ id: t.id, label: t.label, writable: !MCP_READ_ONLY_TYPES.has(t.id) })),
        values: {
          read: "Records come back as {property name: plain value}: option labels, numbers, booleans, ISO dates, historical dates as {text,start,end,certainty}, people as names, locations as {name,address,latitude,longitude}, relations as record ids, images as {imageId,fileName}.",
          write:
            "Write the same plain values. select/status take a label, multi_select a list of labels (missing ones are created unless createMissingOptions is false), date «YYYY-MM-DD» or {start,end,includeTime}, historical_date free text («c. 1930», «s. XIX», «1925-1930») or {text,start,end}, relation record ids or exact titles, null to clear. Formula, rollup, created/edited times, unique ids and attachments are computed or attached by Imago.",
        },
        rollupFunctions: ROLLUP_FUNCTIONS.map((f) => f.id),
        write:
          ctx.access() === "write"
            ? "Write tools are available. Each call that changes values is one step of Imago's history (imago_undo reverts it); deleting records, properties or databases cannot be undone, so ask the user first."
            : "Read only. The user can grant write access in Imago → Ajustes → Servidor MCP.",
      };
    }),
  );

  server.registerTool(
    "imago_list_databases",
    {
      title: "List databases",
      description: "Every database in Imago with its id, short id, name, kind, number of records and number of properties.",
      inputSchema: {},
      annotations: READ,
    },
    handler("imago_list_databases", "read", async () => {
      const list = await listDatabases();
      const out = [];
      for (const d of list) {
        const detail = await detailOf(d.id, true);
        out.push({
          id: d.id,
          shortId: d.shortId,
          name: d.name,
          kind: d.kind ?? null,
          icon: d.icon,
          records: d.rowCount,
          properties: detail.columns.length,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        });
      }
      return { databases: out };
    }),
  );

  server.registerTool(
    "imago_get_database",
    {
      title: "Database schema",
      description:
        "One database's properties: id, name, type, options (for select, status and multi-select), configuration, whether a model can write it, and the filter operators it accepts.",
      inputSchema: { database: databaseRef },
      annotations: READ,
    },
    handler("imago_get_database", "read", async ({ database }: { database: string }) => {
      const detail = await resolveDatabase(database),
        list = await listDatabases();
      return {
        id: detail.database.id,
        shortId: detail.database.shortId,
        name: detail.database.name,
        kind: detail.database.kind ?? null,
        records: detail.database.rowCount,
        properties: detail.columns.map((c) => describeColumn(c, list)),
      };
    }),
  );

  server.registerTool(
    "imago_query_records",
    {
      title: "Query records",
      description:
        "Reads the records of one database, with every cell as a plain value. Filter by properties, sort, search by words or by meaning, choose the properties to return and page through with limit/offset (total says how many match).",
      inputSchema: {
        database: databaseRef,
        filters: filtersSchema,
        filterLogic: z.enum(["and", "or"]).optional(),
        search: textSearchSchema,
        sorts: z
          .array(z.object({ property: propertyRef, direction: z.enum(["asc", "desc"]) }))
          .max(8)
          .optional(),
        properties: z.array(propertyRef).max(500).optional().describe("Only these properties (all when omitted)."),
        includeImages: z.boolean().optional().describe("List each record's images (default true)."),
        limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
        offset: z.number().int().min(0).optional(),
      },
      annotations: READ,
    },
    handler(
      "imago_query_records",
      "read",
      async (args: {
        database: string;
        filters?: z.infer<typeof filtersSchema>;
        filterLogic?: "and" | "or";
        search?: z.infer<typeof textSearchSchema>;
        sorts?: { property: string; direction: "asc" | "desc" }[];
        properties?: string[];
        includeImages?: boolean;
        limit?: number;
        offset?: number;
      }) => {
        const detail = await resolveDatabase(args.database);
        const input: SearchInput = {
          ...searchInput(detail, args),
          sorts: (args.sorts ?? []).map((s) => ({ columnId: resolveProperty(detail, s.property).id, direction: s.direction })),
          limit: args.limit ?? 50,
          offset: args.offset ?? 0,
        };
        const page: Page = await run("search", input);
        const only = args.properties?.length ? new Set(args.properties.map((p) => resolveProperty(detail, p).id)) : undefined;
        return {
          database: { id: detail.database.id, name: detail.database.name },
          total: page.total,
          offset: input.offset,
          returned: page.rows.length,
          hasMore: (input.offset ?? 0) + page.rows.length < page.total,
          ...coverage(page, input.mode),
          records: page.rows.map((row) => recordOut(row, detail.columns, { only, images: args.includeImages !== false })),
        };
      },
    ),
  );

  server.registerTool(
    "imago_get_record",
    {
      title: "Get record",
      description:
        "One record in full: every property with its type and value, its images (with their ids for imago_get_image), the regions annotated on them and the records linked to it.",
      inputSchema: { recordId: z.string().min(1).max(200) },
      annotations: READ,
    },
    handler("imago_get_record", "read", async ({ recordId }: { recordId: string }) => {
      const row = await getRecord(recordId),
        detail = await detailOf(row.databaseId, true);
      const linked = await run("linkedRecords", { rowId: row.id }).catch(() => []);
      return {
        ...recordOut(row, detail.columns),
        properties: detail.columns.map((c) => ({ id: c.id, name: c.name, type: c.type, value: clip(mcpCellValue(c, row)) })),
        annotations: (row.annotations ?? []).map((a) => ({
          id: a.id,
          imageId: a.assetId,
          region: { x: a.x, y: a.y, w: a.w, h: a.h },
          note: a.note,
          tags: a.tags,
        })),
        linkedRecords: linked,
      };
    }),
  );

  server.registerTool(
    "imago_search",
    {
      title: "Search the collection",
      description:
        "Searches records across databases. literal finds the words; semantic compares meaning with the embeddings of the records' text and images (it finds photographs by what they show); hybrid combines both. Semantic results report index coverage: with nothing indexed an empty result means nothing.",
      inputSchema: {
        query: z.string().min(1).max(2000),
        mode: z.enum(["literal", "semantic", "hybrid"]).optional().describe("Default hybrid."),
        databases: z.array(databaseRef).max(50).optional().describe("Limit to these databases (all when omitted)."),
        semanticSources: z.enum(["both", "images", "text"]).optional(),
        match: z.enum(["words", "phrase", "partial"]).optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20."),
        offset: z.number().int().min(0).optional(),
      },
      annotations: READ,
    },
    handler(
      "imago_search",
      "read",
      async (args: {
        query: string;
        mode?: "literal" | "semantic" | "hybrid";
        databases?: string[];
        semanticSources?: "both" | "images" | "text";
        match?: "words" | "phrase" | "partial";
        limit?: number;
        offset?: number;
      }) => {
        const databaseIds = args.databases?.length
          ? await Promise.all(args.databases.map(async (d) => (await resolveDatabase(d)).database.id))
          : (await listDatabases()).map((d) => d.id);
        const mode = args.mode ?? "hybrid";
        const page: Page = await run("search", {
          databaseIds,
          query: args.query,
          mode,
          match: args.match,
          semanticSources: args.semanticSources,
          limit: args.limit ?? 20,
          offset: args.offset ?? 0,
        });
        return { total: page.total, mode, ...coverage(page, mode), records: await rowsOut(page.rows, true) };
      },
    ),
  );

  server.registerTool(
    "imago_find_similar_images",
    {
      title: "Find similar images",
      description:
        "Records whose images look like a given image (by its image embeddings). With a region (fractions 0–1 of the image), finds that detail — a building, an object, a sign — in the other images.",
      inputSchema: {
        imageId: z.string().min(1).max(200),
        region: z
          .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.01).max(1) })
          .optional(),
        databases: z.array(databaseRef).max(50).optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20."),
      },
      annotations: READ,
    },
    handler(
      "imago_find_similar_images",
      "read",
      async (args: { imageId: string; region?: { x: number; y: number; w: number; h: number }; databases?: string[]; limit?: number }) => {
        const databaseIds = args.databases?.length
          ? await Promise.all(args.databases.map(async (d) => (await resolveDatabase(d)).database.id))
          : (await listDatabases()).map((d) => d.id);
        if (args.region) {
          const result = await run("detailSearch", { assetId: args.imageId, region: args.region, databaseIds });
          return result;
        }
        const page: Page = await run("search", {
          databaseIds,
          similarAssetId: args.imageId,
          mode: "semantic",
          limit: args.limit ?? 20,
        });
        return { total: page.total, ...coverage(page, "semantic"), records: await rowsOut(page.rows, true) };
      },
    ),
  );

  server.registerTool(
    "imago_get_image",
    {
      title: "Get image",
      description:
        "Returns images so you can look at them and analyse them: by imageId, or the images of a record. They come as Imago shows them (turned and cropped), as JPEG, with their file name, size, description and the regions annotated on them.",
      inputSchema: {
        imageId: z.string().min(1).max(200).optional(),
        recordId: z.string().min(1).max(200).optional(),
        limit: z.number().int().min(1).max(6).optional().describe("With recordId: how many of its images (default 1)."),
        maxSize: z.number().int().min(256).max(2200).optional().describe("Longest side in pixels (default 1568)."),
      },
      annotations: READ,
    },
    handler(
      "imago_get_image",
      "read",
      async (args: { imageId?: string; recordId?: string; limit?: number; maxSize?: number }) => {
        if (!!args.imageId === !!args.recordId) throw new ToolError("Indica imageId o recordId (uno de los dos).");
        let row: RecordRow, assets: RecordRow["images"];
        if (args.recordId) {
          row = await getRecord(args.recordId);
          assets = row.images.slice(0, args.limit ?? 1);
          if (!assets.length) throw new ToolError("El registro no tiene imágenes.");
        } else {
          const found: RecordRow | null = await findImageRecord(args.imageId!);
          if (!found) throw new ToolError(`No existe la imagen «${args.imageId}».`);
          row = found;
          assets = row.images.filter((a) => a.id === args.imageId);
        }
        const content: ({ type: "image"; data: string; mimeType: string } | { type: "text"; text: string })[] = [];
        const described = [];
        for (const asset of assets) {
          const image = await run("_mcpImage", { id: asset.id, maxSize: args.maxSize });
          content.push({ type: "image", data: image.data, mimeType: image.mimeType });
          described.push({
            imageId: asset.id,
            fileName: asset.fileName,
            originalSize: { width: asset.width, height: asset.height },
            sentSize: { width: image.width, height: image.height },
            ...(asset.description ? { description: asset.description } : {}),
            annotations: (row.annotations ?? [])
              .filter((a) => a.assetId === asset.id)
              .map((a) => ({ region: { x: a.x, y: a.y, w: a.w, h: a.h }, note: a.note, tags: a.tags })),
          });
        }
        content.push({
          type: "text",
          text: JSON.stringify({ record: { id: row.id, title: row.title, database: row.databaseName }, images: described }, null, 1),
        });
        return { content };
      },
      true,
    ),
  );
  async function findImageRecord(imageId: string): Promise<RecordRow | null> {
    const owner: string | null = await run("_mcpImageOwner", { id: imageId });
    return owner ? getRecord(owner) : null;
  }

  server.registerTool(
    "imago_summarize_property",
    {
      title: "Summarise a property",
      description:
        "One figure for a property over the records that match: count, distinct values, empties, sum, average, median, min, max, range, earliest/latest date, checked… (as the footer of a table column).",
      inputSchema: {
        database: databaseRef,
        property: propertyRef,
        function: z.enum(SUMMARY_FNS),
        filters: filtersSchema,
        filterLogic: z.enum(["and", "or"]).optional(),
        search: textSearchSchema,
      },
      annotations: READ,
    },
    handler(
      "imago_summarize_property",
      "read",
      async (args: {
        database: string;
        property: string;
        function: (typeof SUMMARY_FNS)[number];
        filters?: z.infer<typeof filtersSchema>;
        filterLogic?: "and" | "or";
        search?: z.infer<typeof textSearchSchema>;
      }) => {
        const detail = await resolveDatabase(args.database),
          column = resolveProperty(detail, args.property);
        const result = await run("columnSummary", { search: searchInput(detail, args), columnId: column.id, fn: args.function });
        return { property: column.name, function: args.function, ...result };
      },
    ),
  );

  server.registerTool(
    "imago_compute_statistic",
    {
      title: "Compute a statistic",
      description:
        "Imago's statistics over the records that match: frequency of a property's values, a crosstab of two properties (count, row percentages or standardised residuals), co-occurrence of tags, a trend over years or decades (optionally split by a series) and the distribution of a number.",
      inputSchema: {
        database: databaseRef,
        kind: z.enum(["frequency", "crosstab", "cooccurrence", "trend", "numeric"]),
        property: propertyRef.optional().describe("frequency, cooccurrence and numeric: the property."),
        rowProperty: propertyRef.optional().describe("crosstab: rows."),
        columnProperty: propertyRef.optional().describe("crosstab: columns."),
        measure: z.enum(["count", "row", "residual"]).optional().describe("crosstab measure."),
        yearProperty: propertyRef.optional().describe("trend: the property with the date or year."),
        seriesProperty: propertyRef.optional().describe("trend: split into series by this property."),
        bucket: z.enum(["year", "decade"]).optional(),
        bins: z.number().int().min(2).max(60).optional().describe("numeric: number of bins."),
        limit: z.number().int().min(2).max(60).optional().describe("How many values to keep."),
        filters: filtersSchema,
        filterLogic: z.enum(["and", "or"]).optional(),
        search: textSearchSchema,
      },
      annotations: READ,
    },
    handler("imago_compute_statistic", "read", async (args: any) => {
      const detail = await resolveDatabase(args.database);
      const id = (ref: string | undefined, what: string) => {
        if (!ref) throw new ToolError(`Falta «${what}» para la estadística «${args.kind}».`);
        return resolveProperty(detail, ref).id;
      };
      const spec =
        args.kind === "frequency" || args.kind === "cooccurrence"
          ? { kind: args.kind, columnId: id(args.property, "property"), limit: args.limit }
          : args.kind === "crosstab"
            ? { kind: "crosstab", rowColumnId: id(args.rowProperty, "rowProperty"), colColumnId: id(args.columnProperty, "columnProperty"), measure: args.measure, limit: args.limit }
            : args.kind === "trend"
              ? {
                  kind: "trend",
                  yearColumnId: id(args.yearProperty, "yearProperty"),
                  seriesColumnId: args.seriesProperty ? id(args.seriesProperty, "seriesProperty") : null,
                  bucket: args.bucket,
                  limit: args.limit,
                }
              : { kind: "numeric", columnId: id(args.property, "property"), bins: args.bins };
      for (const key of Object.keys(spec)) if ((spec as Record<string, unknown>)[key] === undefined) delete (spec as Record<string, unknown>)[key];
      return run("statisticCompute", { search: searchInput(detail, args), spec });
    }),
  );

  server.registerTool(
    "imago_count_values",
    {
      title: "Count every value",
      description:
        "Every distinct value of a property with how many records hold it (a multi-select counts each label), most frequent first. For a filtered or more elaborate count use imago_compute_statistic or imago_run_calculation.",
      inputSchema: { database: databaseRef, property: propertyRef, limit: z.number().int().min(1).max(5000).optional().describe("Default 500.") },
      annotations: READ,
    },
    handler("imago_count_values", "read", async (args: { database: string; property: string; limit?: number }) => {
      const detail = await resolveDatabase(args.database),
        column = resolveProperty(detail, args.property);
      const rows = await fetchAll({ databaseIds: [detail.database.id] });
      const counts = new Map<string, number>();
      let empty = 0;
      for (const row of rows) {
        const value = mcpCellValue(column, row);
        const items = (Array.isArray(value) ? value : [value])
          .map((v) => (v != null && typeof v === "object" ? ((v as { text?: string; name?: string; fileName?: string }).text ?? (v as { name?: string }).name ?? (v as { fileName?: string }).fileName ?? JSON.stringify(v)) : v))
          .filter((v) => v != null && v !== "");
        if (!items.length) empty++;
        for (const v of new Set(items.map(String))) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const limit = args.limit ?? 500;
      return {
        property: column.name,
        records: rows.length,
        empty,
        distinct: sorted.length,
        values: sorted.slice(0, limit).map(([value, count]) => ({ value: clip(value), count })),
        truncated: sorted.length > limit,
      };
    }),
  );

  server.registerTool(
    "imago_timeline",
    {
      title: "Timeline",
      description: "How many records fall in each year according to a date, historical date or year property, over the records that match.",
      inputSchema: { database: databaseRef, property: propertyRef, filters: filtersSchema, filterLogic: z.enum(["and", "or"]).optional(), search: textSearchSchema },
      annotations: READ,
    },
    handler("imago_timeline", "read", async (args: any) => {
      const detail = await resolveDatabase(args.database),
        column = resolveProperty(detail, args.property);
      return run("timeline", { search: searchInput(detail, args), columnId: column.id });
    }),
  );

  if (ctx.calc)
    server.registerTool(
      "imago_run_calculation",
      {
        title: "Run a calculation",
        description:
          "Runs JavaScript over every record of the chosen databases in an isolated process (no files, network or modules; 15 s). The code sees `databases`: [{name, columns:[{name,type}], rows:[{_id, _images, <property name>: plain value}]}] and the helpers yearOf(value), countBy(rows, row => key) and top(object, n). It must `return` a JSON-serialisable result (console.log is captured). Use it for any calculation the other tools do not cover.",
        inputSchema: {
          databases: z.array(databaseRef).min(1).max(10),
          code: z.string().min(1).max(20000),
        },
        annotations: READ,
      },
      handler("imago_run_calculation", "read", async (args: { databases: string[]; code: string }) => {
        const ids = await Promise.all(args.databases.map(async (d) => (await resolveDatabase(d)).database.id));
        const dataset = JSON.stringify(await run("_chatDataset", { databaseIds: ids }));
        const outcome = await ctx.calc!(args.code, dataset, 15_000);
        if (!outcome.ok) throw new ToolError(`El cálculo falló: ${outcome.error}${outcome.logs.length ? `\nlogs: ${outcome.logs.join("\n")}` : ""}`);
        return { result: JSON.parse(outcome.result), logs: outcome.logs, ms: outcome.ms };
      }),
    );

  server.registerTool(
    "imago_list_saved",
    {
      title: "Saved views and statistics",
      description: "The views (filters and sorts) and statistics the user saved for a database.",
      inputSchema: { database: databaseRef },
      annotations: READ,
    },
    handler("imago_list_saved", "read", async ({ database }: { database: string }) => {
      const detail = await resolveDatabase(database);
      const [views, statistics] = await Promise.all([
        run("savedViewsList", { databaseId: detail.database.id }),
        run("statisticsList", { databaseId: detail.database.id }),
      ]);
      return { views, statistics };
    }),
  );

  server.registerTool(
    "imago_list_jobs",
    {
      title: "Task queue",
      description: "Imago's task queue: imports, indexing and AI analyses, with their state and progress.",
      inputSchema: {},
      annotations: READ,
    },
    handler("imago_list_jobs", "read", async () => ({ jobs: (await run("jobs")).slice(0, 50) })),
  );

  if (!options.write) return;

  // ── Writing ───────────────────────────────────────────────────────────────
  const valuesSchema = z
    .record(z.string(), z.unknown())
    .describe("{property name or id: plain value}; null clears a cell.");

  server.registerTool(
    "imago_create_database",
    {
      title: "Create a database",
      description:
        "Creates a database. kind chooses its starting properties: images (title, images, author, historical date, location, categories…), sources, custom (only a title); without kind it starts with a title and an images property.",
      inputSchema: {
        name: z.string().trim().min(1).max(300),
        kind: z.enum(["images", "sources", "custom"]).optional(),
        icon: z.string().max(40).optional().describe("An icon name from Imago's set (optional)."),
      },
      annotations: WRITE,
    },
    handler("imago_create_database", "write", async (args: { name: string; kind?: "images" | "sources" | "custom"; icon?: string }) => {
      const detail: DatabaseDetail = await run("createDatabase", { name: args.name, ...(args.kind ? { kind: args.kind } : {}) });
      if (args.icon) await run("setDatabaseIcon", { id: detail.database.id, icon: args.icon });
      const list = await listDatabases();
      const fresh = await detailOf(detail.database.id, true);
      return { id: fresh.database.id, shortId: fresh.database.shortId, name: fresh.database.name, properties: fresh.columns.map((c) => describeColumn(c, list)) };
    }),
  );

  server.registerTool(
    "imago_update_database",
    {
      title: "Update a database",
      description: "Renames a database, or changes its icon or kind.",
      inputSchema: {
        database: databaseRef,
        name: z.string().trim().min(1).max(300).optional(),
        icon: z.string().max(40).nullable().optional(),
        kind: z.enum(["images", "sources", "custom"]).nullable().optional(),
      },
      annotations: WRITE,
    },
    handler("imago_update_database", "write", async (args: { database: string; name?: string; icon?: string | null; kind?: "images" | "sources" | "custom" | null }) => {
      const detail = await resolveDatabase(args.database),
        id = detail.database.id;
      if (args.name) await run("renameDatabase", { id, name: args.name });
      if (args.icon !== undefined) await run("setDatabaseIcon", { id, icon: args.icon });
      if (args.kind !== undefined) await run("setDatabaseKind", { id, kind: args.kind });
      const fresh = await detailOf(id, true);
      return { id, name: fresh.database.name, icon: fresh.database.icon, kind: fresh.database.kind ?? null };
    }),
  );

  server.registerTool(
    "imago_delete_database",
    {
      title: "Delete a database",
      description:
        "Deletes a database with all its records and images. This cannot be undone. Ask the user first, and repeat the database's exact name in confirmName.",
      inputSchema: { database: databaseRef, confirmName: z.string().min(1).max(300) },
      annotations: DESTRUCTIVE,
    },
    handler("imago_delete_database", "write", async (args: { database: string; confirmName: string }) => {
      const detail = await resolveDatabase(args.database);
      if (args.confirmName.trim() !== detail.database.name.trim())
        throw new ToolError(`confirmName debe ser exactamente «${detail.database.name}».`);
      await run("deleteDatabase", { id: detail.database.id });
      detailCache.delete(detail.database.id);
      return { deleted: { id: detail.database.id, name: detail.database.name, records: detail.database.rowCount } };
    }),
  );

  server.registerTool(
    "imago_add_property",
    {
      title: "Add a property",
      description:
        "Adds a property of any type to a database. options: the choices of a select, status or multi-select. relation: the related database (twoWayName also adds the property on the other side). rollup: aggregates a property of the related records. config: any other setting, as imago_get_database shows it (number format, AI instructions, formula…).",
      inputSchema: {
        database: databaseRef,
        name: z.string().trim().min(1).max(300),
        type: z.enum(COLUMN_TYPE_IDS),
        options: z.array(z.union([z.string().min(1).max(300), z.object({ label: z.string().min(1).max(300), color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional() })])).max(1000).optional(),
        relation: z
          .object({
            targetDatabase: databaseRef,
            twoWayName: z.string().trim().max(200).optional().describe("Name of the twin property on the related database."),
            cardinality: z.enum(["one", "many"]).optional(),
          })
          .optional(),
        rollup: z
          .object({
            relationProperty: propertyRef.describe("A relation property of this database."),
            targetProperty: z.string().min(1).max(300).describe("A property of the related database, or «__title__»."),
            function: z.enum(ROLLUP_FUNCTIONS.map((f) => f.id) as [string, ...string[]]),
          })
          .optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: WRITE,
    },
    handler("imago_add_property", "write", async (args: any) => {
      const detail = await resolveDatabase(args.database);
      const config: Record<string, unknown> = { ...(args.config ?? {}) };
      if (args.type === "relation") {
        if (!args.relation) throw new ToolError("Una relación necesita «relation.targetDatabase».");
        const target = await resolveDatabase(args.relation.targetDatabase);
        Object.assign(config, {
          relationTargetKind: "db_row",
          relationTargetDatabaseId: target.database.id,
          ...(args.relation.cardinality ? { relationCardinality: args.relation.cardinality } : {}),
          ...(args.relation.twoWayName ? { relationInverseName: args.relation.twoWayName } : {}),
        });
      }
      if (args.type === "rollup") {
        if (!args.rollup) throw new ToolError("Un rollup necesita «rollup».");
        const relation = resolveProperty(detail, args.rollup.relationProperty);
        if (relation.type !== "relation" || !relation.config.relationTargetDatabaseId)
          throw new ToolError(`«${relation.name}» no es una relación con otra base de datos.`);
        const target = await detailOf(relation.config.relationTargetDatabaseId, true);
        Object.assign(config, {
          rollupRelationColumnId: relation.id,
          rollupTargetColumnId: args.rollup.targetProperty === "__title__" ? "__title__" : resolveProperty(target, args.rollup.targetProperty).id,
          rollupFunction: args.rollup.function,
        });
      }
      const column: DatabaseColumn = await run("addColumn", { databaseId: detail.database.id, name: args.name, type: args.type, config });
      if (args.options?.length) {
        if (!columnTypeHasOptions(column.type)) throw new ToolError(`Las propiedades de tipo ${column.type} no tienen opciones.`);
        await run("saveOptions", {
          columnId: column.id,
          options: args.options.map((o: string | { label: string; color?: string | null }, i: number) =>
            typeof o === "string" ? { label: o, color: importedOptionColor(i) } : { label: o.label, color: o.color ?? importedOptionColor(i) },
          ),
        });
      }
      const fresh = await detailOf(detail.database.id, true);
      return describeColumn(fresh.columns.find((c) => c.id === column.id)!, await listDatabases());
    }),
  );

  server.registerTool(
    "imago_update_property",
    {
      title: "Update a property",
      description:
        "Renames a property, changes its configuration (merged into the current one) or edits its options: add, rename or remove them (an option still in use cannot be removed).",
      inputSchema: {
        database: databaseRef,
        property: propertyRef,
        name: z.string().trim().min(1).max(300).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        addOptions: z.array(z.string().min(1).max(300)).max(1000).optional(),
        renameOptions: z.array(z.object({ from: z.string().min(1).max(300), to: z.string().min(1).max(300) })).max(1000).optional(),
        removeOptions: z.array(z.string().min(1).max(300)).max(1000).optional(),
      },
      annotations: WRITE,
    },
    handler("imago_update_property", "write", async (args: any) => {
      const detail = await resolveDatabase(args.database),
        column = resolveProperty(detail, args.property);
      if (args.name || args.config)
        await run("updateColumn", { id: column.id, ...(args.name ? { name: args.name } : {}), ...(args.config ? { config: { ...column.config, ...args.config } } : {}) });
      if (args.addOptions?.length || args.renameOptions?.length || args.removeOptions?.length) {
        if (!columnTypeHasOptions(column.type)) throw new ToolError(`Las propiedades de tipo ${column.type} no tienen opciones.`);
        const find = (label: string) => {
          const option = column.options.find((o) => o.id === label || optionKey(o.label) === optionKey(label));
          if (!option) throw new ToolError(`«${column.name}» no tiene la opción «${label}».`);
          return option;
        };
        const renames = new Map((args.renameOptions ?? []).map((r: { from: string; to: string }) => [find(r.from).id, r.to.trim()]));
        const removed = new Set((args.removeOptions ?? []).map((l: string) => find(l).id));
        const kept = column.options
          .filter((o) => !removed.has(o.id))
          .map((o) => ({ id: o.id, label: (renames.get(o.id) as string | undefined) ?? o.label, color: o.color }));
        const added = (args.addOptions ?? [])
          .filter((l: string) => !kept.some((o) => optionKey(o.label) === optionKey(l)))
          .map((label: string, i: number) => ({ label: label.trim(), color: importedOptionColor(kept.length + i) }));
        await run("saveOptions", { columnId: column.id, options: [...kept, ...added] });
      }
      const fresh = await detailOf(detail.database.id, true);
      return describeColumn(fresh.columns.find((c) => c.id === column.id)!, await listDatabases());
    }),
  );

  server.registerTool(
    "imago_convert_property",
    {
      title: "Change a property's type",
      description:
        "Converts a property to another type, keeping what each value can keep. With apply false it only reports what would change; apply true converts.",
      inputSchema: { database: databaseRef, property: propertyRef, type: z.enum(COLUMN_TYPE_IDS), apply: z.boolean() },
      annotations: DESTRUCTIVE,
    },
    handler("imago_convert_property", "write", async (args: { database: string; property: string; type: string; apply: boolean }) => {
      const detail = await resolveDatabase(args.database),
        column = resolveProperty(detail, args.property);
      return run("convertColumn", { id: column.id, type: args.type, apply: args.apply });
    }),
  );

  server.registerTool(
    "imago_delete_property",
    {
      title: "Delete a property",
      description: "Deletes a property and its values from every record. This cannot be undone: ask the user first.",
      inputSchema: { database: databaseRef, property: propertyRef },
      annotations: DESTRUCTIVE,
    },
    handler("imago_delete_property", "write", async (args: { database: string; property: string }) => {
      const detail = await resolveDatabase(args.database),
        column = resolveProperty(detail, args.property);
      await run("deleteColumn", { id: column.id });
      return { deleted: { id: column.id, name: column.name, type: column.type } };
    }),
  );

  server.registerTool(
    "imago_reorder_properties",
    {
      title: "Reorder properties",
      description: "Sets the order of a database's properties. List every property once.",
      inputSchema: { database: databaseRef, properties: z.array(propertyRef).min(1).max(500) },
      annotations: WRITE,
    },
    handler("imago_reorder_properties", "write", async (args: { database: string; properties: string[] }) => {
      const detail = await resolveDatabase(args.database);
      await run("reorderColumns", { databaseId: detail.database.id, columnIds: args.properties.map((p) => resolveProperty(detail, p).id) });
      return { order: (await detailOf(detail.database.id, true)).columns.map((c) => c.name) };
    }),
  );

  server.registerTool(
    "imago_create_records",
    {
      title: "Create records",
      description:
        "Creates records in a database and fills their values (by property name). Option labels that do not exist yet are added unless createMissingOptions is false. Up to 500 records per call.",
      inputSchema: {
        database: databaseRef,
        records: z.array(z.object({ values: valuesSchema })).min(1).max(500),
        createMissingOptions: z.boolean().optional().describe("Default true."),
      },
      annotations: WRITE,
    },
    handler(
      "imago_create_records",
      "write",
      async (args: { database: string; records: { values: Record<string, unknown> }[]; createMissingOptions?: boolean }) => {
        const detail = await resolveDatabase(args.database);
        // Every name and value is checked before any record is created.
        const encoded = await encodeValues(detail.database.id, args.records.map((r) => r.values ?? {}), args.createMissingOptions !== false);
        const ids: string[] = await run("createRows", { databaseId: detail.database.id, count: args.records.length });
        try {
          await writeCells(encoded.flatMap((cells, i) => cells.map((c) => ({ rowId: ids[i], columnId: c.columnId, value: c.value }))));
        } catch (error) {
          await run("deleteRows", { ids }).catch(() => {});
          throw error;
        }
        const created = ids.map((id, i) => ({ id, written: encoded[i].map((c) => c.name) }));
        return { created: created.length, records: created };
      },
    ),
  );

  server.registerTool(
    "imago_update_records",
    {
      title: "Update records",
      description:
        "Changes values of existing records (by property name; null clears). Option labels that do not exist yet are added unless createMissingOptions is false. Up to 500 records per call.",
      inputSchema: {
        updates: z.array(z.object({ recordId: z.string().min(1).max(200), values: valuesSchema })).min(1).max(500),
        createMissingOptions: z.boolean().optional().describe("Default true."),
      },
      annotations: WRITE,
    },
    handler(
      "imago_update_records",
      "write",
      async (args: { updates: { recordId: string; values: Record<string, unknown> }[]; createMissingOptions?: boolean }) => {
        const rows: RecordRow[] = [];
        for (const update of args.updates) rows.push(await getRecord(update.recordId));
        const byDatabase = new Map<string, number[]>();
        rows.forEach((row, i) => (byDatabase.get(row.databaseId) ?? byDatabase.set(row.databaseId, []).get(row.databaseId)!).push(i));
        const cells: Cell[] = [];
        const done: { id: string; written: string[] }[] = rows.map((row) => ({ id: row.id, written: [] }));
        for (const [databaseId, indexes] of byDatabase) {
          const encoded = await encodeValues(databaseId, indexes.map((i) => args.updates[i].values ?? {}), args.createMissingOptions !== false);
          indexes.forEach((index, k) => {
            done[index].written = encoded[k].map((c) => c.name);
            cells.push(...encoded[k].map((c) => ({ rowId: rows[index].id, columnId: c.columnId, value: c.value })));
          });
        }
        await writeCells(cells);
        return { updated: done.length, records: done };
      },
    ),
  );

  server.registerTool(
    "imago_delete_records",
    {
      title: "Delete records",
      description: "Deletes records and their images in Imago. This cannot be undone: ask the user first.",
      inputSchema: { recordIds: z.array(z.string().min(1).max(200)).min(1).max(5000) },
      annotations: DESTRUCTIVE,
    },
    handler("imago_delete_records", "write", async ({ recordIds }: { recordIds: string[] }) => {
      for (const id of recordIds) await getRecord(id);
      await run("deleteRows", { ids: recordIds });
      return { deleted: recordIds.length };
    }),
  );

  server.registerTool(
    "imago_import_images",
    {
      title: "Import images",
      description:
        "Imports image files or folders from this computer into a database: matched to existing records by file name when possible, otherwise one new record per image (createRecords). storage copy keeps a copy inside Imago (default); link points at the original files. Runs as a background task: follow it with imago_list_jobs.",
      inputSchema: {
        database: databaseRef,
        paths: z.array(z.string().min(1).max(4000)).min(1).max(10000).describe("Absolute paths of image files or folders."),
        property: propertyRef.optional().describe("The images property to fill (the first one when omitted)."),
        storage: z.enum(["copy", "link"]).optional(),
        createRecords: z.boolean().optional().describe("Create a record for each image without a match (default true)."),
      },
      annotations: WRITE,
    },
    handler("imago_import_images", "write", async (args: { database: string; paths: string[]; property?: string; storage?: "copy" | "link"; createRecords?: boolean }) => {
      const detail = await resolveDatabase(args.database);
      const column = args.property ? resolveProperty(detail, args.property) : undefined;
      // The window passes paths chosen in a dialog; here they come from the tool's own schema.
      const plan: ImagePlan = await ctx.call("imagePreview", { databaseId: detail.database.id, paths: args.paths, ...(column ? { columnId: column.id } : {}) });
      if (!plan.matches.length) throw new ToolError("No hay imágenes compatibles en esas rutas.");
      const jobId = await run("importImages", {
        token: plan.token,
        storage: args.storage ?? "copy",
        createUnmatched: args.createRecords !== false,
        ...(plan.columnId ? { columnId: plan.columnId } : {}),
        assignments: plan.matches.map((m) => ({ pathToken: m.pathToken, rowId: m.status === "safe" ? m.rowId : null })),
      });
      return {
        jobId,
        files: plan.files,
        matchedToRecords: plan.matches.filter((m) => m.status === "safe" && m.rowId).length,
        newRecords: args.createRecords !== false ? plan.matches.filter((m) => !(m.status === "safe" && m.rowId)).length : 0,
      };
    }),
  );

  server.registerTool(
    "imago_annotate_image",
    {
      title: "Annotate an image",
      description: "Marks a region (fractions 0–1 of the image; w = h = 0 for a point) on an image with a note and tags, or edits an annotation by its id.",
      inputSchema: {
        imageId: z.string().min(1).max(200),
        annotationId: z.string().min(1).max(200).optional(),
        region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }),
        note: z.string().max(20000),
        tags: z.array(z.string().max(120)).max(50).optional(),
        color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
      },
      annotations: WRITE,
    },
    handler("imago_annotate_image", "write", async (args: any) =>
      run("annotationSave", {
        ...(args.annotationId ? { id: args.annotationId } : {}),
        assetId: args.imageId,
        ...args.region,
        note: args.note,
        tags: args.tags ?? [],
        ...(args.color !== undefined ? { color: args.color } : {}),
      }),
    ),
  );

  server.registerTool(
    "imago_delete_annotation",
    {
      title: "Delete an annotation",
      description: "Removes an annotated region from an image.",
      inputSchema: { annotationId: z.string().min(1).max(200) },
      annotations: DESTRUCTIVE,
    },
    handler("imago_delete_annotation", "write", async ({ annotationId }: { annotationId: string }) => {
      await run("annotationDelete", { id: annotationId });
      return { deleted: annotationId };
    }),
  );

  server.registerTool(
    "imago_run_ai_properties",
    {
      title: "Fill AI properties",
      description:
        "Queues Imago's own AI (the models the user configured) to fill AI properties — descriptions, tags, transcriptions, AI selections — for some records or a whole database. It may use a paid API the user set up. Runs in the background: follow it with imago_list_jobs.",
      inputSchema: {
        database: databaseRef,
        properties: z.array(propertyRef).min(1).max(50),
        recordIds: z.array(z.string().min(1).max(200)).max(100000).optional().describe("All records when omitted."),
        overwrite: z.boolean().optional().describe("Also replace cells that already have a value (default false)."),
      },
      annotations: WRITE,
    },
    handler("imago_run_ai_properties", "write", async (args: { database: string; properties: string[]; recordIds?: string[]; overwrite?: boolean }) => {
      const detail = await resolveDatabase(args.database);
      const settings = await run("_settings");
      const jobId = await run("analyze", {
        ...(args.recordIds?.length ? { rowIds: args.recordIds } : { databaseId: detail.database.id }),
        columnIds: args.properties.map((p) => resolveProperty(detail, p).id),
        language: settings.language === "en" ? "English" : "Español",
        detailed: false,
        ...(args.overwrite ? { overwrite: true } : {}),
      });
      return { jobId };
    }),
  );

  for (const [name, command] of [
    ["imago_undo", "undo"],
    ["imago_redo", "redo"],
  ] as const)
    server.registerTool(
      name,
      {
        title: command === "undo" ? "Undo" : "Redo",
        description:
          command === "undo"
            ? "Reverts the last change to values made in Imago (a whole tool call, or an edit in the window), as the Undo button does. Returns how many cells it changed. Deleted records, properties and databases do not come back."
            : "Applies again the last change that was undone.",
        inputSchema: {},
        annotations: WRITE,
      },
      handler(name, "write", async () => ({ changes: await run(command, { scope: "all" }) })),
    );
}

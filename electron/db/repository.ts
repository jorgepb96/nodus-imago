import Database from "better-sqlite3";
import { randomUUID as uuid } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { schema } from "./schema";
import {
  columnTypeHasOptions,
  decodeMultiSelect,
  encodeMultiSelect,
  isDatabaseColumnType,
  newDatabaseShortId,
  normalizeCellValue,
} from "../../shared/databases";
import type {
  DatabaseColumn,
  DatabaseColumnConfig,
  DatabaseColumnType,
  DatabaseDetail,
  DatabaseRow,
  DatabaseSummary,
} from "../../shared/databases";
import { databaseCellStorage } from "../../shared/databaseCellStorage";
import { exportCellText } from "../../shared/databaseExport";
import { splitMultiValue, normalizeCsvValue } from "../../shared/databaseCsv";
import { computeFormulas } from "../../shared/databaseFormulaEval";
import type {
  ImageAsset,
  Job,
  Page,
  Proposal,
  RecordRow,
  SearchInput,
  Settings,
} from "../../shared/imago";
import { settingsSchema } from "../../shared/validation";

export const now = () => new Date().toISOString();
const marks = (xs: unknown[]) => xs.map(() => "?").join(",");
const sqlText = (value: string) => "'" + value.replace(/'/g, "''") + "'";
/** System columns are generated in hydrate(), not stored in db_cells. Filters
 * and sorts must still see them. */
function systemValueSql(column: DatabaseColumn): string | null {
  const stored = `(SELECT value_text FROM db_cells sc WHERE sc.row_id=r.id AND sc.column_id=${sqlText(column.id)})`;
  if (column.type === "unique_id")
    return `COALESCE(${stored}, ${sqlText(column.config.uniqueIdPrefix ?? "")} || r.id)`;
  if (column.type === "created_time")
    return `COALESCE(${stored}, r.created_at)`;
  if (column.type === "last_edited_time")
    return `COALESCE(${stored}, r.updated_at)`;
  return null;
}
const parse = (value: string | null) => (value ? JSON.parse(value) : {});
export class Repository {
  db: Database.Database;
  constructor(public root: string) {
    fs.mkdirSync(root, { recursive: true });
    for (const folder of ["originals", "thumbnails", "models", "staging"])
      fs.mkdirSync(path.join(root, folder), { recursive: true });
    this.db = new Database(path.join(root, "imago.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    const version = this.db
      .prepare("SELECT name FROM sqlite_master WHERE name='imago_schema'")
      .get();
    if (
      version &&
      (
        this.db.prepare("SELECT version FROM imago_schema").get() as {
          version: number;
        }
      ).version !== 1
    )
      throw new Error("Esquema Imago incompatible.");
    this.db.exec(schema);
    // Interrupted work resumes at its last committed item. Cancellation remains final.
    this.db
      .prepare("UPDATE jobs SET state='queued' WHERE state='running'")
      .run();
  }
  close() {
    this.db.close();
  }
  list(): DatabaseSummary[] {
    return this.db
      .prepare(
        `SELECT d.id,d.short_id shortId,d.name,d.icon,d.position,d.created_at createdAt,d.updated_at updatedAt,
      (SELECT count(*) FROM db_rows r WHERE r.database_id=d.id) rowCount FROM db_databases d ORDER BY d.position,d.id`,
      )
      .all() as DatabaseSummary[];
  }
  detail(id: string): DatabaseDetail {
    const database = this.db
      .prepare(
        `SELECT d.id,d.short_id shortId,d.name,d.icon,d.position,d.created_at createdAt,d.updated_at updatedAt,
      (SELECT count(*) FROM db_rows r WHERE r.database_id=d.id) rowCount FROM db_databases d WHERE d.id=?`,
      )
      .get(id) as DatabaseSummary | undefined;
    if (!database) throw new Error("Base de datos no encontrada.");
    const columns = this.db
      .prepare(
        "SELECT id,database_id databaseId,name,type,position,config_json FROM db_columns WHERE database_id=? ORDER BY position,id",
      )
      .all(id) as any[];
    const options = this.db
      .prepare(
        "SELECT id,column_id columnId,label,color,position FROM db_select_options WHERE database_id=? ORDER BY position,id",
      )
      .all(id) as any[];
    return {
      database,
      columns: columns.map((c) => ({
        ...c,
        config: parse(c.config_json),
        options: options.filter((o) => o.columnId === c.id),
      })),
    };
  }
  column(id: string): DatabaseColumn {
    const row = this.db
      .prepare("SELECT database_id FROM db_columns WHERE id=?")
      .get(id) as { database_id: string } | undefined;
    if (!row) throw new Error("Propiedad no encontrada.");
    return this.detail(row.database_id).columns.find((c) => c.id === id)!;
  }
  create(
    name: string,
    defaults = true,
    identity?: { id: string; shortId: string },
  ): DatabaseDetail {
    return this.db.transaction(() => {
      const id = identity?.id ?? uuid(),
        at = now();
      this.db
        .prepare("INSERT INTO db_databases VALUES(?,?,?,?,?,?,?)")
        .run(
          id,
          identity?.shortId ?? newDatabaseShortId(),
          name,
          null,
          this.list().length,
          at,
          at,
        );
      if (defaults) {
        this.addColumn(id, "Título", "title");
        this.addColumn(id, "Imágenes", "attachment");
      }
      return this.detail(id);
    })();
  }
  addColumn(
    databaseId: string,
    name: string,
    type: DatabaseColumnType,
    config: DatabaseColumnConfig = {},
  ): DatabaseColumn {
    if (!isDatabaseColumnType(type)) throw new Error("Tipo desconocido.");
    const detail = this.detail(databaseId);
    if (type === "title" && detail.columns.some((c) => c.type === "title"))
      throw new Error("La base ya tiene una propiedad de título.");
    const id = uuid(),
      at = now();
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO db_columns VALUES(?,?,?,?,?,?,?,?)")
        .run(
          id,
          databaseId,
          name,
          type,
          detail.columns.length,
          JSON.stringify(config),
          at,
          at,
        );
      // A new formula column must show results for rows that already exist.
      if (type === "formula") {
        this.recompute(databaseId);
        this.rebuildText(databaseId);
      }
    })();
    return this.column(id);
  }
  updateColumn(id: string, name?: string, config?: DatabaseColumnConfig) {
    const c = this.column(id);
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE db_columns SET name=?,config_json=?,updated_at=? WHERE id=?",
        )
        .run(name ?? c.name, JSON.stringify(config ?? c.config), now(), id);
      this.recompute(c.databaseId);
      this.rebuildText(c.databaseId);
    })();
  }
  pruneEquivalences(removedColumnIds: string[]) {
    if (!removedColumnIds.length) return;
    const removed = new Set(removedColumnIds),
      settings = this.getSettings(),
      groups = settings.fieldEquivalences
        .map((group) => ({
          ...group,
          columnIds: group.columnIds.filter((id) => !removed.has(id)),
        }))
        .filter((group) => group.columnIds.length >= 2);
    if (
      JSON.stringify(groups) !== JSON.stringify(settings.fieldEquivalences)
    )
      this.updateSettings({ fieldEquivalences: groups });
  }
  deleteColumn(id: string) {
    const c = this.column(id);
    if (c.type === "title")
      throw new Error("La propiedad de título es obligatoria.");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM history WHERE column_id=?").run(id);
      this.db.prepare("DELETE FROM db_columns WHERE id=?").run(id);
      this.pruneEquivalences([id]);
      this.recompute(c.databaseId);
      this.rebuildText(c.databaseId);
      this.db
        .prepare(
          "DELETE FROM embeddings WHERE content_hash NOT IN (SELECT content_hash FROM image_assets)",
        )
        .run();
    })();
  }
  saveOptions(
    columnId: string,
    input: { id?: string; label: string; color: string | null }[],
  ) {
    const column = this.column(columnId);
    if (!columnTypeHasOptions(column.type))
      throw new Error("Esta propiedad no tiene opciones.");
    const labels = input.map((o) =>
      o.label.normalize("NFKC").trim().toLowerCase(),
    );
    if (new Set(labels).size !== labels.length)
      throw new Error("Hay opciones duplicadas.");
    if (input.some((o) => o.id && !column.options.some((x) => x.id === o.id)))
      throw new Error("Identificador de opción ajeno a la propiedad.");
    if (
      new Set(input.filter((o) => o.id).map((o) => o.id)).size !==
      input.filter((o) => o.id).length
    )
      throw new Error("ID de opción duplicado.");
    const removed = column.options.filter(
      (o) => !input.some((n) => n.id === o.id),
    );
    for (const option of removed) {
      const rows = this.db
        .prepare("SELECT value_text FROM db_cells WHERE column_id=?")
        .all(columnId) as { value_text: string }[];
      if (
        rows.some(
          (r) =>
            r.value_text === option.id ||
            decodeMultiSelect(r.value_text).includes(option.id),
        )
      )
        throw new Error(
          `La opción «${option.label}» está en uso. Reasigna sus registros antes de eliminarla.`,
        );
    }
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM db_select_options WHERE column_id=?")
        .run(columnId);
      input.forEach((o, i) =>
        this.db
          .prepare("INSERT INTO db_select_options VALUES(?,?,?,?,?,?,?,?)")
          .run(
            o.id ?? uuid(),
            column.databaseId,
            columnId,
            o.label.trim(),
            o.color,
            i,
            now(),
            now(),
          ),
      );
      this.rebuildText(column.databaseId);
    })();
  }
  createRow(databaseId: string, index = true): RecordRow {
    this.detail(databaseId);
    const id = uuid(),
      at = now();
    this.db
      .prepare("INSERT INTO db_rows VALUES(?,?,?,?,?)")
      .run(
        id,
        databaseId,
        (
          this.db
            .prepare(
              "SELECT coalesce(max(position),-1)+1 n FROM db_rows WHERE database_id=?",
            )
            .get(databaseId) as any
        ).n,
        at,
        at,
      );
    if (index) this.indexRow(id);
    return this.getRow(id);
  }
  rawCell(
    rowId: string,
    columnId: string,
    value: string | null,
    type: DatabaseColumnType,
  ) {
    if (value == null)
      this.db
        .prepare("DELETE FROM db_cells WHERE row_id=? AND column_id=?")
        .run(rowId, columnId);
    else {
      const v = databaseCellStorage(type, value);
      this.db
        .prepare(
          `INSERT INTO db_cells(row_id,column_id,value_text,value_type,value_number,value_integer,value_date,value_json,value_reference) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(row_id,column_id) DO UPDATE SET value_text=excluded.value_text,value_type=excluded.value_type,value_number=excluded.value_number,value_integer=excluded.value_integer,value_date=excluded.value_date,value_json=excluded.value_json,value_reference=excluded.value_reference`,
        )
        .run(
          rowId,
          columnId,
          v.value_text,
          v.value_type,
          v.value_number,
          v.value_integer,
          v.value_date,
          v.value_json,
          v.value_reference,
        );
    }
  }
  setCell(rowId: string, columnId: string, raw: string | null, history = true) {
    const c = this.column(columnId),
      row = this.getRow(rowId);
    if (c.databaseId !== row.databaseId)
      throw new Error("La propiedad pertenece a otra base de datos.");
    if (
      [
        "formula",
        "rollup",
        "unique_id",
        "created_time",
        "last_edited_time",
        "attachment",
        "files",
      ].includes(c.type)
    )
      throw new Error(
        "Propiedad calculada o de archivo: utiliza su editor específico.",
      );
    const value = normalizeCellValue(c.type, raw);
    const optionIds =
      c.type === "multi_select"
        ? decodeMultiSelect(value)
        : columnTypeHasOptions(c.type) && value
          ? [value]
          : [];
    if (optionIds.some((v) => !c.options.some((o) => o.id === v)))
      throw new Error("Opción no válida para esta propiedad.");
    if (c.type === "number" && raw?.trim() && value == null)
      throw new Error("Número no válido.");
    this.db.transaction(() => {
      if (c.type === "relation") {
        const targets = value ? JSON.parse(value) : [];
        if (
          !Array.isArray(targets) ||
          targets.some((t) => typeof t !== "string")
        )
          throw new Error("Selecciona los registros relacionados.");
        if (c.config.relationCardinality === "one" && targets.length > 1)
          throw new Error("Solo se permite una relación.");
        for (const t of targets) {
          const target = this.getRow(t);
          if (
            c.config.relationTargetDatabaseId &&
            c.config.relationTargetDatabaseId !== target.databaseId
          )
            throw new Error("Base relacionada incompatible.");
        }
        this.db
          .prepare("DELETE FROM db_relations WHERE row_id=? AND column_id=?")
          .run(rowId, columnId);
        targets.forEach((t, i) =>
          this.db
            .prepare("INSERT INTO db_relations VALUES(?,?,?,?,?,?,?,?,?,?)")
            .run(
              uuid(),
              row.databaseId,
              rowId,
              columnId,
              "db_row",
              t,
              null,
              this.getRow(t).title,
              i,
              now(),
            ),
        );
      }
      if (history && (row.cells[columnId] ?? null) !== value)
        this.db
          .prepare(
            "INSERT INTO history(batch_id,row_id,column_id,before_value,after_value,created_at) VALUES(?,?,?,?,?,?)",
          )
          .run(
            uuid(),
            rowId,
            columnId,
            row.cells[columnId] ?? null,
            value,
            now(),
          );
      this.rawCell(rowId, columnId, value, c.type);
      this.db
        .prepare("UPDATE db_rows SET updated_at=? WHERE id=?")
        .run(now(), rowId);
      this.db
        .prepare("UPDATE db_databases SET updated_at=? WHERE id=?")
        .run(now(), row.databaseId);
      this.recompute(row.databaseId);
      this.indexRow(rowId);
    })();
  }
  recompute(databaseId: string) {
    const columns = this.detail(databaseId).columns;
    if (!columns.some((c) => c.type === "formula")) return;
    const ids = (
      this.db
        .prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position")
        .all(databaseId) as { id: string }[]
    ).map((x) => x.id);
    const rows: RecordRow[] = [];
    for (let i = 0; i < ids.length; i += 200)
      rows.push(...this.hydrate(ids.slice(i, i + 200)));
    computeFormulas(rows, columns);
    for (const row of rows)
      for (const c of columns.filter((c) => c.type === "formula"))
        this.rawCell(row.id, c.id, row.cells[c.id] ?? null, c.type);
    // Formula edits may change other rows (table-wide statistics).
    for (const row of rows) this.indexRow(row.id);
  }
  hydrate(ids: string[]): RecordRow[] {
    if (!ids.length) return [];
    const p = marks(ids);
    const rows = this.db
      .prepare(
        `SELECT r.id,r.database_id databaseId,r.position,r.created_at createdAt,r.updated_at updatedAt,d.name databaseName FROM db_rows r JOIN db_databases d ON d.id=r.database_id WHERE r.id IN (${p})`,
      )
      .all(...ids) as RecordRow[];
    const cells = this.db
      .prepare(
        `SELECT row_id,column_id,value_text FROM db_cells WHERE row_id IN (${p})`,
      )
      .all(...ids) as any[];
    const assets = this.db
      .prepare(
        `SELECT id,row_id rowId,column_id columnId,file_name fileName,content_hash contentHash,bytes,width,height,position,metadata_json,description FROM image_assets WHERE row_id IN (${p}) ORDER BY position,created_at`,
      )
      .all(...ids) as any[];
    const titleCols = this.db
      .prepare("SELECT id,database_id FROM db_columns WHERE type='title'")
      .all() as any[];
    const systemColumns = this.db
      .prepare(
        "SELECT id,database_id,type,config_json FROM db_columns WHERE type IN ('unique_id','created_time','last_edited_time')",
      )
      .all() as any[];
    for (const row of rows) {
      row.cells = Object.fromEntries(
        cells
          .filter((c) => c.row_id === row.id)
          .map((c) => [c.column_id, c.value_text]),
      );
      for (const column of systemColumns.filter(
        (c) => c.database_id === row.databaseId,
      ))
        row.cells[column.id] ??=
          column.type === "unique_id"
            ? (parse(column.config_json).uniqueIdPrefix ?? "") + row.id
            : column.type === "created_time"
              ? row.createdAt
              : row.updatedAt;
      row.images = assets
        .filter((a) => a.rowId === row.id)
        .map((a) => ({
          ...a,
          metadata: parse(a.metadata_json),
          missing: false,
        }));
      row.title =
        row.cells[
          titleCols.find((c) => c.database_id === row.databaseId)?.id
        ] || row.id.slice(0, 8);
      row.attachments = {};
      for (const a of row.images)
        (row.attachments[a.columnId] ??= []).push({
          id: a.id,
          rowId: a.rowId,
          columnId: a.columnId,
          fileName: a.fileName,
          mimeType: "image/*",
          bytes: a.bytes,
          hasBlob: false,
          contentHash: a.contentHash,
          extractedText: null,
          description: a.description,
          aiGenerated: false,
          aiPrompt: null,
          position: a.position,
          createdAt: row.createdAt,
        });
    }
    const map = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => (map.has(id) ? [map.get(id)!] : []));
  }
  getRow(id: string) {
    const row = this.hydrate([id])[0];
    if (!row) throw new Error("Registro no encontrado.");
    return row;
  }
  indexRow(
    id: string,
    suppliedColumns?: DatabaseColumn[],
    suppliedRow?: RecordRow,
  ) {
    const row = suppliedRow ?? this.getRow(id),
      columns = suppliedColumns ?? this.detail(row.databaseId).columns;
    const body = columns
      .map((c) => exportCellText(c, row))
      .concat(
        row.images.map((a) =>
          [a.fileName, a.description, JSON.stringify(a.metadata)]
            .filter(Boolean)
            .join(" "),
        ),
      )
      .join("\n");
    this.db
      .prepare(
        "INSERT INTO search_documents VALUES(?,?,?) ON CONFLICT(row_id) DO UPDATE SET body=excluded.body,database_id=excluded.database_id",
      )
      .run(id, row.databaseId, body);
  }
  rebuildText(databaseId?: string) {
    return this.db.transaction(() => {
      const rows = (
        databaseId
          ? this.db
              .prepare("SELECT id FROM db_rows WHERE database_id=?")
              .all(databaseId)
          : this.db.prepare("SELECT id FROM db_rows").all()
      ) as { id: string }[];
      const columns = new Map<string, DatabaseColumn[]>();
      for (let i = 0; i < rows.length; i += 200)
        for (const row of this.hydrate(
          rows.slice(i, i + 200).map((r) => r.id),
        )) {
          if (!columns.has(row.databaseId))
            columns.set(row.databaseId, this.detail(row.databaseId).columns);
          this.indexRow(row.id, columns.get(row.databaseId), row);
        }
      return rows.length;
    })();
  }
  deleteRows(ids: string[]) {
    if (!ids.length) return;
    const databases = new Set(
      (
        this.db
          .prepare(
            `SELECT DISTINCT database_id FROM db_rows WHERE id IN (${marks(ids)})`,
          )
          .all(...ids) as { database_id: string }[]
      ).map((row) => row.database_id),
    );
    this.db.transaction(() => {
      for (const id of ids) {
        this.db.prepare("DELETE FROM history WHERE row_id=?").run(id);
        this.db.prepare("DELETE FROM db_rows WHERE id=?").run(id);
      }
      // Table-wide formulas (rank, percent of total, column totals) depend on
      // the remaining rows; keep the deletion and the recomputation atomic.
      for (const databaseId of databases) this.recompute(databaseId);
      this.db
        .prepare(
          "DELETE FROM embeddings WHERE content_hash NOT IN (SELECT content_hash FROM image_assets)",
        )
        .run();
    })();
  }
  literal(input: SearchInput, candidates?: string[]): Page {
    const where: string[] = [],
      params: unknown[] = [];
    const scope = input.databaseIds;
    if (scope?.length) {
      where.push(`r.database_id IN (${marks(scope)})`);
      params.push(...scope);
    }
    if (scope && !scope.length) return { rows: [], total: 0 };
    if (candidates) {
      if (!candidates.length) return { rows: [], total: 0 };
      where.push(`r.id IN (${marks(candidates)})`);
      params.push(...candidates);
    }
    const query = input.query?.trim();
    let order = "r.position,r.id",
      join = "";
    if (query) {
      if (input.match === "partial") {
        where.push(
          "EXISTS(SELECT 1 FROM search_documents s WHERE s.row_id=r.id AND s.body LIKE ? ESCAPE '\\')",
        );
        params.push("%" + query.replace(/[\\%_]/g, "\\$&") + "%");
      } else {
        const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
        const fts =
          input.match === "phrase"
            ? quote(query)
            : query.split(/\s+/).map(quote).join(" AND ");
        join = "JOIN records_fts ON records_fts.row_id=r.id";
        where.push("records_fts MATCH ?");
        params.push(fts);
        order = "records_fts.rank,r.id";
      }
    }
    const filterGroups = new Map<string, NonNullable<SearchInput["filters"]>>();
    for (const f of input.filters ?? []) {
      const key = f.databaseId ?? "";
      if (!filterGroups.has(key)) filterGroups.set(key, []);
      filterGroups.get(key)!.push(f);
    }
    for (const [databaseScope, group] of filterGroups) {
      const clauses: string[] = [];
      if (databaseScope) params.push(databaseScope);
      for (const f of group) {
        const column = this.column(f.columnId);
        if (f.databaseId && f.databaseId !== column.databaseId)
          throw new Error("Filtro de otra base de datos.");
        const operand = Array.isArray(f.value) ? f.value : [f.value];
        if (f.columnIds?.length) {
          const columns = f.columnIds.flatMap((columnId) => {
            try {
              return [this.column(columnId)];
            } catch {
              return [];
            }
          });
          if (!columns.length) {
            clauses.push("0");
            continue;
          }
          const databaseIds = [...new Set(columns.map((c) => c.databaseId))];
          const parts = columns.map((groupColumn) => {
            if (f.op === "empty")
              return {
                sql: "NOT EXISTS(SELECT 1 FROM db_cells c WHERE c.row_id=r.id AND c.column_id=? AND c.value_text IS NOT NULL AND c.value_text<>'')",
                params: [groupColumn.id],
              };
            if (f.op === "contains")
              return {
                sql: "EXISTS(SELECT 1 FROM db_cells c WHERE c.row_id=r.id AND c.column_id=? AND c.value_text LIKE ? ESCAPE '\\')",
                params: [
                  groupColumn.id,
                  "%" +
                    String(operand[0] ?? "").replace(/[\\%_]/g, "\\$&") +
                    "%",
                ],
              };
            if (f.op === "equals")
              return {
                sql: "EXISTS(SELECT 1 FROM db_cells c WHERE c.row_id=r.id AND c.column_id=? AND c.value_text=?)",
                params: [groupColumn.id, String(operand[0] ?? "")],
              };
            if (f.op === "any" || f.op === "all") {
              if (!operand.length)
                return { sql: "0", params: [] as unknown[] };
              return {
                sql:
                  "EXISTS(SELECT 1 FROM db_cells c WHERE c.row_id=r.id AND c.column_id=? AND (" +
                  operand
                    .map(
                      () =>
                        "EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(c.value_text) THEN c.value_text ELSE '[]' END) j WHERE j.value=?)",
                    )
                    .join(f.op === "all" ? " AND " : " OR ") +
                  "))",
                params: [groupColumn.id, ...operand],
              };
            }
            const numeric = groupColumn.type === "number",
              value = numeric ? Number(operand[0]) : String(operand[0] ?? "");
            if (numeric && !Number.isFinite(value))
              throw new Error("Filtro numérico no válido.");
            return {
              sql: `EXISTS(SELECT 1 FROM db_cells c WHERE c.row_id=r.id AND c.column_id=? AND ${numeric ? "c.value_number" : "coalesce(json_extract(CASE WHEN json_valid(c.value_text) THEN c.value_text ELSE '{}' END,'$.start'),c.value_text)"} ${f.op === "gte" ? ">=" : "<="} ?)`,
              params: [groupColumn.id, value],
            };
          });
          const combined = `(${parts.map((part) => part.sql).join(f.op === "empty" ? " AND " : " OR ")})`;
          const guard = databaseIds.length
            ? `(r.database_id NOT IN (${marks(databaseIds)}) OR ${combined})`
            : combined;
          clauses.push(guard);
          params.push(...databaseIds, ...parts.flatMap((part) => part.params));
          continue;
        }
        const system = systemValueSql(column);
        let clause = "";

        if (f.op === "empty") {
          if (system) clause = "0";
          else {
            clause +=
              "NOT EXISTS(SELECT 1 FROM db_cells c WHERE c.row_id=r.id AND c.column_id=? AND c.value_text IS NOT NULL AND c.value_text<>'')";
            params.push(f.columnId);
          }
        } else if (system) {
          if (f.op === "contains") {
            clause = `${system} LIKE ? ESCAPE '\\'`;
            params.push("%" + operand[0].replace(/[\\%_]/g, "\\$&") + "%");
          } else if (f.op === "equals") {
            clause = `${system}=?`;
            params.push(operand[0]);
          } else {
            clause = `${system} ${f.op === "gte" ? ">=" : "<="} ?`;
            params.push(operand[0]);
          }
        } else {
          clause +=
            "EXISTS(SELECT 1 FROM db_cells c WHERE c.row_id=r.id AND c.column_id=? AND ";
          params.push(f.columnId);
          if (f.op === "any" || f.op === "all") {
            if (!operand.length) clause += "0";
            else {
              clause +=
                "(" +
                operand
                  .map(
                    () =>
                      "EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(c.value_text) THEN c.value_text ELSE '[]' END) j WHERE j.value=?)",
                  )
                  .join(f.op === "all" ? " AND " : " OR ") +
                ")";
              params.push(...operand);
            }
          } else if (f.op === "contains") {
            clause += "c.value_text LIKE ? ESCAPE '\\'";
            params.push("%" + operand[0].replace(/[\\%_]/g, "\\$&") + "%");
          } else if (f.op === "equals") {
            clause += "c.value_text=?";
            params.push(operand[0]);
          } else {
            const numeric = column.type === "number";
            const v = numeric ? Number(operand[0]) : operand[0];
            if (numeric && !Number.isFinite(v))
              throw new Error("Filtro numérico no válido.");
            clause += `${numeric ? "c.value_number" : "coalesce(json_extract(CASE WHEN json_valid(c.value_text) THEN c.value_text ELSE '{}' END,'$.start'),c.value_text)"} ${f.op === "gte" ? ">=" : "<="} ?`;
            params.push(v);
          }
          clause += ")";
        }
        clauses.push(clause);
      }
      if (clauses.length) {
        const combined =
          "(" +
          clauses.join(input.filterLogic === "or" ? " OR " : " AND ") +
          ")";
        where.push(
          databaseScope ? "(r.database_id<>? OR " + combined + ")" : combined,
        );
      }
    }
    let orderParams = params;
    if (input.sortColumn) {
      const c = this.column(input.sortColumn),
        system = systemValueSql(c);
      if (system)
        order = `${system} ${input.descending ? "DESC" : "ASC"},r.id`;
      else {
        order = `(SELECT ${c.type === "number" ? "value_number" : "value_text"} FROM db_cells sc WHERE sc.row_id=r.id AND sc.column_id=?) ${input.descending ? "DESC" : "ASC"},r.id`;
        orderParams = [...params, input.sortColumn];
      }
    }
    const sql = `FROM db_rows r ${join} ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
    const total = (
      this.db.prepare(`SELECT count(*) n ${sql}`).get(...params) as any
    ).n;
    const found = this.db
      .prepare(`SELECT r.id ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...orderParams, input.limit ?? 100, input.offset ?? 0) as {
      id: string;
    }[];
    const rows = this.hydrate(found.map((r) => r.id));
    for (const row of rows) {
      if (query) {
        const body =
          (
            this.db
              .prepare("SELECT body FROM search_documents WHERE row_id=?")
              .get(row.id) as any
          )?.body ?? "";
        const start = Math.max(
          0,
          body.toLowerCase().indexOf(query.toLowerCase()) - 35,
        );
        row.snippet = body.slice(start, start + 200);
      }
    }
    return { rows, total };
  }
  importCsv(
    name: string,
    headers: string[],
    types: DatabaseColumnType[],
    rows: string[][],
  ) {
    if (
      headers.length !== types.length ||
      !headers.length ||
      types.filter((t) => t === "title").length !== 1
    )
      throw new Error("Selecciona exactamente una columna de título.");
    // Never silently drop values when the user overrides detection.
    for (const row of rows)
      for (let i = 0; i < types.length; i++)
        if (
          row[i]?.trim() &&
          ["number", "date", "time", "checkbox"].includes(types[i]) &&
          normalizeCsvValue(types[i], row[i]) == null
        )
          throw new Error(
            `«${row[i]}» no se puede importar como ${types[i]} en «${headers[i]}».`,
          );
    return this.db.transaction(() => {
      const detail = this.create(name, false),
        columns = headers.map((h, i) =>
          this.addColumn(detail.database.id, h, types[i]),
        );
      const maps = new Map<string, Map<string, string>>();
      for (const c of columns.filter((c) => columnTypeHasOptions(c.type)))
        maps.set(c.id, new Map());
      const rowInsert = this.db.prepare(
        "INSERT INTO db_rows VALUES(?,?,?,?,?)",
      );
      for (let position = 0; position < rows.length; position++) {
        const values = rows[position],
          rowId = uuid(),
          at = now();
        rowInsert.run(rowId, detail.database.id, position, at, at);
        for (let i = 0; i < columns.length; i++) {
          const c = columns[i],
            raw = values[i] ?? "";
          let value: string | null;
          if (columnTypeHasOptions(c.type)) {
            const labels =
              c.type === "multi_select"
                ? splitMultiValue(raw)
                : raw.trim()
                  ? [raw.trim()]
                  : [];
            const map = maps.get(c.id)!;
            const options = labels.map((label) => {
              const key = label.normalize("NFKC").trim().toLowerCase();
              if (!map.has(key)) {
                const id = uuid();
                map.set(key, id);
                this.db
                  .prepare(
                    "INSERT INTO db_select_options VALUES(?,?,?,?,?,?,?,?)",
                  )
                  .run(
                    id,
                    c.databaseId,
                    c.id,
                    label,
                    "#6366f1",
                    map.size - 1,
                    at,
                    at,
                  );
              }
              return map.get(key)!;
            });
            value =
              c.type === "multi_select"
                ? encodeMultiSelect([...new Set(options)])
                : (options[0] ?? null);
          } else value = normalizeCsvValue(c.type, raw);
          this.rawCell(rowId, c.id, value, c.type);
        }
      }
      this.rebuildText(detail.database.id);
      return this.detail(detail.database.id);
    })();
  }
  getSettings(): Settings {
    const saved = this.db
      .prepare("SELECT value FROM settings WHERE key='preferences'")
      .get() as { value: string } | undefined;
    return settingsSchema.parse({
      mode: "system",
      theme: "default",
      accent: "#6366f1",
      language: "es",
      profile: os.totalmem() < 8 * 2 ** 30 ? "light" : "balanced",
      dimensions: 512,
      python: process.platform === "win32" ? "python" : "python3",
      device: "cpu",
      visionModel: "lfm3-vl-2b",
      descriptionModel: { provider: "local", model: "lfm3-vl-2b" },
      classificationModel: { provider: "local", model: "lfm3-vl-2b" },
      remoteEnabled: false,
      apiProfiles: {},
      apiDelayMs: 1000,
      parallelJobs: os.totalmem() >= 12 * 2 ** 30 ? 2 : 1,
      fieldEquivalences: [],
      ...parse(saved?.value ?? null),
    });
  }
  updateSettings(patch: Partial<Settings>) {
    const settings = settingsSchema.parse({ ...this.getSettings(), ...patch });
    this.db
      .prepare(
        "INSERT INTO settings VALUES('preferences',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(settings));
    return settings;
  }
  jobs(): Job[] {
    return this.db
      .prepare(
        "SELECT id,kind,coalesce(json_extract(payload_json,'$.label'),'') label,state,done,total,failed,skipped,message,created_at createdAt,updated_at updatedAt FROM jobs WHERE state IN ('queued','running','paused','failed') OR id IN(SELECT id FROM jobs WHERE state IN ('completed','cancelled') ORDER BY created_at DESC LIMIT 50) ORDER BY CASE state WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'paused' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END,created_at DESC",
      )
      .all() as Job[];
  }
  newJob(kind: string, payload: unknown, total: number) {
    const id = uuid(),
      at = now();
    this.db
      .prepare(
        "INSERT INTO jobs(id,kind,state,payload_json,total,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(id, kind, "queued", JSON.stringify(payload), total, at, at);
    return id;
  }
  proposals(): Proposal[] {
    return this.db
      .prepare(
        `SELECT p.id,p.row_id rowId,p.column_id columnId,p.before_value before,p.value,p.model,p.revision,p.prompt,p.created_at createdAt,p.state,c.name columnName,
    coalesce((SELECT ce.value_text FROM db_cells ce JOIN db_columns tc ON tc.id=ce.column_id WHERE ce.row_id=p.row_id AND tc.type='title'),'') title
    FROM proposals p JOIN db_columns c ON c.id=p.column_id WHERE p.state='pending' ORDER BY p.created_at`,
      )
      .all() as Proposal[];
  }
  provenance(rowId: string) {
    return this.db
      .prepare(
        `SELECT p.id,p.column_id columnId,c.name columnName,p.value,p.model,p.revision,p.prompt,p.state,p.created_at createdAt
         FROM proposals p JOIN db_columns c ON c.id=p.column_id
         WHERE p.row_id=? ORDER BY p.created_at DESC`,
      )
      .all(rowId) as {
      id: string;
      columnId: string;
      columnName: string;
      value: string | null;
      model: string;
      revision: string;
      prompt: string;
      state: "pending" | "accepted" | "rejected";
      createdAt: string;
    }[];
  }
  reviewProposals(ids: string[], action: "accept" | "reject") {
    return this.db.transaction(() => {
      let applied = 0,
        conflicts = 0;
      const batch = uuid();
      for (const id of ids) {
        const p = this.db
          .prepare("SELECT * FROM proposals WHERE id=? AND state='pending'")
          .get(id) as any;
        if (!p) continue;
        if (action === "reject") {
          this.db
            .prepare("UPDATE proposals SET state='rejected' WHERE id=?")
            .run(id);
          applied++;
          continue;
        }
        const row = this.getRow(p.row_id);
        if (
          (row.cells[p.column_id] ?? null) !== p.before_value ||
          (p.before_value != null && p.before_value !== "")
        ) {
          conflicts++;
          continue;
        }
        this.setCell(p.row_id, p.column_id, p.value, false);
        this.db
          .prepare(
            "INSERT INTO history(batch_id,row_id,column_id,before_value,after_value,created_at) VALUES(?,?,?,?,?,?)",
          )
          .run(batch, p.row_id, p.column_id, p.before_value, p.value, now());
        this.db
          .prepare("UPDATE proposals SET state='accepted' WHERE id=?")
          .run(id);
        applied++;
      }
      return { applied, conflicts };
    })();
  }
  undo() {
    return this.db.transaction(() => {
      const last = this.db
        .prepare(
          "SELECT batch_id FROM history WHERE undone=0 ORDER BY id DESC LIMIT 1",
        )
        .get() as any;
      if (!last) return 0;
      const changes = this.db
        .prepare(
          "SELECT * FROM history WHERE batch_id=? AND undone=0 ORDER BY id DESC",
        )
        .all(last.batch_id) as any[];
      for (const c of changes)
        if (
          (this.getRow(c.row_id).cells[c.column_id] ?? null) !== c.after_value
        )
          throw new Error(
            "El valor cambió después de esta operación. No se ha deshecho ningún cambio.",
          );
      for (const c of changes) {
        this.setCell(c.row_id, c.column_id, c.before_value, false);
        this.db.prepare("UPDATE history SET undone=1 WHERE id=?").run(c.id);
      }
      return changes.length;
    })();
  }
  asset(id: string) {
    const a = this.db
      .prepare("SELECT * FROM image_assets WHERE id=?")
      .get(id) as any;
    if (!a) throw new Error("Imagen no encontrada.");
    return a;
  }
  normalizeImagePositions(rowId: string) {
    const images = this.db
      .prepare(
        "SELECT id FROM image_assets WHERE row_id=? ORDER BY position,created_at,id",
      )
      .all(rowId) as { id: string }[];
    images.forEach((image, position) =>
      this.db
        .prepare("UPDATE image_assets SET position=? WHERE id=?")
        .run(position, image.id),
    );
  }
  deleteImage(id: string) {
    const asset = this.asset(id);
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM image_assets WHERE id=?").run(id);
      this.normalizeImagePositions(asset.row_id);
      this.indexRow(asset.row_id);
      this.db
        .prepare(
          "DELETE FROM embeddings WHERE content_hash NOT IN (SELECT content_hash FROM image_assets)",
        )
        .run();
    })();
    return asset.row_id;
  }
  deleteImages(ids: string[]) {
    if (!ids.length) return 0;
    const assets = ids.map((id) => this.asset(id));
    this.db.transaction(() => {
      for (const asset of assets)
        this.db.prepare("DELETE FROM image_assets WHERE id=?").run(asset.id);
      for (const rowId of new Set(assets.map((asset) => asset.row_id))) {
        this.normalizeImagePositions(rowId);
        this.indexRow(rowId);
      }
      this.db
        .prepare(
          "DELETE FROM embeddings WHERE content_hash NOT IN (SELECT content_hash FROM image_assets)",
        )
        .run();
    })();
    return assets.length;
  }
  reassignImages(
    ids: string[],
    rowId: string,
    columnId?: string,
  ) {
    if (!ids.length) return 0;
    const row = this.getRow(rowId),
      assets = ids.map((id) => this.asset(id));
    const column = columnId ? this.column(columnId) : null;
    if (
      column &&
      (column.databaseId !== row.databaseId ||
        !["attachment", "files"].includes(column.type))
    )
      throw new Error("Destino de imagen incompatible.");
    for (const asset of assets) {
      if (asset.database_id !== row.databaseId)
        throw new Error("Las imágenes pertenecen a otra base de datos.");
      const targetColumn = column ?? this.column(asset.column_id);
      if (
        targetColumn.databaseId !== row.databaseId ||
        !["attachment", "files"].includes(targetColumn.type)
      )
        throw new Error("Columna de imagen incompatible.");
    }
    this.db.transaction(() => {
      for (const asset of assets) {
        const targetColumn = column ?? this.column(asset.column_id);
        this.db
          .prepare(
            "UPDATE image_assets SET database_id=?,row_id=?,column_id=? WHERE id=?",
          )
          .run(row.databaseId, row.id, targetColumn.id, asset.id);
        this.normalizeImagePositions(asset.row_id);
        this.indexRow(asset.row_id);
      }
      this.normalizeImagePositions(row.id);
      this.indexRow(row.id);
    })();
    return assets.length;
  }
  assetPath(id: string, thumbnail = false): string {
    const a = this.asset(id);
    return thumbnail
      ? path.join(this.root, "thumbnails", a.content_hash + ".webp")
      : a.original_path;
  }
  stats() {
    const count = (table: string) =>
      (this.db.prepare(`SELECT count(*) n FROM ${table}`).get() as any)
        .n as number;
    return {
      databases: count("db_databases"),
      rows: count("db_rows"),
      images: count("image_assets"),
      indexed: count("embeddings"),
    };
  }
}

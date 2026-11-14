import Database from "better-sqlite3";
import { createHash, randomUUID as uuid } from "node:crypto";
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
  aggregateRollup,
  type RollupFunction,
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
import {
  splitMultiValue,
  normalizeCsvValue,
  isNullMarker,
  optionKey,
  importedOptionColor,
} from "../../shared/databaseCsv";
import type { CsvImportOptions } from "../../shared/databaseCsv";
import { recordEmbeddingText } from "../../shared/recordEmbedding";
import { computeFormulas } from "../../shared/databaseFormulaEval";
import type {
  ImageAsset,
  Job,
  Page,
  Proposal,
  RecordRow,
  SearchInput,
  Settings,
  MapRecord,
  MapRecordsInput,
} from "../../shared/imago";
import { decodeDatabaseLocation } from "../../shared/databaseProperties";
import {
  installViewFunctions,
  compileViewFilters,
  compileViewSorts,
  propertyChoices,
} from "./viewQuery";
import { settingsSchema } from "../../shared/validation";
import { defaultEmbeddingModel } from "../../shared/embeddingBackends";
import { markdownBlocks, type PageDocument } from "../../shared/pageBlocks";
import { recomputeRollups, validateRollup } from "./rollups";

export const now = () => new Date().toISOString();
const marks = (xs: unknown[]) => xs.map(() => "?").join(",");
const parse = (value: string | null) => (value ? JSON.parse(value) : {});
export class Repository {
  db: Database.Database;
  constructor(public root: string) {
    fs.mkdirSync(root, { recursive: true });
    for (const folder of ["originals", "thumbnails", "models", "staging"])
      fs.mkdirSync(path.join(root, folder), { recursive: true });
    this.db = new Database(path.join(root, "imago.sqlite"));
    installViewFunctions(this.db);
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
    // Collections indexed before stale tracking existed gain the column.
    if (
      !(
        this.db.prepare("PRAGMA table_info(record_embeddings)").all() as {
          name: string;
        }[]
      ).some((c) => c.name === "stale")
    )
      this.db.exec(
        "ALTER TABLE record_embeddings ADD COLUMN stale INTEGER NOT NULL DEFAULT 0",
      );
    // The full-text index used to be kept in step by row_id, an unindexed
    // FTS column, so every record edit scanned the whole index (25 ms per
    // record in a 7,000-record catalogue: minutes for a rename or a type
    // change). It now shares search_documents' rowid; older collections are
    // migrated once.
    const trigger = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='search_delete'")
      .get() as { sql: string } | undefined;
    if (trigger && !trigger.sql.includes("rowid=old.rowid"))
      this.db.transaction(() => {
        this.db.exec(
          "DROP TRIGGER search_insert; DROP TRIGGER search_delete; DROP TRIGGER search_update; DELETE FROM records_fts;",
        );
        this.db.exec(schema);
        this.db.exec(
          "INSERT INTO records_fts(rowid,row_id,database_id,body) SELECT rowid,row_id,database_id,body FROM search_documents",
        );
      })();
    // Interrupted work resumes at its last committed item. Cancellation remains final.
    this.db
      .prepare("UPDATE jobs SET state='queued' WHERE state='running'")
      .run();
  }
  close() {
    this.db.close();
  }
  touchRows(ids: string[]) {
    if (!ids.length) return;
    const at = now(),
      serialized = JSON.stringify([...new Set(ids)]);
    this.db
      .prepare(
        "UPDATE db_rows SET updated_at=? WHERE id IN(SELECT value FROM json_each(?))",
      )
      .run(at, serialized);
    this.db
      .prepare(
        "UPDATE db_databases SET updated_at=? WHERE id IN(SELECT database_id FROM db_rows WHERE id IN(SELECT value FROM json_each(?)))",
      )
      .run(at, serialized);
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
    if (type === "rollup") validateRollup(this, databaseId, config);
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
      if (type === "formula" || type === "rollup") {
        this.recompute(databaseId);
        this.rebuildText(databaseId);
      }
    })();
    return this.column(id);
  }
  updateColumn(id: string, name?: string, config?: DatabaseColumnConfig) {
    const c = this.column(id);
    if (c.type === "rollup" && config)
      validateRollup(this, c.databaseId, config);
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE db_columns SET name=?,config_json=?,updated_at=? WHERE id=?",
        )
        .run(name ?? c.name, JSON.stringify(config ?? c.config), now(), id);
      // Formulas may name the property; the search text holds values only,
      // so a rename alone leaves it as it is. Record vectors that include the
      // old name are refreshed as their records change.
      this.recompute(c.databaseId);
      if (config) this.rebuildText(c.databaseId);
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
    if (JSON.stringify(groups) !== JSON.stringify(settings.fieldEquivalences))
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
  /**
   * Convert a property to another type, as Notion's "Change type": each value
   * is read as text and written in the new type. With `apply` false nothing
   * changes and the result says how many values the new type cannot hold, so
   * the interface can ask before losing them. Options are kept when moving
   * between select, status and multi-select.
   */
  convertColumn(id: string, type: DatabaseColumnType, apply: boolean) {
    const column = this.column(id);
    const convertible = new Set<DatabaseColumnType>([
      "text", "rich_text", "number", "date", "time", "select", "status",
      "multi_select", "checkbox", "url", "email", "phone", "location",
    ]);
    if (!convertible.has(column.type) || !convertible.has(type))
      throw new Error("Este tipo de propiedad no se puede convertir.");
    if (column.type === type) return { total: 0, lost: 0 };
    const ids = (
      this.db
        .prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position")
        .all(column.databaseId) as { id: string }[]
    ).map((r) => r.id);
    const optionTypes = (t: DatabaseColumnType) => columnTypeHasOptions(t);
    const keepOptions = optionTypes(column.type) && optionTypes(type);
    const labels = new Map(column.options.map((o) => [optionKey(o.label), o.id]));
    const created: { id: string; label: string }[] = [];
    const optionFor = (label: string) => {
      const key = optionKey(label);
      let found = labels.get(key);
      if (!found) {
        found = uuid();
        labels.set(key, found);
        created.push({ id: found, label: label.replace(/\s+/g, " ") });
      }
      return found;
    };
    let total = 0,
      lost = 0;
    const values: [string, string | null][] = [];
    for (let i = 0; i < ids.length; i += 500)
      for (const row of this.hydrate(ids.slice(i, i + 500))) {
        const text = exportCellText(column, row).trim();
        if (!text) {
          values.push([row.id, null]);
          continue;
        }
        total++;
        let value: string | null;
        if (optionTypes(type)) {
          const parts =
            type === "multi_select" ? splitMultiValue(text) : [text];
          if (keepOptions && column.type === "multi_select" && type !== "multi_select") {
            const selected = decodeMultiSelect(row.cells[column.id] ?? null);
            if (selected.length > 1) lost++;
            value = selected[0] ?? null;
          } else if (keepOptions && type === "multi_select") {
            value = encodeMultiSelect(
              column.type === "multi_select"
                ? decodeMultiSelect(row.cells[column.id] ?? null)
                : [row.cells[column.id]!],
            );
          } else if (keepOptions) value = row.cells[column.id] ?? null;
          else {
            const ids = [...new Set(parts.filter(Boolean).map(optionFor))];
            value = type === "multi_select" ? encodeMultiSelect(ids) : (ids[0] ?? null);
          }
        } else {
          value = normalizeCsvValue(type, text);
          if (value == null) lost++;
        }
        values.push([row.id, value]);
      }
    if (!apply) return { total, lost };
    const at = now();
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE db_columns SET type=?,updated_at=? WHERE id=?")
        .run(type, at, id);
      if (!optionTypes(type))
        this.db.prepare("DELETE FROM db_select_options WHERE column_id=?").run(id);
      const insert = this.db.prepare(
        "INSERT INTO db_select_options VALUES(?,?,?,?,?,?,?,?)",
      );
      const start = keepOptions ? column.options.length : 0;
      if (!keepOptions && optionTypes(type))
        this.db.prepare("DELETE FROM db_select_options WHERE column_id=?").run(id);
      created.forEach((o, i) =>
        insert.run(o.id, column.databaseId, id, o.label, importedOptionColor(start + i), start + i, at, at),
      );
      if (column.type === "rich_text")
        this.db.prepare("DELETE FROM page_documents WHERE column_id=?").run(id);
      for (const [rowId, value] of values) this.rawCell(rowId, id, value, type);
      this.recompute(column.databaseId);
      this.rebuildText(column.databaseId);
    })();
    return { total, lost };
  }
  /** Copy a property, its options and its values, right after the original. */
  /** `copy` is the word for "copy" in the interface language. */
  duplicateColumn(id: string, copy = "copia") {
    const column = this.column(id);
    if (["title", "attachment", "files", "relation", "ai_image"].includes(column.type))
      throw new Error("Esta propiedad no se puede duplicar.");
    const detail = this.detail(column.databaseId),
      copyId = uuid(),
      at = now();
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE db_columns SET position=position+1 WHERE database_id=? AND position>?")
        .run(column.databaseId, column.position);
      const names = new Set(detail.columns.map((c) => c.name));
      let name = `${column.name} (${copy})`;
      for (let n = 2; names.has(name); n++) name = `${column.name} (${copy} ${n})`;
      this.db
        .prepare("INSERT INTO db_columns VALUES(?,?,?,?,?,?,?,?)")
        .run(copyId, column.databaseId, name, column.type, column.position + 1, JSON.stringify(column.config), at, at);
      const map = new Map<string, string>();
      for (const o of column.options) {
        const optionId = uuid();
        map.set(o.id, optionId);
        this.db
          .prepare("INSERT INTO db_select_options VALUES(?,?,?,?,?,?,?,?)")
          .run(optionId, column.databaseId, copyId, o.label, o.color, o.position, at, at);
      }
      const cells = this.db
        .prepare("SELECT * FROM db_cells WHERE column_id=?")
        .all(id) as Record<string, unknown>[];
      const insert = this.db.prepare(
        "INSERT INTO db_cells(row_id,column_id,value_text,value_type,value_number,value_integer,value_date,value_json,value_reference) VALUES(?,?,?,?,?,?,?,?,?)",
      );
      for (const cell of cells) {
        let text = cell.value_text as string | null;
        if (column.type === "select" || column.type === "status")
          text = text ? (map.get(text) ?? null) : null;
        if (column.type === "multi_select")
          text = encodeMultiSelect(decodeMultiSelect(text).map((o) => map.get(o)!).filter(Boolean));
        insert.run(cell.row_id, copyId, text, cell.value_type, cell.value_number, cell.value_integer, cell.value_date, cell.value_json, cell.value_reference);
      }
      if (column.type === "rich_text")
        this.db
          .prepare(
            "INSERT INTO page_documents(row_id,column_id,format,source_markdown,imported_markdown,tree_json) SELECT row_id,?,format,source_markdown,imported_markdown,tree_json FROM page_documents WHERE column_id=?",
          )
          .run(copyId, id);
      this.recompute(column.databaseId);
      this.rebuildText(column.databaseId);
    })();
    return this.column(copyId);
  }
  /**
   * A column summary for the table footer (Notion's "Calculate"), over every
   * record that matches the current search and filters, not only the page.
   */
  columnSummary(input: SearchInput, columnId: string, fn: RollupFunction, selected?: string[]) {
    const column = this.column(columnId);
    // `selected` comes from a semantic search; otherwise the filters decide.
    const ids =
      selected ??
      this.literalIds({ ...input, databaseIds: [column.databaseId], sorts: undefined, sortColumn: undefined });
    const values: (string | null)[] = [];
    for (let i = 0; i < ids.length; i += 500)
      for (const row of this.hydrate(ids.slice(i, i + 500))) {
        const raw = row.cells[column.id] ?? null;
        values.push(
          ["number", "date", "checkbox"].includes(column.type)
            ? raw
            : exportCellText(column, row) || null,
        );
      }
    // Multi-select counts its labels as one value per record; unique counts labels.
    if (fn === "count_unique" && column.type === "multi_select")
      return {
        value: String(new Set(values.flatMap((v) => (v ? v.split(", ") : []))).size),
        records: ids.length,
      };
    return { value: aggregateRollup(fn, values), records: ids.length };
  }
  /** New property order for a database: exactly its columns, each once. */
  reorderColumns(databaseId: string, columnIds: string[]) {
    const current = this.detail(databaseId).columns.map((c) => c.id);
    if (
      columnIds.length !== current.length ||
      new Set(columnIds).size !== columnIds.length ||
      columnIds.some((id) => !current.includes(id))
    )
      throw new Error(
        "El nuevo orden debe incluir cada propiedad de la base una sola vez.",
      );
    const at = now(),
      update = this.db.prepare(
        "UPDATE db_columns SET position=?,updated_at=? WHERE id=? AND database_id=?",
      );
    this.db.transaction(() =>
      columnIds.forEach((id, position) =>
        update.run(position, at, id, databaseId),
      ),
    )();
    return this.detail(databaseId);
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
      this.recompute(column.databaseId);
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
    if (index) {
      this.recompute(databaseId);
      this.indexRow(id);
    }
    return this.getRow(id);
  }
  createRows(databaseId: string, count: number): string[] {
    if (!Number.isInteger(count) || count < 1 || count > 1000)
      throw new Error("Indica entre 1 y 1.000 registros.");
    this.detail(databaseId);
    const at = now(),
      start = (
        this.db
          .prepare(
            "SELECT coalesce(max(position),-1)+1 n FROM db_rows WHERE database_id=?",
          )
          .get(databaseId) as any
      ).n as number,
      ids = Array.from({ length: count }, () => uuid()),
      insert = this.db.prepare("INSERT INTO db_rows VALUES(?,?,?,?,?)");
    this.db.transaction(() => {
      ids.forEach((id, index) =>
        insert.run(id, databaseId, start + index, at, at),
      );
      this.recompute(databaseId);
      for (const id of ids) this.indexRow(id);
    })();
    return ids;
  }
  private statements = new Map<string, Database.Statement>();
  /** Prepared once per connection: rawCell runs for every cell of an import. */
  private statement(sql: string) {
    let prepared = this.statements.get(sql);
    if (!prepared) {
      prepared = this.db.prepare(sql);
      this.statements.set(sql, prepared);
    }
    return prepared;
  }
  rawCell(
    rowId: string,
    columnId: string,
    value: string | null,
    type: DatabaseColumnType,
  ) {
    if (type === "rich_text") {
      if (value == null)
        this.statement(
          "DELETE FROM page_documents WHERE row_id=? AND column_id=?",
        ).run(rowId, columnId);
      else
        this.statement(
          "INSERT INTO page_documents(row_id,column_id,format,source_markdown,tree_json) VALUES(?,?,?,?,?) ON CONFLICT(row_id,column_id) DO UPDATE SET source_markdown=excluded.source_markdown,tree_json=excluded.tree_json",
        ).run(
          rowId,
          columnId,
          "imago.blocks/1",
          value,
          JSON.stringify(markdownBlocks(value)),
        );
    }
    if (value == null)
      this.statement("DELETE FROM db_cells WHERE row_id=? AND column_id=?").run(
        rowId,
        columnId,
      );
    else {
      const v = databaseCellStorage(type, value);
      this.statement(
        `INSERT INTO db_cells(row_id,column_id,value_text,value_type,value_number,value_integer,value_date,value_json,value_reference) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(row_id,column_id) DO UPDATE SET value_text=excluded.value_text,value_type=excluded.value_type,value_number=excluded.value_number,value_integer=excluded.value_integer,value_date=excluded.value_date,value_json=excluded.value_json,value_reference=excluded.value_reference`,
      ).run(
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
  pageDocument(rowId: string, columnId: string): PageDocument {
    const row = this.getRow(rowId),
      column = this.column(columnId);
    if (column.databaseId !== row.databaseId || column.type !== "rich_text")
      throw Error("Documento incompatible.");
    const saved = this.db
      .prepare(
        "SELECT source_markdown,imported_markdown,tree_json FROM page_documents WHERE row_id=? AND column_id=?",
      )
      .get(rowId, columnId) as any;
    const sourceMarkdown = row.cells[columnId] ?? "";
    return {
      format: "imago.blocks/1",
      sourceMarkdown,
      importedMarkdown: saved?.imported_markdown ?? null,
      blocks:
        saved && saved.source_markdown === sourceMarkdown
          ? JSON.parse(saved.tree_json)
          : markdownBlocks(sourceMarkdown),
    };
  }
  recompute(databaseId: string) {
    if (
      this.db
        .prepare("SELECT 1 FROM db_columns WHERE type='rollup' LIMIT 1")
        .get()
    ) {
      recomputeRollups(this, databaseId);
      return;
    }
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
    // Grouped once: filtering every cell for every record was quadratic.
    const cellsByRow = new Map<string, Record<string, string | null>>(),
      assetsByRow = new Map<string, any[]>();
    for (const c of cells)
      (cellsByRow.get(c.row_id) ??
        cellsByRow.set(c.row_id, {}).get(c.row_id)!)[c.column_id] = c.value_text;
    for (const a of assets)
      (assetsByRow.get(a.rowId) ?? assetsByRow.set(a.rowId, []).get(a.rowId)!).push(a);
    for (const row of rows) {
      row.cells = cellsByRow.get(row.id) ?? {};
      for (const column of systemColumns.filter(
        (c) => c.database_id === row.databaseId,
      ))
        row.cells[column.id] ??=
          column.type === "unique_id"
            ? (parse(column.config_json).uniqueIdPrefix ?? "") + row.id
            : column.type === "created_time"
              ? row.createdAt
              : row.updatedAt;
      row.images = (assetsByRow.get(row.id) ?? [])
        .map((a) => {
          const metadata = parse(a.metadata_json);
          return {
            ...a,
            metadata,
            revision: metadata.imagoRelinkRevision,
            missing: false,
          };
        });
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
    this.statement(
      "INSERT INTO search_documents VALUES(?,?,?) ON CONFLICT(row_id) DO UPDATE SET body=excluded.body,database_id=excluded.database_id WHERE body IS NOT excluded.body OR database_id IS NOT excluded.database_id",
    ).run(id, row.databaseId, body);
    // A text vector that no longer describes the record keeps serving searches
    // but is marked for the next indexing pass (manual or automatic).
    // Undoing an edit makes the old vector current again.
    const hash = recordTextHash(recordEmbeddingText(columns, row));
    this.statement(
      "UPDATE record_embeddings SET stale=(text_hash<>?) WHERE row_id=? AND stale<>(text_hash<>?)",
    ).run(hash, id, hash);
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
  /** SQL shared by the paged literal search and the id-only lanes of semantic search. */
  private literalQuery(input: SearchInput, candidates?: string[]) {
    const where: string[] = [],
      params: unknown[] = [];
    const scope = input.databaseIds;
    if (scope?.length) {
      where.push(`r.database_id IN (${marks(scope)})`);
      params.push(...scope);
    }
    if (scope && !scope.length) return null;
    if (candidates) {
      if (!candidates.length) return null;
      where.push("r.id IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify(candidates));
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
        const fts = ftsExpression(query, input.match ?? "words");
        if (!fts) return null;
        join = "JOIN records_fts ON records_fts.row_id=r.id";
        where.push("records_fts MATCH ?");
        params.push(fts);
        order = "records_fts.rank,r.id";
      }
    }
    const criteria = compileViewFilters(input, (id) => this.column(id));
    if (criteria.sql) {
      where.push(criteria.sql);
      params.push(...criteria.params);
    }
    const sorts = input.sorts?.length
      ? input.sorts
      : input.sortColumn
        ? [
            {
              columnId: input.sortColumn,
              direction: input.descending
                ? ("desc" as const)
                : ("asc" as const),
            },
          ]
        : [];
    if (sorts.length) order = compileViewSorts(sorts, (id) => this.column(id));
    const sql = `FROM db_rows r ${join} ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
    return { sql, params, order };
  }
  /** Every matching record id, in result order, without loading the records. */
  literalIds(input: SearchInput, candidates?: string[]): string[] {
    const built = this.literalQuery(input, candidates);
    if (!built) return [];
    return (
      this.db
        .prepare(`SELECT r.id ${built.sql} ORDER BY ${built.order}`)
        .all(...built.params) as { id: string }[]
    ).map((r) => r.id);
  }
  literal(input: SearchInput, candidates?: string[]): Page {
    const built = this.literalQuery(input, candidates);
    if (!built) return { rows: [], total: 0 };
    const { sql, params, order } = built;
    const query = input.query?.trim();
    const total = (
      this.db.prepare(`SELECT count(*) n ${sql}`).get(...params) as any
    ).n;
    const found = this.db
      .prepare(`SELECT r.id ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, input.limit ?? 100, input.offset ?? 0) as {
      id: string;
    }[];
    const rows = this.hydrate(found.map((r) => r.id));
    if (query) {
      const snippetBody = this.db.prepare(
        "SELECT body FROM search_documents WHERE row_id=?",
      );
      for (const row of rows) {
        const body =
          (snippetBody.get(row.id) as { body: string } | undefined)?.body ?? "";
        row.snippet = snippetAround(body, query);
      }
    }
    return { rows, total };
  }
  propertyChoices(input: {
    columnIds: string[];
    query?: string;
    offset?: number;
    selected?: string[];
  }) {
    return propertyChoices(
      this.db,
      input.columnIds,
      input.query ?? "",
      input.offset ?? 0,
      (id) => this.column(id),
      input.selected,
    );
  }
  mapRecords(input: MapRecordsInput): { records: MapRecord[]; total: number } {
    const column = this.column(input.columnId);
    if (column.databaseId !== input.databaseId || column.type !== "location")
      throw new Error(
        "Elige una propiedad de ubicación de esta base de datos.",
      );
    // Read every matching row in one consistent snapshot. A map is not a page
    // of the grid; only the compact presentation fields cross the IPC boundary.
    return this.db.transaction(() => {
      const records: MapRecord[] = [];
      let total = 0;
      do {
        const page = this.literal({
          databaseIds: [input.databaseId],
          filters: input.filters,
          filterLogic: input.filterLogic,
          filterGroups: input.filterGroups,
          sorts: input.sorts,
          offset: records.length,
          limit: 200,
        });
        total = page.total;
        for (const row of page.rows) {
          const image = row.images.find((asset) => asset.width > 0);
          records.push({
            id: row.id,
            title: row.title,
            location: decodeDatabaseLocation(row.cells[column.id] ?? null),
            image: image ? { id: image.id, revision: image.revision } : null,
            imageCount: row.images.length,
          });
        }
        if (!page.rows.length) break;
      } while (records.length < total);
      return { records, total };
    })();
  }
  importCsv(
    name: string,
    headers: string[],
    types: DatabaseColumnType[],
    rows: string[][],
    options: CsvImportOptions = {},
  ) {
    if (
      headers.length !== types.length ||
      !headers.length ||
      types.filter((t) => t === "title").length !== 1
    )
      throw new Error("Selecciona exactamente una columna de título.");
    const empty = (raw: string) =>
      options.nullMarkersAsEmpty === true && isNullMarker(raw);
    // Never silently drop values when the user overrides detection.
    for (const row of rows)
      for (let i = 0; i < types.length; i++)
        if (
          row[i]?.trim() &&
          ["number", "date", "time", "checkbox"].includes(types[i]) &&
          normalizeCsvValue(types[i], row[i]) == null &&
          !isNullMarker(row[i])
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
        ),
        optionInsert = this.db.prepare(
          "INSERT INTO db_select_options VALUES(?,?,?,?,?,?,?,?)",
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
          if (empty(raw)) value = null;
          else if (columnTypeHasOptions(c.type)) {
            const labels = (
              c.type === "multi_select"
                ? splitMultiValue(raw)
                : raw.trim()
                  ? [raw.trim()]
                  : []
            ).filter(
              (label) => !options.nullMarkersAsEmpty || !isNullMarker(label),
            );
            const map = maps.get(c.id)!;
            const ids = labels.map((label) => {
              const key = optionKey(label);
              if (!map.has(key)) {
                const id = uuid();
                map.set(key, id);
                optionInsert.run(
                  id,
                  c.databaseId,
                  c.id,
                  label.replace(/\s+/g, " "),
                  importedOptionColor(map.size - 1),
                  map.size - 1,
                  at,
                  at,
                );
              }
              return map.get(key)!;
            });
            value =
              c.type === "multi_select"
                ? encodeMultiSelect([...new Set(ids)])
                : (ids[0] ?? null);
          } else value = normalizeCsvValue(c.type, raw);
          // A new row has no cell to clear.
          if (value !== null) this.rawCell(rowId, c.id, value, c.type);
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
      embeddingModel: defaultEmbeddingModel(process.platform, process.arch),
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
        "SELECT id,kind,CASE WHEN json_valid(payload_json) THEN coalesce(json_extract(payload_json,'$.label'),'') ELSE '' END label,state,done,total,failed,skipped,message,created_at createdAt,updated_at updatedAt FROM jobs WHERE state IN ('queued','running','paused','failed') OR id IN(SELECT id FROM jobs WHERE state IN ('completed','cancelled') ORDER BY created_at DESC LIMIT 50) ORDER BY CASE state WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'paused' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END,created_at DESC",
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
        // Store the normalized value actually written. In particular [] for an
        // empty multi-select becomes NULL; a no-op must not poison batch undo.
        const after = this.getRow(p.row_id).cells[p.column_id] ?? null;
        if (after !== p.before_value)
          this.db
            .prepare(
              "INSERT INTO history(batch_id,row_id,column_id,before_value,after_value,created_at) VALUES(?,?,?,?,?,?)",
            )
            .run(batch, p.row_id, p.column_id, p.before_value, after, now());
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
        this.touchRows([rowId]);
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
  reassignImages(ids: string[], rowId: string, columnId?: string) {
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
        this.touchRows([asset.row_id]);
        this.indexRow(asset.row_id);
      }
      this.normalizeImagePositions(row.id);
      this.touchRows([row.id]);
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
export function recordTextHash(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
/** Words that carry no meaning on their own in a Spanish, English or French query. */
const STOPWORDS = new Set(
  (
    "a al ante bajo con contra de del desde durante en entre hacia hasta mediante para por segun sin so sobre tras " +
    "el la los las lo un una unos unas y e o u ni que como cual cuando donde se su sus mas muy ya es son esta este " +
    "esto estos estas ese esa eso hay le les me mi nos the of and or in on at to for with from by an is are this that " +
    "le la les des du et ou un une en dans sur avec pour par"
  ).split(" "),
);
/**
 * FTS5 expression for a query. "words" requires every word, "phrase" the
 * exact sequence, and "any" accepts any significant word with a light
 * plural-insensitive prefix (nazarenos → nazareno*), ranked by BM25.
 */
export function ftsExpression(
  query: string,
  match: "words" | "phrase" | "any" | "partial",
): string {
  const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
  if (match === "phrase") return quote(query);
  const words = query.split(/\s+/).filter(Boolean);
  if (match !== "any") return words.map(quote).join(" AND ");
  const terms = new Set<string>();
  for (const word of words) {
    const clean = fold(word).replace(/[^\p{L}\p{N}]+/gu, "");
    if (clean.length < 2 || STOPWORDS.has(clean)) continue;
    const stem =
      clean.length >= 6 && clean.endsWith("es")
        ? clean.slice(0, -2)
        : clean.length >= 4 && clean.endsWith("s")
          ? clean.slice(0, -1)
          : clean;
    terms.add(quote(stem) + (stem.length >= 3 ? "*" : ""));
  }
  return [...terms].join(" OR ");
}
/** A short excerpt around the first query word found in the text. */
export function snippetAround(body: string, query: string): string {
  const folded = fold(body);
  let at = folded.indexOf(fold(query));
  if (at < 0)
    for (const word of query.split(/\s+/)) {
      const w = fold(word).replace(/[^\p{L}\p{N}]+/gu, "");
      if (w.length < 3 || STOPWORDS.has(w)) continue;
      at = folded.indexOf(w.length > 5 ? w.slice(0, -1) : w);
      if (at >= 0) break;
    }
  const start = Math.max(0, at - 35);
  return body.slice(start, start + 200);
}

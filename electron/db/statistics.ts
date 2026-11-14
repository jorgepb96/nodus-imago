// Saved statistics, their computation and the timeline, over the records a
// database view currently selects (filters and its search box).
import { randomUUID as uuid } from "node:crypto";
import type { Repository } from "./repository";
import type { DatabaseColumn } from "../../shared/databases";
import { exportCellText } from "../../shared/databaseExport";
import {
  categoryValues,
  cooccurrence,
  crosstab,
  frequency,
  numeric,
  trend,
  yearCoverage,
  yearOf,
  type SavedStatistic,
  type StatResult,
  type StatSpec,
} from "../../shared/statistics";

const now = () => new Date().toISOString();
type Values = { raw: string | null; display: string }[];

export class Statistics {
  constructor(private repo: Repository) {}

  list(databaseId: string): SavedStatistic[] {
    return (
      this.repo.db
        .prepare(
          "SELECT id,database_id databaseId,name,spec_json,position,created_at createdAt,updated_at updatedAt FROM db_statistics WHERE database_id=? ORDER BY position,created_at",
        )
        .all(databaseId) as (Omit<SavedStatistic, "spec"> & { spec_json: string })[]
    ).map(({ spec_json, ...rest }) => ({ ...rest, spec: JSON.parse(spec_json) as StatSpec }));
  }
  save(input: { id?: string; databaseId: string; name: string; spec: StatSpec }): SavedStatistic {
    this.columns(input.databaseId, specColumns(input.spec));
    const at = now();
    if (input.id) {
      const done = this.repo.db
        .prepare("UPDATE db_statistics SET name=?,spec_json=?,updated_at=? WHERE id=? AND database_id=?")
        .run(input.name, JSON.stringify(input.spec), at, input.id, input.databaseId);
      if (!done.changes) throw new Error("Estadística no encontrada.");
      return this.list(input.databaseId).find((s) => s.id === input.id)!;
    }
    const id = uuid(),
      position =
        (this.repo.db
          .prepare("SELECT coalesce(max(position),-1)+1 p FROM db_statistics WHERE database_id=?")
          .get(input.databaseId) as { p: number }).p;
    this.repo.db
      .prepare("INSERT INTO db_statistics VALUES(?,?,?,?,?,?,?)")
      .run(id, input.databaseId, input.name, JSON.stringify(input.spec), position, at, at);
    return this.list(input.databaseId).find((s) => s.id === id)!;
  }
  delete(id: string) {
    this.repo.db.prepare("DELETE FROM db_statistics WHERE id=?").run(id);
  }

  /** The properties, checked to belong to the database. */
  private columns(databaseId: string, ids: string[]): DatabaseColumn[] {
    const columns = this.repo.detail(databaseId).columns;
    return ids.map((id) => {
      const column = columns.find((c) => c.id === id);
      if (!column) throw new Error("La propiedad no pertenece a esta base de datos.");
      return column;
    });
  }
  /** Raw and shown values of some properties for these records, in order. */
  private values(ids: string[], columns: DatabaseColumn[]): Values[] {
    const out: Values[] = columns.map(() => []);
    for (let i = 0; i < ids.length; i += 500)
      for (const row of this.repo.hydrate(ids.slice(i, i + 500)))
        columns.forEach((column, c) =>
          out[c].push({ raw: row.cells[column.id] ?? null, display: exportCellText(column, row) }),
        );
    return out;
  }

  compute(databaseId: string, ids: string[], spec: StatSpec): StatResult {
    const columns = this.columns(databaseId, specColumns(spec)),
      values = this.values(ids, columns),
      labels = (c: number) => values[c].map((v) => categoryValues(columns[c], v.raw, v.display));
    switch (spec.kind) {
      case "frequency":
        return frequency(labels(0), spec.limit ?? 20);
      case "crosstab":
        return crosstab(labels(0), labels(1), spec.limit ?? 12);
      case "cooccurrence":
        return cooccurrence(labels(0), spec.limit ?? 15);
      case "trend":
        return trend(
          values[0].map((v) => yearOf(columns[0], v.raw, v.display)),
          columns[1] ? labels(1) : null,
          spec.bucket ?? "year",
          spec.limit ?? 6,
        );
      case "numeric":
        return numeric(
          values[0].map((v) => {
            if (v.raw == null || v.raw === "") return null;
            const n = Number(v.raw);
            return Number.isFinite(n) ? n : null;
          }),
          spec.bins ?? 12,
        );
    }
  }

  /** Properties that can place records in time, best first. */
  yearCandidates(databaseId: string) {
    const columns = this.repo
      .detail(databaseId)
      .columns.filter((c) =>
        ["date", "number", "text", "select", "status", "multi_select", "created_time", "rich_text"].includes(c.type),
      );
    // A sample is enough to rank them; the timeline itself reads every record.
    const ids = (
      this.repo.db
        .prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY random() LIMIT 1500")
        .all(databaseId) as { id: string }[]
    ).map((r) => r.id);
    const values = this.values(ids, columns);
    return columns
      .map((c, i) => ({ ...yearCoverage(c, values[i]), name: c.name, type: c.type }))
      .filter((c) => c.dated > 0)
      .sort((a, b) => b.score - a.score);
  }

  timeline(databaseId: string, ids: string[], columnId: string) {
    const [column] = this.columns(databaseId, [columnId]);
    const items: { id: string; title: string; year: number; imageId: string | null; revision?: string }[] = [];
    let undated = 0;
    for (let i = 0; i < ids.length; i += 500)
      for (const row of this.repo.hydrate(ids.slice(i, i + 500))) {
        const year = yearOf(column, row.cells[column.id] ?? null, exportCellText(column, row));
        if (year === null) {
          undated++;
          continue;
        }
        const image = row.images.find((a) => a.width > 0) ?? row.images[0];
        items.push({
          id: row.id,
          title: row.title,
          year,
          imageId: image?.id ?? null,
          revision: image?.revision,
        });
      }
    items.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title, "es", { numeric: true }));
    return { items, undated, total: ids.length };
  }
}

export function specColumns(spec: StatSpec): string[] {
  switch (spec.kind) {
    case "crosstab":
      return [spec.rowColumnId, spec.colColumnId];
    case "trend":
      return spec.seriesColumnId ? [spec.yearColumnId, spec.seriesColumnId] : [spec.yearColumnId];
    default:
      return [spec.columnId];
  }
}

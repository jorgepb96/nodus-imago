// Saved statistics, their computation and the timeline, over the records a
// database view currently selects (filters and its search box).
import { randomUUID as uuid } from "node:crypto";
import type { Repository } from "./repository";
import { decodeMultiSelect, type DatabaseColumn } from "../../shared/databases";
import { heritageCategories, heritageScheme, isHeritageColumn } from "../../shared/heritage";
import { exportCellText } from "../../shared/databaseExport";
import { decodeHistoricalDate, periodLabel } from "../../shared/historicalDate";
import {
  categoryValues,
  cooccurrence,
  crosstab,
  frequency,
  numeric,
  trend,
  yearCoverage,
  yearOf,
  yearSpan,
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
    const rows = [];
    for (let i = 0; i < ids.length; i += 500) rows.push(...this.repo.hydrate(ids.slice(i, i + 500)));
    // A relation counts the titles of the records it links to.
    const linked = (raw: string | null | undefined): string[] => {
      try {
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
      } catch {
        return [];
      }
    };
    const targets = [
      ...new Set(columns.some((c) => c.type === "relation") ? rows.flatMap((row) => columns.filter((c) => c.type === "relation").flatMap((c) => linked(row.cells[c.id]))) : []),
    ];
    const titles = new Map<string, string>();
    const hydrated: ReturnType<typeof this.repo.hydrate> = [];
    for (let i = 0; i < targets.length; i += 500) hydrated.push(...this.repo.hydrate(targets.slice(i, i + 500)));
    // Two records with the same title (two editions of a book) stay apart:
    // their identifier, or else their position, is added to the label.
    const sameTitle = new Map<string, number>();
    for (const target of hydrated) sameTitle.set(target.title, (sameTitle.get(target.title) ?? 0) + 1);
    const idColumns = new Map<string, DatabaseColumn | null>();
    const identifier = (target: (typeof hydrated)[number]) => {
      if (!idColumns.has(target.databaseId))
        idColumns.set(
          target.databaseId,
          this.repo
            .detail(target.databaseId)
            .columns.find((c) => c.type !== "title" && /^(id|identificador|identifier|c[oó]digo|code|signatura|isbn|ref(erencia)?)$/i.test(c.name.trim())) ?? null,
        );
      const column = idColumns.get(target.databaseId);
      return (column ? exportCellText(column, target).trim() : "") || `#${target.position + 1}`;
    };
    for (const target of hydrated)
      titles.set(target.id, (sameTitle.get(target.title) ?? 0) > 1 ? `${target.title} (${identifier(target)})` : target.title);
    for (const row of rows)
      columns.forEach((column, c) => {
        if (column.type === "relation") {
          const names = linked(row.cells[column.id]).flatMap((id) => (titles.has(id) ? [titles.get(id)!] : []));
          out[c].push({ raw: names.length ? JSON.stringify(names) : null, display: names.join("; ") });
        } else out[c].push({ raw: row.cells[column.id] ?? null, display: exportCellText(column, row) });
      });
    return out;
  }

  compute(databaseId: string, ids: string[], spec: StatSpec): StatResult {
    const columns = this.columns(databaseId, specColumns(spec)),
      values = this.values(ids, columns);
    // Heritage properties can count types, groups, or parts in their wholes.
    const level = spec.heritageLevel ?? "element",
      parts = !!spec.includeParts;
    const heritage = columns.map((column) =>
      isHeritageColumn(column) && (level !== "element" || parts)
        ? {
            labels: new Map(column.options.map((o) => [o.id, o.label])),
            byId: Object.fromEntries(
              (
                this.repo.db.prepare("SELECT * FROM heritage_elements WHERE column_id=?").all(column.id) as {
                  option_id: string;
                  parent_option_id: string | null;
                  group_key: string | null;
                  type_key: string | null;
                }[]
              ).map((r) => [
                r.option_id,
                { optionId: r.option_id, parentId: r.parent_option_id, group: r.group_key, type: r.type_key, latitude: null, longitude: null, coordSource: null },
              ]),
            ),
            scheme: heritageScheme(column.config),
          }
        : null,
    );
    const language = this.repo.getSettings().language;
    const labels = (c: number) =>
      values[c].map((v) => {
        const h = heritage[c];
        return h
          ? heritageCategories(decodeMultiSelect(v.raw), h.labels, h.byId, h.scheme, level, parts, language)
          : categoryValues(columns[c], v.raw, v.display);
      });
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
        ["historical_date", "date", "number", "text", "select", "status", "multi_select", "created_time", "rich_text"].includes(c.type),
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
    const items: {
      id: string;
      title: string;
      year: number;
      /** First and last year the date covers (a period spans several). */
      start: number;
      end: number;
      imageId: string | null;
      revision?: string;
      /** For a historical date: the period and how certain it is. */
      period?: string;
      certainty?: string;
    }[] = [];
    let undated = 0;
    for (let i = 0; i < ids.length; i += 500)
      for (const row of this.repo.hydrate(ids.slice(i, i + 500))) {
        const year = yearOf(column, row.cells[column.id] ?? null, exportCellText(column, row));
        if (year === null) {
          undated++;
          continue;
        }
        const image = row.images.find((a) => a.width > 0) ?? row.images[0];
        const historical =
          column.type === "historical_date" ? decodeHistoricalDate(row.cells[column.id] ?? null) : null;
        // Whatever the form of the date, the years it covers.
        const span = yearSpan(column, row.cells[column.id] ?? null, exportCellText(column, row)) ?? { start: year, end: year };
        items.push({
          id: row.id,
          title: row.title,
          year,
          start: span.start,
          end: span.end,
          imageId: image?.id ?? null,
          revision: image?.revision,
          ...(historical
            ? { period: periodLabel(historical), certainty: historical.certainty }
            : span.end > span.start
              ? { period: periodLabel(span), certainty: "exact" }
              : {}),
        });
      }
    items.sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title, "es", { numeric: true }));
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

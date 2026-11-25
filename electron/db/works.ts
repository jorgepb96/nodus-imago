// A photograph as a work: one record in a "works" database for the
// photograph itself (photographer, date taken, place), to which every print,
// scan and reproduction of it in the collection links. Variant detection
// proposes the family; gathering it into a work is the researcher's
// decision, kept as ordinary two-way relations they can edit or undo.
import { randomUUID as uuid } from "node:crypto";
import type { Repository } from "./repository";
import type { Variants } from "./variants";
import type { DatabaseColumn } from "../../shared/databases";
import type { RecordRow } from "../../shared/imago";
import type { Sensitivity, WorkLink } from "../../shared/variants";

const AUTHOR = /autor|author|fot[oó]grafo|photographer|creador|creator|artista|artist/i,
  DATE = /fecha|date|a[nñ]o|year|dataci/i,
  PLACE = /lugar|place|ubicaci|location|localidad/i;

export class Works {
  constructor(
    private repo: Repository,
    private variants: Variants,
  ) {}

  /** The databases that hold photographs as works. */
  private worksDatabases(): string[] {
    return (this.repo.db.prepare("SELECT id FROM db_databases WHERE kind='works' ORDER BY position").all() as { id: string }[]).map(
      (d) => d.id,
    );
  }

  /** A record's relations to works databases. */
  private workRelations(databaseId: string): DatabaseColumn[] {
    const works = new Set(this.worksDatabases());
    return this.repo
      .detail(databaseId)
      .columns.filter((c) => c.type === "relation" && works.has(c.config.relationTargetDatabaseId as string));
  }

  /** The work a record is linked to, with every record linked to it. */
  workOf(rowId: string): WorkLink | null {
    const row = this.repo.getRow(rowId);
    for (const c of this.workRelations(row.databaseId)) {
      const link = row.links?.[c.id]?.[0];
      if (!link) continue;
      const work = this.repo.getRow(link.id);
      const reproductions = (
        this.repo.db
          .prepare(
            "SELECT DISTINCT r.row_id FROM db_relations r JOIN db_columns c ON c.id=r.column_id WHERE r.target_kind='db_row' AND r.target_id=? AND c.database_id<>?",
          )
          .all(work.id, work.databaseId) as { row_id: string }[]
      ).map((r) => r.row_id);
      return {
        workId: work.id,
        title: work.title,
        databaseId: work.databaseId,
        databaseName: work.databaseName,
        columnId: c.id,
        reproductions,
      };
    }
    return null;
  }

  /**
   * Gathers the family of an image into one work: the work it is already
   * linked to, or a new record in a works database (created, as
   * «Fotografías», when there is none). Each record of the family gains a
   * link to it through a relation «Obra» (two-way: the work lists its
   * reproductions), made where missing. Records already linked to another
   * work are left as they are. The links are one step of the history.
   */
  async fromFamily(input: { assetId: string; sensitivity?: Sensitivity; databaseId?: string | null; title?: string | null }) {
    const anchor = this.repo.asset(input.assetId) as { row_id: string };
    const family = await this.variants.ofImage(input.assetId, input.sensitivity ?? "balanced");
    const rowIds = [...new Set([anchor.row_id, ...family.members.map((m) => m.rowId)])];
    const source = this.repo.getRow(anchor.row_id);
    const existing = this.workOf(anchor.row_id);
    return this.repo.db.transaction(() => {
      let worksDb = existing?.databaseId ?? input.databaseId ?? this.worksDatabases()[0] ?? null;
      if (worksDb && this.repo.detail(worksDb).database.kind !== "works")
        throw new Error("Elige una base de datos de obras fotográficas.");
      if (!worksDb) worksDb = this.repo.create("Fotografías", true, undefined, "works").database.id;
      const workId = existing?.workId ?? this.createWork(worksDb, source, input.title);
      const batch = uuid();
      let linked = 0,
        skipped = 0;
      for (const rowId of rowIds) {
        const row = this.repo.getRow(rowId);
        if (row.databaseId === worksDb) continue;
        const column = this.relationTo(row.databaseId, worksDb);
        const current = row.links?.[column.id]?.map((l) => l.id) ?? [];
        if (current.includes(workId)) continue;
        if (current.length && column.config.relationCardinality === "one") {
          skipped++;
          continue;
        }
        this.repo.setCell(rowId, column.id, JSON.stringify([...current, workId]), true, batch);
        linked++;
      }
      return { workId, databaseId: worksDb, linked, skipped, created: !existing };
    })();
  }

  /** A new work titled like the record, with its photographer, date and place where they map. */
  private createWork(databaseId: string, source: RecordRow, title?: string | null): string {
    const work = this.repo.createRow(databaseId);
    const target = this.repo.detail(databaseId).columns,
      from = this.repo.detail(source.databaseId).columns;
    const titleColumn = target.find((c) => c.type === "title");
    if (titleColumn) this.repo.setCell(work.id, titleColumn.id, title?.trim() || source.title, false);
    // The first property of the same type whose name plays the same part.
    const copy = (type: string, pattern: RegExp) => {
      const to = target.find((c) => c.type === type && pattern.test(c.name)),
        of = from.find((c) => c.type === type && pattern.test(c.name)) ?? from.find((c) => c.type === type && type !== "text");
      const value = of ? source.cells[of.id] : null;
      if (to && value) this.repo.setCell(work.id, to.id, value, false);
    };
    copy("text", AUTHOR);
    copy("historical_date", DATE);
    copy("location", PLACE);
    return work.id;
  }

  /** The relation from a database to the works database: the existing one, or a new two-way «Obra». */
  private relationTo(databaseId: string, worksDb: string): DatabaseColumn {
    const columns = this.repo.detail(databaseId).columns;
    const found =
      columns.find((c) => c.type === "relation" && c.config.relationTargetDatabaseId === worksDb && c.config.relationCardinality === "one") ??
      columns.find((c) => c.type === "relation" && c.config.relationTargetDatabaseId === worksDb);
    if (found) return found;
    const name = columns.some((c) => c.name === "Obra") ? "Obra fotográfica" : "Obra";
    return this.repo.addColumn(databaseId, name, "relation", {
      relationTargetKind: "db_row",
      relationTargetDatabaseId: worksDb,
      relationCardinality: "one",
      relationInverseName: this.repo.detail(databaseId).database.name,
    });
  }
}

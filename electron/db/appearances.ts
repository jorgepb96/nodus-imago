// Where a photograph appears: one line per record of its family (its versions
// in the collection) and the reproductions added by hand, in date order. The
// work, page and caption come from the record's properties: a relation to a
// "sources" database, or properties named like work/page/caption, or those
// the researcher chooses for each database.
import { randomUUID } from "node:crypto";
import type { Repository } from "./repository";
import type { Variants } from "./variants";
import type { DatabaseColumn, DatabaseDetail } from "../../shared/databases";
import type { RecordRow } from "../../shared/imago";
import type {
  AppearanceFields,
  ImageAppearance,
  ImageVariantMember,
  ManualAppearance,
  Sensitivity,
} from "../../shared/variants";
import { exportCellText } from "../../shared/databaseExport";

const WORK = /obra|fuente|libro|publicaci|revista|[aá]lbum|source|work|book|journal|magazine/i,
  PAGE = /^p[aá]g|page/i,
  CAPTION = /pie|caption|leyenda|^t[ií]tulo$|^title$/i,
  AUTHOR = /autor|author|creador|creator/i,
  YEAR = /^a[nñ]o$|fecha|year|date/i;
const TEXTUAL = ["text", "rich_text", "select", "multi_select", "status", "number", "url"];

type Row = {
  id: string;
  content_hash: string;
  work: string;
  author: string | null;
  year: number | null;
  page: string | null;
  caption: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};
const manualOf = (r: Row): ManualAppearance => ({
  id: r.id,
  contentHash: r.content_hash,
  work: r.work,
  author: r.author,
  year: r.year,
  page: r.page,
  caption: r.caption,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class Appearances {
  constructor(
    private repo: Repository,
    private variants: Variants,
  ) {}

  /** Reproductions added by hand to these files. */
  manual(hashes: string[]): ManualAppearance[] {
    if (!hashes.length) return [];
    return (
      this.repo.db
        .prepare(`SELECT * FROM image_appearances WHERE content_hash IN (${hashes.map(() => "?").join(",")}) ORDER BY year,work`)
        .all(...hashes) as Row[]
    ).map(manualOf);
  }

  save(input: {
    id?: string;
    assetId: string;
    work: string;
    author?: string | null;
    year?: number | null;
    page?: string | null;
    caption?: string | null;
    note?: string | null;
  }): ManualAppearance {
    const hash = (this.repo.asset(input.assetId) as { content_hash: string }).content_hash,
      at = new Date().toISOString(),
      clean = (v?: string | null) => (v?.trim() ? v.trim() : null);
    const id = input.id ?? randomUUID();
    if (input.id && !this.repo.db.prepare("SELECT 1 FROM image_appearances WHERE id=?").get(input.id))
      throw new Error("La aparición ya no existe.");
    this.repo.db
      .prepare(
        `INSERT INTO image_appearances VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET work=excluded.work,author=excluded.author,year=excluded.year,page=excluded.page,caption=excluded.caption,note=excluded.note,updated_at=excluded.updated_at`,
      )
      .run(id, hash, input.work.trim(), clean(input.author), input.year ?? null, clean(input.page), clean(input.caption), clean(input.note), at, at);
    return manualOf(this.repo.db.prepare("SELECT * FROM image_appearances WHERE id=?").get(id) as Row);
  }

  delete(id: string) {
    this.repo.db.prepare("DELETE FROM image_appearances WHERE id=?").run(id);
  }

  /** The properties that give work, page and caption in a database. */
  fieldsFor(detail: DatabaseDetail, chosen: AppearanceFields = {}) {
    const columns = detail.columns,
      byId = (id?: string | null) => (id ? (columns.find((c) => c.id === id) ?? null) : null),
      named = (pattern: RegExp, types = TEXTUAL) =>
        columns.find((c) => c.type !== "title" && types.includes(c.type) && pattern.test(c.name.trim())) ?? null;
    // A relation to a sources database first, then any relation to another one.
    const relations = columns.filter(
      (c) => c.type === "relation" && c.config.relationTargetDatabaseId && c.config.relationTargetDatabaseId !== detail.database.id,
    );
    const kindOf = (id: string) => {
      try {
        return this.repo.detail(id).database.kind ?? null;
      } catch {
        return null;
      }
    };
    const relation = relations.find((c) => kindOf(c.config.relationTargetDatabaseId as string) === "sources") ?? relations[0] ?? null;
    return {
      work: chosen.work === null ? null : (byId(chosen.work) ?? relation ?? named(WORK)),
      page: chosen.page === null ? null : (byId(chosen.page) ?? named(PAGE)),
      caption: chosen.caption === null ? null : (byId(chosen.caption) ?? named(CAPTION)),
    };
  }

  /** The work of a record: related source records (with author and year), or a property's text. */
  private work(column: DatabaseColumn | null, row: RecordRow) {
    if (!column) return { work: null, author: null, workDetail: null };
    if (column.type !== "relation") return { work: exportCellText(column, row).trim() || null, author: null, workDetail: null };
    const targets = (
      this.repo.db
        .prepare("SELECT target_id FROM db_relations WHERE row_id=? AND column_id=? AND target_kind='db_row' ORDER BY position")
        .all(row.id, column.id) as { target_id: string }[]
    ).map((r) => r.target_id);
    if (!targets.length) return { work: null, author: null, workDetail: null };
    const sources = this.repo.hydrate(targets);
    const details = new Map<string, DatabaseDetail>();
    const detail = (id: string) => details.get(id) ?? details.set(id, this.repo.detail(id)).get(id)!;
    const text = (source: RecordRow, pattern: RegExp) => {
      const col = detail(source.databaseId).columns.find((c) => c.type !== "title" && pattern.test(c.name.trim()));
      return col ? exportCellText(col, source).trim() || null : null;
    };
    const author = sources.map((s) => text(s, AUTHOR)).filter(Boolean).join("; ") || null,
      year = sources.map((s) => text(s, YEAR)).filter(Boolean).join("; ") || null;
    return {
      work: sources.map((s) => s.title).join("; ") || null,
      author,
      workDetail: [author, year].filter(Boolean).join(" · ") || null,
    };
  }

  /** Every appearance of the image's family, the image's own record first among equal years. */
  async list(assetId: string, sensitivity: Sensitivity = "balanced", fields: Record<string, AppearanceFields> = {}): Promise<ImageAppearance[]> {
    const family = await this.variants.ofImage(assetId, sensitivity);
    const anchor = this.repo.asset(assetId) as { id: string; row_id: string; content_hash: string };
    const own = this.variants.describeOne(assetId);
    const entries: { member: ImageVariantMember | null; rowId: string; assetId: string; year: number | null; date: string | null; revision?: string }[] = [];
    if (own) entries.push({ member: null, rowId: anchor.row_id, assetId, year: own.year, date: own.date, revision: own.revision });
    const seen = new Set([anchor.row_id]);
    for (const m of family.members)
      if (!seen.has(m.rowId)) {
        seen.add(m.rowId);
        entries.push({ member: m, rowId: m.rowId, assetId: m.assetId, year: m.year, date: m.date, revision: m.revision });
      }
    const rows = new Map(this.repo.hydrate(entries.map((e) => e.rowId)).map((r) => [r.id, r]));
    const details = new Map<string, DatabaseDetail>();
    const detail = (id: string) => details.get(id) ?? details.set(id, this.repo.detail(id)).get(id)!;
    const lines: ImageAppearance[] = entries.flatMap((e) => {
      const row = rows.get(e.rowId);
      if (!row) return [];
      const used = this.fieldsFor(detail(row.databaseId), fields[row.databaseId]);
      const work = this.work(used.work, row);
      return [
        {
          id: row.id,
          manual: false,
          assetId: e.assetId,
          rowId: row.id,
          databaseId: row.databaseId,
          databaseName: row.databaseName,
          title: row.title,
          revision: e.revision,
          work: work.work,
          workDetail: work.workDetail,
          author: work.author,
          year: e.year,
          date: e.date,
          page: used.page ? exportCellText(used.page, row).trim() || null : null,
          caption: used.caption ? exportCellText(used.caption, row).trim() || null : null,
          note: null,
          match: e.member ? e.member.match : "self",
          fields: { work: used.work?.id ?? null, page: used.page?.id ?? null, caption: used.caption?.id ?? null },
        },
      ];
    });
    const hashes = [family.contentHash, ...new Set(family.members.map((m) => m.contentHash))];
    for (const m of this.manual(hashes))
      lines.push({
        id: m.id,
        manual: true,
        assetId: null,
        rowId: null,
        databaseId: null,
        databaseName: null,
        title: null,
        work: m.work,
        workDetail: [m.author, m.year].filter(Boolean).join(" · ") || null,
        author: m.author,
        year: m.year,
        date: m.year ? String(m.year) : null,
        page: m.page,
        caption: m.caption,
        note: m.note,
        match: null,
      });
    return lines.sort(
      (a, b) =>
        (a.year ?? 9999) - (b.year ?? 9999) ||
        Number(a.match !== "self") - Number(b.match !== "self") ||
        (a.work ?? a.title ?? "").localeCompare(b.work ?? b.title ?? "", "es", { numeric: true }),
    );
  }
}

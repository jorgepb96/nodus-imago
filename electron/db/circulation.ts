// The circulation of a photograph: its taking (from its photographic work,
// or the record on screen) and every use in date order, each with when the
// work printed it and when that copy was made, its page and caption, what
// part of the image it keeps, and where it was reproduced from. What stands
// out is marked: the first known publication, a caption that changes, the
// years between the taking and the first publication. Nothing new is stored
// but «Procede de»; dates, pages and captions are read where they already are.
import type { Repository } from "./repository";
import type { Variants } from "./variants";
import type { Appearances } from "./appearances";
import type { Works } from "./works";
import type {
  AppearanceFields,
  CirculationEntry,
  CirculationSummary,
  ImageAppearance,
  ImageCirculation,
  Sensitivity,
  VariantFamily,
} from "../../shared/variants";
import type { RecordRow } from "../../shared/imago";
import { decodeHistoricalDate, representativeYear } from "../../shared/historicalDate";
import { decodeDatabaseLocation } from "../../shared/databaseProperties";
import { exportCellText } from "../../shared/databaseExport";

const AUTHOR = /fot[oó]grafo|photographer|autor|author|creador|creator/i,
  TAKEN = /toma|captur|taken|fecha|date/i;
/** Captions compared without case, spacing or final punctuation. */
const sameCaption = (a: string, b: string) =>
  a.replace(/[\s.,;:«»"“”]+/g, " ").trim().toLocaleLowerCase() === b.replace(/[\s.,;:«»"“”]+/g, " ").trim().toLocaleLowerCase();

export class Circulation {
  constructor(
    private repo: Repository,
    private variants: Variants,
    private appearances: Appearances,
    private works: Works,
  ) {}

  async of(assetId: string, sensitivity: Sensitivity = "balanced", fields: Record<string, AppearanceFields> = {}): Promise<ImageCirculation> {
    const anchor = this.repo.asset(assetId) as { row_id: string; content_hash: string };
    const [lines, family] = await Promise.all([this.appearances.list(assetId, sensitivity, fields), this.variants.ofImage(assetId, sensitivity)]);
    const kindOf = new Map(family.members.map((m) => [m.contentHash, m.kind]));
    const capture = this.capture(anchor.row_id, assetId);
    // Date order: when the work printed it, else when the copy was made.
    const when = (l: ImageAppearance) => l.publicationYear ?? l.copyYear ?? l.year ?? null;
    const sorted = [...lines].sort(
      (a, b) =>
        (when(a) ?? 9999) - (when(b) ?? 9999) ||
        Number(a.match !== "self") - Number(b.match !== "self") ||
        (a.work ?? a.title ?? "").localeCompare(b.work ?? b.title ?? "", "es", { numeric: true }),
    );
    const hashes = [...new Set(sorted.map((l) => l.contentHash).filter((h): h is string => !!h))];
    const origins = this.variants.origins(hashes);
    let previous: string | null = null;
    const entries: CirculationEntry[] = sorted.map((l) => {
      const hash = l.contentHash ?? null;
      let crop: CirculationEntry["crop"] = null;
      if (hash && hash !== anchor.content_hash) {
        const placement = this.variants.placement(anchor.content_hash, hash);
        // «other»: this use keeps part of the image on screen; «this»: the image on screen keeps part of it.
        if (placement) crop = { of: placement.inner === hash ? "other" : "this", rect: placement.rect, kept: placement.kept };
      }
      const changed = !!(l.caption && previous && !sameCaption(l.caption, previous));
      const entry: CirculationEntry = {
        id: l.id,
        manual: l.manual,
        assetId: l.assetId,
        contentHash: hash,
        rowId: l.rowId,
        title: l.title,
        databaseName: l.databaseName,
        revision: l.revision,
        work: l.work,
        workDetail: l.workDetail,
        page: l.page,
        figure: l.figure ?? null,
        caption: l.caption,
        note: l.note,
        publicationYear: l.publicationYear ?? null,
        copyDate: l.copyDate ?? null,
        copyYear: l.copyYear ?? null,
        match: l.match,
        kind: hash ? (kindOf.get(hash) ?? null) : null,
        crop,
        captionChanged: changed,
        previousCaption: changed ? previous : null,
        parent: null,
        suggestedParent: null,
        depth: 0,
      };
      if (l.caption) previous = l.caption;
      return entry;
    });
    // «Procede de»: the earliest entry holding the source file.
    const byHash = new Map<string, CirculationEntry>();
    for (const e of entries) if (e.contentHash && !byHash.has(e.contentHash)) byHash.set(e.contentHash, e);
    entries.forEach((e, i) => {
      const source = e.contentHash ? origins.get(e.contentHash) : undefined;
      if (source && byHash.get(source) && byHash.get(source) !== e) e.parent = byHash.get(source)!.id;
      // A likely source: an earlier use whose image this one is a crop of.
      if (!e.parent && e.contentHash)
        for (const earlier of entries.slice(0, i))
          if (earlier.contentHash && earlier.contentHash !== e.contentHash) {
            const p = this.variants.placement(earlier.contentHash, e.contentHash);
            if (p && p.inner === e.contentHash) {
              e.suggestedParent = earlier.id;
              break;
            }
          }
    });
    const byId = new Map(entries.map((e) => [e.id, e]));
    const depth = (e: CirculationEntry, seen = new Set<string>()): number =>
      e.parent && byId.get(e.parent) && !seen.has(e.id) ? 1 + depth(byId.get(e.parent)!, seen.add(e.id)) : 0;
    for (const e of entries) e.depth = depth(e);
    const first = entries.find((e) => e.publicationYear !== null) ?? null;
    const captions = new Set<string>();
    for (const e of entries)
      if (e.caption && ![...captions].some((c) => sameCaption(c, e.caption!))) captions.add(e.caption);
    return {
      capture,
      entries,
      firstPublication: first?.id ?? null,
      gapYears: first && capture.year !== null ? first.publicationYear! - capture.year : null,
      captions: captions.size,
    };
  }

  /**
   * The circulation of many families at once: how often each photograph was
   * used and published, when it was first published, how long after its
   * taking, and whether its captions changed. One pass over the records.
   */
  summary(families: VariantFamily[]): CirculationSummary {
    const rowIds = [...new Set(families.flatMap((f) => f.members.map((m) => m.rowId)))];
    const rows = new Map<string, RecordRow>();
    for (let i = 0; i < rowIds.length; i += 300) for (const r of this.repo.hydrate(rowIds.slice(i, i + 300))) rows.set(r.id, r);
    const publications = new Map<string, { year: number | null; caption: string | null }[]>();
    for (const r of rows.values()) publications.set(r.id, this.appearances.publications(r));
    const manual = this.repo.db.prepare("SELECT year,caption FROM image_appearances WHERE content_hash=?");
    const top: CirculationSummary["top"] = [];
    const firstYears = new Map<number, number>();
    const gaps: number[] = [];
    let published = 0,
      captionsChange = 0;
    for (const f of families) {
      const members = [...new Map(f.members.map((m) => [m.rowId, m])).values()];
      const pubs = [
        ...members.flatMap((m) => publications.get(m.rowId) ?? []),
        ...[...new Set(f.members.map((m) => m.contentHash))].flatMap((h) => manual.all(h) as { year: number | null; caption: string | null }[]),
      ];
      const years = pubs.map((p) => p.year).filter((y): y is number => y !== null).sort((a, b) => a - b);
      const captions = new Set<string>();
      for (const p of pubs) if (p.caption) captions.add(p.caption.replace(/[\s.,;:«»"“”]+/g, " ").trim().toLocaleLowerCase());
      if (captions.size > 1) captionsChange++;
      if (years.length) {
        published++;
        firstYears.set(years[0], (firstYears.get(years[0]) ?? 0) + 1);
        // The taking, from the work its records are gathered under.
        const gathered = members.find((m) => this.works.workOf(m.rowId));
        if (gathered) {
          const taken = this.capture(gathered.rowId, gathered.assetId).year;
          if (taken !== null && years[0] >= taken) gaps.push(years[0] - taken);
        }
      }
      const head = f.members[0];
      top.push({
        assetId: head.assetId,
        rowId: head.rowId,
        title: head.title,
        revision: head.revision,
        uses: Math.max(members.length, pubs.length),
        publications: years.length,
        first: years[0] ?? null,
        last: years.at(-1) ?? null,
      });
    }
    top.sort((a, b) => b.uses - a.uses || b.publications - a.publications || a.title.localeCompare(b.title, "es"));
    gaps.sort((a, b) => a - b);
    const median = gaps.length ? (gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2) : null;
    return {
      families: families.length,
      published,
      top: top.slice(0, 12),
      firstYears: [...firstYears].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year),
      gap: { median, min: gaps[0] ?? null, max: gaps.at(-1) ?? null, n: gaps.length },
      captionsChange,
    };
  }

  /** The taking: from the photographic work when there is one, else from the record on screen. */
  private capture(rowId: string, assetId: string): ImageCirculation["capture"] {
    const work = this.works.workOf(rowId);
    const from = work ? this.repo.getRow(work.workId) : this.repo.getRow(rowId);
    const columns = this.repo.detail(from.databaseId).columns;
    const dated = columns.find((c) => c.type === "historical_date" && TAKEN.test(c.name)) ?? columns.find((c) => c.type === "historical_date");
    const historical = dated ? decodeHistoricalDate(from.cells[dated.id] ?? null) : null;
    let date = historical?.text ?? null,
      year = historical ? representativeYear(historical) : null;
    if (!work && !date) {
      // A record without a historical date: the date comparison boards read.
      const item = this.variants.describeOne(assetId);
      date = item?.date ?? null;
      year = item?.year ?? null;
    }
    const author = columns.find((c) => ["text", "select", "multi_select", "person"].includes(c.type) && AUTHOR.test(c.name));
    const place = columns.find((c) => c.type === "location");
    return {
      date,
      year,
      photographer: author ? exportCellText(author, from).trim() || null : null,
      place: place ? decodeDatabaseLocation(from.cells[place.id] ?? null)?.name ?? null : null,
      from: work ? "work" : "record",
      workId: work?.workId ?? null,
      workTitle: work?.title ?? null,
    };
  }
}

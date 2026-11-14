// The visual map of a database: the image vectors of semantic search placed
// on a plane (see ai/projection). The layout is kept per database and
// recalculated only when the set of indexed images changes; filters, search
// and colours are applied on each request.
import { createHash } from "node:crypto";
import type { Repository } from "./repository";
import { projectVectors } from "../ai/projection";
import { exportCellText } from "../../shared/databaseExport";
import { categoryValues, yearOf } from "../../shared/statistics";
import { VISUAL_MAP_CATEGORIES, type VisualMap, type VisualMapPoint } from "../../shared/visualMap";

const fromBlob = (b: Buffer) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
/** Changes when the layout method changes, so stored maps are calculated again. */
const LAYOUT_VERSION = "2";
const pause = () => new Promise<void>((resolve) => setImmediate(resolve));

export class VisualMaps {
  private running = new Map<string, Promise<{ rows: string[]; assets: string[]; xy: Float32Array; computed: boolean }>>();
  constructor(
    private repo: Repository,
    private contract: () => string,
  ) {}

  /** The layout of a database's records, from the store or calculated now. */
  private layout(databaseId: string) {
    const contract = this.contract();
    // One image per record: its first indexed image.
    const rows = this.repo.db
      .prepare(
        `SELECT a.row_id rowId,a.id assetId,a.content_hash hash FROM image_assets a
         JOIN embeddings e ON e.content_hash=a.content_hash AND e.contract=?
         WHERE a.database_id=? ORDER BY a.row_id,a.position,a.created_at`,
      )
      .all(contract, databaseId) as { rowId: string; assetId: string; hash: string }[];
    const first = new Map<string, { assetId: string; hash: string }>();
    for (const r of rows) if (!first.has(r.rowId)) first.set(r.rowId, r);
    const ids = [...first.keys()];
    const key = createHash("sha1")
      .update(LAYOUT_VERSION)
      .update(contract)
      .update(ids.map((id) => `${id}:${first.get(id)!.hash}`).join("|"))
      .digest("hex");
    const stored = this.repo.db.prepare("SELECT key,data FROM visual_maps WHERE database_id=?").get(databaseId) as
      | { key: string; data: string }
      | undefined;
    if (stored?.key === key) {
      const data = JSON.parse(stored.data) as { rows: string[]; assets: string[]; xy: number[] };
      return Promise.resolve({ ...data, xy: Float32Array.from(data.xy), computed: false });
    }
    const running = this.running.get(key);
    if (running) return running;
    const work = (async () => {
      const vector = this.repo.db.prepare("SELECT vector FROM embeddings WHERE content_hash=? AND contract=?");
      const vectors = ids.map((id) => fromBlob((vector.get(first.get(id)!.hash, contract) as { vector: Buffer }).vector));
      const xy = await projectVectors(vectors, { pause });
      const data = { rows: ids, assets: ids.map((id) => first.get(id)!.assetId), xy: Array.from(xy, (v) => Math.round(v * 1e5) / 1e5) };
      this.repo.db
        .prepare("INSERT OR REPLACE INTO visual_maps(database_id,key,created_at,data) VALUES(?,?,?,?)")
        .run(databaseId, key, new Date().toISOString(), JSON.stringify(data));
      return { ...data, xy: Float32Array.from(data.xy), computed: true };
    })().finally(() => this.running.delete(key));
    this.running.set(key, work);
    return work;
  }

  async map(databaseId: string, shownIds: string[], colorColumnId: string | null | undefined): Promise<VisualMap> {
    const detail = this.repo.detail(databaseId);
    const column = colorColumnId ? detail.columns.find((c) => c.id === colorColumnId) : undefined;
    if (colorColumnId && !column) throw new Error("La propiedad no pertenece a esta base de datos.");
    const { rows, assets, xy, computed } = await this.layout(databaseId);
    const shown = new Set(shownIds);
    const records = (this.repo.db.prepare("SELECT count(*) n FROM db_rows WHERE database_id=?").get(databaseId) as { n: number }).n;
    const dated = column && (column.type === "historical_date" || column.type === "number" || column.type === "date");
    const raw: (string | number | null)[] = [];
    const titles: string[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const batch = new Map(this.repo.hydrate(rows.slice(i, i + 500)).map((r) => [r.id, r]));
      for (const id of rows.slice(i, i + 500)) {
        const row = batch.get(id);
        titles.push(row?.title ?? "");
        if (!row || !column) raw.push(null);
        else if (dated) raw.push(yearOf(column, row.cells[column.id] ?? null, exportCellText(column, row)));
        else raw.push(categoryValues(column, row.cells[column.id] ?? null, exportCellText(column, row))[0] ?? null);
      }
      await pause();
    }
    let legend: VisualMap["legend"] = [],
      years: VisualMap["years"] = null,
      values: (number | null)[];
    if (!column) values = raw.map(() => null);
    else if (dated) {
      // The colour scale runs from the 2nd to the 98th percentile, so a few
      // far dates do not wash out the rest; years beyond take the end colour.
      const known = raw.filter((v): v is number => typeof v === "number").sort((x, y) => x - y);
      const at = (q: number) => known[Math.min(known.length - 1, Math.max(0, Math.round(q * (known.length - 1))))];
      years = known.length ? { min: at(0.02), max: at(0.98) } : null;
      values = raw.map((v) => (typeof v === "number" ? v : null));
    } else {
      const counts = new Map<string, number>();
      for (const v of raw) if (typeof v === "string") counts.set(v, (counts.get(v) ?? 0) + 1);
      const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const top = ranked.slice(0, ranked.length > VISUAL_MAP_CATEGORIES ? VISUAL_MAP_CATEGORIES - 1 : VISUAL_MAP_CATEGORIES);
      legend = top.map(([label, count]) => ({ label, count }));
      const rest = ranked.slice(top.length).reduce((s, [, c]) => s + c, 0);
      if (rest) legend.push({ label: "Otros", count: rest });
      const index = new Map(top.map(([label], i) => [label, i]));
      values = raw.map((v) => (typeof v === "string" ? (index.get(v) ?? (rest ? top.length : null)) : null));
    }
    const points: VisualMapPoint[] = rows.map((rowId, i) => ({
      rowId,
      assetId: assets[i],
      title: titles[i],
      x: xy[i * 2],
      y: xy[i * 2 + 1],
      value: values[i],
      shown: shown.has(rowId),
    }));
    return { points, records, missing: records - rows.length, mode: !column ? "none" : dated ? "year" : "category", legend, years, computed };
  }
}

// Comparison boards: up to six images, from any database, kept side by side
// with synchronised zoom or one over the other. A board stores image ids; an
// image removed from its record simply leaves the board.
import { randomUUID as uuid } from "node:crypto";
import type { Repository } from "./repository";
import type { DatabaseColumn } from "../../shared/databases";
import { exportCellText } from "../../shared/databaseExport";
import { yearCoverage, yearOf } from "../../shared/statistics";
import type { CompareBoard, CompareItem } from "../../shared/compare";

export const BOARD_LIMIT = 6;
const now = () => new Date().toISOString();
type Row = { id: string; name: string; asset_ids_json: string; created_at: string; updated_at: string };
const decode = (r: Row): CompareBoard => ({
  id: r.id,
  name: r.name,
  assetIds: JSON.parse(r.asset_ids_json),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class CompareBoards {
  private dateColumns = new Map<string, DatabaseColumn | null>();
  constructor(private repo: Repository) {}

  list(): CompareBoard[] {
    return (this.repo.db.prepare("SELECT * FROM compare_boards ORDER BY updated_at DESC").all() as Row[]).map(decode);
  }
  get(id: string): CompareBoard & { items: CompareItem[] } {
    const row = this.repo.db.prepare("SELECT * FROM compare_boards WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new Error("Mesa no encontrada.");
    const board = decode(row);
    return { ...board, items: this.items(board.assetIds) };
  }
  save(input: { id?: string; name?: string; assetIds?: string[] }): CompareBoard {
    const assetIds = input.assetIds ? [...new Set(input.assetIds)] : undefined;
    if (assetIds && assetIds.length > BOARD_LIMIT)
      throw new Error("Una mesa admite como máximo seis imágenes.");
    for (const id of assetIds ?? []) this.repo.asset(id);
    const at = now();
    if (input.id) {
      const current = this.get(input.id);
      this.repo.db
        .prepare("UPDATE compare_boards SET name=?,asset_ids_json=?,updated_at=? WHERE id=?")
        .run(input.name?.trim() || current.name, JSON.stringify(assetIds ?? current.assetIds), at, input.id);
      return decode(this.repo.db.prepare("SELECT * FROM compare_boards WHERE id=?").get(input.id) as Row);
    }
    const id = uuid();
    this.repo.db
      .prepare("INSERT INTO compare_boards VALUES(?,?,?,?,?)")
      .run(id, input.name?.trim() || "Mesa", JSON.stringify(assetIds ?? []), at, at);
    return decode(this.repo.db.prepare("SELECT * FROM compare_boards WHERE id=?").get(id) as Row);
  }
  delete(id: string) {
    this.repo.db.prepare("DELETE FROM compare_boards WHERE id=?").run(id);
  }

  /** Images in board order, with what identifies them. */
  items(assetIds: string[]): CompareItem[] {
    if (!assetIds.length) return [];
    const assets = this.repo.db
      .prepare(`SELECT id,row_id FROM image_assets WHERE id IN (${assetIds.map(() => "?").join(",")})`)
      .all(...assetIds) as { id: string; row_id: string }[];
    const rows = new Map(this.repo.hydrate([...new Set(assets.map((a) => a.row_id))]).map((r) => [r.id, r]));
    return assetIds.flatMap((assetId) => {
      const rowId = assets.find((a) => a.id === assetId)?.row_id;
      const row = rowId ? rows.get(rowId) : undefined;
      const image = row?.images.find((i) => i.id === assetId);
      if (!row || !image) return [];
      const column = this.dateColumn(row.databaseId);
      const date = column ? exportCellText(column, row).trim() || null : null;
      const year = column ? yearOf(column, row.cells[column.id] ?? null, date ?? "") : null;
      return [
        {
          assetId,
          rowId: row.id,
          title: row.title,
          databaseId: row.databaseId,
          databaseName: row.databaseName,
          fileName: image.fileName,
          width: image.width,
          height: image.height,
          revision: image.revision,
          date,
          year,
        },
      ];
    });
  }
  /** The property that holds dates in a database, chosen once per session. */
  private dateColumn(databaseId: string): DatabaseColumn | null {
    if (this.dateColumns.has(databaseId)) return this.dateColumns.get(databaseId)!;
    const columns = this.repo
      .detail(databaseId)
      .columns.filter((c) => ["historical_date", "date", "text", "number"].includes(c.type));
    const ids = (
      this.repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY random() LIMIT 300").all(databaseId) as { id: string }[]
    ).map((r) => r.id);
    const rows = this.repo.hydrate(ids);
    const best = columns
      .map((c) => ({ c, ...yearCoverage(c, rows.map((r) => ({ raw: r.cells[c.id] ?? null, display: exportCellText(c, r) }))) }))
      .filter((x) => x.share >= 0.3)
      .sort((a, b) => b.score - a.score)[0];
    this.dateColumns.set(databaseId, best?.c ?? null);
    return best?.c ?? null;
  }
}

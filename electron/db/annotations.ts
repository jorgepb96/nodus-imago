// Regions marked on an image with a note and tags. Coordinates are fractions
// of the image as displayed (after its EXIF rotation), so they hold for every
// size Imago shows. Saving one re-indexes its record: the note is found by the
// literal search at once and by the semantic search after the next indexing.
import { randomUUID as uuid } from "node:crypto";
import type { Repository } from "./repository";
import type { ImageAnnotation } from "../../shared/imago";

const now = () => new Date().toISOString();
const clamp = (n: number) => Math.min(1, Math.max(0, n));
type Row = Omit<ImageAnnotation, "tags"> & { tags_json: string };
const SELECT =
  "SELECT id,asset_id assetId,row_id rowId,x,y,w,h,note,tags_json,color,created_at createdAt,updated_at updatedAt FROM image_annotations";
const decode = ({ tags_json, ...row }: Row): ImageAnnotation => ({ ...row, tags: JSON.parse(tags_json) });

export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 30);
}

export class Annotations {
  constructor(private repo: Repository) {}

  list(input: { assetId?: string; rowId?: string }): ImageAnnotation[] {
    const [where, value] = input.assetId ? ["asset_id", input.assetId] : ["row_id", input.rowId];
    return (this.repo.db.prepare(`${SELECT} WHERE ${where}=? ORDER BY created_at`).all(value) as Row[]).map(decode);
  }
  get(id: string): ImageAnnotation {
    const row = this.repo.db.prepare(`${SELECT} WHERE id=?`).get(id) as Row | undefined;
    if (!row) throw new Error("Anotación no encontrada.");
    return decode(row);
  }
  save(input: {
    id?: string;
    assetId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    note: string;
    tags: string[];
    color?: string | null;
  }): ImageAnnotation {
    const asset = this.repo.asset(input.assetId) as { row_id: string };
    const x = clamp(input.x),
      y = clamp(input.y),
      w = Math.min(clamp(input.w), 1 - x),
      h = Math.min(clamp(input.h), 1 - y);
    if (w < 0.005 || h < 0.005) throw new Error("La zona es demasiado pequeña.");
    const at = now(),
      tags = JSON.stringify(cleanTags(input.tags)),
      note = input.note.trim();
    const id = input.id ?? uuid();
    this.repo.db.transaction(() => {
      if (input.id) {
        const done = this.repo.db
          .prepare("UPDATE image_annotations SET x=?,y=?,w=?,h=?,note=?,tags_json=?,color=?,updated_at=? WHERE id=? AND asset_id=?")
          .run(x, y, w, h, note, tags, input.color ?? null, at, input.id, input.assetId);
        if (!done.changes) throw new Error("Anotación no encontrada.");
      } else
        this.repo.db
          .prepare("INSERT INTO image_annotations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(id, input.assetId, asset.row_id, x, y, w, h, note, tags, input.color ?? null, at, at);
      this.repo.touchRows([asset.row_id]);
      this.repo.indexRow(asset.row_id);
    })();
    return this.get(id);
  }
  delete(id: string) {
    const annotation = this.get(id);
    this.repo.db.transaction(() => {
      this.repo.db.prepare("DELETE FROM image_annotations WHERE id=?").run(id);
      this.repo.touchRows([annotation.rowId]);
      this.repo.indexRow(annotation.rowId);
    })();
  }
  /** Tags already used, most frequent first, to suggest while typing. */
  tags(databaseId: string): string[] {
    const counts = new Map<string, number>();
    for (const { tags_json } of this.repo.db
      .prepare("SELECT a.tags_json FROM image_annotations a JOIN db_rows r ON r.id=a.row_id WHERE r.database_id=?")
      .all(databaseId) as { tags_json: string }[])
      for (const tag of JSON.parse(tags_json) as string[]) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t).slice(0, 200);
  }
}

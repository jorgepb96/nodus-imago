// Regions marked on an image with a note and tags. Coordinates are stored as
// fractions of the original as oriented by its EXIF tag, so they hold for
// every size Imago shows and survive turning and cropping: they are listed and
// saved in the frame of the image as shown (shared/imageRotation.ts). Saving one re-indexes its record: the note is found by the
// literal search at once and by the semantic search after the next indexing.
import { randomUUID as uuid } from "node:crypto";
import type { Repository } from "./repository";
import type { ImageAnnotation } from "../../shared/imago";
import { assetView, fromShown, toShown, type ImageView } from "../../shared/imageRotation";
import { decodeMultiSelect, encodeMultiSelect } from "../../shared/databases";
import { isHeritageColumn } from "../../shared/heritage";

const now = () => new Date().toISOString();
const clamp = (n: number) => Math.min(1, Math.max(0, n));
type Row = Omit<ImageAnnotation, "tags"> & { tags_json: string };
const SELECT =
  "SELECT id,asset_id assetId,row_id rowId,x,y,w,h,note,tags_json,color,created_at createdAt,updated_at updatedAt,kind,option_id optionId FROM image_annotations";
/** A point travels through turns and crops as a tiny square around it. */
const E = 1e-4;
const around = <T extends { x: number; y: number; w: number; h: number }>(p: T): T => ({ ...p, x: p.x - E, y: p.y - E, w: 2 * E, h: 2 * E });
const centre = <T extends { x: number; y: number; w: number; h: number }>(r: T): T => ({ ...r, x: r.x + r.w / 2, y: r.y + r.h / 2, w: 0, h: 0 });
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

  private view(assetId: string): ImageView {
    return assetView((this.repo.asset(assetId) as { metadata_json: string }).metadata_json);
  }
  /** As shown: turned and cropped like the image; a crop hides the rest. */
  list(input: { assetId?: string; rowId?: string }): ImageAnnotation[] {
    const [where, value] = input.assetId ? ["asset_id", input.assetId] : ["row_id", input.rowId];
    const views = new Map<string, ImageView>();
    return (this.repo.db.prepare(`${SELECT} WHERE ${where}=? ORDER BY created_at`).all(value) as Row[]).flatMap((row) => {
      if (!views.has(row.assetId)) views.set(row.assetId, this.view(row.assetId));
      const stored = decode(row);
      if (stored.kind === "point") {
        const shown = toShown(around(stored), views.get(row.assetId)!);
        return shown && shown.w > E ? [centre(shown)] : [];
      }
      const shown = toShown(stored, views.get(row.assetId)!);
      return shown ? [shown] : [];
    });
  }
  /** In the original's frame, as stored. */
  private stored(id: string): ImageAnnotation {
    const row = this.repo.db.prepare(`${SELECT} WHERE id=?`).get(id) as Row | undefined;
    if (!row) throw new Error("Anotación no encontrada.");
    return decode(row);
  }
  get(id: string): ImageAnnotation {
    const annotation = this.stored(id);
    if (annotation.kind === "point") {
      const shown = toShown(around(annotation), this.view(annotation.assetId));
      return shown ? centre(shown) : annotation;
    }
    return toShown(annotation, this.view(annotation.assetId)) ?? annotation;
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
    kind?: "rect" | "point";
    optionId?: string | null;
  }): ImageAnnotation {
    const asset = this.repo.asset(input.assetId) as { row_id: string; metadata_json: string };
    const view = assetView(asset.metadata_json);
    // Editing the note of a zone a crop clips must not shrink the zone: keep
    // the stored one unless the zone itself was moved.
    const previous = input.id ? this.stored(input.id) : null,
      shownBefore = previous ? toShown(previous, view) : null,
      unchanged =
        shownBefore &&
        (["x", "y", "w", "h"] as const).every((k) => Math.abs(shownBefore[k] - input[k]) < 1e-6),
      point = (input.kind ?? previous?.kind) === "point",
      region = unchanged ? previous! : point ? centre(fromShown(around(input), view)) : fromShown(input, view);
    const x = clamp(region.x),
      y = clamp(region.y),
      w = point ? 0 : Math.min(clamp(region.w), 1 - x),
      h = point ? 0 : Math.min(clamp(region.h), 1 - y);
    if (!point && (w < 0.005 || h < 0.005)) throw new Error("La zona es demasiado pequeña.");
    // A mark of a heritage element: the element must belong to a heritage
    // property of the record's database, and the record shows it.
    const optionId = input.optionId === undefined ? (previous?.optionId ?? null) : input.optionId;
    const heritageColumn = optionId ? this.heritageColumnOf(optionId, asset.row_id) : null;
    const at = now(),
      tags = JSON.stringify(cleanTags(input.tags)),
      note = input.note.trim();
    const id = input.id ?? uuid();
    this.repo.db.transaction(() => {
      if (input.id) {
        const done = this.repo.db
          .prepare("UPDATE image_annotations SET x=?,y=?,w=?,h=?,note=?,tags_json=?,color=?,updated_at=?,kind=?,option_id=? WHERE id=? AND asset_id=?")
          .run(x, y, w, h, note, tags, input.color ?? null, at, point ? "point" : "rect", optionId, input.id, input.assetId);
        if (!done.changes) throw new Error("Anotación no encontrada.");
      } else
        this.repo.db
          .prepare(
            "INSERT INTO image_annotations(id,asset_id,row_id,x,y,w,h,note,tags_json,color,created_at,updated_at,kind,option_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(id, input.assetId, asset.row_id, x, y, w, h, note, tags, input.color ?? null, at, at, point ? "point" : "rect", optionId);
      if (heritageColumn && optionId) {
        const cell = this.repo.getRow(asset.row_id).cells[heritageColumn] ?? null;
        const ids = decodeMultiSelect(cell);
        if (!ids.includes(optionId)) this.repo.setCell(asset.row_id, heritageColumn, encodeMultiSelect([...ids, optionId]));
      }
      this.repo.touchRows([asset.row_id]);
      this.repo.indexRow(asset.row_id);
    })();
    return this.get(id);
  }
  /** The heritage property an element belongs to, in the record's database. */
  private heritageColumnOf(optionId: string, rowId: string): string {
    const found = this.repo.db
      .prepare(
        "SELECT c.id,c.type,c.config_json FROM db_select_options o JOIN db_columns c ON c.id=o.column_id JOIN db_rows r ON r.database_id=c.database_id WHERE o.id=? AND r.id=?",
      )
      .get(optionId, rowId) as { id: string; type: string; config_json: string } | undefined;
    if (!found || !isHeritageColumn({ type: found.type, config: JSON.parse(found.config_json || "{}") }))
      throw new Error("El elemento no pertenece a una propiedad de patrimonio de esta base.");
    return found.id;
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

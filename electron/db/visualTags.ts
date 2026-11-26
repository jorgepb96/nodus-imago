// Visual tags drawn by hand on the images of a database: each region names
// what it shows with a tag, an option of the database's «Etiquetas visuales»
// property (created the first time an image is tagged). Regions are stored
// in the original's frame, like annotations, so they hold through turns and
// crops; the property is re-filled from them after every change. Each region
// keeps its source, model, confidence and validation state for a detector to
// come; today every region is drawn by hand and validated.
import { randomUUID as uuid } from "node:crypto";
import type { Repository } from "./repository";
import { assetView, fromShown, toShown } from "../../shared/imageRotation";
import { importedOptionColor } from "../../shared/databaseCsv";
import type { DatabaseColumn } from "../../shared/databases";
import { VISUAL_TAGS_NAME, type VisualTagRegion, type VisualTagsSummary } from "../../shared/visualTags";

const now = () => new Date().toISOString();
const clamp = (n: number) => Math.min(1, Math.max(0, n));
type Row = {
  id: string;
  asset_id: string;
  option_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  source: VisualTagRegion["source"];
  model: string | null;
  confidence: number | null;
  state: VisualTagRegion["state"];
  created_at: string;
  updated_at: string;
};
const decode = (r: Row): VisualTagRegion => ({
  id: r.id,
  assetId: r.asset_id,
  optionId: r.option_id,
  x: r.x,
  y: r.y,
  w: r.w,
  h: r.h,
  source: r.source,
  model: r.model,
  confidence: r.confidence,
  state: r.state,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class VisualTags {
  constructor(private repo: Repository) {}

  /** The database's «Etiquetas visuales», made (after the other properties) when asked to. */
  column(databaseId: string, create = false): DatabaseColumn | null {
    const found = this.repo.detail(databaseId).columns.find((c) => c.type === "multi_select" && c.config.visualTags);
    if (found || !create) return found ?? null;
    const taken = new Set(this.repo.detail(databaseId).columns.map((c) => c.name.toLocaleLowerCase()));
    const name = taken.has(VISUAL_TAGS_NAME.toLocaleLowerCase()) ? `${VISUAL_TAGS_NAME} (Imago)` : VISUAL_TAGS_NAME;
    return this.repo.addColumn(databaseId, name, "multi_select", { visualTags: true });
  }

  /** The regions of an image, as it is shown (turned and cropped); a crop hides those outside it. */
  list(assetId: string): VisualTagRegion[] {
    const view = assetView((this.repo.asset(assetId) as { metadata_json: string }).metadata_json);
    return (this.repo.db.prepare("SELECT * FROM image_tags WHERE asset_id=? AND state<>'rejected' ORDER BY created_at").all(assetId) as Row[]).flatMap((r) => {
      const shown = toShown(r, view);
      return shown ? [decode({ ...r, ...shown })] : [];
    });
  }

  /**
   * Saves a region: a new one, or one moved, resized or given another tag.
   * The tag is an existing option, or a new one named by `label` (made at
   * once, with the property if the database has none yet). The image counts
   * as reviewed.
   */
  save(input: { id?: string; assetId: string; x: number; y: number; w: number; h: number; optionId?: string | null; label?: string | null }): VisualTagRegion {
    const asset = this.repo.asset(input.assetId) as { row_id: string; database_id: string; metadata_json: string };
    const view = assetView(asset.metadata_json);
    const previous = input.id ? (this.repo.db.prepare("SELECT * FROM image_tags WHERE id=? AND asset_id=?").get(input.id, input.assetId) as Row | undefined) : undefined;
    if (input.id && !previous) throw new Error("La región ya no existe.");
    return this.repo.db.transaction(() => {
      const optionId = this.option(asset.database_id, input.optionId ?? null, input.label ?? null) ?? previous?.option_id;
      if (!optionId) throw new Error("Elige o escribe una etiqueta.");
      // A region whose place did not change keeps the stored one (a crop may clip what is shown).
      const shownBefore = previous ? toShown(previous, view) : null,
        unchanged = shownBefore && (["x", "y", "w", "h"] as const).every((k) => Math.abs(shownBefore[k] - input[k]) < 1e-6);
      const region = unchanged ? previous! : fromShown(input, view);
      const x = clamp(region.x),
        y = clamp(region.y),
        w = Math.min(clamp(region.w), 1 - x),
        h = Math.min(clamp(region.h), 1 - y);
      if (w < 0.004 || h < 0.004) throw new Error("La zona es demasiado pequeña.");
      const id = input.id ?? uuid(),
        at = now();
      if (previous)
        this.repo.db.prepare("UPDATE image_tags SET option_id=?,x=?,y=?,w=?,h=?,updated_at=? WHERE id=?").run(optionId, x, y, w, h, at, id);
      else
        this.repo.db
          .prepare("INSERT INTO image_tags(id,asset_id,option_id,x,y,w,h,source,model,confidence,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'manual',NULL,NULL,'validated',?,?)")
          .run(id, input.assetId, optionId, x, y, w, h, at, at);
      this.markReviewed(input.assetId, true);
      this.repo.syncVisualTags(asset.row_id);
      return this.list(input.assetId).find((r) => r.id === id) ?? decode({ ...(this.repo.db.prepare("SELECT * FROM image_tags WHERE id=?").get(id) as Row) });
    })();
  }

  /** The property whose options are offered as tags, if one is linked. */
  dictionary(databaseId: string): DatabaseColumn | null {
    const id = this.column(databaseId)?.config.visualTagsDictionary;
    return (id && this.repo.detail(databaseId).columns.find((c) => c.id === id && ["select", "multi_select", "status"].includes(c.type))) || null;
  }
  /** Links a select property of the database as the tags' dictionary (null unlinks it). */
  setDictionary(databaseId: string, columnId: string | null) {
    if (columnId) {
      const source = this.repo.detail(databaseId).columns.find((c) => c.id === columnId);
      if (!source || !["select", "multi_select", "status"].includes(source.type) || source.config.visualTags)
        throw new Error("Elige una propiedad de selección de esta base de datos.");
    }
    const column = this.column(databaseId, !!columnId);
    if (!column) return;
    this.repo.updateColumn(column.id, undefined, { ...column.config, visualTagsDictionary: columnId });
  }
  /**
   * The option for a region: a tag of this database; a term of the linked
   * dictionary, copied as a tag (name, colour and icon) the first time; or a
   * new tag by name.
   */
  private option(databaseId: string, optionId: string | null, label: string | null): string | null {
    if (optionId) {
      const column = this.column(databaseId);
      if (column?.options.some((o) => o.id === optionId)) return optionId;
      const dictionary = this.dictionary(databaseId);
      const term = dictionary?.options.find((o) => o.id === optionId);
      if (!term || !dictionary) throw new Error("La etiqueta no pertenece a esta base de datos.");
      const tags = this.column(databaseId, true)!;
      const same = tags.options.find((o) => o.label.toLocaleLowerCase() === term.label.toLocaleLowerCase());
      if (same) return same.id;
      // A term without a colour gets one of the palette, so tags are told apart on the image.
      this.repo.saveOptions(tags.id, [
        ...tags.options.map((o) => ({ id: o.id, label: o.label, color: o.color })),
        { label: term.label, color: term.color ?? importedOptionColor(tags.options.length) },
      ]);
      const created = this.repo.column(tags.id).options.find((o) => o.label === term.label)!;
      const icon = dictionary.config.optionIcons?.[term.id];
      if (icon) {
        const current = this.repo.column(tags.id);
        this.repo.updateColumn(tags.id, undefined, { ...current.config, optionIcons: { ...(current.config.optionIcons ?? {}), [created.id]: icon } });
      }
      return created.id;
    }
    const name = label?.replace(/\s+/g, " ").trim();
    if (!name) return null;
    const column = this.column(databaseId, true)!;
    const existing = column.options.find((o) => o.label.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) return existing.id;
    this.repo.saveOptions(column.id, [
      ...column.options.map((o) => ({ id: o.id, label: o.label, color: o.color })),
      { label: name.slice(0, 200), color: importedOptionColor(column.options.length) },
    ]);
    return this.repo.column(column.id).options.find((o) => o.label === name.slice(0, 200))!.id;
  }

  delete(id: string) {
    const region = this.repo.db.prepare("SELECT t.id,a.row_id FROM image_tags t JOIN image_assets a ON a.id=t.asset_id WHERE t.id=?").get(id) as { row_id: string } | undefined;
    if (!region) return;
    this.repo.db.transaction(() => {
      this.repo.db.prepare("DELETE FROM image_tags WHERE id=?").run(id);
      this.repo.syncVisualTags(region.row_id);
    })();
  }

  /** Marks an image as looked at (with or without regions), or as not reviewed again. */
  setReviewed(assetId: string, reviewed: boolean) {
    const asset = this.repo.asset(assetId) as { row_id: string };
    this.repo.db.transaction(() => {
      this.markReviewed(assetId, reviewed);
      this.repo.syncVisualTags(asset.row_id);
    })();
  }
  private markReviewed(assetId: string, reviewed: boolean) {
    if (reviewed) this.repo.db.prepare("INSERT OR IGNORE INTO image_tag_reviews VALUES(?,?)").run(assetId, now());
    else this.repo.db.prepare("DELETE FROM image_tag_reviews WHERE asset_id=?").run(assetId);
  }
  /** Whether an image was reviewed. */
  reviewed(assetId: string): boolean {
    return !!this.repo.db.prepare("SELECT 1 FROM image_tag_reviews WHERE asset_id=?").get(assetId);
  }

  /**
   * How a database's images were tagged: images reviewed and those reviewed
   * with nothing to tag, regions by source and state, and each tag's
   * appearances and the photographs that hold it.
   */
  summary(databaseId: string): VisualTagsSummary {
    const column = this.column(databaseId);
    const images = (this.repo.db.prepare("SELECT count(*) n FROM image_assets WHERE database_id=?").get(databaseId) as { n: number }).n;
    const reviewed = (
      this.repo.db.prepare("SELECT count(*) n FROM image_tag_reviews v JOIN image_assets a ON a.id=v.asset_id WHERE a.database_id=?").get(databaseId) as { n: number }
    ).n;
    const reviewedEmpty = (
      this.repo.db
        .prepare(
          "SELECT count(*) n FROM image_tag_reviews v JOIN image_assets a ON a.id=v.asset_id WHERE a.database_id=? AND NOT EXISTS(SELECT 1 FROM image_tags t WHERE t.asset_id=a.id AND t.state='validated')",
        )
        .get(databaseId) as { n: number }
    ).n;
    const regions = this.repo.db
      .prepare("SELECT t.source,t.state,count(*) n FROM image_tags t JOIN image_assets a ON a.id=t.asset_id WHERE a.database_id=? GROUP BY t.source,t.state")
      .all(databaseId) as { source: string; state: string; n: number }[];
    const tags = column
      ? (
          this.repo.db
            .prepare(
              "SELECT t.option_id id,count(*) appearances,count(DISTINCT a.row_id) records,count(DISTINCT a.id) images FROM image_tags t JOIN image_assets a ON a.id=t.asset_id WHERE a.database_id=? AND t.state='validated' GROUP BY t.option_id",
            )
            .all(databaseId) as { id: string; appearances: number; records: number; images: number }[]
        )
          .map((r) => ({ ...r, label: column.options.find((o) => o.id === r.id)?.label ?? "", color: column.options.find((o) => o.id === r.id)?.color ?? null }))
          .filter((r) => r.label)
          .sort((a, b) => b.appearances - a.appearances || a.label.localeCompare(b.label, "es"))
      : [];
    return { columnId: column?.id ?? null, columnName: column?.name ?? null, images, reviewed, reviewedEmpty, regions, tags };
  }
}

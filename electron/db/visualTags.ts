// Visual tags drawn by hand on the images of a database: each region describes
// what it shows with options of the database's «Etiquetas visuales»
// property (created the first time an image is tagged). Regions are stored
// in the original's frame, like annotations, so they hold through turns and
// crops; the property is re-filled from them after every change. Each region
// keeps its source, model, confidence and validation state.
import { createHash, randomUUID as uuid } from "node:crypto";
import type { Repository } from "./repository";
import { assetRevision, assetView, fromShown, toShown, type Region } from "../../shared/imageRotation";
import { importedOptionColor } from "../../shared/databaseCsv";
import type { DatabaseColumn } from "../../shared/databases";
import { isHeritageColumn } from "../../shared/heritage";
import { modelChoiceLabel, type ModelChoice } from "../../shared/aiConfig";
import { VISUAL_TAGS_NAME, type VisualTagChoice, type VisualTagRegion, type VisualTagSuggestion, type VisualTagsSummary } from "../../shared/visualTags";

const now = () => new Date().toISOString();
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const optionName = (s: string) => s.normalize("NFKC").trim().toLowerCase();
type TagInput = Region & {
  id?: string; assetId: string; dictionaryId?: string | null;
  tags?: VisualTagChoice[]; optionId?: string | null; label?: string | null;
};
type Row = {
  id: string;
  asset_id: string;
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
const taggedRegions = `
  SELECT t.*,json_group_array(link.option_id ORDER BY link.position) optionIds,o.visual_tag_dictionary_id dictionaryId
  FROM image_tags t JOIN image_tag_options link ON link.region_id=t.id
  JOIN db_select_options o ON o.id=link.option_id
`;
type TaggedRow = Row & { optionIds: string; dictionaryId: string | null };
type UndoKind = "region" | "review" | "suggestions";
type UndoStep = {
  assetId: string; dictionaryId: string | null; kind: UndoKind;
  regions: { id: string; before?: TaggedRow; after?: TaggedRow }[];
  beforeReview: string | null; afterReview: string | null;
};
const decode = (r: Row, optionIds: string[]): VisualTagRegion => ({
  id: r.id,
  assetId: r.asset_id,
  optionIds,
  optionId: optionIds[0],
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
  private readonly undoSteps: UndoStep[] = [];
  /** Steps undone, newest last; any new change of the same image and dictionary drops them. */
  private readonly redoSteps: UndoStep[] = [];

  constructor(private repo: Repository) {}

  /** The database's «Etiquetas visuales», made (after the other properties) when asked to. */
  column(databaseId: string, create = false): DatabaseColumn | null {
    const { columns } = this.repo.detail(databaseId);
    const found = columns.find((c) => c.type === "multi_select" && c.config.visualTags);
    if (found || !create) return found ?? null;
    const taken = new Set(columns.map((c) => c.name.toLocaleLowerCase()));
    const name = taken.has(VISUAL_TAGS_NAME.toLocaleLowerCase()) ? `${VISUAL_TAGS_NAME} (Imago)` : VISUAL_TAGS_NAME;
    return this.repo.addColumn(databaseId, name, "multi_select", { visualTags: true });
  }

  /** The regions of an image, as it is shown (turned and cropped); a crop hides those outside it. */
  list(assetId: string, dictionaryId?: string | null): VisualTagRegion[] {
    const asset = this.repo.asset(assetId) as { database_id: string; metadata_json: string };
    const view = assetView(asset.metadata_json);
    const scope = dictionaryId === undefined ? this.dictionary(asset.database_id)?.id ?? null : dictionaryId;
    const rows = this.repo.db.prepare(
      `${taggedRegions}
       WHERE t.asset_id=? AND t.state<>'rejected' AND o.visual_tag_dictionary_id IS ?
       GROUP BY t.id ORDER BY t.created_at,t.rowid`,
    ).all(assetId, scope) as TaggedRow[];
    return rows.flatMap((r) => {
      const shown = toShown(r, view);
      return shown ? [decode({ ...r, ...shown }, JSON.parse(r.optionIds))] : [];
    });
  }

  selection(assetId: string) {
    const asset = this.repo.asset(assetId) as { database_id: string };
    const column = this.column(asset.database_id);
    const dictionary = this.dictionary(asset.database_id, column?.config.visualTagsDictionary ?? null);
    const dictionaryId = dictionary?.id ?? null;
    return {
      regions: this.list(assetId, dictionaryId),
      reviewed: this.reviewed(assetId, dictionaryId),
      column,
      dictionary,
      optionIds: column ? this.appliedOptionIds(column.id, dictionaryId) : [],
      canUndo: this.undoIndex(assetId, dictionaryId) >= 0,
      canRedo: this.undoIndex(assetId, dictionaryId, this.redoSteps) >= 0,
    };
  }

  /** Per-image review, independent of the aggregate record and of other dictionaries. */
  pendingImages(databaseId: string, dictionaryId: string | null, rowIds: string[]): string[] {
    if (rowIds.length === 0) return [];
    if (dictionaryId && !this.dictionary(databaseId, dictionaryId)) return [];
    return this.repo.db.prepare(
      `SELECT a.id FROM image_assets a
       WHERE a.database_id=? AND a.row_id IN (SELECT value FROM json_each(?))
         AND NOT EXISTS(SELECT 1 FROM image_tag_reviews v WHERE v.asset_id=a.id AND v.dictionary_id=?)
         AND NOT EXISTS(
           SELECT 1 FROM image_tags t JOIN image_tag_options l ON l.region_id=t.id JOIN db_select_options o ON o.id=l.option_id
           WHERE t.asset_id=a.id AND t.state='validated' AND o.visual_tag_dictionary_id IS ?
         )`,
    ).pluck().all(databaseId, JSON.stringify(rowIds), dictionaryId ?? "", dictionaryId) as string[];
  }

  private undoIndex(assetId: string, dictionaryId: string | null, steps = this.undoSteps) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.assetId === assetId && step.dictionaryId === dictionaryId) return i;
    }
    return -1;
  }

  private snapshot(assetId: string, dictionaryId: string | null) {
    const regions = this.repo.db.prepare(
      `${taggedRegions} WHERE t.asset_id=? AND o.visual_tag_dictionary_id IS ? GROUP BY t.id`,
    ).all(assetId, dictionaryId) as TaggedRow[];
    const reviewedAt = this.repo.db.prepare("SELECT reviewed_at FROM image_tag_reviews WHERE asset_id=? AND dictionary_id=?")
      .pluck().get(assetId, dictionaryId ?? "") as string | undefined;
    return { regions: new Map(regions.map((region) => [region.id, region])), reviewedAt: reviewedAt ?? null };
  }

  private remember<T>(assetId: string, dictionaryId: string | null, kind: UndoKind, action: () => T): T {
    const { before, after, result } = this.repo.db.transaction(() => {
      const before = this.snapshot(assetId, dictionaryId);
      const result = action();
      return { before, after: this.snapshot(assetId, dictionaryId), result };
    })();
    const ids = new Set([...before.regions.keys(), ...after.regions.keys()]);
    const regions = [...ids].flatMap((id) => {
      const old = before.regions.get(id), next = after.regions.get(id);
      return JSON.stringify(old) === JSON.stringify(next) ? [] : [{ id, before: old, after: next }];
    });
    if (regions.length || before.reviewedAt !== after.reviewedAt) {
      this.undoSteps.push({ assetId, dictionaryId, kind, regions, beforeReview: before.reviewedAt, afterReview: after.reviewedAt });
      if (this.undoSteps.length > 100) this.undoSteps.shift();
      for (let i = this.redoSteps.length - 1; i >= 0; i--)
        if (this.redoSteps[i].assetId === assetId && this.redoSteps[i].dictionaryId === dictionaryId) this.redoSteps.splice(i, 1);
    }
    return result;
  }

  clearUndo() {
    this.undoSteps.length = 0;
    this.redoSteps.length = 0;
  }

  undo(assetId: string, dictionaryId: string | null): { kind: UndoKind } | null {
    return this.step(assetId, dictionaryId, this.undoSteps, this.redoSteps, "Esta acción ya no se puede deshacer porque el etiquetado ha cambiado.");
  }

  redo(assetId: string, dictionaryId: string | null): { kind: UndoKind } | null {
    return this.step(assetId, dictionaryId, this.redoSteps, this.undoSteps, "Esta acción ya no se puede rehacer porque el etiquetado ha cambiado.");
  }

  /** Takes the image's newest step from one stack, puts its «before» back and keeps the reverse step in the other. */
  private step(assetId: string, dictionaryId: string | null, from: UndoStep[], to: UndoStep[], staleMessage: string): { kind: UndoKind } | null {
    const index = this.undoIndex(assetId, dictionaryId, from);
    if (index < 0) return null;
    const step = from[index];
    const asset = this.repo.asset(assetId) as { row_id: string; database_id: string };
    const restored = this.repo.db.transaction(() => {
      const current = this.snapshot(assetId, dictionaryId);
      const column = this.column(asset.database_id);
      const options = new Set(column ? this.appliedOptionIds(column.id, dictionaryId) : []);
      const stale = current.reviewedAt !== step.afterReview || step.regions.some(({ id, before, after }) =>
        JSON.stringify(current.regions.get(id)) !== JSON.stringify(after) ||
        (before && (JSON.parse(before.optionIds) as string[]).some((optionId) => !options.has(optionId))),
      );
      if (stale) return false;
      const remove = this.repo.db.prepare("DELETE FROM image_tags WHERE id=? AND asset_id=?");
      const insert = this.repo.db.prepare(
        `INSERT INTO image_tags(id,asset_id,x,y,w,h,source,model,confidence,state,created_at,updated_at)
         VALUES(@id,@asset_id,@x,@y,@w,@h,@source,@model,@confidence,@state,@created_at,@updated_at)`,
      );
      const addLink = this.repo.db.prepare("INSERT INTO image_tag_options(region_id,option_id,position) VALUES(?,?,?)");
      for (const { id, before } of step.regions) {
        remove.run(id, assetId);
        if (!before) continue;
        const { optionIds, dictionaryId: _dictionaryId, ...row } = before;
        insert.run(row);
        (JSON.parse(optionIds) as string[]).forEach((optionId, position) => addLink.run(id, optionId, position));
      }
      this.markReviewed(assetId, dictionaryId, false);
      if (step.beforeReview)
        this.repo.db.prepare("INSERT INTO image_tag_reviews(asset_id,reviewed_at,dictionary_id) VALUES(?,?,?)")
          .run(assetId, step.beforeReview, dictionaryId ?? "");
      this.repo.syncVisualTags(asset.row_id);
      return true;
    })();
    from.splice(index, 1);
    if (!restored) throw new Error(staleMessage);
    to.push({
      ...step,
      regions: step.regions.map(({ id, before, after }) => ({ id, before: after, after: before })),
      beforeReview: step.afterReview,
      afterReview: step.beforeReview,
    });
    if (to.length > 100) to.shift();
    return { kind: step.kind };
  }

  suggestionTarget(assetId: string, dictionaryId: string) {
    const asset = this.repo.asset(assetId) as { row_id: string; database_id: string; content_hash: string; metadata_json: string };
    const dictionary = this.dictionary(asset.database_id);
    if (dictionary?.id !== dictionaryId || !dictionary.options.length)
      throw new Error("Elige un diccionario activo que contenga etiquetas.");
    const imageVersion = createHash("sha256").update(JSON.stringify([
      asset.row_id, asset.content_hash, assetRevision(asset.metadata_json),
      dictionary.options.map(({ id, label }) => [id, label]),
    ])).digest("hex");
    return { dictionary, imageVersion, rowId: asset.row_id };
  }

  /** Keeps a model's suggestions for this image, replacing earlier ones. */
  storeSuggestions(assetId: string, dictionaryId: string, imageVersion: string, choice: ModelChoice, regions: VisualTagSuggestion[]) {
    this.repo.db.prepare(
      "INSERT OR REPLACE INTO image_tag_suggestions(asset_id,dictionary_id,image_version,choice_json,regions_json,created_at) VALUES(?,?,?,?,?,?)",
    ).run(assetId, dictionaryId, imageVersion, JSON.stringify(choice), JSON.stringify(regions), now());
  }

  /**
   * The suggestions kept for this image, if the image and the dictionary are
   * as they were; each with the tags already added from it.
   */
  storedSuggestions(assetId: string, dictionaryId: string) {
    const stored = this.repo.db.prepare(
      "SELECT image_version imageVersion,choice_json choice,regions_json regions FROM image_tag_suggestions WHERE asset_id=? AND dictionary_id=?",
    ).get(assetId, dictionaryId) as { imageVersion: string; choice: string; regions: string } | undefined;
    if (!stored) return null;
    let target: ReturnType<VisualTags["suggestionTarget"]>;
    try {
      target = this.suggestionTarget(assetId, dictionaryId);
    } catch {
      return null;
    }
    if (target.imageVersion !== stored.imageVersion) return null;
    const terms = new Map(target.dictionary.options.map((option) => [option.id, optionName(option.label)]));
    const names = new Map(this.column(target.dictionary.databaseId)?.options.map((option) => [option.id, optionName(option.label)]));
    const boxKey = (region: Region) => [region.x, region.y, region.w, region.h].map((n) => Math.round(n * 1000)).join(",");
    const saved = this.list(assetId, dictionaryId).filter((region) => region.state === "validated");
    const regions = (JSON.parse(stored.regions) as VisualTagSuggestion[]).map((region) => {
      const sameBox = saved.filter((other) => boxKey(other) === boxKey(region));
      const applied = region.optionIds.filter((id) => sameBox.some((other) => other.optionIds.some((own) => names.get(own) === terms.get(id))));
      return { region, applied };
    });
    return { imageVersion: stored.imageVersion, choice: JSON.parse(stored.choice) as ModelChoice, regions };
  }

  applySuggestions(input: { assetId: string; dictionaryId: string; imageVersion: string; choice: ModelChoice; regions: (VisualTagSuggestion & { choice?: ModelChoice })[] }) {
    return this.remember(input.assetId, input.dictionaryId, "suggestions", () => {
      const { dictionary, imageVersion, rowId } = this.suggestionTarget(input.assetId, input.dictionaryId);
      if (imageVersion !== input.imageVersion)
        throw new Error("La imagen o el diccionario han cambiado. Vuelve a generar las sugerencias.");
      const terms = new Map(dictionary.options.map((option) => [option.id, optionName(option.label)]));
      const applied = new Map(this.column(dictionary.databaseId)?.options.map((option) => [option.id, optionName(option.label)]));
      // Identical suggestions can appear again on a rerun. A matching
      // region and set of tags already in the image should only count once.
      const boxKey = (region: Region) => [region.x, region.y, region.w, region.h].map((n) => Math.round(n * 1000)).join(",");
      const existing = this.list(input.assetId, input.dictionaryId).filter((region) => region.state === "validated");
      let added = 0;
      for (const { optionIds, choice, ...region } of input.regions) {
        const model = modelChoiceLabel(choice ?? input.choice);
        const labels = optionIds.map((id) => terms.get(id));
        if (labels.some((label) => !label)) throw new Error("El diccionario ha cambiado. Vuelve a generar las sugerencias.");
        const sameBox = existing.filter((saved) => boxKey(saved) === boxKey(region));
        if (sameBox.some((saved) => labels.every((label) => saved.optionIds.some((id) => applied.get(id) === label)))) continue;
        // If the user accepted only some tags for a proposal, a later
        // acceptance from the same model adds to that region.
        const previous = sameBox.find((saved) => saved.source === "ai" && saved.model === model);
        const { x, y, w, h } = previous ?? region;
        const saved = this.write({
          x, y, w, h, id: previous?.id, assetId: input.assetId, dictionaryId: input.dictionaryId,
          tags: [...(previous?.optionIds ?? []), ...optionIds].map((optionId) => ({ optionId })),
        }, model);
        if (saved.optionIds.some((id) => !applied.has(id)))
          for (const option of this.column(dictionary.databaseId)?.options ?? [])
            applied.set(option.id, optionName(option.label));
        if (previous) existing[existing.indexOf(previous)] = saved;
        else existing.push(saved);
        added++;
      }
      if (added) {
        this.markReviewed(input.assetId, input.dictionaryId, true);
        this.repo.syncVisualTags(rowId);
      }
      return added;
    });
  }

  /**
   * Saves a region and its ordered tags. A geometry-only edit keeps its tags.
   * New labels and dictionary terms become options in the active criterion.
   */
  save(input: TagInput): VisualTagRegion {
    return this.write(input);
  }

  private write(input: TagInput, suggestedBy?: string): VisualTagRegion {
    const asset = this.repo.asset(input.assetId) as { row_id: string; database_id: string; metadata_json: string };
    const view = assetView(asset.metadata_json);
    const previous = input.id ? this.repo.db.prepare(
      `${taggedRegions} WHERE t.id=? AND t.asset_id=? GROUP BY t.id`,
    ).get(input.id, input.assetId) as TaggedRow | undefined : undefined;
    if (input.id && !previous) throw new Error("La región ya no existe.");
    const requested = input.dictionaryId === undefined && previous ? previous.dictionaryId : input.dictionaryId;
    const dictionary = this.dictionary(asset.database_id, requested);
    if (requested && !dictionary) throw new Error("Elige una propiedad de selección de esta base de datos.");
    const dictionaryId = dictionary?.id ?? null;
    if (previous && previous.dictionaryId !== dictionaryId) throw new Error("La región ya no existe.");
    const choices = input.tags ?? (input.optionId ? [{ optionId: input.optionId }] : input.label?.trim() ? [{ label: input.label }] : undefined);
    const write = this.repo.db.transaction(() => {
      const optionIds = choices
        ? [...new Set(choices.map((choice) => this.option(asset.database_id, dictionary, choice)))]
        : previous ? JSON.parse(previous.optionIds) as string[] : [];
      if (!optionIds.length) throw new Error("Elige o escribe una etiqueta.");
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
        this.repo.db.prepare("UPDATE image_tags SET x=?,y=?,w=?,h=?,updated_at=? WHERE id=?").run(x, y, w, h, at, id);
      else
        this.repo.db
          .prepare("INSERT INTO image_tags(id,asset_id,x,y,w,h,source,model,confidence,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,NULL,'validated',?,?)")
          .run(id, input.assetId, x, y, w, h, suggestedBy ? "ai" : "manual", suggestedBy ?? null, at, at);
      if (choices) {
        this.repo.db.prepare("DELETE FROM image_tag_options WHERE region_id=?").run(id);
        const add = this.repo.db.prepare("INSERT INTO image_tag_options(region_id,option_id,position) VALUES(?,?,?)");
        optionIds.forEach((optionId, position) => add.run(id, optionId, position));
      }
      if (!suggestedBy) {
        this.markReviewed(input.assetId, dictionaryId, true);
        this.repo.syncVisualTags(asset.row_id);
      }
      const saved = this.repo.db.prepare("SELECT * FROM image_tags WHERE id=?").get(id) as Row;
      const shown = saved.state !== "rejected" ? toShown(saved, view) : null;
      return decode(shown ? { ...saved, ...shown } : saved, optionIds);
    });
    return suggestedBy ? write() : this.remember(input.assetId, dictionaryId, "region", write);
  }

  /** The eligible dictionary for this scope, defaulting to the active one. */
  dictionary(databaseId: string, id = this.column(databaseId)?.config.visualTagsDictionary ?? null): DatabaseColumn | null {
    return (id && this.repo.detail(databaseId).columns.find((c) =>
      c.id === id && ["select", "multi_select", "status"].includes(c.type) && !c.config.visualTags && !isHeritageColumn(c),
    )) || null;
  }
  /** Activates the selected dictionary's tagging, or the standalone tags. */
  setDictionary(databaseId: string, columnId: string | null) {
    if (columnId && !this.dictionary(databaseId, columnId))
      throw new Error("Elige una propiedad de selección de esta base de datos.");
    const column = this.column(databaseId, !!columnId);
    if (!column || (column.config.visualTagsDictionary ?? null) === columnId) return;
    this.repo.updateColumn(column.id, undefined, { ...column.config, visualTagsDictionary: columnId });
  }

  private appliedOptionIds(columnId: string, dictionaryId: string | null) {
    return this.repo.db.prepare("SELECT id FROM db_select_options WHERE column_id=? AND visual_tag_dictionary_id IS ?")
      .pluck().all(columnId, dictionaryId) as string[];
  }

  /**
   * The option for a region: a tag of this database; a term of the linked
   * dictionary, copied as a tag (name, colour and icon) the first time; or a
   * new tag by name.
   */
  private option(databaseId: string, dictionary: DatabaseColumn | null, choice: VisualTagChoice): string {
    const column = this.column(databaseId);
    const dictionaryId = dictionary?.id ?? null;
    if ("optionId" in choice) {
      const { optionId } = choice;
      if (column && this.appliedOptionIds(column.id, dictionaryId).includes(optionId)) return optionId;
      const term = dictionary?.options.find((o) => o.id === optionId);
      if (!term || !dictionary) throw new Error("La etiqueta no pertenece a esta base de datos.");
      return this.appendOption(column ?? this.column(databaseId, true)!, dictionary.id, term.label, term.color, dictionary.config.optionIcons?.[term.id]);
    }
    const name = choice.label.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!name) throw new Error("Elige o escribe una etiqueta.");
    return this.appendOption(column ?? this.column(databaseId, true)!, dictionaryId, name, null);
  }

  private appendOption(column: DatabaseColumn, dictionaryId: string | null, label: string, color: string | null, icon?: string) {
    const name = optionName(label);
    const applied = new Set(this.appliedOptionIds(column.id, dictionaryId));
    const existing = column.options.find((o) => applied.has(o.id) && optionName(o.label) === name);
    if (existing) return existing.id;
    const id = uuid(),
      at = now(),
      position = (column.options.at(-1)?.position ?? -1) + 1;
    // Existing options and their cells are unchanged. The region save below
    // synchronizes the affected row, including its derived values and search text.
    this.repo.db
      .prepare("INSERT INTO db_select_options(id,database_id,column_id,label,color,position,created_at,updated_at,visual_tag_dictionary_id) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, column.databaseId, column.id, label.trim(), color ?? importedOptionColor(column.options.length), position, at, at, dictionaryId);
    if (icon) this.repo.updateColumn(column.id, undefined, { ...column.config, optionIcons: { ...column.config.optionIcons, [id]: icon } });
    return id;
  }

  delete(id: string) {
    const region = this.repo.db.prepare(
      `SELECT t.asset_id,a.row_id,o.visual_tag_dictionary_id dictionaryId
       FROM image_tags t JOIN image_assets a ON a.id=t.asset_id
       JOIN image_tag_options l ON l.region_id=t.id JOIN db_select_options o ON o.id=l.option_id WHERE t.id=? LIMIT 1`,
    ).get(id) as { asset_id: string; row_id: string; dictionaryId: string | null } | undefined;
    if (!region) return;
    this.remember(region.asset_id, region.dictionaryId, "region", () => {
      this.repo.db.prepare("DELETE FROM image_tags WHERE id=?").run(id);
      this.repo.syncVisualTags(region.row_id);
    });
  }

  /** Marks an image as looked at (with or without regions), or as not reviewed again. */
  setReviewed(assetId: string, reviewed: boolean, dictionaryId?: string | null) {
    const asset = this.repo.asset(assetId) as { row_id: string; database_id: string };
    const dictionary = this.dictionary(asset.database_id, dictionaryId);
    if (dictionaryId && !dictionary) throw new Error("Elige una propiedad de selección de esta base de datos.");
    const scope = dictionary?.id ?? null;
    this.remember(assetId, scope, "review", () => {
      this.markReviewed(assetId, scope, reviewed);
      this.repo.syncVisualTags(asset.row_id);
    });
  }
  private markReviewed(assetId: string, dictionaryId: string | null, reviewed: boolean) {
    if (reviewed) this.repo.db.prepare("INSERT OR IGNORE INTO image_tag_reviews(asset_id,reviewed_at,dictionary_id) VALUES(?,?,?)").run(assetId, now(), dictionaryId ?? "");
    else this.repo.db.prepare("DELETE FROM image_tag_reviews WHERE asset_id=? AND dictionary_id=?").run(assetId, dictionaryId ?? "");
  }
  /** Whether an image was reviewed. */
  reviewed(assetId: string, dictionaryId?: string | null): boolean {
    const scope = dictionaryId === undefined
      ? this.dictionary((this.repo.asset(assetId) as { database_id: string }).database_id)?.id ?? null
      : dictionaryId;
    return !!this.repo.db.prepare("SELECT 1 FROM image_tag_reviews WHERE asset_id=? AND dictionary_id=?").get(assetId, scope ?? "");
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
      this.repo.db.prepare("SELECT count(DISTINCT v.asset_id) n FROM image_tag_reviews v JOIN image_assets a ON a.id=v.asset_id WHERE a.database_id=?").get(databaseId) as { n: number }
    ).n;
    const reviewedEmpty = (
      this.repo.db
        .prepare(
          "SELECT count(DISTINCT v.asset_id) n FROM image_tag_reviews v JOIN image_assets a ON a.id=v.asset_id WHERE a.database_id=? AND NOT EXISTS(SELECT 1 FROM image_tags t WHERE t.asset_id=a.id AND t.state='validated')",
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
              `SELECT o.option_id id,count(*) appearances,count(DISTINCT a.row_id) records,count(DISTINCT a.id) images
               FROM image_tags t JOIN image_assets a ON a.id=t.asset_id JOIN image_tag_options o ON o.region_id=t.id
               WHERE a.database_id=? AND t.state='validated' GROUP BY o.option_id`,
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

// Visual tags drawn by hand: the property created on first use and filled
// from the regions, appearances and review, a dictionary's terms, removing a
// tag, filters, statistics (also filtered by a related book), export, the
// methodology report and backups.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { VisualTags } from "../electron/db/visualTags";
import { Annotations } from "../electron/db/annotations";
import { Authorities } from "../electron/db/authorities";
import { Heritage } from "../electron/db/heritage";
import { Statistics } from "../electron/db/statistics";
import { collectMethodology } from "../electron/export/methodology";
import { writeBackup, restoreBackup, verifyBackup } from "../electron/export/backup";
import { hashFile } from "../electron/import/images";
import sharp from "sharp";
import { exportCellText, exportCellValue } from "../shared/databaseExport";
import { mergeVisualTagReview, parseVisualTagSuggestions, VISUAL_TAGS_NAME } from "../shared/visualTags";
import { filterOperators } from "../shared/viewCriteria";
import { emptyElement, resolvedPosition } from "../shared/heritage";

/** Three photographs, each with one image file. */
async function withPhotos(run: (ctx: { repo: Repository; tags: VisualTags; db: string; rows: string[]; assets: string[]; root: string }) => Promise<void> | void) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-vtags-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv("Postales", ["Título", "Tema"], ["title", "multi_select"], [["Plaza", "Fiesta"], ["Dehesa", "Campo"], ["Puerto", "Mar"]]);
    const db = detail.database.id;
    const rows = (repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position").all(db) as { id: string }[]).map((r) => r.id);
    repo.db
      .prepare("INSERT INTO db_columns(id,database_id,name,type,position,config_json,created_at,updated_at) VALUES('img',?,'Imagen','files',9,'{}','x','x')")
      .run(db);
    const assets = rows.map((rowId, i) => {
      repo.db
        .prepare("INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(`asset-${i}`, db, rowId, "img", `f${i}.jpg`, path.join(root, `f${i}.jpg`), 0, `hash-${i}`, 10, 800, 600, "{}", null, 0, "x");
      return `asset-${i}`;
    });
    await run({ repo, tags: new VisualTags(repo), db, rows, assets, root });
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}
const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.3 };

async function writePhotoOriginals(repo: Repository, assets: string[]) {
  for (const [i, id] of assets.entries()) {
    const { original_path } = repo.asset(id) as { original_path: string };
    const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 40 + i * 40, g: 85, b: 115 } } }).jpeg().toBuffer();
    await fs.writeFile(original_path, bytes);
    repo.db.prepare("UPDATE image_assets SET content_hash=?,bytes=? WHERE id=?").run(await hashFile(original_path), bytes.length, id);
  }
}

test("visual suggestions group tags by box, ignore unknown labels and reject malformed responses", () => {
  const dictionary = [{ id: "person" }, { id: "place" }];
  const raw = '<think>Reasoning ignored</think>\n```json\n{"regions":[{"box":[200,100,500,400],"tags":[1,98]},{"box":[200,100,500,400],"tags":["2",1]},{"box":[0,0,1001,1000],"tags":[1]},{"box":[300,800,450,900],"tags":[2]}]}\n```';
  assert.deepEqual(parseVisualTagSuggestions(raw, dictionary), [
    { x: 0.1, y: 0.2, w: 0.3, h: 0.3, optionIds: ["person", "place"] },
    { x: 0.8, y: 0.3, w: 0.1, h: 0.15, optionIds: ["place"] },
  ]);
  assert.deepEqual(parseVisualTagSuggestions('{"regions":[]}', dictionary), []);
  assert.throws(() => parseVisualTagSuggestions('{"regions":[{"box":[0,0,1000,1000],"tags":[98]}]}', dictionary), /formato/);
  assert.throws(() => parseVisualTagSuggestions("No encuentro coincidencias.", dictionary), /formato/);
});

test("rerunning suggestions matches detected boxes and preserves edits and label decisions", () => {
  const firstModel = { provider: "local" as const, model: "first" };
  const nextModel = { provider: "local" as const, model: "next" };
  const initial = mergeVisualTagReview([], [{ ...box, optionIds: ["yes", "no"] }], firstModel, false)[0];
  const edited = { ...initial, region: { ...initial.region, x: 0.45, w: 0.3 }, checked: [], applied: ["yes"] };
  const fresh = { ...box, x: 0.75, optionIds: ["new"] };
  const [matched, separate] = mergeVisualTagReview(
    [edited], [{ ...box, x: 0.11, optionIds: ["yes", "no", "new"] }, fresh], nextModel, true,
  );
  assert.deepEqual(matched, {
    ...edited, region: { ...edited.region, optionIds: ["yes", "no", "new"] }, checked: ["new"], newTags: ["new"],
  });
  assert.notEqual(separate.id, initial.id);
  assert.deepEqual(separate.region, fresh);
  assert.deepEqual(separate.choice, nextModel);
  assert.deepEqual(separate.newTags, ["new"]);
  assert.deepEqual(mergeVisualTagReview([matched, separate], [], nextModel, true), [
    { ...matched, newTags: [] }, { ...separate, newTags: [] },
  ]);
});

test("only accepted AI suggestions are saved, in their original dictionary and image view", () =>
  withPhotos(({ repo, tags, db, rows, assets }) => {
    const theme = repo.detail(db).columns.find((c) => c.name === "Tema")!;
    const first = theme.options[0].id;
    const second = theme.options[1].id;
    const assetId = assets[0];
    tags.setDictionary(db, theme.id);
    const { imageVersion } = tags.suggestionTarget(assetId, theme.id);
    const input = { assetId, dictionaryId: theme.id, imageVersion, choice: { provider: "local" as const, model: "fixture" } };
    assert.deepEqual(tags.list(assetId), []);
    assert.throws(() => tags.applySuggestions({
      ...input, regions: [{ ...box, optionIds: [first] }, { ...box, x: 0.6, optionIds: ["not-in-the-dictionary"] }],
    }), /diccionario ha cambiado/);
    assert.deepEqual(tags.list(assetId), []);
    assert.equal(tags.applySuggestions({ ...input, regions: [{ ...box, optionIds: [first] }] }), 1);
    const region = tags.list(assetId)[0];
    assert.equal(region.source, "ai");
    assert.equal(region.state, "validated");
    assert.equal(region.model, "Local · fixture");
    assert.equal(tags.applySuggestions({ ...input, regions: [{ ...box, optionIds: [first, second] }] }), 1);
    assert.equal(tags.applySuggestions({ ...input, regions: [{ ...box, optionIds: [first, second] }] }), 0);
    const saved = tags.list(assetId);
    assert.deepEqual(saved.map((r) => r.id), [region.id]);
    assert.equal(saved[0].optionIds.length, 2);
    assert.deepEqual(Object.values(repo.getRow(rows[0]).visualTags!.counts), [1, 1]);
    tags.setDictionary(db, null);
    assert.throws(() => tags.applySuggestions({ ...input, regions: [{ ...box, optionIds: [first] }] }), /diccionario activo/);
    tags.setDictionary(db, theme.id);
    repo.saveOptions(theme.id, theme.options.map((o) => ({ ...o, label: o.id === first ? "Renombrada" : o.label })));
    assert.throws(() => tags.applySuggestions({ ...input, regions: [{ ...box, optionIds: [first] }] }), /Vuelve a generar/);
  }));

test("the first tag creates «Etiquetas visuales», filled with each tag's appearances", () =>
  withPhotos(({ repo, tags, db, rows, assets }) => {
    assert.equal(tags.column(db), null, "no property before the first tag");
    const first = tags.save({ assetId: assets[0], ...box, label: "Toro" });
    const column = tags.column(db)!;
    assert.equal(column.name, VISUAL_TAGS_NAME);
    assert.equal(column.config.visualTags, true);
    const toro = column.options.find((o) => o.label === "Toro")!;
    assert.equal(first.optionId, toro.id);
    assert.equal(first.source, "manual");
    assert.equal(first.state, "validated");
    // Typing an existing name (any case) reuses the tag.
    tags.save({ assetId: assets[0], x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: "toro" });
    tags.save({ assetId: assets[0], x: 0.6, y: 0.1, w: 0.1, h: 0.1, label: "Persona" });
    const row = repo.getRow(rows[0]);
    const persona = repo.column(column.id).options.find((o) => o.label === "Persona")!;
    assert.deepEqual(JSON.parse(row.cells[column.id]!), [toro.id, persona.id], "most frequent first");
    assert.deepEqual(row.visualTags, { counts: { [toro.id]: 2, [persona.id]: 1 }, review: "tagged" });
    assert.equal(exportCellText(repo.column(column.id), row), "Toro ×2, Persona");
    assert.deepEqual(exportCellValue(repo.column(column.id), row), [{ label: "Toro", count: 2 }, { label: "Persona", count: 1 }]);
    // Cells are filled from the regions, never by hand.
    assert.throws(() => repo.setCell(rows[0], column.id, JSON.stringify([persona.id])), /dibujando regiones/);
    // Moving and retagging a region.
    const moved = tags.save({ id: first.id, assetId: assets[0], x: 0.2, y: 0.2, w: 0.3, h: 0.3, optionId: persona.id });
    assert.equal(moved.optionId, persona.id);
    assert.ok(Math.abs(moved.x - 0.2) < 1e-9);
    assert.deepEqual(repo.getRow(rows[0]).visualTags!.counts, { [toro.id]: 1, [persona.id]: 2 });
    assert.throws(() => tags.save({ assetId: assets[0], x: 0.1, y: 0.1, w: 0.001, h: 0.001, label: "Toro" }), /pequeña/);
  }));

test("several tags share one region, survive a move and count once per tag", () =>
  withPhotos(({ repo, tags, db, rows, assets }) => {
    const region = tags.save({
      assetId: assets[0], ...box, tags: [{ label: "Persona" }, { label: "Automóvil" }, { label: "persona" }],
    });
    const column = tags.column(db)!;
    const [person, car] = column.options;
    assert.deepEqual(region.optionIds, [person.id, car.id]);
    assert.deepEqual(tags.list(assets[0]).map((r) => [r.id, r.optionIds]), [[region.id, region.optionIds]]);
    assert.deepEqual(repo.getRow(rows[0]).visualTags?.counts, { [person.id]: 1, [car.id]: 1 });
    assert.deepEqual(tags.summary(db).regions, [{ source: "manual", state: "validated", n: 1 }]);
    const stats = new Statistics(repo).compute(db, [rows[0]], { kind: "frequency", columnId: column.id, count: "appearances" });
    assert.equal(stats.kind, "frequency");
    if (stats.kind === "frequency") assert.deepEqual(stats.visual?.appearances, { Persona: 1, Automóvil: 1 });

    const moved = tags.save({ id: region.id, assetId: assets[0], ...box, x: 0.3 });
    assert.ok(Math.abs(moved.x - 0.3) < 1e-9);
    assert.deepEqual(moved.optionIds, region.optionIds);
    assert.throws(() => tags.save({
      id: region.id, assetId: assets[0], ...box, tags: [{ label: "Temporal" }, { optionId: "elsewhere" }],
    }), /no pertenece/);
    assert.equal(tags.column(db)!.options.length, 2);
    assert.deepEqual(tags.list(assets[0])[0].optionIds, region.optionIds);

    const edited = tags.save({ id: region.id, assetId: assets[0], ...box, x: moved.x, tags: [{ optionId: car.id }, { label: "Calle" }] });
    const street = tags.column(db)!.options.find((o) => o.label === "Calle")!;
    assert.deepEqual(edited.optionIds, [car.id, street.id]);
    repo.saveOptions(column.id, [person, street], { dropFromCells: true });
    assert.deepEqual(tags.list(assets[0]).map((r) => [r.id, r.optionIds]), [[region.id, [street.id]]]);
    assert.deepEqual(repo.getRow(rows[0]).visualTags?.counts, { [street.id]: 1 });
    repo.saveOptions(column.id, [person], { dropFromCells: true });
    assert.deepEqual(tags.list(assets[0]), []);
    assert.equal(repo.getRow(rows[0]).visualTags?.review, "empty");
  }));

test("review: untouched, reviewed with nothing, tagged; filters tell them apart", () =>
  withPhotos(({ repo, tags, db, rows, assets }) => {
    const region = tags.save({ assetId: assets[0], ...box, label: "Toro" });
    tags.setReviewed(assets[1], true);
    const review = (i: number) => repo.getRow(rows[i]).visualTags!.review;
    assert.deepEqual([review(0), review(1), review(2)], ["tagged", "empty", "unreviewed"]);
    const column = tags.column(db)!;
    assert.ok(filterOperators(column).includes("visual_unreviewed"));
    const titles = (op: "visual_unreviewed" | "visual_reviewed_empty") =>
      repo.literal({ databaseIds: [db], filters: [{ columnId: column.id, op, value: "" }], limit: 10 }).rows.map((r) => r.title);
    assert.deepEqual(titles("visual_reviewed_empty"), ["Dehesa"]);
    assert.deepEqual(titles("visual_unreviewed"), ["Puerto"]);
    // Deleting the only region leaves a reviewed image with nothing; unreviewing it, untouched.
    tags.delete(region.id);
    assert.equal(review(0), "empty");
    tags.setReviewed(assets[0], false);
    assert.equal(review(0), "unreviewed");
  }));

test("pending status and undo are per photograph and dictionary", () =>
  withPhotos(({ repo, tags, db, rows, assets, root }) => {
    const theme = repo.detail(db).columns.find((column) => column.name === "Tema")!;
    const [image, reviewed, untouched] = assets;
    const second = "second-photo";
    repo.db.prepare("INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(second, db, rows[0], "img", "second.jpg", path.join(root, "second.jpg"), 0, "second-hash", 10, 800, 600, "{}", null, 1, "x");
    tags.setDictionary(db, theme.id);
    const [one, two] = theme.options;
    const pending = () => tags.pendingImages(db, theme.id, rows.slice(0, 2)).sort();
    const original = tags.save({ assetId: image, ...box, tags: [{ optionId: one.id }, { optionId: two.id }] });
    tags.setReviewed(reviewed, true);
    assert.deepEqual(pending(), [second]);
    assert.deepEqual(tags.pendingImages(db, theme.id, rows.slice(2)), [untouched]);
    assert.deepEqual(tags.pendingImages(db, null, rows).sort(), [...assets, second].sort());

    tags.save({ id: original.id, assetId: image, ...box, x: 0.4 });
    tags.delete(original.id);
    assert.deepEqual(pending(), [second], "deleting a region leaves its photo reviewed");
    assert.equal(tags.selection(image).canUndo, true);
    assert.equal(tags.undo(image, null), null);
    assert.deepEqual(tags.undo(image, theme.id), { kind: "region" });
    assert.equal(tags.list(image)[0].x, 0.4);
    assert.deepEqual(tags.undo(image, theme.id), { kind: "region" });
    assert.deepEqual(tags.list(image), [original]);
    assert.deepEqual(tags.undo(reviewed, theme.id), { kind: "review" });
    assert.deepEqual(pending(), [reviewed, second]);
    assert.deepEqual(tags.undo(image, theme.id), { kind: "region" });
    assert.equal(tags.selection(image).canUndo, false);
    assert.deepEqual(pending(), [image, reviewed, second]);
    assert.equal(repo.getRow(rows[0]).visualTags?.review, "unreviewed");
  }));

test("undoing AI suggestions restores the photograph in one step", () =>
  withPhotos(({ repo, tags, db, assets }) => {
    const theme = repo.detail(db).columns.find((column) => column.name === "Tema")!;
    const assetId = assets[0];
    tags.setDictionary(db, theme.id);
    const { imageVersion } = tags.suggestionTarget(assetId, theme.id);
    const [one, two] = theme.options;
    assert.equal(tags.applySuggestions({
      assetId, dictionaryId: theme.id, imageVersion, choice: { provider: "local", model: "first" },
      regions: [
        { ...box, optionIds: [one.id] },
        { ...box, x: 0.5, optionIds: [two.id], choice: { provider: "local", model: "second" } },
      ],
    }), 2);
    assert.deepEqual(tags.list(assetId).map((region) => region.model).sort(), ["Local · first", "Local · second"]);
    assert.equal(tags.reviewed(assetId), true);
    assert.deepEqual(tags.undo(assetId, theme.id), { kind: "suggestions" });
    assert.deepEqual(tags.list(assetId), []);
    assert.equal(tags.reviewed(assetId), false);
    assert.equal(tags.selection(assetId).canUndo, false);
  }));

test("a linked dictionary's terms become tags with their colour and icon", () =>
  withPhotos(({ repo, tags, db, assets }) => {
    const theme = repo.detail(db).columns.find((c) => c.name === "Tema")!;
    repo.updateColumn(theme.id, undefined, { ...theme.config, optionIcons: { [theme.options[0].id]: "Sun:orange" } });
    const fiesta = repo.column(theme.id).options.find((o) => o.label === "Fiesta")!;
    tags.setDictionary(db, theme.id);
    assert.equal(tags.dictionary(db)?.id, theme.id, "linking it creates the property");
    const region = tags.save({ assetId: assets[0], ...box, optionId: fiesta.id });
    const column = tags.column(db)!;
    const tag = column.options.find((o) => o.id === region.optionId)!;
    assert.equal(tag.label, "Fiesta");
    assert.equal(tag.color, fiesta.color);
    assert.equal(column.config.optionIcons?.[tag.id], fiesta.id === theme.options[0].id ? "Sun:orange" : undefined);
    // Picked again, the same tag; another database's option is refused.
    assert.equal(tags.save({ assetId: assets[1], ...box, optionId: fiesta.id }).optionId, tag.id);
    assert.throws(() => tags.save({ assetId: assets[1], ...box, optionId: "elsewhere" }), /no pertenece/);
    assert.throws(() => tags.setDictionary(db, column.id), /selección/);
  }));

test("switching dictionaries keeps each one's regions, applied options and review independent", () =>
  withPhotos(({ repo, tags, db, rows, assets }) => {
    const theme = repo.detail(db).columns.find((c) => c.name === "Tema")!;
    const kind = repo.addColumn(db, "Tipo", "select");
    const [image, empty] = assets;
    const standalone = tags.save({ assetId: image, ...box, label: "Fiesta" });
    tags.setDictionary(db, theme.id);
    assert.deepEqual(tags.selection(image).optionIds, []);
    assert.deepEqual(tags.list(image), []);
    assert.equal(tags.reviewed(image), false);
    const fiesta = theme.options.find((o) => o.label === "Fiesta")!;
    const byTheme = tags.save({ assetId: image, ...box, optionId: fiesta.id });
    assert.notEqual(byTheme.optionId, standalone.optionId);
    tags.setReviewed(empty, true);

    tags.setDictionary(db, kind.id);
    assert.deepEqual(tags.list(image), []);
    assert.equal(tags.reviewed(empty), false);
    assert.throws(() => tags.save({ assetId: image, ...box, optionId: byTheme.optionId }), /no pertenece/);
    assert.throws(() => tags.save({ id: byTheme.id, assetId: image, ...box, dictionaryId: kind.id, label: "Fiesta" }), /región ya no existe/);
    const byKind = tags.save({ assetId: image, ...box, label: "Fiesta" });
    const column = tags.column(db)!;
    // An edit to one of the two copies keeps the other option and its scope.
    repo.saveOptions(column.id, column.options.map((o) => ({ ...o, label: o.id === byKind.optionId ? "Fiesta local" : o.label })));
    assert.deepEqual(tags.selection(image).optionIds, [byKind.optionId]);
    assert.deepEqual(tags.list(image).map((r) => r.id), [byKind.id]);
    tags.delete(byKind.id);
    assert.deepEqual(tags.selection(image).optionIds, [byKind.optionId], "options are reusable after deleting their regions");
    tags.setReviewed(image, false);

    tags.setDictionary(db, theme.id);
    assert.deepEqual(tags.selection(image).optionIds, [byTheme.optionId]);
    assert.deepEqual(tags.list(image).map((r) => r.id), [byTheme.id]);
    assert.equal(tags.reviewed(image), true);
    assert.equal(tags.reviewed(empty), true);
    tags.setDictionary(db, null);
    assert.deepEqual(tags.list(image).map((r) => r.id), [standalone.id]);
    assert.equal(tags.reviewed(empty), false);
    assert.deepEqual(repo.getRow(rows[0]).visualTags?.counts, { [standalone.optionId]: 1, [byTheme.optionId]: 1 });
    assert.equal(tags.summary(db).reviewed, 2, "the database summary counts each image once");
  }));

test("a legacy collection and its backup keep tags and review under the last selected dictionary", () =>
  withPhotos(async ({ repo, tags, db, assets, root }) => {
    const theme = repo.detail(db).columns.find((c) => c.name === "Tema")!;
    tags.setDictionary(db, theme.id);
    const region = tags.save({ assetId: assets[0], ...box, label: "Fiesta" });
    tags.setReviewed(assets[1], true);
    // Recreate the schema used before regions and reviews belonged to a criterion.
    repo.db.exec(`
      ALTER TABLE image_tags ADD COLUMN option_id TEXT NOT NULL DEFAULT '';
      UPDATE image_tags SET option_id=(SELECT option_id FROM image_tag_options WHERE region_id=image_tags.id);
      DROP TABLE image_tag_options;
      CREATE INDEX image_tags_option ON image_tags(option_id);
      ALTER TABLE db_select_options DROP COLUMN visual_tag_dictionary_id;
      ALTER TABLE image_tag_reviews RENAME TO scoped_reviews;
      CREATE TABLE image_tag_reviews(asset_id TEXT PRIMARY KEY REFERENCES image_assets(id) ON DELETE CASCADE,reviewed_at TEXT NOT NULL);
      INSERT INTO image_tag_reviews SELECT asset_id,reviewed_at FROM scoped_reviews;
      DROP TABLE scoped_reviews;
    `);
    await writePhotoOriginals(repo, assets);
    const backup = path.join(root, "legacy.imago");
    await writeBackup(repo, backup);
    const restored = new Repository(path.join(root, "restored"));
    try {
      assert.equal((await verifyBackup(restored, backup)).files, assets.length);
      await restoreBackup(restored, backup);
      const restoredTags = new VisualTags(restored);
      assert.equal(restoredTags.dictionary(db)?.id, theme.id);
      assert.deepEqual(restoredTags.list(assets[0]), [region]);
      assert.equal(restoredTags.reviewed(assets[1]), true);
    } finally {
      restored.close();
    }
    const migrated = new Repository(root);
    try {
      const oldTags = new VisualTags(migrated);
      assert.equal(oldTags.dictionary(db)?.id, theme.id);
      assert.deepEqual(oldTags.selection(assets[0]).optionIds, [region.optionId]);
      assert.deepEqual(oldTags.list(assets[0]).map((r) => r.id), [region.id]);
      assert.deepEqual(oldTags.list(assets[0])[0].optionIds, [region.optionId]);
      assert.equal(oldTags.reviewed(assets[1]), true);
      oldTags.setDictionary(db, null);
      assert.deepEqual(oldTags.list(assets[0]), []);
      assert.equal(oldTags.reviewed(assets[1]), false);
      oldTags.setDictionary(db, theme.id);
      assert.deepEqual(oldTags.list(assets[0]).map((r) => r.id), [region.id]);
    } finally {
      migrated.close();
    }
  }));

test("renaming a tag shows everywhere and deleting it recalculates once", (t) =>
  withPhotos(({ repo, tags, db, rows, assets }) => {
    tags.save({ assetId: assets[0], ...box, label: "Toro" });
    tags.save({ assetId: assets[1], ...box, label: "Toro" });
    tags.save({ assetId: assets[1], x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: "Carro" });
    const column = tags.column(db)!;
    const toro = column.options.find((o) => o.label === "Toro")!;
    repo.saveOptions(column.id, column.options.map((o) => ({ id: o.id, label: o.id === toro.id ? "Toro bravo" : o.label, color: o.color })));
    assert.equal(exportCellText(repo.column(column.id), repo.getRow(rows[1])), "Toro bravo, Carro");
    const formula = repo.addColumn(db, "Temas", "formula", {
      formula: { kind: "concat", parts: [{ kind: "text", value: "Temas: " }, { kind: "column", columnId: column.id }] },
    });
    assert.equal(repo.getRow(rows[1]).cells[formula.id], "Temas: Toro bravo, Carro");
    assert.equal(repo.literal({ query: "bravo" }).total, 2);
    const recompute = t.mock.method(repo, "recompute");
    // The regions are authoritative even if a record's cached cell is missing.
    repo.rawCell(rows[0], column.id, null, "multi_select");
    repo.db.prepare("UPDATE db_rows SET updated_at='2026-01-01' WHERE id=?").run(rows[2]);
    repo.saveOptions(
      column.id,
      repo.column(column.id).options.filter((o) => o.id !== toro.id).map((o) => ({ id: o.id, label: o.label, color: o.color })),
      { dropFromCells: true },
    );
    assert.equal(recompute.mock.callCount(), 1);
    assert.equal(tags.list(assets[0]).length, 0);
    assert.equal(tags.list(assets[1]).length, 1);
    assert.equal(repo.getRow(rows[0]).cells[column.id] ?? null, null);
    assert.equal(repo.getRow(rows[1]).cells[formula.id], "Temas: Carro");
    assert.equal(repo.getRow(rows[2]).updatedAt, "2026-01-01");
    assert.equal(repo.literal({ query: "bravo" }).total, 0);
    assert.equal(repo.literal({ query: "carro" }).total, 1);
  }));

test("statistics count photographs or appearances, over the records a filter keeps (a book's bulls)", () =>
  withPhotos(({ repo, tags, db, rows, assets }) => {
    // The photographs are linked to the books that print them.
    const books = repo.create("Libros", true, undefined, "sources");
    const titleOf = books.columns.find((c) => c.type === "title")!.id;
    const book = (name: string) => {
      const r = repo.createRow(books.database.id);
      repo.setCell(r.id, titleOf, name, false);
      return r.id;
    };
    const [a, b] = [book("Guía A"), book("Guía B")];
    const rel = repo.addColumn(db, "Publicada en", "relation", { relationTargetDatabaseId: books.database.id });
    repo.setCell(rows[0], rel.id, JSON.stringify([a]));
    repo.setCell(rows[1], rel.id, JSON.stringify([b]));
    repo.setCell(rows[2], rel.id, JSON.stringify([a]));
    for (const at of [0.1, 0.4, 0.7]) tags.save({ assetId: assets[0], x: at, y: 0.1, w: 0.1, h: 0.1, label: "Toro" });
    tags.save({ assetId: assets[1], ...box, label: "Toro" });
    tags.save({ assetId: assets[2], ...box, label: "Barco" });
    const column = tags.column(db)!;
    const stats = new Statistics(repo);
    const ids = (filters: Parameters<Repository["literal"]>[0]["filters"] = []) =>
      repo.literal({ databaseIds: [db], filters, limit: 100 }).rows.map((r) => r.id);
    const records = stats.compute(db, ids(), { kind: "frequency", columnId: column.id });
    assert.equal(records.kind, "frequency");
    if (records.kind !== "frequency") return;
    assert.deepEqual(records.categories.map((c) => [c.label, c.count]), [["Toro", 2], ["Barco", 1]]);
    assert.deepEqual(records.visual!.appearances, { Toro: 4, Barco: 1 });
    assert.deepEqual(records.visual!.records, { Toro: 2, Barco: 1 });
    const appearances = stats.compute(db, ids(), { kind: "frequency", columnId: column.id, count: "appearances" });
    if (appearances.kind !== "frequency") return;
    assert.deepEqual(appearances.categories.map((c) => [c.label, c.count]), [["Toro", 4], ["Barco", 1]]);
    // Only the photographs printed in «Guía A»: its bulls are three, in one photograph.
    const inA = ids([{ columnId: rel.id, op: "any", value: [a] }]);
    const bulls = stats.compute(db, inA, { kind: "frequency", columnId: column.id, count: "appearances" });
    if (bulls.kind !== "frequency") return;
    assert.equal(bulls.visual!.appearances.Toro, 3);
    assert.equal(bulls.visual!.records.Toro, 1);
    // Cross with another property, by records.
    const cross = stats.compute(db, ids(), { kind: "crosstab", rowColumnId: column.id, colColumnId: rel.id });
    assert.equal(cross.kind, "crosstab");
  }));

test("the methodology and backups keep visual tags, annotations and heritage with their positions", () =>
  withPhotos(async ({ repo, tags, db, rows, assets, root }) => {
    await writePhotoOriginals(repo, assets);
    tags.save({ assetId: assets[0], ...box, label: "Toro" });
    tags.save({ assetId: assets[0], x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: "Toro" });
    tags.setReviewed(assets[1], true);
    const data = collectMethodology({ repo, contract: "x", dimensions: 768 }, { databaseIds: [db] });
    assert.equal(data.visualTags.length, 1);
    assert.deepEqual(
      data.visualTags[0].tags.map((t) => [t.label, t.appearances, t.records]),
      [["Toro", 2, 1]],
    );
    assert.equal(data.visualTags[0].reviewed, 2);
    assert.equal(data.visualTags[0].reviewedEmpty, 1);
    const assetId = assets[0];
    const standalone = tags.list(assetId);
    const theme = repo.detail(db).columns.find((c) => c.name === "Tema")!;
    const fiesta = theme.options.find((o) => o.label === "Fiesta")!;
    const campo = theme.options.find((o) => o.label === "Campo")!;
    repo.saveOptions(theme.id, theme.options.map((o) => ({ ...o, color: o.id === fiesta.id ? "#c2410c" : "#1d4ed8" })));
    repo.updateColumn(theme.id, undefined, { ...theme.config, optionIcons: { [fiesta.id]: "Sun:orange" } });
    const type = repo.addColumn(db, "Tipo", "select");
    tags.setDictionary(db, type.id);
    const other = tags.save({ assetId, x: 0.55, y: 0.24, w: 0.15, h: 0.21, label: "Urbana" });
    tags.setDictionary(db, theme.id);
    const { imageVersion } = tags.suggestionTarget(assetId, theme.id);
    tags.applySuggestions({
      assetId, dictionaryId: theme.id, imageVersion, choice: { provider: "local", model: "fixture" },
      regions: [{ ...box, optionIds: [fiesta.id, campo.id] }],
    });
    const themed = tags.list(assetId)[0];
    const visualColumn = tags.column(db)!;

    const heritage = new Heritage(repo);
    const property = repo.addColumn(db, "Patrimonio", "multi_select", { heritage: true });
    const bridge = heritage.addElement(property.id, "Puente de la Plaza", {
      source: "wikidata", id: "Q321", label: "Puente de la Plaza", description: null,
      uri: "https://www.wikidata.org/wiki/Q321", kind: "place", coordinates: { latitude: 40.42, longitude: -3.71 },
    });
    const arch = heritage.addElement(property.id, "Arco del puente", null);
    heritage.save(property.id, [{ ...emptyElement(arch), parentId: bridge }]);
    const annotations = new Annotations(repo);
    const note = annotations.save({ assetId, ...box, note: "Detalle del pretil", tags: ["piedra"], color: "#f59e0b" });
    const point = annotations.save({ assetId, x: 0.31, y: 0.42, w: 0, h: 0, note: "", tags: [], kind: "point", optionId: bridge });
    const rect = annotations.save({ assetId, x: 0.45, y: 0.2, w: 0.18, h: 0.22, note: "", tags: [], kind: "rect", optionId: arch });
    repo.rotateImage(assetId, "right");
    repo.cropImage(assetId, { x: 0.08, y: 0.05, w: 0.85, h: 0.85 }, [800, 600]);
    const shownTags = tags.list(assetId);
    const shownMarks = annotations.list({ assetId });
    assert.equal(shownTags.length, 1);
    assert.equal(shownMarks.length, 3);
    assert.notEqual(shownTags[0].x, themed.x);

    const file = path.join(root, "copia.imago");
    await writeBackup(repo, file);
    await Promise.all(assets.map((id) => fs.rm(repo.asset(id).original_path)));
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "imago-vtags-restored-"));
    const restored = new Repository(target);
    try {
      assert.equal((await verifyBackup(restored, file)).files, assets.length);
      await restoreBackup(restored, file);
      const restoredTags = new VisualTags(restored);
      const restoredAnnotations = new Annotations(restored);
      const restoredHeritage = new Heritage(restored).elements(property.id);
      assert.deepEqual(restored.asset(assetId).metadata_json, repo.asset(assetId).metadata_json);
      assert.equal(await hashFile(restored.asset(assetId).original_path), repo.asset(assetId).content_hash);
      assert.equal(restoredTags.dictionary(db)?.id, theme.id);
      assert.deepEqual(new Set(restoredTags.selection(assetId).optionIds), new Set(themed.optionIds));
      assert.deepEqual(restoredTags.column(db)?.options, visualColumn.options);
      assert.deepEqual(restoredTags.column(db)?.config, visualColumn.config);
      assert.deepEqual(restoredTags.list(assetId), shownTags);
      assert.deepEqual(restoredAnnotations.list({ assetId }), shownMarks);
      assert.deepEqual(restoredHeritage, heritage.elements(property.id));
      assert.deepEqual(resolvedPosition(arch, restoredHeritage), { latitude: 40.42, longitude: -3.71, inherited: true, from: bridge });
      assert.deepEqual(new Authorities(restored).links(property.id), new Authorities(repo).links(property.id));
      assert.equal(restored.getRow(rows[0]).cells[property.id], repo.getRow(rows[0]).cells[property.id]);
      assert.equal(restoredTags.reviewed(assets[1]), false);

      // Removing the restored edits reveals the same original positions.
      restored.cropImage(assetId, null, [800, 600]);
      restored.rotateImage(assetId, "left");
      assert.deepEqual(restoredTags.list(assetId), [themed]);
      for (const mark of [note, point, rect]) assert.deepEqual(restoredAnnotations.get(mark.id), mark);
      restoredTags.setDictionary(db, type.id);
      assert.deepEqual(restoredTags.list(assetId), [other]);
      restoredTags.setDictionary(db, null);
      assert.deepEqual(restoredTags.list(assetId), standalone);
      assert.equal(restoredTags.reviewed(assets[1]), true);
    } finally {
      restored.close();
      await fs.rm(target, { recursive: true, force: true });
    }
  }));

test("verification and restore reject a backup whose visual regions have lost their tag links", () =>
  withPhotos(async ({ repo, tags, assets, root }) => {
    await writePhotoOriginals(repo, assets);
    const region = tags.save({ assetId: assets[0], ...box, label: "Toro" });
    repo.db.prepare("DELETE FROM image_tag_options WHERE region_id=?").run(region.id);
    const backup = path.join(root, "missing-tag-links.imago");
    await writeBackup(repo, backup);
    const restored = new Repository(path.join(root, "restored-invalid"));
    try {
      await assert.rejects(verifyBackup(restored, backup), /sin sus etiquetas/);
      await assert.rejects(restoreBackup(restored, backup), /sin sus etiquetas/);
      assert.deepEqual(restored.list(), []);
      assert.deepEqual(await fs.readdir(path.join(restored.root, "originals")), []);
    } finally {
      restored.close();
    }
  }));

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
import { Statistics } from "../electron/db/statistics";
import { collectMethodology } from "../electron/export/methodology";
import { writeBackup, restoreBackup } from "../electron/export/backup";
import { hashFile } from "../electron/import/images";
import sharp from "sharp";
import { exportCellText, exportCellValue } from "../shared/databaseExport";
import { VISUAL_TAGS_NAME } from "../shared/visualTags";
import { filterOperators } from "../shared/viewCriteria";

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

test("the methodology report and backups keep the tagging", () =>
  withPhotos(async ({ repo, tags, db, assets, root }) => {
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
    // Backups carry the image files: real ones, with their hashes.
    for (const id of assets) {
      const a = repo.asset(id) as { original_path: string };
      const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#888" } }).jpeg().toBuffer();
      await fs.writeFile(a.original_path, bytes);
      repo.db.prepare("UPDATE image_assets SET content_hash=?,bytes=? WHERE id=?").run(await hashFile(a.original_path), bytes.length, id);
    }
    const file = path.join(root, "copia.imago");
    await writeBackup(repo, file);
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "imago-vtags-restored-"));
    const restored = new Repository(target);
    try {
      await restoreBackup(restored, file);
      assert.equal((restored.db.prepare("SELECT count(*) n FROM image_tags").get() as { n: number }).n, 2);
      assert.equal((restored.db.prepare("SELECT count(*) n FROM image_tag_reviews").get() as { n: number }).n, 2);
    } finally {
      restored.close();
      await fs.rm(target, { recursive: true, force: true });
    }
  }));

// What each link between two records records (page, figure, caption, note):
// seen from both sides, kept when the relation is edited, undone and redone,
// brought into a rollup, exported, cited, searched and backed up.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import {
  DATABASE_TEMPLATES,
  LINK_ROLLUP_TARGETS,
  cleanLinkDetails,
  linkPlace,
  relationHasPlace,
} from "../shared/databases";
import { exportCellText, exportCellValue, withLinkNoteColumns } from "../shared/databaseExport";
import { citationTemplate, renderCitation } from "../shared/citation";
import { writeBackup, restoreBackup } from "../electron/export/backup";
import { schemas } from "../shared/validation";

async function withRepo(run: (repo: Repository, root: string) => Promise<void> | void) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-links-")),
    repo = new Repository(root);
  try {
    await run(repo, root);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}
const ids = (repo: Repository, db: string) =>
  (repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position").all(db) as { id: string }[]).map((r) => r.id);

/** Photographs F1–F3 and books L1–L2 (a Sources database), linked both ways. */
function photosAndBooks(repo: Repository) {
  const photos = repo.importCsv("Fotos", ["Título", "Autor"], ["title", "text"], [["F1", "Laurent"], ["F2", "Clifford"], ["F3", ""]]);
  const books = repo.create("Libros", true, undefined, "sources");
  const title = books.columns.find((c) => c.type === "title")!.id,
    year = books.columns.find((c) => c.name === "Año")!.id;
  for (const [name, y] of [["Guía de Toledo", "1931"], ["España pintoresca", "1956"]]) {
    const row = repo.createRow(books.database.id);
    repo.setCell(row.id, title, name, false);
    repo.setCell(row.id, year, y, false);
  }
  const rel = repo.addColumn(photos.database.id, "Publicada en", "relation", {
    relationTargetDatabaseId: books.database.id,
    relationInverseName: "Fotografías",
  });
  const twin = repo.detail(books.database.id).columns.find((c) => c.name === "Fotografías")!;
  return { photos: photos.database.id, books: books.database.id, rel, twin, f: ids(repo, photos.database.id), l: ids(repo, books.database.id) };
}

test("details are cleaned, placed and only where they apply", () => {
  assert.equal(cleanLinkDetails({ page: "  ", note: "" }), null);
  assert.deepEqual(cleanLinkDetails({ page: " 12 ", figure: "3", caption: "Vista  general" }), { page: "12", figure: "3", caption: "Vista general" });
  assert.equal(linkPlace({ page: "12", figure: "3" }), "p. 12 · fig. 3");
  assert.equal(linkPlace({ caption: "x" }), "");
  const plain = { config: {} };
  assert.equal(relationHasPlace(plain, "images", "sources"), true, "to a Sources database");
  assert.equal(relationHasPlace(plain, "sources", "images"), true, "from a Sources database");
  assert.equal(relationHasPlace(plain, "images", "people"), false);
  assert.equal(relationHasPlace({ config: { relationLinkDetails: true } }, "images", "people"), true, "turned on");
  assert.equal(relationHasPlace({ config: { relationLinkDetails: false } }, "images", "sources"), false, "turned off");
  assert.ok(schemas.setLinkDetails.safeParse({ rowId: "a", columnId: "b", targetId: "c", details: { page: "1" } }).success);
  assert.equal(schemas.setLinkDetails.safeParse({ rowId: "a", columnId: "b", targetId: "c", details: { other: "1" } }).success, false);
});

test("a link's details are seen from both records and survive edits of the relation", () =>
  withRepo((repo) => {
    const { rel, twin, f, l } = photosAndBooks(repo);
    repo.setCell(f[0], rel.id, JSON.stringify([l[0], l[1]]));
    repo.setLinkDetails(f[0], rel.id, l[0], { page: "12", figure: "3", caption: "Vista desde el mirador", note: "Recortada" });
    const photo = repo.getRow(f[0]);
    assert.deepEqual(
      photo.links![rel.id].map((x) => [x.title, x.page ?? null]),
      [["Guía de Toledo", "12"], ["España pintoresca", null]],
    );
    // From the book, through the twin.
    const book = repo.getRow(l[0]).links![twin.id].find((x) => x.id === f[0])!;
    assert.equal(book.caption, "Vista desde el mirador");
    // Editing from the book's side writes the same details.
    repo.setLinkDetails(l[0], twin.id, f[0], { page: "14", figure: "3", caption: "Vista desde el mirador", note: "Recortada" });
    assert.equal(repo.linkDetails(f[0], l[0])!.page, "14");
    // Adding and reordering links keeps them.
    repo.setCell(f[0], rel.id, JSON.stringify([l[1], l[0]]));
    assert.equal(repo.getRow(f[0]).links![rel.id][1].page, "14");
    // A record that is not linked cannot be described.
    assert.throws(() => repo.setLinkDetails(f[1], rel.id, l[0], { page: "1" }), /no está enlazado/);
    // Table text and JSON.
    const columns = repo.detail(repo.getRow(f[0]).databaseId).columns,
      column = columns.find((c) => c.id === rel.id)!;
    assert.equal(exportCellText(column, repo.getRow(f[0])), "España pintoresca; Guía de Toledo (p. 14 · fig. 3)");
    assert.deepEqual((exportCellValue(column, repo.getRow(f[0])) as { title: string; page?: string }[]).map((x) => x.page ?? null), [null, "14"]);
    const table = withLinkNoteColumns(columns, [repo.getRow(f[0]), repo.getRow(f[1])]);
    const notes = table.columns.find((c) => c.name === "Publicada en · pies y notas")!;
    assert.equal(table.rows[0].cells[notes.id], "Guía de Toledo — Vista desde el mirador · Recortada");
    assert.equal(table.rows[1].cells[notes.id], null);
    // Literal search finds the caption, not the book's title.
    const found = repo.literal({ query: "mirador", limit: 10 }).rows.map((r) => r.title);
    assert.ok(found.includes("F1") && found.includes("Guía de Toledo"), "both records hold the caption");
    // Deleting the book removes its details.
    repo.deleteRows([l[0]]);
    assert.equal((repo.db.prepare("SELECT count(*) n FROM relation_details").get() as { n: number }).n, 0);
  }));

test("details are one step of the history: undo and redo", () =>
  withRepo((repo) => {
    const { rel, f, l } = photosAndBooks(repo);
    repo.setCell(f[0], rel.id, JSON.stringify([l[0]]));
    repo.setLinkDetails(f[0], rel.id, l[0], { page: "12" });
    repo.setLinkDetails(f[0], rel.id, l[0], { page: "12", caption: "Puente" });
    assert.equal(repo.historyState().undo?.kind, "link");
    repo.undo();
    assert.deepEqual(repo.linkDetails(f[0], l[0]), { page: "12" });
    repo.undo();
    assert.equal(repo.linkDetails(f[0], l[0]), null);
    repo.redo();
    repo.redo();
    assert.deepEqual(repo.linkDetails(f[0], l[0]), { page: "12", caption: "Puente" });
    // Undoing the link itself, then its details: the details come back with it.
    repo.setCell(f[0], rel.id, JSON.stringify([]));
    repo.undo();
    assert.equal(repo.getRow(f[0]).links![rel.id][0].caption, "Puente");
  }));

test("rollups show a field of each link, which can be filtered and counted", () =>
  withRepo((repo) => {
    const { photos, books, rel, twin, f, l } = photosAndBooks(repo);
    repo.setCell(f[0], rel.id, JSON.stringify([l[0], l[1]]));
    repo.setCell(f[1], rel.id, JSON.stringify([l[0]]));
    repo.setLinkDetails(f[0], rel.id, l[0], { page: "12" });
    repo.setLinkDetails(f[0], rel.id, l[1], { page: "40" });
    const pages = repo.addColumn(photos, "Página (Publicada en)", "rollup", {
      rollupRelationColumnId: rel.id,
      rollupTargetColumnId: LINK_ROLLUP_TARGETS.page,
      rollupFunction: "show",
    });
    assert.equal(repo.getRow(f[0]).cells[pages.id], "12, 40");
    assert.equal(repo.getRow(f[1]).cells[pages.id] ?? "", "");
    // Changing a detail updates the rollup on both sides.
    const onBooks = repo.addColumn(books, "Páginas", "rollup", {
      rollupRelationColumnId: twin.id,
      rollupTargetColumnId: LINK_ROLLUP_TARGETS.page,
      rollupFunction: "count_values",
    });
    assert.equal(repo.getRow(l[0]).cells[onBooks.id], "1");
    repo.setLinkDetails(f[1], rel.id, l[0], { page: "7" });
    assert.equal(repo.getRow(l[0]).cells[onBooks.id], "2");
    assert.equal(repo.getRow(f[1]).cells[pages.id], "7");
    const filtered = repo.literal({ databaseIds: [photos], filters: [{ columnId: pages.id, op: "contains", value: "40" }], limit: 10 });
    assert.deepEqual(filtered.rows.map((r) => r.title), ["F1"]);
    assert.throws(
      () => repo.addColumn(photos, "X", "rollup", { rollupRelationColumnId: rel.id, rollupTargetColumnId: LINK_ROLLUP_TARGETS.page, rollupFunction: "sum" }),
      /no se aplica/,
    );
  }));

test("linked records carry each link's details and whether they record a place", () =>
  withRepo((repo) => {
    const { rel, f, l } = photosAndBooks(repo);
    repo.setCell(f[0], rel.id, JSON.stringify([l[0]]));
    repo.setLinkDetails(f[0], rel.id, l[0], { page: "12" });
    const [group] = repo.linkedRecords(l[0]);
    assert.equal(group.place, true);
    assert.deepEqual(group.details[f[0]], { page: "12" });
    // Turned off for the pair.
    repo.setRelationPlace(rel.id, false);
    assert.equal(repo.linkedRecords(l[0])[0].place, false);
    assert.equal(repo.relationPlace(repo.column(rel.id)), false);
  }));

test("citations include the works reproducing the image, with page and figure", () =>
  withRepo((repo) => {
    const { photos, rel, f, l } = photosAndBooks(repo);
    repo.setCell(f[0], rel.id, JSON.stringify([l[0]]));
    repo.setLinkDetails(f[0], rel.id, l[0], { page: "12", figure: "3" });
    const columns = repo.detail(photos).columns;
    const template = citationTemplate(columns);
    assert.match(template, /\{Publicada en\}/);
    assert.equal(renderCitation(template, columns, repo.getRow(f[0])), "Laurent, «F1», Guía de Toledo (p. 12 · fig. 3).");
  }));

test("backups keep the details of each link", () =>
  withRepo(async (repo, root) => {
    const { rel, f, l } = photosAndBooks(repo);
    repo.setCell(f[0], rel.id, JSON.stringify([l[0]]));
    repo.setLinkDetails(f[0], rel.id, l[0], { page: "12", caption: "Puente" });
    const file = path.join(root, "copia.imago");
    await writeBackup(repo, file);
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "imago-links-restored-"));
    const restored = new Repository(target);
    try {
      await restoreBackup(restored, file);
      assert.deepEqual(restored.linkDetails(f[0], l[0]), { page: "12", caption: "Puente" });
      assert.equal(restored.getRow(f[0]).links![rel.id][0].caption, "Puente");
    } finally {
      restored.close();
      await fs.rm(target, { recursive: true, force: true });
    }
  }));

test("works, people and events start with their properties", () =>
  withRepo((repo) => {
    for (const kind of ["works", "people", "events"] as const) {
      const d = repo.create(kind, true, undefined, kind);
      assert.equal(d.database.kind, kind);
      assert.deepEqual(d.columns.map((c) => [c.name, c.type]), DATABASE_TEMPLATES[kind].map((p) => [p.name, p.type]));
    }
    assert.ok(schemas.createDatabase.safeParse({ name: "X", kind: "works" }).success);
  }));

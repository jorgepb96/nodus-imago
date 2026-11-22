// Database kinds, two-way relations, converting a property into a relation,
// linked records, statistics by relation and backups from before kinds.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Repository } from "../electron/db/repository";
import { Statistics } from "../electron/db/statistics";
import { SavedViews } from "../electron/db/savedViews";
import { DATABASE_TEMPLATES } from "../shared/databases";
import { buildCsvImportPlan } from "../shared/databaseCsv";

async function withRepo(run: (repo: Repository, root: string) => Promise<void> | void) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-relations-")),
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
const links = (repo: Repository, rowId: string, columnId: string) => JSON.parse(repo.getRow(rowId).cells[columnId] ?? "[]") as string[];

test("a database's kind gives its starting properties, all editable", () =>
  withRepo((repo) => {
    const sources = repo.create("Libros", true, undefined, "sources");
    assert.equal(sources.database.kind, "sources");
    assert.deepEqual(sources.columns.map((c) => [c.name, c.type]), DATABASE_TEMPLATES.sources.map((p) => [p.name, p.type]));
    assert.deepEqual(sources.columns.find((c) => c.name === "Tipo")!.options.map((o) => o.label), ["Libro", "Revista", "Álbum", "Folleto", "Documento"]);
    assert.deepEqual(repo.create("Fotos", true, undefined, "images").columns.map((c) => c.name), DATABASE_TEMPLATES.images.map((p) => p.name));
    assert.deepEqual(repo.create("Otra", true, undefined, "custom").columns.map((c) => c.type), ["title", "attachment"]);
    // Without a kind, as before: title and images.
    const plain = repo.create("Antigua");
    assert.equal(plain.database.kind ?? null, null);
    assert.deepEqual(plain.columns.map((c) => c.type), ["title", "attachment"]);
    repo.deleteColumn(sources.columns.find((c) => c.name === "Editorial")!.id);
    repo.setKind(plain.database.id, "images");
    assert.equal(repo.detail(plain.database.id).database.kind, "images");
  }));

test("two-way relations stay in step on both sides, through undo and deletions", () =>
  withRepo((repo) => {
    const photos = repo.importCsv("Fotos", ["Título"], ["title"], [["F1"], ["F2"], ["F3"]]),
      books = repo.importCsv("Libros", ["Título"], ["title"], [["L1"], ["L2"]]);
    const [f1, f2, f3] = ids(repo, photos.database.id),
      [l1, l2] = ids(repo, books.database.id);
    const inBooks = repo.addColumn(photos.database.id, "Libros", "relation", {
      relationTargetDatabaseId: books.database.id,
      relationInverseName: "Fotografías",
    });
    const twin = repo.detail(books.database.id).columns.find((c) => c.name === "Fotografías")!;
    assert.equal(twin.type, "relation");
    assert.equal(twin.config.relationInverseColumnId, inBooks.id);
    assert.equal(repo.column(inBooks.id).config.relationInverseColumnId, twin.id);
    assert.equal(repo.column(inBooks.id).config.relationInverseName, undefined);
    // Linking from either side shows on the other.
    repo.setCell(f1, inBooks.id, JSON.stringify([l1, l2]));
    repo.setCell(f2, inBooks.id, JSON.stringify([l1]));
    assert.deepEqual(links(repo, l1, twin.id), [f1, f2]);
    assert.deepEqual(links(repo, l2, twin.id), [f1]);
    repo.setCell(l2, twin.id, JSON.stringify([f1, f3]));
    assert.deepEqual(links(repo, f3, inBooks.id), [l2]);
    repo.setCell(f1, inBooks.id, JSON.stringify([l2]));
    assert.deepEqual(links(repo, l1, twin.id), [f2]);
    // Undo takes both sides back.
    repo.undo();
    assert.deepEqual(links(repo, f1, inBooks.id), [l1, l2]);
    assert.deepEqual(links(repo, l1, twin.id).sort(), [f1, f2].sort());
    repo.redo();
    assert.deepEqual(links(repo, l1, twin.id), [f2]);
    // A record that goes leaves no link behind.
    repo.deleteRows([l2]);
    assert.deepEqual(links(repo, f1, inBooks.id), []);
    assert.deepEqual(links(repo, f3, inBooks.id), []);
    assert.equal((repo.db.prepare("SELECT count(*) n FROM db_relations WHERE target_id=?").get(l2) as { n: number }).n, 0);
    // Deleting one of the pair leaves the other as a one-way relation.
    repo.deleteColumn(twin.id);
    assert.equal(repo.column(inBooks.id).config.relationInverseColumnId, undefined);
    repo.setCell(f3, inBooks.id, JSON.stringify([l1]));
    assert.deepEqual(links(repo, f3, inBooks.id), [l1]);
  }));

test("an existing relation becomes two-way with its links, and a «one» twin replaces its link", () =>
  withRepo((repo) => {
    const photos = repo.importCsv("Fotos", ["Título"], ["title"], [["F1"], ["F2"]]),
      books = repo.importCsv("Libros", ["Título"], ["title"], [["L1"], ["L2"]]);
    const [f1, f2] = ids(repo, photos.database.id),
      [l1, l2] = ids(repo, books.database.id);
    const rel = repo.addColumn(photos.database.id, "Libro", "relation", { relationTargetDatabaseId: books.database.id });
    repo.setCell(f1, rel.id, JSON.stringify([l1]));
    repo.setCell(f2, rel.id, JSON.stringify([l1, l2]));
    const twin = repo.pairRelation(rel.id, "Fotos");
    assert.deepEqual(links(repo, l1, twin.id), [f1, f2]);
    assert.deepEqual(links(repo, l2, twin.id), [f2]);
    // Pairing twice returns the same twin.
    assert.equal(repo.pairRelation(rel.id, "Otra").id, twin.id);
    // A photo that may be in one book only: linking it elsewhere moves it.
    repo.updateColumn(twin.id, undefined, { ...repo.column(twin.id).config });
    repo.updateColumn(rel.id, undefined, { ...repo.column(rel.id).config, relationCardinality: "one" });
    repo.setCell(l2, twin.id, JSON.stringify([f2, f1]));
    assert.deepEqual(links(repo, f1, rel.id), [l2]);
    assert.ok(!links(repo, l1, twin.id).includes(f1));
    // One-way again: both stay, nothing mirrors any more.
    repo.unpairRelation(rel.id);
    repo.setCell(f2, rel.id, JSON.stringify([]));
    assert.ok(links(repo, l2, twin.id).includes(f2));
  }));

test("a relation inside one database can be two-way (part of / parts)", () =>
  withRepo((repo) => {
    const d = repo.importCsv("Fondos", ["Título"], ["title"], [["Fondo"], ["Serie A"], ["Serie B"]]);
    const [fondo, a, b] = ids(repo, d.database.id);
    const parent = repo.addColumn(d.database.id, "Parte de", "relation", { relationTargetDatabaseId: d.database.id, relationInverseName: "Partes" });
    const parts = repo.detail(d.database.id).columns.find((c) => c.name === "Partes")!;
    repo.setCell(a, parent.id, JSON.stringify([fondo]));
    repo.setCell(b, parent.id, JSON.stringify([fondo]));
    assert.deepEqual(links(repo, fondo, parts.id), [a, b]);
  }));

test("a property that names records becomes a relation: preview, missing records, kept copy and saved views", () =>
  withRepo((repo) => {
    const books = repo.importCsv("Libros", ["Título", "Código"], ["title", "text"], [["Guía ilustrada", "B-001"], ["Álbum de viaje", "B-002"], ["Duplicado", "B-003"], ["Duplicado bis", "B-003"]]);
    const photos = repo.importCsv(
      "Fotos",
      ["Título", "Libro"],
      ["title", "select"],
      [["F1", "B-001"], ["F2", "b-002 "], ["F3", "B-002"], ["F4", "B-009"], ["F5", ""], ["F6", "B-003"]],
    );
    const db = photos.database.id,
      book = photos.columns.find((c) => c.name === "Libro")!,
      code = books.columns.find((c) => c.name === "Código")!;
    const [f1, f2, f3, f4, f5, f6] = ids(repo, db),
      [l1, l2, l3] = ids(repo, books.database.id);
    const views = new SavedViews(repo);
    const second = book.options.find((o) => o.label.trim().toUpperCase() === "B-002")!.id;
    const view = views.save({
      databaseId: db,
      name: "Segundo libro",
      view: "table",
      criteria: { filters: [{ columnId: book.id, op: "any", value: [second] }], filterLogic: "and", filterGroups: [], sorts: [{ columnId: book.id, direction: "asc" }] },
    });
    // Preview: nothing changes.
    const preview = repo.convertToRelation(book.id, { targetDatabaseId: books.database.id, matchColumnId: code.id, apply: false });
    assert.deepEqual(
      { total: preview.total, linked: preview.linked, ambiguous: preview.ambiguous, unmatchedRows: preview.unmatchedRows, unmatched: preview.unmatched },
      { total: 5, linked: 4, ambiguous: 1, unmatchedRows: 1, unmatched: [{ value: "B-009", rows: 1 }] },
    );
    assert.equal(repo.column(book.id).type, "select");
    // Applying: the copy keeps the text, the missing record is created, and the relation is two-way.
    repo.convertToRelation(book.id, {
      targetDatabaseId: books.database.id,
      matchColumnId: code.id,
      createMissing: true,
      inverseName: "Fotografías",
      apply: true,
    });
    const converted = repo.column(book.id);
    assert.equal(converted.type, "relation");
    assert.deepEqual(converted.options, []);
    assert.deepEqual(links(repo, f1, book.id), [l1]);
    assert.deepEqual(links(repo, f2, book.id), [l2]);
    assert.deepEqual(links(repo, f6, book.id), [l3]);
    assert.deepEqual(links(repo, f5, book.id), []);
    const created = links(repo, f4, book.id)[0];
    assert.equal(repo.getRow(created).cells[code.id], "B-009");
    const copy = repo.detail(db).columns.find((c) => c.name === "Libro (texto original)")!;
    assert.equal(copy.type, "select");
    assert.equal(copy.options.find((o) => o.id === repo.getRow(f2).cells[copy.id])?.label.trim().toUpperCase(), "B-002");
    const twin = repo.detail(books.database.id).columns.find((c) => c.name === "Fotografías")!;
    assert.deepEqual(links(repo, l2, twin.id), [f2, f3]);
    // The saved view now filters by the record, and finds the same photographs.
    const saved = views.list(db).find((v) => v.id === view.id)!;
    assert.deepEqual(saved.criteria.filters, [{ columnId: book.id, op: "any", value: [l2] }]);
    assert.deepEqual(saved.criteria.sorts, []);
    assert.deepEqual(new Set(repo.literalIds({ databaseIds: [db], ...saved.criteria })), new Set([f2, f3]));
    assert.throws(() => repo.convertToRelation(book.id, { targetDatabaseId: books.database.id, apply: false }), /Solo se puede convertir/);
  }));

test("records list what they link to and what links to them, and statistics count relations by title", () =>
  withRepo((repo) => {
    const photos = repo.importCsv("Fotos", ["Título"], ["title"], [["F1"], ["F2"], ["F3"]]),
      books = repo.importCsv("Libros", ["Título"], ["title"], [["L1"], ["L2"]]);
    const [f1, f2, f3] = ids(repo, photos.database.id),
      [l1, l2] = ids(repo, books.database.id);
    const rel = repo.addColumn(photos.database.id, "Libro", "relation", { relationTargetDatabaseId: books.database.id });
    repo.setCell(f1, rel.id, JSON.stringify([l1]));
    repo.setCell(f2, rel.id, JSON.stringify([l1, l2]));
    repo.setCell(f3, rel.id, JSON.stringify([l1]));
    // One-way: the book still lists its photographs.
    const groups = repo.linkedRecords(l1);
    assert.deepEqual(groups.map((g) => [g.name, g.direction, g.total, g.rows.map((r) => r.title)]), [["Libro", "in", 3, ["F1", "F2", "F3"]]]);
    assert.deepEqual(repo.linkedRecords(f2).map((g) => [g.direction, g.rows.map((r) => r.title)]), [["out", ["L1", "L2"]]]);
    // Two-way: listed once, from the twin.
    const twin = repo.pairRelation(rel.id, "Fotografías");
    assert.deepEqual(repo.linkedRecords(l1).map((g) => [g.columnId, g.direction, g.total]), [[twin.id, "out", 3]]);
    const stats = new Statistics(repo);
    const result = stats.compute(photos.database.id, [f1, f2, f3], { kind: "frequency", columnId: rel.id }) as { categories: { label: string; count: number }[] };
    assert.deepEqual(result.categories.map((r) => [r.label, r.count]), [["L1", 3], ["L2", 1]]);
  }));

test("a backup made before database kinds restores", () =>
  withRepo(async (repo, root) => {
    // A snapshot whose db_databases has no kind column.
    const file = path.join(root, "old.sqlite");
    const old = new Database(file);
    old.exec("CREATE TABLE db_databases(id TEXT PRIMARY KEY,short_id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,icon TEXT,position INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
    old.prepare("INSERT INTO db_databases VALUES('d1','DB-OLD1','Vieja',NULL,0,'x','x')").run();
    const before = new Set((old.prepare("PRAGMA table_info(db_databases)").all() as { name: string }[]).map((c) => c.name));
    const shared = (repo.db.prepare("PRAGMA table_info(db_databases)").all() as { name: string }[]).map((c) => c.name).filter((n) => before.has(n));
    assert.ok(!shared.includes("kind"));
    const rows = old.prepare(`SELECT ${shared.join(",")} FROM db_databases`).all() as Record<string, unknown>[];
    repo.db.prepare(`INSERT INTO db_databases(${shared.join(",")}) VALUES(${shared.map(() => "?").join(",")})`).run(...shared.map((c) => rows[0][c]));
    assert.equal(repo.detail("d1").database.kind ?? null, null);
    old.close();
  }));

test("records that share a title stay apart in statistics, and a CSV column called «Título» names the rows", () =>
  withRepo((repo) => {
    const photos = repo.importCsv("Fotos", ["Título"], ["title"], [["F1"], ["F2"], ["F3"]]),
      books = repo.importCsv("Libros", ["Título", "Identificador"], ["title", "text"], [["Guía", "B-1"], ["Guía", "B-2"], ["Álbum", "B-3"]]);
    const [f1, f2, f3] = ids(repo, photos.database.id),
      [g1, g2, a] = ids(repo, books.database.id);
    const rel = repo.addColumn(photos.database.id, "Libro", "relation", { relationTargetDatabaseId: books.database.id });
    repo.setCell(f1, rel.id, JSON.stringify([g1]));
    repo.setCell(f2, rel.id, JSON.stringify([g2]));
    repo.setCell(f3, rel.id, JSON.stringify([a, g1]));
    const result = new Statistics(repo).compute(photos.database.id, [f1, f2, f3], { kind: "frequency", columnId: rel.id }) as {
      categories: { label: string; count: number }[];
    };
    assert.deepEqual(result.categories.map((c) => [c.label, c.count]), [["Guía (B-1)", 2], ["Álbum", 1], ["Guía (B-2)", 1]]);
    const plan = buildCsvImportPlan([["ID", "Autor", "Título"], ["B-1", "Uno", "Guía"], ["B-2", "Dos", "Álbum"]]);
    assert.deepEqual(plan.suggestedTypes, ["text", "text", "title"]);
    assert.deepEqual(buildCsvImportPlan([["Código", "Autor"], ["1", "Uno"]]).suggestedTypes[0], "title");
  }));

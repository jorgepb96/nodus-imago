// The column header menu: change type with a preview of lost values,
// duplicate a property with its values, and per-column calculations that
// follow the table's filters.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { decodeMultiSelect } from "../shared/databases";
import { calculationsFor, visibleColumns, EMPTY_PREFS } from "../src/columnPrefs";

async function withRepo(run: (repo: Repository) => void | Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-columns-")),
    repo = new Repository(root);
  try {
    await run(repo);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}
const sample = (repo: Repository) =>
  repo.importCsv(
    "Fotos",
    ["ID", "Año", "Lugar", "Temas", "Revisada"],
    ["title", "text", "text", "multi_select", "checkbox"],
    [
      ["R1", "1925", "Sevilla", "Fiestas, Calles", "sí"],
      ["R2", "c. 1930", "Granada", "Calles", "no"],
      ["R3", "1931", "Sevilla", "", "sí"],
      ["R4", "", "Córdoba", "Monumentos", ""],
    ],
  );

test("changing a type previews how many values would be lost before applying", async () =>
  withRepo((repo) => {
    const d = sample(repo),
      year = d.columns[1];
    const preview = repo.convertColumn(year.id, "number", false);
    assert.deepEqual(preview, { total: 3, lost: 1 });
    // The preview changes nothing.
    assert.equal(repo.detail(d.database.id).columns[1].type, "text");
    repo.convertColumn(year.id, "number", true);
    const after = repo.detail(d.database.id),
      rows = repo.literal({ databaseIds: [d.database.id] }).rows;
    assert.equal(after.columns[1].type, "number");
    assert.deepEqual(
      rows.map((r) => r.cells[year.id] ?? null),
      ["1925", null, "1931", null],
    );
  }));

test("text becomes options, and options keep their identity between option types", async () =>
  withRepo((repo) => {
    const d = sample(repo),
      [, , place, themes] = d.columns;
    assert.deepEqual(repo.convertColumn(place.id, "select", true), { total: 4, lost: 0 });
    const options = repo.detail(d.database.id).columns[2].options;
    assert.deepEqual(options.map((o) => o.label).sort(), ["Córdoba", "Granada", "Sevilla"]);
    // Multi-select → select keeps the first label and reports the record that had two.
    const before = repo.detail(d.database.id).columns[3].options.map((o) => o.id).sort();
    assert.deepEqual(repo.convertColumn(themes.id, "select", false), { total: 3, lost: 1 });
    repo.convertColumn(themes.id, "select", true);
    const converted = repo.detail(d.database.id).columns[3];
    assert.deepEqual(converted.options.map((o) => o.id).sort(), before);
    // And back to multi-select without losing anything.
    assert.deepEqual(repo.convertColumn(themes.id, "multi_select", true), { total: 3, lost: 0 });
    const rows = repo.literal({ databaseIds: [d.database.id] }).rows;
    assert.equal(decodeMultiSelect(rows[0].cells[themes.id] ?? null).length, 1);
  }));

test("title, files and relations cannot change type or be duplicated", async () =>
  withRepo((repo) => {
    const d = sample(repo);
    assert.throws(() => repo.convertColumn(d.columns[0].id, "text", false), /no se puede convertir/);
    assert.throws(() => repo.duplicateColumn(d.columns[0].id), /no se puede duplicar/);
  }));

test("duplicating copies options and values next to the original", async () =>
  withRepo((repo) => {
    const d = sample(repo),
      themes = d.columns[3];
    const copy = repo.duplicateColumn(themes.id, "copy");
    const after = repo.detail(d.database.id);
    assert.deepEqual(
      after.columns.map((c) => c.name),
      ["ID", "Año", "Lugar", "Temas", "Temas (copy)", "Revisada"],
    );
    const again = repo.duplicateColumn(themes.id, "copy");
    assert.equal(again.name, "Temas (copy 2)");
    const labels = (id: string) =>
      Object.fromEntries(
        repo.detail(d.database.id).columns.find((c) => c.id === id)!.options.map((o) => [o.id, o.label]),
      );
    const original = labels(themes.id),
      copied = labels(copy.id);
    assert.deepEqual(Object.values(copied).sort(), Object.values(original).sort());
    // Copied options are new options: editing one does not touch the other.
    assert.equal(Object.keys(copied).some((id) => id in original), false);
    for (const row of repo.literal({ databaseIds: [d.database.id] }).rows)
      assert.deepEqual(
        decodeMultiSelect(row.cells[copy.id] ?? null).map((id) => copied[id]),
        decodeMultiSelect(row.cells[themes.id] ?? null).map((id) => original[id]),
      );
  }));

test("column calculations follow the table's filters", async () =>
  withRepo((repo) => {
    const d = sample(repo),
      [, year, place, themes, checked] = d.columns,
      all = { databaseIds: [d.database.id] };
    repo.convertColumn(year.id, "number", true);
    assert.deepEqual(repo.columnSummary(all, year.id, "sum"), { value: "3856", records: 4 });
    assert.equal(repo.columnSummary(all, year.id, "count_empty").value, "2");
    assert.equal(repo.columnSummary(all, place.id, "count_unique").value, "3");
    assert.equal(repo.columnSummary(all, themes.id, "count_unique").value, "3");
    assert.equal(repo.columnSummary(all, checked.id, "checked").value, "2");
    assert.equal(repo.columnSummary(all, place.id, "percent_not_empty").value, "100%");
    const sevilla = {
      ...all,
      filters: [{ columnId: place.id, op: "equals" as const, value: "Sevilla" }],
    };
    assert.deepEqual(repo.columnSummary(sevilla, year.id, "average"), { value: "1928", records: 2 });
  }));

test("hidden columns never hide the title, and calculations suit the type", () => {
  const column = (id: string, type: string) =>
    ({ id, type, name: id, databaseId: "d", position: 0, config: {}, options: [] }) as never;
  const columns = [column("t", "title"), column("n", "number"), column("x", "text")];
  assert.deepEqual(
    visibleColumns(columns, { ...EMPTY_PREFS, hidden: ["t", "n"] }).map((c: { id: string }) => c.id),
    ["t", "x"],
  );
  assert.ok(calculationsFor(column("n", "number")).includes("sum"));
  assert.ok(!calculationsFor(column("x", "text")).includes("sum"));
  assert.ok(calculationsFor(column("c", "checkbox")).includes("percent_checked"));
  assert.ok(calculationsFor(column("f", "date")).includes("date_range"));
});

test("full-text index of older collections is migrated to rowid triggers and keeps working", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-fts-"));
  let repo = new Repository(root);
  try {
    const d = sample(repo);
    // The triggers older versions installed, which scanned the whole index.
    repo.db.exec(`DROP TRIGGER search_insert; DROP TRIGGER search_delete; DROP TRIGGER search_update;
      CREATE TRIGGER search_insert AFTER INSERT ON search_documents BEGIN INSERT INTO records_fts(row_id,database_id,body) VALUES(new.row_id,new.database_id,new.body); END;
      CREATE TRIGGER search_delete AFTER DELETE ON search_documents BEGIN DELETE FROM records_fts WHERE row_id=old.row_id; END;
      CREATE TRIGGER search_update AFTER UPDATE ON search_documents BEGIN DELETE FROM records_fts WHERE row_id=old.row_id; INSERT INTO records_fts(row_id,database_id,body) VALUES(new.row_id,new.database_id,new.body); END;
      DELETE FROM records_fts; INSERT INTO records_fts(row_id,database_id,body) SELECT row_id,database_id,body FROM search_documents;`);
    repo.close();
    repo = new Repository(root);
    const sql = (repo.db.prepare("SELECT sql FROM sqlite_master WHERE name='search_delete'").get() as { sql: string }).sql;
    assert.match(sql, /rowid=old\.rowid/);
    const find = (query: string) =>
      repo.literal({ databaseIds: [d.database.id], query }).rows.map((r) => r.title).sort();
    assert.deepEqual(find("Sevilla"), ["R1", "R3"]);
    const second = repo.literal({ databaseIds: [d.database.id], query: "Granada" }).rows[0];
    repo.setCell(second.id, d.columns[2].id, "Sevilla");
    assert.deepEqual(find("Sevilla"), ["R1", "R2", "R3"]);
    assert.deepEqual(find("Granada"), []);
    repo.deleteRows([second.id]);
    assert.deepEqual(find("Sevilla"), ["R1", "R3"]);
    // Index and documents stay one-to-one.
    const counts = repo.db
      .prepare("SELECT (SELECT count(*) FROM records_fts) fts, (SELECT count(*) FROM search_documents) docs")
      .get() as { fts: number; docs: number };
    assert.equal(counts.fts, counts.docs);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

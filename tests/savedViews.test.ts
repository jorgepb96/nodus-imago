// Saved views: a kind of view with its filters and sort, kept with the
// database (not copied), renamed, updated and removed with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { SavedViews } from "../electron/db/savedViews";
import { schemas } from "../shared/validation";

test("saved views keep their filters and sort, are edited and go with their database", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-views-")),
    repo = new Repository(root);
  try {
    const d = repo.create("Fotos");
    const place = repo.addColumn(d.database.id, "Lugar", "text");
    const views = new SavedViews(repo);
    const criteria = {
      filters: [{ columnId: place.id, op: "contains" as const, value: "Granada" }],
      filterLogic: "and" as const,
      filterGroups: [],
      sorts: [{ columnId: place.id, direction: "asc" as const }],
    };
    const rows = () => (repo.db.prepare("SELECT count(*) n FROM db_rows").get() as { n: number }).n;
    const before = rows();
    const a = views.save({ databaseId: d.database.id, name: "Granada", view: "map", criteria });
    const b = views.save({ databaseId: d.database.id, name: "Todo", view: "gallery", criteria: { ...criteria, filters: [], sorts: [] } });
    assert.deepEqual(views.list(d.database.id).map((v) => [v.name, v.view, v.position]), [["Granada", "map", 0], ["Todo", "gallery", 1]]);
    assert.deepEqual(views.list(d.database.id)[0].criteria, criteria);
    // Names are unique within a database, whatever the case.
    assert.throws(() => views.save({ databaseId: d.database.id, name: "granada", view: "table", criteria }), /Ya hay una vista/);
    // Editing keeps the id and changes name, kind and criteria.
    const edited = views.save({ id: a.id, databaseId: d.database.id, name: "Granada (tabla)", view: "table", criteria: { ...criteria, sorts: [] } });
    assert.equal(edited.id, a.id);
    assert.equal(edited.view, "table");
    assert.deepEqual(edited.criteria.sorts, []);
    // No record is copied.
    assert.equal(rows(), before);
    views.delete(b.id);
    assert.deepEqual(views.list(d.database.id).map((v) => v.name), ["Granada (tabla)"]);
    // They go with their database.
    repo.db.prepare("DELETE FROM db_databases WHERE id=?").run(d.database.id);
    assert.equal((repo.db.prepare("SELECT count(*) n FROM db_views").get() as { n: number }).n, 0);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a saved view is validated before it reaches the database", () => {
  const ok = schemas.savedViewSave.safeParse({ databaseId: "d", name: "Vista", view: "map", criteria: { filters: [], filterLogic: "and", filterGroups: [], sorts: [] } });
  assert.equal(ok.success, true);
  assert.equal(schemas.savedViewSave.safeParse({ databaseId: "d", name: "Vista", view: "elsewhere", criteria: { filters: [], filterLogic: "and", filterGroups: [], sorts: [] } }).success, false);
  assert.equal(schemas.savedViewSave.safeParse({ databaseId: "d", name: " ", view: "map", criteria: { filters: [], filterLogic: "and", filterGroups: [], sorts: [] } }).success, false);
});

// View tabs: their order and colour, and the data source the built-in views
// take their records from (a saved view's filters, joined with the
// researcher's own filters).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { combineCriteria, isViewColor, moveViewKey, orderViewKeys, savedIdOf } from "../shared/savedViews";
import { schemas } from "../shared/validation";
import { edgeSpeed } from "../src/edgeScroll";

test("tabs keep the order the researcher dragged them, with new views at the end", () => {
  const keys = ["table", "gallery", "map", "saved:a"];
  assert.deepEqual(orderViewKeys(undefined, keys), keys);
  // Unknown or repeated keys are ignored; views not placed yet come last.
  assert.deepEqual(orderViewKeys(["map", "gone", "map", "table"], keys), ["map", "table", "gallery", "saved:a"]);
  assert.deepEqual(moveViewKey(undefined, keys, "saved:a", "table", "before"), ["saved:a", "table", "gallery", "map"]);
  assert.deepEqual(moveViewKey(["saved:a", "table"], keys, "table", "map", "after"), ["saved:a", "gallery", "map", "table"]);
  assert.deepEqual(moveViewKey(undefined, keys, "map", "map", "after"), keys);
  assert.equal(savedIdOf("saved:abc"), "abc");
  assert.equal(savedIdOf("map"), null);
});

test("a tab colour is a pastel or normal hue, or none", () => {
  assert.ok(isViewColor("pastel:blue"));
  assert.ok(isViewColor("normal:pink"));
  assert.ok(!isViewColor("pastel:teal"));
  assert.ok(!isViewColor("bright:blue"));
  assert.ok(!isViewColor(null));
});

test("dragging near an edge scrolls slowly at first and faster closer to it", () => {
  assert.equal(edgeSpeed(500, 0, 1000), 0);
  const near = edgeSpeed(990, 0, 1000),
    nearer = edgeSpeed(1000, 0, 1000),
    start = edgeSpeed(940, 0, 1000);
  assert.ok(start > 0 && start < near && near < nearer);
  assert.equal(nearer, 16);
  assert.equal(edgeSpeed(-50, 0, 1000), -16, "beyond the edge: full speed, never more");
  assert.ok(edgeSpeed(10, 0, 1000) < 0);
});

test("a data source keeps its records, and the researcher's filters narrow them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-source-")),
    repo = new Repository(root);
  try {
    const d = repo.create("Fotos"),
      db = d.database.id,
      place = repo.addColumn(db, "Lugar", "text"),
      kind = repo.addColumn(db, "Tipo", "text");
    const data = [
      ["Granada", "foto"],
      ["Granada", "mapa"],
      ["Sevilla", "foto"],
      ["Toledo", "foto"],
      ["Toledo", "grabado"],
    ];
    const rows = data.map(([p, k]) => {
      const row = repo.createRow(db);
      repo.setCell(row.id, place.id, p);
      repo.setCell(row.id, kind.id, k);
      return row.id;
    });
    const is = (columnId: string, value: string) => ({ columnId, op: "equals" as const, value });
    const ids = (c: ReturnType<typeof combineCriteria>) => new Set(repo.literalIds({ databaseIds: [db], ...c }));
    const photos = { filters: [is(kind.id, "foto")], filterLogic: "and" as const, filterGroups: [] };
    const southOr = { filters: [is(place.id, "Granada"), is(place.id, "Sevilla")], filterLogic: "or" as const, filterGroups: [] };
    const none = { filters: [], filterLogic: "and" as const, filterGroups: [] };
    // Without a source, the researcher's criteria are used as they are.
    assert.deepEqual(combineCriteria(null, southOr), southOr);
    assert.deepEqual(ids(combineCriteria(photos, none)), new Set([rows[0], rows[2], rows[3]]));
    // An OR on either side stays an OR inside, joined with AND.
    assert.deepEqual(ids(combineCriteria(photos, southOr)), new Set([rows[0], rows[2]]));
    assert.deepEqual(ids(combineCriteria(southOr, photos)), new Set([rows[0], rows[2]]));
    assert.deepEqual(ids(combineCriteria(southOr, { ...southOr, filters: [is(place.id, "Toledo"), is(kind.id, "mapa")] })), new Set([rows[1]]));
    // What is sent to the app still passes validation.
    const combined = combineCriteria(southOr, southOr);
    assert.ok(schemas.search.safeParse({ databaseIds: [db], ...combined }).success);
    assert.ok(schemas.variantFamilies.safeParse({ databaseIds: [db], sensitivity: "balanced", search: { databaseIds: [db], ...combined } }).success);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

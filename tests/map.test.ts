import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { encodeDatabaseLocation } from "../shared/databaseProperties";
import { locatedRecords, clusterMapRecords } from "../shared/mapClusters";
import { validateCommand } from "../shared/validation";
import type { MapRecord } from "../shared/imago";

test("database map reads beyond table pages, honours filters and isolates databases/properties", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-map-"));
  const repo = new Repository(root);
  try {
    const db = repo.create("Mapa"),
      other = repo.create("Otra base");
    const place = repo.addColumn(db.database.id, "Lugar", "location");
    const second = repo.addColumn(
      db.database.id,
      "Lugar alternativo",
      "location",
    );
    const category = repo.addColumn(db.database.id, "Grupo", "text");
    const foreign = repo.addColumn(other.database.id, "Lugar", "location");
    const rows = repo.createRows(db.database.id, 237);
    repo.db.transaction(() =>
      rows.forEach((id, i) => {
        repo.setCell(
          id,
          place.id,
          encodeDatabaseLocation({
            name: `Lugar ${i}`,
            latitude: i === 0 ? 0 : 37,
            longitude: i === 0 ? 0 : -3,
          }),
        );
        repo.setCell(id, category.id, i % 2 ? "A" : "B");
      }),
    )();
    repo.createRow(other.database.id);
    const input = { databaseId: db.database.id, columnId: place.id };
    const all = repo.mapRecords(input);
    assert.equal(all.total, 237);
    assert.equal(all.records.length, 237);
    assert.ok(all.records.some((row) => row.id === rows.at(-1)));
    assert.equal(locatedRecords(all.records).length, 237);
    const filtered = repo.mapRecords({
      ...input,
      filters: [{ columnId: category.id, op: "equals", value: "A" }],
    });
    assert.equal(filtered.total, 118);
    assert.equal(filtered.records.length, 118);
    assert.equal(
      locatedRecords(repo.mapRecords({ ...input, columnId: second.id }).records)
        .length,
      0,
    );
    repo.setCell(
      rows[0],
      place.id,
      encodeDatabaseLocation({ name: "Un paraje propio" }),
    );
    assert.equal(locatedRecords(repo.mapRecords(input).records).length, 236);
    assert.throws(
      () => repo.mapRecords({ ...input, columnId: foreign.id }),
      /ubicación/,
    );
    assert.throws(
      () => repo.mapRecords({ ...input, columnId: category.id }),
      /ubicación/,
    );
    assert.throws(() =>
      validateCommand("mapRecords", { ...input, limit: 100 }),
    );
  } finally {
    repo.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("map clusters preserve every coincident record, invalid coordinates stay unlocated, and zoom separates nearby places", () => {
  const row = (id: string, lat: number, lon: number): MapRecord => ({
    id,
    title: id,
    image: null,
    imageCount: 0,
    location: { name: id, latitude: lat, longitude: lon },
  });
  const duplicates = Array.from({ length: 2000 }, (_, i) =>
    row(String(i), 20.2, 11.2),
  );
  assert.equal(clusterMapRecords(locatedRecords(duplicates), 19).length, 1);
  assert.equal(
    clusterMapRecords(locatedRecords(duplicates), 19)[0].records.length,
    2000,
  );
  const nearby = locatedRecords([row("a", 20.2, 11.2), row("b", 20.21, 11.21)]);
  assert.equal(clusterMapRecords(nearby, 2).length, 1);
  assert.equal(clusterMapRecords(nearby, 19).length, 2);
  assert.equal(
    locatedRecords([row("invalid", 200, 0), row("zero", 0, 0)]).length,
    1,
  );
  const poles = clusterMapRecords(
    locatedRecords([row("north", 90, 180), row("south", -90, -180)]),
    2,
  );
  assert.equal(poles.length, 2);
  assert.ok(poles.every((group) => !group.id.includes("NaN")));
});

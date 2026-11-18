import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { decodeDatabaseLocation, encodeDatabaseLocation } from "../shared/databaseProperties";
import {
  clusterMapRecords,
  focusBounds,
  locatedRecords,
  sameMapRecords,
  storedBounds,
  type LocatedMapRecord,
} from "../shared/mapClusters";
import { validateCommand } from "../shared/validation";
import type { MapRecord } from "../shared/imago";
import { angleBetween, metres, repeatedViews } from "../shared/viewpoints";

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

test("map records read only the map fields yet match the full record hydration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-map-slim-"));
  const repo = new Repository(root);
  try {
    const db = repo.create("Mapa");
    const place = repo.addColumn(db.database.id, "Lugar", "location");
    const order = repo.addColumn(db.database.id, "Orden", "number");
    const title = db.columns.find((column) => column.type === "title")!;
    const rows = [
      ...repo.createRows(db.database.id, 1000),
      ...repo.createRows(db.database.id, 234),
    ];
    const images = db.columns.find((column) => column.type === "attachment")!;
    const asset = repo.db.prepare(
      "INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    repo.db.transaction(() =>
      rows.forEach((id, i) => {
        if (i % 5) repo.setCell(id, title.id, `Foto ${i}`);
        repo.setCell(id, order.id, String((i * 7919) % 1234));
        if (i % 4)
          repo.setCell(
            id,
            place.id,
            encodeDatabaseLocation({
              name: `Lugar ${i}`,
              latitude: 36 + (i % 7),
              longitude: -6 + (i % 9),
              ...(i % 3 ? { bearing: i % 360 } : {}),
            }),
          );
        // No image, a not-yet-measured image first, rotated revisions.
        for (let n = 0; n < i % 3; n++)
          asset.run(
            `${id}-${n}`, db.database.id, id, images.id, `f${n}.jpg`, `/x/${n}`, 0,
            `${id}-h${n}`, 1, n === 0 && i % 2 ? 0 : 640, 480,
            JSON.stringify(n === 1 ? { imagoRotation: 90 } : {}), null, 2 - n,
            "2026-01-01",
          );
      }),
    )();
    const input = {
      databaseId: db.database.id,
      columnId: place.id,
      sorts: [{ columnId: order.id, direction: "desc" as const }],
    };
    const result = repo.mapRecords(input);
    const ids = repo.literalIds({ databaseIds: [db.database.id], sorts: input.sorts });
    const expected = repo.hydrate(ids).map((row): MapRecord => {
      const image = row.images.find((a) => a.width > 0);
      return {
        id: row.id,
        title: row.title,
        location: decodeDatabaseLocation(row.cells[place.id] ?? null),
        image: image ? { id: image.id, revision: image.revision } : null,
        imageCount: row.images.length,
      };
    });
    assert.equal(result.total, 1234);
    assert.deepEqual(result.records, expected);
    assert.ok(result.records.some((r) => r.image?.revision));
    assert.ok(result.records.some((r) => r.imageCount && !r.image));
  } finally {
    repo.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the map opens on the region where the photographs are", () => {
  let n = 0;
  const at = (latitude: number, longitude: number) =>
    ({
      id: String(n++),
      title: "",
      image: null,
      imageCount: 0,
      location: { name: "x", latitude, longitude },
    }) as LocatedMapRecord;
  const spread = (count: number, lat: [number, number], lng: [number, number]) =>
    Array.from({ length: count }, (_, i) =>
      at(lat[0] + ((lat[1] - lat[0]) * i) / count, lng[0] + ((lng[1] - lng[0]) * ((i * 7) % count)) / count),
    );
  const peninsula = spread(500, [36, 43.7], [-9.3, 3.3]),
    canaries = spread(3, [27.8, 29.2], [-18, -13.4]);
  // Spain, Canary Islands included: the country, not the world.
  const spain = focusBounds([...peninsula, ...canaries])!;
  assert.ok(spain[0][0] < 28.5 && spain[1][0] > 43 && spain[0][1] < -17 && spain[1][1] > 3);
  // A trip abroad belongs to the collection: Granada and London, both.
  const trip = focusBounds([...peninsula, at(51.5, -0.12)])!;
  assert.ok(trip[1][0] > 51 && trip[0][0] < 36.5);
  // Several European countries: Europe.
  const europe = focusBounds([
    ...peninsula,
    ...spread(300, [44, 51], [-4, 8]),
    ...spread(300, [38, 47], [7, 18]),
    ...spread(200, [47, 55], [6, 15]),
  ])!;
  assert.ok(europe[0][1] < -9 && europe[1][1] > 17 && europe[1][0] > 54);
  // Every continent: the world.
  const world = focusBounds([
    ...peninsula,
    ...spread(200, [-35, 5], [-70, -40]),
    ...spread(200, [20, 45], [100, 140]),
    ...spread(200, [-38, -12], [115, 150]),
  ])!;
  assert.ok(world[0][0] < -30 && world[1][1] > 140 && world[0][1] < -60);
  assert.equal(focusBounds([]), null);
  assert.deepEqual(focusBounds([at(37.4, -6)]), [[37.4, -6], [37.4, -6]]);
  assert.deepEqual(storedBounds(JSON.stringify(spain)), spain);
  for (const raw of [null, "", "x", "[1,2]", "[[100,0],[0,0]]", '{"a":1}'])
    assert.equal(storedBounds(raw), null);
});

test("a refreshed map answer with the same records keeps the markers", () => {
  const row = (id: string, latitude = 1): MapRecord => ({
    id,
    title: id,
    image: { id: "img" + id, revision: "1" },
    imageCount: 1,
    location: { name: id, address: null, latitude, longitude: 2 },
  });
  const a = [row("a"), row("b")];
  assert.ok(sameMapRecords(a, [row("a"), row("b")]));
  assert.ok(!sameMapRecords(a, [row("a"), row("b", 3)]));
  assert.ok(!sameMapRecords(a, [row("b"), row("a")]));
  assert.ok(!sameMapRecords(a, [row("a")]));
  assert.ok(!sameMapRecords(a, [row("a"), { ...row("b"), image: { id: "imgb", revision: "2" } }]));
});

test("repeated views come out exactly as comparing every pair, but fast", () => {
  // The previous all-pairs grouping, kept as the reference.
  const reference = (records: MapRecord[], maxMetres = 80, maxAngle = 40) => {
    type L = MapRecord & { location: { latitude: number; longitude: number; bearing?: number | null; name: string } };
    const located = records.filter(
      (r): r is L => typeof r.location?.latitude === "number" && typeof r.location?.longitude === "number",
    );
    const close = (a: L, b: L) =>
      metres(a.location, b.location) <= maxMetres &&
      (a.location.bearing == null || b.location.bearing == null || angleBetween(a.location.bearing, b.location.bearing) <= maxAngle);
    const neighbours = new Map(located.map((r) => [r.id, located.filter((o) => o.id !== r.id && close(r, o))]));
    const remaining = new Set(located.map((r) => r.id));
    const groups: L[][] = [];
    for (const r of [...located].sort((a, b) => neighbours.get(b.id)!.length - neighbours.get(a.id)!.length)) {
      if (!remaining.has(r.id)) continue;
      const members = [r, ...neighbours.get(r.id)!.filter((o) => remaining.has(o.id))];
      if (members.length < 2) continue;
      const directed = members.filter((m) => m.location.bearing != null).length;
      if (directed < 2 && members.length > 12) continue;
      for (const m of members) remaining.delete(m.id);
      groups.push(members);
    }
    return groups.sort((a, b) => b.length - a.length);
  };
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spots = [
    [37.1773, -3.5986], [40.4168, -3.7038], [28.1, -15.4], [51.5, -0.12],
    [0, 179.9997], [0, -179.9998], [89.9995, 10], [89.9996, -170], [-33.9, 151.2],
  ];
  const records: MapRecord[] = Array.from({ length: 3000 }, (_, i) => {
    const [lat, lng] = spots[i % spots.length];
    // Within a few hundred metres of a spot, some exactly coincident, some
    // with a camera direction, some without coordinates.
    const spread = i % 5 === 0 ? 0 : 0.004;
    return {
      id: `r${i}`,
      title: "",
      image: null,
      imageCount: 0,
      location:
        i % 97 === 0
          ? { name: "sin coordenadas", latitude: null, longitude: null }
          : {
              name: `p${i % spots.length}`,
              latitude: Math.max(-90, Math.min(90, lat + (random() - 0.5) * spread)),
              longitude: ((lng + (random() - 0.5) * spread + 540) % 360) - 180,
              ...(i % 3 ? { bearing: Math.floor(random() * 360) } : {}),
            },
    } as MapRecord;
  });
  const ids = (groups: MapRecord[][]) => groups.map((g) => g.map((r) => r.id));
  // How long comparing every pair takes on this machine: the yardstick for
  // "fast", so a slow CI runner does not fail a fast algorithm.
  const referenceStarted = performance.now();
  const referenceGroups = reference(records);
  const referenceTime = performance.now() - referenceStarted;
  assert.deepEqual(ids(repeatedViews(records)), ids(referenceGroups));
  assert.deepEqual(ids(repeatedViews(records, 300, 90)), ids(reference(records, 300, 90)));
  assert.ok(repeatedViews(records).length > 10);
  // The real collection size: well under a frame budget, not seconds.
  const many = Array.from({ length: 6000 }, (_, i) => records[i % records.length]).map((r, i) => ({ ...r, id: `m${i}` }));
  const started = performance.now();
  repeatedViews(many);
  const elapsed = performance.now() - started;
  // Twice the records in a fraction of the time all pairs take for half of
  // them; on a typical machine that is well under 1.5 s.
  assert.ok(
    elapsed < Math.max(1500, referenceTime),
    `${Math.round(elapsed)} ms for 6,000 records; all pairs of 3,000 took ${Math.round(referenceTime)} ms`,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  chiSquare,
  chiSquareP,
  cooccurrence,
  crosstab,
  frequency,
  numeric,
  trend,
  yearOf,
} from "../shared/statistics";
import { Repository } from "../electron/db/repository";
import { Statistics } from "../electron/db/statistics";

const close = (a: number, b: number, tolerance = 1e-3) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);

test("chi-square p-values match reference tables", () => {
  close(chiSquareP(3.841, 1), 0.05);
  close(chiSquareP(10, 4), 0.0404);
  close(chiSquareP(18.307, 10), 0.05);
  close(chiSquareP(0.5, 3), 0.9189);
  close(chiSquareP(100, 2), 1.93e-22, 1e-23);
  assert.equal(chiSquareP(5, 0), 1);
});

test("chi-square test of independence with Cramér's V and residuals", () => {
  // Classic 2×2: smokers by sex (Agresti-style toy table).
  const { chi, residuals } = chiSquare([
    [30, 10],
    [20, 40],
  ]);
  assert.ok(chi);
  close(chi.statistic, 16.667, 1e-2);
  assert.equal(chi.df, 1);
  assert.ok(chi.p < 0.001);
  close(chi.cramersV, 0.408, 1e-3);
  assert.ok(residuals[0][0] > 1.96 && residuals[0][1] < -1.96);
  // Independent table: no association.
  const flat = chiSquare([
    [10, 20],
    [20, 40],
  ]).chi!;
  close(flat.statistic, 0);
  close(flat.p, 1);
  // A single used row cannot be tested.
  assert.equal(chiSquare([[3, 4], [0, 0]]).chi, null);
});

test("frequencies count records, keep the rest apart and spot multi-select", () => {
  const r = frequency([["a"], ["a", "b"], [], ["c"], ["a"]], 2);
  assert.deepEqual(
    r.categories.map((c) => [c.label, c.count]),
    [["a", 3], ["b", 1]],
  );
  assert.equal(r.other, 1);
  assert.equal(r.empty, 1);
  assert.equal(r.distinct, 3);
  assert.equal(r.multi, true);
  assert.equal(r.categories[0].share, 0.6);
});

test("crosstab and co-occurrence", () => {
  const t = crosstab(
    [["Sevilla"], ["Sevilla"], ["Granada"], ["Granada"], []],
    [["BN"], ["BN"], ["Color"], ["BN"], ["BN"]],
  );
  assert.deepEqual(t.rows, ["Granada", "Sevilla"]);
  assert.deepEqual(t.cols, ["BN", "Color"]);
  assert.deepEqual(t.counts, [[1, 1], [2, 0]]);
  assert.equal(t.records, 4);
  const c = cooccurrence([["a", "b"], ["a", "b", "c"], ["a"], ["c"]]);
  const ab = c.pairs.find((p) => p.a === "a" && p.b === "b")!;
  assert.equal(ab.count, 2);
  close(ab.jaccard, 2 / 3);
  close(ab.lift, (2 * 4) / (3 * 2), 1e-2);
  assert.equal(c.matrix[c.labels.indexOf("a")][c.labels.indexOf("a")], 3);
});

test("years come from dates, numbers, free text and centuries", () => {
  assert.equal(yearOf({ type: "date" }, '{"start":"1958-05-02"}'), 1958);
  assert.equal(yearOf({ type: "date" }, "1958-05-02"), 1958);
  assert.equal(yearOf({ type: "number" }, "1925"), 1925);
  assert.equal(yearOf({ type: "number" }, "12"), null);
  assert.equal(yearOf({ type: "text" }, "c. 1930"), 1930);
  assert.equal(yearOf({ type: "select" }, "x", "1950-1959"), 1950);
  assert.equal(yearOf({ type: "text" }, "s. XIX"), 1850);
  assert.equal(yearOf({ type: "text" }, "Foto 12345"), null);
  assert.equal(yearOf({ type: "text" }, "s.d."), null);
});

test("trends by decade with series, and numeric summaries", () => {
  const t = trend([1921, 1925, 1933, null, 1948], [["a"], ["b"], ["a"], ["a"], ["a"]], "decade");
  assert.deepEqual(t.buckets, [1920, 1930, 1940]);
  assert.deepEqual(t.totals, [2, 1, 1]);
  assert.equal(t.undated, 1);
  assert.deepEqual(t.series.find((s) => s.label === "a")!.values, [1, 1, 1]);
  const n = numeric([1, 2, 3, 4, null, 100], 4);
  assert.equal(n.n, 5);
  assert.equal(n.median, 3);
  assert.equal(n.min, 1);
  assert.equal(n.histogram.reduce((a, b) => a + b.count, 0), 5);
});

test("statistics are saved per database and computed over the selected records", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-stats-")),
    repo = new Repository(root);
  try {
    const d = repo.importCsv(
      "Fotos",
      ["ID", "Año", "Lugar", "Temas"],
      ["title", "text", "select", "multi_select"],
      [
        ["R1", "1925", "Sevilla", "Fiestas, Calles"],
        ["R2", "c. 1930", "Granada", "Calles"],
        ["R3", "1931", "Sevilla", ""],
        ["R4", "s.d.", "Córdoba", "Monumentos"],
      ],
    );
    const [, year, place, themes] = d.columns,
      stats = new Statistics(repo),
      ids = repo.literalIds({ databaseIds: [d.database.id] });
    const saved = stats.save({ databaseId: d.database.id, name: "Lugares", spec: { kind: "frequency", columnId: place.id } });
    stats.save({ databaseId: d.database.id, name: "Temas", spec: { kind: "cooccurrence", columnId: themes.id } });
    assert.deepEqual(stats.list(d.database.id).map((s) => s.name), ["Lugares", "Temas"]);
    stats.save({ ...saved, name: "Lugares (todas)" });
    assert.equal(stats.list(d.database.id)[0].name, "Lugares (todas)");
    const other = repo.importCsv("Otra", ["ID"], ["title"], [["X"]]);
    assert.throws(
      () => stats.save({ databaseId: other.database.id, name: "x", spec: { kind: "frequency", columnId: place.id } }),
      /no pertenece/,
    );
    const freq = stats.compute(d.database.id, ids, { kind: "frequency", columnId: place.id });
    assert.equal(freq.kind === "frequency" && freq.categories[0].label, "Sevilla");
    const candidates = stats.yearCandidates(d.database.id);
    assert.equal(candidates[0].columnId, year.id);
    const line = stats.timeline(d.database.id, ids, year.id);
    assert.deepEqual(line.items.map((i) => [i.title, i.year]), [["R1", 1925], ["R2", 1930], ["R3", 1931]]);
    assert.equal(line.undated, 1);
    // Filtered selection: only Sevilla.
    const sevilla = repo.literalIds({
      databaseIds: [d.database.id],
      filters: [
        {
          columnId: place.id,
          op: "any",
          value: [repo.detail(d.database.id).columns[2].options.find((o) => o.label === "Sevilla")!.id],
        },
      ],
    });
    assert.equal(stats.timeline(d.database.id, sevilla, year.id).items.length, 2);
    stats.delete(saved.id);
    assert.equal(stats.list(d.database.id).length, 1);
    // Deleting the database removes its statistics.
    repo.db.prepare("DELETE FROM db_databases WHERE id=?").run(d.database.id);
    assert.equal(stats.list(d.database.id).length, 0);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

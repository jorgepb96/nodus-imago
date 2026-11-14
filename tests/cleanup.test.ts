// Values written in different ways: which are grouped, and merging them
// (and undoing the merge) in option and text properties.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clusterValues, fingerprint, similarKeys } from "../shared/cleanup";
import { Repository } from "../electron/db/repository";
import { ValueCleanup } from "../electron/db/cleanup";

const v = (value: string, count = 1) => ({ value, optionId: null, count });

test("values are grouped by key, by initials and by small spelling differences, never by different numbers", () => {
  assert.equal(fingerprint("Muller, Nicolás"), fingerprint("nicolas  MULLER"));
  assert.ok(similarKeys(fingerprint("N. Muller"), fingerprint("Nicolás Muller")));
  assert.ok(similarKeys(fingerprint("Wolgensinger"), fingerprint("Wolgensiger")));
  assert.ok(!similarKeys(fingerprint("1950"), fingerprint("1951")));
  assert.ok(!similarKeys(fingerprint("Fondo 3"), fingerprint("Fondo 4")));
  assert.ok(!similarKeys(fingerprint("Fondo A"), fingerprint("Fondo B")));
  assert.ok(!similarKeys(fingerprint("Ávila"), fingerprint("Ávalos")), "short names need the same spelling");
  for (const [a, b] of [["Valencia", "Palencia"], ["Mérida", "Lérida"], ["Catedral de Tarragona", "Catedral de Tarazona"], ["plazas", "playas"], ["Osuna", "Osuña"]])
    assert.ok(!similarKeys(fingerprint(a), fingerprint(b)), `${a} / ${b}`);
  assert.ok(similarKeys(fingerprint("Estudios Ribera"), fingerprint("Estudio Ribera")));
  assert.equal(fingerprint("Peñíscola"), fingerprint("peñiscola"));
  assert.ok(!similarKeys(fingerprint("N. Muller"), fingerprint("Nicolás Martín")));
  const clusters = clusterValues([
    v("Nicolás Muller", 40), v("Muller, Nicolás", 3), v("N. Muller", 2), v("Nicolas Müller", 1),
    v("Toledo", 9), v("toledo", 1), v("Segovia", 5), v("1950", 2), v("1951", 2),
  ]);
  assert.deepEqual(
    clusters.map((c) => [c.kind, c.suggestion, c.members.map((m) => m.value)]),
    [
      ["same", "Toledo", ["Toledo", "toledo"]],
      ["similar", "Nicolás Muller", ["Nicolás Muller", "Muller, Nicolás", "N. Muller", "Nicolas Müller"]],
    ],
  );
});

test("merging options moves their records, renames the kept one, and «Deshacer» brings everything back", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-cleanup-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv(
      "Fotos",
      ["ID", "Autor", "Temas", "Notas"],
      ["title", "select", "multi_select", "text"],
      [
        ["1", "Nicolás Muller", "fiesta, procesion", "Fondo A"],
        ["2", "N. Muller", "fiesta", "fondo a"],
        ["3", "Muller, Nicolás", "procesión", "Fondo A"],
        ["4", "Otro", "procesión, procesion", "Fondo B"],
      ],
    );
    const [, author, topics, notes] = repo.detail(detail.database.id).columns;
    const cleanup = new ValueCleanup(repo);
    const clusters = cleanup.clusters(author.id);
    assert.equal(clusters.length, 1);
    const ids = clusters[0].members.map((m) => m.optionId!);
    const before = repo.literal({ databaseIds: [detail.database.id], limit: 10 }).rows.map((r) => r.cells[author.id]);
    assert.equal(cleanup.merge(author.id, [{ members: ids, target: "Muller, Nicolás" }]), 2);
    const after = repo.detail(detail.database.id).columns.find((c) => c.id === author.id)!;
    assert.deepEqual(after.options.map((o) => o.label).sort(), ["Muller, Nicolás", "Otro"]);
    const rows = repo.literal({ databaseIds: [detail.database.id], limit: 10 }).rows;
    assert.equal(new Set(rows.slice(0, 3).map((r) => r.cells[author.id])).size, 1);
    assert.equal(repo.literal({ databaseIds: [detail.database.id], query: "Muller, Nicolás", limit: 10 }).total, 3);
    // Undo: the removed options return and every record points to its own again.
    repo.undo();
    const restored = repo.detail(detail.database.id).columns.find((c) => c.id === author.id)!;
    assert.deepEqual(restored.options.map((o) => o.label).sort(), ["Muller, Nicolás", "N. Muller", "Nicolás Muller", "Otro"]);
    assert.deepEqual(repo.literal({ databaseIds: [detail.database.id], limit: 10 }).rows.map((r) => r.cells[author.id]), before);
    // Several labels in one record become one.
    const topicClusters = cleanup.clusters(topics.id);
    assert.equal(topicClusters.length, 1);
    cleanup.merge(topics.id, [{ members: topicClusters[0].members.map((m) => m.optionId!), target: "procesión" }]);
    const merged = repo.literal({ databaseIds: [detail.database.id], limit: 10 }).rows;
    assert.equal(JSON.parse(merged[0].cells[topics.id]!).length, 2);
    assert.equal(JSON.parse(merged[3].cells[topics.id]!).length, 1, "both forms in one record become one label");
    // Text: the cells take the chosen form.
    const textClusters = cleanup.clusters(notes.id);
    assert.deepEqual(textClusters.map((c) => c.members.map((m) => [m.value, m.count])), [[["Fondo A", 2], ["fondo a", 1]]]);
    assert.equal(cleanup.merge(notes.id, [{ members: ["Fondo A", "fondo a"], target: "Fondo A" }]), 1);
    repo.undo();
    assert.equal(repo.literal({ databaseIds: [detail.database.id], limit: 10 }).rows[1].cells[notes.id], "fondo a");
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

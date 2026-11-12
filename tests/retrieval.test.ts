import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Repository } from "../electron/db/repository";
import { Images } from "../electron/import/images";
import { Models } from "../electron/ai/models";
import { InferenceHost } from "../electron/ai/host";
import { Engine } from "../electron/ai/engine";
import { normalizeVector } from "../shared/vectors";

test("retrieval scopes, structured filters, temporary image queries and dimension isolation work with deterministic contract vectors", async () => {
  // Tests retrieval mechanics, not model quality or actual inference.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-retrieval-")),
    repo = new Repository(root),
    host = new InferenceHost(repo, "not-used"),
    models = new Models(repo),
    engine = new Engine(repo, models, host),
    images = new Images(repo);
  try {
    repo.updateSettings({ embeddingModel: "embeddinggemma2" });
    const a = repo.importCsv(
        "A",
        ["ID", "Año"],
        ["title", "number"],
        [
          ["Patio rural", "1945"],
          ["Vivienda tradicional", "1960"],
        ],
      ),
      b = repo.importCsv("B", ["ID"], ["title"], [["Otra colección"]]);
    const rows = repo.literal({}).rows,
      columns = new Map(
        [a, b].map((d) => [
          d.database.id,
          repo.addColumn(d.database.id, "Fotos", "attachment").id,
        ]),
      );
    for (let i = 0; i < rows.length; i++) {
      const file = path.join(root, `test-${i}.jpg`);
      await sharp({
        create: {
          width: 20,
          height: 20,
          channels: 3,
          background: ["#224466", "#669922", "#cc6622"][i],
        },
      })
        .jpeg()
        .toFile(file);
      await images.importOne(
        {
          databaseId: rows[i].databaseId,
          columnId: columns.get(rows[i].databaseId)!,
          storage: "link",
          createUnmatched: false,
          files: [{ path: file, rowId: rows[i].id }],
        },
        0,
      );
      const vector = Array(512).fill(0);
      vector[rows[i].title === "Vivienda tradicional" ? 1 : 0] = 1;
      const hash = repo.getRow(rows[i].id).images[0].contentHash;
      repo.db
        .prepare("INSERT INTO embeddings VALUES(?,?,?)")
        .run(
          hash,
          engine.contract(),
          Buffer.from(new Float32Array(vector).buffer),
        );
    }
    engine.ready = () => {};
    host.request = async (input) => {
      const vector = Array(input.dimensions as number).fill(0);
      vector[0] = 1;
      return (input.inputs as unknown[]).map(() => vector);
    };
    let page = await engine.search({
      mode: "semantic",
      query: "rural",
      databaseIds: [a.database.id],
    });
    assert.equal(page.total, 2);
    assert.equal(page.rows[0].title, "Patio rural");
    assert.equal(page.rows[0].score, 1);
    page = await engine.search({
      mode: "semantic",
      query: "rural",
      databaseIds: [a.database.id],
      filters: [{ columnId: a.columns[1].id, op: "gte", value: "1950" }],
    });
    assert.equal(page.total, 1);
    assert.equal(page.rows[0].title, "Vivienda tradicional");
    const before = repo.stats();
    page = await engine.search(
      { mode: "semantic" },
      path.join(root, "test-0.jpg"),
    );
    assert.equal(page.total, 3);
    assert.deepEqual(repo.stats(), before);
    page = await engine.search({
      mode: "hybrid",
      query: "Vivienda",
      databaseIds: [a.database.id],
      semanticWeight: 0,
    });
    assert.equal(page.total, 1);
    assert.equal(page.rows[0].title, "Vivienda tradicional");
    repo.updateSettings({ dimensions: 256 });
    page = await engine.search({ mode: "semantic", query: "rural" });
    assert.equal(page.total, 0);
    assert.equal(repo.stats().indexed, 3);
  } finally {
    host.close();
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("database-specific OR filters do not turn unrelated schema predicates into tautologies", async () => {
  const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "imago-schema-filters-"),
    ),
    repo = new Repository(root);
  try {
    const a = repo.importCsv(
        "A",
        ["ID", "Lugar"],
        ["title", "text"],
        [
          ["A1", "Granada"],
          ["A2", "Sevilla"],
        ],
      ),
      b = repo.importCsv(
        "B",
        ["ID", "Autor"],
        ["title", "text"],
        [
          ["B1", "María"],
          ["B2", "Pedro"],
        ],
      );
    const p = repo.literal({
      filterLogic: "or",
      filters: [
        {
          databaseId: a.database.id,
          columnId: a.columns[1].id,
          op: "equals",
          value: "Granada",
        },
        {
          databaseId: b.database.id,
          columnId: b.columns[1].id,
          op: "equals",
          value: "María",
        },
      ],
    });
    assert.deepEqual(p.rows.map((r) => r.title).sort(), ["A1", "B1"]);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

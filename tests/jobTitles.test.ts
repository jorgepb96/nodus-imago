// The queue names an indexing pass by what it holds: the text of records,
// images or both.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { jobTitle } from "../shared/jobTitles";

test("an indexing pass is named after the records and images it holds", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-jobs-")),
    repo = new Repository(root);
  try {
    const records = repo.newJob("index", { rows: ["a", "b"], assets: [], label: "Indexación automática" }, 2);
    const images = repo.newJob("index", { rows: [], assets: ["x"] }, 1);
    const both = repo.newJob("index", { rows: ["a"], assets: ["x", "y"] }, 3);
    const other = repo.newJob("fingerprints", { hashes: ["h"] }, 1);
    const byId = new Map(repo.jobs().map((j) => [j.id, j]));
    assert.deepEqual([byId.get(records)!.indexRows, byId.get(records)!.indexAssets], [2, 0]);
    assert.equal(jobTitle(byId.get(records)!), "Indexar fichas");
    assert.equal(jobTitle(byId.get(images)!), "Indexar imágenes");
    assert.equal(jobTitle(byId.get(both)!), "Indexar fichas e imágenes");
    assert.equal(jobTitle(byId.get(other)!), "Calcular huellas visuales");
    assert.equal(byId.get(other)!.indexRows, null);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

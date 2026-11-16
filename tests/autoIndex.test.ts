import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { Models } from "../electron/ai/models";
import { InferenceHost } from "../electron/ai/host";
import { Engine } from "../electron/ai/engine";
import { Images } from "../electron/import/images";
import { JobQueue } from "../electron/jobs";
import { AutoIndexer } from "../electron/autoIndex";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-auto-index-")),
    repo = new Repository(root),
    host = new InferenceHost(repo, "not-used"),
    models = new Models(repo),
    engine = new Engine(repo, models, host),
    queue = new JobQueue(repo, new Images(repo), models, engine, () => {});
  // These tests are about timing; the first-indexing quality choice has its own.
  repo.updateSettings({ embeddingModel: "embeddinggemma2-onnx", indexQualityChosen: true });
  engine.ready = () => {};
  const embedded: string[] = [];
  engine.onnx.embed = async (_dir, _threads, dims, inputs) =>
    inputs.map((item) => {
      embedded.push(item.text ?? "image");
      return Array.from({ length: dims }, (_, i) => (i === 0 ? 1 : 0.01));
    });
  let now = 1_000_000;
  const auto = new AutoIndexer(repo, engine, queue, { settleMs: 30_000, intervalMs: 60_000 }, () => now);
  const d = repo.importCsv("Fotos", ["ID", "Descripción"], ["title", "text"], [["R1", "Plaza"], ["R2", "Puerto"]]);
  const run = async () => {
    queue.pump();
    await queue.task;
  };
  return {
    repo, engine, queue, auto, d, embedded, run,
    advance: (ms: number) => (now += ms),
    close: async () => {
      await queue.close();
      host.close();
      repo.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test("new and edited records are indexed once editing settles, one pass at a time", async () => {
  const f = await fixture();
  try {
    assert.equal(f.auto.enabled(), true);
    f.auto.touch();
    assert.equal(f.auto.tick(), "settling");
    f.advance(31_000);
    assert.equal(f.auto.state().pending, 2);
    const id = f.auto.tick();
    assert.match(id, /^[0-9a-f-]{36}$/);
    // While that pass is queued or running, no second one is created.
    assert.equal(f.auto.tick(), "busy");
    await f.run();
    assert.equal(f.repo.jobs().find((j) => j.id === id)?.state, "completed");
    assert.equal(f.auto.tick(), "idle");
    assert.equal(f.auto.state().pending, 0);
    // An edit marks only that record; undoing it makes its old vector current again.
    const row = f.repo.literal({ databaseIds: [f.d.database.id] }).rows[0];
    f.repo.setCell(row.id, f.d.columns[1].id, "Plaza mayor con mercado");
    assert.equal(f.auto.state().pending, 1);
    f.repo.setCell(row.id, f.d.columns[1].id, "Plaza");
    assert.equal(f.auto.state().pending, 0);
    f.repo.setCell(row.id, f.d.columns[1].id, "Plaza mayor con mercado");
    f.auto.touch();
    f.advance(31_000);
    const before = f.embedded.length;
    f.auto.tick();
    await f.run();
    assert.equal(f.embedded.length - before, 1);
    assert.match(f.embedded.at(-1)!, /Plaza mayor con mercado/);
    assert.equal(f.auto.state().pending, 0);
  } finally {
    await f.close();
  }
});

test("a long backlog goes in batches, records first; paused or failed passes are never resumed by the timer", async () => {
  const f = await fixture();
  try {
    f.advance(31_000);
    const estimate = f.engine.estimateSeconds.bind(f.engine);
    const pendingIndex = f.engine.pendingIndex.bind(f.engine);
    // Two records at 1 s each and images at 10 min each: one batch holds the
    // records and one image; the next tick queues the following batch.
    f.engine.estimateSeconds = (p) => p.rows * 1 + p.assets * 600;
    f.engine.pendingIndex = () => ({ ...pendingIndex(), assets: ["a1", "a2", "a3"] });
    const first = f.auto.tick();
    assert.match(first, /^[0-9a-f-]{36}$/);
    const payload = (id: string) =>
      JSON.parse((f.repo.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(id) as { payload_json: string }).payload_json);
    assert.equal(payload(first).rows.length, 2);
    assert.deepEqual(payload(first).assets, ["a1"]);
    assert.equal(f.auto.tick(), "busy", "one batch at a time");
    f.repo.db.prepare("UPDATE jobs SET state='completed' WHERE id=?").run(first);
    f.engine.pendingIndex = () => ({ ...pendingIndex(), rows: [], assets: ["a2", "a3"] });
    const second = f.auto.tick();
    assert.deepEqual([payload(second).rows.length, payload(second).assets], [0, ["a2"]]);
    f.repo.db.prepare("DELETE FROM jobs").run();
    f.engine.pendingIndex = pendingIndex;
    f.engine.estimateSeconds = estimate;
    const id = f.auto.tick();
    f.queue.control(id, "pause", false);
    assert.equal(f.repo.jobs()[0].state, "paused");
    assert.equal(f.auto.tick(), "blocked");
    f.repo.db.prepare("UPDATE jobs SET state='failed' WHERE id=?").run(id);
    assert.equal(f.auto.tick(), "blocked");
    f.repo.db.prepare("UPDATE jobs SET state='cancelled' WHERE id=?").run(id);
    assert.match(f.auto.tick(), /^[0-9a-f-]{36}$/);
  } finally {
    await f.close();
  }
});

test("what an import adds is indexed while it goes on; a classification writing cells is waited for; remote APIs stay manual unless enabled", async () => {
  const f = await fixture();
  try {
    f.advance(31_000);
    f.repo.newJob("images", { files: [{ path: "/x.jpg", rowId: null }], databaseId: f.d.database.id, columnId: "c", storage: "link", createUnmatched: false }, 1);
    assert.match(f.auto.tick(), /^[0-9a-f-]{36}$/, "indexes during the import");
    f.repo.db.prepare("DELETE FROM jobs").run();
    f.repo.newJob("analyze", { rowIds: [], columnIds: [] }, 1);
    assert.equal(f.auto.tick(), "settling");
    f.repo.db.prepare("UPDATE jobs SET state='completed'").run();
    f.repo.updateSettings({ embeddingModel: "api-embedding" });
    assert.equal(f.auto.enabled(), false);
    assert.equal(f.auto.tick(), "disabled");
    f.repo.updateSettings({ autoIndex: { api: true } });
    assert.equal(f.auto.enabled(), true);
    // The local choice is kept apart from the API one.
    f.repo.updateSettings({ embeddingModel: "embeddinggemma2-onnx" });
    assert.equal(f.auto.enabled(), true);
    f.repo.updateSettings({ autoIndex: { api: true, local: false } });
    assert.equal(f.auto.tick(), "disabled");
  } finally {
    await f.close();
  }
});

test("automatic passes yield to work the researcher queued explicitly", async () => {
  const f = await fixture();
  try {
    // Both waiting in the queue: the explicit one goes first even if it is newer.
    // (A pass that is already running is never interrupted.)
    const autoId = f.engine.enqueueIndex(undefined, { auto: true });
    const manualId = f.engine.enqueueIndex();
    f.queue.pump();
    const state = (id: string) => f.repo.jobs().find((j) => j.id === id)?.state;
    assert.equal(state(manualId), "running");
    assert.equal(state(autoId), "queued");
    assert.equal(f.repo.jobs().find((j) => j.id === autoId)?.label, "Indexación automática");
    await f.queue.task;
  } finally {
    await f.close();
  }
});

test("the first image indexing waits for the researcher to choose its quality", async () => {
  const f = await fixture();
  try {
    f.repo.updateSettings({ indexQualityChosen: false });
    f.engine.pendingIndex = ((original) => () => ({ ...original(), assets: ["a1", "a2"] }))(f.engine.pendingIndex.bind(f.engine));
    f.advance(31_000);
    // Nothing starts on its own, records included: changing the quality
    // would invalidate a pass already running.
    assert.equal(f.auto.tick(), "quality");
    assert.equal(f.repo.jobs().length, 0);
    const quality = f.auto.state().quality!;
    assert.deepEqual([quality.assets, quality.rows, quality.current], [2, 2, 70]);
    assert.ok(quality.seconds[280] > quality.seconds[140] && quality.seconds[140] > quality.seconds[70]);
    // Asked as soon as images arrive, while the import still goes on, with
    // the fast level chosen unless another was set.
    f.repo.newJob("images", { files: [], databaseId: f.d.database.id, columnId: "c", storage: "link", createUnmatched: false }, 1);
    assert.notEqual(f.auto.state().quality, null);
    assert.equal(f.auto.tick(), "quality");
    f.repo.db.prepare("DELETE FROM jobs").run();
    // Once chosen, indexing runs as usual and the question is not asked again.
    f.repo.updateSettings({ visionBudget: 70, indexQualityChosen: true });
    assert.equal(f.auto.state().quality, null);
    assert.match(f.auto.tick(), /^[0-9a-f-]{36}$/);
    // A collection that already has image vectors is never asked.
    f.repo.db.prepare("DELETE FROM jobs").run();
    f.repo.updateSettings({ indexQualityChosen: false });
    f.repo.db.prepare("INSERT INTO embeddings VALUES(?,?,?)").run("h", "c", Buffer.from(new Float32Array([1]).buffer));
    assert.equal(f.auto.state().quality, null);
  } finally {
    await f.close();
  }
});

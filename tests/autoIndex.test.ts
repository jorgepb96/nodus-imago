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
  repo.updateSettings({ embeddingModel: "embeddinggemma2-onnx" });
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

test("long passes wait for the researcher; paused or failed passes are never resumed by the timer", async () => {
  const f = await fixture();
  try {
    f.advance(31_000);
    const estimate = f.engine.estimateSeconds.bind(f.engine);
    f.engine.estimateSeconds = () => 3600;
    assert.equal(f.auto.tick(), "held");
    assert.deepEqual(f.auto.state().held, { items: 2, seconds: 3600 });
    assert.equal(f.repo.jobs().length, 0);
    // A long image backlog does not stop records: they go alone, images wait.
    f.engine.estimateSeconds = (p) => (p.assets ? 3600 : 1);
    f.engine.pendingIndex = ((original) => () => ({ ...original(), assets: ["a1", "a2"] }))(f.engine.pendingIndex.bind(f.engine));
    const recordsId = f.auto.tick();
    assert.match(recordsId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(f.auto.state().held, { items: 2, seconds: 3599 });
    const payload = JSON.parse((f.repo.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(recordsId) as { payload_json: string }).payload_json);
    assert.equal(payload.rows.length, 2);
    assert.equal(payload.assets.length, 0);
    f.repo.db.prepare("DELETE FROM jobs").run();
    delete (f.engine as { pendingIndex?: unknown }).pendingIndex;
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

test("an import still running counts as activity, and remote APIs stay manual unless enabled", async () => {
  const f = await fixture();
  try {
    f.advance(31_000);
    f.repo.newJob("images", { files: [{ path: "/x.jpg", rowId: null }], databaseId: f.d.database.id, columnId: "c", storage: "link", createUnmatched: false }, 1);
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

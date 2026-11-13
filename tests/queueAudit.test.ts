import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { Images } from "../electron/import/images";
import { Models } from "../electron/ai/models";
import { InferenceHost } from "../electron/ai/host";
import { Engine } from "../electron/ai/engine";
import { JobQueue } from "../electron/jobs";
const delay = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
async function until(work: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!work()) {
    if (Date.now() > deadline) throw Error("Queue did not settle");
    await delay(5);
  }
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-queue-audit-")),
    repo = new Repository(root),
    models = new Models(repo),
    engine = new Engine(repo, models, new InferenceHost(repo, "unused"));
  let changes = 0;
  const queue = new JobQueue(repo, new Images(repo), models, engine, () => {
    changes++;
  });
  queue.concurrency = () => 2;
  const enqueue = (column = "column", count = 1) =>
    repo.newJob(
      "analyze",
      {
        items: Array.from({ length: count }, (_, i) => ({
          rowId: "row" + i,
          columnId: column,
          choice: { provider: "custom", model: "fixture" },
        })),
      },
      count,
    );
  return {
    root,
    repo,
    queue,
    engine,
    models,
    enqueue,
    changes: () => changes,
    job: (id: string) => repo.jobs().find((j) => j.id === id)!,
    async close() {
      await queue.close();
      repo.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
test("repeated resume of queued/running work is idempotent and never aborts its request", async () => {
  const f = fixture();
  let calls = 0,
    aborted = false,
    finish!: () => void;
  try {
    f.engine.analyzeOne = async (_p, _i, signal) => {
      calls++;
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      await new Promise<void>((r) => (finish = r));
      return "imported";
    };
    const id = f.enqueue();
    f.queue.control(id, "resume", false);
    f.queue.pump();
    f.queue.control(id, "resume");
    f.queue.control(id, "resume");
    assert.equal(calls, 1);
    assert.equal(aborted, false);
    assert.equal(f.job(id).state, "running");
    finish();
    await f.queue.task;
    assert.equal(f.job(id).state, "completed");
  } finally {
    finish?.();
    await f.close();
  }
});
test("retry after a recoverable prefix error followed by a fatal error recovers the whole failed attempt", async () => {
  const f = fixture();
  const seen: number[] = [];
  let fatal = true,
    partial = true;
  try {
    f.engine.analyzeOne = async (_p, i) => {
      seen.push(i);
      if (i === 0 && partial) {
        partial = false;
        throw Error("recoverable");
      }
      if (i === 1 && fatal) {
        fatal = false;
        throw Object.assign(Error("provider offline"), { fatal: true });
      }
      return "imported";
    };
    const id = f.enqueue("column", 3);
    f.queue.pump();
    await f.queue.task;
    assert.equal(f.job(id).state, "failed");
    assert.equal(f.job(id).done, 1);
    f.queue.control(id, "pause");
    assert.equal(f.job(id).state, "failed");
    f.queue.control(id, "resume");
    await f.queue.task;
    assert.equal(f.job(id).state, "completed");
    assert.equal(f.job(id).failed, 0);
    assert.deepEqual(seen, [0, 1, 0, 1, 2]);
  } finally {
    await f.close();
  }
});
test("resume-all starts paused tasks but never retries failed work or resurrects cancelled tasks", async () => {
  const f = fixture();
  const seen: string[] = [];
  try {
    f.engine.analyzeOne = async (p) => {
      seen.push(p.items[0].columnId);
      return "imported";
    };
    const paused = f.enqueue("paused"),
      failed = f.enqueue("failed"),
      cancelled = f.enqueue("cancelled");
    f.queue.control(paused, "pause", false);
    f.repo.db.prepare("UPDATE jobs SET state='failed' WHERE id=?").run(failed);
    f.queue.control(cancelled, "cancel", false);
    f.queue.resumeAll();
    await f.queue.task;
    assert.deepEqual(seen, ["paused"]);
    assert.equal(f.job(failed).state, "failed");
    assert.equal(f.job(cancelled).state, "cancelled");
  } finally {
    await f.close();
  }
});
test("rapid pause/resume waits for the aborted attempt before occupying a second slot", async () => {
  const f = fixture();
  let active = 0,
    max = 0,
    calls = 0;
  try {
    f.engine.analyzeOne = async (_p, _i, s) => {
      active++;
      max = Math.max(max, active);
      calls++;
      try {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 40);
          s.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              setTimeout(() => reject(Error("cancelled")), 15);
            },
            { once: true },
          );
        });
        return "imported";
      } finally {
        active--;
      }
    };
    const id = f.enqueue();
    f.queue.pump();
    f.queue.control(id, "pause");
    f.queue.control(id, "resume");
    f.queue.control(id, "resume");
    await until(() => f.job(id).state === "completed");
    assert.equal(calls, 2);
    assert.equal(max, 1);
  } finally {
    await f.close();
  }
});
test("queue is FIFO even when timestamps collide and IDs sort in the opposite order", async () => {
  const f = fixture();
  const seen: string[] = [];
  f.queue.concurrency = () => 1;
  try {
    f.engine.analyzeOne = async (p) => {
      seen.push(p.items[0].columnId);
      return "imported";
    };
    for (const [id, col] of [
      ["z", "first"],
      ["m", "second"],
      ["a", "third"],
    ]) {
      const old = f.enqueue(col);
      f.repo.db
        .prepare(
          "UPDATE jobs SET id=?,created_at='2026-01-01T00:00:00Z' WHERE id=?",
        )
        .run(id, old);
    }
    f.queue.pump();
    await until(() => f.repo.jobs().every((j) => j.state === "completed"));
    assert.deepEqual(seen, ["first", "second", "third"]);
  } finally {
    await f.close();
  }
});
test("an excluded column does not block unrelated queued columns", async () => {
  const f = fixture();
  let finish!: () => void;
  const seen: string[] = [];
  try {
    f.engine.analyzeOne = async (p) => {
      const c = p.items[0].columnId;
      seen.push(c);
      if (seen.length === 1) await new Promise<void>((r) => (finish = r));
      return "imported";
    };
    f.enqueue("same");
    const blocked = f.enqueue("same"),
      other = f.enqueue("other");
    f.queue.pump();
    await until(() => f.job(other).state === "completed");
    assert.equal(f.job(blocked).state, "queued");
    finish();
    await until(() => f.job(blocked).state === "completed");
    assert.deepEqual(seen, ["same", "other", "same"]);
  } finally {
    finish?.();
    await f.close();
  }
});
for (const state of ["completed", "cancelled"] as const)
  for (const action of ["pause", "resume", "cancel"] as const)
    test(`${state} is terminal under ${action}`, async () => {
      const f = fixture();
      try {
        const id = f.enqueue();
        f.repo.db.prepare("UPDATE jobs SET state=? WHERE id=?").run(state, id);
        f.queue.control(id, action);
        assert.equal(f.job(id).state, state);
        assert.equal(f.queue.running.size, 0);
      } finally {
        await f.close();
      }
    });
for (const [kind, payload, total, done] of [
  ["unknown", {}, 1, 0],
  ["analyze", { items: [] }, 1, 0],
  ["images", {}, 1, 0],
  ["index", { assets: [] }, -1, 0],
  ["index", { assets: [] }, 0, 1],
  ["prepare", { steps: null }, 1, 0],
] as const)
  test(`malformed ${kind}/${total}/${done} fails without blocking healthy jobs`, async () => {
    const f = fixture();
    try {
      f.engine.analyzeOne = async () => "imported";
      const bad = f.repo.newJob(kind, payload, total);
      f.repo.db.prepare("UPDATE jobs SET done=? WHERE id=?").run(done, bad);
      const good = f.enqueue("good");
      f.queue.pump();
      await f.queue.task;
      assert.equal(f.job(bad).state, "failed");
      assert.equal(f.job(good).state, "completed");
      assert.ok(f.changes() > 0);
    } finally {
      await f.close();
    }
  });
test("malformed JSON cannot break queue status and is quarantined as a failed task", async () => {
  const f = fixture();
  try {
    const id = f.enqueue();
    f.repo.db.prepare("UPDATE jobs SET payload_json='{' WHERE id=?").run(id);
    assert.doesNotThrow(() => f.repo.jobs());
    f.queue.pump();
    assert.equal(f.job(id).state, "failed");
    assert.ok(f.job(id).message);
  } finally {
    await f.close();
  }
});
test("graceful close preserves committed progress; reopening only recovers interrupted running states", async () => {
  const f = fixture();
  let finish!: () => void;
  try {
    f.engine.analyzeOne = async (_p, i, s) => {
      if (i === 1)
        await new Promise<void>((r) => {
          finish = r;
          s.addEventListener("abort", () => r(), { once: true });
        });
      return "imported";
    };
    const id = f.enqueue("column", 3);
    f.queue.pump();
    await until(() => f.job(id).done === 1);
    await f.queue.close();
    assert.equal(f.queue.running.size, 0);
    const count = f.job(id).done;
    assert.ok(count >= 1 && count <= 2);
    f.repo.close();
    const reopened = new Repository(f.root);
    assert.equal(reopened.jobs().find((j) => j.id === id)?.state, "queued");
    assert.equal(reopened.jobs().find((j) => j.id === id)?.done, count);
    reopened.close();
  } finally {
    finish?.();
    if (f.repo.db.open) await f.close();
    else fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("retry never repeats a successful import even if its external source has since disappeared", async () => {
  const f = fixture();
  const imported: number[] = [];
  let fail = true;
  try {
    const id = f.repo.newJob(
      "images",
      {
        databaseId: null,
        files: [{ path: "removed-source" }, { path: "retry-source" }],
      },
      2,
    );
    f.queue.images.importOne = async (_p, i) => {
      if (i === 0 && imported.includes(0))
        throw Error("external source no longer exists");
      if (i === 1 && fail) {
        fail = false;
        throw Error("temporary I/O error");
      }
      imported.push(i);
      return "imported";
    };
    f.queue.pump();
    await f.queue.task;
    assert.equal(f.job(id).failed, 1);
    f.queue.control(id, "resume");
    await f.queue.task;
    assert.equal(f.job(id).state, "completed");
    assert.deepEqual(imported, [0, 1]);
    assert.equal(f.job(id).skipped, 1);
  } finally {
    await f.close();
  }
});

test("deterministic stress: repeated controls preserve terminal states, bounded progress and resource exclusivity", async () => {
  const f = fixture();
  let seed = 379,
    overlap = false;
  const active = new Set<string>();
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  try {
    f.engine.analyzeOne = async (payload, _index, signal) => {
      const column = payload.items[0].columnId;
      if (active.has(column)) overlap = true;
      active.add(column);
      try {
        await delay(1);
        signal.throwIfAborted();
        return "imported";
      } finally {
        active.delete(column);
      }
    };
    const ids = Array.from({ length: 60 }, (_, i) =>
      f.enqueue("column-" + (i % 5), 3),
    );
    for (let i = 0; i < 1800; i++) {
      const id = ids[random() % ids.length],
        before = f.repo.db
          .prepare("SELECT * FROM jobs WHERE id=?")
          .get(id) as any,
        action = (["pause", "resume", "cancel"] as const)[random() % 3];
      f.queue.control(id, action);
      if (i % 17 === 0) await delay(1);
      const after = f.repo.db
        .prepare("SELECT * FROM jobs WHERE id=?")
        .get(id) as any;
      assert.ok(after.done >= 0 && after.done <= after.total);
      assert.ok(after.failed >= 0 && after.failed <= after.total);
      if (["completed", "cancelled"].includes(before.state))
        assert.equal(after.state, before.state);
    }
    f.queue.resumeAll();
    await until(() =>
      f.repo.jobs().every((j) => !["queued", "running"].includes(j.state)),
    );
    assert.equal(overlap, false);
    assert.equal(active.size, 0);
  } finally {
    await f.close();
  }
});
for (const retryItems of [[-1], [1.5], [0, 0], [9], "all"])
  test(`invalid retry selection ${JSON.stringify(retryItems)} is quarantined`, async () => {
    const f = fixture();
    try {
      const id = f.repo.newJob("index", { assets: ["fixture"], retryItems }, 1);
      f.queue.pump();
      await f.queue.task;
      assert.equal(f.job(id).state, "failed");
      assert.match(f.job(id).message ?? "", /reintento/);
    } finally {
      await f.close();
    }
  });

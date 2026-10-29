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
test("separate column jobs execute concurrently; pausing one does not cancel another", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-parallel-")),
    repo = new Repository(root),
    images = new Images(repo),
    models = new Models(repo),
    host = new InferenceHost(repo, "unused"),
    engine = new Engine(repo, models, host);
  const queue = new JobQueue(repo, images, models, engine, () => {});
  queue.concurrency = () => 2;
  try {
    repo.updateSettings({ parallelJobs: 2 });
    let active = 0,
      maximum = 0;
    const finished: string[] = [];
    engine.analyzeOne = async (payload, index, signal) => {
      active++;
      maximum = Math.max(maximum, active);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 60);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("cancelled"));
            },
            { once: true },
          );
        });
        finished.push(payload.items[index].columnId);
        return "imported";
      } finally {
        active--;
      }
    };
    const a = repo.newJob(
        "analyze",
        {
          items: [
            {
              rowId: "A",
              columnId: "columnA",
              choice: { provider: "custom", model: "fixture" },
            },
          ],
        },
        1,
      ),
      b = repo.newJob(
        "analyze",
        {
          items: [
            {
              rowId: "B",
              columnId: "columnB",
              choice: { provider: "custom", model: "fixture" },
            },
          ],
        },
        1,
      );
    queue.pump();
    assert.equal(queue.running.size, 2);
    assert.equal(repo.jobs().filter((j) => j.state === "running").length, 2);
    queue.control(a, "pause");
    await queue.task;
    assert.equal(repo.jobs().find((j) => j.id === a)?.state, "paused");
    assert.equal(repo.jobs().find((j) => j.id === b)?.state, "completed");
    assert.deepEqual(finished, ["columnB"]);
    assert.equal(maximum, 2);
    queue.control(a, "resume");
    await queue.task;
    assert.equal(repo.jobs().find((j) => j.id === a)?.state, "completed");
    assert.ok(finished.includes("columnA"));
  } finally {
    await queue.close();
    repo.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("duplicate column jobs share an exclusion resource to avoid generating competing proposals", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-exclusive-")),
    repo = new Repository(root),
    host = new InferenceHost(repo, "unused"),
    models = new Models(repo),
    engine = new Engine(repo, models, host),
    queue = new JobQueue(repo, new Images(repo), models, engine, () => {});
  queue.concurrency = () => 3;
  try {
    engine.analyzeOne = async () => {
      await new Promise((r) => setTimeout(r, 20));
      return "imported";
    };
    for (let i = 0; i < 2; i++)
      repo.newJob(
        "analyze",
        {
          items: [
            {
              rowId: "A",
              columnId: "sameColumn",
              choice: { provider: "custom", model: "fixture" },
            },
          ],
        },
        1,
      );
    queue.pump();
    assert.equal(queue.running.size, 1);
    await queue.task;
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(repo.jobs().filter((j) => j.state === "completed").length, 2);
  } finally {
    await queue.close();
    repo.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pause all also pauses queued work, not only the running process", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-pause-all-")),
    repo = new Repository(root),
    host = new InferenceHost(repo, "unused"),
    models = new Models(repo),
    engine = new Engine(repo, models, host),
    queue = new JobQueue(repo, new Images(repo), models, engine, () => {});
  queue.concurrency = () => 1;
  try {
    engine.analyzeOne = async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return "imported";
    };
    for (let i = 0; i < 2; i++)
      repo.newJob(
        "analyze",
        {
          items: [
            {
              rowId: "A" + i,
              columnId: "column" + i,
              choice: { provider: "custom", model: "fixture" },
            },
          ],
        },
        1,
      );
    queue.pump();
    queue.pauseAll();
    await queue.task;
    assert.equal(repo.jobs().filter((j) => j.state === "paused").length, 2);
  } finally {
    await queue.close();
    repo.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The task list: a failed task stays visible until the same work completes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";

test("a failed task is hidden once the same work completes later", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-job-list-")),
    repo = new Repository(root);
  try {
    const job = (payload: unknown, state: string, createdAt: string) => {
      const id = repo.newJob("download", payload, 1);
      repo.db.prepare("UPDATE jobs SET state=?, created_at=? WHERE id=?").run(state, createdAt, id);
      return id;
    };
    const superseded = job({ id: "llama-runtime" }, "failed", "2026-10-29T11:48:56.662Z");
    job({ id: "llama-runtime" }, "completed", "2026-10-29T11:51:52.076Z");
    const otherModel = job({ id: "lfm3-vl-2b" }, "failed", "2026-10-29T11:48:56.656Z");
    job({ id: "embeddinggemma2" }, "completed", "2026-10-29T11:40:00.000Z");
    const retriedLater = job({ id: "embeddinggemma2" }, "failed", "2026-10-29T11:50:00.000Z");
    const ids = repo.jobs().map((j) => j.id);
    assert.equal(ids.includes(superseded), false, "an old failure the retry fixed is not shown");
    assert.equal(ids.includes(otherModel), true, "a failure for other work stays");
    assert.equal(ids.includes(retriedLater), true, "a failure after the last success stays");
  } finally {
    repo.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

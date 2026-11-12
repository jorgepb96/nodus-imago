import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Models } from "../electron/ai/models";
import { Repository } from "../electron/db/repository";
test("download network failure preserves resumable bytes and a later response verifies them", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-offline-")),
    repo = new Repository(root),
    models = new Models(repo),
    payload = Buffer.from("exact model fixture bytes");
  const model = {
    id: "fixture-download",
    repository: "test/fixture",
    revision: "revision",
    label: "Fixture (not an inference test)",
    task: "embedding",
    license: "Apache-2.0",
    files: [
      {
        path: "config.json",
        size: payload.length,
        algorithm: "sha256",
        digest: createHash("sha256").update(payload).digest("hex"),
      },
    ],
  };
  try {
    context.mock.method(models, "catalog", () => [model]);
    const dir = models.directory(model.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "config.json.part"),
      payload.subarray(0, 5),
    );
    const offline = context.mock.method(globalThis, "fetch", async () => {
      throw Error("ENETUNREACH: offline");
    });
    await assert.rejects(
      models.downloadFile(model.id, 0, new AbortController().signal, () => {}),
      /offline/,
    );
    assert.equal((await fs.stat(path.join(dir, "config.json.part"))).size, 5);
    offline.mock.restore();
    context.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
      assert.equal(init.headers.Range, "bytes=5-");
      return new Response(payload.subarray(5), {
        status: 206,
        headers: {
          "Content-Range": `bytes 5-${payload.length - 1}/${payload.length}`,
        },
      });
    });
    await models.downloadFile(
      model.id,
      0,
      new AbortController().signal,
      () => {},
    );
    await models.verify(model.id);
    assert.equal(
      await fs.readFile(path.join(dir, "config.json"), "utf8"),
      payload.toString(),
    );
  } finally {
    context.mock.restoreAll();
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

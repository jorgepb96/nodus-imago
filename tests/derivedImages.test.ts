import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { Service } from "../electron/service";
test("simultaneous requests after restore rebuild a shared thumbnail only once", async (context) => {
  const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "imago-thumbnail-lock-"),
    ),
    service = new Service(path.join(root, "data"), "unused", () => {});
  try {
    const d = service.repo.create("Shared image"),
      file = path.join(root, "source.png");
    await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#335577" },
    })
      .png()
      .toFile(file);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const row = service.repo.createRow(d.database.id);
      await service.images.importOne(
        {
          databaseId: d.database.id,
          columnId: d.columns[1].id,
          storage: "copy",
          createUnmatched: false,
          files: [{ path: file, rowId: row.id }],
        },
        0,
      );
      ids.push(service.repo.getRow(row.id).images[0].id);
    }
    const target = service.repo.assetPath(ids[0], true);
    await fs.rm(target);
    let writes = 0;
    const rename = fs.rename;
    context.mock.method(fs, "rename", async (from: any, to: any) => {
      if (to === target) {
        writes++;
        await new Promise((r) => setTimeout(r, 25));
      }
      return rename(from, to);
    });
    const results = await Promise.all(
      ids.map((id) => service.run("_asset", { id, variant: "thumb" })),
    );
    assert.equal(writes, 1);
    assert.ok(results.every((result) => result === target));
    assert.ok((await fs.stat(target)).size > 0);
  } finally {
    context.mock.restoreAll();
    await service.run("_close");
    await fs.rm(root, { recursive: true, force: true });
  }
});

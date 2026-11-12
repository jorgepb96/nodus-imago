import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
test("live rollups use related records, propagate changes and deletions, feed formulas and reject cycles", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-rollups-")),
    repo = new Repository(root);
  try {
    const books = repo.create("Books"),
      images = repo.create("Images"),
      amount = repo.addColumn(images.database.id, "Amount", "number"),
      link = repo.addColumn(books.database.id, "Images", "relation", {
        relationTargetDatabaseId: images.database.id,
        relationTargetKind: "db_row",
      });
    const sum = repo.addColumn(books.database.id, "Total", "rollup", {
        rollupRelationColumnId: link.id,
        rollupTargetColumnId: amount.id,
        rollupFunction: "sum",
      }),
      count = repo.addColumn(books.database.id, "Count", "rollup", {
        rollupRelationColumnId: link.id,
        rollupTargetColumnId: amount.id,
        rollupFunction: "count",
      });
    const parent = repo.createRow(books.database.id),
      a = repo.createRow(images.database.id),
      b = repo.createRow(images.database.id);
    repo.setCell(a.id, amount.id, "2");
    repo.setCell(b.id, amount.id, "3");
    repo.setCell(parent.id, link.id, JSON.stringify([a.id, b.id]));
    assert.equal(repo.getRow(parent.id).cells[sum.id], "5");
    assert.equal(repo.getRow(parent.id).cells[count.id], "2");
    const formula = repo.addColumn(books.database.id, "Double", "formula", {
      formula: {
        kind: "arithmetic",
        op: "multiply",
        operands: [
          { kind: "column", columnId: sum.id },
          { kind: "number", value: 2 },
        ],
      },
    });
    repo.setCell(a.id, amount.id, "8");
    assert.equal(repo.getRow(parent.id).cells[sum.id], "11");
    assert.equal(repo.getRow(parent.id).cells[formula.id], "22");
    repo.deleteRows([a.id]);
    assert.equal(repo.getRow(parent.id).cells[sum.id], "3");
    assert.equal(repo.getRow(parent.id).cells[count.id], "1");
    const selfLink = repo.addColumn(books.database.id, "Self", "relation", {
      relationTargetDatabaseId: books.database.id,
    });
    assert.throws(
      () =>
        repo.updateColumn(sum.id, undefined, {
          rollupRelationColumnId: selfLink.id,
          rollupTargetColumnId: formula.id,
          rollupFunction: "sum",
        }),
      /circular/,
    );
    assert.equal(repo.getRow(parent.id).cells[sum.id], "3");
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

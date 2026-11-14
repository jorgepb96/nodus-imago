// The visual map: the projection keeps neighbours together, and the map of a
// database is kept until its indexed images change.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { projectVectors, random } from "../electron/ai/projection";
import { Repository } from "../electron/db/repository";
import { Images } from "../electron/import/images";
import { VisualMaps } from "../electron/db/visualMap";

function clusters(n: number, d: number, groups: number, seed = 3) {
  const r = random(seed),
    g = () => r() + r() + r() + r() - 2;
  const centres = Array.from({ length: groups }, () => Float32Array.from({ length: d }, () => g() * 2));
  const labels: number[] = [];
  const vectors = Array.from({ length: n }, (_, i) => {
    labels.push(i % groups);
    return Float32Array.from(centres[i % groups], (x) => x + g() * 0.6);
  });
  return { vectors, labels };
}

test("the projection keeps similar vectors together, inside the unit square, and repeats itself", async () => {
  const { vectors, labels } = clusters(300, 48, 4);
  const xy = await projectVectors(vectors, { epochs: 150 });
  assert.equal(xy.length, 600);
  assert.ok([...xy].every((v) => v >= 0 && v <= 1));
  let same = 0,
    total = 0;
  for (let i = 0; i < 300; i += 3) {
    const near = [...Array(300).keys()]
      .filter((j) => j !== i)
      .sort((a, b) => (xy[a * 2] - xy[i * 2]) ** 2 + (xy[a * 2 + 1] - xy[i * 2 + 1]) ** 2 - ((xy[b * 2] - xy[i * 2]) ** 2 + (xy[b * 2 + 1] - xy[i * 2 + 1]) ** 2))
      .slice(0, 8);
    for (const j of near) (total++, labels[j] === labels[i] && same++);
  }
  assert.ok(same / total > 0.95, `neighbours of the same group: ${same}/${total}`);
  assert.deepEqual(await projectVectors(vectors, { epochs: 150 }), xy);
});

test("the visual map is kept, recalculated when the images change, and coloured by a property", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-vmap-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv(
      "Fotos",
      ["ID", "Lugar"],
      ["title", "select"],
      Array.from({ length: 12 }, (_, i) => [`F${i}`, i < 7 ? "Toledo" : i < 10 ? "Segovia" : "Ávila"]),
    );
    const rows = (repo.db.prepare("SELECT id FROM db_rows ORDER BY position").all() as { id: string }[]).map((r) => r.id);
    const attachment = repo.addColumn(detail.database.id, "Fotos", "attachment");
    const images = new Images(repo);
    const { vectors } = clusters(12, 16, 2);
    for (const [i, rowId] of rows.slice(0, 10).entries()) {
      const file = path.join(root, `f${i}.png`);
      await sharp({ create: { width: 20 + i, height: 20, channels: 3, background: `#${(i * 20).toString(16).padStart(2, "0")}4466` } })
        .png()
        .toFile(file);
      await images.importOne({ databaseId: detail.database.id, columnId: attachment.id, storage: "copy", createUnmatched: false, files: [{ path: file, rowId }] }, 0);
    }
    const hashes = (repo.db.prepare("SELECT row_id,content_hash FROM image_assets").all() as { row_id: string; content_hash: string }[]);
    const embed = repo.db.prepare("INSERT INTO embeddings VALUES(?,?,?)");
    for (const h of hashes) embed.run(h.content_hash, "unit", Buffer.from(vectors[rows.indexOf(h.row_id)].buffer));
    const maps = new VisualMaps(repo, () => "unit");
    const place = detail.columns[1].id;
    const first = await maps.map(detail.database.id, rows.slice(0, 5), place);
    assert.equal(first.computed, true);
    assert.equal(first.points.length, 10);
    assert.equal(first.missing, 2);
    assert.deepEqual(first.legend, [{ label: "Toledo", count: 7 }, { label: "Segovia", count: 3 }]);
    assert.equal(first.points.filter((p) => p.shown).length, 5);
    const again = await maps.map(detail.database.id, rows, null);
    assert.equal(again.computed, false, "read from the store");
    assert.deepEqual(again.points.map((p) => [p.x, p.y]), first.points.map((p) => [p.x, p.y]));
    assert.equal(again.mode, "none");
    // A new indexed image changes the set: the layout is calculated again.
    const file = path.join(root, "f10.png");
    await sharp({ create: { width: 40, height: 20, channels: 3, background: "#aa2211" } }).png().toFile(file);
    await images.importOne({ databaseId: detail.database.id, columnId: attachment.id, storage: "copy", createUnmatched: false, files: [{ path: file, rowId: rows[10] }] }, 0);
    const added = (repo.db.prepare("SELECT content_hash FROM image_assets WHERE row_id=?").get(rows[10]) as { content_hash: string }).content_hash;
    embed.run(added, "unit", Buffer.from(vectors[10].buffer));
    const third = await maps.map(detail.database.id, rows, place);
    assert.equal(third.computed, true);
    assert.equal(third.points.length, 11);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

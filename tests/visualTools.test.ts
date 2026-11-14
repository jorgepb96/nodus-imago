// Annotations on image regions, comparison boards and variant families.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Repository } from "../electron/db/repository";
import { Annotations, cleanTags } from "../electron/db/annotations";
import { CompareBoards } from "../electron/db/compare";
import { Variants, dHash, hamming } from "../electron/db/variants";
import { recordEmbeddingText } from "../shared/recordEmbedding";
import { JobQueue } from "../electron/jobs";

async function withCatalogue(run: (ctx: { repo: Repository; root: string; ids: string[]; assets: string[]; databaseId: string }) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-visual-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv(
      "Postales",
      ["ID", "Fecha"],
      ["title", "historical_date"],
      [["A", "c. 1930"], ["B", "1952"], ["C", "[1941]"], ["D", "1960"]],
    );
    const ids = (repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position").all(detail.database.id) as { id: string }[]).map((r) => r.id);
    const column = repo.db
      .prepare("INSERT INTO db_columns(id,database_id,name,type,position,config_json,created_at,updated_at) VALUES('img',?,'Imagen','files',9,'{}','x','x')")
      .run(detail.database.id);
    void column;
    // Three files: an original, a recompressed and slightly brightened
    // reproduction of it, and an unrelated image.
    const pattern = Buffer.alloc(64 * 48 * 3);
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 3;
        pattern[i] = pattern[i + 1] = pattern[i + 2] = (x * 4 + Math.round(40 * Math.sin(y / 5))) & 255;
      }
    const other = Buffer.alloc(64 * 48 * 3);
    for (let i = 0; i < other.length; i += 3) other[i] = other[i + 1] = other[i + 2] = ((i / 3) % 48) * 5;
    const files = [
      await sharp(pattern, { raw: { width: 64, height: 48, channels: 3 } }).png().toBuffer(),
      await sharp(pattern, { raw: { width: 64, height: 48, channels: 3 } }).modulate({ brightness: 1.08 }).jpeg({ quality: 60 }).toBuffer(),
      await sharp(other, { raw: { width: 64, height: 48, channels: 3 } }).png().toBuffer(),
    ];
    const assets: string[] = [];
    for (const [index, rowIndex] of [0, 1, 2, 0].entries()) {
      // The fourth image is the same file as the first, in record D.
      const file = path.join(root, `f${index}.img`);
      const bytes = files[index === 3 ? 0 : index];
      await fs.writeFile(file, bytes);
      const id = `asset-${index}`;
      repo.db
        .prepare("INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, detail.database.id, ids[index === 3 ? 3 : rowIndex], "img", `f${index}.png`, file, 0, `hash-${index === 3 ? 0 : index}`, bytes.length, 64, 48, "{}", null, 0, "x");
      assets.push(id);
    }
    await run({ repo, root, ids, assets, databaseId: detail.database.id });
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("annotations are saved per image, follow it and enter the record's text", () =>
  withCatalogue(async ({ repo, ids, assets }) => {
    const notes = new Annotations(repo);
    const saved = notes.save({ assetId: assets[0], x: 0.1, y: 0.2, w: 0.3, h: 0.25, note: "Vendedor de periódicos", tags: ["oficios", " Oficios ", "calle"] });
    assert.deepEqual(saved.tags, ["oficios", "calle"]);
    assert.equal(saved.rowId, ids[0]);
    // Out-of-range regions are clipped to the image.
    const clipped = notes.save({ assetId: assets[0], x: 0.9, y: 0.9, w: 0.5, h: 0.5, note: "", tags: [] });
    assert.ok(Math.abs(clipped.w - 0.1) < 1e-9 && Math.abs(clipped.h - 0.1) < 1e-9);
    assert.throws(() => notes.save({ assetId: assets[0], x: 0.5, y: 0.5, w: 0.001, h: 0.2, note: "", tags: [] }), /pequeña/);
    // The literal search finds the note; the semantic text carries it.
    const found = repo.literal({ query: "periódicos", limit: 10 }).rows.map((r) => r.id);
    assert.deepEqual(found, [ids[0]]);
    const row = repo.getRow(ids[0]);
    assert.equal(row.annotations?.length, 2);
    assert.match(recordEmbeddingText(repo.detail(row.databaseId).columns, row), /Detalle: Vendedor de periódicos · oficios, calle/);
    assert.deepEqual(new Annotations(repo).tags(row.databaseId), ["calle", "oficios"]);
    // Moving the image to another record moves its regions.
    repo.db.prepare("UPDATE image_assets SET row_id=? WHERE id=?").run(ids[2], assets[0]);
    assert.equal(notes.get(saved.id).rowId, ids[2]);
    notes.delete(saved.id);
    assert.equal(notes.list({ assetId: assets[0] }).length, 1);
    assert.deepEqual(cleanTags(["", "a", "A", "b "]), ["a", "b"]);
  }));

test("a comparison board keeps up to six images with their record and date", () =>
  withCatalogue(async ({ repo, assets }) => {
    const boards = new CompareBoards(repo);
    const board = boards.save({ name: "Reproducciones", assetIds: [assets[1], assets[0], assets[1]] });
    assert.deepEqual(board.assetIds, [assets[1], assets[0]]);
    const full = boards.get(board.id);
    assert.deepEqual(
      full.items.map((i) => [i.title, i.date, i.year]),
      [["B", "1952", 1952], ["A", "c. 1930", 1930]],
    );
    assert.throws(() => boards.save({ id: board.id, assetIds: Array(7).fill(assets[0]).map((a, i) => (i ? a + i : a)) }));
    boards.save({ id: board.id, name: "Copias" });
    assert.equal(boards.list()[0].name, "Copias");
    boards.delete(board.id);
    assert.deepEqual(boards.list(), []);
  }));

test("fingerprints group copies and the same file, in date order", () =>
  withCatalogue(async ({ repo, assets, ids }) => {
    assert.equal(hamming("ffffffffffffffff", "0000000000000000"), 64);
    assert.equal(hamming("00000000000000ff", "0000000000000000"), 8);
    assert.equal(dHash(Buffer.from(Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 10))), "ffffffffffffffff");
    const variants = new Variants(repo, new CompareBoards(repo), () => null);
    assert.deepEqual(variants.status(), { images: 3, missing: 3, vectors: 0 });
    const job = variants.prepare();
    assert.ok(job);
    const payload = JSON.parse((repo.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(job) as { payload_json: string }).payload_json);
    for (let i = 0; i < payload.hashes.length; i++) assert.equal(await variants.fingerprintOne(payload, i), "imported");
    assert.equal(variants.status().missing, 0);
    assert.equal(variants.prepare(), null);
    // Different images are far apart; the reproduction is close to the original.
    const prints = new Map(
      (repo.db.prepare("SELECT content_hash,hash FROM image_fingerprints").all() as { content_hash: string; hash: string }[]).map((r) => [r.content_hash, r.hash]),
    );
    assert.equal(prints.get("hash-0")!.length, 32);
    assert.ok(hamming(prints.get("hash-0")!, prints.get("hash-2")!) > 30, "different images");
    assert.ok(hamming(prints.get("hash-0")!, prints.get("hash-1")!) <= 16, "reproduction");
    const families = await variants.families({ sensitivity: "balanced" });
    assert.equal(families.length, 1);
    const [family] = families;
    // A (c. 1930) is the original, B (1952) a reproduction, D (1960) holds the
    // same file as A; C is a different image.
    assert.deepEqual(
      family.members.map((m) => [m.title, m.year, m.match]),
      [["A", 1930, "identical"], ["B", 1952, "near"], ["D", 1960, "identical"]],
    );
    assert.equal(family.firstYear, 1930);
    assert.ok(!family.members.some((m) => m.rowId === ids[2]));
    assert.equal((await variants.of(assets[1]))?.members.length, 3);
    assert.equal(await variants.of(assets[2]), null);
  }));

test("the fingerprint task runs through the job queue", () =>
  withCatalogue(async ({ repo }) => {
    const variants = new Variants(repo, new CompareBoards(repo), () => null);
    const queue = new JobQueue(repo, {} as never, {} as never, { host: { close() {} } } as never, () => {});
    queue.fingerprint = (payload, index) => variants.fingerprintOne(payload, index);
    const id = variants.prepare()!;
    queue.pump();
    const started = Date.now();
    let job: { state: string; done: number; total: number; message: string | null } | undefined;
    while (Date.now() - started < 10_000) {
      job = repo.db.prepare("SELECT state,done,total,message FROM jobs WHERE id=?").get(id) as typeof job;
      if (job && !["queued", "running"].includes(job.state)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.deepEqual({ state: job!.state, done: job!.done, message: job!.message }, { state: "completed", done: 3, message: null });
    assert.equal(variants.status().missing, 0);
    await queue.close();
  }));

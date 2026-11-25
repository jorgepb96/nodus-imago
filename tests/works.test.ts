// A photograph as a work: its family gathered into one record of a works
// database, linked both ways, with the work's data written once; the records
// under a work count as appearances; the links undo as one step.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Repository } from "../electron/db/repository";
import { CompareBoards } from "../electron/db/compare";
import { Variants } from "../electron/db/variants";
import { Appearances } from "../electron/db/appearances";
import { Works } from "../electron/db/works";

/** A (c. 1930) and D (1960) hold the same file, B (1952) a reproduction of it, C (1941) another image. */
async function withFamily(run: (ctx: { repo: Repository; works: Works; appearances: Appearances; ids: string[]; assets: string[]; db: string }) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-works-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv(
      "Postales",
      ["ID", "Fecha", "Autor", "Ubicación"],
      ["title", "historical_date", "text", "text"],
      [
        ["A", "c. 1930", "J. Laurent", ""],
        ["B", "1952", "", ""],
        ["C", "[1941]", "", ""],
        ["D", "1960", "", ""],
      ],
    );
    const db = detail.database.id;
    const ids = (repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position").all(db) as { id: string }[]).map((r) => r.id);
    repo.db
      .prepare("INSERT INTO db_columns(id,database_id,name,type,position,config_json,created_at,updated_at) VALUES('img',?,'Imagen','files',9,'{}','x','x')")
      .run(db);
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
    for (const [index, rowIndex] of [0, 1, 2, 3].entries()) {
      const file = path.join(root, `f${index}.img`),
        bytes = files[index === 3 ? 0 : index];
      await fs.writeFile(file, bytes);
      repo.db
        .prepare("INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(`asset-${index}`, db, ids[rowIndex], "img", `f${index}.png`, file, 0, `hash-${index === 3 ? 0 : index}`, bytes.length, 64, 48, "{}", null, 0, "x");
      assets.push(`asset-${index}`);
    }
    const variants = new Variants(repo, new CompareBoards(repo), () => null);
    const job = variants.prepare();
    const payload = JSON.parse((repo.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(job) as { payload_json: string }).payload_json);
    for (let i = 0; i < payload.hashes.length; i++) await variants.fingerprintOne(payload, i);
    const works = new Works(repo, variants);
    await run({ repo, works, appearances: new Appearances(repo, variants, works), ids, assets, db });
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("a family is gathered into one work, created in a new «Fotografías» database", () =>
  withFamily(async ({ repo, works, ids, assets, db }) => {
    const [a, b, c, d] = ids;
    const result = await works.fromFamily({ assetId: assets[0] });
    assert.equal(result.created, true);
    assert.equal(result.linked, 3, "A, B and D");
    const worksDb = repo.detail(result.databaseId);
    assert.equal(worksDb.database.kind, "works");
    assert.equal(worksDb.database.name, "Fotografías");
    // The work takes the title, photographer and date of the record.
    const work = repo.getRow(result.workId);
    assert.equal(work.title, "A");
    const cell = (name: string) => work.cells[worksDb.columns.find((col) => col.name === name)!.id];
    assert.equal(cell("Fotógrafo"), "J. Laurent");
    assert.match(cell("Fecha de toma") ?? "", /1930/);
    // A two-way «Obra» relation, of one work per record.
    const obra = repo.detail(db).columns.find((col) => col.name === "Obra")!;
    assert.equal(obra.type, "relation");
    assert.equal(obra.config.relationCardinality, "one");
    for (const id of [a, b, d]) assert.deepEqual(repo.getRow(id).links![obra.id].map((l) => l.id), [result.workId]);
    assert.equal(repo.getRow(c).links![obra.id]?.length ?? 0, 0);
    const reproductions = works.workOf(b)!;
    assert.equal(reproductions.workId, result.workId);
    assert.deepEqual([...reproductions.reproductions].sort(), [a, b, d].sort());
    // The work lists them through the twin.
    assert.equal(repo.linkedRecords(result.workId)[0].total, 3);
  }));

test("gathering again reuses the work, links what is missing, and keeps other works", () =>
  withFamily(async ({ repo, works, ids, assets, db }) => {
    const [a, , c] = ids;
    const first = await works.fromFamily({ assetId: assets[0], title: "Vista de Toledo" });
    assert.equal(repo.getRow(first.workId).title, "Vista de Toledo");
    const obra = repo.detail(db).columns.find((col) => col.name === "Obra")!;
    // A record of the family unlinked by hand is linked again, into the same work.
    repo.setCell(a, obra.id, JSON.stringify([]));
    const again = await works.fromFamily({ assetId: assets[1] });
    assert.equal(again.workId, first.workId);
    assert.equal(again.created, false);
    assert.equal(again.linked, 1);
    // Only works databases are accepted.
    await assert.rejects(works.fromFamily({ assetId: assets[2], databaseId: db }), /obras fotográficas/);
    // C belongs to another work: gathering C's family leaves A, B and D where they are.
    const other = await works.fromFamily({ assetId: assets[2], databaseId: first.databaseId });
    assert.notEqual(other.workId, first.workId);
    assert.equal(other.linked, 1);
    assert.deepEqual(repo.getRow(c).links![obra.id].map((l) => l.id), [other.workId]);
    assert.equal(repo.getRow(a).links![obra.id][0].id, first.workId);
  }));

test("the links to a work undo as one step, and records under a work are appearances", () =>
  withFamily(async ({ repo, works, appearances, ids, assets, db }) => {
    const [a, b, c, d] = ids;
    const result = await works.fromFamily({ assetId: assets[0] });
    const obra = repo.detail(db).columns.find((col) => col.name === "Obra")!;
    // C is not a detected version, but the researcher puts it under the work.
    repo.setCell(c, obra.id, JSON.stringify([result.workId]));
    const lines = await appearances.list(assets[0]);
    assert.deepEqual(
      lines.map((l) => l.title).sort(),
      ["A", "B", "C", "D"],
      "the family and the record under the same work",
    );
    assert.equal(lines.find((l) => l.title === "C")!.match, "confirmed");
    // The work is the photograph itself, not where it was printed.
    assert.ok(lines.every((l) => l.work !== repo.getRow(result.workId).title && !l.publicationYear), "the work's relation is not a publication");
    repo.undo(); // C's link
    repo.undo(); // the gathering
    for (const id of [a, b, d]) assert.equal(repo.getRow(id).links![obra.id]?.length ?? 0, 0);
    assert.equal(works.workOf(a), null);
  }));

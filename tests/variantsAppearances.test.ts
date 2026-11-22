// Versions of one photograph and where it appears: the researcher's verdicts
// over detection (reject, confirm, chain), the same verdicts in the Variants
// view, the works, pages and captions of its records, and reproductions added
// by hand.
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
import { schemas } from "../shared/validation";

/**
 * Four records: A (c. 1930) and D (1960) hold the same file, B (1952) a
 * reproduction of it, and C (1941) an unrelated image.
 */
async function withFamily(
  run: (ctx: { repo: Repository; variants: Variants; appearances: Appearances; ids: string[]; assets: string[]; db: string }) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-appear-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv(
      "Postales",
      ["ID", "Fecha", "Página", "Pie de foto"],
      ["title", "historical_date", "text", "text"],
      [
        ["A", "c. 1930", "12", "Vista desde el mirador"],
        ["B", "1952", "", "General view"],
        ["C", "[1941]", "3", "Otra vista"],
        ["D", "1960", "88", ""],
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
    await run({ repo, variants, appearances: new Appearances(repo, variants), ids, assets, db });
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}
const titles = (list: { title: string }[]) => list.map((m) => m.title);

test("the versions of an image follow the researcher's verdicts", () =>
  withFamily(async ({ variants, assets }) => {
    // Detection: B is a reproduction of A, D the same file; C is unrelated.
    let family = await variants.ofImage(assets[0]);
    assert.deepEqual(
      family.members.map((m) => [m.title, m.match, m.origin, m.verdict]),
      [["B", "near", "auto", null], ["D", "identical", "auto", null]],
    );
    // Rejecting B moves it apart, undoably; the Variants view drops the link too.
    variants.setVerdict(assets[0], assets[1], "different");
    family = await variants.ofImage(assets[0]);
    assert.deepEqual(titles(family.members), ["D"]);
    assert.deepEqual(family.rejected.map((m) => [m.title, m.verdict]), [["B", "different"]]);
    assert.ok(!(await variants.families({ sensitivity: "balanced" })).some((f) => titles(f.members).includes("B")));
    variants.setVerdict(assets[0], assets[1], null);
    assert.deepEqual(titles((await variants.ofImage(assets[0])).members), ["B", "D"]);
    // Confirming C, which detection never matched, brings it in with a kind…
    variants.setVerdict(assets[0], assets[2], "same", "other_take");
    family = await variants.ofImage(assets[0]);
    assert.deepEqual(
      family.members.map((m) => [m.title, m.match, m.origin, m.verdict, m.kind]),
      [["C", "confirmed", "confirmed", "same", "other_take"], ["B", "near", "auto", null, null], ["D", "identical", "auto", null, null]],
    );
    // …and the Variants view groups it too.
    const groups = await variants.families({ sensitivity: "balanced" });
    assert.ok(groups.some((f) => ["A", "B", "C"].every((t) => titles(f.members).includes(t))));
    // Confirmed links chain: from B, C is reached through A.
    variants.setVerdict(assets[0], assets[1], "same", "reproduction");
    assert.ok(titles((await variants.ofImage(assets[1])).members).includes("C"));
    // The same file cannot be judged against itself.
    assert.throws(() => variants.setVerdict(assets[0], assets[3], "different"), /mismo archivo/);
  }));

test("appearances list the family's works, pages and captions, by date, with those added by hand", () =>
  withFamily(async ({ repo, appearances, ids, assets, db }) => {
    // Without a work property: page and caption by name, no work.
    let lines = await appearances.list(assets[0]);
    assert.deepEqual(
      lines.map((l) => [l.title, l.year, l.page, l.caption, l.match]),
      [["A", 1930, "12", "Vista desde el mirador", "self"], ["B", 1952, null, "General view", "near"], ["D", 1960, "88", null, "identical"]],
    );
    // A relation to a sources database gives the work, with its author and year.
    const sources = repo.importCsv("Fuentes", ["Título", "Autor", "Año"], ["title", "text", "text"], [["Guía ilustrada", "Autora Uno", "1951"], ["Álbum de viaje", "Autor Dos", "1928"]]);
    const sourceIds = (repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position").all(sources.database.id) as { id: string }[]).map((r) => r.id);
    const work = repo.addColumn(db, "Libro", "relation", { relationTargetDatabaseId: sources.database.id });
    repo.setCell(ids[0], work.id, JSON.stringify([sourceIds[1]]));
    repo.setCell(ids[1], work.id, JSON.stringify([sourceIds[0]]));
    lines = await appearances.list(assets[0]);
    assert.deepEqual(lines.map((l) => [l.title, l.work, l.workDetail]), [
      ["A", "Álbum de viaje", "Autor Dos · 1928"],
      ["B", "Guía ilustrada", "Autora Uno · 1951"],
      ["D", null, null],
    ]);
    assert.equal(lines[0].fields?.work, work.id);
    // The researcher can choose other properties, or none.
    const caption = repo.detail(db).columns.find((c) => c.name === "Página")!;
    lines = await appearances.list(assets[0], "balanced", { [db]: { work: null, caption: caption.id } });
    assert.deepEqual(lines.map((l) => [l.title, l.work, l.caption]), [["A", null, "12"], ["B", null, null], ["D", null, "88"]]);
    // A reproduction added by hand takes its place by year, from any version.
    const manual = appearances.save({ assetId: assets[1], work: "Revista de muestra", year: 1940, page: "7", caption: " Vista general " });
    lines = await appearances.list(assets[0]);
    assert.deepEqual(lines.map((l) => [l.manual, l.work ?? l.title, l.year]), [
      [false, "Álbum de viaje", 1930],
      [true, "Revista de muestra", 1940],
      [false, "Guía ilustrada", 1952],
      [false, "D", 1960],
    ]);
    assert.equal(lines[1].caption, "Vista general");
    appearances.save({ id: manual.id, assetId: assets[1], work: "Revista de muestra", year: 1941 });
    assert.equal((await appearances.list(assets[0])).find((l) => l.manual)?.year, 1941);
    appearances.delete(manual.id);
    assert.ok(!(await appearances.list(assets[0])).some((l) => l.manual));
    assert.throws(() => appearances.save({ id: manual.id, assetId: assets[1], work: "x" }), /ya no existe/);
  }));

test("verdicts and appearances are validated", () => {
  assert.ok(schemas.variantVerdict.safeParse({ assetId: "a", otherAssetId: "b", verdict: "same", kind: "crop" }).success);
  assert.ok(schemas.variantVerdict.safeParse({ assetId: "a", otherAssetId: "b", verdict: null }).success);
  assert.ok(!schemas.variantVerdict.safeParse({ assetId: "a", otherAssetId: "b", verdict: "maybe" }).success);
  assert.ok(!schemas.variantVerdict.safeParse({ assetId: "a", otherAssetId: "b", verdict: "same", kind: "fake" }).success);
  assert.ok(schemas.appearanceSave.safeParse({ assetId: "a", work: "Libro", year: 1955 }).success);
  assert.ok(!schemas.appearanceSave.safeParse({ assetId: "a", work: "  " }).success);
  assert.ok(schemas.imageAppearances.safeParse({ assetId: "a", fields: { d1: { work: null, page: "c1" } } }).success);
});

test("an image's versions come from its own fingerprint and vector, not from every pair of the collection", () =>
  withFamily(async ({ repo, assets }) => {
    // B is found only by its vector (its fingerprint is gone) and confirmed by
    // its pixels; C's vector points elsewhere.
    repo.db.prepare("DELETE FROM image_fingerprints WHERE content_hash='hash-1'").run();
    const vector = (values: number[]) => {
      const v = new Float32Array(8);
      values.forEach((x, i) => (v[i] = x));
      const norm = Math.hypot(...v);
      return Buffer.from(v.map((x) => x / norm).buffer);
    };
    const put = repo.db.prepare("INSERT INTO embeddings VALUES(?,?,?)");
    put.run("hash-0", "c", vector([1, 0.1]));
    put.run("hash-1", "c", vector([1, 0.2]));
    put.run("hash-2", "c", vector([0, 1]));
    const variants = new Variants(repo, new CompareBoards(repo), () => "c");
    // Opening a record must not compute the whole collection's pairs.
    (variants as unknown as { matches: () => never }).matches = () => {
      throw new Error("whole-collection pairs computed for one image");
    };
    const family = await variants.ofImage(assets[0]);
    assert.deepEqual(
      family.members.map((m) => [m.title, m.match]),
      [["B", "similar"], ["D", "identical"]],
    );
  }));

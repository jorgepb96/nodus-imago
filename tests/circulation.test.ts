// The circulation of a photograph: its uses in date order with publication
// and copy dates apart, the first publication, a caption that changes, the
// part a crop keeps, «Procede de» (suggested, set, without loops) and the
// circulation of a whole collection.
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
import { Circulation } from "../electron/db/circulation";
import { cropPlacement, type Miniature } from "../electron/db/cropMatch";

/** Soft blocks of pseudo-random greys: a scene whose parts do not repeat, smooth like a photograph. */
const photo = (width: number, height: number) => sharp(scene(width, height), { raw: { width, height, channels: 3 } }).blur(3);
function scene(width: number, height: number, seed = 7) {
  const pixels = Buffer.alloc(width * height * 3);
  let state = seed;
  const next = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 255;
  const blocks = new Map<string, number>();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const key = `${(x / 24) | 0},${(y / 24) | 0}`;
      if (!blocks.has(key)) blocks.set(key, next());
      const i = (y * width + x) * 3;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = blocks.get(key)!;
    }
  return pixels;
}
const miniature = async (input: ReturnType<typeof sharp>): Promise<Miniature> => {
  const { data, info } = await input.resize(48, 48, { fit: "inside" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: new Uint8Array(data) };
};

test("the crop detector says where a crop sits and how much it keeps", async () => {
  const raw = await photo(192, 144).png().toBuffer();
  const part = sharp(raw).extract({ left: 48, top: 36, width: 120, height: 90 });
  const placed = cropPlacement(await miniature(sharp(raw)), await miniature(part))!;
  assert.equal(placed.inner, "b", "the second image is the crop");
  assert.ok(Math.abs(placed.rect.x - 0.25) < 0.08 && Math.abs(placed.rect.y - 0.25) < 0.08, `placed near the middle (${JSON.stringify(placed.rect)})`);
  assert.ok(placed.kept > 0.25 && placed.kept < 0.55, `keeps about 39 % (${placed.kept})`);
  assert.equal(cropPlacement(await miniature(sharp(raw)), await miniature(sharp(raw))), null, "the same field is no crop");
});

/**
 * A (c. 1930) holds the original; B (1960) a crop of it, printed in a 1935
 * guide; C (1950) a copy, printed in a 1948 magazine with another caption.
 */
async function withStudy(run: (ctx: { repo: Repository; variants: Variants; circulation: Circulation; works: Works; ids: string[]; assets: string[] }) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-circ-")),
    repo = new Repository(root);
  try {
    const photos = repo.importCsv("Postales", ["Título", "Fecha"], ["title", "historical_date"], [["A", "c. 1930"], ["B", "1960"], ["C", "1950"]]);
    const db = photos.database.id;
    const ids = (repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position").all(db) as { id: string }[]).map((r) => r.id);
    repo.db
      .prepare("INSERT INTO db_columns(id,database_id,name,type,position,config_json,created_at,updated_at) VALUES('img',?,'Imagen','files',9,'{}','x','x')")
      .run(db);
    const raw = await photo(192, 144).png().toBuffer();
    const files = [
      raw,
      await sharp(raw).extract({ left: 48, top: 36, width: 120, height: 90 }).png().toBuffer(),
      await sharp(raw).modulate({ brightness: 1.06 }).jpeg({ quality: 70 }).toBuffer(),
    ];
    const assets: string[] = [];
    for (const [i, bytes] of files.entries()) {
      const file = path.join(root, `f${i}.img`);
      await fs.writeFile(file, bytes);
      const meta = await sharp(bytes).metadata();
      repo.db
        .prepare("INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(`asset-${i}`, db, ids[i], "img", `f${i}.png`, file, 0, `hash-${i}`, bytes.length, meta.width, meta.height, "{}", null, 0, "x");
      assets.push(`asset-${i}`);
    }
    const books = repo.create("Libros", true, undefined, "sources");
    const titleOf = books.columns.find((c) => c.type === "title")!.id,
      yearOf = books.columns.find((c) => c.name === "Año")!.id;
    const book = (title: string, year: string) => {
      const row = repo.createRow(books.database.id);
      repo.setCell(row.id, titleOf, title, false);
      repo.setCell(row.id, yearOf, year, false);
      return row.id;
    };
    const guide = book("Guía de Toledo", "1935"),
      magazine = book("Revista ilustrada", "1948");
    const rel = repo.addColumn(db, "Publicada en", "relation", { relationTargetDatabaseId: books.database.id, relationInverseName: "Fotografías" });
    repo.setCell(ids[1], rel.id, JSON.stringify([guide]));
    repo.setLinkDetails(ids[1], rel.id, guide, { page: "12", caption: "Puente" });
    repo.setCell(ids[2], rel.id, JSON.stringify([magazine]));
    repo.setLinkDetails(ids[2], rel.id, magazine, { page: "3", caption: "El puente romano" });
    const variants = new Variants(repo, new CompareBoards(repo), () => null);
    const job = variants.prepare();
    const payload = JSON.parse((repo.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(job) as { payload_json: string }).payload_json);
    for (let i = 0; i < payload.hashes.length; i++) await variants.fingerprintOne(payload, i);
    // Without image vectors the crop is not detected: the researcher confirms it.
    variants.setVerdict(assets[0], assets[1], "same", "crop");
    const works = new Works(repo, variants);
    const appearances = new Appearances(repo, variants, works);
    // A reproduction known from elsewhere, added by hand.
    appearances.save({ assetId: assets[0], work: "Álbum de viaje", year: 1970, caption: "Puente" });
    await run({ repo, variants, circulation: new Circulation(repo, variants, appearances, works), works, ids, assets });
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("the circulation lists the uses in date order, with what stands out", () =>
  withStudy(async ({ circulation, assets }) => {
    const c = await circulation.of(assets[0]);
    assert.deepEqual(
      c.entries.map((e) => [e.title ?? e.work, e.publicationYear, e.copyYear]),
      [
        ["A", null, 1930],
        ["B", 1935, 1960],
        ["C", 1948, 1950],
        ["Álbum de viaje", 1970, null],
      ],
    );
    assert.equal(c.capture.from, "record");
    assert.equal(c.capture.year, 1930);
    const [a, b, cc, manual] = c.entries;
    assert.equal(c.firstPublication, b.id);
    assert.equal(c.gapYears, 5);
    assert.equal(b.page, "12");
    assert.equal(b.kind, "crop");
    // B keeps part of the image on screen; the copy keeps the same field.
    assert.equal(b.crop?.of, "other");
    assert.ok(b.crop!.kept > 0.25 && b.crop!.kept < 0.55);
    assert.equal(cc.crop, null);
    // The caption changes in the magazine, and comes back in the album.
    assert.equal(cc.captionChanged, true);
    assert.equal(cc.previousCaption, "Puente");
    assert.equal(manual.captionChanged, true);
    assert.equal(c.captions, 2);
    // B is a crop of A: A is offered as its source.
    assert.equal(b.suggestedParent, a.id);
    assert.equal(cc.suggestedParent, null);
  }));

test("«Procede de» draws branches and refuses loops", () =>
  withStudy(async ({ circulation, variants, assets }) => {
    variants.setOrigin(assets[2], assets[0]);
    variants.setOrigin(assets[1], assets[2]);
    const c = await circulation.of(assets[0]);
    const byTitle = new Map(c.entries.map((e) => [e.title ?? e.work, e]));
    assert.equal(byTitle.get("C")!.parent, byTitle.get("A")!.id);
    assert.equal(byTitle.get("C")!.depth, 1);
    assert.equal(byTitle.get("B")!.depth, 2);
    assert.equal(byTitle.get("B")!.suggestedParent, null, "no suggestion once a source is set");
    assert.throws(() => variants.setOrigin(assets[0], assets[1]), /círculo/);
    assert.throws(() => variants.setOrigin(assets[0], assets[0]), /sí misma/);
    variants.setOrigin(assets[1], null);
    assert.equal((await circulation.of(assets[0])).entries.find((e) => e.title === "B")!.parent, null);
  }));

test("a work fixes the taking, and the collection's circulation is summed up", () =>
  withStudy(async ({ repo, works, circulation, variants, assets, ids }) => {
    await works.fromFamily({ assetId: assets[0] });
    const workDb = repo.list().find((d) => d.kind === "works")!;
    const work = works.workOf(ids[0])!;
    repo.setCell(work.workId, repo.detail(workDb.id).columns.find((col) => col.name === "Fecha de toma")!.id, "1925");
    const c = await circulation.of(assets[0]);
    assert.equal(c.capture.from, "work");
    assert.equal(c.capture.year, 1925);
    assert.equal(c.gapYears, 10);
    const summary = circulation.summary(await variants.families({ sensitivity: "balanced" }));
    assert.equal(summary.published, 1);
    assert.deepEqual(summary.firstYears, [{ year: 1935, count: 1 }]);
    assert.equal(summary.captionsChange, 1);
    assert.equal(summary.gap.median, 10);
    assert.ok(summary.top[0].uses >= 3);
  }));

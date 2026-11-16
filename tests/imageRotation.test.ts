import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { Service } from "../electron/service";
import {
  assetRevision,
  assetRotation,
  fromShown,
  toShown,
  turn,
  turnRegion,
  validCrop,
  type ImageView,
} from "../shared/imageRotation";

test("quarter turns wrap around and only quarter turns are read back", () => {
  assert.equal(turn(0, "right"), 90);
  assert.equal(turn(0, "left"), 270);
  assert.equal(turn(270, "right"), 0);
  assert.equal(assetRotation('{"imagoRotation":180}'), 180);
  for (const value of ['{"imagoRotation":45}', '{"imagoRotation":"90"}', "{}", "not json", null])
    assert.equal(assetRotation(value), 0);
  assert.equal(assetRevision({}), undefined);
  assert.equal(assetRevision({ imagoRotation: 90 }), "r90");
  assert.equal(assetRevision({ imagoRelinkRevision: "abc", imagoRotation: 270 }), "abc-r270");
  assert.equal(assetRevision({ imagoCrop: { x: 0.1, y: 0, w: 0.5, h: 1 } }), "c1000_0_5000_10000");
  assert.equal(validCrop({ x: 0, y: 0, w: 1, h: 1 }), null, "the whole image is no crop");
  assert.equal(validCrop({ x: 0.6, y: 0, w: 0.5, h: 1 }), null, "a crop never leaves the image");
});

test("annotations keep the original's frame through any turn and crop", () => {
  const zone = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  for (const view of [
    { rotation: 90, crop: null },
    { rotation: 180, crop: { x: 0.05, y: 0.1, w: 0.9, h: 0.8 } },
    { rotation: 270, crop: { x: 0, y: 0, w: 0.9, h: 0.95 } },
  ] as ImageView[]) {
    const shown = toShown(zone, view)!;
    const back = fromShown(shown, view);
    (["x", "y", "w", "h"] as const).forEach((k) => assert.ok(Math.abs(back[k] - zone[k]) < 1e-9, `${view.rotation} ${k}`));
  }
  // A crop of the left half shows a left-half zone over the whole image and hides the right half.
  const left = { rotation: 0, crop: { x: 0, y: 0, w: 0.5, h: 1 } } as ImageView;
  assert.deepEqual(toShown({ x: 0, y: 0, w: 0.5, h: 1 }, left), { x: 0, y: 0, w: 1, h: 1 });
  assert.equal(toShown({ x: 0.6, y: 0, w: 0.3, h: 1 }, left), null);
});

test("a region keeps marking the same part of the image through every turn", () => {
  const left = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  // Turned right, the image's left edge becomes its top edge.
  assert.deepEqual(turnRegion({ x: 0, y: 0, w: 0.5, h: 1 }, "right"), { x: 0, y: 0, w: 1, h: 0.5 });
  const close = (a: typeof left, b: typeof left) =>
    (["x", "y", "w", "h"] as const).forEach((k) => assert.ok(Math.abs(a[k] - b[k]) < 1e-9, k));
  close(turnRegion(turnRegion(left, "right"), "left"), left);
  let region = left;
  for (let i = 0; i < 4; i++) region = turnRegion(region, "right");
  close(region, left);
});

test("turning an image keeps the original and turns its previews, size, annotations and index", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-rotation-")),
    service = new Service(path.join(root, "data"), "unused", () => {});
  try {
    const d = service.repo.create("Turned"),
      file = path.join(root, "source.png");
    // Red on the left half, blue on the right.
    await sharp({ create: { width: 40, height: 20, channels: 3, background: "#0000ff" } })
      .composite([
        {
          input: await sharp({ create: { width: 20, height: 20, channels: 3, background: "#ff0000" } }).png().toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toFile(file);
    const before = await fs.readFile(file);
    const row = service.repo.createRow(d.database.id);
    await service.images.importOne(
      {
        databaseId: d.database.id,
        columnId: d.columns[1].id,
        storage: "link",
        createUnmatched: false,
        files: [{ path: file, rowId: row.id }],
      },
      0,
    );
    const image = service.repo.getRow(row.id).images[0];
    await service.run("annotationSave", { assetId: image.id, x: 0, y: 0, w: 0.5, h: 1, note: "rojo", tags: [] });
    service.repo.db
      .prepare("INSERT INTO embeddings VALUES(?,?,?)")
      .run(image.contentHash, "contract", Buffer.from(new Float32Array([1, 0]).buffer));

    assert.deepEqual(await service.run("rotateImage", { id: image.id, direction: "right" }), { rotation: 90 });
    const turned = service.repo.getRow(row.id).images[0];
    assert.equal(turned.width, 20);
    assert.equal(turned.height, 40);
    assert.equal(turned.revision, "r90");
    const [note] = await service.run("annotationsList", { assetId: image.id });
    assert.deepEqual([note.x, note.y, note.w, note.h], [0, 0, 1, 0.5]);
    assert.equal(
      (service.repo.db.prepare("SELECT count(*) n FROM embeddings WHERE content_hash=?").get(image.contentHash) as { n: number }).n,
      0,
      "the image is embedded again the right way up",
    );

    const preview = await service.run("_asset", { id: image.id, variant: "preview" });
    assert.match(path.basename(preview), /-r90-preview\.webp$/);
    const { data, info } = await sharp(preview).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height], [20, 40]);
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    // Turned right, the red left half is now on top.
    assert.ok(pixel(10, 5)[0] > 200 && pixel(10, 5)[2] < 60, "top is red");
    assert.ok(pixel(10, 35)[2] > 200 && pixel(10, 35)[0] < 60, "bottom is blue");
    // The unturned preview other records may share is left as it was.
    const plain = path.join(path.dirname(preview), image.contentHash + "-preview.webp");
    assert.deepEqual(
      [(await sharp(plain).metadata()).width, (await sharp(plain).metadata()).height],
      [40, 20],
    );

    await service.run("rotateImage", { id: image.id, direction: "left" });
    const back = service.repo.getRow(row.id).images[0];
    assert.deepEqual([back.width, back.height, back.revision], [40, 20, undefined]);
    const [restored] = await service.run("annotationsList", { assetId: image.id });
    assert.deepEqual([restored.x, restored.y, restored.w, restored.h], [0, 0, 0.5, 1]);

    // Crop the red left half: the record shows a 20×20 red image.
    await service.run("annotationSave", { assetId: image.id, x: 0.6, y: 0.1, w: 0.3, h: 0.3, note: "azul", tags: [] });
    assert.deepEqual(await service.run("cropImage", { id: image.id, crop: { x: 0, y: 0, w: 0.5, h: 1 } }), {
      crop: { x: 0, y: 0, w: 0.5, h: 1 },
    });
    const cropped = service.repo.getRow(row.id).images[0];
    assert.deepEqual([cropped.width, cropped.height], [20, 20]);
    const cut = await service.run("_asset", { id: image.id, variant: "preview" });
    const cutPixels = await sharp(cut).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([cutPixels.info.width, cutPixels.info.height], [20, 20]);
    assert.ok(cutPixels.data[0] > 200 && cutPixels.data[2] < 60, "only the red half remains");
    const full = await service.run("_asset", { id: image.id, variant: "full" });
    assert.equal((await sharp(full).metadata()).width, 40, "the crop editor sees the whole image");
    const inCrop = await service.run("annotationsList", { assetId: image.id });
    assert.deepEqual(inCrop.map((a: { note: string; w: number }) => [a.note, a.w]), [["rojo", 1]], "the blue zone is outside the crop");
    // Turning a cropped image turns its crop too.
    await service.run("rotateImage", { id: image.id, direction: "right" });
    const turnedCrop = service.repo.getRow(row.id).images[0];
    assert.equal(turnedCrop.revision, "r90-c0_0_10000_5000");
    await service.run("rotateImage", { id: image.id, direction: "left" });
    // Back to the original: the whole image and every annotation return.
    assert.deepEqual(await service.run("cropImage", { id: image.id, crop: null }), { crop: null });
    const whole = service.repo.getRow(row.id).images[0];
    assert.deepEqual([whole.width, whole.height, whole.revision], [40, 20, undefined]);
    const all = await service.run("annotationsList", { assetId: image.id });
    assert.deepEqual(
      all.map((a: { note: string; x: number; w: number }) => [a.note, a.x, a.w]),
      [["rojo", 0, 0.5], ["azul", 0.6, 0.3]],
    );
    assert.deepEqual(await fs.readFile(file), before, "the original file is never changed");
  } finally {
    await service.run("_close");
    await fs.rm(root, { recursive: true, force: true });
  }
});

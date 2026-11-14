// A crop of a photograph matches it on the pixels; another picture of the
// same kind does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { cropMatch, MINIATURE, SAME_PHOTOGRAPH, type Miniature } from "../electron/db/cropMatch";

const scene = (shapes: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#c8b8a0"/>${shapes}</svg>`);
const building = '<rect x="80" y="120" width="160" height="220" fill="#3a3028"/><rect x="110" y="160" width="30" height="50" fill="#e8dcc8"/><rect x="180" y="160" width="30" height="50" fill="#e8dcc8"/><polygon points="80,120 160,60 240,120" fill="#5a4838"/><rect x="330" y="200" width="200" height="140" fill="#6a5848"/><circle cx="470" cy="90" r="40" fill="#f0e8d8"/><rect x="360" y="230" width="40" height="70" fill="#20180f"/>';
const other = '<rect x="250" y="60" width="100" height="300" fill="#2a2018"/><circle cx="300" cy="120" r="45" fill="#d8c8b0"/><rect x="60" y="300" width="480" height="40" fill="#4a3a2a"/><rect x="120" y="180" width="60" height="120" fill="#8a7868"/>';
async function miniature(input: Buffer, crop?: { left: number; top: number; width: number; height: number }): Promise<Miniature> {
  let image = sharp(input).greyscale();
  if (crop) image = sharp(await image.png().toBuffer()).extract(crop);
  const { data, info } = await image.resize(MINIATURE, MINIATURE, { fit: "inside" }).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: new Uint8Array(data) };
}

test("a crop matches its photograph; a different picture of the same kind does not", async () => {
  const whole = await miniature(scene(building));
  const crop = await miniature(scene(building), { left: 60, top: 40, width: 400, height: 320 });
  const different = await miniature(scene(other));
  assert.ok(cropMatch(whole, whole) > 0.99);
  assert.ok(cropMatch(whole, crop) >= SAME_PHOTOGRAPH, `crop ${cropMatch(whole, crop)}`);
  assert.ok(cropMatch(crop, whole) >= SAME_PHOTOGRAPH, "either order");
  assert.ok(cropMatch(whole, different) < SAME_PHOTOGRAPH, `different ${cropMatch(whole, different)}`);
});

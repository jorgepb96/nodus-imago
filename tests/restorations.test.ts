// Restoration workshop: regions are pasted back without touching the rest of
// the image, whole results take the original's size, the watermark is drawn
// on downloads, and each provider is asked in its own format.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Repository } from "../electron/db/repository";
import { Restorations, watermarkSvg } from "../electron/db/restorations";
import { ApiProviders } from "../electron/ai/apiProviders";
import { decodeImageModel, encodeImageModel, restorationPrompt } from "../shared/restoration";

async function withImage(run: (ctx: { repo: Repository; assetId: string; root: string }) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-restore-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv("Postales", ["ID"], ["title"], [["A"]]);
    const rowId = (repo.db.prepare("SELECT id FROM db_rows").get() as { id: string }).id;
    repo.db.prepare("INSERT INTO db_columns(id,database_id,name,type,position,config_json,created_at,updated_at) VALUES('img',?,'Imagen','files',9,'{}','x','x')").run(detail.database.id);
    // A 200×100 grey gradient.
    const raw = Buffer.alloc(200 * 100 * 3);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 200; x++) raw.fill(x, (y * 200 + x) * 3, (y * 200 + x) * 3 + 3);
    const file = path.join(root, "original.png");
    await sharp(raw, { raw: { width: 200, height: 100, channels: 3 } }).png().toFile(file);
    repo.db
      .prepare("INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("a1", detail.database.id, rowId, "img", "original.png", file, 0, "h1", 1, 200, 100, "{}", null, 0, "x");
    await run({ repo, assetId: "a1", root });
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}
const red = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#ff0000" } }).png().toBuffer();

test("a restored region is pasted back; the rest of the image is unchanged", () =>
  withImage(async ({ repo, assetId }) => {
    const restorations = new Restorations(repo);
    const region = { x: 0.25, y: 0.3, w: 0.2, h: 0.4 };
    const input = await restorations.input(assetId, region);
    // 4 % of margin around the region.
    assert.deepEqual(input.crop, { left: 42, top: 26, width: 56, height: 48 });
    assert.equal(input.mimeType, "image/jpeg");
    const saved = await restorations.store({
      assetId, provider: "openai", model: "gpt-image-1", task: "restore", prompt: "x", region, crop: input.crop,
      result: (await red(1024, 1024)).toString("base64"),
    });
    assert.deepEqual([saved.width, saved.height, saved.title], [200, 100, "A"]);
    const { data } = await sharp(restorations.file(saved.id)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * 200 + x) * 3, (y * 200 + x) * 3 + 3)];
    assert.deepEqual(pixel(66, 50), [255, 0, 0], "the centre of the region is the result");
    assert.deepEqual(pixel(10, 10), [10, 10, 10], "outside the region is the original");
    assert.deepEqual(pixel(150, 90), [150, 150, 150]);
    assert.equal(restorations.list({ assetId }).length, 1);
  }));

test("a whole-image result takes the original's size; downloads carry the watermark", () =>
  withImage(async ({ repo, assetId, root }) => {
    const restorations = new Restorations(repo);
    const saved = await restorations.store({
      assetId, provider: "gemini", model: "gemini-2.5-flash-image", task: "colorize", prompt: "x", region: null, crop: null,
      result: (await red(1024, 1024)).toString("base64"),
    });
    assert.deepEqual([saved.width, saved.height], [200, 100]);
    const plain = path.join(root, "plain.png"),
      marked = path.join(root, "marked.png");
    await restorations.export({ id: saved.id, target: plain, format: "png", watermark: { enabled: false, text: "Editada con IA", position: "bottom-right" } });
    await restorations.export({ id: saved.id, target: marked, format: "png", watermark: { enabled: true, text: "Editada con IA", position: "bottom-right" } });
    const corner = async (file: string) => {
      const { data } = await sharp(file).removeAlpha().extract({ left: 150, top: 85, width: 40, height: 10 }).raw().toBuffer({ resolveWithObject: true });
      return data.reduce((n, v) => n + v, 0) / data.length;
    };
    assert.ok((await corner(marked)) < (await corner(plain)) - 20, "the dark box of the mark is in the corner");
    assert.match(watermarkSvg(400, 300, { enabled: true, text: "A <b> & c", position: "top-left" }).toString(), /A &lt;b&gt; &amp; c/);
    await restorations.delete(saved.id);
    assert.deepEqual(restorations.list({}), []);
    await assert.rejects(fs.access(path.join(root, "restorations", saved.id + ".png")));
  }));

test("each provider is asked for an image in its own format", async () => {
  const png = await sharp(Buffer.from(Array.from({ length: 32 * 32 * 3 }, (_, i) => (i * 37) % 256)), { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
  const calls: { url: string; init: RequestInit }[] = [];
  const answers: Record<string, unknown> = {
    "/images/edits": { data: [{ b64_json: png.toString("base64") }] },
    ":generateContent": { candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { data: png.toString("base64") } }] } }] },
    "/chat/completions": { choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] } }] },
  };
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(answers).find((k) => url.includes(k))!;
    return new Response(JSON.stringify(answers[key]), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const secrets = { get: () => "test-key", encryption: { available: () => true } } as never;
  const providers = new ApiProviders(secrets, fetcher);
  const base = { profiles: {}, remoteEnabled: true, prompt: "Restaura", image: png, mimeType: "image/png" as const };
  for (const choice of [
    { provider: "openai" as const, model: "gpt-image-1" },
    { provider: "gemini" as const, model: "gemini-2.5-flash-image" },
    { provider: "openrouter" as const, model: "google/gemini-2.5-flash-image" },
  ]) {
    const out = await providers.editImage({ ...base, choice }, new AbortController().signal);
    assert.ok(out.equals(png), choice.provider);
  }
  assert.match(calls[0].url, /api\.openai\.com\/v1\/images\/edits$/);
  assert.ok(calls[0].init.body instanceof FormData);
  assert.equal((calls[0].init.body as FormData).get("model"), "gpt-image-1");
  assert.match(calls[1].url, /models\/gemini-2\.5-flash-image:generateContent$/);
  assert.deepEqual(JSON.parse(String(calls[1].init.body)).generationConfig, { responseModalities: ["IMAGE", "TEXT"] });
  const chat = JSON.parse(String(calls[2].init.body));
  assert.deepEqual(chat.modalities, ["image", "text"]);
  assert.match(chat.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  // Providers without image output and disabled remote APIs send nothing.
  await assert.rejects(providers.editImage({ ...base, choice: { provider: "anthropic", model: "x" } }, new AbortController().signal), /no genera imágenes/);
  await assert.rejects(providers.editImage({ ...base, remoteEnabled: false, choice: { provider: "openai", model: "gpt-image-1" } }, new AbortController().signal), /desactivadas/);
  assert.equal(calls.length, 3);
});

test("task instructions keep the image as it is and mention crops", () => {
  assert.match(restorationPrompt("restore", "es", false), /No añadas ni elimines elementos/);
  assert.match(restorationPrompt("colorize", "en", true), /crop of a larger one/);
  assert.equal(restorationPrompt("custom", "es", false), "");
  assert.deepEqual(decodeImageModel(encodeImageModel("openrouter", "google/gemini-2.5-flash-image")), { provider: "openrouter", model: "google/gemini-2.5-flash-image" });
  assert.equal(decodeImageModel("anthropic|claude"), null);
});

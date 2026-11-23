// Restoration workshop: regions are pasted back without touching the rest of
// the image and with the tone of their surroundings, whole results line up
// with their source, colourising keeps the source's light, a monochrome photo
// keeps its tint, every version can be measured and shown with its changes,
// the watermark is drawn on downloads, and each provider is asked in its own
// format.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Repository } from "../electron/db/repository";
import { Restorations, findFit, keepLight, monochromeTint, watermarkSvg } from "../electron/db/restorations";
import { ApiProviders } from "../electron/ai/apiProviders";
import { closestAspect, decodeImageModel, encodeImageModel, restorationContext, restorationPrompt, restorationRequest } from "../shared/restoration";

async function withImage(
  run: (ctx: { repo: Repository; assetId: string; root: string }) => Promise<void>,
  /** Changes the grey gradient before it is saved (a stain, a pattern). */
  draw?: (raw: Buffer, width: number, height: number) => void,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-restore-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv("Postales", ["ID"], ["title"], [["A"]]);
    const rowId = (repo.db.prepare("SELECT id FROM db_rows").get() as { id: string }).id;
    repo.db.prepare("INSERT INTO db_columns(id,database_id,name,type,position,config_json,created_at,updated_at) VALUES('img',?,'Imagen','files',9,'{}','x','x')").run(detail.database.id);
    // A 200×100 grey gradient.
    const raw = Buffer.alloc(200 * 100 * 3);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 200; x++) raw.fill(x, (y * 200 + x) * 3, (y * 200 + x) * 3 + 3);
    draw?.(raw, 200, 100);
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

test("a repaired region is pasted back with the tone around it; the rest of the image is unchanged", () =>
  withImage(
    async ({ repo, assetId }) => {
      const restorations = new Restorations(repo);
      const region = { x: 0.25, y: 0.3, w: 0.2, h: 0.4 };
      const input = await restorations.input(assetId, region);
      // 4 % of margin around the region.
      assert.deepEqual(input.crop, { left: 42, top: 26, width: 56, height: 48 });
      assert.deepEqual(input.sent, [56, 48]);
      assert.equal(input.mimeType, "image/jpeg");
      // The model removed the stain but answered 40 levels lighter, at its own size.
      const answer = Buffer.alloc(56 * 48 * 3);
      for (let y = 0; y < 48; y++) for (let x = 0; x < 56; x++) answer.fill(42 + x + 40, (y * 56 + x) * 3, (y * 56 + x) * 3 + 3);
      const saved = await restorations.store({
        assetId, provider: "gemini", model: "m", task: "repair", prompt: "x", region, crop: input.crop,
        result: (await sharp(answer, { raw: { width: 56, height: 48, channels: 3 } }).resize(1024, 1024, { fit: "fill" }).png().toBuffer()).toString("base64"),
      });
      assert.deepEqual([saved.width, saved.height, saved.title, saved.baseId], [200, 100, "A", null]);
      const { data } = await sharp(restorations.file(saved.id)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) => [...data.subarray((y * 200 + x) * 3, (y * 200 + x) * 3 + 3)];
      assert.ok(Math.abs(pixel(70, 50)[0] - 70) <= 4, `the stain is gone and the tone is the original's (${pixel(70, 50)})`);
      assert.deepEqual(pixel(10, 10), [10, 10, 10], "outside the region is the original");
      assert.deepEqual(pixel(150, 90), [150, 150, 150]);
      assert.equal(restorations.list({ assetId }).length, 1);
      assert.equal(saved.check?.level, "faithful");
    },
    (raw) => {
      for (let y = 45; y < 56; y++) for (let x = 65; x < 76; x++) raw.fill(0, (y * 200 + x) * 3, (y * 200 + x) * 3 + 3);
    },
  ));

test("a whole-image result keeps its source's proportions and a small scan the model's larger size; downloads carry the watermark", () =>
  withImage(async ({ repo, assetId, root }) => {
    const restorations = new Restorations(repo);
    // A flat red answer is not the picture: colourising cannot keep its detail and says so.
    const saved = await restorations.store({
      assetId, provider: "gemini", model: "gemini-2.5-flash-image", task: "colorize", prompt: "x", region: null, crop: null,
      result: (await red(1024, 1024)).toString("base64"),
    });
    assert.deepEqual([saved.width, saved.height], [1024, 512]);
    assert.match(saved.notes?.[0] ?? "", /cambiado demasiado/);
    assert.notEqual(saved.check?.level, "faithful");
    const plain = path.join(root, "plain.png"),
      marked = path.join(root, "marked.png");
    await restorations.export({ id: saved.id, target: plain, format: "png", watermark: { enabled: false, text: "Editada con IA", position: "bottom-right" } });
    await restorations.export({ id: saved.id, target: marked, format: "png", watermark: { enabled: true, text: "Editada con IA", position: "bottom-right" } });
    const corner = async (file: string) => {
      // The top edge of the mark's box, above its text (bottom-right corner of a 1024×512 version).
      const { data } = await sharp(file).removeAlpha().extract({ left: 866, top: 474, width: 140, height: 4 }).raw().toBuffer({ resolveWithObject: true });
      return data.reduce((n, v) => n + v, 0) / data.length;
    };
    assert.ok((await corner(marked)) < (await corner(plain)) - 20, `the dark box of the mark is in the corner (${await corner(marked)} vs ${await corner(plain)})`);
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
    const out = await providers.editImage({ ...base, choice, aspect: "3:4" }, new AbortController().signal);
    assert.ok(out.equals(png), choice.provider);
  }
  assert.match(calls[0].url, /api\.openai\.com\/v1\/images\/edits$/);
  assert.ok(calls[0].init.body instanceof FormData);
  assert.equal((calls[0].init.body as FormData).get("model"), "gpt-image-1");
  assert.match(calls[1].url, /models\/gemini-2\.5-flash-image:generateContent$/);
  // The answer keeps the shape of what was sent.
  assert.deepEqual(JSON.parse(String(calls[1].init.body)).generationConfig, { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "3:4" } });
  const chat = JSON.parse(String(calls[2].init.body));
  assert.deepEqual(chat.image_config, { aspect_ratio: "3:4" });
  assert.deepEqual(chat.modalities, ["image", "text"]);
  assert.match(chat.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  // Providers without image output and disabled remote APIs send nothing.
  await assert.rejects(providers.editImage({ ...base, choice: { provider: "anthropic", model: "x" } }, new AbortController().signal), /no genera imágenes/);
  await assert.rejects(providers.editImage({ ...base, remoteEnabled: false, choice: { provider: "openai", model: "gpt-image-1" } }, new AbortController().signal), /desactivadas/);
  assert.equal(calls.length, 3);
  // A model that answers with words instead of an image says what it said.
  answers[":generateContent"] = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "No puedo editar esta imagen." }] } }] };
  await assert.rejects(providers.editImage({ ...base, choice: { provider: "gemini", model: "x" } }, new AbortController().signal), /Respondió: «No puedo editar esta imagen\.»/);
});

test("task instructions keep the image as it is, name the damage and mention crops; the context follows them", () => {
  assert.match(restorationPrompt("restore", "es", false), /No cambies la forma de la fotografía/);
  assert.match(restorationPrompt("repair", "es", false), /emulsión[\s\S]*No redibujes las caras/);
  assert.match(restorationPrompt("colorize", "en", true), /crop of a larger one/);
  // Colourising uses what is known for colours; repairing must not change any.
  const fields = [{ label: "Lugar", value: "Galicia" }, { label: null, value: "Retrato" }];
  assert.match(restorationContext({ note: "Fachada ocre", fields }, "es", "colorize"), /elegir colores[\s\S]*Fachada ocre\nLugar: Galicia\nRetrato$/);
  assert.match(restorationContext({ fields }, "es", "repair"), /no cambies sus colores ni su tonalidad/);
  assert.equal(restorationContext({ note: " ", fields: [] }, "es"), "");
  assert.equal(restorationRequest("Haz esto. ", ""), "Haz esto.");
  assert.equal(restorationRequest("Haz esto.", "Contexto"), "Haz esto.\n\nContexto");
  assert.deepEqual([closestAspect(1500, 1000), closestAspect(477, 643), closestAspect(1200, 678), closestAspect(500, 500)], ["3:2", "3:4", "16:9", "1:1"]);
  assert.equal(restorationPrompt("custom", "es", false), "");
  assert.deepEqual(decodeImageModel(encodeImageModel("openrouter", "google/gemini-2.5-flash-image")), { provider: "openrouter", model: "google/gemini-2.5-flash-image" });
  assert.equal(decodeImageModel("anthropic|claude"), null);
});

/** A deterministic texture (blobs and stripes) that lines up only where it should. */
const texture = (width: number, height: number) => {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = 128 + 60 * Math.sin(x / 7) * Math.cos(y / 11) + 50 * Math.sin((x + 2 * y) / 23);
      raw.fill(Math.max(0, Math.min(255, Math.round(v))), (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  return raw;
};

test("a model's answer that zoomed or shifted the picture is found and lined up", async () => {
  const source = await sharp(texture(300, 300), { raw: { width: 300, height: 300, channels: 3 } }).png().toBuffer();
  // The model zoomed in 6 % on the middle of the picture.
  const zoomed = await sharp(source).extract({ left: 9, top: 9, width: 282, height: 282 }).resize(300, 300).png().toBuffer();
  const fit = await findFit(source, zoomed);
  assert.ok(Math.abs(fit.sx - 1.06) <= 0.02 && Math.abs(fit.sy - 1.06) <= 0.02, JSON.stringify(fit));
  assert.ok(Math.abs(fit.tx + 0.03) <= 0.015 && fit.score > 0.9, JSON.stringify(fit));
  const same = await findFit(source, source);
  assert.deepEqual([same.sx, same.sy, same.tx, same.ty], [1, 1, 0, 0]);
});

test("colourising keeps the source's light and takes only the model's colour", async () => {
  const width = 120,
    height = 80;
  const grey = texture(width, height);
  const source = await sharp(grey, { raw: { width, height, channels: 3 } }).png().toBuffer();
  // The model's colour: warm, and darker than the source.
  const warm = Buffer.alloc(grey.length);
  for (let i = 0; i < grey.length; i += 3) [warm[i], warm[i + 1], warm[i + 2]] = [grey[i] * 0.8, grey[i] * 0.6, grey[i] * 0.4];
  const out = await sharp(await keepLight(source, await sharp(warm, { raw: { width, height, channels: 3 } }).png().toBuffer(), width, height)).raw().toBuffer();
  const luma = (b: Buffer, i: number) => 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
  let worst = 0,
    warmer = 0;
  for (let i = 0; i < out.length; i += 3) {
    worst = Math.max(worst, Math.abs(luma(out, i) - grey[i]));
    if (out[i] > out[i + 2] + 4) warmer++;
  }
  assert.ok(worst <= 12, `the light is the source's (worst ${worst})`);
  assert.ok(warmer > (out.length / 3) * 0.5, "the colour is the model's");
});

test("restoring a monochrome photograph keeps its tint even when the model added colour", () =>
  withImage(async ({ repo, assetId }) => {
    const restorations = new Restorations(repo);
    const original = await sharp(repo.asset(assetId).original_path).png().toBuffer();
    assert.ok(await monochromeTint(original), "a grey gradient is monochrome");
    // The answer: the same gradient, but blue.
    const blue = Buffer.alloc(200 * 100 * 3);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 200; x++) [blue[(y * 200 + x) * 3], blue[(y * 200 + x) * 3 + 1], blue[(y * 200 + x) * 3 + 2]] = [x * 0.4, x * 0.6, Math.min(255, x + 60)];
    const saved = await restorations.store({
      assetId, provider: "gemini", model: "m", task: "restore", prompt: "x", region: null, crop: null,
      result: (await sharp(blue, { raw: { width: 200, height: 100, channels: 3 } }).png().toBuffer()).toString("base64"),
    });
    assert.match(saved.notes?.join(" ") ?? "", /tonalidad del original/);
    const { data } = await sharp(restorations.file(saved.id)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let colourful = 0;
    for (let i = 0; i < data.length; i += 3) if (Math.abs(data[i] - data[i + 2]) > 6) colourful++;
    assert.equal(colourful, 0, "no pixel came back coloured");
  }));

test("versions are measured against what they started from, with what changed marked in red", () =>
  withImage(
    async ({ repo, assetId, root }) => {
      const restorations = new Restorations(repo);
      const original = await sharp(repo.asset(assetId).original_path).png().toBuffer();
      const keep = await restorations.store({ assetId, provider: "gemini", model: "m", task: "sharpen", prompt: "x", region: null, crop: null, result: original.toString("base64") });
      assert.deepEqual([keep.check?.level, (keep.check?.similarity ?? 0) >= 0.99], ["faithful", true]);
      // A version with a new dark square drawn on the stripes.
      const drawn = Buffer.from(texture(200, 100));
      for (let y = 30; y < 70; y++) for (let x = 120; x < 170; x++) drawn.fill(10, (y * 200 + x) * 3, (y * 200 + x) * 3 + 3);
      const changed = await restorations.store({
        assetId, provider: "gemini", model: "m", task: "custom", prompt: "x", region: null, crop: null,
        result: (await sharp(drawn, { raw: { width: 200, height: 100, channels: 3 } }).png().toBuffer()).toString("base64"),
      });
      assert.ok((changed.check?.similarity ?? 1) < keep.check!.similarity);
      const red = async (id: string, x0: number, x1: number) => {
        const { data, info } = await sharp(await restorations.diff(id)).raw().toBuffer({ resolveWithObject: true });
        let n = 0;
        for (let y = 0; y < info.height; y++)
          for (let x = Math.round(x0 * info.width); x < Math.round(x1 * info.width); x++) {
            const i = (y * info.width + x) * 3;
            if (data[i] > data[i + 1] + 60) n++;
          }
        return n;
      };
      assert.equal(await red(keep.id, 0, 1), 0, "an unchanged version has nothing in red");
      assert.ok((await red(changed.id, 0.6, 0.85)) > 300, "the new square is marked");
      assert.equal(await red(changed.id, 0, 0.4), 0, "the rest is not");
      // Colourising the first version: measured against it, not against the original.
      const colour = await restorations.store({
        assetId, provider: "gemini", model: "m", task: "colorize", prompt: "x", region: null, crop: null, baseId: keep.id,
        result: (await sharp(original).tint({ r: 200, g: 150, b: 100 }).png().toBuffer()).toString("base64"),
      });
      assert.equal(colour.baseId, keep.id);
      assert.ok((colour.check?.similarity ?? 0) >= 0.98, JSON.stringify(colour.check));
      await restorations.delete(changed.id);
      await assert.rejects(fs.access(path.join(root, "restorations", changed.id + ".changes.png")));
    },
    (raw, width, height) => texture(width, height).copy(raw),
  ));

test("the record of an image is told to the model in the order of the table's columns", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-restore-context-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv("Fotos", ["Nombre", "Lugar", "Fecha", "Web"], ["title", "text", "text", "text"], [["Boda", "Galicia", "1945", "https://example.org/x"]]);
    const rowId = (repo.db.prepare("SELECT id FROM db_rows").get() as { id: string }).id;
    repo.db.prepare("INSERT INTO db_columns(id,database_id,name,type,position,config_json,created_at,updated_at) VALUES('img',?,'Imagen','files',9,'{}','x','x')").run(detail.database.id);
    repo.db.prepare("INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("a1", detail.database.id, rowId, "img", "x.png", path.join(root, "x.png"), 0, "h1", 1, 10, 10, "{}", null, 0, "x");
    assert.deepEqual(new Restorations(repo).context("a1"), [
      { label: "Nombre", value: "Boda" },
      { label: "Lugar", value: "Galicia" },
      { label: "Fecha", value: "1945" },
    ]);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

// API embeddings, as in Nodus, plus multimodal Gemini Embedding 2. No network:
// every request goes to a recording fetcher.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv } from "node:crypto";
import sharp from "sharp";
import { Secrets } from "../electron/secrets/store";
import { ApiProviders, type EmbeddingRequest } from "../electron/ai/apiProviders";
import { Repository } from "../electron/db/repository";
import { Models } from "../electron/ai/models";
import { Engine } from "../electron/ai/engine";
import { InferenceHost } from "../electron/ai/host";
import { Images } from "../electron/import/images";
import { JobQueue } from "../electron/jobs";
import { embeddingApiMultimodal, embeddingApiText } from "../shared/embeddingApi";

const encryption = {
  available: () => true,
  encrypt: (s: string) => {
    const c = createCipheriv("aes-256-gcm", Buffer.alloc(32, 1), Buffer.alloc(12, 2));
    return Buffer.concat([c.update(s, "utf8"), c.final(), c.getAuthTag()]);
  },
  decrypt: (b: Buffer) => {
    const d = createDecipheriv("aes-256-gcm", Buffer.alloc(32, 1), Buffer.alloc(12, 2));
    d.setAuthTag(b.subarray(-16));
    return d.update(b.subarray(0, -16), undefined, "utf8") + d.final("utf8");
  },
};
const vector = (n: number, axis = 0) => Array.from({ length: n }, (_, i) => (i === axis ? 1 : 0.001));
const request = (patch: Partial<EmbeddingRequest>): EmbeddingRequest => ({
  embedding: true,
  provider: "gemini",
  model: "gemini-embedding-2",
  dimensions: 8,
  profiles: {},
  remoteEnabled: true,
  inputs: [{ text: "plaza mayor", role: "query" }],
  ...patch,
});

test("Gemini Embedding 2 embeds text and images through the native batch endpoint", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-embed-api-"));
  try {
    const secrets = new Secrets(root, encryption);
    secrets.set("gemini", "unit-test-key");
    const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
    const providers = new ApiProviders(secrets, async (url, options) => {
      const body = JSON.parse(options!.body as string);
      calls.push({ url: String(url), headers: options!.headers as Record<string, string>, body });
      return new Response(JSON.stringify({ embeddings: body.requests.map((_: unknown, i: number) => ({ values: vector(8, i) })) }));
    });
    const vectors = await providers.embed(
      request({
        inputs: [
          { text: "nazarenos en procesión", role: "query" },
          { image: "AAAA", mimeType: "image/jpeg" },
        ],
      }),
      new AbortController().signal,
    );
    assert.equal(vectors.length, 2);
    const call = calls[0];
    assert.equal(call.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents");
    assert.equal(call.headers["x-goog-api-key"], "unit-test-key");
    assert.equal(call.headers.Authorization, undefined);
    assert.equal(call.body.requests[0].content.parts[0].text, "task: search result | query: nazarenos en procesión");
    assert.deepEqual(call.body.requests[1].content.parts[0], { inline_data: { mime_type: "image/jpeg", data: "AAAA" } });
    assert.equal(call.body.requests[0].output_dimensionality, 8);
    assert.equal(call.body.requests[0].taskType, undefined);
    // The text-only Gemini model takes a task type instead of a prefix.
    await providers.embed(request({ model: "gemini-embedding-001", inputs: [{ text: "x", role: "document" }] }), new AbortController().signal);
    assert.equal(calls[1].body.requests[0].taskType, "RETRIEVAL_DOCUMENT");
    assert.equal(calls[1].body.requests[0].content.parts[0].text, "x");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("OpenAI-compatible embeddings, local servers without keys, and every refusal path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-embed-api-"));
  try {
    const secrets = new Secrets(root, encryption);
    secrets.set("openai", "unit-test-key");
    const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
    let reply: (body: any) => unknown = (body) => ({
      data: body.input.map((_: unknown, i: number) => ({ index: i, embedding: vector(8, i) })).reverse(),
    });
    const providers = new ApiProviders(secrets, async (url, options) => {
      const body = JSON.parse(options!.body as string);
      calls.push({ url: String(url), body, headers: options!.headers as Record<string, string> });
      return new Response(JSON.stringify(reply(body)));
    });
    const signal = new AbortController().signal;
    const out = await providers.embed(
      request({ provider: "openai", model: "text-embedding-3-small", inputs: [{ text: "a", role: "document" }, { text: "b", role: "document" }] }),
      signal,
    );
    // Results are reordered by their index field.
    assert.equal(out[0][0], 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/embeddings");
    assert.equal(calls[0].body.dimensions, 8);
    assert.equal(calls[0].headers.Authorization, "Bearer unit-test-key");
    // Ollama needs no key, keeps native size and gets the model's own prefixes.
    await providers.embed(request({ provider: "ollama", model: "nomic-embed-text", remoteEnabled: false, inputs: [{ text: "q", role: "query" }] }), signal);
    assert.equal(calls[1].url, "http://127.0.0.1:11434/v1/embeddings");
    assert.equal(calls[1].body.dimensions, undefined);
    assert.deepEqual(calls[1].body.input, ["search_query: q"]);
    // Remote APIs disabled: nothing is sent.
    await assert.rejects(providers.embed(request({ provider: "openai", remoteEnabled: false }), signal), /desactivadas/);
    // Images never reach a text-only model.
    await assert.rejects(
      providers.embed(request({ provider: "openai", model: "text-embedding-3-small", inputs: [{ image: "AAAA", mimeType: "image/jpeg" }] }), signal),
      /solo admite texto/,
    );
    // Malformed replies are rejected rather than stored.
    reply = () => ({ data: [{ index: 0, embedding: [0, 0, 0] }] });
    await assert.rejects(providers.embed(request({ provider: "openai", model: "text-embedding-3-small" }), signal), /inválidos/);
    // Disabled APIs and refused images never reached the network.
    assert.equal(calls.length, 3);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("text prefixes follow each model family and only Gemini Embedding 2 is multimodal", () => {
  assert.equal(embeddingApiText("embeddinggemma", "document", "t"), "title: none | text: t");
  assert.equal(embeddingApiText("intfloat/multilingual-e5-large", "query", "t"), "query: t");
  assert.equal(embeddingApiText("text-embedding-3-small", "query", "t"), "t");
  assert.ok(embeddingApiMultimodal({ provider: "gemini", model: "gemini-embedding-2" }));
  assert.ok(!embeddingApiMultimodal({ provider: "gemini", model: "gemini-embedding-001" }));
  assert.ok(!embeddingApiMultimodal({ provider: "openrouter", model: "gemini-embedding-2" }));
});

test("an API model indexes records and images in batches, under its own contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-embed-engine-")),
    repo = new Repository(root),
    host = new InferenceHost(repo, "not-used"),
    engine = new Engine(repo, new Models(repo), host),
    images = new Images(repo);
  let queue: JobQueue | undefined;
  try {
    const localContract = engine.contract();
    repo.updateSettings({
      embeddingModel: "api-embedding",
      embeddingApi: { provider: "gemini", model: "gemini-embedding-2", dimensions: 64 },
    });
    assert.throws(() => engine.enqueueIndex(), /Activa el uso opcional de APIs/);
    repo.updateSettings({ remoteEnabled: true });
    const geminiContract = engine.contract();
    assert.notEqual(geminiContract, localContract);
    const d = repo.importCsv(
      "Fotos",
      ["ID", "Descripción"],
      ["title", "text"],
      Array.from({ length: 40 }, (_, i) => [`R${i}`, i === 7 ? "Procesión de nazarenos" : `Vista ${i}`]),
    );
    const column = repo.addColumn(d.database.id, "Imágenes", "attachment").id;
    const rows = repo.literal({ databaseIds: [d.database.id], limit: 100 }).rows;
    for (let i = 0; i < 8; i++) {
      const file = path.join(root, `img${i}.jpg`);
      await sharp({ create: { width: 30, height: 20, channels: 3, background: { r: i * 30, g: 90, b: 40 } } }).jpeg().toFile(file);
      await images.importOne({ databaseId: d.database.id, columnId: column, storage: "link", createUnmatched: false, files: [{ path: file, rowId: rows[i].id }] }, 0);
    }
    const sent: EmbeddingRequest[] = [];
    engine.remoteEmbed = async (input) => {
      sent.push(input);
      return input.inputs.map((item) =>
        vector(64, "text" in item && /nazaren|procesi/i.test(item.text) ? 1 : 2),
      );
    };
    queue = new JobQueue(repo, images, new Models(repo), engine, () => {});
    engine.enqueueIndex([d.database.id]);
    queue.pump();
    await queue.task;
    const job = repo.jobs()[0];
    assert.equal(job.state, "completed");
    assert.equal(job.done, 48);
    // 40 records in two requests (32 + 8), 8 images in two (6 + 2).
    assert.deepEqual(sent.map((s) => s.inputs.length), [32, 8, 6, 2]);
    assert.ok(sent.slice(2).every((s) => s.inputs.every((item) => "image" in item && item.mimeType === "image/jpeg")));
    assert.equal((repo.db.prepare("SELECT count(*) n FROM record_embeddings WHERE contract=?").get(geminiContract) as { n: number }).n, 40);
    assert.equal((repo.db.prepare("SELECT count(*) n FROM embeddings WHERE contract=?").get(geminiContract) as { n: number }).n, 8);
    // The fake images all share one vector, so only the text lane can rank here.
    const page = await engine.search({ mode: "semantic", semanticSources: "text", query: "nazarenos", databaseIds: [d.database.id] });
    assert.equal(page.rows[0].title, "R7");
    // A model that answers with another size stops the job with a clear message.
    repo.updateSettings({ embeddingApi: { provider: "gemini", model: "gemini-embedding-2", dimensions: 128 } });
    await assert.rejects(engine.embed([{ text: "x", role: "query" }]), /ajusta las dimensiones a 64/);
    // A text-only model without LFM3 indexes records only and never sends images.
    repo.updateSettings({ embeddingApi: { provider: "openai", model: "text-embedding-3-small", dimensions: 64 } });
    assert.equal(engine.imageMode(), "none");
    const payload = JSON.parse((repo.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(engine.enqueueIndex([d.database.id])) as { payload_json: string }).payload_json);
    assert.equal(payload.assets.length, 0);
    assert.equal(payload.rows.length, 40);
  } finally {
    await queue?.close();
    host.close();
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("changing the EmbeddingGemma visual budget keeps text vectors and separates image vectors", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-budget-")),
    repo = new Repository(root),
    host = new InferenceHost(repo, "not-used"),
    engine = new Engine(repo, new Models(repo), host);
  try {
    repo.updateSettings({ embeddingModel: "embeddinggemma2-onnx" });
    const image280 = engine.contract(), text280 = engine.textContract();
    assert.equal(image280, text280);
    repo.updateSettings({ visionBudget: 140 });
    assert.notEqual(engine.contract(), image280);
    assert.equal(engine.textContract(), text280);
    repo.updateSettings({ visionBudget: 280 });
    // The default budget keeps the contract existing indexes were built with.
    assert.equal(engine.contract(), image280);
  } finally {
    host.close();
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv } from "node:crypto";
import sharp from "sharp";
import { Secrets } from "../electron/secrets/store";
import { ApiProviders, ApiFailure, type CompletionRequest } from "../electron/ai/apiProviders";
import { Repository } from "../electron/db/repository";
import { Models } from "../electron/ai/models";
import { Engine } from "../electron/ai/engine";
import { InferenceHost } from "../electron/ai/host";
import { Images } from "../electron/import/images";
import { providerBase } from "../shared/aiConfig";
import { JobQueue } from "../electron/jobs";

const encryption = {
  available: () => true,
  encrypt: (s: string) => {
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.alloc(32, 1),
      Buffer.alloc(12, 2),
    );
    return Buffer.concat([
      cipher.update(s, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  },
  decrypt: (b: Buffer) => {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.alloc(32, 1),
      Buffer.alloc(12, 2),
    );
    decipher.setAuthTag(b.subarray(-16));
    return (
      decipher.update(b.subarray(0, -16), undefined, "utf8") +
      decipher.final("utf8")
    );
  },
};
test("encrypted secrets are independent per provider, never plaintext, and unavailable encryption fails closed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-secret-"));
  try {
    const store = new Secrets(root, encryption);
    store.set("openai", "unit-test-key");
    assert.equal(store.get("openai"), "unit-test-key");
    assert.equal(store.get("gemini"), null);
    assert.ok(
      !(await fs.readFile(path.join(root, "ai_key_openai.bin"))).includes(
        "unit-test-key",
      ),
    );
    const disabled = new Secrets(root, {
      ...encryption,
      available: () => false,
    });
    assert.equal(disabled.get("openai"), null);
    assert.throws(
      () => disabled.set("gemini", "unit-test-key"),
      /no está disponible/,
    );
    store.clear("openai");
    assert.equal(store.get("openai"), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("remote API gate blocks all network attempts, URL credentials and nonlocal HTTP", async () => {
  let requests = 0;
  const providers = new ApiProviders(
    new Secrets("/not-used", { ...encryption, available: () => false }),
    async () => {
      requests++;
      return new Response("{}");
    },
  );
  await assert.rejects(
    providers.complete(
      {
        choice: { provider: "openai", model: "test" },
        profiles: {},
        remoteEnabled: false,
        prompt: "image",
        system: "system",
        images: [],
      },
      new AbortController().signal,
    ),
    /desactivadas/,
  );
  assert.equal(requests, 0);
  assert.throws(
    () =>
      providerBase("custom", {
        custom: { baseUrl: "http://example.com/v1", models: [] },
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      providerBase("custom", {
        custom: { baseUrl: "https://secret@example.com/v1", models: [] },
      }),
    /claves/,
  );
  assert.equal(providerBase("ollama", {}), "http://127.0.0.1:11434/v1");
});
test("the visual-tag model catalogue prefers vision favourites and falls back to compatible models", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-vision-catalogue-"));
  try {
    const secrets = new Secrets(root, encryption);
    secrets.set("gemini", "fixture-key");
    const providers = new ApiProviders(secrets, async (url) => {
      if (String(url).includes("generativelanguage.googleapis.com")) return Response.json({ models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
      ] });
      return new Response("{}", { status: 404 });
    });
    const signal = new AbortController().signal;
    const models = async (favorites: string[], remoteEnabled: boolean) => (await providers.visionCatalog(
      { gemini: { baseUrl: "", models: favorites } }, remoteEnabled, signal,
    )).map((model) => model.choice.model);
    assert.deepEqual(await models([], true), ["gemini-2.5-flash", "gemini-2.5-pro"]);
    assert.deepEqual(await models(["gemini-2.5-pro", "gemini-embedding-001"], true), ["gemini-2.5-pro"]);
    assert.deepEqual(await models(["gemini-embedding-001"], true), ["gemini-2.5-flash", "gemini-2.5-pro"]);
    assert.deepEqual(await models([], false), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("visual tagging uses the catalogue format and effort, and retries a truncated answer once within the model limit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-visual-completion-"));
  try {
    const secrets = new Secrets(root, encryption);
    secrets.set("openrouter", "fixture-key");
    const requests: any[] = [];
    let answers: { choices: { finish_reason: string; message: { content: string | null } }[] }[] = [];
    const providers = new ApiProviders(secrets, async (url, options) => {
      if (String(url).endsWith("/models")) return Response.json({ data: [
        { id: "author/structured", input_modalities: ["image"], supported_parameters: ["structured_outputs"],
          reasoning: { supported_efforts: ["medium", "high"] }, top_provider: { max_completion_tokens: 9000 } },
        { id: "author/native", input_modalities: ["image"], reasoning: { supported_efforts: ["high", "low"] } },
      ] });
      requests.push(JSON.parse(options!.body as string));
      return Response.json(answers.shift());
    });
    const input: CompletionRequest = {
      choice: { provider: "openrouter", model: "author/structured" },
      profiles: {}, remoteEnabled: true, prompt: "Return JSON", system: "Detect regions",
      images: [{ base64: "AAAA", mediaType: "image/jpeg" }], visualTags: true,
    };
    const signal = new AbortController().signal;
    await providers.visionCatalog(input.profiles, true, signal);
    const answer = (finish_reason: string, content: string | null) => ({ choices: [{ finish_reason, message: { content } }] });
    const empty = '{"regions":[]}';
    answers = [answer("length", null), answer("stop", empty)];
    assert.equal(await providers.complete(input, signal), empty);
    assert.deepEqual(requests.map((r) => r.max_tokens), [6144, 9000]);
    assert.deepEqual(requests[1], { ...requests[0], max_tokens: 9000 });
    assert.deepEqual(requests[0].reasoning, { effort: "medium" });
    assert.deepEqual(requests[0].provider, { require_parameters: true });
    assert.equal(requests[0].response_format.type, "json_schema");
    assert.deepEqual(requests[0].response_format.json_schema.schema.required, ["regions"]);

    answers = [answer("length", empty), answer("length", "")];
    await assert.rejects(providers.complete(input, signal), /límite de salida/);
    assert.deepEqual(requests.slice(2).map((r) => r.max_tokens), [6144, 9000]);

    answers = [answer("stop", "  ")];
    await assert.rejects(providers.complete({
      ...input, choice: { provider: "openrouter", model: "author/native" },
    }, signal), /no devolvió una respuesta de texto/);
    assert.equal(requests.length, 5);
    assert.equal(requests[4].reasoning, undefined);
    assert.equal(requests[4].response_format, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("visual tagging uses DeepSeek JSON mode and native high effort", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-deepseek-tags-"));
  try {
    const secrets = new Secrets(root, encryption);
    secrets.set("deepseek", "fixture-key");
    const requests: any[] = [];
    const providers = new ApiProviders(secrets, async (url, options) => {
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      requests.push(JSON.parse(options!.body as string));
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"regions":[]}' } }] });
    });
    const input: CompletionRequest = {
      choice: { provider: "deepseek", model: "deepseek-flash" }, profiles: {},
      remoteEnabled: true, prompt: "Return JSON", system: "Detect regions", images: [],
    };
    const signal = new AbortController().signal;
    await providers.complete(input, signal);
    await providers.complete({ ...input, visualTags: true }, signal);
    assert.equal(requests[0].max_tokens, 1000);
    assert.equal(requests[0].reasoning_effort, undefined);
    assert.equal(requests[0].response_format, undefined);
    assert.equal(requests[1].max_tokens, 6144);
    assert.equal(requests[1].reasoning_effort, "high");
    assert.deepEqual(requests[1].response_format, { type: "json_object" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Nodus-compatible API vision messages use encrypted credentials and retain source images", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-api-"));
  try {
    const secrets = new Secrets(root, encryption);
    secrets.set("openai", "unit-test-key");
    secrets.set("anthropic", "unit-test-key");
    const requests: any[] = [];
    const providers = new ApiProviders(secrets, async (url, options) => {
      requests.push({
        url,
        options,
        body: JSON.parse(options!.body as string),
      });
      return new Response(
        JSON.stringify(
          String(url).endsWith("/messages")
            ? { content: [{ type: "text", text: "A landscape" }] }
            : { choices: [{ message: { content: "A landscape" } }] },
        ),
        { status: 200 },
      );
    });
    for (const provider of ["openai", "anthropic"] as const)
      assert.equal(
        await providers.complete(
          {
            choice: { provider, model: "unit-vision" },
            profiles: {},
            remoteEnabled: true,
            prompt: "Describe observable details",
            system: "Do not invent dates",
            images: [{ base64: "AAAA", mediaType: "image/jpeg" }],
          },
          new AbortController().signal,
        ),
        "A landscape",
      );
    assert.equal(
      requests[0].body.messages[1].content[1].image_url.url,
      "data:image/jpeg;base64,AAAA",
    );
    assert.equal(requests[1].body.messages[0].content[1].source.data, "AAAA");
    assert.equal(requests[1].options.headers["x-api-key"], "unit-test-key");
    assert.equal(requests[0].options.redirect, "error");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("stored API keys require explicit authorization for a custom endpoint before any network request", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "imago-endpoint-trust-"),
  );
  try {
    const secrets = new Secrets(root, encryption);
    secrets.set("openai", "fixture-secret");
    let requests = 0,
      approvals = 0;
    const fetcher = async () => {
      requests++;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "fixture" } }] }),
      );
    };
    const input = {
      choice: { provider: "openai" as const, model: "fixture" },
      profiles: { openai: { baseUrl: "https://other.example/v1", models: [] } },
      remoteEnabled: true,
      prompt: "fixture",
      system: "fixture",
      images: [],
    };
    await assert.rejects(
      new ApiProviders(secrets, fetcher).complete(
        input,
        new AbortController().signal,
      ),
      /Autoriza/,
    );
    assert.equal(requests, 0);
    const providers = new ApiProviders(
      secrets,
      fetcher,
      async (_provider, base) => {
        approvals++;
        return base === "https://other.example/v1";
      },
    );
    assert.equal(
      await providers.complete(input, new AbortController().signal),
      "fixture",
    );
    assert.equal(requests, 1);
    assert.equal(approvals, 1);
    await assert.rejects(
      providers.complete(
        {
          ...input,
          profiles: {
            openai: { baseUrl: "https://changed.example/v1", models: [] },
          },
        },
        new AbortController().signal,
      ),
      /Autoriza/,
    );
    assert.equal(requests, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("whole-column classification queues incrementally, validates taxonomy, protects human values and can undo accepted proposals", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-ai-")),
    repo = new Repository(path.join(root, "data"));
  const host = new InferenceHost(repo, "unused");
  try {
    const d = repo.importCsv(
        "A",
        ["ID"],
        ["title"],
        [["IMG001"], ["IMG002"], ["IMG003"]],
      ),
      c = repo.addColumn(d.database.id, "Categorías", "multi_select");
    repo.saveOptions(c.id, [
      { label: "Paisaje", color: "#336699" },
      { label: "Patrimonio", color: "#886699" },
    ]);
    const option = repo.column(c.id).options[0];
    const rows = repo.literal({}).rows;
    repo.setCell(rows[2].id, c.id, JSON.stringify([option.id]));
    const image = path.join(root, "image.jpg");
    await sharp({
      create: { width: 30, height: 30, channels: 3, background: "#224466" },
    })
      .jpeg()
      .toFile(image);
    const images = new Images(repo),
      attachment = repo.addColumn(d.database.id, "Fotos", "attachment");
    for (const row of rows)
      await images.importOne(
        {
          databaseId: d.database.id,
          columnId: attachment.id,
          storage: "copy",
          createUnmatched: false,
          files: [{ path: image, rowId: row.id }],
        },
        0,
      );
    repo.updateSettings({
      remoteEnabled: true,
      apiDelayMs: 0,
      classificationModel: { provider: "custom", model: "unit-vision" },
      apiProfiles: {
        custom: { baseUrl: "https://example.test/v1", models: ["unit-vision"] },
      },
    });
    let calls = 0;
    const engine = new Engine(repo, new Models(repo), host, async (input) => {
      calls++;
      assert.match(input.prompt, /Paisaje/);
      assert.match(input.prompt, /Patrimonio/);
      assert.equal(input.choice.model, "unit-vision");
      return '["Paisaje"]';
    });
    const id = engine.enqueueAnalysis({
      databaseId: d.database.id,
      columnIds: [c.id],
      language: "es",
      detailed: false,
    });
    const job = repo.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as any,
      payload = JSON.parse(job.payload_json);
    assert.equal(job.total, 2);
    await engine.analyzeOne(payload, 0, new AbortController().signal);
    await engine.analyzeOne(payload, 1, new AbortController().signal);
    assert.equal(calls, 2);
    assert.equal(repo.proposals().length, 2);
    assert.equal(repo.getRow(rows[0].id).cells[c.id], undefined);
    const proposals = repo.proposals();
    repo.setCell(proposals[1].rowId, c.id, JSON.stringify([option.id]));
    const result = repo.reviewProposals(
      proposals.map((p) => p.id),
      "accept",
    );
    assert.equal(result.applied, 1);
    assert.equal(result.conflicts, 1);
    const provenance = repo.provenance(proposals[0].rowId);
    assert.equal(provenance.length, 1);
    assert.equal(provenance[0].state, "accepted");
    assert.equal(provenance[0].columnId, c.id);
    assert.match(provenance[0].model, /unit-vision/);
    assert.equal(repo.undo(), 1);
    assert.equal(repo.getRow(proposals[0].rowId).cells[c.id], undefined);
    assert.ok(repo.getRow(rows[2].id).cells[c.id]);
    const bad = new Engine(
      repo,
      new Models(repo),
      host,
      async () => '["Una categoría inventada"]',
    );
    await assert.rejects(
      bad.analyzeOne(payload, 0, new AbortController().signal),
      /vocabulario/,
    );
  } finally {
    host.close();
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("fatal API failures stop a whole-column queue without spending requests on remaining items", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-fatal-")),
    repo = new Repository(root),
    images = new Images(repo),
    models = new Models(repo),
    host = new InferenceHost(repo, "unused");
  try {
    let calls = 0;
    const engine = new Engine(repo, models, host);
    engine.analyzeOne = async () => {
      calls++;
      throw new ApiFailure("Authentication failed");
    };
    const id = repo.newJob(
        "analyze",
        { items: Array(10).fill({ rowId: "not-read", columnId: "not-read" }) },
        10,
      ),
      queue = new JobQueue(repo, images, models, engine, () => {});
    queue.pump();
    await queue.task;
    assert.equal(repo.jobs()[0].state, "failed");
    assert.equal(repo.jobs()[0].done, 0);
    assert.equal(calls, 1);
    await queue.close();
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

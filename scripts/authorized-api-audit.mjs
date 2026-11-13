// Manual, opt-in, real native queues. Never reads or prints decrypted keys.
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { launchNative, waitNativeJob } from "./native-test-support.mjs";

if (process.env.IMAGO_AUTHORIZED_API_AUDIT !== "1")
  throw Error(
    "This manual audit requires explicit authorization and an isolated profile.",
  );
const root = path.resolve("test-results/authorized-api-audit-20261113");
const authorization = JSON.parse(
  await fs.readFile(path.join(root, "authorization.json")),
);
assert.equal(authorization.maximumUsdPerProvider.openrouter, 1);
assert.equal(authorization.maximumUsdPerProvider.gemini, 1);
const images = JSON.parse(await fs.readFile(path.join(root, "images.json")));
assert.equal(images.length, 10);
const reportPath = path.join(root, "audit.json");
try {
  await fs.access(reportPath);
  throw Error(
    "Audit already started; inspect its durable report before any further spending.",
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const report = {
  started: new Date().toISOString(),
  authorization: { maximumUsdPerProvider: { openrouter: 1, gemini: 1 } },
  models: [],
  ledger: [],
  checks: [],
  errors: [],
  images: images.map(({ file, ...rest }) => rest),
};
const persist = async () => {
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  authorization.apiRequestsMade = report.ledger.length;
  authorization.costsByProvider = Object.fromEntries(
    ["openrouter", "gemini"].map((provider) => {
      const entries = report.ledger.filter((x) => x.provider === provider);
      return [
        provider,
        {
          actualReportedUsd: entries.reduce(
            (s, x) => s + (x.actualReportedUsd || 0),
            0,
          ),
          estimatedUsd: entries.reduce((s, x) => s + (x.estimatedUsd || 0), 0),
          budgetChargeUsd: entries.reduce((s, x) => s + x.budgetChargeUsd, 0),
        },
      ];
    }),
  );
  authorization.spentUsd = Object.values(authorization.costsByProvider).reduce(
    (s, x) => s + x.actualReportedUsd + x.estimatedUsd,
    0,
  );
  await fs.writeFile(
    path.join(root, "authorization.json"),
    JSON.stringify(authorization, null, 2),
    { mode: 0o600 },
  );
};
await persist();
const catalogue = await (
  await fetch("https://openrouter.ai/api/v1/models")
).json();
await fs.writeFile(
  path.join(root, "catalog-openrouter-audit.json"),
  JSON.stringify(catalogue, null, 2),
);
const selected = [
  "google/gemma-3-4b-it",
  "mistralai/ministral-3b-2512",
  "qwen/qwen3.5-9b",
].map((id) => {
  const m = catalogue.data.find((x) => x.id === id);
  assert.ok(m?.architecture.input_modalities.includes("image"));
  assert.ok(
    Number(m.pricing.prompt) <= 0.00000011 &&
      Number(m.pricing.completion) <= 0.0000002,
  );
  // Price filters prevent more expensive upstreams; full context is reserved
  // before sending, not a guess at the compressed image's token count.
  return {
    provider: "openrouter",
    model: id,
    context: m.context_length,
    input: Number(m.pricing.prompt) * 1.2,
    output: Number(m.pricing.completion) * 1.2,
    reasoning: m.supported_parameters.includes("reasoning"),
  };
});
selected.push({
  provider: "gemini",
  model: "gemini-2.5-flash-lite",
  context: 1048576,
  input: 0.1 / 1e6,
  output: 0.4 / 1e6,
});
report.priceSources = [
  "https://openrouter.ai/api/v1/models",
  "https://aistudio.google.com/docs/pricing#gemini-2.5-flash-lite",
];
report.priceCaps = selected;
await persist();
const seen = new Set();
const bases = {
  openrouter: "https://openrouter.ai/api/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};
// A single forwarding gate serializes both providers, durably reserves cost,
// suppresses retries after uncertain results, and returns actual upstream text.
let forwarding = Promise.resolve();
const server = http.createServer((req, res) => {
  forwarding = forwarding
    .then(async () => {
      const match = /^\/(openrouter|gemini)\/chat\/completions$/.exec(
        req.url || "",
      );
      if (req.method !== "POST" || !match) {
        res.writeHead(404).end();
        return;
      }
      const provider = match[1];
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8 * 2 ** 20) throw Error("Oversized audit request");
      }
      const payload = JSON.parse(body),
        model = selected.find(
          (m) => m.provider === provider && m.model === payload.model,
        );
      if (!model || !req.headers.authorization) {
        res.writeHead(403).end();
        return;
      }
      const hash = createHash("sha256")
        .update(provider + body)
        .digest("hex");
      const reserve = (model.context * model.input + 512 * model.output) * 1.05;
      const used = report.ledger
        .filter((x) => x.provider === provider)
        .reduce((a, x) => a + x.budgetChargeUsd, 0);
      if (seen.has(hash) || used + reserve > 1) {
        res.writeHead(402).end();
        return;
      }
      seen.add(hash);
      const entry = {
        provider,
        model: model.model,
        requestHash: hash,
        reservedUsd: reserve,
        budgetChargeUsd: reserve,
        started: new Date().toISOString(),
        status: "reserved",
      };
      report.ledger.push(entry);
      await persist();
      payload.max_tokens = 512;
      if (provider === "openrouter") {
        payload.provider = {
          max_price: {
            prompt: model.input * 1e6,
            completion: model.output * 1e6,
            image: 0,
            request: 0,
          },
        };
        if (model.reasoning) payload.reasoning = { enabled: false };
      } else payload.reasoning_effort = "none";
      try {
        const response = await fetch(bases[provider] + "/chat/completions", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(110000),
          headers: {
            "Content-Type": "application/json",
            Authorization: req.headers.authorization,
          },
          body: JSON.stringify(payload),
        });
        const text = await response.text();
        entry.httpStatus = response.status;
        let result;
        try {
          result = JSON.parse(text);
        } catch {
          /* retain full reservation */
        }
        entry.responseId = result?.id;
        entry.usage = result?.usage;
        entry.output = result?.choices?.[0]?.message?.content;
        if (
          response.ok &&
          provider === "openrouter" &&
          Number.isFinite(result?.usage?.cost)
        ) {
          entry.actualReportedUsd = result.usage.cost;
          entry.budgetChargeUsd = result.usage.cost * 1.05;
        } else if (
          response.ok &&
          provider === "gemini" &&
          Number.isFinite(result?.usage?.prompt_tokens) &&
          Number.isFinite(result?.usage?.completion_tokens)
        ) {
          entry.estimatedUsd =
            result.usage.prompt_tokens * model.input +
            result.usage.completion_tokens * model.output;
          entry.budgetChargeUsd = entry.estimatedUsd * 1.05;
        } else if ([400, 401, 403, 404, 402].includes(response.status)) {
          entry.budgetChargeUsd = 0; // rejected, no generation; keep status evidence
        }
        entry.status = response.ok ? "completed" : "rejected";
        await persist();
        // Stop the native adapter retry loop on rate/server errors; never replay
        // a potentially billed request just to turn a flaky provider green.
        res.writeHead(
          [429, 500, 502, 503, 504].includes(response.status)
            ? 402
            : response.status,
          { "Content-Type": "application/json" },
        );
        res.end(text);
      } catch {
        entry.status = "uncertain";
        await persist();
        res
          .writeHead(402)
          .end('{"error":"Audit stopped; cost reservation retained"}');
      }
    })
    .catch(async () => {
      if (!res.headersSent) res.writeHead(402);
      res.end('{"error":"Audit forwarding failed"}');
    });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
let app, call, page, original;
try {
  ({ app, page, call } = await launchNative(root));
  original = (await call("status")).settings;
  assert.equal(await page.locator(".sidebar .privacy").count(), 0);
  const sidebar = await page.locator(".sidebar").boundingBox();
  const settings = await page.locator(".sidebar-bottom > button").boundingBox();
  assert.ok(sidebar.y + sidebar.height - settings.y - settings.height <= 12);
  report.checks.push(
    "Sidebar privacy footer removed; Settings anchored at bottom",
  );
  for (const id of ["llama-runtime", "lfm3-vl-2b", "embeddinggemma2-onnx"])
    assert.equal(await call("verifyModel", { id }), true);
  report.checks.push(
    "Existing licensed test models reused and SHA-256 verified; no new model downloads",
  );
  await app.evaluate(({ dialog }, expected) => {
    dialog.showMessageBox = async (_, options) => ({
      response:
        options.title === "Autorizar destino de la clave" &&
        [
          "OpenRouter: " + expected + "/openrouter",
          "Google Gemini: " + expected + "/gemini",
        ].includes(options.message)
          ? 1
          : 0,
    });
  }, base);
  await call("updateSettings", {
    remoteEnabled: true,
    apiDelayMs: 1000,
    parallelJobs: 1,
    python: "/intentionally-unavailable/python",
    device: "cpu",
    apiProfiles: Object.fromEntries(
      selected.map((m) => [
        m.provider,
        {
          baseUrl: base + "/" + m.provider,
          models: selected
            .filter((x) => x.provider === m.provider)
            .map((x) => x.model),
        },
      ]),
    ),
  });
  const db = await call("createDatabase", {
    name: "Auditoría real · NASA · diez fotografías",
  });
  report.databaseId = db.database.id;
  report.rows = [];
  for (let i = 0; i < images.length; i++) {
    const row = await call("createRow", { databaseId: db.database.id });
    report.rows.push({ id: row.id, sourceId: images[i].id });
    await call("setCell", {
      rowId: row.id,
      columnId: db.columns.find((c) => c.type === "title").id,
      value: `Imagen ${String(i + 1).padStart(2, "0")}`,
    });
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, images[i].file);
    const plan = await call("imagePreview", {
      databaseId: db.database.id,
      source: "files",
    });
    await waitNativeJob(
      call,
      await call("importImages", {
        token: plan.token,
        storage: "copy",
        createUnmatched: false,
        assignments: plan.matches.map((m) => ({
          pathToken: m.pathToken,
          rowId: row.id,
        })),
      }),
    );
  }
  report.taxonomy = [
    "Personas y retratos",
    "Infraestructuras y tecnología",
    "Trabajo y actividad colectiva",
    "Paisajes y entorno natural",
    "Detalles y objetos",
  ];
  report.taxonomyNote =
    "Fixture elegido solo para esta prueba. No es una taxonomía por defecto ni una referencia humana.";
  // All outputs stay as proposals until every model finishes: no model sees
  // another model's accepted classification or description in its row context.
  for (const choice of [
    ...selected,
    { provider: "local", model: "lfm3-vl-2b" },
  ]) {
    const columns = [];
    for (const [type, name] of [
      ["text", "Descripción"],
      ["select", "Tema"],
    ]) {
      const col = await call("addColumn", {
        databaseId: db.database.id,
        name: `${name} · ${choice.model}`,
        type,
        config: {
          aiModel: {
            provider: choice.provider === "local" ? "nodus" : choice.provider,
            model: choice.model,
          },
          aiPrompt:
            "Describe o clasifica el tema visual predominante. Usa solo evidencias visibles; no infieras identidad, fecha o lugar. Las etiquetas de este ensayo son instrumentales.",
        },
      });
      if (type === "select")
        await call("saveOptions", {
          columnId: col.id,
          options: report.taxonomy.map((label) => ({ label, color: null })),
        });
      columns.push({ id: col.id, type });
    }
    const run = {
      provider: choice.provider,
      model: choice.model,
      columns,
      started: new Date().toISOString(),
    };
    report.models.push(run);
    await persist();
    const start = performance.now();
    try {
      run.job = await call("analyze", {
        databaseId: db.database.id,
        columnIds: columns.map((c) => c.id),
        language: "Spanish",
        detailed: false,
      });
      await waitNativeJob(call, run.job);
      run.elapsedMs = performance.now() - start;
      run.proposals = (await call("proposals")).filter((p) =>
        columns.some((c) => c.id === p.columnId),
      );
      assert.equal(run.proposals.length, 20);
      run.passed = true;
    } catch (error) {
      run.error = String(error.message);
      run.passed = false;
    }
    run.elapsedMs = performance.now() - start;
    run.proposals = (await call("proposals")).filter((p) =>
      columns.some((c) => c.id === p.columnId),
    );
    run.jobState = (await call("jobs")).find((j) => j.id === run.job);
    await persist();
    console.log(
      "Real audit model",
      choice.model,
      run.passed ? "20 proposals" : "failed; inspect sanitized report",
    );
  }
  const proposals = await call("proposals");
  for (const row of report.rows) {
    const current = await call("getRow", { id: row.id });
    assert.equal(
      Object.keys(current.cells).filter(
        (id) =>
          report.models.some((m) => m.columns.some((c) => c.id === id)) &&
          current.cells[id],
      ).length,
      0,
    );
  }
  await call("reviewProposals", {
    ids: proposals.map((p) => p.id),
    action: "accept",
  });
  report.checks.push(
    "Ten actual images imported; native column queues; independent proposals; explicit acceptance; original titles preserved",
  );
  const raters = report.models
    .filter((m) =>
      m.proposals.some(
        (p) => p.columnId === m.columns.find((c) => c.type === "select").id,
      ),
    )
    .map((m) => ({
      columnId: m.columns.find((c) => c.type === "select").id,
      label: m.model,
      model: m.model,
      prompt: "Predominant visible theme; test taxonomy",
    }));
  if (raters.length >= 2) {
    report.agreement = await call("agreementRun", {
      databaseId: db.database.id,
      config: {
        raters,
        mode: "nominal",
        delimiter: ";",
        ignoreCase: false,
        emptySetValid: false,
        imagesOnly: true,
        cohort: "complete",
        aliases: [],
        weight: "none",
        categoryOrder: [],
        notes:
          "Ten test photographs; no human reference. Agreement is not accuracy.",
      },
    });
  }
  const indexingStart = performance.now();
  await waitNativeJob(
    call,
    await call("indexImages", { databaseIds: [db.database.id] }),
  );
  report.indexMs = performance.now() - indexingStart;
  report.semanticQuery = await call("search", {
    databaseIds: [db.database.id],
    mode: "semantic",
    query: "Un cohete despegando entre nubes de humo",
  });
  report.embeddingDiagnostics = await call("inferenceDiagnostics");
  assert.equal((await call("status")).indexed, 10);
  assert.equal(report.semanticQuery.rows.length, 10);
  report.checks.push(
    "Actual ONNX indexing of ten photographs and semantic retrieval without Python",
  );
  await page.reload();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: db.database.name })
    .click();
  await page.screenshot({ path: path.join(root, "native-audit.png") });
  report.finished = new Date().toISOString();
  await persist();
} finally {
  if (call && original)
    await call("updateSettings", {
      remoteEnabled: false,
      apiProfiles: original.apiProfiles,
    }).catch(() => {});
  await app?.close().catch(() => {});
  await new Promise((r) => server.close(r));
  await persist();
}

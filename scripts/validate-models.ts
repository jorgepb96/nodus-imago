// Opt-in integration test using downloaded, real model weights. Separate corpus.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Service } from "../electron/service";
import sharp from "sharp";
import bmp from "bmp-js";
const metadata = JSON.parse(
  await fsp.readFile("test-results/model-store.json", "utf8"),
);
const root = path.resolve("test-results/local-ai-validation");
// A fresh corpus every run: without it, embeddings from a previous run would be
// reused and the indexing measurement would only verify hashes, not inference.
await fsp.rm(root, { recursive: true, force: true });
await fsp.mkdir(root, { recursive: true });
await fsp.symlink(
  path.join(metadata.root, "models"),
  path.join(root, "models"),
  "dir",
);
let service = new Service(root, path.resolve("runtime/inference.py"), () => {});
const report: any = {
  date: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  cpu: os.cpus()[0].model,
  memoryGB: Math.round(os.totalmem() / 2 ** 30),
  device: "cpu",
  dimensions: 512,
  models: metadata.models.filter((m: any) =>
    ["embeddinggemma2", "lfm3-vl-2b", "llama-runtime"].includes(m.id),
  ),
  measurements: {},
  results: {},
};
async function waitJob(id: string) {
  const start = performance.now();
  let previous = -1;
  for (;;) {
    const job = service.repo.jobs().find((j) => j.id === id)!;
    if (job.done !== previous) {
      console.log(
        job.kind,
        job.done + "/" + job.total,
        job.state,
        job.message ?? "",
      );
      previous = job.done;
    }
    if (job.state === "completed") {
      if (job.failed)
        throw new Error("Job completed with failures: " + job.message);
      return performance.now() - start;
    }
    if (job.state === "failed")
      throw new Error(job.message ?? "Inference failed");
    if (performance.now() - start > 15 * 60_000)
      throw new Error("Integration test timed out");
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function waitRunning(id: string) {
  const start = performance.now();
  for (;;) {
    const job = service.repo.jobs().find((j) => j.id === id);
    if (job?.state === "running") return;
    if (job?.state === "completed") return;
    if (job?.state === "failed")
      throw new Error(job.message ?? "Job failed before pause test");
    if (performance.now() - start > 60_000)
      throw new Error("Job did not start");
    await new Promise((r) => setTimeout(r, 50));
  }
}
try {
  service.repo.updateSettings({
    python: path.resolve(".venv/bin/python"),
    embeddingModel: "embeddinggemma2",
    device: "cpu",
    profile: "balanced",
    parallelJobs: 2,
    dimensions: 512,
  });
  // Restart-friendly test setup; no writes to the user's collection.
  for (const d of service.repo.list())
    service.repo.db.prepare("DELETE FROM db_databases WHERE id=?").run(d.id);
  const d = service.repo.create("Validación temporal"),
    description = service.repo.addColumn(
      d.database.id,
      "Descripción visual",
      "text",
    ),
    categories = service.repo.addColumn(
      d.database.id,
      "Categorías",
      "multi_select",
    );
  service.repo.saveOptions(categories.id, [
    { label: "Arquitectura", color: "#6366f1" },
    { label: "Paisaje", color: "#339977" },
    { label: "Interiores", color: "#b08855" },
    { label: "Interfaz de software", color: "#5588bb" },
  ]);
  const files = [
    path.resolve("test-results/model-fixtures/GoldenGate.png"),
    path.resolve("test-results/model-fixtures/kitchen_painting.jpg"),
    path.resolve("test-results/06-providers.png"),
  ];
  const ids = [];
  for (let i = 0; i < files.length; i++) {
    const row = service.repo.createRow(d.database.id);
    service.repo.setCell(
      row.id,
      d.columns[0].id,
      "Documento " + String.fromCharCode(65 + i),
    );
    await service.images.importOne(
      {
        databaseId: d.database.id,
        columnId: d.columns[1].id,
        storage: "copy",
        createUnmatched: false,
        files: [{ path: files[i], rowId: row.id }],
      },
      0,
    );
    ids.push(row.id);
  }
  const index = await service.run("indexImages", {
    databaseIds: [d.database.id],
  });
  report.measurements.indexThreeImagesMs = Math.round(await waitJob(index));
  const at = performance.now(),
    text = await service.run("search", {
      mode: "semantic",
      query: "un puente rojo sobre el mar",
      databaseIds: [d.database.id],
    });
  report.measurements.textQueryMs = Math.round(performance.now() - at);
  report.results.text = text.rows.map((r: any) => ({
    title: r.title,
    score: r.score,
  }));
  report.results.semanticIndexed = text.indexed;
  assert.equal(text.rows[0]?.id, ids[0]);
  const queryImage = await service.run("queryImage", { file: files[0] }),
    count = service.repo.stats().rows;
  const imageAt = performance.now(),
    image = await service.run("search", {
      mode: "semantic",
      imageToken: queryImage.token,
      databaseIds: [d.database.id],
    });
  report.measurements.imageQueryMs = Math.round(performance.now() - imageAt);
  assert.equal(image.rows[0]?.id, ids[0]);
  assert.equal(service.repo.stats().rows, count);
  report.results.image = image.rows.map((r: any) => ({
    title: r.title,
    score: r.score,
  }));
  const combinedAt = performance.now(),
    combined = await service.run("search", {
      mode: "hybrid",
      query: "puente",
      imageToken: queryImage.token,
      databaseIds: [d.database.id],
      semanticWeight: 0.7,
    });
  report.measurements.combinedQueryMs = Math.round(
    performance.now() - combinedAt,
  );
  assert.equal(combined.rows[0]?.id, ids[0]);
  report.results.combined = combined.rows.map((r: any) => ({
    title: r.title,
    score: r.score,
  }));
  const a = await service.run("analyze", {
      rowIds: [ids[0]],
      columnIds: [description.id],
      language: "es",
      detailed: false,
    }),
    b = await service.run("analyze", {
      rowIds: [ids[0]],
      columnIds: [categories.id],
      language: "Español",
      detailed: false,
    });
  await Promise.all([waitRunning(a), waitRunning(b)]);
  console.log(
    "Concurrent real analysis jobs:",
    service.repo.jobs().filter((j) => j.state === "running").length,
  );
  assert.equal(
    service.repo.jobs().filter((j) => j.state === "running").length,
    2,
  );
  // Pause the description job while the classification job keeps its own LFM3 process.
  await service.run("controlJob", { id: a, action: "pause" });
  const classificationMs = await waitJob(b);
  assert.equal(service.repo.jobs().find((j) => j.id === a)?.state, "paused");
  const resumeAt = performance.now();
  await service.run("controlJob", { id: a, action: "resume" });
  const descriptionMs = await waitJob(a);
  report.measurements.descriptionMs = Math.round(performance.now() - resumeAt);
  report.measurements.descriptionAfterPauseMs = Math.round(descriptionMs);
  report.measurements.classificationMs = Math.round(classificationMs);
  report.results.concurrency = {
    bothStarted: true,
    pausedIndependently: true,
    otherCompletedWhilePaused: true,
  };
  const proposals = service.repo.proposals();
  assert.equal(proposals.length, 2);
  report.results.proposals = proposals.map((p) => ({
    column: p.columnName,
    value: p.value,
    model: p.model,
    revision: p.revision,
    prompt: p.prompt,
  }));
  const descriptionProposal = proposals.find(
      (p) => p.columnId === description.id,
    ),
    classificationProposal = proposals.find(
      (p) => p.columnId === categories.id,
    );
  assert.ok(descriptionProposal && classificationProposal);
  assert.ok(
    !descriptionProposal.value?.includes("==="),
    "La descripción no debe contener el encabezado del prompt",
  );
  assert.ok(
    !/<\/?think\b|reasoning/i.test(descriptionProposal.value ?? ""),
    "La descripción no debe contener razonamiento",
  );
  assert.ok(
    !/^#/.test(descriptionProposal.value ?? ""),
    "La descripción no debe empezar con un encabezado Markdown",
  );
  assert.ok((descriptionProposal.value?.length ?? 0) >= 20);
  const selected = (
    JSON.parse(classificationProposal.value ?? "[]") as string[]
  ).map(
    (id) =>
      service.repo.column(categories.id).options.find((o) => o.id === id)
        ?.label,
  );
  assert.equal(selected.length, 1);
  assert.ok(
    selected.every((label) =>
      [
        "Arquitectura",
        "Paisaje",
        "Interiores",
        "Interfaz de software",
      ].includes(label as string),
    ),
  );
  report.results.classificationLabels = selected;
  const accepted = service.repo.reviewProposals(
    proposals.map((p) => p.id),
    "accept",
  );
  assert.equal(accepted.applied, 2);
  report.results.accepted = accepted;
  assert.equal(
    JSON.parse(service.repo.getRow(ids[0]).cells[categories.id] ?? "[]").length,
    1,
  );
  assert.ok(
    (service.repo.getRow(ids[0]).cells[description.id]?.length ?? 0) >= 20,
  );
  // A single LFM3 chat session must serve several cells without reloading the
  // GGUF. This exercises the persistent pool with one job and two records.
  const multiAt = performance.now();
  const multi = await service.run("analyze", {
    rowIds: [ids[1], ids[2]],
    columnIds: [description.id],
    language: "es",
    detailed: false,
  });
  report.measurements.twoCellDescriptionMs = Math.round(await waitJob(multi));
  const multiProposals = service.repo.proposals();
  assert.equal(multiProposals.length, 2);
  report.results.multiCell = {
    elapsedMs: Math.round(performance.now() - multiAt),
    values: multiProposals.map((p) => ({
      column: p.columnName,
      value: p.value,
    })),
  };
  const multiAccepted = service.repo.reviewProposals(
    multiProposals.map((p) => p.id),
    "accept",
  );
  assert.equal(multiAccepted.applied, 2);
  // Criterion 11: close and reopen without losing rows, accepted values or vectors.
  const beforeRestart = service.repo.stats();
  await service.run("_close");
  service = new Service(root, path.resolve("runtime/inference.py"), () => {});
  const reopenedRow = service.repo.getRow(ids[0]);
  assert.equal(
    (JSON.parse(reopenedRow.cells[categories.id] ?? "[]") as string[]).length,
    1,
  );
  assert.ok((reopenedRow.cells[description.id]?.length ?? 0) >= 20);
  assert.equal(service.repo.stats().rows, beforeRestart.rows);
  assert.equal(service.repo.stats().images, beforeRestart.images);
  assert.equal(service.repo.stats().indexed, beforeRestart.indexed);
  assert.equal(service.repo.proposals().length, 0);
  const restartAt = performance.now(),
    afterRestart = await service.run("search", {
      mode: "semantic",
      query: "puente rojo sobre el agua",
      databaseIds: [d.database.id],
    });
  report.measurements.restartQueryMs = Math.round(
    performance.now() - restartAt,
  );
  assert.equal(afterRestart.rows[0]?.id, ids[0]);
  report.results.persistence = {
    rows: service.repo.stats().rows,
    images: service.repo.stats().images,
    indexed: service.repo.stats().indexed,
    topMatch: afterRestart.rows[0]?.title,
  };
  // Exercise codecs end to end, beyond thumbnail import: the Python and GGUF
  // runtimes must receive a readable, oriented image even for HEIC and BMP.
  const formats = service.repo.create("Formatos IA"),
    formatDescription = service.repo.addColumn(
      formats.database.id,
      "Descripción",
      "text",
    );
  const bitmap = path.join(root, "fixture.bmp");
  await fsp.writeFile(
    bitmap,
    bmp.encode({ width: 24, height: 18, data: Buffer.alloc(24 * 18 * 4, 100) })
      .data,
  );
  const formatRows = [];
  const heicFixture = path.resolve("test-results/model-fixtures/real.heic");
  for (const file of [heicFixture, bitmap]) {
    const row = service.repo.createRow(formats.database.id);
    formatRows.push(row.id);
    await service.images.importOne(
      {
        databaseId: formats.database.id,
        columnId: formats.columns[1].id,
        storage: "copy",
        createUnmatched: false,
        files: [{ path: file, rowId: row.id }],
      },
      0,
    );
  }
  const formatIndex = await service.run("indexImages", {
    databaseIds: [formats.database.id],
  });
  report.measurements.formatIndexMs = Math.round(await waitJob(formatIndex));
  const heicQuery = await service.run("queryImage", { file: heicFixture });
  const formatSearch = await service.run("search", {
    mode: "semantic",
    imageToken: heicQuery.token,
    databaseIds: [formats.database.id],
  });
  assert.equal(formatSearch.rows[0]?.id, formatRows[0]);
  const heicAnalysis = await service.run("analyze", {
    rowIds: [formatRows[0]],
    columnIds: [formatDescription.id],
    language: "es",
    detailed: false,
  });
  report.measurements.heicDescriptionMs = Math.round(
    await waitJob(heicAnalysis),
  );
  assert.equal(service.repo.proposals().length, 1);
  assert.ok((service.repo.proposals()[0].value?.length ?? 0) > 20);
  assert.ok(
    !/<\/?(?:arg|tool|invoke|parameter)/i.test(
      service.repo.proposals()[0].value ?? "",
    ),
  );
  report.results.formats = {
    heicIndexed: true,
    bmpIndexed: true,
    heicQueryTopMatch: true,
    heicLfm3Description: service.repo.proposals()[0].value,
  };
  const oriented = path.join(root, "orientation.jpg");
  await sharp({
    create: { width: 80, height: 60, channels: 3, background: "#335577" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toFile(oriented);
  await service.engine.embed([{ image: oriented }]);
  report.results.dimensions = [];
  for (const dimensions of [256, 768]) {
    await service.run("updateSettings", { dimensions });
    const [vector] = await service.engine.embed([
      { text: "puente rojo", role: "query" },
    ]);
    assert.equal(vector.length, dimensions);
    assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-6);
    report.results.dimensions.push({ dimensions, norm: Math.hypot(...vector) });
  }
  await service.run("updateSettings", { dimensions: 512 });
  assert.deepEqual(await fsp.readdir(path.join(root, "staging")), []);
  report.status = "passed";
  await fsp.mkdir("docs/benchmarks", { recursive: true });
  await fsp.writeFile(
    "docs/benchmarks/real-models-macos-arm64.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log("Real model validation passed.");
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  console.error(report.error);
  await fsp.writeFile(
    "test-results/real-models-failure.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  if (service) await service.run("_close");
}

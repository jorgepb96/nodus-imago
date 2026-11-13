// Actual local LFM3 queue cancellation / waiting slots / restart / semantic index.
// Reuses already downloaded, licensed, verified test models. No API requests or downloads.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import os from "node:os";
import {
  launchNative,
  seedNativeImages,
  pollNative,
  waitNativeJob,
} from "./native-test-support.mjs";
const installation = JSON.parse(
  await fs.readFile("test-results/v1-onboarding-e2e.json", "utf8"),
);
const profile = path.resolve("test-results/queue-real-" + Date.now());
await fs.mkdir(path.join(profile, "collection"), { recursive: true });
await fs.writeFile(
  path.join(profile, "isolation.json"),
  JSON.stringify({ format: "nodus.imago.native-qa/1", root: profile }),
);
const modelSource = path.join(installation.root, "models");
await fs.symlink(
  modelSource,
  path.join(profile, "collection", "models"),
  process.platform === "win32" ? "junction" : "dir",
);
let native;
const checks = [],
  errors = [];
const start = Date.now();
try {
  native = await launchNative(profile);
  let { app, page, call } = native;
  page.on("pageerror", (e) => errors.push(e.message));
  const available = (await call("status")).models;
  for (const id of [
    "llama-runtime",
    "lfm3-vl-2b",
    installation.diagnostics.backend,
  ]) {
    const model = available.find((m) => m.id === id);
    if (!model?.verified)
      throw Error("Test model must already be verified: " + id);
    console.log(
      "Reusing licensed dependency",
      model.label,
      model.license,
      model.estimatedGB,
      "GB",
      modelSource,
    );
  }
  await call("updateSettings", {
    profile: "balanced",
    parallelJobs: 2,
    device: "cpu",
    python: path.join(profile, "PYTHON_MUST_NOT_RUN"),
    remoteEnabled: false,
  });
  const seed = await seedNativeImages(
    app,
    call,
    path.join(profile, "fixtures"),
  );
  const a = await call("addColumn", {
      databaseId: seed.database.id,
      name: "Descripción conservada",
      type: "text",
    }),
    b = await call("addColumn", {
      databaseId: seed.database.id,
      name: "Descripción cancelada",
      type: "text",
    });
  const first = await call("analyze", {
    databaseId: seed.database.id,
    columnIds: [a.id],
    language: "English",
    detailed: false,
  });
  const second = await call("analyze", {
    databaseId: seed.database.id,
    columnIds: [b.id],
    language: "English",
    detailed: false,
  });
  const slots = Math.min(
    2,
    Math.max(1, Math.floor((os.totalmem() / 2 ** 30 - 4) / 3)),
  );
  await pollNative(
    async () =>
      (await call("jobs")).filter(
        (j) => [first, second].includes(j.id) && j.state === "running",
      ).length === slots,
  );
  const cancelStart = Date.now();
  await call("controlJob", { id: second, action: "cancel" });
  await call("controlJob", { id: first, action: "pause" });
  await pollNative(
    async () =>
      !(await call("jobs")).some(
        (j) => [first, second].includes(j.id) && j.state === "running",
      ),
  );
  const cancelMs = Date.now() - cancelStart;
  await app.close();
  native = null;
  checks.push(
    "Real model queue respects memory limit; second job cancelled, active load paused, graceful close",
  );
  native = await launchNative(profile);
  ({ app, page, call } = native);
  page.on("pageerror", (e) => errors.push(e.message));
  const jobs = await call("jobs");
  assert.equal(jobs.find((j) => j.id === first).state, "paused");
  assert.equal(jobs.find((j) => j.id === second).state, "cancelled");
  await call("resumePausedJobs");
  await waitNativeJob(call, first);
  assert.equal(
    (await call("jobs")).find((j) => j.id === second).state,
    "cancelled",
  );
  let proposals = (await call("proposals")).filter((p) =>
    [a.id, b.id].includes(p.columnId),
  );
  assert.equal(proposals.filter((p) => p.columnId === b.id).length, 0);
  assert.equal(proposals.filter((p) => p.columnId === a.id).length, 2);
  assert.ok(
    proposals.every(
      (p) => p.value?.length > 8 && p.model.toLowerCase().includes("lfm3"),
    ),
  );
  checks.push(
    "Restart resumes paused work only, actual LFM3 produces two proposals and cancelled work produces none",
  );
  for (const rowId of seed.rows)
    assert.equal(
      (await call("getRow", { id: rowId })).cells[a.id] ?? null,
      null,
    );
  await call("reviewProposals", {
    ids: proposals.map((p) => p.id),
    action: "accept",
  });
  checks.push("Original human cells protected until explicit review");
  const index = await call("indexImages", { databaseIds: [seed.database.id] });
  await waitNativeJob(call, index);
  const semantic = await call("search", {
    databaseIds: [seed.database.id],
    query: "a blue circle",
    mode: "semantic",
  });
  assert.equal(semantic.rows.length, 2);
  checks.push(
    "Real embedding index and semantic search after queue recovery without Python",
  );
  const diagnostics = await call("inferenceDiagnostics");
  await page
    .getByRole("button", { name: "Colas y tareas", exact: true })
    .click();
  await page.screenshot({ path: path.join(profile, "queue.png") });
  await app.close();
  native = null;
  await fs.writeFile(
    path.join(profile, "evidence.json"),
    JSON.stringify(
      {
        checks,
        errors,
        simulatedInference: false,
        apiRequests: 0,
        elapsedMs: Date.now() - start,
        cancelMs,
        diagnostics,
        modelSource,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  console.log("Real queue audit passed", checks.length, profile);
} catch (error) {
  await fs.writeFile(
    path.join(profile, "failure.json"),
    JSON.stringify({ checks, errors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await native?.app.close().catch(() => {});
}

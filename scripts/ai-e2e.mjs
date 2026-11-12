// Opt-in native UI integration with real, already-authorized local weights.
import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const store = JSON.parse(
  await fs.readFile("test-results/model-store.json", "utf8"),
);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-real-ui-"));
await fs.mkdir(path.join(root, "collection"));
await fs.symlink(
  path.join(store.root, "models"),
  path.join(root, "collection", "models"),
  "dir",
);
const env = { ...process.env, IMAGO_USER_DATA: root };
delete env.ELECTRON_RUN_AS_NODE;
delete env.IMAGO_DEV_URL;
const options = process.env.IMAGO_E2E_EXECUTABLE
  ? { executablePath: process.env.IMAGO_E2E_EXECUTABLE, args: [], env }
  : { args: ["."], env };
let app, page;
const errors = [],
  report = {
    date: new Date().toISOString(),
    packaged: !!process.env.IMAGO_E2E_EXECUTABLE,
    status: "running",
    results: {},
  };
const call = (command, input) =>
  page.evaluate(({ command, input }) => window.imago.call(command, input), {
    command,
    input,
  });
async function poll(work) {
  const start = Date.now();
  for (;;) {
    if (await work()) return;
    if (Date.now() - start > 5 * 60_000)
      throw new Error("Real UI inference timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function waitJob(id) {
  await poll(async () => {
    const job = (await call("jobs")).find((j) => j.id === id);
    if (job.state === "failed") throw new Error(job.message);
    return job.state === "completed";
  });
}
const openFile = (files) =>
  app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, files);
async function closeDialog() {
  await page
    .getByRole("dialog")
    .locator("header")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
}
try {
  app = await electron.launch(options);
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", {
      name: "Tu espacio de investigación visual",
      exact: true,
    })
    .waitFor();
  await call("updateSettings", {
    python: path.resolve(".venv/bin/python"),
    device: "cpu",
    profile: "balanced",
    parallelJobs: 2,
    dimensions: 512,
  });
  const db = await call("createDatabase", { name: "IA real por interfaz" });
  const description = await call("addColumn", {
    databaseId: db.database.id,
    name: "Descripción",
    type: "text",
  });
  const category = await call("addColumn", {
    databaseId: db.database.id,
    name: "Categorías",
    type: "multi_select",
  });
  await call("saveOptions", {
    columnId: category.id,
    options: [
      { label: "Paisaje", color: "#118866" },
      { label: "Interiores", color: "#995533" },
    ],
  });
  const files = [
    path.resolve("test-results/model-fixtures/GoldenGate.png"),
    path.resolve("test-results/model-fixtures/kitchen_painting.jpg"),
  ];
  const rows = [];
  for (let i = 0; i < 2; i++) {
    const row = await call("createRow", { databaseId: db.database.id });
    rows.push(row);
    await call("setCell", {
      rowId: row.id,
      columnId: db.columns[0].id,
      value: "Documento " + (i ? "B" : "A"),
    });
    await openFile([files[i]]);
    const plan = await call("imagePreview", {
      databaseId: db.database.id,
      source: "files",
    });
    const job = await call("importImages", {
      token: plan.token,
      storage: "copy",
      createUnmatched: false,
      assignments: plan.matches.map((m) => ({
        pathToken: m.pathToken,
        rowId: row.id,
      })),
    });
    await waitJob(job);
  }
  const index = await call("indexImages", { databaseIds: [db.database.id] });
  // Worker inference must leave the native renderer interactive.
  await page.getByRole("button", { name: "Menú lateral", exact: true }).click();
  await page.getByRole("button", { name: "Menú lateral", exact: true }).click();
  await waitJob(index);
  report.results.indexed = (await call("status")).indexed;
  assert.equal(report.results.indexed, 2);
  await page.reload();
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: "Búsqueda", exact: true })
    .click();
  await page.getByRole("button", { name: "Semántica", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Buscar", exact: true })
    .fill("un puente rojo sobre el mar");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await poll(
    async () =>
      (await page.locator(".gallery-card h3").allTextContents())[0] ===
      "Documento A",
  );
  report.results.semanticText = true;
  await openFile([files[1]]);
  await page
    .getByRole("button", { name: "Adjuntar imagen", exact: true })
    .click();
  await page.locator(".query-image").waitFor();
  await page.getByRole("textbox", { name: "Buscar", exact: true }).fill("");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await poll(
    async () =>
      (await page.locator(".gallery-card h3").allTextContents())[0] ===
      "Documento B",
  );
  assert.equal((await call("status")).rows, 2);
  report.results.imageQueryWithoutImport = true;
  await openFile([files[0]]);
  await page
    .getByRole("button", { name: "Adjuntar imagen", exact: true })
    .click();
  await page.getByRole("button", { name: "Híbrida", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Buscar", exact: true })
    .fill("puente");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await poll(
    async () =>
      (await page.locator(".gallery-card h3").allTextContents())[0] ===
      "Documento A",
  );
  report.results.hybridTextAndImage = true;
  await page
    .getByRole("button", { name: "Abrir registro Documento B", exact: true })
    .click();
  await page
    .locator(".record-panel")
    .getByRole("button", { name: "Buscar imágenes similares", exact: true })
    .click();
  await poll(
    async () =>
      (await page.locator(".gallery-card h3").allTextContents())[0] ===
      "Documento B",
  );
  report.results.similarImages = true;
  await page.getByLabel("seleccionar Documento A", { exact: true }).check();
  await page
    .locator(".selection-bar")
    .getByRole("button", { name: "Analizar", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Descripción", { exact: true }).check();
  await dialog.getByLabel("Categorías", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Generar propuestas", exact: true })
    .click();
  await page.getByRole("heading", { name: "Tareas", exact: true }).waitFor();
  const job = (await call("jobs")).find((j) => j.kind === "analyze");
  await waitJob(job.id);
  await closeDialog();
  await page
    .getByRole("button", { name: "Revisar propuestas", exact: true })
    .click();
  const proposals = await call("proposals");
  assert.equal(proposals.length, 2);
  assert.ok(proposals.every((p) => p.model === "LiquidAI/LFM3-VL-2B-GGUF"));
  await page.screenshot({ path: "test-results/codex-real-ai-proposals.png" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Aceptar todas", exact: true })
    .click();
  await poll(async () => (await call("proposals")).length === 0);
  const accepted = await call("getRow", { id: rows[0].id });
  assert.ok(accepted.cells[description.id].length > 20);
  assert.ok(JSON.parse(accepted.cells[category.id]).length >= 1);
  report.results.localDescriptionsAndClassification = proposals.map((p) => ({
    column: p.columnName,
    value: p.value,
    model: p.model,
    revision: p.revision,
  }));
  await app.close();
  app = await electron.launch(options);
  page = await app.firstWindow();
  await page
    .getByRole("heading", {
      name: "Tu espacio de investigación visual",
      exact: true,
    })
    .waitFor();
  const reopened = await call("getRow", { id: rows[0].id });
  assert.equal(reopened.cells[description.id], accepted.cells[description.id]);
  assert.equal(reopened.cells[category.id], accepted.cells[category.id]);
  assert.equal((await call("status")).indexed, 2);
  report.results.restartPersistence = true;
  assert.deepEqual(errors, []);
  report.status = "passed";
  console.log(
    "Real AI E2E passed: renderer → IPC → worker → native/Python inference → search/proposals → persistence.",
  );
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  if (page)
    await page
      .screenshot({ path: "test-results/codex-real-ai-failure.png" })
      .catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
  await fs.writeFile(
    "test-results/codex-real-ai-e2e.json",
    JSON.stringify(report, null, 2),
  );
  await fs.rm(root, { recursive: true, force: true });
}

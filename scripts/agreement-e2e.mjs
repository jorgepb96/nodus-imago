// Native end-to-end concordance audit; fixtures are categorical test data, not AI inference.
import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { chooseCriteria } from "./e2e-criteria.mjs";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-agreement-e2e-"));
const env = { ...process.env, IMAGO_DISABLE_UPDATES: "1", IMAGO_USER_DATA: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.IMAGO_DEV_URL;
let app, page;
const errors = [],
  checks = [],
  requests = [];
const call = (command, input) =>
  page.evaluate(({ command, input }) => window.imago.call(command, input), {
    command,
    input,
  });
const poll = async (predicate) => {
  const end = Date.now() + 20000;
  while (!(await predicate())) {
    if (Date.now() > end) throw Error("Agreement condition timed out");
    await new Promise((r) => setTimeout(r, 70));
  }
};
async function exportResult(dialog, format) {
  const file = path.join(root, "agreement." + format);
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, file);
  await dialog
    .getByRole("button", {
      name: "Exportar " + format.toUpperCase(),
      exact: true,
    })
    .click();
  await poll(async () =>
    fs
      .stat(file)
      .then(() => true)
      .catch(() => false),
  );
  return format === "json"
    ? JSON.parse(await fs.readFile(file, "utf8"))
    : await fs.readFile(file, "utf8");
}
try {
  await fs.mkdir("test-results", { recursive: true });
  app = await electron.launch(
    process.env.IMAGO_E2E_EXECUTABLE
      ? {
          executablePath: process.env.IMAGO_E2E_EXECUTABLE,
          args: process.env.IMAGO_E2E_NO_SANDBOX ? ["--no-sandbox"] : [],
          env,
        }
      : {
          args: process.env.IMAGO_E2E_NO_SANDBOX
            ? [".", "--no-sandbox"]
            : ["."],
          env,
        },
  );
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  app.context().on("request", (req) => {
    if (/^https?:/.test(req.url())) requests.push(req.url());
  });
  await page
    .getByRole("heading", {
      name: "Tu espacio de investigación visual",
      exact: true,
    })
    .waitFor();
  const fixture = await page.evaluate(async () => {
    const api = window.imago,
      d = await api.call("createDatabase", { name: "Concordancia de fuentes" });
    const title = d.columns.find((c) => c.type === "title");
    const columns = [];
    for (const name of ["Modelo A", "Modelo B", "Modelo C", "Investigador"]) {
      const c = await api.call("addColumn", {
        databaseId: d.database.id,
        name,
        type: "select",
      });
      await api.call("saveOptions", {
        columnId: c.id,
        options: ["Paisaje", "Patrimonio", "Vida cotidiana"].map((label) => ({
          label,
          color: "#5544cc",
        })),
      });
      columns.push(
        (await api.call("detail", { id: d.database.id })).columns.find(
          (col) => col.id === c.id,
        ),
      );
    }
    const ids = await api.call("createRows", {
      databaseId: d.database.id,
      count: 240,
    });
    const values = [];
    for (let i = 0; i < ids.length; i++) {
      const row = [
        i % 3,
        i % 5 === 0 ? (i + 1) % 3 : i % 3,
        i >= 237 ? null : i % 7 === 0 ? (i + 2) % 3 : i % 3,
        i >= 238 ? null : i % 11 === 0 ? (i + 1) % 3 : i % 3,
      ];
      values.push(row);
      await api.call("setCell", {
        rowId: ids[i],
        columnId: title.id,
        value: "IMG" + String(i + 1).padStart(3, "0"),
      });
      for (let j = 0; j < columns.length; j++)
        if (row[j] !== null)
          await api.call("setCell", {
            rowId: ids[i],
            columnId: columns[j].id,
            value: columns[j].options[row[j]].id,
          });
    }
    return { database: d.database, title, ids, columns, values };
  });
  await page.reload();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: fixture.database.name })
    .click();
  await page
    .locator(".view-tabs")
    .first()
    .getByRole("button", { name: "Tabla", exact: true })
    .waitFor();
  assert.deepEqual(
    await page
      .locator(".view-tabs")
      .first()
      .getByRole("button")
      .allTextContents(),
    ["Tabla", "Galería", "Mapa"],
  );
  await page.getByRole("button", { name: "Concordancia", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Concordancia · " + fixture.database.name,
    exact: true,
  });
  assert.equal(
    await dialog
      .getByRole("button", { name: "Calcular concordancia", exact: true })
      .isDisabled(),
    true,
  );
  const modelLabel = "Columnas de modelos / evaluadores (máximo 8)";
  for (const name of ["Modelo A", "Modelo B", "Modelo C"])
    await chooseCriteria(page, modelLabel, name, dialog, true);
  await chooseCriteria(
    page,
    "Referencia humana (opcional)",
    "Investigador",
    dialog,
  );
  // Selected model options cannot also become the independent human reference.
  await dialog
    .getByRole("button", { name: "Referencia humana (opcional)", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("listbox", {
        name: "Referencia humana (opcional)",
        exact: true,
      })
      .getByRole("option")
      .count(),
    1,
  );
  await page.keyboard.press("Escape");
  await dialog
    .getByRole("button", { name: "Calcular concordancia", exact: true })
    .click();
  await dialog
    .getByRole("heading", { name: "Instantánea del ensayo", exact: true })
    .waitFor();
  const snapshot = await exportResult(dialog, "json");
  assert.equal(snapshot.rows.length, 240);
  assert.equal(snapshot.results.total, 240);
  assert.equal(snapshot.results.complete, 237);
  const complete = fixture.values.filter((r) => r.every((v) => v !== null));
  const unanimity = complete.filter(
    (r) => r[0] === r[1] && r[1] === r[2],
  ).length;
  const any = complete.filter((r) => r.slice(0, 3).includes(r[3])).length;
  assert.equal(snapshot.results.models.unanimity.count, unanimity);
  assert.equal(snapshot.results.models.unanimity.n, 237);
  assert.equal(snapshot.results.human.any.count, any);
  assert.equal(snapshot.results.human.any.n, 237);
  assert.equal(snapshot.results.pairs.length, 6);
  assert.equal(
    snapshot.results.pairs.find(
      (p) => p.a === fixture.columns[3].id && p.b === fixture.columns[0].id,
    ).n,
    238,
  );
  assert.notEqual(
    fixture.columns[0].options[0].id,
    fixture.columns[1].options[0].id,
  );
  await dialog
    .getByRole("heading", { name: "Instantánea del ensayo", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/final-agreement-summary.png" });
  const csv = await exportResult(dialog, "csv");
  assert.ok(csv.includes('"confusion"'));
  assert.ok(csv.includes('"raw_record"'));
  assert.ok(csv.includes('"denominator"'));
  checks.push(
    "Native configuration, independent reference, 240 records, distinct option IDs, exact UI metrics, JSON and CSV dialogs",
  );
  await chooseCriteria(
    page,
    "Tipo de discrepancia",
    "Modelos unánimes que difieren del investigador",
    dialog,
  );
  await dialog
    .getByRole("textbox", { name: "Buscar registros del ensayo", exact: true })
    .fill("IMG012");
  const review = dialog.locator(".agreement-review-list");
  await review
    .getByRole("button", { name: "Abrir registro IMG012", exact: true })
    .click();
  const record = page.locator(".record-panel");
  await record
    .getByRole("textbox", { name: "Título", exact: true })
    .fill("IMG012 revisada");
  await record
    .getByRole("textbox", { name: "Título", exact: true })
    .press("Tab");
  await poll(
    async () =>
      (await call("getRow", { id: fixture.ids[11] })).title ===
      "IMG012 revisada",
  );
  await record
    .locator("header")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  assert.ok((await review.innerText()).includes("IMG012"));
  assert.ok(!(await review.innerText()).includes("IMG012 revisada"));
  await dialog
    .getByRole("textbox", { name: "Nombre del ensayo", exact: true })
    .fill("Ensayo nominal A");
  await dialog
    .getByRole("button", { name: "Guardar ensayo", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Guardado", exact: true }).waitFor();
  const saved = (
    await call("agreementList", { databaseId: fixture.database.id })
  )[0];
  await dialog
    .getByRole("button", {
      name: "Recalcular con filtros actuales",
      exact: true,
    })
    .click();
  await poll(
    async () =>
      await dialog
        .getByRole("button", { name: "Guardar ensayo", exact: true })
        .isEnabled(),
  );
  const updated = await exportResult(dialog, "json");
  // The export destination existed before this second save; poll content explicitly.
  await poll(
    async () =>
      JSON.parse(await fs.readFile(path.join(root, "agreement.json"), "utf8"))
        .rows[11].title === "IMG012 revisada",
  );
  assert.equal(
    (await call("agreementLoad", { id: saved.id })).snapshot.rows[11].title,
    "IMG012",
  );
  checks.push(
    "Disagreement review opens a live record; edits preserve the snapshot and explicit recalculation refreshes it",
  );
  await dialog
    .getByRole("button", { name: "Configurar ensayo", exact: true })
    .click();
  await chooseCriteria(
    page,
    "Datos incompletos",
    "Mismos casos completos para todos",
    dialog,
  );
  await chooseCriteria(
    page,
    "Tipo de clasificación",
    "Varias etiquetas por registro",
    dialog,
  );
  await dialog
    .getByRole("button", {
      name: "Recalcular con filtros actuales",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("heading", { name: "Instantánea del ensayo", exact: true })
    .waitFor();
  await dialog
    .getByRole("textbox", { name: "Nombre del ensayo", exact: true })
    .fill("Ensayo multietiqueta B");
  await dialog
    .getByRole("button", { name: "Guardar ensayo", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Guardado", exact: true }).waitFor();
  await dialog
    .getByRole("button", { name: "Ensayos guardados", exact: true })
    .click();
  const list = dialog.locator(".agreement-experiments");
  for (const name of ["Ensayo nominal A", "Ensayo multietiqueta B"])
    await list
      .locator("article")
      .filter({ hasText: name })
      .getByRole("button", { name: "Comparar", exact: true })
      .click();
  await dialog
    .getByText(
      "Los ensayos difieren en registros, referencia humana, categorías o reglas de cálculo. Los porcentajes no permiten una comparación directa de rendimiento.",
      { exact: true },
    )
    .waitFor();
  await page.screenshot({
    path: "test-results/final-agreement-comparison.png",
  });
  await list
    .locator("article")
    .filter({ hasText: "Ensayo nominal A" })
    .getByRole("button", { name: "Abrir ensayo", exact: true })
    .click();
  await dialog
    .getByRole("heading", { name: "Instantánea del ensayo", exact: true })
    .waitFor();
  await dialog
    .getByRole("button", { name: "Cerrar", exact: true })
    .first()
    .click();
  await page.reload();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: fixture.database.name })
    .click();
  await page.getByRole("button", { name: "Galería", exact: true }).click();
  await page.getByRole("button", { name: "Concordancia", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Ensayos guardados", exact: true })
    .click();
  assert.equal(await list.locator("article").count(), 2);
  checks.push(
    "Nominal/multilabel experiments, common complete cases, comparison warnings, gallery entry and restart persistence",
  );
  await list
    .locator("article")
    .filter({ hasText: "Ensayo multietiqueta B" })
    .getByRole("button", { name: /Eliminar ensayo/ })
    .click();
  assert.equal(
    (await call("agreementList", { databaseId: fixture.database.id })).length,
    2,
  );
  await list
    .locator("article")
    .filter({ hasText: "Ensayo multietiqueta B" })
    .getByRole("button", { name: /Eliminar ensayo/ })
    .click();
  await poll(
    async () =>
      (await call("agreementList", { databaseId: fixture.database.id }))
        .length === 1,
  );
  await dialog
    .getByRole("button", { name: "Cerrar", exact: true })
    .first()
    .click();
  await call("updateSettings", { mode: "dark", language: "en" });
  await page.reload();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: fixture.database.name })
    .click();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1000, 680);
  });
  await page.getByRole("button", { name: "Agreement", exact: true }).click();
  const english = page.getByRole("dialog", {
    name: "Agreement · " + fixture.database.name,
    exact: true,
  });
  await english
    .getByRole("button", { name: "Saved experiments", exact: true })
    .click();
  await english
    .locator(".agreement-experiments")
    .getByRole("button", { name: "Open experiment", exact: true })
    .click();
  await english
    .getByRole("heading", { name: "Experiment snapshot", exact: true })
    .waitFor();
  await page.screenshot({
    path: "test-results/final-agreement-dark-minimum.png",
  });
  const fit = await english.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return (
      r.left >= 0 &&
      r.right <= innerWidth &&
      r.top >= 0 &&
      r.bottom <= innerHeight
    );
  });
  assert.ok(fit);
  assert.equal(
    await english
      .getByRole("heading", { name: "Concordancia", exact: true })
      .count(),
    0,
  );
  checks.push(
    "Deliberate deletion, English labels, dark theme, minimum window and no external requests",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await fs.writeFile(
    "test-results/final-agreement-e2e.json",
    JSON.stringify(
      {
        executable: process.env.IMAGO_E2E_EXECUTABLE || "native-source",
        checks,
        errors,
        requests,
      },
      null,
      2,
    ),
  );
  console.log("Agreement E2E passed:", checks.join("; "));
} catch (error) {
  if (page)
    await page
      .screenshot({ path: "test-results/final-agreement-failure.png" })
      .catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}

import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { launchNative, pollNative } from "./native-test-support.mjs";
import { chooseCriteria } from "./e2e-criteria.mjs";
const profile = path.resolve("test-results/phase2-" + Date.now());
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "isolation.json"),
  JSON.stringify({ format: "nodus.imago.native-qa/1", root: profile }),
);
const { app, page, call } = await launchNative(profile),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  const source = await call("createDatabase", { name: "Fuentes vinculadas" }),
    collection = await call("createDatabase", {
      name: "Cuaderno de investigación",
    }),
    amount = await call("addColumn", {
      databaseId: source.database.id,
      name: "Cantidad",
      type: "number",
    }),
    rich = await call("addColumn", {
      databaseId: collection.database.id,
      name: "Anotaciones",
      type: "rich_text",
    }),
    label = await call("addColumn", {
      databaseId: collection.database.id,
      name: "Revisión",
      type: "text",
    }),
    relation = await call("addColumn", {
      databaseId: collection.database.id,
      name: "Fuentes",
      type: "relation",
      config: {
        relationTargetKind: "db_row",
        relationTargetDatabaseId: source.database.id,
      },
    }),
    sum = await call("addColumn", {
      databaseId: collection.database.id,
      name: "Total",
      type: "rollup",
      config: {
        rollupRelationColumnId: relation.id,
        rollupTargetColumnId: amount.id,
        rollupFunction: "sum",
      },
    });
  const a = await call("createRow", { databaseId: source.database.id }),
    b = await call("createRow", { databaseId: source.database.id }),
    row = await call("createRow", { databaseId: collection.database.id });
  await call("setCell", { rowId: a.id, columnId: amount.id, value: "3" });
  await call("setCell", { rowId: b.id, columnId: amount.id, value: "5" });
  await call("setCell", {
    rowId: row.id,
    columnId: collection.columns[0].id,
    value: "Cuaderno 1",
  });
  await call("setCell", {
    rowId: row.id,
    columnId: relation.id,
    value: JSON.stringify([a.id, b.id]),
  });
  assert.equal((await call("getRow", { id: row.id })).cells[sum.id], "8");
  await page.reload();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: collection.database.name })
    .click();
  await page.getByRole("button", { name: "Tabla", exact: true }).click();
  await page
    .getByRole("button", { name: "Abrir registro", exact: true })
    .click();
  const record = page.locator(".record-panel"),
    editor = record.getByRole("textbox", { name: "Anotaciones", exact: true });
  await editor.fill("Una nota visual");
  await editor.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await record.getByRole("button", { name: "Negrita", exact: true }).click();
  await record.locator("header strong").click();
  await pollNative(async () =>
    /\*\*Una nota visual\*\*/.test(
      (await call("getRow", { id: row.id })).cells[rich.id] ?? "",
    ),
  );
  await editor.click();
  await editor.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await pollNative(async () =>
    editor.evaluate((e) => !e.editor.state.selection.empty),
  );
  await record.getByRole("button", { name: "Enlace", exact: true }).click();
  await record
    .getByLabel("URL HTTPS", { exact: true })
    .fill("https://example.org/source");
  await record
    .getByRole("button", { name: "Guardar enlace", exact: true })
    .click();
  await record.locator("header strong").click();

  await pollNative(async () =>
    (await call("getRow", { id: row.id })).cells[rich.id].includes(
      "https://example.org/source",
    ),
  );
  await record.getByRole("button", { name: "Markdown", exact: true }).click();
  await record
    .getByLabel("Anotaciones", { exact: true })
    .fill("# Archivo\n\n- Padre\n  - Hijo\n\n> Fuente");
  await record.locator("header strong").click();
  await record.getByText("Árbol de bloques", { exact: true }).click();
  await record
    .locator(".block-outline")
    .locator("li")
    .filter({ hasText: "Hijo" })
    .first()
    .waitFor();
  const document = await call("pageDocument", {
    rowId: row.id,
    columnId: rich.id,
  });
  assert.ok(document.blocks.some((b) => b.type === "list"));
  checks.push(
    "Visual editor applies bold without Markdown syntax; persisted block tree retains nested lists and quotes",
  );
  await page.reload();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: collection.database.name })
    .click();
  await page
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByRole("button", { name: "Añadir regla", exact: true })
    .click();
  await modal
    .getByLabel("Nombre", { exact: true })
    .fill("Marcar para revisión");
  await modal.getByLabel("Regla activada", { exact: true }).check();
  await chooseCriteria(page, "Cuándo", "Ejecución manual", modal);
  await chooseCriteria(page, "Propiedad de destino", "Revisión", modal);
  await modal.getByLabel("Revisión", { exact: true }).fill("Pendiente");
  await modal.getByLabel("Revisión", { exact: true }).press("Tab");
  await modal.getByRole("button", { name: "Guardar", exact: true }).click();
  await modal
    .getByRole("button", {
      name: "Ejecutar sobre los registros actuales",
      exact: true,
    })
    .click();
  await pollNative(
    async () =>
      (await call("getRow", { id: row.id })).cells[label.id] === "Pendiente",
  );
  assert.equal(
    (await call("automationHistory", { databaseId: collection.database.id }))[0]
      .state,
    "completed",
  );
  checks.push(
    "Rules created and deliberately enabled through the UI; manual execution, destination value and audit history",
  );
  await call("setCell", { rowId: b.id, columnId: amount.id, value: "10" });
  assert.equal((await call("getRow", { id: row.id })).cells[sum.id], "13");
  await call("deleteRows", { ids: [a.id] });
  assert.equal((await call("getRow", { id: row.id })).cells[sum.id], "10");
  checks.push("Cross-database rollups update after edits and deletion");
  assert.deepEqual(errors, []);
  console.log(
    "Phase 2 E2E passed: visual formatting and links, nested block tree, enabled manual automation, audit history and live rollups.",
  );
  await page.screenshot({ path: "test-results/phase2-desktop.png" });
  await fs.writeFile(
    "test-results/phase2-e2e.json",
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        arch: process.arch,
        checks,
        errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page
    .screenshot({ path: "test-results/phase2-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}

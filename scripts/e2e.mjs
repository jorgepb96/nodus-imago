import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import assert from "node:assert/strict";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-e2e-"));
await fs.mkdir("test-results", { recursive: true });
const csv = path.join(root, "Archivo.csv"),
  out = path.resolve("test-results/e2e-export.csv");
await fs.writeFile(
  csv,
  'ID,Descripción,Categorías,Año\nIMG001,Patio de una vivienda rural,"Paisaje, Patrimonio",1945\nIMG002,Retrato de familia,"Retratos, Costumbres",1950\nIMG003,Arquitectura tradicional,"Paisaje, Patrimonio",1960\nIMG004,Escena cotidiana,"Retratos, Costumbres",1955',
);
const images = [];
for (let i = 1; i <= 4; i++) {
  const file = path.join(root, `IMG00${i}.jpg`);
  const svg = `<svg width="640" height="440" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="440" fill="${["#d7c3a2", "#a5bbc2", "#c8c9b4", "#c3afb0"][i - 1]}"/><rect x="70" y="80" width="500" height="300" rx="10" fill="#ffffff30"/><circle cx="320" cy="215" r="90" fill="#ffffff50"/><text x="320" y="390" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#444">QA · IMG00${i} · imagen de prueba</text></svg>`;
  await sharp(Buffer.from(svg)).jpeg().toFile(file);
  images.push(file);
}
const env = { ...process.env, IMAGO_USER_DATA: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.IMAGO_DEV_URL;
const launchOptions = process.env.IMAGO_E2E_EXECUTABLE
  ? { executablePath: process.env.IMAGO_E2E_EXECUTABLE, args: [], env }
  : { args: ["."], env };
let app;
const errors = [];
try {
  app = await electron.launch(launchOptions);
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page
    .getByRole("heading", {
      name: "Tu espacio de investigación visual",
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: "test-results/01-empty.png" });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, csv);
  await page.getByRole("button", { name: "Importar CSV", exact: true }).click();
  await page
    .getByRole("heading", { name: "Previsualización de importación" })
    .waitFor();
  await page
    .locator(".preview-table select")
    .nth(2)
    .selectOption("multi_select");
  await page.getByRole("button", { name: "Importar 4 registros" }).click();
  await page.getByRole("heading", { name: "Archivo", exact: true }).waitFor();
  // Property editor: an attachment target chosen by the user and a formula
  // created with the new arithmetic/expression recipe editor.
  await page.getByRole("button", { name: "Propiedades", exact: true }).click();
  const properties = page.getByRole("dialog");
  await properties.getByRole("button", { name: "Añadir propiedad" }).click();
  await properties.getByLabel("Nombre", { exact: true }).fill("Archivo adjunto");
  await properties.locator("select").nth(0).selectOption("attachment");
  await properties.getByRole("button", { name: "Guardar", exact: true }).click();
  await properties.getByRole("button", { name: "Añadir propiedad" }).click();
  await properties.getByLabel("Nombre", { exact: true }).fill("Doble año");
  await properties.locator("select").nth(0).selectOption("formula");
  await properties.locator("select").nth(2).selectOption({ label: "Año" });
  await properties.locator("select").nth(3).selectOption("multiply");
  await properties.locator('input[type="number"]').fill("2");
  await properties.getByRole("button", { name: "Guardar", exact: true }).click();
  await properties.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.locator(".gallery-card").nth(3).waitFor();
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, images);
  await page.locator(".toolbar-actions .actions-menu summary").click();
  await page
    .getByRole("button", { name: "Importar imágenes", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Importar imágenes", exact: true })
    .waitFor();
  await page
    .locator("label")
    .filter({ hasText: "Columna de destino" })
    .locator("select")
    .selectOption({ label: "Archivo adjunto" });
  assert.equal(await page.locator(".matching-table .badge.safe").count(), 4);
  await page
    .getByRole("button", { name: "Confirmar importación", exact: true })
    .click();
  await page.getByRole("heading", { name: "Tareas", exact: true }).waitFor();
  await page.locator(".job .badge.completed").waitFor({ timeout: 30000 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".gallery-card img")].every(
        (i) => i.complete && i.naturalWidth > 0,
      ) && document.querySelectorAll(".gallery-card img").length === 4,
  );
  await page.screenshot({ path: "test-results/02-gallery.png" });
  await page
    .locator(".sidebar nav button")
    .filter({ hasText: "Bases de datos" })
    .click();
  await page.locator(".collection-home").waitFor();
  await page
    .locator(".database-cards button")
    .filter({ hasText: "Archivo" })
    .click();
  await page.getByRole("heading", { name: "Archivo", exact: true }).waitFor();
  await page.getByRole("button", { name: "Tabla", exact: true }).click();
  await page.locator(".data-table").waitFor();
  assert.equal(await page.locator(".data-table tbody tr").count(), 4);
  await page
    .locator(".data-table thead")
    .getByText("Doble año", { exact: true })
    .waitFor();
  assert.match(
    await page.locator(".data-table tbody tr").first().innerText(),
    /3890/,
  );
  const firstDescription = page
    .locator('.data-table input[aria-label="Descripción"]')
    .first();
  await firstDescription.fill("Vivienda rural junto al camino");
  await firstDescription.press("Tab");
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/03-table.png" });
  await page
    .getByRole("button", { name: "Búsqueda", exact: false })
    .first()
    .click();
  await page.getByRole("heading", { name: "Búsqueda", exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "Buscar", exact: true })
    .fill("camino");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".data-table tbody tr").length === 1,
  );
  await page
    .getByRole("button", { name: "Abrir registro", exact: true })
    .click();
  await page.locator(".record-panel").waitFor();
  await page.waitForTimeout(300);
  assert.ok(
    await page
      .locator(".record-panel")
      .innerText()
      .then((t) => t.includes("IMG001")),
  );
  await page.screenshot({ path: "test-results/04-record.png" });
  await page
    .locator(".record-panel")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Buscar", exact: true })
      .inputValue(),
    "camino",
  );
  await page
    .getByRole("button", { name: "Guardar búsqueda", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Nombre", exact: true })
    .fill("Viviendas junto al camino");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Guardar", exact: true })
    .click();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: "Archivo" })
    .click();
  await page.locator(".data-table tbody tr").nth(3).waitFor();
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, out);
  await page.locator(".export-button").click();
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".spin"));
  assert.match(
    await fs.readFile(out, "utf8"),
    /Vivienda rural junto al camino/,
  );
  await page
    .locator(".sidebar-bottom")
    .getByRole("button", { name: "Ajustes", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Proveedores de IA y modelos" })
    .waitFor();
  await page.screenshot({ path: "test-results/06-providers.png" });
  await page
    .getByRole("button", { name: "Equivalencias de campos", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Equivalencias de campos", exact: true })
    .waitFor();
  await page
    .getByPlaceholder("Lugar, Autor, Fecha…")
    .fill("Campos de texto");
  await page
    .locator(".equivalence-form select")
    .selectOption([{ label: "ID" }, { label: "Descripción" }]);
  await page.getByRole("button", { name: "Añadir grupo", exact: true }).click();
  await page
    .locator(".equivalence-item")
    .filter({ hasText: "Campos de texto" })
    .waitFor();
  await page.screenshot({ path: "test-results/09-equivalences.png" });
  await page
    .getByRole("button", { name: "Colas y tareas", exact: true })
    .first()
    .click();
  await page.locator(".queue-popover").waitFor();
  await page
    .locator(".queue-popover")
    .getByLabel("Mostrar completadas")
    .check();
  assert.equal(
    await page
      .locator(".queue-tabs > button")
      .first()
      .locator("span")
      .innerText(),
    "1",
  );
  await page.screenshot({ path: "test-results/07-queues.png" });
  await page
    .locator(".queue-popover")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  await page.getByRole("button", { name: "Interfaz", exact: true }).click();
  await page.getByRole("combobox").first().selectOption("dark");
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("dark"),
  );
  await page.screenshot({ path: "test-results/05-settings-dark.png" });
  await page.evaluate(() => window.imago.call("updateSettings", { language: "en" }));
  await page.reload();
  await page
    .getByRole("heading", { name: "Your visual research space", exact: true })
    .waitFor();
  await page.screenshot({ path: "test-results/08-home-en.png" });
  await page.evaluate(() => window.imago.call("updateSettings", { language: "es" }));
  await page.reload();
  await page
    .getByRole("heading", {
      name: "Tu espacio de investigación visual",
      exact: true,
    })
    .waitFor();
  await app.close();
  app = undefined;
  app = await electron.launch(launchOptions);
  const reopened = await app.firstWindow();
  await reopened
    .getByRole("heading", {
      name: "Tu espacio de investigación visual",
      exact: true,
    })
    .waitFor();
  await reopened.waitForFunction(() =>
    document.documentElement.classList.contains("dark"),
  );
  assert.ok(
    await reopened
      .locator(".home-recent")
      .innerText()
      .then((t) => t.includes("Archivo")),
  );
  const stored = await reopened.evaluate(() =>
    window.imago.call("search", { query: "camino" }),
  );
  assert.equal(stored.total, 1);
  assert.equal(stored.rows[0].images.length, 1);
  const savedEquivalences = await reopened.evaluate(async () =>
    (await window.imago.call("status")).settings.fieldEquivalences,
  );
  assert.equal(savedEquivalences.length, 1);
  assert.ok(savedEquivalences[0].columnIds.length >= 2);
  assert.deepEqual(errors, []);
  console.log(
    "E2E passed: native desktop, CSV mapping, target attachment, formula editor, image association, gallery/table editing, search, record, export, field equivalences, theme, restart persistence.",
  );
} catch (error) {
  if (app) {
    try {
      const page = await app.firstWindow();
      await page.screenshot({ path: "test-results/e2e-failure.png" });
      console.error((await page.locator("body").innerText()).slice(-7000));
    } catch {}
  }
  console.error(errors);
  throw error;
} finally {
  if (app) await app.close();
  await fs.rm(root, { recursive: true, force: true });
}

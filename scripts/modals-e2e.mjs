// Visual/geometry audit of actual dialogs. Uses an isolated profile and retains screenshots.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {
  launchNative,
  seedNativeImages,
  pollNative,
} from "./native-test-support.mjs";
const root = path.resolve("test-results/modal-audit-" + Date.now()),
  profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "isolation.json"),
  JSON.stringify({ format: "nodus.imago.native-qa/1", root: profile }),
);
const { app, page, call } = await launchNative(profile);
const errors = [],
  checks = [];
const baseline = process.env.IMAGO_MODAL_BASELINE === "1";
page.on("pageerror", (e) => errors.push(e.message));
const modal = () => page.locator("dialog.modal[open]").last();
async function close() {
  await modal()
    .locator(":scope > header")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
}
async function inspect(name) {
  const dialog = modal();
  await dialog.waitFor();
  const footer = dialog.locator("footer").last();
  if (await footer.count()) await footer.scrollIntoViewIfNeeded();
  else {
    const last = dialog.locator("button,input,select,textarea,summary").last();
    if (await last.count()) await last.scrollIntoViewIfNeeded();
  }
  const geometry = await dialog.evaluate((d) => {
    const r = d.getBoundingClientRect(),
      header = d.querySelector(":scope > header")?.getBoundingClientRect();
    const items = [
      ...d.querySelectorAll(
        "button,input:not([type=hidden]),textarea,select,summary",
      ),
    ]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      })
      .map((el) => {
        const b = el.getBoundingClientRect();
        return {
          label: (el.getAttribute("aria-label") || el.textContent || el.tagName)
            .trim()
            .slice(0, 90),
          left: b.left - r.left,
          right: r.right - b.right,
          bottom: r.bottom - b.bottom,
          visible: b.bottom > (header?.bottom ?? r.top) && b.top < r.bottom,
        };
      });
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      overflow: d.scrollWidth - d.clientWidth,
      viewport: { width: innerWidth, height: innerHeight },
      items,
    };
  });
  const edge = geometry.items.filter((i) => i.left < 12 || i.right < 12),
    bottom = geometry.items.filter(
      (i) => i.visible && i.bottom >= -1 && i.bottom < 12,
    );
  checks.push({ name, geometry, edge, bottom });
  const capture = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
      .toPNG()
      .toString("base64"),
  );
  await fs.writeFile(
    path.join(root, name + ".png"),
    Buffer.from(capture, "base64"),
  );
  if (!baseline) {
    assert.ok(geometry.overflow <= 1, name + " horizontal overflow");
    assert.ok(
      geometry.left >= 12 &&
        geometry.right <= geometry.viewport.width - 12 &&
        geometry.top >= 12 &&
        geometry.bottom <= geometry.viewport.height - 12,
      name + " outside viewport",
    );
    assert.deepEqual(edge, [], name + " controls touch side edges");
    assert.deepEqual(bottom, [], name + " controls touch bottom");
  }
}
async function database() {
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: "Fuentes de prueba nativa" })
    .click();
  await page.getByRole("button", { name: "Tabla", exact: true }).click();
}
async function storage() {
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Ajustes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Almacenamiento y copias", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Copias de seguridad", exact: true })
    .waitFor();
}
async function restorePreview(file) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page
    .getByRole("button", { name: "Restaurar copia", exact: true })
    .click();
  await modal()
    .getByLabel("Contraseña original de la copia", { exact: true })
    .fill("modal-audit-password");
  await modal()
    .getByRole("button", { name: "Comprobar antes de restaurar", exact: true })
    .click();
  await modal()
    .getByRole("button", { name: "Restaurar datos comprobados", exact: true })
    .waitFor();
}
try {
  await page
    .getByRole("button", { name: "Nueva base de datos", exact: true })
    .last()
    .click();
  await modal()
    .getByLabel("Nombre", { exact: true })
    .fill(
      "Colección con un nombre muy largo para comprobar alineación, márgenes y cierre del diálogo",
    );
  await inspect("01-create");
  await close();
  const seed = await seedNativeImages(app, call, path.join(root, "images"));
  await call("addColumn",{databaseId:seed.database.id,name:"Código_"+"archivo".repeat(20),type:"text"});
  await page.reload();
  await database();
  await page
    .getByRole("button", { name: "Añadir registros", exact: true })
    .click();
  await inspect("02-add-rows");
  await close();
  const menu = page.locator(".page-heading .actions-menu");
  await menu.locator("summary").click();
  await menu.getByRole("button", { name: "Nombre", exact: true }).click();
  await inspect("02b-rename");
  await close();
  if ((await menu.getAttribute("open")) !== null)
    await menu.locator("summary").click();
  await menu.locator("summary").click();
  await menu.getByRole("button", { name: "Eliminar", exact: true }).click();
  await inspect("02c-delete-database");
  await close();
  if ((await menu.getAttribute("open")) !== null)
    await menu.locator("summary").click();
  const selected = page
    .getByRole("checkbox", { name: /^seleccionar / })
    .first();
  await selected.check();
  await page.getByRole("button", { name: "Analizar", exact: true }).click();
  await inspect("02d-generate-proposals");
  await close();
  await page
    .locator(".selection-bar")
    .getByRole("button", { name: "Eliminar", exact: true })
    .click();
  await inspect("02e-delete-selection");
  await close();
  await selected.uncheck();
  await page
    .getByRole("button", { name: "Revisar propuestas", exact: true })
    .click();
  await inspect("02f-review-proposals");
  await close();
  await page.getByRole("button", { name: "Propiedades", exact: true }).click();
  await inspect("03-properties-empty");
  await modal()
    .getByRole("button", { name: "Añadir propiedad", exact: true })
    .click();
  await modal().getByLabel("Tipo", { exact: true }).selectOption("formula");
  await inspect("04-property-form");
  await close();
  await page
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await modal()
    .getByRole("button", { name: "Añadir regla", exact: true })
    .click();
  await inspect("05-automations");
  await modal()
    .getByText("Historial de automatizaciones", { exact: true })
    .click();
  await inspect("06-automation-history");
  await close();
  await call("renameDatabase", {
    id: seed.database.id,
    name:
      "Fuentes de prueba nativa · " +
      "Colección documental con un nombre extenso. ".repeat(3),
  });
  await page.reload();
  await database();
  await page.getByRole("button", { name: "Concordancia", exact: true }).click();
  await inspect("07-agreement");
  await modal()
    .getByRole("button", { name: "Metodología", exact: true })
    .click();
  await inspect("08-methodology");
  await close();
  const csv = path.join(root, "sources.csv");
  await fs.writeFile(
    csv,
    "Título,Descripción\nFuente 1,Una descripción documental\nFuente 2,Otra descripción",
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, csv);
  await page
    .locator(".actions-menu > summary")
    .filter({ hasText: "Importar" })
    .click();
  await page.getByRole("button", { name: /CSV/ }).last().click();
  await inspect("09-csv");
  await close();
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, seed.files);
  await page
    .locator(".actions-menu > summary")
    .filter({ hasText: "Importar" })
    .click();
  await page
    .getByRole("button", { name: "Importar imágenes", exact: true })
    .click();
  await inspect("09b-images");
  await modal()
    .getByRole("button", { name: "Confirmar importación", exact: true })
    .click();
  await modal().getByRole("heading", { name: "Tareas", exact: true }).waitFor();
  await inspect("09c-tasks");
  await close();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Búsqueda", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Guardar búsqueda", exact: true })
    .click();
  await inspect("09d-save-search");
  await close();
  await storage();
  const copy = path.join(root, "copy.imago");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, copy);
  await call("backupRun", { password: "modal-audit-password" });
  await pollNative(
    async () =>
      (await page
        .getByRole("button", { name: "Comprobar integridad", exact: true })
        .count()) === 1,
  );
  await page
    .getByRole("button", { name: "Comprobar integridad", exact: true })
    .click();
  await inspect("10-backup-verify");
  await close();
  await restorePreview(copy);
  await inspect("11-backup-restore");
  await close();
  await page
    .getByRole("button", { name: "Modelos locales", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Licencia y procedencia", exact: true })
    .first()
    .click();
  await inspect("12-license");
  await close();
  await call("updateSettings", { mode: "dark" });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1000, 680);
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25);
  });
  await page.reload();
  await storage();
  await page
    .getByRole("button", { name: "Comprobar integridad", exact: true })
    .click();
  await inspect("13-verify-dark-zoom");
  await close();
  await restorePreview(copy);
  await inspect("14-restore-dark-zoom");
  await close();
  await database();
  await page.getByRole("button", { name: "Propiedades", exact: true }).click();
  await modal()
    .getByRole("button", { name: "Añadir propiedad", exact: true })
    .click();
  await inspect("15-properties-dark-zoom");
  await close();
  await page
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await modal()
    .getByRole("button", { name: "Añadir regla", exact: true })
    .click();
  await inspect("16-automations-dark-zoom");
  await close();
  await page.getByRole("button", { name: "Concordancia", exact: true }).click();
  await inspect("17-long-heading-dark-zoom");
  await close();
  await storage();
  await page
    .getByRole("button", { name: "Modelos locales", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Licencia y procedencia", exact: true })
    .first()
    .click();
  await inspect("18-license-dark-zoom");
  await close();
  await call("updateSettings", { language: "en" });
  await page.reload();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Storage and backups", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Verify integrity", exact: true })
    .click();
  await inspect("19-verify-english-zoom");
  await modal().locator(":scope > header button").click();
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        baseline,
        checks,
        errors,
        database: seed.database.id,
        executable: process.env.IMAGO_E2E_EXECUTABLE || "source",
      },
      null,
      2,
    ),
  );
  console.log("Modal audit passed", checks.length, root);
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  await fs.writeFile(
    path.join(root, "failure.json"),
    JSON.stringify({ error: String(error), checks, errors }, null, 2),
  );
  throw error;
} finally {
  await app.close();
}

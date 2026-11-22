// Databases of different kinds linked both ways, in an isolated native
// profile: a Sources database created from the dialog, a property of codes
// turned into a two-way relation (match found by itself, a saved view kept
// working), a related property brought in, the book's photographs in its
// record, links made from either side, and statistics by relation.
import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-relations-e2e-"));
const env = { ...process.env, IMAGO_DISABLE_UPDATES: "1", IMAGO_USER_DATA: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.IMAGO_DEV_URL;
let app, page;
const errors = [],
  checks = [];
const call = (command, input) =>
  page.evaluate(({ command, input }) => window.imago.call(command, input), { command, input });
const poll = async (predicate, what = "condition") => {
  const deadline = Date.now() + 30000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Relations: ${what} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
};
const openDatabase = async (name) => {
  await page.locator(".sidebar-databases>button").filter({ hasText: name }).click();
  await page.getByRole("heading", { name, exact: true }).waitFor();
};
try {
  await fs.mkdir("test-results", { recursive: true });
  app = await electron.launch(
    process.env.IMAGO_E2E_EXECUTABLE
      ? { executablePath: process.env.IMAGO_E2E_EXECUTABLE, args: process.env.IMAGO_E2E_NO_SANDBOX ? ["--no-sandbox"] : [], env }
      : { args: process.env.IMAGO_E2E_NO_SANDBOX ? [".", "--no-sandbox"] : ["."], env },
  );
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "Tu espacio de investigación visual", exact: true }).waitFor();

  // A Sources database from the dialog: its starting properties.
  await page.getByRole("button", { name: "Nueva base de datos", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre", { exact: true }).fill("Obras");
  await dialog.getByTestId("database-kinds").getByText("Fuentes", { exact: true }).click();
  // An icon found by searching, in a colour.
  const picker = dialog.getByTestId("database-icon-picker");
  assert.equal(await picker.locator(".database-icon-preview .database-icon").getAttribute("data-icon"), "BookOpen");
  await picker.getByRole("searchbox").fill("castillo");
  assert.deepEqual(await picker.locator(".database-icon-option").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))), ["Castle"]);
  await picker.getByTestId("database-icon-Castle").click();
  await picker.getByTestId("database-icon-color-green").click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: "test-results/relations-new-database.png" });
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await page.getByRole("heading", { name: "Obras", exact: true }).waitFor();
  const books = (await call("listDatabases")).find((d) => d.name === "Obras");
  assert.equal(books.icon, "Castle:green");
  const sideIcon = page.locator(".sidebar-databases>button").filter({ hasText: "Obras" }).locator(".database-icon");
  assert.equal(await sideIcon.getAttribute("data-icon"), "Castle");
  assert.equal(await sideIcon.getAttribute("data-color"), "green");
  // Changed from the heading's icon, then back to the kind's icon.
  await page.getByTestId("database-title-icon").click();
  // It opens on the group of the current icon; another group is a tab away.
  assert.equal(await page.getByRole("dialog").getByRole("tab", { selected: true }).innerText(), "Lugares y viajes");
  await page.getByRole("dialog").getByRole("tab", { name: "Colecciones", exact: true }).click();
  await page.getByRole("dialog").getByTestId("database-icon-Library").click();
  await page.getByRole("dialog").getByRole("button", { name: "Guardar", exact: true }).click();
  await poll(async () => (await call("listDatabases")).find((d) => d.name === "Obras").icon === "Library:green", "icon changed");
  await page.getByTestId("database-title-icon").click();
  await page.getByRole("dialog").getByRole("button", { name: "Restablecer", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Guardar", exact: true }).click();
  await poll(async () => (await call("listDatabases")).find((d) => d.name === "Obras").icon === null, "icon reset");
  await poll(
    async () => (await page.locator(".sidebar-databases>button").filter({ hasText: "Obras" }).locator(".database-icon").getAttribute("data-icon")) === "BookOpen",
    "the sidebar shows the kind's icon again",
  );
  checks.push("A database icon chosen by search, coloured, changed from its heading and reset to its kind's icon");
  assert.equal(books.kind, "sources");
  const booksDetail = await call("detail", { id: books.id });
  assert.deepEqual(
    booksDetail.columns.map((c) => c.name),
    ["Título", "Tipo", "Autor", "Editorial", "Lugar de edición", "Año", "Identificador", "Cubierta"],
  );
  const col = (detail, name) => detail.columns.find((c) => c.name === name).id;
  const bookIds = [];
  for (const [title, publisher, code] of [["Guía ilustrada", "Editorial Norte", "B-001"], ["Álbum de viaje", "Editorial Sur", "B-002"], ["Cuaderno", "Editorial Sur", "B-003"]]) {
    const row = await call("createRow", { databaseId: books.id });
    await call("setCell", { rowId: row.id, columnId: col(booksDetail, "Título"), value: title });
    await call("setCell", { rowId: row.id, columnId: col(booksDetail, "Editorial"), value: publisher });
    await call("setCell", { rowId: row.id, columnId: col(booksDetail, "Identificador"), value: code });
    bookIds.push(row.id);
  }
  checks.push("A Sources database from the dialog, with its starting properties");

  // Photographs whose «Libro» holds book codes, and a saved view by one code.
  const csv = path.join(root, "Fotos.csv");
  await fs.writeFile(csv, 'Título,Libro\n"F1","B-001"\n"F2","b-002"\n"F3","B-002"\n"F4","B-009"\n"F5",""\n');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    return true;
  }, csv);
  const plan = await call("csvPreview");
  const photos = await call("csvImport", { token: plan.token, name: "Fotos", types: ["title", "select"], headers: plan.headers });
  const book = photos.columns.find((c) => c.name === "Libro");
  const second = book.options.find((o) => o.label.toUpperCase() === "B-002").id;
  await call("savedViewSave", {
    databaseId: photos.database.id,
    name: "Del segundo libro",
    view: "table",
    criteria: { filters: [{ columnId: book.id, op: "any", value: [second] }], filterLogic: "and", filterGroups: [], sorts: [] },
  });
  await page.reload();
  await openDatabase("Fotos");

  // «Libro» becomes a two-way relation to «Obras», matched by itself.
  await page.locator('th[data-column] .column-header-label', { hasText: "Libro" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Cambiar tipo" }).click();
  await page.getByTestId("convert-to-relation").click();
  const convert = page.getByTestId("convert-relation");
  await poll(async () => /3\s*de\s*4/.test(await convert.getByTestId("convert-preview").innerText()), "preview found the codes");
  assert.equal(await convert.getByTestId("convert-match").locator("option:checked").innerText(), "Identificador");
  await convert.getByTestId("convert-preview").locator("summary").click();
  assert.match(await convert.getByTestId("convert-preview").innerText(), /1 valor sin registro[\s\S]*B-009/);
  await page.screenshot({ path: "test-results/relations-convert.png" });
  await convert.getByTestId("convert-apply").click();
  await poll(async () => (await call("detail", { id: photos.database.id })).columns.find((c) => c.id === book.id).type === "relation", "converted");
  const photoRows = (await call("search", { databaseIds: [photos.database.id], limit: 10 })).rows;
  const photo = (title) => photoRows.find((r) => r.title === title);
  assert.deepEqual(JSON.parse(photo("F1").cells[book.id]), [bookIds[0]]);
  assert.deepEqual(JSON.parse(photo("F2").cells[book.id]), [bookIds[1]]);
  // The saved view keeps finding the second book's photographs.
  const view = (await call("savedViewsList", { databaseId: photos.database.id }))[0];
  const kept = await call("search", { databaseIds: [photos.database.id], ...view.criteria, limit: 10 });
  assert.deepEqual(kept.rows.map((r) => r.title).sort(), ["F2", "F3"]);
  const twin = (await call("detail", { id: books.id })).columns.find((c) => c.config.relationInverseColumnId === book.id);
  assert.equal(twin.name, "Fotos");
  checks.push("Book codes became a two-way relation (match found by itself, 3 of 4, missing code listed); the saved view still works");

  // A related property brought in.
  await page.locator('th[data-column] .column-header-label', { hasText: /^Libro$/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Traer una propiedad de la base relacionada" }).click();
  await page.getByTestId("lookup-property").selectOption({ label: "Editorial" });
  await page.getByTestId("lookup-apply").click();
  await poll(async () => (await call("detail", { id: photos.database.id })).columns.some((c) => c.name === "Editorial (Libro)"), "rollup added");
  const lookup = (await call("detail", { id: photos.database.id })).columns.find((c) => c.name === "Editorial (Libro)");
  const withLookup = (await call("search", { databaseIds: [photos.database.id], limit: 10 })).rows;
  assert.equal(withLookup.find((r) => r.title === "F3").cells[lookup.id], "Editorial Sur");
  const bySouth = await call("search", { databaseIds: [photos.database.id], filters: [{ columnId: lookup.id, op: "contains", value: "Sur" }], limit: 10 });
  assert.deepEqual(bySouth.rows.map((r) => r.title).sort(), ["F2", "F3"]);
  checks.push("A related property (publisher) brought in, filterable");

  // Links from the book's side show on the photograph; the book shows its photographs.
  await call("setCell", { rowId: bookIds[2], columnId: twin.id, value: JSON.stringify([photo("F5").id]) });
  assert.deepEqual(JSON.parse((await call("getRow", { id: photo("F5").id })).cells[book.id]), [bookIds[2]]);
  await openDatabase("Obras");
  await page.locator("tbody tr").getByRole("button", { name: "Abrir registro", exact: true }).nth(1).click();
  const linked = page.getByTestId("linked-records");
  await linked.getByTestId("linked-group").filter({ hasText: "Fotos" }).waitFor();
  assert.match(await linked.innerText(), /F2[\s\S]*F3|F3[\s\S]*F2/);
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/relations-book-record.png" });
  await page.locator(".record-panel>header").getByRole("button", { name: "Cerrar", exact: true }).click();
  checks.push("Linking from the book shows on the photograph; the book's record lists its photographs");

  // Statistics count photographs by book.
  const stats = await call("statisticCompute", { search: { databaseIds: [photos.database.id] }, spec: { kind: "frequency", columnId: book.id } });
  assert.deepEqual(
    stats.categories.map((c) => [c.label, c.count]),
    [["Álbum de viaje", 2], ["Cuaderno", 1], ["Guía ilustrada", 1]],
  );
  checks.push("Statistics by relation count photographs per book");

  assert.deepEqual(errors, []);
  await fs.writeFile("test-results/relations-e2e.json", JSON.stringify({ status: "passed", checks, errors }, null, 2));
  console.log("Relations E2E passed:", checks.join("; "));
} catch (error) {
  if (page) await page.screenshot({ path: "test-results/relations-failure.png" }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}

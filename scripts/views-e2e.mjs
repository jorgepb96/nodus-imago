// View tabs and record panel in an isolated native profile: a data source
// for the built-in views, featured and coloured saved views, tabs moved by
// dragging and from the keyboard, gentle scrolling while a column is dragged
// to the edge, the strip of a map point's records and a full-screen panel.
import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import sharp from "sharp";
import { installMapTiles } from "./map-tile-fixture.mjs";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-views-e2e-"));
const env = { ...process.env, IMAGO_DISABLE_UPDATES: "1", IMAGO_USER_DATA: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.IMAGO_DEV_URL;
let app, page;
const errors = [],
  checks = [];
const tile = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#dfe8d7" } })
  .png()
  .toBuffer();
const call = (command, input) =>
  page.evaluate(({ command, input }) => window.imago.call(command, input), { command, input });
const poll = async (predicate, what = "condition") => {
  const deadline = Date.now() + 30000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Views: ${what} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
};
const tab = (name) => page.locator(".view-tabs > button").filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) });
const tabOrder = () => page.locator(".view-tabs > button:not([hidden])").allInnerTexts();
const total = async () => Number((await page.locator(".result-meta b").first().innerText()).replace(/\D/g, ""));
const menuFor = async (name) => {
  await tab(name).click({ button: "right" });
  return page.getByRole("dialog", { name: "Opciones de la vista" });
};
try {
  await fs.mkdir("test-results", { recursive: true });
  app = await electron.launch(
    process.env.IMAGO_E2E_EXECUTABLE
      ? { executablePath: process.env.IMAGO_E2E_EXECUTABLE, args: process.env.IMAGO_E2E_NO_SANDBOX ? ["--no-sandbox"] : [], env }
      : { args: process.env.IMAGO_E2E_NO_SANDBOX ? [".", "--no-sandbox"] : ["."], env },
  );
  await installMapTiles(app, tile);
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "Tu espacio de investigación visual", exact: true }).waitFor();

  // Six records: five photographs and a map; five in Granada, one in Seville;
  // and enough properties for the table to scroll sideways.
  const granada = { name: "Granada", latitude: 37.18817, longitude: -3.60667 },
    seville = { name: "Sevilla", latitude: 37.38863, longitude: -5.98233 };
  const extra = Array.from({ length: 16 }, (_, i) => `Campo ${i + 1}`);
  const rows = [
    ["R1", granada, "foto"],
    ["R2", granada, "foto"],
    ["R3", granada, "mapa"],
    ["R4", granada, "foto"],
    ["R5", granada, "foto"],
    ["R6", seville, "foto"],
  ].map(([title, place, kind]) =>
    [title, JSON.stringify(place), kind, ...extra.map(() => "valor largo para que la tabla se desplace")]
      .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
      .join(","),
  );
  const csv = path.join(root, "Vistas.csv");
  await fs.writeFile(csv, ["Título", "Lugar", "Tipo", ...extra].join(",") + "\n" + rows.join("\n"));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    return true;
  }, csv);
  const plan = await call("csvPreview");
  const db = await call("csvImport", {
    token: plan.token,
    name: "Vistas y orígenes",
    types: ["title", "location", "text", ...extra.map(() => "text")],
    headers: plan.headers,
  });
  const kind = db.columns.find((c) => c.name === "Tipo"),
    place = db.columns.find((c) => c.name === "Lugar");
  await call("savedViewSave", {
    databaseId: db.database.id,
    name: "Solo fotos",
    view: "table",
    criteria: { filters: [{ columnId: kind.id, op: "equals", value: "foto" }], filterLogic: "and", filterGroups: [], sorts: [] },
  });
  await call("savedViewSave", {
    databaseId: db.database.id,
    name: "Granada",
    view: "gallery",
    criteria: { filters: [{ columnId: place.id, op: "contains", value: "Granada" }], filterLogic: "and", filterGroups: [], sorts: [] },
  });
  await page.reload();
  await page.locator(".sidebar-databases>button").filter({ hasText: db.database.name }).click();
  await poll(async () => (await total()) === 6, "six records");

  // Data source: the views other than the table take the saved view's
  // records; the table is always the main table, without a source picker.
  await tab("Tabla").click();
  assert.equal(await page.getByTestId("data-source").count(), 0);
  await tab("Galería").click();
  await page.getByTestId("data-source").filter({ hasText: "Tabla principal" }).waitFor();
  await page.getByTestId("data-source").click();
  await page.getByTestId("data-source-option").filter({ hasText: "Solo fotos" }).click();
  await poll(async () => (await total()) === 5, "data source in the gallery");
  await page.getByTestId("data-source").filter({ hasText: "Solo fotos" }).waitFor();
  await tab("Mapa").click();
  const map = page.getByRole("region", { name: "Vista de mapa", exact: true });
  await poll(async () => (await map.locator(".map-record-count").innerText()).includes("5"), "data source on the map");
  await tab("Tabla").click();
  await poll(async () => (await total()) === 6, "the table keeps the whole database");
  assert.equal(await page.getByTestId("data-source").count(), 0);
  const sources = await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("imago.tableView."))));
  assert.match(sources, /"dataSource":"saved:/);
  // A saved view on screen uses its own filters: no source to pick.
  await tab("Granada").click();
  await poll(async () => (await total()) === 5, "saved view's own filters");
  assert.equal(await page.getByTestId("data-source").count(), 0);
  await tab("Galería").click();
  await poll(async () => (await total()) === 5, "the gallery keeps its source");
  await page.getByTestId("data-source").click();
  await page.getByTestId("data-source-all").click();
  await poll(async () => (await total()) === 6, "main table again");
  checks.push("Data source: the gallery and the map take a saved view's records, the table and saved views keep their own, back to the main table");

  // Featuring a saved view: the database opens in it.
  await (await menuFor("Granada")).getByTestId("view-feature").click();
  await tab("Granada").locator(".view-featured").waitFor();
  // A colour: pastel with a stronger line below; then normal; then none.
  await (await menuFor("Mapa")).getByTestId("view-color-pastel-blue").click();
  await poll(async () => (await tab("Mapa").getAttribute("class"))?.includes("tone-pastel"), "pastel colour");
  assert.equal(await tab("Mapa").evaluate((el) => getComputedStyle(el).borderBottomWidth), "3px");
  await (await menuFor("Solo fotos")).getByTestId("view-color-normal-green").click();
  await poll(async () => (await tab("Solo fotos").getAttribute("class"))?.includes("tone-normal"), "normal colour");
  await page.screenshot({ path: "test-results/views-coloured-tabs.png" });
  // Moving tabs: from the keyboard, then by dragging.
  await tab("Galería").focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await poll(async () => (await tabOrder())[0].includes("Galería"), "keyboard move");
  // The tabs are one row that scrolls sideways: press a tab at the end of
  // the row, carry it to the left edge until the row has scrolled back to
  // the start, and drop it on the first tab (as a person would; dragTo
  // scrolls the row between the press and the drag).
  const row = page.locator(".view-tabs");
  await row.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  const pressed = await tab("Solo fotos").boundingBox(),
    edge = await row.boundingBox();
  await page.mouse.move(pressed.x + pressed.width / 2, pressed.y + pressed.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + 24, pressed.y + pressed.height / 2, { steps: 12 });
  // A dragged pointer only reports itself when it moves: keep it moving
  // near the edge until the row is back at its start.
  for (let i = 0; i < 120 && (await row.evaluate((el) => el.scrollLeft)) > 0; i++) {
    await page.mouse.move(edge.x + 12 + (i % 2), pressed.y + pressed.height / 2);
    await page.waitForTimeout(50);
  }
  assert.equal(await row.evaluate((el) => el.scrollLeft), 0, "the tab row scrolls while a tab is dragged near its edge");
  const onto = await tab("Tabla").boundingBox();
  await page.mouse.move(onto.x + 4, onto.y + 10, { steps: 4 });
  await page.mouse.up();
  await poll(async () => (await tabOrder()).findIndex((t) => t.includes("Solo fotos")) < (await tabOrder()).findIndex((t) => t.includes("Tabla")), "drag move");
  const order = await tabOrder();
  // Everything stays after reopening the database.
  await page.reload();
  await page.locator(".sidebar-databases>button").filter({ hasText: db.database.name }).click();
  await poll(async () => (await tab("Granada").getAttribute("class"))?.includes("active"), "featured saved view opens");
  assert.deepEqual(await tabOrder(), order);
  assert.ok((await tab("Mapa").getAttribute("class")).includes("tone-pastel"));
  checks.push("Saved views featured, tabs coloured (pastel/normal, 3 px line) and moved by keyboard and dragging, kept after reopening");
  // The palette: nine swatches per tone on one line, «Sin color» lined up with them.
  const menu = await menuFor("Mapa");
  for (const tone of ["pastel", "normal"]) {
    const tops = await menu.locator(`.view-color-swatch.tone-${tone}`).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    assert.equal(tops.length, 9);
    assert.equal(new Set(tops).size, 1, `${tone} swatches on one line: ${tops}`);
  }
  const firstSwatch = await menu.getByTestId("view-color-pastel-gray").boundingBox(),
    noneIcon = await menu.getByTestId("view-color-none").locator("svg").boundingBox();
  assert.ok(Math.abs(noneIcon.x - firstSwatch.x) <= 3, `«Sin color» lined up: ${noneIcon.x} / ${firstSwatch.x}`);
  // Nothing cut off: the menu needs no horizontal scrolling.
  // Nothing cut off and nothing to scroll, across or down.
  const overflow = await menu.evaluate((el) =>
    [el, ...el.querySelectorAll("*")]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
      .map((e) => e.className || e.tagName),
  );
  assert.deepEqual(overflow, [], "the menu shows everything without scrolling");
  const lastSwatch = await menu.getByTestId("view-color-normal-pink").boundingBox(),
    menuBox = await menu.boundingBox();
  assert.ok(lastSwatch.x + lastSwatch.width <= menuBox.x + menuBox.width - 8, "the last colour is inside the menu");
  await page.screenshot({ path: "test-results/views-color-picker.png" });
  await menu.getByTestId("view-color-none").click();
  await poll(async () => !(await tab("Mapa").getAttribute("class"))?.includes("has-color"), "no colour");

  // Gentle scrolling while a column is dragged to the right edge.
  await tab("Tabla").click();
  const scroller = page.locator(".table-scroll");
  await poll(async () => (await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)) > 300, "a wide table");
  const label = page.locator('th[data-column] .column-header-label', { hasText: "Tipo" });
  const from = await label.boundingBox(),
    box = await scroller.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 160, from.y + from.height / 2, { steps: 8 });
  const samples = [];
  for (let i = 0; i < 16; i++) {
    await page.mouse.move(box.x + box.width - 6 + (i % 2), from.y + from.height / 2);
    await page.waitForTimeout(60);
    samples.push(await scroller.evaluate((el) => el.scrollLeft));
  }
  await page.mouse.up();
  const max = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
  assert.ok(samples.at(-1) > 0, `scrolled while dragging: ${samples}`);
  assert.ok(samples[0] < max / 2, `starts gently: ${samples}`);
  assert.ok(samples.slice(1).every((v, i) => v >= samples[i]), `keeps going: ${samples}`);
  checks.push(`Dragging a column to the edge scrolls gradually (${samples[0]} → ${samples.at(-1)} of ${max} px)`);

  // A point of the map: its records in a strip in the record panel.
  await tab("Mapa").click();
  await page.getByRole("button", { name: "5 registros · Granada", exact: true }).click();
  await map.getByText("5 registros en este grupo", { exact: true }).waitFor();
  await map.getByRole("button", { name: "Abrir registro R2", exact: true }).click();
  const strip = page.getByTestId("record-strip");
  await strip.waitFor();
  assert.equal(await strip.locator(".record-strip-item").count(), 5);
  assert.equal(await strip.locator(".record-strip-item.is-current").innerText(), "R2");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/views-record-strip.png" });
  await strip.getByRole("button", { name: "Registro siguiente", exact: true }).click();
  await poll(async () => (await page.locator(".record-panel > header strong").innerText()) === "R3", "next record from the strip");
  await strip.locator(".record-strip-item", { hasText: "R5" }).click();
  await poll(async () => (await page.locator(".record-panel > header strong").innerText()) === "R5", "record picked in the strip");
  // Full screen, kept for the next record, and back.
  await page.getByTestId("record-fullscreen").click();
  await poll(async () => (await page.getByTestId("record-panel").getAttribute("class")).includes("fullscreen"), "full screen");
  const width = await page.getByTestId("record-panel").evaluate((el) => el.getBoundingClientRect().width),
    windowWidth = await page.evaluate(() => window.innerWidth);
  assert.ok(width >= windowWidth - 2, `full width: ${width} of ${windowWidth}`);
  await page.screenshot({ path: "test-results/views-record-fullscreen.png" });
  await strip.locator(".record-strip-item", { hasText: "R1" }).click();
  await poll(async () => (await page.locator(".record-panel > header strong").innerText()) === "R1", "next record in full screen");
  assert.ok((await page.getByTestId("record-panel").getAttribute("class")).includes("fullscreen"));
  await page.getByTestId("record-fullscreen").click();
  await poll(async () => !(await page.getByTestId("record-panel").getAttribute("class")).includes("fullscreen"), "side panel again");
  await page.locator(".record-panel>header").getByRole("button", { name: "Cerrar", exact: true }).click();
  // Opened on its own (not from a point), a record has no strip.
  await tab("Tabla").click();
  await page.locator("tbody tr").first().locator(".cell-images, td").first().waitFor();
  checks.push("A map point's records in a strip (next, pick), full-screen panel kept across records and back");

  assert.deepEqual(errors, []);
  await fs.writeFile("test-results/views-e2e.json", JSON.stringify({ status: "passed", checks, errors }, null, 2));
  console.log("Views E2E passed:", checks.join("; "));
} catch (error) {
  if (page) await page.screenshot({ path: "test-results/views-failure.png" }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}

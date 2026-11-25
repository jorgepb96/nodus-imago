// «Variantes y apariciones» in a record, in an isolated native profile: the
// versions of an image grouped by kind, confirmed, rejected and undone, one
// added to the family by search, two compared, and the works it appears in
// (by property, chosen properties, and added by hand).
import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import sharp from "sharp";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-variants-e2e-"));
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
    if (Date.now() > deadline) throw new Error(`Variants: ${what} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
};
const idle = () => poll(async () => !(await call("jobs")).some((j) => ["queued", "running"].includes(j.state)), "jobs");
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

  // A (c. 1930) and D (1960) share a file, B is a reproduction of it, C is another image.
  const csv = path.join(root, "Fotos.csv");
  await fs.writeFile(
    csv,
    'Título,Fecha,Página,Pie de foto\n"A","c. 1930","12","Vista desde el mirador"\n"B","1952","","General view"\n"C","1941","3","Otra vista"\n"D","1960","88",""\n',
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    return true;
  }, csv);
  const plan = await call("csvPreview");
  const db = await call("csvImport", { token: plan.token, name: "Familias", types: ["title", "historical_date", "text", "text"], headers: plan.headers });
  await call("addColumn", { databaseId: db.database.id, name: "Imágenes", type: "attachment" });
  const rows = (await call("search", { databaseIds: [db.database.id], limit: 10 })).rows;
  const row = (title) => rows.find((r) => r.title === title).id;
  const pattern = Buffer.alloc(320 * 240 * 3);
  for (let y = 0; y < 240; y++)
    for (let x = 0; x < 320; x++) {
      const i = (y * 320 + x) * 3;
      pattern[i] = pattern[i + 1] = pattern[i + 2] = (x + Math.round(60 * Math.sin(y / 18)) + (((x >> 5) + (y >> 5)) % 2) * 50) & 255;
    }
  const other = Buffer.alloc(320 * 240 * 3);
  for (let i = 0; i < other.length; i += 3) other[i] = other[i + 1] = other[i + 2] = (((i / 3) % 240) * 3 + ((i / 3 / 320) | 0)) & 255;
  const files = {
    "a.png": await sharp(pattern, { raw: { width: 320, height: 240, channels: 3 } }).png().toBuffer(),
    "b.jpg": await sharp(pattern, { raw: { width: 320, height: 240, channels: 3 } }).modulate({ brightness: 1.08 }).jpeg({ quality: 60 }).toBuffer(),
    "c.png": await sharp(other, { raw: { width: 320, height: 240, channels: 3 } }).png().toBuffer(),
  };
  const targets = { "a.png": ["A", "D"], "b.jpg": ["B"], "c.png": ["C"] };
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(root, name);
    await fs.writeFile(file, bytes);
    for (const title of targets[name]) {
      await app.evaluate(({ dialog }, f) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
        return true;
      }, file);
      const preview = await call("imagePreview", { databaseId: db.database.id, source: "files" });
      await call("importImages", {
        token: preview.token,
        storage: "copy",
        createUnmatched: false,
        assignments: preview.matches.map((m) => ({ pathToken: m.pathToken, rowId: row(title) })),
      });
      await idle();
    }
  }
  await call("variantsPrepare", { databaseIds: [db.database.id] });
  await idle();
  await page.reload();
  await page.locator(".sidebar-databases>button").filter({ hasText: "Familias" }).click();
  await poll(async () => (await page.locator("tbody tr").getByRole("button", { name: "Abrir registro", exact: true }).count()) === 4, "four rows");
  const openRecord = async (title) => {
    await page.locator("tbody tr").getByRole("button", { name: "Abrir registro", exact: true }).nth(["A", "B", "C", "D"].indexOf(title)).click();
  };
  await openRecord("A");
  const panel = page.getByTestId("record-panel");
  await poll(async () => /Variantes y apariciones\s*2/.test(await panel.getByTestId("record-tab-variants").innerText()), "variant count on the tab");
  await panel.getByTestId("record-tab-variants").click();
  const tab = panel.getByTestId("record-variants");
  await tab.getByTestId("variant-group-identical").getByText("D", { exact: true }).waitFor();
  await tab.getByTestId("variant-group-near").getByText("B", { exact: true }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/variants-tab.png" });
  // The same tab filling the window, then back to the side.
  await panel.getByTestId("record-fullscreen").click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/variants-tab-fullscreen.png" });
  await panel.getByTestId("record-fullscreen").click();
  checks.push("The record's versions grouped: the same file (D) and a reproduction (B), counted on the tab");

  // Confirm B and name the kind; reject it; undo.
  const cardB = () => tab.getByTestId("variant-card").filter({ hasText: "B" }).first();
  await cardB().getByTestId("variant-confirm").click();
  await cardB().getByText("Confirmada", { exact: true }).waitFor();
  await cardB().getByRole("combobox").selectOption("reproduction");
  await poll(async () => (await cardB().getByRole("combobox").inputValue()) === "reproduction", "kind saved");
  await cardB().getByTestId("variant-undo").click();
  await cardB().getByTestId("variant-reject").click();
  await tab.getByTestId("variant-group-rejected").waitFor();
  assert.equal(await tab.getByTestId("variant-group-near").count(), 0);
  await tab.getByTestId("variant-group-rejected").locator("summary").click();
  await tab.getByTestId("variant-group-rejected").getByTestId("variant-undo").click();
  await tab.getByTestId("variant-group-near").getByText("B", { exact: true }).waitFor();
  checks.push("Confirm with a kind, reject apart and undo both");

  // Add C, which detection does not match, by searching its record.
  await tab.getByTestId("variants-add").click();
  await tab.getByLabel("Buscar registro para añadir a la familia").fill("Otra vista");
  await tab.getByTestId("variant-candidate").first().click();
  await tab.getByTestId("variant-group-confirmed").getByText("C", { exact: true }).waitFor();
  checks.push("A version added to the family by search, as confirmed by hand");

  // Appearances: by date, page and caption by name; a chosen property; one added by hand.
  const appear = tab.getByTestId("appearances");
  await poll(async () => (await appear.getByTestId("appearance-row").count()) === 4, "four appearances");
  const firstRow = await appear.getByTestId("appearance-row").first().innerText();
  assert.match(firstRow, /1930/);
  assert.match(firstRow, /Vista desde el mirador/);
  assert.match(firstRow, /12/);
  await appear.getByTestId("appearance-add").click();
  const form = appear.getByTestId("appearance-form");
  await form.getByLabel("Obra").fill("Revista de prueba");
  await form.getByLabel("Año").fill("1945");
  await form.getByLabel("Página").fill("7");
  await form.getByLabel("Pie de foto original").fill("Pie manual");
  await form.getByRole("button", { name: "Guardar", exact: true }).click();
  await poll(async () => (await appear.getByTestId("appearance-row").count()) === 5, "manual appearance");
  assert.match(await appear.getByTestId("appearance-row").nth(2).innerText(), /Revista de prueba[\s\S]*1945|1945[\s\S]*Revista de prueba/);
  await appear.getByTestId("appearance-fields").locator("summary").click();
  await appear.getByTestId("appearance-field-caption").selectOption({ label: "Página" });
  await poll(async () => (await appear.getByTestId("appearance-row").first().locator(".rv-caption").innerText()) === "12", "chosen caption property");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/variants-appearances.png", fullPage: false });
  page.once("dialog", (d) => d.accept());
  await appear.getByTestId("appearance-delete").click();
  await poll(async () => (await appear.getByTestId("appearance-row").count()) === 4, "manual appearance deleted");
  checks.push("Works it appears in: date order, page and caption by name, a chosen property, one added and deleted by hand");

  // The family gathered into one photographic work, in a new «Fotografías».
  await tab.getByTestId("variants-gather").click();
  const gather = tab.getByTestId("variant-gather-form");
  assert.equal(await gather.getByLabel("Título de la obra").inputValue(), "A");
  await gather.getByLabel("Título de la obra").fill("Vista de Toledo");
  await gather.getByTestId("variant-gather-apply").click();
  await tab.getByTestId("variant-work").filter({ hasText: "Vista de Toledo" }).waitFor();
  const worksDb = (await call("listDatabases")).find((d) => d.kind === "works");
  assert.equal(worksDb.name, "Fotografías");
  const work = await call("workOf", { rowId: row("A") });
  assert.equal(work.title, "Vista de Toledo");
  assert.deepEqual(work.reproductions.sort(), ["A", "B", "C", "D"].map(row).sort(), "every record of the family under the work");
  assert.equal(await tab.getByTestId("variants-gather").count(), 0, "gathered once");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/variants-work.png" });
  checks.push("The family gathered into one photographic work in a new «Fotografías» database, every record linked to it");

  // Two versions to the comparison board.
  await tab.locator(".rv-self input[type=checkbox]").check();
  await tab.getByTestId("variant-card").filter({ hasText: "B" }).first().locator("input[type=checkbox]").check();
  await tab.getByTestId("variants-compare").click();
  await poll(async () => !(await page.getByTestId("record-panel").count()), "panel closes for the board");
  await page.getByTestId("compare-view").waitFor();
  checks.push("Two versions opened on the comparison board");

  assert.deepEqual(errors, []);
  await fs.writeFile("test-results/variants-e2e.json", JSON.stringify({ status: "passed", checks, errors }, null, 2));
  console.log("Variants E2E passed:", checks.join("; "));
} catch (error) {
  if (page) await page.screenshot({ path: "test-results/variants-failure.png" }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}

// The methodology report from the real window, in an isolated native
// profile: a database with a classified property, the report opened from the
// database's menu, the PDF and its JSON annex saved where the save dialog
// points, and the PDF's pages checked.
import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-methodology-e2e-"));
const env = { ...process.env, IMAGO_DISABLE_UPDATES: "1", IMAGO_USER_DATA: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.IMAGO_DEV_URL;
let app, page;
const errors = [],
  checks = [];
const call = (command, input) => page.evaluate(({ command, input }) => window.imago.call(command, input), { command, input });
const poll = async (predicate, what = "condition") => {
  const deadline = Date.now() + 60000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Methodology: ${what} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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

  const csv = path.join(root, "Postales.csv");
  await fs.writeFile(csv, 'Título,Fecha,Tema\n"Puente","1931","Arquitectura"\n"Mercado","1948","Costumbres"\n"Catedral","c. 1955","Arquitectura"\n');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    return true;
  }, csv);
  const plan = await call("csvPreview");
  const db = await call("csvImport", { token: plan.token, name: "Postales", types: ["title", "historical_date", "select"], headers: plan.headers });
  const theme = db.columns.find((c) => c.name === "Tema");
  await call("statisticSave", { databaseId: db.database.id, name: "Temas", spec: { kind: "frequency", columnId: theme.id } });
  await page.reload();
  await page.locator(".sidebar-databases>button").filter({ hasText: "Postales" }).click();
  await page.getByRole("heading", { name: "Postales", exact: true }).waitFor();

  const target = path.join(root, "Informe.pdf");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    return true;
  }, target);
  await page.locator("summary[aria-label=\"Más acciones de la base\"]").click();
  await page.getByTestId("methodology-open").click();
  const dialog = page.getByTestId("methodology-dialog");
  assert.equal(await dialog.getByTestId("methodology-title").inputValue(), "Informe metodológico de «Postales»");
  await page.screenshot({ path: "test-results/methodology-dialog.png" });
  await dialog.getByTestId("methodology-generate").click();
  await poll(async () => (await fs.stat(target).catch(() => null))?.size > 10000, "PDF saved");
  await poll(async () => !(await page.getByTestId("methodology-dialog").count()), "dialog closes");
  const pdf = await fs.readFile(target);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  assert.ok(pages >= 5, `the report has several pages (${pages})`);
  const annex = JSON.parse(await fs.readFile(path.join(root, "Informe.json"), "utf8"));
  assert.equal(annex.format, "nodus.imago.methodology/1");
  assert.equal(annex.databases[0].name, "Postales");
  assert.match(annex.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(annex.statistics[0].result.kind, "frequency");
  assert.equal(annex.environment.app.length > 0, true);
  await fs.copyFile(target, "test-results/methodology-report.pdf");
  checks.push(`The methodology report saved from the database menu: a ${pages}-page PDF and its JSON annex with the data's fingerprint and the saved statistic`);

  assert.deepEqual(errors, []);
  await fs.writeFile("test-results/methodology-e2e.json", JSON.stringify({ status: "passed", checks, errors }, null, 2));
  console.log("Methodology E2E passed:", checks.join("; "));
} catch (error) {
  if (page) await page.screenshot({ path: "test-results/methodology-failure.png" }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}

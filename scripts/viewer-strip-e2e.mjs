// The strip under the image viewer, in an isolated native profile: a record
// opened from a database table shows the photographs of that list; the arrow
// keys pass to the next record with an image (records without one are passed
// over, and the next batch of the list is read when the first runs out); a
// photograph of the strip opens its record; the header button hides and shows
// the strip, and the choice is kept.
import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import sharp from "sharp";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-viewer-strip-e2e-"));
const env = { ...process.env, IMAGO_DISABLE_UPDATES: "1", IMAGO_USER_DATA: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.IMAGO_DEV_URL;
let app, page;
const errors = [],
  checks = [];
const call = (command, input) => page.evaluate(({ command, input }) => window.imago.call(command, input), { command, input });
const poll = async (predicate, what = "condition") => {
  const deadline = Date.now() + 30000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Viewer strip: ${what} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
};
const idle = () => poll(async () => !(await call("jobs")).some((j) => ["queued", "running"].includes(j.state)), "jobs");
const TOTAL = 230;
const title = (n) => `Postal ${String(n).padStart(3, "0")}`;
// Photographs on the first records, none on 2, and one far down the list (past the first batch of 100).
const withImages = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 160];
const scene = (n) => {
  const hue = (n * 37) % 360;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,72%)"/><stop offset="1" stop-color="hsl(${hue},35%,38%)"/></linearGradient></defs>
    <rect width="900" height="600" fill="url(#s)"/>
    <path d="M0 470 Q 220 ${380 + (n % 4) * 20} 450 440 T 900 420 V600 H0Z" fill="hsl(${(hue + 40) % 360},25%,24%)"/>
    <circle cx="${180 + (n * 53) % 540}" cy="140" r="54" fill="hsl(45,80%,88%)" opacity=".85"/>
    <text x="40" y="560" font-family="Georgia,serif" font-size="44" fill="#f4efe6">${title(n)}</text></svg>`);
};
const current = (viewer) => viewer.locator('[data-testid="viewer-strip-item"][aria-current="true"]').getAttribute("aria-label");
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
  await fs.writeFile(csv, "Título\n" + Array.from({ length: TOTAL }, (_, i) => `"${title(i + 1)}"`).join("\n") + "\n");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    return true;
  }, csv);
  const plan = await call("csvPreview");
  const db = await call("csvImport", { token: plan.token, name: "Postales", types: ["title"], headers: plan.headers });
  await call("addColumn", { databaseId: db.database.id, name: "Imágenes", type: "attachment" });
  const rows = [...(await call("search", { databaseIds: [db.database.id], limit: 200 })).rows, ...(await call("search", { databaseIds: [db.database.id], offset: 200, limit: 200 })).rows];
  for (const n of withImages) {
    const file = path.join(root, `${title(n)}.png`);
    await sharp(scene(n)).png().toFile(file);
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
      return true;
    }, file);
    const preview = await call("imagePreview", { databaseId: db.database.id, source: "files" });
    await call("importImages", {
      token: preview.token,
      storage: "copy",
      createUnmatched: false,
      assignments: preview.matches.map((m) => ({ pathToken: m.pathToken, rowId: rows.find((r) => r.title === title(n)).id })),
    });
  }
  await idle();
  await page.reload();
  await page.locator(".sidebar-databases>button").filter({ hasText: "Postales" }).click();
  await page.locator("tbody tr").getByRole("button", { name: "Abrir registro", exact: true }).first().click();
  await page.getByTestId("record-image-open").click();
  const viewer = page.getByTestId("image-viewer");
  await viewer.locator(".viewer-image").waitFor();

  // The strip is shown at first, with the photographs of the list read so far.
  const strip = viewer.getByTestId("viewer-strip");
  await strip.waitFor();
  await poll(async () => (await strip.getByTestId("viewer-strip-item").count()) === withImages.length - 1, "first batch in the strip");
  assert.equal(await strip.getByTestId("viewer-strip-count").innerText(), `1 / ${TOTAL}`);
  assert.equal(await current(viewer), title(1));
  checks.push(`The strip shows the table's photographs (first batch: ${withImages.length - 1}) and «1 / ${TOTAL}»`);

  // → passes over the record without a photograph.
  await page.keyboard.press("ArrowRight");
  await poll(async () => (await current(viewer)) === title(3), "→ to Postal 003");
  assert.equal(await strip.getByTestId("viewer-strip-count").innerText(), `3 / ${TOTAL}`);
  assert.match(await page.getByTestId("record-panel").innerText(), new RegExp(title(3)));
  checks.push("→ opens the next record with a photograph (Postal 002, without one, is passed over) and the record panel follows");

  // A photograph of the strip opens its record.
  await strip.getByTestId("viewer-strip-item").filter({ hasText: title(12) }).click();
  await poll(async () => (await current(viewer)) === title(12), "strip click to Postal 012");
  assert.equal(await strip.getByTestId("viewer-strip-count").innerText(), `12 / ${TOTAL}`);
  checks.push("A click on the strip opens that record");

  // At the end of what was read, → reads the next batch of the list.
  await page.keyboard.press("ArrowRight");
  await poll(async () => (await current(viewer)) === title(160), "→ to Postal 160 in the second batch");
  assert.equal(await strip.getByTestId("viewer-strip-count").innerText(), `160 / ${TOTAL}`);
  assert.equal(await strip.getByTestId("viewer-strip-item").count(), withImages.length);
  await page.keyboard.press("ArrowLeft");
  await poll(async () => (await current(viewer)) === title(12), "← back to Postal 012");
  checks.push("→ past the last photograph read loads the next batch (Postal 160 of 230) and ← comes back");

  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/viewer-strip.png" });

  // The header button hides the strip, and the choice is kept for the next opening.
  await viewer.getByTestId("viewer-strip-toggle").click();
  assert.equal(await viewer.getByTestId("viewer-strip").count(), 0);
  await page.keyboard.press("ArrowRight");
  await poll(async () => /160/.test(await page.getByTestId("record-panel").innerText()), "→ without the strip");
  await page.keyboard.press("Escape");
  await poll(async () => !(await page.getByTestId("image-viewer").count()), "viewer closed");
  await page.getByTestId("record-image-open").click();
  await viewer.locator(".viewer-image").waitFor();
  assert.equal(await viewer.getByTestId("viewer-strip").count(), 0, "the strip stays hidden");
  await viewer.getByTestId("viewer-strip-toggle").click();
  await strip.waitFor();
  checks.push("The header button hides and shows the strip; → still works without it; the choice is kept");

  assert.deepEqual(errors, []);
  await fs.writeFile("test-results/viewer-strip-e2e.json", JSON.stringify({ status: "passed", checks, errors }, null, 2));
  console.log("Viewer strip E2E passed:", checks.join("; "));
} catch (error) {
  if (page) await page.screenshot({ path: "test-results/viewer-strip-failure.png" }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}

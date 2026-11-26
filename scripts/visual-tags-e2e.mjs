// «Etiquetado» in the image viewer, in an isolated native profile: regions
// drawn by dragging, a tag created by typing and Enter, an existing one picked,
// a dictionary term picked, a region moved and deleted, the layers hidden, an
// image marked reviewed with nothing to tag, and «Etiquetas visuales» filled in
// the table with each tag's appearances.
import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import sharp from "sharp";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-visual-tags-e2e-"));
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
    if (Date.now() > deadline) throw new Error(`Visual tags: ${what} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
};
const idle = () => poll(async () => !(await call("jobs")).some((j) => ["queued", "running"].includes(j.state)), "jobs");
const checkContrast = async (label) => {
  const ratios = await label.evaluate((node) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    const paint = (colour) => {
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 1, 1);
    };
    const luminance = () => {
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3), (value) => {
        const srgb = value / 255;
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      });
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    };
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    try {
      return [false, true].map((dark) => {
        root.classList.toggle("dark", dark);
        ctx.clearRect(0, 0, 1, 1);
        const backgrounds = [];
        for (let element = node; !element.matches(".image-viewer"); element = element.parentElement) {
          backgrounds.unshift(getComputedStyle(element).backgroundColor);
        }
        backgrounds.forEach(paint);
        const background = luminance();
        paint(getComputedStyle(node).color);
        const text = luminance();
        return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
      });
    } finally {
      root.classList.toggle("dark", wasDark);
    }
  });
  assert.ok(ratios.every((ratio) => ratio >= 4.5), `Label must be readable in light and dark mode (${ratios})`);
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

  // Two photographs with an image each, and a «Tema» vocabulary to use as a dictionary.
  const csv = path.join(root, "Postales.csv");
  await fs.writeFile(csv, 'Título,Tema\n"Plaza","Fiesta"\n"Dehesa","Campo;Ganado"\n');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    return true;
  }, csv);
  const plan = await call("csvPreview");
  const db = await call("csvImport", { token: plan.token, name: "Postales", types: ["title", "multi_select"], headers: plan.headers });
  await call("addColumn", { databaseId: db.database.id, name: "Imágenes", type: "attachment" });
  const rows = (await call("search", { databaseIds: [db.database.id], limit: 10 })).rows;
  const row = (title) => rows.find((r) => r.title === title).id;
  for (const [title, colour] of [["Plaza", "#8a6d4b"], ["Dehesa", "#4b6d8a"]]) {
    const file = path.join(root, `${title}.png`);
    await sharp({ create: { width: 900, height: 600, channels: 3, background: colour } }).png().toFile(file);
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
  await page.reload();
  await page.locator(".sidebar-databases>button").filter({ hasText: "Postales" }).click();
  await poll(async () => (await page.locator("tbody tr").getByRole("button", { name: "Abrir registro", exact: true }).count()) === 2, "two rows");

  // Open Plaza's image in the viewer and turn «Etiquetado» on.
  await page.locator("tbody tr").getByRole("button", { name: "Abrir registro", exact: true }).first().click();
  await page.getByTestId("record-image-open").click();
  const viewer = page.getByTestId("image-viewer");
  await viewer.locator(".viewer-image").waitFor();
  await poll(async () => (await viewer.locator(".viewer-image").boundingBox())?.width > 100, "image shown");
  await viewer.getByTestId("viewer-tagging").click();
  const image = await viewer.locator(".viewer-image").boundingBox();
  const drag = async (x0, y0, x1, y1) => {
    await page.mouse.move(image.x + image.width * x0, image.y + image.height * y0);
    await page.mouse.down();
    await page.mouse.move(image.x + image.width * x1, image.y + image.height * y1, { steps: 6 });
    await page.mouse.up();
  };
  // A new tag: type its name and press Enter.
  await drag(0.1, 0.2, 0.3, 0.6);
  const picker = viewer.getByTestId("tag-picker");
  await picker.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "tag-picker-input", "the search is focused");
  await page.keyboard.type("Toro");
  await page.keyboard.press("Enter");
  await viewer.locator("[data-tag-region]").filter({ hasText: "Toro" }).waitFor();
  // The same tag again, picked from the list.
  await drag(0.5, 0.3, 0.7, 0.7);
  await picker.waitFor();
  await page.keyboard.type("to");
  const toro = picker.getByTestId("tag-picker-option").filter({ hasText: "Toro" });
  await toro.getByRole("button", { name: "Toro", exact: true }).hover();
  await checkContrast(toro.locator(".option-label"));
  await toro.getByRole("button", { name: "Editar opción Toro" }).click();
  const blue = picker.getByRole("button", { name: "Azul", exact: true });
  await blue.hover();
  await checkContrast(blue.locator(".option-edit-label"));
  await page.screenshot({ path: "test-results/visual-tags-colour-hover.png" });
  await page.keyboard.press("Escape");
  await blue.waitFor({ state: "hidden" });
  // Hold the real save so an immediate region cannot be mistaken for a fast database response.
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get("imago:call");
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    ipcMain.removeHandler("imago:call");
    ipcMain.handle("imago:call", async (event, command, ...args) => {
      if (command === "visualTagSave") await hold;
      return handler(event, command, ...args);
    });
    globalThis.releaseTagSave = release;
  });
  await toro.getByRole("button", { name: "Toro", exact: true }).click();
  await picker.waitFor({ state: "hidden" });
  await viewer.locator('.viewer-tag[aria-busy="true"]').filter({ hasText: "Toro" }).waitFor();
  assert.equal(await viewer.locator("[data-tag-region]").count(), 1);
  await app.evaluate(() => globalThis.releaseTagSave());
  await poll(async () => (await viewer.locator("[data-tag-region]").count()) === 2, "second region saved");
  checks.push("Existing tag appears on click while the database save is held; tag and colour highlights are readable in either theme");
  // A dictionary: «Tema»; its terms appear under the tags and one becomes a tag.
  await viewer.getByTestId("viewer-tag-dictionary").selectOption(db.columns.find((c) => c.name === "Tema").id);
  await drag(0.75, 0.1, 0.95, 0.4);
  await picker.waitFor();
  await page.keyboard.type("fies");
  const fiesta = picker.getByTestId("tag-picker-term").filter({ hasText: "Fiesta" });
  await fiesta.waitFor();
  await fiesta.getByRole("button").hover();
  await checkContrast(fiesta.locator(".option-label"));
  await page.screenshot({ path: "test-results/visual-tags-dictionary-hover.png" });
  await picker.getByTestId("tag-picker-input").hover();
  await page.keyboard.press("ArrowUp");
  // «Crear "fies"» comes first; the arrow goes down to the dictionary's term.
  assert.match(await picker.getByTestId("tag-picker-create").innerText(), /fies/);
  await page.keyboard.press("ArrowDown");
  await checkContrast(fiesta.locator(".option-label"));
  await page.keyboard.press("Enter");
  await viewer.locator("[data-tag-region]").filter({ hasText: "Fiesta" }).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/visual-tags-viewer.png" });
  const visual = (await call("detail", { id: db.database.id })).columns.find((c) => c.config.visualTags);
  assert.equal(visual.name, "Etiquetas visuales");
  assert.deepEqual(visual.options.map((o) => o.label).sort(), ["Fiesta", "Toro"]);
  checks.push("Regions drawn in «Etiquetado»: a tag created with Enter, an existing one picked, a dictionary term turned into a tag; «Etiquetas visuales» created");

  // Move a region, then delete it with the keyboard.
  const third = viewer.getByTestId("viewer-tag-region").filter({ hasText: "Fiesta" });
  const before = await third.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 40, before.y + before.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await poll(async () => {
    const regions = (await call("visualTagsList", { assetId: (await call("getRow", { id: row("Plaza") })).images[0].id })).regions;
    const fiesta = regions.find((r) => r.optionId === visual.options.find((o) => o.label === "Fiesta").id);
    return fiesta && Math.abs(fiesta.x - 0.75) > 0.02;
  }, "region moved");
  await page.keyboard.press("Delete");
  await poll(async () => (await viewer.getByTestId("viewer-tag-region").count()) === 2, "region deleted");
  // The layers: hide the tags, show them again.
  await viewer.getByTestId("viewer-layer-tags").click();
  assert.equal(await viewer.getByTestId("viewer-tag-region").count(), 0);
  await viewer.getByTestId("viewer-layer-tags").click();
  assert.equal(await viewer.getByTestId("viewer-tag-region").count(), 2);
  checks.push("A region moved and deleted (Supr); the tag layer hidden and shown");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await poll(async () => !(await page.getByTestId("image-viewer").count()), "viewer closed");

  // Dehesa: reviewed with nothing to tag.
  await call("visualTagReview", { assetId: (await call("getRow", { id: row("Dehesa") })).images[0].id, reviewed: true });
  await page.locator(".record-panel>header").getByRole("button", { name: "Cerrar", exact: true }).click().catch(() => {});
  await page.reload();
  await page.locator(".sidebar-databases>button").filter({ hasText: "Postales" }).click();
  await poll(async () => (await page.getByTestId("visual-tags-cell").count()) === 2, "visual tags column in the table");
  const cells = await page.getByTestId("visual-tags-cell").allInnerTexts();
  assert.ok(cells.some((text) => /Toro\s*×2/.test(text)), `Toro ×2 in the table (${cells.join(" | ")})`);
  assert.ok(cells.some((text) => /Revisada, sin elementos/.test(text)));
  await page.screenshot({ path: "test-results/visual-tags-table.png" });
  // Statistics: photographs and appearances.
  const stats = await call("statisticCompute", { search: { databaseIds: [db.database.id] }, spec: { kind: "frequency", columnId: visual.id, count: "appearances" } });
  assert.deepEqual(stats.categories.map((c) => [c.label, c.count]), [["Toro", 2]]);
  assert.equal(stats.visual.reviewedEmpty, 1);
  checks.push("«Etiquetas visuales» in the table (Toro ×2, Revisada, sin elementos) and counted by appearances");

  assert.deepEqual(errors, []);
  await fs.writeFile("test-results/visual-tags-e2e.json", JSON.stringify({ status: "passed", checks, errors }, null, 2));
  console.log("Visual tags E2E passed:", checks.join("; "));
} catch (error) {
  if (page) await page.screenshot({ path: "test-results/visual-tags-failure.png" }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}

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
import { createServer } from "node:http";
import sharp from "sharp";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-visual-tags-e2e-"));
const env = { ...process.env, IMAGO_DISABLE_UPDATES: "1", IMAGO_USER_DATA: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.IMAGO_DEV_URL;
let app, page, visionServer;
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

  // Two photographs with an image each and two possible dictionaries.
  const csv = path.join(root, "Postales.csv");
  await fs.writeFile(csv, 'Título,Tema,Tipo\n"Plaza","Fiesta","Urbana"\n"Dehesa","Campo;Ganado;Bosque","Rural"\n');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    return true;
  }, csv);
  const plan = await call("csvPreview");
  const db = await call("csvImport", { token: plan.token, name: "Postales", types: ["title", "multi_select", "select"], headers: plan.headers });
  await call("addColumn", { databaseId: db.database.id, name: "Imágenes", type: "attachment" });
  await call("addColumn", { databaseId: db.database.id, name: "Patrimonio", type: "multi_select", config: { heritage: true } });
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
  const plaza = await call("getRow", { id: row("Plaza") });
  await call("annotationSave", { assetId: plaza.images[0].id, x: 0.03, y: 0.04, w: 0.06, h: 0.09, note: "Detalle de la foto", tags: [] });
  await page.reload();
  await page.locator(".sidebar-databases>button").filter({ hasText: "Postales" }).click();
  await poll(async () => (await page.locator("tbody tr").getByRole("button", { name: "Abrir registro", exact: true }).count()) === 2, "two rows");
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get("imago:call");
    ipcMain.removeHandler("imago:call");
    ipcMain.handle("imago:call", async (event, command, input) => {
      const result = await handler(event, command, input);
      return command === "status" ? { ...result, semanticReady: true, indexed: 1 } : result;
    });
  });

  // Open Plaza's image in the viewer and turn «Etiquetado» on.
  await page.locator("tbody tr").getByRole("button", { name: "Abrir registro", exact: true }).first().click();
  const taggedBadge = page.getByTestId("record-image-tagged-regions");
  assert.equal(await taggedBadge.count(), 0);
  await page.getByTestId("record-image-open").click();
  const viewer = page.getByTestId("image-viewer");
  await viewer.locator(".viewer-image").waitFor();
  await poll(async () => (await viewer.locator(".viewer-image").boundingBox())?.width > 100, "image shown");
  await viewer.locator(".viewer-stage").getByRole("button", { name: "Detalle de la foto" }).locator(".viewer-annotation-icon .lucide-message-square").waitFor();
  const tabs = viewer.getByRole("tablist", { name: "Secciones del visor" });
  const annotationTab = tabs.getByRole("tab", { name: "Anotaciones", exact: true });
  const tagTab = tabs.getByRole("tab", { name: "Etiquetas", exact: true });
  const heritageTab = tabs.getByRole("tab", { name: "Patrimonio", exact: true });
  assert.equal(await annotationTab.getAttribute("aria-selected"), "true");
  assert.equal(await tagTab.textContent(), "");
  assert.equal(await tagTab.getAttribute("data-tooltip"), "Etiquetas");
  await annotationTab.press("ArrowRight");
  await viewer.getByRole("tabpanel", { name: "Etiquetas", exact: true }).waitFor();
  assert.match(await tagTab.textContent(), /Etiquetas/);
  assert.equal(await annotationTab.textContent(), "");
  assert.equal(await viewer.getByTestId("viewer-tagging").getAttribute("aria-pressed"), "false");
  await tagTab.press("End");
  await viewer.getByRole("tabpanel", { name: "Patrimonio", exact: true }).waitFor();
  await heritageTab.press("Home");
  await viewer.getByRole("tabpanel", { name: "Anotaciones", exact: true }).waitFor();
  checks.push("The viewer sidebar shows one panel at a time, with icon-only inactive tabs and keyboard navigation");

  const searchTool = viewer.getByTestId("viewer-search");
  await poll(async () => !(await searchTool.isDisabled()), "search tool enabled");
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const modifierLabel = process.platform === "darwin" ? "Comando" : "Ctrl";
  for (const [testId, key] of [["viewer-annotate", "A"], ["viewer-search", "B"], ["viewer-heritage", "P"], ["viewer-tagging", "E"]]) {
    const control = viewer.getByTestId(testId);
    assert.equal(await control.getAttribute("aria-keyshortcuts"), `${modifier}+${key}`);
    assert.ok((await control.getAttribute("data-tooltip")).endsWith(`(Atajo ${modifierLabel} + ${key})`));
    await page.keyboard.press(key.toLowerCase());
    assert.equal(await control.getAttribute("aria-pressed"), "false", "a letter alone leaves the tool unchanged");
    await page.keyboard.down(modifier);
    await page.keyboard.down(key.toLowerCase());
    await page.keyboard.down(key.toLowerCase());
    await page.keyboard.up(key.toLowerCase());
    await page.keyboard.up(modifier);
    assert.equal(await control.getAttribute("aria-pressed"), "true", "holding the key activates the tool once");
    await control.click();
    assert.equal(await control.getAttribute("aria-pressed"), "false");
    await control.click();
    await page.keyboard.press(`${modifier}+${key.toLowerCase()}`);
    assert.equal(await control.getAttribute("aria-pressed"), "false");
  }
  checks.push("Command or Ctrl plus A, B, P and E match the toolbar controls and their tooltips");
  await viewer.getByTestId("viewer-tagging").click();
  await viewer.getByRole("tabpanel", { name: "Etiquetas", exact: true }).waitFor();
  const drag = async (x0, y0, x1, y1) => {
    const image = await viewer.locator(".viewer-image").boundingBox();
    await page.mouse.move(image.x + image.width * x0, image.y + image.height * y0);
    await page.mouse.down();
    await page.mouse.move(image.x + image.width * x1, image.y + image.height * y1, { steps: 6 });
    await page.mouse.up();
  };
  // A new tag: type its name and press Enter.
  await drag(0.1, 0.2, 0.3, 0.6);
  const picker = viewer.getByTestId("tag-picker");
  const savePicker = picker.getByTestId("tag-picker-save");
  await picker.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "tag-picker-input", "the search is focused");
  await page.keyboard.type("bape");
  assert.equal(await picker.getByTestId("tag-picker-input").inputValue(), "bape");
  assert.equal(await viewer.getByTestId("viewer-tagging").getAttribute("aria-pressed"), "true");
  await picker.getByTestId("tag-picker-input").clear();
  await page.keyboard.type("Toro");
  await page.keyboard.press("Enter");
  await savePicker.click();
  await viewer.locator("[data-tag-region]").filter({ hasText: "Toro" }).locator(".viewer-tag-label .lucide-tag").waitFor();
  checks.push("Annotations show a comment icon and visual tags show a tag icon next to their names");
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
  await picker.getByRole("button", { name: "Quitar «Toro»", exact: true }).waitFor();
  await savePicker.click();
  await picker.waitFor({ state: "hidden" });
  await viewer.locator('.viewer-tag[aria-busy="true"]').filter({ hasText: "Toro" }).waitFor();
  assert.equal(await viewer.locator("[data-tag-region]").count(), 1);
  await app.evaluate(() => globalThis.releaseTagSave());
  await poll(async () => (await viewer.locator("[data-tag-region]").count()) === 2, "second region saved");
  checks.push("Existing tag appears on click while the database save is held; tag and colour highlights are readable in either theme");
  const dictionary = viewer.getByTestId("viewer-tag-dictionary");
  const chooseDictionary = async (name) => {
    const value = name ? db.columns.find((c) => c.name === name).id : "";
    await dictionary.selectOption(value);
    await poll(async () => !(await dictionary.isDisabled()) && await dictionary.inputValue() === value, "dictionary loaded");
  };
  // «Tema» starts with its own empty set of regions and offers terms to apply.
  await chooseDictionary("Tema");
  assert.equal(await viewer.locator("[data-tag-region]").count(), 0);
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
  await picker.getByRole("button", { name: "Quitar «Fiesta»", exact: true }).waitFor();
  await page.keyboard.type("Campo");
  await page.keyboard.press("Enter");
  await picker.getByRole("button", { name: "Quitar «Campo»", exact: true }).waitFor();
  await savePicker.click();
  const combined = viewer.locator('[data-tag-region][aria-label="Fiesta, Campo"]');
  await combined.waitFor();
  assert.equal(await viewer.locator("[data-tag-region]").count(), 1);
  assert.match(await combined.evaluate((el) => el.style.getPropertyValue("--tag-gradient")), / 0% 50%, .* 50% 100%\)/);
  const firstRegionId = await combined.getAttribute("data-tag-region");
  await combined.getByTestId("viewer-tag-retag").click();
  await picker.getByRole("button", { name: "Quitar «Campo»", exact: true }).click();
  await page.keyboard.type("Ganado");
  await page.keyboard.press("Enter");
  await savePicker.click();
  const edited = viewer.locator('[data-tag-region][aria-label="Fiesta, Ganado"]');
  await edited.waitFor();
  assert.equal(await edited.getAttribute("data-tag-region"), firstRegionId);
  checks.push("Several tags can be saved together or edited in an existing region, with two equal color bands");
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/visual-tags-viewer.png" });
  await drag(0.75, 0.65, 0.92, 0.88);
  await picker.waitFor();
  await page.keyboard.type("Campo");
  await page.keyboard.press("Enter");
  await savePicker.click();
  await viewer.locator("[data-tag-region]").filter({ hasText: "Campo" }).waitFor();
  await drag(0.40, 0.12, 0.55, 0.25);
  await picker.waitFor();
  const applied = picker.getByRole("group", { name: "Etiquetas aplicadas" });
  const terms = picker.getByRole("group", { name: "Del diccionario «Tema»" });
  assert.deepEqual(await applied.locator(".option-label").allTextContents(), ["Campo", "Fiesta", "Ganado"]);
  assert.deepEqual(await terms.locator(".option-label").allTextContents(), ["Bosque"]);
  await page.keyboard.press("Escape");
  await chooseDictionary("Tipo");
  assert.equal(await viewer.locator("[data-tag-region]").count(), 0);
  const review = viewer.getByTestId("viewer-tag-review");
  assert.equal(await review.getAttribute("aria-pressed"), "false");
  await review.click();
  await poll(async () => await review.getAttribute("aria-pressed") === "true", "review saved for Tipo");
  await chooseDictionary("Tema");
  assert.deepEqual(await viewer.locator("[data-tag-region]").evaluateAll((regions) => regions.map((region) => region.getAttribute("aria-label"))), ["Fiesta, Ganado", "Campo"]);
  const visual = (await call("detail", { id: db.database.id })).columns.find((c) => c.config.visualTags);
  assert.equal(visual.name, "Etiquetas visuales");
  assert.deepEqual(visual.options.map((o) => o.label).sort(), ["Campo", "Fiesta", "Ganado", "Toro"]);
  checks.push("Applied tags are alphabetized in their own group, and each dictionary restores its regions and review");

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
  await poll(async () => (await viewer.getByTestId("viewer-tag-region").count()) === 1, "region deleted");
  await chooseDictionary("Tipo");
  assert.equal(await review.getAttribute("aria-pressed"), "true");
  await chooseDictionary(null);
  assert.deepEqual(await viewer.locator("[data-tag-region] .viewer-tag-label").allTextContents(), ["Toro", "Toro"]);
  // Each layer can be changed while the shared popover stays open.
  const layerTrigger = viewer.getByTestId("viewer-layers");
  await layerTrigger.click();
  const layerMenu = viewer.getByRole("dialog", { name: "Capas", exact: true });
  assert.deepEqual(await layerMenu.getByRole("button").allTextContents(), ["Etiquetas", "Anotaciones", "Tira"]);
  const tagsLayer = layerMenu.getByTestId("viewer-layer-tags");
  const notesLayer = layerMenu.getByTestId("viewer-layer-notes");
  await tagsLayer.click();
  assert.equal(await viewer.getByTestId("viewer-tag-region").count(), 0);
  assert.equal(await viewer.locator(".viewer-annotation-icon").count(), 1);
  await notesLayer.click();
  assert.equal(await viewer.locator(".viewer-annotation-icon").count(), 0);
  await tagsLayer.click();
  assert.equal(await viewer.getByTestId("viewer-tag-region").count(), 2);
  await notesLayer.click();
  assert.equal(await viewer.locator(".viewer-annotation-icon").count(), 1);
  await page.keyboard.press("Escape");
  await layerMenu.waitFor({ state: "hidden" });
  assert.equal(await layerTrigger.getAttribute("aria-expanded"), "false");
  checks.push("A region moved and deleted (Supr); labels and annotations toggle separately from the same popover");
  await viewer.locator(".viewer-close").click();
  await viewer.waitFor({ state: "hidden" });
  await taggedBadge.waitFor();
  assert.equal(await taggedBadge.innerText(), "2");
  assert.equal(await taggedBadge.getAttribute("data-tooltip"), "Zonas etiquetadas en esta imagen");
  assert.equal(await page.locator(".record-image-regions:not(.is-tagged)").innerText(), "1");
  checks.push("The record photograph shows separate badges for annotations and tagged regions in the active dictionary");

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
  assert.deepEqual(stats.categories.map((c) => [c.label, c.count]), [["Toro", 2], ["Campo", 1]]);
  assert.equal(stats.visual.reviewedEmpty, 1);
  checks.push("«Etiquetas visuales» in the table (Toro ×2, Revisada, sin elementos) and counted by appearances");

  // Keep the deletion pending long enough to check the confirmation's feedback.
  await page.locator("tbody tr").getByRole("button", { name: "Abrir registro", exact: true }).first().click();
  await page.getByTestId("record-image-open").click();
  await viewer.locator(".viewer-image").waitFor();
  await viewer.getByTestId("viewer-tagging").click();
  await viewer.getByTestId("viewer-tag-region").filter({ hasText: "Toro" }).first().waitFor();
  await drag(0.75, 0.1, 0.95, 0.4);
  await picker.getByRole("button", { name: "Editar opción Toro" }).click();
  await picker.getByRole("button", { name: "Eliminar", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Eliminar opción" });
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get("imago:call");
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    ipcMain.removeHandler("imago:call");
    ipcMain.handle("imago:call", async (event, command, input) => {
      if (command === "saveOptions" && input?.dropFromCells) await hold;
      return handler(event, command, input);
    });
    globalThis.releaseTagDeletion = release;
  });
  await confirm.getByRole("button", { name: "Eliminar", exact: true }).click();
  const deleting = confirm.getByRole("button", { name: "Eliminando…", exact: true });
  await deleting.locator(".spin").waitFor();
  assert.ok(await deleting.isDisabled());
  await app.evaluate(() => globalThis.releaseTagDeletion());
  await confirm.waitFor({ state: "hidden" });
  await viewer.getByTestId("viewer-tag-region").filter({ hasText: "Toro" }).first().waitFor({ state: "hidden" });
  checks.push("Deleting a tag shows «Eliminando…» and a spinner while pending, then removes its regions from the viewer");

  // Use a local provider fixture for the real model picker, image request and approval.
  const visionRequests = [];
  const visionBudgets = [];
  visionServer = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [
        { id: "vision-fixture", capabilities: { vision: true } },
        { id: "vision-other", capabilities: { vision: true } },
        { id: "text-fixture", capabilities: { vision: false } },
      ] }));
      return;
    }
    try {
      assert.equal(req.url, "/v1/chat/completions");
      const parts = [];
      for await (const part of req) parts.push(part);
      const request = JSON.parse(Buffer.concat(parts).toString());
      visionBudgets.push(request.max_tokens);
      if (visionBudgets.length === 1) {
        res.end(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: null } }] }));
        return;
      }
      const content = request.messages.find((message) => message.role === "user").content;
      const prompt = content.find((part) => part.type === "text").text;
      const labels = JSON.parse(prompt.split("\n").at(-1).replace("Dictionary (number and label): ", ""));
      const keyOf = (label) => labels.find((entry) => entry[1] === label)[0];
      visionRequests.push({ model: request.model, image: content.find((part) => part.type === "image_url")?.image_url.url });
      const tags = [keyOf("Bosque"), keyOf("Ganado")];
      const rerun = visionRequests.length > 1;
      if (rerun) tags.push(keyOf("Fiesta"));
      const answer = { regions: [{ box: rerun ? [245, 365, 425, 595] : [240, 360, 420, 590], tags }] };
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
  await new Promise((resolve, reject) => visionServer.once("error", reject).listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${visionServer.address().port}/v1`;
  await call("updateSettings", { apiProfiles: { custom: { baseUrl, models: ["vision-fixture"] } } });
  await picker.getByRole("button", { name: "Cancelar", exact: true }).click();
  await chooseDictionary("Tema");
  await annotationTab.click();
  await tagTab.click();
  const suggestions = viewer.getByTestId("viewer-tag-suggestions");
  await suggestions.getByRole("button", { name: "Modelo de visión", exact: true }).click();
  const modelSearch = page.getByRole("combobox", { name: "Buscar: Modelo de visión" });
  await modelSearch.fill("text");
  assert.equal(await page.getByRole("option", { name: /text-fixture/ }).count(), 0);
  await modelSearch.fill("vision");
  assert.equal(await page.getByRole("option", { name: /vision-other/ }).count(), 0);
  await page.getByRole("option", { name: /vision-fixture/ }).click();
  const suggest = suggestions.getByTestId("viewer-tag-suggest-run");
  const bosque = suggestions.getByRole("checkbox", { name: "Bosque", exact: true });
  const ganado = suggestions.getByRole("checkbox", { name: "Ganado", exact: true });
  const beforeSuggestions = await viewer.locator("[data-tag-region]").count();
  await suggest.click();
  await bosque.waitFor();
  assert.equal(await viewer.locator("[data-tag-region]").count(), beforeSuggestions);
  await viewer.getByRole("button", { name: "Ajustar a la pantalla" }).click();
  const proposal = viewer.getByTestId("viewer-proposal-box");
  const original = await proposal.boundingBox();
  assert.ok(original);
  await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2);
  await page.mouse.down();
  await page.mouse.move(original.x + original.width / 2 + 24, original.y + original.height / 2 + 18, { steps: 4 });
  await page.mouse.up();
  const moved = await proposal.boundingBox();
  assert.ok(moved && moved.x > original.x + 10 && moved.y > original.y + 10, "the suggestion can be moved");
  const grip = await proposal.locator('[data-grip="se"]').boundingBox();
  assert.ok(grip);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 18, grip.y + grip.height / 2 + 14, { steps: 4 });
  await page.mouse.up();
  const resized = await proposal.boundingBox();
  assert.ok(resized && resized.width > moved.width + 8 && resized.height > moved.height + 8, "the suggestion can be resized");
  await ganado.uncheck();
  await suggest.click();
  await poll(async () => visionRequests.length === 2 && !(await suggest.isDisabled()), "vision suggestion rerun");
  assert.deepEqual(visionBudgets, [6144, 12288, 6144]);
  assert.ok(visionRequests.every(({ image, model }) => model === "vision-fixture" && image.startsWith("data:image/jpeg;base64,")));
  assert.deepEqual(await proposal.boundingBox(), resized);
  assert.equal(await ganado.isChecked(), false);
  const freshFiesta = suggestions.getByRole("checkbox", { name: /Fiesta.*Nueva/ });
  assert.equal(await freshFiesta.isChecked(), true);
  await freshFiesta.uncheck();
  await suggestions.getByTestId("viewer-tag-suggest-apply").click();
  const saved = viewer.locator('[data-tag-region][aria-label="Bosque"]');
  await saved.waitFor();
  assert.equal(await viewer.locator("[data-tag-region]").count(), beforeSuggestions + 1);
  assert.equal(await viewer.locator('[data-tag-region][aria-label*="Ganado"]').count(), 0);
  const undo = viewer.getByTestId("viewer-tag-undo");
  await poll(async () => undo.isEnabled(), "undo available after applying suggestions");
  const tagPanel = viewer.getByTestId("viewer-tag-panel");
  const [dictionaryBox, undoBox, countsBox, listBox, aiBox] = await Promise.all([
    tagPanel.getByTestId("viewer-tag-dictionary").boundingBox(), undo.boundingBox(),
    tagPanel.getByTestId("viewer-tag-counts").boundingBox(), tagPanel.locator(".viewer-list").boundingBox(),
    suggestions.boundingBox(),
  ]);
  assert.ok(dictionaryBox && undoBox && countsBox && listBox && aiBox);
  assert.ok(Math.abs(dictionaryBox.y - undoBox.y) < 1 && undoBox.x >= dictionaryBox.x + dictionaryBox.width);
  assert.ok(dictionaryBox.y + dictionaryBox.height < countsBox.y && countsBox.y < listBox.y && listBox.y + listBox.height < aiBox.y);
  assert.equal(await undo.textContent(), "");
  assert.match(await undo.getAttribute("aria-label"), /Deshacer/);
  checks.push("Tags follow the dictionary, with icon-only Undo aligned beside the selector");
  await ganado.press("Control+z");
  await saved.waitFor({ state: "hidden" });
  await poll(async () => suggestions.getByRole("checkbox", { name: "Bosque", exact: true }).isChecked(), "undone suggestion is ready to review");
  checks.push("Vision suggestions can be moved and resized; retry keeps edits and decisions, marks new labels, and applying selected tags can be undone");

  assert.deepEqual(errors, []);
  await fs.writeFile("test-results/visual-tags-e2e.json", JSON.stringify({ status: "passed", checks, errors }, null, 2));
  console.log("Visual tags E2E passed:", checks.join("; "));
} catch (error) {
  if (page) await page.screenshot({ path: "test-results/visual-tags-failure.png" }).catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  if (visionServer) await new Promise((resolve) => visionServer.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}

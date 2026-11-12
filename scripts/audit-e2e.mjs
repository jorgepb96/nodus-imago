// Independent UI/IPC/network audit. All data and the OpenAI-compatible endpoint
// are temporary and local. The endpoint is a contract fixture, not AI inference.
import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import assert from "node:assert/strict";
import sharp from "sharp";
import AdmZip from "adm-zip";
import { chooseCriteria } from "./e2e-criteria.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-audit-"));
const results = [],
  errors = [],
  requests = [],
  traffic = [];
let app,
  page,
  responseDelay = 100;
const server = http.createServer(async (req, res) => {
  traffic.push({ method: req.method, url: req.url });
  if (req.url === "/v1/models") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: [{ id: "audit-description" }, { id: "audit-taxonomy" }],
      }),
    );
    return;
  }
  let body = "";
  for await (const part of req) body += part;
  const data = JSON.parse(body);
  requests.push(data);
  setTimeout(() => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                data.model === "audit-taxonomy"
                  ? '["Paisaje"]'
                  : "Descripción de prueba del endpoint local.",
            },
          },
        ],
      }),
    );
  }, responseDelay);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const env = { ...process.env, IMAGO_USER_DATA: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.IMAGO_DEV_URL;
const launchOptions = process.env.IMAGO_E2E_EXECUTABLE
  ? {
      executablePath: process.env.IMAGO_E2E_EXECUTABLE,
      args: process.env.IMAGO_E2E_NO_SANDBOX ? ["--no-sandbox"] : [],
      env,
    }
  : {
      args: process.env.IMAGO_E2E_NO_SANDBOX ? [".", "--no-sandbox"] : ["."],
      env,
    };
const call = (command, input) =>
  page.evaluate(({ command, input }) => window.imago.call(command, input), {
    command,
    input,
  });
const nativeOpen = (files) =>
  app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
    return true;
  }, files);
const nativeSave = (filePath) =>
  app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    return true;
  }, filePath);
async function check(name, work) {
  const start = Date.now();
  await work();
  results.push({ name, status: "passed", ms: Date.now() - start });
  console.log("PASS", name);
}
async function sidebar(name) {
  await page
    .locator(".sidebar")
    .getByRole("button", { name, exact: true })
    .click();
}
async function closeDialog() {
  await page
    .getByRole("dialog")
    .locator("header")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
}
async function poll(predicate) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > 30000)
      throw new Error("Audit condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function waitJobs() {
  const start = Date.now();
  let jobs;
  do {
    jobs = await call("jobs");
    if (!jobs.some((j) => ["queued", "running"].includes(j.state))) break;
    if (Date.now() - start > 30000)
      throw new Error("Jobs timed out: " + JSON.stringify(jobs));
    await new Promise((resolve) => setTimeout(resolve, 30));
  } while (jobs.some((j) => ["queued", "running"].includes(j.state)));
  assert.equal(
    jobs.filter((j) => ["queued", "running", "paused"].includes(j.state))
      .length,
    0,
    JSON.stringify(jobs),
  );
  assert.equal(
    jobs.filter((j) => j.state === "failed").length,
    0,
    JSON.stringify(jobs),
  );
}
let database, number, expression, rows, photoColumn, taxonomy, description;
try {
  app = await electron.launch(launchOptions);
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", {
      name: "Tu espacio de investigación visual",
      exact: true,
    })
    .waitFor();
  await check(
    "Create database and advanced expression through the UI",
    async () => {
      await page
        .getByRole("button", { name: "Nueva base de datos", exact: true })
        .last()
        .click();
      await page
        .getByRole("dialog")
        .getByLabel("Nombre", { exact: true })
        .fill("Auditoría Codex");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Crear", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Auditoría Codex", exact: true })
        .waitFor();
      database = (await call("listDatabases"))[0];
      await page
        .getByRole("button", { name: "Propiedades", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: "Añadir propiedad", exact: true })
        .click();
      await dialog
        .getByLabel("Nombre", { exact: true })
        .fill("Expresión visible");
      await dialog.getByLabel("Tipo", { exact: true }).selectOption("formula");
      await dialog
        .getByLabel("Receta", { exact: true })
        .selectOption("expression");
      await dialog
        .getByLabel("Expresión", { exact: true })
        .fill('concat("Registro ", "calculado")');
      await dialog
        .getByRole("button", { name: "Guardar", exact: true })
        .click();
      await poll(async () =>
        (await call("detail", { id: database.id })).columns.some(
          (c) => c.name === "Expresión visible",
        ),
      );
      await closeDialog();
      expression = (await call("detail", { id: database.id })).columns.find(
        (c) => c.type === "formula",
      );
      await page
        .getByRole("button", { name: "Añadir registros", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByLabel("Número de registros", { exact: true })
        .fill("3");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^Crear/ })
        .click();
      await poll(async () => (await call("status")).rows === 3);
      rows = (await call("search", { databaseIds: [database.id] })).rows;
      assert.ok(
        rows.every((r) => r.cells[expression.id] === "Registro calculado"),
      );
    },
  );
  await check("Typed editing, options, database filters and sort", async () => {
    const detail = await call("detail", { id: database.id });
    for (let i = 0; i < rows.length; i++)
      await call("setCell", {
        rowId: rows[i].id,
        columnId: detail.columns[0].id,
        value: "IMG00" + (i + 1),
      });
    number = await call("addColumn", {
      databaseId: database.id,
      name: "Año",
      type: "number",
    });
    taxonomy = await call("addColumn", {
      databaseId: database.id,
      name: "Categorías",
      type: "multi_select",
      config: { aiModel: { provider: "custom", model: "audit-taxonomy" } },
    });
    description = await call("addColumn", {
      databaseId: database.id,
      name: "Descripción",
      type: "rich_text",
    });
    await call("saveOptions", {
      columnId: taxonomy.id,
      options: [
        { label: "Paisaje", color: "#118866" },
        { label: "Patrimonio", color: "#9955aa" },
      ],
    });
    await page.reload();
    await page
      .locator(".sidebar-databases>button")
      .filter({ hasText: database.name })
      .click();
    await page.getByRole("button", { name: "Tabla", exact: true }).click();
    for (let i = 0; i < 3; i++) {
      const input = page.locator('.data-table input[aria-label="Año"]').nth(i);
      await input.fill(String([1945, 1960, 1950][i]));
      await input.press("Tab");
      await poll(
        async () =>
          (await call("getRow", { id: rows[i].id })).cells[number.id] ===
          String([1945, 1960, 1950][i]),
      );
    }
    const picker = page.locator(".data-table .option-picker").first();
    await picker.locator("summary").click();
    await picker.getByLabel("Patrimonio", { exact: true }).click();
    await poll(
      async () =>
        !!(await call("getRow", { id: rows[0].id })).cells[taxonomy.id],
    );
    await page
      .getByRole("heading", { name: database.name, exact: true })
      .click();
    await page.getByRole("button", { name: "Filtrar y ordenar", exact: true }).click();
    await page.locator(".view-controls-panel").getByRole("button", { name: /Ordenamientos/ }).click();
    await chooseCriteria(page, "Añadir ordenamiento", number.name);
    await page.waitForFunction(
      () =>
        document.querySelector(
          '.data-table tbody tr input[aria-label="Título"]',
        ).value === "IMG001",
    );
    await chooseCriteria(page, "Dirección del ordenamiento", "Mayor a menor");
    await page.waitForFunction(
      () =>
        document.querySelector(
          '.data-table tbody tr input[aria-label="Título"]',
        ).value === "IMG002",
    );
    assert.equal(
      JSON.parse((await call("getRow", { id: rows[0].id })).cells[taxonomy.id])
        .length,
      1,
    );
    await page.locator(".view-controls-panel").getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.screenshot({ path: "test-results/codex-audit-table.png" });
  });
  await check(
    "Whole-column HTTP contract, concurrent queues, review and undo",
    async () => {
      const image = path.join(root, "source.png");
      await sharp({
        create: { width: 80, height: 60, channels: 3, background: "#335577" },
      })
        .png()
        .toFile(image);
      photoColumn = (await call("detail", { id: database.id })).columns.find(
        (c) => c.type === "attachment",
      );
      for (const row of rows) {
        await nativeOpen([image]);
        const plan = await call("imagePreview", {
          databaseId: database.id,
          source: "files",
        });
        await call("importImages", {
          token: plan.token,
          storage: "copy",
          createUnmatched: false,
          assignments: plan.matches.map((m) => ({
            pathToken: m.pathToken,
            rowId: row.id,
          })),
        });
        await waitJobs();
      }
      await call("updateSettings", {
        apiProfiles: {
          custom: {
            baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
            models: ["audit-description", "audit-taxonomy"],
          },
        },
        descriptionModel: { provider: "custom", model: "audit-description" },
        parallelJobs: 2,
        profile: "balanced",
        apiDelayMs: 0,
      });
      assert.deepEqual(
        await call("listProviderModels", { provider: "custom" }),
        ["audit-description", "audit-taxonomy"],
      );
      await page.reload();
      await page
        .locator(".sidebar-databases>button")
        .filter({ hasText: database.name })
        .click();
      responseDelay = 1500;
      for (const column of [description, taxonomy]) {
        await page
          .getByRole("button", { name: "Propiedades", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog
          .locator(".property-list>button")
          .filter({ hasText: column.name })
          .click();
        await dialog
          .getByRole("button", { name: /Encolar celdas vacías/ })
          .click();
        await dialog.waitFor({ state: "hidden" });
      }
      const pending = (await call("jobs")).filter((j) =>
          ["running", "queued"].includes(j.state),
        ),
        capacity = (await call("status")).parallelCapacity;
      assert.equal(
        pending.filter((j) => j.state === "running").length,
        Math.min(2, capacity),
      );
      await page.locator("[data-queue-trigger]").click();
      await page.locator(".queue-popover").waitFor();
      await page.screenshot({
        path: "test-results/codex-audit-parallel-queues.png",
      });
      const descriptionJob = pending.find((j) => j.label === description.name),
        categoryJob = pending.find((j) => j.label === taxonomy.name);
      assert.ok(descriptionJob && categoryJob);
      await page
        .locator(".queue-popover .job")
        .filter({ hasText: description.name })
        .getByRole("button", { name: "Pausar", exact: true })
        .click();
      await poll(
        async () =>
          (await call("jobs")).find((j) => j.id === categoryJob.id)?.state ===
          "completed",
      );
      assert.equal(
        (await call("jobs")).find((j) => j.id === descriptionJob.id)?.state,
        "paused",
      );
      await page
        .locator(".queue-popover .job")
        .filter({ hasText: description.name })
        .getByRole("button", { name: "Reanudar", exact: true })
        .click();
      await page
        .locator(".queue-popover")
        .getByRole("button", { name: "Cerrar", exact: true })
        .click();
      await waitJobs();
      assert.ok(requests.length >= 5 && requests.length <= 6); // An aborted request can be retried.
      assert.ok(
        requests.every((r) =>
          r.messages[1].content.some((p) => p.type === "image_url"),
        ),
      );
      assert.equal((await call("proposals")).length, 5);
      await page
        .getByRole("button", { name: "Revisar propuestas", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: "Aceptar todas", exact: true })
        .click();
      await poll(async () => (await call("proposals")).length === 0);
      assert.ok(
        (await call("getRow", { id: rows[0].id })).cells[description.id],
      );
      await dialog
        .getByRole("button", { name: "Deshacer", exact: true })
        .click();
      await poll(
        async () =>
          !(await call("getRow", { id: rows[0].id })).cells[description.id],
      );
      assert.equal(
        JSON.parse(
          (await call("getRow", { id: rows[0].id })).cells[taxonomy.id],
        ).length,
        1,
      );
      await closeDialog();
      assert.equal((await call("status")).settings.remoteEnabled, false);
    },
  );
  await check(
    "Backup, JSON/XLSX export and restore in a clean profile",
    async () => {
      for (const format of ["json", "xlsx"]) {
        const file = path.join(root, "export." + format);
        await nativeSave(file);
        assert.equal(
          await call("export", { databaseId: database.id, format }),
          true,
        );
        if (format === "json")
          assert.equal(
            JSON.parse(await fs.readFile(file, "utf8")).rows.length,
            3,
          );
        else
          assert.ok(
            new AdmZip(file)
              .readAsText("xl/worksheets/sheet1.xml")
              .includes("IMG001"),
          );
      }
      const backup = path.join(root, "audit.imago");
      await nativeSave(backup);
      await sidebar("Ajustes");
      await page
        .getByRole("button", { name: "Almacenamiento y copias", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Crear copia completa", exact: true })
        .click();
      await page.waitForFunction(() =>
        document
          .querySelector(".toast")
          ?.textContent.includes("Copia completa creada"),
      );
      assert.ok((await fs.stat(backup)).size > 0);
      await app.close();
      app = await electron.launch({
        ...launchOptions,
        env: { ...env, IMAGO_USER_DATA: path.join(root, "restored-profile") },
      });
      page = await app.firstWindow();
      page.on("pageerror", (error) => errors.push(error.message));
      await page
        .getByRole("heading", {
          name: "Tu espacio de investigación visual",
          exact: true,
        })
        .waitFor();
      await nativeOpen([backup]);
      await sidebar("Ajustes");
      await page
        .getByRole("button", { name: "Almacenamiento y copias", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Restaurar copia", exact: true })
        .click();
      await poll(async () => (await call("status")).rows === 3);
      assert.equal((await call("status")).images, 3);
      assert.deepEqual(
        (await call("search", { query: "IMG001" })).rows.map((r) => r.id),
        [rows[0].id],
      );
      await page
        .locator(".sidebar-databases>button")
        .filter({ hasText: database.name })
        .click();
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll(".gallery-card img")].length === 3 &&
          [...document.querySelectorAll(".gallery-card img")].every(
            (img) => img.complete && img.naturalWidth > 0,
          ),
      );
      await page.screenshot({ path: "test-results/codex-audit-restored.png" });
    },
  );
  await check("Sibling layout dimensions and minimum-window fit", async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 680),
    );
    await sidebar("Ajustes");
    await page
      .getByRole("heading", {
        name: "Proveedores de IA y modelos",
        exact: true,
      })
      .waitFor();
    const layout = await page.evaluate(() => ({
      header: document.querySelector(".nodus-header").getBoundingClientRect()
        .height,
      sidebar: document.querySelector(".sidebar").getBoundingClientRect().width,
      viewport: innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    assert.equal(layout.header, 44);
    assert.equal(layout.sidebar, 228);
    assert.ok(layout.content <= layout.viewport, JSON.stringify(layout));
    await page.screenshot({
      path: "test-results/codex-audit-minimum-settings.png",
    });
    await page
      .getByRole("button", { name: "Menú lateral", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector(".app-shell")
        .classList.contains("sidebar-collapsed"),
    );
    await page
      .getByRole("button", { name: "Menú lateral", exact: true })
      .click();
    assert.deepEqual(errors, []);
  });
  await check(
    "Model licenses, renderer isolation and native credential storage",
    async () => {
      await page
        .getByRole("button", { name: "Modelos locales", exact: true })
        .click();
      const licenses = page.getByRole("button", {
        name: "Licencia y procedencia",
        exact: true,
      });
      const count = await licenses.count();
      assert.ok(count >= 4);
      for (let i = 0; i < count; i++) {
        await licenses.nth(i).click();
        await page.getByRole("dialog").locator(".license-text").waitFor();
        assert.ok(
          (await page.getByRole("dialog").locator(".license-text").innerText())
            .length > 100,
        );
        await closeDialog();
      }
      assert.ok((await call("status")).models.every((m) => !m.installed));
      const before = traffic.length;
      assert.equal(
        await page.evaluate(async (endpoint) => {
          try {
            await fetch(endpoint);
            return false;
          } catch {
            return true;
          }
        }, `http://127.0.0.1:${server.address().port}/v1/models`),
        true,
      );
      assert.equal(traffic.length, before);
      assert.equal(
        await page.evaluate(() => typeof window.require),
        "undefined",
      );
      await assert.rejects(call("_asset", { id: "arbitrary" }), /no permitida/);
      const credentials = await call("credentialsStatus");
      if (credentials.encryptionAvailable) {
        await call("setApiKey", {
          provider: "custom",
          key: "audit-only-credential",
        });
        assert.equal((await call("credentialsStatus")).providers.custom, true);
        const bytes = await fs.readFile(
          path.join(root, "restored-profile", "secrets", "ai_key_custom.bin"),
        );
        assert.ok(!bytes.includes("audit-only-credential"));
        await call("clearApiKey", { provider: "custom" });
        assert.equal((await call("credentialsStatus")).providers.custom, false);
      } else {
        await assert.rejects(
          call("setApiKey", {
            provider: "custom",
            key: "audit-only-credential",
          }),
          /no está disponible/,
        );
      }
      results.push({
        credentialStorage: credentials.encryptionAvailable
          ? "native encryption tested"
          : "unavailable; refusal verified",
      });
    },
  );
  await check(
    "Missing linked original, native relink and immediate image recovery",
    async () => {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1440, 940),
      );
      const original = path.join(root, "linked.jpg"),
        relocated = path.join(root, "relocated.jpg");
      await sharp({
        create: { width: 90, height: 70, channels: 3, background: "#669944" },
      })
        .jpeg()
        .toFile(original);
      await nativeOpen([original]);
      const plan = await call("imagePreview", {
        databaseId: database.id,
        source: "files",
      });
      await call("importImages", {
        token: plan.token,
        storage: "link",
        createUnmatched: false,
        assignments: plan.matches.map((m) => ({
          pathToken: m.pathToken,
          rowId: rows[0].id,
        })),
      });
      await waitJobs();
      const image = (await call("getRow", { id: rows[0].id })).images.find(
        (a) => a.fileName === "linked.jpg",
      );
      await call("setPrimary", { id: image.id });
      await fs.rename(original, relocated);
      await page.reload();
      await page
        .locator(".sidebar-databases>button")
        .filter({ hasText: database.name })
        .click();
      await page
        .getByRole("button", { name: "Abrir registro IMG001", exact: true })
        .click();
      const record = page.locator(".record-panel");
      await record.locator(".image-frame.unavailable").waitFor();
      await nativeOpen([relocated]);
      await record
        .getByRole("button", {
          name: "Volver a vincular original",
          exact: true,
        })
        .click();
      await record.locator(".image-frame:not(.unavailable) img").waitFor();
      await poll(async () =>
        record
          .locator(".image-frame img")
          .evaluate(
            (img) => img.complete && img.naturalWidth > 0 && !img.hidden,
          ),
      );
      await record
        .getByRole("button", { name: "Registro", exact: true })
        .click();
      await record
        .getByRole("textbox", { name: "Buscar", exact: true })
        .fill("IMG003");
      await record.getByRole("button", { name: "Buscar", exact: true }).click();
      await record.getByRole("button", { name: "IMG003", exact: true }).click();
      await poll(
        async () =>
          (await call("getRow", { id: rows[0].id })).images.length === 1,
      );
      assert.equal((await call("getRow", { id: rows[2].id })).images.length, 2);
      await closeDialog();
      await page
        .getByRole("button", { name: "Abrir registro IMG003", exact: true })
        .click();
      await record
        .getByRole("button", { name: "Siguiente", exact: true })
        .click();
      page.once("dialog", (dialog) => dialog.accept());
      await record
        .getByRole("button", { name: "Quitar del registro", exact: true })
        .click();
      await poll(
        async () =>
          (await call("getRow", { id: rows[2].id })).images.length === 1,
      );
      await fs.access(relocated); // Deleting the association must preserve the original.
      await closeDialog();
    },
  );
  await check(
    "Record editors for dates, time, checkbox, URL, location, Markdown and relations",
    async () => {
      const fields = {};
      for (const [name, type] of [
        ["Fecha", "date"],
        ["Hora", "time"],
        ["Revisado", "checkbox"],
        ["Referencia", "url"],
        ["Lugar", "location"],
        ["Relacionado", "relation"],
      ]) {
        fields[name] = await call("addColumn", {
          databaseId: database.id,
          name,
          type,
          config:
            type === "relation"
              ? {
                  relationTargetDatabaseId: database.id,
                  relationTargetKind: "db_row",
                }
              : {},
        });
      }
      await page.reload();
      await page
        .locator(".sidebar-databases>button")
        .filter({ hasText: database.name })
        .click();
      await page
        .getByRole("button", { name: "Abrir registro IMG001", exact: true })
        .click();
      const record = page.locator(".record-panel");
      await record.getByLabel("Fecha", { exact: true }).fill("1945-04-12");
      for (const [name, value] of [
        ["Hora", "12:30"],
        ["Referencia", "https://example.org/archive"],
        ["Lugar", "Andalucía"],
      ]) {
        await record.getByLabel(name, { exact: true }).fill(value);
        await record.getByLabel(name, { exact: true }).press("Tab");
      }
      await record.getByLabel("Revisado", { exact: true }).click();
      await record
        .getByLabel("Descripción", { exact: true })
        .fill("**Anotación humana** de archivo.");
      await record
        .getByRole("button", { name: "Vista previa", exact: true })
        .click();
      await record
        .locator(".markdown-view strong")
        .filter({ hasText: "Anotación humana" })
        .waitFor();
      const relations = record
        .locator(".record-property")
        .filter({ hasText: "Relacionado" });
      await relations
        .getByRole("textbox", { name: "Relacionado", exact: true })
        .fill("IMG002");
      await relations
        .getByRole("button", { name: "Buscar", exact: true })
        .click();
      await relations
        .locator(".relation-choices label")
        .filter({ hasText: "IMG002" })
        .locator("input")
        .click();
      await poll(async () =>
        (await call("getRow", { id: rows[0].id })).cells[
          fields.Relacionado.id
        ]?.includes(rows[1].id),
      );
      const stored = (await call("getRow", { id: rows[0].id })).cells;
      assert.ok(stored[fields.Fecha.id].includes("1945-04-12"));
      assert.equal(stored[fields.Hora.id], "12:30");
      assert.equal(stored[fields.Revisado.id], "1");
      assert.equal(stored[fields.Referencia.id], "https://example.org/archive");
      assert.equal(JSON.parse(stored[fields.Lugar.id]).name, "Andalucía");
      assert.equal(stored[description.id], "**Anotación humana** de archivo.");
      await page.screenshot({
        path: "test-results/codex-audit-record-editors.png",
      });
      await closeDialog();
    },
  );
  await check(
    "Rename database, delete selected records and remove the database without search ghosts",
    async () => {
      await page.locator(".database-heading .actions-menu summary").click();
      await page
        .locator(".database-heading")
        .getByRole("button", { name: "Nombre", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByLabel("Nombre", { exact: true })
        .fill("Archivo auditado");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Guardar", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Archivo auditado", exact: true })
        .waitFor();
      assert.equal(
        (await call("detail", { id: database.id })).database.name,
        "Archivo auditado",
      );
      await page.getByLabel("seleccionar IMG003", { exact: true }).check();
      await page
        .locator(".selection-bar")
        .getByRole("button", { name: "Eliminar", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Eliminar", exact: true })
        .click();
      await poll(
        async () =>
          (await call("search", { databaseIds: [database.id] })).total === 2,
      );
      assert.equal((await call("search", { query: "IMG003" })).total, 0);
      await page.locator(".database-heading .actions-menu summary").click();
      await page
        .locator(".database-heading")
        .getByRole("button", { name: "Eliminar", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Eliminar", exact: true })
        .click();
      await poll(async () => (await call("listDatabases")).length === 0);
      assert.equal((await call("search", { query: "IMG001" })).total, 0);
      assert.deepEqual(errors, []);
    },
  );
} catch (error) {
  results.push({ status: "failed", error: String(error) });
  if (page) {
    await page
      .screenshot({ path: "test-results/codex-audit-failure.png" })
      .catch(() => {});
    console.error(
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  throw error;
} finally {
  await fs.writeFile(
    "test-results/codex-audit-e2e.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        artifact: process.env.IMAGO_E2E_EXECUTABLE ?? "development",
        platform: process.platform,
        arch: process.arch,
        results,
        errors,
        requestCount: requests.length,
      },
      null,
      2,
    ),
  );
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}

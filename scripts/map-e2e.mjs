// Full database map flow in an isolated native profile. OSM tiles are fixtures;
// automated navigation never requests public map tiles.
import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import sharp from "sharp";
import { chooseCriteria } from "./e2e-criteria.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-db-map-"));
const env = { ...process.env, IMAGO_USER_DATA: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.IMAGO_DEV_URL;
let app,
  page,
  failTiles = false;
const errors = [],
  checks = [],
  tileRequests = [];
const tile = await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dfe8d7"/><path d="M0 50L256 210M80 0L20 256" stroke="#fff" stroke-width="8"/><text x="12" y="245" font-size="12" fill="#7d8977">Map fixture · no live traffic</text></svg>',
  ),
)
  .png()
  .toBuffer();
const call = (command, input) =>
  page.evaluate(({ command, input }) => window.imago.call(command, input), {
    command,
    input,
  });
const poll = async (predicate) => {
  const deadline = Date.now() + 30000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Map condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
};
const closeRecord = () =>
  page
    .locator(".record-panel>header")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
try {
  await fs.mkdir("test-results", { recursive: true });
  app = await electron.launch(
    process.env.IMAGO_E2E_EXECUTABLE
      ? { executablePath: process.env.IMAGO_E2E_EXECUTABLE, env }
      : { args: ["."], env },
  );
  await app.context().route("https://tile.openstreetmap.org/**", (route) => {
    tileRequests.push(route.request().url());
    return failTiles
      ? route.abort()
      : route.fulfill({ status: 200, contentType: "image/png", body: tile });
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", {
      name: "Tu espacio de investigación visual",
      exact: true,
    })
    .waitFor();
  await app.evaluate(({ shell }) => {
    global.__mapExternal = [];
    shell.openExternal = async (url) => {
      global.__mapExternal.push(url);
    };
    return true;
  });
  const csv = path.join(root, "Mapa.csv");
  const csvCell = (value) => '"' + String(value).replaceAll('"', '""') + '"';
  const rows = Array.from({ length: 235 }, (_, index) => {
    const i = index + 1;
    const location =
      i <= 232
        ? { name: "Granada", latitude: 37.18817, longitude: -3.60667 }
        : i === 233
          ? { name: "Londres", latitude: 51.50853, longitude: -0.12574 }
          : i === 234
            ? { name: "Paraje propio" }
            : null;
    const other =
      i === 1
        ? { name: "Tokyo", latitude: 35.6895, longitude: 139.69171 }
        : null;
    return [
      `MAP${String(i).padStart(3, "0")}`,
      location ? JSON.stringify(location) : "",
      other ? JSON.stringify(other) : "",
    ]
      .map(csvCell)
      .join(",");
  });
  await fs.writeFile(csv, "Título,Lugar,Otro lugar\n" + rows.join("\n"));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
    return true;
  }, csv);
  const plan = await call("csvPreview");
  const db = await call("csvImport", {
    token: plan.token,
    name: "Archivo en el mapa",
    types: ["title", "location", "location"],
    headers: plan.headers,
  });
  const location = db.columns.find((c) => c.name === "Lugar"),
    other = db.columns.find((c) => c.name === "Otro lugar");
  const first = (
    await call("search", { databaseIds: [db.database.id], limit: 100 })
  ).rows.find((row) => row.title === "MAP001");
  const image = path.join(root, "photo.png");
  await sharp({
    create: { width: 96, height: 72, channels: 3, background: "#6a54b8" },
  })
    .png()
    .toFile(image);
  await call("addColumn", {
    databaseId: db.database.id,
    name: "Imágenes",
    type: "attachment",
  });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
    return true;
  }, image);
  const imagePlan = await call("imagePreview", {
    databaseId: db.database.id,
    source: "files",
  });
  await call("importImages", {
    token: imagePlan.token,
    storage: "copy",
    createUnmatched: false,
    assignments: imagePlan.matches.map((match) => ({
      pathToken: match.pathToken,
      rowId: first.id,
    })),
  });
  await poll(
    async () =>
      !(await call("jobs")).some((job) =>
        ["queued", "running"].includes(job.state),
      ),
  );
  await page.reload();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: db.database.name })
    .click();
  await page.getByRole("button", { name: "Mapa", exact: true }).click();
  const map = page.getByRole("region", { name: "Vista de mapa", exact: true });
  await poll(async () =>
    (await map.locator(".map-record-count").innerText()).includes("233"),
  );
  await page
    .getByRole("button", { name: "232 registros · Granada", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "MAP233", exact: true }).waitFor();
  assert.equal(
    await page
      .locator(".pagination")
      .getByRole("button", { name: "Siguiente", exact: true })
      .count(),
    0,
  );
  await map.locator(".map-record-pin img").first().waitFor();
  await page.waitForTimeout(350);
  await page.screenshot({ path: "test-results/codex-database-map.png" });
  checks.push(
    "All 235 records, 233 located beyond grid pagination, image thumbnails and coincident clusters",
  );
  await page
    .getByRole("button", { name: "232 registros · Granada", exact: true })
    .click();
  await map.getByText("232 registros en este grupo", { exact: true }).waitFor();
  await map
    .getByLabel("Buscar en los registros del mapa", { exact: true })
    .fill("MAP001");
  await map
    .getByRole("button", { name: "Abrir registro MAP001", exact: true })
    .click();
  const record = page.locator(".record-panel");
  await record
    .getByRole("combobox", { name: "Lugar", exact: true })
    .fill("Lugar sin coordenadas");
  await record
    .getByRole("combobox", { name: "Lugar", exact: true })
    .press("Tab");
  await poll(
    async () =>
      JSON.parse((await call("getRow", { id: first.id })).cells[location.id])
        .latitude === null,
  );
  await closeRecord();
  await poll(async () =>
    (await map.locator(".map-record-count").innerText()).includes("232"),
  );
  await map
    .getByRole("button", { name: "Sin coordenadas (3)", exact: true })
    .click();
  await map
    .getByRole("button", { name: "Abrir registro MAP001", exact: true })
    .waitFor();
  checks.push(
    "Cluster browsing, open original record, edit location and immediate marker/count refresh",
  );
  await map
    .getByLabel("Buscar en los registros del mapa", { exact: true })
    .fill("");
  await map
    .getByRole("button", { name: "En el mapa (232)", exact: true })
    .click();
  await page.getByRole("button", { name: "Filtrar y ordenar", exact: true }).click();
  await chooseCriteria(page, "Añadir filtro", "Título");
  await page.getByRole("textbox", { name: "Valor del filtro", exact: true }).fill("MAP233");
  await poll(
    async () =>
      (await map.locator(".map-record-count").innerText()).trim() ===
      "1 situados en el mapa · 1 registros",
  );
  await page.locator(".view-controls-panel").getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("button", { name: "MAP233", exact: true }).waitFor();
  await page.getByRole("button", { name: "Filtrar y ordenar", exact: true }).click();
  await page
    .locator(".criteria-filter-row")
    .getByRole("button", { name: "Eliminar condición", exact: true })
    .click();
  await poll(async () =>
    (await map.locator(".map-record-count").innerText()).includes("232"),
  );
  await page.locator(".view-controls-panel").getByRole("button", { name: "Cerrar", exact: true }).click();
  await chooseCriteria(page, "Propiedad de ubicación", other.name, map);
  await poll(async () =>
    (await map.locator(".map-record-count").innerText()).includes("1 situados"),
  );
  await page.getByRole("button", { name: "MAP001", exact: true }).waitFor();
  await page.reload();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: db.database.name })
    .click();
  await page.getByRole("button", { name: "Mapa", exact: true }).click();
  assert.equal(
    (await map.getByRole("button", { name: "Propiedad de ubicación", exact: true }).innerText()).trim(),
    other.name,
  );
  await chooseCriteria(page, "Propiedad de ubicación", location.name, map);
  await page
    .getByRole("button", { name: "231 registros · Granada", exact: true })
    .waitFor();
  checks.push(
    "Filters beyond first 100 rows, multiple location columns and saved per-database choice",
  );
  await map.locator(".leaflet-control-zoom-in").click();
  await page.waitForTimeout(350);
  await map
    .getByRole("button", { name: "Ajustar al contenido", exact: true })
    .click();
  await poll(async () => {
    const canvas = await map.locator(".database-map-canvas").boundingBox();
    const points = await map
      .locator(".leaflet-marker-icon")
      .evaluateAll((elements) =>
        elements.map((el) => {
          const rect = el.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }),
      );
    return (
      points.length > 0 &&
      points.every(
        (point) =>
          point.x >= canvas.x &&
          point.x <= canvas.x + canvas.width &&
          point.y >= canvas.y &&
          point.y <= canvas.y + canvas.height,
      )
    );
  });
  assert.deepEqual(await app.evaluate(() => global.__mapExternal), []);
  await map.getByRole("link", { name: "OpenStreetMap", exact: true }).click();
  assert.deepEqual(await app.evaluate(() => global.__mapExternal), [
    "https://www.openstreetmap.org/copyright",
  ]);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      get: () => false,
      configurable: true,
    });
    window.dispatchEvent(new Event("offline"));
  });
  await map
    .getByText(
      "Sin conexión. Los registros y sus coordenadas siguen disponibles.",
      { exact: true },
    )
    .waitFor();
  await page
    .getByRole("button", { name: "231 registros · Granada", exact: true })
    .waitFor();
  failTiles = true;
  await app.evaluate(async ({ session }) => {
    await session.defaultSession.clearCache();
    return true;
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      get: () => true,
      configurable: true,
    });
    window.dispatchEvent(new Event("online"));
  });
  await map.locator(".leaflet-control-zoom-in").click();
  await map
    .locator(".leaflet-tile")
    .first()
    .evaluate((image) => image.dispatchEvent(new Event("error")));
  await map
    .getByText(
      "No se pudo cargar el fondo del mapa. Puedes seguir consultando los registros.",
      { exact: false },
    )
    .waitFor();
  failTiles = false;
  await map.getByRole("button", { name: "Reintentar", exact: true }).click();
  await map.locator(".leaflet-tile-loaded").first().waitFor();
  await map
    .getByRole("button", { name: "Ajustar al contenido", exact: true })
    .click();
  checks.push(
    "Zoom/fitting never opens a browser, safe attribution, offline markers, tile failure and retry",
  );
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1000, 680);
    return true;
  });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForTimeout(350);
  await map
    .getByRole("button", { name: "Ajustar al contenido", exact: true })
    .click();
  await poll(
    async () =>
      Number(
        await map
          .locator(".database-map-canvas")
          .getAttribute("data-marker-count"),
      ) > 0,
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false);
  const sidebarBounds = await map
    .locator(".database-map-records")
    .boundingBox();
  for (const tab of await map.locator(".map-list-tabs button").all()) {
    const bounds = await tab.boundingBox();
    assert.ok(
      bounds.x >= sidebarBounds.x &&
        bounds.x + bounds.width <= sidebarBounds.x + sidebarBounds.width,
    );
  }
  await page.screenshot({
    path: "test-results/codex-database-map-dark-minimum.png",
  });
  checks.push("Dark mode, minimum window and responsive map/list");
  const empty = await call("createDatabase", { name: "Base sin lugares" });
  await page.reload();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: empty.database.name })
    .click();
  await page.getByRole("button", { name: "Mapa", exact: true }).click();
  await page
    .getByRole("heading", {
      name: "Añade una ubicación para situar tus imágenes",
      exact: true,
    })
    .waitFor();
  await call("addColumn", {
    databaseId: empty.database.id,
    name: "Ubicación",
    type: "location",
  });
  await page.reload();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: db.database.name })
    .click();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: empty.database.name })
    .click();
  await page.getByRole("button", { name: "Mapa", exact: true }).click();
  await poll(async () =>
    (await map.locator(".map-record-count").innerText()).includes("0 situados"),
  );
  assert.equal(await map.locator(".leaflet-marker-icon").count(), 0);
  checks.push(
    "Every database offers the view, with helpful missing-property and empty-map states",
  );
  assert.deepEqual(errors, []);
  const result = {
    status: "passed",
    packaged: !!process.env.IMAGO_E2E_EXECUTABLE,
    application: await app.evaluate(() => ({
      platform: process.platform,
      arch: process.arch,
    })),
    checks,
    fixtureTileRequests: tileRequests.length,
    errors,
  };
  await fs.writeFile(
    "test-results/codex-map-e2e.json",
    JSON.stringify(result, null, 2),
  );
  console.log("Map E2E passed:", checks.join("; "));
} catch (error) {
  if (page)
    await page
      .screenshot({ path: "test-results/codex-map-failure.png" })
      .catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}

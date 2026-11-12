// Native UI regression for local locations. Tiles are fixtures, never live OSM
// requests: automated pan/zoom tests must not put load on the public service.
import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import sharp from "sharp";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-places-"));
const env = { ...process.env, IMAGO_USER_DATA: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.IMAGO_DEV_URL;
const launch = () =>
  electron.launch(
    process.env.IMAGO_E2E_EXECUTABLE
      ? {
          executablePath: process.env.IMAGO_E2E_EXECUTABLE,
          args: process.env.IMAGO_E2E_NO_SANDBOX ? ["--no-sandbox"] : [],
          env,
        }
      : {
          args: process.env.IMAGO_E2E_NO_SANDBOX
            ? [".", "--no-sandbox"]
            : ["."],
          env,
        },
  );
let app, page;
const errors = [],
  requests = [],
  checks = [];
let failTiles = false;
const tile = await sharp(
  Buffer.from(
    '<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg"><rect width="256" height="256" fill="#e3eadc"/><path d="M0 40L256 200M30 0L210 256M0 150L256 30" stroke="#fff" stroke-width="10"/><text x="10" y="240" font-size="12" fill="#78816f">Map fixture · no live traffic</text></svg>',
  ),
)
  .png()
  .toBuffer();
const call = (command, input) =>
  page.evaluate(({ command, input }) => window.imago.call(command, input), {
    command,
    input,
  });
async function poll(predicate) {
  const deadline = Date.now() + 15000;
  while (!(await predicate())) {
    if (Date.now() > deadline)
      throw new Error("Location test condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function openApp() {
  app = await launch();
  await app.context().route("https://tile.openstreetmap.org/**", (route) => {
    requests.push(route.request().url());
    return failTiles
      ? route.abort()
      : route.fulfill({ status: 200, contentType: "image/png", body: tile });
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page
    .getByRole("heading", {
      name: "Tu espacio de investigación visual",
      exact: true,
    })
    .waitFor();
}
async function closeTopDialog() {
  await page
    .getByRole("dialog")
    .last()
    .locator("header")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
}
async function assertCentredPin(scope) {
  await poll(async () => {
    const bounds = await scope.locator(".location-map-canvas").boundingBox();
    const pin = await scope.locator("path.leaflet-interactive").boundingBox();
    return (
      bounds &&
      pin &&
      Math.abs(pin.x + pin.width / 2 - bounds.x - bounds.width / 2) < 3 &&
      Math.abs(pin.y + pin.height / 2 - bounds.y - bounds.height / 2) < 3
    );
  });
}
try {
  await fs.mkdir("test-results", { recursive: true });
  await openApp();
  const db = await call("createDatabase", { name: "Lugares · verificación" });
  const col = await call("addColumn", {
    databaseId: db.database.id,
    name: "Lugar",
    type: "location",
  });
  const row = await call("createRow", { databaseId: db.database.id });
  const title = db.columns.find((c) => c.type === "title");
  await call("setCell", {
    rowId: row.id,
    columnId: title.id,
    value: "Fotografía de archivo",
  });
  const stored = async () =>
    JSON.parse((await call("getRow", { id: row.id })).cells[col.id] ?? "null");
  await page.reload();
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: db.database.name })
    .click();
  await page
    .getByRole("button", {
      name: "Abrir registro Fotografía de archivo",
      exact: true,
    })
    .click();
  const record = page.locator(".record-panel");
  let input = record.getByRole("combobox", { name: "Lugar", exact: true });
  await input.fill("Málaga");
  await page
    .getByRole("option")
    .filter({ hasText: "Málaga" })
    .first()
    .waitFor();
  await page.screenshot({ path: "test-results/codex-places-suggestions.png" });
  // Keyboard selection carries a stable source id, not only a label.
  const lastOptionId = await page.getByRole("option").last().getAttribute("id");
  await input.press("ArrowUp");
  await poll(
    async () =>
      (await input.getAttribute("aria-activedescendant")) === lastOptionId,
  );
  assert.equal(await input.getAttribute("aria-activedescendant"), lastOptionId);
  await input.press("ArrowDown");
  await input.press("Enter");
  await poll(async () =>
    (await stored())?.gazetteerId?.startsWith("geonames:"),
  );
  const chosen = await stored();
  assert.equal(chosen.name, "Málaga");
  await record.locator(".leaflet-tile-loaded").first().waitFor();
  await page.waitForTimeout(350); // Leaflet's tile fade and panel's opening animation.
  await assertCentredPin(record);
  assert.ok(requests.length > 0);
  const mapRect = await record.locator(".location-map").boundingBox();
  assert.ok(
    Math.abs(mapRect.width - mapRect.height) < 2 && mapRect.width <= 201,
  );
  assert.equal(
    await record.locator(".location-map-canvas").getAttribute("data-latitude"),
    String(chosen.latitude),
  );
  await page.screenshot({ path: "test-results/codex-places-preview.png" });
  checks.push(
    "Local suggestions, keyboard selection, stable identifier and square preview",
  );
  await record
    .getByRole("button", { name: "Ampliar mapa", exact: true })
    .click();
  const expanded = page.getByRole("dialog", {
    name: "Mapa de Málaga",
    exact: true,
  });
  await expanded.locator(".leaflet-tile-loaded").first().waitFor();
  await expanded.locator(".leaflet-control-zoom-in").click();
  await assertCentredPin(expanded);
  await page.screenshot({ path: "test-results/codex-places-expanded.png" });
  // Attribution uses the fixed safe native bridge instead of navigating the app.
  const external = await app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      global.__placeExternal = url;
    };
    return true;
  });
  assert.equal(external, true);
  await expanded
    .getByRole("link", { name: "OpenStreetMap", exact: true })
    .click();
  assert.equal(
    await app.evaluate(() => global.__placeExternal),
    "https://www.openstreetmap.org/copyright",
  );
  await closeTopDialog();
  checks.push("Expand, zoom, nested dialog close and safe attribution link");
  await input.fill("Finca de mi familia");
  await input.press("Tab");
  await poll(async () => (await stored())?.name === "Finca de mi familia");
  assert.equal((await stored()).latitude, null);
  assert.equal((await stored()).longitude, null);
  assert.equal((await stored()).gazetteerId, undefined);
  await record.locator(".location-map").waitFor({ state: "detached" });
  checks.push("Custom text clears the previous place's pin");
  // Offline suggestions remain usable; coordinates do not require a network.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      get: () => false,
      configurable: true,
    });
    window.dispatchEvent(new Event("offline"));
  });
  const beforeOffline = requests.length;
  await input.fill("Granada");
  await page.getByRole("option").filter({ hasText: "Spain" }).first().click();
  await poll(async () => (await stored())?.name === "Granada");
  await record
    .getByText(
      "Conéctate para ver el mapa. El lugar está guardado en este equipo.",
      { exact: true },
    )
    .waitFor();
  assert.equal(requests.length, beforeOffline);
  const granada = await stored();
  checks.push(
    "Offline selection and retained coordinates without tile requests",
  );
  failTiles = true;
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      get: () => true,
      configurable: true,
    });
    window.dispatchEvent(new Event("online"));
  });
  await record
    .getByText("No se pudo cargar el mapa. El lugar sigue guardado.", {
      exact: true,
    })
    .waitFor();
  failTiles = false;
  await record.getByRole("button", { name: "Reintentar", exact: true }).click();
  await record.locator(".leaflet-tile-loaded").first().waitFor();
  assert.deepEqual(await stored(), granada);
  checks.push("Unavailable tile service, retry and data preserved");
  await record.locator(".location-coordinates summary").click();
  await record.getByLabel("Lugar · Latitud", { exact: true }).fill("91");
  await record
    .getByRole("button", { name: "Guardar coordenadas", exact: true })
    .click();
  await record.getByRole("alert").waitFor();
  assert.deepEqual(await stored(), granada);
  await record.getByLabel("Lugar · Latitud", { exact: true }).fill("0");
  await record.getByLabel("Lugar · Longitud", { exact: true }).fill("0");
  await record
    .getByRole("button", { name: "Guardar coordenadas", exact: true })
    .click();
  await poll(async () => (await stored())?.latitude === 0);
  assert.equal((await stored()).longitude, 0);
  checks.push("Manual coordinate validation and valid zero coordinates");
  await closeTopDialog();
  await page.getByRole("button", { name: "Tabla", exact: true }).click();
  input = page
    .locator(".data-table")
    .getByRole("combobox", { name: "Lugar", exact: true });
  await input.fill("Paris, France");
  await page.getByRole("option").filter({ hasText: "Paris" }).first().click();
  await poll(async () => (await stored())?.name === "Paris");
  await page
    .getByRole("button", { name: "Ver mapa: Lugar", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Mapa de Paris", exact: true })
    .waitFor();
  await closeTopDialog();
  await page.screenshot({ path: "test-results/codex-places-table.png" });
  const finalPlace = await stored();
  const exported = path.join(root, "places.json");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    return true;
  }, exported);
  await call("export", { databaseId: db.database.id, format: "json" });
  const json = JSON.parse(await fs.readFile(exported, "utf8"));
  assert.deepEqual(json.rows[0].Lugar, finalPlace);
  checks.push("Table suggestions escape the scroll container and open a map");
  // Neither broad image origins nor arbitrary fetches were enabled for maps.
  assert.equal(
    await page.evaluate(() =>
      fetch("https://example.org/private").then(
        () => true,
        () => false,
      ),
    ),
    false,
  );
  await app.close();
  app = null;
  await openApp();
  assert.deepEqual(await stored(), finalPlace);
  await page
    .locator(".sidebar-databases>button")
    .filter({ hasText: db.database.name })
    .click();
  await page
    .getByRole("button", {
      name: "Abrir registro Fotografía de archivo",
      exact: true,
    })
    .click();
  await page.locator(".record-panel").locator(".location-map").waitFor();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.locator(".record-panel .leaflet-tile-loaded").first().waitFor();
  await page.waitForTimeout(350);
  await assertCentredPin(page.locator(".record-panel"));
  await page.screenshot({ path: "test-results/codex-places-dark.png" });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1000, 680);
    return true;
  });
  const ownInput = page
    .locator(".record-panel")
    .getByRole("combobox", { name: "Lugar", exact: true });
  await ownInput.click();
  await page.locator(".place-custom").waitFor();
  const popup = await page.locator(".place-suggestions").boundingBox();
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  assert.ok(
    popup.x >= 0 &&
      popup.y >= 0 &&
      popup.x + popup.width <= viewport.width &&
      popup.y + popup.height <= viewport.height,
  );
  await page.locator(".place-custom").click();
  await poll(async () => (await stored())?.latitude === null);
  assert.equal((await stored()).name, finalPlace.name);
  checks.push(
    "Structured JSON export, minimum-window popup fit and custom text with the same name",
  );
  await page
    .locator(".record-panel")
    .getByRole("button", { name: "Quitar lugar: Lugar", exact: true })
    .click();
  await poll(async () => (await stored()) === null);
  checks.push("Restart persistence, dark styling, clear and network isolation");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "test-results/codex-places-e2e.json",
    JSON.stringify(
      {
        status: "passed",
        packaged: !!process.env.IMAGO_E2E_EXECUTABLE,
        application: await app.evaluate(() => ({
          platform: process.platform,
          arch: process.arch,
        })),
        checks,
        fixtureTileRequests: requests.length,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Places E2E passed:", checks.join("; "));
} catch (error) {
  if (page)
    await page
      .screenshot({ path: "test-results/codex-places-failure.png" })
      .catch(() => {});
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}

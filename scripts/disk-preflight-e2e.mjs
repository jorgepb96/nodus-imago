// Actual small filesystem, not a mocked inference or simulated disk counter.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { launchNative } from "./native-test-support.mjs";
if (process.platform !== "darwin")
  throw Error(
    "This physical disk preflight uses an isolated macOS disk image.",
  );
const root = path.resolve("test-results/disk-preflight-" + Date.now()),
  mount = path.join(root, "mount"),
  image = path.join(root, "limited.sparseimage");
await fs.mkdir(mount, { recursive: true });
execFileSync(
  "hdiutil",
  [
    "create",
    "-size",
    "128m",
    "-fs",
    "HFS+",
    "-type",
    "SPARSE",
    "-volname",
    "ImagoPreflight",
    image,
  ],
  { stdio: "inherit" },
);
execFileSync("hdiutil", ["attach", "-nobrowse", "-mountpoint", mount, image], {
  stdio: "inherit",
});
let app;
try {
  const profile = path.join(mount, "profile");
  await fs.mkdir(profile);
  await fs.writeFile(
    path.join(profile, "isolation.json"),
    JSON.stringify({ format: "nodus.imago.native-qa/1", root: profile }),
  );
  const native = await launchNative(profile);
  app = native.app;
  const { page, call } = native;
  const database = await call("createDatabase", {
      name: "Literal without space for weights",
    }),
    row = await call("createRow", { databaseId: database.database.id });
  await call("setCell", {
    rowId: row.id,
    columnId: database.columns.find((c) => c.type === "title").id,
    value: "Literal survives",
  });
  assert.equal(
    (await call("search", { mode: "literal", query: "Literal survives" }))
      .total,
    1,
  );
  await page.reload();
  await page
    .locator(".onboarding-intro")
    .getByRole("button", { name: "Preparar búsqueda local", exact: true })
    .click();
  const region = page.getByRole("region", {
    name: "Preparar búsqueda local",
    exact: true,
  });
  await region
    .getByText("No hay espacio suficiente para preparar el modelo.", {
      exact: true,
    })
    .waitFor();
  await region.getByRole("checkbox").check();
  assert.equal(
    await region
      .getByRole("button", { name: "Preparar búsqueda semántica", exact: true })
      .isDisabled(),
    true,
  );
  const plan = await call("modelPreparation");
  assert.ok(plan.freeBytes < plan.remainingBytes);
  await assert.rejects(
    call("prepareModels", { consent: true }),
    /Espacio insuficiente/,
  );
  assert.equal((await call("jobs")).length, 0);
  await page.screenshot({ path: "test-results/disk-preflight-e2e.png" });
  await fs.writeFile(
    "test-results/disk-preflight-e2e.json",
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        arch: process.arch,
        physicalFilesystemBytes: 128 * 2 ** 20,
        freeBytes: plan.freeBytes,
        requiredBytes: plan.remainingBytes,
        checks: [
          "Literal search works without room for weights",
          "Native UI refuses preparation before any downloads or jobs",
        ],
        mockedDisk: false,
      },
      null,
      2,
    ),
  );
} finally {
  if (app) await app.close();
  execFileSync("hdiutil", ["detach", mount], { stdio: "inherit" });
}

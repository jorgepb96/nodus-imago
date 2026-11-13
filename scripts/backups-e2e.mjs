// Real Electron UI, encryption, database replacement and cross-profile recovery.
// Profiles and backups are retained as evidence; no production data or API calls.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  launchNative,
  seedNativeImages,
  pollNative,
} from "./native-test-support.mjs";
const root = path.resolve("test-results/backups-native-" + Date.now()),
  folder = path.join(root, "copies");
await fs.mkdir(folder, { recursive: true });
const checks = [],
  errors = [];
let active;
const password = "native-qa-only-2026";
async function launch(name) {
  const profile = path.join(root, name);
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(
    path.join(profile, "isolation.json"),
    JSON.stringify({ format: "nodus.imago.native-qa/1", root: profile }),
  );
  active = await launchNative(profile);
  active.page.on("pageerror", (e) => errors.push(e.message));
  return active;
}
async function storage(f) {
  await f.page
    .locator(".sidebar")
    .getByRole("button", { name: "Ajustes", exact: true })
    .click();
  await f.page
    .getByRole("button", { name: "Almacenamiento y copias", exact: true })
    .click();
  await f.page
    .getByRole("heading", { name: "Copias de seguridad", exact: true })
    .waitFor();
}
async function openFile(f, file) {
  await f.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
}
async function chooseFolder(f) {
  await openFile(f, folder);
  await f.page
    .getByRole("button", { name: "Elegir carpeta", exact: true })
    .click();
  await pollNative(
    async () => (await f.call("backupStatus")).folder === folder,
  );
}
async function pick(f, file) {
  await openFile(f, file);
  return f.call("backupPickRestore");
}
async function originals(f, rows) {
  const result = [];
  const profile = await f.app.evaluate(({ app }) => app.getPath("userData"));
  const directory = path.join(profile, "collection", "originals"),
    files = await fs.readdir(directory);
  for (const id of rows) {
    const row = await f.call("getRow", { id });
    for (const image of row.images) {
      const file = files.find(
        (n) => n === image.contentHash || n.startsWith(image.contentHash + "."),
      );
      assert.ok(file);
      const hash = createHash("sha256")
        .update(await fs.readFile(path.join(directory, file)))
        .digest("hex");
      assert.equal(hash, image.contentHash);
      result.push(hash);
      const response = await f.page.evaluate(
        async (id) =>
          new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve(true);
            image.onerror = () => resolve(false);
            image.src = "imago://asset/" + id + "/preview";
          }),
        image.id,
      );
      assert.equal(response, true);
    }
  }
  return result.sort();
}
try {
  const a = await launch("source");
  const seed = await seedNativeImages(a.app, a.call, path.join(root, "images"));
  const detail = await a.call("detail", { id: seed.database.id });
  const title = detail.columns.find((c) => c.type === "title"),
    rich = await a.call("addColumn", {
      databaseId: seed.database.id,
      name: "Notas",
      type: "rich_text",
    });
  await a.call("setCell", {
    rowId: seed.rows[0],
    columnId: rich.id,
    value: "# Fuente\n\n- Padre\n  - Hijo\n\n**Descripción histórica**",
  });
  await a.call("updateSettings", { mode: "dark" });
  await a.call("updateConfigure", { automaticChecks: false, autoDownload: false, beta: true });
  const secure = (await a.call("credentialsStatus")).encryptionAvailable;
  if (secure) await a.call("setApiKey", {provider: "custom", key: "fixture-backup-key-no-network"});
  await a.page.evaluate(() =>
    localStorage.setItem(
      "imago.native.backup-view",
      JSON.stringify({
        view: "map",
        filters: [{ property: "research", value: "historical" }],
      }),
    ),
  );
  const before = await a.call("getRow", { id: seed.rows[0] });
  const hashes = await originals(a, seed.rows);
  assert.equal(hashes.length, 2);
  checks.push("Two original images retrieved and SHA-256 recorded");
  await storage(a);
  await chooseFolder(a);
  await a.page.getByLabel("Nueva contraseña", { exact: true }).fill(password);
  await a.page
    .getByLabel("Confirmar contraseña", { exact: true })
    .fill("does-not-match");
  assert.equal(
    await a.page
      .getByRole("button", { name: "Crear copia completa", exact: true })
      .isDisabled(),
    true,
  );
  checks.push("Mismatched password cannot silently create plaintext");
  await a.page
    .getByLabel("Confirmar contraseña", { exact: true })
    .fill(password);
  const copy = path.join(folder, "source.imago");
  await a.app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, copy);
  await a.page
    .getByRole("button", { name: "Crear copia completa", exact: true })
    .click();
  await pollNative(
    async () => (await a.call("backupStatus")).entries.length === 1,
    60000,
  );
  const entry = (await a.call("backupStatus")).entries[0];
  assert.equal(entry.encrypted, true);
  assert.equal(
    (await fs.readFile(copy)).subarray(0, 10).toString(),
    "IMAGOENC1\n",
  );
  await a.page
    .getByRole("button", { name: "Comprobar integridad", exact: true })
    .click();
  const verify = a.page.getByRole("dialog");
  await verify
    .getByLabel("Contraseña original de la copia", { exact: true })
    .fill(password);
  await verify
    .getByRole("button", { name: "Comprobar integridad", exact: true })
    .click();
  await verify.waitFor({ state: "hidden" });
  checks.push("UI creates encrypted copy and independently verifies it");
  if (secure) await a.call("setApiKey", {provider: "custom", key: "fixture-current-key-preserved"});
  const currentSecret = secure ? await fs.readFile(path.join(root,"source","secrets","ai_key_custom.bin")) : null;
  await a.call("setCell", {
    rowId: seed.rows[0],
    columnId: title.id,
    value: "Edited after snapshot",
  });
  const chosen = await pick(a, copy);
  await assert.rejects(
    a.call("backupInspect", {
      token: chosen.token,
      password: "wrong-password",
    }),
  );
  assert.equal(
    (await a.call("getRow", { id: seed.rows[0] })).title,
    "Edited after snapshot",
  );
  await a.call("backupInspect", { token: chosen.token, password });
  await a.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (_window, options) => {
      if (options.title !== "Restaurar colección")
        throw Error("Unexpected native prompt");
      return { response: 1, checkboxChecked: false };
    };
  });
  await a.page.getByRole("button", {name: "Restaurar copia", exact: true}).click();
  const restoreDialog = a.page.getByRole("dialog");
  await restoreDialog.getByLabel("Contraseña original de la copia", {exact: true}).fill(password);
  await restoreDialog.getByRole("button", {name: "Comprobar antes de restaurar", exact: true}).click();
  await restoreDialog.getByRole("checkbox", {name: "Sustituir la colección actual conservando antes una copia cifrada y verificada", exact: true}).check();
  await restoreDialog.getByRole("button", {name: "Restaurar datos comprobados", exact: true}).click();
  await a.page.getByRole("heading", {name: "Tu espacio de investigación visual", exact: true}).waitFor();
  assert.equal(
    (await a.call("getRow", { id: seed.rows[0] })).title,
    before.title,
  );
  assert.equal(
    (await a.call("getRow", { id: seed.rows[0] })).cells[rich.id],
    before.cells[rich.id],
  );
  assert.deepEqual(await originals(a, seed.rows), hashes);
  if (secure) assert.deepEqual(await fs.readFile(path.join(root,"source","secrets","ai_key_custom.bin")),currentSecret);
  assert.deepEqual((await a.call("updateStatus")).preferences,{automaticChecks:false,autoDownload:false,beta:false});
  const safety = (await a.call("backupStatus")).entries.find(
    (e) => e.reason === "before-restore",
  );
  assert.ok(safety?.encrypted);
  checks.push(
    "Wrong password preserves data; replacement creates a verified encrypted safety copy",
  );
  await a.app.close();
  active = null;
  const reopened = await launch("source");
  assert.equal(
    (await reopened.call("getRow", { id: seed.rows[0] })).title,
    before.title,
  );
  assert.deepEqual(await originals(reopened, seed.rows), hashes);
  assert.equal(
    await reopened.page.evaluate(() =>
      localStorage.getItem("imago.native.backup-view"),
    ),
    JSON.stringify({
      view: "map",
      filters: [{ property: "research", value: "historical" }],
    }),
  );
  assert.equal((await reopened.call("status")).settings.remoteEnabled, false);
  assert.equal((await reopened.call("status")).settings.mode, "dark");
  checks.push(
    "Close and reopen retains IDs, rich content, view settings and all image hashes",
  );
  await reopened.app.close();
  active = null;
  const b = await launch("recovery");
  const recovery = await pick(b, safety.file);
  await b.call("backupInspect", { token: recovery.token, password });
  await b.call("backupRestore", {
    token: recovery.token,
    password,
    replace: false,
    restoreCredentials: secure,
  });
  assert.equal(
    (await b.call("getRow", { id: seed.rows[0] })).title,
    "Edited after snapshot",
  );
  assert.deepEqual(await originals(b, seed.rows), hashes);
  if (secure) {
    assert.equal((await b.call("credentialsStatus")).providers.custom,true);
    const stored = await fs.readFile(path.join(root,"recovery","secrets","ai_key_custom.bin"));
    assert.equal(stored.includes("fixture-current-key-preserved"),false);
  }
  checks.push(
    "Independent clean profile recovers the pre-replacement edited collection",
  );
  await storage(b);
  await chooseFolder(b);
  const second = path.join(folder, "recovered-again.imago");
  await b.app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, second);
  const roundtrip = await b.call("backupRun", { password });
  await b.call("backupVerify", { id: roundtrip.id, password });
  const corrupted = path.join(folder, "damaged.imago"),
    bytes = await fs.readFile(second);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  await fs.writeFile(corrupted, bytes);
  const bad = await pick(b, corrupted);
  await assert.rejects(b.call("backupInspect", { token: bad.token, password }));
  assert.equal(
    (await b.call("getRow", { id: seed.rows[0] })).title,
    "Edited after snapshot",
  );
  checks.push(
    "Recovered data creates another verified copy; authenticated corruption is rejected without mutation",
  );
  await b.app.close();
  active = null;
  const c = await launch("roundtrip");
  const final = await pick(c, second);
  await c.call("backupInspect", { token: final.token, password });
  await c.call("backupRestore", {
    token: final.token,
    password,
    replace: false,
    restoreCredentials: secure,
  });
  assert.equal(
    (await c.call("getRow", { id: seed.rows[0] })).title,
    "Edited after snapshot",
  );
  assert.deepEqual(await originals(c, seed.rows), hashes);
  assert.equal(
    (await c.call("getRow", { id: seed.rows[0] })).cells[rich.id],
    before.cells[rich.id],
  );
  checks.push(
    "Second complete backup → verify → restore cycle preserves originals and research content",
  );
  await storage(c);
  await c.page.screenshot({
    path: path.join(root, "backup-settings.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await c.app.close();
  active = null;
  await fs.writeFile(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        checks,
        errors,
        hashes,
        copy,
        safety: safety.file,
        roundtrip: second,
        executable: process.env.IMAGO_E2E_EXECUTABLE || "source",
      },
      null,
      2,
    ),
  );
  console.log("Backup native audit passed:", checks.length, root);
} catch (error) {
  await active?.page
    .screenshot({ path: path.join(root, "failure.png"), fullPage: true })
    .catch(() => {});
  await fs.writeFile(
    path.join(root, "failure.json"),
    JSON.stringify({ checks, errors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await active?.app.close().catch(() => {});
}

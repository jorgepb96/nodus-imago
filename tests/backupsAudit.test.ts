import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { Repository } from "../electron/db/repository";
import { Service } from "../electron/service";
import { Secrets } from "../electron/secrets/store";
import { Images } from "../electron/import/images";
import {
  writeBackup,
  restoreBackup,
  verifyBackup,
} from "../electron/export/backup";
import {
  encryptBackup,
  decryptBackup,
  sealMetadata,
  openMetadata,
} from "../electron/export/backupCrypto";
import {
  DesktopBackups,
  publishBackupFile,
} from "../electron/export/desktopBackups";
import { backupDue, backupPreferencesSchema } from "../shared/backups";
async function harness(root: string, name: string) {
  const profile = path.join(root, name);
  await fs.mkdir(profile, { recursive: true });
  const service = new Service(
    path.join(profile, "collection"),
    "unused",
    () => {},
  );
  const key = randomBytes(32);
  const secrets = new Secrets(path.join(profile, "secrets"), {
    available: () => true,
    encrypt: (value) => {
      const iv = randomBytes(12),
        c = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([c.update(value), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    decrypt: (data) => {
      const d = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
      d.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString();
    },
  });
  let client: Record<string, string> = {
    "imago.criteria.fixture": '{"filters":[]}',
  };
  let now = new Date("2026-11-13T20:00:00Z");
  const manager = new DesktopBackups(
    profile,
    secrets,
    {
      write: (file, application) =>
        service.run("_writeBackup", { file, application }),
      verify: (file) => service.run("_verifyBackup", { file }),
      restore: (file, replace) =>
        service.run("_restoreBackup", { file, replace }),
      client: async () => client,
      applyClient: async (data) => {
        client = data;
      },
      cancel: () => service.run("_cancelBackup"),
      lockRestore: () => service.run("_beginRestore"),
      unlockRestore: () => service.run("_endRestore"),
      changed: () => {},
    },
    () => now,
  );
  return {
    profile,
    service,
    repo: service.repo,
    manager,
    secrets,
    client: () => client,
    advance: (hours: number) => {
      now = new Date(+now + hours * 3600000);
    },
    async close() {
      await manager.close();
      await service.run("_close");
    },
  };
}
async function temp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "imago-backup-audit-"));
}
async function image(root: string) {
  const file = path.join(root, "fotografía original.png");
  await sharp({
    create: { width: 18, height: 14, channels: 3, background: "#7368cf" },
  })
    .png()
    .toFile(file);
  return file;
}
test("authenticated streaming encryption rejects wrong password, truncation and tampering without touching existing destinations", async () => {
  const root = await temp();
  try {
    const src = path.join(root, "source"),
      sealed = path.join(root, "encrypted"),
      out = path.join(root, "out");
    await fs.writeFile(src, randomBytes(1024 * 1024));
    await encryptBackup(src, sealed, "test-only-password");
    assert.equal(
      await decryptBackup(sealed, null, "test-only-password"),
      createHash("sha256")
        .update(await fs.readFile(src))
        .digest("hex"),
    );
    await assert.rejects(
      decryptBackup(sealed, out, "wrong-password"),
      /Contraseña/,
    );
    await assert.rejects(fs.stat(out), { code: "ENOENT" });
    await fs.writeFile(out, "preserve");
    await assert.rejects(decryptBackup(sealed, out, "test-only-password"));
    assert.equal(await fs.readFile(out, "utf8"), "preserve");
    await assert.rejects(encryptBackup(src, sealed, "test-only-password"));
    assert.ok((await fs.stat(sealed)).size > 1024 * 1024);
    for (const bytes of [
      (await fs.readFile(sealed)).subarray(0, 40),
      Buffer.from(await fs.readFile(sealed)),
    ]) {
      if (bytes.length > 40) bytes[100] ^= 1;
      const bad = path.join(root, "bad");
      await fs.writeFile(bad, bytes);
      await assert.rejects(
        decryptBackup(bad, path.join(root, "failed"), "test-only-password"),
      );
      await assert.rejects(fs.stat(path.join(root, "failed")), {
        code: "ENOENT",
      });
    }
    const value = await sealMetadata(
      { openrouter: "fixture-key" },
      "test-only-password",
    );
    assert.deepEqual(await openMetadata(value, "test-only-password"), {
      openrouter: "fixture-key",
    });
    await assert.rejects(openMetadata(value, "wrong-password"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("complete encrypted backup restores originals, rich blocks, preferences, view state and missing API keys; preserves existing keys", async () => {
  const root = await temp(),
    a = await harness(root, "source"),
    b = await harness(root, "target");
  try {
    const folder = path.join(root, "copies");
    await fs.mkdir(folder);
    await a.manager.folder(folder);
    await a.manager.setPassword("original-password-123");
    a.secrets.set("openrouter", "fixture-openrouter-original");
    a.secrets.set("gemini", "fixture-gemini-original");
    b.secrets.set("openrouter", "fixture-existing-preserved");
    const d = a.repo.create("Archivo histórico"),
      row = a.repo.createRow(d.database.id),
      text = a.repo.addColumn(d.database.id, "Descripción", "rich_text");
    a.repo.setCell(row.id, text.id, "# Documento\n\n- Padre\n  - Hijo");
    a.repo.updateSettings({
      language: "en",
      accent: "#112233",
      remoteEnabled: true,
    });
    const original = await image(root);
    await new Images(a.repo).importOne(
      {
        databaseId: d.database.id,
        columnId: d.columns.find((c) => c.type === "attachment")!.id,
        storage: "link",
        createUnmatched: false,
        files: [{ path: original, rowId: row.id }],
      },
      0,
    );
    const entry = await a.manager.create();
    assert.equal(entry.encrypted, true);
    assert.ok(
      !(await fs.readFile(entry.file)).includes(
        Buffer.from("fixture-gemini-original"),
      ),
    );
    await fs.rm(original);
    const pick = await b.manager.pick(entry.file);
    const preview = await b.manager.inspect(
      pick.token,
      "original-password-123",
    );
    assert.equal(preview.rows, 1);
    const result = await b.manager.restore(
      pick.token,
      "original-password-123",
      false,
      true,
    );
    assert.equal(result.credentialsRestored, 1);
    assert.equal(result.credentialsPreserved, 1);
    assert.equal(b.secrets.get("openrouter"), "fixture-existing-preserved");
    assert.equal(b.secrets.get("gemini"), "fixture-gemini-original");
    assert.deepEqual(
      b.repo.pageDocument(row.id, text.id),
      a.repo.pageDocument(row.id, text.id),
    );
    assert.equal(b.repo.getSettings().language, "en");
    assert.equal(b.repo.getSettings().accent, "#112233");
    assert.equal(b.repo.getSettings().remoteEnabled, false);
    assert.deepEqual(b.client(), a.client());
    const asset = b.repo.getRow(row.id).images[0];
    assert.equal(asset.fileName, "fotografía original.png");
    assert.ok((await fs.stat(b.repo.asset(asset.id).original_path)).size > 0);
    assert.equal((await b.manager.status()).preferences.enabled, false);
  } finally {
    await a.close();
    await b.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("replacement first creates a verified safety copy and rolls back the original collection on transaction failure", async () => {
  const root = await temp(),
    a = await harness(root, "a"),
    b = await harness(root, "b");
  try {
    const folder = path.join(root, "copies");
    await fs.mkdir(folder);
    await a.manager.folder(folder);
    await b.manager.folder(folder);
    await a.manager.setPassword("source-password-123");
    await b.manager.setPassword("target-password-123");
    const src = a.repo.create("New collection");
    a.repo.createRow(src.database.id);
    const old = b.repo.create("Original must survive");
    b.repo.createRow(old.database.id);
    const entry = await a.manager.create();
    const pick = await b.manager.pick(entry.file);
    await b.manager.inspect(pick.token, "source-password-123");
    b.repo.db.exec(
      "CREATE TRIGGER fixture_failure BEFORE INSERT ON db_rows BEGIN SELECT RAISE(ABORT,'injected transaction failure'); END",
    );
    await assert.rejects(
      b.manager.restore(pick.token, "source-password-123", true, true),
      /injected/,
    );
    assert.equal(b.repo.list()[0].name, "Original must survive");
    const safety = (await b.manager.status()).entries.find(
      (e) => e.reason === "before-restore",
    )!;
    assert.ok(safety);
    assert.equal((await b.manager.verify(safety.id)).rows, 1);
    b.repo.db.exec("DROP TRIGGER fixture_failure");
    const result = await b.manager.restore(
      pick.token,
      "source-password-123",
      true,
      true,
    );
    assert.equal(result.databases, 1);
    assert.equal(b.repo.list()[0].name, "New collection");
  } finally {
    await a.close();
    await b.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("paused import remains recoverable after source removal, including its original file name and title", async () => {
  const root = await temp(),
    source = new Repository(path.join(root, "source")),
    target = new Service(path.join(root, "target"), "unused", () => {});
  try {
    const d = source.create("Pending import"),
      original = await image(root);
    const id = source.newJob(
      "images",
      {
        databaseId: d.database.id,
        columnId: d.columns.find((c) => c.type === "attachment")!.id,
        storage: "copy",
        createUnmatched: true,
        files: [{ path: original, rowId: null }],
      },
      1,
    );
    source.db.prepare("UPDATE jobs SET state='paused' WHERE id=?").run(id);
    const file = path.join(root, "backup.imago");
    await writeBackup(source, file);
    await fs.rm(original);
    await restoreBackup(target.repo, file);
    assert.equal(target.repo.jobs()[0].state, "paused");
    target.queue.control(id, "resume");
    await target.queue.task;
    assert.equal(target.repo.jobs()[0].state, "completed");
    const rows = (await target.run("search", { databaseIds: [d.database.id] }))
      .rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].images[0].fileName, "fotografía original.png");
    assert.equal(
      rows[0].cells[d.columns.find((c) => c.type === "title")!.id],
      "fotografía original",
    );
  } finally {
    source.close();
    await target.run("_close");
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("snapshot checksum and ambiguous manifests fail before modifying the target", async () => {
  const root = await temp(),
    source = new Repository(path.join(root, "source")),
    target = new Repository(path.join(root, "target"));
  try {
    const d = source.create("Source"),
      r = source.createRow(d.database.id),
      original = await image(root);
    await new Images(source).importOne(
      {
        databaseId: d.database.id,
        columnId: d.columns.find((c) => c.type === "attachment")!.id,
        storage: "copy",
        createUnmatched: false,
        files: [{ path: original, rowId: r.id }],
      },
      0,
    );
    const file = path.join(root, "copy.imago");
    await writeBackup(source, file);
    const zip = new AdmZip(file),
      manifest = JSON.parse(zip.readAsText("manifest.json"));
    manifest.files.push({
      ...manifest.files[0],
      hash: "0".repeat(64),
      entry: "originals/" + "0".repeat(64),
    });
    zip.updateFile("manifest.json", Buffer.from(JSON.stringify(manifest)));
    const bad = path.join(root, "bad.imago");
    zip.writeZip(bad);
    await assert.rejects(verifyBackup(target, bad), /ambiguo/);
    await assert.rejects(restoreBackup(target, bad), /ambiguo/);
    const corrupt = new AdmZip(file);
    const bytes = corrupt.readFile("imago.sqlite")!;
    bytes[100] ^= 1;
    corrupt.updateFile("imago.sqlite", bytes);
    corrupt.writeZip(bad);
    await assert.rejects(restoreBackup(target, bad), /Hash/);
    assert.equal(target.list().length, 0);
    assert.deepEqual(await fs.readdir(path.join(target.root, "originals")), []);
  } finally {
    source.close();
    target.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("scheduling catches up missed days, intervals, invalid timestamps and a clock moved backwards", () => {
  const p = backupPreferencesSchema.parse({ days: [1], hour: 10, minute: 30 }),
    now = new Date(2026, 10, 17, 12);
  assert.equal(backupDue(p, null, now), true);
  assert.equal(
    backupDue(p, new Date(2026, 10, 16, 11).toISOString(), now),
    false,
  );
  assert.equal(
    backupDue(p, new Date(2026, 10, 15, 10).toISOString(), now),
    true,
  );
  assert.equal(backupDue(p, "broken", now), true);
  assert.equal(backupDue(p, new Date(2027, 0, 1).toISOString(), now), true);
  const interval = { ...p, schedule: "interval" as const, intervalHours: 24 };
  assert.equal(
    backupDue(interval, new Date(+now - 23 * 3600000).toISOString(), now),
    false,
  );
  assert.equal(
    backupDue(interval, new Date(+now - 24 * 3600000).toISOString(), now),
    true,
  );
});
test("automatic retention archives rather than deletes, retains three verified copies and supports password rotation", async () => {
  const root = await temp(),
    a = await harness(root, "a");
  try {
    const folder = path.join(root, "copies");
    await fs.mkdir(folder);
    a.repo.create("Data");
    await a.manager.folder(folder);
    await a.manager.setPassword("first-password-123");
    await a.manager.configure(
      backupPreferencesSchema.parse({
        enabled: true,
        schedule: "interval",
        intervalHours: 1,
        retentionEnabled: true,
        keepLast: 3,
      }),
    );
    for (let i = 0; i < 4; i++) {
      await a.manager.tick();
      a.advance(2);
      if (i === 1) await a.manager.setPassword("second-password-123");
    }
    const state = await a.manager.status();
    assert.equal(state.entries.length, 4);
    assert.equal(state.entries.filter((e) => !e.archived).length, 3);
    assert.ok(state.entries.every((e) => e.available));
    const archived = state.entries.find((e) => e.archived)!;
    await a.manager.verify(archived.id);
    await a.manager.archive(archived.id, false);
    assert.equal(
      (await a.manager.status()).entries.filter((e) => e.archived).length,
      0,
    );
  } finally {
    await a.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("missing source or destination, existing output and interrupted operation never damage earlier verified backups", async () => {
  const root = await temp(),
    a = await harness(root, "a");
  try {
    const folder = path.join(root, "copies");
    await fs.mkdir(folder);
    await a.manager.folder(folder);
    const d = a.repo.create("Data"),
      row = a.repo.createRow(d.database.id),
      original = await image(root);
    await a.service.images.importOne(
      {
        databaseId: d.database.id,
        columnId: d.columns.find((c) => c.type === "attachment")!.id,
        storage: "link",
        createUnmatched: false,
        files: [{ path: original, rowId: row.id }],
      },
      0,
    );
    const good = await a.manager.create();
    const hash = good.sha256;
    await assert.rejects(a.manager.create(good.file), /ya existe/);
    await fs.rm(original);
    await assert.rejects(a.manager.create());
    assert.equal((await a.manager.status()).entries.length, 1);
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(good.file))
        .digest("hex"),
      hash,
    );
    assert.ok(
      (await fs.readdir(folder)).every(
        (x) => !x.includes("partial") && !x.startsWith(".imago-backup"),
      ),
    );
    await assert.rejects(a.manager.folder(a.profile), /fuera/);
  } finally {
    await a.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("restoration lock rejects writes, concurrent snapshots and queue resumes until explicitly released", async () => {
  const root = await temp(),
    f = await harness(root, "locked");
  try {
    const database = f.repo.create("Existing");
    await f.service.run("_beginRestore");
    await assert.rejects(
      f.service.run("createRow", { databaseId: database.database.id }),
      /restauración/,
    );
    await assert.rejects(f.service.run("resumePausedJobs"), /restauración/);
    assert.equal((await f.service.run("listDatabases")).length, 1);
    await f.service.run("_endRestore");
    const row = await f.service.run("createRow", {
      databaseId: database.database.id,
    });
    assert.ok(row.id);
  } finally {
    await f.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("manual encrypted backups work without an OS password store and remain portable", async () => {
  const root = await temp(),
    a = await harness(root, "source"),
    b = await harness(root, "target");
  try {
    a.secrets.encryption.available = () => false;
    b.secrets.encryption.available = () => false;
    a.repo.create("Portable");
    const file = path.join(root, "portable.imago");
    const copy = await a.manager.create(file, "manual", "manual-password-123");
    assert.equal(copy.encrypted, true);
    assert.equal((await a.manager.status()).passwordStored, false);
    await assert.rejects(a.manager.setPassword("manual-password-123"));
    const pick = await b.manager.pick(file);
    await b.manager.inspect(pick.token, "manual-password-123");
    await b.manager.restore(pick.token, "manual-password-123", false, false);
    assert.equal(b.repo.list()[0].name, "Portable");
  } finally {
    await a.close();
    await b.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("source changed after preview cannot replace the target; disconnected backup folder blocks replacement safely", async () => {
  const root = await temp(),
    a = await harness(root, "source"),
    b = await harness(root, "target");
  try {
    const folder = path.join(root, "external");
    await fs.mkdir(folder);
    await b.manager.folder(folder);
    await b.manager.setPassword("safety-password-123");
    a.repo.create("Source");
    b.repo.create("Preserved target");
    const copy = await a.manager.create(
      path.join(root, "source.imago"),
      "manual",
      "source-password-123",
    );
    let pick = await b.manager.pick(copy.file);
    await b.manager.inspect(pick.token, "source-password-123");
    await fs.appendFile(copy.file, "changed");
    await assert.rejects(
      b.manager.restore(pick.token, "source-password-123", true, false),
      /cambió/,
    );
    assert.equal(b.repo.list()[0].name, "Preserved target");
    const original = await a.manager.create(
      path.join(root, "second.imago"),
      "manual",
      "source-password-123",
    );
    pick = await b.manager.pick(original.file);
    await b.manager.inspect(pick.token, "source-password-123");
    await fs.rename(folder, folder + "-unplugged");
    await assert.rejects(
      b.manager.restore(pick.token, "source-password-123", true, false),
    );
    assert.equal(b.repo.list()[0].name, "Preserved target");
    await b.service.run("createRow", { databaseId: b.repo.list()[0].id });
  } finally {
    await a.close();
    await b.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("aborted snapshot removes only its partial output and preserves existing data and backups", async () => {
  const root = await temp(),
    f = await harness(root, "source");
  try {
    f.repo.create("Preserved");
    const old = path.join(root, "old.imago");
    await writeBackup(f.repo, old);
    const originalHash = createHash("sha256")
      .update(await fs.readFile(old))
      .digest("hex");
    const controller = new AbortController();
    controller.abort();
    const partial = path.join(root, "cancelled.imago");
    await assert.rejects(
      writeBackup(f.repo, partial, { signal: controller.signal }),
    );
    await assert.rejects(fs.stat(partial), { code: "ENOENT" });
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(old))
        .digest("hex"),
      originalHash,
    );
    await verifyBackup(f.repo, old);
    assert.deepEqual(await fs.readdir(path.join(f.repo.root, "staging")), []);
  } finally {
    await f.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("encrypted backup never prepares its plaintext archive in the external/synced destination", async () => {
  const root = await temp(),
    f = await harness(root, "private-profile");
  try {
    const external = path.join(root, "synced-folder");
    await fs.mkdir(external);
    f.repo.create("Private research");
    const original = f.service.run.bind(f.service);
    let observed = false;
    f.service.run = async (command, input) => {
      if (command === "_writeBackup") {
        observed = true;
        assert.ok(input.file.startsWith(f.profile + path.sep));
        assert.equal(input.file.startsWith(external + path.sep), false);
      }
      return original(command, input);
    };
    const copy = await f.manager.create(
      path.join(external, "encrypted.imago"),
      "manual",
      "external-folder-password",
    );
    assert.equal(observed, true);
    assert.equal(
      (await fs.readFile(copy.file)).subarray(0, 10).toString(),
      "IMAGOENC1\n",
    );
    assert.deepEqual(await fs.readdir(external), ["encrypted.imago"]);
    assert.equal(
      (await fs.readdir(f.profile)).some((n) => n.startsWith(".imago-backup-")),
      false,
    );
  } finally {
    await f.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("disk exhaustion during creation or replacement preserves all previous copies and target records", async () => {
  const root = await temp(),
    a = await harness(root, "source"),
    b = await harness(root, "target"),
    statfs = fs.statfs;
  try {
    const folder = path.join(root, "copies");
    await fs.mkdir(folder);
    await b.manager.folder(folder);
    await b.manager.setPassword("disk-safety-password");
    a.repo.create("Source");
    b.repo.create("Preserved");
    const copy = await a.manager.create(
        path.join(folder, "good.imago"),
        "manual",
        "disk-source-password",
      ),
      pick = await b.manager.pick(copy.file);
    await b.manager.inspect(pick.token, "disk-source-password");
    const hash = createHash("sha256")
      .update(await fs.readFile(copy.file))
      .digest("hex");
    fs.statfs = (async () => ({
      bavail: 0,
      bsize: 4096,
    })) as unknown as typeof fs.statfs;
    await assert.rejects(
      b.manager.create(
        path.join(folder, "no-space.imago"),
        "manual",
        "disk-safety-password",
      ),
      /Espacio insuficiente/,
    );
    await assert.rejects(
      b.manager.restore(pick.token, "disk-source-password", true, false),
      /Espacio insuficiente/,
    );
    assert.equal(b.repo.list()[0].name, "Preserved");
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(copy.file))
        .digest("hex"),
      hash,
    );
    assert.deepEqual(await fs.readdir(folder), ["good.imago"]);
    await b.service.run("createRow", { databaseId: b.repo.list()[0].id });
  } finally {
    fs.statfs = statfs;
    await a.close();
    await b.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("exclusive publication preserves both files when a destination appears after preflight", async () => {
  const root = await temp(),
    link = fs.link;
  try {
    const source = path.join(root, "verified.partial"),
      destination = path.join(root, "new.imago");
    await fs.writeFile(source, "verified-data");
    const hash = createHash("sha256").update("verified-data").digest("hex");
    fs.link = async (from, to) => {
      await fs.writeFile(to, "concurrently-created-copy", { flag: "wx" });
      return link(from, to);
    };
    await assert.rejects(publishBackupFile(source, destination, hash), {
      code: "EEXIST",
    });
    assert.equal(await fs.readFile(source, "utf8"), "verified-data");
    assert.equal(
      await fs.readFile(destination, "utf8"),
      "concurrently-created-copy",
    );
  } finally {
    fs.link = link;
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("exclusive publication supports external filesystems without hard links and never overwrites an existing file", async () => {
  const root = await temp(),
    link = fs.link;
  try {
    fs.link = async () => {
      throw Object.assign(Error("Hard links unsupported"), { code: "ENOTSUP" });
    };
    const source = path.join(root, "verified.partial"),
      destination = path.join(root, "new.imago"),
      hash = createHash("sha256").update("verified-data").digest("hex");
    await fs.writeFile(source, "verified-data");
    await publishBackupFile(source, destination, hash);
    assert.equal(await fs.readFile(destination, "utf8"), "verified-data");
    await assert.rejects(fs.stat(source), { code: "ENOENT" });
    await fs.writeFile(source, "verified-data");
    await assert.rejects(publishBackupFile(source, destination, hash), {
      code: "EEXIST",
    });
    assert.equal(await fs.readFile(source, "utf8"), "verified-data");
    assert.equal(await fs.readFile(destination, "utf8"), "verified-data");
  } finally {
    fs.link = link;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("registered backups restore using their saved password version after master-password rotation", async () => {
  const root = await temp(),
    f = await harness(root, "source");
  try {
    const folder = path.join(root, "copies");
    await fs.mkdir(folder);
    await f.manager.folder(folder);
    await f.manager.setPassword("first-master-password");
    const db = f.repo.create("Before rotation"),
      row = f.repo.createRow(db.database.id);
    const copy = await f.manager.create();
    await f.manager.setPassword("second-master-password");
    f.repo.setCell(
      row.id,
      db.columns.find((c) => c.type === "title")!.id,
      "Changed later",
    );
    const pick = await f.manager.pick(copy.file);
    assert.equal(pick.passwordStored, true);
    await f.manager.inspect(pick.token);
    await f.manager.restore(pick.token, undefined, true, false);
    assert.notEqual(f.repo.getRow(row.id).title, "Changed later");
    const safety = (await f.manager.status()).entries.find(
      (e) => e.reason === "before-restore",
    )!;
    await f.manager.verify(safety.id);
  } finally {
    await f.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

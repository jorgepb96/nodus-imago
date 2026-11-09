import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import AdmZip from "adm-zip";
import Database from "better-sqlite3";
import { Repository } from "../electron/db/repository";
import {
  Images,
  IMAGE_EXTENSIONS,
  hashFile,
  imagePipeline,
  isImage,
} from "../electron/import/images";
import { writeBackup, restoreBackup } from "../electron/export/backup";
import { Archive } from "../electron/import/archive";
import { importNodus } from "../electron/import/nodus";
import { importNotion } from "../electron/import/notion";
import { Service } from "../electron/service";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-files-"));
  const repo = new Repository(path.join(root, "data"));
  const image = path.join(root, "IMG001.jpg");
  await sharp({
    create: { width: 100, height: 80, channels: 3, background: "#446677" },
  })
    .jpeg()
    .toFile(image);
  return {
    root,
    repo,
    image,
    close: async () => {
      if (repo.db.open) repo.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
test("image import hashes originals, creates external thumbnails, associates multiple images and skips duplicates", async () => {
  const f = await fixture();
  try {
    const d = f.repo.importCsv("A", ["ID"], ["title"], [["IMG001"]]),
      row = f.repo.literal({}).rows[0],
      images = new Images(f.repo),
      plan = await images.preview(d.database.id, [f.image]);
    assert.equal(plan.matches[0].rowId, row.id);
    const id = images.enqueue(
      plan.token,
      "copy",
      true,
      plan.matches.map((m) => ({ pathToken: m.pathToken, rowId: m.rowId })),
    );
    const payload = JSON.parse(
      (
        f.repo.db
          .prepare("SELECT payload_json FROM jobs WHERE id=?")
          .get(id) as any
      ).payload_json,
    );
    const before = await hashFile(f.image);
    assert.equal(await images.importOne(payload, 0), "imported");
    assert.equal(await images.importOne(payload, 0), "skipped");
    const after = f.repo.getRow(row.id);
    assert.equal(after.images.length, 1);
    assert.equal(after.images[0].width, 100);
    assert.equal(await hashFile(f.image), before);
    assert.equal(after.images[0].contentHash, before);
    assert.ok(
      (await fs.stat(f.repo.assetPath(after.images[0].id, true))).size > 0,
    );
    assert.notEqual(f.repo.assetPath(after.images[0].id), f.image);
    const managed = f.repo.assetPath(after.images[0].id);
    f.repo.deleteImage(after.images[0].id);
    assert.equal(f.repo.stats().images, 0);
    assert.equal(f.repo.getRow(row.id).images.length, 0);
    assert.ok((await fs.stat(managed)).size > 0);
  } finally {
    await f.close();
  }
});
test("image import can target a chosen attachment column instead of the first one", async () => {
  const f = await fixture();
  try {
    const d = f.repo.create("A"),
      first = d.columns.find((c) => c.type === "attachment")!,
      second = f.repo.addColumn(d.database.id, "Otra carpeta", "attachment"),
      images = new Images(f.repo),
      row = f.repo.createRow(d.database.id),
      plan = await images.preview(d.database.id, [f.image]);
    const id = images.enqueue(
      plan.token,
      "copy",
      false,
      plan.matches.map((m) => ({ pathToken: m.pathToken, rowId: row.id })),
      second.id,
    );
    const payload = JSON.parse(
      (f.repo.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(id) as any)
        .payload_json,
    );
    await images.importOne(payload, 0);
    assert.equal(f.repo.getRow(row.id).images[0].columnId, second.id);
    assert.notEqual(f.repo.getRow(row.id).images[0].columnId, first.id);
  } finally {
    await f.close();
  }
});
test("bulk image reassignment and deletion keep both records consistent", async () => {
  const f = await fixture();
  try {
    const d = f.repo.create("A"),
      first = d.columns.find((c) => c.type === "attachment")!,
      second = f.repo.addColumn(d.database.id, "Segunda carpeta", "attachment"),
      images = new Images(f.repo),
      from = f.repo.createRow(d.database.id),
      to = f.repo.createRow(d.database.id);
    for (const columnId of [first.id, second.id])
      await images.importOne(
        {
          databaseId: d.database.id,
          columnId,
          storage: "copy",
          createUnmatched: false,
          files: [{ path: f.image, rowId: from.id }],
        },
        0,
      );
    const assets = f.repo.getRow(from.id).images;
    assert.equal(assets.length, 2);
    assert.equal(
      f.repo.reassignImages(
        assets.map((asset) => asset.id),
        to.id,
      ),
      2,
    );
    assert.equal(f.repo.getRow(from.id).images.length, 0);
    assert.equal(f.repo.getRow(to.id).images.length, 2);
    assert.equal(
      f.repo.deleteImages(
        f.repo.getRow(to.id).images.map((asset) => asset.id),
      ),
      2,
    );
    assert.equal(f.repo.getRow(to.id).images.length, 0);
    assert.equal(f.repo.stats().images, 0);
  } finally {
    await f.close();
  }
});
test("unmatched duplicate image never creates a second record, including after interrupted-job replay", async () => {
  const f = await fixture();
  try {
    const d = f.repo.create("A"),
      images = new Images(f.repo),
      payload = {
        databaseId: d.database.id,
        columnId: d.columns[1].id,
        storage: "copy" as const,
        createUnmatched: true,
        files: [{ path: f.image, rowId: null }],
      };
    await images.importOne(payload, 0);
    await images.importOne(payload, 0);
    assert.equal(f.repo.stats().rows, 1);
    assert.equal(f.repo.stats().images, 1);
  } finally {
    await f.close();
  }
});
test("native backup restores IDs, relations, tags, originals and embeddings, and refuses overwrite", async () => {
  const f = await fixture(),
    target = new Repository(path.join(f.root, "restored"));
  try {
    const d = f.repo.importCsv(
        "A",
        ["ID", "Tags"],
        ["title", "multi_select"],
        [["IMG001", "Paisaje, Rural"]],
      ),
      row = f.repo.literal({}).rows[0],
      attachment = f.repo.addColumn(d.database.id, "Fotos", "attachment"),
      images = new Images(f.repo);
    await images.importOne(
      {
        databaseId: d.database.id,
        columnId: attachment.id,
        storage: "link",
        createUnmatched: false,
        files: [{ path: f.image, rowId: row.id }],
      },
      0,
    );
    f.repo.db
      .prepare("INSERT INTO embeddings VALUES(?,?,?)")
      .run(
        f.repo.getRow(row.id).images[0].contentHash,
        "contract",
        Buffer.from(new Float32Array(256).fill(0.0625).buffer),
      );
    const backup = path.join(f.root, "backup.imago");
    await writeBackup(f.repo, backup);
    // Completed job history is not user data and must not block restoring into
    // an otherwise empty collection.
    const previousJob = target.newJob("analyze", { items: [] }, 0);
    target.db
      .prepare("UPDATE jobs SET state='completed' WHERE id=?")
      .run(previousJob);
    // Orphaned vectors from deleted databases must not collide with the backup.
    target.db
      .prepare("INSERT INTO embeddings VALUES(?,?,?)")
      .run(
        f.repo.getRow(row.id).images[0].contentHash,
        "contract",
        Buffer.from(new Float32Array(256).fill(0.0625).buffer),
      );
    assert.equal(await restoreBackup(target, backup), 1);
    assert.deepEqual(
      target.detail(d.database.id).columns.map((c) => c.id),
      f.repo.detail(d.database.id).columns.map((c) => c.id),
    );
    assert.equal(
      target.getRow(row.id).images[0].contentHash,
      f.repo.getRow(row.id).images[0].contentHash,
    );
    assert.equal(target.literal({ query: "rural" }).total, 1);
    assert.equal(target.stats().indexed, 1);
    assert.equal(
      await hashFile(target.assetPath(target.getRow(row.id).images[0].id)),
      await hashFile(f.image),
    );
    await assert.rejects(restoreBackup(target, backup), /vacía/);
  } finally {
    target.close();
    await f.close();
  }
});
test("archive path traversal and tampered backup originals are rejected", async () => {
  const f = await fixture();
  try {
    const zip = new AdmZip();
    zip.addFile(
      "manifest.json",
      Buffer.from(
        JSON.stringify({
          format: "nodus.imago/1",
          createdAt: "now",
          files: [{ source: "x", entry: "../../evil", hash: "a".repeat(64) }],
        }),
      ),
    );
    const file = path.join(f.root, "bad.imago");
    zip.writeZip(file);
    await assert.rejects(restoreBackup(f.repo, file));
    assert.equal(f.repo.list().length, 0);
  } finally {
    await f.close();
  }
});
test("Nodus import reads a snapshot, preserves option IDs and extracts v135 deduplicated blobs without modifying source", async () => {
  const f = await fixture();
  try {
    const sourceFile = path.join(f.root, "nodus.sqlite"),
      source = new Repository(path.join(f.root, "source"));
    const d = source.importCsv(
        "Nodus",
        ["ID", "Tags"],
        ["title", "multi_select"],
        [["IMG001", "Paisaje, Retrato"]],
      ),
      r = source.literal({}).rows[0];
    source.db.exec(
      "CREATE TABLE db_blobs(hash TEXT PRIMARY KEY,data BLOB);CREATE TABLE db_attachments(id TEXT,row_id TEXT,column_id TEXT,file_name TEXT,mime_type TEXT,position INTEGER,created_at TEXT,description TEXT,extracted_text TEXT,blob BLOB,blob_hash TEXT)",
    );
    const c = source.addColumn(d.database.id, "Fotos", "attachment");
    const n = source.addColumn(d.database.id, "Número", "number");
    const formula = source.addColumn(d.database.id, "Doble", "formula", {
      formula: {
        kind: "arithmetic",
        op: "multiply",
        operands: [
          { kind: "column", columnId: n.id },
          { kind: "number", value: 2 },
        ],
      },
    });
    source.setCell(r.id, n.id, "6");
    assert.equal(source.getRow(r.id).cells[formula.id], "12");
    const bytes = await fs.readFile(f.image),
      hash = await hashFile(f.image);
    source.db.prepare("INSERT INTO db_blobs VALUES(?,?)").run(hash, bytes);
    source.db
      .prepare("INSERT INTO db_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        "attachment-1",
        r.id,
        c.id,
        "IMG001.jpg",
        "image/jpeg",
        0,
        new Date().toISOString(),
        null,
        "familia",
        null,
        hash,
      );
    await source.db.backup(sourceFile);
    source.close();
    const before = await hashFile(sourceFile),
      result = await importNodus(f.repo, sourceFile);
    assert.equal(result.databases, 1);
    assert.equal(result.attachments, 1);
    assert.equal(f.repo.getRow(r.id).images[0].id, "attachment-1");
    assert.equal(await hashFile(sourceFile), before);
    assert.deepEqual(
      f.repo.detail(d.database.id).columns[1].options.map((o) => o.id),
      d.columns[1].options.map((o) => o.id),
    );
    const importedFormula = f.repo
      .detail(d.database.id)
      .columns.find((col) => col.type === "formula")!;
    assert.equal(f.repo.getRow(r.id).cells[importedFormula.id], "12");
  } finally {
    await f.close();
  }
});
test("Notion ZIP imports a CSV and safely resolves its referenced image", async () => {
  const f = await fixture();
  try {
    const zip = new AdmZip();
    zip.addFile(
      "Archivo 0123456789abcdef0123456789abcdef.csv",
      Buffer.from("ID,Foto\nIMG001,images/IMG001.jpg"),
    );
    zip.addFile("images/IMG001.jpg", await fs.readFile(f.image));
    const file = path.join(f.root, "notion.zip");
    zip.writeZip(file);
    const result = await importNotion(f.repo, new Images(f.repo), file);
    assert.equal(result.databases, 1);
    assert.equal(result.attachments, 1);
    assert.equal(f.repo.list()[0].name, "Archivo");
    assert.equal(f.repo.stats().images, 1);
  } finally {
    await f.close();
  }
});
test("persistent paused tasks survive service restart and resume import from their cursor", async () => {
  const f = await fixture();
  const d = f.repo.create("A"),
    payload = {
      databaseId: d.database.id,
      columnId: d.columns[1].id,
      storage: "copy",
      createUnmatched: true,
      files: [{ path: f.image, rowId: null }],
    },
    id = f.repo.newJob("images", payload, 1);
  f.repo.db.prepare("UPDATE jobs SET state='paused' WHERE id=?").run(id);
  f.repo.close();
  let service: Service | undefined;
  try {
    service = new Service(path.join(f.root, "data"), "not-used", () => {});
    assert.equal(service.repo.jobs()[0].state, "paused");
    await service.run("controlJob", { id, action: "resume" });
    const start = Date.now();
    while (
      service.repo.jobs()[0].state !== "completed" &&
      Date.now() - start < 10000
    )
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(service.repo.jobs()[0].state, "completed");
    assert.equal(service.repo.stats().images, 1);
    await service.run("_close");
    service = undefined;
  } finally {
    if (service) await service.run("_close");
    await f.close();
  }
});
test("Notion ZIP imports Markdown pages as a text database and extracts page images", async () => {
  const f = await fixture();
  try {
    const zip = new AdmZip();
    zip.addFile(
      "Sección/Página 0123456789abcdef0123456789abcdef.md",
      Buffer.from("# Página\n\n![Foto](images/IMG001.jpg)\n\nContenido"),
    );
    zip.addFile("Sección/images/IMG001.jpg", await fs.readFile(f.image));
    const file = path.join(f.root, "notion-pages.zip");
    zip.writeZip(file);
    const result = await importNotion(f.repo, new Images(f.repo), file);
    assert.equal(result.databases, 1);
    assert.equal(result.attachments, 1);
    const database = f.repo.list()[0];
    assert.equal(database.name, "Páginas Notion");
    const detail = f.repo.detail(database.id),
      rows = f.repo.literal({
        databaseIds: [database.id],
        query: "",
        limit: 10,
      });
    assert.equal(rows.total, 1);
    assert.equal(rows.rows[0].title, "Página");
    const contentColumn = detail.columns.find((column) => column.name === "Contenido")!;
    assert.match(String(f.repo.getRow(rows.rows[0].id).cells[contentColumn.id]), /# Página/);
    const folderColumn = detail.columns.find((column) => column.name === "Carpeta")!;
    assert.equal(f.repo.getRow(rows.rows[0].id).cells[folderColumn.id], "Sección");
    assert.equal(f.repo.getRow(rows.rows[0].id).images.length, 1);
    assert.ok(result.notices.some((notice) => notice.includes("páginas Markdown")));
  } finally {
    await f.close();
  }
});

test("HEIC/HEIF images decode through the WASM libheif path and import with a thumbnail", async () => {
  const f = await fixture();
  try {
    const heic = path.resolve("tests/fixtures/synthetic.heic");
    assert.ok(isImage(heic));
    assert.ok(IMAGE_EXTENSIONS.includes("heic"));
    const pipeline = await imagePipeline(heic),
      meta = await pipeline.metadata();
    assert.equal(meta.width, 96);
    assert.equal(meta.height, 64);
    const d = f.repo.create("HEIC"),
      column = d.columns.find((c) => c.type === "attachment")!,
      row = f.repo.createRow(d.database.id),
      images = new Images(f.repo);
    await images.importOne(
      {
        databaseId: d.database.id,
        columnId: column.id,
        storage: "copy",
        createUnmatched: false,
        files: [{ path: heic, rowId: row.id }],
      },
      0,
    );
    const stored = f.repo.getRow(row.id).images;
    assert.equal(stored.length, 1);
    assert.match(f.repo.assetPath(stored[0].id), /\.heic$/);
    assert.ok(await fs.stat(f.repo.assetPath(stored[0].id, true)));
    assert.equal(f.repo.stats().images, 1);
  } finally {
    await f.close();
  }
});

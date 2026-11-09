import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import bmp from "bmp-js";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { Repository } from "../electron/db/repository";
import { Images } from "../electron/import/images";
import { Archive } from "../electron/import/archive";
import { writeBackup, restoreBackup } from "../electron/export/backup";
import { Models, type CatalogModel } from "../electron/ai/models";

test("PNG, WebP, TIFF and BMP have real decoding and thumbnail paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-formats-")),
    repo = new Repository(path.join(root, "data"));
  try {
    const d = repo.create("Formatos"),
      images = new Images(repo);
    for (const format of ["png", "webp", "tiff", "bmp"]) {
      const file = path.join(root, "source." + format);
      if (format === "bmp") {
        const data = Buffer.alloc(4 * 16 * 12, 0);
        for (let i = 0; i < data.length; i += 4) {
          data[i + 1] = 90;
          data[i + 2] = 40;
          data[i + 3] = 150;
        }
        await fs.writeFile(
          file,
          bmp.encode({ width: 16, height: 12, data }).data,
        );
      } else {
        const image = sharp({
          create: { width: 16, height: 12, channels: 3, background: "#994477" },
        });
        await image.toFormat(format as "png").toFile(file);
      }
      await images.importOne(
        {
          databaseId: d.database.id,
          columnId: d.columns[1].id,
          storage: "copy",
          createUnmatched: true,
          files: [{ path: file, rowId: null }],
        },
        0,
      );
    }
    assert.equal(repo.stats().images, 4);
    for (const row of repo.literal({}).rows) {
      assert.equal(row.images[0].width, 16);
      assert.ok(
        (await fs.stat(repo.assetPath(row.images[0].id, true))).size > 0,
      );
    }
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("backup refuses a linked original whose content no longer matches its stored hash", async () => {
  const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "imago-backup-integrity-"),
    ),
    repo = new Repository(path.join(root, "data"));
  try {
    const d = repo.create("A"),
      file = path.join(root, "source.png");
    await sharp({
      create: { width: 12, height: 12, channels: 3, background: "#224466" },
    })
      .png()
      .toFile(file);
    await new Images(repo).importOne(
      {
        databaseId: d.database.id,
        columnId: d.columns[1].id,
        storage: "link",
        createUnmatched: true,
        files: [{ path: file, rowId: null }],
      },
      0,
    );
    await fs.writeFile(file, "modified");
    const destination = path.join(root, "invalid.imago");
    await assert.rejects(writeBackup(repo, destination), /ha cambiado/);
    await assert.rejects(fs.access(destination));
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("archive traversal is rejected before any entry can be extracted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-zip-"));
  try {
    const zip = new AdmZip();
    zip.addFile("ok/evil", Buffer.from("data"));
    const binary = zip.toBuffer(),
      from = Buffer.from("ok/evil"),
      to = Buffer.from("../evil");
    for (let i = 0; i <= binary.length - from.length; i++)
      if (binary.subarray(i, i + from.length).equals(from)) to.copy(binary, i);
    const file = path.join(root, "bad.zip");
    await fs.writeFile(file, binary);
    await assert.rejects(Archive.open(file));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("model integrity verifies actual bytes and rejects same-size tampering", async () => {
  const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "imago-model-integrity-"),
    ),
    repo = new Repository(root),
    models = new Models(repo);
  try {
    const data = Buffer.from('{"unit":1}'),
      definition: CatalogModel = {
        id: "fixture",
        repository: "fixture",
        revision: "unit",
        label: "Fixture",
        task: "vision",
        license: "MIT",
        files: [
          {
            path: "config.json",
            size: data.length,
            algorithm: "sha256",
            digest: createHash("sha256").update(data).digest("hex"),
          },
        ],
      };
    models.catalog = () => [definition];
    const directory = models.directory("fixture");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "config.json"), data);
    assert.equal(await models.verify("fixture"), true);
    await fs.writeFile(path.join(directory, "config.json"), '{"unit":2}');
    await assert.rejects(models.verify("fixture"), /Integridad/);
    assert.equal(models.list()[0].verified, false);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runtime archives extract files first and then create only validated internal links", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-runtime-")),
    repo = new Repository(path.join(root, "data")),
    models = new Models(repo);
  try {
    const packageRoot = path.join(root, "package");
    await fs.mkdir(path.join(packageRoot, "pkg"), { recursive: true });
    await fs.writeFile(path.join(packageRoot, "pkg", "llama-mtmd-cli"), "#!/bin/sh\n", { mode: 0o755 });
    await fs.writeFile(path.join(packageRoot, "pkg", "libfoo.0.1.dylib"), "dylib");
    await fs.symlink("libfoo.0.1.dylib", path.join(packageRoot, "pkg", "libfoo.0.dylib"));
    await fs.symlink("libfoo.0.dylib", path.join(packageRoot, "pkg", "libfoo.dylib"));
    const archive = path.join(root, "runtime.tar.gz");
    await tar.c({ gzip: true, file: archive, cwd: packageRoot }, ["pkg"]);
    const bytes = await fs.readFile(archive),
      definition: CatalogModel = {
        id: "llama-runtime",
        repository: "fixture",
        revision: "unit",
        label: "Runtime fixture",
        task: "runtime",
        license: "MIT",
        files: [
          {
            path: "runtime.tar.gz",
            size: bytes.length,
            algorithm: "sha256",
            digest: createHash("sha256").update(bytes).digest("hex"),
          },
        ],
      };
    models.catalog = () => [definition];
    const directory = models.directory("llama-runtime");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "runtime.tar.gz"), bytes);
    await models.prepareRuntime();
    await fs.writeFile(path.join(directory, "verified.json"), JSON.stringify({ revision: "unit" }));
    const executable = await models.runtimeExecutable();
    assert.ok(executable.endsWith("llama-mtmd-cli"));
    const alias = path.join(directory, "bin", "pkg", "libfoo.dylib");
    assert.equal(await fs.readlink(alias), "libfoo.0.dylib");
    assert.equal(await fs.readFile(path.join(directory, "bin", "pkg", "libfoo.0.1.dylib"), "utf8"), "dylib");
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("runtime archives reject links that leave the extraction directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-runtime-escape-")),
    repo = new Repository(path.join(root, "data")),
    models = new Models(repo);
  try {
    const packageRoot = path.join(root, "package");
    await fs.mkdir(path.join(packageRoot, "pkg"), { recursive: true });
    await fs.writeFile(path.join(packageRoot, "pkg", "llama-mtmd-cli"), "#!/bin/sh\n", { mode: 0o755 });
    await fs.symlink("../../outside", path.join(packageRoot, "pkg", "escape"));
    const archive = path.join(root, "runtime.tar.gz");
    await tar.c({ gzip: true, file: archive, cwd: packageRoot }, ["pkg"]);
    const bytes = await fs.readFile(archive),
      definition: CatalogModel = {
        id: "llama-runtime",
        repository: "fixture",
        revision: "unit",
        label: "Runtime fixture",
        task: "runtime",
        license: "MIT",
        files: [
          {
            path: "runtime.tar.gz",
            size: bytes.length,
            algorithm: "sha256",
            digest: createHash("sha256").update(bytes).digest("hex"),
          },
        ],
      };
    models.catalog = () => [definition];
    const directory = models.directory("llama-runtime");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "runtime.tar.gz"), bytes);
    await assert.rejects(models.prepareRuntime(), /Enlace de runtime no permitido/);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

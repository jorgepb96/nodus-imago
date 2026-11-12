import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { ensureDiskSpace, DISK_RESERVE } from "../electron/storage/disk";
import { Archive } from "../electron/import/archive";
import { externalHttpsUrl } from "../shared/externalLinks";
import { validateCommand } from "../shared/validation";

test("archive preflight fails before extraction on insufficient disk and preserves existing paths", async (context) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "imago-disk-preflight-"),
  );
  let archive: Archive | undefined;
  try {
    const file = path.join(root, "fixture.zip"),
      zip = new AdmZip();
    zip.addFile("file.txt", Buffer.from("valid"));
    zip.writeZip(file);
    archive = await Archive.open(file);
    const mock = context.mock.method(fs, "statfs", async () => ({
      bsize: 1,
      bavail: 0,
    }));
    await assert.rejects(archive.preflight(root), /Espacio insuficiente/);
    const output = path.join(root, "output.txt");
    await assert.rejects(
      archive.extract("file.txt", output),
      /Espacio insuficiente/,
    );
    await assert.rejects(fs.stat(output), { code: "ENOENT" });
    mock.mock.restore();
    await fs.writeFile(output, "keep");
    await assert.rejects(archive.extract("file.txt", output), {
      code: "EEXIST",
    });
    assert.equal(await fs.readFile(output, "utf8"), "keep");
    await ensureDiskSpace(root, 3, (async () => ({
      bsize: 1,
      bavail: DISK_RESERVE + 4,
    })) as unknown as typeof fs.statfs);
  } finally {
    archive?.close();
    context.mock.restoreAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("external documents allow HTTPS only, without credentials, controls or renderer-chosen paths", () => {
  assert.equal(
    externalHttpsUrl("https://doi.org/10.1/test?q=hello#fragment"),
    "https://doi.org/10.1/test?q=hello#fragment",
  );
  for (const input of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "mailto:x@example.com",
    "http://example.com",
    "https://key@example.com",
    "https://example.com/\nfile",
    "not a url",
  ])
    assert.equal(externalHttpsUrl(input), null);
  assert.doesNotThrow(() =>
    validateCommand("openExternalLink", { url: "https://example.com" }),
  );
  assert.throws(() =>
    validateCommand("openExternalLink", {
      url: "https://example.com",
      file: "/tmp/anything",
    }),
  );
});

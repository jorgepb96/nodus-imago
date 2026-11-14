import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { appendMacIntelFeed, mergeUpdateFeeds } from "../scripts/merge-update-feeds.mjs";
import { load, dump } from "js-yaml";
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-feeds-")),
    input = path.join(root, "inputs"),
    output = path.join(root, "output");
  await fs.mkdir(input);
  for (const [target, suffixes, name] of [
    ["mac-arm", ["arm64.zip", "arm64.dmg"], "latest-mac.yml"],
    ["mac-x64", ["x64.zip", "x64.dmg"], "latest-mac.yml"],
    ["win", ["x64.exe"], "latest.yml"],
    [
      "linux",
      ["x86_64.AppImage", "amd64.deb", "x86_64.rpm"],
      "latest-linux.yml",
    ],
    [
      "linux-arm",
      ["arm64.AppImage", "arm64.deb", "aarch64.rpm"],
      "latest-linux-arm64.yml",
    ],
  ] as [string, string[], string][]) {
    const folder = path.join(input, target);
    await fs.mkdir(folder);
    const files = [];
    for (const suffix of suffixes) {
      const url = `Nodus-Imago-${target.startsWith("mac") ? "mac" : target.startsWith("win") ? "win" : "linux"}-${suffix}`,
        bytes = Buffer.from(url);
      await fs.writeFile(path.join(folder, url), bytes);
      files.push({
        url,
        sha512: createHash("sha512").update(bytes).digest("base64"),
        size: bytes.length,
      });
    }
    await fs.writeFile(
      path.join(folder, name),
      dump({ version: "0.2.0", files }),
    );
  }
  return { root, input, output };
}
test("release feeds validate all five targets and retain ARM first / ZIP compatibility pointer", async () => {
  const f = await fixture();
  try {
    const files = await mergeUpdateFeeds(f.input, f.output, "0.2.0");
    assert.equal(files.length, 4);
    const mac = load(
      await fs.readFile(path.join(f.output, "latest-mac.yml"), "utf8"),
    ) as any;
    assert.ok(mac.path.endsWith("-arm64.zip"));
    assert.equal(mac.files.length, 4);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
for (const fault of [
  "missing-intel",
  "bad-hash",
  "wrong-version",
  "missing-linux-arm",
])
  test(`feed assembly fails closed: ${fault}`, async () => {
    const f = await fixture();
    try {
      if (fault === "missing-intel")
        await fs.rm(path.join(f.input, "mac-x64"), { recursive: true });
      if (fault === "bad-hash")
        await fs.appendFile(
          path.join(f.input, "win", "Nodus-Imago-win-x64.exe"),
          "damage",
        );
      if (fault === "wrong-version") {
        const file = path.join(f.input, "win", "latest.yml");
        await fs.writeFile(
          file,
          (await fs.readFile(file, "utf8")).replace(
            "version: 0.2.0",
            "version: 9.0.0",
          ),
        );
      }
      if (fault === "missing-linux-arm")
        await fs.rm(path.join(f.input, "linux-arm"), { recursive: true });
      await assert.rejects(mergeUpdateFeeds(f.input, f.output, "0.2.0"));
    } finally {
      await fs.rm(f.root, { recursive: true, force: true });
    }
  });

test("a release can be prepared without Intel, and Intel appended to the published macOS feed later", async () => {
  const f = await fixture();
  try {
    // The draft without Intel.
    await fs.rm(path.join(f.input, "mac-x64"), { recursive: true });
    await assert.rejects(mergeUpdateFeeds(f.input, f.output, "0.2.0"), /Missing architecture\/package x64/);
    await mergeUpdateFeeds(f.input, f.output, "0.2.0", { macIntel: false });
    const publishedText = await fs.readFile(path.join(f.output, "latest-mac.yml"), "utf8");
    assert.deepEqual((load(publishedText) as any).files.map((x: any) => x.url), ["Nodus-Imago-mac-arm64.zip", "Nodus-Imago-mac-arm64.dmg"]);
    // The Intel build, made afterwards.
    const intelFolder = path.join(f.root, "intel");
    await fs.mkdir(intelFolder);
    const files = [];
    for (const url of ["Nodus-Imago-mac-x64.zip", "Nodus-Imago-mac-x64.dmg"]) {
      const bytes = Buffer.from("intel " + url);
      await fs.writeFile(path.join(intelFolder, url), bytes);
      files.push({ url, sha512: createHash("sha512").update(bytes).digest("base64"), size: bytes.length });
    }
    const intelText = dump({ version: "0.2.0", files, path: "Nodus-Imago-mac-x64.zip", sha512: files[0].sha512 });
    const merged = load(await appendMacIntelFeed(publishedText, intelText, intelFolder, "0.2.0")) as any;
    assert.deepEqual(merged.files.map((x: any) => x.url), ["Nodus-Imago-mac-arm64.zip", "Nodus-Imago-mac-arm64.dmg", "Nodus-Imago-mac-x64.zip", "Nodus-Imago-mac-x64.dmg"]);
    assert.equal(merged.path, "Nodus-Imago-mac-arm64.zip", "Apple silicon stays the compatibility pointer");
    // A retry replaces the Intel entries instead of duplicating them.
    const again = load(await appendMacIntelFeed(dump(merged), intelText, intelFolder, "0.2.0")) as any;
    assert.equal(again.files.length, 4);
    // Damaged or mismatched Intel files are refused.
    await fs.appendFile(path.join(intelFolder, "Nodus-Imago-mac-x64.dmg"), "damage");
    await assert.rejects(appendMacIntelFeed(publishedText, intelText, intelFolder, "0.2.0"), /checksum/);
    await assert.rejects(appendMacIntelFeed(publishedText, intelText, intelFolder, "0.3.0"), /version/);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

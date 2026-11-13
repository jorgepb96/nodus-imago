import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  Updates,
  compatibleUpdateAssets,
  type NativeUpdater,
} from "../electron/updates";
const pause = () => new Promise((r) => setTimeout(r, 5));
async function until(fn: () => boolean) {
  const end = Date.now() + 3000;
  while (!fn()) {
    if (Date.now() > end) throw Error("Update state timed out");
    await pause();
  }
}
class Driver extends EventEmitter implements NativeUpdater {
  channel: string | null = null;
  allowPrerelease = false;
  allowDowngrade = true;
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checks = 0;
  downloads = 0;
  installed = 0;
  version = "0.2.0";
  available = true;
  files: { url: string; sha512: string; size: number }[] = [];
  file = "";
  cancelled = 0;
  async checkForUpdates() {
    this.checks++;
    await pause();
    return {
      isUpdateAvailable: this.available,
      updateInfo: { version: this.version, files: this.files },
      cancellationToken: {
        cancel: () => {
          this.cancelled++;
        },
      },
    };
  }
  async downloadUpdate() {
    this.downloads++;
    this.emit("download-progress", { percent: 67 });
    this.emit("update-downloaded", {
      version: this.version,
      files: this.files,
      downloadedFile: this.file,
    });
    return [this.file];
  }
  quitAndInstall() {
    this.installed++;
  }
}
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-update-test-")),
    driver = new Driver(),
    events: string[] = [];
  driver.file = path.join(root, "update.zip");
  await fs.writeFile(driver.file, "non-installable test fixture");
  driver.files = [
    {
      url: "Nodus-Imago-0.2.0-arm64.zip",
      sha512: createHash("sha512")
        .update(await fs.readFile(driver.file))
        .digest("base64"),
      size: (await fs.stat(driver.file)).size,
    },
  ];
  const options = {
    userData: root,
    version: "0.1.0",
    packaged: true,
    disabled: false,
    platform: "darwin",
    arch: "arm64",
    changed: () => {},
    prepare: async () => {
      events.push("verified-backup");
    },
    finish: async (success: boolean) => {
      events.push(success ? "data-closed" : "unlock");
    },
    canInstall: async () => {
      events.push("permission-check");
    },
  };
  const manager = new Updates(driver, options);
  return {
    root,
    driver,
    events,
    options,
    manager,
    async close() {
      manager.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
test("update checks coalesce, verify bytes and require a backup/data-close gate before explicit installation", async () => {
  const f = await setup();
  try {
    await Promise.all([
      f.manager.check(),
      f.manager.check(),
      f.manager.check(),
    ]);
    await until(() => f.manager.status().status === "downloaded");
    assert.equal(f.driver.checks, 1);
    assert.equal(f.driver.downloads, 1);
    assert.equal(f.driver.installed, 0);
    assert.equal(f.driver.autoInstallOnAppQuit, false);
    f.driver.quitAndInstall = () => {
      f.events.push("native-install");
      f.driver.installed++;
    };
    await f.manager.install();
    assert.deepEqual(f.events, [
      "permission-check",
      "verified-backup",
      "data-closed",
      "native-install",
    ]);
    assert.equal(f.driver.installed, 1);
  } finally {
    await f.close();
  }
});
for (const version of ["0.0.9", "0.1.0", "0.2.0-beta.1", "not-semver"])
  test(`stable channel rejects ${version}`, async () => {
    const f = await setup();
    try {
      f.driver.version = version;
      await f.manager.check();
      assert.equal(f.driver.downloads, 0);
      assert.equal(f.manager.status().status, "not-available");
      assert.equal(f.driver.allowDowngrade, false);
    } finally {
      await f.close();
    }
  });
test("turning beta off discards a staged prerelease and prevents installation", async () => {
  const f = await setup();
  try {
    await f.manager.configure({
      automaticChecks: false,
      autoDownload: true,
      beta: true,
    });
    f.driver.version = "0.2.0-beta.1";
    await f.manager.check();
    await until(() => f.manager.status().status === "downloaded");
    await f.manager.configure({
      automaticChecks: false,
      autoDownload: true,
      beta: false,
    });
    await assert.rejects(f.manager.install());
    assert.equal(f.driver.installed, 0);
    assert.equal(f.driver.allowDowngrade, false);
    assert.ok(f.driver.cancelled >= 1);
  } finally {
    await f.close();
  }
});
test("a corrupted download is never ready to install", async () => {
  const f = await setup();
  try {
    await fs.writeFile(f.driver.file, "corrupt");
    await f.manager.check();
    await until(() => f.manager.status().status === "error");
    await assert.rejects(f.manager.install());
    assert.equal(f.driver.installed, 0);
  } finally {
    await f.close();
  }
});
test("tampering with a previously verified package invalidates the staged update", async () => {
  const f = await setup();
  try {
    await f.manager.check();
    await until(() => f.manager.status().status === "downloaded");
    await fs.writeFile(f.driver.file, "changed");
    await assert.rejects(f.manager.install(), /cambió/);
    assert.equal(f.driver.installed, 0);
    assert.deepEqual(f.events, ["permission-check"]);
  } finally {
    await f.close();
  }
});
test("failed backup blocks installation, releases the data lock and permits an explicit retry", async () => {
  const f = await setup();
  try {
    let fail = true;
    f.options.prepare = async () => {
      if (fail) throw Error("backup disk unavailable");
    };
    await f.manager.check();
    await until(() => f.manager.status().status === "downloaded");
    await assert.rejects(f.manager.install(), /disk/);
    assert.equal(f.driver.installed, 0);
    assert.ok(f.events.includes("unlock"));
    fail = false;
    await f.manager.check();
    await f.manager.install();
    assert.equal(f.driver.installed, 1);
  } finally {
    await f.close();
  }
});
test("a release rejected by the native updater is not shown as available just because it contains updateInfo", async () => {
  const f = await setup();
  try {
    f.driver.available = false;
    await f.manager.check();
    assert.equal(f.manager.status().status, "not-available");
    assert.equal(f.driver.downloads, 0);
  } finally {
    await f.close();
  }
});
test("development/disabled profiles never contact the update feed even when preferences change", async () => {
  const f = await setup();
  try {
    f.options.packaged = false;
    await f.manager.configure({
      automaticChecks: true,
      beta: true,
      autoDownload: true,
    });
    await f.manager.check();
    assert.equal(f.driver.checks, 0);
  } finally {
    await f.close();
  }
});
for (const [platform, arch, type, extension] of [
  ["darwin", "arm64", "", "zip"],
  ["darwin", "x64", "", "zip"],
  ["win32", "x64", "", "exe"],
  ["linux", "x64", "deb", "deb"],
  ["linux", "arm64", "rpm", "rpm"],
  ["linux", "arm64", "AppImage", "AppImage"],
])
  test(`update assets select ${platform}/${arch}/${type}`, () => {
    const hash = Buffer.alloc(64).toString("base64");
    const info = {
      version: "0.2.0",
      files: [
        { url: `Nodus-Imago-0.2.0-${arch}.${extension}`, sha512: hash },
        {
          url: `Nodus-Imago-0.2.0-${arch === "arm64" ? "x64" : "arm64"}.${extension}`,
          sha512: hash,
        },
        { url: "https://evil.invalid/not-an-imago.zip", sha512: hash },
      ],
    };
    assert.equal(compatibleUpdateAssets(info, platform, arch, type).length, 1);
  });

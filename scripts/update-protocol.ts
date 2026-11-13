// Actual electron-updater provider, Electron net and download/checksum machinery.
// The payload is explicitly non-installable: only the OS installation boundary is intercepted.
import { app } from "electron";
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Updates } from "../electron/updates";
const { BaseUpdater } = require("electron-updater/out/BaseUpdater");
const {
  ElectronHttpExecutor,
} = require("electron-updater/out/electronHttpExecutor");
const { findFile } = require("electron-updater/out/providers/Provider");
const root = path.resolve("test-results/update-protocol-" + Date.now());
mkdirSync(path.join(root,"electron-profile"),{recursive:true});
app.setPath("userData",path.join(root,"electron-profile"));
let mode = "valid";
const requests: string[] = [],
  events: string[] = [];
const bytes = Buffer.alloc(1024 * 1024, 73),
  digest = createHash("sha512").update(bytes).digest("base64");
const filename = `Nodus-Imago-0.2.0-${process.arch}.zip`;
const server = http.createServer((request, response) => {
  const url = new URL(request.url!, "http://localhost");
  requests.push(url.pathname);
  if (mode === "missing") {
    response.writeHead(404);
    response.end();
    return;
  }
  if (url.pathname.endsWith(".yml")) {
    response.setHeader("Content-Type", "text/yaml");
    response.end(
      `version: 0.2.0\nfiles:\n  - url: ${filename}\n    sha512: ${digest}\n    size: ${bytes.length}\npath: ${filename}\nsha512: ${digest}\n`,
    );
  } else if (url.pathname === "/" + filename) {
    const body = mode === "corrupt" ? Buffer.alloc(bytes.length, 4) : bytes;
    response.setHeader("Content-Length", body.length);
    response.end(body);
  } else {
    response.writeHead(404);
    response.end();
  }
});
async function until(check: () => boolean) {
  const end = Date.now() + 20000;
  while (!check()) {
    if (Date.now() > end) throw Error("Update protocol timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
class Transport extends BaseUpdater {
  constructor(folder: string, url: string) {
    const adapter = {
      version: "0.1.0",
      name: "imago-protocol-audit",
      isPackaged: true,
      appUpdateConfigPath: path.join(folder, "app-update.yml"),
      userDataPath: folder,
      baseCachePath: folder,
      whenReady: () => app.whenReady(),
      relaunch: () => {},
      quit: () => {},
      onQuit: () => {},
    };
    super(null, adapter);
    this.httpExecutor = new ElectronHttpExecutor();
    this.setFeedURL({ provider: "generic", url });
    this.logger = { info: () => {}, warn: () => {}, error: () => {} };
  }
  doDownloadUpdate(options: any) {
    const provider = options.updateInfoAndProvider.provider,
      fileInfo = findFile(
        provider.resolveFiles(options.updateInfoAndProvider.info),
        "zip",
      );
    return this.executeDownload({
      fileExtension: "zip",
      fileInfo,
      downloadUpdateOptions: options,
      task: async (file: string, downloadOptions: any) => {
        await this.httpExecutor.download(fileInfo.url, file, downloadOptions);
      },
    });
  }
  doInstall() {
    throw Error("OS installer must never execute in this audit");
  }
  quitAndInstall() {
    events.push("controlled-install-boundary");
  }
}
async function run() {
  await fs.mkdir(root, { recursive: true });
  await app.whenReady();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  let backupFailure = false;
  const checks: string[] = [];
  async function setup(name: string) {
    const folder = path.join(root, name);
    await fs.mkdir(folder);
    await fs.writeFile(
      path.join(folder, "app-update.yml"),
      "updaterCacheDirName: imago-test-cache\n",
    );
    const driver = new Transport(folder, `http://127.0.0.1:${port}/`);
    const manager = new Updates(driver as any, {
      userData: folder,
      version: "0.1.0",
      packaged: true,
      disabled: false,
      platform: "darwin",
      arch: process.arch,
      changed: () => {},
      canInstall: async () => {},
      prepare: async () => {
        events.push("backup-gate");
        if (backupFailure) throw Error("Backup unavailable");
      },
      finish: async (success) => {
        events.push(success ? "data-closed" : "unlock");
      },
    });
    return manager;
  }
  let manager = await setup("valid");
  await manager.check();
  await until(() => ["downloaded", "error"].includes(manager.status().status));
  assert.equal(manager.status().status, "downloaded", manager.status().message);
  assert.ok(requests.some((r) => r.endsWith(".yml")));
  assert.ok(requests.includes("/" + filename));
  assert.equal(events.length, 0);
  checks.push(
    "Real HTTP feed and 1 MiB download verified by electron-updater SHA-512 and Imago",
  );
  backupFailure = true;
  await assert.rejects(manager.install(), /Backup unavailable/);
  assert.equal(events.includes("controlled-install-boundary"), false);
  checks.push("Failed backup blocks installation boundary and unlocks storage");
  backupFailure = false;
  await manager.check();
  await manager.install();
  assert.deepEqual(events.slice(-3), [
    "backup-gate",
    "data-closed",
    "controlled-install-boundary",
  ]);
  checks.push(
    "Explicit successful handoff occurs after backup and data close only",
  );
  manager.close();
  mode = "corrupt";
  manager = await setup("corrupt");
  await manager.check();
  await until(() => manager.status().status === "error");
  await assert.rejects(manager.install());
  checks.push("Real transport rejects payload checksum mismatch");
  manager.close();
  mode = "missing";
  manager = await setup("missing");
  await manager.check();
  assert.equal(manager.status().status, "error");
  checks.push("Missing release feed is a visible recoverable error");
  manager.close();
  await fs.writeFile(
    path.join(root, "evidence.json"),
    JSON.stringify(
      {
        checks,
        requests,
        events,
        limit:
          "Synthetic non-installable payload. OS install/signature/notarization not exercised.",
      },
      null,
      2,
    ),
  );
  console.log("Update protocol passed", checks.length, root);
}
run().then(
  () => {
    server.close();
    app.exit(0);
  },
  async (error) => {
    console.error(error);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      path.join(root, "failure.json"),
      JSON.stringify({ error: String(error), requests, events }, null, 2),
    );
    server.close();
    app.exit(1);
  },
);

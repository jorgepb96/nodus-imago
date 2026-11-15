import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
// The preload is CommonJS so `node --require` can load it before electron-builder.
import stapler from "../scripts/macos-stapler-retry.cjs";

const { installStaplerRetries, retryStapler } = stapler as {
  installStaplerRetries: (options?: object) => unknown;
  retryStapler: <T>(fn: (...args: unknown[]) => T, options?: object) => (...args: unknown[]) => Promise<T>;
};
const load = createRequire(path.resolve("package.json"));
const lost = () =>
  new Error(
    'Failed to staple your application with code: 68\nError Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
  );
const quiet = () => {};

test("a lost Apple ticket connection is retried and the app is stapled", async () => {
  const delays: number[] = [];
  let calls = 0;
  const staple = retryStapler(
    () => {
      if (++calls < 3) throw lost();
      return "stapled";
    },
    { sleep: async (ms: number) => void delays.push(ms), log: quiet },
  );
  assert.equal(await staple({ appPath: "/tmp/Nodus Imago.app" }), "stapled");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [15_000, 30_000]);
});

test("missing or invalid tickets and unrelated failures stop at once", async () => {
  for (const error of [
    new Error("Failed to staple your application with code: 65\nRecord not found"),
    new Error("Failed to staple your application with code: 68\nInvalid ticket"),
    new Error("Notarization status: Invalid"),
    new Error("The network connection was lost."),
  ]) {
    let calls = 0;
    const staple = retryStapler(
      () => {
        calls += 1;
        throw error;
      },
      { sleep: async () => assert.fail("permanent errors must not wait"), log: quiet },
    );
    await assert.rejects(staple(), (actual) => actual === error);
    assert.equal(calls, 1);
  }
});

test("a lasting Apple outage exhausts bounded retries and fails", async () => {
  const error = lost();
  const delays: number[] = [];
  let calls = 0;
  const staple = retryStapler(
    () => {
      calls += 1;
      throw error;
    },
    { sleep: async (ms: number) => void delays.push(ms), log: quiet },
  );
  await assert.rejects(staple(), (actual) => actual === error);
  assert.equal(calls, 6);
  assert.deepEqual(delays, [15_000, 30_000, 60_000, 120_000, 120_000]);
});

test("the pinned notarize package retries stapling without resubmitting", async () => {
  const folder = path.dirname(load.resolve("@electron/notarize"));
  const signature = load(path.join(folder, "check-signature.js"));
  const notary = load(path.join(folder, "notarytool.js"));
  const spawn = load(path.join(folder, "spawn.js"));
  const staple = load(path.join(folder, "staple.js"));
  const original = {
    check: signature.checkSignatures,
    available: notary.isNotaryToolAvailable,
    submit: notary.notarizeAndWaitForNotaryTool,
    spawn: spawn.spawn,
    staple: staple.stapleApp,
  };
  let submissions = 0;
  let downloads = 0;
  const delays: number[] = [];
  try {
    signature.checkSignatures = async () => {};
    notary.isNotaryToolAvailable = async () => true;
    notary.notarizeAndWaitForNotaryTool = async () => {
      submissions += 1;
    };
    spawn.spawn = async (command: string, args: string[]) => {
      assert.equal(command, "xcrun");
      assert.deepEqual(args, ["stapler", "staple", "-v", "Nodus Imago.app"]);
      downloads += 1;
      return downloads === 1
        ? { code: 68, output: "The network connection was lost." }
        : { code: 0, output: "The staple action worked!" };
    };
    const installed = installStaplerRetries({
      sleep: async (ms: number) => void delays.push(ms),
      log: quiet,
    });
    assert.equal(installStaplerRetries(), installed, "installing twice must not nest retries");
    await load("@electron/notarize").notarize({ appPath: "/tmp/Nodus Imago.app" });
    assert.equal(submissions, 1);
    assert.equal(downloads, 2);
    assert.deepEqual(delays, [15_000]);
  } finally {
    signature.checkSignatures = original.check;
    notary.isNotaryToolAvailable = original.available;
    notary.notarizeAndWaitForNotaryTool = original.submit;
    spawn.spawn = original.spawn;
    staple.stapleApp = original.staple;
  }
});

test("both macOS release workflows preload the stapling retries", () => {
  for (const file of ["release-draft.yml", "release-macos-intel.yml"]) {
    const workflow = fs.readFileSync(path.join(".github/workflows", file), "utf8");
    assert.match(workflow, /IMAGO_RETRY_MACOS_STAPLING: "1"/, file);
    assert.match(
      workflow,
      /node --require "\$GITHUB_WORKSPACE\/scripts\/macos-stapler-retry\.cjs" node_modules\/electron-builder\/cli\.js/,
      file,
    );
  }
});

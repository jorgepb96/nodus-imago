import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { launchNative, waitNativeJob } from "./native-test-support.mjs";
const installation = JSON.parse(
  await fs.readFile("test-results/v1-onboarding-e2e.json", "utf8"),
);
const { app, call } = await launchNative(installation.profile);
const initial = (await call("status")).settings;
try {
  const before = await call("status");
  if (initial.embeddingModel === "embeddinggemma2-onnx") {
    const dimensions = initial.dimensions === 512 ? 256 : 512;
    await call("updateSettings", { dimensions });
    const migrated = await call("status");
    assert.equal(migrated.indexed, 0);
    assert.ok((await call("modelPreparation")).priorVectors >= before.indexed);
    assert.equal(
      (await call("search", { mode: "literal", query: "Red square" })).total,
      1,
    );
    const job = await call("indexImages", {});
    await waitNativeJob(call, job);
    assert.equal((await call("status")).indexed, before.indexed);
    assert.ok((await call("modelPreparation")).priorVectors >= before.indexed);
    assert.equal(
      (
        await call("search", {
          mode: "semantic",
          query: "a geometric red shape",
        })
      ).rows.length,
      2,
    );
    await call("updateSettings", { dimensions: initial.dimensions });
    assert.equal((await call("status")).indexed, before.indexed);
    await fs.writeFile(
      "test-results/v1-migration-e2e.json",
      JSON.stringify(
        {
          passed: true,
          platform: process.platform,
          arch: process.arch,
          checks: [
            "Distinct active contract starts empty; previous vectors retained",
            "Literal works during migration",
            "Actual reindex, semantic retrieval and return to previous contract",
          ],
          simulatedInference: false,
        },
        null,
        2,
      ),
    );
  } else {
    // Harrier is fixed at 1024; its separate protocol is covered by the shared
    // contract tests. Never force an unsupported ONNX runtime on Intel.
    await fs.writeFile(
      "test-results/v1-migration-e2e.json",
      JSON.stringify(
        {
          platform: process.platform,
          arch: process.arch,
          dimensionMigration: "not applicable to fixed-1024 Harrier",
          contractTests: "tests/embeddingBackends.test.ts",
        },
        null,
        2,
      ),
    );
  }
} finally {
  await call("updateSettings", { dimensions: initial.dimensions }).catch(
    () => {},
  );
  await app.close();
}

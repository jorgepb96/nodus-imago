// Real CPU parity audit. Run only in the final validation; weights are never fetched here.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { Repository } from "../electron/db/repository";
import { Models } from "../electron/ai/models";
import { InferenceHost } from "../electron/ai/host";
import { Engine } from "../electron/ai/engine";
import { OnnxHost } from "../electron/ai/onnxHost";
import { ONNX_ID, LEGACY_EMBEDDING_ID } from "../shared/embeddingBackends";

async function main() {
  const legacyStore = JSON.parse(
    await fs.readFile("test-results/model-store.json", "utf8"),
  ).root;
  const nativeRoot = process.env.IMAGO_ONNX_MODEL_ROOT;
  if (!nativeRoot)
    throw new Error(
      "Set IMAGO_ONNX_MODEL_ROOT to the isolated ONNX collection; downloads require the manager consent flow.",
    );
  const output = path.resolve("test-results/onnx-parity-" + Date.now());
  await fs.mkdir(output, { recursive: true });
  const repo = new Repository(output),
    models = new Models(repo),
    host = new InferenceHost(repo, path.resolve("runtime/inference.py"));
  const engine = new Engine(repo, models, host);
  engine.onnx = new OnnxHost(path.resolve("dist-electron/ai/onnxWorker.cjs"));
  const result: any = {
    date: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    thresholds: { cosine: 0.95, normAbsoluteError: 1e-5 },
    samples: [],
    source:
      "Real ONNX Q8 and PyTorch FP32, CPU, same prepared images and task prefixes",
    qualityBenchmark: false,
  };
  try {
    for (const [id, source] of [
      [LEGACY_EMBEDDING_ID, legacyStore],
      [ONNX_ID, nativeRoot],
    ]) {
      const model = models.get(id),
        destination = models.directory(id);
      for (const file of model.files) {
        const target = path.join(destination, file.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.link(
          path.join(source, "models", id, model.revision, file.path),
          target,
        );
      }
      await models.verify(id);
    }
    repo.updateSettings({
      python: path.resolve(".venv/bin/python"),
      device: "cpu",
      profile: "balanced",
    });
    const inputs = [
      { text: "un puente rojo sobre el mar", role: "query" },
      { text: "A red bridge crossing the sea.", role: "document" },
      {
        text: "Un interior con muebles y objetos domésticos.",
        role: "document",
      },
      { image: path.resolve("test-results/model-fixtures/GoldenGate.png") },
      {
        image: path.resolve("test-results/model-fixtures/kitchen_painting.jpg"),
      },
    ];
    for (const dimensions of [256, 512, 768] as const) {
      repo.updateSettings({ embeddingModel: LEGACY_EMBEDDING_ID, dimensions });
      const legacyContract = engine.contract();
      const beforePython = performance.now(),
        legacy = await engine.embed(inputs);
      const pythonMs = performance.now() - beforePython;
      host.close();
      repo.updateSettings({ embeddingModel: ONNX_ID, dimensions });
      const onnxContract = engine.contract();
      assert.notEqual(onnxContract, legacyContract);
      const beforeOnnx = performance.now(),
        onnx = await engine.embed(inputs);
      const onnxMs = performance.now() - beforeOnnx;
      const cosines = legacy.map((vector, i) =>
        vector.reduce((sum, value, j) => sum + value * onnx[i][j], 0),
      );
      for (const vector of [...legacy, ...onnx])
        assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-5);
      assert.ok(
        cosines.every((cosine) => cosine >= 0.95),
        "Inspect processor/tokenizer differences before changing the declared cosine threshold: " +
          cosines,
      );
      const nearest = (vectors: number[][], query: number) =>
        vectors
          .map((v, index) => ({
            index,
            score: v.reduce((s, x, j) => s + x * vectors[query][j], 0),
          }))
          .sort((a, b) => b.score - a.score)[0].index;
      for (const query of [3, 4]) {
        assert.equal(nearest(legacy, query), query);
        assert.equal(nearest(onnx, query), query);
      }
      result.samples.push({
        dimensions,
        cosines,
        pythonMs,
        onnxMs,
        legacyContract,
        onnxContract,
        selfRetrieval: [3, 4],
      });
    }
    result.passed = true;
    await fs.writeFile(
      "test-results/v1-onnx-parity.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await engine.resetRuntimes();
    host.close();
    repo.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

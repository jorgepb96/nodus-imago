import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Repository } from "../electron/db/repository";
import { matchImages } from "../shared/imageMatching";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-bench-")),
  repo = new Repository(root);
try {
  const rows = Array.from({ length: 10000 }, (_, i) => [
    "IMG" + String(i).padStart(5, "0"),
    `Fuente visual ${i} ${i % 2 ? "arquitectura rural" : "retrato familiar"}`,
    i % 2 ? "Patrimonio, Paisaje" : "Retratos, Costumbres",
    String(1900 + (i % 100)),
  ]);
  const start = performance.now(),
    detail = repo.importCsv(
      "Corpus de prueba",
      ["ID", "Descripción", "Categorías", "Año"],
      ["title", "text", "multi_select", "number"],
      rows,
    ),
    importMs = performance.now() - start;
  const durations: number[] = [];
  for (let i = 0; i < 30; i++) {
    const at = performance.now();
    repo.literal({
      query: i % 2 ? "rural" : "familiar",
      databaseIds: [detail.database.id],
      offset: i * 100,
      limit: 100,
    });
    durations.push(performance.now() - at);
  }
  const refs = repo.db
    .prepare(
      "SELECT row_id rowId,value_text refValue FROM db_cells WHERE column_id=?",
    )
    .all(detail.columns[0].id) as { rowId: string; refValue: string }[];
  const matchStart = performance.now(),
    matches = matchImages(
      rows.map((r, i) => ({ token: String(i), name: r[0] + ".jpg" })),
      refs,
    ),
    matchingMs = performance.now() - matchStart;
  const dims = 512,
    query = new Float32Array(dims).fill(1 / Math.sqrt(dims));
  const vectors = Array.from({ length: 10000 }, (_, i) =>
    new Float32Array(dims).fill(i % 2 ? 0.04 : 0.02),
  );
  const vectorStart = performance.now();
  let checksum = 0;
  for (const vector of vectors) {
    let score = 0;
    for (let i = 0; i < dims; i++) score += vector[i] * query[i];
    checksum += score;
  }
  const vectorMs = performance.now() - vectorStart;
  durations.sort((a, b) => a - b);
  const report = {
    date: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0].model,
    totalMemoryGB: Math.round(os.totalmem() / 2 ** 30),
    node: process.versions.node,
    electron: process.versions.electron,
    records: 10000,
    importCsvAndFtsMs: Math.round(importMs),
    literalPage100MedianMs: Math.round(durations[15]),
    literalPage100P95Ms: Math.round(durations[28]),
    matching10000Ms: Math.round(matchingMs),
    safeMatches: matches.filter((m) => m.status === "safe").length,
    vectorDotProducts10000x512Ms: Math.round(vectorMs),
    peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    checksum,
    scope:
      "Synthetic structured records and synthetic vectors; no model inference and no real-photo corpus. Vector timing excludes SQL reads, filtering and ranking.",
  };
  fs.mkdirSync("docs/benchmarks", { recursive: true });
  fs.writeFileSync(
    "docs/benchmarks/local.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  repo.close();
  fs.rmSync(root, { recursive: true, force: true });
}

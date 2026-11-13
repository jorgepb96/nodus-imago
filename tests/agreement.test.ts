// Prepared for the joint review; execution is deferred at the user's request.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { AgreementResearch } from "../electron/research/agreement";
import {
  calculateAgreement,
  defaultAgreementConfig,
} from "../shared/agreement";
import type { AgreementSnapshot } from "../shared/agreement";
import { agreementCsv } from "../shared/agreementExport";
import { validateCommand } from "../shared/validation";
import { writeBackup, restoreBackup } from "../electron/export/backup";
import AdmZip from "adm-zip";
import Database from "better-sqlite3";

function fixture(values: (string | null)[][]): AgreementSnapshot {
  const ids = values[0]?.map((_, i) => `c${i}`) ?? ["c0", "c1"];
  return {
    format: "nodus.imago.agreement/1",
    database: { id: "db", name: "Corpus" },
    createdAt: "2026-11-12T12:00:00Z",
    input: {
      databaseId: "db",
      config: {
        ...defaultAgreementConfig(),
        raters: ids.map((columnId) => ({
          columnId,
          label: columnId,
          model: "",
          prompt: "",
        })),
      },
    },
    columns: ids.map((id, position) => ({
      id,
      databaseId: "db",
      name: id,
      type: "text",
      position,
      config: {},
      options: [],
    })),
    rows: values.map((row, i) => ({
      id: `r${i}`,
      title: `Image ${i}`,
      updatedAt: "2026-11-12T12:00:00Z",
      image: null,
      imageCount: 1,
      cells: Object.fromEntries(ids.map((id, j) => [id, row[j]])),
    })),
    matched: values.length,
    provenance: [],
  };
}
const close = (actual: number | null, expected: number) =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) < 1e-10,
    `${actual} ≠ ${expected}`,
  );

test("Cohen reproduces the sklearn worked example with rater-specific marginals", () => {
  const snapshot = fixture([
    ["negative", "negative"],
    ["positive", "positive"],
    ["negative", "negative"],
    ["neutral", "neutral"],
    ["positive", "negative"],
  ]);
  const report = calculateAgreement(snapshot);
  close(report.pairs[0].kappa.value, 0.6875);
  close(report.pairs[0].exact.value, 0.8);
  assert.equal(report.pairs[0].n, 5);
});
test("Fleiss and nominal alpha retain their distinct finite-sample chance models", () => {
  const report = calculateAgreement(
    fixture([
      ["a", "a", "a"],
      ["a", "a", "b"],
      ["b", "b", "a"],
      ["b", "b", "b"],
    ]),
  );
  close(report.models.fleiss.value, 1 / 3);
  close(report.models.alpha.value, 7 / 18);
  close(report.models.unanimity.value, 0.5);
  assert.equal(report.models.alphaUnits, 4);
  assert.equal(report.models.alphaRatings, 12);
});
test("alpha excludes singleton units and weights incomplete units correctly", () => {
  const snapshot = fixture([
    ["a", "a", "b"],
    ["b", "b", null],
    ["unpaired", null, null],
  ]);
  const report = calculateAgreement(snapshot);
  close(report.models.alpha.value, 1 / 3);
  assert.equal(report.models.alphaUnits, 2);
  assert.equal(report.models.alphaRatings, 5);
  assert.equal(report.models.fleiss.value, null);
  snapshot.input.config.cohort = "complete";
  const complete = calculateAgreement(snapshot);
  assert.equal(complete.models.alpha.value, null);
  assert.equal(complete.pairs[0].n, 1);
});
test("human comparisons use complete common cases, strict majorities and explicit denominators", () => {
  const snapshot = fixture([
    ["a", "a", "a", "a"],
    ["b", "b", "b", "a"],
    ["a", "b", "c", "c"],
    ["a", null, "b", "a"],
  ]);
  snapshot.input.config.raters.pop();
  snapshot.input.config.referenceId = "c3";
  const report = calculateAgreement(snapshot);
  assert.equal(report.models.unanimity.count, 2);
  assert.equal(report.models.unanimity.n, 3);
  assert.equal(report.human!.any.count, 2);
  assert.equal(report.human!.any.n, 3);
  assert.equal(report.human!.all.count, 1);
  assert.equal(report.human!.majority.count, 1);
  assert.equal(report.human!.majority.n, 2);
  assert.equal(report.human!.noMajority, 1);
  assert.equal(report.human!.unanimousDifferent, 1);
  assert.equal(report.pairs.find((p) => p.a === "c3" && p.b === "c0")!.n, 4);
});
test("select columns compare labels instead of unrelated UUIDs and report deleted options", () => {
  const snapshot = fixture([
    ["a1", "a2"],
    ["b1", "b2"],
    ["deleted", "a2"],
  ]);
  snapshot.columns.forEach((column, i) => {
    column.type = "select";
    column.options = ["a", "b"].map((label, position) => ({
      id: `${label}${i + 1}`,
      columnId: column.id,
      label,
      color: null,
      position,
    }));
  });
  const report = calculateAgreement(snapshot);
  assert.equal(report.pairs[0].exact.count, 2);
  assert.equal(report.pairs[0].n, 2);
  assert.equal(report.coverage[0].invalid, 1);
  close(report.pairs[0].kappa.value, 1);
});
test("normalization preserves accents and explicit aliases are single-pass and nonmutating", () => {
  const snapshot = fixture([
    ["  Patrimonio   Artístico ", "patrimonio artístico"],
    ["ano", "año"],
    ["HERITAGE", "patrimonio artístico"],
  ]);
  snapshot.input.config.aliases = [
    { columnId: "c0", from: "heritage", to: "patrimonio artístico" },
    { columnId: "c0", from: "patrimonio artístico", to: "otro" },
  ];
  const original = JSON.stringify(snapshot);
  const report = calculateAgreement(snapshot);
  assert.equal(report.rows[0].judgments.c0.labels![0], "otro");
  assert.equal(report.rows[2].judgments.c0.labels![0], "patrimonio artístico");
  assert.equal(report.rows[1].modelDisagreement, true);
  assert.equal(JSON.stringify(snapshot), original);
});
test("multilabel compares unordered sets, averages Jaccard and uses binary category kappas", () => {
  const snapshot = fixture([
    ["a;b", "b;a"],
    ["a", "b"],
    ["a", "a;b"],
    [null, null],
  ]);
  snapshot.input.config.mode = "multilabel";
  const report = calculateAgreement(snapshot),
    p = report.pairs[0];
  assert.equal(p.n, 3);
  assert.equal(p.exact.count, 1);
  close(p.jaccard, 0.5);
  assert.equal(p.kappa.value, null);
  assert.equal(report.models.fleiss.value, null);
  const a = p.classes.find((c) => c.label === "a")!;
  assert.equal(a.a, 3);
  assert.equal(a.b, 2);
  assert.equal(a.both, 2);
  close(a.precision, 1);
  close(a.recall, 2 / 3);
  close(a.f1, 0.8);
  close(a.kappa.value, 0);
});
test("missing data is not agreement, explicit empty multisets require opt-in and unknown IDs are invalid", () => {
  const snapshot = fixture([
    ["[]", "[]"],
    [null, null],
    ['["a","b"]', '["b","a"]'],
    ['["bad"]', "[]"],
  ]);
  snapshot.columns.forEach((c) => {
    c.type = "multi_select";
    c.options = ["a", "b"].map((label, position) => ({
      id: label,
      columnId: c.id,
      label,
      color: null,
      position,
    }));
  });
  snapshot.input.config.mode = "multilabel";
  assert.equal(calculateAgreement(snapshot).pairs[0].n, 1);
  snapshot.input.config.emptySetValid = true;
  const report = calculateAgreement(snapshot);
  assert.equal(report.pairs[0].n, 2);
  close(report.pairs[0].jaccard, 1);
  assert.equal(report.coverage[0].missing, 1);
  assert.equal(report.coverage[0].invalid, 1);
  snapshot.input.config.mode = "nominal";
  assert.equal(calculateAgreement(snapshot).coverage[0].invalid, 2);
});
test("ordinal weights use a declared order and constant labels never get a fake perfect kappa", () => {
  const snapshot = fixture([
    ["0", "0"],
    ["0", "1"],
    ["1", "1"],
    ["1", "2"],
    ["2", "2"],
  ]);
  snapshot.input.config.categoryOrder = ["0", "1", "2"];
  snapshot.input.config.weight = "linear";
  close(calculateAgreement(snapshot).pairs[0].weightedKappa.value, 6 / 11);
  snapshot.input.config.weight = "quadratic";
  close(calculateAgreement(snapshot).pairs[0].weightedKappa.value, 0.6875);
  snapshot.input.config.categoryOrder.pop();
  assert.equal(calculateAgreement(snapshot).pairs[0].weightedKappa.value, null);
  const constant = calculateAgreement(
    fixture([
      ["a", "a"],
      ["a", "a"],
    ]),
  );
  close(constant.pairs[0].exact.value, 1);
  assert.equal(constant.pairs[0].kappa.value, null);
  assert.equal(constant.models.alpha.value, null);
});
test("CSV preserves denominators and snapshot metadata and protects formula-like text", () => {
  const snapshot = fixture([
    ["=1+1", "a"],
    ["b", "a"],
  ]);
  const csv = agreementCsv(snapshot, calculateAgreement(snapshot));
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("'=1+1"));
  assert.ok(csv.includes('"denominator"'));
  assert.ok(csv.includes('"input_json"'));
  assert.ok(csv.includes('"raw_record"'));
});
test("research reads the whole filtered database, preserves snapshots, exports and isolates deleted sources", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-agreement-")),
    repo = new Repository(root),
    research = new AgreementResearch(repo);
  try {
    const db = repo.create("Corpus"),
      a = repo.addColumn(db.database.id, "Modelo A", "text"),
      b = repo.addColumn(db.database.id, "Humano", "text");
    const rows = repo.createRows(db.database.id, 237);
    repo.db.transaction(() =>
      rows.forEach((id, i) => {
        repo.setCell(id, a.id, i % 2 ? "a" : "b");
        repo.setCell(id, b.id, "a");
      }),
    )();
    const config = {
      ...defaultAgreementConfig(),
      raters: [
        {
          columnId: a.id,
          label: "Modelo A",
          model: "local/model",
          prompt: "Classify",
        },
      ],
      referenceId: b.id,
    };
    const result = research.run({ databaseId: db.database.id, config });
    assert.equal(result.report.total, 237);
    assert.equal(result.report.pairs[0].n, 237);
    const saved = research.save(result.token, "Prueba 1");
    repo.setCell(rows[0], a.id, "edited");
    assert.equal(research.load(saved.id).snapshot.rows[0].cells[a.id], "b");
    const filtered = research.run({
      databaseId: db.database.id,
      config,
      filters: [{ columnId: a.id, op: "equals", value: "a" }],
    });
    assert.equal(filtered.report.total, 118);
    assert.ok(filtered.snapshot.rows.some((r) => r.id === rows.at(-2)));
    const file = path.join(root, "agreement.json");
    await research.export(result.token, "json", file);
    const exported = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(exported.results.total, 237);
    assert.throws(
      () =>
        research.run({
          databaseId: db.database.id,
          config: { ...config, referenceId: a.id },
        }),
      /diferentes/,
    );
    const other = repo.create("Other"),
      foreign = repo.addColumn(other.database.id, "Foreign", "text");
    assert.throws(
      () =>
        research.run({
          databaseId: db.database.id,
          config: { ...config, referenceId: foreign.id },
        }),
      /esta base/,
    );
    repo.deleteColumn(a.id);
    assert.equal(research.load(saved.id).report.total, 237);
    research.delete(saved.id);
    assert.equal(research.list(db.database.id).length, 0);
    assert.throws(() => research.load(saved.id), /no encontrado/);
  } finally {
    repo.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("research IPC rejects nested extras, excessive raters and renderer-provided file paths", () => {
  const snapshot = fixture([["a", "b"]]);
  assert.doesNotThrow(() => validateCommand("agreementRun", snapshot.input));
  assert.throws(() =>
    validateCommand("agreementRun", {
      ...snapshot.input,
      config: { ...snapshot.input.config, download: true },
    }),
  );
  assert.throws(() =>
    validateCommand("agreementExport", {
      token: "x",
      format: "json",
      file: "/tmp/injected",
    }),
  );
  assert.throws(() =>
    validateCommand("agreementRun", {
      ...snapshot.input,
      config: {
        ...snapshot.input.config,
        raters: Array(9).fill(snapshot.input.config.raters[0]),
      },
    }),
  );
});

test("research snapshots survive native backup and old v1 backups without the optional table still restore", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-agreement-backup-"));
  const source = new Repository(path.join(root, "source")), target = new Repository(path.join(root, "target")), legacy = new Repository(path.join(root, "legacy"));
  try {
    const db = source.create("Corpus"), a = source.addColumn(db.database.id, "Modelo", "text"), b = source.addColumn(db.database.id, "Humano", "text");
    const row = source.createRow(db.database.id); source.setCell(row.id, a.id, "a"); source.setCell(row.id, b.id, "b");
    const research = new AgreementResearch(source), run = research.run({ databaseId: db.database.id, config: { ...defaultAgreementConfig(), raters: [{ columnId: a.id, label: "Modelo", model: "v1", prompt: "Historical images" }], referenceId: b.id } });
    const saved = research.save(run.token, "Ensayo original");
    const backup = path.join(root, "backup.imago"); await writeBackup(source, backup); await restoreBackup(target, backup);
    const restored = new AgreementResearch(target).load(saved.id); assert.deepEqual(restored.snapshot, run.snapshot); assert.deepEqual(restored.report, run.report);
    const zip = new AdmZip(backup), snapshotPath = path.join(root, "legacy.sqlite"); fs.writeFileSync(snapshotPath, zip.readFile("imago.sqlite")!);
    const old = new Database(snapshotPath); old.exec("DROP TABLE agreement_experiments"); old.close(); zip.updateFile("imago.sqlite", fs.readFileSync(snapshotPath));
    const legacyManifest=JSON.parse(zip.readAsText("manifest.json"));delete legacyManifest.databaseHash;zip.updateFile("manifest.json",Buffer.from(JSON.stringify(legacyManifest)));
    const oldBackup = path.join(root, "old.imago"); zip.writeZip(oldBackup); await restoreBackup(legacy, oldBackup);
    assert.equal(legacy.stats().rows, 1); assert.equal(new AgreementResearch(legacy).list(db.database.id).length, 0);
    target.db.prepare("DELETE FROM db_databases WHERE id=?").run(db.database.id);
    assert.equal((target.db.prepare("SELECT count(*) n FROM agreement_experiments").get() as {n:number}).n, 0);
  } finally { source.close(); target.close(); legacy.close(); fs.rmSync(root, { recursive:true, force:true }); }
});

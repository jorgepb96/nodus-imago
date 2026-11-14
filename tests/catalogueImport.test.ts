// Regressions in importing and searching a large photographic catalogue
// exported from a notes app (multi-select tags, "-" placeholders, large
// place vocabularies, several model classifications per image).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository, ftsExpression, snippetAround, recordTextHash } from "../electron/db/repository";
import { Models } from "../electron/ai/models";
import { InferenceHost } from "../electron/ai/host";
import { Engine } from "../electron/ai/engine";
import { JobQueue } from "../electron/jobs";
import { Images } from "../electron/import/images";
import { buildCsvImportPlan, suggestColumn } from "../shared/databaseCsv";
import { decodeMultiSelect } from "../shared/databases";
import { calculateAgreement, defaultAgreementConfig } from "../shared/agreement";
import type { AgreementSnapshot } from "../shared/agreement";
import { recordEmbeddingText } from "../shared/recordEmbedding";
import { fuseRankLists } from "../shared/vectors";

const repeat = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

test("tag columns where only a minority of cells hold several labels are multi-select", () => {
  // A few sources hold two labels ("A,B"): a select would create a fused option.
  const sources = ["Colección A", "Internet Archive", "Colección B", "Otras", "Biblioteca Nacional"];
  const values = [
    ...repeat(900, (i) => sources[i % 5]),
    ...repeat(20, () => "Biblioteca Nacional,Colección B"),
  ];
  assert.equal(suggestColumn("Fuente", values, 3).type, "multi_select");
  // A large vocabulary of heritage sites, mostly one per cell, some with two.
  const sites = repeat(400, (i) => `Monumento ${i} - Ciudad ${i % 40}`);
  const heritage = [
    ...repeat(3000, (i) => sites[i % 400]),
    ...repeat(200, (i) => `${sites[i % 400]}, ${sites[(i * 7) % 400]}`),
    ...repeat(3000, () => "-"),
  ];
  const suggestion = suggestColumn("Lugares", heritage, 5);
  assert.equal(suggestion.type, "multi_select");
  assert.equal(suggestion.nullMarkers, 3000);
  assert.equal(suggestion.options, 400);
});

test("prose and titles with commas stay text; large repeated vocabularies become selects", () => {
  const prose = repeat(500, (i) => `La imagen muestra una calle, con casas blancas y, al fondo, la sierra número ${i}`);
  assert.equal(suggestColumn("Comentario", prose, 2).type, "text");
  const titles = [
    ...repeat(300, (i) => `Granada, vista ${i}`),
    ...repeat(300, (i) => `Toledo ${i}`),
  ];
  assert.equal(suggestColumn("Titulo", titles, 2).type, "text");
  const places = repeat(6000, (i) => `Lugar ${i % 600}`);
  const place = suggestColumn("Lugar", places, 2);
  assert.equal(place.type, "select");
  assert.equal(place.reason, "Lista amplia de valores que se repiten");
  // Unique identifiers are never a vocabulary.
  assert.equal(suggestColumn("Archivo", repeat(6000, (i) => `img/${i}.jpg`), 1).type, "text");
});

test("placeholders never stop the suggested import and can become empty cells", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-catalogue-")),
    repo = new Repository(root);
  try {
    const csv = [
      ["ID", "Fecha", "Tema", "Temas"],
      ...repeat(40, (i) => [`R${i}`, i % 10 === 0 ? "s.d." : String(1950 + (i % 9)), i % 5 === 0 ? "-" : ["Paisaje", "Patrimonio"][i % 2], i % 3 === 0 ? "-" : "A1 Monumentos, B4 Animales"]),
    ];
    const plan = buildCsvImportPlan(csv);
    assert.deepEqual(plan.suggestedTypes, ["title", "number", "select", "multi_select"]);
    // Kept verbatim in text-like columns, but never fatal in a number column.
    const kept = repo.importCsv("Verbatim", plan.headers, plan.suggestedTypes, plan.rows);
    assert.ok(kept.columns[2].options.some((o) => o.label === "-"));
    const d = repo.importCsv("Clean", plan.headers, plan.suggestedTypes, plan.rows, { nullMarkersAsEmpty: true });
    const [, year, theme, tags] = d.columns;
    assert.deepEqual(theme.options.map((o) => o.label).sort(), ["Paisaje", "Patrimonio"]);
    assert.deepEqual(tags.options.map((o) => o.label), ["A1 Monumentos", "B4 Animales"]);
    assert.notEqual(theme.options[0].color, theme.options[1].color);
    const rows = repo.literal({ databaseIds: [d.database.id], limit: 100 }).rows;
    assert.equal(rows[0].cells[year.id] ?? null, null);
    assert.equal(rows[0].cells[theme.id] ?? null, null);
    assert.equal(decodeMultiSelect(rows[0].cells[tags.id] ?? null).length, 0);
    assert.equal(decodeMultiSelect(rows[1].cells[tags.id] ?? null).length, 2);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("agreement can read placeholders as missing judgments", () => {
  const column = (id: string) => ({
    id, databaseId: "d", name: id, type: "text" as const, position: 0, config: {}, options: [],
  });
  const columns = [column("human"), column("model")];
  const rows = [
    ["Paisaje", "Paisaje"],
    ["Retrato", "Retrato"],
    ["Paisaje", "-"],
    ["Retrato", "-"],
  ].map(([human, model], i) => ({
    id: "r" + i, title: "r" + i, updatedAt: "", imageCount: 0, image: null, cells: { human, model },
  }));
  const base = { ...defaultAgreementConfig(), raters: [{ columnId: "model", label: "m", model: "m", prompt: "" }], referenceId: "human" };
  const snapshot = (config: typeof base): AgreementSnapshot => ({
    format: "nodus.imago.agreement/1",
    createdAt: "",
    database: { id: "d", name: "d" },
    input: { databaseId: "d", config },
    columns,
    rows,
    matched: 0,
    provenance: [],
  });
  const asLabel = calculateAgreement(snapshot({ ...base, placeholdersMissing: false }));
  const asMissing = calculateAgreement(snapshot(base));
  assert.equal(asLabel.pairs[0].n, 4);
  assert.equal(asMissing.pairs[0].n, 2);
  assert.equal(asMissing.pairs[0].exact.value, 1);
  assert.equal(asMissing.coverage.find((c) => c.columnId === "model")?.missing, 2);
});

test("hybrid lexical lane accepts any significant word with plural-insensitive prefixes", () => {
  assert.equal(ftsExpression("toros en la plaza", "words"), '"toros" AND "en" AND "la" AND "plaza"');
  assert.equal(ftsExpression("Nazarenos con capirotes en la procesión", "any"), '"nazareno"* OR "capirot"* OR "procesion"*');
  assert.equal(ftsExpression("de la", "any"), "");
  // Operators are quoted terms, never FTS syntax; "or" is a stopword.
  assert.equal(ftsExpression('"OR" * NOT', "any"), '"not"*');
  assert.match(snippetAround("x".repeat(300) + " Procesión de nazarenos en Sevilla", "nazarenos sevilla"), /nazarenos/);
});

test("records are searchable by their own text, fused with images by rank", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-record-text-")),
    repo = new Repository(root),
    host = new InferenceHost(repo, "not-used"),
    engine = new Engine(repo, new Models(repo), host);
  try {
    repo.updateSettings({ embeddingModel: "embeddinggemma2" });
    const d = repo.importCsv(
      "Fotos",
      ["ID", "Descripción", "Lugar", "Tema", "Archivo"],
      ["title", "text", "text", "select", "text"],
      [
        ["R1", "Nazarenos en procesión", "Sevilla", "Fiestas", "export/R1/1.jpg"],
        ["R2", "Vista de la catedral (https://example.org/x)", "-", "Patrimonio", "export%20x/R2/2.png"],
        ["R3", "Toro en la plaza", "Ronda", "Fiestas", "export/R3/3.jpg"],
      ],
    );
    const detail = repo.detail(d.database.id);
    const text = recordEmbeddingText(detail.columns, repo.literal({ databaseIds: [d.database.id] }).rows[1]);
    const lines = text.split("\n");
    assert.equal(lines[0], "R2");
    assert.deepEqual(lines.slice(1).sort(), ["Descripción: Vista de la catedral", "Tema: Patrimonio"]);
    engine.ready = () => {};
    // Deterministic "model": axis 0 for processions, axis 1 for everything else.
    host.request = async (input) =>
      (input.inputs as { text?: string }[]).map((item) => {
        const v = Array(input.dimensions as number).fill(0);
        v[/procesi|nazaren/i.test(item.text ?? "") ? 0 : 1] = 1;
        return v;
      });
    const job = engine.enqueueIndex([d.database.id]);
    const payload = JSON.parse((repo.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(job) as { payload_json: string }).payload_json);
    assert.equal(payload.rows.length, 3);
    // Run it through the real queue, which validates the combined payload.
    const queue = new JobQueue(repo, new Images(repo), new Models(repo), engine, () => {});
    queue.pump();
    await queue.task;
    const state = repo.db.prepare("SELECT state,done,failed,message FROM jobs WHERE id=?").get(job) as { state: string; done: number; failed: number; message: string | null };
    assert.deepEqual(state, { state: "completed", done: 3, failed: 0, message: state.message });
    await queue.close();
    // Nothing to redo while the text is unchanged.
    assert.equal(await engine.indexOne(payload, 0, new AbortController().signal), "skipped");
    let page = await engine.search({ mode: "semantic", query: "procesión de semana santa", databaseIds: [d.database.id] });
    assert.equal(page.rows[0].title, "R1");
    assert.equal(page.textIndexed, 3);
    page = await engine.search({ mode: "semantic", query: "procesión", semanticSources: "images", databaseIds: [d.database.id] });
    assert.equal(page.total, 0);
    // Editing a record keeps its old vector serving searches; re-indexing
    // embeds only the records whose text changed.
    const row = repo.literal({ databaseIds: [d.database.id] }).rows[2];
    repo.setCell(row.id, detail.columns[1].id, "Procesión del Corpus");
    assert.equal((repo.db.prepare("SELECT count(*) n FROM record_embeddings").get() as { n: number }).n, 3);
    const again = JSON.parse((repo.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(engine.enqueueIndex([d.database.id])) as { payload_json: string }).payload_json);
    assert.deepEqual(again.rows, [row.id]);
    // Renaming a property changes every record's text but empties nothing.
    repo.updateColumn(detail.columns[2].id, "Localidad");
    assert.equal((await engine.search({ mode: "semantic", query: "procesión", databaseIds: [d.database.id] })).textIndexed, 3);
  } finally {
    host.close();
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rank fusion rewards records found by both lanes", () => {
  const fused = fuseRankLists([
    { ids: ["a", "b", "c"], weight: 1 },
    { ids: ["c", "d"], weight: 1 },
  ]).map(([id]) => id);
  assert.equal(fused[0], "c");
  assert.deepEqual(new Set(fused), new Set(["a", "b", "c", "d"]));
  // A record with no image vector, first by its text, is not buried under
  // records that only appear in both lanes at mediocre ranks.
  const text = ["noImage", ...Array.from({ length: 30 }, (_, i) => "r" + i)];
  const images = Array.from({ length: 30 }, (_, i) => "r" + (29 - i));
  const summed = fuseRankLists([{ ids: text, weight: 1 }, { ids: images, weight: 1 }]).map(([id]) => id);
  const mean = fuseRankLists([{ ids: text, weight: 1 }, { ids: images, weight: 1 }], 60, "mean").map(([id]) => id);
  assert.ok(summed.indexOf("noImage") > 10);
  assert.equal(mean[0], "noImage");
});

test("an exported table imports back without the formula-guard apostrophe", () => {
  const plan = buildCsvImportPlan([["ID", "Nota"], ["A", "'-and an ay!"], ["B", "'=1+1"], ["C", "'quoted"]]);
  assert.deepEqual(plan.rows.map((r) => r[1]), ["-and an ay!", "=1+1", "'quoted"]);
});

test("columns can be reordered like Notion, without staling record vectors", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-reorder-")),
    repo = new Repository(root);
  try {
    const d = repo.importCsv("Fotos", ["ID", "Lugar", "Tema"], ["title", "text", "select"], [["R1", "Sevilla", "Fiestas"]]);
    const other = repo.importCsv("Otra", ["ID"], ["title"], [["X"]]);
    const [title, place, theme] = d.columns.map((c) => c.id);
    const row = repo.literal({ databaseIds: [d.database.id] }).rows[0];
    repo.db.prepare("INSERT INTO record_embeddings VALUES(?,?,?,?,0)").run(row.id, "c", recordTextHash(recordEmbeddingText(repo.detail(d.database.id).columns, row)), Buffer.alloc(4));
    const moved = repo.reorderColumns(d.database.id, [theme, title, place]);
    assert.deepEqual(moved.columns.map((c) => c.id), [theme, title, place]);
    assert.deepEqual(repo.detail(d.database.id).columns.map((c) => c.name), ["Tema", "ID", "Lugar"]);
    // The record text, and therefore its vector, does not depend on the order.
    repo.indexRow(row.id);
    assert.equal((repo.db.prepare("SELECT stale FROM record_embeddings WHERE row_id=?").get(row.id) as { stale: number }).stale, 0);
    for (const bad of [[theme, title], [theme, title, title], [theme, title, other.columns[0].id]])
      assert.throws(() => repo.reorderColumns(d.database.id, bad), /cada propiedad/);
    assert.deepEqual(repo.detail(d.database.id).columns.map((c) => c.id), [theme, title, place]);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

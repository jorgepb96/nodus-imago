// The methodology report: the facts gathered from a collection (data and its
// fingerprint, vocabularies, AI properties with their exact instructions and
// what became of their values, review, views, statistics) and the printable
// document in the interface language.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { Statistics } from "../electron/db/statistics";
import { SavedViews } from "../electron/db/savedViews";
import { collectMethodology } from "../electron/export/methodology";
import { renderMethodologyHtml } from "../shared/methodologyHtml";
import type { MethodologyData } from "../shared/methodology";
import { translate } from "../src/i18n";

const environment = { app: "0.0.0", platform: "darwin", arch: "arm64", electron: "1", chromium: "1" };

/** Photographs classified by theme with AI (one value later corrected by hand), linked to books. */
async function withStudy(run: (ctx: { repo: Repository; photos: string; books: string; root: string }) => Promise<void> | void) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-method-")),
    repo = new Repository(root);
  try {
    const photos = repo.importCsv(
      "Postales",
      ["Título", "Fecha", "Tema"],
      ["title", "historical_date", "select"],
      [
        ["Puente romano", "1931", "Arquitectura"],
        ["Mercado", "1948", "Costumbres"],
        ["Procesión", "1952", "Religión"],
        ["Catedral", "c. 1955", "Arquitectura"],
      ],
    );
    const db = photos.database.id;
    const theme = photos.columns.find((c) => c.name === "Tema")!;
    // The theme is classified with AI, with general criteria and definitions.
    repo.updateColumn(theme.id, undefined, {
      ...repo.column(theme.id).config,
      aiEnabled: true,
      aiCriteriaOn: true,
      aiCriteria: "Clasifica por el motivo principal.",
      aiDefinitionsOn: true,
      aiDefinitions: { arquitectura: "Edificios y monumentos como motivo principal." },
    });
    const books = repo.create("Libros", true, undefined, "sources");
    const rel = repo.addColumn(db, "Publicada en", "relation", { relationTargetDatabaseId: books.database.id, relationInverseName: "Fotografías" });
    const book = repo.createRow(books.database.id);
    repo.setCell(book.id, books.columns.find((c) => c.type === "title")!.id, "Guía de España", false);
    const ids = (repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position").all(db) as { id: string }[]).map((r) => r.id);
    repo.setCell(ids[0], rel.id, JSON.stringify([book.id]));
    repo.setLinkDetails(ids[0], rel.id, book.id, { page: "12", caption: "El puente" });
    // Two values written by the AI, one corrected afterwards.
    const option = (label: string) => repo.column(theme.id).options.find((o) => o.label === label)!.id;
    const source = JSON.stringify({ model: "LiquidAI/LFM3-VL-2B-GGUF", revision: "b36554cfd3", prompt: repo.rememberPrompt("Clasifica la fotografía: Arquitectura, Costumbres, Religión.") });
    repo.setCell(ids[1], theme.id, option("Arquitectura"), true, undefined, { kind: "ai", source });
    repo.setCell(ids[2], theme.id, option("Costumbres"), true, undefined, { kind: "ai", source });
    repo.setCell(ids[1], theme.id, option("Costumbres"));
    // A proposal accepted and one rejected, kept with their instructions.
    for (const [row, state] of [[ids[3], "accepted"], [ids[0], "rejected"]] as const)
      repo.db
        .prepare("INSERT INTO proposals(id,row_id,column_id,before_value,value,model,revision,prompt,created_at,state) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(`p-${row}`, row, theme.id, null, option("Arquitectura"), "openrouter/model-x", "API · https://openrouter.ai", "Prompt de propuesta", "2026-01-01", state);
    new SavedViews(repo).save({
      databaseId: db,
      name: "Arquitectura",
      view: "table",
      criteria: { filters: [{ columnId: theme.id, op: "any", value: [option("Arquitectura")] }], filterLogic: "and", filterGroups: [], sorts: [] },
    });
    new Statistics(repo).save({ databaseId: db, name: "Temas", spec: { kind: "frequency", columnId: theme.id } });
    await run({ repo, photos: db, books: books.database.id, root });
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}
const collect = (repo: Repository, ids: string[]): MethodologyData => ({
  ...collectMethodology({ repo, contract: "test", dimensions: 768 }, { databaseIds: ids }),
  environment,
});

test("the report gathers the data, the AI instructions, what became of the values and the review", () =>
  withStudy(({ repo, photos, books }) => {
    const data = collect(repo, [photos, books]);
    assert.equal(data.databases.length, 2);
    const db = data.databases.find((d) => d.name === "Postales")!;
    assert.equal(db.records, 4);
    assert.match(db.fingerprint, /^[a-f0-9]{64}$/);
    const theme = db.properties.find((p) => p.name === "Tema")!;
    assert.equal(theme.ai, true);
    assert.deepEqual(
      theme.options!.map((o) => [o.label, o.count]),
      [["Arquitectura", 2], ["Costumbres", 2], ["Religión", 0]],
    );
    assert.equal(theme.options!.find((o) => o.label === "Arquitectura")!.definition, "Edificios y monumentos como motivo principal.");
    assert.deepEqual(db.properties.find((p) => p.name === "Publicada en")!.relation, { target: "Libros", twoWay: true, place: true });
    const ai = data.aiProperties.find((a) => a.name === "Tema")!;
    assert.equal(ai.criteria, "Clasifica por el motivo principal.");
    assert.equal(ai.kept, 1);
    assert.equal(ai.corrected, 1);
    assert.deepEqual(ai.proposals, { accepted: 1, rejected: 1, pending: 0 });
    assert.ok(ai.prompts.some((p) => p.text === "Clasifica la fotografía: Arquitectura, Costumbres, Religión." && p.count === 2));
    assert.ok(ai.writes.some((w) => w.model === "LiquidAI/LFM3-VL-2B-GGUF" && w.count === 2));
    const local = data.models.find((m) => m.model === "LiquidAI/LFM3-VL-2B-GGUF" && m.task === "property")!;
    assert.equal(local.where, "local");
    assert.equal(local.label, "LFM3-VL-2B · Q4_K_M", "named from the catalogue");
    assert.equal(data.models.find((m) => m.model === "openrouter/model-x")!.where, "api");
    assert.equal(data.review.linkDetails, 1);
    assert.equal(data.review.aiCorrected, 1);
    assert.deepEqual(data.views[0].filters, [{ property: "Tema", op: "any", value: "Arquitectura" }]);
    assert.equal(data.statistics[0].result?.kind, "frequency");
    // The same data gives the same fingerprint; a change gives another.
    assert.equal(collect(repo, [photos, books]).fingerprint, data.fingerprint);
    const first = (repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position LIMIT 1").get(photos) as { id: string }).id;
    repo.setCell(first, repo.detail(photos).columns.find((c) => c.name === "Fecha")!.id, "1932");
    assert.notEqual(collect(repo, [photos, books]).fingerprint, data.fingerprint);
  }));

test("the document has a cover, contents, numbered sections, charts and the running footer, in the interface language", () =>
  withStudy(async ({ repo, photos, books }) => {
    const data = collect(repo, [photos, books]);
    const asked = new Set<string>();
    const es = renderMethodologyHtml(data, (s) => (asked.add(s), s), { title: "Mi estudio", logoSvg: await fs.readFile("build/icon-mark.svg", "utf8") });
    assert.match(es, /<html lang="es">/);
    assert.match(es, /class="cover"/);
    assert.match(es, /Contenidos/);
    assert.match(es, /Mi estudio/);
    assert.match(es, /@bottom-center \{ content: counter\(page\) " \/ " counter\(pages\)/);
    assert.match(es, /@page :first/);
    assert.match(es, /<svg class="chart"/);
    assert.match(es, /Clasifica la fotografía: Arquitectura, Costumbres, Religión\./, "the exact instructions");
    assert.match(es, /text-align: justify/);
    assert.match(es, /data:image\/svg\+xml;base64,/, "the Imago mark");
    for (const id of ["summary", "corpus", "vocabularies", "models", "ai", "review", "views", "statistics", "reproduction"]) assert.match(es, new RegExp(`id="${id}"`));
    // Every sentence of the report has an English version.
    const missing = [...asked].filter((s) => /[a-záéíóúñ]{3}/i.test(s) && translate(s, "en") === s && !["Rollup", "URL", "Email"].includes(s));
    assert.deepEqual(missing, [], "translated");
    // With circulation: its own section and charts.
    const withCirculation = renderMethodologyHtml(
      {
        ...data,
        circulation: {
          families: 3,
          published: 2,
          top: [{ assetId: "a", rowId: "r", title: "Puente romano", uses: 4, publications: 2, first: 1935, last: 1948 }],
          firstYears: [{ year: 1935, count: 1 }, { year: 1948, count: 1 }],
          gap: { median: 7, min: 5, max: 9, n: 2 },
          captionsChange: 1,
          origins: 1,
        },
      },
      (s) => (asked.add(s), s),
    );
    assert.match(withCirculation, /id="circulation"/);
    assert.match(withCirculation, /Circulación de las imágenes/);
    assert.match(withCirculation, /pasaron 7,0 años de mediana/);
    const untranslated = [...asked].filter((s) => /[a-záéíóúñ]{3}/i.test(s) && translate(s, "en") === s && !["Rollup", "URL", "Email", "Total"].includes(s));
    assert.deepEqual(untranslated, [], "the circulation is translated too");
    const en = renderMethodologyHtml({ ...data, language: "en" }, (s) => translate(s, "en"));
    assert.match(en, /<html lang="en">/);
    assert.match(en, /Methodology report/);
    assert.match(en, /Human review and corrections/);
    await fs.mkdir("test-results", { recursive: true });
    await fs.writeFile("test-results/methodology-sample.html", es);
  }));

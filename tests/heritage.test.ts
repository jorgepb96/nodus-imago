// Heritage («Patrimonio») properties: element records, typology, hierarchy,
// Wikidata linking in reviewed batches, marks on photographs, the map, the
// statistics and the filters. Invented data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { Heritage } from "../electron/db/heritage";
import { Annotations } from "../electron/db/annotations";
import { ValueCleanup } from "../electron/db/cleanup";
import { Statistics } from "../electron/db/statistics";
import { annotationsW3c } from "../electron/import/standards";
import { decodeMultiSelect } from "../shared/databases";
import type { AuthorityLink } from "../shared/authority";
import {
  DEFAULT_HERITAGE_SCHEME,
  ancestors,
  emptyElement,
  heritageCategories,
  heritageDictionaryOptions,
  heritageQuery,
  heritageRegionPrompt,
  isHeritageColumn,
  parseHeritageRegions,
  rankCandidates,
  resolvedPosition,
  typeFromInstances,
  wouldCycle,
  WIKIDATA_TYPES,
  withSuperclasses,
  type HeritageElement,
} from "../shared/heritage";
import { filterOperators } from "../shared/viewCriteria";

const link = (id: string, label: string, extra: Partial<AuthorityLink> = {}): AuthorityLink => ({
  source: "wikidata",
  id,
  label,
  description: null,
  uri: `https://www.wikidata.org/wiki/${id}`,
  kind: "place",
  ...extra,
});
const element = (optionId: string, change: Partial<HeritageElement> = {}): HeritageElement => ({ ...emptyElement(optionId), ...change });

test("heritage regions require dictionary references until suggestions outside the dictionary are enabled", () => {
  const dictionary = [{ id: "tower", label: "Torre Eiffel - París" }];
  const output = JSON.stringify({ elements: [
    { entry: 1, name: "An unchecked name", place: "Rome", confidence: "high", box: [100, 200, 800, 700] },
    { entry: null, name: "Pont Neuf", place: "París, Francia", confidence: "low", box: [0, 0, 1001, 1000] },
    { entry: 99, name: "Foreign dictionary entry", box: null },
  ] });
  const known = { optionId: "tower", name: "Torre Eiffel - París", place: null, confidence: "high", box: { x: 0.2, y: 0.1, w: 0.5, h: 0.7 } };
  assert.deepEqual(parseHeritageRegions(output, dictionary, false), [known]);
  assert.deepEqual(parseHeritageRegions(output, dictionary, true), [
    known, { optionId: null, name: "Pont Neuf", place: "París", confidence: "low", box: null },
  ]);
  assert.match(heritageRegionPrompt(dictionary, false, false), /Only return elements from the dictionary/);
  assert.match(heritageRegionPrompt(dictionary, true, false), /recognisable named heritage outside the dictionary/);
});

test("the viewer reuses heritage, and linked select vocabularies retain their separate identity", async () => {
  await withCatalogue(({ repo, heritage, databaseId, columnId }) => {
    const own = repo.column(columnId);
    assert.equal(heritage.selectDictionary(databaseId, null).id, columnId);
    assert.deepEqual(heritage.selectDictionary(databaseId, columnId), own);
    const source = repo.addColumn(databaseId, "Lugares", "multi_select");
    repo.saveOptions(source.id, [{ label: "Torre Eiffel", color: null }]);
    const optionId = repo.column(source.id).options[0].id;
    const selected = heritage.selectDictionary(databaseId, source.id);
    assert.equal(heritage.selectDictionary(databaseId, source.id).id, selected.id);
    assert.ok(isHeritageColumn(selected));
    assert.ok(!isHeritageColumn(repo.column(source.id)));
    assert.deepEqual(heritageDictionaryOptions(selected, repo.detail(databaseId).columns).map((o) => o.id), [optionId]);
    assert.deepEqual(repo.column(columnId), own);
    const identified = heritage.addElement(selected.id, "Torre Eiffel", link("Q243", "Torre Eiffel"));
    assert.equal(heritage.addElement(selected.id, "Eiffel Tower", link("Q243", "Eiffel Tower")), identified);
    const fresh = repo.importCsv("Sin patrimonio", ["Título", "Lugares"], ["title", "multi_select"], [["París", "Torre Eiffel"]]);
    const freshSource = fresh.columns.find((column) => column.name === "Lugares")!;
    const blank = heritage.selectDictionary(fresh.database.id, null);
    assert.equal(heritage.selectDictionary(fresh.database.id, freshSource.id).id, blank.id);
    assert.equal(repo.detail(fresh.database.id).columns.filter(isHeritageColumn).length, 1);
  });
});

test("names become searches, candidates are ranked and Wikidata classes give a typology", () => {
  assert.deepEqual(heritageQuery("Catedral - Villaverde"), {
    queries: ["Catedral de Villaverde", "Catedral", "Catedral Villaverde"],
    hints: ["Villaverde"],
  });
  assert.deepEqual(heritageQuery("Puente de los Arcos - Villaverde").queries, ["Puente de los Arcos", "Puente de los Arcos Villaverde"]);
  assert.deepEqual(heritageQuery("Retrato de dama - Pintor X - Museo Y").hints, ["Pintor X", "Museo Y"]);
  assert.deepEqual(heritageQuery("Torre Mayor").queries, ["Torre Mayor"]);

  const ranked = rankCandidates("Catedral - Villaverde", [
    link("Q1", "Catedral de Villaverde", { description: "catedral en Villaverde", instances: ["Q2977"], coordinates: { latitude: 40, longitude: -3 } }),
    link("Q2", "Catedral de Otraparte", { description: "catedral en Otraparte", instances: ["Q2977"] }),
    link("Q3", "Catedral de Villaverde", { description: "pintor", kind: "person" }),
  ]);
  assert.equal(ranked[0].link.id, "Q1");
  assert.equal(ranked[0].confidence, "high");
  assert.equal(ranked.find((c) => c.link.id === "Q3")!.confidence, "low");

  // Near the place named settles a homonym; far away rules it out.
  const homonyms = rankCandidates(
    "Iglesia de Santa María - Villaverde",
    [
      link("Q20", "Iglesia de Santa María", { description: "iglesia", instances: ["Q16970"], coordinates: { latitude: 43, longitude: -8 } }),
      link("Q21", "Iglesia de Santa María", { description: "iglesia", instances: ["Q16970"], coordinates: { latitude: 40.01, longitude: -3.01 } }),
    ],
    { latitude: 40, longitude: -3 },
  );
  assert.deepEqual(homonyms.map((c) => [c.link.id, c.confidence]), [["Q21", "high"], ["Q20", "low"]]);
  // An unknown class is typed by the class above it.
  assert.deepEqual(withSuperclasses(["Q999"], { Q999: ["Q12518"] }), ["Q999", "Q12518"]);
  assert.deepEqual(typeFromInstances(withSuperclasses(["Q999"], { Q999: ["Q12518"] })), { group: "defensive", type: "tower" });
  assert.deepEqual(typeFromInstances(["Q5", "Q2977"]), { group: "religious", type: "cathedral" });
  assert.deepEqual(typeFromInstances(["Q12280"]), { group: "public-works", type: "bridge" });
  assert.equal(typeFromInstances(["Q5"]), null);
  // Every type the map suggests exists in the default scheme.
  for (const type of new Set(Object.values(WIKIDATA_TYPES)))
    assert.ok(DEFAULT_HERITAGE_SCHEME.groups.some((g) => g.types.some((x) => x.key === type)), type);
});

test("parts hang from wholes without loops and take the whole's position when they have none", () => {
  const byId = {
    whole: element("whole", { latitude: 40, longitude: -3, coordSource: "manual" }),
    part: element("part", { parentId: "whole" }),
    detail: element("detail", { parentId: "part" }),
    alone: element("alone"),
  };
  assert.deepEqual(ancestors("detail", byId), ["part", "whole"]);
  assert.equal(wouldCycle("whole", "detail", byId), true);
  assert.equal(wouldCycle("alone", "whole", byId), false);
  assert.deepEqual(resolvedPosition("detail", byId), { latitude: 40, longitude: -3, inherited: true, from: "whole" });
  assert.equal(resolvedPosition("alone", byId), null);
  // A loop already stored does not hang the walk.
  assert.deepEqual(ancestors("a", { a: element("a", { parentId: "b" }), b: element("b", { parentId: "a" }) }), ["b"]);

  const labels = new Map([["whole", "Conjunto"], ["part", "Patio"], ["detail", "Fuente del patio"], ["alone", "Calle Mayor"]]);
  byId.whole.group = "civil";
  byId.whole.type = "palace";
  byId.detail.group = "commemorative";
  byId.detail.type = "fountain";
  assert.deepEqual(heritageCategories(["detail"], labels, byId, DEFAULT_HERITAGE_SCHEME, "element", true).sort(), ["Conjunto", "Fuente del patio", "Patio"]);
  assert.deepEqual(heritageCategories(["detail", "whole"], labels, byId, DEFAULT_HERITAGE_SCHEME, "group"), ["Monumentos conmemorativos", "Arquitectura civil"]);
  // In the language of the interface.
  assert.deepEqual(heritageCategories(["detail", "whole"], labels, byId, DEFAULT_HERITAGE_SCHEME, "group", false, "en"), ["Commemorative monuments", "Civil architecture"]);
  assert.deepEqual(heritageCategories(["alone", "part"], labels, byId, DEFAULT_HERITAGE_SCHEME, "type"), ["Sin tipología"]);
});

/** A database of four photographs with a heritage property and a location. */
async function withCatalogue(
  run: (c: { repo: Repository; heritage: Heritage; databaseId: string; columnId: string; locationId: string; ids: string[]; option: (label: string) => string; root: string }) => Promise<void> | void,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-heritage-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv(
      "Fotos",
      ["ID", "Patrimonio", "Fecha"],
      ["title", "multi_select", "historical_date"],
      [
        ["A", "Conjunto - Villaverde, Patio - Villaverde", "1950-1959"],
        ["B", "Patio - Villaverde", "1960-1969"],
        ["C", "Puente Viejo - Villaverde", "c. 1955"],
        ["D", "", "1950-1959"],
      ],
    );
    const column = repo.detail(detail.database.id).columns.find((c) => c.name === "Patrimonio")!;
    repo.updateColumn(column.id, undefined, { ...column.config, heritage: true });
    const location = repo.addColumn(detail.database.id, "Ubicación", "location");
    const ids = (repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position").all(detail.database.id) as { id: string }[]).map((r) => r.id);
    repo.setCell(ids[3], location.id, JSON.stringify({ name: "Villaverde", latitude: 41, longitude: -4 }));
    repo.setCell(ids[1], location.id, JSON.stringify({ name: "Villaverde", latitude: 41, longitude: -4 }));
    const option = (label: string) => repo.column(column.id).options.find((o) => o.label === label)!.id;
    // One image per record: asset-0 … asset-3.
    repo.db
      .prepare("INSERT INTO db_columns(id,database_id,name,type,position,config_json,created_at,updated_at) VALUES('img',?,'Imagen','files',9,'{}','x','x')")
      .run(detail.database.id);
    ids.forEach((rowId, i) =>
      repo.db
        .prepare("INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(`asset-${i}`, detail.database.id, rowId, "img", `f${i}.png`, path.join(root, `f${i}.png`), 0, `hash-${i}`, 1, 100, 100, "{}", null, 0, "x"),
    );
    await run({ repo, heritage: new Heritage(repo), databaseId: detail.database.id, columnId: column.id, locationId: location.id, ids, option, root });
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("element records are saved apart from the options and refuse loops and foreign parents", () =>
  withCatalogue(({ repo, heritage, columnId, option }) => {
    assert.ok(isHeritageColumn(repo.column(columnId)));
    const [whole, part] = [option("Conjunto - Villaverde"), option("Patio - Villaverde")];
    heritage.save(columnId, [
      element(whole, { latitude: 40.5, longitude: -3.5, group: "civil", type: "palace" }),
      element(part, { parentId: whole }),
    ]);
    assert.equal(heritage.elements(columnId)[whole].coordSource, "manual");
    assert.throws(() => heritage.save(columnId, [element(whole, { parentId: part })]), /parte de sí mismo/);
    assert.throws(() => heritage.save(columnId, [element(part, { group: "civil", type: "cathedral" })]), /desconocida/);
    assert.throws(() => heritage.save(columnId, [element(part, { parentId: "elsewhere" })]), /no está en esta propiedad/);
    // Renaming options keeps the records.
    repo.saveOptions(columnId, repo.column(columnId).options.map((o) => ({ id: o.id, label: o.label + " (renombrado)", color: o.color })));
    assert.equal(heritage.elements(columnId)[part].parentId, whole);
    // An empty record is removed.
    heritage.save(columnId, [element(part)]);
    assert.equal(heritage.elements(columnId)[part], undefined);
    // A new element by name, and one from Wikidata with its place and type.
    const plain = heritage.addElement(columnId, "Fuente Nueva", null);
    assert.equal(heritage.addElement(columnId, "fuente nueva", null), plain);
    const linked = heritage.addElement(columnId, "Torre del Reloj", link("Q900", "Torre del Reloj", { instances: ["Q12518"], coordinates: { latitude: 39, longitude: -2 } }));
    assert.deepEqual(
      { ...heritage.elements(columnId)[linked] },
      { optionId: linked, parentId: null, group: "defensive", type: "tower", latitude: 39, longitude: -2, coordSource: "wikidata", osm: null },
    );
  }));

test("Wikidata batches fill only what is missing, keep manual coordinates and revert as a whole", () =>
  withCatalogue(({ heritage, columnId, option }) => {
    const [whole, part, bridge] = [option("Conjunto - Villaverde"), option("Patio - Villaverde"), option("Puente Viejo - Villaverde")];
    heritage.save(columnId, [element(bridge, { latitude: 1, longitude: 2 })]);
    const batch = heritage.applyLinks(columnId, [
      { optionId: whole, link: link("Q10", "Conjunto", { coordinates: { latitude: 40, longitude: -3 } }), group: "civil", type: "palace" },
      { optionId: part, link: link("Q11", "Patio", { partOf: ["Q10"] }), parentId: whole },
      { optionId: bridge, link: link("Q12", "Puente Viejo", { coordinates: { latitude: 9, longitude: 9 } }), group: "public-works", type: "bridge" },
    ]);
    assert.equal(batch.applied, 3);
    const after = heritage.elements(columnId);
    assert.deepEqual([after[whole].group, after[whole].latitude, after[part].parentId], ["civil", 40, whole]);
    assert.deepEqual([after[bridge].latitude, after[bridge].coordSource, after[bridge].type], [1, "manual", "bridge"]);
    assert.throws(() => heritage.applyLinks(columnId, [{ optionId: whole, link: { ...link("Q1", "x"), uri: "https://evil.example/Q1" } }]), /no válido/);
    assert.equal(heritage.revertBatch(batch.id), 3);
    const reverted = heritage.elements(columnId);
    assert.equal(reverted[whole], undefined);
    assert.deepEqual([reverted[bridge].latitude, reverted[bridge].type], [1, null]);
    assert.equal(heritage.batches(columnId)[0].revertedAt !== null, true);
    assert.throws(() => heritage.revertBatch(batch.id), /ya se revirtió/);
  }));

test("merging elements keeps records, parts and marks, and «Deshacer» puts everything back", () =>
  withCatalogue(({ repo, heritage, columnId, option, ids }) => {
    const [whole, part, bridge] = [option("Conjunto - Villaverde"), option("Patio - Villaverde"), option("Puente Viejo - Villaverde")];
    heritage.save(columnId, [element(part, { latitude: 40, longitude: -3, group: "civil", type: "palace" }), element(bridge, { parentId: part })]);
    repo.db
      .prepare("INSERT INTO image_annotations(id,asset_id,row_id,x,y,w,h,note,tags_json,color,created_at,updated_at,kind,option_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("mark-1", "asset-1", ids[1], 0.5, 0.5, 0, 0, "", "[]", null, "x", "x", "point", part);
    new ValueCleanup(repo).merge(columnId, [{ members: [whole, part], target: "Conjunto - Villaverde" }]);
    const merged = heritage.elements(columnId);
    assert.deepEqual([merged[whole].latitude, merged[whole].group, merged[bridge].parentId], [40, "civil", whole]);
    assert.equal((repo.db.prepare("SELECT option_id o FROM image_annotations WHERE id='mark-1'").get() as { o: string }).o, whole);
    repo.undo();
    const back = heritage.elements(columnId);
    assert.equal(back[whole], undefined);
    assert.equal(back[bridge].parentId, part);
    assert.equal((repo.db.prepare("SELECT option_id o FROM image_annotations WHERE id='mark-1'").get() as { o: string }).o, part);
  }));

test("converting away from options warns about the records and marks it would lose", () =>
  withCatalogue(({ repo, heritage, columnId, option }) => {
    heritage.save(columnId, [element(option("Patio - Villaverde"), { latitude: 1, longitude: 1 })]);
    // Between option types nothing is lost: the records come back.
    repo.convertColumn(columnId, "select", true);
    repo.convertColumn(columnId, "multi_select", true);
    assert.ok(isHeritageColumn(repo.column(columnId)));
    assert.equal(Object.keys(heritage.elements(columnId)).length, 1);
    const preview = repo.convertColumn(columnId, "text", false);
    assert.deepEqual(preview.heritage, { elements: 1, marks: 0 });
    repo.convertColumn(columnId, "text", true);
    assert.equal((repo.db.prepare("SELECT count(*) n FROM heritage_elements WHERE column_id=?").get(columnId) as { n: number }).n, 0);
  }));

test("marks are points or rectangles of an element, add it to the record and follow crops", () =>
  withCatalogue(({ repo, columnId, option, ids, databaseId }) => {
    const notes = new Annotations(repo);
    const bridge = option("Puente Viejo - Villaverde");
    const point = notes.save({ assetId: "asset-3", x: 0.25, y: 0.75, w: 0, h: 0, note: "", tags: [], kind: "point", optionId: bridge });
    assert.deepEqual([point.kind, point.optionId, point.w, point.h], ["point", bridge, 0, 0]);
    assert.ok(Math.abs(point.x - 0.25) < 1e-9 && Math.abs(point.y - 0.75) < 1e-9);
    // The record now shows the element.
    assert.deepEqual(decodeMultiSelect(repo.getRow(ids[3]).cells[columnId] ?? null), [bridge]);
    const rect = notes.save({ assetId: "asset-3", x: 0.1, y: 0.1, w: 0.2, h: 0.2, note: "", tags: [], optionId: option("Patio - Villaverde") });
    assert.equal(rect.kind, "rect");
    assert.throws(() => notes.save({ assetId: "asset-3", x: 0.1, y: 0.1, w: 0.2, h: 0.2, note: "", tags: [], optionId: "elsewhere" }), /no pertenece/);
    // With a crop that leaves the point out, it is not shown; inside, it moves with the crop.
    repo.db.prepare("UPDATE image_assets SET metadata_json=? WHERE id='asset-3'").run(JSON.stringify({ imagoCrop: { x: 0, y: 0.5, w: 0.5, h: 0.5 } }));
    const shown = notes.list({ assetId: "asset-3" }).find((a) => a.id === point.id)!;
    assert.ok(Math.abs(shown.x - 0.5) < 1e-6 && Math.abs(shown.y - 0.5) < 1e-6);
    repo.db.prepare("UPDATE image_assets SET metadata_json=? WHERE id='asset-3'").run(JSON.stringify({ imagoCrop: { x: 0.5, y: 0, w: 0.5, h: 0.5 } }));
    assert.equal(notes.list({ assetId: "asset-3" }).some((a) => a.id === point.id), false);
    // The W3C export identifies the element.
    const exported = annotationsW3c(repo, databaseId).first.items.find((i) => i.id === `urn:uuid:${point.id}`)!;
    assert.equal(exported.motivation, "identifying");
    assert.match(exported.target.selector.value, /^xywh=percent:/);
  }));

test("the map places photos at their elements, falls back to their location and draws one point per element", () =>
  withCatalogue(({ repo, heritage, columnId, locationId, option, ids, databaseId }) => {
    const [whole, part, bridge] = [option("Conjunto - Villaverde"), option("Patio - Villaverde"), option("Puente Viejo - Villaverde")];
    heritage.save(columnId, [element(whole, { latitude: 40, longitude: -3 }), element(part, { parentId: whole }), element(bridge, { latitude: 42, longitude: -5 })]);
    const records = repo.mapRecords({ databaseId, columnId, fallbackColumnId: locationId }).records;
    // A: whole and part share a place → one marker; B: inherits; C: bridge; D: its location.
    assert.deepEqual(
      records.map((r) => [ids.indexOf(r.id), r.location?.latitude ?? null, r.placement?.inherited ?? null]),
      [[0, 40, false], [1, 40, true], [2, 42, false], [3, 41, null]],
    );
    assert.equal(repo.mapRecords({ databaseId, columnId, fallbackColumnId: null }).records.find((r) => r.id === ids[3])!.location, null);
    const map = heritage.map({ databaseId, columnId, includeParts: false });
    assert.deepEqual(map.elements.map((e) => [e.label, e.count]), [["Conjunto - Villaverde", 1], ["Puente Viejo - Villaverde", 1]]);
    assert.equal(map.records, 3);
    const withParts = heritage.map({ databaseId, columnId, includeParts: true });
    assert.equal(withParts.elements.find((e) => e.optionId === whole)!.count, 2);
  }));

test("statistics count elements, types or groups, and filters find types, parts, marks and unlinked elements", () =>
  withCatalogue(({ repo, heritage, columnId, option, ids, databaseId }) => {
    const [whole, part, bridge] = [option("Conjunto - Villaverde"), option("Patio - Villaverde"), option("Puente Viejo - Villaverde")];
    heritage.save(columnId, [
      element(whole, { group: "civil", type: "palace" }),
      element(part, { parentId: whole }),
      element(bridge, { group: "public-works", type: "bridge" }),
    ]);
    const stats = new Statistics(repo);
    const frequency = (spec: object) =>
      (stats.compute(databaseId, ids, { kind: "frequency", columnId, ...spec }) as { categories: { label: string; count: number }[] }).categories;
    assert.deepEqual(frequency({ includeParts: true }).find((r) => r.label === "Conjunto - Villaverde")!.count, 2);
    assert.deepEqual(frequency({}).find((r) => r.label === "Conjunto - Villaverde")!.count, 1);
    assert.deepEqual(
      frequency({ heritageLevel: "group" }).map((r) => [r.label, r.count]).sort(),
      // A part with no typology of its own counts as such.
      [["Arquitectura civil", 1], ["Obra pública", 1], ["Sin tipología", 2]],
    );
    const column = repo.column(columnId);
    assert.ok(filterOperators(column).includes("part_of"));
    const find = (op: string, value: string | string[] = []) =>
      repo.literal({ databaseIds: [databaseId], filters: [{ columnId, op: op as never, value }], limit: 10 }).rows.map((r) => ids.indexOf(r.id)).sort();
    assert.deepEqual(find("part_of", [whole]), [0, 1]);
    assert.deepEqual(find("heritage_group", ["public-works"]), [2]);
    assert.deepEqual(find("heritage_type", ["civil/palace"]), [0]);
    assert.deepEqual(find("heritage_unlinked"), [0, 1, 2]);
    repo.db
      .prepare("INSERT INTO image_annotations(id,asset_id,row_id,x,y,w,h,note,tags_json,color,created_at,updated_at,kind,option_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("mark-2", "asset-2", ids[2], 0.5, 0.5, 0, 0, "", "[]", null, "x", "x", "point", bridge);
    assert.deepEqual(find("heritage_marked"), [2]);
    // A plain multi-select does not offer heritage conditions.
    repo.updateColumn(columnId, undefined, { ...column.config, heritage: false });
    assert.ok(!filterOperators(repo.column(columnId)).includes("part_of"));
  }));

test("a vision model's answer is read leniently and matched with the property's elements", async () => {
  const { parseSuggestions, matchSuggestion, knownForRecord, heritageSuggestPrompt } = await import("../shared/heritage");
  const raw = 'Here you go:\n[{"name":"Catedral de Villaverde","place":"Villaverde","confidence":"high"},"Puente Viejo",{"name":"catedral de villaverde"},{"x":1}]';
  assert.deepEqual(parseSuggestions(raw), [
    { name: "Catedral de Villaverde", place: "Villaverde", confidence: "high" },
    { name: "Puente Viejo", place: null, confidence: "medium" },
  ]);
  assert.deepEqual(parseSuggestions("no JSON here"), []);
  // The place keeps only the town: models add the region or the country.
  assert.deepEqual(
    parseSuggestions('[{"name":"Puente Viejo","place":"Villaverde, Spain"},{"name":"Torre","place":"Villaverde (Provincia)"},{"name":"Fuente","place":" , Spain"}]').map((s) => s.place),
    ["Villaverde", "Villaverde", null],
  );
  assert.match(heritageSuggestPrompt([], false), /only the town or city, without region or country/);
  const options = [
    { id: "a", label: "Catedral - Villaverde" },
    { id: "b", label: "Puente Viejo - Villaverde" },
    { id: "c", label: "Catedral - Otraparte" },
  ];
  assert.equal(matchSuggestion({ name: "Catedral de Villaverde", place: "Villaverde" }, options), "a");
  assert.equal(matchSuggestion({ name: "Puente Viejo", place: null }, options), "b");
  assert.equal(matchSuggestion({ name: "Catedral", place: null }, options), null);
  assert.equal(matchSuggestion({ name: "Torre Nueva", place: "Villaverde" }, options), null);
  assert.deepEqual(knownForRecord(options, "Vista de Villaverde desde el río"), ["Catedral - Villaverde", "Puente Viejo - Villaverde"]);
  assert.match(heritageSuggestPrompt(["Catedral - Villaverde"], true), /detail cut out[\s\S]*Catedral - Villaverde[\s\S]*JSON array/);
});

test("an element's name gives its typology when Wikidata does not, and OpenStreetMap places what Wikidata lacks", async () => {
  const { typeFromName, rankOsm } = await import("../shared/heritage");
  assert.deepEqual(typeFromName("Castillo de Fulanito - Villaverde"), { group: "defensive", type: "castle" });
  assert.deepEqual(typeFromName("Colegiata - Villaverde"), { group: "religious", type: "church" });
  assert.deepEqual(typeFromName("Convento de las Monjas - Villaverde"), { group: "religious", type: "monastery" });
  assert.deepEqual(typeFromName("Plaza de toros - Villaverde"), { group: "civil", type: "bullring" });
  assert.deepEqual(typeFromName("Plaza Mayor - Villaverde"), { group: "urban", type: "square" });
  assert.deepEqual(typeFromName("Retrato de dama - Velázquez - Museo Y"), { group: "artworks", type: "painting" });
  assert.equal(typeFromName("Café Central - Villaverde"), null);
  // Every icon of the religious group is the church.
  assert.ok(DEFAULT_HERITAGE_SCHEME.groups.find((g) => g.key === "religious")!.types.every((x) => !x.icon));
  const answer = [
    { lat: "40.001", lon: "-3.001", osm_type: "way", osm_id: 7, name: "Calle Mayor", display_name: "Calle Mayor, Villaverde, España", category: "highway", type: "residential" },
    { lat: "43", lon: "-8", osm_type: "way", osm_id: 8, name: "Calle Mayor", display_name: "Calle Mayor, Lejos, España", category: "highway", type: "residential" },
  ];
  const ranked = rankOsm("Calle Mayor - Villaverde", answer, { latitude: 40, longitude: -3 });
  assert.deepEqual(ranked.map((c) => [c.osm, c.confidence, c.type]), [["way/7", "high", "street"]]);
});

test("typologies by name and places from OpenStreetMap are applied where missing and revert as a batch", () =>
  withCatalogue(({ heritage, columnId, option }) => {
    const [whole, bridge] = [option("Conjunto - Villaverde"), option("Puente Viejo - Villaverde")];
    heritage.save(columnId, [element(whole, { group: "civil", type: "palace" })]);
    const named = heritage.inferTypes(columnId);
    assert.equal(heritage.elements(columnId)[bridge].type, "bridge");
    assert.equal(heritage.elements(columnId)[whole].type, "palace");
    const placed = heritage.applyPlaces(columnId, [{ optionId: bridge, latitude: 41, longitude: -4, osm: "way/12" }]);
    assert.deepEqual(
      { ...heritage.elements(columnId)[bridge] },
      { optionId: bridge, parentId: null, group: "public-works", type: "bridge", latitude: 41, longitude: -4, coordSource: "osm", osm: "way/12" },
    );
    // A town's centre only fills what has no position, and a precise place replaces it.
    const whole2 = option("Patio - Villaverde");
    const town = heritage.applyPlaces(columnId, [
      { optionId: whole2, latitude: 40, longitude: -3, town: true },
      { optionId: bridge, latitude: 40, longitude: -3, town: true },
    ]);
    assert.equal(heritage.elements(columnId)[whole2].coordSource, "town");
    assert.equal(heritage.elements(columnId)[bridge].coordSource, "osm");
    heritage.applyPlaces(columnId, [{ optionId: whole2, latitude: 40.5, longitude: -3.5, osm: "node/9" }]);
    assert.deepEqual([heritage.elements(columnId)[whole2].coordSource, heritage.elements(columnId)[whole2].latitude], ["osm", 40.5]);
    void town;
    heritage.revertBatch(placed.id);
    assert.equal(heritage.elements(columnId)[bridge].latitude, null);
    heritage.revertBatch(named.id);
    assert.equal(heritage.elements(columnId)[bridge], undefined);
  }));

test("town names are read together: a district inside another town of the list is not the town", async () => {
  const { resolveTowns } = await import("../shared/heritage");
  const capital = { name: "Capital", countryCode: "ES", latitude: 40.4, longitude: -3.7 };
  const district = { name: "Villaverde", countryCode: "ES", latitude: 40.43, longitude: -3.68 };
  const town = { name: "Villaverde", countryCode: "ES", latitude: 40.96, longitude: -5.66 };
  const abroad = { name: "Villaverde", countryCode: "PE", latitude: -8.1, longitude: -79 };
  const towns = resolveTowns([
    { id: "a", town: "Capital", found: [capital] },
    { id: "b", town: "Villaverde", found: [district, town, abroad] },
    { id: "c", town: "Nowhere", found: [] },
    // The Spanish town is missing from the gazetteer: its namesake on another continent is not it.
    { id: "d", town: "San Ulpio", found: [{ name: "San Ulpio", countryCode: "GT", latitude: 14.56, longitude: -91.65 }] },
    // A town abroad but near the collection (a trip to Italy) is still placed.
    { id: "e", town: "Lucca", found: [{ name: "Lucca", countryCode: "IT", latitude: 43.84, longitude: 10.5 }] },
    // A name that only contains the text is another place; an official double name is the town.
    { id: "f", town: "Ulme", found: [{ name: "Ulmeda", countryCode: "US", latitude: 33.1, longitude: -117.1 }, { name: "Ulmesto", countryCode: "ES", latitude: 41.1, longitude: -4.9 }] },
    {
      id: "g",
      town: "San Ulpio",
      found: [
        { name: "San Ulpio", countryCode: "GT", latitude: 14.56, longitude: -91.65 },
        { name: "San Ulpio de los Reyes", countryCode: "ES", latitude: 40.55, longitude: -3.62 },
        { name: "Itzaina / San Ulpio", countryCode: "ES", latitude: 43.32, longitude: -1.98 },
      ],
    },
  ]);
  assert.deepEqual(towns.get("a"), { latitude: 40.4, longitude: -3.7 });
  assert.deepEqual(towns.get("b"), { latitude: 40.96, longitude: -5.66 });
  assert.equal(towns.get("c"), null);
  assert.equal(towns.get("d"), null);
  assert.deepEqual(towns.get("e"), { latitude: 43.84, longitude: 10.5 });
  assert.equal(towns.get("f"), null);
  assert.deepEqual(towns.get("g"), { latitude: 43.32, longitude: -1.98 });
  // A batch where no town is in the gazetteer by its name has no country:
  // its towns stay unplaced instead of the lookup failing.
  const none = resolveTowns([
    { id: "h", town: "Villaverde, Spain", found: [district, town] },
    { id: "i", town: null, found: [] },
    { id: "j", town: "Nowhere", found: [{ name: "Nowhere Creek", countryCode: "US", latitude: 30, longitude: -90 }] },
  ]);
  assert.deepEqual([...none.values()], [null, null, null]);
});

test("background searches pause where a service fails or Imago closes, resume there, and their proposals apply and revert", () =>
  withCatalogue(async ({ repo, heritage, columnId, option, root }) => {
    const { Images } = await import("../electron/import/images");
    const { Models } = await import("../electron/ai/models");
    const { InferenceHost } = await import("../electron/ai/host");
    const { Engine } = await import("../electron/ai/engine");
    const { JobQueue } = await import("../electron/jobs");
    const { HeritageNetworkError } = await import("../electron/heritage/finder");
    const models = new Models(repo);
    const queue = new JobQueue(repo, new Images(repo), models, new Engine(repo, models, new InferenceHost(repo, "unused")), () => {});
    const items = heritage.pendingItems(columnId, "wikidata");
    assert.equal(items.length, 3);
    // The second element meets a service that is down.
    let down = true;
    const seen: string[] = [];
    queue.heritageOne = async (payload, index) => {
      const item = payload.items[index];
      if (index === 1 && down) throw new HeritageNetworkError("No se pudo conectar con Wikidata.");
      seen.push(item.label);
      heritage.saveProposal(payload.columnId, item.optionId, "wikidata", null, [
        { link: link(`Q${100 + index}`, item.label, { coordinates: { latitude: 40, longitude: -3 } }), confidence: "high", score: 9 },
      ], true);
      return "imported";
    };
    const id = repo.newJob("heritage", { columnId, source: "wikidata", items, label: "x" }, items.length);
    const job = () => repo.db.prepare("SELECT state,done,message FROM jobs WHERE id=?").get(id) as { state: string; done: number; message: string };
    const settle = async (state: string) => {
      const deadline = Date.now() + 5000;
      while (job().state !== state) {
        if (Date.now() > deadline) throw new Error(`job stayed ${job().state}`);
        await new Promise((r) => setTimeout(r, 5));
      }
    };
    queue.pump();
    await settle("paused");
    assert.deepEqual([job().done, seen.length], [1, 1]);
    assert.match(job().message, /Pausada/);
    // Resumed when the service is back: it continues at the second element.
    down = false;
    queue.control(id, "resume");
    await settle("completed");
    assert.equal(seen.length, 3);
    assert.equal(heritage.proposals(columnId, "wikidata").length, 3);
    // A search running when Imago closes is paused, not restarted on its own.
    const again = repo.newJob("heritage", { columnId, source: "osm", items, label: "y" }, items.length);
    repo.db.prepare("UPDATE jobs SET state='running' WHERE id=?").run(again);
    const reopened = new Repository(root);
    assert.equal((reopened.db.prepare("SELECT state FROM jobs WHERE id=?").get(again) as { state: string }).state, "paused");
    reopened.close();
    // Reviewing: one declined, the rest applied as one revertible batch.
    const [first, ...rest] = heritage.proposals(columnId, "wikidata");
    heritage.updateProposal(first.id, { accepted: false });
    const batch = heritage.applyProposals(columnId, "wikidata")!;
    assert.equal(batch.applied, 2);
    assert.equal(heritage.proposals(columnId, "wikidata").length, 1);
    assert.equal(heritage.elements(columnId)[rest[0].optionId].coordSource, "wikidata");
    heritage.revertBatch(batch.id);
    assert.equal(heritage.elements(columnId)[rest[0].optionId]?.latitude ?? null, null);
    void option;
    await queue.close();
  }));

test("the artist of a work is not its town", async () => {
  const { heritageTown } = await import("../shared/heritage");
  assert.equal(heritageTown("Retrato de dama - Velázquez"), null);
  assert.equal(heritageTown("Retrato de dama - Goya - Villaverde"), "Villaverde");
  assert.equal(heritageTown("Catedral - Villaverde"), "Villaverde");
  assert.equal(heritageTown("Mirador del Ulmo"), null);
});

test("the artist says what kind of work it is", async () => {
  const { typeFromName } = await import("../shared/heritage");
  assert.deepEqual(typeFromName("Virgen del Ulmo - Zurbarán"), { group: "artworks", type: "painting" });
  assert.deepEqual(typeFromName("Virgen del Ulmo - Salzillo"), { group: "artworks", type: "sculpture" });
  assert.deepEqual(typeFromName("Virgen del Ulmo"), { group: "artworks", type: "sculpture" });
});

test("a town looked up in OpenStreetMap is a settlement called so, not a named spot or a café", async () => {
  const { pickSettlement } = await import("../shared/heritage");
  const answer = [
    { name: "Villafría", lat: "41.67", lon: "-3.94", type: "locality", addresstype: "locality" },
    { name: "Villafría.", lat: "39.47", lon: "-0.38", type: "cafe", addresstype: "amenity" },
    { name: "Villafría", lat: "42.61", lon: "-1.05", type: "hamlet", addresstype: "hamlet" },
  ];
  assert.deepEqual(pickSettlement(answer, "Villafría"), { latitude: 42.61, longitude: -1.05 });
  assert.equal(pickSettlement(answer.slice(0, 2), "Villafría"), null);
});

test("the finder ranks Wikidata answers and pauses on unreachable services", async () => {
  const { HeritageFinder, HeritageNetworkError } = await import("../electron/heritage/finder");
  const places = { search: (q: string) => (q === "Villaverde" ? [{ gazetteerId: "g:1", name: "Villaverde", admin1: "", countryCode: "ES", country: "España", latitude: 40, longitude: -3, population: 1 }] : []) };
  const answer = (url: string) => {
    if (url.includes("list=search")) return { query: { search: [{ title: "Q1" }] } };
    if (url.includes("wbsearchentities")) return { search: [{ id: "Q1" }, { id: "Q2" }] };
    if (url.includes("wbgetentities") && url.includes("props=claims%7Clabels")) return { entities: {
      Q1: { labels: { es: { value: "Castillo de Villaverde" } }, descriptions: { es: { value: "castillo en Villaverde" } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q23413" } } } }], P625: [{ mainsnak: { datavalue: { value: { latitude: 40.01, longitude: -3.01 } } } }] } },
      Q2: { labels: { es: { value: "Calle del Castillo" } }, descriptions: { es: { value: "calle" } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q79007" } } } }] } },
    } };
    return { entities: {} };
  };
  const finder = new HeritageFinder(() => places, (async (url: string) => new Response(JSON.stringify(answer(url)))) as typeof fetch);
  const items = [{ optionId: "a", label: "Castillo - Villaverde" }];
  const towns = await finder.towns(items, false);
  const [found] = await finder.wikidata(items, "es", towns);
  assert.deepEqual([found.candidates[0].link.id, found.candidates[0].confidence], ["Q1", "high"]);
  const offline = new HeritageFinder(() => places, (async () => {
    throw new Error("offline");
  }) as typeof fetch);
  await assert.rejects(offline.wikidata(items, "es", towns), (e: unknown) => e instanceof HeritageNetworkError && (e as { pause: boolean }).pause);
});

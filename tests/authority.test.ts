// Authority links: reading Wikidata and Iconclass answers, keeping the links
// of a property's options, placing records from linked places, and exports.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  authorityExportText,
  fitsKind,
  iconclassSearchUrl,
  rankIconclass,
  parseIconclassItem,
  parseIconclassSearch,
  parseWikidataEntities,
  parseWikidataSearch,
  wikidataEntitiesUrl,
  wikidataSearchUrl,
} from "../shared/authority";
import { decodeDatabaseLocation } from "../shared/databaseProperties";
import { databaseToCsv } from "../shared/databaseExport";
import { Repository } from "../electron/db/repository";
import { Authorities } from "../electron/db/authorities";

const entities = {
  entities: {
    Q5598: {
      labels: { es: { value: "Rembrandt" } },
      descriptions: { es: { value: "pintor neerlandés" } },
      claims: {
        P31: [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }],
        P245: [{ mainsnak: { datavalue: { value: "500011051" } } }],
        P569: [{ mainsnak: { datavalue: { value: { time: "+1606-07-15T00:00:00Z" } } } }],
        P570: [{ mainsnak: { datavalue: { value: { time: "+1669-10-04T00:00:00Z" } } } }],
      },
    },
    Q8717: {
      labels: { en: { value: "Seville" } },
      descriptions: {},
      claims: {
        P1667: [{ mainsnak: { datavalue: { value: "7008746" } } }],
        P625: [{ mainsnak: { datavalue: { value: { latitude: 37.3828, longitude: -5.9731 } } } }],
      },
    },
    Q404: { missing: "" },
  },
};

test("Wikidata and Iconclass answers become candidates with their identifiers", () => {
  assert.match(wikidataSearchUrl("Rembrandt", "es"), /action=wbsearchentities&search=Rembrandt&language=es/);
  assert.match(wikidataEntitiesUrl(["Q1", "x", "Q2"], "es"), /ids=Q1%7CQ2&/);
  assert.match(iconclassSearchUrl("procession"), /lang=en/);
  assert.deepEqual(parseWikidataSearch({ search: [{ id: "Q5598" }, { id: "P31" }, { id: "Q8717" }] }), ["Q5598", "Q8717"]);
  const [painter, city] = parseWikidataEntities(entities, ["Q5598", "Q8717", "Q404"], "es");
  assert.deepEqual(
    { kind: painter.kind, ulan: painter.ulan, born: painter.born, died: painter.died, uri: painter.uri, description: painter.description },
    { kind: "person", ulan: "500011051", born: 1606, died: 1669, uri: "https://www.wikidata.org/wiki/Q5598", description: "pintor neerlandés" },
  );
  assert.deepEqual({ kind: city.kind, label: city.label, tgn: city.tgn, coordinates: city.coordinates }, { kind: "place", label: "Seville", tgn: "7008746", coordinates: { latitude: 37.3828, longitude: -5.9731 } });
  assert.ok(fitsKind(painter, "person") && !fitsKind(city, "person") && fitsKind(city, "place") && fitsKind(city, "subject"));
  assert.deepEqual(parseIconclassSearch({ result: ["47C6111", "<script>", "11Q71", "47C311(+53)", "42E22"] }), ["11Q71", "42E22", "47C6111"]);
  const ranked = rankIconclass(
    [
      { source: "iconclass", id: "47C6111", label: "pouring into (industrial process)", description: null, uri: "https://iconclass.org/47C6111" },
      { source: "iconclass", id: "42E22", label: "cortege, funeral procession", description: null, uri: "https://iconclass.org/42E22" },
    ],
    "procession",
  );
  assert.deepEqual(ranked.map((r) => r.id), ["42E22"]);
  const item = parseIconclassItem({ n: "11Q71", txt: { en: "Christian churches", de: "Kirchen" } })!;
  assert.deepEqual({ label: item.label, uri: item.uri }, { label: "Christian churches", uri: "https://iconclass.org/11Q71" });
  assert.equal(authorityExportText(painter), "https://www.wikidata.org/wiki/Q5598 · ULAN 500011051");
});

test("links survive editing the options, place records on the map and go into exports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-authority-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv(
      "Fotos",
      ["ID", "Lugar", "Autor"],
      ["title", "select", "select"],
      [["1", "Sevilla", "Ana"], ["2", "Sevilla", "Ana"], ["3", "Granada", "Luis"], ["4", "", "Luis"]],
    );
    const [, place] = repo.detail(detail.database.id).columns;
    const authorities = new Authorities(repo);
    const [sevilla, granada] = ["Sevilla", "Granada"].map((label) => place.options.find((o) => o.label === label)!);
    const [, city] = parseWikidataEntities(entities, ["Q5598", "Q8717"], "es");
    authorities.set(place.id, [{ optionId: sevilla.id, link: city }]);
    assert.throws(() => authorities.set(place.id, [{ optionId: granada.id, link: { ...city, uri: "https://evil.example/Q1" } }]), /no válido/);
    // Renaming the options keeps their links.
    repo.saveOptions(place.id, place.options.map((o) => ({ id: o.id, label: o.label === "Sevilla" ? "Sevilla (ciudad)" : o.label, color: o.color })));
    assert.equal(authorities.links(place.id)[sevilla.id].id, "Q8717");
    const { columnId, located } = authorities.locate(place.id, "Ubicación");
    assert.equal(located, 2);
    const rows = repo.literal({ databaseIds: [detail.database.id], limit: 10 }).rows;
    assert.deepEqual(decodeDatabaseLocation(rows[0].cells[columnId] ?? null), { name: "Sevilla (ciudad)", address: null, latitude: 37.3828, longitude: -5.9731 });
    assert.equal(rows[2].cells[columnId] ?? null, null);
    repo.undo();
    assert.equal(repo.literal({ databaseIds: [detail.database.id], limit: 10 }).rows[0].cells[columnId] ?? null, null);
    // The export gains a column with the URI and the Getty identifier.
    const current = repo.detail(detail.database.id);
    const exported = authorities.exportColumns(current.columns, repo.literal({ databaseIds: [detail.database.id], limit: 10 }).rows);
    const csv = databaseToCsv(exported.columns, exported.rows).split("\r\n");
    assert.match(csv[0], /^ID,Lugar,Lugar · URI,Autor/);
    assert.match(csv[1], /Sevilla \(ciudad\),https:\/\/www\.wikidata\.org\/wiki\/Q8717 · TGN 7008746,Ana/);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

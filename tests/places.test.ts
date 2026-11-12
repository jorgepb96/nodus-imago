import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Gazetteer } from "../electron/geo/gazetteer";
import { isMapTileRequest } from "../electron/geo/mapRequests";
import { validCoordinates } from "../shared/places";
import {
  encodeDatabaseLocation,
  decodeDatabaseLocation,
} from "../shared/databaseProperties";
import { validateCommand } from "../shared/validation";

test("same genealogy gazetteer resolves accented and ambiguous towns completely offline", () => {
  const catalogue = new Gazetteer(
    path.resolve("electron/assets/gazetteer/cities.tsv.gz"),
  );
  const granada = catalogue.search("Granada")[0];
  assert.equal(granada.gazetteerId, "geonames:2517117");
  assert.equal(granada.countryCode, "ES");
  assert.ok(validCoordinates(granada));
  assert.equal(
    catalogue.search("Malaga")[0].gazetteerId,
    catalogue.search("Málaga")[0].gazetteerId,
  );
  const parises = catalogue.search("Paris");
  assert.equal(parises[0].countryCode, "FR");
  assert.ok(parises.some((place) => place.countryCode === "US"));
  assert.ok(
    catalogue
      .search("Paris, France")
      .every((place) => place.countryCode === "FR"),
  );
  assert.deepEqual(catalogue.search("qzxxvvnonexistent"), []);
  assert.deepEqual(catalogue.search("a"), []);
});

test("locations retain source, coordinates and custom text through their storage codec", () => {
  const value = {
    name: "Granada",
    address: "Andalusia, Spain",
    gazetteerId: "geonames:2517117",
    latitude: 37.18817,
    longitude: -3.60667,
  };
  assert.deepEqual(
    decodeDatabaseLocation(encodeDatabaseLocation(value)),
    value,
  );
  assert.equal(
    decodeDatabaseLocation("Finca de la familia")?.name,
    "Finca de la familia",
  );
  assert.equal(encodeDatabaseLocation({ name: "  " }), null);
  assert.ok(validCoordinates({ latitude: 0, longitude: 0 }));
  assert.ok(!validCoordinates({ latitude: 91, longitude: 0 }));
  assert.ok(!validCoordinates({ latitude: 0, longitude: NaN }));
});

test("map exception only permits actual HTTPS tile images; IPC remains bounded", () => {
  assert.ok(
    isMapTileRequest(
      "https://tile.openstreetmap.org/12/2007/1590.png",
      "image",
    ),
  );
  for (const url of [
    "https://tile.openstreetmap.org.evil.org/12/1/1.png",
    "http://tile.openstreetmap.org/12/1/1.png",
    "https://tile.openstreetmap.org/12/1/1.png?private=data",
    "https://tile.openstreetmap.org/search",
  ]) {
    assert.ok(!isMapTileRequest(url, "image"));
  }
  assert.ok(
    !isMapTileRequest("https://tile.openstreetmap.org/12/1/1.png", "script"),
  );
  assert.ok(
    !isMapTileRequest("https://tile.openstreetmap.org/12/1/1.png", "xhr"),
  );
  assert.throws(() =>
    validateCommand("searchPlaces", { query: "a".repeat(201) }),
  );
  assert.throws(() =>
    validateCommand("searchPlaces", { query: "Madrid", file: "/etc/passwd" }),
  );
  assert.throws(() =>
    validateCommand("openMapAttribution", { url: "https://evil.org" }),
  );
});

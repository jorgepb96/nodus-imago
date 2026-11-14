// Historical dates: how catalogue dates are read, stored, filtered, sorted
// and placed on the timeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  decodeHistoricalDate,
  encodeHistoricalDate,
  looksHistoricalDate,
  normalizeHistoricalDate,
  overlaps,
  parseHistoricalDate,
  periodLabel,
  representativeYear,
} from "../shared/historicalDate";
import { suggestColumn } from "../shared/databaseCsv";
import { yearOf } from "../shared/statistics";
import { Repository } from "../electron/db/repository";

test("catalogue dates are read as a period with a certainty", () => {
  const cases: [string, number | null, number | null, string][] = [
    ["1930", 1930, 1930, "exact"],
    ["12/05/1931", 1931, 1931, "exact"],
    ["1931-05-12", 1931, 1931, "exact"],
    ["c. 1930", 1925, 1935, "approx"],
    ["ca. 1930", 1925, 1935, "approx"],
    ["Hacia 1920", 1915, 1925, "approx"],
    ["h. 1920", 1915, 1925, "approx"],
    ["circa 1900", 1895, 1905, "approx"],
    ["[1930]", 1930, 1930, "inferred"],
    ["1930?", 1930, 1930, "uncertain"],
    ["[1930?]", 1930, 1930, "uncertain"],
    ["1930-1935", 1930, 1935, "exact"],
    ["1930–35", 1930, 1935, "exact"],
    ["entre 1930 y 1935", 1930, 1935, "exact"],
    ["c. 1930-1935", 1930, 1935, "approx"],
    ["ant. 1936", null, 1936, "approx"],
    ["antes de 1936", null, 1936, "approx"],
    ["post. 1920", 1920, null, "approx"],
    ["después de 1920", 1920, null, "approx"],
    ["años 50", 1950, 1959, "approx"],
    ["años cincuenta", 1950, 1959, "approx"],
    ["década de 1950", 1950, 1959, "approx"],
    ["1950s", 1950, 1959, "approx"],
    ["s. XIX", 1801, 1900, "approx"],
    ["siglo XX", 1901, 2000, "approx"],
    ["finales del s. XIX", 1867, 1900, "approx"],
    ["principios del siglo XX", 1901, 1933, "approx"],
    ["mediados del s. XX", 1934, 1966, "approx"],
    ["primera mitad del s. XX", 1901, 1950, "approx"],
    ["segunda mitad del siglo XIX", 1851, 1900, "approx"],
    ["early 20th century", 1901, 1933, "approx"],
    ["before 1936", null, 1936, "approx"],
  ];
  for (const [text, start, end, certainty] of cases)
    assert.deepEqual(parseHistoricalDate(text), { start, end, certainty }, text);
  for (const empty of ["", "s.d.", "s/f", "sin fecha", "-", "?", "véase reverso"])
    assert.equal(parseHistoricalDate(empty), null, empty);
});

test("the text is kept as written; a manual period survives until the text changes", () => {
  const stored = normalizeHistoricalDate("  c. 1930 ")!;
  assert.deepEqual(decodeHistoricalDate(stored), { text: "c. 1930", start: 1925, end: 1935, certainty: "approx" });
  const manual = encodeHistoricalDate({ text: "c. 1930", start: 1928, end: 1931, certainty: "inferred", manual: true });
  assert.deepEqual(decodeHistoricalDate(normalizeHistoricalDate(manual)), {
    text: "c. 1930", start: 1928, end: 1931, certainty: "inferred", manual: true,
  });
  // Writing the text again reads it again.
  assert.equal(decodeHistoricalDate(normalizeHistoricalDate("c. 1930"))!.start, 1925);
  // Text with no year is kept, with no period.
  assert.deepEqual(decodeHistoricalDate(normalizeHistoricalDate("véase reverso")), {
    text: "véase reverso", start: null, end: null, certainty: "exact",
  });
  assert.throws(() => normalizeHistoricalDate(encodeHistoricalDate({ text: "x", start: 1940, end: 1930, certainty: "exact", manual: true })), /anterior/);
  assert.equal(representativeYear({ start: 1925, end: 1935 }), 1930);
  assert.equal(representativeYear({ start: null, end: 1936 }), 1936);
  assert.equal(periodLabel({ start: 1925, end: 1935 }), "1925–1935");
  assert.equal(periodLabel({ start: null, end: 1936 }), "hasta 1936");
  assert.equal(overlaps({ start: 1925, end: 1935 }, 1934, 1940), true);
  assert.equal(overlaps({ start: null, end: 1936 }, 1900, 1901), true);
  assert.equal(overlaps({ start: 1925, end: 1935 }, 1936, 1940), false);
  assert.equal(yearOf({ type: "historical_date" }, stored), 1930);
});

test("a CSV column of catalogue dates is suggested as a historical date", () => {
  const values = ["1930", "c. 1935", "[1940]", "1950?", "años 50", "1931", "1932", "s. XIX", "1933", "1934"];
  assert.equal(looksHistoricalDate(values), true);
  assert.equal(suggestColumn("Fecha", values, 2).type, "historical_date");
  // Plain years stay numbers.
  assert.equal(suggestColumn("Año", ["1930", "1931", "1932", "1933"], 2).type, "number");
});

test("filters, sorting and conversion use the period", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-historical-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv(
      "Postales",
      ["ID", "Fecha"],
      ["title", "text"],
      [["A", "c. 1930"], ["B", "ant. 1936"], ["C", "1950"], ["D", "s. XIX"], ["E", "sin fecha"], ["F", "[1941]"]],
    );
    const date = detail.columns[1];
    assert.deepEqual(repo.convertColumn(date.id, "historical_date", false), { total: 6, lost: 0 });
    repo.convertColumn(date.id, "historical_date", true);
    const ids = (filter: object) =>
      repo
        .literal({ databaseIds: [detail.database.id], filters: [{ columnId: date.id, ...filter } as never], limit: 50 })
        .rows.map((r) => r.title)
        .sort();
    assert.deepEqual(ids({ op: "between", value: ["1931", "1940"] }), ["A", "B"]);
    assert.deepEqual(ids({ op: "equals", value: "1935" }), ["A", "B"]);
    assert.deepEqual(ids({ op: "lt", value: "1901" }), ["D"]);
    assert.deepEqual(ids({ op: "gt", value: "1940" }), ["C", "F"]);
    // A text with no readable year has no period: "empty" finds the undated records.
    assert.deepEqual(ids({ op: "empty", value: "" }), ["E"]);
    const sorted = repo
      .literal({ databaseIds: [detail.database.id], sorts: [{ columnId: date.id, direction: "asc" }], limit: 50 })
      .rows.map((r) => r.title);
    assert.deepEqual(sorted, ["B", "D", "A", "F", "C", "E"]);
    // Text is shown as written in the table and in exports.
    const row = repo.literal({ databaseIds: [detail.database.id], limit: 50 }).rows.find((r) => r.title === "F")!;
    assert.deepEqual(decodeHistoricalDate(row.cells[date.id]), { text: "[1941]", start: 1941, end: 1941, certainty: "inferred" });
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

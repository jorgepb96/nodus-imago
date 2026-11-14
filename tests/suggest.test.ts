// Completing records from similar images.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { NeighbourSuggestions, weightedQuantile } from "../electron/db/suggest";
import { decodeHistoricalDate } from "../shared/historicalDate";

test("dates and options are proposed from the closest dated images, and one undo reverts them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-suggest-")),
    repo = new Repository(root);
  try {
    // Group A (around 1930, "Sevilla") and group B (around 1960, "Granada"); X and Y lack both.
    const rows = [
      ["A1", "1928", "Sevilla"], ["A2", "1930", "Sevilla"], ["A3", "c. 1931", "Sevilla"], ["A4", "1932", "Sevilla"],
      ["B1", "1958", "Granada"], ["B2", "1960", "Granada"], ["B3", "1961", "Granada"], ["B4", "1963", "Granada"],
      ["X", "", ""], ["Y", "", ""],
    ];
    const detail = repo.importCsv("Postales", ["ID", "Fecha", "Lugar"], ["title", "historical_date", "select"], rows);
    const [, date, place] = detail.columns;
    repo.db.prepare("INSERT INTO db_columns(id,database_id,name,type,position,config_json,created_at,updated_at) VALUES('img',?,'Imagen','files',9,'{}','x','x')").run(detail.database.id);
    const ids = new Map((repo.db.prepare("SELECT r.id,c.value_text t FROM db_rows r JOIN db_cells c ON c.row_id=r.id AND c.column_id=?").all(detail.columns[0].id) as { id: string; t: string }[]).map((r) => [r.t, r.id]));
    const vector = (group: "A" | "B", jitter: number) => {
      const v = new Float32Array(8);
      v[group === "A" ? 0 : 1] = 1;
      v[2] = jitter;
      const norm = Math.hypot(...v);
      return Buffer.from(v.map((x) => x / norm).buffer);
    };
    const add = (title: string, group: "A" | "B", jitter: number) => {
      const hash = "h-" + title;
      repo.db
        .prepare("INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run("a-" + title, detail.database.id, ids.get(title), "img", title + ".jpg", "/none", 0, hash, 1, 10, 10, "{}", null, 0, "x");
      repo.db.prepare("INSERT INTO embeddings VALUES(?,?,?)").run(hash, "test", vector(group, jitter));
    };
    ["A1", "A2", "A3", "A4"].forEach((t, i) => add(t, "A", i * 0.05));
    ["B1", "B2", "B3", "B4"].forEach((t, i) => add(t, "B", i * 0.05));
    add("X", "A", 0.02);
    add("Y", "B", 0.03);
    const suggestions = new NeighbourSuggestions(repo, () => "test");

    const dates = suggestions.suggest({ databaseId: detail.database.id, columnId: date.id });
    assert.deepEqual([dates.missing, dates.known, dates.withVectors], [2, 8, 10]);
    const x = dates.items.find((i) => i.title === "X")!;
    const y = dates.items.find((i) => i.title === "Y")!;
    assert.equal(x.evidence[0].value.startsWith("19"), true);
    // X looks like group A: an attributed period within 1928–1932.
    const xDate = decodeHistoricalDate(x.value)!;
    assert.equal(xDate.certainty, "inferred");
    assert.ok(xDate.start! >= 1928 && xDate.end! <= 1932, x.display);
    assert.match(x.display, /^\[19(2|3)\d(–19\d\d)?\]$/);
    assert.ok(decodeHistoricalDate(y.value)!.start! >= 1958);

    const places = suggestions.suggest({ databaseId: detail.database.id, columnId: place.id });
    const xPlace = places.items.find((i) => i.title === "X")!;
    assert.equal(xPlace.display, "Sevilla");
    assert.equal(places.items.find((i) => i.title === "Y")!.display, "Granada");
    assert.ok(xPlace.confidence > 0.5);

    // Accepting in bulk is one undoable change.
    suggestions.apply([
      { rowId: ids.get("X")!, columnId: date.id, value: x.value },
      { rowId: ids.get("X")!, columnId: place.id, value: xPlace.value },
    ]);
    assert.equal(decodeHistoricalDate(repo.getRow(ids.get("X")!).cells[date.id])!.text, x.display);
    assert.equal(repo.undo(), 2);
    assert.equal(repo.getRow(ids.get("X")!).cells[date.id] ?? null, null);
    assert.equal(repo.getRow(ids.get("X")!).cells[place.id] ?? null, null);
    assert.throws(() => new NeighbourSuggestions(repo, () => null).suggest({ databaseId: detail.database.id, columnId: date.id }), /Indexa/);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("weighted quantiles", () => {
  assert.equal(weightedQuantile([[1930, 1], [1950, 1], [1960, 2]], 0.5), 1950);
  assert.equal(weightedQuantile([[1930, 5], [1950, 1]], 0.5), 1930);
});

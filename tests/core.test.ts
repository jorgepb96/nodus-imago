import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Repository } from "../electron/db/repository";
import { parseCsv } from "../shared/csvParser";
import { buildCsvImportPlan } from "../shared/databaseCsv";
import {
  databaseToCsv,
  databaseToJson,
  tableToCsv,
} from "../shared/databaseExport";
import { decodeMultiSelect } from "../shared/databases";
import { matchImages } from "../shared/imageMatching";
import { normalizeVector, fuseRanks } from "../shared/vectors";
import { validateCommand } from "../shared/validation";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-core-"));
  const repo = new Repository(root);
  return {
    repo,
    root,
    close: () => {
      repo.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
test("Nodus codecs and CSV import preserve typed multi-select options and identifiers", () => {
  const f = fixture();
  try {
    const csv =
      'ID;Descripción;Categorías;Año\n001;"Familia; en el patio";"Paisaje, Patrimonio";1945\n002;Retrato;"Patrimonio, Costumbres";1950';
    const plan = buildCsvImportPlan(parseCsv(csv));
    assert.equal(plan.rows.length, 2);
    assert.equal(plan.headers.length, 4);
    const d = f.repo.importCsv(
        "Archivo",
        plan.headers,
        ["title", "text", "multi_select", "number"],
        plan.rows,
      ),
      rows = f.repo.literal({ databaseIds: [d.database.id] }).rows;
    assert.equal(rows[0].title, "001");
    assert.equal(rows[0].cells[d.columns[1].id], "Familia; en el patio");
    assert.equal(d.columns[2].options.length, 3);
    const labels = decodeMultiSelect(rows[0].cells[d.columns[2].id]).map(
      (id) => d.columns[2].options.find((o) => o.id === id)?.label,
    );
    assert.deepEqual(labels, ["Paisaje", "Patrimonio"]);
    const json = JSON.parse(databaseToJson(d.columns, rows));
    assert.equal(json.rows[0].Año, 1945);
    assert.deepEqual(json.rows[0].Categorías, ["Paisaje", "Patrimonio"]);
    assert.ok(databaseToCsv(d.columns, rows).includes("001"));
    assert.equal(
      (f.repo.db.pragma("foreign_key_check") as unknown[]).length,
      0,
    );
  } finally {
    f.close();
  }
});
test("checkbox CSV accepts 1/0 and yes/no but rejects unknown values instead of silently clearing", () => {
  const f = fixture();
  try {
    const d = f.repo.importCsv(
      "Checkboxes",
      ["ID", "Activo"],
      ["title", "checkbox"],
      [
        ["A", "1"],
        ["B", "0"],
        ["C", "yes"],
        ["D", "no"],
      ],
    );
    assert.deepEqual(
      f.repo.literal({ databaseIds: [d.database.id] }).rows.map(
        (row) => row.cells[d.columns[1].id],
      ),
      ["1", "0", "1", "0"],
    );
    assert.throws(
      () =>
        f.repo.importCsv(
          "Bad checkbox",
          ["ID", "Activo"],
          ["title", "checkbox"],
          [["A", "maybe"]],
        ),
      /no se puede importar/,
    );
    assert.equal(f.repo.list().length, 1);
  } finally {
    f.close();
  }
});
test("CSV export neutralises formulas without turning negative numbers into text", () => {
  assert.equal(tableToCsv(["Valor"], [["-5"]]), "Valor\r\n-5");
  assert.equal(tableToCsv(["Valor"], [["-5+1"]]), "Valor\r\n'-5+1");
  assert.equal(tableToCsv(["Valor"], [["=1+1"]]), "Valor\r\n'=1+1");
});
test("failed type override leaves no partial database or silently dropped values", () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.repo.importCsv(
          "Fallida",
          ["Título", "Valor"],
          ["title", "number"],
          [["A", "no es número"]],
        ),
      /no se puede/,
    );
    assert.equal(f.repo.list().length, 0);
  } finally {
    f.close();
  }
});
test("multi-select rejects foreign options, preserves order/color, and refuses removal of used options", () => {
  const f = fixture();
  try {
    const d = f.repo.create("A"),
      c = f.repo.addColumn(d.database.id, "Categorías", "multi_select"),
      r = f.repo.createRow(d.database.id);
    f.repo.saveOptions(c.id, [
      { label: "Patrimonio", color: "#6366f1" },
      { label: "Paisaje", color: "#338866" },
    ]);
    const opts = f.repo.column(c.id).options;
    f.repo.setCell(r.id, c.id, JSON.stringify(opts.map((o) => o.id)));
    assert.throws(() => f.repo.setCell(r.id, c.id, '["foreign"]'), /Opción/);
    f.repo.saveOptions(c.id, [{ ...opts[1], color: "#225544" }, opts[0]]);
    assert.equal(f.repo.column(c.id).options[0].id, opts[1].id);
    assert.equal(f.repo.column(c.id).options[0].color, "#225544");
    assert.throws(() => f.repo.saveOptions(c.id, [opts[0]]), /está en uso/);
    assert.equal(decodeMultiSelect(f.repo.getRow(r.id).cells[c.id]).length, 2);
  } finally {
    f.close();
  }
});
test("literal FTS finds option labels, accents, words, exact phrases, substring and all database scopes", () => {
  const f = fixture();
  try {
    const d = f.repo.importCsv(
      "Archivo",
      ["Título", "Lugar", "Categoría"],
      ["title", "text", "select"],
      [
        ["Familia rural", "Andalucía", "Patrimonio"],
        ["Familia en plaza", "Granada", "Retrato"],
      ],
    );
    f.repo.importCsv("Otro", ["Nombre"], ["title"], [["Andalucía rural"]]);
    assert.equal(f.repo.literal({ query: "andalucia" }).total, 2);
    assert.equal(
      f.repo.literal({ query: "familia rural", match: "phrase" }).total,
      1,
    );
    assert.equal(
      f.repo.literal({ query: "familia plaza", match: "words" }).total,
      1,
    );
    assert.equal(f.repo.literal({ query: "trimo", match: "partial" }).total, 1);
    assert.equal(
      f.repo.literal({ query: "rural", databaseIds: [d.database.id] }).total,
      1,
    );
    assert.equal(f.repo.literal({ query: "rural", databaseIds: [] }).total, 0);
    assert.equal(f.repo.literal({ query: '" OR * NOT \"' }).total, 0);
    assert.equal(f.repo.literal({ query: "%", match: "partial" }).total, 0);
  } finally {
    f.close();
  }
});
test("structured multi-select AND/OR filtering and numeric sorting are applied by SQLite", () => {
  const f = fixture();
  try {
    const d = f.repo.importCsv(
        "A",
        ["ID", "Tags", "Año"],
        ["title", "multi_select", "number"],
        [
          ["A", "Paisaje, Patrimonio", "1940"],
          ["B", "Retrato", "1955"],
          ["C", "Paisaje", "1960"],
        ],
      ),
      tags = d.columns[1],
      year = d.columns[2];
    const opts = tags.options.map((o) => o.id);
    assert.equal(
      f.repo.literal({
        filters: [{ columnId: tags.id, op: "all", value: [opts[0], opts[1]] }],
      }).total,
      1,
    );
    assert.equal(
      f.repo.literal({
        filters: [{ columnId: tags.id, op: "any", value: opts }],
      }).total,
      3,
    );
    const filtered = f.repo.literal({
      filters: [{ columnId: year.id, op: "gte", value: "1950" }],
      sortColumn: year.id,
      descending: true,
    });
    assert.equal(filtered.rows[0].title, "C");
    assert.equal(filtered.total, 2);
  } finally {
    f.close();
  }
});
test("records and FTS survive restart, editing updates search, and cascading delete removes search ghosts", () => {
  const f = fixture();
  const d = f.repo.create("Persistente"),
    title = d.columns[0],
    r = f.repo.createRow(d.database.id);
  f.repo.setCell(r.id, title.id, "Castillo medieval");
  f.repo.close();
  const reopened = new Repository(f.root);
  try {
    assert.equal(reopened.literal({ query: "castillo" }).total, 1);
    reopened.setCell(r.id, title.id, "Vivienda rural");
    assert.equal(reopened.literal({ query: "castillo" }).total, 0);
    assert.equal(reopened.literal({ query: "vivienda" }).total, 1);
    reopened.deleteRows([r.id]);
    assert.equal(reopened.literal({ query: "vivienda" }).total, 0);
  } finally {
    reopened.close();
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test("Nodus formula evaluation recomputes dependent values and undo restores the source", () => {
  const f = fixture();
  try {
    const d = f.repo.create("A"),
      n = f.repo.addColumn(d.database.id, "Número", "number"),
      formula = f.repo.addColumn(d.database.id, "Doble", "formula", {
        formula: {
          kind: "arithmetic",
          op: "multiply",
          operands: [
            { kind: "column", columnId: n.id },
            { kind: "number", value: 2 },
          ],
        },
      }),
      row = f.repo.createRow(d.database.id);
    f.repo.setCell(row.id, n.id, "8");
    assert.equal(f.repo.getRow(row.id).cells[formula.id], "16");
    f.repo.setCell(row.id, n.id, "9");
    assert.equal(f.repo.undo(), 1);
    assert.equal(f.repo.getRow(row.id).cells[formula.id], "16");
  } finally {
    f.close();
  }
});
test("row and column deletion removes orphaned undo history", () => {
  const f = fixture();
  try {
    const d = f.repo.create("A"),
      row = f.repo.createRow(d.database.id),
      column = f.repo.addColumn(d.database.id, "Nota", "text");
    f.repo.db
      .prepare(
        "INSERT INTO history(batch_id,row_id,column_id,before_value,after_value,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run("batch", row.id, column.id, null, "texto", new Date().toISOString());
    f.repo.deleteRows([row.id]);
    assert.equal(f.repo.undo(), 0);
    const row2 = f.repo.createRow(d.database.id);
    f.repo.db
      .prepare(
        "INSERT INTO history(batch_id,row_id,column_id,before_value,after_value,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run("batch2", row2.id, column.id, null, "texto", new Date().toISOString());
    f.repo.deleteColumn(column.id);
    assert.equal(f.repo.undo(), 0);
  } finally {
    f.close();
  }
});
test("deleting rows refreshes table-wide formula results", () => {
  const f = fixture();
  try {
    const d = f.repo.create("Fórmulas"),
      number = f.repo.addColumn(d.database.id, "Número", "number"),
      percent = f.repo.addColumn(d.database.id, "Porcentaje", "formula", {
        formula: {
          kind: "columnStat",
          fn: "percentOfTotal",
          columnId: number.id,
        },
      }),
      a = f.repo.createRow(d.database.id),
      b = f.repo.createRow(d.database.id);
    f.repo.setCell(a.id, number.id, "10");
    f.repo.setCell(b.id, number.id, "30");
    assert.equal(f.repo.getRow(a.id).cells[percent.id], "25");
    assert.equal(f.repo.getRow(b.id).cells[percent.id], "75");
    f.repo.deleteRows([a.id]);
    assert.equal(f.repo.getRow(b.id).cells[percent.id], "100");
  } finally {
    f.close();
  }
});
test("a formula column computes existing rows as soon as it is created", () => {
  const f = fixture();
  try {
    const d = f.repo.create("Fórmulas"),
      number = f.repo.addColumn(d.database.id, "Número", "number"),
      a = f.repo.createRow(d.database.id),
      b = f.repo.createRow(d.database.id);
    f.repo.setCell(a.id, number.id, "10");
    f.repo.setCell(b.id, number.id, "30");
    const percent = f.repo.addColumn(d.database.id, "Porcentaje", "formula", {
      formula: {
        kind: "columnStat",
        fn: "percentOfTotal",
        columnId: number.id,
      },
    });
    assert.equal(f.repo.getRow(a.id).cells[percent.id], "25");
    assert.equal(f.repo.getRow(b.id).cells[percent.id], "75");
  } finally {
    f.close();
  }
});
test("computed unique IDs and timestamps can be filtered and sorted", () => {
  const f = fixture();
  try {
    const d = f.repo.create("Sistema"),
      unique = f.repo.addColumn(d.database.id, "ID único", "unique_id", {
        uniqueIdPrefix: "IMG-",
      }),
      a = f.repo.createRow(d.database.id),
      b = f.repo.createRow(d.database.id);
    const all = f.repo.literal({
      databaseIds: [d.database.id],
      filters: [
        {
          databaseId: d.database.id,
          columnId: unique.id,
          op: "contains",
          value: "IMG-",
        },
      ],
    });
    assert.equal(all.total, 2);
    const exact = f.repo.literal({
      databaseIds: [d.database.id],
      filters: [
        {
          databaseId: d.database.id,
          columnId: unique.id,
          op: "equals",
          value: "IMG-" + a.id,
        },
      ],
    });
    assert.equal(exact.total, 1);
    assert.equal(exact.rows[0].id, a.id);
    const sorted = f.repo.literal({
      databaseIds: [d.database.id],
      sortColumn: unique.id,
    });
    assert.deepEqual(
      sorted.rows.map((row) => row.id),
      [a.id, b.id].sort((x, y) => ("IMG-" + x).localeCompare("IMG-" + y)),
    );
  } finally {
    f.close();
  }
});
test("cross-database writes and relation targets fail without corrupting cells", () => {
  const f = fixture();
  try {
    const a = f.repo.create("A"),
      b = f.repo.create("B"),
      ra = f.repo.createRow(a.database.id),
      rb = f.repo.createRow(b.database.id);
    assert.throws(
      () => f.repo.setCell(ra.id, b.columns[0].id, "x"),
      /otra base/,
    );
    const c = f.repo.addColumn(a.database.id, "Relación", "relation", {
      relationTargetDatabaseId: b.database.id,
    });
    f.repo.setCell(ra.id, c.id, JSON.stringify([rb.id]));
    assert.equal(
      (f.repo.db.prepare("SELECT count(*) n FROM db_relations").get() as any).n,
      1,
    );
    assert.throws(
      () => f.repo.setCell(ra.id, c.id, JSON.stringify([ra.id])),
      /incompatible/,
    );
    assert.deepEqual(JSON.parse(f.repo.getRow(ra.id).cells[c.id]!), [rb.id]);
  } finally {
    f.close();
  }
});
test("matching refuses duplicate exact identifiers and duplicate catalogue codes", () => {
  const rows = [
    { rowId: "1", refValue: "IMG001" },
    { rowId: "2", refValue: "IMG001" },
    { rowId: "3", refValue: "IMG002" },
  ];
  const m = matchImages(
    [
      { token: "a", name: "IMG001.jpg" },
      { token: "b", name: "IMG002.png" },
      { token: "c", name: "other.jpg" },
    ],
    rows,
  );
  assert.equal(m[0].status, "ambiguous");
  assert.equal(m[0].rowId, null);
  assert.equal(m[1].rowId, "3");
  assert.equal(m[1].status, "safe");
  assert.equal(m[2].status, "unmatched");
  assert.throws(
    () => matchImages([{ token: "a", name: "x" }], rows, "/(a+)+$/"),
    /lineal/,
  );
});
test("vector normalization, dimension contracts and rank fusion never treat similarity as probability", () => {
  const v = normalizeVector(
    Array.from({ length: 768 }, (_, i) => i + 1),
    256,
  );
  assert.equal(v.length, 256);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-10);
  assert.throws(() => normalizeVector(Array(512).fill(0)), /vacío/);
  assert.throws(() => normalizeVector([NaN], 256), /incompatible/);
  assert.equal(fuseRanks(["a", "b"], ["b", "c"], 0.8)[0][0], "b");
});
test("IPC command validation rejects filesystem paths, unknown operations, invalid types and extra fields", () => {
  assert.throws(() => validateCommand("_asset", { id: "x" }), /no permitida/);
  assert.throws(() => validateCommand("csvPreview", { file: "/etc/passwd" }));
  assert.throws(() => validateCommand("search", { limit: 100000 }));
  assert.throws(() => validateCommand("updateSettings", { apiKey: "secret" }));
  assert.throws(() =>
    validateCommand("setApiKey", { provider: "../../evil", key: "secret" }),
  );
});

test("equivalent fields from different schemas filter together with OR semantics", () => {
  const f = fixture();
  try {
    const a = f.repo.importCsv("A", ["Lugar"], ["title"], [["Granada"], ["Sevilla"]]),
      b = f.repo.importCsv("B", ["Ciudad"], ["title"], [["Granada"], ["Madrid"]]),
      aColumn = a.columns[0],
      bColumn = b.columns[0];
    const result = f.repo.literal({
      databaseIds: [a.database.id, b.database.id],
      filters: [
        {
          columnId: aColumn.id,
          columnIds: [aColumn.id, bColumn.id],
          op: "contains",
          value: "gran",
        },
      ],
    });
    assert.equal(result.total, 2);
    const empty = f.repo.literal({
      databaseIds: [a.database.id, b.database.id],
      filters: [
        {
          columnId: aColumn.id,
          columnIds: [aColumn.id, bColumn.id],
          op: "empty",
          value: "",
        },
      ],
    });
    assert.equal(empty.total, 0);
  } finally {
    f.close();
  }
});

test("deleting a column removes stale field-equivalence groups", () => {
  const f = fixture();
  try {
    const d = f.repo.create("A"),
      text = f.repo.addColumn(d.database.id, "Notas", "text");
    f.repo.updateSettings({
      fieldEquivalences: [
        {
          id: "group",
          name: "Texto",
          columnIds: [d.columns[0].id, text.id],
        },
      ],
    });
    f.repo.deleteColumn(text.id);
    assert.deepEqual(f.repo.getSettings().fieldEquivalences, []);
  } finally {
    f.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseColumn, DatabaseRow } from "../shared/databases";
import {
  evaluateFormulaExpression,
  formulaExpressionDependencies,
  formulaExpressionResultKind,
  formulaRuntimeToRaw,
  parseFormulaExpression,
  validateFormulaExpression,
} from "../shared/databaseFormulaExpression";

const column = (
  id: string,
  type: DatabaseColumn["type"],
  name = id,
): DatabaseColumn => ({
  id,
  databaseId: "db",
  name,
  type,
  position: 0,
  config: {},
  options: [],
});
const row: DatabaseRow = {
  id: "row",
  databaseId: "db",
  position: 0,
  cells: { n: "10", text: "Hola mundo", date: "2026-01-02" },
  createdAt: "",
  updatedAt: "",
};

test("formula expressions parse, evaluate and infer their kind safely", () => {
  const columns = [column("n", "number"), column("text", "text")];
  const arithmetic = parseFormulaExpression('property("n") * 2 + 5');
  assert.equal(evaluateFormulaExpression(arithmetic, { columns: new Map(columns.map((c) => [c.id, c])), row }), 25);
  assert.equal(formulaExpressionResultKind(arithmetic, columns), "number");
  assert.deepEqual(formulaExpressionDependencies(arithmetic), ["n"]);
  const text = parseFormulaExpression('concat("Hola ", property("text"))');
  assert.equal(
    evaluateFormulaExpression(text, {
      columns: new Map(columns.map((c) => [c.id, c])),
      row,
    }),
    "Hola Hola mundo",
  );
  assert.equal(formulaExpressionResultKind(text, columns), "text");
  const conditional = parseFormulaExpression(
    'if(property("n") > 5, "alto", "bajo")',
  );
  assert.equal(
    evaluateFormulaExpression(conditional, {
      columns: new Map(columns.map((c) => [c.id, c])),
      row,
    }),
    "alto",
  );
  assert.equal(
    formulaRuntimeToRaw(
      evaluateFormulaExpression(parseFormulaExpression('property("n") / 4'), {
        columns: new Map(columns.map((c) => [c.id, c])),
        row,
      }),
    ),
    "2.5",
  );
});

test("formula expressions reject unknown functions, unknown properties and invalid calls", () => {
  assert.throws(() => parseFormulaExpression("process.exit()"), /no permitid/);
  assert.throws(
    () => parseFormulaExpression("property(n)"),
    /texto|property|permitid|esperaba/i,
  );
  assert.throws(() => parseFormulaExpression("1 +"), /incompleta/);
  const columns = [column("n", "number")];
  const missing = parseFormulaExpression('property("missing") + 1');
  assert.match(
    validateFormulaExpression(missing, columns) ?? "",
    /ya no existe/,
  );
  const invalidIf = parseFormulaExpression('if(true, 1)');
  assert.match(validateFormulaExpression(invalidIf, columns) ?? "", /if\(\)/);
});

test("formula column statistics use the supplied snapshot", () => {
  const columns = [column("n", "number")];
  const expression = parseFormulaExpression('percentOfTotal(property("n"))');
  const value = evaluateFormulaExpression(expression, {
    columns: new Map(columns.map((c) => [c.id, c])),
    row,
    columnStats: new Map([["n", { sorted: [5, 10, 20], total: 35, mean: 35 / 3 }]]),
  });
  assert.ok(typeof value === "number");
  assert.ok(Math.abs(value - (10 / 35) * 100) < 1e-9);
});

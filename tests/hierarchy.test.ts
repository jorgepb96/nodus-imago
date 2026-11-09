import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHierarchy, relationTargets } from "../shared/hierarchy";

test("self-relations build a stable hierarchy and cycles stay reachable", () => {
  const rows = [
    { id: "root", title: "Root", cells: { parent: null } },
    { id: "a", title: "A", cells: { parent: '["root"]' } },
    { id: "b", title: "B", cells: { parent: '["a"]' } },
    { id: "cycle1", title: "C1", cells: { parent: '["cycle2"]' } },
    { id: "cycle2", title: "C2", cells: { parent: '["cycle1"]' } },
    { id: "missing", title: "M", cells: { parent: '["gone"]' } },
  ];
  const tree = buildHierarchy(rows, "parent");
  assert.deepEqual(
    tree.map((node) => node.row.id),
    ["root", "missing", "cycle1"],
  );
  assert.deepEqual(
    tree[0].children.map((node) => node.row.id),
    ["a"],
  );
  assert.deepEqual(
    tree[0].children[0].children.map((node) => node.row.id),
    ["b"],
  );
  assert.equal(tree[2].children[0].row.id, "cycle2");
  assert.deepEqual(relationTargets('[ "a", 2, "b" ]'), ["a", "b"]);
  assert.deepEqual(relationTargets("not json"), []);
});

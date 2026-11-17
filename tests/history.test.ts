// Undo and Redo: the proposals dialog only reverts accepted proposals, every
// button can say what it would change, and Redo re-applies an undone batch
// until something else is changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Repository } from "../electron/db/repository";
import { NeighbourSuggestions } from "../electron/db/suggest";
import { validateCommand } from "../shared/validation";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-history-"));
  const repo = new Repository(root);
  const d = repo.create("Fotos"),
    place = repo.addColumn(d.database.id, "Ubicación", "location"),
    note = repo.addColumn(d.database.id, "Nota", "text"),
    rows = [repo.createRow(d.database.id), repo.createRow(d.database.id), repo.createRow(d.database.id)];
  return {
    repo,
    root,
    place,
    note,
    rows,
    cell: (rowId: string, columnId: string) => repo.getRow(rowId).cells[columnId] ?? null,
    close: () => {
      repo.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
const spot = (name: string) => JSON.stringify({ name, address: null, latitude: 40, longitude: -3 });

test("the proposals scope never reverts a bulk change made elsewhere", () => {
  const f = fixture();
  try {
    // A bulk «locate» batch, as Situar los registros en el mapa writes it.
    f.repo.db.transaction(() => {
      const before = (f.repo.db.prepare("SELECT coalesce(max(id),0) id FROM history").get() as { id: number }).id;
      for (const r of f.rows) f.repo.setCell(r.id, f.place.id, spot("Ávila"));
      f.repo.db.prepare("UPDATE history SET batch_id='locate',kind='locate' WHERE id>?").run(before);
    })();
    assert.equal(f.repo.historyState("proposals").undo, null);
    assert.equal(f.repo.undo("proposals"), 0);
    for (const r of f.rows) assert.notEqual(f.cell(r.id, f.place.id), null);

    // The general Undo says exactly what it would revert before doing it.
    const step = f.repo.historyState("all").undo!;
    assert.equal(step.kind, "locate");
    assert.equal(step.changes, 3);
    assert.deepEqual(step.columns, ["Ubicación"]);
  } finally {
    f.close();
  }
});

test("accepted proposals and similar-image suggestions are undone and redone in their own scope", () => {
  const f = fixture();
  try {
    const insert = f.repo.db.prepare(
      "INSERT INTO proposals(id,row_id,column_id,before_value,value,model,revision,prompt,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    insert.run("p1", f.rows[0].id, f.note.id, null, "Retrato", "fixture", "1", "fixture", "2026-11-17");
    assert.equal(f.repo.reviewProposals(["p1"], "accept").applied, 1);
    new NeighbourSuggestions(f.repo, () => null).apply([{ rowId: f.rows[1].id, columnId: f.note.id, value: "Paisaje" }]);
    // A later hand edit is not part of the proposals scope.
    f.repo.setCell(f.rows[2].id, f.note.id, "A mano");

    assert.equal(f.repo.historyState("proposals").undo?.kind, "proposals");
    assert.equal(f.repo.undo("proposals"), 1);
    assert.equal(f.cell(f.rows[1].id, f.note.id), null);
    assert.equal(f.cell(f.rows[2].id, f.note.id), "A mano");
    assert.equal(f.repo.undo("proposals"), 1);
    assert.equal(f.cell(f.rows[0].id, f.note.id), null);

    // Redo goes back in reverse order of the undos.
    assert.equal(f.repo.redo("proposals"), 1);
    assert.equal(f.cell(f.rows[0].id, f.note.id), "Retrato");
    assert.equal(f.repo.redo("proposals"), 1);
    assert.equal(f.cell(f.rows[1].id, f.note.id), "Paisaje");
    assert.equal(f.repo.redo("proposals"), 0);
    assert.equal(f.repo.historyState("proposals").redo, null);
  } finally {
    f.close();
  }
});

test("a new change after Undo ends Redo, and Redo refuses values changed since", () => {
  const f = fixture();
  try {
    f.repo.setCell(f.rows[0].id, f.note.id, "uno");
    assert.equal(f.repo.undo(), 1);
    assert.equal(f.repo.historyState().redo?.changes, 1);
    f.repo.setCell(f.rows[1].id, f.note.id, "otro");
    assert.equal(f.repo.historyState().redo, null);
    assert.equal(f.repo.redo(), 0);
    assert.equal(f.cell(f.rows[0].id, f.note.id), null);

    // Undo the new edit too: the first one is redoable again, and a value
    // written outside the history makes Redo stop without touching anything.
    assert.equal(f.repo.undo(), 1);
    assert.equal(f.repo.redo(), 1);
    assert.equal(f.cell(f.rows[1].id, f.note.id), "otro");
    assert.equal(f.repo.undo(), 1);
    f.repo.setCell(f.rows[1].id, f.note.id, "fuera", false);
    assert.throws(() => f.repo.redo(), /No se ha rehecho/);
    assert.equal(f.cell(f.rows[1].id, f.note.id), "fuera");
  } finally {
    f.close();
  }
});

test("collections made before Redo gain the history columns and keep old undos out of Redo", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imago-history-old-"));
  try {
    let repo = new Repository(root);
    const d = repo.create("Fotos"),
      note = repo.addColumn(d.database.id, "Nota", "text"),
      row = repo.createRow(d.database.id);
    repo.close();
    const db = new Database(path.join(root, "imago.sqlite"));
    db.exec(
      "DROP INDEX history_batch; DROP INDEX history_undone; ALTER TABLE history DROP COLUMN kind; ALTER TABLE history DROP COLUMN undone_seq; ALTER TABLE history DROP COLUMN undo_mark;",
    );
    db.prepare(
      "INSERT INTO history(batch_id,row_id,column_id,before_value,after_value,created_at,undone) VALUES('old',?,?,NULL,'antes',?,1)",
    ).run(row.id, note.id, new Date().toISOString());
    db.close();
    repo = new Repository(root);
    try {
      assert.equal(repo.historyState().redo, null);
      assert.equal(repo.redo(), 0);
      assert.equal(repo.getRow(row.id).cells[note.id], undefined);
    } finally {
      repo.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("undo, redo and historyState only accept a known scope", () => {
  for (const command of ["undo", "redo", "historyState"] as const) {
    assert.doesNotThrow(() => validateCommand(command, { scope: "proposals" }));
    assert.throws(() => validateCommand(command, { scope: "everything" }));
    assert.throws(() => validateCommand(command, undefined));
  }
});

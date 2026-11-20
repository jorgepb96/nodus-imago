// Saved views of a database: a kind of view with its filters and sort.
import { randomUUID as uuid } from "node:crypto";
import type { Repository } from "./repository";
import type { SavedView, SavedViewCriteria, DatabaseViewId } from "../../shared/savedViews";

type Row = Omit<SavedView, "criteria"> & { criteria_json: string };
const now = () => new Date().toISOString();

export class SavedViews {
  constructor(private repo: Repository) {}

  list(databaseId: string): SavedView[] {
    return (
      this.repo.db
        .prepare(
          "SELECT id,database_id databaseId,name,view,criteria_json,position,created_at createdAt,updated_at updatedAt FROM db_views WHERE database_id=? ORDER BY position,created_at",
        )
        .all(databaseId) as Row[]
    ).map(({ criteria_json, ...rest }) => ({ ...rest, criteria: JSON.parse(criteria_json) as SavedViewCriteria }));
  }
  save(input: { id?: string; databaseId: string; name: string; view: DatabaseViewId; criteria: SavedViewCriteria }): SavedView {
    this.repo.detail(input.databaseId);
    const name = input.name.trim();
    const clash = this.list(input.databaseId).find((v) => v.id !== input.id && v.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (clash) throw new Error("Ya hay una vista con ese nombre.");
    const at = now(),
      criteria = JSON.stringify(input.criteria);
    if (input.id) {
      const done = this.repo.db
        .prepare("UPDATE db_views SET name=?,view=?,criteria_json=?,updated_at=? WHERE id=? AND database_id=?")
        .run(name, input.view, criteria, at, input.id, input.databaseId);
      if (!done.changes) throw new Error("Vista no encontrada.");
      return this.list(input.databaseId).find((v) => v.id === input.id)!;
    }
    const id = uuid(),
      position = (this.repo.db.prepare("SELECT coalesce(max(position),-1)+1 p FROM db_views WHERE database_id=?").get(input.databaseId) as { p: number }).p;
    this.repo.db.prepare("INSERT INTO db_views VALUES(?,?,?,?,?,?,?,?)").run(id, input.databaseId, name, input.view, criteria, position, at, at);
    return this.list(input.databaseId).find((v) => v.id === id)!;
  }
  delete(id: string) {
    this.repo.db.prepare("DELETE FROM db_views WHERE id=?").run(id);
  }
}

// Merging values written in different ways. For a property with options the
// kept option takes the chosen name, the records of the others move to it and
// the others are removed; a snapshot of the removed and renamed options lets
// «Deshacer» bring everything back. For a text property, the cells change.
import { randomUUID } from "node:crypto";
import type { Repository } from "./repository";
import { decodeMultiSelect } from "../../shared/databases";
import { clusterValues, type ValueCluster, type ValueCount } from "../../shared/cleanup";

export const CLEANABLE = ["select", "multi_select", "text"];

export class ValueCleanup {
  constructor(private repo: Repository) {}

  counts(columnId: string): ValueCount[] {
    const column = this.repo.column(columnId);
    if (!CLEANABLE.includes(column.type)) throw new Error("Esta propiedad no admite unificar valores.");
    const cells = this.repo.db.prepare("SELECT value_text v FROM db_cells WHERE column_id=? AND value_text IS NOT NULL AND value_text<>''").all(columnId) as { v: string }[];
    const counts = new Map<string, number>();
    for (const { v } of cells)
      for (const value of column.type === "multi_select" ? decodeMultiSelect(v) : [column.type === "text" ? v.trim() : v])
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    if (column.type === "text") return [...counts].filter(([v]) => v.length <= 200).map(([value, count]) => ({ value, optionId: null, count }));
    return column.options.filter((o) => counts.has(o.id)).map((o) => ({ value: o.label, optionId: o.id, count: counts.get(o.id)! }));
  }

  clusters(columnId: string): ValueCluster[] {
    return clusterValues(this.counts(columnId));
  }

  /**
   * Each group: the values to merge (option ids, or texts for a text
   * property) and the name they keep. One history batch for all of them.
   */
  merge(columnId: string, groups: { members: string[]; target: string }[]): number {
    const column = this.repo.column(columnId);
    if (!CLEANABLE.includes(column.type)) throw new Error("Esta propiedad no admite unificar valores.");
    const db = this.repo.db;
    const batch = randomUUID();
    let changed = 0;
    db.transaction(() => {
      const before = (db.prepare("SELECT coalesce(max(id),0) id FROM history").get() as { id: number }).id;
      const snapshots: unknown[] = [];
      const cells = () => db.prepare("SELECT row_id r,value_text v FROM db_cells WHERE column_id=? AND value_text IS NOT NULL").all(columnId) as { r: string; v: string }[];
      for (const group of groups) {
        const target = group.target.trim();
        if (!target || group.members.length < 2) continue;
        if (column.type === "text") {
          const members = new Set(group.members.map((m) => m.trim()));
          for (const { r, v } of cells())
            if (members.has(v.trim()) && v !== target) {
              this.repo.setCell(r, columnId, target);
              changed++;
            }
          continue;
        }
        const current = this.repo.column(columnId).options;
        const options = group.members.map((id) => {
          const o = current.find((x) => x.id === id);
          if (!o) throw new Error("Identificador de opción ajeno a la propiedad.");
          return o;
        });
        const keep = options.find((o) => o.label === target) ?? options[0];
        const others = options.filter((o) => o.id !== keep.id);
        const clash = current.find((o) => !options.includes(o) && o.label.normalize("NFKC").trim().toLowerCase() === target.normalize("NFKC").toLowerCase());
        if (clash) throw new Error(`Ya existe otra opción llamada «${clash.label}». Inclúyela en el grupo para unirla.`);
        const raw = (id: string) => db.prepare("SELECT * FROM db_select_options WHERE id=?").get(id);
        if (keep.label !== target) {
          snapshots.push(raw(keep.id));
          db.prepare("UPDATE db_select_options SET label=?,updated_at=? WHERE id=?").run(target, new Date().toISOString(), keep.id);
        }
        const moved = new Set(others.map((o) => o.id));
        for (const { r, v } of cells()) {
          if (column.type === "select" || column.type === "status") {
            if (moved.has(v)) {
              this.repo.setCell(r, columnId, keep.id);
              changed++;
            }
          } else {
            const ids = decodeMultiSelect(v);
            if (!ids.some((id) => moved.has(id))) continue;
            this.repo.setCell(r, columnId, JSON.stringify([...new Set(ids.map((id) => (moved.has(id) ? keep.id : id)))]));
            changed++;
          }
        }
        for (const o of others) {
          snapshots.push(raw(o.id));
          db.prepare("DELETE FROM db_select_options WHERE id=?").run(o.id);
        }
      }
      db.prepare("UPDATE history SET batch_id=?,kind='cleanup' WHERE id>?").run(batch, before);
      const save = db.prepare("INSERT INTO option_restores(batch_id,option_json) VALUES(?,?)");
      for (const s of snapshots) save.run(batch, JSON.stringify(s));
      this.repo.recompute(column.databaseId);
      this.repo.rebuildText(column.databaseId);
    })();
    return changed;
  }
}

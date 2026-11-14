// Authority links of option values (Wikidata, Iconclass), kept apart from the
// options so that editing a property's options never loses them, and what
// they give back: identifiers in exports and coordinates for the map.
import { randomUUID } from "node:crypto";
import type { Repository } from "./repository";
import { decodeMultiSelect, type DatabaseColumn, type DatabaseRow } from "../../shared/databases";
import { encodeDatabaseLocation } from "../../shared/databaseProperties";
import { authorityExportText, type AuthorityLink } from "../../shared/authority";

const LINKABLE = ["select", "multi_select"];

export class Authorities {
  constructor(private repo: Repository) {}

  private optionColumn(columnId: string) {
    const column = this.repo.column(columnId);
    if (!LINKABLE.includes(column.type)) throw new Error("Solo se pueden enlazar las propiedades con opciones.");
    return column;
  }

  links(columnId: string): Record<string, AuthorityLink> {
    const column = this.optionColumn(columnId);
    const ids = new Set(column.options.map((o) => o.id));
    const rows = this.repo.db.prepare("SELECT option_id id,link_json json FROM option_authorities WHERE column_id=?").all(columnId) as { id: string; json: string }[];
    return Object.fromEntries(rows.filter((r) => ids.has(r.id)).map((r) => [r.id, JSON.parse(r.json) as AuthorityLink]));
  }

  set(columnId: string, items: { optionId: string; link: AuthorityLink | null }[]) {
    const column = this.optionColumn(columnId);
    const save = this.repo.db.prepare("INSERT OR REPLACE INTO option_authorities(option_id,column_id,link_json,linked_at) VALUES(?,?,?,?)");
    const remove = this.repo.db.prepare("DELETE FROM option_authorities WHERE option_id=?");
    this.repo.db.transaction(() => {
      for (const { optionId, link } of items) {
        if (!column.options.some((o) => o.id === optionId)) throw new Error("Identificador de opción ajeno a la propiedad.");
        if (!link) remove.run(optionId);
        else {
          if (!/^https:\/\/(www\.wikidata\.org|iconclass\.org)\//.test(link.uri)) throw new Error("Enlace de autoridad no válido.");
          save.run(optionId, columnId, JSON.stringify(link), new Date().toISOString());
        }
      }
    })();
    return items.length;
  }

  /**
   * A location property filled from the coordinates of the linked places:
   * every record gets the place of its value. One «Deshacer» batch.
   */
  locate(columnId: string, name: string): { columnId: string; located: number } {
    const column = this.optionColumn(columnId);
    const links = this.links(columnId);
    const places = new Map(
      column.options.flatMap((o) => {
        const c = links[o.id]?.coordinates;
        return c ? [[o.id, { name: o.label, latitude: c.latitude, longitude: c.longitude }] as const] : [];
      }),
    );
    if (!places.size) throw new Error("Ningún valor enlazado tiene coordenadas en Wikidata.");
    const db = this.repo.db;
    let located = 0;
    let created: DatabaseColumn | null = null;
    db.transaction(() => {
      const taken = new Set(this.repo.detail(column.databaseId).columns.map((c) => c.name.toLocaleLowerCase()));
      let label = name,
        n = 2;
      while (taken.has(label.toLocaleLowerCase())) label = `${name} ${n++}`;
      created = this.repo.addColumn(column.databaseId, label, "location");
      const before = (db.prepare("SELECT coalesce(max(id),0) id FROM history").get() as { id: number }).id;
      const cells = db.prepare("SELECT row_id r,value_text v FROM db_cells WHERE column_id=? AND value_text IS NOT NULL").all(columnId) as { r: string; v: string }[];
      for (const { r, v } of cells) {
        const ids = column.type === "multi_select" ? decodeMultiSelect(v) : [v];
        const place = ids.map((id) => places.get(id)).find(Boolean);
        if (!place) continue;
        this.repo.setCell(r, created.id, encodeDatabaseLocation(place));
        located++;
      }
      db.prepare("UPDATE history SET batch_id=? WHERE id>?").run(randomUUID(), before);
    })();
    return { columnId: created!.id, located };
  }

  /**
   * For exports: after each linked property, a column with the URIs (and
   * Getty identifiers) of its values.
   */
  exportColumns(columns: DatabaseColumn[], rows: DatabaseRow[]): { columns: DatabaseColumn[]; rows: DatabaseRow[] } {
    const extra = new Map<string, Record<string, AuthorityLink>>();
    for (const c of columns) if (LINKABLE.includes(c.type)) {
      const links = this.links(c.id);
      if (Object.keys(links).length) extra.set(c.id, links);
    }
    if (!extra.size) return { columns, rows };
    const out: DatabaseColumn[] = [];
    for (const c of columns) {
      out.push(c);
      if (extra.has(c.id)) out.push({ ...c, id: `authority:${c.id}`, name: `${c.name} · URI`, type: "text", options: [], config: {} });
    }
    return {
      columns: out,
      rows: rows.map((row) => {
        const cells = { ...row.cells };
        for (const [columnId, links] of extra) {
          const raw = row.cells[columnId] ?? null;
          const column = columns.find((c) => c.id === columnId)!;
          const ids = column.type === "multi_select" ? decodeMultiSelect(raw) : raw ? [raw] : [];
          cells[`authority:${columnId}`] = ids.map((id) => authorityExportText(links[id])).filter(Boolean).join("; ") || null;
        }
        return { ...row, cells };
      }),
    };
  }
}

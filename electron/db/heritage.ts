// Records of heritage elements: the options of a heritage property with their
// coordinates, typology and the element they are part of. Kept apart from the
// options (like authority links) so editing the options never loses them.
// Linking many elements to Wikidata at once is recorded in batches that can be
// reverted as a whole.
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Repository } from "./repository";
import type { AuthorityLink } from "../../shared/authority";
import type { HeritageMapElement, MapRecordsInput } from "../../shared/imago";
import { decodeMultiSelect, type DatabaseColumn } from "../../shared/databases";
import { importedOptionColor } from "../../shared/databaseCsv";
import {
  ancestors,
  emptyElement,
  heritageScheme,
  resolvedPosition,
  typeFromInstances,
  typeFromName,
  isHeritageColumn,
  wouldCycle,
  type HeritageElement,
} from "../../shared/heritage";

type Row = {
  option_id: string;
  column_id: string;
  parent_option_id: string | null;
  group_key: string | null;
  type_key: string | null;
  latitude: number | null;
  longitude: number | null;
  coord_source: "wikidata" | "osm" | "manual" | null;
  updated_at: string;
  osm_ref?: string | null;
};
const decode = (r: Row): HeritageElement => ({
  optionId: r.option_id,
  parentId: r.parent_option_id,
  group: r.group_key,
  type: r.type_key,
  latitude: r.latitude,
  longitude: r.longitude,
  coordSource: r.coord_source,
  osm: r.osm_ref ?? null,
});
const isEmpty = (e: HeritageElement) =>
  !e.parentId && !e.group && !e.type && e.latitude === null && e.longitude === null;

/** One change of a linking batch, as it was before. */
type LinkSnapshot = { optionId: string; link: string | null; element: Row | null };
export type HeritageLinkBatch = { id: string; applied: number; createdAt: string; revertedAt: string | null };
export type HeritageLinkItem = {
  optionId: string;
  link: AuthorityLink;
  /** Fill coordinates, typology and parent only where the record has none. */
  group?: string | null;
  type?: string | null;
  parentId?: string | null;
};

/**
 * Undo of «Unificar valores» on a heritage property: entries saved in
 * option_restores next to the options themselves.
 */
export type HeritageRestore =
  | { __heritage: "element"; optionId: string; row: Row | null }
  | { __heritage: "mark"; id: string; optionId: string | null }
  | { __heritage: "authority"; optionId: string; columnId: string; link: string | null };

export function restoreHeritage(db: Database.Database, entry: HeritageRestore) {
  if (entry.__heritage === "element") {
    if (!entry.row) db.prepare("DELETE FROM heritage_elements WHERE option_id=?").run(entry.optionId);
    else writeRow(db, entry.row);
  } else if (entry.__heritage === "mark") {
    db.prepare("UPDATE image_annotations SET option_id=? WHERE id=?").run(entry.optionId, entry.id);
  } else if (entry.link === null) {
    db.prepare("DELETE FROM option_authorities WHERE option_id=?").run(entry.optionId);
  } else {
    db.prepare("INSERT OR REPLACE INTO option_authorities(option_id,column_id,link_json,linked_at) VALUES(?,?,?,?)").run(
      entry.optionId,
      entry.columnId,
      entry.link,
      new Date().toISOString(),
    );
  }
}

function writeRow(db: Database.Database, r: Row) {
  db.prepare(
    "INSERT OR REPLACE INTO heritage_elements(option_id,column_id,parent_option_id,group_key,type_key,latitude,longitude,coord_source,updated_at,osm_ref) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).run(r.option_id, r.column_id, r.parent_option_id, r.group_key, r.type_key, r.latitude, r.longitude, r.coord_source, r.updated_at, r.osm_ref ?? null);
}

/** Where each element of a heritage property is drawn (own or whole's coordinates). */
export function heritagePlaces(
  db: Database.Database,
  column: DatabaseColumn,
): Map<string, { label: string; latitude: number; longitude: number; inherited: boolean }> {
  const rows = db.prepare("SELECT * FROM heritage_elements WHERE column_id=?").all(column.id) as Row[];
  const byId = Object.fromEntries(rows.map((r) => [r.option_id, decode(r)]));
  const out = new Map<string, { label: string; latitude: number; longitude: number; inherited: boolean }>();
  for (const o of column.options) {
    const p = resolvedPosition(o.id, byId);
    if (p) out.set(o.id, { label: o.label, latitude: p.latitude, longitude: p.longitude, inherited: p.inherited });
  }
  return out;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export class Heritage {
  constructor(private repo: Repository) {}

  private get db() {
    return this.repo.db;
  }

  heritageColumn(columnId: string) {
    const column = this.repo.column(columnId);
    if (!isHeritageColumn(column)) throw new Error("Esta propiedad no es de patrimonio.");
    return column;
  }

  private rows(columnId: string): Row[] {
    return this.db.prepare("SELECT * FROM heritage_elements WHERE column_id=?").all(columnId) as Row[];
  }

  /** Records of the property's current options, by option id. */
  elements(columnId: string): Record<string, HeritageElement> {
    const column = this.heritageColumn(columnId);
    const ids = new Set(column.options.map((o) => o.id));
    return Object.fromEntries(this.rows(columnId).filter((r) => ids.has(r.option_id)).map((r) => [r.option_id, decode(r)]));
  }

  /** Saves records; an empty one is removed. Refuses loops and foreign parents. */
  save(columnId: string, items: HeritageElement[]): number {
    const column = this.heritageColumn(columnId);
    const ids = new Set(column.options.map((o) => o.id));
    const scheme = heritageScheme(column.config);
    const db = this.db;
    db.transaction(() => {
      const current = this.elements(columnId);
      for (const raw of items) {
        if (!ids.has(raw.optionId)) throw new Error("Identificador de opción ajeno a la propiedad.");
        const item: HeritageElement = { ...emptyElement(raw.optionId), ...raw };
        if (item.parentId && !ids.has(item.parentId)) throw new Error("El elemento del que forma parte no está en esta propiedad.");
        if (wouldCycle(item.optionId, item.parentId, current))
          throw new Error("Un elemento no puede formar parte de sí mismo ni de una de sus partes.");
        const group = item.group ? scheme.groups.find((g) => g.key === item.group) : null;
        if (item.group && !group) throw new Error("Tipología desconocida.");
        if (item.type && !group?.types.some((x) => x.key === item.type)) throw new Error("Tipología desconocida.");
        const located = finite(item.latitude) && finite(item.longitude);
        if (located && (Math.abs(item.latitude!) > 90 || Math.abs(item.longitude!) > 180))
          throw new Error("Coordenadas no válidas.");
        const element: HeritageElement = {
          ...item,
          latitude: located ? item.latitude : null,
          longitude: located ? item.longitude : null,
          coordSource: located ? (item.coordSource ?? "manual") : null,
        };
        current[item.optionId] = element;
        if (isEmpty(element)) db.prepare("DELETE FROM heritage_elements WHERE option_id=?").run(item.optionId);
        else
          writeRow(db, {
            option_id: element.optionId,
            column_id: columnId,
            parent_option_id: element.parentId,
            group_key: element.group,
            type_key: element.type,
            latitude: element.latitude,
            longitude: element.longitude,
            coord_source: element.coordSource,
            updated_at: new Date().toISOString(),
            osm_ref: element.coordSource === "osm" ? (element.osm ?? null) : null,
          });
      }
    })();
    return items.length;
  }

  /**
   * A new element: an option at the end of the list and, when it comes from
   * Wikidata, its link, coordinates, suggested typology and parent.
   */
  addElement(columnId: string, label: string, link: AuthorityLink | null): string {
    const column = this.heritageColumn(columnId);
    const name = label.trim().slice(0, 500);
    if (!name) throw new Error("El elemento necesita un nombre.");
    const folded = name.normalize("NFKC").toLowerCase();
    const existing = column.options.find((o) => o.label.normalize("NFKC").trim().toLowerCase() === folded);
    if (existing) return existing.id;
    if (link && !/^https:\/\/www\.wikidata\.org\//.test(link.uri)) throw new Error("Enlace de autoridad no válido.");
    const id = randomUUID();
    const at = new Date().toISOString();
    this.db.transaction(() => {
      const position = column.options.length;
      this.db
        .prepare("INSERT INTO db_select_options(id,database_id,column_id,label,color,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(id, column.databaseId, columnId, name, importedOptionColor(position), position, at, at);
      if (!link) {
        const named = typeFromName(name);
        if (named && heritageScheme(column.config).groups.some((g) => g.key === named.group))
          writeRow(this.db, {
            option_id: id,
            column_id: columnId,
            parent_option_id: null,
            group_key: named.group,
            type_key: named.type,
            latitude: null,
            longitude: null,
            coord_source: null,
            updated_at: at,
          });
      }
      if (link) {
        const typed = typeFromName(name) ?? typeFromInstances(link.instances);
        const scheme = heritageScheme(column.config);
        const inScheme = typed && scheme.groups.some((g) => g.key === typed.group && (!typed.type || g.types.some((x) => x.key === typed.type)));
        const links = this.db.prepare("SELECT option_id id,link_json json FROM option_authorities WHERE column_id=?").all(columnId) as { id: string; json: string }[];
        const parent = links.find((l) => link.partOf?.includes((JSON.parse(l.json) as AuthorityLink).id))?.id ?? null;
        this.db.prepare("INSERT OR REPLACE INTO option_authorities(option_id,column_id,link_json,linked_at) VALUES(?,?,?,?)").run(id, columnId, JSON.stringify(link), at);
        const c = link.coordinates;
        if (c || inScheme || parent)
          writeRow(this.db, {
            option_id: id,
            column_id: columnId,
            parent_option_id: parent,
            group_key: inScheme ? typed!.group : null,
            type_key: inScheme ? typed!.type : null,
            latitude: c?.latitude ?? null,
            longitude: c?.longitude ?? null,
            coord_source: c ? "wikidata" : null,
            updated_at: at,
          });
      }
    })();
    return id;
  }

  /**
   * The heritage map of a view: one point per element with its own
   * coordinates and the number of the view's records that show it; with its
   * parts, a record of a part also counts for every whole above it.
   */
  map(input: Omit<MapRecordsInput, "fallbackColumnId"> & { includeParts: boolean }): {
    elements: HeritageMapElement[];
    unplaced: number;
    records: number;
  } {
    const column = this.heritageColumn(input.columnId);
    if (column.databaseId !== input.databaseId) throw new Error("Elige una propiedad de patrimonio de esta base de datos.");
    const ids = this.repo.literalIds({
      databaseIds: [input.databaseId],
      filters: input.filters,
      filterLogic: input.filterLogic,
      filterGroups: input.filterGroups,
      sorts: input.sorts,
    });
    const byId = Object.fromEntries(this.rows(column.id).map((r) => [r.option_id, decode(r)]));
    const shows = new Map<string, Set<string>>();
    const add = (optionId: string, rowId: string) =>
      (shows.get(optionId) ?? shows.set(optionId, new Set()).get(optionId)!).add(rowId);
    const cell = this.db.prepare("SELECT value_text v FROM db_cells WHERE row_id=? AND column_id=?");
    let records = 0;
    for (const rowId of ids) {
      const values = decodeMultiSelect((cell.get(rowId, column.id) as { v: string | null } | undefined)?.v ?? null);
      if (values.length) records++;
      for (const optionId of values) {
        add(optionId, rowId);
        if (input.includeParts) for (const whole of ancestors(optionId, byId)) add(whole, rowId);
      }
    }
    const elements: HeritageMapElement[] = [];
    let unplaced = 0;
    for (const o of column.options) {
      const rows = shows.get(o.id);
      if (!rows?.size) continue;
      const e = byId[o.id];
      const p = resolvedPosition(o.id, byId);
      if (!p) unplaced++;
      if (!p || p.inherited) continue;
      elements.push({
        optionId: o.id,
        label: o.label,
        latitude: p.latitude,
        longitude: p.longitude,
        inherited: false,
        group: e?.group ?? null,
        type: e?.type ?? null,
        parentId: e?.parentId ?? null,
        count: rows.size,
        rowIds: [...rows].slice(0, 500),
      });
    }
    return { elements: elements.sort((a, b) => b.count - a.count), unplaced, records };
  }

  // ── Wikidata in batches ──────────────────────────────────────────────────

  /**
   * Links many elements at once and fills, where empty, coordinates (manual
   * ones are never replaced), typology and parent. Recorded as one batch.
   */
  applyLinks(columnId: string, items: HeritageLinkItem[]): HeritageLinkBatch {
    const column = this.heritageColumn(columnId);
    const ids = new Set(column.options.map((o) => o.id));
    const scheme = heritageScheme(column.config);
    const db = this.db;
    const batch: HeritageLinkBatch = { id: randomUUID(), applied: 0, createdAt: new Date().toISOString(), revertedAt: null };
    db.transaction(() => {
      const snapshot: LinkSnapshot[] = [];
      const elements = this.elements(columnId);
      for (const item of items) {
        if (!ids.has(item.optionId)) throw new Error("Identificador de opción ajeno a la propiedad.");
        if (!/^https:\/\/www\.wikidata\.org\//.test(item.link.uri)) throw new Error("Enlace de autoridad no válido.");
        const before = db.prepare("SELECT link_json FROM option_authorities WHERE option_id=?").get(item.optionId) as
          | { link_json: string }
          | undefined;
        const row = db.prepare("SELECT * FROM heritage_elements WHERE option_id=?").get(item.optionId) as Row | undefined;
        snapshot.push({ optionId: item.optionId, link: before?.link_json ?? null, element: row ?? null });
        db.prepare("INSERT OR REPLACE INTO option_authorities(option_id,column_id,link_json,linked_at) VALUES(?,?,?,?)").run(
          item.optionId,
          columnId,
          JSON.stringify(item.link),
          batch.createdAt,
        );
        const e: HeritageElement = { ...emptyElement(item.optionId), ...elements[item.optionId] };
        const c = item.link.coordinates;
        if (c && e.coordSource !== "manual") Object.assign(e, { latitude: c.latitude, longitude: c.longitude, coordSource: "wikidata" });
        // The researcher's own name says what it is first («Castillo de …»); Wikidata's class after.
        const label = column.options.find((o) => o.id === item.optionId)?.label ?? "";
        const named = typeFromName(label);
        const suggested = named ?? (item.group ? { group: item.group, type: item.type ?? null } : null);
        const group = suggested && scheme.groups.find((g) => g.key === suggested.group);
        if (!e.group && group && (!suggested!.type || group.types.some((x) => x.key === suggested!.type)))
          Object.assign(e, { group: group.key, type: suggested!.type ?? null });
        if (!e.parentId && item.parentId && ids.has(item.parentId) && !wouldCycle(e.optionId, item.parentId, elements))
          e.parentId = item.parentId;
        elements[e.optionId] = e;
        if (!isEmpty(e))
          writeRow(db, {
            option_id: e.optionId,
            column_id: columnId,
            parent_option_id: e.parentId,
            group_key: e.group,
            type_key: e.type,
            latitude: e.latitude,
            longitude: e.longitude,
            coord_source: e.coordSource,
            updated_at: batch.createdAt,
            osm_ref: e.coordSource === "osm" ? (e.osm ?? null) : null,
          });
        batch.applied++;
      }
      db.prepare("INSERT INTO heritage_link_batches(id,column_id,applied,snapshot_json,created_at) VALUES(?,?,?,?,?)").run(
        batch.id,
        columnId,
        batch.applied,
        JSON.stringify(snapshot),
        batch.createdAt,
      );
    })();
    return batch;
  }

  /**
   * Gives elements without a typology the one their name announces
   * («Castillo de …» is a castle). One batch that «Revertir» undoes.
   */
  inferTypes(columnId: string): HeritageLinkBatch {
    const column = this.heritageColumn(columnId);
    const scheme = heritageScheme(column.config);
    const db = this.db;
    const batch: HeritageLinkBatch = { id: randomUUID(), applied: 0, createdAt: new Date().toISOString(), revertedAt: null };
    db.transaction(() => {
      const snapshot: LinkSnapshot[] = [];
      const elements = this.elements(columnId);
      for (const o of column.options) {
        const e: HeritageElement = { ...emptyElement(o.id), ...elements[o.id] };
        if (e.group) continue;
        const named = typeFromName(o.label);
        const group = named && scheme.groups.find((g) => g.key === named.group);
        if (!group || (named!.type && !group.types.some((x) => x.key === named!.type))) continue;
        const link = db.prepare("SELECT link_json FROM option_authorities WHERE option_id=?").get(o.id) as { link_json: string } | undefined;
        const row = db.prepare("SELECT * FROM heritage_elements WHERE option_id=?").get(o.id) as Row | undefined;
        snapshot.push({ optionId: o.id, link: link?.link_json ?? null, element: row ?? null });
        writeRow(db, {
          option_id: o.id,
          column_id: columnId,
          parent_option_id: e.parentId,
          group_key: group.key,
          type_key: named!.type,
          latitude: e.latitude,
          longitude: e.longitude,
          coord_source: e.coordSource,
          updated_at: batch.createdAt,
          osm_ref: e.osm ?? null,
        });
        batch.applied++;
      }
      if (batch.applied)
        db.prepare("INSERT INTO heritage_link_batches(id,column_id,applied,snapshot_json,created_at) VALUES(?,?,?,?,?)").run(
          batch.id,
          columnId,
          batch.applied,
          JSON.stringify(snapshot),
          batch.createdAt,
        );
    })();
    return batch;
  }

  /**
   * Places elements Wikidata does not have from OpenStreetMap: coordinates
   * where they have none and a typology where they lack it (their name first).
   * One batch that «Revertir» undoes.
   */
  applyPlaces(
    columnId: string,
    items: { optionId: string; latitude: number; longitude: number; osm: string; group?: string | null; type?: string | null }[],
  ): HeritageLinkBatch {
    const column = this.heritageColumn(columnId);
    const scheme = heritageScheme(column.config);
    const db = this.db;
    const batch: HeritageLinkBatch = { id: randomUUID(), applied: 0, createdAt: new Date().toISOString(), revertedAt: null };
    db.transaction(() => {
      const snapshot: LinkSnapshot[] = [];
      const elements = this.elements(columnId);
      for (const item of items) {
        const option = column.options.find((o) => o.id === item.optionId);
        if (!option) throw new Error("Identificador de opción ajeno a la propiedad.");
        const e: HeritageElement = { ...emptyElement(item.optionId), ...elements[item.optionId] };
        const link = db.prepare("SELECT link_json FROM option_authorities WHERE option_id=?").get(item.optionId) as { link_json: string } | undefined;
        const row = db.prepare("SELECT * FROM heritage_elements WHERE option_id=?").get(item.optionId) as Row | undefined;
        snapshot.push({ optionId: item.optionId, link: link?.link_json ?? null, element: row ?? null });
        if (e.latitude === null) Object.assign(e, { latitude: item.latitude, longitude: item.longitude, coordSource: "osm", osm: item.osm });
        const suggested = typeFromName(option.label) ?? (item.group ? { group: item.group, type: item.type ?? null } : null);
        const group = suggested && scheme.groups.find((g) => g.key === suggested.group);
        if (!e.group && group && (!suggested!.type || group.types.some((x) => x.key === suggested!.type)))
          Object.assign(e, { group: group.key, type: suggested!.type ?? null });
        writeRow(db, {
          option_id: e.optionId,
          column_id: columnId,
          parent_option_id: e.parentId,
          group_key: e.group,
          type_key: e.type,
          latitude: e.latitude,
          longitude: e.longitude,
          coord_source: e.coordSource,
          updated_at: batch.createdAt,
          osm_ref: e.coordSource === "osm" ? (e.osm ?? null) : null,
        });
        batch.applied++;
      }
      db.prepare("INSERT INTO heritage_link_batches(id,column_id,applied,snapshot_json,created_at) VALUES(?,?,?,?,?)").run(
        batch.id,
        columnId,
        batch.applied,
        JSON.stringify(snapshot),
        batch.createdAt,
      );
    })();
    return batch;
  }

  batches(columnId: string): HeritageLinkBatch[] {
    this.heritageColumn(columnId);
    return this.db
      .prepare(
        "SELECT id,applied,created_at createdAt,reverted_at revertedAt FROM heritage_link_batches WHERE column_id=? ORDER BY created_at DESC LIMIT 20",
      )
      .all(columnId) as HeritageLinkBatch[];
  }

  /** Puts links and records back as they were before the batch. */
  revertBatch(batchId: string): number {
    const db = this.db;
    const batch = db.prepare("SELECT column_id,snapshot_json,reverted_at FROM heritage_link_batches WHERE id=?").get(batchId) as
      | { column_id: string; snapshot_json: string; reverted_at: string | null }
      | undefined;
    if (!batch) throw new Error("Vinculación no encontrada.");
    if (batch.reverted_at) throw new Error("Esta vinculación ya se revirtió.");
    const snapshot = JSON.parse(batch.snapshot_json) as LinkSnapshot[];
    db.transaction(() => {
      // Last change first, so an element changed twice ends as it began.
      for (const s of [...snapshot].reverse()) {
        restoreHeritage(db, { __heritage: "authority", optionId: s.optionId, columnId: batch.column_id, link: s.link });
        restoreHeritage(db, { __heritage: "element", optionId: s.optionId, row: s.element });
      }
      db.prepare("UPDATE heritage_link_batches SET reverted_at=? WHERE id=?").run(new Date().toISOString(), batchId);
    })();
    return snapshot.length;
  }

  // ── «Unificar valores» ───────────────────────────────────────────────────

  /**
   * Before options are merged into `keepId`: the kept element takes what it
   * lacks from the absorbed ones, their parts hang from it and their marks
   * point to it. Returns what «Deshacer» needs to put it all back.
   */
  mergeInto(columnId: string, keepId: string, absorbedIds: string[]): HeritageRestore[] {
    const db = this.db;
    const absorbed = new Set(absorbedIds.filter((id) => id !== keepId));
    if (!absorbed.size) return [];
    const rows = new Map(this.rows(columnId).map((r) => [r.option_id, r]));
    const restores: HeritageRestore[] = [];
    const remember = (id: string) => {
      if (!restores.some((r) => r.__heritage === "element" && r.optionId === id))
        restores.push({ __heritage: "element", optionId: id, row: rows.get(id) ? { ...rows.get(id)! } : null });
    };
    const at = new Date().toISOString();
    // The kept record, completed with the absorbed ones.
    remember(keepId);
    const kept: Row = rows.get(keepId) ?? {
      option_id: keepId,
      column_id: columnId,
      parent_option_id: null,
      group_key: null,
      type_key: null,
      latitude: null,
      longitude: null,
      coord_source: null,
      updated_at: at,
    };
    for (const id of absorbed) {
      const r = rows.get(id);
      if (!r) continue;
      if (kept.latitude === null && r.latitude !== null)
        Object.assign(kept, { latitude: r.latitude, longitude: r.longitude, coord_source: r.coord_source });
      if (!kept.group_key && r.group_key) Object.assign(kept, { group_key: r.group_key, type_key: r.type_key });
      if (!kept.parent_option_id && r.parent_option_id && !absorbed.has(r.parent_option_id))
        kept.parent_option_id = r.parent_option_id;
    }
    if (kept.parent_option_id && absorbed.has(kept.parent_option_id)) kept.parent_option_id = null;
    kept.updated_at = at;
    rows.set(keepId, kept);
    // Parts of the absorbed elements now hang from the kept one, unless that makes a loop.
    const byId = Object.fromEntries([...rows.values()].map((r) => [r.option_id, decode(r)]));
    for (const r of rows.values()) {
      if (!r.parent_option_id || !absorbed.has(r.parent_option_id) || r.option_id === keepId) continue;
      remember(r.option_id);
      r.parent_option_id = wouldCycle(r.option_id, keepId, byId) ? null : keepId;
      r.updated_at = at;
      byId[r.option_id] = decode(r);
    }
    for (const entry of restores) {
      if (entry.__heritage !== "element") continue;
      const r = rows.get(entry.optionId);
      if (r) writeRow(db, r);
    }
    // The kept element takes an authority link it lacks.
    const link = (id: string) =>
      (db.prepare("SELECT link_json FROM option_authorities WHERE option_id=?").get(id) as { link_json: string } | undefined)?.link_json ?? null;
    if (!link(keepId)) {
      const found = [...absorbed].map(link).find((l): l is string => !!l);
      if (found) {
        restores.push({ __heritage: "authority", optionId: keepId, columnId, link: null });
        restoreHeritage(db, { __heritage: "authority", optionId: keepId, columnId, link: found });
      }
    }
    // Marks on the photos follow.
    const marks = db
      .prepare(`SELECT id,option_id FROM image_annotations WHERE option_id IN (${[...absorbed].map(() => "?").join(",")})`)
      .all(...absorbed) as { id: string; option_id: string }[];
    for (const m of marks) {
      restores.push({ __heritage: "mark", id: m.id, optionId: m.option_id });
      db.prepare("UPDATE image_annotations SET option_id=? WHERE id=?").run(keepId, m.id);
    }
    return restores;
  }
}

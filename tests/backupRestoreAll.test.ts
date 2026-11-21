// A backup restores everything the researcher made, not only records and
// images: heritage records and their batches, authority links, notes and
// marks on photos, saved statistics and views, comparison boards and chats.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Repository } from "../electron/db/repository";
import { Images } from "../electron/import/images";
import { Heritage } from "../electron/db/heritage";
import { SavedViews } from "../electron/db/savedViews";
import { Statistics } from "../electron/db/statistics";
import { writeBackup, restoreBackup } from "../electron/export/backup";
import { emptyElement } from "../shared/heritage";

const TABLES = [
  "heritage_elements",
  "heritage_link_batches",
  "option_authorities",
  "image_annotations",
  "db_statistics",
  "db_views",
  "compare_boards",
  "chat_folders",
  "chat_conversations",
  "restorations",
  "image_fingerprints",
  "image_miniatures",
];
const count = (repo: Repository, table: string) => (repo.db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;

test("restoring a backup brings back heritage, links, marks, saved statistics and views, boards and chats", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-restore-all-"));
  const source = new Repository(path.join(root, "a"));
  const target = new Repository(path.join(root, "b"));
  try {
    const d = source.create("Fotos");
    const db = d.database.id;
    const place = source.addColumn(db, "Patrimonio", "multi_select", { heritage: true } as never);
    source.saveOptions(place.id, [{ label: "Catedral - Villaverde", color: null }]);
    const option = source.column(place.id).options[0].id;
    const image = path.join(root, "foto.png");
    await sharp({ create: { width: 40, height: 30, channels: 3, background: "#335577" } }).png().toFile(image);
    const attachment = source.addColumn(db, "Imagen", "attachment");
    const row = source.createRow(db);
    await new Images(source).importOne({ databaseId: db, columnId: attachment.id, storage: "copy", createUnmatched: false, files: [{ path: image, rowId: row.id }] }, 0);
    source.setCell(row.id, place.id, JSON.stringify([option]));
    const asset = (source.db.prepare("SELECT id FROM image_assets").get() as { id: string }).id;
    const heritage = new Heritage(source);
    heritage.applyLinks(place.id, [
      {
        optionId: option,
        link: { source: "wikidata", id: "Q1", label: "Catedral de Villaverde", description: null, uri: "https://www.wikidata.org/wiki/Q1", kind: "place", coordinates: { latitude: 40, longitude: -3 } },
        group: "religious",
        type: "cathedral",
        parentId: null,
      },
    ]);
    heritage.save(place.id, [{ ...emptyElement(option), ...heritage.elements(place.id)[option], group: "religious", type: "cathedral" }]);
    source.db
      .prepare("INSERT INTO image_annotations(id,asset_id,row_id,x,y,w,h,note,tags_json,color,created_at,updated_at,kind,option_id) VALUES('n1',?,?,0.1,0.1,0.2,0.2,'Portada','[]',NULL,'2026-01-01','2026-01-01','rect',?)")
      .run(asset, row.id, option);
    new Statistics(source).save({ databaseId: db, name: "Por patrimonio", spec: { kind: "frequency", columnId: place.id, heritageLevel: "group", chart: "bar", limit: 20 } as never });
    new SavedViews(source).save({ databaseId: db, name: "Catedrales", view: "map", criteria: { filters: [], filterLogic: "and", filterGroups: [], sorts: [] } });
    source.db.prepare("INSERT INTO compare_boards(id,name,asset_ids_json,created_at,updated_at) VALUES('b1','Mesa',?,'2026-01-01','2026-01-01')").run(JSON.stringify([asset]));
    source.db.prepare("INSERT INTO chat_folders(id,parent_id,name,color,icon,position,created_at) VALUES('f1',NULL,'Proyecto',NULL,NULL,0,'2026-01-01')").run();
    source.db.prepare("INSERT INTO chat_folders(id,parent_id,name,color,icon,position,created_at) VALUES('f2','f1','Capítulo 2',NULL,NULL,0,'2026-01-01')").run();
    const chat = source.db.prepare("PRAGMA table_info(chat_conversations)").all() as { name: string; notnull: number; dflt_value: unknown }[];
    const required = chat.filter((c) => c.notnull && c.dflt_value === null).map((c) => c.name);
    const values: Record<string, unknown> = { id: "c1", title: "Preguntas", folder_id: "f2", database_ids_json: JSON.stringify([db]), created_at: "2026-01-01", updated_at: "2026-01-01" };
    for (const c of required) values[c] ??= c.endsWith("_at") ? "2026-01-01" : c.endsWith("_json") ? "[]" : "x";
    source.db.prepare(`INSERT INTO chat_conversations(${Object.keys(values).join(",")}) VALUES(${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
    // A restored version of the image, with its file, and two computed caches.
    const restoredFile = path.join(source.root, "restorations", "r1.png");
    await fs.mkdir(path.dirname(restoredFile), { recursive: true });
    await sharp({ create: { width: 40, height: 30, channels: 3, background: "#aa7744" } }).png().toFile(restoredFile);
    const rcols = source.db.prepare("PRAGMA table_info(restorations)").all() as { name: string; notnull: number; dflt_value: unknown; type: string }[];
    const rv: Record<string, unknown> = { id: "r1", asset_id: asset, row_id: row.id, provider: "openai", model: "m", task: "restore", prompt: "p", file: restoredFile, width: 40, height: 30, created_at: "2026-01-01" };
    for (const c of rcols) if (c.notnull && c.dflt_value === null && !(c.name in rv)) rv[c.name] = /INT|REAL/i.test(c.type) ? 0 : "x";
    source.db.prepare(`INSERT INTO restorations(${Object.keys(rv).join(",")}) VALUES(${Object.keys(rv).map(() => "?").join(",")})`).run(...Object.values(rv));
    const hash = (source.db.prepare("SELECT content_hash h FROM image_assets").get() as { h: string }).h;
    source.db.prepare("INSERT INTO image_fingerprints(content_hash,hash) VALUES(?,?)").run(hash, "abcd");
    source.db.prepare("INSERT INTO image_miniatures(content_hash,width,height,pixels) VALUES(?,?,?,?)").run(hash, 2, 2, Buffer.from([1, 2, 3, 4]));
    const before = Object.fromEntries(TABLES.map((t) => [t, count(source, t)]));
    for (const t of TABLES) assert.ok(before[t] > 0, `${t} has data before the backup`);

    const backup = path.join(root, "copia.imago");
    await writeBackup(source, backup);
    await restoreBackup(target, backup);

    for (const t of TABLES) assert.equal(count(target, t), before[t], `${t} restored`);
    const restored = new Heritage(target).elements(place.id)[option];
    assert.equal(restored.group, "religious");
    assert.equal(restored.latitude, 40);
    assert.deepEqual(new SavedViews(target).list(db).map((v) => v.name), ["Catedrales"]);
    assert.equal((target.db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length, 0);
    // The restored version's file is back in its folder, identical.
    const file = (target.db.prepare("SELECT file FROM restorations WHERE id='r1'").get() as { file: string }).file;
    assert.equal(file, path.join(target.root, "restorations", "r1.png"));
    assert.deepEqual(await fs.readFile(file), await fs.readFile(restoredFile));
    // No stray copy left in the originals folder.
    const originals = await fs.readdir(path.join(target.root, "originals"));
    assert.equal(originals.length, 1);
  } finally {
    source.close();
    target.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

import Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID as uuid, createHash } from "node:crypto";
import { Repository, now } from "../db/repository";
import { imagePipeline, isImage } from "./images";
import { isDatabaseColumnType } from "../../shared/databases";

// Read a consistent SQLite backup through a read-only connection. Never migrate Nodus.
export async function importNodus(repo: Repository, file: string) {
  const source = new Database(file, { readonly: true, fileMustExist: true });
  source.pragma("trusted_schema=OFF");
  const staging = path.join(repo.root, "staging", uuid());
  await fs.mkdir(staging);
  let db: Database.Database | undefined;
  try {
    await source.backup(path.join(staging, "nodus.sqlite"));
    source.close();
    db = new Database(path.join(staging, "nodus.sqlite"), { readonly: true });
    db.pragma("trusted_schema=OFF");
    if (db.pragma("integrity_check", { simple: true }) !== "ok")
      throw new Error(
        "La copia de Nodus no supera la comprobación de integridad.",
      );
    const tables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as any[]
      ).map((t) => t.name),
    );
    for (const table of [
      "db_databases",
      "db_columns",
      "db_select_options",
      "db_rows",
      "db_cells",
    ])
      if (!tables.has(table))
        throw new Error("No es una base Databases Vault compatible.");
    const databases = db
      .prepare("SELECT * FROM db_databases ORDER BY position")
      .all() as any[];
    if (databases.some((d) => repo.list().some((r) => r.id === d.id)))
      throw new Error(
        "Ya existe una base con estos identificadores. La importación se ha cancelado para evitar duplicados.",
      );
    const columns = db
      .prepare("SELECT * FROM db_columns ORDER BY position")
      .all() as any[];
    if (columns.some((c) => !isDatabaseColumnType(c.type)))
      throw new Error(
        "Nodus contiene tipos de propiedad de una versión no compatible.",
      );
    const notices: string[] = [];
    if (
      columns.some((c) =>
        ["ai", "ai_image", "rollup", "button", "comparison"].includes(c.type),
      )
    )
      notices.push(
        "Las configuraciones avanzadas se conservan como datos. IA remota, botones de automatización y rollups de Nodus no se ejecutan en Imago.",
      );
    const attachments = tables.has("db_attachments")
      ? (db
          .prepare(
            "SELECT id,row_id,column_id,file_name,mime_type,position,created_at,description,extracted_text FROM db_attachments",
          )
          .all() as any[])
      : [];
    // Stage each original before opening the destination transaction.
    const imported: any[] = [];
    for (const a of attachments) {
      const info = db
        .prepare("SELECT * FROM db_attachments WHERE id=?")
        .get(a.id) as any;
      const bytes =
        info.blob ??
        (info.blob_hash && tables.has("db_blobs")
          ? (
              db
                .prepare("SELECT data FROM db_blobs WHERE hash=?")
                .get(info.blob_hash) as any
            )?.data
          : null);
      if (!bytes)
        throw new Error(
          "Un adjunto de Nodus no tiene su original. No se ha importado ningún registro.",
        );
      const hash = createHash("sha256").update(bytes).digest("hex"),
        original = path.join(repo.root, "originals", hash);
      await fs.writeFile(path.join(staging, hash), bytes);
      let width = 0,
        height = 0;
      if (isImage(a.file_name ?? "")) {
        try {
          const image = await imagePipeline(path.join(staging, hash)),
            m = await image.metadata();
          width = m.width ?? 0;
          height = m.height ?? 0;
          await image
            .clone()
            .rotate()
            .resize(480, 480, { fit: "inside", withoutEnlargement: true })
            .webp()
            .toFile(path.join(repo.root, "thumbnails", hash + ".webp"));
          await image
            .clone()
            .rotate()
            .resize(2200, 2200, { fit: "inside", withoutEnlargement: true })
            .webp()
            .toFile(path.join(repo.root, "thumbnails", hash + "-preview.webp"));
        } catch {
          notices.push("Original conservado sin miniatura: " + a.file_name);
        }
      }
      await fs.copyFile(path.join(staging, hash), original);
      imported.push({
        ...a,
        hash,
        original,
        bytes: bytes.length,
        width,
        height,
      });
    }
    repo.db.transaction(() => {
      for (const d of databases)
        repo.db
          .prepare("INSERT INTO db_databases VALUES(?,?,?,?,?,?,?)")
          .run(
            d.id,
            d.short_id,
            d.name,
            d.icon,
            d.position,
            d.created_at,
            d.updated_at,
          );
      for (const c of columns)
        repo.db
          .prepare("INSERT INTO db_columns VALUES(?,?,?,?,?,?,?,?)")
          .run(
            c.id,
            c.database_id,
            c.name,
            c.type,
            c.position,
            c.config_json ?? "{}",
            c.created_at,
            c.updated_at ?? c.created_at,
          );
      for (const o of db!
        .prepare("SELECT * FROM db_select_options")
        .all() as any[])
        repo.db
          .prepare("INSERT INTO db_select_options VALUES(?,?,?,?,?,?,?,?)")
          .run(
            o.id,
            columns.find((c) => c.id === o.column_id).database_id,
            o.column_id,
            o.label,
            o.color,
            o.position,
            o.created_at ?? now(),
            o.updated_at ?? now(),
          );
      for (const r of db!.prepare("SELECT * FROM db_rows").all() as any[])
        repo.db
          .prepare("INSERT INTO db_rows VALUES(?,?,?,?,?)")
          .run(r.id, r.database_id, r.position, r.created_at, r.updated_at);
      for (const c of db!
        .prepare("SELECT row_id,column_id,value_text FROM db_cells")
        .all() as any[])
        repo.rawCell(
          c.row_id,
          c.column_id,
          c.value_text,
          columns.find((col) => col.id === c.column_id).type,
        );
      for (const a of imported)
        repo.db
          .prepare(
            "INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            a.id,
            columns.find((c) => c.id === a.column_id).database_id,
            a.row_id,
            a.column_id,
            a.file_name ?? a.hash,
            a.original,
            1,
            a.hash,
            a.bytes,
            a.width,
            a.height,
            JSON.stringify({
              source: "nodus",
              extractedText: a.extracted_text,
              mimeType: a.mime_type,
            }),
            a.description,
            a.position,
            a.created_at,
          );
      if (tables.has("db_relations"))
        for (const r of db!
          .prepare("SELECT * FROM db_relations")
          .all() as any[]) {
          repo.db
            .prepare("INSERT INTO db_relations VALUES(?,?,?,?,?,?,?,?,?,?)")
            .run(
              r.id,
              columns.find((c) => c.id === r.column_id).database_id,
              r.row_id,
              r.column_id,
              r.target_kind,
              r.target_id,
              r.target_vault_id ?? null,
              r.last_known_label ?? r.label ?? null,
              r.position,
              r.created_at,
            );
          if (r.target_kind !== "db_row")
            notices.push(
              "Relación externa de Nodus conservada sin resolver: " +
                r.target_kind,
            );
        }
      repo.rebuildText();
      if ((repo.db.pragma("foreign_key_check") as unknown[]).length)
        throw new Error("Las relaciones importadas son inconsistentes.");
    })();
    // Imported formula configurations must produce current cells, not only the
    // snapshot values that happened to be stored in the source database.
    for (const d of databases) repo.recompute(d.id);
    return {
      databases: databases.length,
      attachments: imported.length,
      notices: [...new Set(notices)],
    };
  } finally {
    if (source.open) source.close();
    db?.close();
    await fs.rm(staging, { recursive: true, force: true });
  }
}

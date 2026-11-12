import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID as uuid, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import Database from "better-sqlite3";
import { z } from "zod";
import { Repository } from "../db/repository";
import { Archive } from "../import/archive";
import { hashFile } from "../import/images";
import {ensureDiskSpace} from '../storage/disk';

export const BACKUP_TABLES = [
  "db_databases",
  "db_columns",
  "db_select_options",
  "db_rows",
  "db_cells",
  "page_documents",
  "image_assets",
  "db_relations",
  "automation_rules",
  "automation_events",
  "automation_runs",
  "jobs",
  "job_errors",
  "embeddings",
  "image_captions",
  "proposals",
  "history",
  "settings",
  "saved_searches",
  "agreement_experiments",
] as const;
const manifestSchema = z
  .object({
    format: z.literal("nodus.imago/1"),
    createdAt: z.string(),
    files: z.array(
      z
        .object({
          source: z.string(),
          entry: z.string().regex(/^originals\/[a-f0-9]{64}$/),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ),
  })
  .strict();

export async function writeBackup(repo: Repository, destination: string) {
  const staging = path.join(repo.root, "staging", uuid());
  await fsp.mkdir(staging);
  const temp = destination + ".partial-" + uuid();
  try {
    const pageSize=repo.db.pragma('page_size',{simple:true}) as number,pageCount=repo.db.pragma('page_count',{simple:true}) as number;
    await ensureDiskSpace(staging,pageSize*pageCount);
    const snapshot = path.join(staging, "imago.sqlite");
    await repo.db.backup(snapshot);
    const backupDb = new Database(snapshot, { readonly: true });
    const assetSources = backupDb
      .prepare("SELECT original_path,content_hash FROM image_assets")
      .all() as { original_path: string; content_hash: string }[];
    const expected = new Map(
      assetSources.map((a) => [a.original_path, a.content_hash]),
    );
    const sources = new Set(assetSources.map((a) => a.original_path));
    for (const job of backupDb
      .prepare(
        "SELECT payload_json,done FROM jobs WHERE kind='images' AND state IN ('queued','paused','running')",
      )
      .all() as any[])
      for (const f of JSON.parse(job.payload_json).files.slice(job.done))
        sources.add(f.path);
    backupDb.close();
    const files = [];
    for (const source of sources) {
      const hash = await hashFile(source);
      if (expected.has(source) && expected.get(source) !== hash)
        throw new Error(
          "Un original ha cambiado. Reimporta el archivo antes de crear una copia completa.",
        );
      files.push({ source, entry: "originals/" + hash, hash });
    }
    const manifest = {
      format: "nodus.imago/1",
      createdAt: new Date().toISOString(),
      files,
    };
    let archiveBytes=(await fsp.stat(snapshot)).size+Buffer.byteLength(JSON.stringify(manifest))+1024*1024;
    for(const source of new Set(files.map(file=>file.source)))archiveBytes+=(await fsp.stat(source)).size+1024;
    await ensureDiskSpace(path.dirname(destination),archiveBytes);
    const out = fs.createWriteStream(temp);
    const archive = new ZipArchive({ zlib: { level: 0 } });
    const done = new Promise<void>((resolve, reject) => {
      out.on("close", resolve);
      out.on("error", reject);
      archive.on("error", reject);
      archive.on("warning", reject);
    });
    archive.pipe(out);
    archive.file(snapshot, { name: "imago.sqlite" });
    archive.append(JSON.stringify(manifest), { name: "manifest.json" });
    const seen = new Set<string>();
    for (const file of files)
      if (!seen.has(file.entry)) {
        const content = Readable.from(
          (async function* () {
            const hash = createHash("sha256");
            for await (const chunk of fs.createReadStream(file.source)) {
              hash.update(chunk);
              yield chunk;
            }
            if (hash.digest("hex") !== file.hash)
              throw new Error("Un original cambió durante la copia.");
          })(),
        );
        content.on("error", (error) => {
          archive.abort();
          out.destroy(error);
        });
        archive.append(content, { name: file.entry });
        seen.add(file.entry);
      }
    await Promise.all([archive.finalize(), done]);
    await fsp.rename(temp, destination);
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.rm(temp, { force: true });
  }
}
export async function restoreBackup(
  repo: Repository,
  file: string,
): Promise<number> {
  // A restore is deliberate and only accepts an empty collection. It never merges IDs.
  if (
    repo.stats().databases ||
    repo
      .jobs()
      .some((job) => ["queued", "running", "paused"].includes(job.state))
  )
    throw new Error(
      "Restaura en una instalación vacía y sin trabajos activos para preservar todos los identificadores. Exporta primero tus datos actuales.",
    );
  const archive = await Archive.open(file),
    staging = path.join(repo.root, "staging", uuid());
  await fsp.mkdir(staging);
  let snapshot: Database.Database | undefined;
  const promoted: string[] = [];
  let committed = false;
  try {
    await archive.preflight(staging);
    const manifest = manifestSchema.parse(
      JSON.parse((await archive.read("manifest.json")).toString("utf8")),
    );
    const source = path.join(staging, "snapshot.sqlite");
    await archive.extract("imago.sqlite", source);
    snapshot = new Database(source, { readonly: true, fileMustExist: true });
    snapshot.pragma("trusted_schema=OFF");
    if (
      snapshot.pragma("integrity_check", { simple: true }) !== "ok" ||
      (snapshot.pragma("foreign_key_check") as unknown[]).length
    )
      throw new Error("La copia no supera la comprobación de integridad.");
    if (
      (snapshot.prepare("SELECT version FROM imago_schema").get() as any)
        ?.version !== 1
    )
      throw new Error("Versión de copia no compatible.");
    const relocated = new Map<string, string>();
    const staged = new Map<string, string>();
    for (const item of manifest.files) {
      let local = staged.get(item.hash);
      if (!local) {
        local = path.join(staging, item.hash);
        await archive.extract(item.entry, local);
        if ((await hashFile(local)) !== item.hash)
          throw new Error("Hash de archivo incorrecto.");
        staged.set(item.hash, local);
      }
      relocated.set(item.source, path.join(repo.root, "originals", item.hash));
    }
    // Check all referenced paths before moving a byte into managed originals.
    const images = snapshot
      .prepare("SELECT * FROM image_assets")
      .all() as any[];
    for (const a of images) {
      if (!relocated.has(a.original_path))
        throw new Error("La copia omite un original.");
      const m = manifest.files.find((f) => f.source === a.original_path);
      if (m?.hash !== a.content_hash)
        throw new Error("Original y metadatos no coinciden.");
    }
    for (const [hash, local] of staged) {
      const dest = path.join(repo.root, "originals", hash);
      if (fs.existsSync(dest)) {
        if ((await hashFile(dest)) !== hash)
          throw new Error("Original existente dañado.");
      } else {
        await fsp.rename(local, dest);
        promoted.push(dest);
      }
    }
    // An otherwise empty target can still hold orphaned vectors or saved
    // searches from deleted databases. Restore replaces them with the backup
    // instead of failing on a UNIQUE/PRIMARY KEY collision.
    repo.db.transaction(() => {
      if (
        repo.stats().databases ||
        repo
          .jobs()
          .some((job) => ["queued", "running", "paused"].includes(job.state))
      )
        throw new Error(
          "La colección ha cambiado durante la restauración; no se ha sustituido ningún dato.",
        );
      repo.db.prepare("DELETE FROM embeddings").run();
      repo.db.prepare("DELETE FROM image_captions").run();
      repo.db.prepare("DELETE FROM saved_searches").run();
      repo.db.prepare("DELETE FROM agreement_experiments").run();
      repo.db.prepare("DELETE FROM history").run();
      repo.db.prepare("DELETE FROM proposals").run();
      repo.db.prepare("DELETE FROM jobs").run();
      for (const table of BACKUP_TABLES) {
        if (table === "settings") continue;
        // Older v1 backups predate the optional research snapshots table.
        if (
          ["agreement_experiments", "image_captions", "page_documents", "automation_rules", "automation_events", "automation_runs"].includes(table) &&
          !snapshot!
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table)
        )
          continue;
        const expected = (
          repo.db.prepare(`PRAGMA table_info(${table})`).all() as any[]
        ).map((c) => c.name);
        const records = snapshot!
          .prepare(`SELECT ${expected.join(",")} FROM ${table}`)
          .all() as any[];
        const insert = repo.db.prepare(
          `INSERT INTO ${table}(${expected.join(",")}) VALUES(${expected.map(() => "?").join(",")})`,
        );
        for (const r of records) {
          if(table==='automation_rules'){r.enabled=0;const config=JSON.parse(r.config_json);config.enabled=false;r.config_json=JSON.stringify(config);}
          if(table==='automation_events')continue;
          if (table === "image_assets") {
            r.original_path = relocated.get(r.original_path);
            r.managed = 1;
          }
          if (table === "jobs") {
            if (["running", "queued"].includes(r.state)) r.state = "paused";
            if (r.kind === "images") {
              const p = JSON.parse(r.payload_json);
              for (const f of p.files)
                f.path =
                  relocated.get(f.path) ??
                  path.join(repo.root, "staging", "unavailable-" + uuid());
              r.payload_json = JSON.stringify(p);
            }
          }
          insert.run(...expected.map((c) => r[c]));
        }
      }
      repo.rebuildText();
      if ((repo.db.pragma("foreign_key_check") as unknown[]).length)
        throw new Error("Relaciones de la copia incoherentes.");
    })();
    committed = true;
    return repo.stats().databases;
  } finally {
    snapshot?.close();
    archive.close();
    await fsp.rm(staging, { recursive: true, force: true });
    if (!committed)
      for (const file of promoted) {
        // Never remove a pre-existing file or one adopted by another operation.
        if (
          !repo.db
            .prepare("SELECT 1 FROM image_assets WHERE original_path=? LIMIT 1")
            .get(file)
        )
          await fsp.rm(file, { force: true });
      }
  }
}

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { Repository } from "../db/repository";
import { Archive } from "./archive";
import { Images, isImage } from "./images";
import { parseCsv } from "../../shared/csvParser";
import { buildCsvImportPlan } from "../../shared/databaseCsv";

// Adapted from Nodus notionZipImport: bounded archive, CSV type detection,
// Notion ID suffix removal, path-safe attachment resolution.
export async function importNotion(
  repo: Repository,
  images: Images,
  file: string,
) {
  const zip = await Archive.open(file),
    staging = path.join(repo.root, "staging", uuid());
  await fs.mkdir(staging);
  const notices: string[] = [];
  let databases = 0,
    attachments = 0;
  const created: string[] = [];
  try {
    for (const entry of zip.entries.keys()) {
      if (!entry.toLowerCase().endsWith(".csv")) continue;
      const plan = buildCsvImportPlan(
        parseCsv((await zip.read(entry, 128 * 2 ** 20)).toString("utf8")),
      );
      if (!plan.headers.length) continue;
      const name = path.posix
        .basename(entry, ".csv")
        .replace(/(?:\s+|_)[0-9a-f]{32}$/i, "")
        .trim();
      const detail = repo.importCsv(
        name,
        plan.headers,
        plan.suggestedTypes,
        plan.rows,
      );
      created.push(detail.database.id);
      databases++;
      const rows = repo.db
        .prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position")
        .all(detail.database.id) as { id: string }[];
      let attachmentColumn = detail.columns.find(
        (c) => c.type === "attachment",
      );
      for (let i = 0; i < plan.rows.length; i++)
        for (const cell of plan.rows[i]) {
          // Notion CSV attachment paths are comma-separated, URL-encoded relative paths.
          for (const reference of cell.split(/,\s*/)) {
            let decoded: string;
            try {
              decoded = decodeURIComponent(reference.trim());
            } catch {
              continue;
            }
            const resolved = path.posix.normalize(
              path.posix.join(path.posix.dirname(entry), decoded),
            );
            if (
              !decoded ||
              /^(https?:|data:|file:)/i.test(decoded) ||
              !zip.entries.has(resolved) ||
              !isImage(resolved)
            )
              continue;
            attachmentColumn ??= repo.addColumn(
              detail.database.id,
              "Imágenes",
              "attachment",
            );
            const target = path.join(
              staging,
              uuid() + path.posix.extname(resolved),
            );
            await zip.extract(resolved, target);
            await images.importOne(
              {
                databaseId: detail.database.id,
                columnId: attachmentColumn.id,
                storage: "copy",
                createUnmatched: false,
                files: [{ path: target, rowId: rows[i].id }],
              },
              0,
            );
            attachments++;
          }
        }
    }
    if (!databases) throw new Error("El ZIP no contiene bases de datos CSV.");
    if ([...zip.entries.keys()].some((n) => n.endsWith(".md")))
      notices.push(
        "Los documentos Markdown de páginas se conservan en el ZIP original; esta importación incorpora tablas CSV e imágenes referenciadas.",
      );
    notices.push(
      "CSV de Notion no conserva IDs originales de opciones, fórmulas ni relaciones tipadas. Revisa los tipos detectados después de importar.",
    );
    return { databases, attachments, notices };
  } catch (error) {
    repo.db.transaction(() => {
      for (const id of created)
        repo.db.prepare("DELETE FROM db_databases WHERE id=?").run(id);
    })();
    throw error;
  } finally {
    zip.close();
    await fs.rm(staging, { recursive: true, force: true });
  }
}

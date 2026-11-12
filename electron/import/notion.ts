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
    // Images may temporarily coexist in staging and the managed collection.
    await zip.preflight(staging, 2);
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
    const markdown = [...zip.entries.keys()]
      .filter((entry) => entry.toLowerCase().endsWith(".md"))
      .sort();
    if (markdown.length) {
      const pagesName = repo.list().some((d) => d.name === "Páginas Notion")
        ? "Páginas Notion (importadas)"
        : "Páginas Notion";
      const pages = await Promise.all(
        markdown.map(async (entry) => {
          const text = (await zip.read(entry, 10 * 2 ** 20)).toString("utf8");
          return {
            entry,
            title:
              path.posix
                .basename(entry, path.posix.extname(entry))
                .replace(/(?:\s+|_)[0-9a-f]{32}$/i, "")
                .trim() || "Página sin título",
            text: text.replace(/\0/g, ""),
          };
        }),
      );
      const pageDb = repo.importCsv(
        pagesName,
        ["Título", "Contenido", "Carpeta"],
        ["title", "rich_text", "text"],
        pages.map((page) => [
          page.title,
          page.text,
          path.posix.dirname(page.entry) === "."
            ? ""
            : path.posix.dirname(page.entry),
        ]),
      );
      created.push(pageDb.database.id);
      databases++;
      const pageRows = repo.db
        .prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position")
        .all(pageDb.database.id) as { id: string }[];
      const contentColumn=pageDb.columns.find(c=>c.type==='rich_text')!;
      repo.db.transaction(()=>pages.forEach((page,index)=>{
        // Keep the original export even after visual edits change its blocks.
        repo.db.prepare('UPDATE page_documents SET imported_markdown=? WHERE row_id=? AND column_id=?').run(page.text,pageRows[index].id,contentColumn.id);
      }))();
      // Notion exports a page hierarchy as folders + Markdown files. Preserve
      // that parent/child relationship as a relation column, while keeping the
      // original folder path as a plain text column.
      const pageByLocation = new Map<
          string,
          { rowId: string; title: string }
        >(),
        cleanFolder = (value: string) =>
          value
            .replace(/(?:\s+|_)[0-9a-f]{32}$/i, "")
            .normalize("NFKC")
            .trim(),
        pageParents = new Map<string, string>();
      pages.forEach((page, index) => {
        const folder =
            path.posix.dirname(page.entry) === "."
              ? ""
              : path.posix.dirname(page.entry),
          key = `${folder}\0${page.title}`;
        if (!pageByLocation.has(key))
          pageByLocation.set(key, {
            rowId: pageRows[index].id,
            title: page.title,
          });
      });
      pages.forEach((page, index) => {
        let folder =
          path.posix.dirname(page.entry) === "."
            ? ""
            : path.posix.dirname(page.entry);
        while (folder) {
          const name = cleanFolder(path.posix.basename(folder)),
            parentFolder = path.posix.dirname(folder),
            parentKey = `${parentFolder === "." ? "" : parentFolder}\0${name}`,
            parent = pageByLocation.get(parentKey);
          if (parent && parent.rowId !== pageRows[index].id) {
            pageParents.set(pageRows[index].id, parent.rowId);
            break;
          }
          const next = parentFolder === "." ? "" : parentFolder;
          if (next === folder) break;
          folder = next;
        }
      });
      let pageAttachments = pageDb.columns.find(
        (column) => column.type === "attachment",
      );
      for (let index = 0; index < pages.length; index++) {
        const references = new Set<string>();
        for (const pattern of [
          /!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
          /<img[^>]+src=["']([^"']+)["']/gi,
        ])
          for (const match of pages[index].text.matchAll(pattern))
            references.add(match[1].replace(/^<|>$/g, ""));
        for (const reference of references) {
          let decoded: string;
          try {
            decoded = decodeURIComponent(reference);
          } catch {
            continue;
          }
          if (/^(?:https?:|data:|file:|#|mailto:)/i.test(decoded)) continue;
          const candidates = [
            path.posix.normalize(
              path.posix.join(path.posix.dirname(pages[index].entry), decoded),
            ),
            path.posix.normalize(decoded),
          ];
          const resolved = candidates.find(
            (candidate) =>
              !candidate.startsWith("../") &&
              zip.entries.has(candidate) &&
              isImage(candidate),
          );
          if (!resolved) continue;
          pageAttachments ??= repo.addColumn(
            pageDb.database.id,
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
              databaseId: pageDb.database.id,
              columnId: pageAttachments.id,
              storage: "copy",
              createUnmatched: false,
              files: [{ path: target, rowId: pageRows[index].id }],
            },
            0,
          );
          attachments++;
        }
      }
      if (pageParents.size) {
        const parentColumn = repo.addColumn(
          pageDb.database.id,
          "Página padre",
          "relation",
          {
            relationTargetKind: "db_row",
            relationTargetDatabaseId: pageDb.database.id,
            relationCardinality: "one",
          },
        );
        for (const [rowId, parentRowId] of pageParents)
          repo.setCell(
            rowId,
            parentColumn.id,
            JSON.stringify([parentRowId]),
            false,
          );
      }
      notices.push(
        `Se importaron ${markdown.length} páginas Markdown como texto plano en «${pagesName}». La relación «Página padre» conserva la jerarquía de carpetas; no se reproducen bloques ni formato enriquecido.`,
      );
    }
    if (!databases)
      throw new Error(
        "El ZIP no contiene bases de datos CSV ni páginas Markdown.",
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

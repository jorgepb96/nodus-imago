// The text a record contributes to semantic search: its title and the values a
// researcher wrote or chose, one property per line. Links, contact fields,
// file names, counters and placeholders carry no meaning for an embedding.
import type { DatabaseColumn, DatabaseRow } from "./databases";
import { exportCellText } from "./databaseExport";
import { isNullMarker } from "./databaseCsv";

const EMBEDDED_TYPES = new Set([
  "title",
  "text",
  "rich_text",
  "select",
  "status",
  "multi_select",
  "location",
  "person",
  "ai",
  "date",
  "number",
  "formula",
]);
const FILE_PATH =
  /^\S+\.(?:jpe?g|png|tiff?|webp|heic|heif|bmp|gif|pdf|docx?|txt|md|csv)$/i;
/** Roughly 2k tokens: enough for long catalogue descriptions, bounded for CPU. */
export const RECORD_EMBEDDING_MAX_CHARS = 8000;

export function recordEmbeddingText(
  columns: DatabaseColumn[],
  row: DatabaseRow,
): string {
  const lines: string[] = [];
  // Title first, then properties in a stable order that does not depend on
  // their position: moving a column in the table must not change what a
  // record says, nor make its vector stale.
  const ordered = [...columns].sort(
    (a, b) =>
      Number(b.type === "title") - Number(a.type === "title") ||
      a.id.localeCompare(b.id),
  );
  for (const column of ordered) {
    if (!EMBEDDED_TYPES.has(column.type)) continue;
    const value = exportCellText(column, row)
      // Links and file paths (Notion exports carry both) say nothing about content.
      .replace(/\(?\bhttps?:\/\/[^\s)]+\)?/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!value || isNullMarker(value) || FILE_PATH.test(value)) continue;
    lines.push(column.type === "title" ? value : `${column.name}: ${value}`);
  }
  const text = lines.join("\n");
  return text.length > RECORD_EMBEDDING_MAX_CHARS
    ? text.slice(0, RECORD_EMBEDDING_MAX_CHARS)
    : text;
}

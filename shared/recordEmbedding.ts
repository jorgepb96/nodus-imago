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
  "historical_date",
  "number",
  "formula",
]);
const FILE_PATH =
  /^\S+\.(?:jpe?g|png|tiff?|webp|heic|heif|bmp|gif|pdf|docx?|txt|md|csv)$/i;
/** Roughly 2k tokens: enough for long catalogue descriptions, bounded for CPU. */
export const RECORD_EMBEDDING_MAX_CHARS = 8000;

/** What a record says, line by line: the property's name (none for the title) and its value. */
export function recordEmbeddingParts(
  columns: DatabaseColumn[],
  row: DatabaseRow,
): { label: string | null; value: string }[] {
  const parts: { label: string | null; value: string }[] = [];
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
    parts.push({ label: column.type === "title" ? null : column.name, value });
  }
  // Notes written on regions of the images say what the record shows.
  for (const annotation of (row as { annotations?: { note: string; tags: string[] }[] }).annotations ?? []) {
    const value = [annotation.note.trim(), annotation.tags.join(", ")].filter(Boolean).join(" · ");
    if (value) parts.push({ label: "Detalle", value });
  }
  return parts;
}

export function recordEmbeddingText(
  columns: DatabaseColumn[],
  row: DatabaseRow,
): string {
  const text = recordEmbeddingParts(columns, row)
    .map((part) => (part.label === null ? part.value : `${part.label}: ${part.value}`))
    .join("\n");
  return text.length > RECORD_EMBEDDING_MAX_CHARS
    ? text.slice(0, RECORD_EMBEDDING_MAX_CHARS)
    : text;
}

/**
 * What decides whether a record's text vector is out of date: its values,
 * whatever property holds them. Renaming a property, or moving its values to
 * another one (converting it to a relation keeps them in «… (texto
 * original)»), changes the words around the values but not what the record
 * says, so its thousands of vectors are not computed again for it.
 */
export function recordEmbeddingValues(columns: DatabaseColumn[], row: DatabaseRow): string {
  return recordEmbeddingParts(columns, row)
    .map((part) => part.value)
    .sort()
    .join("\n");
}

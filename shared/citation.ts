// Citations and figure captions from a record. A template names properties in
// braces: "{Autor}, {Título}, {Fecha}. {Fondo}, {Signatura}." Empty properties
// disappear with the punctuation around them. Pure, so it is tested.
import type { DatabaseColumn, DatabaseRow } from "./databases";
import { exportCellText } from "./databaseExport";

const ROLES: [RegExp, string][] = [
  [/^(autor|autora|author|fot[oó]grafo|photographer|creditos?|créditos?|credits?|artista|artist|grabador)/i, "author"],
  [/^(t[ií]tulo|title)$/i, "title"],
  [/^(fecha|date|a[ñn]o|year|datación|dating)/i, "date"],
  [/(fondo|archivo|archive|colecci[oó]n|collection|fuente|source|instituci[oó]n|repositorio|library|biblioteca)/i, "holding"],
  [/(signatura|shelfmark|call number|inventario|inventory|^id|identificador|identifier|referencia)/i, "reference"],
  [/(lugar|place|localidad|location)/i, "place"],
];
const PUBLISHED = /(fuente|libro|obra|publicaci|publicad|revista|[aá]lbum|reproduc|source|book|work|journal|magazine|published)/i;
/** File names, paths and links: what a column called "Archivo" holds when it means the file, not the archive. */
const FILE_LIKE = /^(https?:\/\/|file:)|%20|[\\/][^\s]*\.[a-z0-9]{2,4}$|\.(jpe?g|png|tiff?|gif|webp|heic|pdf)$/i;
function holdsFiles(column: DatabaseColumn, sample: DatabaseRow[]): boolean {
  const values = sample.map((row) => exportCellText(column, row).trim()).filter(Boolean);
  return values.length > 0 && values.filter((v) => FILE_LIKE.test(v)).length / values.length >= 0.5;
}

/**
 * Which property plays each role in a citation, guessed from names and types.
 * With sample records, properties that hold file names or links are left out.
 */
export function citationRoles(columns: DatabaseColumn[], sample: DatabaseRow[] = []): Partial<Record<string, string>> {
  const roles: Partial<Record<string, string>> = {};
  for (const column of columns) {
    // A relation to the books or magazines that reproduce the image, with
    // where each one prints it: «Book (p. 12 · fig. 3)».
    if (column.type === "relation" && PUBLISHED.test(column.name.trim()) && !roles.publication) {
      roles.publication = column.name;
      continue;
    }
    if (["title", "button", "files", "attachment", "ai_image", "rich_text", "relation", "rollup"].includes(column.type)) continue;
    if (holdsFiles(column, sample)) continue;
    const role =
      column.type === "historical_date" ? "date" : ROLES.find(([re]) => re.test(column.name.trim()))?.[1];
    if (role && !roles[role]) roles[role] = column.name;
  }
  const title = columns.find((c) => c.type === "title");
  if (title && !roles.title) roles.title = title.name;
  return roles;
}
const slot = (name: string | undefined) => (name ? `{${name}}` : "");
export type CitationStyle = "chicago" | "iso690" | "apa";
export const CITATION_STYLES: Record<CitationStyle, string> = {
  chicago: "Chicago (nota)",
  iso690: "ISO 690",
  apa: "APA",
};
/** A template in a style, filled with the properties that play each role. */
export function citationTemplate(columns: DatabaseColumn[], style: CitationStyle = "chicago", sample: DatabaseRow[] = []): string {
  const r = citationRoles(columns, sample);
  if (style === "iso690")
    return [slot(r.author) && `${slot(r.author)}.`, slot(r.title) && `${slot(r.title)} [fotografía].`, slot(r.place) && `${slot(r.place)},`, slot(r.date) && `${slot(r.date)}.`, slot(r.publication) && `${slot(r.publication)}.`, slot(r.holding) && `${slot(r.holding)}.`, slot(r.reference) && `${slot(r.reference)}.`]
      .filter(Boolean)
      .join(" ");
  if (style === "apa")
    return [slot(r.author) && `${slot(r.author)}`, slot(r.date) && `(${slot(r.date)}).`, slot(r.title) && `${slot(r.title)} [Fotografía].`, slot(r.publication) && `${slot(r.publication)}.`, slot(r.holding) && `${slot(r.holding)}.`, slot(r.reference) && `${slot(r.reference)}.`]
      .filter(Boolean)
      .join(" ");
  return [slot(r.author), slot(r.title) && `«${slot(r.title)}»`, slot(r.place), slot(r.date), slot(r.publication), slot(r.holding), slot(r.reference)].filter(Boolean).join(", ") + ".";
}

/** Fills a template for one record; empty properties leave no stray punctuation. */
export function renderCitation(template: string, columns: DatabaseColumn[], row: DatabaseRow): string {
  const byName = new Map(columns.map((c) => [c.name.toLocaleLowerCase(), c]));
  // A slot carries its own wrappers («», (), [], quotes) and a trailing [note].
  const SLOT = /([«"“(\[]?)\{([^{}]+)\}([»"”)\]]?(?:\s*\[[^\]]*\])?)/g;
  const slots: { value: string; before: string }[] = [];
  let cursor = 0,
    leading = "",
    match: RegExpExecArray | null;
  while ((match = SLOT.exec(template))) {
    const literal = template.slice(cursor, match.index);
    if (!slots.length) leading = literal;
    else slots[slots.length - 1].before = literal; // text after the previous slot
    const column = byName.get(match[2].trim().toLocaleLowerCase());
    // Option icons (emoji) are decoration, not part of a reference.
    const value = column
      ? exportCellText(column, row).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim()
      : "";
    slots.push({ value: value ? match[1] + value + match[3] : "", before: "" });
    cursor = match.index + match[0].length;
  }
  const trailing = template.slice(cursor);
  if (!slots.length) return template.trim();
  // Between two filled slots, the strongest punctuation of what lay between them.
  const strength = (text: string) => (/[.;:]/.test(text) ? text.match(/[.;:]/)![0] + " " : /,/.test(text) ? ", " : " ");
  let out = "",
    between = "";
  for (const slot of slots) {
    if (slot.value) {
      out += out ? strength(between) + slot.value : slot.value;
      between = "";
    }
    between += slot.before;
  }
  return out
    ? (leading + out + trailing).replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").replace(/\.\./g, ".").trim()
    : "";
}

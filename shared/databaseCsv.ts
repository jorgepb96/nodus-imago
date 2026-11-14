// Adapted from Nodus Research, © Jorge Pérez Burgueño. AGPL-3.0-only.
/**
 * Pure helpers for importing a CSV into a database: suggesting a column type from its
 * header and sample values, and normalizing a raw string to a column type. Dependency-free
 * so the inference is unit-tested without a file or a database. The actual CSV parsing lives
 * in electron/extraction/tabular.ts; the DB creation lives in databasesRepo.ts.
 */

import type { DatabaseColumnType } from './databases';

const NUMBER_RE = /^-?\d{1,3}(?:[.,]?\d{3})*(?:[.,]\d+)?$|^-?\d+(?:\.\d+)?$/;
// Date properties may include a local wall time or an explicit UTC/offset suffix.
// Keep the imported spelling lossless; the date decoder already understands both
// compact historical values and the structured range representation.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const BOOL_TRUE = new Set(['sí', 'si', 'true', 'yes', 'verdadero', 'x', '✓', '1']);
const BOOL_FALSE = new Set(['no', 'false', 'falso', '', '0']);

/**
 * Placeholders that mean "no value" in an exported sheet. They are ignored when inferring a
 * type (otherwise one "s.d." in 7k numeric years drags the whole column down to text), but
 * they are still imported verbatim — deciding they are noise is the user's call, not ours.
 */
const NULL_MARKERS = new Set(['-', '–', '—', '_', 's.d.', 's/d', 'sd', 'n/a', 'n.a.', 'na', 'null', 'none', 'ninguno', 'sin datos', '?']);

/** Whether a raw value is a "no data" placeholder rather than a real value. */
export function isNullMarker(raw: string): boolean {
  return NULL_MARKERS.has(raw.trim().toLowerCase());
}

/** Column types that can receive text from a CSV cell. */
const TEXT_BACKED_TYPES = new Set<DatabaseColumnType>([
  'title', 'rich_text', 'text', 'number', 'date', 'time', 'select', 'status', 'multi_select', 'checkbox',
  'person', 'url', 'email', 'phone', 'location', 'ai',
]);

/**
 * Whether an imported CSV value can be stored in this column type. attachment/ai_image hold
 * blobs, relation rows live in their own table, and rollup/formula are computed from other
 * columns — a CSV string has nowhere to go in those, so the importer creates the column but
 * writes no cells.
 */
export function typeStoresImportedText(type: DatabaseColumnType): boolean {
  return TEXT_BACKED_TYPES.has(type);
}

const HEADER_HINTS: { re: RegExp; kind: 'description' | 'identifier' | 'file' | 'link' }[] = [
  { re: /descrip|notas?|note|coment|comment|resumen|abstract|observac|summary/i, kind: 'description' },
  { re: /^(id|c[oó]digo|code|ref|referencia|sku|isbn|issn|doi|dni|nif|signatura)\b|_id$|\bid$/i, kind: 'identifier' },
  { re: /archivo|fichero|file|imagen|image|foto|photo|documento|document|adjunto|attach|escaneo|scan/i, kind: 'file' },
  { re: /url|link|enlace|http|web/i, kind: 'link' },
];

function headerKind(header: string): 'description' | 'identifier' | 'file' | 'link' | null {
  for (const h of HEADER_HINTS) if (h.re.test(header)) return h.kind;
  return null;
}

const MULTI_SPLIT_RE = /[,;|]/;

/** Split a multi-select cell's raw value into distinct trimmed option labels. */
export function splitMultiValue(raw: string): string[] {
  return raw
    .split(MULTI_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cap on how many distinct values still make a sensible controlled vocabulary. */
const MAX_SELECT_OPTIONS = 60;
const MAX_MULTI_OPTIONS = 100;
/** Ceiling for large catalogues: a select with more options stops being browsable. */
const MAX_LARGE_VOCABULARY = 1000;
/** How many values the multi-select probe tokenizes; the shape is stable well below this. */
const TOKEN_PROBE_SAMPLE = 1500;

function averageLength(values: string[]): number {
  return values.reduce((n, v) => n + v.length, 0) / Math.max(1, values.length);
}

/**
 * Share of the labels inside separator-bearing cells that also appear on their own in another
 * cell. Exported tag lists ("Puente Viejo - Villa A, Torre Norte - Villa B") reuse the very labels
 * that single-valued rows hold, whereas comma-laden prose almost never splits into a phrase that
 * is a whole cell elsewhere. This catches tag columns where only a minority of rows have more than
 * one value, or whose vocabulary is too large for the reuse ratio below.
 */
function multiValueCoverage(values: string[]): { multi: number; coverage: number; tokens: string[] } {
  const singles = new Set<string>();
  const tokens: string[] = [];
  let multi = 0;
  for (const v of values) {
    if (!MULTI_SPLIT_RE.test(v)) {
      singles.add(v.toLowerCase());
      continue;
    }
    multi++;
    for (const t of splitMultiValue(v)) if (!isNullMarker(t)) tokens.push(t.toLowerCase());
  }
  if (!tokens.length) return { multi, coverage: 0, tokens };
  const covered = tokens.filter((t) => singles.has(t)).length;
  return { multi, coverage: covered / tokens.length, tokens };
}

/**
 * Whether a column of separator-bearing values is a tag list rather than prose. The signal is
 * token reuse: real tags are a small vocabulary repeated across rows (55 distinct tokens seen
 * 267x each), while comma-laden prose produces nearly as many distinct tokens as tokens (1.1x).
 */
function looksMultiSelect(values: string[]): boolean {
  const withSep = values.filter((v) => MULTI_SPLIT_RE.test(v)).length;
  if (!withSep) return false;
  const { multi, coverage, tokens } = multiValueCoverage(values);
  if (multi >= 3 && coverage >= 0.6 && averageLength(tokens) <= 60) {
    const all = new Set<string>();
    for (const v of values) for (const t of splitMultiValue(v)) all.add(t.toLowerCase());
    if (all.size <= Math.max(MAX_MULTI_OPTIONS, Math.min(MAX_LARGE_VOCABULARY, values.length / 2))) return true;
  }
  if (withSep / values.length < 0.1) return false;
  const sample = values.slice(0, TOKEN_PROBE_SAMPLE);
  const sampled: string[] = [];
  for (const v of sample) for (const t of splitMultiValue(v)) sampled.push(t.toLowerCase());
  if (sampled.length === 0) return false;
  const distinct = new Set(sampled);
  if (distinct.size > MAX_MULTI_OPTIONS) return false;
  if (averageLength(sampled) > 40) return false;
  return sampled.length / distinct.size >= 3;
}

function looksSelect(values: string[]): boolean {
  // One or two stray values are not evidence of a controlled vocabulary.
  if (values.length < 3) return false;
  const distinct = new Set(values.map((v) => v.toLowerCase()));
  // A small repeating vocabulary, judged either against a tiny sample (a handful of rows) or
  // against a large one (18 regions across 7k rows is a select).
  if (distinct.size <= 12 && distinct.size <= Math.max(2, Math.floor(values.length / 3))) return true;
  if (distinct.size <= MAX_SELECT_OPTIONS && distinct.size * 5 <= values.length) return true;
  // Large catalogues keep larger vocabularies: 612 place names or 375 photographers over 7k
  // rows are still a repeated list a researcher filters by. Long values (titles, prose, links)
  // are excluded, as is anything that is not reused at least eight times on average.
  return (
    distinct.size <= MAX_LARGE_VOCABULARY &&
    distinct.size * 8 <= values.length &&
    averageLength(values) <= 48
  );
}

/**
 * Infer a column type from a sample of its (string) values.
 * Kept for callers that have values but no header; prefer suggestColumn.
 */
export function inferColumnType(values: string[]): DatabaseColumnType {
  return suggestColumn('', values, 1).type;
}

export interface CsvColumnSuggestion {
  type: DatabaseColumnType;
  /** Spanish source string explaining the pick; the UI translates it via t(). */
  reason: string;
  /** Values that are neither empty nor a null marker. */
  filled: number;
  /** Distinct non-empty values. */
  distinct: number;
  /** How many real values this type cannot represent and would import empty. */
  dropped: number;
  /** Placeholders such as "-" or "s.d." found in the column (not counted in `filled`). */
  nullMarkers: number;
  /** Distinct labels a select/multi-select would create, and the most frequent ones. */
  options?: number;
  topOptions?: string[];
  /** Options each vocabulary type would create, so the modal can warn on a manual override. */
  vocabularies: { select: number; multi_select: number };
}

/** Count values a type would silently drop, so the modal can warn before importing. */
function countDropped(type: DatabaseColumnType, values: string[]): number {
  if (!typeStoresImportedText(type)) return values.length;
  if (type !== 'number' && type !== 'date' && type !== 'time') return 0;
  let dropped = 0;
  for (const v of values) if (normalizeCsvValue(type, v) == null) dropped++;
  return dropped;
}

/** The labels a select or multi-select would create, most frequent first. */
export function vocabulary(type: 'select' | 'multi_select', values: string[]): { options: number; topOptions: string[] } {
  const counts = new Map<string, { label: string; n: number }>();
  for (const v of values)
    for (const label of type === 'multi_select' ? splitMultiValue(v) : [v.trim()]) {
      if (!label || isNullMarker(label)) continue;
      const key = optionKey(label);
      const entry = counts.get(key);
      if (entry) entry.n++;
      else counts.set(key, { label, n: 1 });
    }
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  return { options: ranked.length, topOptions: ranked.slice(0, 6).map((e) => e.label) };
}

/** Option identity used by the importer: case, width and spacing variants share one option. */
export function optionKey(label: string): string {
  return label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A readable, distinct default color per imported option (cycled). */
const IMPORTED_OPTION_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316',
  '#ec4899', '#84cc16', '#64748b', '#a855f7',
];
export function importedOptionColor(index: number): string {
  return IMPORTED_OPTION_COLORS[index % IMPORTED_OPTION_COLORS.length];
}

/**
 * Suggest a type for a column from its header and values. `index` is the column's position:
 * the first column becomes the title, since that is the row's identity in the grid.
 */
export function suggestColumn(header: string, values: string[], index: number): CsvColumnSuggestion {
  const present = values.map((v) => v.trim()).filter(Boolean);
  const real = present.filter((v) => !isNullMarker(v));
  const distinct = new Set(real.map((v) => v.toLowerCase())).size;
  const kind = headerKind(header);
  const base = {
    filled: real.length,
    distinct,
    nullMarkers: present.length - real.length,
    vocabularies: {
      select: distinct,
      multi_select: vocabulary('multi_select', real).options,
    },
  };
  const pick = (type: DatabaseColumnType, reason: string): CsvColumnSuggestion => ({
    type,
    reason,
    ...base,
    dropped: countDropped(type, real),
    ...(type === 'select' || type === 'multi_select' ? vocabulary(type, real) : {}),
  });

  if (index === 0) return pick('title', 'Primera columna: identifica la fila');
  if (real.length === 0) {
    if (kind === 'file') return pick('attachment', 'Columna vacía con nombre de archivo: lista para adjuntar');
    return pick('text', 'Columna vacía');
  }

  const lowered = real.map((v) => v.toLowerCase());
  if (real.every((v) => ISO_DATE_RE.test(v))) return pick('date', 'Todos los valores son fechas ISO');
  if (real.every((v) => TIME_RE.test(v))) return pick('time', 'Todos los valores son horas');
  if (real.every((v) => NUMBER_RE.test(v))) {
    // A numeric-looking identifier is not a quantity: keep the digits verbatim.
    if (kind === 'identifier') return pick('text', 'Parece un identificador, no una cantidad');
    return pick('number', 'Todos los valores son numéricos');
  }
  if (lowered.every((v) => BOOL_TRUE.has(v) || BOOL_FALSE.has(v)) && lowered.some((v) => BOOL_TRUE.has(v))) {
    return pick('checkbox', 'Solo dos valores de sí/no');
  }
  if (kind === 'description') return pick('text', 'Parece texto libre');
  if (kind === 'link') return pick('text', 'Parece un enlace');
  if (looksMultiSelect(real)) return pick('multi_select', 'Varias etiquetas por celda, separadas por comas');
  if (looksSelect(real))
    return pick('select', distinct <= MAX_SELECT_OPTIONS ? 'Vocabulario corto y repetido' : 'Lista amplia de valores que se repiten');
  return pick('text', 'Valores libres y variados');
}

export interface CsvImportPlan {
  headers: string[];
  /** Data rows (header row removed). */
  rows: string[][];
  /** Suggested type per column (first column defaults to title). */
  suggestedTypes: DatabaseColumnType[];
  /** Full suggestion per column, for the import modal's hints. */
  suggestions: CsvColumnSuggestion[];
}

/**
 * What the import modal receives. Deliberately holds only headers, per-column suggestions and
 * a small preview: the rows themselves stay in the main process behind `token`.
 */
export interface CsvImportPlanData {
  token: string;
  fileName: string;
  headers: string[];
  suggestedTypes: DatabaseColumnType[];
  suggestions: CsvColumnSuggestion[];
  rowCount: number;
  sampleRows: string[][];
}

/** Build an import plan from parsed CSV rows (rows[0] = header). */
export function buildCsvImportPlan(parsed: string[][]): CsvImportPlan {
  const headers = (parsed[0] ?? []).map((h, i) => h.trim() || `Columna ${i + 1}`);
  // Undo the formula-injection guard that CSV exports (ours and spreadsheets') add: a
  // leading apostrophe before = + - @ is a marker, not part of the value.
  const rows = parsed
    .slice(1)
    .filter((r) => r.some((c) => c && c.trim() !== ''))
    .map((r) => r.map((c) => (/^'[=+\-@\t\r]/.test(c) ? c.slice(1) : c)));
  const suggestions = headers.map((h, col) => suggestColumn(h, rows.map((r) => r[col] ?? ''), col));
  return { headers, rows, suggestedTypes: suggestions.map((s) => s.type), suggestions };
}

export interface CsvImportOptions {
  /**
   * Import placeholders ("-", "s.d.", "n/a"...) as empty cells in every column. Typed columns
   * (number, date, time, checkbox) always do so, since the placeholder has no typed value.
   */
  nullMarkersAsEmpty?: boolean;
}

/** Normalize a raw CSV value for a non-option column type (options handled by the repo). */
export function normalizeCsvValue(type: DatabaseColumnType, raw: string): string | null {
  const v = raw.trim();
  if (v === '') return null;
  if ((type === 'number' || type === 'date' || type === 'time' || type === 'checkbox') && isNullMarker(v)) return null;
  if (type === 'number') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? String(n) : null;
  }
  if (type === 'checkbox') {
    const lowered = v.toLowerCase();
    if (BOOL_TRUE.has(lowered)) return '1';
    if (BOOL_FALSE.has(lowered)) return '0';
    return null;
  }
  if (type === 'date') return ISO_DATE_RE.test(v) ? v : null;
  if (type === 'time') return TIME_RE.test(v) ? v : null;
  return v;
}

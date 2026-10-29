// Adapted from Nodus electron/extraction/tabular.ts. AGPL-3.0-only.
const DELIMITERS = [',', ';', '\t', '|'];

function decodeXmlEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return named[lower] ?? entity;
  });
}

/** Pick the delimiter that appears most on the first non-empty line (outside quotes). */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  let best = ',';
  let bestCount = -1;
  for (const delim of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === delim && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = delim;
    }
  }
  return best;
}

/**
 * Parse RFC-4180-ish delimited text into rows of string cells. Handles quoted
 * fields, escaped quotes (""), and delimiters/newlines inside quotes; tolerates
 * both LF and CRLF. The delimiter is auto-detected when not given.
 */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      if (text[i + 1] === '\n') continue; // CRLF — the \n ends the row
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}


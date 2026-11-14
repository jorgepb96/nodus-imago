// Historical dates: the text a cataloguer wrote ("c. 1930", "[1930]",
// "ant. 1936", "años 50", "finales del s. XIX") kept as written, with the
// period it refers to (first and last year) and how certain it is. Filters,
// the timeline, statistics and the chat read the period; the table shows
// the text. Pure, so the interpretation is unit-tested.

export type Certainty = "exact" | "approx" | "inferred" | "uncertain";
export type HistoricalDate = {
  text: string;
  /** First and last year of the period; null where it is open (before/after). */
  start: number | null;
  end: number | null;
  certainty: Certainty;
  /** Set when the user fixed the period by hand. Writing a new text reads it again. */
  manual?: boolean;
};

export const CERTAINTY_LABELS: Record<Certainty, string> = {
  exact: "Exacta",
  approx: "Aproximada",
  inferred: "Atribuida",
  uncertain: "Dudosa",
};
export const CERTAINTY_HELP: Record<Certainty, string> = {
  exact: "La fecha consta en la fuente.",
  approx: "Fecha aproximada: circa, década, siglo o una parte de él.",
  inferred: "Fecha atribuida por quien cataloga, escrita entre corchetes: [1930].",
  uncertain: "Fecha dudosa, escrita con interrogación: 1930?",
};

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
function roman(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const v = ROMAN[text[i]] ?? 0,
      next = ROMAN[text[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const YEAR = "(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})";
/** How many years either side "circa" covers. */
const CIRCA = 5;
const NULLISH = /^(-+|—|–|s\.?\s?[df]\.?|s\/[df]|sin fecha|n\.?\s?d\.?|no date|undated|desconocida?|unknown|\?+)$/;
const WORDS: Record<string, number> = {
  diez: 10, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  twenties: 20, thirties: 30, forties: 40, fifties: 50, sixties: 60, seventies: 70, eighties: 80, nineties: 90,
};

/** The century written as a Roman or Arabic number ("XIX", "19th", "19"). */
function centuryOf(text: string): number | null {
  const m =
    /\b(?:s\.|sig\.|siglo|sec\.|century)\s*([ivxlc]{1,6}|\d{1,2})\b/.exec(text) ??
    /\b([ivxlc]{1,6}|\d{1,2})(?:st|nd|rd|th)?\s+(?:century|siglo)\b/.exec(text);
  if (!m) return null;
  const c = /\d/.test(m[1]) ? Number(m[1]) : roman(m[1].toUpperCase());
  return c >= 1 && c <= 22 ? c : null;
}

/** Reads a cataloguer's date. Returns null when nothing in it is a date. */
export function parseHistoricalDate(input: string): Omit<HistoricalDate, "text"> | null {
  const raw = input.trim();
  if (!raw) return null;
  let text = fold(raw).replace(/\s+/g, " ");
  if (NULLISH.test(text)) return null;
  let certainty: Certainty = "exact";
  // [1930] is supplied by the cataloguer; 1930? is doubtful.
  if (/^\[.*\]$/.test(text) || /\[\s*\d{4}\s*\]/.test(text)) certainty = "inferred";
  if (/\?/.test(text)) certainty = "uncertain";
  text = text.replace(/[[\]?]/g, " ").replace(/\s+/g, " ").trim();
  const approx = () => {
    if (certainty === "exact") certainty = "approx";
  };

  // Before / after: "ant. 1936", "antes de 1936", "a. q. 1936", "post. 1920", "after 1920".
  const before = new RegExp(`\\b(?:ant\\.?|antes de|a\\.?\\s?q\\.?|ante quem|before|pre)\\s*${YEAR}\\b`).exec(text);
  if (before) {
    approx();
    return { start: null, end: Number(before[1]), certainty };
  }
  const after = new RegExp(`\\b(?:post\\.?|despues de|p\\.?\\s?q\\.?|post quem|after)\\s*${YEAR}\\b`).exec(text);
  if (after) {
    approx();
    return { start: Number(after[1]), end: null, certainty };
  }

  // Ranges: "1930-1935", "1930–35", "entre 1930 y 1935", "1930 a 1935".
  const range = new RegExp(`${YEAR}\\s*(?:-|–|—|/|a|y|al|to|and)\\s*(\\d{2,4})\\b`).exec(text);
  if (range) {
    const start = Number(range[1]);
    let end = Number(range[2]);
    if (range[2].length === 2) end = Math.floor(start / 100) * 100 + end;
    if (end >= start && end - start <= 200) {
      if (/\b(?:c\.?|ca\.?|circa|h\.|hacia|aprox)/.test(text)) approx();
      return { start, end, certainty };
    }
  }

  // Decades: "años 50", "años cincuenta", "década de 1950", "1950s", "the fifties".
  const decade =
    new RegExp(`\\b(?:decada de(?: los)?|anos|años)\\s*${YEAR}\\b`).exec(text) ??
    /\b(1[0-9]{2}0|20[0-9]0)'?s\b/.exec(text);
  if (decade) {
    approx();
    const d = Number(decade[1]);
    return { start: d, end: d + 9, certainty };
  }
  const shortDecade = /\b(?:anos|años|decada de los)\s*('?\d0|diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\b/.exec(text) ??
    /\b(?:the\s+)?(twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)\b/.exec(text);
  if (shortDecade) {
    approx();
    const v = shortDecade[1].replace("'", "");
    const d = 1900 + (/\d/.test(v) ? Number(v) : WORDS[v]);
    return { start: d, end: d + 9, certainty };
  }

  // Centuries and their parts.
  const century = centuryOf(text);
  if (century && !new RegExp(YEAR).test(text)) {
    approx();
    const first = (century - 1) * 100 + 1,
      last = century * 100;
    const part = (from: number, to: number) => ({ start: first + from, end: first + to, certainty });
    if (/primera mitad|first half/.test(text)) return part(0, 49);
    if (/segunda mitad|second half/.test(text)) return part(50, 99);
    if (/principios|comienzos|inicios|early/.test(text)) return part(0, 32);
    if (/mediados|mid/.test(text)) return part(33, 65);
    if (/finales|fines|late/.test(text)) return part(66, 99);
    return { start: first, end: last, certainty };
  }

  // One year, with circa: "c. 1930", "ca. 1930", "h. 1930", "hacia 1930", "~1930".
  const single = new RegExp(`(?:^|[^\\d])${YEAR}(?!\\d)`).exec(text);
  if (single) {
    const year = Number(single[1]);
    if (/(?:^|\s)(?:c\.?|ca\.?|circa|h\.|hacia|aprox\.?|aproximadamente|around|about)\s*\d|~\s*\d/.test(text)) {
      approx();
      return { start: year - CIRCA, end: year + CIRCA, certainty };
    }
    return { start: year, end: year, certainty };
  }
  return null;
}

/** The value stored for a cell, or null when the text is empty. */
export function encodeHistoricalDate(value: HistoricalDate | null): string | null {
  if (!value || !value.text.trim()) return null;
  return JSON.stringify({
    text: value.text.trim(),
    start: value.start,
    end: value.end,
    certainty: value.certainty,
    ...(value.manual ? { manual: true } : {}),
  });
}
/** A stored value, or any text: plain text is read with parseHistoricalDate. */
export function decodeHistoricalDate(raw: string | null | undefined): HistoricalDate | null {
  if (raw == null || !String(raw).trim()) return null;
  const value = String(raw);
  if (value.trimStart().startsWith("{")) {
    try {
      const o = JSON.parse(value);
      if (o && typeof o.text === "string") {
        const year = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= -3000 && v <= 2200 ? v : null);
        const certainty: Certainty = ["exact", "approx", "inferred", "uncertain"].includes(o.certainty) ? o.certainty : "exact";
        return { text: o.text, start: year(o.start), end: year(o.end), certainty, ...(o.manual ? { manual: true } : {}) };
      }
    } catch {
      /* Read as text below. */
    }
  }
  const parsed = parseHistoricalDate(value);
  return { text: value.trim(), start: parsed?.start ?? null, end: parsed?.end ?? null, certainty: parsed?.certainty ?? "exact" };
}
/** Normalises what a user or an import wrote: keeps a manual period, re-reads text. */
export function normalizeHistoricalDate(raw: string | null): string | null {
  if (raw == null || !raw.trim()) return null;
  const decoded = decodeHistoricalDate(raw);
  if (!decoded) return null;
  if (!decoded.manual && !raw.trimStart().startsWith("{")) return encodeHistoricalDate(decoded);
  if (decoded.manual) {
    const [start, end] = [decoded.start, decoded.end];
    if (start != null && end != null && start > end) throw new Error("El año inicial debe ser anterior o igual al final.");
    return encodeHistoricalDate(decoded);
  }
  // A structured value without "manual" comes from the app itself: re-read its text.
  const parsed = parseHistoricalDate(decoded.text);
  return encodeHistoricalDate({ text: decoded.text, start: parsed?.start ?? null, end: parsed?.end ?? null, certainty: parsed?.certainty ?? "exact" });
}

/** The year that stands for the period on a timeline: its middle, or its known end. */
export function representativeYear(value: Pick<HistoricalDate, "start" | "end"> | null): number | null {
  if (!value) return null;
  const { start, end } = value;
  if (start != null && end != null) return Math.round((start + end) / 2);
  return start ?? end ?? null;
}
/** "1925–1935", "1930", "hasta 1936", "desde 1920". */
export function periodLabel(value: Pick<HistoricalDate, "start" | "end"> | null, language: "es" | "en" = "es"): string {
  if (!value || (value.start == null && value.end == null)) return "";
  if (value.start != null && value.end != null)
    return value.start === value.end ? String(value.start) : `${value.start}–${value.end}`;
  return value.start != null
    ? `${language === "en" ? "from" : "desde"} ${value.start}`
    : `${language === "en" ? "until" : "hasta"} ${value.end}`;
}
/** Whether a period shares at least one year with [from, to]. Open ends reach forever. */
export function overlaps(value: Pick<HistoricalDate, "start" | "end">, from: number, to: number): boolean {
  return (value.start ?? -Infinity) <= to && (value.end ?? Infinity) >= from;
}
/** Share of values the parser can read, for import suggestions and conversions. */
export function historicalDateCoverage(values: string[]): number {
  const real = values.map((v) => v.trim()).filter(Boolean);
  if (!real.length) return 0;
  return real.filter((v) => { const p = parseHistoricalDate(v); return !!p && (p.start != null || p.end != null); }).length / real.length;
}
/** Whether values look like catalogue dates rather than plain years or ISO dates. */
export function looksHistoricalDate(values: string[]): boolean {
  const real = values.map((v) => v.trim()).filter(Boolean);
  if (real.length < 3) return false;
  const marked = real.filter((v) => /\b(c\.|ca\.|circa|h\.|hacia|ant\.|post\.|s\.\s?[ivxlc]+|siglo|decada|década|años|anos)|\[\d{4}\]|\d{4}\?|\d{4}\s*[-–]\s*\d{2,4}|\d{4}s\b/i.test(v)).length;
  return historicalDateCoverage(real) >= 0.8 && marked / real.length >= 0.05;
}

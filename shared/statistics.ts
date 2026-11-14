// Statistics over a database's records: frequencies, contingency tables
// with a chi-square test, co-occurrence of tags, trends over time and
// numeric summaries. Pure functions over already-extracted values, so the
// maths is unit-tested apart from storage.
import { decodeCheckbox, decodeMultiSelect, type DatabaseColumn } from "./databases";
import { decodeDatabaseDate } from "./databaseProperties";

export type StatChart = "bar" | "column" | "line" | "heatmap" | "table";
export type StatSpec =
  | { kind: "frequency"; columnId: string; limit?: number; chart?: StatChart }
  | {
      kind: "crosstab";
      rowColumnId: string;
      colColumnId: string;
      limit?: number;
      /** What the heatmap colours: counts, row percentages or residuals. */
      measure?: "count" | "row" | "residual";
      chart?: StatChart;
    }
  | { kind: "cooccurrence"; columnId: string; limit?: number; chart?: StatChart }
  | {
      kind: "trend";
      yearColumnId: string;
      seriesColumnId?: string | null;
      bucket?: "year" | "decade";
      limit?: number;
      chart?: StatChart;
    }
  | { kind: "numeric"; columnId: string; bins?: number; chart?: StatChart };
export type SavedStatistic = {
  id: string;
  databaseId: string;
  name: string;
  spec: StatSpec;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type Category = { label: string; count: number; share: number };
export type FrequencyResult = {
  kind: "frequency";
  records: number;
  empty: number;
  distinct: number;
  /** Labels counted (a multi-select record counts once per label). */
  mentions: number;
  categories: Category[];
  other: number;
  multi: boolean;
};
export type ChiSquare = {
  statistic: number;
  df: number;
  p: number;
  cramersV: number;
  /** Share of cells whose expected count is under 5 (test less reliable). */
  lowExpected: number;
};
export type CrosstabResult = {
  kind: "crosstab";
  records: number;
  rows: string[];
  cols: string[];
  counts: number[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
  residuals: number[][];
  chi: ChiSquare | null;
  /** Some records hold several labels: cells are not independent. */
  multi: boolean;
};
export type CooccurrenceResult = {
  kind: "cooccurrence";
  records: number;
  labels: string[];
  singles: number[];
  matrix: number[][];
  pairs: { a: string; b: string; count: number; jaccard: number; lift: number }[];
};
export type TrendResult = {
  kind: "trend";
  records: number;
  undated: number;
  bucket: "year" | "decade";
  buckets: number[];
  totals: number[];
  series: { label: string; values: number[] }[];
};
export type NumericResult = {
  kind: "numeric";
  records: number;
  n: number;
  empty: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  histogram: { from: number; to: number; count: number }[];
};
export type StatResult =
  | FrequencyResult
  | CrosstabResult
  | CooccurrenceResult
  | TrendResult
  | NumericResult;

/** Words used for empty or unknown values in catalogues ("s.d.", "-"…). */
const NULLISH = /^(-+|—|–|s\.?\s?d\.?|n\/?a|sin datos?|desconocid[oa]|unknown|\?+)$/i;

/** A record's labels for a property, as the reader sees them. */
export function categoryValues(
  column: DatabaseColumn,
  raw: string | null | undefined,
  display: string,
): string[] {
  if (raw == null || raw === "") return column.type === "checkbox" ? ["no"] : [];
  if (column.type === "multi_select")
    return decodeMultiSelect(raw)
      .map((id) => column.options.find((o) => o.id === id)?.label)
      .filter((l): l is string => !!l);
  if (column.type === "checkbox") return [decodeCheckbox(raw) ? "sí" : "no"];
  const text = display.trim();
  return text && !NULLISH.test(text) ? [text] : [];
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const roman = (text: string) => {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const v = ROMAN[text[i]], next = ROMAN[text[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
};
/**
 * The year a value refers to: a date's year, a whole number between 1000
 * and 2200, the first four-digit year written in a text ("c. 1930",
 * "1950-1959"), or the middle of a century ("s. XIX" → 1850).
 */
export function yearOf(
  column: Pick<DatabaseColumn, "type">,
  raw: string | null | undefined,
  display = raw ?? "",
): number | null {
  if (raw == null || raw === "") return null;
  if (["date", "created_time", "last_edited_time"].includes(column.type)) {
    const start = column.type === "date" ? decodeDatabaseDate(raw)?.start : raw;
    const year = start ? Number(/^-?\d{4}/.exec(start)?.[0]) : NaN;
    return Number.isFinite(year) ? year : null;
  }
  if (column.type === "number") {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1000 && n <= 2200 ? n : null;
  }
  const text = display;
  const year = /(?:^|[^\d])(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})(?!\d)/.exec(text);
  if (year) return Number(year[1]);
  const century = /\b(?:s\.|siglo|sec\.|century)\s*([IVXLC]{1,6})\b/i.exec(text);
  if (century) {
    const c = roman(century[1].toUpperCase());
    if (c >= 1 && c <= 22) return (c - 1) * 100 + 50;
  }
  return null;
}

/** How likely a property is to hold each record's date, for the timeline. */
export function yearCoverage(
  column: DatabaseColumn,
  values: { raw: string | null; display: string }[],
) {
  let dated = 0;
  for (const v of values) if (yearOf(column, v.raw, v.display) !== null) dated++;
  const share = values.length ? dated / values.length : 0;
  const named = /a[ñn]o|year|fecha|date|periodo|período|cronolog|década|decada|siglo|época|epoca/i.test(
    column.name,
  );
  const typed = ["date", "number"].includes(column.type) ? 0.05 : 0;
  return { columnId: column.id, dated, share, score: share + (named ? 0.15 : 0) + typed };
}

const round = (n: number, digits = 4) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Ln Γ(x) (Lanczos). */
function lnGamma(x: number): number {
  const g = 7,
    c = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
/** Regularised upper incomplete gamma Q(a, x). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    // Series for P, then Q = 1 − P.
    let sum = 1 / a,
      term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // Continued fraction for Q (Lentz).
  let b = x + 1 - a,
    c = 1 / 1e-300,
    d = 1 / b,
    h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}
/** P(χ² ≥ statistic) with `df` degrees of freedom. */
export function chiSquareP(statistic: number, df: number): number {
  if (df <= 0 || !Number.isFinite(statistic)) return 1;
  return Math.min(1, Math.max(0, gammaQ(df / 2, statistic / 2)));
}

/** Pearson's chi-square test of independence for a contingency table. */
export function chiSquare(counts: number[][]): { chi: ChiSquare | null; residuals: number[][] } {
  const rows = counts.length,
    cols = counts[0]?.length ?? 0,
    rowTotals = counts.map((r) => r.reduce((a, b) => a + b, 0)),
    colTotals = Array.from({ length: cols }, (_, j) => counts.reduce((a, r) => a + r[j], 0)),
    total = rowTotals.reduce((a, b) => a + b, 0);
  const residuals = counts.map((r) => r.map(() => 0));
  const usedRows = rowTotals.filter((t) => t > 0).length,
    usedCols = colTotals.filter((t) => t > 0).length;
  if (!total || usedRows < 2 || usedCols < 2) return { chi: null, residuals };
  let statistic = 0,
    low = 0,
    cells = 0;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      if (!rowTotals[i] || !colTotals[j]) continue;
      const expected = (rowTotals[i] * colTotals[j]) / total;
      cells++;
      if (expected < 5) low++;
      const diff = counts[i][j] - expected;
      statistic += (diff * diff) / expected;
      // Adjusted standardised residual: beyond ±1.96 the cell departs from
      // independence at the 5 % level.
      const adjust = Math.sqrt(expected * (1 - rowTotals[i] / total) * (1 - colTotals[j] / total));
      residuals[i][j] = adjust > 0 ? round(diff / adjust, 2) : 0;
    }
  const df = (usedRows - 1) * (usedCols - 1);
  return {
    chi: {
      statistic: round(statistic, 3),
      df,
      p: chiSquareP(statistic, df),
      cramersV: round(Math.sqrt(statistic / (total * Math.min(usedRows - 1, usedCols - 1))), 3),
      lowExpected: round(low / cells, 3),
    },
    residuals,
  };
}

/** Ranked labels with "the rest" kept apart, so charts stay readable. */
function topLabels(counts: Map<string, number>, limit: number) {
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es", { numeric: true }))
    .slice(0, limit)
    .map(([label]) => label);
}

export function frequency(values: string[][], limit = 20): FrequencyResult {
  const counts = new Map<string, number>();
  let empty = 0,
    mentions = 0,
    multi = false;
  for (const labels of values) {
    if (!labels.length) empty++;
    if (labels.length > 1) multi = true;
    for (const l of new Set(labels)) {
      counts.set(l, (counts.get(l) ?? 0) + 1);
      mentions++;
    }
  }
  const top = topLabels(counts, limit),
    shown = top.reduce((a, l) => a + counts.get(l)!, 0);
  return {
    kind: "frequency",
    records: values.length,
    empty,
    distinct: counts.size,
    mentions,
    multi,
    other: mentions - shown,
    // Shares are of records, so a multi-select can add up to more than 100 %.
    categories: top.map((label) => ({
      label,
      count: counts.get(label)!,
      share: values.length ? round(counts.get(label)! / values.length) : 0,
    })),
  };
}

export function crosstab(rowsValues: string[][], colsValues: string[][], limit = 12): CrosstabResult {
  const rowCounts = new Map<string, number>(),
    colCounts = new Map<string, number>();
  let multi = false;
  rowsValues.forEach((r, i) => {
    const c = colsValues[i];
    if (!r.length || !c.length) return;
    if (r.length > 1 || c.length > 1) multi = true;
    for (const l of new Set(r)) rowCounts.set(l, (rowCounts.get(l) ?? 0) + 1);
    for (const l of new Set(c)) colCounts.set(l, (colCounts.get(l) ?? 0) + 1);
  });
  const rows = topLabels(rowCounts, limit),
    cols = topLabels(colCounts, limit),
    rowIndex = new Map(rows.map((l, i) => [l, i])),
    colIndex = new Map(cols.map((l, i) => [l, i]));
  const counts = rows.map(() => cols.map(() => 0));
  let records = 0;
  rowsValues.forEach((r, i) => {
    const c = colsValues[i];
    let counted = false;
    for (const a of new Set(r))
      for (const b of new Set(c)) {
        const x = rowIndex.get(a),
          y = colIndex.get(b);
        if (x === undefined || y === undefined) continue;
        counts[x][y]++;
        counted = true;
      }
    if (counted) records++;
  });
  const rowTotals = counts.map((r) => r.reduce((a, b) => a + b, 0)),
    colTotals = cols.map((_, j) => counts.reduce((a, r) => a + r[j], 0));
  const { chi, residuals } = chiSquare(counts);
  return {
    kind: "crosstab",
    records,
    rows,
    cols,
    counts,
    rowTotals,
    colTotals,
    total: rowTotals.reduce((a, b) => a + b, 0),
    residuals,
    chi,
    multi,
  };
}

export function cooccurrence(values: string[][], limit = 15): CooccurrenceResult {
  const counts = new Map<string, number>();
  for (const labels of values) for (const l of new Set(labels)) counts.set(l, (counts.get(l) ?? 0) + 1);
  const labels = topLabels(counts, limit),
    index = new Map(labels.map((l, i) => [l, i])),
    matrix = labels.map(() => labels.map(() => 0));
  let records = 0;
  for (const set of values) {
    const present = [...new Set(set)].map((l) => index.get(l)).filter((i): i is number => i !== undefined);
    if (present.length) records++;
    for (const i of present) for (const j of present) matrix[i][j]++;
  }
  const singles = labels.map((_, i) => matrix[i][i]);
  const pairs: CooccurrenceResult["pairs"] = [];
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      if (matrix[i][j])
        pairs.push({
          a: labels[i],
          b: labels[j],
          count: matrix[i][j],
          jaccard: round(matrix[i][j] / (singles[i] + singles[j] - matrix[i][j]), 3),
          // Above 1: they appear together more often than chance would give.
          lift: round((matrix[i][j] * values.length) / (singles[i] * singles[j]), 2),
        });
  pairs.sort((a, b) => b.count - a.count || b.lift - a.lift);
  return { kind: "cooccurrence", records, labels, singles, matrix, pairs: pairs.slice(0, 50) };
}

export function trend(
  years: (number | null)[],
  series: string[][] | null,
  bucket: "year" | "decade" = "year",
  limit = 6,
): TrendResult {
  const key = (y: number) => (bucket === "decade" ? Math.floor(y / 10) * 10 : y);
  const dated = years.filter((y): y is number => y !== null);
  if (!dated.length)
    return { kind: "trend", records: years.length, undated: years.length, bucket, buckets: [], totals: [], series: [] };
  const min = key(Math.min(...dated)),
    max = key(Math.max(...dated)),
    step = bucket === "decade" ? 10 : 1,
    buckets: number[] = [];
  for (let b = min; b <= max; b += step) buckets.push(b);
  const at = (y: number) => (key(y) - min) / step;
  const totals = buckets.map(() => 0);
  years.forEach((y) => {
    if (y !== null) totals[at(y)]++;
  });
  let lines: TrendResult["series"] = [];
  if (series) {
    const counts = new Map<string, number>();
    series.forEach((labels, i) => {
      if (years[i] === null) return;
      for (const l of new Set(labels)) counts.set(l, (counts.get(l) ?? 0) + 1);
    });
    lines = topLabels(counts, limit).map((label) => ({ label, values: buckets.map(() => 0) }));
    const byLabel = new Map(lines.map((l) => [l.label, l]));
    series.forEach((labels, i) => {
      const y = years[i];
      if (y === null) return;
      for (const l of new Set(labels)) {
        const line = byLabel.get(l);
        if (line) line.values[at(y)]++;
      }
    });
  }
  return { kind: "trend", records: years.length, undated: years.length - dated.length, bucket, buckets, totals, series: lines };
}

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q,
    lo = Math.floor(pos),
    hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
export function numeric(values: (number | null)[], bins = 12): NumericResult {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const n = nums.length;
  if (!n)
    return {
      kind: "numeric", records: values.length, n: 0, empty: values.length,
      mean: null, median: null, sd: null, min: null, max: null, q1: null, q3: null, histogram: [],
    };
  const mean = nums.reduce((a, b) => a + b, 0) / n,
    sd = n > 1 ? Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0,
    min = nums[0],
    max = nums[n - 1];
  const count = Math.max(1, Math.min(bins, max === min ? 1 : bins)),
    width = max === min ? 1 : (max - min) / count;
  const histogram = Array.from({ length: count }, (_, i) => ({
    from: round(min + i * width, 4),
    to: round(i === count - 1 ? max : min + (i + 1) * width, 4),
    count: 0,
  }));
  for (const v of nums) histogram[Math.min(count - 1, Math.floor((v - min) / width))].count++;
  return {
    kind: "numeric",
    records: values.length,
    n,
    empty: values.length - n,
    mean: round(mean, 3),
    median: round(quantile(nums, 0.5), 3),
    sd: round(sd, 3),
    min,
    max,
    q1: round(quantile(nums, 0.25), 3),
    q3: round(quantile(nums, 0.75), 3),
    histogram,
  };
}

/** Property types each statistic accepts. */
export const CATEGORICAL_TYPES = [
  "select", "status", "multi_select", "checkbox", "text", "person", "url", "email", "phone",
  "location", "created_by", "last_edited_by", "formula", "rollup", "ai",
];
export const MULTI_TYPES = ["multi_select", "person"];

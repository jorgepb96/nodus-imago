import type { DatabaseColumn } from "./databases";
import type { PropertyFilter, PropertyFilterGroup } from "./imago";

/** Statistical contract v1. One database row is one sampling unit. No AI calls. */
export type AgreementConfig = {
  raters: { columnId: string; label: string; model: string; prompt: string }[];
  referenceId?: string;
  mode: "nominal" | "multilabel";
  delimiter: string;
  ignoreCase: boolean;
  emptySetValid: boolean;
  imagesOnly: boolean;
  cohort: "pairwise" | "complete";
  aliases: { columnId: string; from: string; to: string }[];
  weight: "none" | "linear" | "quadratic";
  categoryOrder: string[];
  notes: string;
};
export type AgreementInput = {
  databaseId: string;
  config: AgreementConfig;
  filters?: PropertyFilter[];
  filterGroups?: PropertyFilterGroup[];
  filterLogic?: "and" | "or";
};
export type AgreementSourceRow = {
  id: string;
  title: string;
  updatedAt: string;
  imageCount: number;
  image: { id: string; revision?: string } | null;
  cells: Record<string, string | null>;
};
export type AgreementSnapshot = {
  format: "nodus.imago.agreement/1";
  createdAt: string;
  database: { id: string; name: string };
  input: AgreementInput;
  columns: DatabaseColumn[];
  rows: AgreementSourceRow[];
  matched: number;
  provenance: {
    columnId: string;
    model: string;
    revision: string;
    prompt: string;
    state: string;
    count: number;
    currentMatches: number;
  }[];
};
export type Judgment = {
  labels: string[] | null;
  issue: "missing" | "invalid" | null;
};
export type Estimate = { value: number | null; reason: string | null };
export type Rate = {
  count: number;
  n: number;
  value: number | null;
  interval: [number, number] | null;
};
export type ClassAgreement = {
  label: string;
  a: number;
  b: number;
  both: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  kappa: Estimate;
};
export type PairAgreement = {
  a: string;
  b: string;
  n: number;
  excluded: number;
  exact: Rate;
  jaccard: number | null;
  kappa: Estimate;
  weightedKappa: Estimate;
  confusion: { a: string; b: string; count: number }[];
  classes: ClassAgreement[];
  microF1: number | null;
  macroF1: number | null;
};
export type GroupAgreement = {
  columns: string[];
  complete: number;
  unanimity: Rate;
  fleiss: Estimate;
  alpha: Estimate;
  alphaUnits: number;
  alphaRatings: number;
};
export type AgreementReport = {
  total: number;
  complete: number;
  categories: string[];
  coverage: {
    columnId: string;
    valid: number;
    missing: number;
    invalid: number;
  }[];
  models: GroupAgreement;
  all: GroupAgreement;
  human: {
    any: Rate;
    all: Rate;
    majority: Rate;
    noMajority: number;
    unanimousDifferent: number;
  } | null;
  pairs: PairAgreement[];
  rows: {
    source: AgreementSourceRow;
    judgments: Record<string, Judgment>;
    complete: boolean;
    modelDisagreement: boolean;
    humanDisagreement: boolean;
    unanimousDifferent: boolean;
  }[];
};
export type AgreementResult = {
  token: string;
  snapshot: AgreementSnapshot;
  report: AgreementReport;
};
export type AgreementExperiment = {
  id: string;
  databaseId: string;
  name: string;
  createdAt: string;
  total: number;
  complete: number;
};

export const agreementColumn = (column: DatabaseColumn) =>
  ["select", "status", "multi_select", "text", "rich_text", "ai"].includes(
    column.type,
  );
export const defaultAgreementConfig = (): AgreementConfig => ({
  raters: [],
  mode: "nominal",
  delimiter: ";",
  ignoreCase: true,
  emptySetValid: false,
  imagesOnly: false,
  cohort: "pairwise",
  aliases: [],
  weight: "none",
  categoryOrder: [],
  notes: "",
});
export const normalizeCategory = (value: string, ignoreCase: boolean) => {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return ignoreCase ? normalized.toLocaleLowerCase("und") : normalized;
};
const estimate = (
  value: number | null,
  reason = "Sin variación suficiente.",
): Estimate =>
  value != null && Number.isFinite(value)
    ? { value, reason: null }
    : { value: null, reason };
const ratio = (a: number, b: number) => (b ? a / b : null);
export function agreementRate(count: number, n: number): Rate {
  if (!n) return { count, n, value: null, interval: null };
  const p = count / n,
    z = 1.959963984540054,
    d = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return {
    count,
    n,
    value: p,
    interval: [Math.max(0, center - half), Math.min(1, center + half)],
  };
}
const key = (labels: string[]) => JSON.stringify(labels);
const equal = (a: string[], b: string[]) => key(a) === key(b);
function judgmentReader(
  column: DatabaseColumn,
  config: AgreementConfig,
): (raw: string | null | undefined) => Judgment {
  const norm = (v: string) => normalizeCategory(v, config.ignoreCase);
  const options = new Map(
    column.options.map((option) => [option.id, option.label]),
  );
  const aliases = new Map(
    config.aliases
      .filter((a) => a.columnId === column.id)
      .map((a) => [norm(a.from), norm(a.to)]),
  );
  return (raw) => {
    const missing: Judgment = { labels: null, issue: "missing" },
      invalid: Judgment = { labels: null, issue: "invalid" };
    if (raw == null || !raw.trim()) return missing;
    if (raw.length > 10000) return invalid;
    let values: string[];
    if (column.type === "multi_select") {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string"))
          return invalid;
        values = parsed.map((id) => options.get(id) ?? "");
        if (values.some((v) => !v)) return invalid;
      } catch {
        return invalid;
      }
    } else if (column.type === "select" || column.type === "status") {
      const label = options.get(raw);
      if (!label) return invalid;
      values = [label];
    } else {
      // Text is a categorical value, never interpreted as a generated description.
      values =
        config.mode === "multilabel" && config.delimiter
          ? raw.split(config.delimiter)
          : [raw];
    }
    values = [
      ...new Set(
        values
          .map(norm)
          .filter(Boolean)
          .map((v) => aliases.get(v) ?? v),
      ),
    ].sort();
    if (!values.length)
      return config.mode === "multilabel" && config.emptySetValid
        ? { labels: [], issue: null }
        : missing;
    if (
      values.length > 1000 ||
      values.some((v) => v.length > 500) ||
      (config.mode === "nominal" && values.length !== 1)
    )
      return invalid;
    return { labels: values, issue: null };
  };
}

/** Sparse contingency counts avoid allocating categoryCount² for text columns. */
function cohen(
  cells: { a: string; b: string; count: number }[],
  n: number,
  order?: string[],
  weight?: "linear" | "quadratic",
): Estimate {
  if (n < 2)
    return estimate(null, "Se necesitan al menos dos registros comparables.");
  const a = new Map<string, number>(),
    b = new Map<string, number>();
  for (const cell of cells) {
    a.set(cell.a, (a.get(cell.a) ?? 0) + cell.count);
    b.set(cell.b, (b.get(cell.b) ?? 0) + cell.count);
  }
  if (!weight) {
    const po =
      cells.reduce((sum, c) => sum + (c.a === c.b ? c.count : 0), 0) / n;
    const pe = [...a].reduce(
      (sum, [label, count]) => sum + ((count / n) * (b.get(label) ?? 0)) / n,
      0,
    );
    return estimate(1 - pe > 1e-12 ? (po - pe) / (1 - pe) : null);
  }
  if (!order || order.length < 2)
    return estimate(
      null,
      "Define un orden ordinal con al menos dos categorías.",
    );
  const ranks = new Map(order.map((c, i) => [c, i]));
  if ([...a.keys(), ...b.keys()].some((c) => !ranks.has(c)))
    return estimate(
      null,
      "El orden ordinal no incluye todas las categorías observadas.",
    );
  const distance = (x: string, y: string) =>
    Math.pow(
      Math.abs(ranks.get(x)! - ranks.get(y)!) / (order.length - 1),
      weight === "quadratic" ? 2 : 1,
    );
  const observed =
    cells.reduce((s, c) => s + c.count * distance(c.a, c.b), 0) / n;
  let expected = 0;
  for (const [x, nx] of a)
    for (const [y, ny] of b) expected += (((nx / n) * ny) / n) * distance(x, y);
  return estimate(expected > 1e-12 ? 1 - observed / expected : null);
}
function group(
  data: (string[] | null)[][],
  columns: string[],
  nominal: boolean,
): GroupAgreement {
  const complete = data.filter((row) => row.every((v) => v !== null));
  const unanimity = complete.filter((row) =>
    row.every((v) => equal(v!, row[0]!)),
  ).length;
  const insufficient = estimate(
    null,
    "Se necesitan dos evaluadores y dos registros comparables.",
  );
  let fleiss = insufficient,
    alpha = insufficient,
    alphaUnits = 0,
    alphaRatings = 0;
  if (columns.length >= 2 && nominal) {
    if (complete.length >= 2) {
      const totals = new Map<string, number>();
      let observed = 0;
      for (const row of complete) {
        const counts = new Map<string, number>();
        for (const labels of row) {
          const c = labels![0];
          counts.set(c, (counts.get(c) ?? 0) + 1);
          totals.set(c, (totals.get(c) ?? 0) + 1);
        }
        observed +=
          [...counts.values()].reduce((s, n) => s + n * (n - 1), 0) /
          (columns.length * (columns.length - 1));
      }
      observed /= complete.length;
      const total = complete.length * columns.length;
      const expected = [...totals.values()].reduce(
        (s, n) => s + (n / total) ** 2,
        0,
      );
      fleiss = estimate(
        1 - expected > 1e-12 ? (observed - expected) / (1 - expected) : null,
      );
    }
    const totals = new Map<string, number>();
    let disagreement = 0;
    for (const row of data) {
      const valid = row.filter((v): v is string[] => v !== null);
      if (valid.length < 2) continue;
      alphaUnits++;
      alphaRatings += valid.length;
      const counts = new Map<string, number>();
      for (const labels of valid) {
        const c = labels[0];
        counts.set(c, (counts.get(c) ?? 0) + 1);
        totals.set(c, (totals.get(c) ?? 0) + 1);
      }
      disagreement +=
        (valid.length ** 2 -
          [...counts.values()].reduce((s, n) => s + n * n, 0)) /
        (valid.length - 1);
    }
    if (alphaUnits >= 2) {
      const expected =
        (alphaRatings ** 2 -
          [...totals.values()].reduce((s, n) => s + n * n, 0)) /
        (alphaRatings * (alphaRatings - 1));
      alpha = estimate(
        expected > 1e-12 ? 1 - disagreement / alphaRatings / expected : null,
      );
    }
  } else if (!nominal) {
    fleiss = alpha = estimate(
      null,
      "En multietiqueta se calcula kappa binario por categoría; no se mezclan etiquetas como observaciones independientes.",
    );
  }
  return {
    columns,
    complete: complete.length,
    unanimity:
      columns.length >= 2
        ? agreementRate(unanimity, complete.length)
        : agreementRate(0, 0),
    fleiss,
    alpha,
    alphaUnits,
    alphaRatings,
  };
}
function pair(
  a: string,
  b: string,
  data: [string[], string[]][],
  total: number,
  config: AgreementConfig,
): PairAgreement {
  const n = data.length,
    classes = new Set<string>(),
    counts = new Map<string, { a: string; b: string; count: number }>();
  let exact = 0,
    jaccard = 0;
  const frequency = new Map<string, { a: number; b: number; both: number }>();
  for (const [left, right] of data) {
    const sa = new Set(left),
      sb = new Set(right),
      union = new Set([...left, ...right]);
    const intersection = left.filter((v) => sb.has(v)).length;
    if (equal(left, right)) exact++;
    jaccard += union.size ? intersection / union.size : 1;
    const ca = config.mode === "nominal" ? left[0] : key(left),
      cb = config.mode === "nominal" ? right[0] : key(right);
    const k = JSON.stringify([ca, cb]),
      cell = counts.get(k) ?? { a: ca, b: cb, count: 0 };
    cell.count++;
    counts.set(k, cell);
    for (const label of union) {
      classes.add(label);
      const c = frequency.get(label) ?? { a: 0, b: 0, both: 0 };
      if (sa.has(label)) c.a++;
      if (sb.has(label)) c.b++;
      if (sa.has(label) && sb.has(label)) c.both++;
      frequency.set(label, c);
    }
  }
  const perClass = [...classes].sort().map((label) => {
    const c = frequency.get(label)!;
    return {
      label,
      ...c,
      precision: ratio(c.both, c.b),
      recall: ratio(c.both, c.a),
      f1: ratio(2 * c.both, c.a + c.b),
      kappa: cohen(
        [
          { a: "1", b: "1", count: c.both },
          { a: "1", b: "0", count: c.a - c.both },
          { a: "0", b: "1", count: c.b - c.both },
          { a: "0", b: "0", count: n - c.a - c.b + c.both },
        ],
        n,
      ),
    };
  });
  const confusion = [...counts.values()].sort(
    (x, y) =>
      y.count - x.count || x.a.localeCompare(y.a) || x.b.localeCompare(y.b),
  );
  const tp = perClass.reduce((s, c) => s + c.both, 0),
    den = perClass.reduce((s, c) => s + c.a + c.b, 0);
  const f1s = perClass.map((c) => c.f1).filter((v): v is number => v !== null);
  const ordinal = config.categoryOrder.map((c) =>
    normalizeCategory(c, config.ignoreCase),
  );
  return {
    a,
    b,
    n,
    excluded: total - n,
    exact: agreementRate(exact, n),
    jaccard: ratio(jaccard, n),
    kappa:
      config.mode === "nominal"
        ? cohen(confusion, n)
        : estimate(null, "Consulta el kappa binario de cada categoría."),
    weightedKappa:
      config.mode === "nominal" && config.weight !== "none"
        ? cohen(confusion, n, ordinal, config.weight)
        : estimate(null, "Solo para una escala ordinal declarada."),
    confusion,
    classes: perClass,
    microF1: ratio(2 * tp, den),
    macroF1: f1s.length ? f1s.reduce((s, v) => s + v, 0) / f1s.length : null,
  };
}
export function calculateAgreement(
  snapshot: AgreementSnapshot,
): AgreementReport {
  const { config } = snapshot.input,
    modelIds = config.raters.map((r) => r.columnId);
  const ids = [
    ...modelIds,
    ...(config.referenceId ? [config.referenceId] : []),
  ];
  const columns = new Map(snapshot.columns.map((c) => [c.id, c]));
  const readers = new Map(
    ids.map((id) => [id, judgmentReader(columns.get(id)!, config)]),
  );
  const rows = snapshot.rows.map((source) => {
    const judgments = Object.fromEntries(
      ids.map((id) => [id, readers.get(id)!(source.cells[id])]),
    );
    const models = modelIds.map((id) => judgments[id].labels),
      valid = models.filter((v): v is string[] => v !== null);
    const reference = config.referenceId
      ? judgments[config.referenceId].labels
      : null;
    const unanimous =
      models.length >= 2 &&
      valid.length === models.length &&
      valid.every((v) => equal(v, valid[0]));
    return {
      source,
      judgments,
      complete: ids.every((id) => judgments[id].labels !== null),
      modelDisagreement:
        valid.length >= 2 && !valid.every((v) => equal(v, valid[0])),
      humanDisagreement:
        reference !== null && valid.some((v) => !equal(v, reference)),
      unanimousDifferent:
        unanimous && reference !== null && !equal(valid[0], reference),
    };
  });
  const usable =
    config.cohort === "complete" ? rows.filter((r) => r.complete) : rows;
  const pairs: PairAgreement[] = [];
  // Human is the first (reference) axis for precision/recall and confusion.
  const pairIds = [
    ...(config.referenceId ? [config.referenceId] : []),
    ...modelIds,
  ];
  for (let i = 0; i < pairIds.length; i++)
    for (let j = i + 1; j < pairIds.length; j++) {
      const a = pairIds[i],
        b = pairIds[j],
        data: [string[], string[]][] = [];
      for (const row of usable) {
        const left = row.judgments[a].labels,
          right = row.judgments[b].labels;
        if (left !== null && right !== null) data.push([left, right]);
      }
      pairs.push(pair(a, b, data, rows.length, config));
    }
  const categories = [
    ...new Set(
      rows.flatMap((r) => ids.flatMap((id) => r.judgments[id].labels ?? [])),
    ),
  ].sort();
  let human: AgreementReport["human"] = null;
  if (config.referenceId) {
    const comparable = rows.filter((r) => r.complete);
    let any = 0,
      all = 0,
      majorityMatches = 0,
      majorities = 0;
    for (const row of comparable) {
      const reference = row.judgments[config.referenceId].labels!,
        votes = new Map<string, number>();
      const matches = modelIds.filter((id) =>
        equal(row.judgments[id].labels!, reference),
      ).length;
      if (matches) any++;
      if (matches === modelIds.length) all++;
      for (const id of modelIds) {
        const k = key(row.judgments[id].labels!);
        votes.set(k, (votes.get(k) ?? 0) + 1);
      }
      const majority = [...votes].find(([, n]) => n > modelIds.length / 2);
      if (majority) {
        majorities++;
        if (majority[0] === key(reference)) majorityMatches++;
      }
    }
    human = {
      any: agreementRate(any, comparable.length),
      all: agreementRate(all, comparable.length),
      majority: agreementRate(majorityMatches, majorities),
      noMajority: comparable.length - majorities,
      unanimousDifferent: rows.filter((r) => r.unanimousDifferent).length,
    };
  }
  return {
    total: rows.length,
    complete: rows.filter((r) => r.complete).length,
    categories,
    coverage: ids.map((columnId) => ({
      columnId,
      valid: rows.filter((r) => r.judgments[columnId].labels !== null).length,
      missing: rows.filter((r) => r.judgments[columnId].issue === "missing")
        .length,
      invalid: rows.filter((r) => r.judgments[columnId].issue === "invalid")
        .length,
    })),
    models: group(
      usable.map((r) => modelIds.map((id) => r.judgments[id].labels)),
      modelIds,
      config.mode === "nominal",
    ),
    all: group(
      usable.map((r) => ids.map((id) => r.judgments[id].labels)),
      ids,
      config.mode === "nominal",
    ),
    human,
    pairs,
    rows,
  };
}

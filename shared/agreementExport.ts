import type {
  AgreementReport,
  AgreementSnapshot,
  Estimate,
  Rate,
} from "./agreement";

/** One tidy CSV, section identifies metadata/metrics/categories/confusion/record.
 * Formula-like text is escaped for spreadsheet readers; JSON preserves raw values. */
export function agreementCsv(
  snapshot: AgreementSnapshot,
  report: AgreementReport,
): string {
  const output: (string | number | null)[][] = [
    [
      "section",
      "record_id",
      "title",
      "column_a",
      "column_b",
      "category_a",
      "category_b",
      "metric",
      "value",
      "numerator",
      "denominator",
      "lower_95",
      "upper_95",
      "reason",
    ],
  ];
  const add = (
    section: string,
    a: string,
    b: string,
    metric: string,
    value: number | string | null,
    numerator: number | null = null,
    n: number | null = null,
    lower: number | null = null,
    upper: number | null = null,
    reason = "",
    ca = "",
    cb = "",
  ) =>
    output.push([
      section,
      "",
      "",
      a,
      b,
      ca,
      cb,
      metric,
      value,
      numerator,
      n,
      lower,
      upper,
      reason,
    ]);
  const rate = (metric: string, value: Rate, a = "", b = "") =>
    add(
      "metrics",
      a,
      b,
      metric,
      value.value,
      value.count,
      value.n,
      value.interval?.[0] ?? null,
      value.interval?.[1] ?? null,
    );
  const estimate = (
    metric: string,
    value: Estimate,
    a = "",
    b = "",
    n: number | null = null,
  ) =>
    add(
      "metrics",
      a,
      b,
      metric,
      value.value,
      null,
      n,
      null,
      null,
      value.reason ?? "",
    );
  add("metadata", "", "", "format", snapshot.format);
  add("metadata", "", "", "created_at", snapshot.createdAt);
  add("metadata", "", "", "database", snapshot.database.name);
  add("metadata", "", "", "unit", "database row");
  add("metadata", "", "", "input_json", JSON.stringify(snapshot.input));
  add("metadata", "", "", "columns_json", JSON.stringify(snapshot.columns));
  add(
    "metadata",
    "",
    "",
    "provenance_json",
    JSON.stringify(snapshot.provenance),
  );
  add("metadata", "", "", "matched_before_images_only", snapshot.matched);
  add("metadata", "", "", "analyzed", report.total);
  add("metadata", "", "", "complete_all_raters", report.complete);
  for (const c of report.coverage)
    for (const metric of ["valid", "missing", "invalid"] as const)
      add(
        "coverage",
        c.columnId,
        "",
        metric,
        c[metric],
        c[metric],
        report.total,
      );
  for (const [name, group] of [
    ["models", report.models],
    ["all_raters", report.all],
  ] as const) {
    rate(name + "_unanimity", group.unanimity);
    estimate(name + "_fleiss_kappa", group.fleiss, "", "", group.complete);
    estimate(
      name + "_krippendorff_alpha",
      group.alpha,
      "",
      "",
      group.alphaUnits,
    );
    add("metrics", "", "", name + "_alpha_ratings", group.alphaRatings);
  }
  if (report.human) {
    rate("any_model_matches_reference", report.human.any);
    rate("all_models_match_reference", report.human.all);
    rate("strict_majority_matches_reference", report.human.majority);
    add("metrics", "", "", "no_strict_majority", report.human.noMajority);
    add(
      "metrics",
      "",
      "",
      "unanimous_models_differ_from_reference",
      report.human.unanimousDifferent,
    );
  }
  for (const p of report.pairs) {
    rate("exact_agreement", p.exact, p.a, p.b);
    estimate("cohen_kappa", p.kappa, p.a, p.b, p.n);
    estimate("weighted_cohen_kappa", p.weightedKappa, p.a, p.b, p.n);
    for (const metric of ["jaccard", "microF1", "macroF1"] as const)
      add("metrics", p.a, p.b, metric, p[metric], null, p.n);
    for (const c of p.confusion)
      add(
        "confusion",
        p.a,
        p.b,
        "count",
        c.count,
        c.count,
        p.n,
        null,
        null,
        "",
        c.a,
        c.b,
      );
    for (const c of p.classes)
      for (const metric of [
        "a",
        "b",
        "both",
        "precision",
        "recall",
        "f1",
        "kappa",
      ] as const)
        add(
          "category",
          p.a,
          p.b,
          metric,
          metric === "kappa" ? c.kappa.value : c[metric],
          null,
          p.n,
          null,
          null,
          metric === "kappa" ? (c.kappa.reason ?? "") : "",
          c.label,
        );
  }
  for (const r of report.rows)
    for (const [columnId, j] of Object.entries(r.judgments)) {
      output.push([
        "record",
        r.source.id,
        r.source.title,
        columnId,
        "",
        "",
        "",
        "labels",
        j.labels === null ? null : JSON.stringify(j.labels),
        null,
        null,
        null,
        null,
        j.issue,
      ]);
      output.push([
        "raw_record",
        r.source.id,
        r.source.title,
        columnId,
        "",
        "",
        "",
        "raw_value",
        r.source.cells[columnId] ?? null,
        null,
        null,
        null,
        null,
        r.source.updatedAt,
      ]);
    }
  const escape = (value: string | number | null) => {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text))
      text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return "\uFEFF" + output.map((row) => row.map(escape).join(",")).join("\r\n");
}

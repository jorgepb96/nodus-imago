// The facts of a methodology report, gathered from the collection: the data
// and how it is structured, the vocabularies, the models and their exact
// instructions, what the researcher reviewed and corrected, the agreement
// trials, the parameters of variant detection and of the search index, the
// saved views and statistics. Nothing is sent anywhere; the report is built
// from what Imago already keeps.
import { createHash } from "node:crypto";
import type { Repository } from "../db/repository";
import { Statistics, specColumns } from "../db/statistics";
import { SavedViews } from "../db/savedViews";
import { calculateAgreement, type AgreementSnapshot } from "../../shared/agreement";
import { aiPresetOf, AI_PRESETS } from "../../shared/databaseAi";
import {
  decodeMultiSelect,
  isAiColumn,
  linkRollupField,
  LINK_FIELD_LABELS,
  type DatabaseColumn,
  type DatabaseKind,
} from "../../shared/databases";
import { SENSITIVITY } from "../../shared/variants";
import { MINIATURE } from "../db/cropMatch";
import type { PropertyFilter, PropertyFilterGroup, RecordRow } from "../../shared/imago";
import type {
  MethodologyAiProperty,
  MethodologyData,
  MethodologyDatabase,
  MethodologyFilter,
  MethodologyModel,
  MethodologyProperty,
} from "../../shared/methodology";
import catalog from "../../shared/modelCatalog.json";

/** Options listed per vocabulary; the rest are counted. */
const MAX_OPTIONS = 40;
const marks = (xs: unknown[]) => xs.map(() => "?").join(",");
const ratio = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export type MethodologyContext = {
  repo: Repository;
  /** The search index's current contract and its vector size. */
  contract: string;
  dimensions: number;
  /** The circulation of the databases' photographs, computed by the service (it needs the variant families). */
  circulation?: import("../../shared/variants").CirculationSummary | null;
};

export function collectMethodology(ctx: MethodologyContext, input: { databaseIds: string[] }): Omit<MethodologyData, "environment"> {
  const { repo } = ctx;
  const settings = repo.getSettings();
  const ids = [...new Set(input.databaseIds)].filter((id) => repo.db.prepare("SELECT 1 FROM db_databases WHERE id=?").get(id));
  if (!ids.length) throw new Error("Elige al menos una base de datos.");
  const details = ids.map((id) => repo.detail(id));
  const nameOf = new Map(repo.list().map((d) => [d.id, d.name]));
  const columnName = new Map(repo.list().flatMap((d) => repo.detail(d.id).columns.map((c) => [c.id, c.name] as const)));
  const rowsOf = new Map<string, RecordRow[]>();
  for (const d of details) {
    const rowIds = (repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position,id").all(d.database.id) as { id: string }[]).map((r) => r.id);
    const rows: RecordRow[] = [];
    for (let i = 0; i < rowIds.length; i += 300) rows.push(...repo.hydrate(rowIds.slice(i, i + 300)));
    rowsOf.set(d.database.id, rows);
  }
  const allRows = [...rowsOf.values()].flat();
  const rowIds = allRows.map((r) => r.id);
  const inRows = `(SELECT id FROM db_rows WHERE database_id IN (${marks(ids)}))`;
  const one = <T>(sql: string, ...args: unknown[]) => repo.db.prepare(sql).get(...args) as T;
  const all = <T>(sql: string, ...args: unknown[]) => repo.db.prepare(sql).all(...args) as T[];

  // ── Databases, properties and vocabularies ─────────────────────────────
  const authorities = new Map(
    all<{ option_id: string; link_json: string }>("SELECT option_id,link_json FROM option_authorities").map((a) => {
      try {
        const link = JSON.parse(a.link_json) as { source?: string; id?: string };
        return [a.option_id, [link.source, link.id].filter(Boolean).join(" ")] as const;
      } catch {
        return [a.option_id, ""] as const;
      }
    }),
  );
  const databases: MethodologyDatabase[] = details.map((d) => {
    const rows = rowsOf.get(d.database.id)!;
    const filled = (c: DatabaseColumn) =>
      rows.filter((r) =>
        ["attachment", "files"].includes(c.type)
          ? r.images.some((i) => i.columnId === c.id)
          : c.type === "relation"
            ? !!r.links?.[c.id]?.length
            : (() => {
                const v = r.cells[c.id];
                return v != null && v !== "" && v !== "[]" && v !== "null";
              })(),
      ).length;
    const properties = d.columns.map((c): MethodologyProperty => {
      const p: MethodologyProperty = { id: c.id, name: c.name, type: c.type, filled: filled(c), ai: isAiColumn(c) };
      if (c.type === "relation" && c.config.relationTargetDatabaseId)
        p.relation = {
          target: nameOf.get(c.config.relationTargetDatabaseId as string) ?? "",
          twoWay: !!c.config.relationInverseColumnId,
          place: repo.relationPlace(c),
        };
      if (c.type === "rollup") {
        const field = linkRollupField(c.config.rollupTargetColumnId);
        p.rollup = {
          relation: columnName.get(c.config.rollupRelationColumnId ?? "") ?? "",
          target: field ? LINK_FIELD_LABELS[field] : c.config.rollupTargetColumnId === "__title__" ? "__title__" : (columnName.get(c.config.rollupTargetColumnId ?? "") ?? ""),
          fn: c.config.rollupFunction ?? "",
        };
      }
      if (["select", "multi_select", "status"].includes(c.type)) {
        const counts = new Map<string, number>();
        for (const r of rows)
          for (const id of c.type === "multi_select" ? decodeMultiSelect(r.cells[c.id] ?? null) : r.cells[c.id] ? [r.cells[c.id]!] : [])
            counts.set(id, (counts.get(id) ?? 0) + 1);
        const definitions = (c.config.aiDefinitionsOn && c.config.aiDefinitions) || {};
        const options = c.options
          .map((o) => ({
            label: o.label,
            count: counts.get(o.id) ?? 0,
            ...(definitions[o.label.toLocaleLowerCase()] ? { definition: definitions[o.label.toLocaleLowerCase()] } : {}),
            ...(authorities.get(o.id) ? { authority: authorities.get(o.id) } : {}),
          }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));
        p.options = options.slice(0, MAX_OPTIONS);
        if (options.length > MAX_OPTIONS) p.moreOptions = options.length - MAX_OPTIONS;
      }
      return p;
    });
    // The same values and image files give the same hash, whatever their order.
    const hash = createHash("sha256");
    for (const r of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
      hash.update(r.id);
      for (const [column, value] of Object.entries(r.cells).sort(([a], [b]) => a.localeCompare(b)))
        if (value != null && !["formula", "rollup"].includes(d.columns.find((c) => c.id === column)?.type ?? "")) hash.update(`\u0001${column}\u0002${value}`);
      for (const image of [...r.images].sort((a, b) => a.contentHash.localeCompare(b.contentHash))) hash.update(`\u0003${image.contentHash}`);
    }
    return {
      id: d.database.id,
      name: d.database.name,
      kind: (d.database.kind ?? null) as DatabaseKind | null,
      records: rows.length,
      images: rows.reduce((n, r) => n + r.images.length, 0),
      recordsWithImages: rows.filter((r) => r.images.length).length,
      properties,
      fingerprint: hash.digest("hex"),
    };
  });
  const fingerprint = createHash("sha256")
    .update(databases.map((d) => d.fingerprint).join(""))
    .digest("hex");

  // ── AI properties: instructions, models and what happened to their values ──
  type Write = { row_id: string; column_id: string; source: string | null; id: number };
  const aiWrites = rowIds.length
    ? all<Write>(`SELECT id,row_id,column_id,source FROM history WHERE kind='ai' AND undone=0 AND row_id IN ${inRows}`, ...ids)
    : [];
  const laterEdit = repo.db.prepare(
    "SELECT 1 FROM history WHERE row_id=? AND column_id=? AND id>? AND undone=0 AND (kind IS NULL OR kind<>'ai') LIMIT 1",
  );
  const promptText = repo.db.prepare("SELECT text FROM ai_prompts WHERE hash=?");
  const parseSource = (source: string | null) => {
    try {
      return JSON.parse(source ?? "{}") as { model?: string; revision?: string; prompt?: string };
    } catch {
      return {};
    }
  };
  const presetLabel = (id: string) => AI_PRESETS.find((p) => p.id === id)?.label ?? id;
  const aiProperties: MethodologyAiProperty[] = details.flatMap((d) =>
    d.columns
      .filter((c) => isAiColumn(c) || all<{ n: number }>("SELECT 1 n FROM proposals WHERE column_id=? LIMIT 1", c.id).length)
      .map((c) => {
        const writes = aiWrites.filter((w) => w.column_id === c.id);
        // The last write per record is the one that counts.
        const last = new Map<string, Write>();
        for (const w of writes) if (!last.has(w.row_id) || last.get(w.row_id)!.id < w.id) last.set(w.row_id, w);
        let corrected = 0;
        for (const w of last.values()) if (laterEdit.get(w.row_id, w.column_id, w.id)) corrected++;
        const byModel = new Map<string, { model: string; revision: string; count: number }>();
        const byPrompt = new Map<string, number>();
        for (const w of last.values()) {
          const s = parseSource(w.source);
          const key = `${s.model ?? "?"}\u0000${s.revision ?? ""}`;
          const entry = byModel.get(key) ?? byModel.set(key, { model: s.model ?? "?", revision: s.revision ?? "", count: 0 }).get(key)!;
          entry.count++;
          if (s.prompt) byPrompt.set(s.prompt, (byPrompt.get(s.prompt) ?? 0) + 1);
        }
        // Proposals keep their instructions verbatim.
        const proposals = all<{ state: string; n: number }>("SELECT state,count(*) n FROM proposals WHERE column_id=? GROUP BY state", c.id);
        const proposalPrompts = all<{ prompt: string; n: number }>("SELECT prompt,count(*) n FROM proposals WHERE column_id=? AND state<>'rejected' GROUP BY prompt", c.id);
        const prompts = [
          ...[...byPrompt].map(([hash, count]) => ({ hash, text: (promptText.get(hash) as { text: string } | undefined)?.text ?? "", count })),
          ...proposalPrompts.map((p) => ({ hash: createHash("sha256").update(p.prompt).digest("hex"), text: p.prompt, count: p.n })),
        ].filter((p) => p.text);
        for (const p of all<{ model: string; revision: string; n: number }>(
          "SELECT model,revision,count(*) n FROM proposals WHERE column_id=? AND state='accepted' GROUP BY model,revision",
          c.id,
        )) {
          const key = `${p.model}\u0000${p.revision}`;
          const entry = byModel.get(key) ?? byModel.set(key, { model: p.model, revision: p.revision, count: 0 }).get(key)!;
          entry.count += p.n;
        }
        const state = (name: string) => proposals.find((p) => p.state === name)?.n ?? 0;
        const definitions = c.config.aiDefinitionsOn
          ? Object.entries(c.config.aiDefinitions ?? {})
              .filter(([, text]) => text?.trim())
              .map(([label, text]) => ({ label: c.options.find((o) => o.label.toLocaleLowerCase() === label)?.label ?? label, text }))
          : [];
        const model = c.config.aiModel as { provider: string; model: string } | null | undefined;
        return {
          database: d.database.name,
          name: c.name,
          type: c.type,
          preset: c.type === "ai" && aiPresetOf(c.config) !== "custom" ? presetLabel(aiPresetOf(c.config)) : null,
          instructions: c.config.aiPrompt?.trim() || null,
          criteria: c.config.aiCriteriaOn ? c.config.aiCriteria?.trim() || null : null,
          definitions,
          tags: c.config.aiTags ?? [],
          maxTags: typeof c.config.aiMaxTags === "number" ? c.config.aiMaxTags : null,
          freeTags: !!c.config.aiFreeTags,
          source: c.config.aiSourceColumnId ? (columnName.get(c.config.aiSourceColumnId) ?? null) : null,
          configuredModel: model ? `${model.provider}/${model.model}` : null,
          writes: [...byModel.values()].sort((a, b) => b.count - a.count),
          prompts,
          proposals: { accepted: state("accepted"), rejected: state("rejected"), pending: state("pending") },
          corrected,
          kept: last.size - corrected,
        };
      }),
  );

  // ── Models ──────────────────────────────────────────────────────────────
  const models = new Map<string, MethodologyModel>();
  const known = (catalog as { id: string; repository: string; revision: string; label: string; task: string; license?: string }[]);
  const addModel = (model: string, revision: string | undefined, task: MethodologyModel["task"], uses: number) => {
    // Settings name local models by catalogue id, sometimes with a runtime suffix («-onnx»).
    const entry = known.find((m) => m.repository === model || m.id === model || model.startsWith(`${m.id}-`));
    const api = (revision ?? "").startsWith("API") || model.includes("/") && !entry;
    const key = `${model}\u0000${task}`;
    const current = models.get(key);
    if (current) {
      current.uses += uses;
      return;
    }
    models.set(key, {
      model: entry?.repository ?? model,
      ...(entry ? { label: entry.label, license: entry.license } : {}),
      revision: entry?.revision ?? revision,
      task,
      where: api ? "api" : "local",
      uses,
    });
  };
  for (const p of aiProperties) for (const w of p.writes) addModel(w.model, w.revision, "property", w.count);
  const choiceName = (choice: { provider: string; model: string } | undefined) =>
    !choice ? null : choice.provider === "local" ? choice.model : `${choice.provider}/${choice.model}`;
  for (const [choice, task] of [
    [settings.descriptionModel, "description"],
    [settings.classificationModel, "classification"],
  ] as const) {
    const name = choiceName(choice);
    if (name) addModel(name, choice.provider === "local" ? undefined : "API", task, 0);
  }
  const indexImages = rowIds.length
    ? one<{ n: number }>(`SELECT count(DISTINCT content_hash) n FROM image_assets WHERE row_id IN ${inRows}`, ...ids).n
    : 0;
  const imagesIndexed = rowIds.length
    ? one<{ n: number }>(
        `SELECT count(DISTINCT a.content_hash) n FROM image_assets a JOIN embeddings e ON e.content_hash=a.content_hash AND e.contract=? WHERE a.row_id IN ${inRows}`,
        ctx.contract,
        ...ids,
      ).n
    : 0;
  addModel(settings.embeddingModel, settings.embeddingModel === "api-embedding" ? "API" : undefined, "embedding", imagesIndexed);
  const restorations = rowIds.length
    ? all<{ provider: string; model: string; task: string; count: number }>(
        `SELECT provider,model,task,count(*) count FROM restorations WHERE row_id IN ${inRows} GROUP BY provider,model,task ORDER BY count DESC`,
        ...ids,
      )
    : [];
  for (const r of restorations) addModel(`${r.provider}/${r.model}`, "API", "restoration", r.count);
  const embeddingEntry = known.find((m) => m.id === settings.embeddingModel || settings.embeddingModel.startsWith(`${m.id}-`));

  // ── Review and corrections ──────────────────────────────────────────────
  const count = (sql: string, ...args: unknown[]) => (rowIds.length ? one<{ n: number }>(sql, ...args).n : 0);
  const states = rowIds.length ? all<{ state: string; n: number }>(`SELECT state,count(*) n FROM proposals WHERE row_id IN ${inRows} GROUP BY state`, ...ids) : [];
  const stateOf = (name: string) => states.find((s) => s.state === name)?.n ?? 0;
  const hashes = rowIds.length ? all<{ h: string }>(`SELECT DISTINCT content_hash h FROM image_assets WHERE row_id IN ${inRows}`, ...ids).map((r) => r.h) : [];
  const hashSet = new Set(hashes);
  const verdicts = all<{ a: string; b: string; verdict: string; kind: string | null }>("SELECT a,b,verdict,kind FROM variant_verdicts").filter(
    (v) => hashSet.has(v.a) || hashSet.has(v.b),
  );
  const kinds: Record<string, number> = {};
  for (const v of verdicts) if (v.verdict === "same" && v.kind) kinds[v.kind] = (kinds[v.kind] ?? 0) + 1;
  const columnIds = details.flatMap((d) => d.columns.map((c) => c.id));
  const heritage = columnIds.length
    ? all<{ state: string; n: number }>(`SELECT state,count(*) n FROM heritage_proposals WHERE column_id IN (${marks(columnIds)}) GROUP BY state`, ...columnIds)
    : [];
  const heritageOf = (name: string) => heritage.find((s) => s.state === name)?.n ?? 0;
  const worksDbs = details.filter((d) => d.database.kind === "works").map((d) => d.database.id);

  // ── Agreement trials ────────────────────────────────────────────────────
  const agreement = all<{ name: string; created_at: string; snapshot_json: string }>(
    `SELECT name,created_at,snapshot_json FROM agreement_experiments WHERE database_id IN (${marks(ids)}) ORDER BY created_at`,
    ...ids,
  ).flatMap((e) => {
    try {
      const snapshot = JSON.parse(e.snapshot_json) as AgreementSnapshot;
      const report = calculateAgreement(snapshot);
      const config = snapshot.input.config;
      const nameIn = (id: string) => snapshot.columns.find((c) => c.id === id)?.name ?? id;
      return [
        {
          name: e.name,
          database: snapshot.database.name,
          createdAt: e.created_at,
          units: report.total,
          complete: report.complete,
          raters: config.raters.map((r) => ({ label: r.label || nameIn(r.columnId), model: r.model })),
          reference: config.referenceId ? nameIn(config.referenceId) : null,
          mode: config.mode,
          fleiss: ratio(report.models.fleiss.value),
          alpha: ratio(report.models.alpha.value),
          unanimity: ratio(report.models.unanimity.value),
          allMatchReference: ratio(report.human?.all.value),
          anyMatchesReference: ratio(report.human?.any.value),
          notes: config.notes ?? "",
        },
      ];
    } catch {
      return [];
    }
  });

  // ── Saved views and statistics ──────────────────────────────────────────
  const optionLabel = (column: DatabaseColumn | undefined, value: string) =>
    column?.options.find((o) => o.id === value)?.label ??
    (column?.type === "relation" ? (repo.hydrate([value])[0]?.title ?? value) : value);
  const filtersOf = (columns: DatabaseColumn[], filters: PropertyFilter[], groups: PropertyFilterGroup[]): MethodologyFilter[] => {
    const one = (f: PropertyFilter, group?: number): MethodologyFilter => {
      const column = columns.find((c) => c.id === f.columnId);
      const values = Array.isArray(f.value) ? f.value : [f.value];
      return {
        property: column?.name ?? f.columnId,
        op: f.op,
        value: values.filter((v) => v !== "").map((v) => optionLabel(column, v)).join(", "),
        ...(group !== undefined ? { group } : {}),
      };
    };
    const out = filters.filter((f) => !f.disabled).map((f) => one(f));
    const walk = (list: PropertyFilterGroup[], depth: number) =>
      list.forEach((g, i) => {
        out.push(...g.filters.filter((f) => !f.disabled).map((f) => one(f, depth * 100 + i + 1)));
        if (g.groups) walk(g.groups, depth + 1);
      });
    walk(groups, 0);
    return out;
  };
  const savedViews = new SavedViews(repo);
  const views = details.flatMap((d) =>
    savedViews.list(d.database.id).map((v) => ({
      database: d.database.name,
      name: v.name,
      view: v.view,
      logic: v.criteria.filterLogic ?? "and",
      filters: filtersOf(d.columns, v.criteria.filters ?? [], v.criteria.filterGroups ?? []),
      sorts: (v.criteria.sorts ?? []).map((s) => ({ property: columnName.get(s.columnId) ?? s.columnId, desc: s.direction === "desc" })),
    })),
  );
  const stats = new Statistics(repo);
  const statistics = details.flatMap((d) =>
    stats.list(d.database.id).map((s) => {
      const properties = specColumns(s.spec).map((id) => columnName.get(id) ?? id);
      try {
        return { database: d.database.name, name: s.name, spec: s.spec, properties, result: stats.compute(d.database.id, rowsOf.get(d.database.id)!.map((r) => r.id), s.spec) };
      } catch (error) {
        return { database: d.database.name, name: s.name, spec: s.spec, properties, result: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );

  return {
    format: "nodus.imago.methodology/1",
    generatedAt: new Date().toISOString(),
    language: settings.language,
    accent: settings.accent,
    databases,
    fingerprint,
    models: [...models.values()].sort((a, b) => b.uses - a.uses),
    aiProperties,
    review: {
      proposals: { accepted: stateOf("accepted"), rejected: stateOf("rejected"), pending: stateOf("pending") },
      aiWrites: aiProperties.reduce((n, p) => n + p.kept + p.corrected, 0),
      aiCorrected: aiProperties.reduce((n, p) => n + p.corrected, 0),
      manualEdits: count(`SELECT count(*) n FROM history WHERE undone=0 AND kind IS NULL AND row_id IN ${inRows}`, ...ids),
      variantVerdicts: {
        same: verdicts.filter((v) => v.verdict === "same").length,
        different: verdicts.filter((v) => v.verdict === "different").length,
        kinds,
      },
      heritage: { accepted: heritageOf("accepted"), rejected: heritageOf("rejected"), pending: heritageOf("pending") },
      authorities: columnIds.length ? one<{ n: number }>(`SELECT count(*) n FROM option_authorities WHERE column_id IN (${marks(columnIds)})`, ...columnIds).n : 0,
      linkDetails: count(`SELECT count(*) n FROM relation_details WHERE a IN ${inRows} OR b IN ${inRows}`, ...ids, ...ids),
      works: worksDbs.length ? one<{ n: number }>(`SELECT count(*) n FROM db_rows WHERE database_id IN (${marks(worksDbs)})`, ...worksDbs).n : 0,
      manualAppearances: hashes.length ? one<{ n: number }>(`SELECT count(*) n FROM image_appearances WHERE content_hash IN (${marks(hashes)})`, ...hashes).n : 0,
      annotations: count(`SELECT count(*) n FROM image_annotations WHERE row_id IN ${inRows}`, ...ids),
      undone: count(`SELECT count(*) n FROM history WHERE undone=1 AND row_id IN ${inRows}`, ...ids),
    },
    agreement,
    circulation: ctx.circulation
      ? {
          ...ctx.circulation,
          origins: hashes.length ? one<{ n: number }>(`SELECT count(*) n FROM image_origins WHERE content_hash IN (${marks(hashes)})`, ...hashes).n : 0,
        }
      : null,
    variants: {
      sensitivity: Object.entries(SENSITIVITY).map(([name, v]) => ({ name, bits: v.bits, cosine: v.cosine })),
      images: hashes.length,
      fingerprinted: hashes.length ? one<{ n: number }>(`SELECT count(*) n FROM image_fingerprints WHERE content_hash IN (${marks(hashes)})`, ...hashes).n : 0,
      miniature: MINIATURE,
    },
    index: {
      model: settings.embeddingModel,
      label: embeddingEntry?.label ?? null,
      revision: embeddingEntry?.revision ?? null,
      dimensions: ctx.dimensions,
      visionBudget: settings.visionBudget ?? null,
      images: indexImages,
      imagesIndexed,
      records: rowIds.length,
      recordsIndexed: count(`SELECT count(*) n FROM record_embeddings WHERE contract=? AND stale=0 AND row_id IN ${inRows}`, ctx.contract, ...ids),
      stale: count(`SELECT count(*) n FROM record_embeddings WHERE contract=? AND stale=1 AND row_id IN ${inRows}`, ctx.contract, ...ids),
    },
    views,
    statistics,
    restorations,
    settings: {
      profile: settings.profile,
      device: settings.device,
      parallelJobs: settings.parallelJobs,
      apiDelayMs: settings.apiDelayMs,
      remoteEnabled: settings.remoteEnabled,
    },
  };
}

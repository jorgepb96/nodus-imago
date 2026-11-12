import { randomUUID as uuid } from "node:crypto";
import fs from "node:fs/promises";
import type { Repository } from "../db/repository";
import { compileViewFilters } from "../db/viewQuery";
import {
  agreementColumn,
  calculateAgreement,
  normalizeCategory,
} from "../../shared/agreement";
import type {
  AgreementInput,
  AgreementSnapshot,
  AgreementExperiment,
  AgreementResult,
} from "../../shared/agreement";
import { agreementCsv } from "../../shared/agreementExport";

export class AgreementResearch {
  // Tokens bind saves/exports to the exact computed snapshot, never to edited UI inputs.
  private recent = new Map<string, AgreementResult>();
  constructor(private repo: Repository) {}
  private result(snapshot: AgreementSnapshot): AgreementResult {
    const result = {
      token: uuid(),
      snapshot,
      report: calculateAgreement(snapshot),
    };
    this.recent.set(result.token, result);
    while (this.recent.size > 16)
      this.recent.delete(this.recent.keys().next().value!);
    return result;
  }
  private get(token: string) {
    const result = this.recent.get(token);
    if (!result)
      throw new Error(
        "El resultado ha caducado. Vuelve a calcularlo o abre el ensayo guardado.",
      );
    return result;
  }
  run(input: AgreementInput): AgreementResult {
    const detail = this.repo.detail(input.databaseId),
      { config } = input;
    const ids = [
      ...config.raters.map((r) => r.columnId),
      ...(config.referenceId ? [config.referenceId] : []),
    ];
    if (new Set(ids).size !== ids.length || ids.length < 2)
      throw new Error(
        "Elige al menos dos columnas diferentes; la referencia humana debe ser independiente.",
      );
    const columns = ids.map((id) => detail.columns.find((c) => c.id === id));
    if (columns.some((c) => !c || !agreementColumn(c)))
      throw new Error(
        "Selecciona propiedades categóricas de esta base de datos.",
      );
    const norm = (v: string) => normalizeCategory(v, config.ignoreCase);
    if (
      config.aliases.some(
        (a) => !ids.includes(a.columnId) || !norm(a.from) || !norm(a.to),
      )
    )
      throw new Error("Revisa las equivalencias de categorías.");
    const aliasKeys = config.aliases.map((a) =>
      JSON.stringify([a.columnId, norm(a.from)]),
    );
    if (new Set(aliasKeys).size !== aliasKeys.length)
      throw new Error(
        "Cada categoría de origen solo puede tener una equivalencia por columna.",
      );
    const order = config.categoryOrder.map(norm);
    if (
      config.weight !== "none" &&
      (config.mode !== "nominal" ||
        order.length < 2 ||
        order.some((v) => !v) ||
        new Set(order).size !== order.length)
    )
      throw new Error(
        "El kappa ponderado requiere una escala ordinal con categorías distintas y ordenadas.",
      );
    if (config.mode === "multilabel" && !config.delimiter.trim())
      throw new Error(
        "Indica un separador para las columnas de texto multietiqueta.",
      );
    const snapshot = this.repo.db.transaction((): AgreementSnapshot => {
      const filters = compileViewFilters(input, (id) => this.repo.column(id));
      const title = detail.columns.find((c) => c.type === "title");
      const records = this.repo.db
        .prepare(
          `SELECT r.id,r.updated_at updatedAt,
        coalesce((SELECT c.value_text FROM db_cells c WHERE c.row_id=r.id AND c.column_id=?),'') title,
        (SELECT count(*) FROM image_assets a WHERE a.row_id=r.id) imageCount
        FROM db_rows r WHERE r.database_id=? ${filters.sql ? "AND " + filters.sql : ""}
        ORDER BY r.position,r.id`,
        )
        .all(title?.id ?? "", input.databaseId, ...filters.params) as {
        id: string;
        title: string;
        updatedAt: string;
        imageCount: number;
      }[];
      const included = records.filter(
        (r) => !config.imagesOnly || r.imageCount > 0,
      );
      const cells = this.repo.db
        .prepare(
          "SELECT row_id rowId,column_id columnId,value_text value FROM db_cells WHERE row_id IN(SELECT value FROM json_each(?)) AND column_id IN(SELECT value FROM json_each(?))",
        )
        .all(
          JSON.stringify(included.map((r) => r.id)),
          JSON.stringify(ids),
        ) as { rowId: string; columnId: string; value: string | null }[];
      const byRow = new Map<string, Record<string, string | null>>();
      for (const cell of cells) {
        const row = byRow.get(cell.rowId) ?? {};
        row[cell.columnId] = cell.value;
        byRow.set(cell.rowId, row);
      }
      const image = this.repo.db.prepare(
        "SELECT id,json_extract(metadata_json,'$.imagoRelinkRevision') revision FROM image_assets WHERE row_id=? AND width>0 ORDER BY position,id LIMIT 1",
      );
      const provenance = this.repo.db
        .prepare(
          `SELECT p.column_id columnId,p.model,p.revision,p.prompt,p.state,count(*) count,
        sum(CASE WHEN p.state='accepted' AND p.value IS c.value_text THEN 1 ELSE 0 END) currentMatches
        FROM proposals p LEFT JOIN db_cells c ON c.row_id=p.row_id AND c.column_id=p.column_id
        WHERE p.row_id IN(SELECT value FROM json_each(?)) AND p.column_id IN(SELECT value FROM json_each(?))
        GROUP BY p.column_id,p.model,p.revision,p.prompt,p.state ORDER BY p.column_id,p.model,p.revision,p.prompt,p.state`,
        )
        .all(
          JSON.stringify(included.map((r) => r.id)),
          JSON.stringify(ids),
        ) as AgreementSnapshot["provenance"];
      return {
        format: "nodus.imago.agreement/1",
        createdAt: new Date().toISOString(),
        database: { id: detail.database.id, name: detail.database.name },
        input,
        columns: columns as AgreementSnapshot["columns"],
        rows: included.map((r) => ({
          ...r,
          cells: byRow.get(r.id) ?? {},
          image:
            (image.get(r.id) as
              { id: string; revision?: string } | undefined) ?? null,
        })),
        matched: records.length,
        provenance,
      };
    })();
    return this.result(snapshot);
  }
  list(databaseId: string): AgreementExperiment[] {
    this.repo.detail(databaseId);
    return this.repo.db
      .prepare(
        "SELECT id,database_id databaseId,name,created_at createdAt,total,complete FROM agreement_experiments WHERE database_id=? ORDER BY created_at DESC,id",
      )
      .all(databaseId) as AgreementExperiment[];
  }
  save(token: string, name: string): AgreementExperiment {
    const result = this.get(token),
      { snapshot, report } = result;
    this.repo.detail(snapshot.database.id);
    const experiment = {
      id: uuid(),
      databaseId: snapshot.database.id,
      name,
      createdAt: snapshot.createdAt,
      total: report.total,
      complete: report.complete,
    };
    this.repo.db
      .prepare(
        "INSERT INTO agreement_experiments(id,database_id,name,created_at,total,complete,snapshot_json) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        experiment.id,
        experiment.databaseId,
        name,
        experiment.createdAt,
        report.total,
        report.complete,
        JSON.stringify(snapshot),
      );
    return experiment;
  }
  load(id: string): AgreementResult {
    const row = this.repo.db
      .prepare("SELECT snapshot_json FROM agreement_experiments WHERE id=?")
      .get(id) as { snapshot_json: string } | undefined;
    if (!row) throw new Error("Ensayo no encontrado.");
    return this.result(JSON.parse(row.snapshot_json) as AgreementSnapshot);
  }
  delete(id: string) {
    this.repo.db
      .prepare("DELETE FROM agreement_experiments WHERE id=?")
      .run(id);
  }
  async export(token: string, format: "csv" | "json", file: string) {
    const result = this.get(token);
    const content =
      format === "json"
        ? JSON.stringify(
            { ...result.snapshot, results: result.report },
            null,
            2,
          )
        : agreementCsv(result.snapshot, result.report);
    const temporary = file + ".partial-" + uuid();
    try {
      await fs.writeFile(temporary, content, "utf8");
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return true;
  }
}

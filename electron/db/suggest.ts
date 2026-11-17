// Completing records from similar images: for a property, each record that
// lacks it gets a proposed value from its visual neighbours that have it, with
// the neighbours shown as evidence. Dates become an attributed period
// ("[1950–1955]") from the similarity-weighted years of the neighbours;
// options, places and texts are a similarity-weighted vote. Nothing is written
// until the user accepts a proposal, and accepting can be undone.
import { randomUUID } from "node:crypto";
import type { Repository } from "./repository";
import type { DatabaseColumn } from "../../shared/databases";
import { decodeMultiSelect, encodeMultiSelect } from "../../shared/databases";
import { exportCellText } from "../../shared/databaseExport";
import { yearOf } from "../../shared/statistics";
import { encodeHistoricalDate } from "../../shared/historicalDate";
import type { NeighbourSuggestion } from "../../shared/suggest";

export const SUGGESTIBLE = new Set(["historical_date", "number", "select", "status", "multi_select", "text", "location", "person"]);
const NEIGHBOURS = 8;

type Known = { rowId: string; assetId: string; vector: Float32Array; raw: string; display: string; year: number | null };

/** Weighted quantile of (value, weight) pairs. */
export function weightedQuantile(pairs: [number, number][], q: number): number {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [v, w] of sorted) {
    acc += w;
    if (acc >= q * total) return v;
  }
  return sorted[sorted.length - 1][0];
}

export class NeighbourSuggestions {
  constructor(
    private repo: Repository,
    private contract: () => string | null,
  ) {}

  /** Records of a database with the vector of their main indexed image. */
  private vectors(databaseId: string) {
    const contract = this.contract();
    if (!contract) throw new Error("Indexa las imágenes para la búsqueda semántica: las propuestas se basan en los vectores de imagen.");
    const rows = this.repo.db
      .prepare(
        `SELECT a.row_id rowId,a.id assetId,e.vector FROM image_assets a JOIN embeddings e ON e.content_hash=a.content_hash AND e.contract=?
         WHERE a.database_id=? ORDER BY a.row_id,a.position`,
      )
      .all(contract, databaseId) as { rowId: string; assetId: string; vector: Buffer }[];
    const byRow = new Map<string, { assetId: string; vector: Float32Array }>();
    for (const r of rows)
      if (!byRow.has(r.rowId))
        byRow.set(r.rowId, {
          assetId: r.assetId,
          vector: new Float32Array(r.vector.buffer.slice(r.vector.byteOffset, r.vector.byteOffset + r.vector.byteLength)),
        });
    return byRow;
  }

  suggest(input: { databaseId: string; columnId: string; limit?: number }): { items: NeighbourSuggestion[]; withVectors: number; known: number; missing: number } {
    const column = this.repo.detail(input.databaseId).columns.find((c) => c.id === input.columnId);
    if (!column) throw new Error("La propiedad no pertenece a esta base de datos.");
    if (!SUGGESTIBLE.has(column.type)) throw new Error("Esta propiedad no admite propuestas a partir de imágenes parecidas.");
    const vectors = this.vectors(input.databaseId);
    const ids = [...vectors.keys()];
    const known: Known[] = [],
      missing: string[] = [];
    for (let i = 0; i < ids.length; i += 500)
      for (const row of this.repo.hydrate(ids.slice(i, i + 500))) {
        const raw = row.cells[column.id] ?? null;
        const display = exportCellText(column, row).trim();
        const year = isDateLike(column) ? yearOf(column, raw, display) : null;
        const empty = !raw || !display || (isDateLike(column) && year === null);
        if (empty) missing.push(row.id);
        else known.push({ rowId: row.id, ...vectors.get(row.id)!, raw: raw!, display, year });
      }
    const items: NeighbourSuggestion[] = [];
    if (known.length >= 3)
      for (const rowId of missing.slice(0, input.limit ?? 400)) {
        const { vector, assetId } = vectors.get(rowId)!;
        const neighbours = known
          .map((k) => {
            let dot = 0;
            for (let d = 0; d < vector.length; d++) dot += vector[d] * k.vector[d];
            return { k, similarity: dot };
          })
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, NEIGHBOURS);
        const proposal = this.propose(column, neighbours);
        if (proposal) items.push({ rowId, assetId, title: "", ...proposal });
      }
    const titles = new Map(this.repo.hydrate(items.map((i) => i.rowId)).map((r) => [r.id, r.title]));
    for (const item of items) item.title = titles.get(item.rowId) ?? "";
    items.sort((a, b) => b.confidence - a.confidence);
    return { items, withVectors: ids.length, known: known.length, missing: missing.length };
  }

  private propose(column: DatabaseColumn, neighbours: { k: Known; similarity: number }[]) {
    // Closer neighbours count more; a neighbour far below the closest one counts little.
    const top = neighbours[0]?.similarity ?? 0;
    const weighted = neighbours.map((n) => ({ ...n, weight: Math.max(0.01, 1 - (top - n.similarity) * 8) * Math.max(0, n.similarity) }));
    const evidence = neighbours.slice(0, 6).map((n) => ({
      rowId: n.k.rowId,
      assetId: n.k.assetId,
      value: n.k.display,
      similarity: Math.round(n.similarity * 1000) / 1000,
    }));
    const meanSimilarity = neighbours.reduce((s, n) => s + n.similarity, 0) / Math.max(1, neighbours.length);
    if (isDateLike(column)) {
      const pairs = weighted.filter((n) => n.k.year !== null).map((n) => [n.k.year!, n.weight] as [number, number]);
      if (pairs.length < 3) return null;
      const median = weightedQuantile(pairs, 0.5),
        low = weightedQuantile(pairs, 0.2),
        high = weightedQuantile(pairs, 0.8);
      const spread = high - low;
      const confidence = Math.max(0, Math.min(1, 1 - spread / 30)) * Math.min(1, meanSimilarity / 0.85);
      if (column.type === "number")
        return { value: String(median), display: String(median), confidence, evidence, spread: [low, high] as [number, number] };
      const text = low === high ? `[${median}]` : `[${low}–${high}]`;
      return {
        value: encodeHistoricalDate({ text, start: low, end: high, certainty: "inferred", manual: true })!,
        display: text,
        confidence,
        evidence,
        spread: [low, high] as [number, number],
      };
    }
    // A vote. Multi-select: each label separately; it is proposed when it has half the weight.
    const total = weighted.reduce((s, n) => s + n.weight, 0);
    const votes = new Map<string, { weight: number; raw: string; display: string }>();
    for (const n of weighted) {
      const keys =
        column.type === "multi_select"
          ? decodeMultiSelect(n.k.raw).map((id) => [id, column.options.find((o) => o.id === id)?.label ?? id] as const)
          : [[n.k.display.toLowerCase(), n.k.display] as const];
      for (const [key, label] of keys) {
        const vote = votes.get(key) ?? { weight: 0, raw: column.type === "multi_select" ? key : n.k.raw, display: label };
        vote.weight += n.weight;
        votes.set(key, vote);
      }
    }
    const ranked = [...votes.values()].sort((a, b) => b.weight - a.weight);
    if (!ranked.length) return null;
    if (column.type === "multi_select") {
      const chosen = ranked.filter((v) => v.weight / total >= 0.5);
      if (!chosen.length) return null;
      return {
        value: encodeMultiSelect(chosen.map((v) => v.raw))!,
        display: chosen.map((v) => v.display).join(", "),
        confidence: (chosen.reduce((s, v) => s + v.weight, 0) / chosen.length / total) * Math.min(1, meanSimilarity / 0.85),
        evidence,
      };
    }
    const winner = ranked[0];
    return { value: winner.raw, display: winner.display, confidence: (winner.weight / total) * Math.min(1, meanSimilarity / 0.85), evidence };
  }

  /** Writes accepted proposals; each one can be undone like any edit. */
  apply(items: { rowId: string; columnId: string; value: string }[]) {
    this.repo.db.transaction(() => {
      const before = (this.repo.db.prepare("SELECT coalesce(max(id),0) id FROM history").get() as { id: number }).id;
      for (const item of items) this.repo.setCell(item.rowId, item.columnId, item.value);
      // One batch: a single «Deshacer» reverts every accepted proposal.
      this.repo.db.prepare("UPDATE history SET batch_id=?,kind='proposals' WHERE id>?").run(randomUUID(), before);
    })();
    return items.length;
  }
}

function isDateLike(column: DatabaseColumn) {
  return column.type === "historical_date" || (column.type === "number" && /a[ñn]o|year|fecha|date/i.test(column.name));
}

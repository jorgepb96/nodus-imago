// What the database chat reads: for each chosen database, a profile computed
// over every record, a few example records and, for calculations, every
// record as plain values keyed by property name.
import type { Repository } from "../db/repository";
import type { DatabaseColumn } from "../../shared/databases";
import { decodeCheckbox, decodeMultiSelect, decodeNumber } from "../../shared/databases";
import { decodeDatabaseDate } from "../../shared/databaseProperties";
import { exportCellText } from "../../shared/databaseExport";
import { categoryValues, yearOf } from "../../shared/statistics";
import type { RecordRow } from "../../shared/imago";
import {
  PROFILE_VALUES,
  SAMPLE_ROWS,
  type ChatDataPart,
  type ChatMode,
} from "../../shared/chat";

type Language = "es" | "en";
export type ChatDataset = {
  name: string;
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
};
type Loaded = { name: string; columns: DatabaseColumn[]; keys: string[]; rows: RecordRow[] };

/** Properties that only hold layout or actions. */
const SKIPPED = new Set(["button", "files", "attachment", "ai_image"]);
/** Free text whose values rarely repeat: profiled by fill and length. */
const LONG_TEXT = new Set(["rich_text", "ai"]);
const CATEGORY = new Set(["select", "status", "multi_select", "person", "created_by", "last_edited_by"]);
const TEXT_LIMIT = 2000;

const COPY = {
  es: {
    records: "Registros",
    images: "Imágenes",
    withImages: "registros con imágenes",
    filled: "con valor",
    distinct: "valores distintos",
    top: "más frecuentes",
    length: "longitud media",
    chars: "caracteres",
    yes: "sí",
    no: "no",
    years: "años",
    perDecade: "registros por década",
    mean: "media",
    median: "mediana",
    sum: "suma",
    min: "mín.",
    max: "máx.",
    others: "otros",
  },
  en: {
    records: "Records",
    images: "Images",
    withImages: "records with images",
    filled: "filled",
    distinct: "distinct values",
    top: "most frequent",
    length: "average length",
    chars: "characters",
    yes: "yes",
    no: "no",
    years: "years",
    perDecade: "records per decade",
    mean: "mean",
    median: "median",
    sum: "sum",
    min: "min",
    max: "max",
    others: "others",
  },
};

const round = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
const clip = (text: string, size: number) => (text.length > size ? text.slice(0, size - 1) + "…" : text);

export class ChatData {
  private cache = new Map<string, { key: string; loaded: Loaded }>();
  constructor(private repo: Repository) {}

  /** Every record of a database, reused while nothing in it changes. */
  private load(databaseId: string): Loaded {
    const detail = this.repo.detail(databaseId);
    const stamp = this.repo.db
      .prepare("SELECT count(*) n, max(updated_at) u FROM db_rows WHERE database_id=?")
      .get(databaseId) as { n: number; u: string | null };
    const key = [stamp.n, stamp.u, detail.database.updatedAt, JSON.stringify(detail.columns.map((c) => [c.id, c.name, c.type, c.options.length]))].join("|");
    const cached = this.cache.get(databaseId);
    if (cached?.key === key) return cached.loaded;
    const ids = (
      this.repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position,id").all(databaseId) as { id: string }[]
    ).map((r) => r.id);
    const rows: RecordRow[] = [];
    for (let i = 0; i < ids.length; i += 500) rows.push(...this.repo.hydrate(ids.slice(i, i + 500)));
    const columns = detail.columns.filter((c) => !SKIPPED.has(c.type));
    // Two properties with the same name stay apart in the calculation data.
    const seen = new Map<string, number>();
    const keys = columns.map((c) => {
      const n = (seen.get(c.name) ?? 0) + 1;
      seen.set(c.name, n);
      return n === 1 ? c.name : `${c.name} (${n})`;
    });
    const loaded = { name: detail.database.name, columns, keys, rows };
    this.cache.set(databaseId, { key, loaded });
    if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!);
    return loaded;
  }

  context(databaseIds: string[], mode: ChatMode, language: Language): ChatDataPart[] {
    return databaseIds.map((id) => {
      const data = this.load(id);
      return {
        name: data.name,
        rowCount: data.rows.length,
        profile: this.profile(data, mode, language),
        sample: this.sample(data, mode),
        sampleSize: Math.min(SAMPLE_ROWS[mode], data.rows.length),
      };
    });
  }

  private profile({ columns, rows }: Loaded, mode: ChatMode, language: Language): string {
    const copy = COPY[language] ?? COPY.es,
      total = rows.length,
      limit = PROFILE_VALUES[mode];
    const imageCount = rows.reduce((n, r) => n + r.images.length, 0),
      withImages = rows.filter((r) => r.images.length).length;
    const lines = [
      `${copy.records}: ${total}`,
      `${copy.images}: ${imageCount} (${withImages} ${copy.withImages})`,
      "",
    ];
    for (const column of columns) {
      const raw = rows.map((r) => r.cells[column.id] ?? null),
        display = rows.map((r) => exportCellText(column, r));
      const head = `- ${column.name} [${column.type}]`;
      if (column.type === "number") {
        const values = raw.map(decodeNumber).filter((n): n is number => n != null).sort((a, b) => a - b);
        if (!values.length) {
          lines.push(`${head}: ${copy.filled} 0/${total}`);
          continue;
        }
        const sum = values.reduce((s, v) => s + v, 0),
          mid = values.length >> 1,
          median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
        lines.push(
          `${head}: ${copy.filled} ${values.length}/${total}; ${copy.min} ${values[0]}, ${copy.max} ${values[values.length - 1]}, ${copy.mean} ${round(sum / values.length)}, ${copy.median} ${round(median)}, ${copy.sum} ${round(sum)}`,
        );
      } else if (column.type === "checkbox") {
        const yes = raw.filter((v) => decodeCheckbox(v)).length;
        lines.push(`${head}: ${copy.yes} ${yes}, ${copy.no} ${total - yes}`);
      } else if (LONG_TEXT.has(column.type)) {
        const filled = display.filter((d) => d.trim());
        const avg = filled.length ? Math.round(filled.reduce((s, d) => s + d.length, 0) / filled.length) : 0;
        lines.push(`${head}: ${copy.filled} ${filled.length}/${total} (${pct(filled.length, total)} %); ${copy.length} ${avg} ${copy.chars}`);
      } else {
        const counts = new Map<string, number>();
        let filled = 0;
        rows.forEach((row, i) => {
          const values = categoryValues(column, raw[i], display[i]);
          if (values.length) filled++;
          for (const v of new Set(values)) counts.set(v, (counts.get(v) ?? 0) + 1);
        });
        const distinct = counts.size;
        let line = `${head}: ${copy.filled} ${filled}/${total} (${pct(filled, total)} %); ${distinct} ${copy.distinct}`;
        // Values that repeat are worth listing; identifiers and titles are not.
        const repeats = distinct > 0 && (CATEGORY.has(column.type) || distinct <= Math.max(50, filled * 0.5));
        if (repeats) {
          const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
          const shown = sorted.slice(0, limit).map(([label, n]) => `${clip(label, 60)} (${n})`);
          const rest = sorted.slice(limit).reduce((s, [, n]) => s + n, 0);
          line += `; ${copy.top}: ${shown.join(", ")}${rest ? `; ${copy.others} (${rest})` : ""}`;
        }
        // Dates, and texts that hold years ("c. 1930"), get a count per decade.
        const years = rows.map((_, i) => yearOf(column, raw[i], display[i])).filter((y): y is number => y != null);
        if (years.length >= Math.max(3, filled * 0.6) && ["date", "created_time", "last_edited_time", "text", "title", "select", "status", "number"].includes(column.type)) {
          years.sort((a, b) => a - b);
          const decades = new Map<number, number>();
          for (const y of years) decades.set(Math.floor(y / 10) * 10, (decades.get(Math.floor(y / 10) * 10) ?? 0) + 1);
          line += `; ${copy.years} ${years[0]}–${years[years.length - 1]}; ${copy.perDecade}: ${[...decades].map(([d, n]) => `${d}s (${n})`).join(", ")}`;
        }
        lines.push(line);
      }
    }
    return lines.join("\n");
  }

  private sample({ columns, rows }: Loaded, mode: ChatMode): string {
    const size = Math.min(SAMPLE_ROWS[mode], rows.length);
    if (!size) return "";
    // Spread across the table rather than its first rows.
    const step = rows.length / size;
    const picked = Array.from({ length: size }, (_, i) => rows[Math.floor(i * step)]);
    return picked
      .map((row, i) => {
        const fields = columns
          .map((c) => [c.name, exportCellText(c, row).trim()] as const)
          .filter(([, v]) => v)
          .map(([name, v]) => `${name}: ${clip(v.replace(/\s+/g, " "), 120)}`);
        return `${i + 1}. ${fields.join(" | ")}${row.images.length ? ` | (${row.images.length} img)` : ""}`;
      })
      .join("\n");
  }

  /** Every record as plain values, for the isolated calculation. */
  dataset(databaseIds: string[]): ChatDataset[] {
    return databaseIds.map((id) => {
      const { name, columns, keys, rows } = this.load(id);
      return {
        name,
        columns: columns.map((c, i) => ({ name: keys[i], type: c.type })),
        rows: rows.map((row) => {
          const out: Record<string, unknown> = { _id: row.id, _images: row.images.length };
          columns.forEach((column, i) => {
            const raw = row.cells[column.id] ?? null;
            out[keys[i]] = plainValue(column, raw, row);
          });
          return out;
        }),
      };
    });
  }
}

function plainValue(column: DatabaseColumn, raw: string | null, row: RecordRow): unknown {
  if (raw == null || raw === "") return column.type === "checkbox" ? false : null;
  switch (column.type) {
    case "number":
      return decodeNumber(raw);
    case "checkbox":
      return decodeCheckbox(raw);
    case "multi_select":
      return decodeMultiSelect(raw)
        .map((id) => column.options.find((o) => o.id === id)?.label)
        .filter((l): l is string => !!l);
    case "date":
      return decodeDatabaseDate(raw)?.start ?? null;
    default: {
      const text = exportCellText(column, row).trim();
      return text ? clip(text, TEXT_LIMIT) : null;
    }
  }
}

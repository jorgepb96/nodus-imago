// Keeps the semantic index current without the researcher having to press
// "Index". It queues what is pending (new images, new or edited records) once
// editing settles, also while an import is still adding images, one pass at a
// time: a long backlog goes in batches of about a quarter of an hour that
// follow one another. A paused or failed pass is left to the researcher, and
// images are first indexed only after the researcher chooses their quality.
import type { Repository } from "./db/repository";
import type { Engine } from "./ai/engine";
import type { JobQueue } from "./jobs";
import { API_EMBEDDING_ID } from "../shared/embeddingApi";
import { ONNX_ID } from "../shared/embeddingBackends";

/** The image quality levels of EmbeddingGemma 2 (visual tokens per image). */
export const INDEX_QUALITIES = [280, 140, 70] as const;

/** A longer backlog is indexed in batches of about this duration. */
export const AUTO_INDEX_MAX_SECONDS = 15 * 60;

export type AutoIndexState = {
  enabled: boolean;
  /** Items the next pass would process. */
  pending: number;
  /**
   * Set before images are indexed for the first time: the researcher chooses
   * the quality, with the duration each level would take.
   */
  quality: {
    rows: number;
    assets: number;
    seconds: Record<(typeof INDEX_QUALITIES)[number], number>;
    current: (typeof INDEX_QUALITIES)[number];
  } | null;
};

export class AutoIndexer {
  private lastActivity = 0;
  private timer?: ReturnType<typeof setInterval>;
  /** True while a restore or shutdown owns the collection. */
  suspended = () => false;
  constructor(
    private repo: Repository,
    private engine: Engine,
    private queue: JobQueue,
    private options = { settleMs: 30_000, intervalMs: 15_000 },
    private clock = () => Date.now(),
  ) {}
  start() {
    this.timer ??= setInterval(() => this.tick(), this.options.intervalMs);
    this.timer.unref?.();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  /** A write happened: wait for it to settle before indexing. */
  touch() {
    this.lastActivity = this.clock();
  }
  enabled() {
    const s = this.repo.getSettings();
    // Local models default to on; a remote API sends data and may cost money,
    // so it only indexes on its own when the researcher enables it.
    return s.embeddingModel === API_EMBEDDING_ID
      ? (s.autoIndex?.api ?? false)
      : (s.autoIndex?.local ?? true);
  }
  private ready() {
    try {
      this.engine.ready(this.repo.getSettings().embeddingModel);
      return true;
    } catch {
      return false;
    }
  }
  state(): AutoIndexState {
    if (!this.ready()) return { enabled: this.enabled(), pending: 0, quality: null };
    const pending = this.engine.pendingIndex();
    // Asked as soon as the first images arrive, even while the import goes on.
    const quality = this.needsQuality(pending.assets.length)
      ? {
          rows: pending.rows.length,
          assets: pending.assets.length,
          seconds: Object.fromEntries(
            INDEX_QUALITIES.map((q) => [
              q,
              Math.round(this.engine.estimateSeconds({ rows: pending.rows.length, assets: pending.assets.length }, q)),
            ]),
          ) as Record<(typeof INDEX_QUALITIES)[number], number>,
          // Fast unless the researcher already chose another level.
          current: this.repo.getSettings().visionBudget ?? 70,
        }
      : null;
    return {
      enabled: this.enabled(),
      pending: pending.rows.length + pending.assets.length,
      quality,
    };
  }
  /**
   * A classification is writing cells: their records would be indexed with
   * text about to change. An import is not waited for: what it has added is
   * indexed while it goes on.
   */
  private writing() {
    return this.repo
      .jobs()
      .some((j) => j.kind === "analyze" && ["queued", "running"].includes(j.state));
  }
  /**
   * The first time images are indexed with EmbeddingGemma 2, the researcher
   * chooses the quality (and so the duration) before anything starts. A
   * collection already indexed, or a quality already chosen, is not asked.
   */
  needsQuality(assets: number) {
    const s = this.repo.getSettings();
    if (s.embeddingModel !== ONNX_ID || s.indexQualityChosen || !assets) return false;
    return !(this.repo.db.prepare("SELECT 1 FROM embeddings LIMIT 1").get());
  }
  /** Returns the queued job id, or why nothing was queued (for tests). */
  tick(): string {
    if (this.suspended()) return "suspended";
    if (!this.enabled() || !this.ready()) return this.enabled() ? "not-ready" : "disabled";
    if (this.clock() - this.lastActivity < this.options.settleMs) return "settling";
    const all = this.repo.jobs();
    if (this.writing()) return "settling";
    const jobs = all.filter((j) => j.kind === "index");
    // One pass at a time; when it ends the next tick picks up what remains.
    if (jobs.some((j) => ["queued", "running"].includes(j.state))) return "busy";
    // A pass the researcher paused, or one that failed (for example a refused
    // API key), stays theirs to resume: retrying on a timer would hide it.
    if (jobs.some((j) => ["paused", "failed"].includes(j.state))) return "blocked";
    const { rows, assets } = this.engine.pendingIndex();
    const items = rows.length + assets.length;
    if (!items) return "idle";
    // Images wait for the researcher's choice of quality; nothing starts on
    // its own, since a pass running when the quality changes would be lost.
    if (this.needsQuality(assets.length)) return "quality";
    const seconds = this.engine.estimateSeconds({ rows: rows.length, assets: assets.length });
    let limit: { rows: number; assets: number } | undefined;
    if (seconds > AUTO_INDEX_MAX_SECONDS) {
      // A long backlog goes in batches, records first (they are cheap and
      // make the text lane current), then images; each pass that ends lets
      // the next tick queue the following batch.
      const perRow = this.engine.estimateSeconds({ rows: 1, assets: 0 }),
        perAsset = this.engine.estimateSeconds({ rows: 0, assets: 1 }),
        batchRows = Math.min(rows.length, Math.floor(AUTO_INDEX_MAX_SECONDS / Math.max(perRow, 1e-6))),
        left = AUTO_INDEX_MAX_SECONDS - batchRows * perRow,
        batchAssets = Math.min(assets.length, Math.floor(left / Math.max(perAsset, 1e-6)));
      limit = { rows: batchRows, assets: batchAssets || (batchRows ? 0 : 1) };
    }
    const id = this.engine.enqueueIndex(undefined, { auto: true, limit });
    this.queue.pump();
    return id;
  }
}

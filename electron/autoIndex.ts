// Keeps the semantic index current without the researcher having to press
// "Index". It only queues what is pending (new images, new or edited records),
// waits until editing settles, never runs two passes at once, respects a
// paused or failed pass, and asks before starting anything long.
import type { Repository } from "./db/repository";
import type { Engine } from "./ai/engine";
import type { JobQueue } from "./jobs";
import { API_EMBEDDING_ID } from "../shared/embeddingApi";

/** Passes estimated above this run only when the user asks. */
export const AUTO_INDEX_MAX_SECONDS = 15 * 60;

export type AutoIndexState = {
  enabled: boolean;
  /** Items the next pass would process. */
  pending: number;
  /** Set when a pending pass is too long to start on its own. */
  held: { items: number; seconds: number } | null;
};

export class AutoIndexer {
  private lastActivity = 0;
  private timer?: ReturnType<typeof setInterval>;
  held: AutoIndexState["held"] = null;
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
    if (!this.ready()) return { enabled: this.enabled(), pending: 0, held: null };
    const pending = this.engine.pendingIndex();
    return {
      enabled: this.enabled(),
      pending: pending.rows.length + pending.assets.length,
      held: this.held,
    };
  }
  /** Returns the queued job id, or why nothing was queued (for tests). */
  tick(): string {
    if (this.suspended()) return "suspended";
    if (!this.enabled() || !this.ready()) {
      this.held = null;
      return this.enabled() ? "not-ready" : "disabled";
    }
    if (this.clock() - this.lastActivity < this.options.settleMs) return "settling";
    const all = this.repo.jobs();
    // An import still adding images or a classification still writing cells
    // is ongoing activity: index once it has finished.
    if (
      all.some(
        (j) =>
          ["images", "analyze"].includes(j.kind) &&
          ["queued", "running"].includes(j.state),
      )
    )
      return "settling";
    const jobs = all.filter((j) => j.kind === "index");
    // One pass at a time; when it ends the next tick picks up what remains.
    if (jobs.some((j) => ["queued", "running"].includes(j.state))) {
      this.held = null;
      return "busy";
    }
    // A pass the researcher paused, or one that failed (for example a refused
    // API key), stays theirs to resume: retrying on a timer would hide it.
    if (jobs.some((j) => ["paused", "failed"].includes(j.state))) {
      this.held = null;
      return "blocked";
    }
    this.held = null;
    const { rows, assets } = this.engine.pendingIndex();
    const items = rows.length + assets.length;
    if (!items) return "idle";
    const seconds = this.engine.estimateSeconds({
      rows: rows.length,
      assets: assets.length,
    });
    let recordsOnly = false;
    if (seconds > AUTO_INDEX_MAX_SECONDS) {
      // A large backlog (thousands of images never indexed) must not stop the
      // cheap part: edited and new records are still indexed on their own,
      // and only the long remainder waits for the researcher.
      const recordSeconds = this.engine.estimateSeconds({
        rows: rows.length,
        assets: 0,
      });
      this.held = {
        items: rows.length && recordSeconds <= AUTO_INDEX_MAX_SECONDS ? assets.length : items,
        seconds: Math.round(
          rows.length && recordSeconds <= AUTO_INDEX_MAX_SECONDS
            ? seconds - recordSeconds
            : seconds,
        ),
      };
      if (!rows.length || recordSeconds > AUTO_INDEX_MAX_SECONDS) return "held";
      recordsOnly = true;
    }
    const id = this.engine.enqueueIndex(undefined, { auto: true, recordsOnly });
    this.queue.pump();
    return id;
  }
}

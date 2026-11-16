import os from "node:os";
import { Repository, now } from "./db/repository";
import { Images, type ImageImportPayload, type PreparedImage } from "./import/images";
import { AdaptiveParallelism, importParallelism } from "./import/adaptiveParallelism";
import { Models } from "./ai/models";
import { Engine } from "./ai/engine";

type RunningJob = {
  controller: AbortController;
  task: Promise<void>;
  resources: Set<string>;
};
export class JobQueue {
  running = new Map<string, RunningJob>();
  closed = false;
  constructor(
    public repo: Repository,
    public images: Images,
    public models: Models,
    public engine: Engine,
    public changed: () => void,
  ) {}
  get active() {
    return this.running.keys().next().value ?? null;
  }
  get task() {
    return Promise.all([...this.running.values()].map((r) => r.task));
  }
  concurrency() {
    const s = this.repo.getSettings();
    const memory = Math.max(1, Math.floor((os.totalmem() / 2 ** 30 - 4) / 3));
    return Math.min(
      s.parallelJobs,
      s.profile === "light" ? 1 : s.profile === "balanced" ? 2 : 4,
      memory,
    );
  }
  control(id: string, action: "pause" | "resume" | "cancel", pump = true) {
    const job = this.repo.db
      .prepare("SELECT state,done,total,kind,payload_json FROM jobs WHERE id=?")
      .get(id) as
      | {
          state: string;
          done: number;
          total: number;
          kind: string;
          payload_json: string;
        }
      | undefined;
    if (!job) throw new Error("Tarea no encontrada.");
    if (["completed", "cancelled"].includes(job.state)) return;
    if (this.closed) return;
    if (action === "resume" && !["paused", "failed"].includes(job.state))
      return;
    if (action === "pause" && !["queued", "running"].includes(job.state))
      return;
    if (action === "resume" && job.state === "failed") {
      const payload = JSON.parse(job.payload_json);
      if (!["prepare", "download"].includes(job.kind)) {
        const previous = payload.retryItems
          ? new Set<number>(payload.retryItems)
          : null;
        const errors = (
          this.repo.db
            .prepare("SELECT item FROM job_errors WHERE job_id=?")
            .all(id) as { item: number }[]
        ).map((x) => x.item);
        payload.retryItems = [
          ...new Set([
            ...errors,
            ...Array.from(
              { length: job.total - job.done },
              (_, i) => i + job.done,
            ).filter((i) => !previous || previous.has(i)),
          ]),
        ]
          .filter((i) => i >= 0 && i < job.total)
          .sort((a, b) => a - b);
      }
      this.repo.db
        .prepare(
          "UPDATE jobs SET done=0,failed=0,skipped=0,message=NULL,payload_json=? WHERE id=?",
        )
        .run(JSON.stringify(payload), id);
      this.repo.db.prepare("DELETE FROM job_errors WHERE job_id=?").run(id);
    }
    this.repo.db
      .prepare("UPDATE jobs SET state=?,updated_at=? WHERE id=?")
      .run(
        action === "pause"
          ? "paused"
          : action === "cancel"
            ? "cancelled"
            : "queued",
        now(),
        id,
      );
    this.running.get(id)?.controller.abort();
    this.changed();
    if (pump) this.pump();
  }
  pauseAll() {
    // Include queued jobs, and do not pump between pauses: freeing a slot while
    // later jobs are still queued would start a job we are about to pause (for
    // example a remote API job after the user has disabled remote APIs).
    for (const job of this.repo.jobs())
      if (["queued", "running"].includes(job.state))
        this.control(job.id, "pause", false);
  }
  resumeAll() {
    for (const job of this.repo.jobs())
      if (job.state === "paused") this.control(job.id, "resume", false);
    this.pump();
  }
  async close() {
    this.closed = true;
    for (const item of this.running.values()) item.controller.abort();
    this.engine.host.close();
    await this.task;
  }
  private resources(job: any) {
    if (
      !Number.isSafeInteger(job.total) ||
      job.total < 0 ||
      !Number.isSafeInteger(job.done) ||
      job.done < 0 ||
      job.done > job.total
    )
      throw new Error("Progreso de tarea inválido.");
    if (
      !["images", "download", "prepare", "index", "analyze", "fingerprints"].includes(job.kind)
    )
      throw new Error("Tipo de tarea desconocido.");
    const payload = JSON.parse(job.payload_json),
      resources = new Set<string>();
    const field = (
      {
        images: "files",
        index: "assets",
        analyze: "items",
        prepare: "steps",
        fingerprints: "hashes",
      } as Record<string, string>
    )[job.kind];
    // Index jobs carry record texts before images; older ones only images.
    const items =
      job.kind === "index" && payload && Array.isArray(payload.rows)
        ? payload.rows.length +
          (Array.isArray(payload.assets) ? payload.assets.length : NaN)
        : Array.isArray(payload?.[field])
          ? payload[field].length
          : NaN;
    if (
      !payload ||
      typeof payload !== "object" ||
      (field && (!Array.isArray(payload[field]) || items !== job.total)) ||
      (payload.rows !== undefined &&
        (!Array.isArray(payload.rows) ||
          payload.rows.some((id: unknown) => typeof id !== "string")))
    )
      throw new Error("Contenido de tarea inválido.");
    if (
      payload.retryItems !== undefined &&
      (!Array.isArray(payload.retryItems) ||
        payload.retryItems.some(
          (i: unknown) =>
            !Number.isSafeInteger(i) || Number(i) < 0 || Number(i) >= job.total,
        ) ||
        new Set(payload.retryItems).size !== payload.retryItems.length)
    )
      throw new Error("Selección de reintento inválida.");
    if (job.kind === "images") resources.add("image-import");
    if (job.kind === "download") resources.add("model:" + payload.id);
    if (job.kind === "prepare")
      for (const step of payload.steps) resources.add("model:" + step.id);
    if (job.kind === "index") {
      resources.add("python-inference");
      const id = this.repo.getSettings().embeddingModel;
      resources.add("uses:" + id);
      if (id === "harrier-oss-v1-0.6b-q8_0") {
        resources.add("uses:lfm3-vl-2b");
        resources.add("uses:llama-runtime");
      }
    }
    if (job.kind === "analyze")
      for (const item of payload.items) {
        resources.add("column:" + item.columnId);
        if (item.choice?.provider === "local") {
          resources.add("uses:" + item.choice.model);
          if (this.models.get(item.choice.model).backend === "llama")
            resources.add("uses:llama-runtime");
        }
        if (
          item.choice?.provider === "local" &&
          this.models.get(item.choice.model).backend !== "llama"
        )
          resources.add("python-inference");
      }
    return resources;
  }
  /** Fingerprints one image for the variants view (set by the service). */
  fingerprint?: (payload: { hashes: string[] }, index: number) => Promise<"imported" | "skipped">;
  pump() {
    if (this.closed) return;
    const queued = this.repo.db
      // Automatic indexing yields to work the researcher queued explicitly.
      .prepare(
        "SELECT * FROM jobs WHERE state='queued' ORDER BY CASE WHEN kind='index' AND json_valid(payload_json) THEN coalesce(json_extract(payload_json,'$.auto'),0) ELSE 0 END,rowid",
      )
      .all() as any[];
    for (const job of queued) {
      if (this.running.size >= this.concurrency()) break;
      if (this.running.has(job.id)) continue;
      let resources: Set<string>;
      try {
        resources = this.resources(job);
      } catch (error) {
        this.repo.db
          .prepare(
            "UPDATE jobs SET state='failed',message=?,updated_at=? WHERE id=?",
          )
          .run(
            error instanceof Error ? error.message : String(error),
            now(),
            job.id,
          );
        this.changed();
        continue;
      }
      const occupied = new Set(
        [...this.running.values()].flatMap((r) => [...r.resources]),
      );
      if (
        [...resources].some(
          (r) =>
            (!r.startsWith("uses:") && occupied.has(r)) ||
            (r.startsWith("uses:") && occupied.has("model:" + r.slice(5))) ||
            (r.startsWith("model:") && occupied.has("uses:" + r.slice(6))),
        )
      )
        continue;
      const controller = new AbortController(),
        slot: RunningJob = { controller, resources, task: Promise.resolve() };
      this.running.set(job.id, slot);
      slot.task = this.run(job, controller.signal).finally(() => {
        this.running.delete(job.id);
        this.changed();
        if (!this.closed) setTimeout(() => this.pump(), 10);
      });
    }
  }
  private async run(job: any, signal: AbortSignal) {
    this.repo.db
      .prepare("UPDATE jobs SET state='running',updated_at=? WHERE id=?")
      .run(now(), job.id);
    this.changed();
    const payload = JSON.parse(job.payload_json);
    const retryItems: Set<number> | null = payload.retryItems
      ? new Set(payload.retryItems)
      : null;
    let done = job.done,
      failed = job.failed,
      skipped = job.skipped;
    try {
      if (job.kind === "images") {
        const counts = { done, failed, skipped };
        try {
          await this.importImages(job, payload, retryItems, signal, counts);
        } finally {
          ({ done, failed, skipped } = counts);
        }
      } else for (; done < job.total;) {
        if (signal.aborted || this.closed) break;
        try {
          let outcome: "imported" | "skipped" = "imported";
          if (retryItems && !retryItems.has(done)) outcome = "skipped";
          else if (job.kind === "index")
            outcome = await this.engine.indexOne(payload, done, signal);
          else if (job.kind === "analyze")
            outcome = await this.engine.analyzeOne(payload, done, signal);
          else if (job.kind === "fingerprints" && this.fingerprint)
            outcome = await this.fingerprint(payload, done);
          else if (job.kind === "download" || job.kind === "prepare") {
            const step =
              job.kind === "prepare"
                ? payload.steps[done]
                : { id: payload.id, fileIndex: done };
            if (step.fileIndex === null) {
              await this.models.verify(step.id);
            } else {
              let last = 0;
              await this.models.downloadFile(
                step.id,
                step.fileIndex,
                signal,
                (bytes, total) => {
                  if (Date.now() - last > 500) {
                    last = Date.now();
                    this.repo.db
                      .prepare(
                        "UPDATE jobs SET message=?,updated_at=? WHERE id=?",
                      )
                      .run(
                        `${this.models.get(step.id).label} · ${Math.round(bytes / 1e6)} / ${Math.round(total / 1e6)} MB`,
                        now(),
                        job.id,
                      );
                    this.changed();
                  }
                },
              );
            }
          } else throw new Error("Tipo de tarea desconocido.");
          if (outcome === "skipped") skipped++;
        } catch (error) {
          if (signal.aborted) break;
          if (
            (error as { fatal?: boolean })?.fatal ||
            ["download", "prepare"].includes(job.kind)
          )
            throw error;
          failed++;
          this.itemFailed(job.id, done, error);
        }
        done++;
        this.progress(job.id, done, failed, skipped);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (done === job.total && !signal.aborted && !this.closed) {
        if (job.kind === "download") await this.models.verify(payload.id);
        // Image import can create new rows (and fill their titles), which changes
        // table-wide formula inputs. Recompute once per import, not per file.
        if (job.kind === "images" && payload.databaseId)
          this.repo.recompute(payload.databaseId);
        this.repo.db
          .prepare("UPDATE jobs SET state=?,updated_at=? WHERE id=?")
          .run(failed > 0 ? "failed" : "completed", now(), job.id);
      }
    } catch (error) {
      if (!signal.aborted) {
        if (done < job.total)
          this.repo.db
            .prepare(
              "INSERT INTO job_errors(job_id,item,message) VALUES(?,?,?)",
            )
            .run(
              job.id,
              done,
              error instanceof Error ? error.message : String(error),
            );
        this.repo.db
          .prepare(
            "UPDATE jobs SET state='failed',failed=failed+1,message=?,updated_at=? WHERE id=?",
          )
          .run(
            error instanceof Error ? error.message : String(error),
            now(),
            job.id,
          );
      }
    }
  }
  private itemFailed(jobId: string, item: number, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.repo.db
      .prepare("INSERT INTO job_errors(job_id,item,message) VALUES(?,?,?)")
      .run(jobId, item, message);
    this.repo.db.prepare("UPDATE jobs SET message=? WHERE id=?").run(message, jobId);
  }
  private progress(jobId: string, done: number, failed: number, skipped: number) {
    this.repo.db
      .prepare("UPDATE jobs SET done=?,failed=?,skipped=?,updated_at=? WHERE id=?")
      .run(done, failed, skipped, now(), jobId);
    this.changed();
  }
  /** Set by tests to observe the regulator of each image import. */
  onRegulator?: (regulator: AdaptiveParallelism) => void;
  /**
   * Imports images several at a time, as many as the regulator allows, and
   * records them in the order of their files. `done` stays the number of
   * files settled from the start, so a pause or a restart resumes exactly:
   * after a pause the images already being prepared finish and are recorded.
   */
  private async importImages(
    job: { id: string; total: number },
    payload: ImageImportPayload,
    retryItems: Set<number> | null,
    signal: AbortSignal,
    counts: { done: number; failed: number; skipped: number },
  ) {
    type Result =
      | { kind: "prepared"; prepared: PreparedImage }
      | { kind: "skipped" }
      | { kind: "error"; error: unknown };
    const results = new Map<number, Result>(),
      regulator = new AdaptiveParallelism({
        max: importParallelism(this.repo.getSettings().profile),
        // Indexing alongside runs in a process of its own: not another program.
        ownWork: () => this.running.size > 1,
      });
    this.onRegulator?.(regulator);
    let next = counts.done,
      active = 0,
      fatal: unknown = null;
    const stopped = () => fatal !== null || signal.aborted || this.closed;
    // Record, in file order, every image whose preparation has finished.
    const settle = () => {
      for (let result = results.get(counts.done); result; result = results.get(counts.done)) {
        if (result.kind === "error") {
          // An image interrupted by the pause is prepared again on resume.
          if (signal.aborted || (result.error as { fatal?: boolean })?.fatal) break;
          counts.failed++;
          this.itemFailed(job.id, counts.done, result.error);
        } else if (result.kind === "skipped") counts.skipped++;
        else
          try {
            if (this.images.commitOne(payload, result.prepared) === "skipped") counts.skipped++;
          } catch (error) {
            counts.failed++;
            this.itemFailed(job.id, counts.done, error);
          }
        results.delete(counts.done);
        counts.done++;
        this.progress(job.id, counts.done, counts.failed, counts.skipped);
      }
    };
    try {
      await new Promise<void>((resolve) => {
        const launch = () => {
          while (!stopped() && next < job.total && active < regulator.limit()) {
            const index = next++;
            active++;
            const work: Promise<Result> =
              retryItems && !retryItems.has(index)
                ? Promise.resolve({ kind: "skipped" })
                : this.images.prepareOne(payload, index).then(
                    (prepared) =>
                      prepared === "skipped" ? { kind: "skipped" } : { kind: "prepared", prepared },
                    (error) => ({ kind: "error", error }),
                  );
            void work.then((result) => {
              active--;
              if (result.kind === "error" && (result.error as { fatal?: boolean })?.fatal) fatal ??= result.error;
              regulator.finished(
                result.kind === "prepared" ? result.prepared.width * result.prepared.height : 0,
                result.kind === "error" ? result.error : undefined,
              );
              results.set(index, result);
              try {
                settle();
              } catch (error) {
                fatal ??= error;
              }
              launch();
            });
          }
          if (active === 0) resolve();
        };
        launch();
      });
    } finally {
      regulator.close();
    }
    if (fatal !== null) throw fatal;
  }
}

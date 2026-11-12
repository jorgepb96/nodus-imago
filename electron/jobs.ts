import os from "node:os";
import { Repository, now } from "./db/repository";
import { Images } from "./import/images";
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
  control(
    id: string,
    action: "pause" | "resume" | "cancel",
    pump = true,
  ) {
    const job = this.repo.db
      .prepare("SELECT state,done,total,kind FROM jobs WHERE id=?")
      .get(id) as { state: string; done: number; total: number; kind: string } | undefined;
    if (!job) throw new Error("Tarea no encontrada.");
    if (["completed", "cancelled"].includes(job.state)) return;
    if (
      action === "resume" &&
      job.state === "failed" &&
      (job.done === job.total || ["prepare", "download"].includes(job.kind))
    ) {
      this.repo.db
        .prepare(
          "UPDATE jobs SET done=0,failed=0,skipped=0,message=NULL WHERE id=?",
        )
        .run(id);
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
  async close() {
    this.closed = true;
    for (const item of this.running.values()) item.controller.abort();
    this.engine.host.close();
    await this.task;
  }
  private resources(job: any) {
    const payload = JSON.parse(job.payload_json),
      resources = new Set<string>();
    if (job.kind === "images") resources.add("image-import");
    if (job.kind === "download") resources.add("model:" + payload.id);
    if (job.kind === "prepare") for (const step of payload.steps) resources.add("model:" + step.id);
    if (job.kind === "index") resources.add("python-inference");
    if (job.kind === "analyze")
      for (const item of payload.items) {
        resources.add("column:" + item.columnId);
        if (
          item.choice?.provider === "local" &&
          this.models.get(item.choice.model).backend !== "llama"
        )
          resources.add("python-inference");
      }
    return resources;
  }
  pump() {
    if (this.closed) return;
    const queued = this.repo.db
      .prepare("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at,id")
      .all() as any[];
    for (const job of queued) {
      if (this.running.size >= this.concurrency()) break;
      if (this.running.has(job.id)) continue;
      let resources: Set<string>;
      try {
        resources = this.resources(job);
      } catch (error) {
        this.repo.db
          .prepare("UPDATE jobs SET state='failed',message=? WHERE id=?")
          .run(error instanceof Error ? error.message : String(error), job.id);
        continue;
      }
      const occupied = new Set(
        [...this.running.values()].flatMap((r) => [...r.resources]),
      );
      if ([...resources].some((r) => occupied.has(r))) continue;
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
    let done = job.done,
      failed = job.failed,
      skipped = job.skipped;
    try {
      for (; done < job.total;) {
        if (signal.aborted || this.closed) break;
        try {
          let outcome: "imported" | "skipped" = "imported";
          if (job.kind === "images")
            outcome = await this.images.importOne(payload, done);
          else if (job.kind === "index")
            outcome = await this.engine.indexOne(payload, done, signal);
          else if (job.kind === "analyze")
            outcome = await this.engine.analyzeOne(payload, done, signal);
          else if (job.kind === "download" || job.kind === "prepare") {
            const step = job.kind === "prepare" ? payload.steps[done] : { id: payload.id, fileIndex: done };
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
          if ((error as { fatal?: boolean })?.fatal || ["download", "prepare"].includes(job.kind))
            throw error;
          failed++;
          const message =
            error instanceof Error ? error.message : String(error);
          this.repo.db
            .prepare(
              "INSERT INTO job_errors(job_id,item,message) VALUES(?,?,?)",
            )
            .run(job.id, done, message);
          this.repo.db
            .prepare("UPDATE jobs SET message=? WHERE id=?")
            .run(message, job.id);
        }
        done++;
        this.repo.db
          .prepare(
            "UPDATE jobs SET done=?,failed=?,skipped=?,updated_at=? WHERE id=?",
          )
          .run(done, failed, skipped, now(), job.id);
        this.changed();
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
      if (!signal.aborted)
        this.repo.db
          .prepare(
            "UPDATE jobs SET state='failed',message=?,updated_at=? WHERE id=?",
          )
          .run(
            error instanceof Error ? error.message : String(error),
            now(),
            job.id,
          );
    }
  }
}

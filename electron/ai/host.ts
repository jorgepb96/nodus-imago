import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { Repository } from "../db/repository";

export class InferenceHost {
  child: ChildProcessWithoutNullStreams | null = null;
  pending: {
    id: number;
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  nextId = 0;
  idle: ReturnType<typeof setTimeout> | undefined;
  stderr = "";
  chain: Promise<unknown> = Promise.resolve();
  constructor(
    public repo: Repository,
    public script: string,
  ) {}
  close() {
    clearTimeout(this.idle);
    const child = this.child;
    this.child = null;
    child?.kill();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error("Inferencia detenida."));
      this.pending = null;
    }
  }
  request(input: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    const task = this.chain
      .catch(() => {})
      .then(() => this.execute(input, signal));
    this.chain = task;
    return task;
  }
  private execute(input: Record<string, unknown>, signal?: AbortSignal) {
    if (signal?.aborted)
      return Promise.reject(new Error("Inferencia cancelada."));
    clearTimeout(this.idle);
    if (!this.child) {
      const settings = this.repo.getSettings();
      this.stderr = "";
      const child = spawn(settings.python, ["-u", this.script], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          HF_HUB_OFFLINE: "1",
          TRANSFORMERS_OFFLINE: "1",
          HF_HUB_DISABLE_TELEMETRY: "1",
          DO_NOT_TRACK: "1",
        },
      });
      this.child = child;
      child.stderr.on("data", (data) => {
        this.stderr = (this.stderr + data.toString()).slice(-3000);
      });
      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        try {
          const message = JSON.parse(line);
          if (this.pending && this.pending.id === message.id) {
            const p = this.pending;
            this.pending = null;
            clearTimeout(p.timer);
            message.ok
              ? p.resolve(message.result)
              : p.reject(new Error(message.error));
          }
        } catch {
          /* Library output is not a protocol response. */
        }
      });
      const failed = (error?: Error) => {
        if (this.child !== child) return;
        this.child = null;
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          clearTimeout(p.timer);
          p.reject(
            new Error(
              error?.message ?? "El runtime de IA se cerró. " + this.stderr,
            ),
          );
        }
      };
      child.on("error", failed);
      child.on("exit", () => failed());
    }
    const abort = () => this.close();
    signal?.addEventListener("abort", abort, { once: true });
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.close(), 10 * 60_000);
      this.pending = { id, resolve, reject, timer };
      this.child!.stdin.write(JSON.stringify({ ...input, id }) + "\n");
    }).finally(() => {
      signal?.removeEventListener("abort", abort);
      this.idle = setTimeout(() => this.close(), 60_000);
    });
  }
}

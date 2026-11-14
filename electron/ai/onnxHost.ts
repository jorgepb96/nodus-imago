import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";

/** Integrated Electron/Node child process. Native ONNX never shares the UI's
 * process: cancellation, unsupported binaries and OOM cannot corrupt SQLite. */
export class OnnxHost {
  constructor(private module = path.join(__dirname, "ai", "onnxWorker.cjs")) {}
  private worker: ChildProcess | null = null;
  private key = "";
  private nextId = 0;
  private idle?: ReturnType<typeof setTimeout>;
  private pending = new Map<
    number,
    {
      resolve: (v: number[][]) => void;
      reject: (e: Error) => void;
      cleanup: () => void;
    }
  >();
  private terminating: Promise<unknown> = Promise.resolve();
  get pid() {
    return this.worker?.pid ?? null;
  }
  async close() {
    clearTimeout(this.idle);
    const worker = this.worker;
    this.worker = null;
    this.key = "";
    for (const item of this.pending.values()) {
      item.cleanup();
      item.reject(new Error("Motor ONNX cerrado."));
    }
    this.pending.clear();
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      this.terminating = new Promise<void>((resolve) => {
        const force = setTimeout(() => {
          worker.kill("SIGKILL");
        }, 5000);
        worker.once("exit", () => {
          clearTimeout(force);
          resolve();
        });
        worker.kill();
      });
    }
    await this.terminating;
  }
  async embed(
    directory: string,
    threads: number,
    dimensions: number,
    inputs: { image?: string; text?: string; role?: string }[],
    signal?: AbortSignal,
    visionBudget = 280,
  ): Promise<number[][]> {
    if (process.platform === "darwin" && process.arch === "x64")
      throw new Error(
        "EmbeddingGemma ONNX no está disponible en Mac Intel. Selecciona Harrier.",
      );
    if (signal?.aborted) throw new Error("Indexación cancelada.");
    const key = directory + ":" + threads;
    if (this.worker && this.key !== key) await this.close();
    await this.terminating;
    if (signal?.aborted) throw new Error("Indexación cancelada.");
    clearTimeout(this.idle);
    if (!this.worker) {
      const worker = fork(this.module, [], {
        execPath: process.execPath,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          HF_HUB_OFFLINE: "1",
          TRANSFORMERS_OFFLINE: "1",
          DO_NOT_TRACK: "1",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        serialization: "advanced",
      });
      this.worker = worker;
      this.key = key;
      worker.stdout?.on("data", () => {});
      worker.stderr?.on("data", () => {});
      worker.on("message", (message: any) => {
        const item = this.pending.get(message.id);
        if (!item) return;
        this.pending.delete(message.id);
        item.cleanup();
        if (message.ok) item.resolve(message.result);
        else item.reject(new Error(message.error));
        if (!this.pending.size)
          this.idle = setTimeout(() => {
            void this.close();
          }, 60_000);
      });
      worker.on("error", () => {
        if (this.worker === worker) void this.close();
      });
      worker.on("exit", () => {
        if (this.worker === worker) void this.close();
      });
      worker.send({ operation: "init", directory, threads });
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const abort = () => {
        void this.close();
      };
      const timer = setTimeout(abort, 10 * 60_000);
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        },
      });
      this.worker!.send({ id, inputs, dimensions, visionBudget });
    });
  }
}

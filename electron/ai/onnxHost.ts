import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";

const REQUEST_TIMEOUT = 10 * 60_000;
/** Characters of the worker's stderr kept to explain why it stopped. */
const STDERR_TAIL = 4000;

/** The worker stopped while a request was waiting for it. `retryable` marks a
 * stop the request did not cause (a crash, or a restart for someone else), so
 * sending it once more to a fresh worker can succeed. */
export class OnnxStopped extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Why the worker exited, with the last line it wrote to stderr. */
export function describeExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
) {
  const cause =
    signal === "SIGKILL"
      ? "El sistema detuvo el motor ONNX (SIGKILL), normalmente por falta de memoria."
      : signal
        ? `El motor ONNX se detuvo con la señal ${signal}.`
        : `El motor ONNX se detuvo con el código ${code}.`;
  const last = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 300);
  return last ? `${cause} Último mensaje: ${last}` : cause;
}

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
      worker: ChildProcess;
      resolve: (v: number[][]) => void;
      reject: (e: Error) => void;
      cleanup: () => void;
    }
  >();
  private terminating: Promise<unknown> = Promise.resolve();
  get pid() {
    return this.worker?.pid ?? null;
  }
  /** Stops the worker. Waiting requests fail with `reason`; when `culprit`
   * names the request that caused the stop, the others fail as retryable. */
  async close(reason?: Error, culprit?: number) {
    clearTimeout(this.idle);
    const worker = this.worker;
    this.worker = null;
    this.key = "";
    for (const [id, item] of this.pending) {
      item.cleanup();
      item.reject(
        culprit !== undefined && id !== culprit
          ? new OnnxStopped(
              "El motor ONNX se reinició mientras procesaba esta ficha.",
              true,
            )
          : (reason ?? new Error("Motor ONNX cerrado.")),
      );
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
  /** The worker stopped by itself: fail only the requests it was serving. */
  private lost(worker: ChildProcess, reason: Error) {
    if (this.worker === worker) {
      clearTimeout(this.idle);
      this.worker = null;
      this.key = "";
    }
    for (const [id, item] of this.pending)
      if (item.worker === worker) {
        this.pending.delete(id);
        item.cleanup();
        item.reject(reason);
      }
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
    const send = () =>
      this.request(directory, threads, dimensions, inputs, signal, visionBudget);
    try {
      return await send();
    } catch (error) {
      // A crash is often transient (memory pressure, a native hiccup): give the
      // record one fresh worker before counting it as an error.
      if (error instanceof OnnxStopped && error.retryable && !signal?.aborted)
        return send();
      throw error;
    }
  }
  private async request(
    directory: string,
    threads: number,
    dimensions: number,
    inputs: { image?: string; text?: string; role?: string }[],
    signal: AbortSignal | undefined,
    visionBudget: number,
  ): Promise<number[][]> {
    if (signal?.aborted) throw new Error("Indexación cancelada.");
    const key = directory + ":" + threads;
    if (this.worker && this.key !== key)
      await this.close(
        new OnnxStopped(
          "El motor ONNX se reinició mientras procesaba esta ficha.",
          true,
        ),
      );
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
      let stderr = "";
      worker.stdout?.on("data", () => {});
      worker.stderr?.on("data", (chunk) => {
        stderr = (stderr + String(chunk)).slice(-STDERR_TAIL);
      });
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
      worker.on("error", (error) => {
        if (worker.exitCode === null && worker.signalCode === null)
          worker.kill();
        this.lost(
          worker,
          new OnnxStopped(
            `No se pudo comunicar con el motor ONNX: ${error.message}`,
            true,
          ),
        );
      });
      worker.on("exit", (code, signal) => {
        if (this.worker === worker) {
          clearTimeout(this.idle);
          this.worker = null;
          this.key = "";
        }
        // Let stderr drain so the reason carries the last line it wrote.
        const report = () =>
          this.lost(
            worker,
            new OnnxStopped(describeExit(code, signal, stderr), true),
          );
        const fallback = setTimeout(report, 1000);
        worker.once("close", () => {
          clearTimeout(fallback);
          report();
        });
      });
      worker.send({ operation: "init", directory, threads });
    }
    const worker = this.worker!;
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const abort = () => {
        void this.close(new Error("Indexación cancelada."), id);
      };
      const timer = setTimeout(() => {
        void this.close(
          new OnnxStopped(
            "El motor ONNX tardó más de 10 minutos con esta ficha y se reinició.",
            false,
          ),
          id,
        );
      }, REQUEST_TIMEOUT);
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        worker,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        },
      });
      worker.send({ id, inputs, dimensions, visionBudget });
    });
  }
}

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Models } from "./models";
import {
  HARRIER_ID,
  HARRIER_QUERY_PREFIX,
} from "../../shared/embeddingBackends";
import { normalizeVector } from "../../shared/vectors";

/** Nodus llama-server embedding protocol: 8192-token physical batch, last pooling.
 * CPU is explicit. The loopback endpoint is authenticated with an ephemeral key. */
export class HarrierHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting?: Promise<string>;
  private token = "";
  private idle?: ReturnType<typeof setTimeout>;
  private stderr = "";
  private generation = 0;
  get pid() {
    return this.child?.pid ?? null;
  }
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private models: Models) {}
  close() {
    this.generation++;
    clearTimeout(this.idle);
    this.child?.kill();
    this.child = null;
    this.starting = undefined;
  }
  private async start(): Promise<string> {
    if (this.starting) return this.starting;
    const generation = this.generation;
    const operation = (async () => {
      const server = net.createServer();
      const port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const port = (server.address() as net.AddressInfo).port;
          server.close((error) => (error ? reject(error) : resolve(port)));
        });
      });
      const executable = await this.models.runtimeExecutable("llama-server");
      if (generation !== this.generation)
        throw new Error("Preparación de Harrier cancelada.");
      this.token = randomUUID();
      this.stderr = "";
      const child = spawn(
        executable,
        [
          "--model",
          path.join(
            this.models.directory(HARRIER_ID),
            "harrier-oss-v1-0.6b.Q8_0.gguf",
          ),
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--ctx-size",
          "8192",
          "--parallel",
          "1",
          "--threads",
          "2",
          "--batch-size",
          "8192",
          "--ubatch-size",
          "8192",
          "--embedding",
          "--pooling",
          "last",
          "--n-gpu-layers",
          "0",
          "--no-webui",
          "--api-key",
          this.token,
        ],
        { shell: false, cwd: path.dirname(executable), stdio: "pipe" },
      );
      this.child = child;
      child.stdout.on("data", () => {});
      child.stderr.on("data", (chunk) => {
        this.stderr = (this.stderr + chunk).slice(-2000);
      });
      let failure: Error | undefined;
      child.on("error", (error) => {
        failure = error;
      });
      child.on("exit", () => {
        failure = new Error("Harrier se ha detenido. " + this.stderr);
        if (this.child === child) this.close();
      });
      const base = `http://127.0.0.1:${port}`;
      const timeout = Date.now() + 180_000;
      while (Date.now() < timeout) {
        if (failure || this.child !== child)
          throw failure ?? new Error("Preparación de Harrier cancelada.");
        try {
          const response = await fetch(base + "/health", {
            headers: { Authorization: `Bearer ${this.token}` },
            signal: AbortSignal.timeout(2000),
            redirect: "error",
          });
          if (response.ok) return base;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(
        "Harrier no está listo; revisa el runtime y la memoria disponible.",
      );
    })();
    this.starting = operation;
    operation.catch(() => {
      if (this.starting === operation) this.close();
    });
    return operation;
  }
  embed(text: string, role: string, signal?: AbortSignal): Promise<number[]> {
    const task = this.chain
      .catch(() => {})
      .then(async () => {
        if (signal?.aborted) throw new Error("Embedding cancelado.");
        clearTimeout(this.idle);
        const abort = () => this.close();
        signal?.addEventListener("abort", abort, { once: true });
        try {
          const prefix = role === "query" ? HARRIER_QUERY_PREFIX : "";
          if (text.length + prefix.length > 8000)
            throw new Error(
              "Harrier admite hasta 8000 caracteres por entrada, incluido el prefijo.",
            );
          const base = await this.start();
          const response = await fetch(base + "/v1/embeddings", {
            method: "POST",
            redirect: "error",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.token}`,
            },
            body: JSON.stringify({ model: HARRIER_ID, input: prefix + text }),
            signal: AbortSignal.any([
              signal ?? new AbortController().signal,
              AbortSignal.timeout(5 * 60_000),
            ]),
          });
          if (!response.ok)
            throw new Error(
              `Harrier: HTTP ${response.status}. Reduce la entrada o comprueba el runtime.`,
            );
          const payload = await response.json();
          return normalizeVector(payload?.data?.[0]?.embedding ?? [], 1024);
        } finally {
          signal?.removeEventListener("abort", abort);
          if (this.child) this.idle = setTimeout(() => this.close(), 60_000);
        }
      });
    this.chain = task;
    return task;
  }
}

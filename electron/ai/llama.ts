import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { Models } from "./models";
import type { Repository } from "../db/repository";

// llama.cpp has no JSON-line server mode. Its multimodal CLI does have a
// persistent chat mode, which keeps the GGUF and projector loaded between
// cells. We speak its documented stdin protocol (/clear, /image, prompt) and
// parse the prompt echo instead of starting a model per cell. No HTTP listener
// is opened and no arbitrary remote code is executed.
const MAX_OUTPUT = 2 * 1024 * 1024;

export function cleanChatOutput(value: string) {
  return value
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x08/g, "")
    .replace(/\r/g, "");
}

/**
 * The CLI echoes the prompt before the answer. Keeping everything after the
 * last occurrence of the exact prompt avoids returning the echo as a cell
 * value. Chat mode can emit a reasoning block; the strict vision parser strips
 * it later, but this function never accepts an empty answer.
 */
export function extractChatAnswer(raw: string, prompt: string) {
  let text = cleanChatOutput(raw);
  // The line editor can wrap a long prompt, so the exact echoed prompt is not
  // always contiguous. The CLI always puts a blank line between echo and
  // generation, which is the stable boundary.
  const boundary = text.indexOf("\n\n");
  if (boundary >= 0) text = text.slice(boundary + 2);
  else {
    const cleanedPrompt = cleanChatOutput(prompt).trim();
    const at = cleanedPrompt ? text.lastIndexOf(cleanedPrompt) : -1;
    if (at >= 0) text = text.slice(at + cleanedPrompt.length);
  }
  text = text.replace(/^[\s>]+/, "").trim();
  if (!text) throw new Error("El motor de visión no devolvió texto.");
  return text;
}

export class LlamaSession {
  child: ChildProcessWithoutNullStreams;
  buffer = "";
  errors = "";
  alive = true;
  ready: Promise<unknown>;
  pending:
    | {
        resolve: (value: string) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
        abort?: () => void;
        signal?: AbortSignal;
      }
    | null = null;

  constructor(
    executable: string,
    args: string[],
  ) {
    this.child = spawn(executable, args, {
      shell: false,
      cwd: path.dirname(executable),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk) => this.onData(chunk.toString()));
    this.child.stderr.on("data", (chunk) => {
      this.errors = (this.errors + chunk.toString()).slice(-3000);
    });
    this.child.on("error", (error) => {
      this.alive = false;
      this.fail(
        new Error("El motor de visión no pudo arrancar: " + error.message),
      );
    });
    this.child.on("close", (code) => {
      this.alive = false;
      const detail = (this.errors || this.buffer).slice(-1200);
      this.fail(
        new Error(
          "El motor de visión se cerró" +
            (code == null ? "" : ` (código ${code})`) +
            (detail ? ": " + detail : "."),
        ),
      );
    });
    this.ready = this.waitForPrompt(180_000);
    this.ready.catch(() => this.close());
  }

  private onData(chunk: string) {
    if (!this.alive) return;
    this.buffer += chunk;
    if (this.buffer.length > MAX_OUTPUT) {
      this.fail(new Error("La salida del motor de visión es demasiado grande."));
      return;
    }
    this.checkPrompt();
  }

  private checkPrompt() {
    if (!this.pending) return;
    const marker = this.buffer.lastIndexOf("\n> ");
    if (marker < 0) return;
    const output = this.buffer.slice(0, marker);
    this.buffer = this.buffer.slice(marker + 3);
    this.settle(null, output);
  }

  private settle(error: Error | null, output = "") {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (pending.abort)
      pending.signal?.removeEventListener("abort", pending.abort);
    if (error) pending.reject(error);
    else pending.resolve(output);
  }

  private fail(error: Error) {
    if (this.pending) this.settle(error);
    this.close();
  }

  private waitForPrompt(timeoutMs: number, signal?: AbortSignal) {
    if (!this.alive) return Promise.reject(new Error("Motor de visión cerrado."));
    if (this.pending) return Promise.reject(new Error("Inferencia ya en curso."));
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.settle(new Error("Análisis cancelado."));
        this.close();
      };
      const timer = setTimeout(() => {
        this.settle(
          new Error("El motor de visión agotó el tiempo de espera."),
        );
        this.close();
      }, timeoutMs);
      this.pending = { resolve, reject, timer, abort, signal };
      signal?.addEventListener("abort", abort, { once: true });
      this.checkPrompt();
      if (signal?.aborted) abort();
    });
  }

  private command(line: string, signal: AbortSignal) {
    this.buffer = "";
    const prompt = this.waitForPrompt(10 * 60_000, signal);
    try {
      this.child.stdin.write(line + "\n");
    } catch (error) {
      this.fail(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return prompt;
  }

  async run(image: string, prompt: string, signal: AbortSignal) {
    await this.ready;
    if (!this.alive) throw new Error("Motor de visión cerrado.");
    if (signal.aborted) throw new Error("Análisis cancelado.");
    let line = prompt.replace(/\r?\n/g, " ").replace(/\0/g, "").trim();
    if (!line) throw new Error("El prompt de visión está vacío.");
    if (line.startsWith("/")) line = " " + line;
    if (line.length > 100_000)
      throw new Error("El prompt de visión supera el límite local.");
    await this.command("/clear", signal);
    await this.command("/image " + image, signal);
    const raw = await this.command(line, signal);
    return extractChatAnswer(raw, line);
  }

  close() {
    this.alive = false;
    if (this.pending)
      this.settle(new Error("El motor de visión se ha detenido."));
    this.child.kill();
  }
}

type Slot = {
  key: string;
  modelId: string;
  mode: "text" | "json";
  session: LlamaSession | null;
  busy: boolean;
  idle?: ReturnType<typeof setTimeout>;
};

type Waiter = {
  key: string;
  modelId: string;
  mode: "text" | "json";
  resolve: (slot: Slot) => void;
  reject: (error: Error) => void;
};

/**
 * Keeps one chat process per concurrent slot instead of reloading the model for
 * every cell. Slots are keyed by model/profile/task format, so text descriptions
 * and JSON-constrained classifications can use separate processes up to the
 * profile's memory/job limit. Sessions are closed after a minute of inactivity.
 */
export class LlamaPool {
  slots: Slot[] = [];
  waiting: Waiter[] = [];
  closed = false;

  constructor(
    public repo: Repository,
    public models: Models,
  ) {}

  private settings() {
    return this.repo.getSettings();
  }

  private maxSessions() {
    const settings = this.settings(),
      cap =
        settings.profile === "light"
          ? 1
          : settings.profile === "balanced"
            ? 2
            : 4;
    return Math.max(1, Math.min(cap, settings.parallelJobs, 4));
  }

  private keyFor(modelId: string, mode: "text" | "json") {
    const settings = this.settings();
    return JSON.stringify({
      modelId,
      revision: this.models.get(modelId).revision,
      profile: settings.profile,
      device: settings.device,
      mode,
    });
  }

  private retire(slot: Slot, refill = true) {
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
    if (slot.idle) clearTimeout(slot.idle);
    slot.session?.close();
    slot.session = null;
    if (refill) this.fill();
  }

  private armIdle(slot: Slot) {
    if (slot.idle) clearTimeout(slot.idle);
    slot.idle = setTimeout(() => {
      if (!this.closed && !slot.busy) this.retire(slot);
    }, 60_000);
    slot.idle.unref?.();
  }

  private async create(slot: Slot) {
    if (this.closed) throw new Error("El motor de visión está cerrado.");
    const executable = await this.models.runtimeExecutable(),
      directory = this.models.directory(slot.modelId),
      model = this.models.get(slot.modelId),
      settings = this.settings();
    const weights = model.files.find(
        (file) =>
          file.path.endsWith(".gguf") && !file.path.startsWith("mmproj"),
      ),
      projector = model.files.find((file) => file.path.startsWith("mmproj"));
    if (!weights || !projector)
      throw new Error("Modelo de visión incompleto.");
    const threads =
      settings.profile === "light"
        ? "1"
        : settings.profile === "balanced"
          ? "2"
          : "4";
    const args = [
      "-m",
      path.join(directory, weights.path),
      "--mmproj",
      path.join(directory, projector.path),
      "--image-max-tokens",
      "280",
      "-n",
      "512",
      "--temp",
      "0",
      "-c",
      "4096",
      "-t",
      threads,
      "--log-verbosity",
      "0",
      "-ngl",
      settings.device === "cpu" ? "0" : "99",
    ];
    if (slot.mode === "json")
      args.push(
        "--json-schema",
        JSON.stringify({ type: "array", items: { type: "string" } }),
      );
    const session = new LlamaSession(executable, args);
    try {
      await session.ready;
      if (this.closed || !this.slots.includes(slot)) {
        session.close();
        throw new Error("El motor de visión está cerrado.");
      }
      slot.session = session;
    } catch (error) {
      session.close();
      throw error;
    }
  }

  private fill() {
    if (this.closed) return;
    while (this.waiting.length) {
      const waiter = this.waiting[0],
        free = this.slots.find(
          (slot) => !slot.busy && slot.key === waiter.key,
        );
      if (free) {
        free.busy = true;
        if (free.idle) clearTimeout(free.idle);
        free.idle = undefined;
        this.waiting.shift()!;
        waiter.resolve(free);
        continue;
      }
      if (this.slots.length < this.maxSessions()) {
        const slot: Slot = {
          key: waiter.key,
          modelId: waiter.modelId,
          mode: waiter.mode,
          session: null,
          busy: true,
        };
        this.slots.push(slot);
        this.waiting.shift()!;
        void this.create(slot).then(
          () => waiter.resolve(slot),
          (error) => {
            const index = this.slots.indexOf(slot);
            if (index >= 0) this.slots.splice(index, 1);
            waiter.reject(
              error instanceof Error ? error : new Error(String(error)),
            );
            this.fill();
          },
        );
        continue;
      }
      // Capacity is full. Evict an idle session for another key rather than
      // blocking the new task forever after a model/task change.
      const idle = this.slots.find((slot) => !slot.busy);
      if (idle) {
        this.retire(idle, false);
        continue;
      }
      return;
    }
  }

  private acquire(waiter: Waiter): Promise<Slot> {
    if (this.closed)
      return Promise.reject(new Error("El motor de visión está cerrado."));
    return new Promise((resolve, reject) => {
      this.waiting.push({ ...waiter, resolve, reject });
      this.fill();
    });
  }

  private release(slot: Slot) {
    if (!this.slots.includes(slot)) return;
    slot.busy = false;
    this.armIdle(slot);
    this.fill();
  }

  async describe(
    modelId: string,
    image: string,
    prompt: string,
    signal: AbortSignal,
    mode: "text" | "json" = "text",
  ) {
    if (signal.aborted) throw new Error("Análisis cancelado.");
    const slot = await this.acquire({
      key: this.keyFor(modelId, mode),
      modelId,
      mode,
      resolve: () => {},
      reject: () => {},
    });
    try {
      if (!slot.session)
        throw new Error("No se pudo iniciar el motor de visión.");
      return await slot.session.run(image, prompt, signal);
    } catch (error) {
      this.retire(slot, false);
      throw error;
    } finally {
      this.release(slot);
    }
  }

  close() {
    this.closed = true;
    for (const waiter of this.waiting.splice(0))
      waiter.reject(new Error("El motor de visión está cerrado."));
    for (const slot of this.slots) {
      if (slot.idle) clearTimeout(slot.idle);
      slot.session?.close();
    }
    this.slots = [];
  }
}

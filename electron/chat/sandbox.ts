// Starts the isolated process for one chat calculation and stops it when the
// code finishes, fails, takes too long or the answer is cancelled.
import { fork } from "node:child_process";
import path from "node:path";
import { realpathSync } from "node:fs";
import type { CalcOutcome } from "../../shared/chat";

export type CalcOptions = { timeoutMs?: number; memoryMb?: number };

/** The child script must be a real file: in a package it is unpacked from the asar. */
export function sandboxScript(directory: string) {
  return path.join(directory, "chat", "sandboxChild.cjs").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

/** Node's permission model: read this script only; no writes, processes, workers or addons. */
export function sandboxArgs(script: string, memoryMb = 512) {
  return ["--permission", `--allow-fs-read=${script}`, `--max-old-space-size=${memoryMb}`];
}

export function runCalc(
  script: string,
  code: string,
  json: string,
  signal: AbortSignal,
  { timeoutMs = 8000, memoryMb = 512 }: CalcOptions = {},
): Promise<CalcOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    // The permission model compares real paths (macOS /tmp is a symlink).
    let real = script;
    try {
      real = realpathSync(script);
    } catch {
      /* fork reports the missing file. */
    }
    const child = fork(real, [], {
      execPath: process.execPath,
      // Nothing from this process's environment (keys, paths) is inherited.
      env: { ELECTRON_RUN_AS_NODE: "1" },
      execArgv: sandboxArgs(real, memoryMb),
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 4000) stderr += String(chunk);
    });
    const finish = (outcome: CalcOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve(outcome);
    };
    const fail = (error: string) => finish({ ok: false, error, logs: [], ms: Date.now() - started });
    const abort = () => fail("Cálculo cancelado.");
    // Parsing the data counts too; the code itself has its own V8 timeout.
    const timer = setTimeout(() => fail("El cálculo ha superado el tiempo máximo."), timeoutMs + 20_000);
    signal.addEventListener("abort", abort, { once: true });
    child.on("message", (message: CalcOutcome) => finish(message));
    child.on("error", (error) => fail(`No se pudo iniciar el entorno de cálculo: ${error.message}`));
    child.on("exit", (code) => {
      if (!settled)
        fail(
          /heap|memory/i.test(stderr)
            ? "El cálculo ha superado la memoria disponible."
            : `El entorno de cálculo se cerró (código ${code}).`,
        );
    });
    if (signal.aborted) return abort();
    child.send({ code, json, timeoutMs });
  });
}

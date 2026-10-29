import { parentPort, workerData } from "node:worker_threads";
import { Service } from "./service";
let nextCompletion = 0;
const completions = new Map<
  number,
  { resolve: (v: string) => void; reject: (error: Error) => void }
>();
const service = new Service(
  workerData.root,
  workerData.script,
  () => parentPort!.postMessage({ event: "changed" }),
  (input, signal) =>
    new Promise((resolve, reject) => {
      const id = ++nextCompletion;
      const abort = () =>
        parentPort!.postMessage({ event: "abortCompletion", completionId: id });
      signal.addEventListener("abort", abort, { once: true });
      completions.set(id, {
        resolve: (v) => {
          signal.removeEventListener("abort", abort);
          resolve(v);
        },
        reject: (e) => {
          signal.removeEventListener("abort", abort);
          reject(e);
        },
      });
      parentPort!.postMessage({ event: "complete", completionId: id, input });
    }),
);
parentPort!.on("message", async (message) => {
  if (message.event === "completionReply") {
    const pending = completions.get(message.completionId);
    if (!pending) return;
    completions.delete(message.completionId);
    if (message.ok) pending.resolve(message.result);
    else {
      const error = Object.assign(new Error(message.error), {
        fatal: message.fatal,
      });
      pending.reject(error);
    }
    return;
  }
  try {
    const result = await service.run(message.command, message.input);
    parentPort!.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    parentPort!.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

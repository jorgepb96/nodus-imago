import { spawn } from "node:child_process";
import path from "node:path";
import { Models } from "./models";
import type { Repository } from "../db/repository";
// Same GGUF + mmproj architecture as Nodus's local engine. CLI transport keeps
// this small visual worker independent of a listening HTTP service.
export class LlamaVision {
  constructor(
    public repo: Repository,
    public models: Models,
  ) {}
  async describe(
    modelId: string,
    image: string,
    prompt: string,
    signal: AbortSignal,
  ) {
    const executable = await this.models.runtimeExecutable(),
      directory = this.models.directory(modelId),
      model = this.models.get(modelId),
      settings = this.repo.getSettings();
    const weights = model.files.find(
        (f) => f.path.endsWith(".gguf") && !f.path.startsWith("mmproj"),
      ),
      projector = model.files.find((f) => f.path.startsWith("mmproj"));
    if (!weights || !projector) throw new Error("Modelo de visión incompleto.");
    const args = [
      "-m",
      path.join(directory, weights.path),
      "--mmproj",
      path.join(directory, projector.path),
      "--image",
      image,
      "-p",
      prompt,
      "-n",
      "512",
      "--temp",
      "0",
      "-c",
      "4096",
      "-t",
      settings.profile === "light"
        ? "1"
        : settings.profile === "balanced"
          ? "2"
          : "4",
      "--log-verbosity",
      "0",
      "-ngl",
      settings.device === "cpu" ? "0" : "99",
    ];
    return new Promise<string>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("Análisis cancelado."));
        return;
      }
      const child = spawn(executable, args, {
        shell: false,
        cwd: path.dirname(executable),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "",
        errors = "";
      const abort = () => child.kill(),
        timeout = setTimeout(abort, 10 * 60_000);
      signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk) => {
        text += chunk.toString();
        if (text.length > 1_000_000) child.kill();
      });
      child.stderr.on("data", (chunk) => {
        errors = (errors + chunk.toString()).slice(-1500);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(new Error("Análisis cancelado."));
        else if (code !== 0)
          reject(
            new Error(
              "El motor de visión no pudo ejecutar el modelo: " + errors,
            ),
          );
        else resolve(text.replace(/\[end of text\]/g, "").trim());
      });
    });
  }
}

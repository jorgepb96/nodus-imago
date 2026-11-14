import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import catalog from "../../shared/modelCatalog.json";
import runtimes from "../../shared/runtimeCatalog.json";
import embeddingOnnx from "../../shared/embeddingOnnxCatalog.json";
import {
  HARRIER_ID,
  HARRIER_REVISION,
  ONNX_ID,
} from "../../shared/embeddingBackends";
import { Archive } from "../import/archive";
import * as tar from "tar";
import type { ModelInfo } from "../../shared/imago";
import type { Repository } from "../db/repository";
import { ensureDiskSpace } from "../storage/disk";
import { DISK_RESERVE } from "../storage/disk";
import type {
  ModelPreparation,
  ModelPreparationStep,
} from "../../shared/modelPreparation";
import { embeddingDimensions } from "../../shared/embeddingBackends";
import {
  API_EMBEDDING_ID,
  DEFAULT_EMBEDDING_API,
} from "../../shared/embeddingApi";

export type CatalogModel = {
  id: string;
  repository: string;
  revision: string;
  label: string;
  task: string;
  license: string;
  backend?: string;
  files: {
    path: string;
    url?: string;
    size: number;
    algorithm: string;
    digest: string;
  }[];
};
export class Models {
  constructor(public repo: Repository) {}
  catalog(): CatalogModel[] {
    const runtime = runtimes.find(
      (r) => r.platform === process.platform && r.arch === process.arch,
    );
    const harrier: CatalogModel = {
      id: HARRIER_ID,
      repository: "mradermacher/harrier-oss-v1-0.6b-GGUF",
      revision: HARRIER_REVISION,
      label: "Harrier OSS v1 0.6B · Q8_0 · Mac Intel",
      task: "embedding",
      license: "MIT",
      backend: "llama_cpp",
      files: [
        {
          path: "harrier-oss-v1-0.6b.Q8_0.gguf",
          size: 639448320,
          algorithm: "sha256",
          digest:
            "ba2c9408f82cfdb73aaf70aaea9f125f3fb24c5e76ce0efb469e1530e5ec53e4",
        },
      ],
    };
    return [embeddingOnnx, harrier, ...catalog, ...(runtime ? [runtime] : [])];
  }
  get(id: string): CatalogModel {
    const model = this.catalog().find((m) => m.id === id);
    if (!model) throw new Error("Modelo no permitido.");
    return model;
  }
  available(id: string) {
    const target = `${process.platform}-${process.arch}`;
    if (id === API_EMBEDDING_ID) return true;
    return (
      [
        "darwin-arm64",
        "darwin-x64",
        "win32-x64",
        "linux-x64",
        "linux-arm64",
      ].includes(target) && !(id === ONNX_ID && target === "darwin-x64")
    );
  }
  requirementIds() {
    const id = this.repo.getSettings().embeddingModel;
    // An API model needs nothing downloaded; LFM3 captions stay optional.
    if (id === API_EMBEDDING_ID) return [];
    return id === HARRIER_ID
      ? ["llama-runtime", "lfm3-vl-2b", HARRIER_ID]
      : [id];
  }
  async preparation(activeContract: string): Promise<ModelPreparation> {
    const settings = this.repo.getSettings(),
      all = this.list();
    const requirements = this.requirementIds()
      .map((id) => all.find((model) => model.id === id)!)
      .filter(Boolean);
    let remainingBytes = 0;
    for (const model of requirements)
      if (!model.verified)
        for (const file of this.get(model.id).files) {
          const target = path.join(this.directory(model.id), file.path);
          try {
            if ((await fsp.stat(target)).size === file.size) continue;
          } catch {}
          let partial = 0;
          try {
            partial = Math.min(
              file.size,
              (await fsp.stat(target + ".part")).size,
            );
          } catch {}
          remainingBytes += file.size - partial;
        }
    const disk = await fsp.statfs(this.repo.root);
    return {
      embeddingModel: settings.embeddingModel,
      requirements,
      remainingBytes,
      freeBytes: Number(disk.bavail) * Number(disk.bsize),
      destination: path.join(this.repo.root, "models"),
      supported: this.available(settings.embeddingModel),
      ready:
        settings.embeddingModel !== "embeddinggemma2" &&
        requirements.length === this.requirementIds().length &&
        requirements.every((m) => m.verified),
      activeDimensions:
        settings.embeddingModel === API_EMBEDDING_ID
          ? (settings.embeddingApi ?? DEFAULT_EMBEDDING_API).dimensions
          : embeddingDimensions(settings.embeddingModel, settings.dimensions),
      priorVectors: (
        this.repo.db
          .prepare("SELECT count(*) n FROM embeddings WHERE contract<>?")
          .get(activeContract) as { n: number }
      ).n,
      runtime:
        settings.embeddingModel === API_EMBEDDING_ID
          ? "api"
          : settings.embeddingModel === ONNX_ID
            ? "onnx-cpu"
            : settings.embeddingModel === HARRIER_ID
              ? "llama-cpu"
              : "python-experimental",
    };
  }
  async enqueuePreparation(activeContract: string) {
    const plan = await this.preparation(activeContract);
    if (!plan.supported)
      throw new Error(
        "El modelo elegido no está disponible en este dispositivo.",
      );
    if (plan.runtime === "python-experimental")
      throw new Error(
        "El modo Python es experimental y se prepara manualmente; elige ONNX o Harrier para el flujo principal.",
      );
    if (plan.ready) return null;
    await ensureDiskSpace(
      this.repo.root,
      plan.remainingBytes + (plan.runtime === "llama-cpu" ? 256 * 2 ** 20 : 0),
    );
    const existing = this.repo.db
      .prepare(
        "SELECT id FROM jobs WHERE kind='prepare' AND state IN ('queued','running','paused') LIMIT 1",
      )
      .get() as { id: string } | undefined;
    if (existing) {
      this.repo.db
        .prepare("UPDATE jobs SET state='queued' WHERE id=? AND state='paused'")
        .run(existing.id);
      return existing.id;
    }
    const steps: ModelPreparationStep[] = [];
    for (const model of plan.requirements)
      if (!model.verified) {
        this.get(model.id).files.forEach((_, fileIndex) =>
          steps.push({ id: model.id, fileIndex }),
        );
        steps.push({ id: model.id, fileIndex: null });
      }
    return this.repo.newJob(
      "prepare",
      { label: "Preparar búsqueda local", steps, model: plan.embeddingModel },
      steps.length,
    );
  }
  directory(id: string) {
    const m = this.get(id);
    const directory = path.join(this.repo.root, "models", m.id, m.revision),
      parent = path.dirname(directory);
    if (!fs.existsSync(directory) && fs.existsSync(parent)) {
      const prefix = m.revision + ".previous-";
      const previous = fs
        .readdirSync(parent)
        .find(
          (name) =>
            name.startsWith(prefix) &&
            /^[a-f0-9-]{36}$/.test(name.slice(prefix.length)) &&
            fs.lstatSync(path.join(parent, name)).isDirectory(),
        );
      if (previous) fs.renameSync(path.join(parent, previous), directory);
    }
    return directory;
  }
  list(): ModelInfo[] {
    return this.catalog().map((m) => {
      const dir = this.directory(m.id);
      let verified = false;
      try {
        verified =
          JSON.parse(fs.readFileSync(path.join(dir, "verified.json"), "utf8"))
            .revision === m.revision;
      } catch {}
      const present = m.files.filter(
        (f) =>
          fs.existsSync(path.join(dir, f.path)) &&
          fs.statSync(path.join(dir, f.path)).size === f.size,
      );
      return {
        id: m.id,
        label:
          m.id === "embeddinggemma2" || m.id.startsWith("smolvlm")
            ? m.label + " · experimental Python"
            : m.label,
        task: m.task as ModelInfo["task"],
        repository: m.repository,
        revision: m.revision,
        license: m.license,
        estimatedGB: m.files.reduce((s, f) => s + f.size, 0) / 1e9,
        installed: present.length === m.files.length,
        verified: verified && present.length === m.files.length,
        status: verified ? "integrity-verified" : "unverified",
        files: present.length,
        bytes: present.reduce((s, f) => s + f.size, 0),
        available: this.available(m.id),
        unavailableReason: this.available(m.id)
          ? undefined
          : "EmbeddingGemma ONNX no dispone de runtime para Mac Intel; utiliza Harrier.",
        experimental: m.id === "embeddinggemma2" || m.id.startsWith("smolvlm"),
      };
    });
  }
  async verify(id: string) {
    const model = this.get(id),
      dir = this.directory(id);
    // A prepared runtime stays usable while its replacement is checked. Its
    // previous verification is superseded only after a successful promotion.
    if (model.task !== "runtime")
      await fsp.rm(path.join(dir, "verified.json"), { force: true });
    for (const file of model.files) {
      const target = path.join(dir, file.path),
        stat = await fsp.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size) {
        // A corrupted file with the official size would otherwise be skipped
        // by downloadFile() on every retry. Remove only the invalid file so the
        // user can download it again.
        await fsp.rm(target, { force: true }).catch(() => {});
        throw new Error("Archivo de modelo inválido: " + file.path);
      }
      const digest = createHash(
        file.algorithm === "sha256" ? "sha256" : "sha1",
      );
      if (file.algorithm === "git-sha1") digest.update(`blob ${stat.size}\0`);
      for await (const chunk of fs.createReadStream(target))
        digest.update(chunk);
      if (digest.digest("hex") !== file.digest) {
        await fsp.rm(target, { force: true }).catch(() => {});
        throw new Error("Integridad incorrecta: " + file.path);
      }
    }
    if (model.task === "runtime") await this.prepareRuntime();
    await fsp.writeFile(
      path.join(dir, "verified.json"),
      JSON.stringify({
        revision: model.revision,
        checkedAt: new Date().toISOString(),
      }),
    );
    return true;
  }
  async importDirectory(id: string, source: string) {
    const model = this.get(id),
      dir = this.directory(id);
    if (!this.available(id))
      throw new Error("Este modelo no está disponible en esta plataforma.");
    await fsp.mkdir(path.dirname(dir), { recursive: true });
    await ensureDiskSpace(
      path.dirname(dir),
      model.files.reduce((sum, file) => sum + file.size, 0),
    );
    const staging = await fsp.mkdtemp(
      path.join(path.dirname(dir), ".model-stage-"),
    );
    const previous = dir + ".previous-" + randomUUID();
    let moved = false;
    try {
      // Only exact catalogued data files are copied; no pickle, Python, GGUF or executable.
      for (const file of model.files) {
        const input = path.join(source, file.path),
          stat = await fsp.lstat(input);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size)
          throw new Error(
            "Modelo local incompleto o incompatible: " + file.path,
          );
        await fsp.mkdir(path.dirname(path.join(staging, file.path)), {
          recursive: true,
        });
        const target = path.join(staging, file.path);
        await fsp.copyFile(input, target);
        const hash = createHash(
          file.algorithm === "sha256" ? "sha256" : "sha1",
        );
        if (file.algorithm === "git-sha1") hash.update(`blob ${stat.size}\0`);
        for await (const chunk of fs.createReadStream(target))
          hash.update(chunk);
        if (hash.digest("hex") !== file.digest)
          throw new Error("El modelo importado no supera SHA: " + file.path);
      }
      if (model.task === "runtime") await this.prepareRuntime(staging);
      await fsp.writeFile(
        path.join(staging, "verified.json"),
        JSON.stringify({
          revision: model.revision,
          checkedAt: new Date().toISOString(),
        }),
      );
      if (fs.existsSync(dir)) {
        fs.renameSync(dir, previous);
        moved = true;
      }
      fs.renameSync(staging, dir);
      await fsp.rm(previous, { recursive: true, force: true }).catch(() => {});
      return true;
    } catch (error) {
      if (moved && !fs.existsSync(dir)) await fsp.rename(previous, dir);
      throw error;
    } finally {
      await fsp.rm(staging, { recursive: true, force: true });
    }
  }
  async downloadFile(
    id: string,
    index: number,
    signal: AbortSignal,
    progress: (bytes: number, total: number) => void,
  ) {
    const model = this.get(id),
      file = model.files[index],
      dir = this.directory(id),
      destination = path.join(dir, file.path),
      partial = destination + ".part";
    if (!this.available(id))
      throw new Error("Este modelo no está disponible en esta plataforma.");
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    if (
      fs.existsSync(destination) &&
      (await fsp.stat(destination)).size === file.size
    )
      return;
    let offset = fs.existsSync(partial) ? (await fsp.stat(partial)).size : 0;
    if (offset > file.size) {
      await fsp.rm(partial);
      offset = 0;
    }
    await ensureDiskSpace(path.dirname(destination), file.size - offset);
    let url =
      file.url ??
      `https://huggingface.co/${model.repository}/resolve/${model.revision}/${file.path}`;
    let response: Response | undefined;
    for (let redirects = 0; redirects < 8; redirects++) {
      const host = new URL(url);
      if (
        host.protocol !== "https:" ||
        !(
          host.hostname === "huggingface.co" ||
          host.hostname.endsWith(".huggingface.co") ||
          host.hostname.endsWith(".hf.co") ||
          host.hostname === "github.com" ||
          host.hostname === "release-assets.githubusercontent.com" ||
          host.hostname === "objects.githubusercontent.com"
        )
      )
        throw new Error("Redirección de descarga no autorizada.");
      try {
        response = await fetch(url, {
          redirect: "manual",
          signal,
          headers: offset ? { Range: `bytes=${offset}-` } : {},
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error(
          "No se pudo descargar el modelo. Comprueba la conexión y pulsa Reanudar; se conservan los datos parciales. (" +
            (error instanceof Error ? error.message : String(error)) +
            ")",
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirección sin destino.");
        url = new URL(location, url).href;
        continue;
      }
      break;
    }
    if (!response?.ok || !response.body)
      throw new Error(
        "No se pudo descargar el modelo: HTTP " + response?.status,
      );
    if (response.status !== 206) offset = 0;
    else if (
      !response.headers.get("content-range")?.startsWith(`bytes ${offset}-`)
    )
      throw new Error("Rango de descarga no válido.");
    const out = await fsp.open(partial, offset ? "a" : "w");
    let bytes = offset;
    try {
      for await (const chunk of response.body as any) {
        if (signal.aborted) throw new Error("Descarga pausada.");
        bytes += chunk.length;
        if (bytes > file.size)
          throw new Error("La descarga excede el tamaño oficial.");
        await out.write(chunk);
        progress(bytes, file.size);
      }
    } finally {
      await out.close();
    }
    if (bytes !== file.size)
      throw new Error("Descarga incompleta. Puedes reanudarla.");
    const stat = await fsp.stat(partial),
      hash = createHash(file.algorithm === "sha256" ? "sha256" : "sha1");
    if (file.algorithm === "git-sha1") hash.update(`blob ${stat.size}\0`);
    for await (const chunk of fs.createReadStream(partial)) hash.update(chunk);
    if (hash.digest("hex") !== file.digest) {
      await fsp.rm(partial);
      throw new Error("El modelo descargado no supera la verificación.");
    }
    await fsp.rename(partial, destination);
  }
  async prepareRuntime(targetRoot?: string) {
    const model = this.get("llama-runtime"),
      root = targetRoot ?? this.directory(model.id),
      file = path.join(root, model.files[0].path),
      active = path.join(root, "bin"),
      previous = path.join(root, ".runtime-previous-" + randomUUID());
    await fsp.mkdir(root, { recursive: true });
    await this.recoverRuntime(root);
    const destination = await fsp.mkdtemp(path.join(root, ".runtime-stage-"));
    try {
      if (file.endsWith(".zip")) {
        const archive = await Archive.open(file);
        try {
          await archive.preflight(destination);
          for (const [name, entry] of archive.entries) {
            if (name.endsWith("/")) continue;
            const target = path.join(destination, name);
            await fsp.mkdir(path.dirname(target), { recursive: true });
            await archive.extract(name, target);
          }
        } finally {
          archive.close();
        }
      } else {
        let unpackedBytes = 0;
        await tar.t({
          file,
          onReadEntry: (entry) => {
            unpackedBytes += entry.size;
          },
        });
        await ensureDiskSpace(destination, unpackedBytes);
        const links: { file: string; target: string; hard: boolean }[] = [];
        let invalid: Error | undefined;
        await tar.x({
          file,
          cwd: destination,
          preservePaths: false,
          strict: true,
          filter: (p, entry) => {
            if (invalid) return false;
            if (
              path.isAbsolute(p) ||
              /^[a-z]:[\\/]/i.test(p) ||
              p.split(/[\\/]/).includes("..")
            ) {
              invalid = new Error("Ruta de runtime no permitida.");
              return false;
            }
            if (
              "type" in entry &&
              ["SymbolicLink", "Link"].includes(entry.type)
            ) {
              const linkpath = entry.linkpath ?? "";
              const link = path.resolve(
                path.dirname(path.join(destination, p)),
                linkpath,
              );
              if (
                !linkpath ||
                path.isAbsolute(linkpath) ||
                /^[a-z]:[\\/]/i.test(linkpath) ||
                !link.startsWith(destination + path.sep)
              ) {
                invalid = new Error("Enlace de runtime no permitido.");
                return false;
              }
              links.push({
                file: path.join(destination, p),
                target: linkpath,
                hard: entry.type === "Link",
              });
              return false;
            }
            return true;
          },
        });
        if (invalid) throw invalid;
        // Extract data before creating aliases: tar must never traverse an archive
        // symlink while writing another entry (including dylib alias chains).
        for (const link of links) {
          await fsp.mkdir(path.dirname(link.file), { recursive: true });
          if (link.hard)
            await fsp.link(path.resolve(destination, link.target), link.file);
          else await fsp.symlink(link.target, link.file);
        }
      }
    } catch (error) {
      await fsp.rm(destination, { recursive: true, force: true });
      throw error;
    }
    let moved = false;
    try {
      const executable = await this.findExecutable(destination);
      if (!executable)
        throw new Error("El motor descargado no contiene llama-mtmd-cli.");
      if (process.platform !== "win32") await fsp.chmod(executable, 0o755);
      // All extraction and checks finish before touching the working runtime.
      if (fs.existsSync(active)) {
        fs.renameSync(active, previous);
        moved = true;
      }
      fs.renameSync(destination, active);
      await fsp.rm(previous, { recursive: true, force: true }).catch(() => {});
    } catch (error) {
      if (moved && !fs.existsSync(active)) await fsp.rename(previous, active);
      await fsp.rm(destination, { recursive: true, force: true });
      throw error;
    }
  }
  private async recoverRuntime(root: string) {
    if (!fs.existsSync(root)) return;
    if (fs.existsSync(path.join(root, "bin"))) return;
    const backups = (await fsp.readdir(root)).filter((name) =>
      /^\.runtime-previous-[a-f0-9-]{36}$/.test(name),
    );
    for (const backup of backups.reverse())
      if (await this.findExecutable(path.join(root, backup))) {
        await fsp.rename(path.join(root, backup), path.join(root, "bin"));
        return;
      }
  }
  private async findExecutable(
    root: string,
    name = "llama-mtmd-cli",
  ): Promise<string | null> {
    for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
      const p = path.join(root, entry.name);
      if (
        entry.isFile() &&
        entry.name === (process.platform === "win32" ? name + ".exe" : name)
      )
        return p;
      if (entry.isDirectory()) {
        const found = await this.findExecutable(p, name);
        if (found) return found;
      }
    }
    return null;
  }
  async runtimeExecutable(name = "llama-mtmd-cli") {
    const root = this.directory("llama-runtime");
    await this.recoverRuntime(root);
    let verified = false;
    try {
      verified =
        JSON.parse(await fsp.readFile(path.join(root, "verified.json"), "utf8"))
          .revision === this.get("llama-runtime").revision;
    } catch {}
    if (!verified)
      throw new Error("Instala el motor de visión local en Ajustes.");
    const executable = await this.findExecutable(
      path.join(this.directory("llama-runtime"), "bin"),
      name,
    );
    if (!executable)
      throw new Error("Motor de visión ausente. Verifica su integridad.");
    return executable;
  }
}

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import catalog from "../../shared/modelCatalog.json";
import runtimes from "../../shared/runtimeCatalog.json";
import { Archive } from "../import/archive";
import * as tar from "tar";
import type { ModelInfo } from "../../shared/imago";
import type { Repository } from "../db/repository";

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
    return [...catalog, ...(runtime ? [runtime] : [])];
  }
  get(id: string): CatalogModel {
    const model = this.catalog().find((m) => m.id === id);
    if (!model) throw new Error("Modelo no permitido.");
    return model;
  }
  directory(id: string) {
    const m = this.get(id);
    return path.join(this.repo.root, "models", m.id, m.revision);
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
        label: m.label,
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
      };
    });
  }
  async verify(id: string) {
    const model = this.get(id),
      dir = this.directory(id);
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
    await fsp.mkdir(dir, { recursive: true });
    // Only exact catalogued data files are copied; no pickle, Python, GGUF or executable.
    for (const file of model.files) {
      const input = path.join(source, file.path),
        stat = await fsp.lstat(input);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size)
        throw new Error("Modelo local incompleto o incompatible: " + file.path);
      await fsp.mkdir(path.dirname(path.join(dir, file.path)), {
        recursive: true,
      });
      await fsp.copyFile(input, path.join(dir, file.path));
    }
    return this.verify(id);
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
      response = await fetch(url, {
        redirect: "manual",
        signal,
        headers: offset ? { Range: `bytes=${offset}-` } : {},
      });
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
  async prepareRuntime() {
    const model = this.get("llama-runtime"),
      root = this.directory(model.id),
      file = path.join(root, model.files[0].path),
      destination = path.join(root, "bin");
    await fsp.rm(destination, { recursive: true, force: true });
    await fsp.mkdir(destination, { recursive: true });
    try {
      if (file.endsWith(".zip")) {
        const archive = await Archive.open(file);
        try {
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
    const executable = await this.findExecutable(destination);
    if (!executable)
      throw new Error("El motor descargado no contiene llama-mtmd-cli.");
    if (process.platform !== "win32") await fsp.chmod(executable, 0o755);
  }
  private async findExecutable(root: string): Promise<string | null> {
    for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
      const p = path.join(root, entry.name);
      if (
        entry.isFile() &&
        entry.name ===
          (process.platform === "win32"
            ? "llama-mtmd-cli.exe"
            : "llama-mtmd-cli")
      )
        return p;
      if (entry.isDirectory()) {
        const found = await this.findExecutable(p);
        if (found) return found;
      }
    }
    return null;
  }
  async runtimeExecutable() {
    if (!this.list().some((m) => m.id === "llama-runtime" && m.verified))
      throw new Error("Instala el motor de visión local en Ajustes.");
    const executable = await this.findExecutable(
      path.join(this.directory("llama-runtime"), "bin"),
    );
    if (!executable)
      throw new Error("Motor de visión ausente. Verifica su integridad.");
    return executable;
  }
}

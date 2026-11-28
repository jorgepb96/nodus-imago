// The image workshop, on the service side: previews and saved versions of a
// source image. Versions live with the restorations (one table for every
// derived image of a record); a version made here records its operations,
// its parent version and the SHA-256 of its file and of the original, which
// is only ever read.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { createHash, randomUUID as uuid } from "node:crypto";
import type { Repository } from "../db/repository";
import { assetView } from "../../shared/imageRotation";
import { opLabel, versionLabel, type ImageVersion, type VersionOp, type WorkshopAnalysis, type WorkshopOp } from "../../shared/workshop";
import type { RenderJob, RenderSource } from "./renderWorker";

type Row = {
  id: string;
  asset_id: string;
  base_id: string | null;
  provider: string;
  model: string;
  task: string;
  params_json: string | null;
  operations_json: string | null;
  file: string;
  width: number;
  height: number;
  created_at: string;
  sha256: string | null;
};
export const sha256File = async (file: string) => {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};

/** A version's own operations: recorded ones, or what its row says (AI versions made before the workshop). */
export function ownOps(row: Pick<Row, "task" | "provider" | "model" | "params_json" | "operations_json">): VersionOp[] {
  if (row.operations_json) {
    try {
      return JSON.parse(row.operations_json) as VersionOp[];
    } catch {
      /* falls through */
    }
  }
  if (row.task === "workshop") return [];
  const params = row.params_json ? JSON.parse(row.params_json) : null;
  return [
    {
      tool: "ai",
      kind: row.task as Extract<VersionOp, { tool: "ai" }>["kind"],
      provider: row.provider,
      model: row.model,
      scale: params?.scale,
      remote: row.provider !== "local",
    },
  ];
}

export class Workshop {
  private worker: Worker | null = null;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private next = 0;
  private idle: ReturnType<typeof setTimeout> | undefined;
  constructor(
    public repo: Repository,
    public workerFile: string,
  ) {}
  private get staging() {
    return path.join(this.repo.root, "staging", "workshop");
  }

  private run(job: RenderJob): Promise<any> {
    clearTimeout(this.idle);
    if (!this.worker) {
      const worker = new Worker(this.workerFile);
      this.worker = worker;
      worker.on("message", (m: { id: number; ok: boolean; result?: unknown; error?: string }) => {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.ok) p?.resolve(m.result);
        else p?.reject(new Error(m.error));
      });
      const fail = (error: Error) => {
        if (this.worker !== worker) return;
        this.worker = null;
        for (const p of this.pending.values()) p.reject(error);
        this.pending.clear();
      };
      worker.on("error", fail);
      worker.on("exit", () => fail(new Error("El procesador de imágenes se ha detenido.")));
    }
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, job });
    }).finally(() => {
      // The decoded image takes memory: let it go after a while without work.
      if (this.worker && !this.pending.size) this.idle = setTimeout(() => this.close(), 180_000);
    });
  }
  close() {
    clearTimeout(this.idle);
    const w = this.worker;
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error("El procesador de imágenes se ha detenido."));
    this.pending.clear();
    void w?.terminate();
  }

  /** What a session starts from: the original as shown, or a saved version. */
  private source(assetId: string, versionId: string | null): RenderSource {
    if (versionId) {
      const row = this.repo.db.prepare("SELECT file,asset_id FROM restorations WHERE id=?").get(versionId) as { file: string; asset_id: string } | undefined;
      if (!row || row.asset_id !== assetId) throw new Error("Versión no encontrada.");
      return { kind: "file", path: row.file };
    }
    const asset = this.repo.asset(assetId) as { original_path: string; metadata_json: string };
    return { kind: "asset", path: asset.original_path, view: assetView(asset.metadata_json) };
  }

  /** A preview of the operations, written for the interface to show (imago://workshop/<name>). */
  async preview(input: { session: string; assetId: string; versionId: string | null; ops: WorkshopOp[]; maxSide?: number }) {
    await fsp.mkdir(this.staging, { recursive: true });
    const session = input.session.replace(/[^a-z0-9-]/gi, "").slice(0, 64) || "s";
    const name = `${session}-${Date.now().toString(36)}.png`;
    // The session's earlier previews are no longer shown.
    for (const f of await fsp.readdir(this.staging).catch(() => [] as string[]))
      if (f.startsWith(session + "-") && f !== name) await fsp.rm(path.join(this.staging, f), { force: true }).catch(() => {});
    const result = await this.run({ source: this.source(input.assetId, input.versionId), ops: input.ops, maxSide: input.maxSide ?? 1800, output: path.join(this.staging, name) });
    return { name, ...result } as { name: string; width: number; height: number; histogram: number[]; low: number; high: number; mean: number; ms: number };
  }
  file(name: string) {
    if (!/^[a-z0-9-]{1,80}\.png$/i.test(name)) throw new Error("Vista previa no válida.");
    return path.join(this.staging, name);
  }
  async analyze(assetId: string, versionId: string | null): Promise<WorkshopAnalysis> {
    return this.run({ source: this.source(assetId, versionId), ops: [], maxSide: null, analyze: true });
  }

  /** Renders at full size and saves a new version of the image, sealed with SHA-256. */
  async save(input: { assetId: string; versionId: string | null; ops: WorkshopOp[] }): Promise<ImageVersion> {
    if (!input.ops.length) throw new Error("No hay cambios que guardar.");
    const asset = this.repo.asset(input.assetId) as { row_id: string; original_path: string; content_hash: string };
    const before = await this.integrity(input.assetId);
    const id = uuid(),
      folder = path.join(this.repo.root, "restorations"),
      file = path.join(folder, id + ".png");
    await fsp.mkdir(folder, { recursive: true });
    const result = await this.run({ source: this.source(input.assetId, input.versionId), ops: input.ops, maxSide: null, output: file });
    const after = await this.integrity(input.assetId);
    if (before.ok && !after.ok) {
      await fsp.rm(file, { force: true });
      throw new Error("El archivo original ha cambiado durante el proceso: no se ha guardado nada.");
    }
    const hash = await sha256File(file);
    this.repo.db
      .prepare(
        "INSERT INTO restorations(id,asset_id,row_id,provider,model,task,prompt,region_json,file,width,height,created_at,base_id,params_json,operations_json,sha256,source_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        input.assetId,
        asset.row_id,
        "local",
        "taller",
        "workshop",
        input.ops.map((o) => opLabel(o)).join(" → "),
        null,
        file,
        result.width,
        result.height,
        new Date().toISOString(),
        input.versionId,
        null,
        JSON.stringify(input.ops),
        hash,
        asset.content_hash,
      );
    return this.versions(input.assetId).find((v) => v.id === id)!;
  }

  /** Every version of an image, oldest first, each with its whole history since the original. */
  versions(assetId: string): ImageVersion[] {
    const rows = this.repo.db
      .prepare(
        "SELECT id,asset_id,base_id,provider,model,task,params_json,operations_json,file,width,height,created_at,sha256 FROM restorations WHERE asset_id=? ORDER BY created_at",
      )
      .all(assetId) as Row[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const chain = (r: Row): VersionOp[] => {
      const seen = new Set<string>();
      const parts: VersionOp[][] = [];
      for (let cur: Row | undefined = r; cur && !seen.has(cur.id); cur = cur.base_id ? byId.get(cur.base_id) : undefined) {
        seen.add(cur.id);
        parts.unshift(ownOps(cur));
      }
      return parts.flat();
    };
    return rows.map((r) => {
      const ops = chain(r);
      return {
        id: r.id,
        assetId: r.asset_id,
        parentId: r.base_id,
        label: versionLabel(ops),
        ops,
        own: ownOps(r),
        width: r.width,
        height: r.height,
        createdAt: r.created_at,
        sha256: r.sha256,
        ai: ops.some((o) => o.tool === "ai"),
      };
    });
  }

  /** Whether the original file is still the one imported (its SHA-256 against the recorded one). */
  async integrity(assetId: string): Promise<{ ok: boolean; sha256: string | null }> {
    const asset = this.repo.asset(assetId) as { original_path: string; content_hash: string };
    try {
      const hash = await sha256File(asset.original_path);
      return { ok: hash === asset.content_hash, sha256: hash };
    } catch {
      return { ok: false, sha256: null };
    }
  }
}

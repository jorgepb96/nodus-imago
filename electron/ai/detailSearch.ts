// Searching for a detail (a region of an image) in the whole corpus.
// 1. The crop's vector is compared with the vector of every indexed image.
// 2. Optionally, the best candidates are cut into nine overlapping tiles and
//    each tile is compared too, which finds a detail that fills only part of
//    an image and says where it is. Tile vectors are kept for later searches.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Repository } from "../db/repository";
import type { Engine } from "./engine";
import { imagePipeline } from "../import/images";
import type { DetailMatch } from "../../shared/detailSearch";

type Box = { x: number; y: number; w: number; h: number };
/** Nine tiles of half the width and height, overlapping by half. */
export const TILES: Box[] = [0, 0.25, 0.5].flatMap((y) => [0, 0.25, 0.5].map((x) => ({ x, y, w: 0.5, h: 0.5 })));
const STAGE_ONE = 80,
  STAGE_TWO = 12;

const unit = (v: ArrayLike<number>) => {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
};
const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const fromBlob = (b: Buffer) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export class DetailSearch {
  constructor(
    private repo: Repository,
    private engine: Engine,
  ) {}

  /** A part of an image written as a JPEG the embedding model can read. */
  private async crop(originalPath: string, box: Box, folder: string): Promise<string> {
    const image = (await imagePipeline(originalPath)).rotate();
    const { data, info } = await image.png().toBuffer({ resolveWithObject: true });
    const left = Math.round(box.x * info.width),
      top = Math.round(box.y * info.height);
    const region = {
      left,
      top,
      width: Math.max(8, Math.min(info.width - left, Math.round(box.w * info.width))),
      height: Math.max(8, Math.min(info.height - top, Math.round(box.h * info.height))),
    };
    const file = path.join(folder, randomUUID() + ".jpg");
    await sharp(data).extract(region).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toFile(file);
    return file;
  }

  async search(input: { assetId: string; region: Box; databaseIds?: string[]; inside?: boolean }, signal?: AbortSignal): Promise<DetailMatch[]> {
    const contract = this.engine.contract();
    const source = this.repo.asset(input.assetId) as { original_path: string; content_hash: string };
    const folder = path.join(this.repo.root, "staging", "details");
    await fs.mkdir(folder, { recursive: true });
    const files: string[] = [];
    try {
      const queryFile = await this.crop(source.original_path, input.region, folder);
      files.push(queryFile);
      const query = unit((await this.engine.embed([{ image: queryFile }], signal))[0]);
      const marks = input.databaseIds?.length ? input.databaseIds.map(() => "?").join(",") : null;
      const candidates = this.repo.db
        .prepare(
          `SELECT a.id,a.row_id rowId,a.content_hash hash,a.original_path path,e.vector FROM image_assets a JOIN embeddings e ON e.content_hash=a.content_hash AND e.contract=?
           WHERE a.content_hash<>? ${marks ? `AND a.database_id IN (${marks})` : ""}`,
        )
        .all(contract, source.content_hash, ...(input.databaseIds ?? [])) as { id: string; rowId: string; hash: string; path: string; vector: Buffer }[];
      if (!candidates.length) throw new Error("Indexa las imágenes para la búsqueda semántica: la búsqueda de detalles usa sus vectores.");
      const scored = candidates
        .map((c) => ({ ...c, score: dot(query, unit(fromBlob(c.vector))), box: null as Box | null }))
        .sort((a, b) => b.score - a.score)
        .slice(0, STAGE_ONE);
      if (input.inside) {
        const tiles = this.repo.db.prepare("SELECT tile,vector FROM tile_embeddings WHERE content_hash=? AND contract=?");
        const save = this.repo.db.prepare("INSERT OR REPLACE INTO tile_embeddings VALUES(?,?,?,?)");
        for (const candidate of scored.slice(0, STAGE_TWO)) {
          signal?.throwIfAborted();
          const known = new Map((tiles.all(candidate.hash, contract) as { tile: number; vector: Buffer }[]).map((t) => [t.tile, fromBlob(t.vector)]));
          const missing = TILES.map((_, i) => i).filter((i) => !known.has(i));
          if (missing.length) {
            const cut: string[] = [];
            try {
              for (const i of missing) cut.push(await this.crop(candidate.path, TILES[i], folder));
            } catch {
              continue; // The original is not available: keep the whole-image score.
            }
            files.push(...cut);
            const vectors = await this.engine.embed(cut.map((image) => ({ image })), signal);
            missing.forEach((i, k) => {
              const v = unit(vectors[k]);
              known.set(i, v);
              save.run(candidate.hash, contract, i, Buffer.from(v.buffer));
            });
          }
          for (const [i, v] of known) {
            const score = dot(query, v);
            if (score > candidate.score) [candidate.score, candidate.box] = [score, TILES[i]];
          }
        }
        scored.sort((a, b) => b.score - a.score);
      }
      const top = scored.slice(0, 48);
      const rows = new Map(this.repo.hydrate([...new Set(top.map((t) => t.rowId))]).map((r) => [r.id, r]));
      return top.flatMap((t) => {
        const row = rows.get(t.rowId);
        const image = row?.images.find((i) => i.id === t.id);
        return row && image
          ? [{ assetId: t.id, rowId: t.rowId, title: row.title, databaseName: row.databaseName, revision: image.revision, score: Math.round(t.score * 1000) / 1000, box: t.box }]
          : [];
      });
    } finally {
      await Promise.all(files.map((f) => fs.rm(f, { force: true })));
    }
  }
}

// Variants of one image across records: the same photograph in two archives,
// a reproduction in a magazine, a crop, a retouched print. Two signals:
//  - a perceptual fingerprint (dHash, 64 bits) per file: copies and scans of
//    the same image differ in a few bits;
//  - the image vectors of semantic search, when indexed: crops and retouched
//    versions keep a high cosine similarity. So do different photographs of
//    the same kind (studio portraits), so these candidates are confirmed on a
//    tiny greyscale copy of each image (cropMatch).
// Families group images that match either signal, in date order, so the
// first dated appearance and later reuses can be read as a circulation.
import fs from "node:fs/promises";
import path from "node:path";
import type { Repository } from "./repository";
import type { CompareBoards } from "./compare";
import type { CompareItem } from "../../shared/compare";
import type { Sensitivity, VariantFamily, VariantMember, VariantStatus } from "../../shared/variants";
import { SENSITIVITY } from "../../shared/variants";
import { imagePipeline } from "../import/images";
import { cropMatch, MINIATURE, SAME_PHOTOGRAPH, type Miniature } from "./cropMatch";

/** Fingerprint length in hex characters: 128 bits. Older 64-bit ones are recalculated. */
export const FINGERPRINT_HEX = 32;
/** Number of differing bits between two fingerprints written in hex. */
export function hamming(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < a.length; i += 8) {
    let x = (parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0;
    while (x) {
      x &= x - 1;
      distance++;
    }
  }
  return distance;
}
/** dHash of a 9×8 greyscale image: each bit says whether a pixel is brighter than its right neighbour. */
export function dHash(pixels: Uint8Array | Buffer): string {
  let hex = "";
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) byte = (byte << 1) | (pixels[row * 9 + col] > pixels[row * 9 + col + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
/** 128 bits: horizontal gradients of a 9×8 grid and vertical gradients of an 8×9 grid. */
export function dHash128(horizontal: Uint8Array | Buffer, vertical: Uint8Array | Buffer): string {
  let hex = dHash(horizontal);
  for (let col = 0; col < 8; col++) {
    let byte = 0;
    for (let row = 0; row < 8; row++) byte = (byte << 1) | (vertical[row * 8 + col] > vertical[(row + 1) * 8 + col] ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
/** A fingerprint with almost no edges (a blank or nearly uniform image) says nothing. */
export function informative(hex: string): boolean {
  const bits = hamming(hex, "0".repeat(hex.length));
  return bits >= hex.length / 2 && bits <= hex.length * 3.5;
}

type Asset = { id: string; row_id: string; content_hash: string; database_id: string };

export class Variants {
  /** Pixel checks already made, by pair of files (they never change). */
  private checked = new Map<string, boolean>();
  constructor(
    private repo: Repository,
    private boards: CompareBoards,
    /** The current image-embedding contract, or null when there is none. */
    private contract: () => string | null,
  ) {}

  private assets(databaseIds?: string[]): Asset[] {
    const marks = databaseIds?.length ? databaseIds.map(() => "?").join(",") : null;
    return this.repo.db
      .prepare(`SELECT id,row_id,content_hash,database_id FROM image_assets WHERE width>0 ${marks ? `AND database_id IN (${marks})` : ""}`)
      .all(...(databaseIds ?? [])) as Asset[];
  }
  private fingerprints(): Map<string, string> {
    return new Map(
      (this.repo.db.prepare("SELECT content_hash,hash dhash FROM image_fingerprints WHERE length(hash)=?").all(FINGERPRINT_HEX) as {
        content_hash: string;
        dhash: string;
      }[]).map((r) => [r.content_hash, r.dhash]),
    );
  }
  private vectors(hashes: Set<string>): Map<string, Float32Array> {
    const contract = this.contract();
    const out = new Map<string, Float32Array>();
    if (!contract) return out;
    for (const r of this.repo.db.prepare("SELECT content_hash,vector FROM embeddings WHERE contract=?").all(contract) as {
      content_hash: string;
      vector: Buffer;
    }[])
      if (hashes.has(r.content_hash)) out.set(r.content_hash, new Float32Array(r.vector.buffer.slice(r.vector.byteOffset, r.vector.byteOffset + r.vector.byteLength)));
    return out;
  }

  private miniatures(): Map<string, Miniature> {
    return new Map(
      (this.repo.db.prepare("SELECT content_hash,width,height,pixels FROM image_miniatures").all() as {
        content_hash: string;
        width: number;
        height: number;
        pixels: Buffer;
      }[]).map((r) => [r.content_hash, { width: r.width, height: r.height, pixels: new Uint8Array(r.pixels) }]),
    );
  }
  /** Files still without a fingerprint or a miniature. */
  private pending(hashes: string[]): string[] {
    const known = this.fingerprints(),
      small = new Set((this.repo.db.prepare("SELECT content_hash FROM image_miniatures").all() as { content_hash: string }[]).map((r) => r.content_hash));
    return hashes.filter((h) => !known.has(h) || !small.has(h));
  }

  status(databaseIds?: string[]): VariantStatus {
    const hashes = new Set(this.assets(databaseIds).map((a) => a.content_hash));
    const missing = this.pending([...hashes]).length;
    return { images: hashes.size, missing, vectors: this.vectors(hashes).size };
  }
  /** A background task that fingerprints the images that have none. */
  prepare(databaseIds?: string[]): string | null {
    const hashes = this.pending([...new Set(this.assets(databaseIds).map((a) => a.content_hash))]);
    if (!hashes.length) return null;
    return this.repo.newJob("fingerprints", { hashes }, hashes.length);
  }
  /** One step of that task. */
  async fingerprintOne(payload: { hashes: string[] }, index: number): Promise<"imported" | "skipped"> {
    const hash = payload.hashes[index];
    if (
      this.repo.db.prepare("SELECT 1 FROM image_fingerprints WHERE content_hash=? AND length(hash)=?").get(hash, FINGERPRINT_HEX) &&
      this.repo.db.prepare("SELECT 1 FROM image_miniatures WHERE content_hash=?").get(hash)
    )
      return "skipped";
    const asset = this.repo.db.prepare("SELECT original_path FROM image_assets WHERE content_hash=? AND width>0 LIMIT 1").get(hash) as
      | { original_path: string }
      | undefined;
    if (!asset) return "skipped";
    // The thumbnail is faster to read and gives the same fingerprint.
    const thumbnail = path.join(this.repo.root, "thumbnails", hash + ".webp");
    let source = asset.original_path;
    try {
      await fs.access(thumbnail);
      source = thumbnail;
    } catch {
      /* Read the original. */
    }
    const sharp = (await import("sharp")).default;
    const image = source === thumbnail ? sharp(thumbnail) : await imagePipeline(source);
    // Scans of pages carry wide uniform margins that make unrelated images
    // look alike: they are trimmed before the fingerprint.
    const grey = await image.rotate().greyscale().png().toBuffer();
    const trimmed = await sharp(grey)
      .trim({ threshold: 18 })
      .toBuffer()
      .catch(() => grey);
    // One channel: a grey PNG can still decode as three, and the fingerprint
    // compares neighbouring pixels, not the channels of one pixel.
    const h = await sharp(trimmed).resize(9, 8, { fit: "fill" }).extractChannel(0).raw().toBuffer();
    const v = await sharp(trimmed).resize(8, 9, { fit: "fill" }).extractChannel(0).raw().toBuffer();
    if (h.length !== 72 || v.length !== 72) throw new Error("No se pudo calcular la huella visual.");
    const { data, info } = await sharp(trimmed)
      .resize(MINIATURE, MINIATURE, { fit: "inside" })
      .extractChannel(0)
      .raw()
      .toBuffer({ resolveWithObject: true });
    this.repo.db.transaction(() => {
      this.repo.db.prepare("INSERT OR REPLACE INTO image_fingerprints VALUES(?,?)").run(hash, dHash128(h, v));
      this.repo.db.prepare("INSERT OR REPLACE INTO image_miniatures VALUES(?,?,?,?)").run(hash, info.width, info.height, data);
    })();
    return "imported";
  }

  /** Pairs of files that match, with how closely. */
  private async matches(hashes: string[], sensitivity: Sensitivity) {
    const limits = SENSITIVITY[sensitivity];
    const fingerprints = this.fingerprints();
    const pairs: { a: string; b: string; bits: number | null; cosine: number | null }[] = [];
    const known = hashes.filter((h) => fingerprints.has(h) && informative(fingerprints.get(h)!));
    // 128-bit comparisons are cheap: every pair.
    const words = known.map((h) => {
      const f = fingerprints.get(h)!;
      return [0, 8, 16, 24].map((i) => parseInt(f.slice(i, i + 8), 16) >>> 0);
    });
    const pop = (x: number) => {
      let n = 0;
      while (x) {
        x &= x - 1;
        n++;
      }
      return n;
    };
    for (let i = 0; i < known.length; i++)
      for (let j = i + 1; j < known.length; j++) {
        const a = words[i],
          b = words[j];
        const bits =
          pop((a[0] ^ b[0]) >>> 0) + pop((a[1] ^ b[1]) >>> 0) + pop((a[2] ^ b[2]) >>> 0) + pop((a[3] ^ b[3]) >>> 0);
        if (bits <= limits.bits) pairs.push({ a: known[i], b: known[j], bits, cosine: null });
      }
    // Vectors: random hyperplanes put similar vectors in the same bucket, so
    // only those pairs are compared (thousands instead of millions).
    if (limits.cosine !== null) {
      const vectors = this.vectors(new Set(hashes));
      const miniatures = this.miniatures();
      // A vector candidate counts only when the pixels confirm it.
      // Checks are kept in the collection: two files never change, so each
      // pair is checked once.
      const stored = this.repo.db.prepare("SELECT same FROM image_pair_checks WHERE pair=?");
      const store = this.repo.db.prepare("INSERT OR REPLACE INTO image_pair_checks VALUES(?,?)");
      let work = 0;
      const confirmed = async (a: string, b: string) => {
        const key = a < b ? a + b : b + a;
        let ok = this.checked.get(key);
        if (ok === undefined) {
          const row = stored.get(key) as { same: number } | undefined;
          if (row) ok = !!row.same;
          else {
            const ma = miniatures.get(a),
              mb = miniatures.get(b);
            if (!ma || !mb) return false;
            ok = cropMatch(ma, mb) >= SAME_PHOTOGRAPH;
            store.run(key, ok ? 1 : 0);
            // Long first runs give way to other requests now and then.
            if (++work % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
          }
          this.checked.set(key, ok);
        }
        return ok;
      };
      const list = [...vectors];
      if (list.length > 1) {
        const dims = list[0][1].length;
        let seed = 7;
        const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
        const seen = new Set<string>();
        for (let table = 0; table < 10; table++) {
          const planes = Array.from({ length: 10 }, () => Float32Array.from({ length: dims }, random));
          const buckets = new Map<number, number[]>();
          list.forEach(([, v], index) => {
            let key = 0;
            for (const plane of planes) {
              let dot = 0;
              for (let d = 0; d < dims; d++) dot += plane[d] * v[d];
              key = (key << 1) | (dot > 0 ? 1 : 0);
            }
            (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(index);
          });
          for (const members of buckets.values())
            for (let i = 0; i < members.length; i++)
              for (let j = i + 1; j < members.length; j++) {
                const [ha, va] = list[members[i]],
                  [hb, vb] = list[members[j]];
                const key = ha < hb ? ha + hb : hb + ha;
                if (seen.has(key)) continue;
                seen.add(key);
                let dot = 0;
                for (let d = 0; d < dims; d++) dot += va[d] * vb[d];
                if (dot >= limits.cosine && (await confirmed(ha, hb))) pairs.push({ a: ha, b: hb, bits: null, cosine: dot });
              }
        }
      }
    }
    return pairs;
  }

  async families(input: { databaseIds?: string[]; sensitivity: Sensitivity }): Promise<VariantFamily[]> {
    const assets = this.assets(input.databaseIds);
    const byHash = new Map<string, Asset[]>();
    for (const a of assets) (byHash.get(a.content_hash) ?? byHash.set(a.content_hash, []).get(a.content_hash)!).push(a);
    type Close = { bits: number | null; cosine: number | null };
    const adjacency = new Map<string, Map<string, Close>>();
    const link = (a: string, b: string, close: Close) => {
      const current = adjacency.get(a)?.get(b);
      if (current && (current.bits ?? 999) <= (close.bits ?? 999) && (current.cosine ?? -1) >= (close.cosine ?? -1)) return;
      (adjacency.get(a) ?? adjacency.set(a, new Map()).get(a)!).set(b, { bits: close.bits ?? current?.bits ?? null, cosine: close.cosine ?? current?.cosine ?? null });
    };
    for (const pair of await this.matches([...byHash.keys()], input.sensitivity)) {
      link(pair.a, pair.b, pair);
      link(pair.b, pair.a, pair);
    }
    // Star groups, never chains: each group is a central image and the images
    // that match it directly. A≈B and B≈C does not put A with C.
    const families: VariantFamily[] = [];
    const remaining = new Set(adjacency.keys());
    const degree = (h: string) => [...(adjacency.get(h)?.keys() ?? [])].filter((x) => remaining.has(x)).length;
    while (remaining.size) {
      let centre = "",
        best = -1;
      for (const h of remaining) {
        const d = degree(h);
        if (d > best) [centre, best] = [h, d];
      }
      if (best < 1) break;
      const members = [centre, ...[...adjacency.get(centre)!.keys()].filter((x) => remaining.has(x))];
      for (const m of members) remaining.delete(m);
      const closeness = new Map<string, Close>(members.slice(1).map((m) => [m, adjacency.get(centre)!.get(m)!]));
      // The centre is as close as its closest member.
      const nearest = [...closeness.values()].sort((a, b) => (a.bits ?? 999) - (b.bits ?? 999) || (b.cosine ?? 0) - (a.cosine ?? 0))[0];
      closeness.set(centre, nearest);
      const rows = members.flatMap((h) => byHash.get(h)!);
      if (new Set(rows.map((r) => r.row_id)).size >= 2) families.push(this.family(rows.slice(0, 40), closeness, byHash));
    }
    // The same file in several records is a family too.
    for (const [hash, rows] of byHash)
      if (!adjacency.has(hash) && new Set(rows.map((r) => r.row_id)).size >= 2) families.push(this.family(rows.slice(0, 40), new Map(), byHash));
    return families.sort((a, b) => b.members.length - a.members.length || (a.firstYear ?? 9999) - (b.firstYear ?? 9999));
  }

  /** Images that match one image, for the record panel. */
  async of(assetId: string, sensitivity: Sensitivity = "balanced"): Promise<VariantFamily | null> {
    const asset = this.repo.asset(assetId) as Asset;
    const family = (await this.families({ sensitivity })).find((f) => f.members.some((m) => m.contentHash === asset.content_hash));
    return family ?? null;
  }

  private family(
    members: Asset[],
    closeness: Map<string, { bits: number | null; cosine: number | null }>,
    byHash: Map<string, Asset[]>,
  ): VariantFamily {
    const items = new Map(this.boards.items(members.map((m) => m.id)).map((i) => [i.assetId, i]));
    const list: VariantMember[] = members.flatMap((m) => {
      const item = items.get(m.id) as CompareItem | undefined;
      if (!item) return [];
      const close = closeness.get(m.content_hash);
      // "identical" is the same file in another record; equal fingerprints of
      // different files are copies or reproductions.
      const match: VariantMember["match"] =
        byHash.get(m.content_hash)!.length > 1 ? "identical" : close?.bits != null ? "near" : "similar";
      return [{ ...item, contentHash: m.content_hash, match }];
    });
    list.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title, "es", { numeric: true }));
    const years = list.map((m) => m.year).filter((y): y is number => y !== null);
    return {
      id: list[0]?.contentHash ?? "",
      members: list,
      firstYear: years.length ? Math.min(...years) : null,
      lastYear: years.length ? Math.max(...years) : null,
      databases: [...new Set(list.map((m) => m.databaseName))],
    };
  }
}

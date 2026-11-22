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
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Repository } from "./repository";
import type { CompareBoards } from "./compare";
import type { CompareItem } from "../../shared/compare";
import type {
  ImageVariantMember,
  ImageVariants,
  Sensitivity,
  VariantFamily,
  VariantKind,
  VariantMember,
  VariantStatus,
  VariantVerdict,
} from "../../shared/variants";
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
type Close = { bits: number | null; cosine: number | null };
type Pair = { a: string; b: string; bits: number | null; cosine: number | null };
/** The key of a pair of files, whichever comes first. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class Variants {
  /** Pixel checks already made, by pair of files (they never change). */
  private checked = new Map<string, boolean>();
  /**
   * Pairs already found, by files, sensitivity and the state of their inputs
   * (fingerprints, miniatures, vectors): coming back to the view, or a refresh
   * of the interface, does not compare thousands of images again.
   */
  private pairCache = new Map<string, Pair[]>();
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

  /** Whether two files are the same photograph by their pixels; each pair is
   * checked once and kept in the collection (two files never change). */
  private pixelsMatch(a: string, b: string): boolean {
    const key = a < b ? a + b : b + a;
    let ok = this.checked.get(key);
    if (ok !== undefined) return ok;
    const row = this.repo.db.prepare("SELECT same FROM image_pair_checks WHERE pair=?").get(key) as { same: number } | undefined;
    if (row) ok = !!row.same;
    else {
      const one = this.repo.db.prepare("SELECT width,height,pixels FROM image_miniatures WHERE content_hash=?");
      const ra = one.get(a) as { width: number; height: number; pixels: Buffer } | undefined,
        rb = one.get(b) as { width: number; height: number; pixels: Buffer } | undefined;
      if (!ra || !rb) return false;
      const mini = (r: { width: number; height: number; pixels: Buffer }) => ({ width: r.width, height: r.height, pixels: new Uint8Array(r.pixels) });
      ok = cropMatch(mini(ra), mini(rb)) >= SAME_PHOTOGRAPH;
      this.repo.db.prepare("INSERT OR REPLACE INTO image_pair_checks VALUES(?,?)").run(key, ok ? 1 : 0);
    }
    this.checked.set(key, ok);
    return ok;
  }

  /** The files that match ONE file, with how closely: its fingerprint and its
   * vector against every other one. Opening a record needs only this, not the
   * pairs of the whole collection (which took seconds on thousands of images). */
  private async matchesOf(home: string, hashes: string[], sensitivity: Sensitivity) {
    const limits = SENSITIVITY[sensitivity];
    const pairs: { a: string; b: string; bits: number | null; cosine: number | null }[] = [];
    const fingerprints = this.fingerprints(),
      mine = fingerprints.get(home);
    const found = new Set<string>();
    if (mine && informative(mine))
      for (const h of hashes) {
        const f = fingerprints.get(h);
        if (h === home || !f || !informative(f)) continue;
        const bits = hamming(mine, f);
        if (bits <= limits.bits) {
          pairs.push({ a: home, b: h, bits, cosine: null });
          found.add(h);
        }
      }
    if (limits.cosine !== null) {
      const vectors = this.vectors(new Set(hashes)),
        v = vectors.get(home);
      if (v) {
        let work = 0;
        for (const [h, w] of vectors) {
          if (h === home || found.has(h)) continue;
          let dot = 0;
          for (let d = 0; d < v.length; d++) dot += v[d] * w[d];
          if (dot < limits.cosine) continue;
          if (this.pixelsMatch(home, h)) pairs.push({ a: home, b: h, bits: null, cosine: dot });
          // Long first checks give way to other requests now and then.
          if (++work % 20 === 0) await new Promise((resolve) => setImmediate(resolve));
        }
      }
    }
    return pairs;
  }

  /** What the pairs depend on besides the files: changes when any input is added or replaced. */
  private inputsSignature(contract: string | null) {
    const part = (table: string, where = "") =>
      Object.values(this.repo.db.prepare(`SELECT count(*) n,ifnull(max(rowid),0) m FROM ${table} ${where}`).get(...(where ? [contract] : [])) as object).join(":");
    return [part("image_fingerprints"), part("image_miniatures"), contract ? part("embeddings", "WHERE contract=?") : "-"].join("|");
  }

  /** Pairs of files that match, with how closely (kept while their inputs do not change). */
  private async matches(hashes: string[], sensitivity: Sensitivity): Promise<Pair[]> {
    const contract = this.contract();
    const key = [
      sensitivity,
      contract ?? "",
      this.inputsSignature(contract),
      createHash("sha1").update(hashes.join(",")).digest("hex"),
    ].join("#");
    const cached = this.pairCache.get(key);
    if (cached) return cached;
    const pairs = await this.findMatches(hashes, sensitivity);
    this.pairCache.delete(key);
    this.pairCache.set(key, pairs);
    if (this.pairCache.size > 6) this.pairCache.delete(this.pairCache.keys().next().value!);
    return pairs;
  }

  private async findMatches(hashes: string[], sensitivity: Sensitivity): Promise<Pair[]> {
    const limits = SENSITIVITY[sensitivity];
    const fingerprints = this.fingerprints();
    const pairs: Pair[] = [];
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
        // A candidate is confirmed on the miniatures of both files, or by a
        // check already made; any other pair can never count, so its vectors
        // are not compared. Every vector is still hashed, so the buckets (and
        // the order of the pairs) stay those of the whole list.
        const proven = new Set<string>();
        const prove = (pair: string) => {
          const half = pair.length / 2;
          proven.add(pair.slice(0, half)).add(pair.slice(half));
        };
        for (const [pair, ok] of this.checked) if (ok) prove(pair);
        for (const { pair } of this.repo.db.prepare("SELECT pair FROM image_pair_checks WHERE same=1").all() as { pair: string }[])
          prove(pair);
        const small = Uint8Array.from(list, ([h]) => (miniatures.has(h) ? 1 : 0)),
          known = Uint8Array.from(list, ([h]) => (proven.has(h) ? 1 : 0));
        const dims = list[0][1].length,
          keys: Int32Array[] = [];
        let seed = 7,
          compared = 0;
        const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
        for (let table = 0; table < 10; table++) {
          const planes = Array.from({ length: 10 }, () => Float32Array.from({ length: dims }, random));
          const buckets = new Map<number, number[]>(),
            tableKeys = new Int32Array(list.length);
          list.forEach(([, v], index) => {
            let key = 0;
            for (const plane of planes) {
              let dot = 0;
              for (let d = 0; d < dims; d++) dot += plane[d] * v[d];
              key = (key << 1) | (dot > 0 ? 1 : 0);
            }
            tableKeys[index] = key;
            (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(index);
          });
          for (const members of buckets.values())
            for (let i = 0; i < members.length; i++)
              for (let j = i + 1; j < members.length; j++) {
                const x = members[i],
                  y = members[j];
                if (!((small[x] && small[y]) || (known[x] && known[y]))) continue;
                // Compared already: the two shared a bucket in an earlier table.
                let seen = false;
                for (let t = 0; t < table && !seen; t++) seen = keys[t][x] === keys[t][y];
                if (seen) continue;
                const [ha, va] = list[x],
                  [hb, vb] = list[y];
                let dot = 0;
                for (let d = 0; d < dims; d++) dot += va[d] * vb[d];
                if (dot >= limits.cosine && (await confirmed(ha, hb))) pairs.push({ a: ha, b: hb, bits: null, cosine: dot });
                // Long runs give way to other requests now and then.
                if (++compared % 100000 === 0) await new Promise((resolve) => setImmediate(resolve));
              }
          keys.push(tableKeys);
        }
      }
    }
    return pairs;
  }

  async families(input: { databaseIds?: string[]; sensitivity: Sensitivity; rowIds?: string[] }): Promise<VariantFamily[]> {
    const keep = input.rowIds ? new Set(input.rowIds) : null;
    const assets = this.assets(input.databaseIds).filter((a) => !keep || keep.has(a.row_id));
    const byHash = new Map<string, Asset[]>();
    for (const a of assets) (byHash.get(a.content_hash) ?? byHash.set(a.content_hash, []).get(a.content_hash)!).push(a);
    type Close = { bits: number | null; cosine: number | null };
    const adjacency = new Map<string, Map<string, Close>>();
    const link = (a: string, b: string, close: Close) => {
      const current = adjacency.get(a)?.get(b);
      if (current && (current.bits ?? 999) <= (close.bits ?? 999) && (current.cosine ?? -1) >= (close.cosine ?? -1)) return;
      (adjacency.get(a) ?? adjacency.set(a, new Map()).get(a)!).set(b, { bits: close.bits ?? current?.bits ?? null, cosine: close.cosine ?? current?.cosine ?? null });
    };
    // The researcher's verdicts win: a rejected pair is no link, a confirmed
    // one is, whatever detection found.
    const verdicts = this.verdicts();
    for (const pair of await this.matches([...byHash.keys()], input.sensitivity)) {
      if (verdicts.get(pairKey(pair.a, pair.b))?.verdict === "different") continue;
      link(pair.a, pair.b, pair);
      link(pair.b, pair.a, pair);
    }
    for (const v of verdicts.values())
      if (v.verdict === "same" && byHash.has(v.a) && byHash.has(v.b)) {
        link(v.a, v.b, { bits: null, cosine: null });
        link(v.b, v.a, { bits: null, cosine: null });
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

  /** Every verdict, by pair of files. */
  private verdicts() {
    return new Map(
      (
        this.repo.db.prepare("SELECT pair,a,b,verdict,kind FROM variant_verdicts").all() as {
          pair: string;
          a: string;
          b: string;
          verdict: VariantVerdict;
          kind: VariantKind | null;
        }[]
      ).map((v) => [v.pair, v]),
    );
  }

  /** Records (or clears, with null) what the researcher decided about two images. */
  setVerdict(assetId: string, otherAssetId: string, verdict: VariantVerdict | null, kind: VariantKind | null = null) {
    const a = (this.repo.asset(assetId) as Asset).content_hash,
      b = (this.repo.asset(otherAssetId) as Asset).content_hash;
    if (a === b) throw new Error("Las dos imágenes son el mismo archivo.");
    const key = pairKey(a, b);
    if (!verdict) {
      this.repo.db.prepare("DELETE FROM variant_verdicts WHERE pair=?").run(key);
      return;
    }
    const at = new Date().toISOString(),
      [first, second] = a < b ? [a, b] : [b, a];
    this.repo.db
      .prepare(
        "INSERT INTO variant_verdicts VALUES(?,?,?,?,?,?,?) ON CONFLICT(pair) DO UPDATE SET verdict=excluded.verdict,kind=excluded.kind,updated_at=excluded.updated_at",
      )
      .run(key, first, second, verdict, verdict === "same" ? kind : null, at, at);
  }

  /**
   * The versions of one image, for its record: the images detection matches
   * with it directly (less those rejected), the same file in other records,
   * and everything linked to them by confirmed verdicts (which chain).
   */
  async ofImage(assetId: string, sensitivity: Sensitivity = "balanced"): Promise<ImageVariants> {
    const anchor = this.repo.asset(assetId) as Asset,
      home = anchor.content_hash;
    const assets = this.assets();
    const byHash = new Map<string, Asset[]>();
    for (const a of assets) (byHash.get(a.content_hash) ?? byHash.set(a.content_hash, []).get(a.content_hash)!).push(a);
    const verdicts = this.verdicts(),
      verdictOf = (x: string, y: string) => verdicts.get(pairKey(x, y)) ?? null;
    const near = new Map<string, Close>();
    for (const pair of await this.matchesOf(home, [...byHash.keys()], sensitivity)) near.set(pair.b, pair);
    const rejected = new Set([...near.keys()].filter((h) => verdictOf(home, h)?.verdict === "different"));
    // Confirmed links chain: everything reachable through "same" verdicts.
    const sameOf = new Map<string, string[]>();
    for (const v of verdicts.values())
      if (v.verdict === "same") {
        (sameOf.get(v.a) ?? sameOf.set(v.a, []).get(v.a)!).push(v.b);
        (sameOf.get(v.b) ?? sameOf.set(v.b, []).get(v.b)!).push(v.a);
      }
    const confirmed = new Set<string>(),
      queue = [home, ...[...near.keys()].filter((h) => !rejected.has(h))];
    while (queue.length) {
      const h = queue.shift()!;
      for (const next of sameOf.get(h) ?? [])
        if (next !== home && !confirmed.has(next)) {
          confirmed.add(next);
          queue.push(next);
        }
    }
    for (const h of [...rejected]) if (confirmed.has(h)) rejected.delete(h);
    const kept = new Set([...[...near.keys()].filter((h) => !rejected.has(h)), ...confirmed, home]);
    const pick = (hashes: Iterable<string>) =>
      [...hashes].flatMap((h) => (byHash.get(h) ?? []).filter((a) => a.id !== anchor.id && a.row_id !== anchor.row_id)).slice(0, 200);
    const describe = (list: Asset[]): ImageVariantMember[] => {
      const items = new Map(this.boards.items(list.map((a) => a.id)).map((i) => [i.assetId, i]));
      const out = list.flatMap((a): ImageVariantMember[] => {
        const item = items.get(a.id) as CompareItem | undefined;
        if (!item) return [];
        const close = near.get(a.content_hash),
          verdict = verdictOf(home, a.content_hash);
        const match: VariantMember["match"] =
          a.content_hash === home ? "identical" : close?.bits != null ? "near" : close ? "similar" : "confirmed";
        return [
          {
            ...item,
            contentHash: a.content_hash,
            match,
            origin: a.content_hash === home || close ? "auto" : "confirmed",
            verdict: verdict?.verdict ?? (confirmed.has(a.content_hash) && !close ? "same" : null),
            kind: verdict?.verdict === "same" ? verdict.kind : null,
          },
        ];
      });
      return out.sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999) || x.title.localeCompare(y.title, "es", { numeric: true }));
    };
    return { assetId, contentHash: home, members: describe(pick(kept)), rejected: describe(pick(rejected)) };
  }

  /** One image as a comparison item (record, date, year), or null. */
  describeOne(assetId: string): CompareItem | null {
    return this.boards.items([assetId])[0] ?? null;
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

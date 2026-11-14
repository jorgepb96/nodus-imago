// Places image vectors on a plane so that similar images lie close together
// (the method of UMAP: a graph of nearest neighbours, then a layout that keeps
// neighbours near and pushes other points away). Written here, without a
// dependency, so it is deterministic and can yield to other work: the local
// service answers other requests while a large collection is projected.

export type ProjectionOptions = {
  /** Neighbours per point in the graph. */
  neighbours?: number;
  /** Passes of the layout. */
  epochs?: number;
  seed?: number;
  /** Called now and then so long work can give way to other requests. */
  pause?: () => Promise<void>;
};

/** A deterministic random number generator (mulberry32). */
export function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idle = async () => {};

/**
 * Principal components (subspace iteration): the vectors reduced to `m`
 * dimensions, centred, keeping most of their variation. Rows are normalised
 * so that their dot product is their cosine similarity.
 */
export async function reduce(vectors: Float32Array[], m: number, seed = 7, pause = idle, iterations = 2): Promise<Float32Array[]> {
  const n = vectors.length,
    d = vectors[0]?.length ?? 0;
  m = Math.max(1, Math.min(m, d, n));
  const mean = new Float64Array(d);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j] / n;
  const centred = vectors.map((v) => Float32Array.from(v, (x, j) => x - mean[j]));
  const rand = random(seed);
  // Q: d × m, column-major in one array.
  let q: Float64Array = new Float64Array(d * m).map(() => rand() - 0.5);
  const orthonormalise = (a: Float64Array): Float64Array => {
    for (let c = 0; c < m; c++) {
      for (let p = 0; p < c; p++) {
        let dot = 0;
        for (let j = 0; j < d; j++) dot += a[c * d + j] * a[p * d + j];
        for (let j = 0; j < d; j++) a[c * d + j] -= dot * a[p * d + j];
      }
      let norm = 0;
      for (let j = 0; j < d; j++) norm += a[c * d + j] ** 2;
      norm = Math.sqrt(norm) || 1;
      for (let j = 0; j < d; j++) a[c * d + j] /= norm;
    }
    return a;
  };
  q = orthonormalise(q);
  const project = (out: Float64Array[]) => {
    for (let i = 0; i < n; i++) {
      const v = centred[i],
        row = out[i];
      for (let c = 0; c < m; c++) {
        let s = 0;
        const base = c * d;
        for (let j = 0; j < d; j++) s += v[j] * q[base + j];
        row[c] = s;
      }
    }
  };
  const scores = Array.from({ length: n }, () => new Float64Array(m));
  for (let iteration = 0; iteration < iterations; iteration++) {
    project(scores);
    await pause();
    // Q ← Xᵀ (X Q), then orthonormalise.
    const next = new Float64Array(d * m);
    for (let i = 0; i < n; i++) {
      const v = centred[i],
        s = scores[i];
      for (let c = 0; c < m; c++) {
        const w = s[c],
          base = c * d;
        if (w) for (let j = 0; j < d; j++) next[base + j] += v[j] * w;
      }
    }
    q = orthonormalise(next);
    await pause();
  }
  project(scores);
  return scores.map((s) => {
    let norm = 0;
    for (let c = 0; c < m; c++) norm += s[c] * s[c];
    norm = Math.sqrt(norm) || 1;
    return Float32Array.from(s, (x) => x / norm);
  });
}

/** The k nearest neighbours of every row (largest cosine), and their distances (1 − cosine). */
export async function nearest(rows: Float32Array[], k: number, pause = idle) {
  const n = rows.length,
    m = rows[0]?.length ?? 0;
  k = Math.min(k, n - 1);
  const index = new Int32Array(n * k).fill(-1),
    distance = new Float32Array(n * k).fill(Infinity);
  const offer = (i: number, j: number, d: number) => {
    const base = i * k;
    if (d >= distance[base + k - 1]) return;
    let p = k - 1;
    while (p > 0 && distance[base + p - 1] > d) {
      distance[base + p] = distance[base + p - 1];
      index[base + p] = index[base + p - 1];
      p--;
    }
    distance[base + p] = d;
    index[base + p] = j;
  };
  // Each pair once: the similarity of i and j serves both lists.
  for (let i = 0; i < n; i++) {
    const a = rows[i];
    for (let j = i + 1; j < n; j++) {
      const b = rows[j];
      let s = 0;
      for (let c = 0; c < m; c++) s += a[c] * b[c];
      const d = 1 - s;
      offer(i, j, d);
      offer(j, i, d);
    }
    if (i % 200 === 199) await pause();
  }
  return { index, distance, k };
}

/** Membership strengths of the neighbour graph, made symmetric. */
export function graph(knn: { index: Int32Array; distance: Float32Array; k: number }, n: number) {
  const { index, distance, k } = knn;
  const weights = new Map<number, number>();
  const target = Math.log2(k);
  for (let i = 0; i < n; i++) {
    const base = i * k,
      rho = distance[base];
    let lo = 0,
      hi = Infinity,
      sigma = 1;
    for (let step = 0; step < 64; step++) {
      let sum = 0;
      for (let p = 0; p < k; p++) sum += Math.exp(-Math.max(0, distance[base + p] - rho) / sigma);
      if (Math.abs(sum - target) < 1e-5) break;
      if (sum > target) {
        hi = sigma;
        sigma = (lo + hi) / 2;
      } else {
        lo = sigma;
        sigma = hi === Infinity ? sigma * 2 : (lo + hi) / 2;
      }
    }
    sigma = Math.max(sigma, 1e-3);
    for (let p = 0; p < k; p++) {
      const j = index[base + p];
      if (j < 0) continue;
      const w = Math.exp(-Math.max(0, distance[base + p] - rho) / sigma);
      const key = i < j ? i * n + j : j * n + i,
        old = weights.get(key);
      // Fuzzy union: a + b − a·b.
      weights.set(key, old === undefined ? w : old + w - old * w);
    }
  }
  const heads: number[] = [],
    tails: number[] = [],
    values: number[] = [];
  for (const [key, w] of weights) {
    heads.push(Math.floor(key / n));
    tails.push(key % n);
    values.push(w);
  }
  return { heads: Int32Array.from(heads), tails: Int32Array.from(tails), weights: Float32Array.from(values) };
}

/**
 * Coordinates between 0 and 1 (x, y interleaved) for each vector.
 * Neighbours in the vector space end up close on the plane.
 */
export async function projectVectors(vectors: Float32Array[], options: ProjectionOptions = {}): Promise<Float32Array> {
  const n = vectors.length,
    pause = options.pause ?? idle,
    seed = options.seed ?? 42;
  if (n === 0) return new Float32Array(0);
  if (n < 4) return Float32Array.from({ length: n * 2 }, (_, i) => (i % 2 ? 0.5 : (Math.floor(i / 2) + 1) / (n + 1)));
  const reduced = await reduce(vectors, 32, seed, pause);
  const knn = await nearest(reduced, options.neighbours ?? 15, pause);
  const { heads, tails, weights } = graph(knn, n);
  // Start from the first two principal components, spread to about ±10.
  const pca = await reduce(reduced, 2, seed + 1, pause);
  const y = new Float32Array(n * 2);
  let spread = 1e-9;
  for (let i = 0; i < n; i++) spread = Math.max(spread, Math.abs(pca[i][0]), Math.abs(pca[i][1] ?? 0));
  const rand = random(seed + 2);
  for (let i = 0; i < n; i++) {
    y[i * 2] = (pca[i][0] / spread) * 10 + (rand() - 0.5) * 1e-3;
    y[i * 2 + 1] = ((pca[i][1] ?? 0) / spread) * 10 + (rand() - 0.5) * 1e-3;
  }
  // Layout (UMAP's optimisation with min_dist = 0.1: a = 1.577, b = 0.895).
  const a = 1.577,
    b = 0.895,
    negatives = 5,
    epochs = options.epochs ?? (n > 4000 ? 200 : 350);
  let max = 0;
  for (const w of weights) max = Math.max(max, w);
  const every = Float32Array.from(weights, (w) => (w > 0 ? max / w : Infinity));
  const next = Float32Array.from(every);
  const nextNegative = Float32Array.from(every, (e) => e / negatives);
  const clip = (g: number) => (g > 4 ? 4 : g < -4 ? -4 : g);
  for (let epoch = 1; epoch <= epochs; epoch++) {
    const alpha = 1 - (epoch - 1) / epochs;
    for (let e = 0; e < heads.length; e++) {
      if (next[e] > epoch) continue;
      const i = heads[e],
        j = tails[e];
      let dx = y[i * 2] - y[j * 2],
        dy = y[i * 2 + 1] - y[j * 2 + 1],
        d2 = dx * dx + dy * dy;
      if (d2 > 0) {
        const coefficient = (-2 * a * b * Math.pow(d2, b - 1)) / (a * Math.pow(d2, b) + 1);
        const gx = clip(coefficient * dx),
          gy = clip(coefficient * dy);
        y[i * 2] += gx * alpha;
        y[i * 2 + 1] += gy * alpha;
        y[j * 2] -= gx * alpha;
        y[j * 2 + 1] -= gy * alpha;
      }
      next[e] += every[e];
      const samples = Math.floor((epoch - nextNegative[e]) / (every[e] / negatives));
      for (let s = 0; s < samples; s++) {
        const k = Math.floor(rand() * n);
        if (k === i) continue;
        dx = y[i * 2] - y[k * 2];
        dy = y[i * 2 + 1] - y[k * 2 + 1];
        d2 = dx * dx + dy * dy;
        const coefficient = d2 > 0 ? (2 * b) / ((0.001 + d2) * (a * Math.pow(d2, b) + 1)) : 0;
        y[i * 2] += (coefficient > 0 ? clip(coefficient * dx) : 4) * alpha;
        y[i * 2 + 1] += (coefficient > 0 ? clip(coefficient * dy) : 4) * alpha;
      }
      nextNegative[e] += (every[e] / negatives) * samples;
    }
    if (epoch % 10 === 0) await pause();
  }
  // Into the unit square, keeping the shape. The frame follows the 1st to
  // 99th percentile so that a few very different images, far away, do not
  // shrink the rest; those few sit at the edge.
  const xs = Float32Array.from({ length: n }, (_, i) => y[i * 2]).sort(),
    ys = Float32Array.from({ length: n }, (_, i) => y[i * 2 + 1]).sort();
  const at = (sorted: Float32Array, q: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];
  const [minX, maxX, minY, maxY] = [at(xs, 0.01), at(xs, 0.99), at(ys, 0.01), at(ys, 0.99)];
  const size = Math.max(maxX - minX, maxY - minY) / 0.92 || 1,
    centreX = (minX + maxX) / 2,
    centreY = (minY + maxY) / 2;
  for (let i = 0; i < n; i++) {
    y[i * 2] = Math.min(0.995, Math.max(0.005, 0.5 + (y[i * 2] - centreX) / size));
    y[i * 2 + 1] = Math.min(0.995, Math.max(0.005, 0.5 + (y[i * 2 + 1] - centreY) / size));
  }
  return y;
}

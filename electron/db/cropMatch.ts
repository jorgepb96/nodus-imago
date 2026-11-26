// Whether one image is the other, or a crop of it, judged on the pixels.
// The image vectors of semantic search find crops, but they also find
// different photographs of the same kind (two studio portraits with the same
// pose and backdrop look alike to them). Candidates found by vectors are
// therefore checked here: the smaller image is searched for inside the larger
// one, at several scales, on tiny greyscale copies; a crop matches almost
// exactly, another photograph does not.

/** A tiny greyscale copy: the long side is MINIATURE pixels. */
export type Miniature = { width: number; height: number; pixels: Uint8Array };
export const MINIATURE = 48;

/** Bilinear resampling of a miniature to another size. */
function resample(m: Miniature, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(m.height - 1, Math.max(0, ((y + 0.5) * m.height) / height - 0.5)),
      y0 = Math.floor(sy),
      y1 = Math.min(m.height - 1, y0 + 1),
      fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(m.width - 1, Math.max(0, ((x + 0.5) * m.width) / width - 0.5)),
        x0 = Math.floor(sx),
        x1 = Math.min(m.width - 1, x0 + 1),
        fx = sx - x0;
      const top = m.pixels[y0 * m.width + x0] * (1 - fx) + m.pixels[y0 * m.width + x1] * fx,
        bottom = m.pixels[y1 * m.width + x0] * (1 - fx) + m.pixels[y1 * m.width + x1] * fx;
      out[y * width + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}

/**
 * Edges rather than brightness: broad tones (a sky, a wall, the ground) make
 * unrelated views correlate; the structure of a scene does not repeat.
 */
function edges(values: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      out[i] = Math.abs(values[i + 1] - values[i - 1]) + Math.abs(values[i + width] - values[i - width]);
    }
  return out;
}

/** Where `part` sits best inside `whole`: the correlation and the place, as fractions of `whole`. */
export type Placement = { score: number; x: number; y: number; w: number; h: number };

/** Best normalised correlation of `part` placed anywhere inside `whole`, at the widths (fractions of it) given. */
export function locate(whole: Miniature, part: Miniature, fractions = [1, 0.85, 0.7, 0.55]): Placement {
  const base = edges(Float32Array.from(whole.pixels), whole.width, whole.height);
  const best: Placement = { score: -1, x: 0, y: 0, w: 1, h: 1 };
  for (const fraction of fractions) {
    const width = Math.round(whole.width * fraction),
      height = Math.round((width * part.height) / part.width);
    if (width < 12 || height < 12 || height > whole.height) continue;
    const template = edges(resample(part, width, height), width, height);
    let mean = 0;
    for (const v of template) mean += v;
    mean /= template.length;
    let spread = 0;
    for (let i = 0; i < template.length; i++) {
      template[i] -= mean;
      spread += template[i] * template[i];
    }
    if (spread < 1e-6) continue;
    for (let top = 0; top + height <= whole.height; top++)
      for (let left = 0; left + width <= whole.width; left++) {
        let sum = 0,
          sumSq = 0,
          cross = 0;
        for (let y = 0; y < height; y++) {
          const row = (top + y) * whole.width + left,
            trow = y * width;
          for (let x = 0; x < width; x++) {
            const w = base[row + x];
            sum += w;
            sumSq += w * w;
            cross += w * template[trow + x];
          }
        }
        const n = width * height,
          variance = sumSq - (sum * sum) / n;
        if (variance < 1e-6) continue;
        const ncc = cross / Math.sqrt(variance * spread);
        if (ncc > best.score)
          Object.assign(best, { score: ncc, x: left / whole.width, y: top / whole.height, w: width / whole.width, h: height / whole.height });
      }
  }
  return best;
}
const search = (whole: Miniature, part: Miniature) => locate(whole, part).score;

/** Correlation from which the place of a crop is trusted. */
const PLACEMENT_SCORE = 0.6;
/** Finer widths to say where a crop sits (the match itself needs only the coarse ones). */
const PLACEMENT_FRACTIONS = [1, 0.93, 0.86, 0.79, 0.72, 0.65, 0.58, 0.51, 0.44, 0.37];
/**
 * Which of two images is a crop of the other, and where it sits in the wider
 * one: `inner` "a" or "b" is the crop, `rect` its place in the other (as
 * fractions) and `kept` the share of the wider image it keeps. Null when they
 * show the same field or are not the same photograph.
 */
export function cropPlacement(a: Miniature, b: Miniature): { inner: "a" | "b"; rect: { x: number; y: number; w: number; h: number }; kept: number } | null {
  // Coarse widths first, then every hundredth around the best one.
  const refined = (whole: Miniature, part: Miniature) => {
    const coarse = locate(whole, part, PLACEMENT_FRACTIONS);
    const around = Array.from({ length: 9 }, (_, i) => Math.round((coarse.w + (i - 4) * 0.01) * 100) / 100).filter((f) => f > 0.3 && f <= 1);
    const fine = locate(whole, part, around);
    return fine.score > coarse.score ? fine : coarse;
  };
  const bInA = refined(a, b),
    aInB = refined(b, a);
  const pick = bInA.score >= aInB.score ? { inner: "b" as const, p: bInA } : { inner: "a" as const, p: aInB };
  // Asked only of images already known to be the same photograph: a lower bar than the match itself.
  if (pick.p.score < PLACEMENT_SCORE) return null;
  const kept = pick.p.w * pick.p.h;
  // The same field, give or take a scanner's margin.
  if (kept > 0.92) return null;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { inner: pick.inner, rect: { x: round(pick.p.x), y: round(pick.p.y), w: round(pick.p.w), h: round(pick.p.h) }, kept: round(kept) };
}

/** The higher correlation of either image found inside the other (1: identical). */
export function cropMatch(a: Miniature, b: Miniature): number {
  return Math.max(search(a, b), search(b, a));
}
/** From this correlation up, two images are the same photograph or a crop of it. */
export const SAME_PHOTOGRAPH = 0.7;

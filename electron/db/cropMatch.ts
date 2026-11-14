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

/** Best normalised correlation of `part` placed anywhere inside `whole`, at widths from 50 % to 100 % of it. */
function search(whole: Miniature, part: Miniature): number {
  const base = edges(Float32Array.from(whole.pixels), whole.width, whole.height);
  let best = -1;
  for (const fraction of [1, 0.85, 0.7, 0.55]) {
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
        if (ncc > best) best = ncc;
      }
  }
  return best;
}

/** The higher correlation of either image found inside the other (1: identical). */
export function cropMatch(a: Miniature, b: Miniature): number {
  return Math.max(search(a, b), search(b, a));
}
/** From this correlation up, two images are the same photograph or a crop of it. */
export const SAME_PHOTOGRAPH = 0.7;

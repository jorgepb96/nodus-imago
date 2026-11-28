// The workshop's image operations on raw RGB pixels. Conventional processing
// only (no models): tone, geometry, halftone removal, inspection filters.
// Libvips (sharp) does what it does well (blur, median, CLAHE, rotation);
// the rest is plain arithmetic here.
import sharp, { type Sharp } from "sharp";
import type { Point, WorkshopOp } from "../../shared/workshop";

export type Raw = { w: number; h: number; data: Uint8ClampedArray };

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const toSharp = (img: Raw) => sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.w, height: img.h, channels: 3 } });
async function fromSharp(s: Sharp): Promise<Raw> {
  const { data, info } = await s.removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  if (info.channels === 3) return { w: info.width, h: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
  // Greyscale out of libvips: spread to three channels.
  const out = new Uint8ClampedArray(info.width * info.height * 3);
  for (let i = 0, j = 0; i < info.width * info.height; i++, j += info.channels) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = data[j];
  return { w: info.width, h: info.height, data: out };
}
export const encodePng = (img: Raw, level = 3) => toSharp(img).png({ compressionLevel: level }).toBuffer();
export async function decode(input: Sharp): Promise<Raw> {
  return fromSharp(input);
}

/** Applies a lookup table to every channel. */
function lut(img: Raw, table: Uint8ClampedArray): Raw {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < out.length; i++) out[i] = table[img.data[i]];
  return { ...img, data: out };
}
const luma = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Monotone cubic interpolation (Fritsch–Carlson) through the curve's points, as a table. */
export function curveTable(points: Point[]): Uint8ClampedArray {
  const p = [...points].sort((a, b) => a[0] - b[0]).filter((q, i, all) => i === 0 || q[0] > all[i - 1][0]);
  const table = new Uint8ClampedArray(256);
  if (p.length < 2) {
    for (let i = 0; i < 256; i++) table[i] = i;
    return table;
  }
  const n = p.length,
    dx = [],
    slope = [],
    m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1][0] - p[i][0]);
    slope.push((p[i + 1][1] - p[i][1]) / dx[i]);
  }
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i],
      b = m[i + 1] / slope[i],
      s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  for (let x = 0; x < 256; x++) {
    if (x <= p[0][0]) table[x] = p[0][1];
    else if (x >= p[n - 1][0]) table[x] = p[n - 1][1];
    else {
      let k = 0;
      while (x > p[k + 1][0]) k++;
      const h = dx[k],
        t = (x - p[k][0]) / h,
        t2 = t * t,
        t3 = t2 * t;
      table[x] = clamp(
        (2 * t3 - 3 * t2 + 1) * p[k][1] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * p[k + 1][1] + (t3 - t2) * h * m[k + 1],
      );
    }
  }
  return table;
}

function adjust(img: Raw, op: Extract<WorkshopOp, { tool: "adjust" }>): Raw {
  // Exposure in stops (on linear light), then brightness and contrast as a table.
  const table = new Uint8ClampedArray(256);
  const gain = 2 ** op.exposure,
    c = 1 + op.contrast / 100;
  for (let v = 0; v < 256; v++) {
    let x = 255 * Math.pow(Math.min(1, Math.pow(v / 255, 2.2) * gain), 1 / 2.2);
    x += op.brightness * 1.28;
    x = (x - 128) * c + 128;
    table[v] = clamp(x);
  }
  const out = new Uint8ClampedArray(img.data.length),
    d = img.data,
    sat = 1 + op.saturation / 100,
    sh = op.shadows / 100,
    hi = op.highlights / 100;
  for (let i = 0; i < d.length; i += 3) {
    const r = table[d[i]],
      g = table[d[i + 1]],
      b = table[d[i + 2]];
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // Shadows lift the dark tones, highlights pull down (or up) the light ones, smoothly.
    const delta = 110 * (sh * (1 - l) * (1 - l) * (1 - l) + hi * l * l * l);
    const L = l * 255;
    out[i] = clamp(L + (r - L) * sat + delta);
    out[i + 1] = clamp(L + (g - L) * sat + delta);
    out[i + 2] = clamp(L + (b - L) * sat + delta);
  }
  return { ...img, data: out };
}

// ------------------------------------------------------------------- FFT
/** In-place radix-2 FFT of one row/column (n a power of two). */
function fft1(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len,
      wr = Math.cos(ang),
      wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k,
          b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci,
          xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}
function fft2(re: Float64Array, im: Float64Array, n: number, inverse: boolean) {
  const rr = new Float64Array(n),
    ri = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    rr.set(re.subarray(y * n, y * n + n));
    ri.set(im.subarray(y * n, y * n + n));
    fft1(rr, ri, inverse);
    re.set(rr, y * n);
    im.set(ri, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) (rr[y] = re[y * n + x]), (ri[y] = im[y * n + x]);
    fft1(rr, ri, inverse);
    for (let y = 0; y < n; y++) (re[y * n + x] = rr[y]), (im[y * n + x] = ri[y]);
  }
  if (inverse) for (let i = 0; i < n * n; i++) (re[i] /= n * n), (im[i] /= n * n);
}

/**
 * Removes a halftone screen: a steep low-pass (Butterworth, order 8) just
 * below the screen's frequency, on overlapping tiles blended with sin²
 * windows. A screen of period P pixels cannot carry real detail finer than
 * P, so what is removed is the dots, not the picture. Luminance through the
 * filter; colour (where colour print rosettes live) with a plain blur.
 */
function descreenChannel(src: Float32Array, w: number, h: number, period: number, strength: number): Float32Array {
  const t = 256,
    step = t / 2;
  const fc = (1 / period) * (0.82 - 0.32 * (strength / 100));
  const filt = new Float64Array(t * t);
  for (let y = 0; y < t; y++)
    for (let x = 0; x < t; x++) {
      const fy = (y < t / 2 ? y : y - t) / t,
        fx = (x < t / 2 ? x : x - t) / t;
      filt[y * t + x] = 1 / (1 + Math.pow(Math.hypot(fx, fy) / fc, 8));
    }
  const win = new Float64Array(t);
  for (let i = 0; i < t; i++) win[i] = Math.sin((Math.PI * (i + 0.5)) / t) ** 2;
  // Padded by reflection so the borders are tiled like the middle.
  const H = Math.ceil((h + step) / step) * step + step,
    W = Math.ceil((w + step) / step) * step + step;
  const at = (x: number, y: number) => {
    let sx = x - step,
      sy = y - step;
    if (sx < 0) sx = -sx;
    if (sy < 0) sy = -sy;
    if (sx >= w) sx = Math.max(0, 2 * w - sx - 2);
    if (sy >= h) sy = Math.max(0, 2 * h - sy - 2);
    return src[sy * w + sx];
  };
  const out = new Float32Array(W * H);
  const re = new Float64Array(t * t),
    im = new Float64Array(t * t);
  for (let ty = 0; ty + t <= H; ty += step)
    for (let tx = 0; tx + t <= W; tx += step) {
      let mean = 0;
      for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) mean += re[y * t + x] = at(tx + x, ty + y);
      mean /= t * t;
      for (let i = 0; i < t * t; i++) (re[i] -= mean), (im[i] = 0);
      fft2(re, im, t, false);
      for (let i = 0; i < t * t; i++) (re[i] *= filt[i]), (im[i] *= filt[i]);
      fft2(re, im, t, true);
      for (let y = 0; y < t; y++)
        for (let x = 0; x < t; x++) out[(ty + y) * W + tx + x] += (re[y * t + x] + mean) * win[y] * win[x];
    }
  const result = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) result[y * w + x] = out[(y + step) * W + x + step];
  return result;
}
async function descreen(img: Raw, op: Extract<WorkshopOp, { tool: "descreen" }>, scale: number): Promise<Raw> {
  const period = op.period * scale;
  // At this preview size the screen is already finer than a pixel: nothing to remove here.
  if (period < 2.2) return img;
  const n = img.w * img.h,
    d = img.data;
  const Y = new Float32Array(n);
  // How coloured it really is: the mean chroma. Black-and-white prints scanned
  // in colour carry only noise and moiré in their colour, around one tint.
  let cr = 0,
    cg = 0,
    cb = 0,
    chroma = 0;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const y = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    Y[i] = y;
    cr += d[j] - y;
    cg += d[j + 1] - y;
    cb += d[j + 2] - y;
    chroma += Math.abs(d[j] - d[j + 2]) + Math.abs(d[j] - d[j + 1]);
  }
  [cr, cg, cb] = [cr / n, cg / n, cb / n];
  const monochrome = chroma / n / 2 < 14;
  const Yf = descreenChannel(Y, img.w, img.h, period, op.strength);
  const out = new Uint8ClampedArray(d.length);
  if (monochrome) {
    // One tint for the whole picture (grey, sepia…): the colour noise goes with the dots.
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      out[j] = clamp(Yf[i] + cr);
      out[j + 1] = clamp(Yf[i] + cg);
      out[j + 2] = clamp(Yf[i] + cb);
    }
  } else {
    // Real colour: the filtered light with the colour smoothed well beyond the screen (colour moiré is coarse).
    const blurred = await fromSharp(toSharp(img).blur(Math.max(1, period * 2.5)));
    const b = blurred.data;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const yb = 0.299 * b[j] + 0.587 * b[j + 1] + 0.114 * b[j + 2];
      out[j] = clamp(Yf[i] + b[j] - yb);
      out[j + 1] = clamp(Yf[i] + b[j + 1] - yb);
      out[j + 2] = clamp(Yf[i] + b[j + 2] - yb);
    }
  }
  return { ...img, data: out };
}

/**
 * Finds a halftone screen: in the averaged power spectrum of the image's
 * tiles, a screen shows as a bump at its frequency above the smooth fall of
 * natural images. Returns its period in pixels and how clear it is.
 */
export function detectScreen(img: Raw): { period: number; confidence: number } | null {
  const t = 256,
    step = t;
  const P = new Float64Array(t * t);
  const re = new Float64Array(t * t),
    im = new Float64Array(t * t);
  const win = new Float64Array(t);
  for (let i = 0; i < t; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (t - 1));
  let tiles = 0;
  const d = img.data;
  for (let ty = 0; ty + t <= img.h && tiles < 48; ty += step)
    for (let tx = 0; tx + t <= img.w && tiles < 48; tx += step) {
      let mean = 0,
        sq = 0;
      for (let y = 0; y < t; y++)
        for (let x = 0; x < t; x++) {
          const v = luma(d, ((ty + y) * img.w + tx + x) * 3);
          re[y * t + x] = v;
          mean += v;
          sq += v * v;
        }
      mean /= t * t;
      if (sq / (t * t) - mean * mean < 16) continue;
      for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) (re[y * t + x] = (re[y * t + x] - mean) * win[y] * win[x]), (im[y * t + x] = 0);
      fft2(re, im, t, false);
      for (let i = 0; i < t * t; i++) P[i] += re[i] * re[i] + im[i] * im[i];
      tiles++;
    }
  if (!tiles) return null;
  const half = t / 2,
    sum = new Float64Array(half),
    count = new Float64Array(half);
  for (let y = 0; y < t; y++)
    for (let x = 0; x < t; x++) {
      const fy = y < half ? y : y - t,
        fx = x < half ? x : x - t,
        r = Math.round(Math.hypot(fx, fy));
      if (r > 0 && r < half) (sum[r] += P[y * t + x]), (count[r] += 1);
    }
  // Log radial profile against a quadratic fit in log-log: the residual bump is the screen.
  const xs: number[] = [],
    ys: number[] = [];
  for (let r = 2; r < half; r++) xs.push(Math.log(r)), ys.push(Math.log(sum[r] / count[r] + 1e-9));
  const fit = polyfit2(xs, ys);
  let best = -Infinity,
    bestR = 0;
  for (let k = 0; k < xs.length; k++) {
    const r = k + 2;
    if (r < 12) continue;
    const res = ys[k] - (fit[0] + fit[1] * xs[k] + fit[2] * xs[k] * xs[k]);
    if (res > best) (best = res), (bestR = r);
  }
  if (best < 0.9) return null;
  return { period: Math.round((t / bestR) * 100) / 100, confidence: Math.min(1, (best - 0.9) / 2.5) };
}
function polyfit2(x: number[], y: number[]): [number, number, number] {
  // Least squares for a + b·x + c·x².
  let s0 = 0,
    s1 = 0,
    s2 = 0,
    s3 = 0,
    s4 = 0,
    t0 = 0,
    t1 = 0,
    t2 = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i],
      a2 = a * a;
    s0++;
    s1 += a;
    s2 += a2;
    s3 += a2 * a;
    s4 += a2 * a2;
    t0 += y[i];
    t1 += a * y[i];
    t2 += a2 * y[i];
  }
  const m = [
    [s0, s1, s2, t0],
    [s1, s2, s3, t1],
    [s2, s3, s4, t2],
  ];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++)
      if (r !== c) {
        const f = m[r][c] / m[c][c];
        for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
      }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

// -------------------------------------------------------------- geometry
/** The largest axis-aligned rectangle inside a w×h image turned by `deg`, centred. */
function inscribed(w: number, h: number, deg: number): [number, number] {
  const a = Math.abs((deg * Math.PI) / 180),
    sin = Math.sin(a),
    cos = Math.cos(a);
  const long = Math.max(w, h),
    short = Math.min(w, h);
  let wr: number, hr: number;
  if (short <= 2 * sin * cos * long || Math.abs(sin - cos) < 1e-10) {
    const x = 0.5 * short;
    [wr, hr] = w >= h ? [x / sin, x / cos] : [x / cos, x / sin];
  } else {
    const c2 = cos * cos - sin * sin;
    [wr, hr] = [(w * cos - h * sin) / c2, (h * cos - w * sin) / c2];
  }
  return [Math.floor(Math.abs(wr)), Math.floor(Math.abs(hr))];
}
async function rotate(img: Raw, op: Extract<WorkshopOp, { tool: "rotate" }>): Promise<Raw> {
  let s = toSharp(img);
  if (op.quarter) s = s.rotate(op.quarter);
  if (op.flip) s = s.flop();
  let out = await fromSharp(s);
  if (op.angle) {
    const turned = await fromSharp(toSharp(out).rotate(op.angle, { background: { r: 255, g: 255, b: 255 } }));
    // Cropped to the largest rectangle with no empty corners.
    const [iw, ih] = inscribed(out.w, out.h, op.angle);
    const left = Math.max(0, Math.round((turned.w - iw) / 2)),
      top = Math.max(0, Math.round((turned.h - ih) / 2));
    out = await fromSharp(toSharp(turned).extract({ left, top, width: Math.min(iw, turned.w - left), height: Math.min(ih, turned.h - top) }));
  }
  return out;
}
async function crop(img: Raw, op: Extract<WorkshopOp, { tool: "crop" }>): Promise<Raw> {
  const left = Math.max(0, Math.min(img.w - 1, Math.round(op.x * img.w))),
    top = Math.max(0, Math.min(img.h - 1, Math.round(op.y * img.h)));
  return fromSharp(
    toSharp(img).extract({ left, top, width: Math.max(1, Math.min(img.w - left, Math.round(op.w * img.w))), height: Math.max(1, Math.min(img.h - top, Math.round(op.h * img.h))) }),
  );
}

/** A point of a side: straight between its corners, or a curve through its middle (quadratic Bézier). */
function side(a: Point, b: Point, mid: Point | null, t: number): Point {
  if (!mid) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  // The control point that makes the curve pass through `mid` at t = ½.
  const c: Point = [2 * mid[0] - (a[0] + b[0]) / 2, 2 * mid[1] - (a[1] + b[1]) / 2];
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}
function sideLength(a: Point, b: Point, mid: Point | null, w: number, h: number) {
  let len = 0,
    prev = side(a, b, mid, 0);
  for (let i = 1; i <= 32; i++) {
    const p = side(a, b, mid, i / 32);
    len += Math.hypot((p[0] - prev[0]) * w, (p[1] - prev[1]) * h);
    prev = p;
  }
  return len;
}
/**
 * Flattens a photograph on a book page: the region bounded by four sides
 * (straight, or curved through their middles) is mapped onto a rectangle
 * with a Coons patch, so perspective and page curvature are corrected at once.
 */
function straighten(img: Raw, op: Extract<WorkshopOp, { tool: "straighten" }>): Raw {
  const [tl, tr, br, bl] = op.corners;
  const [bt, br2, bb, bl2] = op.bows; // top, right, bottom, left
  const W = Math.max(8, Math.round((sideLength(tl, tr, bt, img.w, img.h) + sideLength(bl, br, bb, img.w, img.h)) / 2));
  const H = Math.max(8, Math.round((sideLength(tl, bl, bl2, img.w, img.h) + sideLength(tr, br, br2, img.w, img.h)) / 2));
  const out = new Uint8ClampedArray(W * H * 3),
    d = img.data;
  const top = Array.from({ length: W }, (_, x) => side(tl, tr, bt, W > 1 ? x / (W - 1) : 0));
  const bottom = Array.from({ length: W }, (_, x) => side(bl, br, bb, W > 1 ? x / (W - 1) : 0));
  for (let y = 0; y < H; y++) {
    const v = H > 1 ? y / (H - 1) : 0;
    const left = side(tl, bl, bl2, v),
      right = side(tr, br, br2, v);
    for (let x = 0; x < W; x++) {
      const u = W > 1 ? x / (W - 1) : 0;
      // Coons patch: the two ruled surfaces minus the bilinear one of the corners.
      const sx =
        (1 - v) * top[x][0] + v * bottom[x][0] + (1 - u) * left[0] + u * right[0] -
        ((1 - u) * (1 - v) * tl[0] + u * (1 - v) * tr[0] + (1 - u) * v * bl[0] + u * v * br[0]);
      const sy =
        (1 - v) * top[x][1] + v * bottom[x][1] + (1 - u) * left[1] + u * right[1] -
        ((1 - u) * (1 - v) * tl[1] + u * (1 - v) * tr[1] + (1 - u) * v * bl[1] + u * v * br[1]);
      const fx = Math.min(img.w - 1.001, Math.max(0, sx * img.w - 0.5)),
        fy = Math.min(img.h - 1.001, Math.max(0, sy * img.h - 0.5));
      const x0 = Math.floor(fx),
        y0 = Math.floor(fy),
        ax = fx - x0,
        ay = fy - y0;
      const i00 = (y0 * img.w + x0) * 3,
        i10 = i00 + 3,
        i01 = i00 + img.w * 3,
        i11 = i01 + 3,
        o = (y * W + x) * 3;
      for (let c = 0; c < 3; c++)
        out[o + c] = (1 - ay) * ((1 - ax) * d[i00 + c] + ax * d[i10 + c]) + ay * ((1 - ax) * d[i01 + c] + ax * d[i11 + c]);
    }
  }
  return { w: W, h: H, data: out };
}

// ------------------------------------------------------------ inspection
const PALETTES: Record<string, [number, number, number][]> = {
  thermal: [[0, 0, 0], [40, 0, 90], [150, 0, 120], [230, 60, 30], [255, 180, 0], [255, 255, 200]],
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  spectrum: [[48, 18, 59], [40, 120, 240], [30, 220, 160], [230, 220, 40], [240, 60, 20], [122, 4, 3]],
};
function falsecolor(img: Raw, palette: string): Raw {
  const stops = PALETTES[palette] ?? PALETTES.thermal;
  const table: [number, number, number][] = Array.from({ length: 256 }, (_, v) => {
    const t = (v / 255) * (stops.length - 1),
      k = Math.min(stops.length - 2, Math.floor(t)),
      f = t - k;
    return [0, 1, 2].map((c) => stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f) as [number, number, number];
  });
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < out.length; i += 3) {
    const c = table[Math.round(luma(img.data, i))];
    out[i] = c[0];
    out[i + 1] = c[1];
    out[i + 2] = c[2];
  }
  return { ...img, data: out };
}
function edges(img: Raw, strength: number): Raw {
  const { w, h, data } = img,
    L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = luma(data, i * 3);
  const out = new Uint8ClampedArray(data.length),
    k = 0.6 + (strength / 100) * 3;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1];
      const gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1];
      const v = clamp(255 - Math.hypot(gx, gy) * k * 0.25);
      out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = v;
    }
  return { ...img, data: out };
}

/**
 * Applies one operation. `scale` is the size of this image against the
 * source (previews are smaller): operations measured in source pixels
 * (the halftone's period, sharpening radii) are scaled with it.
 */
export async function apply(img: Raw, op: WorkshopOp, scale: number): Promise<Raw> {
  switch (op.tool) {
    case "adjust":
      return adjust(img, op);
    case "levels": {
      const table = new Uint8ClampedArray(256),
        span = Math.max(1, op.white - op.black);
      for (let v = 0; v < 256; v++) table[v] = clamp(255 * Math.pow(Math.min(1, Math.max(0, (v - op.black) / span)), 1 / Math.max(0.05, op.gamma)));
      return lut(img, table);
    }
    case "curve":
      return lut(img, curveTable(op.points));
    case "sharpen":
      return fromSharp(toSharp(img).sharpen({ sigma: Math.max(0.3, op.radius * Math.max(0.35, scale)), m1: 0.5, m2: op.amount / 12 }));
    case "denoise": {
      const size = op.strength > 66 ? 5 : 3;
      const smooth = await fromSharp(toSharp(img).median(size));
      if (op.strength >= 100) return smooth;
      const a = Math.min(1, op.strength / 66),
        out = new Uint8ClampedArray(img.data.length);
      for (let i = 0; i < out.length; i++) out[i] = img.data[i] * (1 - a) + smooth.data[i] * a;
      return { ...img, data: out };
    }
    case "descreen":
      return descreen(img, op, scale);
    case "clahe": {
      // Windows of about a twentieth of the picture: local enough to bring out detail, and fast.
      const tile = Math.max(8, Math.round(Math.min(img.w, img.h) / 20));
      return fromSharp(toSharp(img).clahe({ width: tile, height: tile, maxSlope: Math.round(1 + (op.strength / 100) * 9) }));
    }
    case "rotate":
      return rotate(img, op);
    case "crop":
      return crop(img, op);
    case "straighten":
      return straighten(img, op);
    case "invert": {
      const table = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) table[v] = 255 - v;
      return lut(img, table);
    }
    case "grayscale": {
      const out = new Uint8ClampedArray(img.data.length);
      for (let i = 0; i < out.length; i += 3) out[i] = out[i + 1] = out[i + 2] = luma(img.data, i);
      return { ...img, data: out };
    }
    case "edges":
      return edges(img, op.strength);
    case "falsecolor":
      return falsecolor(img, op.palette);
    case "channel": {
      const c = op.channel === "r" ? 0 : op.channel === "g" ? 1 : 2,
        out = new Uint8ClampedArray(img.data.length);
      for (let i = 0; i < out.length; i += 3) out[i] = out[i + 1] = out[i + 2] = img.data[i + c];
      return { ...img, data: out };
    }
  }
}

/** 256-bin luminance histogram and the percentiles recipes need. */
export function measure(img: Raw) {
  const hist = new Array(256).fill(0);
  const d = img.data,
    n = img.w * img.h;
  let sum = 0;
  for (let i = 0; i < d.length; i += 3) {
    const v = Math.round(luma(d, i));
    hist[v]++;
    sum += v;
  }
  const pct = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= q * n) return v;
    return 255;
  };
  return { histogram: hist, low: pct(0.005), high: pct(0.995), mean: sum / n };
}

/**
 * What the automatic mode looks at, besides the tones: grain (Immerkær's
 * estimate of noise, in grey levels), the tilt of the picture (the dominant
 * direction of its edges near horizontal and vertical) and how coloured it is.
 */
export function inspect(img: Raw) {
  const { w, h, data: d } = img;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; p < g.length; i += 3, p++) g[p] = luma(d, i);
  let noise = 0;
  let chroma = 0;
  const bins = 201; // −10° … +10° in tenths
  const hist = new Float64Array(bins);
  let total = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const a = g[p - w - 1],
        b = g[p - w],
        c = g[p - w + 1],
        l = g[p - 1],
        m = g[p],
        r = g[p + 1],
        e = g[p + w - 1],
        f = g[p + w],
        k = g[p + w + 1];
      noise += Math.abs(a - 2 * b + c - 2 * l + 4 * m - 2 * r + e - 2 * f + k);
      const gx = c + 2 * r + k - a - 2 * l - e;
      const gy = e + 2 * f + k - a - 2 * b - c;
      const mag = Math.hypot(gx, gy);
      if (mag < 60) continue;
      total += mag;
      // An edge's direction, folded onto a quarter turn: a horizontal and a vertical line count alike.
      let deg = (Math.atan2(gy, gx) * 180) / Math.PI;
      deg = ((deg % 90) + 135) % 90 - 45;
      if (deg < -10 || deg > 10) continue;
      hist[Math.round((deg + 10) * 10)] += mag;
    }
  for (let i = 0; i < d.length; i += 3) chroma += (Math.abs(d[i] - d[i + 2]) + Math.abs(d[i] - d[i + 1])) / 2;
  noise = (Math.sqrt(Math.PI / 2) * noise) / (6 * (w - 2) * (h - 2));
  // The peak of the edge directions, smoothed over ±0.3°; trusted only when it stands out.
  let best = 100,
    bestWeight = 0;
  for (let i = 3; i < bins - 3; i++) {
    let s = 0;
    for (let j = -3; j <= 3; j++) s += hist[i + j];
    if (s > bestWeight) (bestWeight = s), (best = i);
  }
  const share = total ? bestWeight / total : 0;
  // The centre of the peak, finer than its bin.
  let num = 0,
    den = 0;
  for (let j = -6; j <= 6; j++) {
    const i = best + j;
    if (i < 0 || i >= bins) continue;
    num += hist[i] * i;
    den += hist[i];
  }
  const angle = Math.round(((den ? num / den : best) / 10 - 10) * 10) / 10;
  return {
    noise: Math.round(noise * 10) / 10,
    chroma: Math.round((chroma / (w * h)) * 10) / 10,
    tilt: share > 0.06 && Math.abs(angle) >= 0.4 && Math.abs(angle) <= 8 ? { angle, confidence: Math.min(1, share / 0.15) } : null,
  };
}

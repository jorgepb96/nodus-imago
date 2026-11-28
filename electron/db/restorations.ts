// Versions made in the restoration workshop. The original file is only read:
// a restored version is a new PNG in <collection>/restorations, recorded with
// the provider, model and instructions that produced it. Restoring a region
// sends only that crop and pastes the result back with a soft edge, so the
// rest of the image stays exactly as it was. Three safeguards keep a model
// from changing what it should not: a colourised version keeps the light and
// detail of its source and takes only the colour of the model's answer; a
// pasted region takes the tone of its surroundings; and every version can be
// measured against the original and shown with what changed marked on it.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import sharp from "sharp";
import type { Repository } from "./repository";
import type { ApiProvider } from "../../shared/aiConfig";
import { checkLevel, type Restoration, type RestorationCheck, type RestorationTask, type Watermark } from "../../shared/restoration";
import { recordEmbeddingParts } from "../../shared/recordEmbedding";
import { imagePipeline, orientedImage } from "../import/images";
import { assetView, shownSize } from "../../shared/imageRotation";
import { sha256File } from "../workshop/workshop";

/** Longest side sent to a provider. */
const SEND_MAX = 2048;
/** Extra margin around a region, so the model sees its surroundings. */
const PADDING = 0.04;
type Region = { x: number; y: number; w: number; h: number };
type Row = Omit<Restoration, "region" | "title" | "params"> & { region_json: string | null; params_json: string | null; file: string };

/** Width and height as displayed, after the EXIF rotation. */
function orientedSize(meta: { width?: number; height?: number; orientation?: number }): [number, number] {
  const w = meta.width ?? 1,
    h = meta.height ?? 1;
  return (meta.orientation ?? 1) >= 5 ? [h, w] : [w, h];
}


type Crop = { left: number; top: number; width: number; height: number };
/** Rec. 601 luma of interleaved RGB. */
function luma(rgb: Buffer): Float32Array {
  const out = new Float32Array(rgb.length / 3);
  for (let i = 0, j = 0; j < out.length; i += 3, j++) out[j] = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
  return out;
}
const rgbAt = (input: Buffer, width: number, height: number) =>
  sharp(input).resize(width, height, { fit: "fill" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
/** Pearson correlation of two equally long series. */
function correlation(a: Float32Array, b: Float32Array): number {
  let ma = 0,
    mb = 0;
  for (let i = 0; i < a.length; i++) (ma += a[i]), (mb += b[i]);
  ma /= a.length;
  mb /= b.length;
  let ab = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma,
      y = b[i] - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : aa === bb ? 1 : 0;
}
/** Mean structural similarity of two greyscale images, in 8×8 blocks. */
export function ssim(a: Float32Array, b: Float32Array, width: number, height: number): number {
  const c1 = (0.01 * 255) ** 2,
    c2 = (0.03 * 255) ** 2;
  let total = 0,
    count = 0;
  for (let by = 0; by + 8 <= height; by += 4)
    for (let bx = 0; bx + 8 <= width; bx += 4) {
      let ma = 0,
        mb = 0;
      for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) (ma += a[y * width + x]), (mb += b[y * width + x]);
      ma /= 64;
      mb /= 64;
      let va = 0,
        vb = 0,
        cov = 0;
      for (let y = by; y < by + 8; y++)
        for (let x = bx; x < bx + 8; x++) {
          const da = a[y * width + x] - ma,
            db = b[y * width + x] - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      va /= 63;
      vb /= 63;
      cov /= 63;
      total += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
      count++;
    }
  return count ? total / count : 1;
}
/** Greyscale, slightly softened, at a fixed size: what the checks compare. */
const greyAt = async (input: Buffer, width: number, height: number) =>
  luma(await sharp(input).resize(width, height, { fit: "fill" }).blur(0.6).removeAlpha().toColourspace("srgb").raw().toBuffer());

/**
 * b with a's tones: each grey level of b is mapped to the level of a at the
 * same rank (histogram matching). A version that is only lighter, darker or
 * more contrasted then compares as unchanged; what moved or appeared does not.
 */
export function matchHistogram(a: Float32Array, b: Float32Array): Float32Array {
  const count = (v: Float32Array) => {
    const h = new Float64Array(256);
    for (const x of v) h[Math.max(0, Math.min(255, Math.round(x)))]++;
    for (let i = 1; i < 256; i++) h[i] += h[i - 1];
    for (let i = 0; i < 256; i++) h[i] /= v.length;
    return h;
  };
  const ca = count(a),
    cb = count(b),
    map = new Float32Array(256);
  for (let i = 0, j = 0; i < 256; i++) {
    while (j < 255 && ca[j] < cb[i]) j++;
    map[i] = j;
  }
  return Float32Array.from(b, (x) => map[Math.max(0, Math.min(255, Math.round(x)))]);
}

type Fit = { sx: number; sy: number; tx: number; ty: number };
/** Correlation of a source with an answer read through a fit (answer = s·source + t, in fractions), over the part they share. */
function fitScore(a: Float32Array, b: Float32Array, n: number, fit: Fit): number {
  let sa = 0,
    sb = 0,
    saa = 0,
    sbb = 0,
    sab = 0,
    count = 0;
  for (let y = 0; y < n; y++) {
    const v = Math.round(fit.sy * (y + 0.5) + fit.ty * n - 0.5);
    if (v < 0 || v >= n) continue;
    for (let x = 0; x < n; x++) {
      const u = Math.round(fit.sx * (x + 0.5) + fit.tx * n - 0.5);
      if (u < 0 || u >= n) continue;
      const p = a[y * n + x],
        q = b[v * n + u];
      sa += p;
      sb += q;
      saa += p * p;
      sbb += q * q;
      sab += p * q;
      count++;
    }
  }
  if (count < n * n * 0.6) return -1;
  const cov = sab / count - (sa / count) * (sb / count),
    va = saa / count - (sa / count) ** 2,
    vb = sbb / count - (sb / count) ** 2;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/**
 * Where a model's answer sits relative to its source: models sometimes zoom
 * in a little, stretch or shift the picture. The scale and shift that best
 * line them up are searched coarse to fine on small greyscale copies.
 */
export async function findFit(source: Buffer, answer: Buffer): Promise<Fit & { score: number; identity: number }> {
  const step = (n: number) => 1 / n;
  // 1. Coarse: one zoom for both sides, centred, and a shift.
  const [a1, b1] = await Promise.all([greyAt(source, 48, 48), greyAt(answer, 48, 48)]);
  let best: Fit & { score: number } = { sx: 1, sy: 1, tx: 0, ty: 0, score: fitScore(a1, b1, 48, { sx: 1, sy: 1, tx: 0, ty: 0 }) };
  for (let i = 0; i <= 20; i++) {
    const sc = 0.8 + i * 0.02;
    for (let dy = -0.16; dy <= 0.16 + 1e-9; dy += step(48))
      for (let dx = -0.16; dx <= 0.16 + 1e-9; dx += step(48)) {
        const fit = { sx: sc, sy: sc, tx: (1 - sc) / 2 + dx, ty: (1 - sc) / 2 + dy };
        const score = fitScore(a1, b1, 48, fit);
        if (score > best.score) best = { ...fit, score };
      }
  }
  // 2. Fine: each side's zoom on its own, and the shift, around the coarse fit.
  const [a2, b2] = await Promise.all([greyAt(source, 128, 128), greyAt(answer, 128, 128)]);
  const identity = fitScore(a2, b2, 128, { sx: 1, sy: 1, tx: 0, ty: 0 });
  const around = best;
  best = { ...around, score: fitScore(a2, b2, 128, around) };
  for (const dsx of [-0.02, -0.01, 0, 0.01, 0.02])
    for (const dsy of [-0.02, -0.01, 0, 0.01, 0.02])
      for (let dy = -0.025; dy <= 0.025 + 1e-9; dy += step(128))
        for (let dx = -0.025; dx <= 0.025 + 1e-9; dx += step(128)) {
          const sx = around.sx + dsx,
            sy = around.sy + dsy;
          // Zooming keeps the point under the coarse fit's centre in place.
          const fit = { sx, sy, tx: around.tx + (around.sx - sx) / 2 + dx, ty: around.ty + (around.sy - sy) / 2 + dy };
          const score = fitScore(a2, b2, 128, fit);
          if (score > best.score) best = { ...fit, score };
        }
  return { ...best, identity };
}

/**
 * The answer lined up with its source, at the source's size, or null when it
 * does not match it (another picture, or changed beyond recognition). A zoom,
 * stretch or shift is only undone when it clearly explains the answer better
 * (heavy damage can fool a weak match); edges the model cropped show the
 * source there.
 */
export async function lineUp(source: Buffer, answer: Buffer, width: number, height: number): Promise<Buffer | null> {
  const fit = await findFit(source, answer);
  if (fit.score < 0.6 && fit.identity < 0.6) return null;
  const resized = await sharp(answer).resize(width, height, { fit: "fill" }).removeAlpha().png().toBuffer();
  const moved = Math.abs(fit.sx - 1) >= 0.006 || Math.abs(fit.sy - 1) >= 0.006 || Math.abs(fit.tx) >= 0.004 || Math.abs(fit.ty) >= 0.004;
  if (!moved || fit.score < 0.65 || fit.score < fit.identity + 0.08) return fit.identity >= 0.6 || !moved ? resized : null;
  const pad = Math.ceil(Math.max(width, height) * 0.4);
  const warped = await sharp(
    await sharp(resized).ensureAlpha().extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
  )
    .extract({
      left: Math.round(fit.tx * width) + pad,
      top: Math.round(fit.ty * height) + pad,
      width: Math.max(1, Math.round(fit.sx * width)),
      height: Math.max(1, Math.round(fit.sy * height)),
    })
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();
  const under = await sharp(source).resize(width, height, { fit: "fill" }).removeAlpha().png().toBuffer();
  return sharp(under).composite([{ input: warped }]).removeAlpha().png().toBuffer();
}

// sRGB ⇄ CIE Lab (D65), for keeping a source's lightness under a model's colour.
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const [XN, YN, ZN] = [0.95047, 1, 1.08883];
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const finv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
const gamma = (c: number) => Math.max(0, Math.min(255, Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055))));
function lab(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = [LINEAR[r], LINEAR[g], LINEAR[b]];
  const x = f((0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / XN),
    y = f((0.2126 * lr + 0.7152 * lg + 0.0722 * lb) / YN),
    z = f((0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / ZN);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * The source's light and detail with the colour of the model's answer: each
 * pixel keeps the source's lightness and takes the answer's colour (CIE Lab
 * a* and b*), so a colourised version cannot move, add or smooth anything.
 */
export async function keepLight(source: Buffer, colour: Buffer, width: number, height: number): Promise<Buffer> {
  const [a, c] = await Promise.all([rgbAt(source, width, height), rgbAt(colour, width, height)]);
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 3) {
    const [l] = lab(a[i], a[i + 1], a[i + 2]);
    const [lc, ca, cb] = lab(c[i], c[i + 1], c[i + 2]);
    // Where the source is lighter than the answer the same colour would look
    // washed out: it is strengthened a little (and softened where darker).
    // Near black and white there is no room for colour: it fades out there.
    const room = Math.min(1, l / 12, (100 - l) / 6) * Math.min(1.35, Math.max(0.85, Math.sqrt((l + 8) / (lc + 8))));
    const fy = (l + 16) / 116,
      fx = fy + (ca * room) / 500,
      fz = fy - (cb * room) / 200;
    const x = XN * finv(fx),
      y = YN * finv(fy),
      z = ZN * finv(fz);
    out[i] = gamma(3.2406 * x - 1.5372 * y - 0.4986 * z);
    out[i + 1] = gamma(-0.9689 * x + 1.8758 * y + 0.0415 * z);
    out[i + 2] = gamma(0.0557 * x - 0.204 * y + 1.057 * z);
  }
  return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** Box blur of a greyscale image (two passes, separable). */
function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius < 1) return src;
  const pass = (input: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(input.length);
    const [n, m] = horizontal ? [height, width] : [width, height];
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const at = (j: number) => input[horizontal ? i * width + Math.max(0, Math.min(m - 1, j)) : Math.max(0, Math.min(m - 1, j)) * width + i];
      for (let j = -radius; j <= radius; j++) sum += at(j);
      for (let j = 0; j < m; j++) {
        out[horizontal ? i * width + j : j * width + i] = sum / (2 * radius + 1);
        sum += at(j + radius + 1) - at(j - radius);
      }
    }
    return out;
  };
  return pass(pass(pass(pass(src, true), false), true), false);
}

/** A monochrome photograph's tint: its Lab a*, b* at each lightness, in steps of 10 (sepia is neutral in the shadows and warm in the middle tones). */
export type Tint = { a: number; b: number }[];
/**
 * The tint of a monochrome photograph (black and white, sepia, toned), read
 * from its middle (mounts, paper edges and scanner margins have their own
 * colour); null when it has real colour. A toned print varies in how strong
 * its tint is, never in its hue: colour off the tint's axis, or of the
 * opposite hue, means a colour photograph.
 */
export async function monochromeTint(png: Buffer): Promise<Tint | null> {
  const m = await sharp(png).metadata();
  const [w, h] = [m.width ?? 1, m.height ?? 1];
  const raw = await sharp(png)
    .extract({ left: Math.floor(w * 0.15), top: Math.floor(h * 0.15), width: Math.max(1, Math.round(w * 0.7)), height: Math.max(1, Math.round(h * 0.7)) })
    .resize(192, 192, { fit: "inside" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer();
  const px: [number, number, number][] = [];
  for (let i = 0; i < raw.length; i += 3) px.push(lab(raw[i], raw[i + 1], raw[i + 2]));
  const median = (v: number[]) => (v.length ? [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] : 0);
  const quantile = (v: number[], q: number) => [...v].sort((x, y) => x - y)[Math.floor((v.length - 1) * q)];
  const ma = median(px.map((p) => p[1])),
    mb = median(px.map((p) => p[2]));
  const norm = Math.hypot(ma, mb);
  if (norm > 3) {
    const [dx, dy] = [ma / norm, mb / norm];
    const off = px.map(([, a, b]) => Math.abs(-a * dy + b * dx)),
      along = px.map(([, a, b]) => a * dx + b * dy);
    if (quantile(off, 0.97) > 8 || quantile(along, 0.02) < -4) return null;
    // Warm colours of a colourised or hand-coloured print fan out in hue; a toned print's do not.
    const hues = px.filter(([, a, b]) => Math.hypot(a, b) > 6).map(([, a, b]) => Math.atan2(b, a));
    const axis = Math.atan2(mb, ma);
    if (hues.length > px.length * 0.05 && quantile(hues.map((x) => Math.abs(Math.atan2(Math.sin(x - axis), Math.cos(x - axis)))), 0.9) > (12 * Math.PI) / 180)
      return null;
  } else if (quantile(px.map(([, a, b]) => Math.hypot(a - ma, b - mb)), 0.97) > 8) return null;
  // The tint at each lightness; levels without pixels take the overall tint.
  return Array.from({ length: 11 }, (_, k) => {
    const near = px.filter(([l]) => Math.abs(l - k * 10) <= 5);
    return near.length >= 20 ? { a: median(near.map((p) => p[1])), b: median(near.map((p) => p[2])) } : { a: ma, b: mb };
  });
}
/** How coloured an image is: the 90th percentile of its Lab chroma around its median tint. */
async function colourfulness(png: Buffer): Promise<number> {
  const raw = await sharp(png).resize(192, 192, { fit: "inside" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  const ab: [number, number][] = [];
  for (let i = 0; i < raw.length; i += 3) {
    const [, a, b] = lab(raw[i], raw[i + 1], raw[i + 2]);
    ab.push([a, b]);
  }
  const median = (k: 0 | 1) => [...ab].map((p) => p[k]).sort((x, y) => x - y)[Math.floor(ab.length / 2)];
  const [ma, mb] = [median(0), median(1)];
  return ab.map(([a, b]) => Math.hypot(a - ma, b - mb)).sort((x, y) => x - y)[Math.floor(ab.length * 0.9)];
}
/** The answer's light with the source's tint: a restored monochrome photograph cannot come back coloured. */
export async function applyTint(answer: Buffer, tint: Tint, width: number, height: number): Promise<Buffer> {
  const c = await rgbAt(answer, width, height);
  const out = Buffer.alloc(c.length);
  for (let i = 0; i < c.length; i += 3) {
    const [l] = lab(c[i], c[i + 1], c[i + 2]);
    // The tint of the source at this lightness, between its two nearest levels.
    const k = Math.max(0, Math.min(9.999, l / 10)),
      j = Math.floor(k),
      t = k - j;
    const ta = tint[j].a * (1 - t) + tint[j + 1].a * t,
      tb = tint[j].b * (1 - t) + tint[j + 1].b * t;
    const room = Math.min(1, l / 12, (100 - l) / 6);
    const fy = (l + 16) / 116,
      x = XN * finv(fy + (ta * room) / 500),
      y = YN * finv(fy),
      z = ZN * finv(fy - (tb * room) / 200);
    out[i] = gamma(3.2406 * x - 1.5372 * y - 0.4986 * z);
    out[i + 1] = gamma(-0.9689 * x + 1.8758 * y + 0.0415 * z);
    out[i + 2] = gamma(0.0557 * x - 0.204 * y + 1.057 * z);
  }
  return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/**
 * A pasted region takes the tone of the source around it: each channel of the
 * answer is shifted and scaled so its border (outside the soft edge, where
 * nothing was to be repaired) matches the source's border.
 */
export async function matchTone(source: Buffer, answer: Buffer, width: number, height: number, ring: number): Promise<Buffer> {
  const [a, b] = await Promise.all([rgbAt(source, width, height), rgbAt(answer, width, height)]);
  const inRing = (x: number, y: number) => x < ring || y < ring || x >= width - ring || y >= height - ring;
  const out = Buffer.alloc(b.length);
  for (let ch = 0; ch < 3; ch++) {
    let sa = 0,
      sb = 0,
      qa = 0,
      qb = 0,
      n = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (!inRing(x, y)) continue;
        const i = (y * width + x) * 3 + ch;
        sa += a[i];
        sb += b[i];
        qa += a[i] * a[i];
        qb += b[i] * b[i];
        n++;
      }
    const ma = sa / n,
      mb = sb / n,
      da = Math.sqrt(Math.max(0, qa / n - ma * ma)),
      db = Math.sqrt(Math.max(0, qb / n - mb * mb));
    const k = db > 1 ? Math.min(1.25, Math.max(0.8, da / db)) : 1;
    for (let i = ch; i < b.length; i += 3) out[i] = Math.max(0, Math.min(255, Math.round((b[i] - mb) * k + ma)));
  }
  return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
/** XMP describing a derived version: what it is, what was done and from which original (by SHA-256). */
export function xmpPacket(meta: { label: string; ops: unknown[]; original: string; app: string; sha256: string | null; createdAt: string }) {
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:imago="https://nodus.app/ns/imago/1.0/">
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(meta.label)}</rdf:li></rdf:Alt></dc:description>
   <xmp:CreatorTool>${xmlEscape(meta.app)}</xmp:CreatorTool>
   <xmp:ModifyDate>${xmlEscape(meta.createdAt)}</xmp:ModifyDate>
   <imago:DerivedFrom>${xmlEscape(meta.original)}</imago:DerivedFrom>
   <imago:VersionSHA256>${xmlEscape(meta.sha256 ?? "")}</imago:VersionSHA256>
   <imago:Treatment>${xmlEscape(meta.label)}</imago:Treatment>
   <imago:History>${xmlEscape(JSON.stringify(meta.ops))}</imago:History>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export function watermarkSvg(width: number, height: number, mark: Watermark): Buffer {
  const size = Math.max(12, Math.round(Math.min(width, height) * 0.032)),
    pad = Math.round(size * 0.6),
    text = mark.text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!),
    boxW = Math.round(size * 0.6 * mark.text.length + pad * 2),
    boxH = Math.round(size * 1.8);
  const left = mark.position.endsWith("left") ? pad : width - boxW - pad,
    top = mark.position.startsWith("top") ? pad : height - boxH - pad;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect x="${left}" y="${top}" width="${boxW}" height="${boxH}" rx="${Math.round(size * 0.35)}" fill="#000" fill-opacity="0.55"/>` +
      `<text x="${left + boxW / 2}" y="${top + boxH / 2}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" fill="#fff" text-anchor="middle" dominant-baseline="central">${text}</text>` +
      `</svg>`,
  );
}

export class Restorations {
  constructor(private repo: Repository) {}
  private get folder() {
    return path.join(this.repo.root, "restorations");
  }
  private asset(assetId: string) {
    return this.repo.asset(assetId) as { original_path: string; row_id: string; database_id: string; metadata_json: string };
  }
  /** The original as shown (turned and cropped), as PNG. */
  private async original(assetId: string): Promise<Buffer> {
    const asset = this.asset(assetId);
    return (await orientedImage(asset.original_path, assetView(asset.metadata_json))).png().toBuffer();
  }
  /** What a run starts from: the original, or an earlier version of the same image. */
  private async source(assetId: string, baseId?: string | null): Promise<Buffer> {
    if (!baseId) return this.original(assetId);
    const base = this.repo.db.prepare("SELECT file,asset_id FROM restorations WHERE id=?").get(baseId) as { file: string; asset_id: string } | undefined;
    if (!base || base.asset_id !== assetId) throw new Error("Versión no encontrada.");
    return fs.readFile(base.file);
  }

  /** Whether a version is, or was made from, a colourisation. */
  private colourised(id: string | null): boolean {
    for (let n = 0; id && n < 50; n++) {
      const row = this.repo.db.prepare("SELECT task,base_id FROM restorations WHERE id=?").get(id) as { task: string; base_id: string | null } | undefined;
      if (!row) return false;
      if (row.task === "colorize") return true;
      id = row.base_id;
    }
    return false;
  }

  /** What a version is measured against: the version it started from, or the original (also when that version was deleted). */
  private async reference(assetId: string, baseId: string | null): Promise<Buffer> {
    const base = baseId ? (this.repo.db.prepare("SELECT file FROM restorations WHERE id=?").get(baseId) as { file: string } | undefined) : undefined;
    return base ? fs.readFile(base.file).catch(() => this.original(assetId)) : this.original(assetId);
  }

  /** The image or the region to send, as JPEG, and where a region sits. */
  async input(assetId: string, region: Region | null, baseId?: string | null) {
    // Regions are fractions of the image as shown, after any quarter turn.
    const data = await this.source(assetId, baseId);
    const info = await sharp(data).metadata();
    const width = info.width ?? 1,
      height = info.height ?? 1;
    let crop: Crop | null = null;
    let image = sharp(data);
    if (region) {
      const x0 = Math.max(0, region.x - PADDING),
        y0 = Math.max(0, region.y - PADDING),
        x1 = Math.min(1, region.x + region.w + PADDING),
        y1 = Math.min(1, region.y + region.h + PADDING);
      crop = {
        left: Math.round(x0 * width),
        top: Math.round(y0 * height),
        width: Math.max(8, Math.round((x1 - x0) * width)),
        height: Math.max(8, Math.round((y1 - y0) * height)),
      };
      crop.width = Math.min(crop.width, width - crop.left);
      crop.height = Math.min(crop.height, height - crop.top);
      image = image.extract(crop);
    }
    const jpeg = await image.resize(SEND_MAX, SEND_MAX, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    return {
      image: jpeg.toString("base64"),
      mimeType: "image/jpeg" as const,
      crop,
      width,
      height,
      /** Size of what is sent, for the aspect ratio asked of the model. */
      sent: crop ? [crop.width, crop.height] : [width, height],
    };
  }

  /** Saves a result: a whole new image, or the region pasted into its source. */
  async store(input: {
    assetId: string;
    provider: ApiProvider;
    model: string;
    task: RestorationTask;
    prompt: string;
    region: Region | null;
    crop: Crop | null;
    result: string;
    /** The version the run started from; none: the original. */
    baseId?: string | null;
    /** Colourising: keep the source's light and detail, take only the colour. */
    keepDetail?: boolean;
  }): Promise<Restoration> {
    const asset = this.asset(input.assetId);
    const result = Buffer.from(input.result, "base64");
    await sharp(result).metadata().catch(() => {
      throw new Error("La imagen recibida está vacía o dañada.");
    });
    const notes: string[] = [];
    const colour = input.task === "colorize" && input.keepDetail !== false;
    const base = await this.source(input.assetId, input.baseId);
    // Restoring, repairing or sharpening a monochrome photograph keeps its tint,
    // even when the context named colours and the model used them.
    // Never after a colourisation: its colours are the point.
    const toned = ["restore", "repair", "sharpen"].includes(input.task) && !this.colourised(input.baseId ?? null);
    const keepTint = async (source: Buffer, answer: Buffer, width: number, height: number) => {
      const tint = toned ? await monochromeTint(source) : null;
      if (!tint) return answer;
      if ((await colourfulness(answer)) > 14)
        notes.push("Se ha mantenido la tonalidad del original: el modelo había añadido color. Si la foto es en color, usa «Instrucciones propias».");
      return applyTint(answer, tint, width, height);
    };
    let output: Buffer;
    if (input.crop) {
      const { width, height } = input.crop;
      const feather = Math.max(2, Math.round(Math.min(width, height) * 0.06));
      const under = await sharp(base).extract(input.crop).png().toBuffer();
      const lined = await lineUp(under, result, width, height);
      let answer: Buffer = lined ?? (await sharp(result).resize(width, height, { fit: "fill" }).removeAlpha().png().toBuffer());
      if (colour) {
        if (lined) answer = await keepLight(under, lined, width, height);
        else notes.push("El modelo ha movido el contenido de la zona: se guarda su respuesta tal cual, sin conservar el detalle original.");
      } else
        answer = await matchTone(under, await keepTint(under, answer, width, height), width, height, Math.max(feather, Math.round(Math.min(width, height) * 0.08)));
      // A soft-edged mask: the pasted crop fades into its source at its border.
      const mask = await sharp({ create: { width, height, channels: 3, background: "#000" } })
        .composite([
          {
            input: await sharp({
              create: { width: Math.max(1, width - feather * 2), height: Math.max(1, height - feather * 2), channels: 3, background: "#fff" },
            })
              .png()
              .toBuffer(),
            left: feather,
            top: feather,
          },
        ])
        .png()
        .toBuffer()
        .then((png) => sharp(png).blur(Math.max(0.3, feather / 2)).extractChannel(0).raw().toBuffer());
      const patch = await sharp(answer).removeAlpha().joinChannel(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
      output = await sharp(base).composite([{ input: patch, left: input.crop.left, top: input.crop.top }]).png().toBuffer();
    } else {
      // Models answer in their own sizes (1024×1024, 1536×1024…): the version
      // takes its source's size and proportions, so both line up when compared.
      let [w, h]: number[] = [];
      if (input.baseId) {
        const meta = await sharp(base).metadata();
        [w, h] = [meta.width ?? 1, meta.height ?? 1];
      } else {
        const original = await (await imagePipeline(asset.original_path)).metadata();
        [w, h] = shownSize(...orientedSize(original), assetView(asset.metadata_json));
      }
      // A small scan keeps the model's larger answer (in the source's
      // proportions); nothing is ever larger than 4096 px.
      const answered = await sharp(result).metadata();
      const longest = Math.max(Math.max(w, h), Math.max(answered.width ?? 0, answered.height ?? 0));
      const scale = Math.min(4096, longest) / Math.max(w, h);
      [w, h] = [Math.round(w * scale), Math.round(h * scale)];
      // Lined up with its source, so both compare and overlay exactly.
      const lined = await lineUp(base, result, w, h);
      if (colour && lined) output = await keepLight(base, lined, w, h);
      else {
        if (colour) notes.push("El modelo ha cambiado demasiado la imagen para conservar su detalle: se guarda su respuesta tal cual.");
        output = await keepTint(base, lined ?? (await sharp(result).resize(w, h, { fit: "fill" }).png().toBuffer()), w, h);
      }
    }
    const meta = await sharp(output).metadata();
    const id = uuid(),
      file = path.join(this.folder, id + ".png");
    await fs.mkdir(this.folder, { recursive: true });
    await fs.writeFile(file, output);
    this.repo.db
      .prepare(
        "INSERT INTO restorations(id,asset_id,row_id,provider,model,task,prompt,region_json,file,width,height,created_at,base_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        input.assetId,
        asset.row_id,
        input.provider,
        input.model,
        input.task,
        input.prompt,
        input.region ? JSON.stringify(input.region) : null,
        file,
        meta.width ?? 0,
        meta.height ?? 0,
        new Date().toISOString(),
        input.baseId ?? null,
      );
    await this.seal(id);
    return { ...this.get(id), notes, check: await this.check(id) };
  }

  /** Records the SHA-256 of a version's file and of the original it comes from. */
  async seal(id: string) {
    const row = this.repo.db.prepare("SELECT r.file,a.content_hash FROM restorations r JOIN image_assets a ON a.id=r.asset_id WHERE r.id=?").get(id) as
      | { file: string; content_hash: string }
      | undefined;
    if (!row) return;
    this.repo.db.prepare("UPDATE restorations SET sha256=?,source_sha256=? WHERE id=?").run(await sha256File(row.file), row.content_hash, id);
  }

  /** What the record of an image says, field by field, to tell the model. */
  context(assetId: string): { label: string; value: string }[] {
    const asset = this.asset(assetId);
    const columns = this.repo.detail(asset.database_id).columns;
    const title = columns.find((c) => c.type === "title")?.name ?? "Título";
    // In the order of the table's columns; notes on regions last.
    const order = new Map(columns.map((c) => [c.type === "title" ? title : c.name, c.position]));
    return recordEmbeddingParts(columns, this.repo.getRow(asset.row_id))
      .map((p) => ({ label: p.label ?? title, value: p.value.slice(0, 1500) }))
      .sort((a, b) => (order.get(a.label) ?? 1e9) - (order.get(b.label) ?? 1e9));
  }

  /** How closely a version keeps the original's light and shapes (inside its region, if any). */
  async check(id: string): Promise<RestorationCheck> {
    const row = this.repo.db.prepare("SELECT asset_id,file,region_json,base_id,task FROM restorations WHERE id=?").get(id) as
      | { asset_id: string; file: string; region_json: string | null; base_id: string | null; task: string }
      | undefined;
    if (!row) throw new Error("Versión no encontrada.");
    let [before, after] = [await this.reference(row.asset_id, row.base_id), await fs.readFile(row.file)];
    const region = row.region_json ? (JSON.parse(row.region_json) as Region) : null;
    // An upscaled region is saved on its own, enlarged: only its source is cut.
    if (region && row.task === "upscale") before = await this.cut(before, region);
    else if (region) {
      const cut = async (png: Buffer) => {
        const m = await sharp(png).metadata();
        const left = Math.floor(region.x * m.width!),
          top = Math.floor(region.y * m.height!);
        return sharp(png)
          .extract({ left, top, width: Math.max(1, Math.min(m.width! - left, Math.round(region.w * m.width!))), height: Math.max(1, Math.min(m.height! - top, Math.round(region.h * m.height!))) })
          .png()
          .toBuffer();
      };
      [before, after] = await Promise.all([cut(before), cut(after)]);
    }
    const m = await sharp(after).metadata();
    const scale = 256 / Math.max(m.width!, m.height!);
    const w = Math.max(16, Math.round(m.width! * scale)),
      h = Math.max(16, Math.round(m.height! * scale));
    const a = await greyAt(before, w, h);
    const similarity = Math.round(ssim(a, matchHistogram(a, await greyAt(after, w, h)), w, h) * 1000) / 1000;
    return { similarity, level: checkLevel(similarity) };
  }

  /** A region of an image, as PNG. */
  private async cut(png: Buffer, region: Region): Promise<Buffer> {
    const m = await sharp(png).metadata();
    const left = Math.floor(region.x * m.width!),
      top = Math.floor(region.y * m.height!);
    return sharp(png)
      .extract({ left, top, width: Math.max(1, Math.min(m.width! - left, Math.round(region.w * m.width!))), height: Math.max(1, Math.min(m.height! - top, Math.round(region.h * m.height!))) })
      .png()
      .toBuffer();
  }
  /** The version in grey with what changed from the original in red (colour changes do not count). */
  async diff(id: string): Promise<string> {
    const target = path.join(this.folder, id + ".changes.png");
    if (await fs.stat(target).then(() => true, () => false)) return target;
    const row = this.repo.db.prepare("SELECT asset_id,file,base_id,task,region_json FROM restorations WHERE id=?").get(id) as
      | { asset_id: string; file: string; base_id: string | null; task: string; region_json: string | null }
      | undefined;
    if (!row) throw new Error("Versión no encontrada.");
    const m = await sharp(row.file).metadata();
    const scale = Math.min(1, 1600 / Math.max(m.width!, m.height!));
    const w = Math.round(m.width! * scale),
      h = Math.round(m.height! * scale);
    let reference = await this.reference(row.asset_id, row.base_id);
    if (row.task === "upscale" && row.region_json) reference = await this.cut(reference, JSON.parse(row.region_json) as Region);
    const [a, raw] = await Promise.all([greyAt(reference, w, h), greyAt(await fs.readFile(row.file), w, h)]);
    // Tone changes (lighter, more contrast) are not marked: only what changed
    // shape or detail. Fine detail is compared apart from the tone of each
    // area, so a darker dress is not a change but a redrawn eye is.
    const b = matchHistogram(a, raw);
    const radius = Math.max(3, Math.round(Math.max(w, h) / 120));
    const [la, lb] = [boxBlur(a, w, h, radius), boxBlur(b, w, h, radius)];
    const out = Buffer.alloc(w * h * 3);
    for (let i = 0; i < a.length; i++) {
      const change = Math.abs(a[i] - la[i] - (b[i] - lb[i])) + 0.4 * Math.abs(la[i] - lb[i]);
      const grey = 30 + a[i] * 0.45,
        alpha = Math.min(1, Math.max(0, (change - 12) / 30));
      out[i * 3] = Math.round(grey + (255 - grey) * alpha);
      out[i * 3 + 1] = Math.round(grey + (70 - grey) * alpha);
      out[i * 3 + 2] = Math.round(grey + (50 - grey) * alpha);
    }
    await fs.mkdir(this.folder, { recursive: true });
    await sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toFile(target);
    return target;
  }

  /** Versions, newest first; `kind` keeps the restoration workshop's or the upscaler's own. */
  list(input: { assetId?: string; kind?: "restoration" | "upscale" }): Restoration[] {
    const where = [input.assetId ? "asset_id=?" : "", input.kind === "upscale" ? "task='upscale'" : input.kind === "restoration" ? "task<>'upscale'" : ""].filter(Boolean);
    const rows = this.repo.db
      .prepare(
        `SELECT id,asset_id assetId,row_id rowId,provider,model,task,prompt,region_json,params_json,file,width,height,created_at createdAt,base_id baseId FROM restorations ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 500`,
      )
      .all(...(input.assetId ? [input.assetId] : [])) as Row[];
    const titles = new Map(this.repo.hydrate([...new Set(rows.map((r) => r.rowId))]).map((r) => [r.id, r.title]));
    return rows.map(({ region_json, params_json, file: _file, ...r }) => ({
      ...r,
      title: titles.get(r.rowId) ?? "",
      region: region_json ? JSON.parse(region_json) : null,
      params: params_json ? JSON.parse(params_json) : null,
    }));
  }
  get(id: string): Restoration {
    const found = this.list({}).find((r) => r.id === id);
    if (!found) throw new Error("Versión no encontrada.");
    return found;
  }
  file(id: string): string {
    const row = this.repo.db.prepare("SELECT file FROM restorations WHERE id=?").get(id) as { file: string } | undefined;
    if (!row) throw new Error("Versión no encontrada.");
    return row.file;
  }
  async delete(id: string) {
    const file = this.file(id);
    // A version others were made from keeps their history: delete those first.
    if (this.repo.db.prepare("SELECT 1 FROM restorations WHERE base_id=? LIMIT 1").get(id))
      throw new Error("Hay versiones hechas a partir de esta. Elimínalas antes para no romper su historial.");
    this.repo.db.prepare("DELETE FROM restorations WHERE id=?").run(id);
    await fs.rm(file, { force: true });
    await fs.rm(path.join(this.folder, id + ".changes.png"), { force: true });
  }
  /**
   * Writes a copy: with the label drawn on it when asked (only the copy; the
   * saved version is never touched), XMP metadata saying what was done, and
   * optionally the whole history as JSON beside it.
   */
  async export(input: {
    id: string;
    target: string;
    format: "png" | "jpeg";
    watermark: Watermark;
    xmp?: boolean;
    history?: boolean;
    meta?: { label: string; ops: unknown[]; original: string; app: string; sha256: string | null; createdAt: string };
  }) {
    let image = sharp(this.file(input.id));
    if (input.watermark.enabled && input.watermark.text.trim()) {
      const meta = await image.metadata();
      image = image.composite([{ input: watermarkSvg(meta.width!, meta.height!, input.watermark), left: 0, top: 0 }]);
    }
    if (input.xmp !== false && input.meta) image = image.withXmp(xmpPacket(input.meta));
    const bytes = input.format === "jpeg" ? await image.jpeg({ quality: 92 }).toBuffer() : await image.png().toBuffer();
    await fs.writeFile(input.target, bytes);
    if (input.history && input.meta)
      await fs.writeFile(input.target.replace(/\.[a-z]+$/i, "") + ".historial.json", JSON.stringify({ version: input.id, ...input.meta }, null, 2));
  }
}

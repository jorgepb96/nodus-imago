// The workshop's renderer, in a thread of its own: halftone removal and the
// other pixel loops take seconds on large scans and must not hold up the
// collection's queries. It keeps the decoded source and the result after
// each step, so moving a slider only redoes the steps after it.
import { parentPort } from "node:worker_threads";
import fs from "node:fs/promises";
import sharp from "sharp";
import { orientedImage } from "../import/images";
import { apply, decode, detectScreen, encodePng, inspect, measure, type Raw } from "./process";
import type { WorkshopOp } from "../../shared/workshop";
import type { ImageView } from "../../shared/imageRotation";

export type RenderSource = { kind: "asset"; path: string; view: ImageView } | { kind: "file"; path: string };
export type RenderJob = {
  source: RenderSource;
  ops: WorkshopOp[];
  /** Longest side of the result; null: full size (saving). */
  maxSide: number | null;
  output?: string;
  analyze?: boolean;
};

let full: { key: string; img: Raw } | null = null;
const steps = new Map<string, Raw>();
const remember = (key: string, img: Raw) => {
  steps.set(key, img);
  // A handful of steps is enough for one editing session.
  while (steps.size > 8) steps.delete(steps.keys().next().value!);
};

async function source(src: RenderSource): Promise<Raw> {
  const { mtimeMs, ctimeMs, size } = await fs.stat(src.path);
  const key = JSON.stringify([src, mtimeMs, ctimeMs, size]);
  if (full?.key === key) return full.img;
  const pipeline = src.kind === "asset" ? await orientedImage(src.path, src.view) : sharp(src.path);
  const img = await decode(pipeline);
  full = { key, img };
  steps.clear();
  return img;
}
async function resize(img: Raw, maxSide: number): Promise<Raw> {
  if (Math.max(img.w, img.h) <= maxSide) return img;
  return decode(
    sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.w, height: img.h, channels: 3 } }).resize(maxSide, maxSide, {
      fit: "inside",
      kernel: "lanczos3",
    }),
  );
}

/**
 * Runs the operations. Previews are made small, except that the steps up to
 * a halftone removal run at full size (a screen is lost when the image is
 * shrunk, so it can only be removed there) and are kept for the next preview.
 */
async function render(job: RenderJob): Promise<Raw> {
  const base = await source(job.source);
  const key = (k: number, size: number | null) => `${JSON.stringify(job.source)}|${size}|${JSON.stringify(job.ops.slice(0, k))}`;
  let lastScreen = -1;
  job.ops.forEach((op, i) => op.tool === "descreen" && (lastScreen = i));
  // Full-size part: everything up to the last halftone removal (all of it when saving).
  const fullUpTo = job.maxSide === null ? job.ops.length : lastScreen + 1;
  let img = base;
  let k = 0;
  for (let j = fullUpTo; j > 0; j--)
    if (steps.has(key(j, null))) {
      img = steps.get(key(j, null))!;
      k = j;
      break;
    }
  for (; k < fullUpTo; k++) {
    img = await apply(img, job.ops[k], 1);
    if (job.maxSide !== null) remember(key(k + 1, null), img);
  }
  if (job.maxSide === null) return img;
  // Preview part: shrink once, then the remaining steps at preview size.
  const sizeKey = job.maxSide;
  let start = fullUpTo;
  let small: Raw | undefined;
  for (let j = job.ops.length; j >= fullUpTo; j--)
    if (steps.has(key(j, sizeKey))) {
      small = steps.get(key(j, sizeKey));
      start = j;
      break;
    }
  if (!small) {
    small = await resize(img, job.maxSide);
    remember(key(fullUpTo, sizeKey), small);
  }
  const scale = small.w / img.w;
  for (let j = start; j < job.ops.length; j++) {
    small = await apply(small, job.ops[j], scale);
    remember(key(j + 1, sizeKey), small);
  }
  return small;
}

async function renderMessage(message: { id: number; job: RenderJob }) {
  const started = Date.now();
  try {
    const { job } = message;
    if (job.analyze) {
      const base = await source(job.source);
      // The screen is looked for in the middle of the full-size image, where the photograph is.
      const side = Math.min(1536, base.w, base.h);
      const left = Math.floor((base.w - side) / 2),
        top = Math.floor((base.h - side) / 2);
      const crop: Raw = { w: side, h: side, data: new Uint8ClampedArray(side * side * 3) };
      for (let y = 0; y < side; y++) crop.data.set(base.data.subarray(((top + y) * base.w + left) * 3, ((top + y) * base.w + left + side) * 3), y * side * 3);
      const small = await resize(base, 1200);
      parentPort!.postMessage({ id: message.id, ok: true, result: { ...measure(small), ...inspect(small), screen: detectScreen(crop), width: base.w, height: base.h, ms: Date.now() - started } });
      return;
    }
    const img = await render(job);
    if (job.output) await fs.writeFile(job.output, await encodePng(img, job.maxSide === null ? 6 : 1));
    const m = measure(job.maxSide === null ? await resize(img, 1200) : img);
    parentPort!.postMessage({ id: message.id, ok: true, result: { width: img.w, height: img.h, ...m, ms: Date.now() - started } });
  } catch (error) {
    parentPort!.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

// Jobs share a source and a prefix cache. Finish each before the next replaces them.
let queue = Promise.resolve();
parentPort!.on("message", (message: { id: number; job: RenderJob }) => {
  queue = queue.then(() => renderMessage(message));
});

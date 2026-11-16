// How a researcher has framed an image in Imago: quarter turns
// (`imagoRotation`, clockwise degrees) and a crop (`imagoCrop`, fractions of
// the turned image), both kept in the asset's metadata. The original file is
// never touched: thumbnails, previews, the semantic index and every AI request
// are derived from the original, oriented by its EXIF tag, then turned, then
// cropped. Annotations stay stored in the frame of the original (oriented by
// EXIF only) and are translated to and from what is shown.

export type Rotation = 0 | 90 | 180 | 270;
export type RotationDirection = "left" | "right";
export type Region = { x: number; y: number; w: number; h: number };
export type ImageView = { rotation: Rotation; crop: Region | null };

/** The smallest crop side, as a fraction of the image. */
export const MIN_CROP = 0.02;

const parse = (metadata: unknown): Record<string, unknown> => {
  let value: unknown = metadata;
  if (typeof metadata === "string") {
    try {
      value = JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
};

/** The stored rotation, or 0 for anything that is not a quarter turn. */
export function assetRotation(metadata: unknown): Rotation {
  const angle = parse(metadata).imagoRotation;
  return angle === 90 || angle === 180 || angle === 270 ? angle : 0;
}

/** A crop that lies inside the image and is not degenerate, or null. */
export function validCrop(value: unknown): Region | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, w, h } = value as Record<string, unknown>;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const crop = { x: x as number, y: y as number, w: w as number, h: h as number };
  if (crop.x < 0 || crop.y < 0 || crop.w < MIN_CROP || crop.h < MIN_CROP) return null;
  if (crop.x + crop.w > 1 + 1e-9 || crop.y + crop.h > 1 + 1e-9) return null;
  // A crop covering the whole image is no crop.
  if (crop.x < 1e-6 && crop.y < 1e-6 && crop.w > 1 - 1e-6 && crop.h > 1 - 1e-6) return null;
  return crop;
}

export function assetView(metadata: unknown): ImageView {
  const parsed = parse(metadata);
  return { rotation: assetRotation(parsed), crop: validCrop(parsed.imagoCrop) };
}

/** The rotation after one more quarter turn to the left or to the right. */
export function turn(rotation: Rotation, direction: RotationDirection): Rotation {
  return (((rotation + (direction === "right" ? 90 : 270)) % 360) as Rotation);
}

/**
 * A region given as fractions of an image, after the image turns a quarter
 * to the left or right, so it keeps marking the same part.
 */
export function turnRegion<T extends Region>(region: T, direction: RotationDirection): T {
  const { x, y, w, h } = region;
  return direction === "right"
    ? { ...region, x: 1 - y - h, y: x, w: h, h: w }
    : { ...region, x: y, y: 1 - x - w, w: h, h: w };
}

const turnBy = <T extends Region>(region: T, rotation: number): T => {
  let turned = region;
  for (let i = 0; i < (((rotation % 360) + 360) % 360) / 90; i++) turned = turnRegion(turned, "right");
  return turned;
};

/**
 * A region of the original (oriented by EXIF) as shown with this view, or
 * null when the crop leaves it out. Parts outside the crop are clipped.
 */
export function toShown<T extends Region>(region: T, view: ImageView): T | null {
  const turned = turnBy(region, view.rotation);
  if (!view.crop) return turned;
  const c = view.crop;
  const x0 = Math.max(0, (turned.x - c.x) / c.w),
    y0 = Math.max(0, (turned.y - c.y) / c.h),
    x1 = Math.min(1, (turned.x + turned.w - c.x) / c.w),
    y1 = Math.min(1, (turned.y + turned.h - c.y) / c.h);
  if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return null;
  return { ...turned, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A region marked on the shown image, in the frame of the original. */
export function fromShown<T extends Region>(region: T, view: ImageView): T {
  const c = view.crop;
  const uncropped = c
    ? { ...region, x: c.x + region.x * c.w, y: c.y + region.y * c.h, w: region.w * c.w, h: region.h * c.h }
    : region;
  return turnBy(uncropped, 360 - view.rotation);
}

/** Pixel size shown for an original of this oriented size. */
export function shownSize(width: number, height: number, view: ImageView): [number, number] {
  const [w, h] = view.rotation % 180 ? [height, width] : [width, height];
  return view.crop
    ? [Math.max(1, Math.round(w * view.crop.w)), Math.max(1, Math.round(h * view.crop.h))]
    : [w, h];
}

/** A short, file-name-safe key of the view; empty for the original view. */
export function viewKey(view: ImageView): string {
  const parts: string[] = [];
  if (view.rotation) parts.push(`r${view.rotation}`);
  if (view.crop)
    parts.push(
      "c" + [view.crop.x, view.crop.y, view.crop.w, view.crop.h].map((n) => Math.round(n * 10000)).join("_"),
    );
  return parts.join("-");
}

/**
 * The cache-busting revision of an asset's derived images: a relinked
 * original and each view get images of their own.
 */
export function assetRevision(metadata: unknown): string | undefined {
  const parsed = parse(metadata);
  const relink = parsed.imagoRelinkRevision;
  const parts = [typeof relink === "string" ? relink : "", viewKey(assetView(parsed))].filter(Boolean);
  return parts.length ? parts.join("-") : undefined;
}

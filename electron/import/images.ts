import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID as uuid } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import exifr from "exifr";
import ExifReader from "exifreader";
import { Repository, now } from "../db/repository";
import { matchImages } from "../../shared/imageMatching";
import type { ImageView } from "../../shared/imageRotation";
import type { ImagePlan } from "../../shared/imago";

// libvips' file cache can keep a decoded source locked after the operation on
// Windows, preventing users from moving/deleting linked originals or restoring.
if (process.platform === "win32") sharp.cache({ files: 0 });

export const IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "tif",
  "tiff",
  "bmp",
  "heic",
  "heif",
];
// sharp's bundled libheif has no HEVC decoder. HEIC/HEIF are decoded by the
// small libheif WASM bundle in imagePipeline, then fed to sharp as raw RGBA.
export const isImage = (p: string) =>
  IMAGE_EXTENSIONS.includes(path.extname(p).slice(1).toLowerCase());
export async function hashFile(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
/** Write a derived image through a temporary file so a crash never leaves a
 * truncated thumbnail that the UI would treat as valid. */
export async function writeAtomicImage(image: Sharp, target: string) {
  const temporary = target + "." + uuid() + ".tmp";
  try {
    await image.toFile(temporary);
    await fsp.rename(temporary, target);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}
export async function scanImages(roots: string[]): Promise<string[]> {
  const files: string[] = [];
  async function scan(file: string) {
    const stat = await fsp.lstat(file);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for await (const entry of await fsp.opendir(file))
        await scan(path.join(file, entry.name));
    } else if (stat.isFile() && isImage(file)) files.push(file);
    if (files.length > 100000)
      throw new Error("Importa como máximo 100.000 imágenes por lote.");
  }
  for (const file of roots) await scan(file);
  return files;
}
export type ImageImportPayload = {
  databaseId: string;
  columnId: string;
  storage: "copy" | "link";
  createUnmatched: boolean;
  files: { path: string; rowId: string | null; originalName?: string }[];
};
export class Images {
  plans = new Map<
    string,
    {
      databaseId: string;
      columnId: string;
      files: { token: string; name: string; path: string }[];
    }
  >();
  constructor(public repo: Repository) {}
  async preview(
    databaseId: string,
    paths: string[],
    columnId?: string,
    referenceColumnId?: string,
    pattern?: string,
    partial?: boolean,
  ): Promise<ImagePlan> {
    const detail = this.repo.detail(databaseId);
    const column = columnId
      ? detail.columns.find((c) => c.id === columnId)
      : detail.columns.find(
          (c) => c.type === "attachment" || c.type === "files",
        );
    if (column && !["attachment", "files"].includes(column.type))
      throw new Error("Selecciona una propiedad de archivos.");
    const token = uuid(),
      files = (await scanImages(paths)).map((file) => ({
        token: uuid(),
        name: path.basename(file),
        path: file,
      }));
    if (this.plans.size > 10)
      this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(token, { databaseId, columnId: column?.id ?? "", files });
    return this.rematch(token, referenceColumnId, pattern, partial);
  }
  rematch(
    token: string,
    referenceColumnId?: string,
    pattern?: string,
    partial?: boolean,
  ): ImagePlan {
    const plan = this.plans.get(token);
    if (!plan)
      throw new Error(
        "La previsualización caducó. Selecciona las imágenes otra vez.",
      );
    const detail = this.repo.detail(plan.databaseId),
      column =
        detail.columns.find((c) => c.id === referenceColumnId) ??
        detail.columns.find((c) => c.type === "title");
    if (
      referenceColumnId &&
      referenceColumnId !== "__record_id__" &&
      !detail.columns.some((c) => c.id === referenceColumnId)
    )
      throw new Error("Columna de correspondencia no válida.");
    const rows = this.repo.db
      .prepare(
        "SELECT r.id rowId,c.value_text refValue FROM db_rows r LEFT JOIN db_cells c ON c.row_id=r.id AND c.column_id=? WHERE r.database_id=?",
      )
      .all(column?.id ?? "", plan.databaseId) as {
      rowId: string;
      refValue: string | null;
    }[];
    if (referenceColumnId === "__record_id__")
      for (const row of rows) row.refValue = row.rowId;
    return {
      token,
      files: plan.files.length,
      columnId: plan.columnId || undefined,
      matches: matchImages(plan.files, rows, pattern, partial),
    };
  }
  enqueue(
    token: string,
    storage: "copy" | "link",
    createUnmatched: boolean,
    assignments: { pathToken: string; rowId: string | null }[],
    requestedColumnId?: string,
  ) {
    const plan = this.plans.get(token);
    if (!plan) throw new Error("La previsualización caducó.");
    if (
      new Set(assignments.map((a) => a.pathToken)).size !== assignments.length
    )
      throw new Error("Archivo repetido en las asignaciones.");
    const files = assignments
      .map((a) => {
        const file = plan.files.find((f) => f.token === a.pathToken);
        if (!file) throw new Error("Archivo no autorizado.");
        if (a.rowId && this.repo.getRow(a.rowId).databaseId !== plan.databaseId)
          throw new Error("El registro pertenece a otra base de datos.");
        return { path: file.path, rowId: a.rowId };
      })
      .filter((f) => f.rowId || createUnmatched);
    let columnId = requestedColumnId || plan.columnId;
    if (columnId) {
      const column = this.repo
        .detail(plan.databaseId)
        .columns.find((candidate) => candidate.id === columnId);
      if (!column || !["attachment", "files"].includes(column.type))
        throw new Error("Selecciona una propiedad de archivos de esta base.");
    } else {
      columnId = this.repo.addColumn(
        plan.databaseId,
        "Imágenes",
        "attachment",
      ).id;
    }
    const payload: ImageImportPayload = {
      databaseId: plan.databaseId,
      columnId,
      storage,
      createUnmatched,
      files,
    };
    const id = this.repo.newJob("images", payload, files.length);
    this.plans.delete(token);
    return id;
  }
  async importOne(
    payload: ImageImportPayload,
    index: number,
  ): Promise<"imported" | "skipped"> {
    const prepared = await this.prepareOne(payload, index);
    return prepared === "skipped" ? prepared : this.commitOne(payload, prepared);
  }
  /** Whether this image is already in the record (or, unmatched, in the database). */
  private exists(payload: ImageImportPayload, file: ImageImportPayload["files"][number], hash: string) {
    return !!(file.rowId
      ? this.repo.db
          .prepare(
            "SELECT id FROM image_assets WHERE row_id=? AND column_id=? AND content_hash=?",
          )
          .get(file.rowId, payload.columnId, hash)
      : this.repo.db
          .prepare(
            "SELECT id FROM image_assets WHERE database_id=? AND content_hash=?",
          )
          .get(payload.databaseId, hash));
  }
  /**
   * The slow part of importing an image, which several images may do at once:
   * hash, previews, metadata and the managed copy. Nothing is recorded yet.
   */
  async prepareOne(
    payload: ImageImportPayload,
    index: number,
  ): Promise<PreparedImage | "skipped"> {
    const file = payload.files[index],
      stat = await fsp.stat(file.path);
    if (!stat.isFile()) throw new Error("El original no es un archivo.");
    const hash = await hashFile(file.path);
    if (this.exists(payload, file, hash)) return "skipped";
    const image = await imagePipeline(file.path),
      meta = await image.metadata();
    if (!meta.width || !meta.height)
      throw new Error("No se han podido leer las dimensiones de la imagen.");
    const thumbnail = path.join(this.repo.root, "thumbnails", hash + ".webp");
    if (!fs.existsSync(thumbnail))
      await writeAtomicImage(
        image
          .clone()
          .rotate()
          .resize(480, 480, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 78 }),
        thumbnail,
      );
    const preview = path.join(
      this.repo.root,
      "thumbnails",
      hash + "-preview.webp",
    );
    if (!fs.existsSync(preview))
      await writeAtomicImage(
        image
          .clone()
          .rotate()
          .resize(2200, 2200, { fit: "inside", withoutEnlargement: true })
          // Effort 2 encodes in half the time for a file ~2 % larger.
          .webp({ quality: 88, effort: 2 }),
        preview,
      );
    let metadata: Record<string, unknown> = {};
    const heif = [".heic", ".heif"].includes(
      path.extname(file.path).toLowerCase(),
    );
    try {
      metadata =
        (await exifr.parse(file.path, {
          pick: [
            "Make",
            "Model",
            "DateTimeOriginal",
            "CreateDate",
            "Artist",
            "Copyright",
            "GPSLatitude",
            "GPSLongitude",
            "Orientation",
          ],
        })) ?? {};
    } catch {
      /* Some formats carry no EXIF. */
    }
    // exifr does not read the HEIF item metadata. ExifReader understands the
    // Exif item in HEIC/HEIF, so merge it even when exifr returned a partial
    // result (for example only Orientation).
    if (!Object.keys(metadata).length || heif) {
      try {
        const tags = await ExifReader.load(file.path);
        const description = (key: string) =>
          typeof tags[key]?.description === "string"
            ? tags[key].description
            : undefined;
        const value = (key: string) => tags[key]?.value as unknown,
          fallback = Object.fromEntries(
            Object.entries({
              Make: description("Make"),
              Model: description("Model"),
              DateTimeOriginal: description("DateTimeOriginal"),
              CreateDate: description("DateTime") ?? description("CreateDate"),
              Artist: description("Artist"),
              Copyright: description("Copyright"),
              GPSLatitude: value("GPSLatitude"),
              GPSLongitude: value("GPSLongitude"),
              Orientation: value("Orientation"),
            }).filter(([, entry]) => entry !== undefined && entry !== ""),
          );
        metadata = { ...fallback, ...metadata };
      } catch {
        /* Some formats carry no EXIF. */
      }
    }
    let original = file.path;
    if (payload.storage === "copy") {
      original = path.join(
        this.repo.root,
        "originals",
        hash + path.extname(file.path).toLowerCase(),
      );
      if (!fs.existsSync(original)) {
        const temp = path.join(this.repo.root, "staging", uuid());
        await fsp.copyFile(file.path, temp);
        if ((await hashFile(temp)) !== hash) {
          await fsp.unlink(temp);
          throw new Error("El original cambió durante la copia.");
        }
        await fsp.rename(temp, original);
      } else if ((await hashFile(original)) !== hash)
        throw new Error(
          "La copia gestionada no supera la verificación de integridad.",
        );
    }
    return {
      file,
      hash,
      size: stat.size,
      width: meta.width,
      height: meta.height,
      metadata,
      original,
    };
  }
  /**
   * Records a prepared image. Imports commit in the order of their files, so
   * new records keep that order however the preparations finished.
   */
  commitOne(payload: ImageImportPayload, prepared: PreparedImage): "imported" | "skipped" {
    const { file, hash, original, metadata } = prepared;
    return this.repo.db.transaction(() => {
      // Two copies of one image prepared at once: only the first is recorded.
      if (this.exists(payload, file, hash)) return "skipped" as const;
      const rowId =
        file.rowId ?? this.repo.createRow(payload.databaseId, false).id;
      if (!file.rowId) {
        const title = this.repo
          .detail(payload.databaseId)
          .columns.find((c) => c.type === "title");
        if (title)
          this.repo.rawCell(
            rowId,
            title.id,
            path.basename(file.originalName ?? file.path, path.extname(file.originalName ?? file.path)),
            title.type,
          );
      }
      const position = (
        this.repo.db
          .prepare(
            "SELECT coalesce(max(position),-1)+1 n FROM image_assets WHERE row_id=?",
          )
          .get(rowId) as any
      ).n;
      this.repo.db
        .prepare(
          "INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          uuid(),
          payload.databaseId,
          rowId,
          payload.columnId,
          file.originalName ?? path.basename(file.path),
          original,
          payload.storage === "copy" ? 1 : 0,
          hash,
          prepared.size,
          prepared.width,
          prepared.height,
          JSON.stringify(metadata),
          null,
          position,
          now(),
        );
      this.repo.touchRows([rowId]);
      this.repo.indexRow(rowId);
      return "imported" as const;
    })();
  }
}

export type PreparedImage = {
  file: ImageImportPayload["files"][number];
  hash: string;
  size: number;
  width: number;
  height: number;
  metadata: Record<string, unknown>;
  original: string;
};
const ORIGINAL_VIEW: ImageView = { rotation: 0, crop: null };
/**
 * The image as the researcher sees it: oriented by its EXIF tag, then turned
 * and cropped as framed in Imago. Callers must not rotate it again (sharp
 * keeps only one explicit rotation per pipeline).
 */
export async function orientedImage(file: string, view: ImageView = ORIGINAL_VIEW): Promise<Sharp> {
  const source = await imagePipeline(file);
  const image = source.clone().rotate();
  if (view.rotation) image.rotate(view.rotation);
  if (!view.crop) return image;
  const meta = await source.metadata();
  const oriented: [number, number] =
    (meta.orientation ?? 1) >= 5 ? [meta.height ?? 1, meta.width ?? 1] : [meta.width ?? 1, meta.height ?? 1];
  const [width, height] = view.rotation % 180 ? [oriented[1], oriented[0]] : oriented;
  const left = Math.min(width - 1, Math.max(0, Math.round(view.crop.x * width))),
    top = Math.min(height - 1, Math.max(0, Math.round(view.crop.y * height)));
  return image.extract({
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(view.crop.w * width))),
    height: Math.max(1, Math.min(height - top, Math.round(view.crop.h * height))),
  });
}
/** Width and height of an original as shown after its EXIF orientation. */
export async function orientedDimensions(file: string): Promise<[number, number]> {
  const meta = await (await imagePipeline(file)).metadata();
  return (meta.orientation ?? 1) >= 5 ? [meta.height ?? 1, meta.width ?? 1] : [meta.width ?? 1, meta.height ?? 1];
}
export async function imagePipeline(file: string): Promise<Sharp> {
  // Native backups store originals by hash, without an extension. Detect the
  // two formats needing our own decoder from their bytes as well as the name.
  const handle = await fsp.open(file, "r");
  const header = Buffer.alloc(64);
  let length: number;
  try {
    length = (await handle.read(header, 0, header.length, 0)).bytesRead;
  } finally {
    await handle.close();
  }
  const extension = path.extname(file).toLowerCase(),
    heif =
      [".heic", ".heif"].includes(extension) ||
      (header.toString("ascii", 4, 8) === "ftyp" &&
        /heic|heix|hevc|hevx|mif1|msf1/.test(
          header.toString("ascii", 8, length),
        ));
  if (extension === ".bmp" || header.toString("ascii", 0, 2) === "BM") {
    const bmp = await import("bmp-js");
    const data = bmp.decode(await fsp.readFile(file));
    // bmp-js emits ABGR, while sharp expects RGBA.
    const rgba = Buffer.alloc(data.data.length);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = data.data[i + 3];
      rgba[i + 1] = data.data[i + 2];
      rgba[i + 2] = data.data[i + 1];
      rgba[i + 3] = 255;
    }
    return sharp(rgba, {
      raw: { width: data.width, height: data.height, channels: 4 },
      limitInputPixels: 100_000_000,
    });
  }
  if (heif) {
    const { default: decode } = await import("heic-decode");
    const data = await decode({ buffer: await fsp.readFile(file) });
    return sharp(Buffer.from(data.data), {
      raw: { width: data.width, height: data.height, channels: 4 },
      limitInputPixels: 100_000_000,
    });
  }
  return sharp(file, { limitInputPixels: 100_000_000, failOn: "error" });
}

/** Every local runtime receives the same oriented RGB PNG, regardless of its
 * own codec support. Derived query images live only for the request and are
 * removed even when inference fails or is cancelled. Originals stay intact. */
export async function withInferenceImage<T>(
  root: string,
  original: string,
  work: (file: string) => Promise<T>,
  view: ImageView = ORIGINAL_VIEW,
): Promise<T> {
  const file = path.join(root, "staging", uuid() + ".png");
  try {
    const image = await orientedImage(original, view);
    await writeAtomicImage(
      image
        .resize(2200, 2200, { fit: "inside", withoutEnlargement: true })
        .toColourspace("srgb")
        .removeAlpha()
        .png(),
      file,
    );
    return await work(file);
  } finally {
    await fsp.rm(file, { force: true });
  }
}

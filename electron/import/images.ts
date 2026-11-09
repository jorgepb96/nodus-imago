import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID as uuid } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import exifr from "exifr";
import ExifReader from "exifreader";
import { Repository, now } from "../db/repository";
import { matchImages } from "../../shared/imageMatching";
import type { ImagePlan } from "../../shared/imago";

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
  files: { path: string; rowId: string | null }[];
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
    const file = payload.files[index],
      stat = await fsp.stat(file.path);
    if (!stat.isFile()) throw new Error("El original no es un archivo.");
    const hash = await hashFile(file.path);
    const existing = payload.files[index].rowId
      ? this.repo.db
          .prepare(
            "SELECT id FROM image_assets WHERE row_id=? AND column_id=? AND content_hash=?",
          )
          .get(file.rowId, payload.columnId, hash)
      : this.repo.db
          .prepare(
            "SELECT id FROM image_assets WHERE database_id=? AND content_hash=?",
          )
          .get(payload.databaseId, hash);
    if (existing) return "skipped";
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
          .webp({ quality: 88 }),
        preview,
      );
    let metadata: Record<string, unknown> = {};
    const heif = [".heic", ".heif"].includes(path.extname(file.path).toLowerCase());
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
    this.repo.db.transaction(() => {
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
            path.basename(file.path, path.extname(file.path)),
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
          path.basename(file.path),
          original,
          payload.storage === "copy" ? 1 : 0,
          hash,
          stat.size,
          meta.width,
          meta.height,
          JSON.stringify(metadata),
          null,
          position,
          now(),
        );
      this.repo.indexRow(rowId);
      // Commit item and cursor together: restart cannot create a second record.
    })();
    return "imported";
  }
}
export async function imagePipeline(file: string): Promise<Sharp> {
  if (path.extname(file).toLowerCase() === ".bmp") {
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
  if ([".heic", ".heif"].includes(path.extname(file).toLowerCase())) {
    const { default: decode } = await import("heic-decode");
    const data = await decode({ buffer: await fsp.readFile(file) });
    return sharp(Buffer.from(data.data), {
      raw: { width: data.width, height: data.height, channels: 4 },
      limitInputPixels: 100_000_000,
    });
  }
  return sharp(file, { limitInputPixels: 100_000_000, failOn: "error" });
}

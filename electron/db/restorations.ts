// Versions made in the restoration workshop. The original file is only read:
// a restored version is a new PNG in <collection>/restorations, recorded with
// the provider, model and instructions that produced it. Restoring a region
// sends only that crop and pastes the result back with a soft edge, so the
// rest of the image stays exactly as it was.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import sharp from "sharp";
import type { Repository } from "./repository";
import type { ApiProvider } from "../../shared/aiConfig";
import type { Restoration, RestorationTask, Watermark } from "../../shared/restoration";
import { imagePipeline, orientedImage } from "../import/images";
import { assetView, shownSize } from "../../shared/imageRotation";

/** Longest side sent to a provider. */
const SEND_MAX = 2048;
/** Extra margin around a region, so the model sees its surroundings. */
const PADDING = 0.04;
type Region = { x: number; y: number; w: number; h: number };
type Row = Omit<Restoration, "region" | "title"> & { region_json: string | null; file: string };

/** Width and height as displayed, after the EXIF rotation. */
function orientedSize(meta: { width?: number; height?: number; orientation?: number }): [number, number] {
  const w = meta.width ?? 1,
    h = meta.height ?? 1;
  return (meta.orientation ?? 1) >= 5 ? [h, w] : [w, h];
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

  /** The image or the region to send, as JPEG, and where a region sits. */
  async input(assetId: string, region: Region | null) {
    const asset = this.repo.asset(assetId) as { original_path: string; metadata_json: string };
    // Regions are fractions of the image as shown, after any quarter turn.
    const source = await orientedImage(asset.original_path, assetView(asset.metadata_json));
    const { data, info } = await source.png().toBuffer({ resolveWithObject: true });
    let crop: { left: number; top: number; width: number; height: number } | null = null;
    let image = sharp(data);
    if (region) {
      const x0 = Math.max(0, region.x - PADDING),
        y0 = Math.max(0, region.y - PADDING),
        x1 = Math.min(1, region.x + region.w + PADDING),
        y1 = Math.min(1, region.y + region.h + PADDING);
      crop = {
        left: Math.round(x0 * info.width),
        top: Math.round(y0 * info.height),
        width: Math.max(8, Math.round((x1 - x0) * info.width)),
        height: Math.max(8, Math.round((y1 - y0) * info.height)),
      };
      crop.width = Math.min(crop.width, info.width - crop.left);
      crop.height = Math.min(crop.height, info.height - crop.top);
      image = image.extract(crop);
    }
    const jpeg = await image.resize(SEND_MAX, SEND_MAX, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    return { image: jpeg.toString("base64"), mimeType: "image/jpeg" as const, crop, width: info.width, height: info.height };
  }

  /** Saves a result: a whole new image, or the region pasted into the original. */
  async store(input: {
    assetId: string;
    provider: ApiProvider;
    model: string;
    task: RestorationTask;
    prompt: string;
    region: Region | null;
    crop: { left: number; top: number; width: number; height: number } | null;
    result: string;
  }): Promise<Restoration> {
    const asset = this.repo.asset(input.assetId) as { original_path: string; row_id: string; metadata_json: string };
    const view = assetView(asset.metadata_json);
    const result = Buffer.from(input.result, "base64");
    await sharp(result).metadata().catch(() => {
      throw new Error("La imagen recibida está vacía o dañada.");
    });
    let output: Buffer;
    if (input.crop) {
      const base = await (await orientedImage(asset.original_path, view)).png().toBuffer();
      const { width, height } = input.crop;
      const feather = Math.max(2, Math.round(Math.min(width, height) * 0.06));
      // A soft-edged mask: the pasted crop fades into the original at its border.
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
      const patch = await sharp(result)
        .resize(width, height, { fit: "fill" })
        .removeAlpha()
        .joinChannel(mask, { raw: { width, height, channels: 1 } })
        .png()
        .toBuffer();
      output = await sharp(base).composite([{ input: patch, left: input.crop.left, top: input.crop.top }]).png().toBuffer();
    } else {
      // Models answer in their own sizes (1024×1024, 1536×1024…): the version
      // takes the original's size and proportions, so both line up when compared.
      const original = await (await imagePipeline(asset.original_path)).metadata();
      const [w, h] = shownSize(...orientedSize(original), view);
      const scale = Math.min(1, 4096 / Math.max(w, h));
      output = await sharp(result)
        .resize(Math.round(w * scale), Math.round(h * scale), { fit: "fill" })
        .png()
        .toBuffer();
    }
    const meta = await sharp(output).metadata();
    const id = uuid(),
      file = path.join(this.folder, id + ".png");
    await fs.mkdir(this.folder, { recursive: true });
    await fs.writeFile(file, output);
    this.repo.db
      .prepare("INSERT INTO restorations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
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
      );
    return this.get(id);
  }

  list(input: { assetId?: string }): Restoration[] {
    const rows = this.repo.db
      .prepare(
        `SELECT id,asset_id assetId,row_id rowId,provider,model,task,prompt,region_json,file,width,height,created_at createdAt FROM restorations ${input.assetId ? "WHERE asset_id=?" : ""} ORDER BY created_at DESC LIMIT 500`,
      )
      .all(...(input.assetId ? [input.assetId] : [])) as Row[];
    const titles = new Map(this.repo.hydrate([...new Set(rows.map((r) => r.rowId))]).map((r) => [r.id, r.title]));
    return rows.map(({ region_json, file: _file, ...r }) => ({
      ...r,
      title: titles.get(r.rowId) ?? "",
      region: region_json ? JSON.parse(region_json) : null,
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
    this.repo.db.prepare("DELETE FROM restorations WHERE id=?").run(id);
    await fs.rm(file, { force: true });
  }
  /** Writes a copy, with the watermark when it is on. */
  async export(input: { id: string; target: string; format: "png" | "jpeg"; watermark: Watermark }) {
    let image = sharp(this.file(input.id));
    if (input.watermark.enabled && input.watermark.text.trim()) {
      const meta = await image.metadata();
      image = image.composite([{ input: watermarkSvg(meta.width!, meta.height!, input.watermark), left: 0, top: 0 }]);
    }
    const bytes = input.format === "jpeg" ? await image.jpeg({ quality: 92 }).toBuffer() : await image.png().toBuffer();
    await fs.writeFile(input.target, bytes);
  }
}

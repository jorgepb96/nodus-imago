// Figure plates for academic work, an article or a book: each record's main image with a
// numbered caption built from the citation template, and a list of figures.
// The worker prepares the images and captions; the main process prints the
// page to PDF in a hidden window with JavaScript disabled.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Repository } from "../db/repository";
import { imagePipeline } from "../import/images";
import { renderCitation } from "../../shared/citation";

export type PlateItem = { file: string; caption: string; width: number; height: number };

export async function preparePlates(repo: Repository, input: { rowIds: string[]; template: string }): Promise<{ folder: string; items: PlateItem[] }> {
  const folder = path.join(repo.root, "staging", "plates-" + randomUUID());
  await fs.mkdir(folder, { recursive: true });
  const rows = repo.hydrate(input.rowIds);
  const columnsByDb = new Map<string, ReturnType<Repository["detail"]>["columns"]>();
  const items: PlateItem[] = [];
  for (const row of rows) {
    const image = row.images.find((i) => i.width > 0);
    if (!image) continue;
    if (!columnsByDb.has(row.databaseId)) columnsByDb.set(row.databaseId, repo.detail(row.databaseId).columns);
    const asset = repo.asset(image.id) as { original_path: string };
    const file = path.join(folder, `${items.length + 1}.jpg`);
    const info = await (await imagePipeline(asset.original_path))
      .rotate()
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(file);
    items.push({ file, caption: renderCitation(input.template, columnsByDb.get(row.databaseId)!, row) || row.title, width: info.width, height: info.height });
  }
  return { folder, items };
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** The printable page: one figure per page, then the list of figures. */
export function platesHtml(input: { title: string; label: string; listTitle: string; start: number; items: PlateItem[] }): string {
  const figures = input.items
    .map(
      (item, i) =>
        `<figure><img src="${escape(path.basename(item.file))}" alt=""><figcaption><b>${escape(input.label)} ${input.start + i}.</b> ${escape(item.caption)}</figcaption></figure>`,
    )
    .join("\n");
  const list = input.items.map((item, i) => `<li><b>${escape(input.label)} ${input.start + i}.</b> ${escape(item.caption)}</li>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(input.title)}</title><style>
@page { size: A4; margin: 18mm 16mm; }
body { font-family: Georgia, "Times New Roman", serif; color: #111; }
h1 { font-size: 20pt; font-weight: normal; margin: 0 0 10mm; }
figure { margin: 0; page-break-after: always; break-after: page; display: flex; flex-direction: column; align-items: center; }
figure img { max-width: 100%; max-height: 225mm; object-fit: contain; }
figcaption { margin-top: 5mm; font-size: 10.5pt; line-height: 1.45; text-align: left; width: 100%; }
h2 { font-size: 14pt; font-weight: normal; }
ol { padding-left: 0; list-style: none; font-size: 10pt; line-height: 1.5; }
li { margin-bottom: 2mm; }
</style></head><body>${input.title ? `<h1>${escape(input.title)}</h1>` : ""}
${figures}
<h2>${escape(input.listTitle)}</h2><ol>${list}</ol></body></html>`;
}

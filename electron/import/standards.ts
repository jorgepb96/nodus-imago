// Standard formats: annotations out as W3C Web Annotations, and records in
// from Tropy (its JSON-LD export: metadata, tags, notes, photos and their
// selections) and from IIIF Presentation manifests or collections (v2, v3).
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Repository } from "../db/repository";
import type { Images } from "./images";
import { Annotations } from "../db/annotations";
import { buildCsvImportPlan } from "../../shared/databaseCsv";
import type { DatabaseColumnType } from "../../shared/databases";
import { historicalDateCoverage } from "../../shared/historicalDate";

// --- W3C Web Annotation export ------------------------------------------------

export function annotationsW3c(repo: Repository, databaseId: string) {
  const database = repo.detail(databaseId).database;
  const rows = repo.db
    .prepare(
      `SELECT n.id,n.x,n.y,n.w,n.h,n.note,n.tags_json,n.created_at,n.updated_at,a.file_name,a.content_hash,r.id row_id
       FROM image_annotations n JOIN image_assets a ON a.id=n.asset_id JOIN db_rows r ON r.id=n.row_id WHERE r.database_id=? ORDER BY n.created_at`,
    )
    .all(databaseId) as {
    id: string; x: number; y: number; w: number; h: number; note: string; tags_json: string;
    created_at: string; updated_at: string; file_name: string; content_hash: string; row_id: string;
  }[];
  const titles = new Map(repo.hydrate([...new Set(rows.map((r) => r.row_id))]).map((r) => [r.id, r.title]));
  const pct = (n: number) => Math.round(n * 10000) / 100;
  const items = rows.map((r) => ({
    id: `urn:uuid:${r.id}`,
    type: "Annotation",
    motivation: "describing",
    created: r.created_at,
    modified: r.updated_at,
    body: [
      ...(r.note ? [{ type: "TextualBody", value: r.note, purpose: "describing", format: "text/plain" }] : []),
      ...(JSON.parse(r.tags_json) as string[]).map((tag) => ({ type: "TextualBody", value: tag, purpose: "tagging" })),
    ],
    target: {
      // The file is identified by its content (SHA-256) and name, never by a local path.
      source: { id: `urn:sha256:${r.content_hash}`, type: "Image", label: r.file_name, partOf: { id: `urn:imago:record:${r.row_id}`, label: titles.get(r.row_id) ?? "" } },
      selector: { type: "FragmentSelector", conformsTo: "http://www.w3.org/TR/media-frags/", value: `xywh=percent:${pct(r.x)},${pct(r.y)},${pct(r.w)},${pct(r.h)}` },
    },
  }));
  return {
    "@context": "http://www.w3.org/ns/anno.jsonld",
    id: `urn:imago:annotations:${databaseId}`,
    type: "AnnotationCollection",
    label: database.name,
    total: items.length,
    first: { type: "AnnotationPage", items },
  };
}

// --- Shared: create a database from records ------------------------------------

type Incoming = {
  title: string;
  fields: Record<string, string>;
  tags: string[];
  notes: string[];
  photos: { source: string; name: string; selections: { x: number; y: number; w: number; h: number; note: string }[] }[];
};
const LABELS: Record<string, string> = {
  title: "Título", date: "Fecha", creator: "Autor", description: "Descripción", source: "Fuente", rights: "Derechos",
  type: "Tipo", identifier: "Identificador", subject: "Tema", coverage: "Lugar", publisher: "Editor",
  contributor: "Colaborador", format: "Formato", language: "Idioma", relation: "Relación", box: "Caja", folder: "Carpeta",
};
const label = (key: string) => {
  const bare = key.replace(/^.*[#/:]/, "");
  return LABELS[bare.toLowerCase()] ?? bare.charAt(0).toUpperCase() + bare.slice(1);
};

async function createDatabase(
  repo: Repository,
  images: Images,
  name: string,
  records: Incoming[],
  fetchPhoto: (source: string) => Promise<string>,
  storage: "copy" | "link",
) {
  const keys = [...new Set(records.flatMap((r) => Object.keys(r.fields)))];
  const headers = ["Título", ...keys.map(label), ...(records.some((r) => r.tags.length) ? ["Etiquetas"] : []), ...(records.some((r) => r.notes.length) ? ["Notas"] : [])];
  const rows = records.map((r) => [
    r.title,
    ...keys.map((k) => r.fields[k] ?? ""),
    ...(records.some((x) => x.tags.length) ? [r.tags.join(", ")] : []),
    ...(records.some((x) => x.notes.length) ? [r.notes.join("\n\n")] : []),
  ]);
  const plan = buildCsvImportPlan([headers, ...rows]);
  const types = plan.suggestedTypes.map((type, i): DatabaseColumnType =>
    headers[i] === "Etiquetas"
      ? "multi_select"
      : headers[i] === "Notas" || headers[i] === "Descripción"
        ? "text"
        : // Dublin Core's date is a date whatever its form ("c. 1930", "1950?").
          headers[i] === "Fecha" && historicalDateCoverage(rows.map((r) => r[i])) >= 0.8
          ? "historical_date"
          : type,
  );
  const detail = repo.importCsv(name, headers, types, rows);
  const column = repo.addColumn(detail.database.id, "Imágenes", "attachment");
  const rowIds = (repo.db.prepare("SELECT id FROM db_rows WHERE database_id=? ORDER BY position").all(detail.database.id) as { id: string }[]).map((r) => r.id);
  const annotations = new Annotations(repo);
  let photos = 0,
    failed = 0,
    regions = 0;
  for (const [i, record] of records.entries())
    for (const photo of record.photos) {
      let file: string;
      try {
        file = await fetchPhoto(photo.source);
        await images.importOne(
          { databaseId: detail.database.id, columnId: column.id, storage, createUnmatched: false, files: [{ path: file, rowId: rowIds[i], originalName: photo.name }] },
          0,
        );
        photos++;
      } catch {
        failed++;
        continue;
      }
      const asset = repo.db
        .prepare("SELECT id FROM image_assets WHERE row_id=? ORDER BY position DESC LIMIT 1")
        .get(rowIds[i]) as { id: string } | undefined;
      if (asset)
        for (const s of photo.selections)
          try {
            annotations.save({ assetId: asset.id, ...s, tags: [] });
            regions++;
          } catch {
            /* A selection too small to keep. */
          }
    }
  return { databaseId: detail.database.id, records: records.length, photos, failed, annotations: regions };
}

// --- Tropy -----------------------------------------------------------------

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join("; ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return text(o["@value"] ?? o.text ?? o.value ?? "");
  }
  return "";
};
const plain = (html: string) => html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const noteText = (note: unknown): string => {
  const n = note as Record<string, unknown>;
  return plain(text(n?.text) || text(n?.html) || text(n));
};
const asArray = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const STRUCTURE = new Set(["@id", "@type", "@context", "template", "photo", "note", "tag", "list", "selection", "id", "type"]);

export function parseTropy(json: unknown): Incoming[] {
  const root = json as Record<string, unknown>;
  const items = (Array.isArray(root) ? root : asArray(root["@graph"] ?? root.items ?? root)) as Record<string, unknown>[];
  return items
    .filter((item) => item && typeof item === "object" && (item.photo || item["@type"] === "Item" || item.title))
    .map((item) => {
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(item))
        if (!STRUCTURE.has(key) && !key.startsWith("@")) {
          const v = text(value).trim();
          if (v && label(key) !== "Título") fields[key] = v;
        }
      return {
        title: text(item.title ?? item["dc:title"]).trim() || "Sin título",
        fields,
        tags: asArray(item.tag as unknown[]).map(text).filter(Boolean),
        notes: asArray(item.note as unknown[]).map(noteText).filter(Boolean),
        photos: asArray(item.photo as Record<string, unknown>[]).map((p) => {
          const width = Number(p.width) || 0,
            height = Number(p.height) || 0;
          return {
            source: text(p.path ?? p.url ?? p.file),
            name: path.basename(text(p.path ?? p.url ?? p.file)) || "foto.jpg",
            selections: asArray(p.selection as Record<string, unknown>[])
              .filter(() => width > 0 && height > 0)
              .map((s) => ({
                x: Number(s.x) / width,
                y: Number(s.y) / height,
                w: Number(s.width) / width,
                h: Number(s.height) / height,
                note: [text(s.title), ...asArray(s.note as unknown[]).map(noteText)].filter(Boolean).join("\n\n"),
              }))
              .filter((s) => [s.x, s.y, s.w, s.h].every(Number.isFinite)),
          };
        }),
      };
    });
}

export async function importTropy(repo: Repository, images: Images, file: string) {
  const json = JSON.parse(await fs.readFile(file, "utf8"));
  const records = parseTropy(json);
  if (!records.length) throw new Error("El archivo no contiene elementos de Tropy.");
  const base = path.dirname(file);
  return createDatabase(
    repo,
    images,
    path.basename(file, path.extname(file)),
    records,
    async (source) => {
      const local = source.startsWith("file://") ? new URL(source).pathname : path.resolve(base, source);
      await fs.access(local);
      return local;
    },
    "link",
  );
}

// --- IIIF --------------------------------------------------------------------

const lang = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(lang).filter(Boolean).join("; ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("@value" in o) return lang(o["@value"]);
    const pick = o.es ?? o.en ?? o.none ?? Object.values(o)[0];
    return lang(pick);
  }
  return String(v);
};
/** A IIIF image URL capped at 2400 pixels, from a service or a direct resource. */
function imageUrl(resource: Record<string, unknown> | undefined): string | null {
  if (!resource) return null;
  const service = asArray(resource.service as Record<string, unknown>[])[0];
  const serviceId = service ? text(service.id ?? service["@id"]) : "";
  if (serviceId) return `${serviceId.replace(/\/$/, "")}/full/!2400,2400/0/default.jpg`;
  const id = text(resource.id ?? resource["@id"]);
  return id || null;
}
export function parseIiif(manifest: Record<string, unknown>, perCanvas: boolean): Incoming[] {
  const fields: Record<string, string> = {};
  for (const entry of asArray(manifest.metadata as Record<string, unknown>[])) {
    const key = plain(lang(entry.label)),
      value = plain(lang(entry.value));
    if (key && value) fields[key] = value;
  }
  const description = plain(lang(manifest.summary ?? manifest.description));
  if (description) fields.description = description;
  const rights = plain(lang(manifest.requiredStatement ? (manifest.requiredStatement as Record<string, unknown>).value : manifest.attribution));
  if (rights) fields.rights = rights;
  const license = text(manifest.rights ?? manifest.license);
  if (license) fields["Licencia"] = license;
  if (manifest.navDate) fields.date = text(manifest.navDate).slice(0, 10);
  fields["Manifiesto IIIF"] = text(manifest.id ?? manifest["@id"]);
  const title = plain(lang(manifest.label)) || "Sin título";
  // v3: items → canvas → annotation page → annotation (painting) → body. v2: sequences → canvases → images → resource.
  const canvases = (manifest.items
    ? asArray(manifest.items as Record<string, unknown>[])
    : asArray((asArray(manifest.sequences as Record<string, unknown>[])[0]?.canvases ?? []) as Record<string, unknown>[])) as Record<string, unknown>[];
  const photos = canvases.flatMap((canvas, i) => {
    const body = canvas.items
      ? (asArray((asArray(canvas.items as Record<string, unknown>[])[0]?.items ?? []) as Record<string, unknown>[])[0]?.body as Record<string, unknown> | undefined)
      : (asArray(canvas.images as Record<string, unknown>[])[0]?.resource as Record<string, unknown> | undefined);
    const url = imageUrl(Array.isArray(body) ? body[0] : body);
    return url ? [{ source: url, name: `${plain(lang(canvas.label)) || `imagen-${i + 1}`}.jpg`, label: plain(lang(canvas.label)), selections: [] }] : [];
  });
  if (!perCanvas) return [{ title, fields, tags: [], notes: [], photos }];
  return photos.map((p, i) => ({
    title: p.label && p.label !== title ? `${title} · ${p.label}` : photos.length > 1 ? `${title} · ${i + 1}` : title,
    fields,
    tags: [],
    notes: [],
    photos: [p],
  }));
}

async function fetchJson(url: string) {
  if (!/^https:\/\//i.test(url)) throw new Error("El enlace IIIF debe empezar por https://.");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { Accept: "application/ld+json, application/json" } }).catch(() => {
    throw new Error("No se pudo descargar el manifiesto IIIF.");
  });
  if (!response.ok) throw new Error(`IIIF: HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function importIiif(repo: Repository, images: Images, input: { url: string; perCanvas: boolean; limit?: number }) {
  const first = await fetchJson(input.url);
  const type = text(first.type ?? first["@type"]);
  // A collection lists manifests; each one becomes one or more records.
  const manifests = /Collection/i.test(type)
    ? await Promise.all(
        asArray((first.items ?? first.manifests) as Record<string, unknown>[])
          .slice(0, 50)
          .map((m) => fetchJson(text(m.id ?? m["@id"]))),
      )
    : [first];
  const records = manifests.flatMap((m) => parseIiif(m, input.perCanvas)).slice(0, input.limit ?? 300);
  if (!records.length) throw new Error("El manifiesto no contiene imágenes.");
  const folder = path.join(repo.root, "staging", "iiif-" + randomUUID());
  await fs.mkdir(folder, { recursive: true });
  try {
    return await createDatabase(
      repo,
      images,
      plain(lang(first.label)) || "IIIF",
      records,
      async (source) => {
        if (!/^https:\/\//i.test(source)) throw new Error("Imagen sin HTTPS.");
        const response = await fetch(source, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok || !/^image\//.test(response.headers.get("content-type") ?? "")) throw new Error("La imagen no está disponible.");
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 60 * 2 ** 20) throw new Error("Imagen demasiado grande.");
        const file = path.join(folder, randomUUID() + ".jpg");
        await fs.writeFile(file, bytes);
        return file;
      },
      "copy",
    );
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}

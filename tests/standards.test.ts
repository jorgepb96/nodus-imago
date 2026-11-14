// Tropy and IIIF imports, W3C annotation export, citations in plates,
// repeated views and the Commons response.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Repository } from "../electron/db/repository";
import { Images } from "../electron/import/images";
import { annotationsW3c, importTropy, parseIiif, parseTropy } from "../electron/import/standards";
import { platesHtml } from "../electron/export/plates";
import { angleBetween, metres, repeatedViews } from "../shared/viewpoints";
import { commonsQuery, parseCommons } from "../shared/commons";
import { decodeHistoricalDate } from "../shared/historicalDate";

const tropy = (dir: string) => ({
  "@context": { "@vocab": "https://tropy.org/v1/tropy#", title: "http://purl.org/dc/elements/1.1/title" },
  "@graph": [
    {
      "@type": "Item",
      template: "https://tropy.org/v1/templates/generic",
      title: "Plaza Mayor",
      date: "c. 1930",
      creator: { "@value": "Estudio Ruiz" },
      tag: ["plaza", "mercado"],
      note: [{ "@type": "Note", html: { "@value": "<p>Sello del estudio en el reverso.</p>" } }],
      photo: [
        {
          "@type": "Photo",
          path: path.join(dir, "a.png"),
          width: 200,
          height: 100,
          selection: [{ "@type": "Selection", x: 20, y: 10, width: 60, height: 40, note: [{ text: { "@value": "Puesto de fruta" } }] }],
        },
      ],
    },
    { "@type": "Item", title: "Puerta", date: "1950?", photo: [{ path: "b.png", width: 50, height: 50 }] },
  ],
});

test("a Tropy project becomes a database with images, notes, tags and annotated selections", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-tropy-")),
    repo = new Repository(root);
  try {
    for (const name of ["a.png", "b.png"])
      await sharp({ create: { width: name === "a.png" ? 200 : 50, height: name === "a.png" ? 100 : 50, channels: 3, background: name === "a.png" ? "#888" : "#444" } })
        .png()
        .toFile(path.join(root, name));
    const file = path.join(root, "proyecto.json");
    await fs.writeFile(file, JSON.stringify(tropy(root)));
    const parsed = parseTropy(tropy(root));
    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed[0].fields, { date: "c. 1930", creator: "Estudio Ruiz" });
    assert.deepEqual(parsed[0].photos[0].selections, [{ x: 0.1, y: 0.1, w: 0.3, h: 0.4, note: "Puesto de fruta" }]);
    const result = await importTropy(repo, new Images(repo), file);
    assert.deepEqual({ ...result, databaseId: "" }, { databaseId: "", records: 2, photos: 2, failed: 0, annotations: 1 });
    const detail = repo.detail(result.databaseId);
    assert.deepEqual(
      detail.columns.map((c) => [c.name, c.type]),
      [["Título", "title"], ["Fecha", "historical_date"], ["Autor", "text"], ["Etiquetas", "multi_select"], ["Notas", "text"], ["Imágenes", "attachment"]],
    );
    const rows = repo.literal({ databaseIds: [result.databaseId], limit: 10 }).rows;
    const plaza = rows.find((r) => r.title === "Plaza Mayor")!;
    assert.equal(decodeHistoricalDate(plaza.cells[detail.columns[1].id])!.start, 1925);
    assert.equal(plaza.images.length, 1);
    assert.equal(plaza.annotations![0].note, "Puesto de fruta");
    assert.match(String(plaza.cells[detail.columns[4].id]), /Sello del estudio en el reverso/);
    // The W3C export carries the region and the note, never a local path.
    const w3c = annotationsW3c(repo, result.databaseId);
    assert.equal(w3c.type, "AnnotationCollection");
    assert.equal(w3c.total, 1);
    const [annotation] = w3c.first.items;
    assert.equal(annotation.target.selector.value, "xywh=percent:10,10,30,40");
    assert.deepEqual(annotation.body, [{ type: "TextualBody", value: "Puesto de fruta", purpose: "describing", format: "text/plain" }]);
    assert.doesNotMatch(JSON.stringify(w3c), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("IIIF manifests, version 2 and 3, become records with their metadata and image URLs", () => {
  const v3 = {
    "@context": "http://iiif.io/api/presentation/3/context.json",
    id: "https://example.org/iiif/album/manifest",
    type: "Manifest",
    label: { es: ["Álbum de Sevilla"] },
    summary: { es: ["Fotografías de la Semana Santa."] },
    metadata: [{ label: { es: ["Fotógrafo"] }, value: { none: ["J. Pérez"] } }],
    navDate: "1925-01-01T00:00:00Z",
    requiredStatement: { label: { es: ["Atribución"] }, value: { es: ["Biblioteca X"] } },
    items: [1, 2].map((n) => ({
      id: `https://example.org/canvas/${n}`,
      type: "Canvas",
      label: { none: [`Foto ${n}`] },
      items: [{ type: "AnnotationPage", items: [{ type: "Annotation", motivation: "painting", body: { id: `https://example.org/full/${n}.jpg`, type: "Image", service: [{ id: `https://example.org/iiif/img${n}`, type: "ImageService3" }] } }] }],
    })),
  };
  const perImage = parseIiif(v3, true);
  assert.deepEqual(perImage.map((r) => r.title), ["Álbum de Sevilla · Foto 1", "Álbum de Sevilla · Foto 2"]);
  assert.equal(perImage[0].photos[0].source, "https://example.org/iiif/img1/full/!2400,2400/0/default.jpg");
  assert.deepEqual(perImage[0].fields, {
    Fotógrafo: "J. Pérez",
    description: "Fotografías de la Semana Santa.",
    rights: "Biblioteca X",
    date: "1925-01-01",
    "Manifiesto IIIF": "https://example.org/iiif/album/manifest",
  });
  assert.equal(parseIiif(v3, false)[0].photos.length, 2);
  const v2 = {
    "@id": "https://example.org/v2/manifest",
    "@type": "sc:Manifest",
    label: "Postal",
    metadata: [{ label: "Fecha", value: "1931" }],
    sequences: [{ canvases: [{ label: "Anverso", images: [{ resource: { "@id": "https://example.org/v2/a.jpg" } }] }] }],
  };
  const [postcard] = parseIiif(v2, true);
  assert.equal(postcard.title, "Postal · Anverso");
  assert.equal(postcard.photos[0].source, "https://example.org/v2/a.jpg");
  assert.equal(postcard.fields.Fecha, "1931");
});

test("plates number figures and escape captions", () => {
  const html = platesHtml({
    title: "Capítulo 3",
    label: "Fig.",
    listTitle: "Lista de figuras",
    start: 4,
    items: [{ file: "/x/1.jpg", caption: "Autor, «A & B».", width: 10, height: 10 }],
  });
  assert.match(html, /<b>Fig\. 4\.<\/b> Autor, «A &amp; B»\./);
  assert.match(html, /<img src="1\.jpg"/);
  assert.match(html, /<h2>Lista de figuras<\/h2>/);
});

test("repeated views join photographs from the same point and direction, never by chains", () => {
  const at = (id: string, lat: number, lng: number, bearing?: number) => ({
    id, title: id, image: { id: "a" + id }, imageCount: 1, location: { name: "Plaza", latitude: lat, longitude: lng, bearing: bearing ?? null },
  });
  assert.ok(Math.abs(metres({ latitude: 37.39, longitude: -5.99 }, { latitude: 37.3909, longitude: -5.99 }) - 100) < 2);
  assert.equal(angleBetween(350, 10), 20);
  const views = repeatedViews([
    at("A", 37.39, -5.99, 90), at("B", 37.3902, -5.99, 100), // same view
    at("C", 37.3901, -5.99, 270), // same place, opposite direction
    at("D", 37.5, -5.99, 90), // elsewhere
  ]);
  assert.deepEqual(views.map((g) => g.map((r) => r.id).sort()), [["A", "B"]]);
});

test("Commons nearby photographs are read from the API response", () => {
  assert.match(commonsQuery(37.39, -5.99, 300), /ggscoord=37\.39%7C-5\.99&ggsradius=300/);
  assert.match(commonsQuery(37.39, -5.99), /colimit=max/);
  const json = {
    query: {
      pages: {
        "1": {
          title: "File:Plaza.jpg",
          coordinates: [{ lat: 37.3901, lon: -5.99 }],
          imageinfo: [{ thumburl: "https://upload.wikimedia.org/a/1200px-Plaza.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Plaza.jpg", extmetadata: { Artist: { value: "<a>Ana</a>" }, LicenseShortName: { value: "CC BY-SA 4.0" }, DateTimeOriginal: { value: "2019-05-02 10:00" } } }],
        },
        "3": { title: "File:Thumb.jpg", coordinates: [{ lat: 37.3902, lon: -5.99 }], imageinfo: [{ thumburl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/T.jpg/1280px-T.jpg" }] },
        "2": { title: "File:Elsewhere.jpg", coordinates: [{ lat: 37.4, lon: -5.99 }], imageinfo: [{ thumburl: "https://evil.example/x.jpg" }] },
      },
    },
  };
  const photos = parseCommons(json, { latitude: 37.39, longitude: -5.99 }, metres);
  assert.equal(photos.length, 2);
  assert.equal(photos[1].thumbnail, "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/T.jpg/500px-T.jpg");
  assert.deepEqual(
    { title: photos[0].title, author: photos[0].author, license: photos[0].license, date: photos[0].date, distance: photos[0].distance, thumb: photos[0].thumbnail },
    { title: "Plaza.jpg", author: "Ana", license: "CC BY-SA 4.0", date: "2019-05-02", distance: 11, thumb: "https://upload.wikimedia.org/a/500px-Plaza.jpg" },
  );
});

test("Commons dates are read from timestamps and from sentences", async () => {
  const { commonsDate } = await import("../shared/commons");
  assert.equal(commonsDate("2019-05-02 10:00"), "2019-05-02");
  assert.equal(commonsDate("Taken on 2 June 2013"), "2013");
  assert.equal(commonsDate("circa 1874"), "1874");
  assert.equal(commonsDate("Take"), null);
  assert.equal(commonsDate(null), null);
});

test("the window loads Commons images and nothing else from Wikimedia", async () => {
  const { isCommonsImageRequest } = await import("../electron/geo/mapRequests");
  assert.ok(isCommonsImageRequest("https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/T.jpg/500px-T.jpg", "image"));
  assert.ok(isCommonsImageRequest("https://upload.wikimedia.org/wikipedia/commons/a/a2/T.jpg", "image"));
  assert.ok(!isCommonsImageRequest("https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/T.jpg/500px-T.jpg", "xhr"));
  assert.ok(!isCommonsImageRequest("https://commons.wikimedia.org/w/api.php?action=query", "image"));
  assert.ok(!isCommonsImageRequest("https://evil.example/wikipedia/commons/x.jpg", "image"));
});

test("the network joins values that share records, across properties only", async () => {
  const { buildNetwork } = await import("../electron/db/network");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-network-")),
    repo = new Repository(root);
  try {
    const detail = repo.importCsv(
      "Fotos",
      ["ID", "Autor", "Lugar", "Fecha"],
      ["title", "select", "select", "number"],
      [
        ["1", "Ruiz", "Sevilla", "1930"], ["2", "Ruiz", "Sevilla", "1931"], ["3", "Ruiz", "Granada", "1950"],
        ["4", "Pérez", "Granada", "1951"], ["5", "Pérez", "Granada", "1952"], ["6", "Pérez", "Sevilla", "1953"],
      ],
    );
    const [, author, place, year] = detail.columns;
    const ids = (repo.db.prepare("SELECT id FROM db_rows").all() as { id: string }[]).map((r) => r.id);
    const network = buildNetwork(repo, detail.database.id, ids, { columnIds: [author.id, place.id], minWeight: 2 });
    const label = (id: string) => network.nodes.find((n) => n.id === id)!.label;
    assert.deepEqual(
      network.edges.map((e) => [label(e.source), label(e.target), e.weight].sort().join("|")).sort(),
      ["2|Granada|Pérez", "2|Ruiz|Sevilla"],
    );
    assert.equal(network.records, 6);
    const thirties = buildNetwork(repo, detail.database.id, ids, { columnIds: [author.id, place.id], minWeight: 1, yearColumnId: year.id, from: 1930, to: 1939 });
    assert.equal(thirties.records, 2);
    assert.deepEqual(thirties.nodes.map((n) => n.label).sort(), ["Ruiz", "Sevilla"]);
    assert.ok(thirties.nodes.every((n) => n.optionId));
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the network layout fills the frame without overlapping circles, and is repeatable", async () => {
  const { layout, NETWORK_WIDTH, NETWORK_HEIGHT } = await import("../src/networkLayout");
  const nodes = Array.from({ length: 40 }, (_, i) => ({
    id: "n" + i, columnId: i < 15 ? "a" : "b", label: "Valor " + i, property: i < 15 ? "A" : "B", count: 3 + ((i * 37) % 90), optionId: null,
  }));
  const edges = Array.from({ length: 90 }, (_, i) => ({ source: "n" + (i % 15), target: "n" + (15 + ((i * 7) % 25)), weight: 1 + (i % 9) }))
    .filter((e, i, all) => all.findIndex((x) => x.source === e.source && x.target === e.target) === i);
  const network = { nodes, edges, records: 100, hidden: 0 } as unknown as Parameters<typeof layout>[0];
  const placed = layout(network, ["a", "b"]);
  for (let i = 0; i < placed.length; i++) {
    const n = placed[i];
    assert.ok(n.x - n.r >= 0 && n.x + n.r <= NETWORK_WIDTH && n.y - n.r >= 0 && n.y + n.r <= NETWORK_HEIGHT);
    for (let j = i + 1; j < placed.length; j++) assert.ok(Math.hypot(n.x - placed[j].x, n.y - placed[j].y) >= n.r + placed[j].r);
  }
  const xs = placed.map((n) => n.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > NETWORK_WIDTH * 0.7, "uses the width");
  assert.deepEqual(layout(network, ["a", "b"]), placed);
});

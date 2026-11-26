// The methodology report as a printable document: cover, contents, numbered
// sections with justified prose, tables and charts, a running header with the
// Imago mark and a footer with the page number. Pure: the renderer passes its
// translator (so the report follows the interface language) and the mark,
// and the main process prints the string to PDF with Chromium.
//
// The layout is adapted from Nodus Research's professional report
// (shared/professionalReport.ts), © Jorge Pérez Burgueño. AGPL-3.0-only.
import { COLUMN_TYPES, ROLLUP_FUNCTIONS } from "./databases";
import { TASK_LABELS } from "./restoration";
import type {
  MethodologyAgreement,
  MethodologyAiProperty,
  MethodologyData,
  MethodologyDatabase,
  MethodologyStatistic,
  MethodologyView,
} from "./methodology";

/** Spanish text in, the interface language out (the app's own translator). */
export type Translate = (text: string) => string;

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [key, value]) => out.split(`{${key}}`).join(String(value)), text);

/** A colour mixed with white (amount 0–1). */
function tint(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[n >> 16, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("")}`;
}
/** A colour mixed with black (amount 0–1). */
function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c * (1 - amount));
  return `#${[n >> 16, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("")}`;
}

type Section = { id: string; title: string; eyebrow: string; lead?: string; html: string; className?: string };

export function renderMethodologyHtml(
  data: MethodologyData,
  t: Translate,
  options: { title?: string; logoSvg?: string } = {},
): string {
  const locale = data.language === "en" ? "en-GB" : "es-ES";
  const num = (n: number) => n.toLocaleString(locale);
  const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10} %` : "—");
  const dec = (n: number | null, digits = 3) => (n === null ? "—" : n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  const accent = /^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : "#4f46e5";
  const theme = { accent, dark: shade(accent, 0.45), soft: tint(accent, 0.9), mid: tint(accent, 0.45), faint: tint(accent, 0.7) };
  const typeLabel = (type: string) => t(COLUMN_TYPES.find((c) => c.id === type)?.label ?? type);
  const date = new Date(data.generatedAt).toLocaleString(locale, { dateStyle: "long", timeStyle: "short" });
  const records = data.databases.reduce((n, d) => n + d.records, 0),
    images = data.databases.reduce((n, d) => n + d.images, 0);
  const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  const logo = options.logoSvg ? `data:image/svg+xml;base64,${base64(options.logoSvg)}` : "";
  // The running header needs an image with a small intrinsic size.
  const headerLogo = options.logoSvg
    ? `data:image/svg+xml;base64,${base64(options.logoSvg.replace(/<svg([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/, '<svg$1 width="20" height="20"'))}`
    : "";

  // ── Charts ───────────────────────────────────────────────────────────────
  /** Horizontal bars: one per label, its value and share written at the end. */
  const bars = (items: { label: string; value: number }[], total?: number) => {
    if (!items.length) return "";
    const max = Math.max(1, ...items.map((i) => i.value));
    const row = 22,
      labelW = 210,
      barW = 300,
      width = 600,
      height = items.length * row + 6;
    const body = items
      .map((item, i) => {
        const y = i * row + 4;
        const w = Math.max(item.value ? 2 : 0, (item.value / max) * barW);
        const label = item.label.length > 34 ? item.label.slice(0, 33) + "…" : item.label;
        return `<text x="${labelW - 8}" y="${y + 13}" text-anchor="end" class="c-label">${esc(label)}</text>
<rect x="${labelW}" y="${y + 3}" width="${barW}" height="13" rx="3" fill="${theme.soft}"/>
<rect x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="13" rx="3" fill="${theme.accent}"/>
<text x="${labelW + barW + 8}" y="${y + 13}" class="c-value">${esc(num(item.value))}${total ? ` · ${esc(pct(item.value, total))}` : ""}</text>`;
      })
      .join("");
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img">${body}</svg>`;
  };
  /** Stacked horizontal bars with a legend: proposals accepted, rejected, pending… */
  const stacked = (items: { label: string; parts: number[] }[], legend: string[]) => {
    if (!items.length) return "";
    const colors = [theme.accent, "#c2410c", theme.faint, "#64748b"];
    const row = 24,
      labelW = 210,
      barW = 330,
      width = 600,
      height = items.length * row + 30;
    const body = items
      .map((item, i) => {
        const y = i * row + 4;
        const total = item.parts.reduce((a, b) => a + b, 0) || 1;
        let x = labelW;
        const label = item.label.length > 34 ? item.label.slice(0, 33) + "…" : item.label;
        const segments = item.parts
          .map((part, k) => {
            const w = (part / total) * barW;
            const rect = part ? `<rect x="${x.toFixed(1)}" y="${y + 3}" width="${w.toFixed(1)}" height="14" fill="${colors[k]}"/>` : "";
            x += w;
            return rect;
          })
          .join("");
        return `<text x="${labelW - 8}" y="${y + 14}" text-anchor="end" class="c-label">${esc(label)}</text>${segments}<text x="${labelW + barW + 8}" y="${y + 14}" class="c-value">${esc(num(item.parts.reduce((a, b) => a + b, 0)))}</text>`;
      })
      .join("");
    // Each key after the previous one, by the length of its text.
    let keyX = labelW;
    const keys = legend
      .map((name, k) => {
        const x = keyX;
        keyX += 26 + name.length * 5.6;
        return `<rect x="${x.toFixed(1)}" y="${height - 16}" width="10" height="10" rx="2" fill="${colors[k]}"/><text x="${(x + 15).toFixed(1)}" y="${height - 7}" class="c-label">${esc(name)}</text>`;
      })
      .join("");
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img">${body}${keys}</svg>`;
  };
  /** Columns over time: a trend's totals by year or decade. */
  const columns = (labels: string[], values: number[]) => {
    if (!values.length) return "";
    const max = Math.max(1, ...values);
    const width = 600,
      height = 180,
      left = 34,
      bottom = 26,
      plotW = width - left - 6,
      plotH = height - bottom - 10;
    const w = plotW / values.length;
    const step = Math.ceil(values.length / 14);
    const body = values
      .map((v, i) => {
        const h = (v / max) * plotH;
        const x = left + i * w;
        return `<rect x="${(x + w * 0.12).toFixed(1)}" y="${(10 + plotH - h).toFixed(1)}" width="${(w * 0.76).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${theme.accent}"/>${
          i % step === 0 ? `<text x="${(x + w / 2).toFixed(1)}" y="${height - 9}" text-anchor="middle" class="c-axis">${esc(labels[i])}</text>` : ""
        }`;
      })
      .join("");
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img">
<line x1="${left}" y1="${10 + plotH}" x2="${width - 6}" y2="${10 + plotH}" stroke="#cbd2e0" stroke-width="1"/>
<text x="${left - 6}" y="16" text-anchor="end" class="c-axis">${esc(num(max))}</text>
<text x="${left - 6}" y="${10 + plotH}" text-anchor="end" class="c-axis">0</text>${body}</svg>`;
  };
  const figure = (svg: string, caption: string) => (svg ? `<figure class="report-figure">${svg}<figcaption>${caption}</figcaption></figure>` : "");
  let figureCount = 0;
  const fig = (svg: string, caption: string) => (svg ? figure(svg, `<b>${esc(t("Figura"))} ${++figureCount}.</b> ${esc(caption)}`) : "");
  const table = (head: string[], rows: string[][], className = "") =>
    rows.length
      ? `<table class="${className}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`
      : "";
  const p = (text: string) => `<p>${text}</p>`;
  const quote = (text: string) => `<pre class="prompt">${esc(text)}</pre>`;

  // ── Sections ─────────────────────────────────────────────────────────────
  const sections: Section[] = [];
  const aiUsed = data.aiProperties.filter((a) => a.kept + a.corrected + a.proposals.accepted + a.proposals.rejected + a.proposals.pending > 0);
  const proposals = data.review.proposals;
  const reviewed = proposals.accepted + proposals.rejected;

  // 1. Summary
  const summary = [
    fill(t("Este informe documenta cómo se ha construido y analizado un corpus de {records} registros y {images} imágenes, distribuido en {databases} bases de datos de Nodus Imago."), {
      records: num(records),
      images: num(images),
      databases: num(data.databases.length),
    }),
    data.aiProperties.length
      ? fill(t("Se usaron modelos de inteligencia artificial en {properties} propiedades; sus instrucciones exactas, los modelos y sus revisiones se recogen en las secciones correspondientes."), {
          properties: num(data.aiProperties.length),
        })
      : t("No se usó inteligencia artificial para rellenar propiedades."),
    reviewed || data.review.aiWrites
      ? fill(t("La revisión humana aceptó {accepted} y rechazó {rejected} propuestas de la IA, y corrigió {corrected} de los {written} valores escritos directamente por ella."), {
          accepted: num(proposals.accepted),
          rejected: num(proposals.rejected),
          corrected: num(data.review.aiCorrected),
          written: num(data.review.aiWrites),
        })
      : "",
    data.agreement.length
      ? fill(t("Se realizaron {n} ensayos de concordancia entre modelos y con la clasificación de referencia."), { n: num(data.agreement.length) })
      : "",
    fill(t("La huella SHA-256 de los datos ({hash}) permite comprobar que otro análisis parte exactamente del mismo corpus."), { hash: data.fingerprint.slice(0, 16) }),
  ].filter(Boolean);
  sections.push({
    id: "summary",
    title: t("Resumen"),
    eyebrow: t("Visión general"),
    className: "exec-summary",
    html: `<div class="abstract-box prose">${summary.map(p).join("")}</div>`,
  });

  // 2. Corpus
  const dbRows = data.databases.map((d) => [
    `<strong>${esc(d.name)}</strong>`,
    esc(d.kind ? t(KIND_LABELS[d.kind] ?? d.kind) : t("Personalizada")),
    esc(num(d.records)),
    esc(num(d.images)),
    esc(pct(d.recordsWithImages, d.records)),
    esc(num(d.properties.length)),
    `<code>${esc(d.fingerprint.slice(0, 16))}</code>`,
  ]);
  const propertyTables = data.databases.map((d) => databaseProperties(d)).join("");
  sections.push({
    id: "corpus",
    title: t("Corpus y estructura de los datos"),
    eyebrow: t("Datos"),
    lead: t("Las bases de datos analizadas, sus propiedades y lo completas que están."),
    html:
      `<div class="prose">${p(t("Cada base de datos reúne registros con las mismas propiedades. Las relaciones enlazan registros de bases distintas sin copiar sus datos, y las propiedades calculadas (rollups y fórmulas) se derivan de otras, por lo que no se rellenan a mano."))}</div>` +
      table([t("Base de datos"), t("Tipo"), t("Registros"), t("Imágenes"), t("Con imagen"), t("Propiedades"), t("Huella")], dbRows) +
      propertyTables,
  });
  function databaseProperties(d: MethodologyDatabase) {
    const rows = d.properties.map((prop) => {
      const notes: string[] = [];
      if (prop.ai) notes.push(t("Rellenada con IA"));
      if (prop.relation)
        notes.push(
          fill(t(prop.relation.twoWay ? "Relación con «{db}», en los dos sentidos" : "Relación con «{db}»"), { db: prop.relation.target }) +
            (prop.relation.place ? ` · ${t("cada vínculo guarda página, figura y pie de foto")}` : ""),
        );
      if (prop.rollup)
        notes.push(
          fill(t("Muestra «{target}» de «{relation}» ({fn})"), {
            target: prop.rollup.target === "__title__" ? t("Título") : t(prop.rollup.target),
            relation: prop.rollup.relation,
            fn: t(ROLLUP_FUNCTIONS.find((f) => f.id === prop.rollup!.fn)?.label ?? prop.rollup.fn),
          }),
        );
      return [esc(prop.name), esc(typeLabel(prop.type)), esc(pct(prop.filled, d.records)), esc(notes.join(" · "))];
    });
    const chart = bars(
      d.properties.filter((prop) => !["title", "formula", "rollup", "created_time", "last_edited_time", "unique_id", "button"].includes(prop.type)).map((prop) => ({ label: prop.name, value: prop.filled })),
      d.records,
    );
    return `<h3>${esc(d.name)}</h3>${table([t("Propiedad"), t("Tipo"), t("Con valor"), t("Notas")], rows, "compact")}${fig(
      chart,
      fill(t("Registros con valor en cada propiedad de «{db}» (de {n})."), { db: d.name, n: num(d.records) }),
    )}`;
  }

  // 3. Vocabularies
  const vocabularies = data.databases.flatMap((d) => d.properties.filter((prop) => prop.options?.some((o) => o.count > 0)).map((prop) => ({ d, prop })));
  if (vocabularies.length)
    sections.push({
      id: "vocabularies",
      title: t("Vocabularios y taxonomías"),
      eyebrow: t("Clasificación"),
      lead: t("Las categorías de cada propiedad de selección, con cuántos registros las tienen, sus definiciones y los vínculos a autoridades."),
      html:
        `<div class="prose">${p(t("Una selección múltiple cuenta cada categoría por separado: un registro con dos categorías suma en las dos, de modo que las cifras pueden superar el número de registros."))}</div>` +
        vocabularies
          .map(({ d, prop }) => {
            const options = prop.options!;
            const hasDefinitions = options.some((o) => o.definition),
              hasAuthorities = options.some((o) => o.authority);
            const rows = options.map((o) => [
              esc(o.label),
              esc(num(o.count)),
              esc(pct(o.count, d.records)),
              ...(hasDefinitions ? [esc(o.definition ?? "")] : []),
              ...(hasAuthorities ? [o.authority ? `<code>${esc(o.authority)}</code>` : ""] : []),
            ]);
            return `<h3>${esc(prop.name)} <small>${esc(d.name)} · ${esc(typeLabel(prop.type))}</small></h3>${table(
              [t("Categoría"), t("Registros"), t("Porcentaje"), ...(hasDefinitions ? [t("Definición")] : []), ...(hasAuthorities ? [t("Autoridad")] : [])],
              rows,
              "compact",
            )}${prop.moreOptions ? p(`<span class="muted">${esc(fill(t("Y {n} categorías más, con menos registros."), { n: num(prop.moreOptions) }))}</span>`) : ""}${fig(
              bars(options.slice(0, 12).map((o) => ({ label: o.label, value: o.count })), d.records),
              fill(t("Las categorías más frecuentes de «{property}»."), { property: prop.name }),
            )}`;
          })
          .join(""),
    });

  // Visual tagging
  const tagged = data.visualTags ?? [];
  if (tagged.length)
    sections.push({
      id: "visual-tags",
      title: t("Etiquetado visual"),
      eyebrow: t("Iconografía"),
      lead: t("Los elementos marcados en las imágenes con una región y una etiqueta, cuántas veces aparece cada uno y en cuántas fotografías."),
      html:
        `<div class="prose">${p(
          t("Cada región delimita un elemento de la imagen (una persona, un vehículo, un edificio) y lo nombra con una etiqueta común a toda la base de datos. Se distingue el número de apariciones (regiones) del de fotografías que contienen la etiqueta, y las imágenes revisadas sin ningún elemento de las que aún no se han revisado. Cada región guarda su origen (a mano o propuesta automática), su confianza y si se validó; las cifras solo cuentan las regiones validadas."),
        )}</div>` +
        tagged
          .map((v) => {
            const sources = v.regions
              .map((r) => `${t(r.source === "manual" ? "a mano" : "automáticas")} · ${t(r.state === "validated" ? "validadas" : r.state === "pending" ? "pendientes" : "rechazadas")}: ${num(r.n)}`)
              .join("; ");
            return `<h3>${esc(v.database)} <small>${esc(v.columnName ?? "")}</small></h3><div class="prose">${p(
              fill(t("Se revisaron {reviewed} de {images} imágenes ({share}); {empty} de ellas no tenían ningún elemento que etiquetar. Regiones: {sources}."), {
                reviewed: num(v.reviewed),
                images: num(v.images),
                share: pct(v.reviewed, v.images),
                empty: num(v.reviewedEmpty),
                sources: sources || "0",
              }),
            )}</div>${table(
              [t("Etiqueta"), t("Apariciones"), t("Fotografías"), t("Imágenes")],
              v.tags.map((tag) => [esc(tag.label), esc(num(tag.appearances)), esc(num(tag.records)), esc(num(tag.images))]),
              "compact",
            )}${fig(
              bars(v.tags.slice(0, 15).map((tag) => ({ label: tag.label, value: tag.appearances }))),
              fill(t("Apariciones de cada etiqueta en «{db}»."), { db: v.database }),
            )}`;
          })
          .join(""),
    });

  // 4. Models
  const taskLabel: Record<string, string> = {
    embedding: "Búsqueda semántica (vectores)",
    vision: "Visión",
    description: "Descripciones (por defecto)",
    classification: "Clasificación (por defecto)",
    restoration: "Restauración de imágenes",
    property: "Propiedades rellenadas con IA",
  };
  sections.push({
    id: "models",
    title: t("Modelos de inteligencia artificial"),
    eyebrow: t("Modelos"),
    lead: t("Cada modelo con su revisión exacta, dónde se ejecuta y cuántos valores produjo."),
    html:
      `<div class="prose">${p(
        t("Los modelos locales se descargan de su repositorio en una revisión fija y se verifican antes de usarse; los de un proveedor externo se identifican por su nombre y su servidor, que pueden cambiar sin aviso. Para repetir el análisis con los mismos resultados conviene usar las mismas revisiones."),
      )}</div>` +
      table(
        [t("Modelo"), t("Tarea"), t("Revisión"), t("Dónde"), t("Licencia"), t("Valores")],
        data.models.map((m) => [
          `<strong>${esc(m.label ?? m.model)}</strong>${m.label ? `<br><code>${esc(m.model)}</code>` : ""}`,
          esc(t(taskLabel[m.task] ?? m.task)),
          m.revision ? `<code>${esc(m.revision.length > 24 ? m.revision.slice(0, 10) : m.revision)}</code>` : "—",
          esc(t(m.where === "local" ? "En este equipo" : "Proveedor externo")),
          esc(m.license ?? "—"),
          esc(num(m.uses)),
        ]),
      ),
  });

  // 5. AI properties
  sections.push({
    id: "ai",
    title: t("Propiedades rellenadas con IA"),
    eyebrow: t("Instrucciones"),
    lead: t("Las instrucciones exactas que recibió cada modelo, sus criterios y definiciones, y qué pasó con los valores que produjo."),
    html: data.aiProperties.length
      ? fig(
          stacked(
            aiUsed.map((a) => ({ label: a.name, parts: [a.kept + a.proposals.accepted, a.corrected + a.proposals.rejected, a.proposals.pending] })),
            [t("Conservados o aceptados"), t("Corregidos o rechazados"), t("Pendientes")],
          ),
          t("Destino de los valores producidos por la IA en cada propiedad."),
        ) + data.aiProperties.map(aiProperty).join("")
      : `<div class="prose">${p(t("No se usó inteligencia artificial para rellenar propiedades."))}</div>`,
  });
  function aiProperty(a: MethodologyAiProperty) {
    const facts: [string, string][] = [
      [t("Base de datos"), esc(a.database)],
      [t("Tipo"), esc(typeLabel(a.type))],
      [t("Tarea"), esc(a.preset ? t(a.preset) : t("Instrucciones propias"))],
      [t("Imágenes de"), esc(a.source ?? t("Todas las imágenes del registro"))],
      [t("Modelo"), esc(a.configuredModel ?? t("El de Ajustes"))],
    ];
    if (a.tags.length) facts.push([t("Etiquetas permitidas"), esc(a.tags.join(", "))]);
    if (a.maxTags) facts.push([t("Máximo de etiquetas"), esc(num(a.maxTags))]);
    if (a.freeTags) facts.push([t("Etiquetas nuevas"), esc(t("La IA puede añadir opciones nuevas"))]);
    const written = a.kept + a.corrected;
    const outcome = [
      written ? fill(t("La IA escribió {n} valores; {kept} siguen como los dejó y {corrected} se corrigieron a mano."), { n: num(written), kept: num(a.kept), corrected: num(a.corrected) }) : "",
      a.proposals.accepted + a.proposals.rejected + a.proposals.pending
        ? fill(t("De sus propuestas, {accepted} se aceptaron, {rejected} se rechazaron y {pending} esperan revisión."), {
            accepted: num(a.proposals.accepted),
            rejected: num(a.proposals.rejected),
            pending: num(a.proposals.pending),
          })
        : "",
    ].filter(Boolean);
    return `<div class="evidence-card">
<span>${esc(t("Propiedad"))}</span><h3>${esc(a.name)}</h3>
<dl>${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>
${a.instructions ? `<h4>${esc(t("Instrucciones de la propiedad"))}</h4>${quote(a.instructions)}` : ""}
${a.criteria ? `<h4>${esc(t("Criterios generales de clasificación"))}</h4>${quote(a.criteria)}` : ""}
${a.definitions.length ? `<h4>${esc(t("Criterios por opción (definiciones)"))}</h4>${table([t("Categoría"), t("Definición")], a.definitions.map((d) => [esc(d.label), esc(d.text)]), "compact")}` : ""}
${a.writes.length ? `<h4>${esc(t("Modelos que produjeron los valores"))}</h4>${table([t("Modelo"), t("Revisión"), t("Valores")], a.writes.map((w) => [`<code>${esc(w.model)}</code>`, `<code>${esc(w.revision || "—")}</code>`, esc(num(w.count))]), "compact")}` : ""}
${outcome.length ? `<div class="prose">${outcome.map(p).join("")}</div>` : ""}
${a.prompts.length ? `<h4>${esc(t("Instrucciones completas enviadas al modelo"))}</h4>${a.prompts
      .map((pr, i) => `<p class="prompt-head">${esc(fill(t("Versión {n} · {count} valores · SHA-256 {hash}"), { n: i + 1, count: num(pr.count), hash: pr.hash.slice(0, 12) }))}</p>${quote(pr.text)}`)
      .join("")}` : ""}
</div>`;
  }

  // 6. Review
  const r = data.review;
  const reviewRows: [string, number][] = [
    [t("Propuestas aceptadas"), r.proposals.accepted],
    [t("Propuestas rechazadas"), r.proposals.rejected],
    [t("Propuestas pendientes"), r.proposals.pending],
    [t("Valores de IA corregidos a mano"), r.aiCorrected],
    [t("Ediciones a mano"), r.manualEdits],
    [t("Cambios deshechos"), r.undone],
    [t("Versiones confirmadas como la misma fotografía"), r.variantVerdicts.same],
    [t("Coincidencias descartadas"), r.variantVerdicts.different],
    [t("Elementos patrimoniales aceptados"), r.heritage.accepted],
    [t("Elementos patrimoniales rechazados"), r.heritage.rejected],
    [t("Valores enlazados a autoridades"), r.authorities],
    [t("Vínculos con página, figura o pie"), r.linkDetails],
    [t("Obras fotográficas"), r.works],
    [t("Apariciones añadidas a mano"), r.manualAppearances],
    [t("Regiones anotadas en las imágenes"), r.annotations],
  ];
  sections.push({
    id: "review",
    title: t("Revisión humana y correcciones"),
    eyebrow: t("Supervisión"),
    lead: t("Lo que la investigadora o el investigador decidió sobre lo que propusieron la IA y la detección automática."),
    html:
      `<div class="prose">${p(
        t("Imago no da por buena ninguna detección automática: las propuestas esperan revisión, las coincidencias entre imágenes se confirman o descartan y cada cambio queda en el historial, que permite deshacerlo. Las cifras siguientes resumen ese trabajo de supervisión."),
      )}</div>` +
      table([t("Decisión"), t("Número")], reviewRows.filter(([, n]) => n > 0).map(([k, n]) => [esc(k), esc(num(n))]), "compact") +
      (Object.keys(r.variantVerdicts.kinds).length
        ? fig(
            bars(Object.entries(r.variantVerdicts.kinds).map(([kind, n]) => ({ label: t(VARIANT_KIND_LABELS[kind] ?? kind), value: n }))),
            t("Tipo de relación entre versiones confirmadas de una misma fotografía."),
          )
        : ""),
  });

  // Circulation of the photographs
  const c = data.circulation;
  if (c && c.families > 0)
    sections.push({
      id: "circulation",
      title: t("Circulación de las imágenes"),
      eyebrow: t("Genealogía"),
      lead: t("Dónde y cuándo se publicó cada fotografía, cuánto tiempo después de la toma y con qué pies."),
      html:
        `<div class="prose">${[
          t("Cada fotografía reúne sus versiones (copias, escaneos, recortes y reproducciones) detectadas con sensibilidad equilibrada y confirmadas o corregidas por la investigación. La fecha de publicación es el año de la fuente que la imprime; la de la copia, la fecha del registro de cada versión; la de la toma, la de su obra fotográfica cuando se reunieron en una."),
          fill(t("{published} de las {families} fotografías con versiones tienen alguna publicación conocida, y {captions} se publicaron con pies distintos. La investigación indicó de qué versión procede {origins} de ellas."), {
            published: num(c.published),
            families: num(c.families),
            captions: num(c.captionsChange),
            origins: num(c.origins),
          }),
          c.gap.median !== null
            ? fill(t("Entre la toma y la primera publicación pasaron {median} años de mediana (de {min} a {max}, en {n} fotografías con fecha de toma)."), {
                median: dec(c.gap.median, 1),
                min: num(c.gap.min ?? 0),
                max: num(c.gap.max ?? 0),
                n: num(c.gap.n),
              })
            : "",
        ]
          .filter(Boolean)
          .map(p)
          .join("")}</div>` +
        fig(bars(c.top.map((x) => ({ label: x.title, value: x.uses }))), t("Las fotografías más reproducidas: número de usos de cada una.")) +
        fig(
          columns(
            c.firstYears.length ? Array.from({ length: c.firstYears.at(-1)!.year - c.firstYears[0].year + 1 }, (_, i) => String(c.firstYears[0].year + i)) : [],
            c.firstYears.length
              ? Array.from({ length: c.firstYears.at(-1)!.year - c.firstYears[0].year + 1 }, (_, i) => c.firstYears.find((y) => y.year === c.firstYears[0].year + i)?.count ?? 0)
              : [],
          ),
          t("Primeras publicaciones conocidas por año."),
        ),
    });

  // 7. Agreement
  if (data.agreement.length)
    sections.push({
      id: "agreement",
      title: t("Concordancia entre modelos y con la referencia"),
      eyebrow: t("Fiabilidad"),
      lead: t("Ensayos que comparan la clasificación de varios modelos entre sí y con la clasificación humana."),
      html:
        `<div class="prose">${p(
          t("La kappa de Fleiss y el alfa de Krippendorff miden el acuerdo más allá del azar (1 es acuerdo perfecto, 0 el esperable por azar). La unanimidad es la proporción de registros en que todos los modelos coinciden."),
        )}</div>` +
        table(
          [t("Ensayo"), t("Registros"), t("Modelos"), t("Referencia"), "κ Fleiss", "α Krippendorff", t("Unanimidad"), t("Todos con la referencia")],
          data.agreement.map((a: MethodologyAgreement) => [
            `<strong>${esc(a.name)}</strong><br><small>${esc(a.database)} · ${esc(new Date(a.createdAt).toLocaleDateString(locale))}</small>`,
            esc(`${num(a.complete)} / ${num(a.units)}`),
            esc(a.raters.map((x) => x.label).join(", ")),
            esc(a.reference ?? "—"),
            esc(dec(a.fleiss)),
            esc(dec(a.alpha)),
            esc(a.unanimity === null ? "—" : pct(a.unanimity, 1)),
            esc(a.allMatchReference === null ? "—" : pct(a.allMatchReference, 1)),
          ]),
          "compact",
        ) +
        fig(
          bars(data.agreement.filter((a) => a.alpha !== null).map((a) => ({ label: a.name, value: Math.round((a.alpha ?? 0) * 1000) / 1000 }))),
          t("Alfa de Krippendorff de cada ensayo."),
        ) +
        data.agreement
          .filter((a) => a.notes.trim())
          .map((a) => `<h4>${esc(a.name)}</h4><div class="prose">${p(esc(a.notes))}</div>`)
          .join(""),
    });

  // 8. Variants and search index
  const v = data.variants,
    ix = data.index;
  sections.push({
    id: "methods",
    title: t("Detección de variantes e índice de búsqueda"),
    eyebrow: t("Parámetros"),
    lead: t("Los métodos automáticos que proponen versiones de una fotografía y buscan por significado, con sus umbrales."),
    html:
      `<div class="prose">${p(
        fill(
          t("Las variantes se proponen en tres niveles: el mismo archivo (huella SHA-256 idéntica); una copia o un nuevo escaneo (huella perceptual de 128 bits que difiere en pocos bits); y un recorte o retoque (vectores de imagen muy parecidos, confirmados comparando los píxeles a {px} px de lado). La sensibilidad elegida decide los umbrales. Se calculó la huella de {done} de {images} imágenes."),
          { px: v.miniature, done: num(v.fingerprinted), images: num(v.images) },
        ),
      )}</div>` +
      table(
        [t("Sensibilidad"), t("Bits distintos como máximo"), t("Similitud de vectores mínima")],
        v.sensitivity.map((s) => [esc(t(SENSITIVITY_LABELS[s.name] ?? s.name)), esc(num(s.bits)), esc(s.cosine === null ? t("No se usan") : dec(s.cosine, 2))]),
        "compact",
      ) +
      `<div class="prose">${p(
        fill(
          t("La búsqueda semántica compara vectores de {dims} dimensiones calculados con {model}. Están indexadas {imagesIndexed} de {images} imágenes y {recordsIndexed} de {records} registros; {stale} vectores de registros esperan recalcularse porque el registro cambió."),
          {
            dims: num(ix.dimensions),
            model: ix.label ?? ix.model,
            imagesIndexed: num(ix.imagesIndexed),
            images: num(ix.images),
            recordsIndexed: num(ix.recordsIndexed),
            records: num(ix.records),
            stale: num(ix.stale),
          },
        ),
      )}</div>`,
  });

  // 9. Views and filters
  if (data.views.length)
    sections.push({
      id: "views",
      title: t("Vistas guardadas y filtros"),
      eyebrow: t("Selección"),
      lead: t("Los subconjuntos del corpus que se guardaron, con sus condiciones exactas."),
      html: data.views.map(view).join(""),
    });
  function view(vw: MethodologyView) {
    const conditions = vw.filters.map((f) => `«${esc(f.property)}» ${esc(t(OP_LABELS[f.op] ?? f.op))}${f.value ? ` <strong>${esc(f.value)}</strong>` : ""}${f.group ? ` <small>(${esc(t("grupo"))} ${f.group})</small>` : ""}`);
    return `<div class="source-card"><h4>${esc(vw.name)} <small>${esc(vw.database)} · ${esc(t(VIEW_LABELS[vw.view] ?? vw.view))}</small></h4>${
      conditions.length
        ? `<p class="muted">${esc(t(vw.logic === "or" ? "Registros que cumplen alguna de estas condiciones:" : "Registros que cumplen todas estas condiciones:"))}</p><ul>${conditions.map((c) => `<li>${c}</li>`).join("")}</ul>`
        : `<p class="muted">${esc(t("Sin filtros: todos los registros."))}</p>`
    }${vw.sorts.length ? `<p class="muted">${esc(t("Orden"))}: ${vw.sorts.map((s) => `«${esc(s.property)}» ${esc(t(s.desc ? "descendente" : "ascendente"))}`).join(", ")}</p>` : ""}</div>`;
  }

  // 10. Statistics
  if (data.statistics.length)
    sections.push({
      id: "statistics",
      title: t("Análisis estadísticos"),
      eyebrow: t("Resultados"),
      lead: t("Las estadísticas guardadas, recalculadas sobre todos los registros de su base de datos en el momento del informe."),
      html: data.statistics.map(statistic).join(""),
    });
  function statistic(s: MethodologyStatistic) {
    const head = `<h3>${esc(s.name)} <small>${esc(s.database)} · ${esc(s.properties.join(" × "))}</small></h3>`;
    const res = s.result;
    if (!res) return head + `<p class="muted">${esc(t(s.error ?? "No se pudo calcular."))}</p>`;
    if (res.kind === "frequency")
      return (
        head +
        `<div class="prose">${p(
          fill(t("Frecuencias sobre {records} registros ({empty} sin valor, {distinct} categorías distintas)."), { records: num(res.records), empty: num(res.empty), distinct: num(res.distinct) }),
        )}</div>` +
        fig(bars(res.categories.slice(0, 15).map((c) => ({ label: c.label, value: c.count })), res.records), fill(t("Frecuencias de «{property}»."), { property: s.properties[0] }))
      );
    if (res.kind === "trend")
      return (
        head +
        `<div class="prose">${p(fill(t("Evolución por {bucket} sobre {records} registros ({undated} sin fecha)."), { bucket: t(res.bucket === "decade" ? "década" : "año"), records: num(res.records), undated: num(res.undated) }))}</div>` +
        fig(columns(res.buckets.map(String), res.totals), fill(t("Registros por {bucket}."), { bucket: t(res.bucket === "decade" ? "década" : "año") }))
      );
    if (res.kind === "crosstab") {
      const rows = res.rows.slice(0, 12).map((label, i) => [esc(label), ...res.counts[i].slice(0, 8).map((n) => esc(num(n))), esc(num(res.rowTotals[i]))]);
      return (
        head +
        table(["", ...res.cols.slice(0, 8), t("Total")], rows, "compact") +
        `<div class="prose">${p(
          res.chi
            ? fill(t("Chi cuadrado = {chi} con {df} grados de libertad (p = {p}); V de Cramér = {v}. {low} de las casillas esperan menos de 5 casos."), {
                chi: dec(res.chi.statistic, 2),
                df: num(res.chi.df),
                p: res.chi.p < 0.001 ? "< 0,001" : dec(res.chi.p, 3),
                v: dec(res.chi.cramersV, 3),
                low: pct(res.chi.lowExpected, 1),
              })
            : t("No hay datos suficientes para la prueba de chi cuadrado."),
        )}</div>`
      );
    }
    if (res.kind === "cooccurrence")
      return head + table([t("Par"), t("Registros"), "Jaccard", "Lift"], res.pairs.slice(0, 15).map((x) => [esc(`${x.a} + ${x.b}`), esc(num(x.count)), esc(dec(x.jaccard, 2)), esc(dec(x.lift, 2))]), "compact");
    return (
      head +
      table(
        ["n", t("Media"), t("Mediana"), t("Desviación típica"), t("Mínimo"), t("Máximo")],
        [[esc(num(res.n)), esc(dec(res.mean, 2)), esc(dec(res.median, 2)), esc(dec(res.sd, 2)), esc(dec(res.min, 2)), esc(dec(res.max, 2))]],
        "compact",
      ) + fig(bars(res.histogram.map((h) => ({ label: `${dec(h.from, 1)} – ${dec(h.to, 1)}`, value: h.count }))), t("Distribución de los valores."))
    );
  }

  // 11. Restorations
  if (data.restorations.length)
    sections.push({
      id: "restorations",
      title: t("Restauraciones con IA"),
      eyebrow: t("Imágenes modificadas"),
      lead: t("Versiones de imágenes generadas por modelos externos. No sustituyen al original como fuente."),
      html: table(
        [t("Proveedor"), t("Modelo"), t("Tarea"), t("Versiones")],
        data.restorations.map((x) => [esc(x.provider), `<code>${esc(x.model)}</code>`, esc(t(TASK_LABELS[x.task as keyof typeof TASK_LABELS] ?? x.task)), esc(num(x.count))]),
        "compact",
      ),
    });

  // 12. Environment and reproduction
  const env = data.environment;
  sections.push({
    id: "reproduction",
    title: t("Entorno y reproducción"),
    eyebrow: t("Reproducibilidad"),
    lead: t("Lo necesario para repetir el análisis y comprobar que parte de los mismos datos."),
    html:
      table(
        [t("Elemento"), t("Valor")],
        [
          [esc(t("Aplicación")), esc(`Nodus Imago ${env.app}`)],
          [esc(t("Sistema")), esc(`${env.platform} · ${env.arch}`)],
          [esc(t("Motor")), esc(`Electron ${env.electron} · Chromium ${env.chromium}`)],
          [esc(t("Perfil de rendimiento")), esc(`${t(PROFILE_LABELS[data.settings.profile] ?? data.settings.profile)} · ${data.settings.device.toUpperCase()}`)],
          [esc(t("Tareas en paralelo")), esc(num(data.settings.parallelJobs))],
          [esc(t("Pausa entre llamadas a la API")), esc(`${num(data.settings.apiDelayMs)} ms`)],
          [esc(t("Proveedores externos")), esc(t(data.settings.remoteEnabled ? "Activados" : "Desactivados"))],
          [esc(t("Fecha del informe")), esc(date)],
          [esc(t("Huella de los datos")), `<code>${esc(data.fingerprint)}</code>`],
        ],
        "compact",
      ) +
      `<div class="prose">${[
        t("Para reproducir el análisis: parte de una copia de seguridad de la colección (.imago) cuya huella coincida con la de este informe, usa los mismos modelos en las mismas revisiones y las mismas instrucciones, y aplica las vistas y estadísticas descritas. La huella se calcula sobre los valores de los registros y los archivos de imagen, sin contar las propiedades calculadas, de modo que cualquier cambio en los datos la altera."),
        t("Los modelos de lenguaje no son deterministas: aun con el mismo modelo y las mismas instrucciones, algunas respuestas pueden variar. Por eso el informe distingue lo que produjo la IA de lo que la revisión humana aceptó o corrigió."),
        t("El anexo técnico (JSON), si se guardó, contiene los mismos datos que este informe en un formato legible por máquina."),
      ]
        .map(p)
        .join("")}</div>`,
  });

  // ── Document ─────────────────────────────────────────────────────────────
  const title = options.title?.trim() || t("Informe metodológico");
  const subtitle = data.databases.map((d) => d.name).join(" · ");
  const kind = t("Informe metodológico");
  const metrics = [
    [num(records), t("Registros")],
    [num(images), t("Imágenes")],
    [num(data.aiProperties.length), t("Propiedades con IA")],
    [num(data.review.aiCorrected + data.review.proposals.rejected), t("Correcciones")],
  ];
  const toc = sections.map((s, i) => `<li><a href="#${s.id}"><b>${String(i + 1).padStart(2, "0")}</b><span>${esc(s.title)}</span><i></i></a></li>`).join("");
  const body = sections
    .map(
      (s, i) => `<section id="${s.id}" class="report-section ${i && BREAK_BEFORE.has(s.id) ? "page-break" : ""} ${s.className ?? ""}">
<header class="section-heading"><span>${String(i + 1).padStart(2, "0")}</span><div><p>${esc(s.eyebrow)}</p><h2>${esc(s.title)}</h2>${s.lead ? `<div class="section-lead">${esc(s.lead)}</div>` : ""}</div></header>
<div class="section-body">${s.html}</div></section>`,
    )
    .join("\n");
  const footerKind = kind.toUpperCase().replace(/"/g, "'");
  return `<!doctype html>
<html lang="${data.language}">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
@page {
  size: A4; margin: 22mm 20mm 20mm;
  ${headerLogo ? `@top-center { content: url("${headerLogo}"); vertical-align: bottom; padding-bottom: 3mm; }` : ""}
  @bottom-left { content: "${esc(footerKind)}"; font: 700 6.5pt Arial, sans-serif; letter-spacing: .12em; color: #7a8295; vertical-align: top; padding-top: 4mm; }
  @bottom-center { content: counter(page) " / " counter(pages); font: 7.5pt Arial, sans-serif; color: #7a8295; vertical-align: top; padding-top: 4mm; }
  @bottom-right { content: "NODUS IMAGO"; font: 700 6.5pt Arial, sans-serif; letter-spacing: .12em; color: ${theme.accent}; vertical-align: top; padding-top: 4mm; }
}
@page :first { @top-center { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }
* { box-sizing: border-box; }
:root { --accent: ${theme.accent}; --accent-dark: ${theme.dark}; --accent-soft: ${theme.soft}; --ink: #182033; --muted: #667085; --line: #d9deea; }
html { color: var(--ink); background: #fff; font-family: Georgia, "Times New Roman", serif; }
body { margin: 0; font-size: 10.5pt; line-height: 1.6; }
p { margin: 0 0 3.6mm; }
a { color: var(--accent-dark); text-decoration: none; }
code { padding: .2mm .9mm; border-radius: 1mm; background: #f1f3f7; font: 8pt Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.cover { height: 245mm; display: flex; flex-direction: column; break-after: page; }
.cover-logo { width: 26mm; height: 26mm; margin-top: 22mm; }
.cover-kicker { margin-top: 14mm; color: var(--accent); font: 700 8.3pt/1.2 Arial, sans-serif; letter-spacing: .19em; text-transform: uppercase; }
.cover-rule { width: 19mm; height: 1.4mm; margin: 5mm 0 8mm; border-radius: 99px; background: var(--accent); }
.cover h1 { max-width: 165mm; margin: 0; font: 700 30pt/1.07 Arial, sans-serif; letter-spacing: -.035em; }
.cover-subtitle { max-width: 150mm; margin: 6mm 0 0; color: var(--muted); font-size: 13pt; line-height: 1.48; }
.cover-meta { margin-top: auto; padding-top: 8mm; border-top: .25mm solid var(--line); display: grid; grid-template-columns: 1fr auto; gap: 8mm; align-items: end; }
.cover-meta dl { margin: 0; display: grid; grid-template-columns: auto 1fr; column-gap: 3mm; row-gap: 1.2mm; }
.cover-meta dt { color: var(--muted); font: 700 7.4pt/1.35 Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
.cover-meta dd { margin: 0; font-size: 9pt; }
.cover-metrics { display: flex; gap: 2mm; }
.cover-metrics div { min-width: 22mm; padding: 2.5mm 3mm; border-radius: 2.3mm; background: var(--accent-soft); text-align: center; }
.cover-metrics strong { display: block; color: var(--accent-dark); font: 700 14pt/1 Arial, sans-serif; }
.cover-metrics span { display: block; margin-top: 1.2mm; color: var(--muted); font: 700 6.2pt/1.2 Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; }
.contents { break-after: page; padding-top: 5mm; }
.contents-kicker { color: var(--accent); font: 700 8pt/1.2 Arial, sans-serif; letter-spacing: .16em; text-transform: uppercase; }
.contents h2 { margin: 2mm 0 10mm; font: 700 25pt/1.1 Arial, sans-serif; letter-spacing: -.025em; }
.toc-list { margin: 0; padding: 0; list-style: none; }
.toc-list > li { padding: 3.1mm 0; border-bottom: .25mm solid var(--line); }
.toc-list a { display: flex; align-items: baseline; gap: 3mm; color: var(--ink); font: 600 10.3pt/1.35 Arial, sans-serif; }
.toc-list a b { color: var(--accent); font-size: 8pt; letter-spacing: .08em; }
.toc-list a i { flex: 1; border-bottom: .25mm dotted #c5cad5; }
.report-section { padding-top: 5mm; }
.report-section + .report-section:not(.page-break) { margin-top: 12mm; padding-top: 8mm; border-top: .25mm solid var(--line); }
.report-section.page-break { break-before: page; }
.section-heading { display: grid; grid-template-columns: 13mm 1fr; gap: 4mm; align-items: start; margin: 0 0 7mm; break-after: avoid; }
.section-heading > span { display: grid; width: 11mm; height: 11mm; place-items: center; border-radius: 50%; background: var(--accent-soft); color: var(--accent-dark); font: 700 8pt/1 Arial, sans-serif; }
.section-heading p { margin: 0 0 1.3mm; color: var(--accent); font: 700 7pt/1.2 Arial, sans-serif; letter-spacing: .13em; text-transform: uppercase; }
.section-heading h2 { margin: 0; color: var(--accent-dark); font: 700 20pt/1.15 Arial, sans-serif; letter-spacing: -.02em; }
.section-lead { max-width: 145mm; margin-top: 2mm; color: var(--muted); font-size: 9.5pt; line-height: 1.48; }
.section-body { margin-left: 17mm; }
.exec-summary .section-body { margin-left: 0; }
.prose p { text-align: justify; hyphens: auto; orphans: 3; widows: 3; }
.prose p + p { text-indent: 1.35em; }
.abstract-box { padding: 6mm; border: .25mm solid color-mix(in srgb, var(--accent) 24%, #d9deea); border-radius: 3mm; background: linear-gradient(145deg, var(--accent-soft), #fff); }
.abstract-box p { font-size: 10.8pt; line-height: 1.7; }
.section-body h3 { margin: 7mm 0 2.5mm; color: var(--accent-dark); font: 700 11.5pt/1.3 Arial, sans-serif; break-after: avoid; }
.section-body h3 small, .section-body h4 small { color: var(--muted); font-weight: 400; font-size: 8pt; }
.section-body h4 { margin: 4mm 0 1.8mm; color: var(--accent); font: 700 8.6pt/1.3 Arial, sans-serif; letter-spacing: .03em; break-after: avoid; }
table { width: 100%; margin: 4mm 0; border-collapse: collapse; font: 7.9pt/1.4 Arial, sans-serif; }
th { padding: 2.2mm 2.4mm; border-bottom: .35mm solid color-mix(in srgb, var(--accent) 30%, #d9deea); background: var(--accent-soft); color: var(--accent-dark); text-align: left; font: 700 6.6pt/1.25 Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; }
td { padding: 2mm 2.4mm; border-bottom: .25mm solid var(--line); vertical-align: top; overflow-wrap: break-word; hyphens: auto; }
table.compact td { padding: 1.5mm 2.2mm; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
.report-figure { margin: 5mm 0; break-inside: avoid; }
.chart { display: block; width: 100%; height: auto; }
.chart .c-label { font: 10.5px Arial, sans-serif; fill: #344054; }
.chart .c-value { font: 700 10px Arial, sans-serif; fill: ${theme.dark}; }
.chart .c-axis { font: 9.5px Arial, sans-serif; fill: #7a8295; }
.report-figure figcaption { margin-top: 2mm; font: 8.5pt/1.5 Georgia, serif; color: var(--muted); }
.report-figure figcaption b { color: var(--accent); }
.evidence-card { margin: 5mm 0; padding: 4mm 5mm; border: .25mm solid var(--line); border-left: 1mm solid var(--accent); border-radius: 2mm; }
.evidence-card > span { color: var(--accent); font: 700 6.8pt/1.2 Arial, sans-serif; letter-spacing: .1em; text-transform: uppercase; }
.evidence-card h3 { margin: 1.3mm 0 3mm; }
.evidence-card dl { display: grid; grid-template-columns: 32mm 1fr; gap: 1mm 3mm; margin: 0 0 2mm; font-size: 8.6pt; }
.evidence-card dt { color: var(--muted); font: 700 6.8pt/1.5 Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; }
.evidence-card dd { margin: 0; }
pre.prompt { margin: 1.5mm 0 3mm; padding: 3mm 3.5mm; border-radius: 2mm; background: #f6f7fb; border: .25mm solid var(--line); color: #262d3d; font: 7.6pt/1.5 Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.prompt-head { margin: 2mm 0 0; color: var(--muted); font: 700 6.8pt/1.3 Arial, sans-serif; letter-spacing: .05em; }
.source-card { margin: 4mm 0; padding: 3.5mm 4.5mm; border: .25mm solid var(--line); border-radius: 2.5mm; break-inside: avoid; font-size: 9.2pt; }
.source-card h4 { margin-top: 0; }
.source-card ul { margin: 1mm 0 2mm; padding-left: 5mm; }
.source-card li::marker { color: var(--accent); }
.muted { color: var(--muted); }
small { font-size: 7.6pt; color: var(--muted); }
</style>
</head>
<body>
<main>
<section class="cover">
${logo ? `<img class="cover-logo" src="${logo}" alt="">` : ""}
<div class="cover-kicker">${esc(kind)}</div>
<div class="cover-rule"></div>
<h1>${esc(title)}</h1>
<p class="cover-subtitle">${esc(subtitle)}</p>
<div class="cover-meta">
<dl>
<dt>${esc(t("Generado"))}</dt><dd>${esc(date)}</dd>
<dt>${esc(t("Aplicación"))}</dt><dd>Nodus Imago ${esc(env.app)}</dd>
<dt>${esc(t("Huella"))}</dt><dd><code>${esc(data.fingerprint.slice(0, 24))}</code></dd>
</dl>
<div class="cover-metrics">${metrics.map(([value, label]) => `<div><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join("")}</div>
</div>
</section>
<nav class="contents">
<div class="contents-kicker">Nodus Imago</div>
<h2>${esc(t("Contenidos"))}</h2>
<ol class="toc-list">${toc}</ol>
</nav>
${body}
</main>
</body>
</html>`;
}

/** Long sections start on a page of their own; short ones follow on. */
const BREAK_BEFORE = new Set(["corpus", "vocabularies", "visual-tags", "models", "ai", "circulation", "agreement", "statistics"]);
export const KIND_LABELS: Record<string, string> = {
  images: "Imágenes",
  sources: "Fuentes",
  works: "Obras fotográficas",
  people: "Personas",
  events: "Acontecimientos",
  custom: "Personalizada",
};
const VARIANT_KIND_LABELS: Record<string, string> = {
  copy: "Copia u otro escaneo",
  crop: "Recorte",
  retouch: "Retoque",
  reproduction: "Reproducción impresa",
  other_take: "Otra toma",
};
const SENSITIVITY_LABELS: Record<string, string> = { strict: "Estricta", balanced: "Equilibrada", broad: "Amplia" };
const PROFILE_LABELS: Record<string, string> = { light: "Ligero", balanced: "Equilibrado", advanced: "Avanzado" };
const VIEW_LABELS: Record<string, string> = {
  table: "Tabla",
  gallery: "Galería",
  map: "Mapa",
  tree: "Árbol",
  timeline: "Cronología",
  stats: "Estadísticas",
  variants: "Variantes",
  network: "Red",
  visualmap: "Mapa visual",
};
/** Filter operators in words: «Fecha» is between 1930 and 1940. */
export const OP_LABELS: Record<string, string> = {
  contains: "contiene",
  not_contains: "no contiene",
  starts_with: "empieza por",
  ends_with: "termina en",
  equals: "es",
  not_equals: "no es",
  gt: "es mayor que",
  gte: "es mayor o igual que",
  lt: "es menor que",
  lte: "es menor o igual que",
  between: "está entre",
  any: "es alguna de",
  all: "tiene todas",
  none: "no tiene ninguna de",
  empty: "está vacía",
  not_empty: "tiene valor",
  checked: "está marcada",
  unchecked: "no está marcada",
  relative_date: "está en el periodo",
  has_coordinates: "tiene coordenadas",
  no_coordinates: "no tiene coordenadas",
  heritage_type: "es del tipo",
  heritage_group: "es del grupo",
  part_of: "forma parte de",
  heritage_marked: "está marcado en la foto",
  heritage_unlinked: "no está enlazado a Wikidata",
  visual_unreviewed: "está sin revisar",
  visual_reviewed_empty: "está revisada, sin elementos",
};

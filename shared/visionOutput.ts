// Strict parsing of local/remote vision-model output.
//
// LFM3's chat template can emit `<think>...</think>` blocks. llama.cpp can add
// loader diagnostics to the console stream, and a model may wrap its answer in
// a Markdown fence or return an object per label instead of bare strings. None
// of those wrappers are a cell value: descriptions and classifications are only
// accepted when the remaining text is unambiguous.

const SPECIAL_TOKEN = /<\|[^|>\n]{1,64}\|>/g;
const END_OF_TEXT = /\[\s*end of text\s*\]/gi;
const CLI_BANNER =
  /^\s*(?:llama_mtmd_cli|llama_model_loader|llama_context|llama_kv_cache|llama_perf|llama_model|ggml_|mtmd_|clip_|print_info|load_tensors|load:|sampling:|generate:|main:|encode:|decode:)\b.*$/;
const THINK_BLOCK = /<think\b[^>]*>[\s\S]*?<\/think\s*>/gi;
const THINK_OPEN = /<think\b[^>]*>/i;
const REASONING_BLOCK = /<reasoning\b[^>]*>[\s\S]*?<\/reasoning\s*>/gi;
const REASONING_OPEN = /<reasoning\b[^>]*>/i;
// Some local generations omit the opening tag but still close the reasoning
// block with </think> (or a provider-specific equivalent). Everything before
// the last closing marker is reasoning and must never become a cell value.
const REASONING_CLOSE =
  /<\/(?:think|reasoning|analysis)\s*>|<\|(?:reasoning_end|end_of_reasoning|eot_reasoning)\|>/gi;

export function stripReasoning(raw: string): string {
  let text = raw.replace(/\r\n?/g, "\n");
  text = text.replace(THINK_BLOCK, "\n").replace(REASONING_BLOCK, "\n");
  // A generation can be cut before the closing tag (token budget, cancellation
  // of the stream, a model that never closes the block). In that case the
  // remainder is reasoning, not an answer, and must not become a cell value.
  const think = text.search(THINK_OPEN);
  if (think >= 0) text = text.slice(0, think);
  const reasoning = text.search(REASONING_OPEN);
  if (reasoning >= 0) text = text.slice(0, reasoning);
  const closes = [...text.matchAll(REASONING_CLOSE)];
  if (closes.length) {
    const last = closes[closes.length - 1];
    text = text.slice((last.index ?? 0) + last[0].length);
  }
  return text;
}

/** Remove transport noise but preserve the model's actual prose. */
export function cleanVisionText(raw: string): string {
  let text = stripReasoning(raw);
  text = text.replace(SPECIAL_TOKEN, " ").replace(END_OF_TEXT, " ");
  text = text
    .split("\n")
    .filter((line) => !CLI_BANNER.test(line))
    .join("\n");
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function scanBalanced(text: string, start: number): number {
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0,
    inString = false,
    escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Every complete top-level JSON value found in `text`, in order. */
export function jsonCandidates(text: string): unknown[] {
  const values: unknown[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "[" && text[i] !== "{") continue;
    const end = scanBalanced(text, i);
    if (end < 0) continue;
    try {
      values.push(JSON.parse(text.slice(i, end + 1)));
    } catch {
      /* not JSON; continue after this candidate */
    }
    i = end;
  }
  try {
    values.push(JSON.parse(text));
  } catch {
    /* the answer is prose, not JSON */
  }
  return values;
}

const LABEL_KEYS = ["label", "category", "value", "name"];
const ARRAY_KEYS = ["labels", "categories", "options", "values", "items"];

function labelOf(item: unknown): string | null {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    for (const key of LABEL_KEYS)
      if (typeof record[key] === "string" && record[key].trim())
        return record[key].trim();
  }
  return null;
}

function arrayFromValue(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ARRAY_KEYS)
      if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return null;
}

function foldLabel(label: string) {
  return label.trim().toLocaleLowerCase();
}

/**
 * Parse a classification answer against the exact option vocabulary of the
 * property. Accepts `["Paisaje"]` and `[{"label":"Paisaje"}]`; rejects unknown
 * labels, prose-only answers, truncated JSON and every item that is not a label.
 */
export function parseClassification(
  raw: string,
  allowed: string[],
  max: number,
): string[] {
  const text = cleanVisionText(raw);
  for (const value of jsonCandidates(text)) {
    const items = arrayFromValue(value);
    if (!items) continue;
    const labels: string[] = [];
    for (const item of items) {
      const label = labelOf(item);
      if (!label)
        throw new Error(
          "El modelo devolvió una clasificación no válida (elemento sin etiqueta).",
        );
      const canonical = allowed.find((option) => foldLabel(option) === foldLabel(label));
      if (!canonical)
        throw new Error(
          `El modelo propuso una opción fuera del vocabulario permitido: ${JSON.stringify(label)}.`,
        );
      if (!labels.some((existing) => foldLabel(existing) === foldLabel(canonical)))
        labels.push(canonical);
    }
    if (labels.length > max)
      throw new Error(
        `El modelo propuso ${labels.length} opciones y el campo admite como máximo ${max}.`,
      );
    return labels;
  }
  throw new Error("El modelo devolvió una clasificación no válida.");
}

const CONTEXT_HEADER = /^===\s*[^=\n]{1,80}\s*===$/;
const ECHOED_FIELD =
  /^(?:Título|Title|Imágenes|Images|Descripción|Description|Categorías|Categories|Archivo|File|Año|Year|Autor|Author|Lugar|Place|Ubicación|Location)\s*:/i;

/** Drop the prompt scaffolding some local models repeat before their answer. */
function stripPromptEcho(text: string): string {
  const lines = text
    .split("\n")
    .filter((line) => !CONTEXT_HEADER.test(line.trim()));
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start++;
  // Only remove metadata lines when the model also echoed a context header;
  // otherwise a legitimate description could begin with "Autor: ...".
  if (start > 0 || text.split("\n").some((line) => CONTEXT_HEADER.test(line.trim()))) {
    while (start < lines.length && ECHOED_FIELD.test(lines[start].trim())) start++;
  }
  return lines.slice(start).join("\n").trim();
}

/**
 * Parse a description. Reasoning, console banners, special tokens and a
 * repeated prompt header are removed; a bare JSON object/array is not a
 * description. A JSON wrapper with a `description` field is accepted because
 * some providers use it despite the instruction to answer in prose.
 */
export function parseDescription(raw: string): string {
  let text = stripPromptEcho(cleanVisionText(raw));
  // A Markdown heading before the prose is a preamble, not part of the value.
  text = text.replace(/^(?:#{1,6}\s+[^\n]*\n+)+/, "").trim();
  const unfenced = text.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```$/, "").trim();
  if (unfenced && !unfenced.includes("```")) text = unfenced;
  for (const value of jsonCandidates(text)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    for (const key of ["description", "descripcion", "descripción", "text"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        text = stripPromptEcho(cleanVisionText(candidate));
        break;
      }
    }
  }
  // A classification array or an unrelated object is not prose.
  const withoutJson = text.replace(/```[\s\S]*?```/g, "").trim();
  if (/^[[{]/.test(withoutJson) && jsonCandidates(withoutJson).length)
    throw new Error("El modelo devolvió JSON en lugar de una descripción.");
  if (!text || text.length < 2)
    throw new Error("El modelo no devolvió una descripción utilizable.");
  return text;
}

// The database chat, adapted from Nodus Research's database chat: the model
// answers from a profile computed over every record of the chosen databases
// and a few example records. When it needs an exact figure the profile does
// not contain, it writes a ```calc block of JavaScript; the app runs it in an
// isolated process over the records and gives the model the result.
// Pure so prompts, parsing and the streaming parsers are unit-tested.
import type { ModelChoice } from "./aiConfig";

export type ChatMode = "fast" | "extended";
/** How many calculation rounds each mode allows in one answer. */
export const CALC_ROUNDS: Record<ChatMode, number> = { fast: 2, extended: 4 };
/** Example records per database shown to the model. */
export const SAMPLE_ROWS: Record<ChatMode, number> = { fast: 8, extended: 20 };
/** Most frequent values listed per property in the profile. */
export const PROFILE_VALUES: Record<ChatMode, number> = { fast: 12, extended: 30 };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** The answer failed; `content` holds the error. */
  error?: boolean;
  /** The answer was stopped before it finished. */
  interrupted?: boolean;
  /** Model that wrote an answer. */
  model?: string;
};
export type ChatFolder = {
  id: string;
  parentId: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  position: number;
  createdAt: string;
};
export type ChatConversationSummary = {
  id: string;
  title: string;
  folderId: string | null;
  databaseIds: string[];
  model: ModelChoice | null;
  mode: ChatMode;
  pinnedAt: string | null;
  archived: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};
export type ChatConversation = ChatConversationSummary & { messages: ChatMessage[] };

/** One turn sent to the main process, which runs it and saves the result. */
export type ChatTurnRequest = {
  conversationId: string;
  question: string;
  databaseIds: string[];
  model: ModelChoice;
  mode: ChatMode;
  /** Replace the last answer instead of asking a new question. */
  regenerate?: boolean;
};
export type ChatTurnResult = { message: ChatMessage; title: string };
export type ChatDelta = { conversationId: string; messageId: string; content: string };

type Language = "es" | "en";

const SYSTEM: Record<Language, string> = {
  es: `Eres un analista de datos que responde preguntas sobre una o varias bases de datos de imágenes históricas del usuario. Cada registro describe una o varias imágenes (fotografías, grabados, postales…) con propiedades como título, fecha, lugar, autor o temas. Responde ÚNICAMENTE con la información de los datos; no inventes cifras, registros ni propiedades.

Los datos llegan en dos bloques distintos:
1. El PERFIL se ha calculado sobre TODOS los registros. Es la fuente válida para totales, recuentos, mínimos, máximos, medias y distribuciones.
2. La MUESTRA son unos pocos registros de ejemplo para que veas cómo son los valores. No es la tabla completa: no cuentes sus filas ni deduzcas totales de ella.

CÁLCULOS. Si necesitas una cifra exacta que el perfil no contiene (un recuento con condiciones, una tabla cruzada, registros por década, un porcentaje concreto, una lista de registros que cumplen algo), no la estimes: escribe un bloque de código con el lenguaje "calc" que contenga JavaScript y termina tu mensaje ahí. La aplicación lo ejecutará en un entorno aislado sobre todos los registros y te devolverá el resultado para que continúes.
- La variable global \`databases\` es una lista de objetos { name, columns, rows }. \`columns\` es una lista de { name, type }. Cada fila de \`rows\` es un objeto cuyas claves son los nombres de las propiedades; además tiene \`_id\` y \`_images\` (número de imágenes).
- Los valores de selección múltiple son listas de textos; los números son números; las casillas son true o false; las fechas son textos AAAA-MM-DD; las propiedades vacías valen null.
- Hay funciones de ayuda: \`yearOf(valor)\` devuelve el año de una fecha o de un texto («c. 1930», «s. XIX» → 1850) o null; \`countBy(filas, f)\` devuelve un objeto { valor: número } contando el valor o los valores que devuelve f para cada fila; \`top(objeto, n)\` devuelve los n pares [clave, número] más altos.
- El código debe terminar con \`return\` y devolver un valor pequeño en JSON (como mucho unos cientos de elementos). No tiene acceso a archivos, red ni a nada fuera de estos datos.
- Ejemplo:
\`\`\`calc
const rows = databases[0].rows;
return top(countBy(rows.filter(r => (yearOf(r["Fecha"]) ?? 0) >= 1900), r => r["Lugar"]), 10);
\`\`\`
Cuando recibas el resultado, úsalo y cita las cifras exactas. Si el cálculo falla, corrige el código una vez o explica la limitación.

GRÁFICOS. Si un gráfico aclara la respuesta, incluye UN bloque de código con el lenguaje "chart" y un JSON válido con esta forma, usando solo datos reales:
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
Usa "bar" para comparar categorías, "column" para años o décadas en orden y "line" para una evolución en el tiempo. Explica en el texto lo que muestra el gráfico.

Escribe en español, de forma clara y concisa, con Markdown. No muestres el código de cálculo en la respuesta final.`,
  en: `You are a data analyst who answers questions about one or more of the user's databases of historical images. Each record describes one or more images (photographs, engravings, postcards…) with properties such as title, date, place, author or subjects. Answer ONLY from the data; never invent figures, records or properties.

The data arrives in two different blocks:
1. The PROFILE was calculated over ALL records. It is the valid source for totals, counts, minima, maxima, averages and distributions.
2. The SAMPLE is a few example records so you can see what the values look like. It is not the full table: do not count its rows or infer totals from it.

CALCULATIONS. If you need an exact figure the profile does not contain (a count with conditions, a cross-tabulation, records per decade, a specific percentage, a list of records that match something), do not estimate it: write a code block with the language "calc" containing JavaScript and end your message there. The app runs it in an isolated environment over all records and returns the result so you can continue.
- The global variable \`databases\` is a list of objects { name, columns, rows }. \`columns\` is a list of { name, type }. Each row in \`rows\` is an object whose keys are the property names; it also has \`_id\` and \`_images\` (number of images).
- Multi-select values are lists of strings; numbers are numbers; checkboxes are true or false; dates are YYYY-MM-DD strings; empty properties are null.
- Helper functions: \`yearOf(value)\` returns the year of a date or a text ("c. 1930", "s. XIX" → 1850) or null; \`countBy(rows, f)\` returns an object { value: count } counting the value or values f returns for each row; \`top(object, n)\` returns the n highest [key, count] pairs.
- The code must end with \`return\` and return a small JSON value (a few hundred items at most). It has no access to files, the network or anything outside this data.
- Example:
\`\`\`calc
const rows = databases[0].rows;
return top(countBy(rows.filter(r => (yearOf(r["Date"]) ?? 0) >= 1900), r => r["Place"]), 10);
\`\`\`
When you receive the result, use it and cite the exact figures. If the calculation fails, fix the code once or explain the limitation.

CHARTS. If a chart makes the answer clearer, include ONE code block with the language "chart" and valid JSON in this shape, using only real data:
\`\`\`chart
{"type":"bar","title":"…","items":[{"label":"…","value":10}]}
\`\`\`
Use "bar" to compare categories, "column" for years or decades in order and "line" for a change over time. Explain in the text what the chart shows.

Write in English, clearly and concisely, using Markdown. Do not show the calculation code in the final answer.`,
};

export function chatSystem(language: Language): string {
  return SYSTEM[language] ?? SYSTEM.es;
}

const COPY = {
  es: {
    database: "BASE DE DATOS",
    profile: (n: number) => `PERFIL (calculado sobre los ${n} registros)`,
    sample: (s: number, n: number) => `MUESTRA: ${s} registros de ejemplo de ${n}. Solo muestra el formato; no cuentes sobre ella`,
    empty: "sin registros",
    data: "DATOS",
    previous: "CONVERSACIÓN PREVIA",
    question: "PREGUNTA",
    user: "Usuario",
    assistant: "Asistente",
    result: "Resultado del cálculo",
    failed: "El cálculo ha fallado",
    next: "Continúa la respuesta con este resultado.",
    last: "No quedan más cálculos disponibles en esta respuesta: responde ya con lo que tienes y, si falta algo, dilo.",
  },
  en: {
    database: "DATABASE",
    profile: (n: number) => `PROFILE (calculated over all ${n} records)`,
    sample: (s: number, n: number) => `SAMPLE: ${s} example records out of ${n}. It only shows the format; do not count from it`,
    empty: "no records",
    data: "DATA",
    previous: "PREVIOUS CONVERSATION",
    question: "QUESTION",
    user: "User",
    assistant: "Assistant",
    result: "Calculation result",
    failed: "The calculation failed",
    next: "Continue the answer with this result.",
    last: "No more calculations are available for this answer: answer now with what you have and say if something is missing.",
  },
};

export type ChatDataPart = {
  name: string;
  rowCount: number;
  profile: string;
  sample: string;
  sampleSize: number;
};

export function buildChatContext(parts: ChatDataPart[], language: Language): string {
  const copy = COPY[language] ?? COPY.es;
  return parts
    .map(
      (p) =>
        `=== ${copy.database}: ${p.name} ===\n` +
        `--- ${copy.profile(p.rowCount)} ---\n${p.profile}\n\n` +
        `--- ${copy.sample(p.sampleSize, p.rowCount)} ---\n${p.sample || `(${copy.empty})`}`,
    )
    .join("\n\n");
}

/** Earlier turns, without the calculation code, so the model keeps the thread. */
export function buildChatUser(
  context: string,
  question: string,
  history: Pick<ChatMessage, "role" | "content" | "error">[],
  language: Language,
): string {
  const copy = COPY[language] ?? COPY.es;
  const convo = history
    .filter((m) => !m.error && m.content.trim())
    .slice(-8)
    .map((m) => `${m.role === "user" ? copy.user : copy.assistant}: ${readableAnswer(m.content).slice(0, 4000)}`)
    .join("\n");
  const parts = [`=== ${copy.data} ===`, context, ""];
  if (convo.trim()) parts.push(`=== ${copy.previous} ===`, convo, "");
  parts.push(`=== ${copy.question} ===\n${question}`);
  return parts.join("\n");
}

/** What the model is told after a calculation ran. */
export function calcFeedback(result: CalcOutcome, language: Language, last: boolean) {
  const copy = COPY[language] ?? COPY.es;
  const body = result.ok
    ? `${copy.result}:\n\`\`\`json\n${result.result}\n\`\`\``
    : `${copy.failed}: ${result.error}`;
  const logs = result.logs.length ? `\nconsole.log:\n${result.logs.join("\n").slice(0, 2000)}` : "";
  return `${body}${logs}\n\n${last ? copy.last : copy.next}`;
}

export type CalcOutcome =
  | { ok: true; result: string; logs: string[]; ms: number }
  | { ok: false; error: string; logs: string[]; ms: number };

const CALC_RE = /```calc[^\S\n]*\n([\s\S]*?)```/;
/** The first calculation the model asked for in this round, if any. */
export function extractCalc(text: string): { code: string; end: number } | null {
  const match = CALC_RE.exec(text);
  if (!match) return null;
  return { code: match[1].trim(), end: match.index + match[0].length };
}
/** How a calculation result is stored in the answer, right after its code. */
export function calcResultBlock(result: CalcOutcome): string {
  return `\n\`\`\`calc-result\n${JSON.stringify(result.ok ? { ok: true, result: result.result, ms: result.ms } : { ok: false, error: result.error, ms: result.ms })}\n\`\`\`\n`;
}

/** The answer as a reader sees it: no calculation code and no results. */
export function readableAnswer(text: string): string {
  return text
    .replace(/```calc[^\S\n]*\n[\s\S]*?```/g, "")
    .replace(/```calc-result[^\S\n]*\n[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ChartSpec = {
  type: "bar" | "column" | "line";
  title?: string;
  items: { label: string; value: number }[];
};
export function isChartSpec(value: unknown): value is ChartSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as ChartSpec;
  return (
    ["bar", "column", "line", "pie"].includes(spec.type) &&
    Array.isArray(spec.items) &&
    spec.items.length > 0 &&
    spec.items.length <= 200 &&
    spec.items.every(
      (item) => item && typeof item.label === "string" && typeof item.value === "number" && Number.isFinite(item.value),
    )
  );
}

export type ChatSegment =
  | { kind: "md"; text: string }
  | { kind: "chart"; spec: ChartSpec }
  | { kind: "calc"; code: string; result: { ok: boolean; result?: string; error?: string; ms?: number } | null };

const BLOCK_RE = /```(chart|calc|calc-result)[^\S\n]*\n([\s\S]*?)```/g;
/**
 * An answer in reading order: Markdown, charts and calculations, each
 * calculation paired with its result. A block still being written while the
 * answer streams stays as text until it closes.
 */
export function parseChatSegments(text: string): ChatSegment[] {
  const out: ChatSegment[] = [];
  let cursor = 0,
    match: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;
  const pushText = (value: string) => {
    if (value.trim()) out.push({ kind: "md", text: value });
  };
  while ((match = BLOCK_RE.exec(text))) {
    pushText(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const [, kind, body] = match;
    if (kind === "chart") {
      let spec: unknown = null;
      try {
        spec = JSON.parse(body.trim());
      } catch {
        spec = null;
      }
      if (isChartSpec(spec))
        out.push({ kind: "chart", spec: { ...spec, type: spec.type === ("pie" as string) ? "bar" : spec.type } });
      else pushText(match[0]);
    } else if (kind === "calc") out.push({ kind: "calc", code: body.trim(), result: null });
    else {
      const last = out[out.length - 1];
      let parsed: { ok: boolean; result?: string; error?: string; ms?: number } | null = null;
      try {
        parsed = JSON.parse(body.trim());
      } catch {
        parsed = null;
      }
      if (last?.kind === "calc" && parsed) last.result = parsed;
    }
  }
  // A calculation the model is still writing is hidden until it closes.
  const rest = text.slice(cursor).replace(/```calc[^\S\n]*\n[\s\S]*$/, "");
  pushText(rest);
  return out;
}

/** A conversation's title from its first question. */
export function chatTitle(question: string): string {
  const line = question.replace(/\s+/g, " ").trim();
  return line.length > 60 ? line.slice(0, 57).trimEnd() + "…" : line || "Chat";
}

// --- Streaming (server-sent events) ----------------------------------------

/** Splits a stream into complete SSE events; the remainder waits for more bytes. */
export function splitSse(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  return { events: parts.filter((p) => p.trim()), rest };
}
/** The `data:` payload of one event, joined across lines. */
export function sseData(event: string): string | null {
  const lines = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  return lines.length ? lines.join("\n") : null;
}
/** Text added by one event of an OpenAI-compatible or Anthropic stream. */
export function streamDelta(provider: "anthropic" | "openai", data: string): { text: string; done: boolean; error?: string } {
  if (data === "[DONE]") return { text: "", done: true };
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    return { text: "", done: false };
  }
  if (json?.error) return { text: "", done: true, error: String(json.error.message ?? json.error) };
  if (provider === "anthropic") {
    if (json.type === "content_block_delta" && json.delta?.type === "text_delta")
      return { text: String(json.delta.text ?? ""), done: false };
    return { text: "", done: json.type === "message_stop" };
  }
  const choice = json.choices?.[0];
  const content = choice?.delta?.content;
  return { text: typeof content === "string" ? content : "", done: false };
}

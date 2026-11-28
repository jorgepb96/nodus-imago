// The image workshop: non-destructive treatments of a source image (or of a
// version derived from it), applied in order and saved as a new version of
// the same record. The original is never changed. Every operation is plain
// data, so a version can always say exactly what was done to it.

export type Point = [number, number];
/** Operations of the workshop, in the order they are applied. */
export type WorkshopOp =
  | { tool: "adjust"; exposure: number; brightness: number; contrast: number; highlights: number; shadows: number; saturation: number }
  | { tool: "levels"; black: number; white: number; gamma: number }
  | { tool: "curve"; points: Point[] }
  | { tool: "sharpen"; amount: number; radius: number }
  | { tool: "denoise"; strength: number }
  | { tool: "descreen"; period: number; strength: number }
  | { tool: "clahe"; strength: number }
  | { tool: "rotate"; angle: number; quarter: 0 | 90 | 180 | 270; flip: boolean }
  | { tool: "crop"; x: number; y: number; w: number; h: number }
  /** Straightens a photograph on a book page: four corners and, for a curved page, the middle of each side. */
  | { tool: "straighten"; corners: [Point, Point, Point, Point]; bows: [Point | null, Point | null, Point | null, Point | null] }
  | { tool: "invert" }
  | { tool: "grayscale" }
  | { tool: "edges"; strength: number }
  | { tool: "falsecolor"; palette: "thermal" | "viridis" | "spectrum" }
  | { tool: "channel"; channel: "r" | "g" | "b" };
export type WorkshopTool = WorkshopOp["tool"];

/** How a version came to be: the workshop's operations, or an AI run (recorded by its engine). */
export type VersionOp = WorkshopOp | { tool: "ai"; kind: "restore" | "repair" | "sharpen" | "colorize" | "custom" | "upscale"; provider: string; model: string; scale?: number; remote: boolean };

export type ToolGroup = "basic" | "geometry" | "technical" | "inspect";
export const TOOLS: { tool: WorkshopTool; group: ToolGroup; label: string; help: string }[] = [
  { tool: "adjust", group: "basic", label: "Luz y color", help: "Exposición, brillo, contraste, luces, sombras y saturación." },
  { tool: "levels", group: "basic", label: "Niveles", help: "Fija el negro y el blanco de la imagen y el tono medio, con el histograma a la vista." },
  { tool: "curve", group: "basic", label: "Curva", help: "Ajusta cada tono por separado arrastrando puntos sobre la curva." },
  { tool: "sharpen", group: "basic", label: "Nitidez", help: "Realza los bordes. Con moderación: exagerada crea halos." },
  { tool: "rotate", group: "geometry", label: "Rotar", help: "Gira en cuartos de vuelta, endereza unos grados o voltea." },
  { tool: "crop", group: "geometry", label: "Recortar", help: "Quita márgenes, bordes de página o lo que sobra alrededor de la foto." },
  { tool: "straighten", group: "geometry", label: "Enderezar foto de libro", help: "Marca las esquinas de la foto y, si la página se curva, el centro de cada lado: se aplana y se corrige la perspectiva." },
  { tool: "descreen", group: "technical", label: "Quitar trama de impresión", help: "Elimina la retícula de puntos de las fotos impresas en libros y revistas (y el moiré que produce)." },
  { tool: "denoise", group: "technical", label: "Reducir ruido", help: "Suaviza el grano y las motas. Con intensidad alta se pierde detalle fino." },
  { tool: "clahe", group: "inspect", label: "Contraste local", help: "Realza el detalle en sombras y luces a la vez (CLAHE): muy útil para leer inscripciones y rótulos." },
  { tool: "invert", group: "inspect", label: "Invertir", help: "Convierte la imagen en su negativo; también sirve para positivar negativos escaneados." },
  { tool: "grayscale", group: "inspect", label: "Blanco y negro", help: "Quita el color, o el tono sepia, para comparar solo la luz." },
  { tool: "edges", group: "inspect", label: "Bordes", help: "Dibuja los contornos: deja ver retoques, letras borradas o perfiles de edificios." },
  { tool: "falsecolor", group: "inspect", label: "Falso color", help: "Pinta cada nivel de gris con un color: distingue tonos que a simple vista parecen iguales." },
  { tool: "channel", group: "inspect", label: "Separar canales", help: "Muestra solo el canal rojo, verde o azul: a veces uno conserva lo que los otros pierden." },
];
export const GROUP_LABELS: Record<ToolGroup, string> = {
  basic: "Ajustes básicos",
  geometry: "Geometría",
  technical: "Corrección técnica",
  inspect: "Inspección visual",
};

export function defaultOp(tool: WorkshopTool): WorkshopOp {
  switch (tool) {
    case "adjust":
      return { tool, exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0 };
    case "levels":
      return { tool, black: 0, white: 255, gamma: 1 };
    case "curve":
      return { tool, points: [[0, 0], [64, 64], [192, 192], [255, 255]] };
    case "sharpen":
      return { tool, amount: 40, radius: 1.2 };
    case "denoise":
      return { tool, strength: 35 };
    case "descreen":
      return { tool, period: 4, strength: 50 };
    case "clahe":
      return { tool, strength: 40 };
    case "rotate":
      return { tool, angle: 0, quarter: 0, flip: false };
    case "crop":
      return { tool, x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
    case "straighten":
      return { tool, corners: [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]], bows: [null, null, null, null] };
    case "edges":
      return { tool, strength: 60 };
    case "falsecolor":
      return { tool, palette: "thermal" };
    case "channel":
      return { tool, channel: "r" };
    default:
      return { tool } as WorkshopOp;
  }
}

/** What an operation did, in a few words (history chips, tooltips, methodology). */
export function opLabel(op: VersionOp): string {
  switch (op.tool) {
    case "ai":
      return op.kind === "upscale" ? `Escalado ×${op.scale ?? "?"} · IA` : op.kind === "colorize" ? "Colorización · IA" : "Restauración · IA";
    case "adjust":
      return "Luz y color";
    case "levels":
      return "Niveles";
    case "curve":
      return "Curva";
    case "sharpen":
      return "Nitidez";
    case "denoise":
      return "Reducción de ruido";
    case "descreen":
      return "Sin trama";
    case "clahe":
      return "Contraste local";
    case "rotate":
      return op.quarter || op.flip ? "Rotación" : `Enderezado ${op.angle > 0 ? "+" : ""}${op.angle}°`;
    case "crop":
      return "Recorte";
    case "straighten":
      return op.bows.some(Boolean) ? "Página aplanada" : "Perspectiva corregida";
    case "invert":
      return "Invertida";
    case "grayscale":
      return "Blanco y negro";
    case "edges":
      return "Bordes";
    case "falsecolor":
      return "Falso color";
    case "channel":
      return `Canal ${op.channel.toUpperCase()}`;
  }
}

/**
 * The label of a version, from every operation since the original (its own
 * and its ancestors'): «Editada», «Rectificada», «Restaurada · IA»,
 * «Escalada ×4 · IA»… joined with «+» when there are several.
 */
export function versionLabel(ops: VersionOp[]): string {
  const parts: string[] = [];
  const add = (p: string) => !parts.includes(p) && parts.push(p);
  for (const op of ops) {
    if (op.tool === "ai") {
      add(op.kind === "upscale" ? `Escalada ×${op.scale ?? "?"}` : op.kind === "colorize" ? "Colorizada" : "Restaurada");
    } else if (["rotate", "crop", "straighten"].includes(op.tool)) add("Rectificada");
    else if (op.tool === "descreen") add("Sin trama");
    else add("Editada");
  }
  if (!parts.length) return "Original";
  const ai = ops.some((o) => o.tool === "ai");
  const text = parts.length > 3 ? `${parts.slice(0, 2).join(" + ")} + ${parts.length - 2}` : parts.join(" + ");
  return ai ? `${text} · IA` : text;
}
/** The words written on an exported copy: «Escalada ×4 mediante IA», «Editada digitalmente»… */
export function exportLabel(ops: VersionOp[]): string {
  const ai = ops.some((o) => o.tool === "ai");
  const base = versionLabel(ops).replace(/ · IA$/, "");
  return ai ? `${base} mediante IA` : `${base} digitalmente`;
}

/** Ready-made treatments for common problems of historical photographs. */
export type RecipeId = "book" | "faded" | "inscription" | "dark" | "negative" | "page";
export const RECIPES: { id: RecipeId; label: string; help: string }[] = [
  { id: "book", label: "Foto impresa en un libro", help: "Quita la trama de impresión, recupera el contraste y afina un poco." },
  { id: "faded", label: "Foto desvaída", help: "Recupera negros y blancos y el detalle de las zonas grises." },
  { id: "inscription", label: "Leer inscripciones y rótulos", help: "Blanco y negro con contraste local fuerte: hace legibles letras gastadas." },
  { id: "dark", label: "Foto oscura", help: "Aclara las sombras sin quemar las luces." },
  { id: "negative", label: "Positivar un negativo", help: "Invierte los tonos y ajusta los niveles." },
  { id: "page", label: "Foto en página curvada", help: "Endereza y aplana una foto escaneada de un libro abierto." },
];

/** What the backend measures of an image to fill in a recipe. */
export type WorkshopAnalysis = {
  /** 0.5 % and 99.5 % luminance percentiles. */
  low: number;
  high: number;
  mean: number;
  /** Halftone screen period in pixels of the source, when a screen is found. */
  screen: { period: number; confidence: number } | null;
  /** Luminance histogram (256 bins) of a 1200 px copy. */
  histogram?: number[];
  /** Estimated grain, in grey levels. */
  noise?: number;
  /** Mean chroma: under ~10 the image is black and white (or a toned print). */
  chroma?: number;
  /** How far the picture leans, in degrees, when its edges agree on it. */
  tilt?: { angle: number; confidence: number } | null;
};

/** One fix the automatic mode proposes, with why. */
export type AutoStep = { id: string; label: string; reason: string; ops: WorkshopOp[]; on: boolean; values?: Record<string, string | number> };

/**
 * The automatic mode: from what was measured, the fixes the image seems to
 * need, each with its reason, in the order they should be applied. Nothing is
 * applied until the researcher accepts them, and each can be left out.
 */
export function autoPlan(a: WorkshopAnalysis): AutoStep[] {
  const steps: AutoStep[] = [];
  const fmt = (n: number) => Math.round(n * 10) / 10;
  if (a.tilt)
    steps.push({
      id: "tilt",
      label: "Enderezar",
      reason: "La imagen está inclinada unos {deg}°: sus líneas horizontales y verticales no lo son.",
      values: { deg: fmt(Math.abs(a.tilt.angle)) },
      ops: [{ tool: "rotate", angle: -a.tilt.angle, quarter: 0, flip: false }],
      on: a.tilt.confidence >= 0.5,
    });
  if (a.screen)
    steps.push({
      id: "screen",
      label: "Quitar trama de impresión",
      reason: "Hay una trama de puntos cada {p} px: es una foto reproducida en un libro o una revista.",
      values: { p: fmt(a.screen.period) },
      ops: [{ tool: "descreen", period: Math.round(a.screen.period * 10) / 10, strength: 50 }],
      on: a.screen.confidence >= 0.5,
    });
  else if ((a.noise ?? 0) >= 4)
    steps.push({
      id: "noise",
      label: "Reducir ruido",
      reason: "Tiene grano o motas visibles (ruido de unos {n} niveles de gris).",
      values: { n: fmt(a.noise ?? 0) },
      ops: [{ tool: "denoise", strength: Math.min(60, Math.round(15 + (a.noise ?? 0) * 4)) }],
      on: (a.noise ?? 0) >= 6,
    });
  // Tones after the black and white points are set.
  const black = Math.max(0, Math.round(a.low)),
    white = Math.min(255, Math.max(Math.round(a.high), black + 20));
  const stretched = black > 10 || white < 245;
  const span = Math.max(1, white - black);
  let mean = 0,
    sq = 0,
    n = 0;
  (a.histogram ?? []).forEach((count, v) => {
    const t = Math.min(255, Math.max(0, ((v - black) / span) * 255));
    mean += t * count;
    sq += t * t * count;
    n += count;
  });
  mean = n ? mean / n : ((a.mean - black) / span) * 255;
  const sd = n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 60;
  const gamma = mean < 95 ? Math.min(1.6, Math.round((Math.log(Math.max(0.05, mean / 255)) / Math.log(0.5)) * 100) / 100) : mean > 170 ? 0.85 : 1;
  if (stretched || gamma !== 1)
    steps.push({
      id: "levels",
      label: "Niveles",
      reason: stretched
        ? "Los tonos solo ocupan del {b} al {w} (de 0 a 255): los negros se ven grises y los blancos apagados."
        : mean < 95
          ? "La imagen es oscura en conjunto: se aclaran los tonos medios."
          : "La imagen está lavada: se oscurecen un poco los tonos medios.",
      values: { b: black, w: white },
      ops: [{ tool: "levels", black: stretched ? black : 0, white: stretched ? white : 255, gamma }],
      on: true,
    });
  if (sd < 52)
    steps.push({
      id: "contrast",
      label: "Contraste local",
      reason: "Tiene poco contraste: el detalle de las zonas grises se pierde.",
      ops: [{ tool: "clahe", strength: sd < 38 ? 35 : 22 }],
      on: true,
    });
  if (a.screen || (a.noise ?? 0) >= 4)
    steps.push({
      id: "sharpen",
      label: "Nitidez",
      reason: "Quitar la trama o el ruido suaviza la imagen: se recupera algo de nitidez.",
      ops: [{ tool: "sharpen", amount: 30, radius: 1.5 }],
      on: steps.some((x) => (x.id === "screen" || x.id === "noise") && x.on),
    });
  return steps;
}
export function recipeOps(id: RecipeId, a: WorkshopAnalysis): WorkshopOp[] {
  const levels: WorkshopOp = { tool: "levels", black: Math.max(0, Math.round(a.low)), white: Math.min(255, Math.max(Math.round(a.high), Math.round(a.low) + 20)), gamma: 1 };
  switch (id) {
    case "book":
      return [
        ...(a.screen ? [{ tool: "descreen", period: Math.round(a.screen.period * 10) / 10, strength: 50 } as WorkshopOp] : [{ tool: "descreen", period: 4, strength: 50 } as WorkshopOp]),
        levels,
        { tool: "sharpen", amount: 30, radius: 1.5 },
      ];
    case "faded":
      return [levels, { tool: "clahe", strength: 30 }];
    case "inscription":
      return [{ tool: "grayscale" }, { tool: "clahe", strength: 70 }, { tool: "sharpen", amount: 50, radius: 1 }];
    case "dark":
      return [{ ...(defaultOp("adjust") as Extract<WorkshopOp, { tool: "adjust" }>), shadows: 45, exposure: a.mean < 70 ? 0.4 : 0.2 }];
    case "negative":
      return [{ tool: "invert" }, { tool: "levels", black: Math.max(0, 255 - Math.round(a.high)), white: Math.min(255, 255 - Math.round(a.low)), gamma: 1 }];
    case "page":
      return [defaultOp("straighten")];
  }
}

/** One version of a source image, as the record and the workshop show it. */
export type ImageVersion = {
  id: string;
  assetId: string;
  /** The version it was made from; null: from the original. */
  parentId: string | null;
  label: string;
  /** Every operation since the original, in order. */
  ops: VersionOp[];
  /** Only this version's own operations. */
  own: VersionOp[];
  width: number;
  height: number;
  createdAt: string;
  sha256: string | null;
  ai: boolean;
};

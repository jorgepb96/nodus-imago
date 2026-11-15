// What changed in each version, newest first, as in Nodus Research
// (shared/releaseNotes.ts): the What's New window shows them after an update
// in the language of the interface, and the GitHub release description is
// generated from the English text in the same order
// (scripts/generate-release-notes.mjs). Keep them short and user-facing.

export type ReleaseCategory = "new" | "enhancement" | "fix";
/** What part of Imago a highlight is about: an icon and a colour in the window. */
export type ReleaseNoteScope =
  | "general"
  | "catalogue"
  | "search"
  | "visual"
  | "compare"
  | "places"
  | "ai"
  | "analysis"
  | "authorities"
  | "publish";

export interface ReleaseHighlight {
  scope: ReleaseNoteScope;
  category: ReleaseCategory;
  es: string;
  en: string;
}
export interface ReleaseNote {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  highlights: ReleaseHighlight[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.1.3",
    date: "2026-11-16",
    highlights: [
      {
        scope: "catalogue",
        category: "new",
        es: "Al hacer clic en una celda de texto de la tabla se abre un recuadro sobre ella con el texto completo, que se puede editar ahí mismo. Intro, Esc o un clic fuera guardan el texto; Mayús+Intro añade una línea.",
        en: "Clicking a text cell in the table opens a panel over it with the whole text, which can be edited there. Enter, Esc or a click outside keep the text; Shift+Enter adds a line.",
      },
      {
        scope: "catalogue",
        category: "fix",
        es: "Los puntos de color de las etiquetas se veían achatados cuando el nombre ocupaba dos líneas. Ahora son siempre círculos.",
        en: "The colour dots of tags looked squashed when the name took two lines. They are now always circles.",
      },
      {
        scope: "general",
        category: "fix",
        es: "La versión para Mac con Intel podía no publicarse si la conexión con Apple se cortaba al final de la firma. Ahora ese paso se reintenta.",
        en: "The Mac version for Intel processors could fail to publish if the connection to Apple dropped at the end of signing. That step is now retried.",
      },
    ],
  },
  {
    version: "0.1.2",
    date: "2026-11-15",
    highlights: [
      {
        scope: "general",
        category: "enhancement",
        es: "Con un tema de color en modo claro, los paneles toman el tono más claro del tema en lugar de quedar en blanco.",
        en: "With a colour theme in light mode, panels take the theme's lightest shade instead of staying white.",
      },
      {
        scope: "general",
        category: "fix",
        es: "La introducción volvía a aparecer después de actualizar si se había terminado mientras se indexaban las imágenes. Ahora la introducción, el recorrido y la ventana de novedades quedan marcados como vistos aunque haya tareas en marcha.",
        en: "The introduction appeared again after an update if it had been finished while images were being indexed. The introduction, the tour and the What's New window are now marked as seen even while tasks are running.",
      },
      {
        scope: "general",
        category: "fix",
        es: "Una tarea fallida dejaba de mostrarse solo al cerrarla. Ahora desaparece de la lista cuando la misma tarea se completa más tarde.",
        en: "A failed task stayed in the list until it was closed. It now disappears when the same task completes later.",
      },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-11-15",
    highlights: [
      {
        scope: "general",
        category: "new",
        es: "Al actualizar, Imago muestra una ventana con las novedades de la versión. Se puede volver a abrir en Ajustes › Actualizaciones y novedades.",
        en: "After an update, Imago shows a window with what is new in the version. It can be opened again from Settings › Updates and news.",
      },
      {
        scope: "visual",
        category: "enhancement",
        es: "El mapa visual se abre ajustado al marco y «Ver todo» encuadra todas las imágenes. Las imágenes se ven más grandes cuando hay pocas.",
        en: "The visual map opens fitted to the frame and “Show all” fits every image. Images are larger when there are few.",
      },
      {
        scope: "compare",
        category: "enhancement",
        es: "Variantes encuentra más recortes de una misma fotografía y comprueba cada candidato sobre las propias imágenes antes de agruparlo.",
        en: "Variants finds more crops of the same photograph and checks every candidate on the images themselves before grouping it.",
      },
      {
        scope: "authorities",
        category: "enhancement",
        es: "Al proponer enlaces con Wikidata o Iconclass para todos los valores, Imago envía una petición por segundo y espera cuando el servicio lo pide.",
        en: "When proposing Wikidata or Iconclass links for every value, Imago sends one request per second and waits when the service asks.",
      },
      {
        scope: "compare",
        category: "fix",
        es: "Variantes agrupaba como la misma fotografía retratos distintos del mismo tipo, como retratos de estudio con la misma pose y el mismo fondo.",
        en: "Variants grouped different photographs of the same kind as the same photograph, such as studio portraits with the same pose and backdrop.",
      },
      {
        scope: "places",
        category: "fix",
        es: "En «Entonces y ahora», algunas fechas de Wikimedia Commons aparecían cortadas; ahora se muestra la fecha o el año.",
        en: "In “Then and now”, some Wikimedia Commons dates appeared cut; the date or the year is now shown.",
      },
      {
        scope: "general",
        category: "fix",
        es: "Ajustes mostraba siempre la versión 0.1.0; ahora muestra la versión instalada.",
        en: "Settings always showed version 0.1.0; it now shows the installed version.",
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-11-14",
    highlights: [
      {
        scope: "catalogue",
        category: "new",
        es: "Primera versión pública. Bases de datos de imágenes que se importan desde CSV, Notion, Nodus, Tropy o un manifiesto IIIF, con fechas históricas que guardan el periodo y su grado de certeza.",
        en: "First public version. Image databases imported from CSV, Notion, Nodus, Tropy or a IIIF manifest, with historical dates that keep their period and how certain they are.",
      },
      {
        scope: "search",
        category: "new",
        es: "Búsqueda literal, por significado y por imagen, anotaciones sobre zonas de una imagen y búsqueda de un detalle dentro de las demás.",
        en: "Literal, meaning-based and image search, notes on regions of an image, and search for a detail inside the others.",
      },
      {
        scope: "visual",
        category: "new",
        es: "Mapa visual, variantes de una misma fotografía y mesa de comparación con zoom compartido y superposición.",
        en: "Visual map, variants of the same photograph and a comparison table with shared zoom and overlay.",
      },
      {
        scope: "places",
        category: "new",
        es: "Mapa con dirección de cámara, vistas repetidas y «Entonces y ahora» con Wikimedia Commons.",
        en: "Map with camera direction, repeated views and “Then and now” with Wikimedia Commons.",
      },
      {
        scope: "ai",
        category: "new",
        es: "Descripción, clasificación y transcripción con IA como propuestas, chat con cálculos sobre todos los registros y taller de restauraciones.",
        en: "AI description, classification and transcription as proposals, a chat that calculates over every record, and a restoration workshop.",
      },
      {
        scope: "analysis",
        category: "new",
        es: "Cronología, estadísticas, concordancia entre clasificaciones y red de relaciones.",
        en: "Timeline, statistics, agreement between classifications and a network of relations.",
      },
      {
        scope: "authorities",
        category: "new",
        es: "Unificar valores escritos de formas distintas y enlazarlos con Wikidata, Getty e Iconclass.",
        en: "Unify values written in different ways and link them to Wikidata, Getty and Iconclass.",
      },
      {
        scope: "publish",
        category: "new",
        es: "Citas, láminas en PDF y exportación de anotaciones W3C.",
        en: "Citations, PDF plates and W3C annotation export.",
      },
    ],
  },
];

/** -1, 0 or 1, comparing versions such as "0.1.10" and "0.1.9". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number(x) || 0),
    pb = b.split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Every version up to the installed one, newest first (the window's history). */
export function releaseNotesUpTo(current: string, notes = RELEASE_NOTES): ReleaseNote[] {
  return notes.filter((n) => compareVersions(n.version, current.split("-")[0]) <= 0);
}

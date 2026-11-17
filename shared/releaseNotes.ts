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
    version: "0.1.7",
    date: "2026-11-17",
    highlights: [
      {
        scope: "places",
        category: "enhancement",
        es: "El mapa se abre en la zona donde están tus fotografías: un país si son de un país, un continente o el mundo si se reparten por ellos. Recuerda el último encuadre de cada base de datos y ya no salta cuando llegan cambios mientras lo exploras.",
        en: "The map opens on the region where your photographs are: a country when they are in one country, a continent or the world when they spread that far. It remembers each database's last framing and no longer jumps when changes arrive while you explore it.",
      },
      {
        scope: "places",
        category: "fix",
        es: "El mapa con miles de fotografías ya no frena ni bloquea Imago: el zoom va fluido, deja de aparecer el círculo de carga a cada rato y solo se vuelve a dibujar cuando cambian los registros. Las vistas repetidas se calculan en una fracción de segundo.",
        en: "A map with thousands of photographs no longer slows down or freezes Imago: zooming is smooth, the loading spinner stops appearing every few seconds and the map only redraws when the records change. Repeated views are found in a fraction of a second.",
      },
      {
        scope: "general",
        category: "fix",
        es: "Al cerrar Imago o instalar una actualización ya no aparece el error «Imago se está cerrando», y los mensajes de error ya no empiezan por «Error invoking remote method».",
        en: "Closing Imago or installing an update no longer shows the «Imago is closing» error, and error messages no longer start with «Error invoking remote method».",
      },
      {
        scope: "general",
        category: "enhancement",
        es: "Todas las ventanas llevan un icono junto al título, el mismo que el botón que las abre.",
        en: "Every window shows an icon beside its title, the same as the button that opens it.",
      },
    ],
  },
  {
    version: "0.1.6",
    date: "2026-11-17",
    highlights: [
      {
        scope: "catalogue",
        category: "enhancement",
        es: "Ordenamientos encadenados por propiedades: cada criterio deshace los empates del anterior, se reordenan arrastrando desde el asa (o con las flechas) y se quitan con la papelera. Cada uno elige la dirección, si los vacíos van al principio o al final y, en las propiedades de selección, si se ordena por el orden de las opciones, por su nombre o por cuántos valores tiene el registro.",
        en: "Chained sorts by property: each rule breaks the ties of the one above, rules are reordered by dragging their handle (or with the arrow keys) and removed with the bin. Each one chooses its direction, whether empty values go first or last and, for select properties, whether to sort by option order, option name or how many values a record has.",
      },
      {
        scope: "catalogue",
        category: "enhancement",
        es: "Los filtros de selección y selección múltiple muestran todas las opciones como casillas, con buscador, su color y cuántos registros tiene cada una. Las condiciones también se reordenan arrastrando.",
        en: "Select and multi-select filters list every option as a checkbox, with a search box, its colour and how many records use it. Conditions can also be reordered by dragging.",
      },
      {
        scope: "catalogue",
        category: "new",
        es: "Bajo la barra de herramientas, cada filtro y ordenamiento activo aparece como una etiqueta: al pulsarla se abre el panel y con la × se quita.",
        en: "Below the toolbar, each active filter and sort shows as a chip: click it to open the panel, or use × to remove it.",
      },
      {
        scope: "search",
        category: "enhancement",
        es: "La tabla de Búsqueda muestra las propiedades de cada base de datos y la miniatura de sus imágenes. Las propiedades con el mismo nombre y tipo de varias bases se juntan en una columna.",
        en: "The Search table shows each database's properties and image thumbnails. Same-named properties of the same type across databases share one column.",
      },
      {
        scope: "catalogue",
        category: "enhancement",
        es: "La ficha de un registro sigue el orden de las columnas de la tabla, y las propiedades ocultas quedan plegadas al final.",
        en: "A record's panel follows the table's column order, and hidden properties are folded away at the end.",
      },
      {
        scope: "compare",
        category: "enhancement",
        es: "La barra lateral de la Mesa de comparación tiene el mismo ancho que la de Restauraciones, con su icono y una descripción.",
        en: "The Comparison table sidebar has the same width as the Restorations one, with its icon and a description.",
      },
    ],
  },
  {
    version: "0.1.5",
    date: "2026-11-16",
    highlights: [
      {
        scope: "catalogue",
        category: "enhancement",
        es: "Los bordes de las columnas de la tabla se ven en la cabecera. Al arrastrar uno, dos líneas verticales cruzan la tabla (dónde estaba y dónde está) con el ancho en píxeles; Escape lo deja como estaba.",
        en: "Table column edges show in the header. While dragging one, two vertical lines cross the table (where it was and where it is) with the width in pixels; Escape puts it back.",
      },
      {
        scope: "general",
        category: "fix",
        es: "Cambiar el ancho de una columna en una base de datos grande podía congelar la ventana hasta dejarla en blanco. Ahora va fluido, y si la ventana fallara se recupera sola o muestra un aviso con un botón para recargarla, sin tener que cerrar Imago.",
        en: "Resizing a column in a large database could freeze the window until it went blank. It is now smooth, and if the window ever fails it recovers on its own or shows a notice with a button to reload it, without closing Imago.",
      },
      {
        scope: "catalogue",
        category: "fix",
        es: "Las miniaturas ya preparadas se muestran al momento aunque haya una importación o una indexación en marcha, en vez de quedarse en blanco un rato.",
        en: "Thumbnails already prepared show at once even while an import or indexing is running, instead of staying blank for a while.",
      },
      {
        scope: "catalogue",
        category: "fix",
        es: "El editor de recorte prepara la imagen completa en cuanto se abre el visor y avisa mientras carga o si no puede cargarla, en lugar de dejar los botones sin efecto.",
        en: "The crop editor prepares the whole image as soon as the viewer opens and says so while it loads or if it cannot load it, instead of leaving the buttons without effect.",
      },
      {
        scope: "ai",
        category: "enhancement",
        es: "El chat junto a una base de datos consulta solo esa base de datos, así que ya no muestra el selector de fuentes.",
        en: "The chat beside a database reads only that database, so it no longer shows the source picker.",
      },
      {
        scope: "catalogue",
        category: "fix",
        es: "Al anotar una zona, «Guardar» va a la izquierda y «Cancelar» a la derecha, con el estilo oscuro del visor.",
        en: "When annotating a region, “Save” is on the left and “Cancel” on the right, in the viewer’s dark style.",
      },
    ],
  },
  {
    version: "0.1.4",
    date: "2026-11-16",
    highlights: [
      {
        scope: "catalogue",
        category: "new",
        es: "Junto a «Ampliar y anotar» hay botones para girar la imagen 90° a la izquierda o a la derecha. El giro se guarda en la ficha sin tocar el archivo original, y las anotaciones giran con la imagen.",
        en: "Next to “Enlarge and annotate” there are buttons to turn the image 90° left or right. The turn is kept in the record without touching the original file, and annotations turn with the image.",
      },
      {
        scope: "catalogue",
        category: "new",
        es: "Las imágenes se pueden recortar a mano, arrastrando el marco o sus esquinas, y volver al original cuando se quiera. El archivo original nunca se modifica.",
        en: "Images can be cropped by hand, dragging the frame or its corners, and returned to the original at any time. The original file is never changed.",
      },
      {
        scope: "catalogue",
        category: "new",
        es: "Las bases de datos se abren en la vista de tabla. Con clic derecho en una pestaña de vista, «Destacar» hace que sea la que se abre en esa base de datos.",
        en: "Databases open in the table view. Right-clicking a view tab and choosing “Feature” makes it the view that opens for that database.",
      },
      {
        scope: "search",
        category: "new",
        es: "La primera vez que se indexan las imágenes, Imago pregunta la calidad, con el tiempo estimado de cada nivel. Viene marcada la rápida.",
        en: "The first time images are indexed, Imago asks for the quality, with the estimated time of each level. Fast is selected by default.",
      },
      {
        scope: "search",
        category: "enhancement",
        es: "Las imágenes se indexan mientras se importan, sin esperar al final. Un volumen grande se indexa en tandas de unos 15 minutos que se encadenan solas.",
        en: "Images are indexed while they are imported, without waiting for the end. A large backlog is indexed in batches of about 15 minutes that follow one another on their own.",
      },
      {
        scope: "catalogue",
        category: "enhancement",
        es: "La importación de imágenes es unas tres veces más rápida: prepara varias a la vez y ajusta cuántas según el ordenador. Si otros programas necesitan el procesador o falta memoria, cede.",
        en: "Image import is about three times faster: it prepares several images at once and adjusts how many to the computer. When other programs need the processor or memory runs short, it gives way.",
      },
      {
        scope: "general",
        category: "fix",
        es: "Las pestañas de vista se movían de sitio al cambiar a una vista sin botones superiores. Ahora se quedan siempre en la misma posición.",
        en: "View tabs moved when switching to a view without top buttons. They now always stay in the same place.",
      },
      {
        scope: "general",
        category: "fix",
        es: "En Configuración, el menú lateral se desplazaba unos píxeles al cambiar de sección. Ya no se mueve.",
        en: "In Settings, the side menu shifted a few pixels when switching sections. It no longer moves.",
      },
    ],
  },
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

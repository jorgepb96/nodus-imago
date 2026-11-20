// Short guided tutorials, one task each, run by the tour engine
// (GuidedTour.tsx) in strict mode over the real interface: the researcher
// does every step themself, the highlighted control shows where.
//
// Writing rule, as for the tour: say what to do and what happens, in plain
// words. A step that waits for an action names it in `until`, so the
// tutorial moves on once it is done; `missing` says how to make a control
// appear when it is not on screen yet.
import type { TourStep } from "./components/GuidedTour";

/** The learning path: five levels, from the essentials to research. */
export type TutorialLevel = "basics" | "images" | "organize" | "ai" | "research";

export const TUTORIAL_LEVELS: { id: TutorialLevel; label: string; summary: string }[] = [
  { id: "basics", label: "Lo esencial", summary: "Crea tu colección, rellena sus datos y protégela." },
  { id: "images", label: "Trabajar con imágenes", summary: "Comenta, endereza, compara y restaura tus imágenes." },
  { id: "organize", label: "Organizar y encontrar", summary: "Filtra, sitúa en el mapa y en el tiempo, y busca por lo que se ve." },
  { id: "ai", label: "La IA trabaja para ti", summary: "Describe, etiqueta y transcribe muchas imágenes a la vez, sin perder el control." },
  { id: "research", label: "Investigar y publicar", summary: "Analiza la colección, pregúntale, enlaza con autoridades y prepara tus publicaciones." },
];

export type Tutorial = {
  id: string;
  title: string;
  /** What the tutorial teaches, in one or two sentences. */
  summary: string;
  /** Its place in the learning path; the list order is the path order. */
  level: TutorialLevel;
  /** Rough time to follow it, in minutes. */
  minutes: number;
  /** What has to be ready first, when something has to. */
  needs?: string;
  /** Extra words to find it by, in Spanish and English. */
  keywords: string[];
  steps: TourStep[];
};

const OPEN_DATABASE = "Abre una base de datos de la lista COLECCIONES, en la vista Tabla, para ver este control.";
const NEEDS_ROWS = "Abre una base de datos con algún registro, en la vista Tabla. Si está vacía, crea uno con «Añadir registros».";
const OPEN_RECORD = "Abre un registro con imagen: pulsa la flecha ↗ al final de su fila en la tabla.";
const NEEDS_DESCRIBER = "Un modelo que lea imágenes: elígelo en Ajustes › Modelos IA (en este ordenador o de un proveedor).";
const NEEDS_SEARCH = "La colección preparada para la búsqueda semántica: elige el modelo en Ajustes › Modelos IA.";

/** The usual way into a record, shared by several tutorials. */
const openRecord: TourStep = {
  target: "row-open",
  area: "databases",
  title: "Abre un registro",
  body: "Pulsa la flecha ↗ al final de la fila de un registro con imagen. Se abre su ficha a la derecha.",
  until: "record-panel",
  missing: NEEDS_ROWS,
};
const selectRows: TourStep = {
  target: "row-select",
  area: "databases",
  title: "Elige los registros",
  body: "Marca la casilla de los registros con los que quieres trabajar. La casilla de la cabecera marca todos los de la página.",
  until: "selection-analyze",
  missing: NEEDS_ROWS,
};
const analyze: TourStep = {
  target: "selection-analyze",
  title: "Pulsa Analizar",
  body: "Al marcar registros aparece esta barra encima de la tabla. Pulsa Analizar.",
  until: "analyze-form",
  missing: "Marca al menos un registro en la tabla para que aparezca la barra con el botón Analizar.",
};
const run: TourStep = {
  target: "analyze-run",
  title: "Genera las propuestas",
  body: "Pulsa Generar propuestas. El análisis se hace en segundo plano: se abre la lista de Tareas para que veas cómo avanza, y puedes seguir trabajando.",
  until: "jobs-list",
  missing: "Pulsa Analizar en la barra de selección para abrir esta ventana.",
};
const review: TourStep = {
  target: "review-proposals",
  area: "databases",
  title: "Revisa y acepta",
  body: "Nada se guarda sin tu permiso: los resultados quedan como propuestas. Cuando la tarea termine, pulsa Revisar propuestas para leerlas y aceptarlas o rechazarlas una a una o todas a la vez. «Deshacer» devuelve los valores anteriores.",
  missing: "Cierra la ventana de Tareas. El botón Revisar propuestas está encima de la tabla, junto a las flechas para pasar de página.",
};

export const TUTORIALS: Tutorial[] = [
  {
    id: "first-database",
    title: "Crear una base de datos e importar imágenes",
    summary: "Crea tu primera base de datos y llénala con imágenes de tu ordenador: cada imagen se convierte en un registro.",
    level: "basics",
    minutes: 2,
    keywords: ["empezar", "nueva", "colección", "importar", "carpeta", "start", "new", "collection", "import", "folder", "create"],
    steps: [
      {
        target: "db-new",
        area: "home",
        title: "Crea la base de datos",
        body: "Pulsa + junto a COLECCIONES, escribe un nombre (por ejemplo, «Fotografías de familia») y pulsa Crear. Una base de datos guarda registros: cada registro es una ficha con sus imágenes y sus propiedades.",
        until: "db-import",
      },
      {
        target: "db-import",
        title: "Importa las imágenes",
        body: "Abre Importar y elige «Importar imágenes» para elegir archivos sueltos o «Importar carpeta» para traer una carpeta entera. Cada imagen crea un registro con el nombre del archivo como título. También puedes arrastrar imágenes sobre la base de datos.",
        missing: OPEN_DATABASE,
      },
      {
        target: "header-queue",
        title: "Sigue la importación",
        body: "El reloj de la barra superior cuenta las tareas en curso: copiar las imágenes, hacer sus miniaturas y prepararlas para la búsqueda. Puedes seguir trabajando mientras tanto.",
      },
      {
        target: "db-views",
        title: "Elige cómo verlas",
        body: "Tabla muestra una fila por registro para editar sus propiedades; Galería muestra las imágenes grandes. El resto de pestañas ordena los mismos registros en un mapa, una cronología o por parecido.",
        missing: OPEN_DATABASE,
      },
    ],
  },
  {
    id: "edit-properties",
    title: "Rellenar los datos de tus registros",
    summary: "Las propiedades son los datos de cada registro: fecha, lugar, fotógrafo, notas… Crea las que necesites y rellénalas en la ficha o en la tabla.",
    level: "basics",
    minutes: 2,
    keywords: ["propiedades", "columnas", "campos", "datos", "editar", "rellenar", "tipo", "properties", "columns", "fields", "edit", "metadata"],
    steps: [
      {
        target: "db-properties",
        area: "databases",
        title: "Las propiedades son tus columnas",
        body: "Cada propiedad es una columna de la tabla y un campo de la ficha de cada registro. Pulsa Propiedades para ver las que tienes.",
        until: "add-property",
        missing: OPEN_DATABASE,
      },
      {
        target: "add-property",
        title: "Crea una propiedad",
        body: "Pulsa Añadir propiedad, ponle un nombre y elige su tipo: Texto simple o enriquecido para notas, Número, Fecha o Fecha histórica, Selección y Selección múltiple para listas cerradas, Ubicación para lugares, Persona o grupo… El tipo decide cómo se escribe, cómo se filtra y qué puede hacer la IA con ella. Guarda y cierra la ventana.",
        missing: "Pulsa Propiedades, arriba a la derecha de la base de datos.",
      },
      openRecord,
      {
        target: "record-properties",
        title: "Rellénala en la ficha",
        body: "Pulsa en el valor de una propiedad, escríbelo y pulsa Intro o sal del campo: se guarda solo. En la tabla puedes hacer lo mismo directamente en cada celda.",
        missing: OPEN_RECORD,
      },
    ],
  },
  {
    id: "attach-image",
    title: "Adjuntar una imagen a un registro",
    summary: "Añade una o varias imágenes a una ficha que ya existe, elige la principal y ábrela a pantalla completa.",
    level: "basics",
    minutes: 1,
    keywords: ["adjuntar", "añadir", "subir", "foto", "anverso", "reverso", "principal", "attach", "add", "upload", "photo", "primary"],
    steps: [
      {
        target: "row-image-add",
        area: "databases",
        title: "Añade la imagen",
        body: "Pulsa el icono de imagen al final de la fila y elige uno o varios archivos. Se copian a tu colección; el archivo original no se toca. Así puedes guardar juntos el anverso y el reverso de una fotografía.",
        missing: NEEDS_ROWS,
      },
      openRecord,
      {
        target: "record-image-open",
        title: "La imagen en la ficha",
        body: "Pulsa la imagen para verla a pantalla completa. Si el registro tiene varias, pasa de una a otra con las flechas de debajo y marca con la estrella la principal: es la que se ve en la tabla, en la galería y en el mapa.",
        missing: OPEN_RECORD,
      },
    ],
  },
  {
    id: "import-catalog",
    title: "Importar un catálogo que ya tienes",
    summary: "Trae tu inventario desde una hoja de cálculo, Tropy o una biblioteca digital, y empareja después cada imagen con su registro.",
    level: "basics",
    minutes: 3,
    keywords: ["importar", "csv", "excel", "hoja de cálculo", "tropy", "iiif", "catálogo", "inventario", "emparejar", "import", "spreadsheet", "catalogue", "inventory", "match"],
    steps: [
      {
        target: "db-import",
        area: "databases",
        title: "Importa las fichas",
        body: "Abre Importar. «CSV o TSV» trae una hoja de cálculo: cada fila será un registro y cada columna una propiedad, y antes de importar eliges el tipo de cada columna. «Proyecto de Tropy» trae fichas, notas y fotos de Tropy, y «Manifiesto IIIF» las de una biblioteca digital.",
        missing: OPEN_DATABASE,
      },
      {
        target: "db-import",
        area: "databases",
        title: "Empareja las imágenes",
        body: "Si las imágenes están aparte, «Importar imágenes» o «Importar carpeta» busca el registro de cada archivo comparando su nombre con una columna de referencia (por ejemplo, la signatura). Revisa las correspondencias dudosas antes de confirmar; las que no encuentren registro pueden crear uno nuevo.",
        missing: OPEN_DATABASE,
      },
    ],
  },
  {
    id: "backups",
    title: "Hacer copias de seguridad",
    summary: "Protege tu colección con copias cifradas y automáticas, y comprueba que se pueden restaurar.",
    level: "basics",
    minutes: 2,
    keywords: ["copia de seguridad", "copias", "backup", "restaurar", "cifrado", "contraseña", "backups", "restore", "encrypted", "password"],
    steps: [
      {
        target: "settings-tab-storage",
        area: "settings",
        tab: "storage",
        title: "Almacenamiento y copias",
        body: "Elige una carpeta para las copias (mejor en otro disco o en una carpeta sincronizada) y una contraseña para cifrarlas. Después puedes programar copias automáticas, hacer una al momento y comprobar que se pueden restaurar.",
      },
    ],
  },
  {
    id: "annotate",
    title: "Comentar una zona de la imagen",
    summary: "Marca una parte de la imagen (una persona, una inscripción, un edificio) y escribe una nota sobre ella. Las notas se pueden buscar.",
    level: "images",
    minutes: 2,
    keywords: ["comentario", "comentar", "nota", "anotar", "anotación", "zona", "detalle", "comment", "note", "annotate", "annotation", "region", "detail"],
    steps: [
      openRecord,
      {
        target: "record-image-open",
        title: "Abre el visor",
        body: "Pulsa la imagen para verla a pantalla completa.",
        until: "viewer-annotate",
        missing: OPEN_RECORD,
      },
      {
        target: "viewer-annotate",
        title: "Activa Anotar",
        body: "Pulsa Anotar (o la tecla A). El cursor cambia para que puedas marcar una zona.",
        missing: "Pulsa la imagen de la ficha para abrir el visor.",
      },
      {
        target: "viewer-stage",
        title: "Marca la zona",
        body: "Arrastra sobre la imagen para dibujar un rectángulo alrededor de lo que quieres comentar.",
        until: "annotation-editor",
        missing: "Pulsa la imagen de la ficha para abrir el visor.",
      },
      {
        target: "annotation-editor",
        title: "Escribe el comentario",
        body: "Escribe la nota y, si quieres, unas etiquetas. Pulsa Guardar. La nota forma parte del registro: la búsqueda también la encuentra.",
        missing: "Con Anotar activado, arrastra sobre la imagen para marcar una zona.",
      },
      {
        target: "viewer-annotations",
        title: "Tus comentarios",
        body: "Aquí se listan las zonas comentadas. Pulsa una para acercar la imagen a esa zona; la lupa busca ese mismo detalle en las demás imágenes; el lápiz edita la nota.",
        missing: "Pulsa la imagen de la ficha para abrir el visor.",
      },
    ],
  },
  {
    id: "crop-rotate",
    title: "Recortar o girar una imagen",
    summary: "Endereza una foto escaneada de lado o quita los bordes. El archivo original nunca se modifica.",
    level: "images",
    minutes: 1,
    keywords: ["recortar", "girar", "rotar", "bordes", "enderezar", "crop", "rotate", "turn", "borders"],
    steps: [
      openRecord,
      {
        target: "record-image-tools",
        title: "Gira o recorta",
        body: "Estos botones giran la imagen 90° a cada lado y abren el recorte. Se guarda una versión aparte: el original sigue intacto.",
        missing: OPEN_RECORD,
      },
      {
        target: "viewer-stage",
        title: "Ajusta el recorte",
        body: "Arrastra el marco o sus esquinas para elegir la parte que quieres ver y pulsa Aplicar recorte. Más tarde, «Volver al original» quita el recorte.",
        missing: "Pulsa el botón de recortar de la imagen para abrir el editor de recorte.",
      },
    ],
  },
  {
    id: "compare",
    title: "Comparar imágenes lado a lado",
    summary: "Pon varias imágenes juntas con el zoom sincronizado o superpón dos para ver qué cambia entre ellas.",
    level: "images",
    minutes: 1,
    keywords: ["comparar", "comparación", "lado a lado", "superponer", "diferencias", "compare", "side by side", "overlay", "differences"],
    steps: [
      {
        ...selectRows,
        body: "Marca la casilla de entre dos y seis registros con imagen.",
        until: "selection-compare",
      },
      {
        target: "selection-compare",
        title: "Pulsa Comparar",
        body: "Abre las imágenes principales de los registros marcados en la mesa de comparación.",
        until: "compare-add",
        missing: "Marca al menos un registro en la tabla para que aparezca la barra de selección.",
      },
      {
        target: "compare-add",
        area: "compare",
        title: "La mesa de comparación",
        body: "Al acercar o mover una imagen, las demás la siguen. Añade más imágenes con este botón (hasta seis) o cambia a Superponer para ver dos una encima de otra.",
      },
    ],
  },
  {
    id: "restore",
    title: "Restaurar o colorear una foto",
    summary: "Crea una versión reparada o coloreada de una imagen con un modelo de IA, sin tocar el original.",
    level: "images",
    minutes: 2,
    needs: "Una clave de OpenAI, Gemini u OpenRouter, en Ajustes › Proveedores.",
    keywords: ["restaurar", "restauración", "colorear", "reparar", "manchas", "restore", "restoration", "colorize", "repair", "scratches"],
    steps: [
      openRecord,
      {
        target: "record-restore",
        title: "Pulsa Restaurar con IA",
        body: "Abre el taller de restauración con esta imagen.",
        missing: OPEN_RECORD,
      },
      {
        target: "nav-restorations",
        title: "El taller de restauración",
        body: "Elige la tarea (restaurar, reparar daños, mejorar la nitidez, colorear o una instrucción propia) y el modelo. Puedes tratar la imagen entera o solo una zona anotada. Arrastra sobre el resultado para compararlo con el original y descárgalo, con una marca de agua si quieres. Cada versión se guarda aparte.",
      },
    ],
  },
  {
    id: "filter-sort",
    title: "Filtrar y ordenar registros",
    summary: "Muestra solo los registros que cumplen unas condiciones y ordénalos por una o varias propiedades.",
    level: "organize",
    minutes: 1,
    keywords: ["filtro", "filtrar", "ordenar", "condición", "orden", "buscar", "filter", "sort", "order", "condition"],
    steps: [
      {
        target: "db-filter",
        area: "databases",
        title: "Abre Filtrar y ordenar",
        body: "Añade una condición, como «Lugar contiene Granada» o «Año es posterior a 1950». Puedes combinar varias con Y u O, agruparlas y ordenar por varias propiedades a la vez.",
        missing: OPEN_DATABASE,
      },
      {
        target: "db-columns",
        area: "databases",
        title: "Desde la cabecera",
        body: "Con clic derecho sobre el nombre de una columna también puedes filtrar u ordenar por ella, y calcular un total al pie de la tabla.",
        missing: OPEN_DATABASE,
      },
      {
        target: "db-search",
        area: "databases",
        title: "Busca dentro de la base",
        body: "Este buscador deja en la tabla solo los registros que contienen lo que escribes, y se combina con los filtros.",
        missing: OPEN_DATABASE,
      },
    ],
  },
  {
    id: "add-place",
    title: "Añadir un lugar a una imagen",
    summary: "Sitúa un registro en el mapa: escribe el lugar, elige la sugerencia y míralo junto a las demás fotos de la zona.",
    level: "organize",
    minutes: 2,
    keywords: ["lugar", "ubicación", "mapa", "coordenadas", "geolocalizar", "ciudad", "place", "location", "map", "coordinates", "geotag"],
    steps: [
      {
        target: "db-properties",
        area: "databases",
        title: "Ten una propiedad de ubicación",
        body: "Los lugares se guardan en una propiedad de tipo Ubicación. Si tu base aún no tiene una, pulsa Propiedades › Añadir propiedad y elige ese tipo.",
        missing: OPEN_DATABASE,
      },
      openRecord,
      {
        target: "record-prop-location",
        title: "Escribe el lugar",
        body: "Escribe el nombre del sitio (una ciudad, un barrio, un monumento) y elige una sugerencia de la lista: se guardan el nombre y las coordenadas. Si el sitio no aparece, puedes guardar el nombre tal cual.",
        missing: "Abre un registro y busca la propiedad de ubicación. Si no la ves, créala en Propiedades con el tipo Ubicación.",
      },
      {
        target: "view-map",
        area: "databases",
        title: "Míralo en el mapa",
        body: "Cierra la ficha y pulsa la pestaña Mapa: el registro aparece en su sitio, junto a los cercanos.",
        until: "map-canvas",
        missing: OPEN_DATABASE,
      },
      {
        target: "map-canvas",
        title: "Explora el mapa",
        body: "El mapa se abre encuadrado en la zona donde hay fotos. Acerca con la rueda del ratón, pulsa un grupo para ver sus registros y abre cualquier ficha desde la lista.",
        missing: "Pulsa la pestaña Mapa de la base de datos.",
      },
    ],
  },
  {
    id: "then-now",
    title: "Entonces y ahora",
    summary: "Encuentra fotografías actuales del mismo lugar y reúne las vistas tomadas desde el mismo punto en distintas épocas.",
    level: "organize",
    minutes: 2,
    needs: "Registros con ubicación: sigue antes «Añadir un lugar a una imagen».",
    keywords: ["entonces y ahora", "antes y después", "actual", "wikimedia", "commons", "vistas repetidas", "refotografía", "then and now", "before after", "rephotography", "repeated views"],
    steps: [
      {
        target: "view-map",
        area: "databases",
        title: "Abre el mapa",
        body: "Pulsa la pestaña Mapa de la base de datos.",
        until: "map-canvas",
        missing: OPEN_DATABASE,
      },
      {
        target: "map-canvas",
        title: "Elige un registro",
        body: "Pulsa un punto del mapa que tenga un solo registro. Al elegirlo aparece el botón «Entonces y ahora».",
        until: "map-then-now",
        missing: "Pulsa la pestaña Mapa de la base de datos.",
      },
      {
        target: "map-then-now",
        title: "Busca el lugar hoy",
        body: "«Entonces y ahora» busca fotografías actuales tomadas cerca en Wikimedia Commons, para comparar el lugar con tu imagen antigua.",
        missing: "Elige en el mapa un punto con un solo registro para ver este botón.",
      },
      {
        target: "map-repeated-views",
        title: "Vistas repetidas",
        body: "Reúne las fotografías tomadas a menos de 80 m entre sí y, si consta la dirección de la cámara, mirando hacia el mismo lado: la misma calle o la misma plaza vista en distintos momentos.",
        missing: "Pulsa la pestaña Mapa de la base de datos.",
      },
    ],
  },
  {
    id: "timeline",
    title: "Ver tus fotos en una cronología",
    summary: "Ordena los registros por año en una línea de tiempo, también con fechas aproximadas como «c. 1930» o «años 50».",
    level: "organize",
    minutes: 1,
    keywords: ["cronología", "fecha", "año", "década", "tiempo", "timeline", "date", "year", "decade", "chronology"],
    steps: [
      {
        target: "view-timeline",
        area: "databases",
        title: "Pulsa Cronología",
        body: "Necesitas una propiedad de tipo Fecha o Fecha histórica. Con una fecha aproximada («c. 1930», «años 50») el registro ocupa su periodo y se marca como aproximado.",
        missing: OPEN_DATABASE,
      },
    ],
  },
  {
    id: "semantic-search",
    title: "Buscar describiendo lo que se ve",
    summary: "Encuentra imágenes escribiendo lo que muestran, aunque ningún registro tenga esas palabras.",
    level: "organize",
    minutes: 1,
    needs: NEEDS_SEARCH,
    keywords: ["búsqueda", "semántica", "buscar", "significado", "híbrida", "search", "semantic", "meaning", "hybrid", "query"],
    steps: [
      {
        target: "search-modes",
        area: "search",
        title: "Elige el tipo de búsqueda",
        body: "Híbrida, la que viene elegida, combina las palabras exactas con el significado. Semántica busca solo por significado y compara también con lo que se ve en las imágenes. Literal busca las palabras exactas en títulos y propiedades.",
      },
      {
        target: "search-input",
        area: "search",
        title: "Describe lo que buscas",
        body: "Escribe, por ejemplo, «niños jugando en una plaza» y pulsa Buscar. En Híbrida o Semántica la encuentra aunque ningún registro diga «niños» ni «plaza».",
      },
    ],
  },
  {
    id: "similar-images",
    title: "Encontrar imágenes parecidas",
    summary: "Parte de una imagen y encuentra las que se le parecen en toda tu colección: copias, la misma escena o el mismo lugar.",
    level: "organize",
    minutes: 1,
    needs: NEEDS_SEARCH,
    keywords: ["similares", "parecidas", "duplicados", "copias", "imagen", "similar", "duplicates", "copies", "lookalike", "reverse image"],
    steps: [
      openRecord,
      {
        target: "record-similar",
        title: "Busca imágenes similares",
        body: "Pulsa «Buscar imágenes similares»: se abre la búsqueda con todas las imágenes de la colección ordenadas por parecido.",
        until: "search-modes",
        missing: OPEN_RECORD,
      },
      {
        target: "search-image",
        area: "search",
        title: "O parte de una imagen de fuera",
        body: "En la búsqueda, en modo Semántica o Híbrida, este botón adjunta una imagen de tu ordenador para encontrar las que se le parecen, aunque no esté en tu colección.",
      },
    ],
  },
  {
    id: "ai-describe",
    title: "Generar descripciones con IA",
    summary: "Haz que un modelo de IA escriba qué se ve en tus imágenes. Las descripciones llegan como propuestas que revisas antes de guardarlas.",
    level: "ai",
    minutes: 3,
    needs: NEEDS_DESCRIBER,
    keywords: ["describir", "descripción", "inteligencia artificial", "modelo", "propuestas", "describe", "description", "ai", "caption", "proposals"],
    steps: [
      {
        target: "db-properties",
        area: "databases",
        title: "Ten una propiedad para el texto",
        body: "La descripción se escribe en una propiedad de texto. Si no tienes una, pulsa Propiedades › Añadir propiedad, llámala «Descripción» y elige el tipo Texto enriquecido.",
        missing: OPEN_DATABASE,
      },
      selectRows,
      analyze,
      {
        target: "analyze-form",
        title: "Elige la propiedad y la tarea",
        body: "Marca la propiedad «Descripción» y deja elegida «Describir lo que se ve en la imagen». «Descripción detallada» da un texto más largo. Solo se rellenan las propiedades que están vacías.",
        missing: "Pulsa Analizar en la barra de selección para abrir esta ventana.",
      },
      run,
      review,
    ],
  },
  {
    id: "ai-tags",
    title: "Etiquetar imágenes con IA",
    summary: "Crea una lista de etiquetas y deja que la IA elija las que corresponden a cada imagen. Tú apruebas el resultado.",
    level: "ai",
    minutes: 3,
    needs: NEEDS_DESCRIBER,
    keywords: ["etiquetas", "etiquetar", "clasificar", "categorías", "selección múltiple", "tags", "tag", "classify", "categories", "labels"],
    steps: [
      {
        target: "db-properties",
        area: "databases",
        title: "Abre Propiedades",
        body: "Las etiquetas se guardan en una propiedad de tipo Selección múltiple. Pulsa Propiedades.",
        until: "add-property",
        missing: OPEN_DATABASE,
      },
      {
        target: "add-property",
        title: "Crea la lista de etiquetas",
        body: "Pulsa Añadir propiedad, llámala «Etiquetas», elige Selección múltiple y escribe las etiquetas posibles como opciones (por ejemplo: retrato, paisaje, interior, multitud). La IA solo elige entre estas opciones: no inventa etiquetas nuevas. Guarda y cierra la ventana.",
        missing: "Pulsa Propiedades, arriba a la derecha de la base de datos.",
      },
      selectRows,
      analyze,
      {
        target: "analyze-form",
        title: "Marca la propiedad de etiquetas",
        body: "Marca «Etiquetas». Para cada imagen elegirá hasta cinco etiquetas de la lista, o una sola si la propiedad es de tipo Selección.",
        missing: "Pulsa Analizar en la barra de selección para abrir esta ventana.",
      },
      run,
      review,
      {
        target: "db-automations",
        area: "databases",
        title: "Para toda la base de datos",
        body: "Analizar trabaja con los registros que marcas. Si quieres que la IA rellene una propiedad en todos los registros, incluidos los que añadas después, crea una Automatización.",
      },
    ],
  },
  {
    id: "ai-transcribe",
    title: "Transcribir reversos e inscripciones",
    summary: "Pasa a texto lo que está escrito en las imágenes: reversos, sellos, firmas, dedicatorias y pies de foto.",
    level: "ai",
    minutes: 2,
    needs: NEEDS_DESCRIBER,
    keywords: ["transcribir", "transcripción", "texto", "leer", "reverso", "sello", "firma", "dedicatoria", "transcribe", "ocr", "text", "back", "stamp", "signature"],
    steps: [
      {
        target: "db-properties",
        area: "databases",
        title: "Ten una propiedad para la transcripción",
        body: "La transcripción se guarda en una propiedad de texto. Si no tienes una, créala en Propiedades › Añadir propiedad, con el tipo Texto enriquecido (por ejemplo, «Inscripciones»).",
        missing: OPEN_DATABASE,
      },
      selectRows,
      analyze,
      {
        target: "analyze-task",
        title: "Elige Transcribir",
        body: "Marca la propiedad y elige «Transcribir el texto visible». Lee todas las imágenes del registro, también el reverso, conserva la ortografía original y marca lo que no se puede leer como [ilegible].",
        missing: "Pulsa Analizar en la barra de selección para abrir esta ventana.",
      },
      run,
      review,
    ],
  },
  {
    id: "suggest",
    title: "Rellenar huecos con imágenes parecidas",
    summary: "Propone valores para los registros vacíos copiándolos de las imágenes más parecidas que sí los tienen.",
    level: "ai",
    minutes: 1,
    needs: NEEDS_SEARCH,
    keywords: ["completar", "rellenar", "vacíos", "sugerir", "propagar", "complete", "fill", "empty", "suggest"],
    steps: [
      {
        target: "db-suggest",
        area: "databases",
        title: "Pulsa Completar",
        body: "Elige una propiedad (por ejemplo, Fotógrafo o Lugar). Para cada registro vacío, busca las imágenes más parecidas que sí tienen ese dato y propone su valor con un grado de confianza. Puedes aceptar de una vez las de confianza alta. Nada se guarda hasta que lo aceptas, y se puede deshacer.",
        missing: OPEN_DATABASE,
      },
    ],
  },
  {
    id: "automations",
    title: "Rellenar una propiedad en toda la base",
    summary: "Crea una regla para que la IA rellene propiedades en todos los registros, también en los que añadas después.",
    level: "ai",
    minutes: 2,
    needs: NEEDS_DESCRIBER,
    keywords: ["automatización", "automatizar", "masivo", "todos", "lote", "automation", "batch", "bulk", "all records"],
    steps: [
      {
        target: "db-automations",
        area: "databases",
        title: "Abre Automatizaciones",
        body: "Añade una regla: en Cuándo, elige «Al crear un registro» para que se aplique a los que vayan llegando; en Acción, «Encolar análisis de IA» y las propiedades que debe rellenar. «Ejecutar sobre los registros actuales» la aplica también a los que ya tienes. Los valores llegan como propuestas que revisas.",
        missing: OPEN_DATABASE,
      },
      review,
    ],
  },
  {
    id: "statistics",
    title: "Sacar estadísticas de tu colección",
    summary: "Calcula frecuencias y tablas cruzadas de tus propiedades, con gráficos que puedes guardar y exportar.",
    level: "research",
    minutes: 2,
    keywords: ["estadísticas", "frecuencias", "tabla cruzada", "gráfico", "contar", "statistics", "frequencies", "crosstab", "chart", "count"],
    steps: [
      {
        target: "view-stats",
        area: "databases",
        title: "Pulsa Estadísticas",
        body: "Elige una propiedad para ver cuántos registros hay de cada valor, o dos para cruzarlas (por ejemplo, lugar por década). Guarda los análisis que quieras repetir.",
        missing: OPEN_DATABASE,
      },
    ],
  },
  {
    id: "patterns",
    title: "Descubrir patrones en las imágenes",
    summary: "Agrupa las imágenes por parecido, encuentra la misma foto en varios registros y mira qué valores aparecen juntos.",
    level: "research",
    minutes: 2,
    needs: NEEDS_SEARCH,
    keywords: ["mapa visual", "variantes", "red", "parecido", "grupos", "patrones", "visual map", "variants", "network", "clusters", "patterns"],
    steps: [
      {
        target: "view-visualmap",
        area: "databases",
        title: "Mapa visual",
        body: "Coloca las imágenes por parecido: las que se parecen aparecen juntas. Colorea por una propiedad para ver si coincide con los grupos y selecciona una zona para trabajar con ella.",
        missing: OPEN_DATABASE,
      },
      {
        target: "view-variants",
        area: "databases",
        title: "Variantes",
        body: "Reúne la misma imagen cuando aparece en varios registros (copias, reproducciones, recortes) y las ordena por fecha.",
        missing: OPEN_DATABASE,
      },
      {
        target: "view-network",
        area: "databases",
        title: "Red",
        body: "Muestra qué valores de dos o tres propiedades aparecen juntos en los mismos registros, por ejemplo qué fotógrafos trabajaron en qué lugares.",
        missing: OPEN_DATABASE,
      },
    ],
  },
  {
    id: "chat",
    title: "Preguntar a tu colección",
    summary: "Haz preguntas sobre tus registros en un chat: cuántos hay de un lugar, qué fotógrafos aparecen más, qué falta por catalogar.",
    level: "research",
    minutes: 1,
    needs: "Un modelo de chat de un proveedor, de Ollama o de LM Studio, elegido en Ajustes › Modelos IA.",
    keywords: ["chat", "preguntar", "pregunta", "conversación", "asistente", "ask", "question", "conversation", "assistant"],
    steps: [
      {
        target: "db-chat",
        area: "databases",
        title: "Abre el chat",
        body: "Se abre a la derecha de la tabla y lee esta base de datos. Pregunta, por ejemplo, «¿cuántas fotografías hay de cada década?». Cuando hace falta una cifra exacta, el modelo hace el cálculo sobre todos los registros en este ordenador.",
        missing: OPEN_DATABASE,
      },
      {
        target: "nav-chat",
        title: "Conversaciones guardadas",
        body: "La sección Chat guarda tus conversaciones en carpetas y permite preguntar a varias bases de datos a la vez.",
      },
    ],
  },
  {
    id: "authorities",
    title: "Enlazar con Wikidata o Iconclass",
    summary: "Conecta personas, lugares y temas con registros de autoridad para que tu catálogo hable el mismo idioma que otros archivos.",
    level: "research",
    minutes: 2,
    keywords: ["autoridades", "wikidata", "iconclass", "getty", "ulan", "tgn", "aat", "normalizar", "enlazar", "authorities", "authority", "link", "normalise"],
    steps: [
      {
        target: "db-columns",
        area: "databases",
        title: "Clic derecho en la columna",
        body: "Haz clic derecho sobre el nombre de una columna con personas, lugares o temas y elige «Enlazar con autoridades».",
        until: "authority-dialog",
        missing: OPEN_DATABASE,
      },
      {
        target: "authority-dialog",
        title: "Revisa los enlaces",
        body: "Elige la fuente: Wikidata, que incluye los identificadores de Getty (ULAN, TGN, AAT) cuando existen, o Iconclass para temas iconográficos, que se busca en inglés. Pulsa Buscar propuestas, revisa cada enlace y aplica los correctos. Solo se envía el texto de cada valor, y los enlaces se exportan con tus datos.",
        missing: "Haz clic derecho sobre el nombre de una columna y elige «Enlazar con autoridades».",
      },
    ],
  },
  {
    id: "heritage",
    title: "Identificar el patrimonio de tus fotos",
    summary: "Registra los monumentos, edificios, calles y obras que salen en tus fotos: enlázalos con Wikidata, sitúalos en el mapa, márcalos en la imagen y cuéntalos por tipología.",
    level: "research",
    minutes: 4,
    keywords: ["patrimonio", "monumento", "edificio", "iglesia", "castillo", "obra de arte", "tipología", "wikidata", "openstreetmap", "heritage", "monument", "building", "landmark", "artwork", "typology"],
    steps: [
      {
        target: "add-property-column",
        area: "databases",
        title: "Crea una propiedad Patrimonio",
        body: "Pulsa + al final de la cabecera de la tabla y elige Patrimonio (puedes escribirlo en el buscador del menú). Funciona como una selección múltiple: cada valor es un elemento patrimonial con su propia ficha, y una foto puede tener varios.",
        missing: OPEN_DATABASE,
      },
      {
        target: "db-columns",
        area: "databases",
        title: "Abre las fichas de patrimonio",
        body: "Cuando la propiedad tenga valores, haz clic derecho sobre su nombre y elige «Fichas de patrimonio». Cada ficha guarda el enlace a Wikidata, las coordenadas, la tipología y de qué conjunto forma parte.",
        until: "heritage-dialog",
        missing: OPEN_DATABASE,
      },
      {
        target: "heritage-identify-tab",
        title: "Identificar y situar",
        body: "Pulsa esta pestaña para identificar de una vez todos los elementos sin enlazar.",
        until: "heritage-identify",
        missing: "Haz clic derecho sobre el nombre de una propiedad Patrimonio y elige «Fichas de patrimonio».",
      },
      {
        target: "heritage-identify",
        title: "Tres pasos en segundo plano",
        body: "Wikidata identifica cada elemento; OpenStreetMap sitúa lo que Wikidata no tiene; lo que quede se sitúa en el centro de su localidad, como posición aproximada. Las búsquedas siguen en la lista de tareas: si se corta la conexión o cierras Imago, se pausan y continúan donde se quedaron. Revisa las propuestas, acepta las correctas y pulsa Aplicar; cada aplicación se puede revertir.",
        missing: "Haz clic derecho sobre el nombre de una propiedad Patrimonio y elige «Fichas de patrimonio».",
      },
      openRecord,
      {
        target: "record-image-open",
        title: "Abre el visor",
        body: "Pulsa la imagen para verla a pantalla completa.",
        until: "viewer-heritage",
        missing: OPEN_RECORD,
      },
      {
        target: "viewer-heritage",
        title: "Marca el elemento en la foto",
        body: "Pulsa Patrimonio y elige el elemento: márcalo con un punto o un rectángulo, o déjalo sin marcar. «Sugerir con IA» pide a un modelo de visión que reconozca los elementos de toda la imagen o de las zonas que dibujes.",
        missing: "Pulsa la imagen de la ficha para abrir el visor. El botón aparece cuando la base de datos tiene una propiedad Patrimonio.",
      },
      {
        target: "view-stats",
        area: "databases",
        title: "Mapa y estadísticas",
        body: "En Mapa, «Situar las fotos según» coloca cada foto donde está su monumento, y el modo Patrimonio muestra un punto por elemento. En Estadísticas, cuenta por elemento, por tipo o por grupo, e incluye sus partes si quieres.",
        missing: OPEN_DATABASE,
      },
    ],
  },
  {
    id: "cite-export",
    title: "Citar un registro y exportar los datos",
    summary: "Copia la cita de una imagen para un trabajo académico y exporta tus registros a CSV, JSON o Excel.",
    level: "research",
    minutes: 1,
    keywords: ["citar", "cita", "exportar", "csv", "excel", "json", "descargar", "cite", "citation", "export", "download"],
    steps: [
      openRecord,
      {
        target: "record-citation",
        title: "Copia la cita",
        body: "Copia la referencia bibliográfica del registro, con sus datos, lista para pegar en tu trabajo. Su forma se cambia en la plantilla de «Láminas y citas».",
        missing: OPEN_RECORD,
      },
      {
        target: "db-export",
        area: "databases",
        title: "Exporta los registros",
        body: "Descarga todos los registros de la base de datos, o solo los que tengas marcados, en CSV, JSON o Excel.",
        missing: OPEN_DATABASE,
      },
    ],
  },
  {
    id: "plates",
    title: "Preparar láminas en PDF",
    summary: "Crea un PDF con una imagen por página, numerada y con su pie, y la lista de figuras al final: listo para un artículo, un trabajo académico o un libro.",
    level: "research",
    minutes: 2,
    keywords: ["láminas", "figuras", "pdf", "pie de foto", "publicar", "artículo", "trabajo académico", "plates", "figures", "caption", "publish", "paper"],
    steps: [
      {
        ...selectRows,
        body: "Marca los registros con imagen que quieres incluir.",
        until: "selection-plates",
      },
      {
        target: "selection-plates",
        title: "Pulsa Láminas",
        body: "Escribe la plantilla del pie con los nombres de las propiedades entre llaves, por ejemplo «{Título}, {Fotógrafo}, {Fecha}»; si una está vacía, desaparece con su puntuación. Elige el rótulo («Fig.») y el primer número, mira la vista previa y crea el PDF. La misma plantilla da forma a «Copiar cita» en la ficha.",
        missing: "Marca al menos un registro en la tabla para que aparezca la barra con el botón Láminas.",
      },
    ],
  },
];

/** Lower case without accents, so «busqueda» finds «Búsqueda». */
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * The tutorials that contain every word of the query, in their title,
 * summary, keywords or steps, in Spanish or in the interface language
 * (`translate` gives the shown text). The best matches come first.
 */
export function searchTutorials(
  query: string,
  translate: (text: string) => string = (text) => text,
  tutorials: Tutorial[] = TUTORIALS,
): Tutorial[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return tutorials;
  const both = (text: string) => fold(text + " " + translate(text));
  const scored = tutorials.flatMap((tutorial) => {
    const title = both(tutorial.title),
      keywords = fold(tutorial.keywords.join(" ")),
      summary = both(tutorial.summary),
      body = [
        title,
        summary,
        keywords,
        both(TUTORIAL_LEVELS.find((l) => l.id === tutorial.level)!.label),
        ...tutorial.steps.map((step) => both(step.title) + " " + both(step.body)),
      ].join(" ");
    if (!words.every((word) => body.includes(word))) return [];
    // A word in the title counts most, then in the keywords, then in the summary.
    const score = words.reduce(
      (sum, word) => sum + (title.includes(word) ? 4 : 0) + (keywords.includes(word) ? 2 : 0) + (summary.includes(word) ? 1 : 0),
      0,
    );
    return [{ tutorial, score }];
  });
  return scored.sort((a, b) => b.score - a.score).map((s) => s.tutorial);
}

/** The first tutorial of the path not finished yet: where to go on. */
export const nextTutorial = (done: readonly string[], tutorials: Tutorial[] = TUTORIALS) =>
  tutorials.find((tutorial) => !done.includes(tutorial.id)) ?? null;

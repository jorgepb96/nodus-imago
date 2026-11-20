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
    version: "0.4.3",
    date: "2026-11-21",
    highlights: [
      {
        scope: "catalogue",
        category: "fix",
        es: "El número de registros ya no se sustituye por el icono de carga cada dos segundos mientras hay una tarea en marcha: solo se muestra al cambiar la búsqueda, los filtros o la página.",
        en: "The record count is no longer replaced by the loading icon every two seconds while a task is running: it only shows when the search, filters or page change.",
      },
      {
        scope: "analysis",
        category: "fix",
        es: "Las estadísticas por tipología de patrimonio nombran los grupos y tipos en el idioma de la interfaz.",
        en: "Statistics by heritage typology name groups and types in the interface language.",
      },
      {
        scope: "general",
        category: "fix",
        es: "En inglés, los filtros de las fichas de patrimonio y el nombre del proveedor personalizado ya aparecen traducidos.",
        en: "In English, the heritage record filters and the custom provider name are now translated.",
      },
    ],
  },
  {
    version: "0.4.2",
    date: "2026-11-20",
    highlights: [
      {
        scope: "places",
        category: "fix",
        es: "En las obras de arte con la forma «Obra - Autor», el autor ya no se toma por la localidad: la obra no se sitúa en un pueblo que se llame como el pintor.",
        en: "In works of art named «Work - Artist», the artist is no longer taken for the town: the work is not placed in a village named like the painter.",
      },
      {
        scope: "authorities",
        category: "fix",
        es: "El autor decide si una obra es pintura o escultura: una «Virgen» o una «Piedad» de un pintor cuenta como pintura.",
        en: "The artist decides whether a work is a painting or a sculpture: a «Virgin» or a «Pietà» by a painter counts as a painting.",
      },
    ],
  },
  {
    version: "0.4.1",
    date: "2026-11-20",
    highlights: [
      {
        scope: "places",
        category: "fix",
        es: "Al situar el patrimonio en su localidad, un pueblo que no está en el nomenclátor ya no se confunde con un lugar cuyo nombre solo se le parece ni con un homónimo de otro continente: solo vale un lugar que se llame exactamente así (o con ese nombre oficial, como en los nombres dobles), y lo demás se busca en OpenStreetMap entre núcleos de población, no parajes ni comercios.",
        en: "When heritage is placed at its town, a town missing from the gazetteer is no longer mistaken for a place whose name merely resembles it or for a namesake on another continent: only a place called exactly that (or with that official name, as in double names) counts, and the rest is looked up in OpenStreetMap among settlements, not named spots or shops.",
      },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-11-20",
    highlights: [
      {
        scope: "places",
        category: "new",
        es: "Nuevo tipo de propiedad Patrimonio: cada valor es un monumento, edificio, calle u obra de arte con su ficha (enlace a Wikidata, coordenadas, tipología con icono y de qué conjunto forma parte). Una foto puede tener varios, cada uno como etiqueta propia. Se crea desde el botón + o convirtiendo una selección múltiple, sin perder ningún valor.",
        en: "New Heritage property type: each value is a monument, building, street or artwork with its own record (Wikidata link, coordinates, typology with an icon, and the ensemble it belongs to). A photo can have several, each as its own tag. Create it from the + button or by converting a multi-select, without losing any value.",
      },
      {
        scope: "authorities",
        category: "new",
        es: "Identificar y situar en tres pasos que siguen en segundo plano en la lista de tareas: Wikidata identifica cada elemento, OpenStreetMap sitúa lo que Wikidata no tiene y el resto se sitúa en su localidad como posición aproximada. Si se corta la conexión o cierras Imago, la tarea se pausa y continúa donde se quedó; las propuestas se guardan hasta que las revisas, y cada aplicación se puede revertir.",
        en: "Identify and place in three steps that run in the background in the task list: Wikidata identifies each element, OpenStreetMap places what Wikidata lacks, and the rest is placed at its town as an approximate position. If the connection drops or you close Imago, the task pauses and continues where it stopped; proposals are kept until you review them, and each application can be reverted.",
      },
      {
        scope: "authorities",
        category: "new",
        es: "La tipología se deduce también del nombre («Castillo de…», «Iglesia de…», una pintura de un autor conocido), así que todo elemento identificable cuenta en su tipo aunque no esté en Wikidata. El esquema de tipologías se puede editar por propiedad.",
        en: "The typology is also read from the name (“Castle of…”, “Church of…”, a painting by a known artist), so every identifiable element counts in its type even when it is not in Wikidata. The typology scheme can be edited per property.",
      },
      {
        scope: "visual",
        category: "new",
        es: "En el visor, marca cada elemento con un punto, con un rectángulo o sin marcar. «Sugerir con IA» reconoce los elementos de la imagen entera o de las zonas que dibujes, y «Buscar este elemento en otras fotos» propone otras fotos donde aparece.",
        en: "In the viewer, mark each element with a point, a rectangle or leave it unmarked. “Suggest with AI” recognises the elements in the whole image or in the zones you draw, and “Find this element in other photos” suggests other photos where it appears.",
      },
      {
        scope: "places",
        category: "new",
        es: "El mapa puede situar las fotos según su ubicación o según su patrimonio, y tiene un modo Patrimonio con un punto por elemento. Los filtros nuevos buscan por tipo, grupo, «forma parte de», marcado o sin enlazar.",
        en: "The map can place photos by their location or by their heritage, and has a Heritage mode with one point per element. New filters search by type, group, “part of”, marked or unlinked.",
      },
      {
        scope: "analysis",
        category: "new",
        es: "Estadísticas por elemento, por tipo o por grupo de patrimonio, incluyendo o no sus partes. Todas las estadísticas se calculan con los filtros activos de la base de datos y muestran cuáles son.",
        en: "Statistics by heritage element, type or group, with or without their parts. All statistics are computed with the database's active filters and show which ones they are.",
      },
      {
        scope: "analysis",
        category: "fix",
        es: "La cronología lee cualquier forma de fecha y dibuja los periodos tal como están registrados (por ejemplo, 1939–1949), en lugar de repartirlos año a año o redondearlos a décadas.",
        en: "The timeline reads any date form and draws periods as they are recorded (for example, 1939–1949) instead of spreading them year by year or rounding them to decades.",
      },
      {
        scope: "catalogue",
        category: "new",
        es: "Plantillas listas para usar de proceso fotográfico y tipo de cámara en el menú +, con sus opciones, colores por periodo, definiciones para la IA y un enlace a Wikipedia por opción. El menú + tiene buscador.",
        en: "Ready-made photographic process and camera type templates in the + menu, with their options, period colours, definitions for AI and a Wikipedia link per option. The + menu has a search box.",
      },
      {
        scope: "general",
        category: "enhancement",
        es: "Nuevo tutorial guiado de Patrimonio. El botón Interfaz de la barra superior desaparece.",
        en: "New guided tutorial for Heritage. The Interface button in the top bar is gone.",
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-11-18",
    highlights: [
      {
        scope: "ai",
        category: "new",
        es: "Las propiedades de IA escriben el resultado directamente en la celda, sin pasar por Revisar propuestas. El texto aparece en directo mientras se genera, con un indicador a la derecha de la celda, y Deshacer lo revierte.",
        en: "AI properties write their result straight into the cell instead of Review proposals. The text appears live while it is generated, with a spinner at the right of the cell, and Undo reverts it.",
      },
      {
        scope: "ai",
        category: "new",
        es: "Botón de IA en cada celda para generarla o regenerarla, y en la cabecera para rellenar las celdas vacías o regenerar toda la columna (con confirmación).",
        en: "An AI button in each cell generates or regenerates it, and one in the header fills the empty cells or regenerates the whole column (after confirming).",
      },
      {
        scope: "ai",
        category: "new",
        es: "Tareas predefinidas en español e inglés: descripción breve o detallada en prosa, etiquetas, transcripción del texto y título sugerido. Puedes leer su prompt, añadir indicaciones y guardar tus propios predefinidos para editarlos o borrarlos después.",
        en: "Ready-made tasks in Spanish and English: short or detailed prose description, tags, text transcription and suggested title. You can read their prompt, add instructions and save your own presets to edit or delete later.",
      },
      {
        scope: "ai",
        category: "new",
        es: "Las etiquetas de IA son una selección múltiple real, con chips que se filtran: la IA elige entre tus opciones o añade nuevas, con un máximo de etiquetas a tu elección. Cualquier selección puede rellenarse con IA, con criterios generales de clasificación y una definición por opción en Opciones avanzadas.",
        en: "AI tags are a real multi-select with chips you can filter: the AI picks from your options or adds new ones, up to the number of tags you choose. Any selection can be filled by AI, with general classification criteria and a definition per option under Advanced options.",
      },
      {
        scope: "ai",
        category: "enhancement",
        es: "Con un proveedor por API, las celdas se envían en paralelo (10 a la vez por defecto, configurable hasta 50 en Ajustes); los modelos locales siguen trabajando de una en una.",
        en: "With an API provider, cells are sent in parallel (10 at a time by default, up to 50 in Settings); local models keep working one at a time.",
      },
      {
        scope: "ai",
        category: "fix",
        es: "El modelo local recibía mal las letras acentuadas al abrir Imago desde el Finder, lo que producía erratas y etiquetas que no encajaban con las opciones. Tampoco devolvía nada en la segunda celda de una misma tanda ni dejaba ya su razonamiento en el resultado.",
        en: "The local model received accented letters garbled when Imago was opened from the Finder, which caused misspellings and tags that did not match the options. It also returned nothing for the second cell of a run, and its reasoning no longer ends up in the result.",
      },
      {
        scope: "catalogue",
        category: "new",
        es: "Suelta imágenes sobre una base de datos y se crea un registro por cada una. Un botón + en la cabecera de la tabla añade propiedades eligiendo el tipo, y cada tipo tiene su icono.",
        en: "Drop images on a database to create one record per image. A + button in the table header adds properties by type, and each type has its own icon.",
      },
      {
        scope: "catalogue",
        category: "enhancement",
        es: "Añadir imagen, abrir registro y añadir propiedad quedan fijos a la derecha al desplazar la tabla, y la lista de opciones de una celda ya no se corta dentro de ella.",
        en: "Add image, open record and add property stay at the right while the table scrolls sideways, and a cell's option list is no longer cut off inside the table.",
      },
      {
        scope: "general",
        category: "enhancement",
        es: "Los tutoriales ya no tapan el menú que explican y se pausan mientras usas una ventana. Tareas permite limpiar las terminadas, y las imágenes nuevas se indexan a los pocos segundos de importarlas.",
        en: "Tutorials no longer cover the menu they explain and pause while you use a window. Tasks can clear the finished ones, and new images are indexed a few seconds after they are imported.",
      },
    ],
  },
  {
    version: "0.2.1",
    date: "2026-11-17",
    highlights: [
      {
        scope: "catalogue",
        category: "fix",
        es: "«Deshacer» en Revisar propuestas solo deshace propuestas aceptadas. Antes deshacía el último cambio de cualquier tipo, y un clic podía vaciar una columna entera situada en el mapa o una unificación de valores.",
        en: "“Undo” in Review proposals only undoes accepted proposals. It used to undo the last change of any kind, so one click could empty a whole column placed on the map or a value merge.",
      },
      {
        scope: "catalogue",
        category: "new",
        es: "Nuevo botón «Rehacer» junto a cada «Deshacer», que vuelve a aplicar lo último que deshiciste mientras no hayas cambiado nada después.",
        en: "A new “Redo” button next to each “Undo” applies again what you last undid, as long as nothing has changed since.",
      },
      {
        scope: "catalogue",
        category: "enhancement",
        es: "«Deshacer» y «Rehacer» dicen qué van a cambiar (cuántos valores, en qué propiedades, de qué operación y cuándo) y piden confirmación antes de tocar más de un valor.",
        en: "“Undo” and “Redo” say what they will change (how many values, in which properties, from which operation and when) and ask before touching more than one value.",
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-11-17",
    highlights: [
      {
        scope: "general",
        category: "new",
        es: "Tutoriales guiados: 26 tutoriales cortos que te enseñan Nodus Imago sobre la pantalla real, de una tarea cada uno (adjuntar una imagen, describirla o etiquetarla con IA, situarla en el mapa, comentar una zona, comparar, enlazar con Wikidata…). Tú haces cada paso y el tutorial ilumina dónde, sigue solo cuando lo haces y te acompaña dentro de las ventanas que abres.",
        en: "Guided tutorials: 26 short tutorials that teach Nodus Imago on the real screen, one task each (attaching an image, describing or tagging it with AI, putting it on the map, commenting on an area, comparing, linking to Wikidata…). You do each step while the tutorial lights up where, moves on by itself once you do it and follows you into the windows you open.",
      },
      {
        scope: "general",
        category: "new",
        es: "Los tutoriales forman un itinerario en cinco niveles, de lo esencial a investigar y publicar, con tu progreso, el siguiente recomendado y un buscador. Están en la nueva sección Tutoriales y en el birrete de la barra superior, y al terminar cada uno Imago te felicita y te propone el siguiente.",
        en: "The tutorials form a five-level path, from the essentials to research and publishing, with your progress, the recommended next one and a search box. They live in the new Tutorials section and behind the mortarboard in the top bar, and when you finish one Imago congratulates you and suggests the next.",
      },
      {
        scope: "search",
        category: "enhancement",
        es: "La búsqueda empieza en Híbrida, que combina las palabras exactas con el significado, y los modos aparecen en el orden Híbrida, Semántica y Literal. Mientras no hay un modelo de búsqueda preparado, sigue en Literal.",
        en: "Search starts in Hybrid, which combines exact words with meaning, and the modes are listed as Hybrid, Semantic and Literal. While no search model is ready, it stays in Literal.",
      },
      {
        scope: "catalogue",
        category: "enhancement",
        es: "Las flechas para pasar de página y «Revisar propuestas» también están encima de la tabla, sin tener que bajar hasta el final.",
        en: "The page arrows and “Review proposals” are also above the table, so you no longer have to scroll to the bottom.",
      },
      {
        scope: "catalogue",
        category: "enhancement",
        es: "Mayúsculas + clic marca o desmarca de una vez todos los registros entre la última casilla y la que pulsas, en la tabla y en la galería. Al volver a una base de datos sus registros aparecen al instante mientras se actualizan.",
        en: "Shift+click ticks or unticks every record between the last box and the one you click, in the table and the gallery. Coming back to a database shows its records at once while they are refreshed.",
      },
      {
        scope: "compare",
        category: "fix",
        es: "«Comparar» con varios registros marcados vuelve a abrir sus imágenes en una mesa nueva, en lugar de la última mesa guardada.",
        en: "“Compare” with several ticked records opens their images on a new table again, instead of the last saved table.",
      },
      {
        scope: "catalogue",
        category: "fix",
        es: "Las casillas de los registros quedan alineadas con la de la cabecera de la tabla.",
        en: "The record checkboxes line up with the one in the table header.",
      },
      {
        scope: "general",
        category: "fix",
        es: "Los botones del visor de imagen vuelven a responder: «Aplicar recorte», «Toda la imagen», «Cancelar» y «Anotar» ya no se quedan sin hacer nada cuando están en la parte superior de la ventana.",
        en: "The image viewer's buttons respond again: “Apply crop”, “Whole image”, “Cancel” and “Annotate” no longer do nothing when they sit at the top of the window.",
      },
    ],
  },
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

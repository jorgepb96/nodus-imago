// Slides of the first-run introduction (Welcome.tsx), kept apart from the
// component so tests can check every text without bundling images.
// Writing rule: say what each feature does, where it is and how to use it,
// in plain words; no slogans or figurative phrases.
import type { ReactNode } from "react";
import {
  BarChart3,
  Bot,
  Cloud,
  Columns3,
  Cpu,
  Database,
  FileSpreadsheet,
  Images,
  Lock,
  MessageSquare,
  ScanSearch,
  Search,
  ShieldCheck,
  Sparkles,
  Type,
  Upload,
} from "lucide-react";

export type Slide = {
  eyebrow: string;
  title: string;
  summary: string;
  icon: ReactNode;
  points?: { icon: ReactNode; title: string; body: string }[];
  tip?: string;
};

export const SLIDES: Slide[] = [
  {
    eyebrow: "1 · PRESENTACIÓN",
    title: "Una aplicación para catalogar y buscar imágenes históricas",
    summary:
      "Nodus Imago guarda tus imágenes y sus fichas en bases de datos en este ordenador. Con ellas puedes describir cada imagen, clasificarla y buscarla por palabras o por lo que muestra.",
    icon: <Images size={15} />,
    points: [
      {
        icon: <Database size={18} />,
        title: "Bases de datos",
        body: "Cada base de datos es una tabla. Cada fila es un registro con sus propiedades (título, fecha, lugar, temas…) y una o varias imágenes.",
      },
      {
        icon: <ScanSearch size={18} />,
        title: "Búsqueda",
        body: "Puedes buscar por palabras exactas o escribir una descripción de lo que aparece en la imagen.",
      },
      {
        icon: <Bot size={18} />,
        title: "Descripciones y categorías con IA",
        body: "Un modelo de IA puede proponer una descripción o una categoría para cada registro. Las propuestas no se guardan hasta que las revisas y las apruebas.",
      },
    ],
    tip: "Nodus Imago no modifica tus archivos originales: guarda una referencia a cada uno y crea miniaturas para mostrarlos.",
  },
  {
    eyebrow: "2 · IMPORTAR",
    title: "Cómo importar tu catálogo",
    summary:
      "Puedes empezar con un archivo CSV que tenga una fila por registro y una carpeta con las imágenes.",
    icon: <Upload size={15} />,
    points: [
      {
        icon: <FileSpreadsheet size={18} />,
        title: "1. Importar el CSV",
        body: "Nodus Imago lee las columnas y propone un tipo para cada una: texto, número, fecha, selección o selección múltiple. Puedes cambiar cualquier tipo antes de importar.",
      },
      {
        icon: <Images size={18} />,
        title: "2. Asociar las imágenes",
        body: "Cada imagen se asocia al registro cuyo identificador coincide con el nombre del archivo o de su carpeta. Las que no tienen una coincidencia clara se muestran aparte para que las revises.",
      },
      {
        icon: <Columns3 size={18} />,
        title: "3. Ajustar las columnas",
        body: "En la tabla puedes arrastrar una columna para moverla, ocultarla o fijarla. Con clic derecho sobre su nombre se abren todas sus opciones.",
      },
    ],
  },
  {
    eyebrow: "3 · BUSCAR",
    title: "Tres formas de buscar",
    summary:
      "La búsqueda está en el menú de la izquierda (para buscar en todas las bases de datos) y en la parte superior de cada base de datos (para buscar solo en ella).",
    icon: <Search size={15} />,
    points: [
      {
        icon: <Type size={18} />,
        title: "Literal",
        body: "Encuentra los registros que contienen todas las palabras escritas, sin tener en cuenta tildes ni mayúsculas.",
      },
      {
        icon: <ScanSearch size={18} />,
        title: "Semántica",
        body: "Compara una descripción, por ejemplo «procesión con faroles de noche», con el contenido de las imágenes y con el texto de las fichas, y ordena los resultados por parecido. También puedes adjuntar una imagen para encontrar otras parecidas.",
      },
      {
        icon: <Sparkles size={18} />,
        title: "Híbrida",
        body: "Muestra los registros que contienen las palabras junto con los más parecidos por significado.",
      },
    ],
    tip: "La búsqueda semántica necesita un modelo de embeddings. Lo eliges en el paso 6.",
  },
  {
    eyebrow: "4 · ANALIZAR",
    title: "Herramientas de análisis",
    summary: "Cada base de datos tiene estas herramientas en su barra superior.",
    icon: <BarChart3 size={15} />,
    points: [
      {
        icon: <Sparkles size={18} />,
        title: "Automatizaciones",
        body: "Pide a un modelo de IA que rellene una propiedad (por ejemplo, una descripción o un tema) en muchos registros a la vez. Cada valor queda como propuesta hasta que lo apruebas.",
      },
      {
        icon: <Bot size={18} />,
        title: "Concordancia",
        body: "Compara las categorías asignadas por varios modelos de IA con las que has asignado tú: porcentaje de acuerdo, índices como kappa y lista de registros en los que no coinciden.",
      },
      {
        icon: <BarChart3 size={18} />,
        title: "Estadísticas",
        body: "Calcula frecuencias, tablas cruzadas con la prueba de chi cuadrado, etiquetas que aparecen juntas y número de registros por año. Puedes guardar cada cálculo para consultarlo después.",
      },
      {
        icon: <MessageSquare size={18} />,
        title: "Chat",
        body: "Haz preguntas sobre una o varias bases de datos. Las cifras exactas se calculan sobre todos los registros en un entorno aislado de este ordenador.",
      },
    ],
  },
  {
    eyebrow: "5 · TUS DATOS",
    title: "Dónde se guardan tus datos",
    summary:
      "Todo se guarda en este ordenador. Nodus Imago no envía nada a servicios externos salvo que tú actives uno.",
    icon: <Lock size={15} />,
    points: [
      {
        icon: <Cpu size={18} />,
        title: "Modelos locales",
        body: "Los modelos que se ejecutan en este ordenador se descargan una vez y después funcionan sin conexión a internet.",
      },
      {
        icon: <Cloud size={18} />,
        title: "Proveedores externos",
        body: "Si activas un proveedor externo (por ejemplo, Gemini u OpenAI), las imágenes o los textos que procese se envían a ese proveedor.",
      },
      {
        icon: <ShieldCheck size={18} />,
        title: "Copias de seguridad",
        body: "En Ajustes › Almacenamiento y copias puedes programar copias cifradas. Si las tienes configuradas, antes de instalar una actualización se crea una copia y se comprueba.",
      },
    ],
  },
];

// Slides of the first-run introduction (Welcome.tsx), kept apart from the
// component so tests can check every text without bundling images.
import type { ReactNode } from "react";
import {
  Bot,
  Check,
  Compass,
  Cpu,
  Database,
  Images,
  Lock,
  ScanSearch,
  Search,
  ShieldCheck,
  Sparkles,
  Type,
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
    eyebrow: "BIENVENIDA",
    title: "Investigación visual, en tu equipo",
    summary:
      "Nodus Imago reúne tus imágenes históricas y sus fichas en bases de datos locales para describirlas, clasificarlas y encontrarlas por lo que muestran.",
    icon: <Sparkles size={15} />,
    points: [
      {
        icon: <Database size={18} />,
        title: "Bases de datos de imágenes",
        body: "Cada registro con sus propiedades y una o varias imágenes.",
      },
      {
        icon: <ScanSearch size={18} />,
        title: "Búsqueda por significado",
        body: "Describe una escena o parte de una imagen de referencia.",
      },
      {
        icon: <Bot size={18} />,
        title: "IA que propone",
        body: "Descripciones y categorías que tú revisas antes de guardarlas.",
      },
    ],
    tip: "Tus originales nunca se modifican: Imago trabaja con miniaturas y referencias.",
  },
  {
    eyebrow: "TUS FUENTES",
    title: "Importa tu catálogo tal como está",
    summary:
      "Trae una tabla CSV y una carpeta de imágenes. Imago propone el tipo de cada propiedad y te deja corregirlo antes de importar.",
    icon: <Database size={15} />,
    points: [
      {
        icon: <Images size={18} />,
        title: "Imágenes asociadas a sus registros",
        body: "Por nombre de archivo o por carpeta; los casos dudosos quedan para revisar.",
      },
      {
        icon: <Compass size={18} />,
        title: "Cinco vistas de los mismos datos",
        body: "Tabla, galería, mapa, cronología y estadísticas.",
      },
      {
        icon: <Type size={18} />,
        title: "Columnas como en Notion",
        body: "Arrástralas, ocúltalas o fíjalas; con el botón derecho tienes todas las opciones.",
      },
    ],
  },
  {
    eyebrow: "BÚSQUEDA",
    title: "Encuentra imágenes por lo que muestran",
    summary:
      "Combina palabras exactas con búsqueda por significado: describe una escena, adjunta una imagen de referencia o busca imágenes parecidas a otra.",
    icon: <Search size={15} />,
    points: [
      {
        icon: <Type size={18} />,
        title: "Literal",
        body: "Todas las palabras, sin importar tildes ni mayúsculas.",
      },
      {
        icon: <ScanSearch size={18} />,
        title: "Semántica",
        body: "Compara tu descripción con las imágenes y con el texto de las fichas.",
      },
      {
        icon: <Sparkles size={18} />,
        title: "Híbrida",
        body: "Las coincidencias exactas más las más parecidas, también desde el buscador de cada base.",
      },
    ],
    tip: "La similitud no es certeza: revisa siempre los resultados.",
  },
  {
    eyebrow: "IA BAJO TU CONTROL",
    title: "La IA propone; tú decides",
    summary:
      "Los modelos generan descripciones y clasificaciones como propuestas. Nada cambia en tus datos hasta que las revisas y aceptas.",
    icon: <Bot size={15} />,
    points: [
      {
        icon: <Sparkles size={18} />,
        title: "Automatizaciones",
        body: "Proponen valores en lote para los registros que elijas.",
      },
      {
        icon: <Check size={18} />,
        title: "Concordancia",
        body: "Compara las etiquetas de varios modelos con las tuyas, con índices y casos de desacuerdo.",
      },
      {
        icon: <Compass size={18} />,
        title: "Estadísticas",
        body: "Frecuencias, tablas cruzadas con χ², coocurrencias y evolución, guardadas con cada base.",
      },
    ],
  },
  {
    eyebrow: "PRIVACIDAD",
    title: "Local por defecto",
    summary:
      "Tu colección vive en tu equipo. Las APIs externas están desactivadas hasta que tú las actives.",
    icon: <Lock size={15} />,
    points: [
      {
        icon: <Cpu size={18} />,
        title: "Modelos sin conexión",
        body: "Una vez descargados, los modelos locales funcionan sin internet.",
      },
      {
        icon: <ShieldCheck size={18} />,
        title: "Copias cifradas",
        body: "Programa copias de seguridad cifradas; se verifican antes de cada actualización.",
      },
    ],
  },
];


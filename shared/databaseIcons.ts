// The icons a database can show in the sidebar and in its heading: a
// curated set of drawn icons (not emoji), each with Spanish words to find it,
// and the colours it can take. The value is stored in db_databases.icon as
// «Name» or «Name:colour» (for example «BookOpen:blue»).
import type { DatabaseKind } from "./databases";
import { VIEW_COLOR_HUES } from "./savedViews";

export const DATABASE_ICON_GROUPS: { label: string; icons: [name: string, keywords: string][] }[] = [
  {
    label: "Colecciones",
    icons: [
      ["Database", "base datos colección"],
      ["Archive", "archivo caja"],
      ["Library", "biblioteca libros"],
      ["LibraryBig", "biblioteca estantería"],
      ["BookOpen", "libro abierto lectura fuente"],
      ["Book", "libro"],
      ["BookMarked", "libro marcador"],
      ["BookCopy", "libros copias"],
      ["BookText", "libro texto"],
      ["BookImage", "libro imágenes álbum"],
      ["Notebook", "cuaderno"],
      ["NotebookPen", "cuaderno diario notas"],
      ["Newspaper", "periódico prensa revista"],
      ["ScrollText", "pergamino documento manuscrito"],
      ["Scroll", "pergamino"],
      ["FileText", "documento texto"],
      ["Files", "documentos"],
      ["FileImage", "archivo imagen"],
      ["Folder", "carpeta"],
      ["FolderOpen", "carpeta abierta"],
      ["FolderArchive", "carpeta archivo"],
      ["Box", "caja"],
      ["Package", "paquete"],
      ["Inbox", "bandeja entrada"],
      ["Layers", "capas"],
      ["LayoutGrid", "cuadrícula"],
      ["Table", "tabla"],
      ["Bookmark", "marcador"],
      ["Tag", "etiqueta"],
      ["Tags", "etiquetas"],
      ["Stamp", "sello"],
      ["Mail", "correo carta postal"],
      ["Mails", "cartas correspondencia"],
      ["Paperclip", "clip"],
    ],
  },
  {
    label: "Imagen",
    icons: [
      ["Image", "imagen foto"],
      ["Images", "imágenes fotos"],
      ["Camera", "cámara fotografía"],
      ["Aperture", "diafragma objetivo"],
      ["Film", "película negativo"],
      ["Clapperboard", "cine claqueta"],
      ["Video", "vídeo"],
      ["ScanLine", "escáner"],
      ["Frame", "marco"],
      ["Focus", "enfoque"],
      ["Palette", "paleta pintura color"],
      ["Brush", "pincel"],
      ["Paintbrush", "pincel pintura"],
      ["PenTool", "pluma diseño"],
      ["Pencil", "lápiz dibujo"],
      ["Eye", "ojo mirada"],
      ["Sparkles", "destellos"],
      ["Contrast", "contraste"],
      ["SunMedium", "luz"],
    ],
  },
  {
    label: "Lugares y viajes",
    icons: [
      ["Map", "mapa"],
      ["MapPin", "lugar ubicación"],
      ["MapPinned", "mapa lugar"],
      ["Globe", "mundo globo"],
      ["Earth", "tierra planeta"],
      ["Compass", "brújula"],
      ["Navigation", "navegación"],
      ["Mountain", "montaña"],
      ["MountainSnow", "montaña nieve"],
      ["Trees", "árboles bosque"],
      ["TreePine", "pino"],
      ["Waves", "olas mar"],
      ["Sailboat", "velero barco"],
      ["Ship", "barco"],
      ["Anchor", "ancla puerto"],
      ["Plane", "avión vuelo"],
      ["Train", "tren"],
      ["TrainFront", "tren"],
      ["Car", "coche"],
      ["Bus", "autobús"],
      ["Bike", "bicicleta"],
      ["Tent", "tienda campamento"],
      ["Castle", "castillo"],
      ["Church", "iglesia"],
      ["Landmark", "monumento"],
      ["Building", "edificio"],
      ["Building2", "edificios ciudad"],
      ["House", "casa"],
      ["Hotel", "hotel"],
      ["Factory", "fábrica industria"],
      ["Warehouse", "almacén"],
      ["Store", "tienda comercio"],
      ["Fence", "valla"],
      ["Milestone", "hito"],
      ["Signpost", "señal camino"],
      ["Route", "ruta"],
      ["Footprints", "huellas paseo"],
      ["Luggage", "equipaje viaje"],
      ["Ticket", "billete entrada"],
      ["Flag", "bandera"],
      ["TowerControl", "torre"],
    ],
  },
  {
    label: "Personas y cultura",
    icons: [
      ["User", "persona"],
      ["Users", "personas grupo"],
      ["UserRound", "persona"],
      ["Baby", "bebé niño"],
      ["PersonStanding", "persona de pie"],
      ["Heart", "corazón"],
      ["HandHeart", "mano corazón"],
      ["Smile", "sonrisa"],
      ["Contact", "contacto"],
      ["IdCard", "identidad carné"],
      ["Crown", "corona rey"],
      ["Drama", "teatro máscaras"],
      ["Music", "música"],
      ["Guitar", "guitarra"],
      ["Mic", "micrófono"],
      ["Radio", "radio"],
      ["Tv", "televisión"],
      ["Trophy", "trofeo"],
      ["Medal", "medalla"],
    ],
  },
  {
    label: "Tiempo",
    icons: [
      ["Calendar", "calendario"],
      ["CalendarDays", "calendario días"],
      ["Clock", "reloj hora"],
      ["Hourglass", "reloj arena"],
      ["History", "historia"],
      ["Timer", "temporizador"],
      ["Sunrise", "amanecer"],
      ["Sunset", "atardecer"],
      ["Watch", "reloj pulsera"],
    ],
  },
  {
    label: "Saber y sociedad",
    icons: [
      ["GraduationCap", "universidad graduación"],
      ["School", "escuela"],
      ["Microscope", "microscopio"],
      ["FlaskConical", "laboratorio"],
      ["Atom", "átomo"],
      ["Brain", "cerebro"],
      ["Lightbulb", "idea bombilla"],
      ["Quote", "cita"],
      ["Languages", "idiomas"],
      ["Telescope", "telescopio"],
      ["Binoculars", "prismáticos"],
      ["Scale", "balanza justicia"],
      ["Gavel", "mazo ley"],
      ["Shield", "escudo"],
      ["Swords", "espadas guerra"],
      ["Key", "llave"],
      ["Lock", "candado"],
      ["Gem", "joya"],
      ["Coins", "monedas"],
      ["Banknote", "billete dinero"],
      ["Briefcase", "maletín"],
      ["Glasses", "gafas"],
    ],
  },
  {
    label: "Naturaleza",
    icons: [
      ["Leaf", "hoja"],
      ["Flower", "flor"],
      ["Flower2", "flor"],
      ["Sprout", "brote planta"],
      ["Bird", "pájaro ave"],
      ["Fish", "pez"],
      ["Bug", "insecto"],
      ["Cat", "gato"],
      ["Dog", "perro"],
      ["Rabbit", "conejo"],
      ["Squirrel", "ardilla"],
      ["Shell", "concha"],
      ["Feather", "pluma"],
      ["Cloud", "nube"],
      ["CloudRain", "lluvia"],
      ["Snowflake", "nieve"],
      ["Flame", "fuego"],
      ["Droplet", "gota agua"],
      ["Zap", "rayo"],
      ["Star", "estrella"],
      ["Rainbow", "arcoíris"],
      ["Sun", "sol"],
      ["Moon", "luna"],
      ["Wheat", "trigo campo"],
      ["Grape", "uva vino"],
      ["Apple", "manzana"],
      ["Coffee", "café"],
      ["Wine", "vino"],
      ["Utensils", "cocina comida"],
      ["Cake", "pastel"],
    ],
  },
  {
    label: "Otros",
    icons: [
      ["Puzzle", "puzle"],
      ["Shapes", "formas"],
      ["Circle", "círculo"],
      ["Square", "cuadrado"],
      ["Triangle", "triángulo"],
      ["Hexagon", "hexágono"],
      ["Diamond", "rombo"],
      ["Target", "diana"],
      ["Rocket", "cohete"],
      ["Wrench", "llave inglesa"],
      ["Hammer", "martillo"],
      ["Shirt", "ropa camisa"],
      ["Gift", "regalo"],
      ["Umbrella", "paraguas"],
      ["Lamp", "lámpara"],
      ["Armchair", "sillón"],
      ["Bed", "cama"],
      ["DoorOpen", "puerta"],
      ["Hash", "almohadilla"],
      ["Bell", "campana"],
      ["Anvil", "yunque"],
    ],
  },
];
export const DATABASE_ICON_NAMES: string[] = DATABASE_ICON_GROUPS.flatMap((g) => g.icons.map(([name]) => name));
const known = new Set(DATABASE_ICON_NAMES);

/** «accent» follows the interface colour; the others are the view colours. */
export const DATABASE_ICON_COLORS = ["accent", ...VIEW_COLOR_HUES] as const;
export type DatabaseIconColor = (typeof DATABASE_ICON_COLORS)[number];

/** The icon a database shows while none is chosen, by its kind. */
export const DEFAULT_DATABASE_ICON: Record<DatabaseKind | "none", string> = {
  images: "Images",
  sources: "BookOpen",
  works: "Camera",
  people: "Users",
  events: "CalendarDays",
  custom: "Database",
  none: "Database",
};

export type DatabaseIconChoice = { name: string; color: DatabaseIconColor; chosen: boolean };

/** The stored value read back; anything unknown falls back to the kind's icon. */
export function parseDatabaseIcon(value: string | null | undefined, kind?: DatabaseKind | null): DatabaseIconChoice {
  const [name, color] = (value ?? "").split(":");
  const valid = known.has(name);
  return {
    name: valid ? name : DEFAULT_DATABASE_ICON[kind ?? "none"],
    color: valid && (DATABASE_ICON_COLORS as readonly string[]).includes(color) ? (color as DatabaseIconColor) : "accent",
    chosen: valid,
  };
}

export function formatDatabaseIcon(name: string, color: DatabaseIconColor): string {
  return color === "accent" ? name : `${name}:${color}`;
}

/** Whether a value can be stored: a known icon, with a known colour or none. */
export function isDatabaseIconValue(value: string): boolean {
  const [name, color, ...rest] = value.split(":");
  return !rest.length && known.has(name) && (color === undefined || (DATABASE_ICON_COLORS as readonly string[]).includes(color));
}

/** The icon chosen for a select option, if any (only known icons). */
export function optionIconValue(
  config: { optionIcons?: Record<string, string> } | null | undefined,
  optionId: string,
): string | null {
  const value = config?.optionIcons?.[optionId];
  return value && isDatabaseIconValue(value) ? value : null;
}

/** Icons whose name or words contain every word searched (accents ignored). */
export function searchDatabaseIcons(query: string): string[] {
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return DATABASE_ICON_NAMES;
  return DATABASE_ICON_GROUPS.flatMap((g) => g.icons)
    .filter(([name, keywords]) => {
      const text = fold(`${name} ${keywords}`);
      return words.every((w) => text.includes(w));
    })
    .map(([name]) => name);
}

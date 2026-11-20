// Heritage («Patrimonio») properties: a multi-select whose options are
// identified heritage elements (buildings, monuments, streets, works of art)
// with a record of their own: a Wikidata link (kept in option_authorities),
// coordinates, a typology (group → type) and the element they are part of.
// Everything here is pure so it is tested and shared by both processes.
import type { AuthorityLink } from "./authority";

export type HeritageType = { key: string; label: string; labelEn: string; icon?: string };
export type HeritageGroup = { key: string; label: string; labelEn: string; icon: string; types: HeritageType[] };
export type HeritageScheme = { groups: HeritageGroup[] };

/** The record of one element, keyed by the option it belongs to. */
export type HeritageElement = {
  optionId: string;
  parentId: string | null;
  group: string | null;
  type: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Where the coordinates come from; «town»: the centre of its town, approximate. */
  coordSource: "wikidata" | "osm" | "town" | "manual" | null;
  /** OpenStreetMap object the coordinates come from («way/123»), when they do. */
  osm?: string | null;
};

export const emptyElement = (optionId: string): HeritageElement => ({
  optionId,
  parentId: null,
  group: null,
  type: null,
  latitude: null,
  longitude: null,
  coordSource: null,
});

/** A heritage property is a multi-select marked as such. */
export function isHeritageColumn(column: { type: string; config?: Record<string, unknown> | null }): boolean {
  return column.type === "multi_select" && !!column.config?.heritage;
}

const t = (key: string, label: string, labelEn: string, icon?: string): HeritageType => ({ key, label, labelEn, ...(icon ? { icon } : {}) });

/** The typology Imago ships with; each property keeps its own editable copy. */
export const DEFAULT_HERITAGE_SCHEME: HeritageScheme = {
  groups: [
    {
      key: "religious", label: "Arquitectura religiosa", labelEn: "Religious architecture", icon: "Church",
      types: [
        t("cathedral", "Catedral", "Cathedral"), t("church", "Iglesia", "Church"),
        t("monastery", "Monasterio o convento", "Monastery or convent"), t("mosque", "Mezquita", "Mosque"),
        t("synagogue", "Sinagoga", "Synagogue"), t("hermitage", "Ermita", "Hermitage"),
      ],
    },
    {
      key: "civil", label: "Arquitectura civil", labelEn: "Civil architecture", icon: "Building2",
      types: [
        t("palace", "Palacio", "Palace", "Landmark"), t("town-hall", "Ayuntamiento", "Town hall"),
        t("university", "Universidad o colegio", "University or college", "University"), t("exchange", "Lonja", "Exchange"),
        t("mansion", "Casa señorial", "Mansion", "House"), t("museum", "Museo", "Museum", "Library"),
        t("bullring", "Plaza de toros", "Bullring"), t("modern-building", "Edificio moderno", "Modern building", "Building"),
      ],
    },
    {
      key: "defensive", label: "Arquitectura defensiva", labelEn: "Defensive architecture", icon: "Castle",
      types: [
        t("castle", "Castillo", "Castle"), t("alcazar", "Alcázar", "Alcázar"), t("wall", "Muralla", "City wall", "BrickWall"),
        t("tower", "Torre", "Tower"), t("gate", "Puerta o arco", "Gate or arch", "DoorOpen"),
      ],
    },
    {
      key: "public-works", label: "Obra pública", labelEn: "Public works", icon: "Milestone",
      types: [
        t("bridge", "Puente", "Bridge"), t("aqueduct", "Acueducto", "Aqueduct"), t("lighthouse", "Faro", "Lighthouse"),
        t("port", "Puerto", "Port", "Anchor"), t("station", "Estación", "Station", "TrainFront"),
      ],
    },
    {
      key: "archaeology", label: "Arqueología", labelEn: "Archaeology", icon: "Amphora",
      types: [t("roman-theatre", "Teatro romano", "Roman theatre", "Theater"), t("site", "Yacimiento", "Archaeological site")],
    },
    {
      key: "commemorative", label: "Monumentos conmemorativos", labelEn: "Commemorative monuments", icon: "PersonStanding",
      types: [t("statue", "Estatua", "Statue"), t("monument", "Monumento", "Monument", "Landmark"), t("fountain", "Fuente", "Fountain", "Waves")],
    },
    {
      key: "urban", label: "Espacios urbanos y paisaje", labelEn: "Urban spaces and landscape", icon: "Trees",
      types: [
        t("street", "Calle", "Street", "Signpost"), t("square", "Plaza", "Square"), t("park", "Parque", "Park"),
        t("viewpoint", "Mirador", "Viewpoint", "Mountain"), t("landscape", "Paraje", "Landscape", "MountainSnow"),
      ],
    },
    {
      key: "artworks", label: "Obras de arte", labelEn: "Works of art", icon: "Palette",
      types: [
        t("painting", "Pintura", "Painting", "Frame"), t("sculpture", "Escultura", "Sculpture", "PersonStanding"),
        t("altarpiece", "Retablo", "Altarpiece"), t("tapestry", "Tapiz", "Tapestry"),
      ],
    },
  ],
};

const KEY = /^[a-z0-9-]{1,40}$/;
const validScheme = (value: unknown): value is HeritageScheme => {
  const groups = (value as HeritageScheme | null)?.groups;
  return (
    Array.isArray(groups) &&
    groups.every(
      (g) =>
        KEY.test(g?.key) && typeof g.label === "string" && typeof g.icon === "string" && Array.isArray(g.types) &&
        g.types.every((x) => KEY.test(x?.key) && typeof x.label === "string"),
    )
  );
};

/** The property's typology, or the default one. */
export function heritageScheme(config: Record<string, unknown> | null | undefined): HeritageScheme {
  return validScheme(config?.heritageScheme) ? (config!.heritageScheme as HeritageScheme) : DEFAULT_HERITAGE_SCHEME;
}

/** Label and icon of an element's typology in the interface language. */
export function typology(
  scheme: HeritageScheme,
  group: string | null,
  type: string | null,
  language = "es",
): { group: string | null; type: string | null; icon: string } | null {
  const g = scheme.groups.find((x) => x.key === group);
  if (!g) return null;
  const k = g.types.find((x) => x.key === type) ?? null;
  const en = language === "en";
  return {
    group: en ? g.labelEn || g.label : g.label,
    type: k ? (en ? k.labelEn || k.label : k.label) : null,
    icon: k?.icon ?? g.icon,
  };
}

/** The group a type belongs to in a scheme. */
export const groupOfType = (scheme: HeritageScheme, type: string) =>
  scheme.groups.find((g) => g.types.some((x) => x.key === type))?.key ?? null;

/**
 * What Wikidata says an element is (P31, "instance of") → a type of the
 * default scheme. Only used to suggest; the researcher confirms.
 */
export const WIKIDATA_TYPES: Record<string, string> = {
  // Religious
  Q2977: "cathedral", Q56242215: "cathedral", Q16970: "church", Q1088552: "church", Q120560: "church", Q163687: "church",
  Q1509716: "church", Q108325: "church", Q1129743: "church",
  Q44613: "monastery", Q1128397: "monastery", Q160742: "monastery", Q2750108: "monastery", Q6021560: "monastery", Q1430154: "monastery",
  Q32815: "mosque", Q34627: "synagogue", Q56750657: "hermitage",
  // Civil
  Q16560: "palace", Q53536964: "palace", Q5383482: "palace", Q543654: "town-hall", Q25550691: "town-hall",
  Q3918: "university", Q875538: "university", Q233324: "university",
  Q3257518: "exchange", Q10882966: "exchange", Q1802963: "mansion", Q3950: "mansion", Q33506: "museum", Q207694: "museum",
  Q1193438: "bullring", Q41176: "modern-building", Q11303: "modern-building", Q1021645: "modern-building",
  // Defensive
  Q23413: "castle", Q57831: "castle", Q57821: "castle", Q88291: "castle", Q613611: "alcazar", Q91717: "alcazar",
  Q16748868: "wall", Q57346: "wall", Q12518: "tower", Q20034791: "tower", Q82117: "gate", Q53060: "gate", Q12277: "gate", Q143912: "gate",
  // Public works
  Q12280: "bridge", Q474: "aqueduct", Q39715: "lighthouse", Q44782: "port", Q55488: "station",
  // Archaeology
  Q19757: "roman-theatre", Q839954: "site", Q15661340: "site",
  // Commemorative
  Q179700: "statue", Q4989906: "monument", Q575759: "monument", Q5003624: "monument", Q483453: "fountain",
  // Urban spaces and landscape
  Q79007: "street", Q174782: "square", Q22698: "park", Q1107656: "park", Q6017969: "viewpoint",
  // Works of art
  Q3305213: "painting", Q860861: "sculpture", Q245117: "sculpture", Q46686: "altarpiece", Q15711026: "altarpiece", Q3714446: "altarpiece",
  Q184296: "tapestry",
};

/**
 * What a candidate is, with the classes above the unknown ones added after
 * them (a «bell tower» is a «tower»), so it can still be given a type.
 */
export function withSuperclasses(instances: string[] | undefined, above: Record<string, string[]>): string[] {
  const own = instances ?? [];
  return [...new Set([...own, ...own.filter((q) => !WIKIDATA_TYPES[q]).flatMap((q) => above[q] ?? [])])].slice(0, 20);
}

/**
 * Whether two typology groups can describe the same element: buildings of
 * any kind among themselves, open spaces among themselves, works of art
 * among themselves; a statue is both a monument and a work of art.
 */
export function compatibleGroups(a: string, b: string): boolean {
  const family = (g: string) => (g === "urban" ? "place" : g === "artworks" ? "art" : "built");
  if (a === b || family(a) === family(b)) return true;
  return [a, b].includes("commemorative") && [a, b].includes("artworks");
}

/** Classes too general to say what an element is (any listed building is a «monument»). */
const WEAK_CLASSES = new Set(["Q4989906", "Q41176", "Q1021645"]);

/**
 * The type of the most specific known class, as group and type of the
 * default scheme; a general one («monument», «building») only when there is
 * nothing better. `weak` tells which it was.
 */
export function typeFromInstances(instances: string[] | null | undefined): { group: string; type: string; weak?: boolean } | null {
  let fallback: { group: string; type: string; weak: boolean } | null = null;
  for (const q of instances ?? []) {
    const type = WIKIDATA_TYPES[q];
    const group = type && groupOfType(DEFAULT_HERITAGE_SCHEME, type);
    if (!type || !group) continue;
    if (!WEAK_CLASSES.has(q)) return { group, type };
    fallback ??= { group, type, weak: true };
  }
  return fallback;
}

// ── Typology from the name ───────────────────────────────────────────────────

/**
 * What the name of an element says it is («Castillo de …», «Iglesia de …»,
 * «Plaza Mayor»), read from its first words: the typology an element keeps
 * when Wikidata does not know it. Longer phrases first.
 */
const NAME_TYPES: [string, string, string | null][] = [
  // [first words, group, type]
  ["plaza de toros", "civil", "bullring"],
  ["teatro romano", "archaeology", "roman-theatre"],
  ["casa consistorial", "civil", "town-hall"],
  ["casas cueva", "urban", "landscape"],
  ["casas colgadas", "civil", "mansion"],
  ["gran via", "urban", "street"],
  ["concatedral", "religious", "cathedral"],
  ["catedral", "religious", "cathedral"],
  ["mezquita", "religious", "mosque"],
  ["iglesia", "religious", "church"],
  ["basilica", "religious", "church"],
  ["colegiata", "religious", "church"],
  ["capilla", "religious", "church"],
  ["santuario", "religious", "church"],
  ["parroquia", "religious", "church"],
  ["templo", "religious", "church"],
  ["sacristia", "religious", "church"],
  ["portico", "religious", "church"],
  ["monasterio", "religious", "monastery"],
  ["convento", "religious", "monastery"],
  ["cartuja", "religious", "monastery"],
  ["abadia", "religious", "monastery"],
  ["claustro", "religious", "monastery"],
  ["priorato", "religious", "monastery"],
  ["sinagoga", "religious", "synagogue"],
  ["ermita", "religious", "hermitage"],
  ["palacio", "civil", "palace"],
  ["ayuntamiento", "civil", "town-hall"],
  ["universidad", "civil", "university"],
  ["colegio", "civil", "university"],
  ["seminario", "civil", "university"],
  ["lonja", "civil", "exchange"],
  ["casa", "civil", "mansion"],
  ["casas", "civil", "mansion"],
  ["museo", "civil", "museum"],
  ["edificio", "civil", "modern-building"],
  ["banco", "civil", "modern-building"],
  ["ministerio", "civil", "modern-building"],
  ["hospital", "civil", "modern-building"],
  ["teatro", "civil", null],
  ["castillo", "defensive", "castle"],
  ["fortaleza", "defensive", "castle"],
  ["ciudadela", "defensive", "castle"],
  ["alcazar", "defensive", "alcazar"],
  ["alcazaba", "defensive", "alcazar"],
  ["muralla", "defensive", "wall"],
  ["murallas", "defensive", "wall"],
  ["torre", "defensive", "tower"],
  ["torres", "defensive", "tower"],
  ["torreon", "defensive", "tower"],
  ["puerta", "defensive", "gate"],
  ["portal", "defensive", "gate"],
  ["arco", "defensive", "gate"],
  ["puente", "public-works", "bridge"],
  ["viaducto", "public-works", "bridge"],
  ["acueducto", "public-works", "aqueduct"],
  ["faro", "public-works", "lighthouse"],
  ["puerto", "public-works", "port"],
  ["estacion", "public-works", "station"],
  ["ruinas", "archaeology", "site"],
  ["yacimiento", "archaeology", "site"],
  ["anfiteatro", "archaeology", "site"],
  ["foro", "archaeology", "site"],
  ["necropolis", "archaeology", "site"],
  ["termas", "archaeology", "site"],
  ["estatua", "commemorative", "statue"],
  ["monumento", "commemorative", "monument"],
  ["mausoleo", "commemorative", "monument"],
  ["sepulcro", "commemorative", "monument"],
  ["cruz", "commemorative", "monument"],
  ["fuente", "commemorative", "fountain"],
  ["pilar", "commemorative", "fountain"],
  ["calle", "urban", "street"],
  ["calleja", "urban", "street"],
  ["callejon", "urban", "street"],
  ["avenida", "urban", "street"],
  ["paseo", "urban", "street"],
  ["rambla", "urban", "street"],
  ["plaza", "urban", "square"],
  ["plazuela", "urban", "square"],
  ["parque", "urban", "park"],
  ["jardin", "urban", "park"],
  ["jardines", "urban", "park"],
  ["mirador", "urban", "viewpoint"],
  ["barrio", "urban", null],
  ["cuevas", "urban", "landscape"],
  ["escultura", "artworks", "sculpture"],
  ["retablo", "artworks", "altarpiece"],
  ["tapiz", "artworks", "tapestry"],
  ["cuadro", "artworks", "painting"],
  ["nuestra senora", "artworks", "sculpture"],
  ["n p", "artworks", "sculpture"],
  ["cristo", "artworks", "sculpture"],
  ["virgen", "artworks", "sculpture"],
  ["piedad", "artworks", "sculpture"],
  ["dolorosa", "artworks", "sculpture"],
  ["descendimiento", "artworks", "sculpture"],
  ["esculturas", "artworks", "sculpture"],
  ["relicario", "artworks", null],
  ["oficina de correos", "civil", "modern-building"],
  ["caja de ahorros", "civil", "modern-building"],
  ["real casino", "civil", "modern-building"],
  ["casino", "civil", "modern-building"],
  ["parador", "civil", "mansion"],
  ["academia", "civil", "university"],
  ["arsenal", "defensive", null],
  ["cine", "civil", null],
  ["cines", "civil", null],
  ["cementerio", "religious", null],
  ["calvario", "religious", null],
  ["panteon", "commemorative", "monument"],
  ["tumba", "commemorative", "monument"],
  ["triunfo", "commemorative", "monument"],
  ["cueva", "archaeology", "site"],
  ["aljibe", "archaeology", "site"],
  ["cuesta", "urban", "street"],
  ["playa", "urban", "landscape"],
  ["palmeral", "urban", "park"],
  ["real monasterio", "religious", "monastery"],
  ["sacro convento", "religious", "monastery"],
  ["seo", "religious", "cathedral"],
  ["campanario", "religious", "church"],
  ["real casa", "civil", "palace"],
  ["patio de escuelas", "civil", "university"],
  ["facultad", "civil", "university"],
  ["ciudad universitaria", "civil", "university"],
  ["archivo", "civil", "museum"],
  ["archivos", "civil", "museum"],
  ["parlamento", "civil", "modern-building"],
  ["audiencia", "civil", "modern-building"],
  ["hotel", "civil", "modern-building"],
  ["estadio", "civil", "modern-building"],
  ["balneario", "civil", "modern-building"],
  ["meson", "civil", "mansion"],
  ["molino", "civil", null],
  ["rollo", "commemorative", "monument"],
  ["circo romano", "archaeology", "site"],
  ["italica", "archaeology", "site"],
  ["naveta", "archaeology", "site"],
  ["escalinata", "urban", "street"],
  ["ramblas", "urban", "street"],
  ["penon", "urban", "landscape"],
  ["ciudad encantada", "urban", "landscape"],
  ["sacra capilla", "religious", "church"],
  ["tapices", "artworks", "tapestry"],
  ["valle de los caidos", "commemorative", "monument"],
  ["pilares", "commemorative", "monument"],
  ["alcaiceria", "civil", "exchange"],
  ["manzana", "urban", null],
  ["casilicio", "religious", null],
  ["cerveceria", "civil", null],
  ["venta", "civil", null],
  ["patio", "civil", null],
];

/** Painters and sculptors whose name in a label («Obra - Autor - Lugar») makes it a work of art. */
const PAINTERS = ["greco", "goya", "velazquez", "el greco", "zurbaran", "murillo", "ribera", "tiziano", "rubens", "el bosco", "sorolla", "picasso", "dali", "miro", "jose maria sert", "sert", "morales", "valdes leal", "alonso cano", "juan de juanes", "sanchez coello", "pantoja de la cruz", "madrazo", "fortuny", "zuloaga", "romero de torres", "rusinol", "j risueno", "risueno"];
const SCULPTORS = ["juan de mena", "montanes", "martinez montanes", "salzillo", "gregorio hernandez", "juan de juni", "juni", "berruguete", "pedro de mena", "mena", "damian forment", "benlliure", "ruiz de la iglesia", "la roldana", "roldan"];

/** The typology an element's name announces, if any. */
export function typeFromName(label: string): { group: string; type: string | null } | null {
  const clean = (text: string) => foldText(text).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const [first = "", ...rest] = label.split(/\s+[-–—]\s*|\s*[-–—]\s+/);
  const name = clean(first);
  for (const [words, group, type] of NAME_TYPES)
    if (name === words || name.startsWith(words + " ")) return { group, type };
  const parts = rest.map(clean);
  if (parts.some((p) => SCULPTORS.includes(p))) return { group: "artworks", type: "sculpture" };
  if (parts.some((p) => PAINTERS.includes(p))) return { group: "artworks", type: "painting" };
  return null;
}

// ── Hierarchy ────────────────────────────────────────────────────────────────

type ById = Record<string, HeritageElement | undefined>;

/** Parent, grandparent… nearest first, stopping at a cycle or a missing record. */
export function ancestors(id: string, byId: ById): string[] {
  const seen = new Set([id]);
  const out: string[] = [];
  for (let p = byId[id]?.parentId ?? null; p && !seen.has(p); p = byId[p]?.parentId ?? null) {
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** Whether giving `id` this parent would close a loop. */
export const wouldCycle = (id: string, parentId: string | null, byId: ById) =>
  !!parentId && (parentId === id || ancestors(parentId, byId).includes(id));

/** Children of each element. */
export function childrenOf(byId: ById): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of Object.values(byId))
    if (e?.parentId) out.set(e.parentId, [...(out.get(e.parentId) ?? []), e.optionId]);
  return out;
}

/** An element and every element under it. */
export function descendantsAndSelf(id: string, byId: ById, children = childrenOf(byId)): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    stack.push(...(children.get(next) ?? []));
  }
  return out;
}

const hasPosition = (e: HeritageElement | undefined): e is HeritageElement & { latitude: number; longitude: number } =>
  !!e && Number.isFinite(e.latitude) && Number.isFinite(e.longitude) && e.latitude !== null && e.longitude !== null;

/**
 * Where an element is drawn: its own coordinates or, without them, those of
 * the nearest ancestor that has them («posición del conjunto»).
 */
export function resolvedPosition(
  id: string,
  byId: ById,
): { latitude: number; longitude: number; inherited: boolean; from: string } | null {
  const own = byId[id];
  if (hasPosition(own)) return { latitude: own.latitude, longitude: own.longitude, inherited: false, from: id };
  for (const a of ancestors(id, byId)) {
    const e = byId[a];
    if (hasPosition(e)) return { latitude: e.latitude, longitude: e.longitude, inherited: true, from: a };
  }
  return null;
}

// ── Finding elements in Wikidata ─────────────────────────────────────────────

export const foldText = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/\s+/g, " ").trim();

/**
 * What to search for an element written as «Elemento - Ciudad» or
 * «Obra - Autor - Lugar»: the searches to try, best first, and the other
 * parts as hints to recognise the right candidate.
 */
export function heritageQuery(label: string): { queries: string[]; hints: string[] } {
  const parts = label
    .split(/\s+[-–—]\s*|\s*[-–—]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const [name = label.trim(), ...hints] = parts;
  const place = hints[hints.length - 1];
  // A single common noun («Catedral», «Alcázar») only means something with its place.
  const generic = !!place && !/\s/.test(name);
  // A single word may be a common noun («Catedral») or a proper name
  // («Generalife»): both readings are searched.
  const queries = place
    ? generic
      ? [`${name} de ${place}`, name, `${name} ${place}`]
      : [name, `${name} ${place}`]
    : [name];
  return { queries: [...new Set(queries.map((q) => q.slice(0, 250)))], hints };
}

/**
 * Wikidata items that are never the element shown: pages about something
 * (categories, lists, disambiguations), writings, media, people, vessels,
 * businesses and organisations.
 */
export const NOT_HERITAGE = new Set([
  "Q4167836", "Q4167410", "Q13406463", "Q17633526", "Q13442814", "Q47461344", "Q571", "Q7725634", "Q732577", "Q3331189",
  "Q1004", "Q11424", "Q482994", "Q134556", "Q7366", "Q5398426", "Q5", "Q15632617", "Q11446", "Q14970", "Q27686",
  "Q4830453", "Q43229", "Q22687",
]);
/** Words of a description that say a candidate is a place, a building or a work. */
const HERITAGE_WORDS =
  /\b(iglesia|catedral|basilica|capilla|ermita|convento|monasterio|colegiata|santuario|mezquita|sinagoga|castillo|alcazar|alcazaba|muralla|torre|puerta|arco|palacio|casa|edificio|monumento|bien de interes cultural|patrimonio|puente|acueducto|faro|puerto|plaza|calle|paseo|parque|jardin|fuente|mirador|museo|teatro|yacimiento|cuadro|pintura|escultura|retablo|estatua|tapiz|church|cathedral|castle|palace|building|monument|bridge|square|street|museum|painting|sculpture)\b/;

/** Distance in kilometres between two points (haversine). */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const r = Math.PI / 180,
    dLat = (b.latitude - a.latitude) * r,
    dLon = (b.longitude - a.longitude) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Where the place named in a label is, from gazetteer matches: in the
 * country most elements are in, and only when the name is not shared by
 * places far apart («Salamanca», the city, and the Madrid district).
 */
export function placeNear(
  name: string,
  found: { name: string; countryCode: string; latitude: number; longitude: number }[],
  country: string | undefined,
): { latitude: number; longitude: number } | null {
  const same = found.filter((p) => foldText(p.name) === foldText(name));
  const pool = same.filter((p) => p.countryCode === country);
  const list = pool.length ? pool : same.length ? same : found.slice(0, 1);
  if (!list.length) return null;
  if (list.some((p) => distanceKm(p, list[0]) > 30)) return null;
  return { latitude: list[0].latitude, longitude: list[0].longitude };
}

type TownHit = { name: string; countryCode: string; latitude: number; longitude: number };

/**
 * Where the towns named by many elements are, read together: the country most
 * of them are in; a name shared by places far apart («Salamanca», the city,
 * and a district of Madrid) is settled by dropping the places that lie inside
 * another town of the list. What stays ambiguous is null.
 */
export function resolveTowns(entries: { id: string; town: string | null; found: TownHit[] }[]): Map<string, { latitude: number; longitude: number } | null> {
  const counts = new Map<string, number>();
  for (const e of entries) if (e.found[0]) counts.set(e.found[0].countryCode, (counts.get(e.found[0].countryCode) ?? 0) + 1);
  const country = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const pool = (e: { town: string | null; found: TownHit[] }) => {
    const same = e.found.filter((p) => e.town && foldText(p.name) === foldText(e.town));
    const inCountry = same.filter((p) => p.countryCode === country);
    return inCountry.length ? inCountry : same.length ? same : e.found.slice(0, 1);
  };
  const together = (list: TownHit[]) => list.length > 0 && !list.some((p) => distanceKm(p, list[0]) > 30);
  const out = new Map<string, { latitude: number; longitude: number } | null>();
  const anchors: { name: string; at: TownHit }[] = [];
  for (const e of entries) {
    const list = pool(e);
    if (e.town && together(list)) {
      out.set(e.id, { latitude: list[0].latitude, longitude: list[0].longitude });
      anchors.push({ name: foldText(e.town), at: list[0] });
    }
  }
  for (const e of entries) {
    if (out.has(e.id)) continue;
    const name = e.town ? foldText(e.town) : "";
    const list = pool(e).filter((p) => !anchors.some((a) => a.name !== name && distanceKm(a.at, p) <= 15));
    out.set(e.id, together(list) ? { latitude: list[0].latitude, longitude: list[0].longitude } : null);
  }
  return out;
}

export type HeritageCandidate = { link: AuthorityLink; confidence: "high" | "medium" | "low"; score: number };

/**
 * Candidates for an element, best first. A candidate is trusted when its
 * name matches and what Wikidata says about it names the element's place
 * (or there is none), and when it is a place or a work, not a person.
 */
export function rankCandidates(
  label: string,
  links: AuthorityLink[],
  /** Where the place named in the label is (from the gazetteer), when known. */
  near?: { latitude: number; longitude: number } | null,
): HeritageCandidate[] {
  const { queries, hints } = heritageQuery(label);
  // A common noun alone («Catedral») helps to search but does not name the
  // element: «calle de la Catedral» is not the cathedral.
  const bare = hints.length && !/\s/.test(label.split(/\s+[-–—]\s*|\s*[-–—]\s+/)[0].trim()) ? foldText(label.split(/\s+[-–—]\s*|\s*[-–—]\s+/)[0]) : null;
  const names = queries.map(foldText).filter((n) => n !== bare);
  const named = typeFromName(label);
  const folded = hints.map(foldText).filter((h) => h.length > 1);
  const seen = new Set<string>();
  return links
    .filter((l) => l.source === "wikidata" && !seen.has(l.id) && seen.add(l.id))
    .filter((l) => !(l.instances ?? []).some((q) => NOT_HERITAGE.has(q)))
    .map((link) => {
      const name = foldText(link.label);
      const about = foldText(`${link.label} ${link.description ?? ""}`);
      const exact = names.includes(name);
      // Close: one name inside the other, but not a short name lost in a
      // much longer label («Alhambra, Generalife y Albaicín» is not «Generalife»).
      const close = !exact && names.some((n) => n.includes(name) || (name.includes(n) && name.length - n.length <= 15));
      // Near the place named (when both positions are known) settles it; far away rules it out.
      const km = near && link.coordinates ? distanceKm(near, link.coordinates) : null;
      const nearby = km !== null && km <= 30;
      const faraway = km !== null && km > 60;
      const hinted = !faraway && (nearby || !folded.length || folded.some((h) => about.includes(h)));
      const kind = typeFromInstances(link.instances);
      const typed = !!kind;
      // What the name says it is must agree with what Wikidata says («Las Meninas -
      // Velázquez» is a painting, not «plaza de las Meninas»).
      const disagrees = !!named && !!kind && !kind.weak && !compatibleGroups(named.group, kind.group);
      // Without the town named in its text, a namesake must be really close.
      const close15 = km !== null && km <= 15;
      // A building, monument or work: by its class, or by what its description says.
      const heritage = typed || HERITAGE_WORDS.test(foldText(link.description ?? ""));
      let score = (exact ? 4 : close ? 2 : 0) + (hinted ? 3 : 0) + (nearby ? 3 : 0) + (typed ? 2 : 0) + (heritage ? 1 : 0) + (link.coordinates ? 1 : 0);
      if (faraway) score -= 6;
      if (link.kind === "person") score -= 6;
      if (disagrees) score -= 5;
      const textual = !folded.length || folded.some((h) => about.includes(h));
      let confidence: HeritageCandidate["confidence"] =
        link.kind === "person" || faraway || (disagrees && !(exact && hinted))
          ? "low"
          : disagrees
            ? "medium"
          : (exact || close) && hinted && heritage && (typed || !!link.coordinates)
            ? exact || nearby
              ? "high"
              : "medium"
            : (exact || close || nearby) && hinted
              ? "medium"
              : "low";
      if (confidence === "high" && !textual && !close15) confidence = "medium";
      return { link, confidence, score };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Statistics ───────────────────────────────────────────────────────────────

/**
 * The categories a record falls in for a heritage property: its elements
 * (and, with their parts, every whole above them), or the types or groups of
 * its elements, each once.
 */
export function heritageCategories(
  ids: string[],
  labels: Map<string, string>,
  byId: Record<string, HeritageElement | undefined>,
  scheme: HeritageScheme,
  level: "element" | "type" | "group" = "element",
  includeParts = false,
): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    if (!labels.has(id)) continue;
    if (level === "element") {
      out.add(labels.get(id)!);
      if (includeParts) for (const whole of ancestors(id, byId)) if (labels.has(whole)) out.add(labels.get(whole)!);
      continue;
    }
    const e = byId[id];
    const info = typology(scheme, e?.group ?? null, e?.type ?? null);
    out.add(level === "group" ? (info?.group ?? "Sin tipología") : (info?.type ?? (info ? `${info.group} (sin tipo)` : "Sin tipología")));
  }
  return [...out];
}

// ── Suggestions from a vision model ──────────────────────────────────────────

export type HeritageSuggestion = {
  name: string;
  place: string | null;
  confidence: "high" | "medium" | "low";
  /** The element of the property it matches, when there is one. */
  optionId: string | null;
};

/** The elements worth naming to the model: those of the places the record mentions. */
export function knownForRecord(options: { id: string; label: string }[], recordText: string, limit = 200): string[] {
  const text = foldText(recordText);
  return options
    .filter((o) => {
      const hints = heritageQuery(o.label).hints;
      const place = hints[hints.length - 1];
      return !!place && foldText(place).length > 2 && text.includes(foldText(place));
    })
    .map((o) => o.label)
    .slice(0, limit);
}

/** What the model is asked about the whole image or one zone of it. */
export function heritageSuggestPrompt(known: string[], zone: boolean): string {
  return [
    zone
      ? "This image is a detail cut out of a larger photograph."
      : "This is a photograph, possibly historical.",
    "Identify the specific, named heritage elements that are visible: buildings, monuments, churches, castles, bridges, fountains, statues, squares, streets, landscapes or works of art (paintings, sculptures, altarpieces).",
    "Name each one as it is commonly known, with the town or city where it is.",
    known.length
      ? `When one of these elements is visible, use its exact name from this list: ${JSON.stringify(known)}`
      : "",
    "Use the record data below only as a hint about where the photograph was taken.",
    'Return ONLY a JSON array, at most 6 items, each {"name": string, "place": string or null, "confidence": "high" | "medium" | "low"}.',
    "Return [] if no specific named element can be recognised. Do not list generic things (people, cars, trees, sky) and do not explain.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The model's answer, read leniently (a JSON array, possibly inside other text). */
export function parseSuggestions(raw: string): Omit<HeritageSuggestion, "optionId">[] {
  const start = raw.indexOf("["),
    end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let items: unknown;
  try {
    items = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items.flatMap((item) => {
    const value = typeof item === "string" ? { name: item } : (item as Record<string, unknown>);
    const name = typeof value?.name === "string" ? value.name.trim().slice(0, 200) : "";
    if (!name || seen.has(foldText(name))) return [];
    seen.add(foldText(name));
    const place = typeof value.place === "string" && value.place.trim() ? value.place.trim().slice(0, 120) : null;
    const confidence = ["high", "medium", "low"].includes(value.confidence as string) ? (value.confidence as HeritageSuggestion["confidence"]) : "medium";
    return [{ name, place, confidence }];
  }).slice(0, 6);
}

/** The element of the property a suggestion names, if any. */
export function matchSuggestion(
  suggestion: { name: string; place: string | null },
  options: { id: string; label: string }[],
): string | null {
  const name = foldText(suggestion.name),
    place = suggestion.place ? foldText(suggestion.place) : null;
  const read = options.map((o) => {
    const parts = o.label.split(/\s+[-–—]\s*|\s*[-–—]\s+/).map(foldText);
    return { id: o.id, full: foldText(o.label), name: parts[0], place: parts.length > 1 ? parts[parts.length - 1] : null };
  });
  const full = place ? `${name} - ${place}` : name;
  const exact = read.find((o) => o.full === full || o.full === name);
  if (exact) return exact.id;
  // «Catedral de Sevilla» and «Catedral - Sevilla» are the same element.
  const sameName = read.filter((o) => o.name === name || (o.place && `${o.name} de ${o.place}` === name));
  const placed = sameName.filter((o) => !place || !o.place || o.place === place || name.includes(o.place));
  return placed.length === 1 ? placed[0].id : sameName.length === 1 && !place ? sameName[0].id : null;
}

// ── OpenStreetMap (Nominatim), for what Wikidata does not have ───────────────

export function nominatimUrl(query: string, countryCode?: string | null, settlement = false) {
  const params = new URLSearchParams({ q: query.slice(0, 250), format: "jsonv2", limit: "6", "accept-language": "es,en" });
  if (settlement) params.set("featuretype", "settlement");
  if (countryCode && /^[a-z]{2}$/i.test(countryCode)) params.set("countrycodes", countryCode.toLowerCase());
  return `https://nominatim.openstreetmap.org/search?${params}`;
}

/** OpenStreetMap tags («category/type») → a type of the default scheme. */
const OSM_TYPES: Record<string, string> = {
  "place/square": "square", "highway/pedestrian": "street", "highway/residential": "street", "highway/primary": "street",
  "highway/secondary": "street", "highway/tertiary": "street", "highway/living_street": "street", "highway/footway": "street",
  "highway/unclassified": "street", "highway/steps": "street", "highway/service": "street", "highway/trunk": "street",
  "leisure/park": "park", "leisure/garden": "park", "tourism/viewpoint": "viewpoint", "natural/beach": "landscape", "natural/peak": "landscape",
  "historic/castle": "castle", "historic/fort": "castle", "historic/city_gate": "gate", "barrier/city_wall": "wall", "historic/tower": "tower",
  "historic/monument": "monument", "historic/memorial": "monument", "amenity/fountain": "fountain", "man_made/bridge": "bridge",
  "amenity/place_of_worship": "church", "building/church": "church", "building/cathedral": "cathedral", "building/chapel": "church",
  "historic/monastery": "monastery", "amenity/monastery": "monastery", "building/monastery": "monastery",
  "tourism/museum": "museum", "railway/station": "station", "historic/archaeological_site": "site", "historic/ruins": "site",
  "building/palace": "palace", "historic/palace": "palace", "amenity/townhall": "town-hall", "amenity/university": "university",
  "man_made/lighthouse": "lighthouse", "amenity/marketplace": "exchange",
};

export type OsmCandidate = {
  name: string;
  display: string;
  latitude: number;
  longitude: number;
  osm: string;
  group: string | null;
  type: string | null;
  confidence: "high" | "medium" | "low";
};

/** Map objects that are never the element (stops, stations of transport). */
const OSM_SKIP = /^(public_transport|highway\/bus_stop|railway\/(stop|halt|tram_stop|subway_entrance)|amenity\/(bus_station|taxi|parking))/;

/** A Nominatim answer read as candidates, before ranking. */
export function readOsm(json: unknown): Omit<OsmCandidate, "confidence">[] {
  const rows = Array.isArray(json) ? (json as Record<string, unknown>[]) : [];
  return rows.flatMap((r) => {
    const latitude = Number(r.lat),
      longitude = Number(r.lon);
    const tag = `${r.category ?? r.class}/${r.type}`;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !r.osm_type || !r.osm_id || OSM_SKIP.test(tag)) return [];
    const type = OSM_TYPES[tag] ?? null;
    return [
      {
        name: String(r.name ?? ""),
        display: String(r.display_name ?? ""),
        latitude,
        longitude,
        osm: `${r.osm_type}/${r.osm_id}`,
        group: type ? groupOfType(DEFAULT_HERITAGE_SCHEME, type) : null,
        type,
      },
    ];
  });
}

/**
 * Candidates for an element, best first. The name must match; the place must
 * be near the town named or be one of the parts of the address (not a region
 * that contains the word); what the name says it is must agree with the map
 * («Castillo …» is not «Avenida del Castillo»); a bare common noun
 * («Catedral - Sevilla») needs the map to say the same kind of thing. Works
 * of art are not looked for on a map.
 */
export function scoreOsm(
  label: string,
  candidates: Omit<OsmCandidate, "confidence">[],
  near?: { latitude: number; longitude: number } | null,
): OsmCandidate[] {
  const { hints } = heritageQuery(label);
  const first = label.split(/\s+[-–—]\s*|\s*[-–—]\s+/)[0] ?? "";
  const name = foldText(first);
  const place = hints.length ? foldText(hints[hints.length - 1]) : null;
  const named = typeFromName(label);
  if (named?.group === "artworks") return [];
  const bare = !!place && !/\s/.test(first.trim());
  // A name that is only a kind of thing («Plaza de toros», «Teatro romano»)
  // exists in many towns around: it must be close to the town's centre.
  const plain = name.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const generic = bare || NAME_TYPES.some(([words]) => words === plain);
  const radius = generic ? 8 : 30;
  return candidates
    .flatMap((c) => {
      const own = foldText(c.name);
      const exact = !!own && own === name;
      const close = !!own && !exact && (own.includes(name) || (name.includes(own) && own.length > 3));
      const km = near ? distanceKm(near, c) : null;
      const nearby = km !== null && km <= radius;
      // Where the town is known, distance decides (a province is often called
      // like its capital); otherwise the town must be part of the address.
      const inPlace = km === null && !!place && c.display.split(",").some((part) => foldText(part) === place);
      if (km !== null && km > 60) return [];
      const agrees = !named || !c.group || compatibleGroups(c.group, named.group);
      const kindKnown = !!named && !!c.group && agrees;
      let confidence: OsmCandidate["confidence"] =
        (exact || close) && (nearby || inPlace) ? (exact ? "high" : "medium") : exact || close ? "medium" : "low";
      if (!agrees) confidence = "low";
      // Without knowing where the town is, nothing is certain enough to apply on its own.
      if (km === null && confidence === "high") confidence = "medium";
      if (bare && !kindKnown) confidence = confidence === "high" ? "medium" : "low";
      const score = (exact ? 4 : close ? 2 : 0) + (nearby || inPlace ? 3 : 0) + (c.type ? 1 : 0) + (agrees ? 0 : -5);
      return [{ ...c, confidence, score }];
    })
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...c }) => c);
}

/** Nominatim answers for an element, best first. */
export function rankOsm(label: string, json: unknown, near?: { latitude: number; longitude: number } | null): OsmCandidate[] {
  return scoreOsm(label, readOsm(json), near);
}

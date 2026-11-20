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
  coordSource: "wikidata" | "manual" | null;
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
        t("monastery", "Monasterio o convento", "Monastery or convent"), t("mosque", "Mezquita", "Mosque", "MoonStar"),
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

/** The first instance with a known type, as group and type of the default scheme. */
export function typeFromInstances(instances: string[] | null | undefined): { group: string; type: string } | null {
  for (const q of instances ?? []) {
    const type = WIKIDATA_TYPES[q];
    const group = type && groupOfType(DEFAULT_HERITAGE_SCHEME, type);
    if (type && group) return { group, type };
  }
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
    .split(/\s+[-–—]\s+/)
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
  const names = queries.map(foldText);
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
      const typed = !!typeFromInstances(link.instances);
      // A building, monument or work: by its class, or by what its description says.
      const heritage = typed || HERITAGE_WORDS.test(foldText(link.description ?? ""));
      let score = (exact ? 4 : close ? 2 : 0) + (hinted ? 3 : 0) + (nearby ? 3 : 0) + (typed ? 2 : 0) + (heritage ? 1 : 0) + (link.coordinates ? 1 : 0);
      if (faraway) score -= 6;
      if (link.kind === "person") score -= 6;
      const confidence: HeritageCandidate["confidence"] =
        link.kind === "person" || faraway
          ? "low"
          : (exact || close) && hinted && heritage && (typed || !!link.coordinates)
            ? exact || nearby
              ? "high"
              : "medium"
            : (exact || close || nearby) && hinted
              ? "medium"
              : "low";
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

// Links between the values of a property and authority records: Wikidata
// (which also carries the Getty identifiers ULAN, TGN and AAT, and Iconclass
// notations) and Iconclass for iconographic subjects. Requests and responses
// are built and read here so they are tested; the main process sends them.

export type AuthoritySource = "wikidata" | "iconclass";
export type AuthorityKind = "person" | "place" | "subject";
export type AuthorityLink = {
  source: AuthoritySource;
  /** Q-number or Iconclass notation. */
  id: string;
  label: string;
  description: string | null;
  uri: string;
  /** Getty vocabularies, when Wikidata has them. */
  ulan?: string | null;
  tgn?: string | null;
  aat?: string | null;
  iconclass?: string | null;
  coordinates?: { latitude: number; longitude: number } | null;
  /** Years of birth and death of a person, or of foundation of a group. */
  born?: number | null;
  died?: number | null;
  /** Person, place or other, as read from Wikidata. */
  kind?: AuthorityKind | "other";
  /** Wikidata: what it is (P31) and what it is part of (P361), as Q-numbers. */
  instances?: string[];
  partOf?: string[];
};

export const AUTHORITY_SOURCES: Record<AuthoritySource, string> = { wikidata: "Wikidata", iconclass: "Iconclass" };

const params = (values: Record<string, string>) => new URLSearchParams(values).toString();

export function wikidataSearchUrl(query: string, language: string, limit = 8) {
  return `https://www.wikidata.org/w/api.php?${params({
    action: "wbsearchentities",
    search: query.slice(0, 250),
    language,
    uselang: language,
    type: "item",
    limit: String(limit),
    format: "json",
  })}`;
}
export function wikidataEntitiesUrl(ids: string[], language: string) {
  return `https://www.wikidata.org/w/api.php?${params({
    action: "wbgetentities",
    ids: ids.filter((id) => /^Q\d+$/.test(id)).slice(0, 50).join("|"),
    props: "claims|labels|descriptions",
    languages: [...new Set([language, "es", "en"])].join("|"),
    format: "json",
  })}`;
}
/** The classes above some classes (P279, "subclass of"), one step up. */
export function wikidataClassesUrl(ids: string[]) {
  return `https://www.wikidata.org/w/api.php?${params({
    action: "wbgetentities",
    ids: ids.filter((id) => /^Q\d+$/.test(id)).slice(0, 50).join("|"),
    props: "claims",
    format: "json",
  })}`;
}
export function parseSuperclasses(json: any): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, e] of Object.entries((json?.entities ?? {}) as Record<string, any>))
    out[id] = ((e?.claims?.P279 ?? []) as any[])
      .map((c) => c?.mainsnak?.datavalue?.value?.id)
      .filter((q): q is string => typeof q === "string" && /^Q\d+$/.test(q));
  return out;
}
/** Full-text search over Wikidata items (labels, aliases and descriptions). */
export function wikidataFullTextUrl(query: string, limit = 6) {
  return `https://www.wikidata.org/w/api.php?${params({
    action: "query",
    list: "search",
    srsearch: query.slice(0, 250),
    srnamespace: "0",
    srlimit: String(limit),
    format: "json",
  })}`;
}
export function parseWikidataFullText(json: any): string[] {
  return ((json?.query?.search ?? []) as any[]).map((r) => String(r.title ?? "")).filter((id) => /^Q\d+$/.test(id));
}
/** Iconclass search works in English, German, French, Italian and other languages, not Spanish. */
export function iconclassSearchUrl(query: string) {
  return `https://iconclass.org/api/search?${params({ q: query.slice(0, 200), lang: "en", size: "100", page: "1", sort: "rank", keys: "0" })}`;
}
export const iconclassItemUrl = (notation: string) => `https://iconclass.org/${encodeURIComponent(notation)}.json`;

export function parseWikidataSearch(json: any): string[] {
  return ((json?.search ?? []) as any[]).map((r) => String(r.id ?? "")).filter((id) => /^Q\d+$/.test(id));
}

const HUMAN = "Q5";
const claim = (entity: any, property: string) => entity?.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
const text = (entity: any, field: "labels" | "descriptions", language: string) =>
  entity?.[field]?.[language]?.value ?? entity?.[field]?.es?.value ?? entity?.[field]?.en?.value ?? null;
const year = (value: any) => {
  const m = /^([+-])(\d{1,4})-/.exec(String(value?.time ?? ""));
  return m ? Number(m[2]) * (m[1] === "-" ? -1 : 1) : null;
};

/** Candidates in the order of the search, with what Wikidata says about each. */
export function parseWikidataEntities(json: any, order: string[], language: string): AuthorityLink[] {
  const entities = json?.entities ?? {};
  return order.flatMap((id) => {
    const e = entities[id];
    if (!e || e.missing !== undefined) return [];
    const instances = ((e.claims?.P31 ?? []) as any[]).map((c) => c?.mainsnak?.datavalue?.value?.id);
    const coordinates = claim(e, "P625");
    const tgn = claim(e, "P1667") ?? null;
    const kind: AuthorityLink["kind"] = instances.includes(HUMAN) ? "person" : coordinates || tgn ? "place" : "other";
    return [
      {
        source: "wikidata" as const,
        id,
        label: text(e, "labels", language) ?? id,
        description: text(e, "descriptions", language),
        uri: `https://www.wikidata.org/wiki/${id}`,
        ulan: claim(e, "P245") ?? null,
        tgn,
        aat: claim(e, "P1014") ?? null,
        iconclass: claim(e, "P1256") ?? null,
        coordinates: coordinates && Number.isFinite(coordinates.latitude) ? { latitude: coordinates.latitude, longitude: coordinates.longitude } : null,
        born: year(claim(e, "P569") ?? claim(e, "P571")),
        died: year(claim(e, "P570") ?? claim(e, "P576")),
        kind,
        instances: instances.filter((q): q is string => typeof q === "string" && /^Q\d+$/.test(q)).slice(0, 20),
        partOf: ((e.claims?.P361 ?? []) as any[])
          .map((c) => c?.mainsnak?.datavalue?.value?.id)
          .filter((q): q is string => typeof q === "string" && /^Q\d+$/.test(q))
          .slice(0, 20),
      },
    ];
  });
}
export const fitsKind = (link: AuthorityLink, kind: AuthorityKind | null | undefined) =>
  !kind || kind === "subject" || link.kind === kind;

/**
 * Iconclass searches by word stems ("procession" also finds "process") and
 * its own order is not useful, so the shortest notations (the more general
 * subjects) are read, and only those whose text has the words searched are kept.
 * Notations with keys ("(+53)") are variants of others and are left out.
 */
export const parseIconclassSearch = (json: any, read = 30): string[] =>
  ((json?.result ?? []) as unknown[])
    .map(String)
    .filter((n) => /^[0-9A-Z][0-9A-Za-z().\s&-]*$/.test(n) && !n.includes("(+"))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, read);
export function rankIconclass(items: AuthorityLink[], query: string, keep = 10): AuthorityLink[] {
  const words = query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const matches = (label: string) => words.every((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(e?s)?\\b`, "iu").test(label));
  // Only the subjects that name the words searched, when there are any.
  const named = items.filter((i) => matches(i.label));
  return (named.length ? named : items).slice(0, keep);
}
export function parseIconclassItem(json: any): AuthorityLink | null {
  const notation = typeof json?.n === "string" ? json.n : null;
  if (!notation) return null;
  const txt = json.txt ?? {};
  return {
    source: "iconclass",
    id: notation,
    label: txt.es ?? txt.en ?? txt.it ?? txt.fr ?? txt.de ?? notation,
    description: null,
    uri: `https://iconclass.org/${encodeURIComponent(notation)}`,
    iconclass: notation,
    kind: "other",
  };
}

/** Plain links for an export: the URI and the Getty identifiers, when known. */
export function authorityExportText(link: AuthorityLink | undefined): string {
  if (!link) return "";
  const getty = [
    link.ulan && `ULAN ${link.ulan}`,
    link.tgn && `TGN ${link.tgn}`,
    link.aat && `AAT ${link.aat}`,
    link.iconclass && link.source !== "iconclass" && `Iconclass ${link.iconclass}`,
  ].filter(Boolean);
  return [link.uri, ...getty].join(" · ");
}

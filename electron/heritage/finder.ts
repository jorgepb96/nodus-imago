// Finding heritage elements outside Imago: Wikidata for identity, typology
// and coordinates; OpenStreetMap (Nominatim) for what Wikidata lacks and for
// towns the bundled gazetteer cannot place. Used by the main process for one-off
// lookups and by the job queue for long batches. Only names are sent.
import type { GazetteerPlace } from "../../shared/places";
import {
  parseSuperclasses,
  parseWikidataEntities,
  parseWikidataFullText,
  parseWikidataSearch,
  wikidataClassesUrl,
  wikidataEntitiesUrl,
  wikidataFullTextUrl,
  wikidataSearchUrl,
  type AuthorityLink,
} from "../../shared/authority";
import {
  heritageQuery,
  heritageTown,
  nominatimUrl,
  pickSettlement,
  rankCandidates,
  rankOsm,
  resolveTowns,
  townsCountry,
  WIKIDATA_TYPES,
  withSuperclasses,
  type HeritageCandidate,
  type OsmCandidate,
} from "../../shared/heritage";

export const HERITAGE_USER_AGENT = "NodusImago/0.1 (https://github.com/jorgepb96/nodus-imago)";

/** A service could not be reached or refused: the work pauses instead of failing. */
export class HeritageNetworkError extends Error {
  pause = true;
}

type Item = { optionId: string; label: string };
type Point = { latitude: number; longitude: number };
export type Towns = { near: (optionId: string) => Point | null; country: string | undefined; town: (optionId: string) => string | null };

export class HeritageFinder {
  private nominatimNext = 0;
  private townCache = new Map<string, Point | null>();
  private classCache = new Map<string, string[]>();
  constructor(
    private gazetteer: () => { search(query: string, limit?: number): GazetteerPlace[] },
    private fetcher: typeof fetch = fetch,
  ) {}

  /** A JSON answer, waiting when asked to slow down; unreachable services pause the work. */
  private async json(url: string, service: string): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: { "User-Agent": HERITAGE_USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new HeritageNetworkError(`No se pudo conectar con ${service}.`);
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        const wait = Math.min(30, Number(response.headers.get("retry-after")) || 5 * (attempt + 1));
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        continue;
      }
      if (!response.ok) throw new HeritageNetworkError(`${service}: HTTP ${response.status}`);
      const json = await response.json();
      if (json?.error && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
        continue;
      }
      if (json?.error) throw new HeritageNetworkError(`${service}: ${json.error.info ?? json.error.code ?? "error"}`);
      return json;
    }
  }
  /** Nominatim allows one request a second. */
  private async nominatim(url: string) {
    const wait = this.nominatimNext - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.nominatimNext = Date.now() + 1100;
    return this.json(url, "OpenStreetMap");
  }

  /**
   * Where the towns named by these elements are: read together from the
   * gazetteer; those it cannot place, from OpenStreetMap (cached).
   */
  async towns(items: Item[], lookup = true): Promise<Towns> {
    const entries = items.map((item) => {
      const town = heritageTown(item.label);
      return { id: item.optionId, town, found: town ? this.gazetteer().search(town, 20) : [] };
    });
    const country = townsCountry(entries);
    const resolved = resolveTowns(entries);
    if (lookup)
      for (const town of [...new Set(entries.filter((e) => e.town && !resolved.get(e.id)).map((e) => e.town!))]) {
        const key = `${country}|${town}`;
        if (this.townCache.has(key)) continue;
        this.townCache.set(key, pickSettlement(await this.nominatim(nominatimUrl(town, country, true)), town));
      }
    const townOf = new Map(entries.map((e) => [e.id, e.town]));
    return {
      country,
      town: (id) => townOf.get(id) ?? null,
      near: (id) => resolved.get(id) ?? (townOf.get(id) ? (this.townCache.get(`${country}|${townOf.get(id)}`) ?? null) : null),
    };
  }

  /** The town of one element, looked for in OpenStreetMap if the gazetteer could not place it. */
  async ensureTown(towns: Towns, optionId: string) {
    const town = towns.town(optionId);
    if (!town || towns.near(optionId)) return;
    const key = `${towns.country}|${town}`;
    if (this.townCache.has(key)) return;
    this.townCache.set(key, pickSettlement(await this.nominatim(nominatimUrl(town, towns.country, true)), town));
  }

  /** Wikidata candidates for some elements, ranked. */
  async wikidata(items: Item[], language: string, towns: Towns): Promise<{ optionId: string; candidates: HeritageCandidate[] }[]> {
    const get = (url: string) => this.json(url, "Wikidata");
    const found = new Map<string, string[]>();
    for (let i = 0; i < items.length; i += 4)
      await Promise.all(
        items.slice(i, i + 4).map(async (item) => {
          const { queries, hints } = heritageQuery(item.label);
          const name = item.label.split(/\s+[-–—]\s*|\s*[-–—]\s+/)[0];
          const place = hints[hints.length - 1];
          const ids: string[] = [];
          if (place) ids.push(...parseWikidataFullText(await get(wikidataFullTextUrl(`${name} ${place}`))));
          for (const query of queries.slice(0, 2)) ids.push(...parseWikidataSearch(await get(wikidataSearchUrl(query, language, 6))));
          found.set(item.optionId, [...new Set(ids)].slice(0, 12));
        }),
      );
    const all = [...new Set([...found.values()].flat())];
    const links = new Map<string, AuthorityLink>();
    for (let i = 0; i < all.length; i += 25) {
      const ids = all.slice(i, i + 25);
      for (const link of parseWikidataEntities(await get(wikidataEntitiesUrl(ids, language)), ids, language)) links.set(link.id, link);
    }
    // Classes Imago does not know: one step up, to suggest a type (cached).
    const unknown = [...new Set([...links.values()].flatMap((l) => l.instances ?? []).filter((q) => !WIKIDATA_TYPES[q] && !this.classCache.has(q)))];
    for (let i = 0; i < unknown.length; i += 50) {
      const above = parseSuperclasses(await get(wikidataClassesUrl(unknown.slice(i, i + 50))));
      for (const q of unknown.slice(i, i + 50)) this.classCache.set(q, above[q] ?? []);
    }
    const above = Object.fromEntries(this.classCache);
    for (const link of links.values()) link.instances = withSuperclasses(link.instances, above);
    return items.map((item) => ({
      optionId: item.optionId,
      candidates: rankCandidates(
        item.label,
        (found.get(item.optionId) ?? []).flatMap((id) => (links.has(id) ? [links.get(id)!] : [])),
        towns.near(item.optionId),
      ).slice(0, 4),
    }));
  }

  /** OpenStreetMap candidates for one element, ranked. */
  async osm(item: Item, towns: Towns): Promise<OsmCandidate[]> {
    const parts = item.label.split(/\s+[-–—]\s*|\s*[-–—]\s+/);
    const town = towns.town(item.optionId);
    const query = town ? `${parts[0]}, ${town}` : parts[0];
    return rankOsm(item.label, await this.nominatim(nominatimUrl(query, towns.country)), towns.near(item.optionId)).slice(0, 4);
  }
}

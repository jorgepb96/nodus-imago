// Adapted from Nodus Research, © Jorge Pérez Burgueño. AGPL-3.0-only.
// Searches the same bundled GeoNames catalogue without any network request.
import fs from "node:fs";
import zlib from "node:zlib";
import type { GazetteerPlace } from "../../shared/places";

export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export class Gazetteer {
  private entries:
    { place: GazetteerPlace; folded: string; context: string }[] | null = null;
  constructor(private file: string) {}

  private load() {
    if (this.entries) return this.entries;
    const text = zlib.gunzipSync(fs.readFileSync(this.file)).toString("utf8");
    this.entries = text.split("\n").flatMap((line) => {
      const [
        id,
        name,
        admin1 = "",
        countryCode = "",
        country = "",
        lat,
        lon,
        pop,
      ] = line.split("\t");
      const latitude = Number(lat),
        longitude = Number(lon);
      if (
        !id ||
        !name ||
        !lat ||
        !lon ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      )
        return [];
      const place = {
        gazetteerId: `geonames:${id}`,
        name,
        admin1,
        countryCode,
        country,
        latitude,
        longitude,
        population: Number(pop) || 0,
      };
      return [
        {
          place,
          folded: foldText(name),
          context: foldText(`${admin1} ${country} ${countryCode}`),
        },
      ];
    });
    return this.entries;
  }

  search(query: string, limit = 12): GazetteerPlace[] {
    const q = foldText(query);
    if (q.length < 2) return [];
    // An optional comma disambiguates towns with the same name: "Paris, France".
    const [name, ...context] = q.split(",").map((part) => part.trim());
    if (!name) return [];
    return this.load()
      .filter(
        (entry) =>
          entry.folded.includes(name) &&
          context.every((part) => entry.context.includes(part)),
      )
      .sort((a, b) => {
        const rank = (text: string) =>
          text === name ? 0 : text.startsWith(name) ? 1 : 2;
        return (
          rank(a.folded) - rank(b.folded) ||
          b.place.population - a.place.population
        );
      })
      .slice(0, Math.min(20, Math.max(1, limit)))
      .map((entry) => entry.place);
  }
}

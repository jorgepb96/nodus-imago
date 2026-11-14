// Present-day photographs near a place, from Wikimedia Commons, to compare
// "then and now". Parsed here so the request and the response are tested.
export type CommonsPhoto = {
  title: string;
  page: string;
  thumbnail: string;
  large: string;
  latitude: number;
  longitude: number;
  distance: number;
  author: string | null;
  license: string | null;
  date: string | null;
};
export function commonsQuery(latitude: number, longitude: number, radius = 300): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "geosearch",
    ggscoord: `${latitude}|${longitude}`,
    ggsradius: String(Math.min(10000, Math.max(10, Math.round(radius)))),
    ggsnamespace: "6",
    ggslimit: "24",
    prop: "imageinfo|coordinates",
    // Coordinates of every page (the API gives ten by default).
    colimit: "max",
    iiprop: "url|extmetadata",
    iiurlwidth: "1200",
    origin: "*",
  });
  return `https://commons.wikimedia.org/w/api.php?${params}`;
}
const plain = (html: unknown) =>
  typeof html === "string" ? html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || null : null;
/**
 * The date of a Commons file as a date or a year. The field may hold a
 * timestamp ("2019-05-02 10:00") or a sentence ("Taken on 2 June 2013").
 */
export function commonsDate(text: string | null): string | null {
  if (!text) return null;
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (iso) return iso[1];
  const year = /\b(1[89]\d{2}|20\d{2})\b/.exec(text);
  return year ? year[1] : null;
}
export function parseCommons(json: any, origin: { latitude: number; longitude: number }, distance: (a: any, b: any) => number): CommonsPhoto[] {
  const pages = Object.values(json?.query?.pages ?? {}) as any[];
  return pages
    .flatMap((p) => {
      const info = p.imageinfo?.[0],
        c = p.coordinates?.[0];
      if (!info?.thumburl || !c || !/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(info.thumburl)) return [];
      const meta = info.extmetadata ?? {};
      const at = { latitude: c.lat, longitude: c.lon };
      return [
        {
          title: String(p.title ?? "").replace(/^File:/, ""),
          page: String(info.descriptionurl ?? ""),
          // 500 px is one of the sizes the thumbnail server always serves.
          thumbnail: String(info.thumburl).replace(/\/\d+px-/, "/500px-"),
          large: String(info.thumburl),
          ...at,
          distance: Math.round(distance(origin, at)),
          author: plain(meta.Artist?.value),
          license: plain(meta.LicenseShortName?.value),
          date: commonsDate(plain(meta.DateTimeOriginal?.value)),
        },
      ];
    })
    .sort((a, b) => a.distance - b.distance);
}

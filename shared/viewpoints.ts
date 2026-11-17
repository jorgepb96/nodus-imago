// Repeated views: photographs taken from about the same place, looking the
// same way (when the camera direction is known). Grouped around a central
// photograph, never by chains, so two distant places are never joined.
import type { MapRecord } from "./imago";

/** Distance in metres between two coordinates. */
export function metres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180,
    dLat = (b.latitude - a.latitude) * rad,
    dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
/** Smallest angle between two directions, in degrees. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

const EARTH = 6371000;
type Point = { location: { latitude: number; longitude: number } };
const grids = new WeakMap<Point[], Map<number, Map<number, number[]>>>();
/** Every record that can lie within maxMetres of located[i], in the original
 * order, never missing one. Comparing every photograph with every other one
 * took seconds with a few thousand records and froze the map; a grid of cells
 * about maxMetres tall only looks at the neighbouring rows, and within them at
 * the longitudes the distance allows. The caller still checks the exact
 * distance. */
function nearby<T extends Point>(located: T[], i: number, maxMetres: number): T[] {
  const dLat = ((maxMetres / EARTH) * 180) / Math.PI;
  const rowOf = (lat: number) => Math.floor(lat / (dLat * 1.01));
  let grid = grids.get(located);
  if (!grid) {
    // Rows of latitude, each holding its records by longitude band.
    grid = new Map();
    located.forEach((r, k) => {
      const row = rowOf(r.location.latitude),
        band = Math.floor(r.location.longitude);
      const bands = grid!.get(row) ?? grid!.set(row, new Map()).get(row)!;
      (bands.get(band) ?? bands.set(band, []).get(band)!).push(k);
    });
    grids.set(located, grid);
  }
  const { latitude, longitude } = located[i].location,
    rad = Math.PI / 180;
  // Haversine: cos a · cos b · sin²(Δλ/2) ≤ sin²(d/2R), with b at most dLat away.
  const cosA = Math.cos(latitude * rad),
    cosB = Math.cos(Math.min(90, Math.abs(latitude) + dLat * 1.01) * rad),
    limit = Math.sin(maxMetres / EARTH / 2) / Math.sqrt(Math.max(0, cosA * cosB));
  const dLng =
    !Number.isFinite(limit) || limit >= 1
      ? 360
      : ((2 * Math.asin(limit)) / rad) * 1.01 + 1e-9;
  const found: number[] = [],
    row = rowOf(latitude);
  for (let r = row - 1; r <= row + 1; r++) {
    const bands = grid.get(r);
    if (!bands) continue;
    if (dLng >= 180) {
      for (const list of bands.values()) found.push(...list);
      continue;
    }
    // Longitudes wrap at ±180°: look at the band range there too.
    for (const shift of [-360, 0, 360]) {
      const from = Math.floor(longitude + shift - dLng),
        to = Math.floor(longitude + shift + dLng);
      for (let band = from; band <= to; band++)
        for (const k of bands.get(band) ?? []) {
          const lng = located[k].location.longitude + -shift;
          if (Math.abs(lng - longitude) <= dLng) found.push(k);
        }
    }
  }
  return [...new Set(found)].sort((a, b) => a - b).map((k) => located[k]);
}

type Located = MapRecord & { location: { latitude: number; longitude: number; bearing?: number | null; name: string } };

export function repeatedViews(records: MapRecord[], maxMetres = 80, maxAngle = 40): Located[][] {
  const located = records.filter(
    (r): r is Located => typeof r.location?.latitude === "number" && typeof r.location?.longitude === "number",
  );
  const close = (a: Located, b: Located) =>
    metres(a.location, b.location) <= maxMetres &&
    (a.location.bearing == null || b.location.bearing == null || angleBetween(a.location.bearing, b.location.bearing) <= maxAngle);
  // A place name repeated by hundreds of records (a city centre) is not a viewpoint:
  // only records with a bearing, or a handful sharing exact coordinates, are grouped.
  const neighbours = new Map(located.map((r, i) => [r.id, nearby(located, i, maxMetres).filter((o) => o.id !== r.id && close(r, o))]));
  const remaining = new Set(located.map((r) => r.id));
  const groups: Located[][] = [];
  for (const r of [...located].sort((a, b) => neighbours.get(b.id)!.length - neighbours.get(a.id)!.length)) {
    if (!remaining.has(r.id)) continue;
    const members = [r, ...neighbours.get(r.id)!.filter((o) => remaining.has(o.id))];
    if (members.length < 2) continue;
    const directed = members.filter((m) => m.location.bearing != null).length;
    if (directed < 2 && members.length > 12) continue;
    for (const m of members) remaining.delete(m.id);
    groups.push(members);
  }
  return groups.sort((a, b) => b.length - a.length);
}

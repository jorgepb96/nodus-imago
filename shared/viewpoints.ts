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
  const neighbours = new Map(located.map((r) => [r.id, located.filter((o) => o.id !== r.id && close(r, o))]));
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

import type { MapRecord } from "./imago";
import { validCoordinates } from "./places";

export type LocatedMapRecord = MapRecord & {
  location: NonNullable<MapRecord["location"]> & {
    latitude: number;
    longitude: number;
  };
};
export function locatedRecords(records: MapRecord[]): LocatedMapRecord[] {
  return records.filter((record): record is LocatedMapRecord =>
    validCoordinates(record.location),
  );
}
export type MapCluster = {
  id: string;
  records: LocatedMapRecord[];
  latitude: number;
  longitude: number;
};
/** Fixed Web Mercator grid per zoom: coincident images remain accessible as a
 * group, and thousands of close records do not create thousands of DOM nodes. */
export function clusterMapRecords(
  records: LocatedMapRecord[],
  zoom: number,
): MapCluster[] {
  const scale = 256 * 2 ** zoom;
  const groups = new Map<string, MapCluster>();
  for (const record of records) {
    const { latitude, longitude } = record.location;
    const sin = Math.sin(
      (Math.min(85.05112878, Math.max(-85.05112878, latitude)) * Math.PI) / 180,
    );
    const x = ((longitude + 180) / 360) * scale;
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
    const id = `${Math.floor(x / 64)}:${Math.floor(y / 64)}`;
    const cluster = groups.get(id);
    if (cluster) {
      cluster.records.push(record);
      cluster.latitude +=
        (latitude - cluster.latitude) / cluster.records.length;
      cluster.longitude +=
        (longitude - cluster.longitude) / cluster.records.length;
    } else groups.set(id, { id, records: [record], latitude, longitude });
  }
  return [...groups.values()];
}

/** True when a refreshed answer shows exactly the same records, so the map
 * keeps its markers and images instead of rebuilding them on every change
 * elsewhere in the app (indexing, backups, updates…). */
export function sameMapRecords(a: MapRecord[], b: MapRecord[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i],
      y = b[i];
    if (
      x.id !== y.id ||
      x.title !== y.title ||
      x.imageCount !== y.imageCount ||
      x.image?.id !== y.image?.id ||
      x.image?.revision !== y.image?.revision ||
      !sameShallow(x.location, y.location)
    )
      return false;
  }
  return true;
}
function sameShallow(a: object | null | undefined, b: object | null | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>,
    keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k])
  );
}

export type MapBounds = [[number, number], [number, number]];
/** The region where the photographs are: a country when they are all in one
 * country, a continent or the world when they spread that far. Every located
 * record counts — a single trip abroad is part of the collection. */
export function focusBounds(records: LocatedMapRecord[]): MapBounds | null {
  if (!records.length) return null;
  let s = Infinity,
    w = Infinity,
    n = -Infinity,
    e = -Infinity;
  for (const { location } of records) {
    s = Math.min(s, location.latitude);
    n = Math.max(n, location.latitude);
    w = Math.min(w, location.longitude);
    e = Math.max(e, location.longitude);
  }
  return [
    [s, w],
    [n, e],
  ];
}
/** A framing saved earlier, read back defensively (device preference). */
export function storedBounds(raw: string | null): MapBounds | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    const ok = (p: unknown) =>
      Array.isArray(p) &&
      p.length === 2 &&
      Math.abs(p[0]) <= 90 &&
      Math.abs(p[1]) <= 180;
    return Array.isArray(value) && value.length === 2 && value.every(ok)
      ? (value as MapBounds)
      : null;
  } catch {
    return null;
  }
}

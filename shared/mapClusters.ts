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

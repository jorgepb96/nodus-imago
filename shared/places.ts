/** Same GeoNames catalogue and identifiers as the Nodus genealogy vault. */
export interface GazetteerPlace {
  gazetteerId: string;
  name: string;
  admin1: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  population: number;
}

export function validCoordinates(
  value: {
    latitude?: number | null;
    longitude?: number | null;
  } | null,
): value is { latitude: number; longitude: number } {
  return (
    typeof value?.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

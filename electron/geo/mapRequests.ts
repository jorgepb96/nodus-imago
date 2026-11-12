/** Renderer networking remains closed except for the visible OSM raster tiles. */
export function isMapTileRequest(url: string, resourceType: string): boolean {
  return (
    resourceType === "image" &&
    /^https:\/\/tile\.openstreetmap\.org\/\d{1,2}\/\d{1,7}\/\d{1,7}\.png$/.test(
      url,
    )
  );
}

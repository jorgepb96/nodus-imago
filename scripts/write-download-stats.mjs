// Used by the download-stats workflow: writes the counters to a folder.
import { fetchReleases, writeSnapshot } from "./release-downloads.mjs";
const folder = process.argv[2];
if (!folder) throw Error("Usage: write-download-stats.mjs <output folder>");
console.log(JSON.stringify(await writeSnapshot(folder, await fetchReleases()), null, 2));

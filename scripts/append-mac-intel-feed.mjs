// Used by release-macos-intel.yml: adds the Intel entries to the published macOS feed.
import fs from "node:fs/promises";
import { appendMacIntelFeed } from "./merge-update-feeds.mjs";
const [published, intel, releaseFolder, version, output] = process.argv.slice(2);
if (!published || !intel || !releaseFolder || !version || !output)
  throw Error("Usage: append-mac-intel-feed.mjs published.yml intel.yml release-folder version output.yml");
await fs.writeFile(output, await appendMacIntelFeed(await fs.readFile(published, "utf8"), await fs.readFile(intel, "utf8"), releaseFolder, version));
console.log("Intel entries added to", output);

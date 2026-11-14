import { mergeUpdateFeeds } from "./merge-update-feeds.mjs";
const [root, output, version, ...flags] = process.argv.slice(2);
if (!root || !output || !version)
  throw Error("Usage: assemble-update-feeds.mjs inputs output version");
// --without-mac-intel: release-macos-intel.yml appends Intel after publication.
console.log(await mergeUpdateFeeds(root, output, version, { macIntel: !flags.includes("--without-mac-intel") }));

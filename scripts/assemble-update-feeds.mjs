import { mergeUpdateFeeds } from "./merge-update-feeds.mjs";
const [root, output, version] = process.argv.slice(2);
if (!root || !output || !version)
  throw Error("Usage: assemble-update-feeds.mjs inputs output version");
console.log(await mergeUpdateFeeds(root, output, version));

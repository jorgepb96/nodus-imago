import sharp from "sharp";
import fs from "node:fs/promises";
await fs.mkdir("build", { recursive: true });
const light = await fs.readFile("build/icon-light.svg", "utf8");
await fs.writeFile("build/icon.svg", light);
await sharp(Buffer.from(light)).png().toFile("build/icon.png");
const dark = await fs.readFile("build/icon-dark.svg", "utf8");
await sharp(Buffer.from(dark)).png().toFile("build/icon-dark.png");
console.log("Generated light and dark app icons.");

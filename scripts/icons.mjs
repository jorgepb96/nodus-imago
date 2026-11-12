import sharp from "sharp";
import fs from "node:fs/promises";
await fs.mkdir("build", { recursive: true });
const light = await fs.readFile("build/icon-light.svg", "utf8");
await fs.writeFile("build/icon.svg", light);
await sharp(Buffer.from(light)).png().toFile("build/icon.png");
const dark = await fs.readFile("build/icon-dark.svg", "utf8");
await sharp(Buffer.from(dark)).png().toFile("build/icon-dark.png");
// The installed application and Dock keep their square tile. The window uses
// the same lens artwork, with no tile or halo outside the circular objective.
const defsEnd = light.indexOf("</defs>") + "</defs>".length;
const lensStart = light.indexOf("<!-- barrel -->");
if (defsEnd < "</defs>".length || lensStart < defsEnd)
  throw new Error("No se ha encontrado el objetivo en el icono original.");
const mark = (light.slice(0, defsEnd) + "\n" + light.slice(lensStart)).replace(
  'viewBox="0 0 1024 1024"',
  'viewBox="128 128 768 768"',
);
await fs.writeFile("build/icon-mark.svg", mark);
await sharp(Buffer.from(mark)).png().toFile("build/icon-mark.png");
console.log("Generated square app/Dock tiles and transparent window mark.");

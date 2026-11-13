import fs from "node:fs";
import path from "node:path";
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const inventory = [],
  texts = [];
for (const [directory, entry] of Object.entries(lock.packages)) {
  if (!directory || entry.dev || !fs.existsSync(directory)) continue;
  const pkg = JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  const licenseFiles = fs
    .readdirSync(directory)
    .filter(
      (file) =>
        /^(licen[sc]e|copying|notice)(\.|$)/i.test(file) &&
        fs.statSync(path.join(directory, file)).isFile(),
    );
  if (!licenseFiles.length && fs.existsSync(path.join(directory, "README.md")))
    licenseFiles.push("README.md");
  inventory.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    repository: pkg.repository,
    licenseFiles,
  });
  texts.push(
    `\n${"=".repeat(72)}\n${pkg.name} ${pkg.version} — ${JSON.stringify(pkg.license)}\n${JSON.stringify(pkg.repository ?? pkg.homepage ?? "")}\n`,
  );
  for (const file of licenseFiles)
    texts.push(
      `\n--- ${file} ---\n${fs.readFileSync(path.join(directory, file), "utf8").replace(/\r\n/g, "\n")}\n`,
    );
}
inventory.sort((a, b) => a.name.localeCompare(b.name));
fs.mkdirSync("legal", { recursive: true });
fs.writeFileSync(
  "legal/dependency-inventory.json",
  JSON.stringify(inventory, null, 2) + "\n",
);
fs.writeFileSync("legal/THIRD_PARTY_LICENSES.txt", texts.join("").replace(/[ \t]+$/gm, ""));
console.log(
  `License inventory: ${inventory.length} installed production packages.`,
);

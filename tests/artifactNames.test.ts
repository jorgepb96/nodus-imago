// The installers' file names are part of the README download links
// ("releases/latest/download/…"), so they must not carry the version or the
// product name. This ties the electron-builder template to those links.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { updateArtifactArchitecture } from "../shared/updateArtifacts.mjs";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require("../build/electron-builder.cjs");

const name = (os: string, arch: string, ext: string) =>
  String(config.artifactName).replace("${os}", os).replace("${arch}", arch).replace("${ext}", ext);

test("installer names have no version, so the README links keep working", () => {
  assert.doesNotMatch(config.artifactName, /\$\{(version|productName)\}/);
  const installers = [
    name("mac", "arm64", "dmg"),
    name("mac", "x64", "dmg"),
    name("win", "x64", "exe"),
    name("linux", updateArtifactArchitecture("linux", "x64", "deb"), "deb"),
    name("linux", updateArtifactArchitecture("linux", "x64", "rpm"), "rpm"),
    name("linux", updateArtifactArchitecture("linux", "x64", "AppImage"), "AppImage"),
  ];
  assert.deepEqual(installers, [
    "Nodus-Imago-mac-arm64.dmg",
    "Nodus-Imago-mac-x64.dmg",
    "Nodus-Imago-win-x64.exe",
    "Nodus-Imago-linux-amd64.deb",
    "Nodus-Imago-linux-x86_64.rpm",
    "Nodus-Imago-linux-x86_64.AppImage",
  ]);
  const readme = fs.readFileSync("README.md", "utf8");
  for (const file of installers)
    if (readme.includes("releases/latest/download/"))
      assert.ok(readme.includes(`releases/latest/download/${file}`), `README links ${file}`);
});

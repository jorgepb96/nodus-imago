import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function files(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(full)
      : entry.name.endsWith(".tsx")
        ? [full]
        : [];
  });
}

test("every visible t() literal has an English translation", () => {
  const used = new Set<string>();
  for (const file of files("src")) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*(["'])(.*?)\1/gs)) {
      if (!match[2].includes("\n") && !match[2].includes("${"))
        used.add(match[2]);
    }
  }
  const dictionary = fs.readFileSync("src/i18n.tsx", "utf8"),
    translated = new Set<string>();
  for (const match of dictionary.matchAll(
    /^\s*(?:"(.*?)"|'(.*?)'|([\p{L}_$][\p{L}\p{N}_$]*))\s*:/gmu,
  ))
    translated.add(
      [match[1], match[2], match[3]].find((value) => value !== undefined)!,
    );
  assert.deepEqual(
    [...used].filter((key) => !translated.has(key)).sort(),
    [],
  );
});

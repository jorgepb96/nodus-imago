import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { translate } from "../src/i18n";

function files(directory: string, pattern: RegExp): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(full, pattern)
      : pattern.test(entry.name)
        ? [full]
        : [];
  });
}
const parse = (file: string) =>
  ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
/** Text a Spanish speaker wrote: accents, ñ, ¿¡ or common function words. */
const SPANISH =
  /[áéíóúñ¿¡]|\b(de|del|la|las|los|el|con|para|por|una|un|que|sin|más|se|su|sus|al|es|en|no|ya|lo|y)\b/i;
const english = (text: string) => translate(text, "en") !== text;
const walk = (node: ts.Node, visit: (node: ts.Node) => void) => {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
};
const inT = (node: ts.Node) => {
  for (let n = node.parent, depth = 0; n && depth < 6; n = n.parent, depth++) {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      ["t", "tx"].includes(n.expression.text)
    )
      return true;
    if (ts.isJsxElement(n) || ts.isBlock(n) || ts.isSourceFile(n)) return false;
  }
  return false;
};

test("every visible t() literal has an English translation", () => {
  const missing = new Set<string>();
  for (const file of files("src", /\.tsx$/)) {
    walk(parse(file), (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "t"
      )
        walk(node.arguments[0], (arg) => {
          if (
            (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) &&
            SPANISH.test(arg.text) &&
            !english(arg.text)
          )
            missing.add(arg.text);
        });
    });
  }
  assert.deepEqual([...missing].sort(), []);
});

test("no interface text is written outside t()", () => {
  // Names that are the same in every language.
  // The language screen speaks both languages until one is chosen.
  const allowed = new Set([
    "Español",
    "Nodus Imago",
    "Elige tu idioma · Choose your language",
    "Puedes cambiarlo cuando quieras en Ajustes. · You can change it at any time in Settings.",
  ]);
  const found: string[] = [];
  for (const file of files("src", /\.tsx$/)) {
    const source = parse(file);
    walk(source, (node) => {
      let text: string | null = null;
      if (ts.isJsxText(node)) text = node.text.replace(/\s+/g, " ").trim();
      else if (
        ts.isJsxAttribute(node) &&
        ["title", "placeholder", "aria-label", "alt", "label"].includes(
          node.name.getText(),
        ) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer)
      )
        text = node.initializer.text;
      if (
        text &&
        /[A-Za-zÁÉÍÓÚáéíóúñ]{3}/.test(text) &&
        SPANISH.test(text) &&
        !allowed.has(text) &&
        !inT(node)
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${file}:${line + 1} ${text}`);
      }
    });
  }
  assert.deepEqual(found, []);
});

test("messages from the main process and shared code have English", () => {
  const missing = new Set<string>();
  const check = (text: string) => {
    if (SPANISH.test(text) && !english(text)) missing.add(text);
  };
  for (const file of [
    ...files("electron", /\.ts$/),
    ...files("shared", /\.ts$/),
  ]) {
    walk(parse(file), (node) => {
      // Error("…"), new ApiFailure("…"), and message/label fields shown as-is.
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        /^(Error|ApiFailure|TypeError)$/.test(node.expression.getText()) &&
        node.arguments?.length
      ) {
        const arg = node.arguments[0];
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
          check(arg.text);
        else if (ts.isTemplateExpression(arg)) {
          // A message with variable parts needs a pattern: try it with "X".
          let sample = arg.head.text;
          for (const span of arg.templateSpans) sample += "X" + span.literal.text;
          check(sample);
        }
      }
      if (
        ts.isPropertyAssignment(node) &&
        ["message", "label"].includes(node.name.getText()) &&
        (ts.isStringLiteral(node.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(node.initializer))
      )
        check(node.initializer.text);
    });
  }
  assert.deepEqual([...missing].sort(), []);
});

test("toasts and labels that are translated when shown have English", () => {
  const missing = new Set<string>();
  for (const file of files("src", /\.tsx$/)) {
    walk(parse(file), (node) => {
      // notify("…"), perform(work, "…") and label/name/state maps rendered via t().
      let candidate: ts.Node | undefined;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === "notify") candidate = node.arguments[0];
        if (node.expression.text === "perform") candidate = node.arguments[1];
      }
      if (
        ts.isPropertyAssignment(node) &&
        ["label", "name", "group"].includes(node.name.getText())
      )
        candidate = node.initializer;
      if (
        candidate &&
        (ts.isStringLiteral(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) &&
        SPANISH.test(candidate.text) &&
        !english(candidate.text)
      )
        missing.add(candidate.text);
    });
  }
  assert.deepEqual([...missing].sort(), []);
});

test("every property type has an English name", async () => {
  const { COLUMN_TYPES } = await import("../shared/databases");
  // A label without accents ("Texto (heredado)") escapes the heuristics above.
  assert.deepEqual(
    COLUMN_TYPES.filter((c) => translate(c.label, "en") === c.label && !["URL", "Email", "Rollup"].includes(c.label)).map((c) => c.label),
    [],
  );
});

test("model catalogue names and licences shown in Settings have English", () => {
  const SPANISH_WORD = /[áéíóúñ]|\b(de|del|para|con|texto|imagen|motor|visión|condición)\b/i;
  const entries = ["shared/modelCatalog.json", "shared/runtimeCatalog.json", "shared/embeddingOnnxCatalog.json"].flatMap((file) => {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return (Array.isArray(data) ? data : [data]).flatMap((m: { label?: string; license?: string }) => [m.label ?? "", m.license ?? ""]);
  });
  assert.deepEqual(entries.filter((v) => SPANISH_WORD.test(v) && !english(v)), []);
});

test("messages with variable parts are translated by pattern", () => {
  assert.equal(
    translate("La opción «Sevilla» está en uso. Reasigna sus registros antes de eliminarla.", "en"),
    "The option “Sevilla” is in use. Reassign its records before deleting it.",
  );
  assert.equal(translate("Indexación automática", "es"), "Indexación automática");
  assert.equal(translate("Indexación automática", "en"), "Automatic indexing");
});

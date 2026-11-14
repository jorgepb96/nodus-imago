// Icon-only controls must say what they do: the tooltip layer
// (src/tooltips.ts) shows their aria-label or title, translated by t().
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".tsx") ? [path.join(dir, e.name)] : [],
  );
const NOT_ICONS = new Set(["Thumbnail", "Spinner", "ImagoMark", "Cell", "OptionPicker"]);

test("every icon-only button has an aria-label or title for its tooltip", () => {
  const missing: string[] = [];
  for (const file of files("src")) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName.getText();
        if (["button", "Button", "summary", "a"].includes(tag)) {
          const attributes = node.openingElement.attributes.properties.map((p) => p.name?.getText());
          const children = node.children.filter((c) => !(ts.isJsxText(c) && !c.text.trim()));
          const iconOnly =
            children.length > 0 &&
            children.every(
              (c) =>
                ts.isJsxSelfClosingElement(c) &&
                /^[A-Z]/.test(c.tagName.getText()) &&
                !NOT_ICONS.has(c.tagName.getText()),
            );
          const spread = attributes.includes(undefined);
          if (iconOnly && !spread && !attributes.includes("aria-label") && !attributes.includes("title")) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart());
            missing.push(`${file}:${line + 1}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(missing, []);
});

test("the tooltip layer is installed at startup", () => {
  assert.match(fs.readFileSync("src/main.tsx", "utf8"), /installTooltips\(\)/);
});

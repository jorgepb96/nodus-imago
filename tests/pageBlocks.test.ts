import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownBlocks } from "../shared/pageBlocks";
test("Notion blocks preserve nested tasks, quotes, tables and inline media without executing HTML", () => {
  const text =
    "# Archivo\n\n- [x] Revisado\n  - Hijo **marcado**\n\n> Una cita\n>\n> - Fuente\n\n| Autor | Año |\n| --- | --- |\n| Ana | 1950 |\n\n![Foto](images/foto.png)\n\n<script>alert(1)</script>";
  const blocks = markdownBlocks(text),
    flat = (items: typeof blocks): typeof blocks =>
      items.flatMap((b) => [b, ...flat(b.children)]),
    all = flat(blocks);
  assert.ok(
    all.some((b) => b.type === "list_item" && b.attributes.checked === true),
  );
  assert.ok(all.some((b) => b.type === "strong" && b.text === "marcado"));
  assert.ok(all.some((b) => b.type === "table_cell" && b.text === "1950"));
  assert.ok(
    all.some(
      (b) => b.type === "image" && b.attributes.href === "images/foto.png",
    ),
  );
  assert.ok(all.some((b) => b.type === "html" && b.raw.includes("<script>")));
  assert.equal(new Set(all.map((b) => b.id)).size, all.length);
});

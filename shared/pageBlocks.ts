import { Lexer, type Token } from "marked";
export interface PageBlock {
  id: string;
  type: string;
  text: string;
  raw: string;
  attributes: Record<string, unknown>;
  children: PageBlock[];
}
export interface PageDocument {
  format: "imago.blocks/1";
  sourceMarkdown: string;
  importedMarkdown: string | null;
  blocks: PageBlock[];
}

// Notion ZIP exports represent their actual block nesting in Markdown. Preserve
// that hierarchy, inline tokens, tables, media references and unknown raw blocks.
// No imported HTML is executed and no external media is downloaded here.
export function markdownBlocks(source: string): PageBlock[] {
  if (source.length > 10 * 2 ** 20) throw Error("Documento demasiado grande.");
  let count = 0;
  const convert = (
    tokens: Token[],
    parent: string,
    depth: number,
  ): PageBlock[] => {
    if (depth > 64) throw Error("Demasiados niveles de bloques.");
    return tokens
      .filter((t) => t.type !== "space")
      .map((token, index) => {
        if (++count > 20000) throw Error("Demasiados bloques.");
        const t = token as any,
          id = `${parent}${index}`,
          attributes: Record<string, unknown> = {};
        for (const key of [
          "depth",
          "ordered",
          "start",
          "task",
          "checked",
          "lang",
          "href",
          "title",
          "align",
        ])
          if (t[key] !== undefined) attributes[key] = t[key];
        let children: PageBlock[] = [];
        if (t.type === "list") children = convert(t.items, id + ".", depth + 1);
        else if (t.type === "table")
          children = [t.header, ...t.rows].map((row: any[], i: number) => ({
            id: id + ".row" + i,
            type: "table_row",
            text: "",
            raw: "",
            attributes: { header: i === 0 },
            children: row.map((cell: any, j: number) => ({
              id: id + ".row" + i + "." + j,
              type: "table_cell",
              text: cell.text ?? "",
              raw: cell.text ?? "",
              attributes: {},
              children: convert(
                cell.tokens ?? [],
                id + "." + i + "." + j + ".",
                depth + 2,
              ),
            })),
          }));
        else if (Array.isArray(t.tokens))
          children = convert(t.tokens, id + ".", depth + 1);
        return {
          id,
          type: t.type,
          text: typeof t.text === "string" ? t.text : "",
          raw: t.raw ?? "",
          attributes,
          children,
        };
      });
  };
  return convert(Lexer.lex(source, { gfm: true }), "b.", 0);
}

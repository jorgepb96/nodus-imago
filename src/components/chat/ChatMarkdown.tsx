// Markdown of chat answers: headings, lists, tables, quotes and code, built
// as React elements from marked's tokens. Raw HTML is shown as text, never
// interpreted, and only HTTPS links open (in the system browser).
import { memo, type ReactNode } from "react";
import { Lexer, type Token, type Tokens } from "marked";
import { externalHttpsUrl } from "../../../shared/externalLinks";

function inline(tokens: Token[] | undefined, key: string): ReactNode[] {
  return (tokens ?? []).map((token, i) => {
    const k = `${key}.${i}`;
    switch (token.type) {
      case "strong":
        return <strong key={k}>{inline((token as Tokens.Strong).tokens, k)}</strong>;
      case "em":
        return <em key={k}>{inline((token as Tokens.Em).tokens, k)}</em>;
      case "del":
        return <del key={k}>{inline((token as Tokens.Del).tokens, k)}</del>;
      case "codespan":
        return <code key={k}>{(token as Tokens.Codespan).text}</code>;
      case "br":
        return <br key={k} />;
      case "link": {
        const link = token as Tokens.Link,
          href = externalHttpsUrl(link.href);
        return href ? (
          <a
            key={k}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              void window.imago.call("openExternalLink", { url: href }).catch(() => {});
            }}
          >
            {inline(link.tokens, k)}
          </a>
        ) : (
          <span key={k}>{inline(link.tokens, k)}</span>
        );
      }
      case "text": {
        const text = token as Tokens.Text;
        return text.tokens ? <span key={k}>{inline(text.tokens, k)}</span> : text.text;
      }
      case "escape":
        return (token as Tokens.Escape).text;
      default:
        return "raw" in token ? String(token.raw) : "";
    }
  });
}

function block(token: Token, key: string): ReactNode {
  switch (token.type) {
    case "space":
      return null;
    case "heading": {
      const heading = token as Tokens.Heading;
      const Tag = (["h3", "h3", "h4", "h5", "h6", "h6"] as const)[heading.depth - 1] ?? "h6";
      return <Tag key={key}>{inline(heading.tokens, key)}</Tag>;
    }
    case "paragraph":
      return <p key={key}>{inline((token as Tokens.Paragraph).tokens, key)}</p>;
    case "text": {
      const text = token as Tokens.Text;
      return <p key={key}>{text.tokens ? inline(text.tokens, key) : text.text}</p>;
    }
    case "list": {
      const list = token as Tokens.List;
      const items = list.items.map((item, i) => (
        <li key={`${key}.${i}`}>
          {item.task && <input type="checkbox" checked={!!item.checked} readOnly disabled />}
          {item.tokens.map((child, j) =>
            child.type === "text" && !list.loose
              ? inline((child as Tokens.Text).tokens ?? [child], `${key}.${i}.${j}`)
              : block(child, `${key}.${i}.${j}`),
          )}
        </li>
      ));
      return list.ordered ? (
        <ol key={key} start={typeof list.start === "number" ? list.start : undefined}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case "blockquote":
      return <blockquote key={key}>{(token as Tokens.Blockquote).tokens.map((t, i) => block(t, `${key}.${i}`))}</blockquote>;
    case "code":
      return (
        <pre key={key}>
          <code>{(token as Tokens.Code).text}</code>
        </pre>
      );
    case "hr":
      return <hr key={key} />;
    case "table": {
      const table = token as Tokens.Table;
      const align = (i: number) => table.align[i] ?? undefined;
      return (
        <div key={key} className="chat-table">
          <table>
            <thead>
              <tr>
                {table.header.map((cell, i) => (
                  <th key={i} style={{ textAlign: align(i) }}>
                    {inline(cell.tokens, `${key}.h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} style={{ textAlign: align(i) }}>
                      {inline(cell.tokens, `${key}.${r}.${i}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      return "raw" in token && String(token.raw).trim() ? <p key={key}>{String(token.raw)}</p> : null;
  }
}

export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  let tokens: Token[];
  try {
    tokens = Lexer.lex(text, { gfm: true });
  } catch {
    return <p>{text}</p>;
  }
  return <div className="chat-markdown">{tokens.map((token, i) => block(token, String(i)))}</div>;
});

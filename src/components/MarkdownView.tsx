import type { ReactNode } from "react";
import { externalHttpsUrl } from "../../shared/externalLinks";

function safeHref(value: string): string | null {
  const href = value.trim();
  return externalHttpsUrl(href);
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0,
    match: RegExpExecArray | null,
    index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0],
      key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**"))
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`"))
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? [];
      const safe = href ? safeHref(href) : null;
      nodes.push(
        safe ? (
          <a
            key={key}
            href={safe}
            onClick={(event) => {
              event.preventDefault();
              void window.imago
                .call("openExternalLink", { url: safe })
                .catch(() => {});
            }}
          >
            {label}
          </a>
        ) : (
          match[0]
        ),
      );
    } else nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** Small, safe Markdown preview used by rich-text cells. Raw HTML is never
 * interpreted; only the formatting the editor itself can insert is rendered. */
export function MarkdownView({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n"),
    nodes: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    const items = list;
    list = [];
    nodes.push(
      <ul key={`list-${nodes.length}`}>
        {items.map((item, index) => (
          <li key={index}>{inline(item, `li-${nodes.length}-${index}`)}</li>
        ))}
      </ul>,
    );
  };
  lines.forEach((line, index) => {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flush();
    if (!line.trim())
      nodes.push(<div className="markdown-gap" key={`gap-${index}`} />);
    else if (heading) {
      const Tag = `h${heading[1].length + 2}` as "h3" | "h4" | "h5";
      nodes.push(
        <Tag key={`h-${index}`}>{inline(heading[2], `h-${index}`)}</Tag>,
      );
    } else nodes.push(<p key={`p-${index}`}>{inline(line, `p-${index}`)}</p>);
  });
  flush();
  return (
    <div className="markdown-view">
      {nodes.length ? nodes : <p className="muted">—</p>}
    </div>
  );
}

import { useState } from "react";
import type { PageBlock, PageDocument } from "../../shared/pageBlocks";
import { useT } from "../i18n";
function Branch({ blocks }: { blocks: PageBlock[] }) {
  return (
    <ol>
      {blocks.map((b) => (
        <li key={b.id}>
          <span className="muted">{b.type}</span> {b.text.slice(0, 160)}
          {!!b.children.length && <Branch blocks={b.children} />}
        </li>
      ))}
    </ol>
  );
}
export function BlockOutline({
  rowId,
  columnId,
}: {
  rowId: string;
  columnId: string;
}) {
  const t = useT(),
    [document, setDocument] = useState<PageDocument | null>(null),
    [error, setError] = useState("");
  return (
    <details
      className="block-outline"
      onToggle={(e) => {
        if (e.currentTarget.open)
          void window.imago
            .call("pageDocument", { rowId, columnId })
            .then(setDocument, (e) => setError(String(e)));
      }}
    >
      <summary>{t("Árbol de bloques")}</summary>
      {error && <p role="alert">{error}</p>}
      {document && (
        <>
          <Branch blocks={document.blocks} />
          {document.importedMarkdown !== null && (
            <details>
              <summary>{t("Original importado")}</summary>
              <pre>{document.importedMarkdown}</pre>
            </details>
          )}
        </>
      )}
    </details>
  );
}

// The facts of a record, as the record panel lists them and in its order:
// a source's records, the properties (in the table's column order, hidden
// ones folded), the linked records, where the AI proposals came from, the
// image's EXIF metadata and the record's id. Shared by the record panel and
// the record preview opened from «Buscar», so both show the same data.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { DatabaseColumn, DatabaseDetail } from "../../shared/databases";
import type { Provenance, RecordRow } from "../../shared/imago";
import { Button } from "./ui";
import { Cell } from "./Cell";
import { LinkedRecords } from "./RelationTools";
import { BlockOutline } from "./BlockOutline";
import type { Perform } from "./Properties";
import { useT } from "../i18n";

function RelationEditor({
  row,
  column,
  perform,
  onChanged,
}: {
  row: RecordRow;
  column: DatabaseColumn;
  perform: Perform;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState(""),
    [choices, setChoices] = useState<RecordRow[]>([]),
    t = useT();
  const selected: string[] = (() => {
    try {
      return JSON.parse(row.cells[column.id] ?? "[]");
    } catch {
      return [];
    }
  })();
  return (
    <div className="stack">
      <div className="row">
        <input
          value={query}
          aria-label={column.name}
          placeholder={t("Buscar")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          onClick={() =>
            void perform(async () =>
              setChoices(
                (
                  await window.imago.call("search", {
                    databaseIds: column.config.relationTargetDatabaseId
                      ? [column.config.relationTargetDatabaseId]
                      : undefined,
                    query,
                    limit: 100,
                  })
                ).rows,
              ),
            )
          }
        >
          {t("Buscar")}
        </Button>
      </div>
      {selected
        .filter((id) => !choices.some((c) => c.id === id))
        .map((id) => (
          <div className="row" key={id}>
            <span className="mono">{id}</span>
            <Button
              icon
              aria-label={t("Eliminar")}
              onClick={() =>
                void perform(async () => {
                  await window.imago.call("setCell", {
                    rowId: row.id,
                    columnId: column.id,
                    value: JSON.stringify(selected.filter((v) => v !== id)),
                  });
                  onChanged();
                })
              }
            >
              <X size={13} />
            </Button>
          </div>
        ))}
      <div className="relation-choices">
        {choices.map((c) => (
          <label className="check-label" key={c.id}>
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={() =>
                void perform(async () => {
                  const next = selected.includes(c.id)
                    ? selected.filter((id) => id !== c.id)
                    : column.config.relationCardinality === "one"
                      ? [c.id]
                      : [...selected, c.id];
                  await window.imago.call("setCell", {
                    rowId: row.id,
                    columnId: column.id,
                    value: JSON.stringify(next),
                  });
                  onChanged();
                })
              }
            />
            {c.title}
            <small className="muted">{c.databaseName}</small>
          </label>
        ))}
      </div>
    </div>
  );
}

export function RecordFacts({
  row,
  detail,
  image,
  hidden = [],
  perform,
  onChanged,
  onOpenRecord,
}: {
  row: RecordRow;
  detail: DatabaseDetail;
  /** The image shown: its EXIF metadata is listed last. */
  image?: RecordRow["images"][number];
  /** Properties hidden in the table: listed apart, folded, after the rest. */
  hidden?: string[];
  perform: Perform;
  onChanged: () => void;
  onOpenRecord?: (rowId: string) => void;
}) {
  const t = useT(),
    [provenance, setProvenance] = useState<Provenance[]>([]);
  useEffect(() => {
    let cancelled = false;
    void window.imago
      .call("provenance", { rowId: row.id })
      .then((items) => {
        if (!cancelled) setProvenance(items);
      })
      .catch(() => {
        if (!cancelled) setProvenance([]);
      });
    return () => {
      cancelled = true;
    };
  }, [row.id]);
  // Same order as the table (the database's column order) and the same
  // hidden properties, which stay reachable in a folded list.
  const hiddenSet = new Set(hidden);
  const properties = detail.columns.filter(
    (c) => !["attachment", "files"].includes(c.type),
  );
  const shownProperties = properties.filter(
    (c) => c.type === "title" || !hiddenSet.has(c.id),
  );
  const hiddenProperties = properties.filter(
    (c) => c.type !== "title" && hiddenSet.has(c.id),
  );
  const property = (c: DatabaseColumn) => (
    <div className="record-property" key={c.id} data-tour={`record-prop-${c.type}`}>
      <label>{c.name}</label>
      <div>
        {c.type === "relation" ? (
          <RelationEditor
            row={row}
            column={c}
            perform={perform}
            onChanged={onChanged}
          />
        ) : (
          <Cell
            column={c}
            value={row.cells[c.id] ?? null}
            onSave={(v) =>
              perform(async () => {
                await window.imago.call("setCell", {
                  rowId: row.id,
                  columnId: c.id,
                  value: v,
                });
                onChanged();
              })
            }
          />
        )}
        {c.type === "rich_text" && (
          <BlockOutline rowId={row.id} columnId={c.id} />
        )}
      </div>
    </div>
  );
  return (
    <>
      {/* A source's records (a book's photographs) come first. */}
      {detail.database.kind === "sources" && <LinkedRecords row={row} onOpenRecord={onOpenRecord} />}
      <h2>{t("Propiedades")}</h2>
      <div className="record-properties" data-tour="record-properties">
        {shownProperties.map(property)}
      </div>
      {!!hiddenProperties.length && (
        <details className="record-hidden-properties">
          <summary>
            {hiddenProperties.length === 1
              ? t("1 propiedad oculta")
              : `${hiddenProperties.length} ${t("propiedades ocultas")}`}
          </summary>
          <div className="record-properties">
            {hiddenProperties.map(property)}
          </div>
        </details>
      )}
      {detail.database.kind !== "sources" && <LinkedRecords row={row} onOpenRecord={onOpenRecord} />}
      {!!provenance.length && (
        <details className="metadata provenance">
          <summary>{t("Procedencia de las propuestas")}</summary>
          {provenance.map((p) => {
            const column = detail.columns.find((c) => c.id === p.columnId);
            let shown = p.value ?? "—";
            if (column?.type === "multi_select") {
              try {
                shown =
                  (JSON.parse(p.value ?? "[]") as string[])
                    .map(
                      (id) =>
                        column.options.find((o) => o.id === id)?.label ??
                        id,
                    )
                    .join(", ") || "—";
              } catch {
                /* keep the stored value */
              }
            } else if (column && ["select", "status"].includes(column.type))
              shown =
                column.options.find((o) => o.id === p.value)?.label ??
                p.value ??
                "—";
            return (
              <div className="provenance-entry" key={p.id}>
                <div className="row">
                  <strong>{p.columnName}</strong>
                  <span className={"badge " + p.state}>
                    {p.state === "accepted"
                      ? t("Aceptada")
                      : p.state === "rejected"
                        ? t("Rechazada")
                        : t("Pendiente")}
                  </span>
                </div>
                <p>{shown}</p>
                <small className="muted">
                  {p.model} · {p.revision.slice(0, 12)} ·{" "}
                  {new Date(p.createdAt).toLocaleString()}
                </small>
                {p.prompt && (
                  <details>
                    <summary>{t("Instrucciones")}</summary>
                    <p className="hint">{p.prompt}</p>
                  </details>
                )}
              </div>
            );
          })}
        </details>
      )}
      {image && (
        <details className="metadata">
          <summary>{t("Metadatos · EXIF")}</summary>
          {Object.entries(image.metadata)
            .filter(([, v]) => v != null)
            .map(([k, v]) => (
              <div className="row" key={k}>
                <span>{k}</span>
                <span>
                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))}
          <p className="mono">SHA-256 · {image.contentHash}</p>
        </details>
      )}
      <p className="hint mono">{row.id}</p>
    </>
  );
}

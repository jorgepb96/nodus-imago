// The facts of a record, as the record panel lists them and in its order:
// a source's records, the properties (in the table's column order, hidden
// ones folded), the linked records, where the AI proposals came from, the
// image's EXIF metadata and the record's id. Shared by the record panel and
// the record preview opened from «Buscar», so both show the same data.
import { useEffect, useState } from "react";
import { Pencil, Plus, Search, X } from "lucide-react";
import { relationHasPlace, type DatabaseColumn, type DatabaseDetail } from "../../shared/databases";
import type { Provenance, RecordRow } from "../../shared/imago";
import { Button } from "./ui";
import { Cell } from "./Cell";
import { LinkDetailsForm, LinkedRecords, linkSummary } from "./RelationTools";
import { BlockOutline } from "./BlockOutline";
import type { Perform } from "./Properties";
import { useT } from "../i18n";

/**
 * A relation in the record panel: the linked records by title, each with what
 * its link records (page, figure, caption, note) and a pencil to edit it; a
 * search that finds as you type, and a new record created from the search
 * when none matches.
 */
function RelationEditor({
  row,
  detail,
  column,
  perform,
  onChanged,
  onOpenRecord,
}: {
  row: RecordRow;
  detail: DatabaseDetail;
  column: DatabaseColumn;
  perform: Perform;
  onChanged: () => void;
  onOpenRecord?: (rowId: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [choices, setChoices] = useState<RecordRow[]>([]),
    [target, setTarget] = useState<DatabaseDetail | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    t = useT();
  const targetId = column.config.relationTargetDatabaseId as string | undefined;
  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    void window.imago
      .call("detail", { id: targetId })
      .then((d) => !cancelled && setTarget(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [targetId]);
  const links = row.links?.[column.id] ?? [];
  const selected = links.map((l) => l.id);
  const place = relationHasPlace(column, detail.database.kind, target?.database.kind);
  // Finds as you type, in the related database.
  useEffect(() => {
    const text = query.trim();
    if (!text) return setChoices([]);
    let cancelled = false;
    const timer = setTimeout(() => {
      void window.imago
        .call("search", { databaseIds: targetId ? [targetId] : undefined, query: text, mode: "literal", match: "partial", limit: 30 })
        .then((page) => !cancelled && setChoices(page.rows))
        .catch(() => !cancelled && setChoices([]));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, targetId]);
  const save = (ids: string[]) =>
    perform(async () => {
      await window.imago.call("setCell", { rowId: row.id, columnId: column.id, value: JSON.stringify(ids) });
      onChanged();
    });
  const add = (id: string) => {
    setQuery("");
    setChoices([]);
    return save(column.config.relationCardinality === "one" ? [id] : [...selected.filter((x) => x !== id), id]);
  };
  const titleColumn = target?.columns.find((c) => c.type === "title");
  const text = query.trim();
  const exact = choices.some((c) => c.title.trim().toLocaleLowerCase() === text.toLocaleLowerCase());
  const create = () =>
    target &&
    titleColumn &&
    void perform(async () => {
      const created = await window.imago.call("createRow", { databaseId: target.database.id });
      await window.imago.call("setCell", { rowId: created.id, columnId: titleColumn.id, value: text });
      await add(created.id);
    });
  return (
    <div className="relation-editor" data-testid="relation-editor">
      {!!links.length && (
        <ul className="relation-links">
          {links.map((l) => {
            const summary = linkSummary(l);
            return (
              <li key={l.id} className="relation-link" data-testid="relation-link">
                <div className="relation-link-row">
                  <button type="button" className="relation-link-title" onClick={() => onOpenRecord?.(l.id)} title={t("Abrir registro")}>
                    {l.title}
                  </button>
                  <Button
                    icon
                    data-testid="relation-link-edit"
                    aria-label={`${t(place ? "Página, pie y nota de" : "Nota de")} ${l.title}`}
                    data-tooltip={t(place ? "Página, figura, pie de foto y nota de este vínculo" : "Nota de este vínculo")}
                    onClick={() => setEditing(editing === l.id ? null : l.id)}
                  >
                    <Pencil size={12} />
                  </Button>
                  <Button
                    icon
                    aria-label={`${t("Quitar")} ${l.title}`}
                    data-tooltip={t("Quitar el vínculo")}
                    onClick={() => void save(selected.filter((v) => v !== l.id))}
                  >
                    <X size={13} />
                  </Button>
                </div>
                {summary && editing !== l.id && <small className="relation-link-details">{summary}</small>}
                {editing === l.id && (
                  <LinkDetailsForm
                    rowId={row.id}
                    columnId={column.id}
                    targetId={l.id}
                    details={l}
                    place={place}
                    perform={perform}
                    onDone={(saved) => {
                      setEditing(null);
                      if (saved) onChanged();
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(column.config.relationCardinality !== "one" || !links.length || text) && (
        <label className="relation-search">
          <Search size={13} />
          <input
            value={query}
            aria-label={column.name}
            placeholder={target ? t("Añadir de «{db}»…").replace("{db}", target.database.name) : t("Buscar")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
        </label>
      )}
      {!!text && (
        <div className="relation-choices">
          {choices
            .filter((c) => !selected.includes(c.id) && c.id !== row.id)
            .slice(0, 8)
            .map((c) => (
              <button key={c.id} type="button" className="relation-choice" data-testid="relation-choice" onClick={() => void add(c.id)}>
                <Plus size={13} />
                <span>{c.title}</span>
                {c.databaseName !== target?.database.name && <small className="muted">{c.databaseName}</small>}
              </button>
            ))}
          {!exact && titleColumn && (
            <button type="button" className="relation-choice is-new" data-testid="relation-create" onClick={create}>
              <Plus size={13} />
              <span>{t("Crear «{title}» en «{db}»").replace("{title}", text).replace("{db}", target!.database.name)}</span>
            </button>
          )}
        </div>
      )}
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
  onOptionsChanged = onChanged,
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
  /** A select property's options were edited from its cell (by default, the
   * same refresh as a changed value). */
  onOptionsChanged?: () => void;
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
            detail={detail}
            column={c}
            perform={perform}
            onChanged={onChanged}
            onOpenRecord={onOpenRecord}
          />
        ) : (
          <Cell
            column={c}
            value={row.cells[c.id] ?? null}
            onOptionsChanged={onOptionsChanged}
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
      {detail.database.kind === "sources" && <LinkedRecords row={row} onOpenRecord={onOpenRecord} perform={perform} />}
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
      {detail.database.kind !== "sources" && <LinkedRecords row={row} onOpenRecord={onOpenRecord} perform={perform} />}
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

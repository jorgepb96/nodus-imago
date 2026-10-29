import { useState, useEffect, useRef } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  ScanSearch,
  Star,
  Link2,
  MoveRight,
  Trash2,
} from "lucide-react";
import type { DatabaseColumn, DatabaseDetail } from "../../shared/databases";
import type { Provenance, RecordRow } from "../../shared/imago";
import { Button, Thumbnail } from "./ui";
import { Cell } from "./Cell";
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
export function RecordPanel({
  row,
  detail,
  onClose,
  onChanged,
  onSimilar,
  perform,
}: {
  row: RecordRow;
  detail: DatabaseDetail;
  onClose: () => void;
  onChanged: () => void;
  onSimilar: (id: string) => void;
  perform: Perform;
}) {
  const t = useT(),
    [imageIndex, setImageIndex] = useState(0),
    [provenance, setProvenance] = useState<Provenance[]>([]),
    [moving, setMoving] = useState(false),
    [query, setQuery] = useState(""),
    [targets, setTargets] = useState<RecordRow[]>([]);
  const dialog = useRef<HTMLDialogElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setImageIndex(0), [row.id]);
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
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    const listener = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    d.addEventListener("cancel", listener);
    return () => {
      d.removeEventListener("cancel", listener);
      d.close();
    };
  }, []);
  const image = row.images[Math.min(imageIndex, row.images.length - 1)];
  return (
    <dialog ref={dialog} className="record-overlay" aria-label={row.title}>
      <button
        className="record-shade"
        onClick={onClose}
        aria-label={t("Cerrar")}
      />
      <aside aria-label={row.title} className="record-panel">
        <header>
          <span>
            <span className="muted">{row.databaseName}</span>
            <strong>{row.title}</strong>
          </span>
          <Button icon aria-label={t("Cerrar")} onClick={onClose}>
            <X size={19} />
          </Button>
        </header>
        <div className="record-body">
          <Thumbnail
            id={image?.width ? image.id : undefined}
            large
            alt={row.title}
          />
          {image && (
            <>
              <div className="image-toolbar">
                <Button
                  icon
                  aria-label={t("Anterior")}
                  disabled={!imageIndex}
                  onClick={() => setImageIndex(imageIndex - 1)}
                >
                  <ChevronLeft size={16} />
                </Button>
                <span>
                  {imageIndex + 1} / {row.images.length}
                </span>
                <Button
                  icon
                  aria-label={t("Siguiente")}
                  disabled={imageIndex >= row.images.length - 1}
                  onClick={() => setImageIndex(imageIndex + 1)}
                >
                  <ChevronRight size={16} />
                </Button>
                <span className="spacer" />
                <Button
                  title={t("Marcar como principal")}
                  onClick={() =>
                    void perform(async () => {
                      await window.imago.call("setPrimary", { id: image.id });
                      setImageIndex(0);
                      onChanged();
                    })
                  }
                >
                  <Star
                    size={15}
                    fill={image.position === 0 ? "currentColor" : "none"}
                  />
                  {image.position === 0 ? t("Imagen principal") : ""}
                </Button>
              </div>
              <div className="image-meta">
                <strong>{image.fileName}</strong>
                <span>
                  {image.width} × {image.height} ·{" "}
                  {(image.bytes / 1e6).toFixed(2)} MB
                </span>
              </div>
              <div className="row wrap">
                <Button onClick={() => onSimilar(image.id)}>
                  <ScanSearch size={15} />
                  {t("Buscar imágenes similares")}
                </Button>
                <Button
                  onClick={() =>
                    void perform(async () => {
                      await window.imago.call("relinkImage", { id: image.id });
                      onChanged();
                    })
                  }
                >
                  <Link2 size={14} />
                  {t("Volver a vincular original")}
                </Button>
                <Button
                  icon
                  title={t("Registro")}
                  onClick={() => setMoving(!moving)}
                >
                  <MoveRight size={15} />
                </Button>
                <Button
                  icon
                  aria-label={t("Quitar del registro")}
                  title={t("Quitar del registro")}
                  onClick={() => {
                    if (
                      !window.confirm(
                        t(
                          "¿Quitar esta imagen del registro? El original no se elimina.",
                        ),
                      )
                    )
                      return;
                    void perform(async () => {
                      await window.imago.call("deleteImage", { id: image.id });
                      setImageIndex(0);
                      onChanged();
                    });
                  }}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
              {moving && (
                <div className="stack inset">
                  <div className="row">
                    <input
                      aria-label={t("Buscar")}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("Buscar") + " " + t("Registro")}
                    />
                    <Button
                      onClick={() =>
                        void perform(async () =>
                          setTargets(
                            (
                              await window.imago.call("search", {
                                databaseIds: [row.databaseId],
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
                  {targets
                    .filter((r) => r.id !== row.id)
                    .map((r) => (
                      <Button
                        key={r.id}
                        onClick={() =>
                          void perform(async () => {
                            await window.imago.call("reassignImage", {
                              id: image.id,
                              rowId: r.id,
                              columnId: image.columnId,
                            });
                            setMoving(false);
                            onChanged();
                          })
                        }
                      >
                        <MoveRight size={14} />
                        {r.title}
                      </Button>
                    ))}
                </div>
              )}
            </>
          )}
          <h2>{t("Propiedades")}</h2>
          <div className="record-properties">
            {detail.columns
              .filter((c) => !["attachment", "files"].includes(c.type))
              .map((c) => (
                <div className="record-property" key={c.id}>
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
                  </div>
                </div>
              ))}
          </div>
          {!!provenance.length && (
            <details className="metadata provenance">
              <summary>Procedencia de las propuestas</summary>
              {provenance.map((p) => {
                const column = detail.columns.find((c) => c.id === p.columnId);
                let shown = p.value ?? "—";
                if (column?.type === "multi_select") {
                  try {
                    shown =
                      (JSON.parse(p.value ?? "[]") as string[])
                        .map(
                          (id) =>
                            column.options.find((o) => o.id === id)?.label ?? id,
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
                        <summary>Instrucciones</summary>
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
              <summary>Metadatos · EXIF</summary>
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
        </div>
      </aside>
    </dialog>
  );
}

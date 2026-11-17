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
  Maximize2,
  SquareDashedMousePointer,
  Wand2,
  Quote,
  Check,
  RotateCcw,
  RotateCw,
  Crop,
  ImageOff,
} from "lucide-react";
import type { DatabaseColumn, DatabaseDetail } from "../../shared/databases";
import type { Provenance, RecordRow } from "../../shared/imago";
import { Button, Thumbnail } from "./ui";
import { Cell } from "./Cell";
import { BlockOutline } from "./BlockOutline";
import type { Perform } from "./Properties";
import { useT } from "../i18n";
import { validCrop } from "../../shared/imageRotation";
import { ImageViewer } from "./ImageViewer";
import { renderCitation } from "../../shared/citation";
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
  onRestore,
  onOpenRecord,
  onCompare,
  citation,
  perform,
  hidden = [],
}: {
  row: RecordRow;
  detail: DatabaseDetail;
  onClose: () => void;
  onChanged: () => void;
  onSimilar: (id: string) => void;
  /** Opens the restoration workshop with this image. */
  onRestore?: (assetId: string) => void;
  onOpenRecord?: (rowId: string) => void;
  onCompare?: (assetIds: string[]) => void;
  /** The database's citation template. */
  citation?: string;
  perform: Perform;
  /** Properties hidden in the table: listed apart, folded, after the rest. */
  hidden?: string[];
}) {
  const t = useT(),
    [imageIndex, setImageIndex] = useState(0),
    [viewer, setViewer] = useState<false | "view" | "crop">(false),
    [copied, setCopied] = useState(false),
    [provenance, setProvenance] = useState<Provenance[]>([]),
    [moving, setMoving] = useState(false),
    [bulkMove, setBulkMove] = useState(false),
    [query, setQuery] = useState(""),
    [targets, setTargets] = useState<RecordRow[]>([]);
  const dialog = useRef<HTMLDialogElement>(null),
    closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
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
  const regions = image ? (row.annotations ?? []).filter((a) => a.assetId === image.id).length : 0;
  /** A quarter turn kept with the image; its annotations turn with it. */
  const rotate = (id: string, direction: "left" | "right") =>
    void perform(async () => {
      await window.imago.call("rotateImage", { id, direction });
      onChanged();
    });
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
    <dialog ref={dialog} className="record-overlay" aria-label={row.title}>
      <button
        className="record-shade"
        onClick={onClose}
        aria-label={t("Cerrar")}
      />
      <aside aria-label={row.title} className="record-panel" data-tour="record-panel">
        <header>
          <span>
            <span className="muted">{row.databaseName}</span>
            <strong>{row.title}</strong>
          </span>
          {citation && (
            <Button
              data-testid="copy-citation"
              data-tour="record-citation"
              data-tooltip={renderCitation(citation, detail.columns, row)}
              onClick={() =>
                void navigator.clipboard.writeText(renderCitation(citation, detail.columns, row)).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? <Check size={14} /> : <Quote size={14} />}
              {t(copied ? "Cita copiada" : "Copiar cita")}
            </Button>
          )}
          <Button icon aria-label={t("Cerrar")} onClick={onClose}>
            <X size={19} />
          </Button>
        </header>
        <div className="record-body">
          <div className="record-image">
            <button
              type="button"
              className="record-image-open"
              disabled={!image?.width}
              aria-label={t("Ampliar y anotar")}
              data-testid="record-image-open"
              data-tour="record-image-open"
              onClick={() => setViewer("view")}
            >
              <Thumbnail
                id={image?.width ? image.id : undefined}
                revision={image?.revision}
                large
                alt={row.title}
              />
              {regions > 0 && (
                <span className="record-image-regions" data-tooltip={t("Zonas anotadas en esta imagen")}>
                  <SquareDashedMousePointer size={12} />
                  {regions}
                </span>
              )}
            </button>
            {image?.width ? (
              <div className="record-image-tools" data-tour="record-image-tools">
                <button
                  type="button"
                  className="record-image-turn"
                  aria-label={t("Girar a la izquierda")}
                  data-tooltip={t("Girar 90° a la izquierda. El original no se modifica.")}
                  data-testid="record-image-rotate-left"
                  onClick={() => rotate(image.id, "left")}
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  type="button"
                  className="record-image-turn"
                  aria-label={t("Girar a la derecha")}
                  data-tooltip={t("Girar 90° a la derecha. El original no se modifica.")}
                  data-testid="record-image-rotate-right"
                  onClick={() => rotate(image.id, "right")}
                >
                  <RotateCw size={14} />
                </button>
                <button
                  type="button"
                  className="record-image-turn"
                  aria-label={t("Recortar")}
                  data-tooltip={t("Recortar la imagen a tu gusto. El original no se modifica.")}
                  data-testid="record-image-crop"
                  onClick={() => setViewer("crop")}
                >
                  <Crop size={14} />
                </button>
                {validCrop(image.metadata?.imagoCrop) && (
                  <button
                    type="button"
                    className="record-image-turn"
                    aria-label={t("Volver al original")}
                    data-tooltip={t("Volver al original: quita el recorte y muestra la imagen completa.")}
                    data-testid="record-image-uncrop"
                    onClick={() =>
                      void perform(async () => {
                        await window.imago.call("cropImage", { id: image.id, crop: null });
                        onChanged();
                      })
                    }
                  >
                    <ImageOff size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="record-image-hint"
                  tabIndex={-1}
                  aria-hidden
                  onClick={() => setViewer("view")}
                >
                  <Maximize2 size={13} />
                  {t("Ampliar y anotar")}
                </button>
              </div>
            ) : null}
          </div>
          {viewer && (
            <ImageViewer
              row={row}
              initialIndex={imageIndex}
              initialCrop={viewer === "crop"}
              onClose={() => setViewer(false)}
              onChanged={onChanged}
              onOpenRecord={onOpenRecord}
              onCompare={onCompare}
            />
          )}
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
                <Button data-tour="record-similar" onClick={() => onSimilar(image.id)}>
                  <ScanSearch size={15} />
                  {t("Buscar imágenes similares")}
                </Button>
                {onRestore && (
                  <Button
                    data-tour="record-restore"
                    data-tooltip={t("Abre el taller de restauración con esta imagen. El original no se modifica.")}
                    onClick={() => onRestore(image.id)}
                  >
                    <Wand2 size={15} />
                    {t("Restaurar con IA")}
                  </Button>
                )}
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
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={bulkMove}
                      onChange={(e) => setBulkMove(e.target.checked)}
                    />
                    {t("Mover todas las imágenes del registro")} ·{" "}
                    {row.images.length}
                  </label>
                  {targets
                    .filter((r) => r.id !== row.id)
                    .map((r) => (
                      <Button
                        key={r.id}
                        onClick={() =>
                          void perform(async () => {
                            if (bulkMove)
                              await window.imago.call("reassignImages", {
                                ids: row.images.map((item) => item.id),
                                rowId: r.id,
                              });
                            else
                              await window.imago.call("reassignImage", {
                                id: image.id,
                                rowId: r.id,
                                columnId: image.columnId,
                              });
                            setBulkMove(false);
                            setMoving(false);
                            setImageIndex(0);
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
        </div>
      </aside>
    </dialog>
  );
}

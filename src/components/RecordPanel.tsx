import { useState, useEffect, useId, useRef } from "react";
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
  Expand,
  Shrink,
  SquareDashedMousePointer,
  Wand2,
  Quote,
  Check,
  RotateCcw,
  RotateCw,
  Crop,
  ImageOff,
  Tag,
} from "lucide-react";
import type { DatabaseDetail } from "../../shared/databases";
import type { RecordRow } from "../../shared/imago";
import { Button, Thumbnail } from "./ui";
import { RecordVariants } from "./RecordVariants";
import { RecordFacts } from "./RecordFacts";
import type { Perform } from "./Properties";
import { useT } from "../i18n";
import { validCrop } from "../../shared/imageRotation";
import { ImageViewer } from "./ImageViewer";
import type { BrowseItem, BrowseList } from "./ViewerStrip";
import { renderCitation } from "../../shared/citation";
export function RecordPanel({
  row,
  detail,
  onClose,
  onChanged,
  onOptionsChanged,
  onSimilar,
  onRestore,
  onOpenRecord,
  onCompare,
  citation,
  perform,
  hidden = [],
  strip,
  fullscreen = false,
  onFullscreen,
  browse,
  onBrowse,
}: {
  row: RecordRow;
  detail: DatabaseDetail;
  onClose: () => void;
  onChanged: () => void;
  /** A select property's options were edited from one of its cells. */
  onOptionsChanged?: () => void;
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
  /** The records opened together (a point of the map): a strip of their
   * images to move from one to another. */
  strip?: { label: string; items: RecordStripItem[] } | null;
  /** The panel over the whole window instead of at the side. */
  fullscreen?: boolean;
  onFullscreen?: (on: boolean) => void;
  /** The list the record was opened from, for the viewer's strip. */
  browse?: BrowseList | null;
  onBrowse?: (item: BrowseItem) => void;
}) {
  const t = useT(),
    [imageIndex, setImageIndex] = useState(0),
    [viewer, setViewer] = useState<false | "view" | "crop">(false),
    [copied, setCopied] = useState(false),
    [moving, setMoving] = useState(false),
    [bulkMove, setBulkMove] = useState(false),
    [query, setQuery] = useState(""),
    [targets, setTargets] = useState<RecordRow[]>([]),
    // «Ficha» or «Variantes y apariciones»; it stays while moving between records.
    [tab, setTab] = useState<"record" | "variants">("record"),
    [variantCount, setVariantCount] = useState<number | null>(null),
    [taggedCount, setTaggedCount] = useState<{ assetId: string; count: number } | null>(null);
  const taggedDescriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null),
    closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => setImageIndex(0), [row.id]);
  // The panel opens as a non-modal dialog beside the side menu, at the side
  // or in full screen, so the menu and the header stay usable while a record
  // is open (the user still shows or hides the menu as always). A non-modal
  // dialog gets no «cancel» on Escape, so Escape inside it is handled here,
  // unless an inner control or a window opened over the panel took it.
  useEffect(() => {
    const d = dialog.current!;
    // Opened from another window (a trial's review list, say), it goes above
    // it as a modal one: below a modal window it would be inert.
    if (document.querySelector("dialog:modal")) d.showModal();
    else d.show();
    const cancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A window opened over the panel (the image viewer) closes on its own.
      if ((e.target as HTMLElement).closest("dialog") !== d) return;
      e.preventDefault();
      closeRef.current();
    };
    // A click anywhere outside the panel (the header, the side menu, another
    // section) closes it, and the click still does what it was meant to. Not
    // a click in a window opened over the panel (the image viewer, a record
    // preview, a confirmation) or in what the panel's fields open apart from
    // it (a text editor, place suggestions), nor in the guided tour.
    const outside = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.isConnected || d.contains(target)) return;
      if (target.closest("dialog, .text-cell-popover, .place-suggestions, .tour-layer, .welcome-cinema, .toast")) return;
      closeRef.current();
    };
    d.addEventListener("cancel", cancel);
    d.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      d.removeEventListener("cancel", cancel);
      d.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside, true);
      d.close();
    };
  }, []);
  const image = row.images[Math.min(imageIndex, row.images.length - 1)];
  // How many versions the image has, for the tab's label.
  const imageId = image?.id;
  useEffect(() => {
    setVariantCount(null);
    if (!imageId) return;
    let cancelled = false;
    void window.imago
      .call("imageVariants", { assetId: imageId })
      .then((v) => !cancelled && setVariantCount(v.members.length))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [imageId]);
  const annotatedRegions = imageId ? (row.annotations ?? []).filter((a) => a.assetId === imageId).length : 0;
  const dictionaryId = detail.columns.find((column) => column.config.visualTags)?.config.visualTagsDictionary;
  useEffect(() => {
    setTaggedCount(null);
    if (!imageId || viewer) return;
    let cancelled = false;
    void window.imago.call("visualTagsList", { assetId: imageId })
      .then(({ regions }) => {
        if (!cancelled) setTaggedCount({ assetId: imageId, count: regions.filter((region) => region.state === "validated").length });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [imageId, image?.revision, dictionaryId, row.visualTags, viewer]);
  const taggedRegions = taggedCount && taggedCount.assetId === imageId ? taggedCount.count : 0;
  /** A quarter turn kept with the image; its annotations turn with it. */
  const rotate = (id: string, direction: "left" | "right") =>
    void perform(async () => {
      await window.imago.call("rotateImage", { id, direction });
      onChanged();
    });
  return (
    <dialog
      ref={dialog}
      className={"record-overlay" + (fullscreen ? " fullscreen" : "")}
      aria-label={row.title}
    >
      <button
        className="record-shade"
        onClick={onClose}
        aria-label={t("Cerrar")}
      />
      <aside
        aria-label={row.title}
        className={"record-panel" + (fullscreen ? " fullscreen" : "")}
        data-tour="record-panel"
        data-testid="record-panel"
      >
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
          <span className="record-head-actions">
            {onFullscreen && (
              <Button
                icon
                data-testid="record-fullscreen"
                aria-pressed={fullscreen}
                aria-label={t(fullscreen ? "Salir de la pantalla completa" : "Pantalla completa")}
                data-tooltip={t(fullscreen ? "Salir de la pantalla completa" : "Pantalla completa")}
                onClick={() => onFullscreen(!fullscreen)}
              >
                {fullscreen ? <Shrink size={17} /> : <Expand size={17} />}
              </Button>
            )}
            <Button icon aria-label={t("Cerrar")} onClick={onClose}>
              <X size={19} />
            </Button>
          </span>
        </header>
        {strip && strip.items.length > 1 && strip.items.some((item) => item.id === row.id) && (
          <RecordStrip strip={strip} current={row.id} onOpen={(id) => onOpenRecord?.(id)} />
        )}
        <div className="record-tabs" role="tablist" aria-label={t("Secciones de la ficha")}>
          <button type="button" role="tab" aria-selected={tab === "record"} data-testid="record-tab-record" onClick={() => setTab("record")}>
            {t("Ficha")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "variants"} data-testid="record-tab-variants" onClick={() => setTab("variants")}>
            {t("Variantes y apariciones")}
            {variantCount !== null && <span className="record-tab-count">{variantCount}</span>}
          </button>
        </div>
        {tab === "variants" && (
          <div className="record-body">
            <RecordVariants
              row={row}
              image={image}
              perform={perform}
              onOpenRecord={onOpenRecord}
              onCompare={onCompare}
              onCount={setVariantCount}
              onChanged={onChanged}
            />
          </div>
        )}
        <div className="record-body" hidden={tab !== "record"}>
          <div className="record-image">
            <button
              type="button"
              className="record-image-open"
              disabled={!image?.width}
              aria-label={t("Ampliar y anotar")}
              aria-describedby={taggedRegions > 0 ? taggedDescriptionId : undefined}
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
              {(annotatedRegions > 0 || taggedRegions > 0) && (
                <span className="record-image-badges">
                  {annotatedRegions > 0 && (
                    <span className="record-image-regions" data-tooltip={t("Zonas anotadas en esta imagen")}>
                      <SquareDashedMousePointer size={12} aria-hidden />
                      {annotatedRegions}
                    </span>
                  )}
                  {taggedRegions > 0 && (
                    <span className="record-image-regions is-tagged" data-tooltip={t("Zonas etiquetadas en esta imagen")} data-testid="record-image-tagged-regions">
                      <Tag size={12} aria-hidden />
                      {taggedRegions}
                      <span id={taggedDescriptionId} hidden>
                        {t(taggedRegions === 1 ? "1 zona etiquetada en esta imagen" : "{n} zonas etiquetadas en esta imagen").replace("{n}", String(taggedRegions))}
                      </span>
                    </span>
                  )}
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
              columns={detail.columns}
              initialIndex={imageIndex}
              initialCrop={viewer === "crop"}
              onClose={() => setViewer(false)}
              onChanged={onChanged}
              onOpenRecord={onOpenRecord}
              onCompare={onCompare}
              browse={browse}
              onBrowse={onBrowse}
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
                    data-tooltip={t("Abre Restauración IA con esta imagen. El original no se modifica.")}
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
          <RecordFacts
            row={row}
            detail={detail}
            image={image}
            hidden={hidden}
            perform={perform}
            onChanged={onChanged}
            onOptionsChanged={onOptionsChanged}
            onOpenRecord={onOpenRecord}
          />
        </div>
      </aside>
    </dialog>
  );
}

/** A record opened with others (a point of the map). */
export type RecordStripItem = { id: string; title: string; image: { id: string; revision?: string } | null };

/** The images of the records opened together, in a row: the open one is
 * marked and kept in view; ← and → move to the previous or next one. */
function RecordStrip({
  strip,
  current,
  onOpen,
}: {
  strip: { label: string; items: RecordStripItem[] };
  current: string;
  onOpen: (id: string) => void;
}) {
  const t = useT(),
    list = useRef<HTMLDivElement>(null),
    at = strip.items.findIndex((item) => item.id === current);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(".is-current")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);
  const go = (step: number) => {
    const next = strip.items[at + step];
    if (next) onOpen(next.id);
  };
  return (
    <nav className="record-strip" aria-label={strip.label} data-testid="record-strip">
      <div className="record-strip-head">
        <span>{strip.label}</span>
        <span className="record-strip-count">
          {at + 1} / {strip.items.length}
        </span>
        <Button icon aria-label={t("Registro anterior")} disabled={at <= 0} onClick={() => go(-1)}>
          <ChevronLeft size={15} />
        </Button>
        <Button icon aria-label={t("Registro siguiente")} disabled={at >= strip.items.length - 1} onClick={() => go(1)}>
          <ChevronRight size={15} />
        </Button>
      </div>
      <div
        className="record-strip-items"
        ref={list}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            go(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        {strip.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={"record-strip-item" + (item.id === current ? " is-current" : "")}
            aria-current={item.id === current ? "true" : undefined}
            aria-label={item.title}
            data-tooltip={item.title}
            onClick={() => item.id !== current && onOpen(item.id)}
          >
            <Thumbnail id={item.image?.id} revision={item.image?.revision} alt={item.title} />
            <small>{item.title}</small>
          </button>
        ))}
      </div>
    </nav>
  );
}

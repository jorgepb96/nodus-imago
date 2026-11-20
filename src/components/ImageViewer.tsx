// Full-screen image viewer with zoom and annotations. With «Anotar» on,
// dragging over the image marks a region; each region keeps a note and tags,
// is listed beside the image with its crop, and is part of the record's text,
// so the literal and semantic searches find it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Check,
  ChevronLeft,
  Crosshair,
  Landmark,
  ChevronRight,
  Crop as CropIcon,
  ImageOff,
  Maximize,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  ScanSearch,
  Square,
  SquareDashedMousePointer,
  Trash2,
  X,
} from "lucide-react";
import type { ImageAnnotation, RecordRow } from "../../shared/imago";
import { useT } from "../i18n";
import { DetailSearchPanel } from "./DetailSearchPanel";
import { Spinner } from "./ui";
import { MIN_CROP, validCrop, type Region } from "../../shared/imageRotation";
import { decodeMultiSelect, type DatabaseColumn } from "../../shared/databases";
import { heritageScheme, isHeritageColumn, typology } from "../../shared/heritage";
import { useHeritage } from "../heritageStore";
import { HeritageIcon } from "./HeritageIcon";
import { HeritageMarksPanel, type MarkDraft } from "./HeritageMarksPanel";

type View = { scale: number; x: number; y: number };
type Draft = { id?: string; x: number; y: number; w: number; h: number; note: string; tags: string[] };
const COLORS = ["#f59e0b", "#22c55e", "#3b82f6", "#ec4899", "#8b5cf6", "#ef4444"];
const src = (id: string, revision?: string, variant: "preview" | "full" = "preview") =>
  `imago://asset/${id}/${variant}${revision ? "?v=" + encodeURIComponent(revision) : ""}`;
/** Which part of the crop frame a drag moves. */
type Grip = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "new";
const GRIPS: Grip[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** The crop after dragging a grip from where the drag started. */
function dragCrop(start: Region, grip: Grip, dx: number, dy: number, origin: { x: number; y: number }): Region {
  if (grip === "new") {
    const x1 = clamp01(origin.x + dx),
      y1 = clamp01(origin.y + dy);
    return {
      x: Math.min(origin.x, x1),
      y: Math.min(origin.y, y1),
      w: Math.max(MIN_CROP, Math.abs(x1 - origin.x)),
      h: Math.max(MIN_CROP, Math.abs(y1 - origin.y)),
    };
  }
  if (grip === "move")
    return {
      ...start,
      x: Math.min(1 - start.w, Math.max(0, start.x + dx)),
      y: Math.min(1 - start.h, Math.max(0, start.y + dy)),
    };
  let x0 = start.x,
    y0 = start.y,
    x1 = start.x + start.w,
    y1 = start.y + start.h;
  if (grip.includes("w")) x0 = Math.min(x1 - MIN_CROP, clamp01(x0 + dx));
  if (grip.includes("e")) x1 = Math.max(x0 + MIN_CROP, clamp01(x1 + dx));
  if (grip.includes("n")) y0 = Math.min(y1 - MIN_CROP, clamp01(y0 + dy));
  if (grip.includes("s")) y1 = Math.max(y0 + MIN_CROP, clamp01(y1 + dy));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function ImageViewer({
  row,
  initialIndex = 0,
  initialCrop = false,
  onClose,
  onChanged,
  onOpenRecord,
  onCompare,
  columns,
}: {
  row: RecordRow;
  /** The database's properties: heritage ones can be marked on the image. */
  columns?: DatabaseColumn[];
  initialIndex?: number;
  /** Open straight into the crop editor. */
  initialCrop?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpenRecord?: (rowId: string) => void;
  onCompare?: (assetIds: string[]) => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, row.images.length - 1)));
  const image = row.images[index];
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [annotating, setAnnotating] = useState(false);
  const [annotations, setAnnotations] = useState<ImageAnnotation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drawing, setDrawing] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [searching, setSearching] = useState<ImageAnnotation | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Marking heritage elements: with a point or a rectangle. */
  const [marking, setMarking] = useState<"point" | "rect" | null>(null);
  const [markDraft, setMarkDraft] = useState<MarkDraft | null>(null);
  const heritageColumns = (columns ?? []).filter((c) => isHeritageColumn(c));
  const [heritageId, setHeritageId] = useState<string | null>(null);
  const heritageColumn = heritageColumns.find((c) => c.id === heritageId) ?? heritageColumns[0] ?? null;
  const heritageElements = useHeritage(heritageColumn?.id);
  const inCell = heritageColumn ? decodeMultiSelect(row.cells[heritageColumn.id] ?? null) : [];
  const heritageOptions = new Set(heritageColumn?.options.map((o) => o.id) ?? []);
  /** The crop being edited, as fractions of the whole turned image. */
  const [cropping, setCropping] = useState<Region | null>(null);
  const cropDrag = useRef<{ grip: Grip; start: Region; from: { x: number; y: number } } | null>(null);
  const savedCrop = image ? validCrop(image.metadata?.imagoCrop) : null;
  /** The shown image could not be loaded (its original moved, say). */
  const [loadFailed, setLoadFailed] = useState(false);
  /** A crop being saved: the bar waits instead of taking more clicks. */
  const [applying, setApplying] = useState(false);
  const startCrop = () => {
    setAnnotating(false);
    setMarking(null);
    setMarkDraft(null);
    setDraft(null);
    setSelected(null);
    setNatural(null);
    setLoadFailed(false);
    setCropping(savedCrop ?? { x: 0, y: 0, w: 1, h: 1 });
  };
  const [cropOnOpen, setCropOnOpen] = useState(initialCrop);
  if (cropOnOpen && image) {
    setCropOnOpen(false);
    startCrop();
  }
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const closeRef = useRef(onClose);
  // Escape leaves the crop editor first, then closes the viewer.
  const isCropping = !!cropping;
  useEffect(() => {
    closeRef.current = isCropping
      ? () => {
          setCropping(null);
          setNatural(null);
          setLoadFailed(false);
        }
      : onClose;
  }, [onClose, isCropping]);

  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    d.addEventListener("cancel", cancel);
    return () => {
      d.removeEventListener("cancel", cancel);
      d.close();
    };
  }, []);
  // Keyed by the image id: the record is refreshed after each saved
  // annotation, and that must not reset the view of the same image.
  const imageId = image?.id;
  const load = useCallback(async () => {
    if (!imageId) return;
    setAnnotations(await window.imago.call("annotationsList", { assetId: imageId }));
  }, [imageId]);
  const [shown, setShown] = useState(imageId);
  if (shown !== imageId) {
    setShown(imageId);
    setNatural(null);
    setDraft(null);
    setSelected(null);
    setCropping(null);
    setLoadFailed(false);
  }
  useEffect(() => {
    void load();
  }, [load]);
  // The crop editor shows the whole image, a file of its own prepared on
  // demand: ask for it in the background so «Recortar» opens at once
  // instead of waiting behind imports or indexing.
  const imageRevision = image?.revision;
  useEffect(() => {
    if (!imageId) return;
    const timer = window.setTimeout(() => {
      const preload = new Image();
      preload.src = src(imageId, imageRevision, "full");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [imageId, imageRevision]);
  useEffect(() => {
    void window.imago.call("annotationTags", { databaseId: row.databaseId }).then(setKnown).catch(() => {});
  }, [row.databaseId]);

  /** The whole image in view. */
  const fit = useCallback(() => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || !natural) return;
    const scale = Math.min((box.width - 48) / natural.w, (box.height - 48) / natural.h, 4);
    setView({ scale, x: (box.width - natural.w * scale) / 2, y: (box.height - natural.h * scale) / 2 });
  }, [natural]);
  useLayoutEffect(() => fit(), [fit]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  const zoom = (factor: number, cx?: number, cy?: number) => {
    const box = stage.current!.getBoundingClientRect();
    const px = cx ?? box.width / 2,
      py = cy ?? box.height / 2;
    setView((v) => {
      const scale = Math.min(12, Math.max(0.05, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };
  /** A pointer position as fractions of the image. */
  const point = (event: { clientX: number; clientY: number }) => {
    if (!natural) return { x: 0, y: 0 };
    const box = stage.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left - view.x) / view.scale / natural.w)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top - view.y) / view.scale / natural.h)),
    };
  };
  const onPointerDown = (event: ReactPointerEvent) => {
    if (!natural || event.button !== 0) return;
    if (cropping) {
      const grip = ((event.target as HTMLElement).closest("[data-grip]") as HTMLElement | null)?.dataset.grip as Grip | undefined;
      const from = point(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      cropDrag.current = { grip: grip ?? "new", start: cropping, from };
      return;
    }
    if ((event.target as HTMLElement).closest(".viewer-region, .viewer-mark")) return;
    if (marking === "point") {
      const p = point(event);
      setMarkDraft({ kind: "point", x: p.x, y: p.y, w: 0, h: 0 });
      setSelected(null);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (annotating || marking === "rect") {
      const p = point(event);
      setDrawing({ x0: p.x, y0: p.y, x: p.x, y: p.y });
      setSelected(null);
    } else drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (cropDrag.current && natural) {
      const { grip, start, from } = cropDrag.current,
        p = point(event);
      setCropping(dragCrop(start, grip, p.x - from.x, p.y - from.y, from));
      return;
    }
    if (drawing && natural) {
      const p = point(event);
      setDrawing({ ...drawing, x: p.x, y: p.y });
    } else if (drag.current) {
      const d = drag.current;
      setView((v) => ({ ...v, x: d.vx + event.clientX - d.x, y: d.vy + event.clientY - d.y }));
    }
  };
  const onPointerUp = () => {
    drag.current = null;
    cropDrag.current = null;
    if (!drawing) return;
    const x = Math.min(drawing.x0, drawing.x),
      y = Math.min(drawing.y0, drawing.y),
      w = Math.abs(drawing.x - drawing.x0),
      h = Math.abs(drawing.y - drawing.y0);
    setDrawing(null);
    if (w < 0.01 || h < 0.01) return;
    if (marking === "rect") setMarkDraft({ kind: "rect", x, y, w, h });
    else setDraft({ x, y, w, h, note: "", tags: [] });
  };
  const save = async () => {
    if (!draft || !image) return;
    setError(null);
    try {
      const saved = await window.imago.call("annotationSave", {
        id: draft.id,
        assetId: image.id,
        x: draft.x,
        y: draft.y,
        w: draft.w,
        h: draft.h,
        note: draft.note,
        tags: draft.tags,
        color: draft.id ? annotations.find((a) => a.id === draft.id)?.color ?? null : COLORS[annotations.length % COLORS.length],
      });
      setDraft(null);
      setSelected(saved.id);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const remove = async (annotation: ImageAnnotation) => {
    if (!window.confirm(t("¿Eliminar esta anotación? No se puede deshacer."))) return;
    await window.imago.call("annotationDelete", { id: annotation.id });
    if (selected === annotation.id) setSelected(null);
    await load();
    onChanged();
  };
  /** Saves the drawn mark as showing this element (added to the record if missing). */
  const saveMark = async (optionId: string) => {
    if (!markDraft || !image) return;
    setError(null);
    try {
      const saved = await window.imago.call("annotationSave", {
        assetId: image.id,
        ...markDraft,
        note: "",
        tags: [],
        optionId,
      });
      setMarkDraft(null);
      setSelected(saved.id);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  /** A new element of the heritage property, then the mark. */
  const createElement = async (label: string) => {
    if (!heritageColumn) return;
    setError(null);
    try {
      const created = await window.imago.call("heritageAddElement", { columnId: heritageColumn.id, label, link: null });
      window.dispatchEvent(new CustomEvent("imago:reload-detail"));
      await saveMark(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const removeMark = async (mark: ImageAnnotation) => {
    await window.imago.call("annotationDelete", { id: mark.id });
    if (selected === mark.id) setSelected(null);
    await load();
    onChanged();
  };
  /** Crop as edited, or the whole image again with `null`. */
  const applyCrop = async (crop: Region | null) => {
    if (!image || applying) return;
    setError(null);
    setApplying(true);
    try {
      await window.imago.call("cropImage", { id: image.id, crop: crop && validCrop(crop) });
      setCropping(null);
      setNatural(null);
      setLoadFailed(false);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };
  const cancelCrop = () => {
    setCropping(null);
    setNatural(null);
    setLoadFailed(false);
  };
  /** A quarter turn kept with the image; its annotations turn with it. */
  const rotate = async (direction: "left" | "right") => {
    if (!image) return;
    setError(null);
    try {
      await window.imago.call("rotateImage", { id: image.id, direction });
      setDraft(null);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  /** Centre a region and zoom to it. */
  const focus = (a: { x: number; y: number; w: number; h: number }) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || !natural) return;
    const scale = Math.min(12, Math.min((box.width * 0.7) / (a.w * natural.w), (box.height * 0.7) / (a.h * natural.h)));
    setView({
      scale,
      x: box.width / 2 - (a.x + a.w / 2) * natural.w * scale,
      y: box.height / 2 - (a.y + a.h / 2) * natural.h * scale,
    });
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest("input,textarea")) return;
      if (cropping) {
        if (event.key === "Enter" && natural) void applyCrop(cropping);
        return;
      }
      if (event.key === "a" || event.key === "A") {
        setMarking(null);
        setAnnotating((v) => !v);
      }
      if (event.key === "+" || event.key === "=") zoom(1.25);
      if (event.key === "-") zoom(0.8);
      if (event.key === "0") fit();
      if (event.key === "ArrowRight" && index < row.images.length - 1) setIndex(index + 1);
      if (event.key === "ArrowLeft" && index > 0) setIndex(index - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const ratio = natural ? natural.w / natural.h : image?.width && image.height ? image.width / image.height : 1;
  const box = (a: { x: number; y: number; w: number; h: number }) =>
    natural
      ? {
          left: view.x + a.x * natural.w * view.scale,
          top: view.y + a.y * natural.h * view.scale,
          width: a.w * natural.w * view.scale,
          height: a.h * natural.h * view.scale,
        }
      : { display: "none" };
  const pending = drawing
    ? { x: Math.min(drawing.x0, drawing.x), y: Math.min(drawing.y0, drawing.y), w: Math.abs(drawing.x - drawing.x0), h: Math.abs(drawing.y - drawing.y0) }
    : draft && !draft.id
      ? draft
      : null;

  // Notes on one side; marks of heritage elements the record shows on the other.
  const notes = annotations.filter((a) => !a.optionId);
  const heritageMarks = annotations.filter((a) => a.optionId && heritageOptions.has(a.optionId));
  const shownMarks = heritageMarks.filter((m) => inCell.includes(m.optionId!));

  return (
    <dialog ref={dialog} className="image-viewer" aria-label={row.title} data-testid="image-viewer">
      <header className="viewer-bar">
        <div className="viewer-title">
          <strong>{row.title}</strong>
          <span>{image?.fileName}</span>
        </div>
        {row.images.length > 1 && (
          <div className="viewer-group">
            <button type="button" aria-label={t("Imagen anterior")} data-tooltip={t("Imagen anterior")} disabled={!index} onClick={() => setIndex(index - 1)}>
              <ChevronLeft size={17} />
            </button>
            <span className="viewer-count">
              {index + 1} / {row.images.length}
            </span>
            <button type="button" aria-label={t("Imagen siguiente")} data-tooltip={t("Imagen siguiente")} disabled={index >= row.images.length - 1} onClick={() => setIndex(index + 1)}>
              <ChevronRight size={17} />
            </button>
          </div>
        )}
        <div className="viewer-group">
          <button type="button" aria-label={t("Alejar")} data-tooltip={t("Alejar")} onClick={() => zoom(0.8)}>
            <Minus size={16} />
          </button>
          <span className="viewer-count">{Math.round(view.scale * 100)} %</span>
          <button type="button" aria-label={t("Acercar")} data-tooltip={t("Acercar")} onClick={() => zoom(1.25)}>
            <Plus size={16} />
          </button>
          <button type="button" aria-label={t("Ajustar a la pantalla")} data-tooltip={t("Ajustar a la pantalla")} onClick={fit}>
            <Maximize size={15} />
          </button>
        </div>
        {cropping ? (
          <div className="crop-bar" data-testid="viewer-crop-bar">
            <span>{t("Arrastra el marco o sus esquinas para elegir la parte que quieres ver.")}</span>
            <button type="button" className="viewer-annotate" disabled={applying || !natural} onClick={() => setCropping({ x: 0, y: 0, w: 1, h: 1 })}>
              {t("Toda la imagen")}
            </button>
            <button type="button" className="viewer-annotate" disabled={applying} onClick={cancelCrop}>
              {t("Cancelar")}
            </button>
            <button
              type="button"
              className="viewer-annotate is-on"
              data-testid="viewer-crop-apply"
              disabled={applying || !natural}
              onClick={() => void applyCrop(cropping)}
            >
              {applying ? <Spinner /> : <Check size={15} />}
              {t(applying ? "Aplicando…" : "Aplicar recorte")}
            </button>
          </div>
        ) : (
          <>
            <div className="viewer-group">
              <button
                type="button"
                aria-label={t("Girar a la izquierda")}
                data-tooltip={t("Girar 90° a la izquierda. El original no se modifica.")}
                data-testid="viewer-rotate-left"
                disabled={!image}
                onClick={() => void rotate("left")}
              >
                <RotateCcw size={15} />
              </button>
              <button
                type="button"
                aria-label={t("Girar a la derecha")}
                data-tooltip={t("Girar 90° a la derecha. El original no se modifica.")}
                data-testid="viewer-rotate-right"
                disabled={!image}
                onClick={() => void rotate("right")}
              >
                <RotateCw size={15} />
              </button>
              <button
                type="button"
                aria-label={t("Recortar")}
                data-tooltip={t("Recortar la imagen a tu gusto. El original no se modifica.")}
                data-testid="viewer-crop"
                data-tour="viewer-crop"
                disabled={!image}
                onClick={startCrop}
              >
                <CropIcon size={15} />
              </button>
              {savedCrop && (
                <button
                  type="button"
                  aria-label={t("Volver al original")}
                  data-tooltip={t("Volver al original: quita el recorte y muestra la imagen completa.")}
                  data-testid="viewer-uncrop"
                  onClick={() => void applyCrop(null)}
                >
                  <ImageOff size={15} />
                </button>
              )}
            </div>
            <button
              type="button"
              className={`viewer-annotate ${annotating ? "is-on" : ""}`}
              aria-pressed={annotating}
              data-testid="viewer-annotate"
              data-tour="viewer-annotate"
              data-tooltip={t("Arrastra sobre la imagen para marcar una zona y escribir una nota (tecla A).")}
              onClick={() => {
                setMarking(null);
                setMarkDraft(null);
                setAnnotating(!annotating);
              }}
            >
              <SquareDashedMousePointer size={16} />
              {t("Anotar")}
            </button>
            {heritageColumn && (
              <div className="viewer-group viewer-heritage">
                <button
                  type="button"
                  className={`viewer-annotate ${marking ? "is-on" : ""}`}
                  aria-pressed={!!marking}
                  data-testid="viewer-heritage"
                  data-tooltip={t("Marca en la imagen un edificio, monumento u obra con un punto o un rectángulo.")}
                  onClick={() => {
                    setAnnotating(false);
                    setDraft(null);
                    setMarkDraft(null);
                    setMarking(marking ? null : "point");
                  }}
                >
                  <Landmark size={16} />
                  {t("Patrimonio")}
                </button>
                {marking && (
                  <>
                    <button
                      type="button"
                      aria-pressed={marking === "point"}
                      className={marking === "point" ? "is-on" : ""}
                      aria-label={t("Punto")}
                      data-tooltip={t("Punto: haz clic sobre el elemento")}
                      data-testid="viewer-heritage-point"
                      onClick={() => setMarking("point")}
                    >
                      <Crosshair size={15} />
                    </button>
                    <button
                      type="button"
                      aria-pressed={marking === "rect"}
                      className={marking === "rect" ? "is-on" : ""}
                      aria-label={t("Rectángulo")}
                      data-tooltip={t("Rectángulo: arrastra alrededor del elemento")}
                      data-testid="viewer-heritage-rect"
                      onClick={() => setMarking("rect")}
                    >
                      <Square size={15} />
                    </button>
                  </>
                )}
                {marking && heritageColumns.length > 1 && (
                  <select value={heritageColumn.id} aria-label={t("Propiedad de patrimonio")} onChange={(e) => setHeritageId(e.target.value)}>
                    {heritageColumns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </>
        )}
        <span className="viewer-spacer" />
        <button type="button" className="viewer-close" aria-label={t("Cerrar")} data-tooltip={t("Cerrar")} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="viewer-body">
        <div
          ref={stage}
          data-tour="viewer-stage"
          className={`viewer-stage ${annotating || marking ? "is-annotating" : ""} ${cropping ? "is-cropping" : ""}`}
          onWheel={(event) => {
            const r = stage.current!.getBoundingClientRect();
            zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - r.left, event.clientY - r.top);
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => !annotating && !marking && !cropping && zoom(2)}
        >
          {image && (
            <img
              key={image.id}
              className="viewer-image"
              src={src(image.id, image.revision, cropping ? "full" : "preview")}
              alt={row.title}
              draggable={false}
              onLoad={(event) => {
                setLoadFailed(false);
                setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight });
              }}
              onError={() => setLoadFailed(true)}
              style={
                natural
                  ? { width: natural.w * view.scale, height: natural.h * view.scale, transform: `translate(${view.x}px, ${view.y}px)` }
                  : { visibility: "hidden" }
              }
            />
          )}
          {image && !natural && (
            <div className="viewer-loading" role="status" data-testid="viewer-loading">
              {loadFailed ? (
                <>
                  <ImageOff size={22} />
                  {t("No se ha podido cargar la imagen.")}
                  {cropping && (
                    <button type="button" className="viewer-annotate" onClick={cancelCrop}>
                      {t("Cancelar")}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <Spinner />
                  {t(cropping ? "Preparando la imagen completa…" : "Cargando la imagen…")}
                </>
              )}
            </div>
          )}
          {cropping && natural && (
            <div className="crop-frame" style={box(cropping)} data-grip="move" data-testid="viewer-crop-frame">
              {GRIPS.map((grip) => (
                <span key={grip} className={`crop-grip is-${grip}`} data-grip={grip} />
              ))}
            </div>
          )}
          {!cropping && notes.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`viewer-region ${selected === a.id ? "is-selected" : ""}`}
              style={{ ...box(a), "--region": a.color ?? COLORS[0] } as unknown as React.CSSProperties}
              data-tooltip={[a.note, a.tags.join(", ")].filter(Boolean).join(" · ") || t("Sin nota")}
              aria-label={a.note || t("Anotación")}
              onClick={() => {
                setSelected(a.id);
                document.getElementById(`annotation-${a.id}`)?.scrollIntoView({ block: "nearest" });
              }}
            />
          ))}
          {!cropping &&
            shownMarks.map((m) => {
              const e = heritageElements[m.optionId!];
              const icon = heritageColumn && typology(heritageScheme(heritageColumn.config), e?.group ?? null, e?.type ?? null)?.icon;
              const label = heritageColumn?.options.find((o) => o.id === m.optionId)?.label ?? "";
              const at = box(m) as { left?: number; top?: number };
              return m.kind === "point" ? (
                <button
                  key={m.id}
                  type="button"
                  className={`viewer-mark ${selected === m.id ? "is-selected" : ""}`}
                  style={natural ? { left: at.left, top: at.top } : { display: "none" }}
                  aria-label={label}
                  data-tooltip={label}
                  onClick={() => setSelected(m.id)}
                >
                  <HeritageIcon name={icon} size={13} />
                </button>
              ) : (
                <button
                  key={m.id}
                  type="button"
                  className={`viewer-region is-heritage ${selected === m.id ? "is-selected" : ""}`}
                  style={box(m)}
                  aria-label={label}
                  data-tooltip={label}
                  onClick={() => setSelected(m.id)}
                >
                  <span className="viewer-mark-label">
                    <HeritageIcon name={icon} size={11} /> {label}
                  </span>
                </button>
              );
            })}
          {markDraft?.kind === "point" && natural && (
            <span className="viewer-mark is-drawing" style={box(markDraft) as React.CSSProperties} />
          )}
          {markDraft?.kind === "rect" && <div className="viewer-region is-drawing is-heritage" style={box(markDraft)} />}
          {pending && <div className="viewer-region is-drawing" style={box(pending)} />}
          {annotating && !notes.length && !pending && (
            <p className="viewer-hint">{t("Arrastra sobre la imagen para marcar la primera zona.")}</p>
          )}
        </div>
        <aside className="viewer-side" data-testid="viewer-annotations" data-tour="viewer-annotations">
          {searching ? (
            <DetailSearchPanel
              annotation={searching}
              databaseId={row.databaseId}
              onBack={() => setSearching(null)}
              onOpenRecord={
                onOpenRecord &&
                ((rowId) => {
                  onClose();
                  onOpenRecord(rowId);
                })
              }
              onCompare={
                onCompare &&
                ((ids) => {
                  onClose();
                  onCompare(ids);
                })
              }
            />
          ) : (
          <>
          {heritageColumn && (
            <HeritageMarksPanel
              column={heritageColumn}
              inCell={inCell}
              marks={heritageMarks}
              draft={markDraft}
              selected={selected}
              onChoose={(id) => void saveMark(id)}
              onCreate={(label) => void createElement(label)}
              onCancel={() => setMarkDraft(null)}
              onFocus={(m) => {
                setSelected(m.id);
                focus(m.kind === "point" ? { x: m.x - 0.05, y: m.y - 0.05, w: 0.1, h: 0.1 } : m);
              }}
              onDelete={(m) => void removeMark(m)}
            />
          )}
          {error && markDraft && <p className="error">{t(error)}</p>}
          <h2>
            {t("Anotaciones")} <span>{notes.length}</span>
          </h2>
          {draft && (
            <AnnotationEditor
              draft={draft}
              known={known}
              imageId={image?.id}
              revision={image?.revision}
              ratio={ratio}
              error={error}
              onChange={setDraft}
              onSave={() => void save()}
              onCancel={() => {
                setDraft(null);
                setError(null);
              }}
            />
          )}
          {!notes.length && !draft && (
            <p className="viewer-empty">
              {t("Esta imagen no tiene anotaciones. Pulsa «Anotar» y arrastra sobre una parte de la imagen (una persona, una inscripción, un edificio) para describirla. Las notas se incluyen en la búsqueda.")}
            </p>
          )}
          <ul className="viewer-list">
            {notes
              .filter((a) => a.id !== draft?.id)
              .map((a) => (
                <li key={a.id} id={`annotation-${a.id}`} className={selected === a.id ? "is-selected" : ""}>
                  <button
                    type="button"
                    className="viewer-item"
                    onClick={() => {
                      setSelected(a.id);
                      focus(a);
                    }}
                  >
                    <Crop annotation={a} imageId={image!.id} revision={image!.revision} ratio={ratio} />
                    <span className="viewer-item-text">
                      <span>{a.note || <em>{t("Sin nota")}</em>}</span>
                      {a.tags.length > 0 && (
                        <span className="viewer-tags">
                          {a.tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                  <span className="viewer-item-actions">
                    <button
                      type="button"
                      aria-label={t("Buscar este detalle")}
                      data-tooltip={t("Buscar este detalle en las demás imágenes")}
                      data-testid="annotation-search"
                      onClick={() => setSearching(a)}
                    >
                      <ScanSearch size={13} />
                    </button>
                    <button type="button" aria-label={t("Editar")} data-tooltip={t("Editar")} onClick={() => setDraft({ ...a })}>
                      <Pencil size={13} />
                    </button>
                    <button type="button" aria-label={t("Eliminar")} data-tooltip={t("Eliminar")} onClick={() => void remove(a)}>
                      <Trash2 size={13} />
                    </button>
                  </span>
                </li>
              ))}
          </ul>
          </>
          )}
        </aside>
      </div>
    </dialog>
  );
}

/** The region cut out of the preview, at the size of a list thumbnail. */
function Crop({
  annotation: a,
  imageId,
  revision,
  ratio,
}: {
  annotation: { x: number; y: number; w: number; h: number; color?: string | null };
  imageId: string;
  revision?: string;
  /** Width / height of the image. */
  ratio: number;
}) {
  const aspect = (a.w * ratio) / a.h,
    max = 64;
  return (
    <span
      className="viewer-crop"
      style={{
        width: aspect >= 1 ? max : max * aspect,
        height: aspect >= 1 ? max / aspect : max,
        backgroundImage: `url("${src(imageId, revision)}")`,
        backgroundSize: `${100 / a.w}% ${100 / a.h}%`,
        backgroundPosition: `${a.w < 1 ? (a.x / (1 - a.w)) * 100 : 0}% ${a.h < 1 ? (a.y / (1 - a.h)) * 100 : 0}%`,
        borderColor: a.color ?? undefined,
      }}
    />
  );
}

function AnnotationEditor({
  draft,
  known,
  imageId,
  revision,
  ratio,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  known: string[];
  imageId?: string;
  revision?: string;
  ratio: number;
  error: string | null;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [tag, setTag] = useState("");
  const add = (value: string) => {
    const clean = value.replace(/,$/, "").trim();
    if (clean && !draft.tags.some((x) => x.toLowerCase() === clean.toLowerCase())) onChange({ ...draft, tags: [...draft.tags, clean] });
    setTag("");
  };
  const suggestions = tag.trim()
    ? known.filter((k) => k.toLowerCase().includes(tag.trim().toLowerCase()) && !draft.tags.includes(k)).slice(0, 6)
    : [];
  return (
    <form
      className="annotation-editor"
      data-testid="annotation-editor"
      data-tour="annotation-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (tag.trim()) add(tag);
        onSave();
      }}
    >
      {imageId && <Crop annotation={draft} imageId={imageId} revision={revision} ratio={ratio} />}
      <label>
        {t("Nota")}
        <textarea
          autoFocus
          rows={3}
          value={draft.note}
          placeholder={t("Qué se ve en esta zona: persona, inscripción, edificio, objeto…")}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </label>
      <label>
        {t("Etiquetas")}
        <span className="annotation-tags">
          {draft.tags.map((x) => (
            <button key={x} type="button" aria-label={`${t("Quitar")} ${x}`} onClick={() => onChange({ ...draft, tags: draft.tags.filter((y) => y !== x) })}>
              {x} <X size={11} />
            </button>
          ))}
          <input
            value={tag}
            placeholder={draft.tags.length ? "" : t("Escribe y pulsa Enter")}
            onChange={(event) => (event.target.value.endsWith(",") ? add(event.target.value) : setTag(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && tag.trim()) {
                event.preventDefault();
                add(tag);
              }
              if (event.key === "Backspace" && !tag && draft.tags.length) onChange({ ...draft, tags: draft.tags.slice(0, -1) });
            }}
          />
        </span>
      </label>
      {suggestions.length > 0 && (
        <span className="annotation-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}>
              {s}
            </button>
          ))}
        </span>
      )}
      {error && <p className="annotation-error">{t(error)}</p>}
      <footer>
        <span className="hint">{t("⌘/Ctrl + Enter para guardar")}</span>
        <button type="submit" className="button primary" data-testid="annotation-save">
          {t("Guardar")}
        </button>
        <button type="button" className="button annotation-cancel" onClick={onCancel}>
          {t("Cancelar")}
        </button>
      </footer>
    </form>
  );
}

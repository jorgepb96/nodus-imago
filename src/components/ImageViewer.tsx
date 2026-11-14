// Full-screen image viewer with zoom and annotations. With «Anotar» on,
// dragging over the image marks a region; each region keeps a note and tags,
// is listed beside the image with its crop, and is part of the record's text,
// so the literal and semantic searches find it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minus,
  Pencil,
  Plus,
  ScanSearch,
  SquareDashedMousePointer,
  Trash2,
  X,
} from "lucide-react";
import type { ImageAnnotation, RecordRow } from "../../shared/imago";
import { useT } from "../i18n";
import { DetailSearchPanel } from "./DetailSearchPanel";

type View = { scale: number; x: number; y: number };
type Draft = { id?: string; x: number; y: number; w: number; h: number; note: string; tags: string[] };
const COLORS = ["#f59e0b", "#22c55e", "#3b82f6", "#ec4899", "#8b5cf6", "#ef4444"];
const src = (id: string, revision?: string) =>
  `imago://asset/${id}/preview${revision ? "?v=" + encodeURIComponent(revision) : ""}`;

export function ImageViewer({
  row,
  initialIndex = 0,
  onClose,
  onChanged,
  onOpenRecord,
  onCompare,
}: {
  row: RecordRow;
  initialIndex?: number;
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
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

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
  }
  useEffect(() => {
    void load();
  }, [load]);
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
    if ((event.target as HTMLElement).closest(".viewer-region")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (annotating) {
      const p = point(event);
      setDrawing({ x0: p.x, y0: p.y, x: p.x, y: p.y });
      setSelected(null);
    } else drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
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
    if (!drawing) return;
    const x = Math.min(drawing.x0, drawing.x),
      y = Math.min(drawing.y0, drawing.y),
      w = Math.abs(drawing.x - drawing.x0),
      h = Math.abs(drawing.y - drawing.y0);
    setDrawing(null);
    if (w < 0.01 || h < 0.01) return;
    setDraft({ x, y, w, h, note: "", tags: [] });
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
      if (event.key === "a" || event.key === "A") setAnnotating((v) => !v);
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
        <button
          type="button"
          className={`viewer-annotate ${annotating ? "is-on" : ""}`}
          aria-pressed={annotating}
          data-testid="viewer-annotate"
          data-tooltip={t("Arrastra sobre la imagen para marcar una zona y escribir una nota (tecla A).")}
          onClick={() => setAnnotating(!annotating)}
        >
          <SquareDashedMousePointer size={16} />
          {t("Anotar")}
        </button>
        <span className="viewer-spacer" />
        <button type="button" className="viewer-close" aria-label={t("Cerrar")} data-tooltip={t("Cerrar")} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="viewer-body">
        <div
          ref={stage}
          className={`viewer-stage ${annotating ? "is-annotating" : ""}`}
          onWheel={(event) => {
            const r = stage.current!.getBoundingClientRect();
            zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - r.left, event.clientY - r.top);
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => !annotating && zoom(2)}
        >
          {image && (
            <img
              key={image.id}
              className="viewer-image"
              src={src(image.id, image.revision)}
              alt={row.title}
              draggable={false}
              onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
              style={
                natural
                  ? { width: natural.w * view.scale, height: natural.h * view.scale, transform: `translate(${view.x}px, ${view.y}px)` }
                  : { visibility: "hidden" }
              }
            />
          )}
          {annotations.map((a) => (
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
          {pending && <div className="viewer-region is-drawing" style={box(pending)} />}
          {annotating && !annotations.length && !pending && (
            <p className="viewer-hint">{t("Arrastra sobre la imagen para marcar la primera zona.")}</p>
          )}
        </div>
        <aside className="viewer-side" data-testid="viewer-annotations">
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
          <h2>
            {t("Anotaciones")} <span>{annotations.length}</span>
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
          {!annotations.length && !draft && (
            <p className="viewer-empty">
              {t("Esta imagen no tiene anotaciones. Pulsa «Anotar» y arrastra sobre una parte de la imagen (una persona, una inscripción, un edificio) para describirla. Las notas se incluyen en la búsqueda.")}
            </p>
          )}
          <ul className="viewer-list">
            {annotations
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
        <button type="button" className="button" onClick={onCancel}>
          {t("Cancelar")}
        </button>
        <button type="submit" className="button primary" data-testid="annotation-save">
          {t("Guardar")}
        </button>
      </footer>
    </form>
  );
}

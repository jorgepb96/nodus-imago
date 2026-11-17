// Comparison table: up to six images from any database side by side, with
// zoom and pan shared by all of them, or two of them one over the other with
// a transparency slider or the difference between them. Boards are saved.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Columns2,
  Layers,
  Link2,
  Link2Off,
  Maximize,
  Plus,
  Search,
  Trash2,
  X,
  ImagePlus,
} from "lucide-react";
import type { CompareBoard, CompareItem } from "../../shared/compare";
import type { DatabaseSummary } from "../../shared/databases";
import type { RecordRow } from "../../shared/imago";
import { useT } from "../i18n";
import { Button, Modal, Thumbnail } from "./ui";
import { CriteriaSelect } from "./CriteriaSelect";

const LIMIT = 6;
type View = { scale: number; x: number; y: number };
const ORIGIN: View = { scale: 1, x: 0, y: 0 };
const src = (item: CompareItem) =>
  `imago://asset/${item.assetId}/preview${item.revision ? "?v=" + encodeURIComponent(item.revision) : ""}`;

export function CompareView({
  databases,
  seed,
  onSeedUsed,
  onOpenRecord,
}: {
  databases: DatabaseSummary[];
  /** Images sent from a gallery selection: they open in a new board. */
  seed: string[] | null;
  onSeedUsed: () => void;
  onOpenRecord: (rowId: string) => void;
}) {
  const t = useT();
  const api = window.imago;
  const [boards, setBoards] = useState<CompareBoard[]>([]);
  const [board, setBoard] = useState<(CompareBoard & { items: CompareItem[] }) | null>(null);
  const [mode, setMode] = useState<"grid" | "overlay">("grid");
  const [synced, setSynced] = useState(true);
  const [shared, setShared] = useState<View>(ORIGIN);
  const [own, setOwn] = useState<Record<string, View>>({});
  const [pair, setPair] = useState<[number, number]>([0, 1]);
  const [opacity, setOpacity] = useState(0.5);
  const [difference, setDifference] = useState(false);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState<CompareBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => setBoards(await api.call("boardsList")), [api]);
  const open = useCallback(
    async (id: string) => {
      setBoard(await api.call("boardGet", { id }));
      setShared(ORIGIN);
      setOwn({});
      setPair([0, 1]);
    },
    [api],
  );
  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);
  // Open the most recent board when arriving, unless a selection arrives.
  const opened = useRef(false);
  // A gallery selection arrives as a new board. It also stops the most
  // recent board from opening: both load at once, and the slower one used
  // to win, so the selection could land on an old board.
  useEffect(() => {
    if (!seed?.length) return;
    opened.current = true;
    onSeedUsed();
    void (async () => {
      const created = await api.call("boardSave", { name: t("Mesa sin título"), assetIds: seed.slice(0, LIMIT) });
      await refresh();
      await open(created.id);
    })().catch((e) => setError(String(e?.message ?? e)));
  }, [seed, onSeedUsed, api, refresh, open, t]);
  useEffect(() => {
    if (opened.current || seed?.length || !boards.length || board) return;
    opened.current = true;
    void open(boards[0].id);
  }, [boards, board, seed, open]);

  const save = async (patch: { name?: string; assetIds?: string[] }) => {
    if (!board) return;
    setError(null);
    try {
      await api.call("boardSave", { id: board.id, ...patch });
      await open(board.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const create = async () => {
    const created = await api.call("boardSave", { name: t("Mesa sin título"), assetIds: [] });
    await refresh();
    await open(created.id);
    setPicking(true);
  };
  const move = (index: number, delta: number) => {
    if (!board) return;
    const ids = [...board.assetIds];
    const [item] = ids.splice(index, 1);
    ids.splice(index + delta, 0, item);
    void save({ assetIds: ids });
  };
  const items = board?.items ?? [];
  const view = (assetId: string) => (synced ? shared : (own[assetId] ?? ORIGIN));
  const setView = (assetId: string, next: (v: View) => View) =>
    synced ? setShared(next) : setOwn((o) => ({ ...o, [assetId]: next(o[assetId] ?? ORIGIN) }));

  return (
    <div className="compare-page" data-testid="compare-view">
      <aside className="compare-boards">
        <h1>
          <Columns2 size={18} />
          {t("Mesa de comparación")}
        </h1>
        <p className="hint">
          {t("Pon imágenes juntas para compararlas con el zoom sincronizado y superpón dos de ellas para ver qué cambia. Cada mesa guarda su selección; las imágenes originales no se modifican.")}
        </p>
        <div className="compare-boards-head">
          <h2>{t("Mesas")}</h2>
          <Button icon aria-label={t("Nueva mesa")} data-tooltip={t("Nueva mesa")} onClick={() => void create()}>
            <Plus size={15} />
          </Button>
        </div>
        {!boards.length && <p className="muted small">{t("Aún no hay mesas.")}</p>}
        {boards.map((b) => (
          <div key={b.id} className={`compare-board-row ${board?.id === b.id ? "active" : ""}`}>
            <button type="button" onClick={() => void open(b.id)}>
              <span>{b.name}</span>
              <small>{b.assetIds.length}</small>
            </button>
            <button type="button" className="compare-board-delete" aria-label={t("Eliminar mesa")} data-tooltip={t("Eliminar mesa")} onClick={() => setDeleting(b)}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </aside>
      <section className="compare-main">
        {!board ? (
          <div className="compare-empty">
            <Columns2 size={30} />
            <h1>{t("Mesa de comparación")}</h1>
            <p>
              {t("Pon hasta seis imágenes juntas para compararlas: estados de un grabado, copias y reproducciones, recortes de prensa o el mismo lugar en dos épocas. El zoom se mueve a la vez en todas, y dos de ellas se pueden superponer.")}
            </p>
            <Button primary onClick={() => void create()}>
              <Plus size={15} />
              {t("Nueva mesa")}
            </Button>
          </div>
        ) : (
          <>
            <header className="compare-toolbar">
              {renaming ? (
                <input
                  autoFocus
                  className="compare-name-input"
                  aria-label={t("Nombre de la mesa")}
                  defaultValue={board.name}
                  onBlur={(e) => {
                    setRenaming(false);
                    if (e.target.value.trim() && e.target.value !== board.name) void save({ name: e.target.value });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                />
              ) : (
                <button type="button" className="compare-name" data-tooltip={t("Cambiar el nombre")} onClick={() => setRenaming(true)}>
                  {board.name}
                </button>
              )}
              <span className="compare-count">
                {items.length} / {LIMIT}
              </span>
              <Button disabled={items.length >= LIMIT} onClick={() => setPicking(true)} data-testid="compare-add" data-tour="compare-add">
                <Plus size={14} />
                {t("Añadir imágenes")}
              </Button>
              <span className="compare-spacer" />
              <div className="segmented compare-mode" role="group" aria-label={t("Modo")}>
                <button type="button" className={mode === "grid" ? "active" : ""} onClick={() => setMode("grid")}>
                  <Columns2 size={13} />
                  {t("Lado a lado")}
                </button>
                <button
                  type="button"
                  className={mode === "overlay" ? "active" : ""}
                  disabled={items.length < 2}
                  data-tooltip={t("Pon una imagen encima de otra para ver qué cambia")}
                  onClick={() => setMode("overlay")}
                >
                  <Layers size={13} />
                  {t("Superponer")}
                </button>
              </div>
              {mode === "grid" && (
                <Button
                  aria-pressed={synced}
                  className={synced ? "is-active" : ""}
                  data-tooltip={t(synced ? "El zoom y el desplazamiento se aplican a todas las imágenes" : "Cada imagen tiene su propio zoom")}
                  onClick={() => setSynced(!synced)}
                >
                  {synced ? <Link2 size={14} /> : <Link2Off size={14} />}
                  {t("Zoom sincronizado")}
                </Button>
              )}
              <Button
                icon
                aria-label={t("Ajustar todas")}
                data-tooltip={t("Ajustar todas")}
                onClick={() => {
                  setShared(ORIGIN);
                  setOwn({});
                }}
              >
                <Maximize size={14} />
              </Button>
            </header>
            {error && <p className="compare-error">{t(error)}</p>}
            {!items.length ? (
              <div className="compare-empty">
                <p>{t("Esta mesa está vacía. Añade imágenes desde aquí o selecciona registros en la galería y pulsa «Comparar».")}</p>
                <Button primary onClick={() => setPicking(true)}>
                  <Plus size={15} />
                  {t("Añadir imágenes")}
                </Button>
              </div>
            ) : mode === "grid" ? (
              <div className={`compare-grid count-${items.length}`}>
                {items.map((item, index) => (
                  <figure key={item.assetId} className="compare-slot" data-testid="compare-slot">
                    <figcaption>
                      <button type="button" className="compare-title" onClick={() => onOpenRecord(item.rowId)} data-tooltip={t("Abrir registro")}>
                        <strong>{item.title}</strong>
                        <small>
                          {[item.date, item.databaseName].filter(Boolean).join(" · ")}
                        </small>
                      </button>
                      <span className="compare-slot-actions">
                        <button type="button" aria-label={t("Mover a la izquierda")} data-tooltip={t("Mover a la izquierda")} disabled={!index} onClick={() => move(index, -1)}>
                          <ArrowLeft size={13} />
                        </button>
                        <button type="button" aria-label={t("Mover a la derecha")} data-tooltip={t("Mover a la derecha")} disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                          <ArrowRight size={13} />
                        </button>
                        <button type="button" aria-label={t("Quitar de la mesa")} data-tooltip={t("Quitar de la mesa")} onClick={() => void save({ assetIds: board.assetIds.filter((id) => id !== item.assetId) })}>
                          <X size={13} />
                        </button>
                      </span>
                    </figcaption>
                    <ZoomStage view={view(item.assetId)} onView={(next) => setView(item.assetId, next)}>
                      <img src={src(item)} alt={item.title} draggable={false} />
                    </ZoomStage>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="compare-overlay">
                <div className="compare-overlay-controls">
                  <label>
                    {t("Abajo")}
                    <select value={pair[0]} onChange={(e) => setPair([Number(e.target.value), pair[1]])}>
                      {items.map((item, i) => (
                        <option key={item.assetId} value={i} disabled={i === pair[1]}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("Encima")}
                    <select value={pair[1]} onChange={(e) => setPair([pair[0], Number(e.target.value)])}>
                      {items.map((item, i) => (
                        <option key={item.assetId} value={i} disabled={i === pair[0]}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="compare-opacity">
                    {t("Transparencia de la imagen de encima")}
                    <input type="range" min={0} max={1} step={0.01} value={opacity} disabled={difference} onChange={(e) => setOpacity(Number(e.target.value))} />
                    <span>{Math.round(opacity * 100)} %</span>
                  </label>
                  <label className="check-label" data-tooltip={t("Las zonas iguales se ven negras; las diferencias, claras")}>
                    <input type="checkbox" checked={difference} onChange={(e) => setDifference(e.target.checked)} />
                    {t("Mostrar la diferencia")}
                  </label>
                </div>
                <ZoomStage view={shared} onView={setShared}>
                  <span className="compare-stack">
                    <img src={src(items[pair[0]] ?? items[0])} alt={(items[pair[0]] ?? items[0]).title} draggable={false} />
                    <img
                      src={src(items[pair[1]] ?? items[1])}
                      alt={(items[pair[1]] ?? items[1]).title}
                      draggable={false}
                      style={difference ? { mixBlendMode: "difference", opacity: 1 } : { opacity }}
                    />
                  </span>
                </ZoomStage>
              </div>
            )}
          </>
        )}
      </section>
      {picking && board && (
        <ImagePicker
          databases={databases}
          taken={board.assetIds}
          room={LIMIT - board.assetIds.length}
          onClose={() => setPicking(false)}
          onAdd={(ids) => {
            setPicking(false);
            void save({ assetIds: [...board.assetIds, ...ids].slice(0, LIMIT) });
          }}
        />
      )}
      {deleting && (
        <Modal icon={Trash2} title={t("Eliminar mesa")} onClose={() => setDeleting(null)}>
          <div className="modal-body">
            <p>{t("Se eliminará «{name}». Las imágenes y los registros no cambian.").replace("{name}", deleting.name)}</p>
          </div>
          <footer>
            <Button onClick={() => setDeleting(null)}>{t("Cancelar")}</Button>
            <Button
              className="danger"
              onClick={() =>
                void (async () => {
                  const id = deleting.id;
                  setDeleting(null);
                  await api.call("boardDelete", { id });
                  if (board?.id === id) setBoard(null);
                  opened.current = true;
                  await refresh();
                })()
              }
            >
              {t("Eliminar")}
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

/** A frame whose content zooms with the wheel and moves by dragging. */
function ZoomStage({ view, onView, children }: { view: View; onView: (next: (v: View) => View) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  return (
    <div
      ref={ref}
      className="compare-stage"
      onWheel={(event) => {
        const box = ref.current!.getBoundingClientRect();
        // Zoom towards the pointer: the point under it stays where it is.
        const px = event.clientX - box.left - box.width / 2,
          py = event.clientY - box.top - box.height / 2,
          factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        onView((v) => {
          const scale = Math.min(12, Math.max(1, v.scale * factor)),
            k = scale / v.scale;
          return scale === 1 ? ORIGIN : { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
        });
      }}
      onPointerDown={(event: ReactPointerEvent) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (d) onView((v) => ({ ...v, x: d.vx + event.clientX - d.x, y: d.vy + event.clientY - d.y }));
      }}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => onView((v) => (v.scale > 1 ? ORIGIN : { ...v, scale: 2.5 }))}
    >
      <div className="compare-zoom" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        {children}
      </div>
    </div>
  );
}

/** Find records in any database and choose their images. */
export function ImagePicker({
  databases,
  taken,
  room,
  onClose,
  onAdd,
  title,
  action,
}: {
  databases: DatabaseSummary[];
  taken: string[];
  room: number;
  onClose: () => void;
  onAdd: (assetIds: string[]) => void;
  title?: string;
  action?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<string[]>(databases.map((d) => d.id));
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      void window.imago
        .call("search", { query, databaseIds: scope.length === databases.length ? undefined : scope, limit: 60 })
        .then((page) => !cancelled && setRows(page.rows.filter((r) => r.images.length)))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, scope, databases.length]);
  const images = rows.flatMap((row) => row.images.filter((i) => i.width > 0).map((image) => ({ row, image })));
  return (
    <Modal icon={ImagePlus} title={title ?? t("Añadir imágenes a la mesa")} onClose={onClose} wide>
      <div className="modal-body compare-picker">
        <div className="compare-picker-search">
          <label className="search-input-row">
            <Search size={16} />
            <input autoFocus value={query} placeholder={t("Buscar por título, autor, lugar, fecha…")} aria-label={t("Buscar")} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {databases.length > 1 && (
            <CriteriaSelect
              label={t("Bases de datos")}
              multiple
              options={databases.map((d) => ({ value: d.id, label: d.name }))}
              values={scope}
              onChange={setScope}
            />
          )}
        </div>
        {room > 1 && (
          <p className="hint">
            {t("Pulsa las imágenes que quieras añadir. Caben {n} más.").replace("{n}", String(room))}
          </p>
        )}
        <div className="compare-picker-grid" aria-busy={loading}>
          {images.map(({ row, image }) => {
            const used = taken.includes(image.id),
              selected = chosen.includes(image.id);
            return (
              <button
                key={image.id}
                type="button"
                className={`compare-pick ${selected ? "is-selected" : ""}`}
                disabled={used || (room > 1 && !selected && chosen.length >= room)}
                aria-pressed={selected}
                onClick={() =>
                  room === 1
                    ? setChosen(selected ? [] : [image.id])
                    : setChosen(selected ? chosen.filter((id) => id !== image.id) : [...chosen, image.id])
                }
              >
                <Thumbnail id={image.id} revision={image.revision} alt={row.title} />
                <span>{row.title}</span>
                {used && <small>{t("Ya está en la mesa")}</small>}
              </button>
            );
          })}
          {!images.length && !loading && <p className="muted">{t("Sin resultados")}</p>}
        </div>
      </div>
      <footer>
        <Button onClick={onClose}>{t("Cancelar")}</Button>
        <Button primary disabled={!chosen.length} onClick={() => onAdd(chosen)} data-testid="compare-pick-add">
          {action ?? t("Añadir")} {room > 1 && chosen.length ? `(${chosen.length})` : ""}
        </Button>
      </footer>
    </Modal>
  );
}

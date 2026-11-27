// The strip under the image viewer: the photographs of the list the record
// was opened from (a database view with its filters and order, or the search
// results), around the one on screen. The list is read in batches as the
// researcher moves along it, so a long working session goes through the whole
// filter; records without images are passed over.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { RecordRow, SearchInput } from "../../shared/imago";
import { useT } from "../i18n";
import { Thumbnail } from "./ui";

/** The list a record was opened from, and where it is in it. */
export type BrowseList = { input: SearchInput; index: number; total: number; label: string };
export type BrowseItem = { row: RecordRow; index: number; imageIndex?: number };
export type PendingBrowse = { databaseId: string; dictionaryId: string | null; revision: number };
const BATCH = 100;
const inDirection = (item: BrowseItem, from: number, direction: 1 | -1, imageIndex?: number) =>
  (item.index - from) * direction > 0 || (item.index === from &&
    item.imageIndex !== undefined && imageIndex !== undefined && (item.imageIndex - imageIndex) * direction > 0);

/**
 * The records of a browse list, read in batches around the current one; and
 * the next or previous record with an image, reading further batches when
 * needed.
 */
export function useBrowse(browse: BrowseList | null | undefined, scope: PendingBrowse | null) {
  const key = browse ? JSON.stringify([browse.input, scope]) : "";
  type Page = BrowseItem[] | null;
  const requests = useMemo(() => {
    return { key, running: new Map<number, Promise<Page>>() };
  }, [key]);
  const [cache, setCache] = useState(() => ({ requests, pages: new Map<number, Page>() }));
  if (cache.requests !== requests) setCache({ requests, pages: new Map() });
  const { pages } = cache;
  const active = useRef<typeof requests | null>(null);
  useLayoutEffect(() => {
    active.current = requests;
    return () => { active.current = null; };
  }, [requests]);
  const batch = useCallback(
    (n: number, retry = false): Promise<Page> => {
      if (active.current !== requests || !browse || n < 0 || n * BATCH >= browse.total) return Promise.resolve(null);
      const done = pages.get(n);
      if (done !== undefined && !(retry && done === null)) return Promise.resolve(done);
      const running = requests.running.get(n);
      if (running) return running;
      const remember = (items: Page) => {
        if (active.current === requests) setCache((current) => current.requests === requests
          ? { requests, pages: new Map(current.pages).set(n, items) } : current);
        return items;
      };
      const request = window.imago
        .call("search", { ...browse.input, offset: n * BATCH, limit: BATCH })
        .then(async (page) => {
          const pendingIds = scope && page.rows.length ? new Set(await window.imago.call("visualTagPending", {
            databaseId: scope.databaseId, dictionaryId: scope.dictionaryId, rowIds: page.rows.map((row) => row.id),
          })) : null;
          const items = page.rows.flatMap((row, i): BrowseItem[] => {
            const index = n * BATCH + i;
            if (!scope) return row.images.length ? [{ row, index }] : [];
            return row.images.flatMap((asset, imageIndex) => pendingIds?.has(asset.id) ? [{ row, index, imageIndex }] : []);
          });
          return remember(items);
        })
        .catch(() => scope ? remember(null) : null)
        .finally(() => requests.running.delete(n));
      requests.running.set(n, request);
      return request;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, pages, browse?.total],
  );
  // The current batch is read, and the next or previous one near its edges.
  const index = browse?.index ?? 0;
  useEffect(() => {
    if (!browse) return;
    const n = Math.floor(index / BATCH);
    void batch(n);
    if (index % BATCH >= BATCH - 20) void batch(n + 1);
    if (index % BATCH < 20) void batch(n - 1);
  }, [browse, index, batch]);
  /** The next (1) or previous (-1) record with an image from `from`, or null at the end of the list. */
  const step = useCallback(
    async (from: number, direction: 1 | -1, imageIndex?: number): Promise<BrowseItem | null> => {
      if (!browse) return null;
      for (let n = Math.floor(from / BATCH); n >= 0 && n * BATCH < browse.total; n += direction) {
        const items = await batch(n);
        if (!items || active.current !== requests) return null;
        const choices = direction === 1 ? items : [...items].reverse();
        const next = choices.find((item) => inDirection(item, from, direction, imageIndex));
        if (next) return next;
      }
      return null;
    },
    [browse, batch, requests],
  );
  // Everything read so far, in list order: the strip draws it.
  const items: BrowseItem[] = [];
  const current = Math.floor(index / BATCH);
  const ready = !!pages.get(current);
  let first = current, last = current;
  while (pages.get(first - 1)) first--;
  while (pages.get(last + 1)) last++;
  for (let n = first; n <= last; n++) items.push(...(pages.get(n) ?? []));
  const before = ready && first > 0;
  const after = ready && !!browse && (last + 1) * BATCH < browse.total;
  const more = (direction: 1 | -1) => void batch(direction === 1 ? last + 1 : first - 1);
  const canStep = (direction: 1 | -1, imageIndex?: number) =>
    (direction === 1 ? after : before) || items.some((item) => inDirection(item, index, direction, imageIndex));
  const failedBatches = (ready ? [first - 1, last + 1] : [current]).filter((n) => pages.get(n) === null);
  const retry = failedBatches.length ? () => {
    for (const n of failedBatches) void batch(n, true);
  } : undefined;
  return { items, step, more, before, after, ready, canStep, retry };
}

export function ViewerStrip({
  browse,
  items,
  currentRowId,
  currentAssetId,
  pendingOnly,
  onPendingChange,
  before,
  after,
  ready,
  onRetry,
  onOpen,
  onStep,
  canStep,
  onMore,
}: {
  browse: BrowseList;
  items: BrowseItem[];
  currentRowId: string;
  currentAssetId: string | undefined;
  pendingOnly: boolean;
  onPendingChange: (enabled: boolean) => void;
  before: boolean;
  after: boolean;
  ready: boolean;
  onRetry: (() => void) | undefined;
  onOpen: (item: BrowseItem) => void;
  /** The next (1) or previous (-1) photograph of the list, as the arrow keys. */
  onStep: (direction: 1 | -1) => void;
  canStep: (direction: 1 | -1) => boolean;
  /** Read the next (1) or previous (-1) batch: the strip reached an end. */
  onMore: (direction: 1 | -1) => void;
}) {
  const t = useT(),
    list = useRef<HTMLOListElement>(null);
  // The record on screen stays in view, centred.
  useLayoutEffect(() => {
    const node = list.current?.querySelector<HTMLElement>(".viewer-strip-item.is-current");
    node?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [currentRowId, currentAssetId, items.length]);
  useEffect(() => {
    if (!pendingOnly || !ready || items.length >= 8) return;
    if (before) onMore(-1);
    if (after) onMore(1);
  }, [pendingOnly, ready, items.length, before, after, onMore]);
  return (
    <nav className="viewer-strip" aria-label={browse.label} data-testid="viewer-strip">
      <div className="viewer-strip-head">
        <div className="viewer-strip-position">
          <span className="viewer-strip-label">{browse.label}</span>
          <span className="viewer-strip-count" data-testid="viewer-strip-count">
            {pendingOnly ? items.length === 1 ? t("1 foto sin revisar") : t("{n} fotos sin revisar").replace("{n}", items.length.toLocaleString())
              : <>{(browse.index + 1).toLocaleString()} / {browse.total.toLocaleString()}</>}
          </span>
        </div>
        <div className="viewer-strip-navigation">
          <button
            type="button"
            aria-label={t("Foto anterior")}
            aria-keyshortcuts="ArrowLeft"
            data-tooltip={t("Foto anterior (←)")}
            disabled={pendingOnly ? !canStep(-1) : browse.index <= 0}
            onClick={() => onStep(-1)}
          >
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
          <span>{t("Usa las flechas del teclado")}</span>
          <button
            type="button"
            aria-label={t("Foto siguiente")}
            aria-keyshortcuts="ArrowRight"
            data-tooltip={t("Foto siguiente (→)")}
            data-testid="viewer-strip-next"
            disabled={pendingOnly ? !canStep(1) : browse.index >= browse.total - 1}
            onClick={() => onStep(1)}
          >
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
        <label className="viewer-strip-pending" data-tooltip={t("Muestra las fotos que no tienen etiquetas validadas ni se han marcado como revisadas. Se aplica al diccionario activo.")}>
          <input type="checkbox" role="switch" checked={pendingOnly} onChange={(event) => onPendingChange(event.target.checked)} />
          {t("Solo fotos sin revisar en Etiquetas")}
        </label>
      </div>
      <ol
        ref={list}
        className="viewer-strip-items"
        onScroll={(e) => {
          // Near either end, the next batch of the list.
          const el = e.currentTarget;
          if (el.scrollLeft + el.clientWidth > el.scrollWidth - 400 && after) onMore(1);
          if (el.scrollLeft < 400 && before) onMore(-1);
        }}
      >
        {pendingOnly && (onRetry || items.length === 0) && (
          <li className="viewer-strip-empty">
            <span role="status">{t(onRetry ? "No se pudieron cargar las fotos sin revisar." : !ready || before || after
              ? "Buscando fotos sin revisar…" : "No quedan fotos sin revisar en esta lista.")}</span>
            {onRetry && <button type="button" onClick={onRetry}>{t("Reintentar")}</button>}
          </li>
        )}
        {items.map((item) => {
          const asset = item.row.images[item.imageIndex ?? 0];
          const active = item.imageIndex === undefined ? item.row.id === currentRowId : asset?.id === currentAssetId;
          const label = item.imageIndex === undefined || item.row.images.length === 1
            ? item.row.title : `${item.row.title} · ${asset?.fileName ?? item.imageIndex + 1}`;
          return (
            <li key={item.imageIndex === undefined ? item.row.id : asset.id}>
              <button
                type="button"
                className={"viewer-strip-item" + (active ? " is-current" : "")}
                aria-current={active ? "true" : undefined}
                aria-label={label}
                data-tooltip={label}
                data-testid="viewer-strip-item"
                onClick={() => onOpen(item)}
              >
                <Thumbnail id={asset?.id} revision={asset?.revision} alt={label} />
                <span>{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

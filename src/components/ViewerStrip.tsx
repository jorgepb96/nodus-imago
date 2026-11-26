// The strip under the image viewer: the photographs of the list the record
// was opened from (a database view with its filters and order, or the search
// results), around the one on screen. The list is read in batches as the
// researcher moves along it, so a long working session goes through the whole
// filter; records without images are passed over.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RecordRow, SearchInput } from "../../shared/imago";
import { useT } from "../i18n";
import { Thumbnail } from "./ui";

/** The list a record was opened from, and where it is in it. */
export type BrowseList = { input: SearchInput; index: number; total: number; label: string };
type Item = { row: RecordRow; index: number };
const BATCH = 100;
export const BROWSE_BATCH = BATCH;

/**
 * The records of a browse list, read in batches around the current one; and
 * the next or previous record with an image, reading further batches when
 * needed.
 */
export function useBrowse(browse: BrowseList | null | undefined) {
  const cache = useRef(new Map<number, RecordRow[]>()),
    pending = useRef(new Map<number, Promise<RecordRow[]>>()),
    [version, setVersion] = useState(0);
  const key = browse ? JSON.stringify(browse.input) : "";
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    // Another list: what was read belongs to the old one.
    setShownKey(key);
    cache.current = new Map();
    pending.current = new Map();
  }
  const batch = useCallback(
    (n: number): Promise<RecordRow[]> => {
      if (!browse || n < 0 || n * BATCH >= browse.total) return Promise.resolve([]);
      const done = cache.current.get(n);
      if (done) return Promise.resolve(done);
      const running = pending.current.get(n);
      if (running) return running;
      const request = window.imago
        .call("search", { ...browse.input, offset: n * BATCH, limit: BATCH })
        .then((page) => {
          cache.current.set(n, page.rows);
          pending.current.delete(n);
          setVersion((v) => v + 1);
          return page.rows;
        })
        .catch(() => {
          pending.current.delete(n);
          return [] as RecordRow[];
        });
      pending.current.set(n, request);
      return request;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, browse?.total],
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
    async (from: number, direction: 1 | -1): Promise<Item | null> => {
      if (!browse) return null;
      for (let i = from + direction, tries = 0; i >= 0 && i < browse.total && tries < 2000; i += direction, tries++) {
        const rows = await batch(Math.floor(i / BATCH));
        const row = rows[i % BATCH];
        if (row?.images.length) return { row, index: i };
      }
      return null;
    },
    [browse, batch],
  );
  // Everything read so far, in list order: the strip draws it.
  const items: Item[] = [];
  void version;
  for (const n of [...cache.current.keys()].sort((a, b) => a - b))
    cache.current.get(n)!.forEach((row, i) => row.images.length && items.push({ row, index: n * BATCH + i }));
  return { items, step, batch };
}

export function ViewerStrip({
  browse,
  items,
  currentRowId,
  onOpen,
  onStep,
  onMore,
}: {
  browse: BrowseList;
  items: Item[];
  currentRowId: string;
  onOpen: (item: Item) => void;
  /** The next (1) or previous (-1) photograph of the list, as the arrow keys. */
  onStep: (direction: 1 | -1) => void;
  /** Read the next (1) or previous (-1) batch: the strip reached an end. */
  onMore: (direction: 1 | -1) => void;
}) {
  const t = useT(),
    list = useRef<HTMLOListElement>(null);
  // The record on screen stays in view, centred.
  useLayoutEffect(() => {
    const node = list.current?.querySelector<HTMLElement>(".viewer-strip-item.is-current");
    node?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [currentRowId, items.length]);
  const first = items[0]?.index ?? 0,
    last = items.at(-1)?.index ?? 0;
  return (
    <nav className="viewer-strip" aria-label={browse.label} data-testid="viewer-strip">
      <div className="viewer-strip-head">
        <span className="viewer-strip-label">{browse.label}</span>
        <span className="viewer-strip-count" data-testid="viewer-strip-count">
          {(browse.index + 1).toLocaleString()} / {browse.total.toLocaleString()}
        </span>
        <button
          type="button"
          aria-label={t("Foto anterior")}
          data-tooltip={t("Foto anterior (←)")}
          disabled={browse.index <= 0}
          onClick={() => onStep(-1)}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          aria-label={t("Foto siguiente")}
          data-tooltip={t("Foto siguiente (→)")}
          data-testid="viewer-strip-next"
          disabled={browse.index >= browse.total - 1}
          onClick={() => onStep(1)}
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <ol
        ref={list}
        className="viewer-strip-items"
        onScroll={(e) => {
          // Near either end, the next batch of the list.
          const el = e.currentTarget;
          if (el.scrollLeft + el.clientWidth > el.scrollWidth - 400 && last < browse.total - 1) onMore(1);
          if (el.scrollLeft < 400 && first > 0) onMore(-1);
        }}
      >
        {items.map((item) => (
          <li key={item.row.id}>
            <button
              type="button"
              className={"viewer-strip-item" + (item.row.id === currentRowId ? " is-current" : "")}
              aria-current={item.row.id === currentRowId ? "true" : undefined}
              aria-label={item.row.title}
              data-tooltip={item.row.title}
              data-testid="viewer-strip-item"
              onClick={() => onOpen(item)}
            >
              <Thumbnail id={item.row.images[0]?.id} revision={item.row.images[0]?.revision} alt={item.row.title} />
              <span>{item.row.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

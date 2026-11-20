// Element records of heritage properties, loaded once per property and shared
// by every cell, the viewer, the maps and the statistics. Whoever changes them
// calls refreshHeritage so all views redraw.
import { useEffect, useSyncExternalStore } from "react";
import type { HeritageElement } from "../shared/heritage";

type Entry = { elements: Record<string, HeritageElement>; loading: boolean };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const EMPTY: Record<string, HeritageElement> = {};
let version = 0;

const emit = () => {
  version++;
  for (const listener of listeners) listener();
};

function load(columnId: string) {
  const entry = cache.get(columnId);
  if (entry?.loading) return;
  cache.set(columnId, { elements: entry?.elements ?? EMPTY, loading: true });
  void window.imago
    .call("heritageElements", { columnId })
    .then((elements) => cache.set(columnId, { elements, loading: false }))
    .catch(() => cache.set(columnId, { elements: EMPTY, loading: false }))
    .finally(emit);
}

/** Reloads one property, or all of them. */
export function refreshHeritage(columnId?: string) {
  for (const id of columnId ? [columnId] : [...cache.keys()]) {
    cache.delete(id);
    load(id);
  }
}

/** The records of a heritage property (empty while loading or for null). */
export function useHeritage(columnId: string | null | undefined): Record<string, HeritageElement> {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
  useEffect(() => {
    if (columnId && !cache.has(columnId)) load(columnId);
  }, [columnId]);
  return (columnId && cache.get(columnId)?.elements) || EMPTY;
}

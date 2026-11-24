// The side panel of the Chat (its history), comparison table and AI
// restoration sections: one width for the three, which the user drags to
// their liking and is kept on this device.
import { useCallback, useState } from "react";
import { useT } from "../i18n";

const KEY = "imago.sectionSide.width";
const DEFAULT = 360;
const MIN = 260;
const max = () => Math.max(MIN, Math.min(640, Math.round(window.innerWidth * 0.5)));
const clamp = (width: number) => Math.round(Math.max(MIN, Math.min(width, max())));

/** The shared width and a setter that keeps it (unless `save` is false, while dragging). */
export function useSectionSideWidth() {
  const [width, setWidth] = useState(() => {
    try {
      return clamp(Number(localStorage.getItem(KEY)) || DEFAULT);
    } catch {
      return DEFAULT;
    }
  });
  const resize = useCallback((next: number, save = true) => {
    const value = clamp(next);
    setWidth(value);
    if (save)
      try {
        localStorage.setItem(KEY, String(value));
      } catch {
        /* A preference only. */
      }
  }, []);
  return [width, resize] as const;
}

/**
 * The handle between a section's side panel and its content: dragging it,
 * or ← and → with the focus on it, changes the width; a double click returns
 * to the default.
 */
export function SectionSideResize({ width, onResize }: { width: number; onResize: (width: number, save?: boolean) => void }) {
  const t = useT();
  return (
    <div
      className="section-side-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Cambiar el ancho del panel lateral")}
      aria-valuenow={width}
      aria-valuemin={MIN}
      tabIndex={0}
      onDoubleClick={() => onResize(DEFAULT)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onResize(width - 24);
        if (event.key === "ArrowRight") onResize(width + 24);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const start = event.clientX,
          handle = event.currentTarget;
        handle.classList.add("is-dragging");
        document.body.classList.add("is-resizing-side");
        const move = (e: PointerEvent) => onResize(width + e.clientX - start, false);
        const up = (e: PointerEvent) => {
          handle.classList.remove("is-dragging");
          document.body.classList.remove("is-resizing-side");
          onResize(width + e.clientX - start);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}

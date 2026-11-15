import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Narrowest the expanded editor gets, however thin the column is. */
const MIN_WIDTH = 380;
/** Space the editor keeps from the window edges. */
const MARGIN = 12;

type Box = { top: number; left: number; width: number; maxHeight: number; minHeight: number };

function place(anchor: Element): Box {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(Math.max(rect.width, MIN_WIDTH), window.innerWidth - MARGIN * 2);
  const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - width - MARGIN));
  // Opens over the cell and grows downwards; near the bottom of the window it
  // moves up so there is always room to read a few lines.
  const room = 200;
  const top = Math.max(MARGIN, Math.min(rect.top, window.innerHeight - MARGIN - room));
  return {
    top,
    left,
    width,
    maxHeight: window.innerHeight - top - MARGIN,
    minHeight: rect.height,
  };
}

/**
 * Expanded editor for a table text cell, as in Notion: a panel laid over the
 * cell that shows the whole text and lets it be edited. Enter, Escape or a
 * click outside keep the text; Shift+Enter adds a line.
 */
export function TextCellPopover({
  anchor,
  label,
  value,
  onChange,
  onClose,
}: {
  anchor: Element;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const [box, setBox] = useState<Box>(() => place(anchor));
  const textarea = useRef<HTMLTextAreaElement>(null);
  const host = anchor.closest("dialog") ?? document.body;
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);
  useEffect(() => {
    // The table scrolls under a fixed panel: follow the cell, and close once
    // it has left the window.
    const follow = () => {
      const rect = anchor.getBoundingClientRect();
      if (!anchor.isConnected || rect.bottom < 0 || rect.top > window.innerHeight) onClose();
      else setBox(place(anchor));
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      className="text-cell-popover"
      style={{ top: box.top, left: box.left, width: box.width }}
    >
      <textarea
        ref={textarea}
        aria-label={label}
        value={value}
        style={{ maxHeight: box.maxHeight, minHeight: box.minHeight }}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onClose}
        onKeyDown={(event) => {
          if ((event.key === "Enter" && !event.shiftKey) || event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      />
    </div>,
    host,
  );
}

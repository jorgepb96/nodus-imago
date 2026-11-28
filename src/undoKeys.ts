// ⌘Z / Ctrl+Z undoes and ⇧⌘Z, Ctrl+Shift+Z or Ctrl+Y redoes, for whatever
// part of the window has its own history. Typing in a text field keeps the
// field's own undo, and a dialog opened on top keeps its keys.
import { useEffect, useRef } from "react";

export const UNDO_KEYS = "⌘Z / Ctrl+Z";
export const REDO_KEYS = "⇧⌘Z / Ctrl+Y";

export function undoDirection(event: KeyboardEvent): "undo" | "redo" | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey && event.ctrlKey) return "redo";
  return null;
}

/** Calls `undo` or `redo` on the shortcuts while `enabled` and no dialog is open over the window. */
export function useUndoKeys(handlers: { undo: () => void; redo: () => void; enabled?: boolean }) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || latest.current.enabled === false) return;
      const direction = undoDirection(event);
      if (!direction) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      if (document.querySelector('dialog[open],[role="dialog"]')) return;
      event.preventDefault();
      if (!event.repeat) latest.current[direction]();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
}

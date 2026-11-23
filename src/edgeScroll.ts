// While something is dragged over a box that scrolls sideways, the box moves
// gently when the pointer nears its left or right edge: slowly at first and
// faster the closer it gets, so a column can be carried to a place that is
// still off screen. Frozen columns count as part of the left edge.
import { useEffect, type RefObject } from "react";

/** Pixels per frame for a pointer at `x`, given the scrollable edges. */
export function edgeSpeed(x: number, left: number, right: number, zone = 72, max = 16): number {
  if (right - left < zone * 2) zone = Math.max(16, (right - left) / 3);
  if (x < left + zone) return -max * Math.min(1, (left + zone - x) / zone) ** 2;
  if (x > right - zone) return max * Math.min(1, (x - (right - zone)) / zone) ** 2;
  return 0;
}

export function useDragEdgeScroll(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    let x: number | null = null,
      frame = 0;
    // Where the pointer is: from what lies under it (dragover) and from the
    // dragged element itself (drag), which keeps reporting even where
    // nothing under the pointer accepts the drop. The last «drag» of some
    // browsers says 0, 0, and outside the window the scrolling stops: both
    // ignored.
    const over = (event: DragEvent) => {
      const { clientX, clientY } = event;
      if (clientX <= 0 || clientY <= 0 || clientX >= innerWidth || clientY >= innerHeight) return;
      x = clientX;
    };
    // Leaving the window stops the scrolling until the pointer comes back.
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) x = null;
    };
    const tick = () => {
      const box = ref.current;
      if (box && x !== null) {
        const rect = box.getBoundingClientRect(),
          frozen = box.querySelector(".frozen-edge")?.getBoundingClientRect().right ?? rect.left,
          speed = edgeSpeed(x, Math.max(rect.left, frozen), rect.right);
        if (speed) box.scrollLeft += speed;
      }
      frame = requestAnimationFrame(tick);
    };
    document.addEventListener("dragover", over, true);
    document.addEventListener("drag", over, true);
    document.addEventListener("dragleave", leave, true);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("dragover", over, true);
      document.removeEventListener("drag", over, true);
      document.removeEventListener("dragleave", leave, true);
    };
  }, [active, ref]);
}

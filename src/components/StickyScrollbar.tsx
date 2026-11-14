// A horizontal scrollbar that stays at the bottom of the window while a
// wide table is on screen, instead of only after its last row. It mirrors
// the table's own horizontal scroll both ways.
import { useEffect, useRef, useState, type RefObject } from "react";
import { useT } from "../i18n";

export function StickyScrollbar({ target }: { target: RefObject<HTMLElement> }) {
  const t = useT(),
    bar = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ scroll: 0, client: 0 });
  useEffect(() => {
    const element = target.current,
      track = bar.current;
    if (!element || !track) return;
    const measure = () =>
      setSize((current) =>
        current.scroll === element.scrollWidth && current.client === element.clientWidth
          ? current
          : { scroll: element.scrollWidth, client: element.clientWidth },
      );
    let syncing: "bar" | "table" | null = null;
    const fromTable = () => {
      if (syncing === "bar") return void (syncing = null);
      syncing = "table";
      track.scrollLeft = element.scrollLeft;
    };
    const fromBar = () => {
      if (syncing === "table") return void (syncing = null);
      syncing = "bar";
      element.scrollLeft = track.scrollLeft;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scroll", fromTable, { passive: true });
    track.addEventListener("scroll", fromBar, { passive: true });
    track.scrollLeft = element.scrollLeft;
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", fromTable);
      track.removeEventListener("scroll", fromBar);
    };
  }, [target]);
  const overflow = size.scroll > size.client + 1;
  return (
    <div
      ref={bar}
      className={"sticky-scrollbar" + (overflow ? "" : " is-idle")}
      aria-hidden={!overflow}
      title={overflow ? t("Desplazar la tabla en horizontal") : undefined}
    >
      <div style={{ width: size.scroll }} />
    </div>
  );
}

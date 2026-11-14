// Guided tour over the real interface, after Nodus Research's tour engine:
// each step highlights a `data-tour` control and explains it in a card next
// to it. Steps whose control is not on screen (no database yet, say) are
// skipped. Arrow keys move, Escape closes; replayable from Settings.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";

export const TOUR_VERSION = 1;

export type TourStep = {
  /** `data-tour` value of the control to highlight; none: a centred card. */
  target?: string;
  /** Where the app should be for this step. */
  area?: "home" | "databases" | "search";
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Recorrido por Nodus Imago",
    body: "En un minuto te enseño dónde está cada cosa. Usa las flechas o los botones para avanzar; puedes salir cuando quieras.",
  },
  {
    target: "nav-home",
    area: "home",
    title: "Inicio",
    body: "El resumen de tu colección: el siguiente paso recomendado, las imágenes y el estado de la indexación.",
  },
  {
    target: "collections",
    title: "Colecciones",
    body: "Tus bases de datos. Pulsa + para crear una nueva; cada una tiene sus propias propiedades.",
  },
  {
    target: "db-views",
    area: "databases",
    title: "Vistas de la base",
    body: "Los mismos registros como tabla, galería, mapa, cronología o estadísticas. Las estadísticas se guardan con la base.",
  },
  {
    target: "db-search",
    area: "databases",
    title: "Buscador de la base",
    body: "Filtra esta base por palabras exactas o por significado, en las imágenes y en las fichas, sin salir de ella.",
  },
  {
    target: "db-import",
    area: "databases",
    title: "Importar",
    body: "Añade imágenes sueltas, una carpeta completa o una tabla CSV a esta base.",
  },
  {
    target: "db-columns",
    area: "databases",
    title: "Columnas",
    body: "Arrastra una cabecera para moverla y su borde para cambiar el ancho. Con el botón derecho puedes renombrar, cambiar el tipo, filtrar, calcular, fijar u ocultar.",
  },
  {
    target: "db-automations",
    area: "databases",
    title: "Automatizaciones",
    body: "Los modelos proponen descripciones o categorías en lote. Revisas las propuestas antes de que cambien tus datos.",
  },
  {
    target: "db-agreement",
    area: "databases",
    title: "Concordancia",
    body: "Compara las etiquetas de varios modelos con las del investigador: acuerdo, índices, confusiones y casos para revisar.",
  },
  {
    target: "nav-search",
    area: "search",
    title: "Búsqueda global",
    body: "Busca en todas tus bases a la vez: literal, semántica o híbrida, con una imagen de referencia y filtros.",
  },
  {
    target: "header-queue",
    title: "Tareas",
    body: "Importaciones, descargas e indexación trabajan en segundo plano. Desde aquí ves su progreso y puedes pausarlas.",
  },
  {
    target: "nav-settings",
    title: "Ajustes",
    body: "Modelos, APIs, copias de seguridad, idioma y apariencia. Desde aquí puedes repetir la introducción y este recorrido.",
  },
  {
    title: "¡Listo!",
    body: "Empieza creando una base de datos o importando tu catálogo. Tus originales nunca se modifican.",
  },
];

type Box = { top: number; left: number; width: number; height: number };

export function GuidedTour({
  onArea,
  onClose,
}: {
  onArea: (area: NonNullable<TourStep["area"]>) => void;
  onClose: () => void;
}) {
  const t = useT(),
    [index, setIndex] = useState(0),
    [box, setBox] = useState<Box | null>(null),
    card = useRef<HTMLDivElement>(null),
    [cardPos, setCardPos] = useState<{ top: number; left: number; side: string } | null>(null);
  const step = TOUR_STEPS[index],
    last = index === TOUR_STEPS.length - 1;
  const present = (s: TourStep) =>
    !s.target || !!document.querySelector(`[data-tour="${s.target}"]`);

  // Moving, skip steps whose control is not on screen (after their area opens).
  const go = useCallback(
    (direction: 1 | -1) => {
      let next = index + direction;
      const tryStep = () => {
        if (next < 0 || next >= TOUR_STEPS.length) return;
        const s = TOUR_STEPS[next];
        if (s.area) onArea(s.area);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (present(s)) setIndex(next);
            else {
              next += direction;
              tryStep();
            }
          }),
        );
      };
      tryStep();
    },
    [index, onArea],
  );

  useLayoutEffect(() => {
    const measure = () => {
      const target = step.target
        ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
        : null;
      if (!target) {
        setBox(null);
        return;
      }
      // Only the visible part: a wide table header or a tall list is clipped
      // to its scrolling container and to the window.
      let r = target.getBoundingClientRect();
      // A tall container (the collections list) is highlighted by its content.
      if (target.dataset.tourFit === "content" && target.children.length) {
        const rects = [...target.children].map((c) => c.getBoundingClientRect());
        r = new DOMRect(
          Math.min(...rects.map((x) => x.left)),
          Math.min(...rects.map((x) => x.top)),
          Math.max(...rects.map((x) => x.right)) - Math.min(...rects.map((x) => x.left)),
          Math.max(...rects.map((x) => x.bottom)) - Math.min(...rects.map((x) => x.top)),
        );
      }
      let top = r.top,
        left = r.left,
        right = r.right,
        bottom = r.bottom;
      for (let p = target.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)) {
          r = p.getBoundingClientRect();
          top = Math.max(top, r.top);
          left = Math.max(left, r.left);
          right = Math.min(right, r.right);
          bottom = Math.min(bottom, r.bottom);
        }
      }
      top = Math.max(top, 0);
      left = Math.max(left, 0);
      right = Math.min(right, window.innerWidth);
      bottom = Math.min(bottom, window.innerHeight);
      setBox({ top: top - 6, left: left - 6, width: right - left + 12, height: bottom - top + 12 });
    };
    const target = step.target
      ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
      : null;
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const timer = setInterval(measure, 400);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      clearInterval(timer);
    };
  }, [step]);

  // The card sits beside the highlighted control, inside the window.
  useLayoutEffect(() => {
    const c = card.current;
    if (!c) return;
    const w = c.offsetWidth,
      h = c.offsetHeight,
      gap = 16,
      vw = window.innerWidth,
      vh = window.innerHeight,
      clampTop = (v: number) => Math.max(12, Math.min(vh - h - 12, v)),
      clampLeft = (v: number) => Math.max(12, Math.min(vw - w - 12, v));
    if (!box) {
      setCardPos({ top: (vh - h) / 2, left: (vw - w) / 2, side: "center" });
      return;
    }
    if (box.left + box.width + gap + w <= vw - 12)
      setCardPos({ top: clampTop(box.top), left: box.left + box.width + gap, side: "right" });
    else if (box.top + box.height + gap + h <= vh - 12)
      setCardPos({ top: box.top + box.height + gap, left: clampLeft(box.left + box.width - w), side: "below" });
    else setCardPos({ top: clampTop(box.top - h - gap), left: clampLeft(box.left), side: "above" });
  }, [box, index]);

  useEffect(() => {
    card.current?.querySelector<HTMLElement>(".tour-next")?.focus({ preventScroll: true });
  }, [index]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" && !last) go(1);
      else if (e.key === "ArrowLeft" && index > 0) go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go, index, last, onClose]);

  return (
    <div className="tour-layer">
      {box ? (
        <div
          className="tour-spotlight"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
          aria-hidden="true"
        />
      ) : (
        <div className="tour-dim" aria-hidden="true" />
      )}
      <div
        ref={card}
        className={"tour-card side-" + (cardPos?.side ?? "center")}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={cardPos ? { top: cardPos.top, left: cardPos.left } : { visibility: "hidden" }}
      >
        <header>
          <span aria-live="polite">
            {t("Recorrido")} · {index + 1}/{TOUR_STEPS.length}
          </span>
          <button type="button" className="tour-close" onClick={onClose} aria-label={t("Cerrar el recorrido")}>
            {t("Saltar")}
            <X size={13} />
          </button>
        </header>
        <h2 id="tour-title">{t(step.title)}</h2>
        <p id="tour-body">{t(step.body)}</p>
        <div className="tour-progress" aria-hidden="true">
          {TOUR_STEPS.map((_, i) => (
            <i key={i} className={i <= index ? "active" : ""} />
          ))}
        </div>
        <footer>
          {index > 0 && (
            <button type="button" className="button" onClick={() => go(-1)}>
              {t("Anterior")}
            </button>
          )}
          <button
            type="button"
            className="button primary tour-next"
            onClick={() => (last ? onClose() : go(1))}
          >
            {t(last ? "Empezar" : "Siguiente")}
          </button>
        </footer>
      </div>
    </div>
  );
}

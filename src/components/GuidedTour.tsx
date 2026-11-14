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
  area?: "home" | "databases" | "search" | "settings";
  title: string;
  body: string;
  /** One line per item when the highlighted control groups several things. */
  items?: string[];
};

// Writing rule: name what is highlighted, say what it does and how to use
// it, in plain words; no slogans or figurative phrases.
export const TOUR_STEPS: TourStep[] = [
  {
    title: "Recorrido por la pantalla",
    body: "Este recorrido señala las partes de la pantalla de Nodus Imago y explica para qué sirve cada una. Pulsa Siguiente o usa las flechas ← → del teclado. Puedes cerrarlo en cualquier momento con Saltar.",
  },
  {
    target: "nav-home",
    area: "home",
    title: "Inicio",
    body: "La página de inicio muestra el siguiente paso recomendado y el estado de tu colección: número de bases de datos, de imágenes, de imágenes preparadas para la búsqueda semántica y de tareas en curso.",
  },
  {
    target: "collections",
    title: "Lista de bases de datos",
    body: "Aquí aparecen todas tus bases de datos con su número de registros. Pulsa sobre una para abrirla. El botón + crea una base de datos nueva.",
  },
  {
    target: "db-views",
    area: "databases",
    title: "Pestañas de vista",
    body: "Estas pestañas muestran los registros de la base de datos abierta de distintas formas:",
    items: [
      "Tabla: una fila por registro y una columna por propiedad. Puedes editar las celdas directamente.",
      "Galería: una tarjeta por registro con su imagen principal.",
      "Mapa: sitúa en un mapa los registros que tienen una propiedad de ubicación.",
      "Cronología: ordena los registros por año según una propiedad de fecha.",
      "Estadísticas: calcula frecuencias, tablas cruzadas y otros análisis, y permite guardarlos.",
    ],
  },
  {
    target: "db-toolbar",
    area: "databases",
    title: "Botones de la base de datos",
    body: "Estos botones actúan sobre la base de datos abierta:",
    items: [
      "Concordancia: compara las categorías asignadas por varios modelos de IA con las que has asignado tú.",
      "Automatizaciones: hace que un modelo de IA rellene una propiedad en muchos registros a la vez. Los valores quedan como propuestas hasta que los apruebas.",
      "Propiedades visibles: elige qué columnas se muestran en la tabla y en la galería.",
      "Filtrar y ordenar: muestra solo los registros que cumplen unas condiciones y cambia su orden.",
      "Importar: añade imágenes (archivos sueltos o una carpeta) o registros desde un archivo CSV.",
      "Añadir registros: crea registros vacíos para rellenarlos a mano.",
    ],
  },
  {
    target: "db-search",
    area: "databases",
    title: "Buscador de la base de datos",
    body: "Busca solo dentro de la base de datos abierta y muestra únicamente los registros que coinciden. Con los botones de la derecha eliges el tipo de búsqueda: Literal (palabras exactas), Semántica (por significado) o Híbrida (las dos).",
  },
  {
    target: "db-columns",
    area: "databases",
    title: "Cabecera de la tabla",
    body: "Cada columna es una propiedad. Arrastra el nombre de una columna para cambiarla de sitio y arrastra su borde derecho para cambiar el ancho. Con clic derecho sobre el nombre puedes renombrarla, cambiar su tipo, filtrar, ordenar, calcular un total, fijarla u ocultarla.",
  },
  {
    target: "db-chat",
    area: "databases",
    title: "Chat junto a la base de datos",
    body: "Abre un chat a la derecha de la tabla para hacer preguntas sobre esta base de datos. Para cambiar el ancho del panel, arrastra su borde izquierdo.",
  },
  {
    target: "nav-search",
    area: "search",
    title: "Búsqueda global",
    body: "Busca en todas tus bases de datos a la vez. Además de escribir, puedes adjuntar una imagen para encontrar otras parecidas y añadir filtros por propiedades.",
  },
  {
    target: "nav-chat",
    title: "Chat",
    body: "La sección Chat guarda tus conversaciones y te deja organizarlas en carpetas. Cada conversación lee solo las bases de datos que elijas. Cuando hace falta una cifra exacta, el modelo escribe un cálculo que se ejecuta sobre todos los registros en un entorno aislado de este ordenador. Necesita un modelo de un proveedor o de Ollama o LM Studio.",
  },
  {
    target: "header-sidebar",
    title: "Mostrar u ocultar el menú lateral",
    body: "El logotipo de la esquina superior izquierda oculta el menú lateral para dejar más espacio a la tabla. Púlsalo otra vez para mostrarlo.",
  },
  {
    target: "header-interface",
    title: "Interfaz",
    body: "Abre Ajustes › Interfaz, donde cambias el idioma, el modo claro u oscuro y los colores de la aplicación.",
  },
  {
    target: "header-actions",
    title: "Botones de la barra superior",
    body: "Estos botones están siempre disponibles:",
    items: [
      "Lupa: abre la búsqueda global.",
      "Luna o sol: cambia entre el modo oscuro y el modo claro.",
      "Reloj: muestra las tareas en segundo plano (importaciones, descargas de modelos, preparación de la búsqueda) y permite pausarlas o cancelarlas. El número indica cuántas hay en curso.",
      "Engranaje: abre los Ajustes.",
    ],
  },
  {
    target: "settings-nav",
    area: "settings",
    title: "Secciones de Ajustes",
    body: "Los Ajustes están organizados en estas secciones:",
    items: [
      "Proveedores: activa las APIs externas y guarda sus claves.",
      "Modelos IA: elige qué modelo describe las imágenes, cuál clasifica y cuál se usa para la búsqueda semántica.",
      "Modelos locales: descarga, verifica y elimina los modelos que se ejecutan en este ordenador.",
      "Interfaz: idioma, modo claro u oscuro, colores, y botones para repetir la introducción y este recorrido.",
      "Rendimiento: cuántas tareas se ejecutan a la vez y cuántos recursos del ordenador pueden usar (perfil ligero, equilibrado o avanzado).",
      "Actualizaciones y novedades: comprueba si hay versiones nuevas y elige si se descargan automáticamente.",
      "Equivalencias de campos: agrupa columnas de bases de datos distintas que guardan el mismo dato, para filtrar por todas a la vez en la búsqueda global.",
      "Almacenamiento y copias: carpeta de la colección, reconstrucción de índices y copias de seguridad.",
      "Colas y tareas: lista de todas las tareas con su estado (en espera, en curso, completada o fallida). Desde aquí puedes pausarlas, reanudarlas o cancelarlas.",
    ],
  },
  {
    title: "Fin del recorrido",
    body: "Para empezar, crea una base de datos con el botón + de la lista de bases de datos, o importa un archivo CSV desde Inicio. Puedes repetir este recorrido en Ajustes › Interfaz.",
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
        {step.items && (
          <ul className="tour-items">
            {step.items.map((item) => {
              const text = t(item),
                cut = text.indexOf(":");
              return (
                <li key={item}>
                  {cut > 0 ? (
                    <>
                      <b>{text.slice(0, cut)}</b>
                      {text.slice(cut)}
                    </>
                  ) : (
                    text
                  )}
                </li>
              );
            })}
          </ul>
        )}
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

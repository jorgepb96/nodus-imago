// Guided tour over the real interface, after Nodus Research's tour engine:
// each step highlights a `data-tour` control and explains it in a card next
// to it. Steps whose control is not on screen (no database yet, say) are
// skipped. Arrow keys move, Escape closes; replayable from Settings.
//
// The same engine runs the short tutorials (src/tutorials.ts) in «strict»
// mode: there the researcher does each step on the real interface, so a
// step whose control is not on screen yet waits for it instead of being
// skipped, a step can move on by itself once the action is done (`until`),
// and the card follows the researcher into the dialogs they open.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useT } from "../i18n";

export const TOUR_VERSION = 1;

export type TourArea = "home" | "databases" | "search" | "settings" | "chat" | "compare" | "restorations";

export type TourStep = {
  /** `data-tour` value of the control to highlight; none: a centred card. */
  target?: string;
  /** Where the app should be for this step. */
  area?: TourArea;
  /** The Settings section to open with `area: "settings"`. */
  tab?: string;
  title: string;
  body: string;
  /** One line per item when the highlighted control groups several things. */
  items?: string[];
  /** Tutorials: move on by itself once this `data-tour` control appears. */
  until?: string;
  /** Tutorials: what to do when the control is not on screen yet. */
  missing?: string;
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
      "Mapa: sitúa los registros que tienen una ubicación. La pestaña Vistas repetidas reúne las fotografías tomadas desde el mismo punto, y «Entonces y ahora» busca fotografías actuales del lugar en Wikimedia Commons.",
      "Cronología: ordena los registros por año según una propiedad de fecha. Con una fecha histórica («c. 1930», «años 50») usa su periodo y muestra si es aproximada.",
      "Estadísticas: calcula frecuencias, tablas cruzadas y otros análisis, y permite guardarlos.",
      "Variantes: agrupa la misma imagen en distintos registros (copias, reproducciones, recortes) en orden de fecha.",
      "Red: muestra qué valores de dos o tres propiedades (por ejemplo, fotógrafo y lugar) aparecen juntos en los mismos registros.",
      "Mapa visual: coloca las imágenes por parecido, de modo que las que se parecen aparecen juntas; se pueden colorear por una propiedad y seleccionar por zonas.",
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
      "Completar: propone valores para los registros vacíos de una propiedad a partir de las imágenes más parecidas que sí lo tienen. Nada se guarda hasta que lo aceptas.",
      "Propiedades visibles: elige qué columnas se muestran en la tabla y en la galería.",
      "Filtrar y ordenar: muestra solo los registros que cumplen unas condiciones y cambia su orden.",
      "Importar: añade imágenes (archivos sueltos o una carpeta), registros desde un archivo CSV, un proyecto de Tropy o un manifiesto IIIF de una biblioteca digital.",
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
    body: "Cada columna es una propiedad. Arrastra el nombre de una columna para cambiarla de sitio y arrastra su borde derecho para cambiar el ancho. Con clic derecho sobre el nombre puedes renombrarla, cambiar su tipo, filtrar, ordenar, calcular un total, unificar valores escritos de formas distintas, enlazar sus valores con Wikidata o Iconclass, fijarla u ocultarla.",
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
    target: "nav-compare",
    title: "Mesa de comparación",
    body: "Pon hasta seis imágenes de cualquier base de datos juntas, con el zoom sincronizado, o superpón dos para ver qué cambia entre ellas. También puedes seleccionar registros en la galería y pulsar «Comparar».",
  },
  {
    target: "nav-restorations",
    title: "Restauraciones",
    body: "Crea versiones restauradas, reparadas o coloreadas con un modelo de imagen de OpenAI, Gemini u OpenRouter. El original no se modifica: cada versión se guarda aparte y se puede descargar con una marca de agua.",
  },
  {
    target: "nav-tutorials",
    title: "Tutoriales",
    body: "Tutoriales cortos que te guían paso a paso por una tarea concreta: adjuntar una imagen, describirla o etiquetarla con IA, situarla en el mapa, comentar una zona, comparar… Tienen buscador, y tú haces cada paso sobre la pantalla real.",
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
      "Birrete: abre los tutoriales guiados desde cualquier pantalla y muestra por dónde seguir aprendiendo.",
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
    body: "Para empezar, crea una base de datos con el botón + de la lista de bases de datos, o importa un archivo CSV desde Inicio. Puedes repetir este recorrido en Tutoriales o en Ajustes › Interfaz.",
  },
];

type Box = { top: number; left: number; width: number; height: number };

const find = (target?: string) =>
  target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;

/** The dialog on top, if any: the card has to live inside it, because an
 *  open modal dialog makes everything outside it unreachable. */
const topDialog = () =>
  [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].filter((d) => d.matches(":modal")).at(-1) ?? null;

export function GuidedTour({
  steps = TOUR_STEPS,
  label = "Recorrido",
  strict = false,
  onArea,
  onClose,
  onDone,
}: {
  steps?: TourStep[];
  /** The word before the step count in the card. */
  label?: string;
  /** Tutorial mode: wait for missing controls instead of skipping them. */
  strict?: boolean;
  onArea: (area: TourArea, tab?: string) => void;
  onClose: () => void;
  /** Called when the last step is finished (not when it is closed early). */
  onDone?: () => void;
}) {
  const t = useT(),
    [index, setIndex] = useState(0),
    [box, setBox] = useState<Box | null>(null),
    card = useRef<HTMLDivElement>(null),
    [cardPos, setCardPos] = useState<{ top: number; left: number; side: string } | null>(null),
    [host, setHost] = useState<HTMLElement | null>(null);
  const step = steps[index],
    last = index === steps.length - 1;
  const present = (s: TourStep) => !s.target || !!find(s.target);

  // A tutorial opens where its first step happens.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const first = steps[0];
    if (strict && first.area) onArea(first.area, first.tab);
  }, [strict, steps, onArea]);

  // Moving, skip steps whose control is not on screen (after their area
  // opens); a tutorial keeps them and waits for the control instead.
  const go = useCallback(
    (direction: 1 | -1) => {
      let next = index + direction;
      if (strict) {
        const s = steps[next];
        if (!s) return;
        if (s.area) onArea(s.area, s.tab);
        setIndex(next);
        return;
      }
      const tryStep = () => {
        if (next < 0 || next >= steps.length) return;
        const s = steps[next];
        if (s.area) onArea(s.area, s.tab);
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
    [index, onArea, steps, strict],
  );

  // A step done on the real interface moves on by itself.
  useEffect(() => {
    if (!step.until || last) return;
    const until = step.until;
    const timer = setInterval(() => {
      if (find(until)) {
        clearInterval(timer);
        go(1);
      }
    }, 300);
    return () => clearInterval(timer);
  }, [step, last, go]);

  useLayoutEffect(() => {
    const measure = () => {
      const dialog = topDialog();
      setHost((current) => (current === dialog ? current : dialog));
      const target = find(step.target);
      if (!target || !target.getClientRects().length) {
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
        // An open dialog is drawn above everything: what contains it in the
        // page (the record panel around the image viewer) does not clip it.
        if (p instanceof HTMLDialogElement && p.matches(":modal")) break;
      }
      top = Math.max(top, 0);
      left = Math.max(left, 0);
      right = Math.min(right, window.innerWidth);
      bottom = Math.min(bottom, window.innerHeight);
      const next = { top: top - 6, left: left - 6, width: right - left + 12, height: bottom - top + 12 };
      setBox((current) =>
        current &&
        current.top === next.top &&
        current.left === next.left &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next,
      );
    };
    find(step.target)?.scrollIntoView({ block: "nearest", inline: "nearest" });
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
      // A tutorial waiting for its control keeps out of the way, so the
      // researcher can still do the step it asks for.
      setCardPos(
        strict && step.target
          ? { top: vh - h - 20, left: vw - w - 20, side: "corner" }
          : { top: (vh - h) / 2, left: (vw - w) / 2, side: "center" },
      );
      return;
    }
    // A control that fills most of the window (the image in the viewer)
    // keeps the card in a corner instead of under it.
    if (strict && box.width > vw * 0.55 && box.height > vh * 0.55)
      setCardPos({ top: vh - h - 20, left: vw - w - 20, side: "corner" });
    else if (box.left + box.width + gap + w <= vw - 12)
      setCardPos({ top: clampTop(box.top), left: box.left + box.width + gap, side: "right" });
    else if (box.top + box.height + gap + h <= vh - 12)
      setCardPos({ top: box.top + box.height + gap, left: clampLeft(box.left + box.width - w), side: "below" });
    else if (box.left - gap - w >= 12)
      setCardPos({ top: clampTop(box.top), left: box.left - gap - w, side: "left" });
    else setCardPos({ top: clampTop(box.top - h - gap), left: clampLeft(box.left), side: "above" });
  }, [box, index, strict, step, host]);

  // The tour takes the keyboard; a tutorial leaves it to the interface the
  // researcher is using (arrows browse images, Escape closes a viewer).
  useEffect(() => {
    if (strict) return;
    card.current?.querySelector<HTMLElement>(".tour-next")?.focus({ preventScroll: true });
  }, [index, strict]);
  useEffect(() => {
    if (strict) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" && !last) go(1);
      else if (e.key === "ArrowLeft" && index > 0) go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go, index, last, onClose, strict]);

  const waiting = strict && !!step.target && !box;
  const layer = (
    <div className={"tour-layer" + (strict ? " is-tutorial" : "")} data-testid="tour-layer">
      {box ? (
        <div
          className="tour-spotlight"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
          aria-hidden="true"
        />
      ) : (
        !strict && <div className="tour-dim" aria-hidden="true" />
      )}
      <div
        ref={card}
        className={"tour-card side-" + (cardPos?.side ?? "center")}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-testid="tour-card"
        style={cardPos ? { top: cardPos.top, left: cardPos.left } : { visibility: "hidden" }}
      >
        <header>
          <span aria-live="polite">
            {t(label)} · {index + 1}/{steps.length}
          </span>
          <button type="button" className="tour-close" onClick={onClose} aria-label={t(strict ? "Salir del tutorial" : "Cerrar el recorrido")}>
            {t(strict ? "Salir" : "Saltar")}
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
        {waiting && (
          <p className="tour-waiting" data-testid="tour-waiting">
            {t(step.missing ?? "Este control aparecerá cuando hagas el paso anterior. Cuando lo veas, se iluminará.")}
          </p>
        )}
        {strict && step.until && !last && !waiting && (
          <p className="tour-waiting">{t("Cuando lo hagas, el tutorial seguirá solo.")}</p>
        )}
        <div className="tour-progress" aria-hidden="true">
          {steps.map((_, i) => (
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
            data-testid="tour-next"
            onClick={() => {
              if (!last) go(1);
              else {
                onDone?.();
                onClose();
              }
            }}
          >
            {t(last ? (strict ? "Terminar" : "Empezar") : "Siguiente")}
          </button>
        </footer>
      </div>
    </div>
  );
  return createPortal(layer, host ?? document.body);
}

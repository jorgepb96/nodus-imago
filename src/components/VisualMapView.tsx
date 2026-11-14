// Visual map: every record with an indexed image placed by visual similarity
// (similar images lie close together), coloured by a property. Zooming in
// shows the images themselves. Records outside the view's filters stay in
// place, greyed, so the map keeps its shape while filtering.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BoxSelect, Maximize, Minus, Plus } from "lucide-react";
import type { DatabaseDetail } from "../../shared/databases";
import type { SearchInput } from "../../shared/imago";
import type { VisualMap, VisualMapPoint } from "../../shared/visualMap";
import { CATEGORICAL_TYPES } from "../../shared/statistics";
import { useT, formatNumber } from "../i18n";
import { Button } from "./ui";

type View = { k: number; x: number; y: number };
const MARGIN = 28;
const THUMBS_AT = 260; // at most this many images on screen; dots beyond that.

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** Mixes two #rrggbb colours. */
function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)),
    pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
}

export function VisualMapView({
  detail,
  search,
  revision,
  onOpen,
  onSelect,
}: {
  detail: DatabaseDetail;
  search: SearchInput;
  revision: number;
  onOpen: (rowId: string) => void;
  onSelect: (rowIds: string[]) => void;
}) {
  const t = useT();
  const candidates = useMemo(
    () =>
      detail.columns.filter(
        (c) =>
          (CATEGORICAL_TYPES.includes(c.type) && c.type !== "checkbox" && c.type !== "text") ||
          c.type === "historical_date" ||
          c.type === "date" ||
          (c.type === "number" && /a[ñn]o|year|fecha|date/i.test(c.name)),
      ),
    [detail.columns],
  );
  const [colorColumnId, setColorColumnId] = useState<string>(
    () => candidates.find((c) => c.type === "historical_date")?.id ?? candidates[0]?.id ?? "",
  );
  const [map, setMap] = useState<VisualMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ point: VisualMapPoint; x: number; y: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const size = useRef({ w: 800, h: 560 });
  const images = useRef(new Map<string, HTMLImageElement>());
  const raf = useRef(0);
  /** The latest draw function, for images that finish loading later. */
  const drawLater = useRef<() => void>(() => {});
  const searchKey = JSON.stringify(search);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.imago
      .call("visualMap", { search: JSON.parse(searchKey), colorColumnId: colorColumnId || null })
      .then((m) => {
        if (cancelled) return;
        setMap(m);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [searchKey, colorColumnId, revision]);

  /** Screen position of a point (CSS pixels). */
  const toScreen = useCallback((p: { x: number; y: number }) => {
    const { w, h } = size.current,
      base = Math.min(w, h) - MARGIN * 2,
      v = view.current;
    return { sx: w / 2 + (p.x - 0.5) * base * v.k + v.x, sy: h / 2 + (p.y - 0.5) * base * v.k + v.y };
  }, []);

  const colourOf = useCallback(
    (p: VisualMapPoint, palette: { cats: string[]; low: string; high: string; none: string }) => {
      if (!map || p.value == null) return palette.none;
      if (map.mode === "category") return palette.cats[Math.min(p.value, palette.cats.length - 1)];
      if (map.mode === "year" && map.years) {
        const span = Math.max(1, map.years.max - map.years.min);
        return mix(palette.low, palette.high, Math.min(1, Math.max(0, (p.value - map.years.min) / span)));
      }
      return palette.none;
    },
    [map],
  );

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c || !map) return;
    const ctx = c.getContext("2d")!;
    const { w, h } = size.current,
      ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const palette = {
      cats: Array.from({ length: 8 }, (_, i) => css(`--viz-${i + 1}`)),
      low: css("--seq-2") || "#9ec5f4",
      high: css("--seq-7") || "#0d366b",
      none: css("--vmap-none") || "#8a8f98",
      muted: css("--vmap-muted") || "#c4c7cc",
      line: css("--panel") || "#ffffff",
    };
    const visible = map.points
      .map((p) => ({ p, ...toScreen(p) }))
      .filter(({ sx, sy }) => sx > -40 && sx < w + 40 && sy > -40 && sy < h + 40);
    const shown = visible.filter((v) => v.p.shown);
    const thumbs = shown.length <= THUMBS_AT;
    // Records outside the filters: small grey dots underneath.
    ctx.fillStyle = palette.muted;
    ctx.globalAlpha = 0.45;
    for (const v of visible) if (!v.p.shown) ctx.fillRect(v.sx - 1.5, v.sy - 1.5, 3, 3);
    ctx.globalAlpha = 1;
    if (!thumbs) {
      for (const v of shown) {
        ctx.beginPath();
        ctx.arc(v.sx, v.sy, 3.6, 0, Math.PI * 2);
        ctx.fillStyle = colourOf(v.p, palette);
        ctx.fill();
      }
      return;
    }
    // Close enough: the images, framed in their colour.
    const s = Math.max(30, Math.min(96, 22 * Math.sqrt(view.current.k)));
    for (const v of shown) {
      let img = images.current.get(v.p.assetId);
      if (!img) {
        img = new Image();
        img.decoding = "async";
        img.src = `imago://asset/${v.p.assetId}/thumb`;
        img.onload = () => {
          cancelAnimationFrame(raf.current);
          raf.current = requestAnimationFrame(() => drawLater.current());
        };
        images.current.set(v.p.assetId, img);
        if (images.current.size > 900) images.current.delete(images.current.keys().next().value!);
      }
      const colour = colourOf(v.p, palette);
      let iw = s,
        ih = s;
      if (img.complete && img.naturalWidth) {
        const r = img.naturalWidth / img.naturalHeight;
        if (r > 1) ih = s / r;
        else iw = s * r;
      }
      const x = v.sx - iw / 2,
        y = v.sy - ih / 2;
      ctx.fillStyle = colour;
      ctx.fillRect(x - 2, y - 2, iw + 4, ih + 4);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, x, y, iw, ih);
      else {
        ctx.fillStyle = palette.line;
        ctx.fillRect(x, y, iw, ih);
      }
    }
  }, [map, toScreen, colourOf]);

  useEffect(() => {
    drawLater.current = draw;
  }, [draw]);
  const redraw = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => draw());
  }, [draw]);

  useLayoutEffect(() => {
    const el = frame.current,
      c = canvas.current;
    if (!el || !c) return;
    const fit = () => {
      const r = el.getBoundingClientRect(),
        ratio = window.devicePixelRatio || 1;
      size.current = { w: r.width, h: r.height };
      c.width = Math.round(r.width * ratio);
      c.height = Math.round(r.height * ratio);
      redraw();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [redraw]);
  useEffect(() => redraw(), [redraw]);

  const pointAt = (x: number, y: number) => {
    if (!map) return null;
    const s = Math.max(30, Math.min(96, 22 * Math.sqrt(view.current.k)));
    const radius = map.points.filter((p) => p.shown).length && view.current.k > 1 ? s / 2 : 7;
    let best: VisualMapPoint | null = null,
      bestD = radius * radius;
    for (const p of map.points) {
      if (!p.shown) continue;
      const { sx, sy } = toScreen(p),
        d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d <= bestD) [best, bestD] = [p, d];
    }
    return best;
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoom = (factor: number, at?: { x: number; y: number }) => {
    const v = view.current,
      { w, h } = size.current,
      cx = at?.x ?? w / 2,
      cy = at?.y ?? h / 2;
    const k = Math.max(0.6, Math.min(80, v.k * factor)),
      f = k / v.k;
    // Keep the point under the cursor in place.
    view.current = { k, x: (v.x - (cx - w / 2)) * f + (cx - w / 2), y: (v.y - (cy - h / 2)) * f + (cy - h / 2) };
    redraw();
  };
  // The wheel zooms the map, not the page: a listener that may cancel scrolling.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  });
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; select: boolean } | null>(null);

  const legendColour = (i: number) => `var(--viz-${Math.min(i, 7) + 1})`;
  const shownCount = map?.points.filter((p) => p.shown).length ?? 0;

  return (
    <div className="visual-map stat-viz" data-testid="visual-map">
      <div className="visual-map-controls">
        <label>
          {t("Color según")}
          <select value={colorColumnId} onChange={(e) => setColorColumnId(e.target.value)}>
            <option value="">{t("Sin color")}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="visual-map-tools">
          <Button icon aria-label={t("Acercar")} data-tooltip={t("Acercar")} onClick={() => zoom(1.6)}>
            <Plus size={15} />
          </Button>
          <Button icon aria-label={t("Alejar")} data-tooltip={t("Alejar")} onClick={() => zoom(1 / 1.6)}>
            <Minus size={15} />
          </Button>
          <Button
            icon
            aria-label={t("Ver todo")}
            data-tooltip={t("Ver todo")}
            onClick={() => {
              view.current = { k: 1, x: 0, y: 0 };
              redraw();
            }}
          >
            <Maximize size={15} />
          </Button>
          <Button
            className={selecting ? "is-active" : ""}
            aria-pressed={selecting}
            data-testid="visual-map-select"
            data-tooltip={t("Arrastra sobre el mapa para seleccionar los registros de una zona (también con Mayús + arrastrar)")}
            onClick={() => setSelecting((v) => !v)}
          >
            <BoxSelect size={15} />
            {t("Seleccionar zona")}
          </Button>
        </div>
      </div>
      {map && (
        <p className="visual-map-summary">
          {t("{n} imágenes en el mapa").replace("{n}", formatNumber(map.points.length, 0))}
          {shownCount < map.points.length && ` · ${t("{n} cumplen los filtros").replace("{n}", formatNumber(shownCount, 0))}`}
          {map.missing > 0 && ` · ${t("{n} registros sin imagen indexada").replace("{n}", formatNumber(map.missing, 0))}`}
        </p>
      )}
      {error && <p className="error">{t(error)}</p>}
      <div className="visual-map-layout">
        <div
          ref={frame}
          className={`visual-map-frame${selecting ? " is-selecting" : ""}`}
        >
          <canvas
            ref={canvas}
            role="img"
            aria-label={t("Mapa visual: las imágenes parecidas aparecen juntas")}
            onPointerDown={(e) => {
              const at = local(e);
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { ...at, vx: view.current.x, vy: view.current.y, moved: false, select: selecting || e.shiftKey };
              if (drag.current.select) setBox({ x0: at.x, y0: at.y, x1: at.x, y1: at.y });
            }}
            onPointerMove={(e) => {
              const at = local(e),
                d = drag.current;
              if (d) {
                if (Math.abs(at.x - d.x) + Math.abs(at.y - d.y) > 4) d.moved = true;
                if (d.select) setBox({ x0: d.x, y0: d.y, x1: at.x, y1: at.y });
                else {
                  view.current = { ...view.current, x: d.vx + at.x - d.x, y: d.vy + at.y - d.y };
                  redraw();
                }
                setHover(null);
                return;
              }
              const point = pointAt(at.x, at.y);
              setHover(point ? { point, x: at.x, y: at.y } : null);
            }}
            onPointerUp={(e) => {
              const at = local(e),
                d = drag.current;
              drag.current = null;
              if (!d) return;
              if (d.select && d.moved && map) {
                const [x0, x1] = [Math.min(d.x, at.x), Math.max(d.x, at.x)],
                  [y0, y1] = [Math.min(d.y, at.y), Math.max(d.y, at.y)];
                const ids = map.points
                  .filter((p) => p.shown)
                  .filter((p) => {
                    const { sx, sy } = toScreen(p);
                    return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
                  })
                  .map((p) => p.rowId);
                setBox(null);
                if (ids.length) onSelect(ids);
                return;
              }
              setBox(null);
              if (!d.moved) {
                const point = pointAt(at.x, at.y);
                if (point) onOpen(point.rowId);
              }
            }}
            onPointerLeave={() => setHover(null)}
          />
          {box && (
            <span
              className="visual-map-box"
              style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
            />
          )}
          {hover && (
            <div className="visual-map-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
              <img src={`imago://asset/${hover.point.assetId}/thumb`} alt="" />
              <strong>{hover.point.title}</strong>
              {map && hover.point.value != null && (
                <small>{map.mode === "category" ? t(map.legend[hover.point.value]?.label ?? "") : String(hover.point.value)}</small>
              )}
            </div>
          )}
          {loading && !map && (
            <p className="visual-map-status" role="status">
              {t("Calculando el mapa visual… La primera vez tarda unos segundos; después se guarda.")}
            </p>
          )}
          {map && !map.points.length && !loading && (
            <p className="visual-map-status">{t("Indexa las imágenes para la búsqueda semántica: el mapa visual usa sus vectores.")}</p>
          )}
        </div>
        <aside className="visual-map-side">
          {map?.mode === "category" && (
            <ul className="visual-map-legend">
              {map.legend.map((item, i) => (
                <li key={item.label}>
                  <i style={{ background: legendColour(i) }} />
                  <span>{t(item.label)}</span>
                  <b>{formatNumber(item.count, 0)}</b>
                </li>
              ))}
            </ul>
          )}
          {map?.mode === "year" && map.years && (
            <div className="visual-map-years">
              <span className="visual-map-ramp" />
              <span>
                <b>{`≤ ${map.years.min}`}</b>
                <b>{`≥ ${map.years.max}`}</b>
              </span>
            </div>
          )}
          <p className="hint">
            {t("Las imágenes parecidas aparecen juntas. Acerca el mapa con la rueda para ver las imágenes; pulsa una para abrir su registro. Los registros que no cumplen los filtros quedan en gris.")}
          </p>
        </aside>
      </div>
    </div>
  );
}

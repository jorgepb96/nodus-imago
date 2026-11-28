// The controls of each workshop tool: sliders, the histogram, the curve and
// the handles that straighten a photograph on a book page.
import { useRef, useState } from "react";
import { FlipHorizontal2, RotateCcw, RotateCw, ScanSearch } from "lucide-react";
import type { Point, WorkshopAnalysis, WorkshopOp } from "../../shared/workshop";
import { useT } from "../i18n";
import { Button } from "./ui";

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
  help,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  help?: string;
}) {
  const t = useT();
  return (
    <label className="workshop-slider" data-tooltip={help ? t(help) : undefined}>
      <span>
        {t(label)}
        <output>{`${Number.isInteger(step) ? Math.round(value) : value.toFixed(step < 0.1 ? 2 : 1)}${unit}`}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(min < 0 ? 0 : value)} />
    </label>
  );
}

/** The luminance histogram, with the black and white points of levels when given. */
export function Histogram({ data, black, white }: { data: number[] | null; black?: number; white?: number }) {
  if (!data) return <div className="workshop-histogram is-empty" />;
  const max = Math.max(1, ...data.slice(1, 255));
  const path = data.map((v, i) => `${i},${100 - Math.min(100, (v / max) * 100)}`).join(" ");
  return (
    <svg className="workshop-histogram" viewBox="0 0 255 100" preserveAspectRatio="none" aria-hidden>
      <polygon points={`0,100 ${path} 255,100`} />
      {black !== undefined && <line x1={black} x2={black} y1={0} y2={100} className="is-black" />}
      {white !== undefined && <line x1={white} x2={white} y1={0} y2={100} className="is-white" />}
    </svg>
  );
}

/** A tone curve: drag points; click to add one, double-click to remove it. */
export function CurveEditor({ points, histogram, onChange }: { points: Point[]; histogram: number[] | null; onChange: (p: Point[]) => void }) {
  const t = useT();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: { clientX: number; clientY: number }): Point => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.round(Math.min(255, Math.max(0, ((e.clientX - r.left) / r.width) * 255))), Math.round(Math.min(255, Math.max(0, 255 - ((e.clientY - r.top) / r.height) * 255)))];
  };
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const max = histogram ? Math.max(1, ...histogram.slice(1, 255)) : 1;
  return (
    <div className="workshop-curve">
      <svg
        ref={svg}
        viewBox="0 0 255 255"
        onPointerDown={(e) => {
          if (drag !== null) return;
          const p = at(e);
          const near = points.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 12);
          if (near >= 0) setDrag(near);
          else {
            onChange([...points, p]);
            setDrag(points.length);
          }
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          const p = at(e);
          onChange(points.map((q, i) => (i === drag ? p : q)));
        }}
        onPointerUp={() => setDrag(null)}
        onDoubleClick={(e) => {
          const p = at(e);
          const near = points.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 12);
          if (near >= 0 && points.length > 2) onChange(points.filter((_, i) => i !== near));
        }}
      >
        {histogram && (
          <polygon className="workshop-curve-hist" points={`0,255 ${histogram.map((v, i) => `${i},${255 - Math.min(255, (v / max) * 255)}`).join(" ")} 255,255`} />
        )}
        {[64, 128, 192].map((g) => (
          <g key={g} className="workshop-curve-grid">
            <line x1={g} x2={g} y1={0} y2={255} />
            <line y1={g} y2={g} x1={0} x2={255} />
          </g>
        ))}
        <line className="workshop-curve-diagonal" x1={0} y1={255} x2={255} y2={0} />
        <polyline className="workshop-curve-line" points={sorted.map(([x, y]) => `${x},${255 - y}`).join(" ")} />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={255 - y} r={6} className={drag === i ? "is-dragging" : ""} />
        ))}
      </svg>
      <small className="hint">{t("Haz clic para añadir un punto, arrástralo para cambiar ese tono; doble clic para quitarlo.")}</small>
    </div>
  );
}

/**
 * The handles of «Straighten book photo», laid over the image as it is
 * before that step: the four corners and, for a curved page, the middle of
 * each side.
 */
export function StraightenEditor({
  image,
  op,
  onChange,
}: {
  image: string;
  op: Extract<WorkshopOp, { tool: "straighten" }>;
  onChange: (op: Extract<WorkshopOp, { tool: "straighten" }>) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ kind: "corner" | "bow"; i: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [tl, tr, br, bl] = op.corners;
  const sides: [Point, Point][] = [
    [tl, tr],
    [tr, br],
    [br, bl],
    [bl, tl],
  ];
  const at = (e: { clientX: number; clientY: number }): Point => {
    const r = box.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  // A side through its middle: the quadratic curve drawn the same way the warp reads it.
  const curve = (a: Point, b: Point, m: Point | null) => {
    if (!m) return `M ${a[0] * 1000} ${a[1] * 1000} L ${b[0] * 1000} ${b[1] * 1000}`;
    const c: Point = [2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2];
    return `M ${a[0] * 1000} ${a[1] * 1000} Q ${c[0] * 1000} ${c[1] * 1000} ${b[0] * 1000} ${b[1] * 1000}`;
  };
  return (
    <div className="workshop-straighten">
      <div
        ref={box}
        className="workshop-straighten-stage"
        style={size ? { aspectRatio: `${size.w} / ${size.h}` } : undefined}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = at(e);
          if (drag.kind === "corner") {
            const corners = op.corners.map((c, i) => (i === drag.i ? p : c)) as typeof op.corners;
            onChange({ ...op, corners });
          } else onChange({ ...op, bows: op.bows.map((b, i) => (i === drag.i ? p : b)) as typeof op.bows });
        }}
        onPointerUp={() => setDrag(null)}
      >
        <img src={image} alt="" draggable={false} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
          <path className="workshop-straighten-outline" d={sides.map(([a, b], i) => curve(a, b, op.bows[i])).join(" ")} />
        </svg>
        {op.corners.map((c, i) => (
          <span
            key={`c${i}`}
            className="workshop-handle is-corner"
            style={{ left: `${c[0] * 100}%`, top: `${c[1] * 100}%` }}
            onPointerDown={(e) => {
              e.currentTarget.parentElement!.setPointerCapture(e.pointerId);
              setDrag({ kind: "corner", i });
            }}
          />
        ))}
        {op.bows.map((b, i) => {
          const p = b ?? mid(...sides[i]);
          return (
            <span
              key={`b${i}`}
              className={`workshop-handle is-bow ${b ? "is-on" : ""}`}
              style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}
              onPointerDown={(e) => {
                e.currentTarget.parentElement!.setPointerCapture(e.pointerId);
                if (!b) onChange({ ...op, bows: op.bows.map((x, j) => (j === i ? p : x)) as typeof op.bows });
                setDrag({ kind: "bow", i });
              }}
              onDoubleClick={() => onChange({ ...op, bows: op.bows.map((x, j) => (j === i ? null : x)) as typeof op.bows })}
            />
          );
        })}
      </div>
    </div>
  );
}

/** The controls of one operation. */
export function ToolControls({
  op,
  onChange,
  histogram,
  analysis,
  onAnalyze,
}: {
  op: WorkshopOp;
  onChange: (op: WorkshopOp) => void;
  histogram: number[] | null;
  analysis: WorkshopAnalysis | null | "loading";
  onAnalyze: () => void;
}) {
  const t = useT();
  const set = <K extends string>(patch: Record<K, unknown>) => onChange({ ...op, ...patch } as WorkshopOp);
  switch (op.tool) {
    case "adjust":
      return (
        <div className="workshop-controls">
          <Slider label="Exposición" value={op.exposure} min={-2} max={2} step={0.05} unit=" EV" onChange={(v) => set({ exposure: v })} help="Más o menos luz en toda la imagen, como abrir o cerrar el diafragma." />
          <Slider label="Brillo" value={op.brightness} min={-100} max={100} onChange={(v) => set({ brightness: v })} />
          <Slider label="Contraste" value={op.contrast} min={-100} max={100} onChange={(v) => set({ contrast: v })} />
          <Slider label="Luces" value={op.highlights} min={-100} max={100} onChange={(v) => set({ highlights: v })} help="Oscurece (o aclara) solo las zonas claras: recupera cielos y fachadas quemadas." />
          <Slider label="Sombras" value={op.shadows} min={-100} max={100} onChange={(v) => set({ shadows: v })} help="Aclara (u oscurece) solo las zonas oscuras: deja ver lo que hay en la sombra." />
          <Slider label="Saturación" value={op.saturation} min={-100} max={100} onChange={(v) => set({ saturation: v })} />
        </div>
      );
    case "levels":
      return (
        <div className="workshop-controls">
          <Histogram data={histogram} black={op.black} white={op.white} />
          <Slider label="Negro" value={op.black} min={0} max={254} onChange={(v) => set({ black: Math.min(v, op.white - 1) })} />
          <Slider label="Blanco" value={op.white} min={1} max={255} onChange={(v) => set({ white: Math.max(v, op.black + 1) })} />
          <Slider label="Tonos medios" value={op.gamma} min={0.2} max={3} step={0.05} onChange={(v) => set({ gamma: v })} />
          {histogram && (
            <Button
              onClick={() => {
                const n = histogram.reduce((a, b) => a + b, 0);
                let acc = 0,
                  low = 0,
                  high = 255;
                for (let v = 0; v < 256; v++) if ((acc += histogram[v]) >= n * 0.005) ((low = v), (v = 256));
                acc = 0;
                for (let v = 255; v >= 0; v--) if ((acc += histogram[v]) >= n * 0.005) ((high = v), (v = -1));
                set({ black: low, white: Math.max(high, low + 10) });
              }}
            >
              {t("Automático")}
            </Button>
          )}
        </div>
      );
    case "curve":
      return <CurveEditor points={op.points} histogram={histogram} onChange={(points) => set({ points })} />;
    case "sharpen":
      return (
        <div className="workshop-controls">
          <Slider label="Cantidad" value={op.amount} min={0} max={100} onChange={(v) => set({ amount: v })} />
          <Slider label="Radio" value={op.radius} min={0.3} max={5} step={0.1} unit=" px" onChange={(v) => set({ radius: v })} />
        </div>
      );
    case "denoise":
    case "clahe":
      return (
        <div className="workshop-controls">
          <Slider label="Intensidad" value={op.strength} min={0} max={100} onChange={(v) => set({ strength: v })} />
          {op.tool === "denoise" && op.strength > 66 && <p className="hint upscale-warn">{t("Con esta intensidad se pierde detalle fino: compara con el original.")}</p>}
        </div>
      );
    case "edges":
      return (
        <div className="workshop-controls">
          <Slider label="Intensidad" value={op.strength} min={0} max={100} onChange={(v) => set({ strength: v })} />
        </div>
      );
    case "descreen":
      return (
        <div className="workshop-controls">
          <div className="workshop-detect">
            <Button onClick={onAnalyze} disabled={analysis === "loading"}>
              <ScanSearch size={13} />
              {t(analysis === "loading" ? "Buscando la trama…" : "Detectar la trama")}
            </Button>
            {analysis && analysis !== "loading" && (
              <small>
                {analysis.screen
                  ? t("Trama encontrada cada {p} px").replace("{p}", analysis.screen.period.toFixed(1).replace(".", ","))
                  : t("No se aprecia una trama regular: prueba a mano.")}
              </small>
            )}
          </div>
          <Slider label="Tamaño de la trama" value={op.period} min={2} max={14} step={0.1} unit=" px" onChange={(v) => set({ period: v })} help="La distancia entre los puntos de la trama, en píxeles de la imagen original." />
          <Slider label="Intensidad" value={op.strength} min={0} max={100} onChange={(v) => set({ strength: v })} />
          <p className="hint">{t("En imágenes grandes, la primera vista previa tarda unos segundos: se procesa a tamaño completo para no confundir la trama con la reducción.")}</p>
        </div>
      );
    case "rotate":
      return (
        <div className="workshop-controls">
          <div className="row">
            <Button icon aria-label={t("Girar a la izquierda")} data-tooltip={t("Girar a la izquierda")} onClick={() => set({ quarter: ((op.quarter + 270) % 360) as 0 | 90 | 180 | 270 })}>
              <RotateCcw size={14} />
            </Button>
            <Button icon aria-label={t("Girar a la derecha")} data-tooltip={t("Girar a la derecha")} onClick={() => set({ quarter: ((op.quarter + 90) % 360) as 0 | 90 | 180 | 270 })}>
              <RotateCw size={14} />
            </Button>
            <Button className={op.flip ? "is-on" : ""} aria-pressed={op.flip} onClick={() => set({ flip: !op.flip })}>
              <FlipHorizontal2 size={14} />
              {t("Voltear")}
            </Button>
          </div>
          <Slider label="Enderezar" value={op.angle} min={-15} max={15} step={0.1} unit="°" onChange={(v) => set({ angle: v })} help="Corrige una foto torcida; se recortan los bordes vacíos." />
        </div>
      );
    case "crop":
      return <p className="hint">{t("Arrastra sobre la imagen el recuadro que quieres conservar.")}</p>;
    case "straighten":
      return (
        <div className="workshop-controls">
          <p className="hint">{t("Arrastra los cuatro puntos redondos a las esquinas de la foto. Si la página se curva, arrastra también el punto central de cada lado hasta el borde curvado (doble clic lo vuelve recto).")}</p>
        </div>
      );
    case "falsecolor":
      return (
        <div className="workshop-controls">
          <label className="restoration-field">
            {t("Paleta")}
            <select value={op.palette} onChange={(e) => set({ palette: e.target.value })}>
              <option value="thermal">{t("Térmica")}</option>
              <option value="viridis">Viridis</option>
              <option value="spectrum">{t("Espectro")}</option>
            </select>
          </label>
        </div>
      );
    case "channel":
      return (
        <div className="upscale-scale">
          {(["r", "g", "b"] as const).map((c) => (
            <button key={c} type="button" className={op.channel === c ? "is-selected" : ""} onClick={() => set({ channel: c })}>
              <strong>{c === "r" ? t("Rojo") : c === "g" ? t("Verde") : t("Azul")}</strong>
            </button>
          ))}
        </div>
      );
    default:
      return <p className="hint">{t("Sin ajustes: se aplica tal cual.")}</p>;
  }
}

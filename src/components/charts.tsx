// Small chart set for the Statistics view: horizontal bars, columns, lines
// and a heatmap. Colours come from the validated palette in index.css
// (.stat-viz): categorical slots in fixed order, a one-hue sequential ramp,
// and a blue/red diverging scale with a grey midpoint. Every mark has a
// hover tooltip; text uses the interface inks, never a series colour.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { uiLocale } from "../i18n";

const format = (n: number) =>
  n.toLocaleString(uiLocale(), { maximumFractionDigits: 2 });

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null),
    [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, Math.round(entry.contentRect.width))),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round "nice" ticks for an axis from 0 to max. */
function ticks(max: number, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count,
    power = 10 ** Math.floor(Math.log10(raw)),
    step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

export function BarList({
  items,
  valueLabel = (v: number) => format(v),
}: {
  items: { label: string; value: number; note?: string }[];
  valueLabel?: (value: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="bar-list" role="list">
      {items.map((item) => (
        <div
          key={item.label}
          className="bar-row"
          role="listitem"
          data-tooltip={`${item.label} · ${valueLabel(item.value)}${item.note ? ` · ${item.note}` : ""}`}
          data-tooltip-instant=""
        >
          <span className="bar-label" title={item.label}>
            {item.label}
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span className="bar-value">{valueLabel(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function ColumnChart({
  items,
  label,
}: {
  items: { label: string; value: number }[];
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(),
    height = 240,
    left = 44,
    bottom = 28,
    top = 10,
    axis = ticks(Math.max(1, ...items.map((i) => i.value))),
    max = axis[axis.length - 1] || 1,
    plot = width - left - 8,
    slot = plot / Math.max(1, items.length),
    gap = Math.min(2, slot * 0.2),
    bar = Math.max(1, slot - gap),
    y = (v: number) => top + (height - top - bottom) * (1 - v / max),
    every = Math.max(1, Math.ceil(items.length / Math.floor(plot / 56)));
  return (
    <div ref={ref} className="stat-chart">
      <svg width={width} height={height} role="img" aria-label={label}>
        {axis.map((v) => (
          <g key={v}>
            <line className="grid" x1={left} x2={width - 8} y1={y(v)} y2={y(v)} />
            <text className="tick" x={left - 6} y={y(v)} dy="0.32em" textAnchor="end">
              {format(v)}
            </text>
          </g>
        ))}
        {items.map((item, i) => {
          const x = left + i * slot + gap / 2,
            h = Math.max(0, y(0) - y(item.value)),
            r = Math.min(4, bar / 2, h);
          return (
            <g key={item.label} data-tooltip={`${item.label} · ${format(item.value)}`} data-tooltip-instant="">
              {/* Hit target taller than the mark. */}
              <rect x={left + i * slot} y={top} width={slot} height={height - top - bottom} fill="transparent" />
              {h > 0 && (
                <path
                  className="mark"
                  d={`M${x},${y(0)} V${y(item.value) + r} Q${x},${y(item.value)} ${x + r},${y(item.value)} H${x + bar - r} Q${x + bar},${y(item.value)} ${x + bar},${y(item.value) + r} V${y(0)} Z`}
                />
              )}
              {i % every === 0 && (
                <text className="tick" x={x + bar / 2} y={height - bottom + 16} textAnchor="middle">
                  {item.label}
                </text>
              )}
            </g>
          );
        })}
        <line className="baseline" x1={left} x2={width - 8} y1={y(0)} y2={y(0)} />
      </svg>
    </div>
  );
}

export function LineChart({
  labels,
  series,
  label,
}: {
  labels: string[];
  series: { label: string; values: number[] }[];
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(),
    [hover, setHover] = useState<number | null>(null),
    height = 260,
    left = 44,
    right = series.length > 1 && series.length <= 4 ? 110 : 12,
    bottom = 28,
    top = 12,
    axis = ticks(Math.max(1, ...series.flatMap((s) => s.values))),
    max = axis[axis.length - 1] || 1,
    plot = width - left - right,
    x = (i: number) => left + (labels.length > 1 ? (plot * i) / (labels.length - 1) : plot / 2),
    y = (v: number) => top + (height - top - bottom) * (1 - v / max),
    every = Math.max(1, Math.ceil(labels.length / Math.floor(plot / 56)));
  return (
    <div ref={ref} className="stat-chart">
      {series.length > 1 && <Legend items={series.map((s) => s.label)} />}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect(),
            px = e.clientX - box.left;
          if (px < left - 10 || px > left + plot + 10) return setHover(null);
          setHover(Math.max(0, Math.min(labels.length - 1, Math.round(((px - left) / plot) * (labels.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {axis.map((v) => (
          <g key={v}>
            <line className="grid" x1={left} x2={left + plot} y1={y(v)} y2={y(v)} />
            <text className="tick" x={left - 6} y={y(v)} dy="0.32em" textAnchor="end">
              {format(v)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 ? (
            <text key={l} className="tick" x={x(i)} y={height - bottom + 16} textAnchor="middle">
              {l}
            </text>
          ) : null,
        )}
        <line className="baseline" x1={left} x2={left + plot} y1={y(0)} y2={y(0)} />
        {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={top} y2={y(0)} />}
        {series.map((s, si) => (
          <g key={s.label} className={`series s${(si % 8) + 1}`}>
            <polyline
              className="line"
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            />
            {hover !== null && <circle className="dot" cx={x(hover)} cy={y(s.values[hover])} r={4} />}
            {right > 12 && (
              <text className="direct-label" x={left + plot + 8} y={y(s.values[s.values.length - 1])} dy="0.32em">
                {s.label.length > 14 ? s.label.slice(0, 13) + "…" : s.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div
          className="chart-tooltip"
          style={{ left: Math.min(x(hover) + 12, width - 180), top: top + 4 }}
          role="status"
        >
          <strong>{labels[hover]}</strong>
          {series.map((s, si) => (
            <span key={s.label}>
              <i className={`swatch s${(si % 8) + 1}`} />
              {s.label}
              <b>{format(s.values[hover])}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: string[] }) {
  return (
    <ul className="chart-legend">
      {items.map((item, i) => (
        <li key={item}>
          <i className={`swatch s${(i % 8) + 1}`} />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Sequential (0…max) or diverging (−3…+3) shading of a table of values. */
export function Heatmap({
  rows,
  cols,
  values,
  display,
  scale,
  tooltip,
  corner,
}: {
  rows: string[];
  cols: string[];
  values: number[][];
  display: (value: number, i: number, j: number) => string;
  scale: "sequential" | "diverging";
  tooltip: (i: number, j: number) => string;
  corner?: ReactNode;
}) {
  const max = Math.max(1e-9, ...values.flat().map(Math.abs));
  const step = (v: number) =>
    scale === "sequential"
      ? v <= 0
        ? 0
        : Math.min(7, 1 + Math.floor((v / max) * 6.999))
      : // ±1.96 is the 5 % threshold; ±3.29 the 0.1 % one.
        Math.sign(v) * (Math.abs(v) < 1.96 ? (Math.abs(v) < 1 ? 0 : 1) : Math.abs(v) < 3.29 ? 2 : 3);
  return (
    <div className="heatmap-scroll">
      <table className={`heatmap ${scale}`}>
        <thead>
          <tr>
            <th>{corner}</th>
            {cols.map((c) => (
              <th key={c} scope="col">
                <span title={c}>{c}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r}>
              <th scope="row">
                <span title={r}>{r}</span>
              </th>
              {cols.map((c, j) => (
                <td
                  key={c}
                  data-step={step(values[i][j])}
                  data-tooltip={tooltip(i, j)}
                  data-tooltip-instant=""
                >
                  {display(values[i][j], i, j)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

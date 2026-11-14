// Network of relations: which values of two or three properties (for example
// photographer, place and subject) appear together in the same records.
// Node size: records with that value. Line width: records they share.
import { useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import type { DatabaseDetail } from "../../shared/databases";
import type { SearchInput } from "../../shared/imago";
import type { Network, NetworkNode } from "../../shared/network";
import { CATEGORICAL_TYPES } from "../../shared/statistics";
import { useT, formatNumber } from "../i18n";
import { Button } from "./ui";
import { CriteriaSelect } from "./CriteriaSelect";

import { layout, NETWORK_HEIGHT as H, NETWORK_WIDTH as W } from "../networkLayout";

export function NetworkView({
  detail,
  search,
  revision,
  onFilter,
}: {
  detail: DatabaseDetail;
  search: SearchInput;
  revision: number;
  onFilter: (node: NetworkNode) => void;
}) {
  const t = useT();
  const candidates = detail.columns.filter((c) => CATEGORICAL_TYPES.includes(c.type) && c.type !== "checkbox" && c.type !== "text");
  const [columnIds, setColumnIds] = useState<string[]>(() => {
    const ranked = [...candidates].sort(
      (a, b) => Number(/autor|fot[oó]grafo|cr[eé]dito|lugar|tema|place|author|subject/i.test(b.name)) - Number(/autor|fot[oó]grafo|cr[eé]dito|lugar|tema|place|author|subject/i.test(a.name)),
    );
    return ranked.slice(0, 2).map((c) => c.id);
  });
  const [minWeight, setMinWeight] = useState(3);
  const [years, setYears] = useState<{ columnId: string; name: string } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [network, setNetwork] = useState<Network | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    void window.imago
      .call("timelineCandidates", { databaseId: detail.database.id })
      .then((list) => setYears(list[0] ? { columnId: list[0].columnId, name: list[0].name } : null))
      .catch(() => {});
  }, [detail.database.id]);
  const searchKey = JSON.stringify(search);
  useEffect(() => {
    if (columnIds.length < 2) {
      setNetwork(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void window.imago
        .call("network", {
          search: JSON.parse(searchKey),
          columnIds,
          minWeight,
          yearColumnId: years?.columnId ?? null,
          from: from ? Number(from) : null,
          to: to ? Number(to) : null,
        })
        .then((n) => {
          if (cancelled) return;
          setNetwork(n);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchKey, columnIds, minWeight, years, from, to, revision]);
  const placed = useMemo(() => (network ? layout(network, columnIds) : []), [network, columnIds]);
  const byId = useMemo(() => new Map(placed.map((n) => [n.id, n])), [placed]);
  const focus = hover ?? selected;
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!focus || !network) return set;
    for (const e of network.edges) {
      if (e.source === focus) set.add(e.target);
      if (e.target === focus) set.add(e.source);
    }
    return set;
  }, [focus, network]);
  const maxWeight = Math.max(1, ...(network?.edges.map((e) => e.weight) ?? [1]));
  const colour = (columnId: string) => `var(--viz-${columnIds.indexOf(columnId) + 1})`;
  const labelled = new Set([...placed].sort((a, b) => b.count - a.count).slice(0, 28).map((n) => n.id));
  const chosen = selected ? byId.get(selected) : null;
  const connections = chosen && network
    ? network.edges
        .filter((e) => e.source === chosen.id || e.target === chosen.id)
        .map((e) => ({ node: byId.get(e.source === chosen.id ? e.target : e.source)!, weight: e.weight }))
        .sort((a, b) => b.weight - a.weight)
    : [];

  return (
    <div className="network-view stat-viz" data-testid="network-view">
      <div className="network-controls">
        <label>
          {t("Propiedades (2 o 3)")}
          <CriteriaSelect
            label={t("Propiedades de la red")}
            multiple
            options={candidates.map((c) => ({ value: c.id, label: c.name }))}
            values={columnIds}
            onChange={(values) => setColumnIds(values.slice(0, 3))}
          />
        </label>
        <label>
          {t("Registros en común (mínimo)")}
          <input type="number" min={1} value={minWeight} onChange={(e) => setMinWeight(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        {years && (
          <label>
            {t("Periodo")} ({years.name})
            <span className="network-years">
              <input inputMode="numeric" placeholder={t("desde")} value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              –
              <input inputMode="numeric" placeholder={t("hasta")} value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, "").slice(0, 4))} />
            </span>
          </label>
        )}
      </div>
      {columnIds.length < 2 && <p className="hint">{t("Elige al menos dos propiedades, por ejemplo el fotógrafo y el lugar.")}</p>}
      {error && <p className="error">{t(error)}</p>}
      {network && (
        <p className="network-summary">
          {t("{r} registros · {n} valores · {e} relaciones").replace("{r}", formatNumber(network.records, 0)).replace("{n}", String(network.nodes.length)).replace("{e}", String(network.edges.length))}
          {network.hidden > 0 && ` · ${t("{h} valores poco frecuentes o sin relaciones no se muestran").replace("{h}", formatNumber(network.hidden, 0))}`}
        </p>
      )}
      <div className="network-layout">
        <svg viewBox={`0 0 ${W} ${H}`} className="network-svg" role="img" aria-label={t("Red de relaciones")}>
          {network?.edges.map((e) => {
            const a = byId.get(e.source)!,
              b = byId.get(e.target)!;
            const active = !focus || e.source === focus || e.target === focus;
            return (
              <line
                key={e.source + e.target}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="network-edge"
                strokeWidth={0.6 + (e.weight / maxWeight) * 6}
                opacity={active ? 0.55 : 0.06}
              >
                <title>{`${a.label} — ${b.label}: ${e.weight}`}</title>
              </line>
            );
          })}
          {placed.map((n) => {
            const dim = focus && n.id !== focus && !neighbours.has(n.id);
            return (
              <g
                key={n.id}
                className={`network-node ${selected === n.id ? "is-selected" : ""}`}
                opacity={dim ? 0.18 : 1}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setSelected(selected === n.id ? null : n.id)}
                data-tooltip={`${n.label} · ${n.property} · ${n.count} ${t("registros")}`}
                data-tooltip-instant=""
              >
                <circle cx={n.x} cy={n.y} r={n.r} fill={colour(n.columnId)} />
              </g>
            );
          })}
          {/* Labels on top of every circle, with a halo in the background colour. */}
          <g className="network-labels" aria-hidden="true">
            {placed
              .filter((n) => labelled.has(n.id) || n.id === focus || neighbours.has(n.id))
              .map((n) => (
                <text
                  key={n.id}
                  x={n.x}
                  y={n.y + n.r + 12}
                  textAnchor="middle"
                  className="network-label"
                  opacity={focus && n.id !== focus && !neighbours.has(n.id) ? 0.25 : 1}
                >
                  {n.label.length > 24 ? n.label.slice(0, 23) + "…" : n.label}
                </text>
              ))}
          </g>
        </svg>
        <aside className="network-side">
          <div className="network-legend">
            {columnIds.map((id) => (
              <span key={id}>
                <i style={{ background: colour(id) }} />
                {detail.columns.find((c) => c.id === id)?.name}
              </span>
            ))}
          </div>
          {chosen ? (
            <div className="network-detail" data-testid="network-detail">
              <strong>{chosen.label}</strong>
              <small>
                {chosen.property} · {chosen.count} {t("registros")}
              </small>
              <Button onClick={() => onFilter(chosen)}>
                <Filter size={13} />
                {t("Ver sus registros")}
              </Button>
              <h3>{t("Aparece con")}</h3>
              <ol>
                {connections.slice(0, 15).map((c) => (
                  <li key={c.node.id}>
                    <button type="button" onClick={() => setSelected(c.node.id)}>
                      <i style={{ background: colour(c.node.columnId) }} />
                      <span>{c.node.label}</span>
                      <b>{c.weight}</b>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="hint">{t("Pulsa un valor para ver con qué otros aparece y cuántos registros comparten.")}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

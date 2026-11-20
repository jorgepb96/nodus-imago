// The heritage map: one point per element with its own coordinates, with the
// icon of its typology and a size that grows with the number of records of
// the view that show it. Filters by group and type, counts parts in their
// wholes on request, and lists the photographs of the element chosen.
import { useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ExternalLink, Landmark, X } from "lucide-react";
import type { DatabaseColumn, DatabaseDetail } from "../../shared/databases";
import type { HeritageMapElement, MapRecord, PropertyFilter, PropertyFilterGroup, ViewSort } from "../../shared/imago";
import { heritageScheme, typology } from "../../shared/heritage";
import { formatNumber, useLanguage, useT } from "../i18n";
import { Button, Spinner, Thumbnail } from "./ui";
import { HeritageIcon } from "./HeritageIcon";

export function HeritageMap({
  detail,
  column,
  filters,
  groups,
  sorts,
  logic,
  revision,
  onOpen,
}: {
  detail: DatabaseDetail;
  column: DatabaseColumn;
  filters: PropertyFilter[];
  groups: PropertyFilterGroup[];
  sorts: ViewSort[];
  logic: "and" | "or";
  revision: number;
  onOpen: (id: string) => void;
}) {
  const t = useT(),
    language = useLanguage();
  const scheme = heritageScheme(column.config);
  const [includeParts, setIncludeParts] = useState(false);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ elements: HeritageMapElement[]; unplaced: number; records: number } | null>(null);
  const [records, setRecords] = useState<Map<string, MapRecord>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const element = useRef<HTMLDivElement>(null),
    mapRef = useRef<L.Map | null>(null),
    layer = useRef<L.LayerGroup | null>(null),
    framed = useRef("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const query = { databaseId: detail.database.id, columnId: column.id, filters, filterLogic: logic, filterGroups: groups, sorts };
    void Promise.all([
      window.imago.call("heritageMap", { ...query, includeParts }),
      window.imago.call("mapRecords", { ...query, fallbackColumnId: null }),
    ])
      .then(([map, rows]) => {
        if (cancelled) return;
        setError("");
        setResult(map);
        setRecords(new Map(rows.records.map((r) => [r.id, r])));
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [detail.database.id, column.id, filters, groups, sorts, logic, includeParts, revision]);

  const shown = useMemo(
    () => (result?.elements ?? []).filter((e) => !e.group || !hiddenGroups.has(e.group)).filter((e) => e.group || !hiddenGroups.has("")),
    [result, hiddenGroups],
  );
  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of result?.elements ?? []) counts.set(e.group ?? "", (counts.get(e.group ?? "") ?? 0) + 1);
    return [...scheme.groups.map((g) => g.key), ""].filter((k) => counts.has(k)).map((k) => ({ key: k, count: counts.get(k)! }));
  }, [result, scheme]);

  useEffect(() => {
    if (!element.current || mapRef.current) return;
    const map = L.map(element.current, { zoomControl: true, worldCopyJump: true }).setView([40.4, -3.7], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layer.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current,
      group = layer.current;
    if (!map || !group) return;
    group.clearLayers();
    const max = Math.max(1, ...shown.map((e) => e.count));
    for (const e of shown) {
      const info = typology(scheme, e.group, e.type, language);
      const size = Math.round(26 + 26 * Math.sqrt(e.count / max));
      const html = renderToStaticMarkup(
        <span className={`heritage-map-pin ${selected === e.optionId ? "is-selected" : ""}`} style={{ width: size, height: size }}>
          <HeritageIcon name={info?.icon} size={Math.round(size * 0.45)} />
          <b>{e.count}</b>
        </span>,
      );
      const label = `${e.label} · ${e.count} ${t("registros")}`;
      L.marker([e.latitude, e.longitude], {
        icon: L.divIcon({ className: "heritage-map-marker", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        title: label,
        alt: label,
        keyboard: true,
        zIndexOffset: e.count,
      })
        .on("click", () => setSelected(e.optionId))
        .addTo(group);
    }
    const key = JSON.stringify([column.id, filters, groups, logic]);
    if (shown.length && framed.current !== key) {
      framed.current = key;
      map.fitBounds(L.latLngBounds(shown.map((e) => [e.latitude, e.longitude] as [number, number])).pad(0.15), { maxZoom: 15 });
    }
  }, [shown, selected, scheme, language, t, column.id, filters, groups, logic]);

  const current = shown.find((e) => e.optionId === selected) ?? null;
  const labels = useMemo(() => new Map(column.options.map((o) => [o.id, o.label])), [column.options]);

  return (
    <div className="heritage-map" data-testid="heritage-map">
      <div className="heritage-map-toolbar">
        <label className="check-label">
          <input type="checkbox" checked={includeParts} onChange={(e) => setIncludeParts(e.target.checked)} />
          {t("Incluir sus partes")}
        </label>
        <span className="map-record-count" role="status">
          {loading ? (
            <Spinner />
          ) : (
            <>
              <b>{formatNumber(shown.length, 0)}</b> {t("elementos en el mapa")} · {formatNumber(result?.records ?? 0, 0)} {t("registros con patrimonio")}
              {(result?.unplaced ?? 0) > 0 && ` · ${formatNumber(result!.unplaced, 0)} ${t("elementos sin situar")}`}
            </>
          )}
        </span>
      </div>
      {legend.length > 0 && (
        <div className="heritage-map-legend" role="group" aria-label={t("Tipologías")}>
          {legend.map(({ key, count }) => {
            const g = scheme.groups.find((x) => x.key === key);
            const off = hiddenGroups.has(key);
            return (
              <button
                key={key || "none"}
                type="button"
                aria-pressed={!off}
                className={off ? "is-off" : ""}
                onClick={() =>
                  setHiddenGroups((all) => {
                    const next = new Set(all);
                    if (off) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              >
                <HeritageIcon name={g?.icon ?? "Landmark"} size={13} />
                {g ? (language === "en" ? g.labelEn || g.label : g.label) : t("Sin tipología")}
                <small>{count}</small>
              </button>
            );
          })}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="database-map-layout">
        <div className="database-map-canvas-wrap">
          <div className="database-map-canvas heritage-map-canvas" ref={element} />
        </div>
        <aside className="database-map-records heritage-map-side" aria-label={t("Elementos")}>
          {current ? (
            <div className="heritage-map-element">
              <header>
                <HeritageIcon name={typology(scheme, current.group, current.type, language)?.icon} size={18} />
                <strong>{current.label}</strong>
                <Button icon aria-label={t("Cerrar")} onClick={() => setSelected(null)}>
                  <X size={14} />
                </Button>
              </header>
              <small className="muted">
                {[
                  typology(scheme, current.group, current.type, language)?.type,
                  current.parentId && `${t("Forma parte de")} ${labels.get(current.parentId) ?? ""}`,
                  `${formatNumber(current.count, 0)} ${t("registros")}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              <ul className="heritage-map-rows">
                {current.rowIds.map((id) => {
                  const r = records.get(id);
                  return (
                    <li key={id}>
                      <button type="button" onClick={() => onOpen(id)}>
                        <Thumbnail id={r?.image?.id} revision={r?.image?.revision} alt={r?.title ?? ""} />
                        <span>{r?.title ?? id.slice(0, 8)}</span>
                        <ExternalLink size={12} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <ul className="heritage-map-list">
              {!shown.length && !loading && (
                <li className="muted">
                  <Landmark size={14} /> {t("Ningún elemento de esta vista tiene coordenadas. Complétalas en las fichas de patrimonio.")}
                </li>
              )}
              {shown.slice(0, 300).map((e) => (
                <li key={e.optionId}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(e.optionId);
                      mapRef.current?.setView([e.latitude, e.longitude], Math.max(mapRef.current.getZoom(), 15));
                    }}
                  >
                    <HeritageIcon name={typology(scheme, e.group, e.type)?.icon} size={14} />
                    <span>{e.label}</span>
                    <small>{formatNumber(e.count, 0)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Focus, MapPin, X } from "lucide-react";
import type { DatabaseDetail } from "../../shared/databases";
import type {
  MapRecord,
  PropertyFilter,
  PropertyFilterGroup,
  ViewSort,
} from "../../shared/imago";
import {
  clusterMapRecords,
  locatedRecords,
  type LocatedMapRecord,
} from "../../shared/mapClusters";
import { useT } from "../i18n";
import { Button, Spinner, Thumbnail } from "./ui";
import { CriteriaSelect } from "./CriteriaSelect";

function RecordMapCanvas({
  records,
  onSelect,
  focusIds,
  fitRequest,
}: {
  records: LocatedMapRecord[];
  onSelect: (ids: string[]) => void;
  focusIds: string[] | null;
  fitRequest: number;
}) {
  const element = useRef<HTMLDivElement>(null),
    mapRef = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null),
    tiles = useRef<L.TileLayer | null>(null);
  const current = useRef(records),
    select = useRef(onSelect),
    redraw = useRef<() => void>(() => {});
  const fitted = useRef("");
  const [ready, setReady] = useState(0),
    [online, setOnline] = useState(navigator.onLine);
  const [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0),
    [linkError, setLinkError] = useState(false);
  const t = useT(),
    recordLabel = t("registros");
  useEffect(() => {
    current.current = records;
    select.current = onSelect;
  }, [records, onSelect]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    const container = element.current!;
    const resize = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      if (mapRef.current) {
        mapRef.current.invalidateSize({ pan: true });
        return;
      }
      const map = L.map(container, {
        minZoom: 2,
        maxZoom: 19,
        worldCopyJump: true,
      }).setView([20, 0], 2);
      map.attributionControl.setPrefix(false);
      mapRef.current = map;
      layers.current = L.layerGroup().addTo(map);
      map.on("moveend", () => redraw.current());
      fitted.current = "";
      setReady((n) => n + 1);
    });
    resize.observe(container);
    return () => {
      resize.disconnect();
      mapRef.current?.stop();
      if (mapRef.current)
        (mapRef.current as unknown as { _animatingZoom?: boolean })._animatingZoom = false;
      mapRef.current?.remove();
      mapRef.current = null;
      layers.current = null;
      tiles.current = null;
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setFailed(false);
    if (!online) return;
    const layer = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        updateWhenIdle: true,
        keepBuffer: 0,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    )
      .on("tileerror", () => setFailed(true))
      .addTo(map);
    tiles.current = layer;
    return () => {
      layer.remove();
      tiles.current = null;
    };
  }, [ready, online, retry]);
  useEffect(() => {
    const map = mapRef.current,
      layer = layers.current;
    if (!map || !layer) return;
    const draw = () => {
      layer.clearLayers();
      for (const group of clusterMapRecords(current.current, map.getZoom())) {
        if (
          !map
            .getBounds()
            .pad(0.2)
            .contains([
              Math.max(-85.05112878, Math.min(85.05112878, group.latitude)),
              group.longitude,
            ])
        )
          continue;
        const cover = group.records.find((record) => record.image)?.image;
        const pin = document.createElement("span");
        pin.className = "map-record-pin";
        if (cover) {
          const img = document.createElement("img");
          img.src = `imago://asset/${encodeURIComponent(cover.id)}/thumb${cover.revision ? "?v=" + encodeURIComponent(cover.revision) : ""}`;
          img.alt = "";
          img.loading = "lazy";
          img.onerror = () => {
            img.remove();
            pin.classList.add("without-image");
          };
          pin.append(img);
        } else pin.classList.add("without-image");
        if (group.records.length > 1) {
          const count = document.createElement("b");
          count.textContent = String(group.records.length);
          pin.append(count);
        }
        const label =
          group.records.length > 1
            ? `${group.records.length} ${recordLabel} · ${group.records[0].location.name}`
            : group.records[0].title;
        const marker = L.marker([group.latitude, group.longitude], {
          icon: L.divIcon({
            className: "record-map-marker",
            html: pin,
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          }),
          title: label,
          alt: label,
          keyboard: true,
        }).addTo(layer);
        marker.getElement()?.setAttribute("aria-label", label);
        marker.on("click", () =>
          select.current(group.records.map((record) => record.id)),
        );
      }
      containerCount();
    };
    const containerCount = () => {
      if (element.current)
        element.current.dataset.markerCount = String(layer.getLayers().length);
    };
    redraw.current = draw;
    draw();
    const signature = records
      .map(
        (record) =>
          `${record.id}:${record.location.latitude}:${record.location.longitude}`,
      )
      .sort()
      .join("|");
    if (signature !== fitted.current) {
      fitted.current = signature;
      map.stop();
      if (records.length)
        map.fitBounds(
          L.latLngBounds(
            records.map((record) => [
              record.location.latitude,
              record.location.longitude,
            ]),
          ),
          { padding: [40, 40], maxZoom: 12, animate: false },
        );
      else map.setView([20, 0], 2, { animate: false });
    }
  }, [records, ready, recordLabel]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitRequest) return;
    const selected = focusIds ? new Set(focusIds) : null;
    const subset = selected
      ? current.current.filter((record) => selected.has(record.id))
      : current.current;
    if (subset.length)
      map
        .stop()
        .fitBounds(
          L.latLngBounds(
            subset.map((record) => [
              record.location.latitude,
              record.location.longitude,
            ]),
          ),
          { padding: [40, 40], maxZoom: 16, animate: false },
        );
  }, [fitRequest, focusIds]);
  return (
    <div className="database-map-canvas-wrap">
      <div
        ref={element}
        className="database-map-canvas"
        role="region"
        aria-label={t("Mapa de registros")}
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              'a[href="https://www.openstreetmap.org/copyright"]',
            )
          ) {
            event.preventDefault();
            void window.imago
              .call("openMapAttribution")
              .catch(() => setLinkError(true));
          }
        }}
      />
      {(!online || failed) && (
        <div className="database-map-notice" role="status">
          <span>
            {t(
              !online
                ? "Sin conexión. Los registros y sus coordenadas siguen disponibles."
                : "No se pudo cargar el fondo del mapa. Puedes seguir consultando los registros.",
            )}
          </span>
          {online && (
            <Button onClick={() => setRetry((n) => n + 1)}>
              {t("Reintentar")}
            </Button>
          )}
        </div>
      )}
      {linkError && (
        <small role="alert">{t("No se pudo abrir el enlace.")}</small>
      )}
    </div>
  );
}

export function DatabaseMap({
  detail,
  filters,
  groups,
  sorts,
  logic,
  revision,
  onOpen,
  onProperties,
}: {
  detail: DatabaseDetail;
  filters: PropertyFilter[];
  groups: PropertyFilterGroup[];
  sorts: ViewSort[];
  logic: "and" | "or";
  revision: number;
  onOpen: (id: string) => void;
  onProperties: () => void;
}) {
  const t = useT(),
    columns = detail.columns.filter((column) => column.type === "location");
  const [chosen, setChosen] = useState(() => {
    try {
      return (
        localStorage.getItem(`imago.map-column.${detail.database.id}`) ?? ""
      );
    } catch {
      return "";
    }
  });
  const columnId = columns.some((column) => column.id === chosen)
    ? chosen
    : (columns[0]?.id ?? "");
  const [data, setData] = useState<MapRecord[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null),
    [unlocated, setUnlocated] = useState(false);
  const [query, setQuery] = useState(""),
    [limit, setLimit] = useState(50),
    [fitRequest, setFitRequest] = useState(0);
  const [focusIds, setFocusIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (!columnId) {
      setData([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void window.imago
        .call("mapRecords", {
          databaseId: detail.database.id,
          columnId,
          filters,
          filterLogic: logic,
          filterGroups: groups,
          sorts,
        })
        .then((result) => {
          if (!cancelled) setData(result.records);
        })
        .catch((cause) => {
          if (!cancelled) {
            setError(String(cause.message ?? cause));
            setData([]);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [detail.database.id, columnId, filters, groups, sorts, logic, revision]);
  useEffect(() => {
    setSelectedIds(null);
    setUnlocated(false);
    setLimit(50);
  }, [columnId, filters, groups, logic]);
  useEffect(() => {
    setData([]);
  }, [columnId]);
  const mapped = useMemo(() => locatedRecords(data), [data]);
  const mappedIds = useMemo(
    () => new Set(mapped.map((record) => record.id)),
    [mapped],
  );
  useEffect(() => {
    setSelectedIds((previous) => {
      if (!previous) return previous;
      const remaining = previous.filter((id) => mappedIds.has(id));
      return remaining.length === previous.length
        ? previous
        : remaining.length
          ? remaining
          : null;
    });
  }, [mappedIds]);
  const selection = useMemo(
    () => (selectedIds ? new Set(selectedIds) : null),
    [selectedIds],
  );
  const visible = data.filter(
    (record) =>
      (unlocated
        ? !mappedIds.has(record.id)
        : selection
          ? selection.has(record.id)
          : mappedIds.has(record.id)) &&
      `${record.title} ${record.location?.name ?? ""} ${record.location?.address ?? ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const select = (ids: string[]) => {
    setSelectedIds(ids);
    setUnlocated(false);
    setQuery("");
    setLimit(50);
  };
  if (!columns.length)
    return (
      <div className="empty database-map-empty">
        <MapPin size={30} />
        <h2>{t("Añade una ubicación para situar tus imágenes")}</h2>
        <p>
          {t(
            "Crea una propiedad de tipo Ubicación y elige un lugar o introduce coordenadas en las fichas.",
          )}
        </p>
        <Button primary onClick={onProperties}>
          {t("Propiedades")}
        </Button>
      </div>
    );
  return (
    <section className="database-map-view" aria-label={t("Vista de mapa")}>
      <div className="database-map-toolbar">
        <label>
          {t("Propiedad de ubicación")}
          <CriteriaSelect
            label={t("Propiedad de ubicación")}
            values={[columnId]}
            options={columns.map((column) => ({
              value: column.id,
              label: column.name,
            }))}
            onChange={(values) => {
              setChosen(values[0]);
              try {
                localStorage.setItem(
                  `imago.map-column.${detail.database.id}`,
                  values[0],
                );
              } catch {
                /* Device UI preference only. */
              }
            }}
          />
        </label>
        <span className="map-record-count" role="status">
          {loading ? (
            <Spinner />
          ) : (
            <>
              <b>{mapped.length.toLocaleString()}</b> {t("situados en el mapa")}{" "}
              · {data.length.toLocaleString()} {t("registros")}
            </>
          )}
        </span>
        <Button
          onClick={() => {
            setFocusIds(null);
            setFitRequest((n) => n + 1);
          }}
          disabled={!mapped.length}
        >
          <Focus size={15} />
          {t("Ajustar al contenido")}
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="database-map-layout">
        <RecordMapCanvas
          records={mapped}
          onSelect={select}
          focusIds={focusIds}
          fitRequest={fitRequest}
        />
        <aside
          className="database-map-records"
          aria-label={t("Registros del mapa")}
        >
          <div className="map-list-tabs">
            <Button
              className={!unlocated ? "selected" : ""}
              onClick={() => {
                setUnlocated(false);
                setSelectedIds(null);
                setLimit(50);
              }}
            >
              {t("En el mapa")} ({mapped.length})
            </Button>
            <Button
              className={unlocated ? "selected" : ""}
              onClick={() => {
                setUnlocated(true);
                setSelectedIds(null);
                setLimit(50);
              }}
            >
              {t("Sin coordenadas")} ({data.length - mapped.length})
            </Button>
          </div>
          <input
            aria-label={t("Buscar en los registros del mapa")}
            placeholder={t("Buscar en los registros del mapa")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(50);
            }}
          />
          {selectedIds && (
            <div className="row map-group-actions">
              <span>
                {selectedIds.length} {t("registros en este grupo")}
              </span>
              <Button
                icon
                aria-label={t("Quitar selección del mapa")}
                onClick={() => setSelectedIds(null)}
              >
                <X size={13} />
              </Button>
              <Button
                onClick={() => {
                  setFocusIds(selectedIds);
                  setFitRequest((n) => n + 1);
                }}
              >
                {t("Acercar al grupo")}
              </Button>
            </div>
          )}
          {!visible.length && !loading && (
            <p className="hint">
              {t(
                unlocated && !query
                  ? "Todos los registros tienen coordenadas."
                  : "No hay registros situados con estos filtros o esta búsqueda.",
              )}
            </p>
          )}
          <div className="map-record-list">
            {visible.slice(0, limit).map((record) => (
              <button
                className="map-record-card"
                key={record.id}
                onClick={() => onOpen(record.id)}
                aria-label={`${t("Abrir registro")} ${record.title}`}
              >
                <Thumbnail
                  id={record.image?.id}
                  revision={record.image?.revision}
                  alt={record.title}
                />
                <span>
                  <strong>{record.title}</strong>
                  <small>{record.location?.name ?? t("Sin ubicación")}</small>
                  <small>
                    {record.imageCount} {t("Imágenes")}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {visible.length > limit && (
            <Button onClick={() => setLimit((n) => n + 50)}>
              {t("Mostrar más registros")}
            </Button>
          )}
        </aside>
      </div>
      <p className="hint">
        {t(
          "Se muestran todos los registros con coordenadas que cumplen los filtros, sin limitarse a la página de la tabla.",
        )}
      </p>
    </section>
  );
}

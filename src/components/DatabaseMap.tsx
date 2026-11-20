import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Columns2, Focus, History, Landmark, MapPin, X } from "lucide-react";
import { repeatedViews } from "../../shared/viewpoints";
import { ThenNow } from "./ThenNow";
import type { DatabaseDetail } from "../../shared/databases";
import type {
  MapRecord,
  PropertyFilter,
  PropertyFilterGroup,
  ViewSort,
} from "../../shared/imago";
import {
  clusterMapRecords,
  focusBounds,
  locatedRecords,
  sameMapRecords,
  storedBounds,
  type LocatedMapRecord,
} from "../../shared/mapClusters";
import { useT } from "../i18n";
import { Button, Spinner, Thumbnail } from "./ui";
import { CriteriaSelect } from "./CriteriaSelect";
import { isHeritageColumn } from "../../shared/heritage";
import { HeritageMap } from "./HeritageMap";

type MarkerEntry = { marker: L.Marker; ids: string[]; thumb?: HTMLImageElement; src?: string };

function RecordMapCanvas({
  records,
  onSelect,
  focusIds,
  fitRequest,
  viewKey,
  frameKey,
}: {
  records: LocatedMapRecord[];
  onSelect: (ids: string[]) => void;
  focusIds: string[] | null;
  fitRequest: number;
  /** Changes when the user picks another property or other filters: the map
   * then frames the new answer even if they had moved it by hand. */
  viewKey: string;
  /** Where this database's last framing is remembered on this device, so the
   * map opens on the photographs' region instead of the whole world while the
   * records load. */
  frameKey: string;
}) {
  const element = useRef<HTMLDivElement>(null),
    mapRef = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null),
    tiles = useRef<L.TileLayer | null>(null);
  const current = useRef(records),
    select = useRef(onSelect),
    frame = useRef(frameKey),
    redraw = useRef<() => void>(() => {});
  // Markers by what they show, so panning and refreshes reuse the same DOM
  // nodes and thumbnails instead of rebuilding hundreds of them each time.
  const markers = useRef(new Map<string, MarkerEntry>());
  // Loaded thumbnails by address. Zooming regroups the photographs into new
  // markers; their images move into them instead of being requested and
  // decoded again, hundreds at a time.
  const thumbs = useRef(new Map<string, HTMLImageElement>());
  const fitted = useRef(""),
    framed = useRef<L.LatLngBounds | null>(null),
    moved = useRef(false),
    lastView = useRef(viewKey);
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
    frame.current = frameKey;
  }, [records, onSelect, frameKey]);
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
    // Once the user pans or zooms, the map stays where they left it.
    const touched = () => {
      moved.current = true;
    };
    container.addEventListener("pointerdown", touched);
    container.addEventListener("wheel", touched, { passive: true });
    container.addEventListener("keydown", touched);
    const resize = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      if (mapRef.current) {
        // The panel often settles its size after the first frame: keep the
        // photographs framed until the user takes over.
        if (!moved.current && framed.current) {
          mapRef.current.invalidateSize({ pan: false });
          mapRef.current.fitBounds(framed.current, {
            padding: [40, 40],
            maxZoom: 12,
            animate: false,
          });
        } else mapRef.current.invalidateSize({ pan: true });
        return;
      }
      let remembered: L.LatLngBounds | null = null;
      try {
        const saved = storedBounds(localStorage.getItem(frame.current));
        remembered = saved ? L.latLngBounds(saved) : null;
      } catch {
        /* Device preference only. */
      }
      const map = L.map(container, {
        minZoom: 2,
        maxZoom: 19,
        worldCopyJump: true,
        // Smaller zoom steps: a trackpad or wheel zooms gradually instead of
        // jumping a whole level per notch.
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 110,
      });
      if (remembered) {
        framed.current = remembered;
        map.fitBounds(remembered, { padding: [40, 40], maxZoom: 12, animate: false });
      } else map.setView([20, 0], 2);
      map.attributionControl.setPrefix(false);
      mapRef.current = map;
      layers.current = L.layerGroup().addTo(map);
      map.on("moveend", () => redraw.current());
      fitted.current = "";
      setReady((n) => n + 1);
    });
    resize.observe(container);
    const cache = markers.current,
      images = thumbs.current;
    return () => {
      resize.disconnect();
      container.removeEventListener("pointerdown", touched);
      container.removeEventListener("wheel", touched);
      container.removeEventListener("keydown", touched);
      mapRef.current?.stop();
      if (mapRef.current)
        (mapRef.current as unknown as { _animatingZoom?: boolean })._animatingZoom = false;
      mapRef.current?.remove();
      mapRef.current = null;
      layers.current = null;
      tiles.current = null;
      cache.clear();
      images.clear();
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
        // Tiles for the final zoom only, not for every step of the animation;
        // neighbouring tiles stay so panning back does not reload them.
        updateWhenZooming: false,
        keepBuffer: 2,
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
      const bounds = map.getBounds().pad(0.2),
        previous = markers.current,
        next = new Map<string, MarkerEntry>();
      for (const group of clusterMapRecords(current.current, map.getZoom())) {
        if (
          !bounds.contains([
            Math.max(-85.05112878, Math.min(85.05112878, group.latitude)),
            group.longitude,
          ])
        )
          continue;
        const cover = group.records.find((record) => record.image)?.image;
        // The direction the camera faced, for a single photograph.
        // A record placed at several heritage elements counts once per group.
        const unique = new Set(group.records.map((record) => record.id)).size;
        const bearing =
          unique === 1 && !group.records[0].placement ? group.records[0].location?.bearing : null;
        const label =
          unique > 1
            ? `${unique} ${recordLabel} · ${group.records[0].location.name}`
            : group.records[0].title;
        let key = [
          group.latitude,
          group.longitude,
          unique,
          cover?.id ?? "",
          cover?.revision ?? "",
          typeof bearing === "number" ? bearing : "",
          label,
        ].join("|");
        const ids = [...new Set(group.records.map((record) => record.id))];
        if (next.has(key)) key += "|" + group.id;
        const reused = previous.get(key);
        if (reused) {
          reused.ids = ids;
          if (reused.src && reused.thumb?.parentElement) {
            thumbs.current.delete(reused.src);
            thumbs.current.set(reused.src, reused.thumb);
          }
          previous.delete(key);
          next.set(key, reused);
          continue;
        }
        const pin = document.createElement("span");
        pin.className = "map-record-pin";
        let thumb: HTMLImageElement | undefined, thumbSrc: string | undefined;
        if (cover) {
          const src = `imago://asset/${encodeURIComponent(cover.id)}/thumb${cover.revision ? "?v=" + encodeURIComponent(cover.revision) : ""}`;
          let img = thumbs.current.get(src);
          if (img) thumbs.current.delete(src);
          else {
            img = document.createElement("img");
            img.src = src;
            img.alt = "";
            img.decoding = "async";
            img.draggable = false;
            img.onerror = () => {
              const parent = img!.parentElement;
              img!.remove();
              thumbs.current.delete(src);
              parent?.classList.add("without-image");
            };
          }
          // Most recently used last, for the size limit below.
          thumbs.current.set(src, img);
          pin.append(img);
          thumb = img;
          thumbSrc = src;
        } else pin.classList.add("without-image");
        if (typeof bearing === "number") {
          const arrow = document.createElement("i");
          arrow.className = "map-bearing";
          arrow.style.setProperty("--bearing", `${bearing}deg`);
          pin.append(arrow);
        }
        if (unique > 1) {
          const count = document.createElement("b");
          count.textContent = String(unique);
          pin.append(count);
        }
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
        });
        const entry: MarkerEntry = { marker, ids, thumb, src: thumbSrc };
        marker.on("click", () => select.current(entry.ids));
        marker.addTo(layer);
        marker.getElement()?.setAttribute("aria-label", label);
        next.set(key, entry);
      }
      for (const { marker } of previous.values()) layer.removeLayer(marker);
      markers.current = next;
      for (const [src] of thumbs.current) {
        if (thumbs.current.size <= 800) break;
        thumbs.current.delete(src);
      }
      if (element.current)
        element.current.dataset.markerCount = String(next.size);
    };
    redraw.current = draw;
    if (lastView.current !== viewKey) {
      lastView.current = viewKey;
      moved.current = false;
    }
    const signature = records
      .map(
        (record) =>
          `${record.id}:${record.location.latitude}:${record.location.longitude}`,
      )
      .sort()
      .join("|");
    // Frame the photographs when they first arrive or the question changes,
    // but never pull the map away from where the user is looking.
    if (signature !== fitted.current && !moved.current) {
      fitted.current = signature;
      map.stop();
      const region = focusBounds(records);
      framed.current = region ? L.latLngBounds(region) : null;
      try {
        if (region) localStorage.setItem(frame.current, JSON.stringify(region));
      } catch {
        /* Device preference only. */
      }
      if (framed.current)
        map.fitBounds(framed.current, {
          padding: [40, 40],
          maxZoom: 12,
          animate: false,
        });
      else map.setView([20, 0], 2, { animate: false });
    } else fitted.current = signature;
    // fitBounds/setView without animation fire «moveend», which draws; draw
    // anyway when the view did not change.
    draw();
  }, [records, ready, recordLabel, viewKey]);
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
    <div className="database-map-canvas-wrap" data-tour="map-canvas">
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
  onCompare,
}: {
  detail: DatabaseDetail;
  filters: PropertyFilter[];
  groups: PropertyFilterGroup[];
  sorts: ViewSort[];
  logic: "and" | "or";
  revision: number;
  onOpen: (id: string) => void;
  onProperties: () => void;
  /** Opens images on a comparison table. */
  onCompare?: (assetIds: string[]) => void;
}) {
  const t = useT(),
    locationColumns = detail.columns.filter((column) => column.type === "location"),
    heritageColumns = detail.columns.filter((column) => isHeritageColumn(column)),
    // Photos are placed by a location or by the heritage elements they show.
    columns = [...locationColumns, ...heritageColumns];
  const remembered = (key: string, fallback: string) => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const remember = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Device UI preference only. */
    }
  };
  const [mode, setMode] = useState<"photos" | "heritage">(() =>
    remembered(`imago.map-mode.${detail.database.id}`, "photos") === "heritage" ? "heritage" : "photos",
  );
  const [fallbackChosen, setFallbackChosen] = useState(() => remembered(`imago.map-fallback.${detail.database.id}`, ""));
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
  const heritageSource = heritageColumns.find((column) => column.id === columnId) ?? null;
  const fallbackColumnId = heritageSource
    ? fallbackChosen === "none"
      ? null
      : (locationColumns.find((column) => column.id === fallbackChosen) ?? locationColumns[0])?.id ?? null
    : null;
  const heritageMapColumn = heritageSource ?? heritageColumns[0] ?? null;
  const [data, setData] = useState<MapRecord[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null),
    [unlocated, setUnlocated] = useState(false),
    [viewsTab, setViewsTab] = useState(false),
    [thenNow, setThenNow] = useState<MapRecord | null>(null);
  const [query, setQuery] = useState(""),
    [limit, setLimit] = useState(50),
    [fitRequest, setFitRequest] = useState(0);
  const [focusIds, setFocusIds] = useState<string[] | null>(null);
  // The question the map answers. Only a new question shows the spinner and
  // frames the map again; a refresh after a change elsewhere in the app keeps
  // the current markers on screen and touches nothing when the answer is the
  // same.
  const viewKey = JSON.stringify([
    detail.database.id,
    columnId,
    fallbackColumnId,
    filters,
    groups,
    logic,
  ]);
  const answered = useRef("");
  useEffect(() => {
    if (!columnId) {
      setData([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const question = JSON.stringify([viewKey, sorts]),
      fresh = answered.current !== question;
    if (fresh) {
      setLoading(true);
      setError("");
    }
    const timer = setTimeout(
      () => {
        void window.imago
          .call("mapRecords", {
            databaseId: detail.database.id,
            columnId,
            fallbackColumnId,
            filters,
            filterLogic: logic,
            filterGroups: groups,
            sorts,
          })
          .then((result) => {
            if (cancelled) return;
            answered.current = question;
            setError("");
            setData((previous) =>
              sameMapRecords(previous, result.records) ? previous : result.records,
            );
          })
          .catch((cause) => {
            if (cancelled) return;
            setError(String(cause.message ?? cause));
            if (fresh) setData([]);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      // Indexing and backups announce changes many times a minute: gather
      // them instead of re-reading thousands of records each time.
      fresh ? 180 : 700,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [detail.database.id, columnId, fallbackColumnId, filters, groups, sorts, logic, revision, viewKey]);
  useEffect(() => {
    setSelectedIds(null);
    setUnlocated(false);
    setLimit(50);
  }, [columnId, filters, groups, logic]);
  useEffect(() => {
    setData([]);
    answered.current = "";
  }, [columnId]);
  const mapped = useMemo(() => locatedRecords(data), [data]);
  const mappedById = useMemo(
    () => new Map(mapped.map((record) => [record.id, record])),
    [mapped],
  );
  const mappedIds = mappedById;
  // Records, once each: a record can be on the map at several elements.
  const uniqueData = useMemo(() => {
    const seen = new Set<string>();
    return data.filter((record) => !seen.has(record.id) && !!seen.add(record.id));
  }, [data]);
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
  const visible = uniqueData.filter(
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
  // Repeated views are about where the camera stood: heritage placements are not.
  const views = useMemo(() => repeatedViews(mapped.filter((record) => !record.placement)), [mapped]);
  const select = (ids: string[]) => {
    setSelectedIds(ids);
    setUnlocated(false);
    setViewsTab(false);
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
        {heritageColumns.length > 0 && (
          <div className="segmented map-mode" role="group" aria-label={t("Qué muestra el mapa")}>
            {(["photos", "heritage"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={mode === m ? "active" : ""}
                aria-pressed={mode === m}
                data-testid={`map-mode-${m}`}
                onClick={() => {
                  setMode(m);
                  remember(`imago.map-mode.${detail.database.id}`, m);
                }}
              >
                {m === "photos" ? <MapPin size={13} /> : <Landmark size={13} />}
                {t(m === "photos" ? "Fotos" : "Patrimonio")}
              </button>
            ))}
          </div>
        )}
        {mode === "heritage" && heritageColumns.length > 1 && (
          <label>
            {t("Propiedad de patrimonio")}
            <CriteriaSelect
              label={t("Propiedad de patrimonio")}
              values={[heritageMapColumn?.id ?? ""]}
              options={heritageColumns.map((column) => ({ value: column.id, label: column.name }))}
              onChange={(values) => {
                setChosen(values[0]);
                remember(`imago.map-column.${detail.database.id}`, values[0]);
              }}
            />
          </label>
        )}
        {mode === "photos" && (
        <label>
          {t("Situar las fotos según")}
          <CriteriaSelect
            label={t("Situar las fotos según")}
            values={[columnId]}
            options={columns.map((column) => ({
              value: column.id,
              label: isHeritageColumn(column) ? `${column.name} · ${t("elementos patrimoniales")}` : column.name,
            }))}
            onChange={(values) => {
              setChosen(values[0]);
              remember(`imago.map-column.${detail.database.id}`, values[0]);
            }}
          />
        </label>
        )}
        {mode === "photos" && heritageSource && (
          <label>
            {t("Si no hay elemento situado")}
            <CriteriaSelect
              label={t("Si no hay elemento situado")}
              values={[fallbackColumnId ?? "none"]}
              options={[
                ...locationColumns.map((column) => ({ value: column.id, label: column.name })),
                { value: "none", label: t("No situar") },
              ]}
              onChange={(values) => {
                setFallbackChosen(values[0]);
                remember(`imago.map-fallback.${detail.database.id}`, values[0]);
              }}
            />
          </label>
        )}
        {mode === "photos" && (
        <>
        <span className="map-record-count" role="status">
          {loading ? (
            <Spinner />
          ) : (
            <>
              <b>{mappedById.size.toLocaleString()}</b> {t("situados en el mapa")}{" "}
              · {uniqueData.length.toLocaleString()} {t("registros")}
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
        </>
        )}
      </div>
      {mode === "heritage" && heritageMapColumn ? (
        <HeritageMap
          detail={detail}
          column={heritageMapColumn}
          filters={filters}
          groups={groups}
          sorts={sorts}
          logic={logic}
          revision={revision}
          onOpen={onOpen}
        />
      ) : (
      <>
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
          viewKey={viewKey}
          frameKey={`imago.map-frame.${detail.database.id}.${columnId}`}
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
              {t("En el mapa")} ({mappedById.size})
            </Button>
            <Button
              className={unlocated ? "selected" : ""}
              onClick={() => {
                setUnlocated(true);
                setViewsTab(false);
                setSelectedIds(null);
                setLimit(50);
              }}
            >
              {t("Sin coordenadas")} ({uniqueData.length - mappedById.size})
            </Button>
            <Button
              className={viewsTab ? "selected" : ""}
              data-tour="map-repeated-views"
              data-tooltip={t("Fotografías tomadas desde el mismo punto y mirando en la misma dirección")}
              onClick={() => {
                setViewsTab(true);
                setUnlocated(false);
                setSelectedIds(null);
              }}
            >
              {t("Vistas repetidas")} ({views.length})
            </Button>
          </div>
          {viewsTab && (
            <div className="map-views" data-testid="repeated-views">
              <p className="hint">
                {t("Grupos de fotografías tomadas a menos de 80 m entre sí y, si consta la dirección de la cámara, mirando hacia el mismo lado (±40°).")}
              </p>
              {!views.length && <p className="hint">{t("No hay vistas repetidas. Indica la dirección de la cámara en la ubicación para afinar los grupos.")}</p>}
              {views.slice(0, 60).map((group) => (
                <div key={group[0].id} className="map-view-group">
                  <div className="map-view-thumbs">
                    {group.slice(0, 4).map((r) => (
                      <button key={r.id} type="button" onClick={() => onOpen(r.id)} aria-label={`${t("Abrir registro")} ${r.title}`}>
                        <Thumbnail id={r.image?.id} revision={r.image?.revision} alt={r.title} />
                      </button>
                    ))}
                  </div>
                  <span>
                    <strong>{group[0].location.name}</strong>
                    <small>
                      {group.length} {t("registros")}
                      {group.some((r) => r.location.bearing != null) ? ` · ${t("con dirección")}` : ""}
                    </small>
                  </span>
                  <span className="map-view-actions">
                    <Button icon aria-label={t("Ver en el mapa")} data-tooltip={t("Ver en el mapa")} onClick={() => { setFocusIds(group.map((r) => r.id)); setFitRequest((n) => n + 1); }}>
                      <Focus size={14} />
                    </Button>
                    {onCompare && (
                      <Button
                        icon
                        aria-label={t("Comparar")}
                        data-tooltip={t("Abrir en la mesa de comparación")}
                        onClick={() => onCompare(group.flatMap((r) => (r.image ? [r.image.id] : [])).slice(0, 6))}
                      >
                        <Columns2 size={14} />
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
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
              {selectedIds.length === 1 && (
                <Button
                  data-testid="then-now-open"
                  data-tour="map-then-now"
                  data-tooltip={t("Busca fotografías actuales tomadas cerca en Wikimedia Commons")}
                  onClick={() => setThenNow(mapped.find((r) => r.id === selectedIds[0]) ?? null)}
                >
                  <History size={14} />
                  {t("Entonces y ahora")}
                </Button>
              )}
            </div>
          )}
          {thenNow && <ThenNow record={thenNow} onClose={() => setThenNow(null)} />}
          {!viewsTab && !visible.length && !loading && (
            <p className="hint">
              {t(
                unlocated && !query
                  ? "Todos los registros tienen coordenadas."
                  : "No hay registros situados con estos filtros o esta búsqueda.",
              )}
            </p>
          )}
          <div className="map-record-list" hidden={viewsTab}>
            {visible.slice(0, limit).map((record) => {
              const located = mappedById.get(record.id);
              return (
                <div className="map-record-item" key={record.id}>
                  <button
                    className="map-record-card"
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
                        {record.imageCount} {t(record.imageCount === 1 ? "imagen" : "imágenes")}
                      </small>
                    </span>
                  </button>
                  {located && (
                    <Button
                      icon
                      className="map-record-then-now"
                      data-testid="then-now-record"
                      aria-label={`${t("Entonces y ahora")}: ${record.title}`}
                      data-tooltip={t("Busca fotografías actuales tomadas cerca en Wikimedia Commons")}
                      onClick={() => setThenNow(located)}
                    >
                      <History size={14} />
                    </Button>
                  )}
                </div>
              );
            })}
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
      </>
      )}
    </section>
  );
}

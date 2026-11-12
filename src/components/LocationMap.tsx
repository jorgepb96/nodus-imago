import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { RefreshCw } from "lucide-react";
import { useT } from "../i18n";
import { Button } from "./ui";

/** Only visible tiles are requested. Chromium supplies the normal HTTP cache. */
export function LocationMap({
  latitude,
  longitude,
  name,
  expanded = false,
}: {
  latitude: number;
  longitude: number;
  name: string;
  expanded?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [linkError, setLinkError] = useState(false);
  const t = useT();
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
    if (!ref.current || !online) return;
    setFailed(false);
    const element = ref.current;
    let map: L.Map | null = null,
      disposed = false;
    // A nested native dialog is still hidden when child effects run. Creating
    // Leaflet then would project the pin against a 0×0 viewport. Wait until the
    // real square/dialog has a size, and preserve its centre on later resizes.
    const resize = new ResizeObserver(() => {
      if (disposed || !element.clientWidth || !element.clientHeight) return;
      if (map) {
        map.invalidateSize({ pan: true });
        return;
      }
      map = L.map(element, {
        zoomControl: expanded,
        attributionControl: true,
        dragging: expanded,
        scrollWheelZoom: expanded,
        doubleClickZoom: expanded,
        touchZoom: expanded,
        boxZoom: expanded,
        keyboard: expanded,
        minZoom: 2,
        maxZoom: 19,
      }).setView([latitude, longitude], 12);
      map.attributionControl.setPrefix(false);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        updateWhenIdle: true,
        keepBuffer: 0,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
        .on("tileerror", () => setFailed(true))
        .addTo(map);
      L.circleMarker([latitude, longitude], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: "#6352ed",
        fillOpacity: 1,
      }).addTo(map);
    });
    resize.observe(element);
    return () => {
      disposed = true;
      resize.disconnect();
      map?.stop();
      // A queued CSS transitionend can still reach Leaflet after remove() and
      // dereference the detached map pane. Clear the flag before removal.
      (map as unknown as { _animatingZoom?: boolean } | null)!??{};
      if (map) (map as unknown as { _animatingZoom?: boolean })._animatingZoom = false;
      map?.remove();
      map = null;
    };
  }, [latitude, longitude, expanded, online, retry]);
  return (
    <div className={`location-map ${expanded ? "expanded" : ""}`}>
      <div
        ref={ref}
        className="location-map-canvas"
        role="region"
        aria-label={`${t("Mapa de")} ${name}`}
        data-latitude={latitude}
        data-longitude={longitude}
        onClick={(event) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.closest(
              'a[href="https://www.openstreetmap.org/copyright"]',
            )
          )
            return;
          event.preventDefault();
          void window.imago
            .call("openMapAttribution")
            .catch(() => setLinkError(true));
        }}
      />
      {(!online || failed) && (
        <div className="location-map-status" role="status">
          <span>
            {t(
              !online
                ? "Conéctate para ver el mapa. El lugar está guardado en este equipo."
                : "No se pudo cargar el mapa. El lugar sigue guardado.",
            )}
          </span>
          {online && (
            <Button onClick={() => setRetry(retry + 1)}>
              <RefreshCw size={13} />
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

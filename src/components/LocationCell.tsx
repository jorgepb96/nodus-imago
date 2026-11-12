import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Maximize2, X } from "lucide-react";
import {
  decodeDatabaseLocation,
  encodeDatabaseLocation,
  type DatabaseLocationValue,
} from "../../shared/databaseProperties";
import { validCoordinates, type GazetteerPlace } from "../../shared/places";
import { useT } from "../i18n";
import { Button, Modal } from "./ui";
import { LocationMap } from "./LocationMap";

export function LocationCell({
  name,
  value,
  onSave,
  compact,
}: {
  name: string;
  value: string | null;
  onSave: (value: string | null) => Promise<void>;
  compact: boolean;
}) {
  const place = decodeDatabaseLocation(value),
    t = useT(),
    listId = useId();
  const [draft, setDraft] = useState(place?.name ?? "");
  const [editing, setEditing] = useState(false);
  const [results, setResults] = useState<GazetteerPlace[]>([]);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchError, setSearchError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [portalHost, setPortalHost] = useState<Element>(document.body);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 300,
    maxHeight: 280,
  });
  const input = useRef<HTMLInputElement>(null),
    saving = useRef(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  useEffect(() => {
    const next = decodeDatabaseLocation(value);
    setDraft(next?.name ?? "");
    setLatitude(next?.latitude == null ? "" : String(next.latitude));
    setLongitude(next?.longitude == null ? "" : String(next.longitude));
  }, [value]);
  useEffect(() => {
    if (!editing || draft.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setResults([]);
    setActive(-1);
    setSearchError(false);
    const timer = setTimeout(() => {
      void window.imago
        .call("searchPlaces", { query: draft.slice(0, 200) })
        .then((places) => {
          if (!cancelled) setResults(places);
        })
        .catch(() => {
          if (!cancelled) setSearchError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, editing]);
  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);
  useEffect(() => {
    if (!editing) return;
    const update = () => {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 12;
      const height = Math.min(280, Math.max(below, rect.top - 12));
      setPosition({
        top:
          below >= Math.min(220, height)
            ? rect.bottom + 4
            : Math.max(8, rect.top - height - 4),
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        width,
        maxHeight: height,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [editing]);
  const save = async (next: DatabaseLocationValue | null) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setEditing(false);
    try {
      await onSave(encodeDatabaseLocation(next));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("No se pudo guardar el lugar."),
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const custom = (force = false) => {
    if (saving.current) return;
    setEditing(false);
    if (!force && draft.trim() === (place?.name ?? "")) return;
    // Renaming a place is a new manual location; never retain a previous city's pin.
    void save(draft.trim() ? { name: draft.trim() } : null);
  };
  const pick = (chosen: GazetteerPlace) => {
    setDraft(chosen.name);
    void save({
      name: chosen.name,
      gazetteerId: chosen.gazetteerId,
      address: [chosen.admin1, chosen.country].filter(Boolean).join(", "),
      latitude: chosen.latitude,
      longitude: chosen.longitude,
    });
  };
  const mapped = validCoordinates(place);
  const open = editing && draft.trim().length >= 2;
  return (
    <div className={`location-cell ${compact ? "compact" : ""}`}>
      <div className="location-input-row">
        <input
          ref={input}
          className="cell-input"
          aria-label={name}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && active >= 0 ? `${listId}-${active}` : undefined
          }
          placeholder={t("Buscar un lugar o escribir uno propio…")}
          autoComplete="off"
          value={draft}
          disabled={busy}
          maxLength={300}
          onFocus={(event) => {
            setPortalHost(
              event.currentTarget.closest("dialog") ?? document.body,
            );
            setEditing(true);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setEditing(true);
          }}
          onBlur={() => custom()}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setEditing(true);
              setActive(
                results.length
                  ? active < 0
                    ? event.key === "ArrowDown"
                      ? 0
                      : results.length - 1
                    : (active +
                        (event.key === "ArrowDown" ? 1 : results.length - 1) +
                        results.length) %
                      results.length
                  : -1,
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (open && active >= 0 && results[active]) pick(results[active]);
              else {
                custom();
                input.current?.blur();
              }
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
            }
          }}
        />
        {mapped && compact && (
          <Button
            icon
            aria-label={`${t("Ver mapa")}: ${name}`}
            onClick={() => setExpanded(true)}
          >
            <MapPin size={14} />
          </Button>
        )}
        {!compact && value && (
          <Button
            icon
            disabled={busy}
            aria-label={`${t("Quitar lugar")}: ${name}`}
            onClick={() => {
              setDraft("");
              void save(null);
            }}
          >
            <X size={14} />
          </Button>
        )}
      </div>
      {open &&
        createPortal(
          <div
            className="place-suggestions"
            style={position}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div id={listId} role="listbox" aria-label={t("Lugares sugeridos")}>
              {results.map((candidate, index) => (
                <button
                  type="button"
                  role="option"
                  tabIndex={-1}
                  id={`${listId}-${index}`}
                  key={candidate.gazetteerId}
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(candidate)}
                >
                  <MapPin size={14} />
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>
                      {[candidate.admin1, candidate.country]
                        .filter(Boolean)
                        .join(", ")}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <small className="place-search-status" role="status">
              {t(
                loading
                  ? "Buscando lugares…"
                  : searchError
                    ? "Catálogo no disponible. Puedes escribir un lugar propio."
                    : results.length
                      ? "Catálogo local · GeoNames · CC BY 4.0"
                      : "Sin coincidencias. Puedes escribir un lugar propio.",
              )}
            </small>
            <button
              type="button"
              className="place-custom"
              onClick={() => custom(true)}
            >
              {t("Usar texto propio")}: <strong>{draft.trim()}</strong>
            </button>
          </div>,
          portalHost,
        )}
      {!compact && (
        <>
          {place?.address && <small className="muted">{place.address}</small>}
          <small className="muted location-help">
            {t(
              "Elige una sugerencia o escribe un lugar propio. La lista funciona sin conexión.",
            )}
          </small>
          {mapped && (
            <div className="location-preview">
              <LocationMap
                latitude={place.latitude}
                longitude={place.longitude}
                name={place.name}
              />
              <Button
                className="location-expand"
                onClick={() => setExpanded(true)}
              >
                <Maximize2 size={13} />
                {t("Ampliar mapa")}
              </Button>
            </div>
          )}
          <details className="location-coordinates">
            <summary>{t("Coordenadas (opcional)")}</summary>
            <div className="row">
              <label>
                {t("Latitud")}
                <input
                  aria-label={`${name} · ${t("Latitud")}`}
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                />
              </label>
              <label>
                {t("Longitud")}
                <input
                  aria-label={`${name} · ${t("Longitud")}`}
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                />
              </label>
            </div>
            <Button
              disabled={busy}
              onClick={() => {
                const next = {
                  latitude: latitude.trim() ? Number(latitude) : null,
                  longitude: longitude.trim() ? Number(longitude) : null,
                };
                if (!draft.trim()) {
                  setError(t("Escribe primero un nombre para el lugar."));
                  return;
                }
                if ((latitude || longitude) && !validCoordinates(next)) {
                  setError(
                    t(
                      "Introduce una latitud entre −90 y 90 y una longitud entre −180 y 180.",
                    ),
                  );
                  return;
                }
                void save({ name: draft.trim(), ...next });
              }}
            >
              {t("Guardar coordenadas")}
            </Button>
          </details>
        </>
      )}
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
      {expanded && mapped && (
        <Modal
          title={`${t("Mapa de")} ${place.name}`}
          wide
          onClose={() => setExpanded(false)}
        >
          <div className="modal-body location-map-body">
            <p>{place.address}</p>
            <LocationMap
              latitude={place.latitude}
              longitude={place.longitude}
              name={place.name}
              expanded
            />
            <small className="muted">
              {place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}
            </small>
          </div>
        </Modal>
      )}
    </div>
  );
}

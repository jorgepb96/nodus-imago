// Then and now: a historical photograph beside present-day photographs taken
// nearby, from Wikimedia Commons. Only the place's coordinates are sent, and
// only when the user opens this window.
import { useEffect, useState } from "react";
import { Columns2, ExternalLink, Layers } from "lucide-react";
import type { MapRecord } from "../../shared/imago";
import type { CommonsPhoto } from "../../shared/commons";
import { useT } from "../i18n";
import { Button, Modal } from "./ui";

export function ThenNow({ record, onClose }: { record: MapRecord; onClose: () => void }) {
  const t = useT();
  const [radius, setRadius] = useState(300);
  const [photos, setPhotos] = useState<CommonsPhoto[] | null>(null);
  const [chosen, setChosen] = useState<CommonsPhoto | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [opacity, setOpacity] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const location = record.location!;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.imago
      .call("commonsNearby", { latitude: location.latitude!, longitude: location.longitude!, radius })
      .then((list) => {
        if (cancelled) return;
        setPhotos(list);
        setChosen((current) => current ?? list[0] ?? null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [location.latitude, location.longitude, radius]);
  const historical = record.image ? `imago://asset/${record.image.id}/preview${record.image.revision ? "?v=" + encodeURIComponent(record.image.revision) : ""}` : null;
  return (
    <Modal title={`${t("Entonces y ahora")} · ${record.title}`} onClose={onClose} wide>
      <div className="modal-body then-now" data-testid="then-now">
        <p className="hint">
          {t("Fotografías actuales de Wikimedia Commons tomadas cerca de este lugar. Se envían a Wikimedia solo las coordenadas del lugar.")}
        </p>
        <div className="then-now-controls">
          <label>
            {t("Distancia")}
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
              {[100, 300, 1000, 3000].map((r) => (
                <option key={r} value={r}>
                  {r < 1000 ? `${r} m` : `${r / 1000} km`}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" role="group" aria-label={t("Modo")}>
            <button type="button" className={!overlay ? "active" : ""} onClick={() => setOverlay(false)}>
              <Columns2 size={13} />
              {t("Lado a lado")}
            </button>
            <button type="button" className={overlay ? "active" : ""} disabled={!chosen} onClick={() => setOverlay(true)}>
              <Layers size={13} />
              {t("Superponer")}
            </button>
          </div>
          {overlay && (
            <label className="compare-opacity">
              {t("Transparencia de la imagen actual")}
              <input type="range" min={0} max={1} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            </label>
          )}
        </div>
        {chosen && historical && (
          <div className={`then-now-stage ${overlay ? "is-overlay" : ""}`}>
            <figure>
              <img src={historical} alt={record.title} />
              {!overlay && <figcaption>{record.title}</figcaption>}
            </figure>
            <figure style={overlay ? { opacity } : undefined}>
              <img src={chosen.large} alt={chosen.title} referrerPolicy="no-referrer" />
              {!overlay && (
                <figcaption>
                  {[chosen.date, chosen.author, chosen.license].filter(Boolean).join(" · ")}
                  {" · "}
                  <button type="button" className="link-button" onClick={() => void window.imago.call("openExternalLink", { url: chosen.page })}>
                    {t("Ver en Wikimedia Commons")} <ExternalLink size={11} />
                  </button>
                </figcaption>
              )}
            </figure>
          </div>
        )}
        {loading && <p className="muted">{t("Buscando fotografías cercanas…")}</p>}
        {error && <p className="error">{t(error)}</p>}
        {photos && !photos.length && !loading && <p className="muted">{t("No hay fotografías de Wikimedia Commons a esa distancia. Prueba con una distancia mayor.")}</p>}
        <ul className="then-now-list">
          {photos?.map((p) => (
            <li key={p.page}>
              <button type="button" className={chosen?.page === p.page ? "is-selected" : ""} onClick={() => setChosen(p)}>
                <img src={p.thumbnail} alt={p.title} loading="lazy" referrerPolicy="no-referrer" />
                <small>
                  {p.distance} m{p.date ? ` · ${p.date.slice(0, 4)}` : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <footer>
        <Button onClick={onClose}>{t("Cerrar")}</Button>
      </footer>
    </Modal>
  );
}

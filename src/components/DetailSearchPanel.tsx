// Results of searching for an annotated detail across the corpus, shown in
// the image viewer: each image with the part where the detail was found.
import { useEffect, useState } from "react";
import { ArrowLeft, Columns2, ScanSearch } from "lucide-react";
import type { DetailMatch } from "../../shared/detailSearch";
import type { ImageAnnotation } from "../../shared/imago";
import { useT } from "../i18n";

const preview = (id: string, revision?: string) => `imago://asset/${id}/preview${revision ? "?v=" + encodeURIComponent(revision) : ""}`;

export function DetailSearchPanel({
  annotation,
  databaseId,
  onBack,
  onOpenRecord,
  onCompare,
}: {
  annotation: ImageAnnotation;
  databaseId: string;
  onBack: () => void;
  onOpenRecord?: (rowId: string) => void;
  onCompare?: (assetIds: string[]) => void;
}) {
  const t = useT();
  const [inside, setInside] = useState(false);
  const [everywhere, setEverywhere] = useState(false);
  const [results, setResults] = useState<DetailMatch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!loading) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [loading]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.imago
      .call("detailSearch", {
        assetId: annotation.assetId,
        region: { x: annotation.x, y: annotation.y, w: annotation.w, h: annotation.h },
        databaseIds: everywhere ? undefined : [databaseId],
        inside,
      })
      .then((r) => !cancelled && setResults(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [annotation, databaseId, inside, everywhere]);
  return (
    <div className="detail-panel" data-testid="detail-results">
      <button type="button" className="detail-back" onClick={onBack}>
        <ArrowLeft size={14} />
        {t("Volver a las anotaciones")}
      </button>
      <h2>
        <ScanSearch size={15} />
        {t("Dónde más aparece este detalle")}
      </h2>
      {annotation.note && <p className="detail-note">«{annotation.note}»</p>}
      <label className="check-label">
        <input type="checkbox" checked={inside} disabled={loading} onChange={(e) => setInside(e.target.checked)} />
        {t("Buscar también dentro de las imágenes (más lento la primera vez)")}
      </label>
      <label className="check-label">
        <input type="checkbox" checked={everywhere} disabled={loading} onChange={(e) => setEverywhere(e.target.checked)} />
        {t("En todas las bases de datos")}
      </label>
      <p className="detail-help">
        {t(inside
          ? "Las imágenes más parecidas se dividen en nueve partes y se marca la parte donde aparece el detalle."
          : "Compara el detalle con cada imagen entera. Funciona mejor cuando el detalle ocupa buena parte de la imagen.")}
      </p>
      {loading && (
        <p className="detail-status" role="status">
          {t(inside ? "Buscando dentro de las imágenes…" : "Buscando…")}
          {inside && elapsed >= 3 && ` ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`}
          {inside && elapsed >= 3 && (
            <small>{t("La primera vez puede tardar unos minutos: las partes de cada imagen se guardan y las búsquedas siguientes son inmediatas.")}</small>
          )}
        </p>
      )}
      {error && <p className="annotation-error">{t(error)}</p>}
      {results && !loading && onCompare && results.length > 0 && (
        <button type="button" className="detail-compare" onClick={() => onCompare([annotation.assetId, ...results.slice(0, 5).map((r) => r.assetId)])}>
          <Columns2 size={14} />
          {t("Comparar con los cinco primeros")}
        </button>
      )}
      <ul className={`detail-results${loading ? " is-loading" : ""}`} aria-busy={loading}>
        {results?.slice(0, 30).map((r) => (
          <li key={r.assetId}>
            <button type="button" onClick={() => onOpenRecord?.(r.rowId)} disabled={!onOpenRecord} data-tooltip={t("Abrir registro")}>
              <span className="detail-thumb">
                <img src={preview(r.assetId, r.revision)} alt={r.title} loading="lazy" />
                {r.box && (
                  <span
                    className="detail-box"
                    style={{ left: `${r.box.x * 100}%`, top: `${r.box.y * 100}%`, width: `${r.box.w * 100}%`, height: `${r.box.h * 100}%` }}
                  />
                )}
              </span>
              <span className="detail-meta">
                <strong>{r.title}</strong>
                <small>
                  {Math.round(r.score * 100)} % · {r.databaseName}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

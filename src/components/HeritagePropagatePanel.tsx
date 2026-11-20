// Spreading an identification: the photographs of the collection most alike
// to an element's mark (or to the whole image when it is not marked), found
// locally by the visual index. The researcher ticks those that show it and
// the element is added to them, with the zone found as its mark if wished.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, ScanSearch } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { DetailMatch } from "../../shared/detailSearch";
import type { ImageAnnotation } from "../../shared/imago";
import { formatNumber, useT } from "../i18n";
import { refreshHeritage } from "../heritageStore";

const preview = (id: string, revision?: string) => `imago://asset/${id}/preview${revision ? "?v=" + encodeURIComponent(revision) : ""}`;

export function HeritagePropagatePanel({
  column,
  optionId,
  assetId,
  mark,
  databaseId,
  onBack,
  onAdded,
}: {
  column: DatabaseColumn;
  optionId: string;
  assetId: string;
  /** The element's rectangle on this image; without it the whole image is compared. */
  mark: ImageAnnotation | null;
  databaseId: string;
  onBack: () => void;
  onAdded: () => Promise<void> | void;
}) {
  const t = useT();
  const label = column.options.find((o) => o.id === optionId)?.label ?? "";
  const [results, setResults] = useState<DetailMatch[] | null>(null);
  const [has, setHas] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [inside, setInside] = useState(!!mark && mark.kind !== "point");
  const [marks, setMarks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const region = useMemo(
    () => (mark && mark.kind !== "point" ? { x: mark.x, y: mark.y, w: mark.w, h: mark.h } : { x: 0, y: 0, w: 1, h: 1 }),
    [mark],
  );

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void window.imago
      .call("detailSearch", { assetId, region, databaseIds: [databaseId], inside })
      .then(async (found) => {
        if (cancelled) return;
        const rows = found.slice(0, 40);
        const already = await window.imago.call("heritageRowsWith", { columnId: column.id, optionId, rowIds: [...new Set(rows.map((r) => r.rowId))] });
        if (cancelled) return;
        setResults(rows);
        setHas(new Set(already));
        setPicked(new Set());
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [assetId, region, databaseId, inside, column.id, optionId]);

  const add = async () => {
    if (!results) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = results.filter((r) => picked.has(r.assetId));
      const added = await window.imago.call("heritageAddToRows", {
        columnId: column.id,
        optionId,
        items: chosen.map((r) => ({ rowId: r.rowId, ...(marks && r.box ? { assetId: r.assetId, box: r.box } : {}) })),
      });
      refreshHeritage(column.id);
      setHas((all) => new Set([...all, ...chosen.map((r) => r.rowId)]));
      setPicked(new Set());
      setMessage(t("«{e}» añadido a {n} fotos. «Deshacer» lo revierte.").replace("{e}", label).replace("{n}", formatNumber(added, 0)));
      await onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="heritage-propagate" data-testid="heritage-propagate">
      <button type="button" className="detail-back" onClick={onBack}>
        <ArrowLeft size={14} />
        {t("Volver al patrimonio de la foto")}
      </button>
      <h2>
        <ScanSearch size={15} /> {t("Buscar en otras fotos")}
      </h2>
      <p className="detail-note">«{label}»</p>
      <p className="detail-help">
        {t(
          mark && mark.kind !== "point"
            ? "Compara la zona marcada con el resto de la colección. Marca las fotos que muestran el elemento."
            : "Sin rectángulo marcado se compara la imagen entera. Para afinar, marca el elemento con un rectángulo.",
        )}
      </p>
      <label className="check-label">
        <input type="checkbox" checked={inside} disabled={busy} onChange={(e) => setInside(e.target.checked)} />
        {t("Buscar también dentro de las imágenes (más lento la primera vez)")}
      </label>
      {busy && (
        <p className="detail-status" role="status">
          <Loader2 size={13} className="spin" /> {t("Buscando…")}
        </p>
      )}
      {error && <p className="annotation-error">{t(error)}</p>}
      {message && <p className="success">{message}</p>}
      <ul className={`detail-results heritage-propagate-results${busy ? " is-loading" : ""}`}>
        {results
          ?.filter((r) => r.assetId !== assetId)
          .map((r) => {
            const done = has.has(r.rowId);
            return (
              <li key={r.assetId} className={done ? "is-done" : picked.has(r.assetId) ? "is-picked" : ""}>
                <label>
                  <input
                    type="checkbox"
                    disabled={done}
                    checked={done || picked.has(r.assetId)}
                    onChange={(e) =>
                      setPicked((all) => {
                        const next = new Set(all);
                        if (e.target.checked) next.add(r.assetId);
                        else next.delete(r.assetId);
                        return next;
                      })
                    }
                  />
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
                      {Math.round(r.score * 100)} %{done ? ` · ${t("ya lo tiene")}` : ""}
                    </small>
                  </span>
                </label>
              </li>
            );
          })}
      </ul>
      {results && results.length > 0 && (
        <div className="heritage-suggest-actions">
          {inside && (
            <label className="check-label">
              <input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} />
              {t("Marcar la zona encontrada")}
            </label>
          )}
          <button type="button" className="viewer-annotate is-on" disabled={busy || !picked.size} onClick={() => void add()}>
            <Check size={14} /> {t("Añadir a {n} fotos").replace("{n}", formatNumber(picked.size, 0))}
          </button>
        </div>
      )}
    </section>
  );
}

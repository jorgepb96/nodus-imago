// A record opened from the results of «Buscar» in the image viewer: a window
// over the viewer with the same data as the record panel, in its order, so
// the search stays where it was. «Abrir registro» opens the full record.
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FileImage, SquareArrowOutUpRight, Star } from "lucide-react";
import type { DatabaseDetail } from "../../shared/databases";
import type { RecordRow } from "../../shared/imago";
import { readColumnPrefs } from "../columnPrefs";
import { useT } from "../i18n";
import { Button, Modal, Spinner, Thumbnail } from "./ui";
import { RecordFacts } from "./RecordFacts";
import type { Perform } from "./Properties";

export function RecordPreview({
  rowId,
  assetId,
  onClose,
  onChanged,
  onOpenRecord,
}: {
  rowId: string;
  /** The image found: shown first. */
  assetId?: string;
  onClose: () => void;
  /** A property edited here: the views behind are refreshed. */
  onChanged?: () => void;
  /** Opens the full record (and leaves the viewer). */
  onOpenRecord?: (rowId: string) => void;
}) {
  const t = useT();
  /** The record shown: a linked record opened from here replaces it. */
  const [shownId, setShownId] = useState(rowId);
  const [row, setRow] = useState<RecordRow | null>(null);
  const [detail, setDetail] = useState<DatabaseDetail | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => setShownId(rowId), [rowId]);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    void (async () => {
      const next = await window.imago.call("getRow", { id: shownId });
      const d = await window.imago.call("detail", { id: next.databaseId });
      if (cancelled) return;
      setRow((previous) => {
        // A new record opens on the image found; a refreshed one keeps its place.
        if (previous?.id !== next.id) {
          const found = assetId ? next.images.findIndex((image) => image.id === assetId) : -1;
          setImageIndex(Math.max(0, found));
        }
        return next;
      });
      setDetail(d);
    })().catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [shownId, assetId, tick]);
  const changed = useCallback(() => {
    setTick((n) => n + 1);
    onChanged?.();
  }, [onChanged]);
  const perform: Perform = async (work) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const ready = row && detail && row.id === shownId;
  const image = ready ? row.images[Math.min(imageIndex, row.images.length - 1)] : undefined;
  return (
    <Modal icon={FileImage} title={ready ? row.title : t("Cargando el registro…")} onClose={onClose} wide layout="panels">
      {!ready ? (
        <div className="record-preview-loading" role="status">
          {error ? <p className="annotation-error">{t(error)}</p> : <Spinner />}
        </div>
      ) : (
        <>
          <div className="record-body record-preview" data-testid="record-preview">
            <p className="record-preview-database">{row.databaseName}</p>
            {error && <p className="annotation-error">{t(error)}</p>}
            <Thumbnail id={image?.width ? image.id : undefined} revision={image?.revision} large alt={row.title} />
            {image && (
              <>
                <div className="image-toolbar">
                  <Button icon aria-label={t("Anterior")} disabled={!imageIndex} onClick={() => setImageIndex(imageIndex - 1)}>
                    <ChevronLeft size={16} />
                  </Button>
                  <span>
                    {imageIndex + 1} / {row.images.length}
                  </span>
                  <Button
                    icon
                    aria-label={t("Siguiente")}
                    disabled={imageIndex >= row.images.length - 1}
                    onClick={() => setImageIndex(imageIndex + 1)}
                  >
                    <ChevronRight size={16} />
                  </Button>
                  <span className="spacer" />
                  {image.position === 0 && (
                    <span className="record-preview-primary">
                      <Star size={13} fill="currentColor" />
                      {t("Imagen principal")}
                    </span>
                  )}
                </div>
                <div className="image-meta">
                  <strong>{image.fileName}</strong>
                  <span>
                    {image.width} × {image.height} · {(image.bytes / 1e6).toFixed(2)} MB
                  </span>
                </div>
              </>
            )}
            <RecordFacts
              row={row}
              detail={detail}
              image={image}
              hidden={readColumnPrefs(row.databaseId).hidden}
              perform={perform}
              onChanged={changed}
              onOpenRecord={setShownId}
            />
          </div>
          {onOpenRecord && (
            <footer className="record-preview-footer">
              <Button primary onClick={() => onOpenRecord(row.id)}>
                <SquareArrowOutUpRight size={14} />
                {t("Abrir registro")}
              </Button>
              <Button onClick={onClose}>{t("Cerrar")}</Button>
            </footer>
          )}
        </>
      )}
    </Modal>
  );
}

// Identifying a heritage property's elements, in three background steps
// reviewed here: Wikidata (identity, typology, coordinates), OpenStreetMap
// (what Wikidata lacks) and, last, the centre of each element's town
// (approximate). Each applied step can be reverted as a whole.
import { useEffect, useState } from "react";
import { History, MapPinned, Undo2, Wand2 } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { AuthorityLink } from "../../shared/authority";
import type { HeritageElement, HeritageScheme } from "../../shared/heritage";
import { formatNumber, useT } from "../i18n";
import { Button } from "./ui";
import { HeritageSearch } from "./HeritageSearch";

type Batch = { id: string; applied: number; createdAt: string; revertedAt: string | null };

export function HeritageIdentify({
  column,
  links,
  elements,
  counts,
  scheme,
  onApplied,
}: {
  column: DatabaseColumn;
  links: Record<string, AuthorityLink>;
  elements: Record<string, HeritageElement>;
  counts: Record<string, number>;
  scheme: HeritageScheme;
  onApplied: () => Promise<void>;
}) {
  const t = useT();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadBatches = () =>
    window.imago
      .call("heritageLinkBatches", { columnId: column.id })
      .then(setBatches)
      .catch(() => {});
  useEffect(() => {
    void loadBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column.id]);
  const applied = async () => {
    await onApplied();
    await loadBatches();
  };
  const common = { column, elements, links, counts, scheme, onApplied: applied };

  return (
    <div className="heritage-identify" data-testid="heritage-identify">
      <p className="hint">
        {t(
          "Tres pasos, en este orden: Wikidata identifica cada elemento (enlace, tipología y coordenadas); OpenStreetMap sitúa lo que Wikidata no tiene; por último, lo que quede se sitúa en el centro de su localidad, como posición aproximada. Las búsquedas siguen en segundo plano en la lista de tareas; las propuestas se guardan hasta que las revisas.",
        )}
      </p>
      <h3>
        <Wand2 size={15} /> 1 · Wikidata
      </h3>
      <HeritageSearch {...common} source="wikidata" />
      <h3>
        <MapPinned size={15} /> 2 · {t("OpenStreetMap: lo que Wikidata no tiene")}
      </h3>
      <HeritageSearch {...common} source="osm" />
      <h3>
        <MapPinned size={15} /> 3 · {t("Situar en su localidad")}
      </h3>
      <HeritageSearch {...common} source="town" />
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{t(error)}</p>}
      {batches.length > 0 && (
        <details className="heritage-batches">
          <summary>
            <History size={13} /> {t("Vinculaciones anteriores")}
          </summary>
          <ul>
            {batches.map((b) => (
              <li key={b.id}>
                <span>
                  {new Date(b.createdAt).toLocaleString()} · {formatNumber(b.applied, 0)} {t("elementos")}
                </span>
                {b.revertedAt ? (
                  <span className="muted">{t("Revertida")}</span>
                ) : (
                  <Button
                    onClick={() =>
                      void window.imago
                        .call("heritageRevertBatch", { id: b.id })
                        .then(async (n) => {
                          setMessage(t("Vinculación revertida: {n} elementos como estaban.").replace("{n}", formatNumber(n, 0)));
                          await applied();
                        })
                        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                    }
                  >
                    <Undo2 size={13} /> {t("Revertir esta vinculación")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

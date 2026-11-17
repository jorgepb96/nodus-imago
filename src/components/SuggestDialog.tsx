// Completing records from similar images: choose a property; each record
// without it gets a proposed value from its visually closest records that have
// it, shown beside the proposal so the researcher can judge it.
import { useEffect, useMemo, useState } from "react";
import { Check, X, Lightbulb } from "lucide-react";
import type { DatabaseDetail } from "../../shared/databases";
import { confidenceLevel, type NeighbourSuggestion } from "../../shared/suggest";
import { useT, formatNumber } from "../i18n";
import { Button, Modal, Thumbnail } from "./ui";

const TYPES = new Set(["historical_date", "number", "select", "status", "multi_select", "text", "location", "person"]);
const LEVEL: Record<string, string> = { high: "Alta", medium: "Media", low: "Baja" };

export function SuggestDialog({
  detail,
  onClose,
  onApplied,
}: {
  detail: DatabaseDetail;
  onClose: () => void;
  onApplied: (count: number) => void;
}) {
  const t = useT();
  const columns = detail.columns.filter((c) => TYPES.has(c.type));
  const [columnId, setColumnId] = useState(
    () => (columns.find((c) => c.type === "historical_date") ?? columns.find((c) => /fecha|a[ñn]o|date|lugar|place/i.test(c.name)) ?? columns[0])?.id ?? "",
  );
  const [result, setResult] = useState<{ items: NeighbourSuggestion[]; withVectors: number; known: number; missing: number } | null>(null);
  const [decided, setDecided] = useState<Record<string, "accept" | "reject">>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimum, setMinimum] = useState<"all" | "medium" | "high">("all");
  useEffect(() => {
    if (!columnId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    setDecided({});
    void window.imago
      .call("neighbourSuggestions", { databaseId: detail.database.id, columnId })
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [columnId, detail.database.id]);
  const shown = useMemo(
    () =>
      (result?.items ?? []).filter((item) => {
        const level = confidenceLevel(item.confidence);
        return minimum === "all" || level === "high" || (minimum === "medium" && level === "medium");
      }),
    [result, minimum],
  );
  const toggle = (rowId: string, value: "accept" | "reject") =>
    setDecided((current) => {
      const next = { ...current };
      if (next[rowId] === value) delete next[rowId];
      else next[rowId] = value;
      return next;
    });
  const accepted = (result?.items ?? []).filter((i) => decided[i.rowId] === "accept");
  const apply = async (items: NeighbourSuggestion[]) => {
    const count = await window.imago.call("neighbourSuggestionsApply", {
      items: items.map((i) => ({ rowId: i.rowId, columnId, value: i.value })),
    });
    onApplied(count);
  };
  return (
    <Modal icon={Lightbulb} title={t("Completar con imágenes parecidas")} onClose={onClose} wide>
      <div className="modal-body suggest-dialog" data-testid="suggest-dialog">
        <p className="hint">
          {t("Para cada registro sin valor en la propiedad elegida, Imago busca las imágenes más parecidas que sí lo tienen y propone un valor. Las fechas se proponen como periodo atribuido, entre corchetes. Nada se guarda hasta que lo aceptas, y se puede deshacer.")}
        </p>
        <div className="suggest-controls">
          <label>
            {t("Propiedad")}
            <select value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" role="group" aria-label={t("Confianza")}>
            {(["all", "medium", "high"] as const).map((v) => (
              <button key={v} type="button" className={minimum === v ? "active" : ""} onClick={() => setMinimum(v)}>
                {t(v === "all" ? "Todas" : v === "medium" ? "Media o alta" : "Solo alta")}
              </button>
            ))}
          </div>
          {result && (
            <span className="suggest-stats">
              {t("{m} registros sin valor · {k} con valor · {v} con imagen indexada")
                .replace("{m}", formatNumber(result.missing, 0))
                .replace("{k}", formatNumber(result.known, 0))
                .replace("{v}", formatNumber(result.withVectors, 0))}
            </span>
          )}
        </div>
        {loading && <p className="muted">{t("Buscando imágenes parecidas…")}</p>}
        {error && <p className="error">{t(error)}</p>}
        {result && !shown.length && !loading && <p className="muted">{t("No hay propuestas para esta propiedad.")}</p>}
        <ul className="suggest-list">
          {shown.slice(0, 150).map((item) => {
            const level = confidenceLevel(item.confidence),
              state = decided[item.rowId];
            return (
              <li key={item.rowId} className={`suggest-item ${state ? "is-" + state : ""}`} data-testid="suggest-item">
                <div className="suggest-target">
                  <Thumbnail id={item.assetId} alt={item.title} />
                  <strong>{item.title}</strong>
                </div>
                <div className="suggest-proposal">
                  <span className="suggest-value">{item.display}</span>
                  <span className={`suggest-confidence level-${level}`}>
                    {t("Confianza")}: {t(LEVEL[level])} ({Math.round(item.confidence * 100)} %)
                  </span>
                  <div className="suggest-actions">
                    <Button
                      className={state === "accept" ? "is-active" : ""}
                      aria-pressed={state === "accept"}
                      onClick={() => toggle(item.rowId, "accept")}
                    >
                      <Check size={14} />
                      {t("Aceptar")}
                    </Button>
                    <Button
                      aria-pressed={state === "reject"}
                      onClick={() => toggle(item.rowId, "reject")}
                    >
                      <X size={14} />
                      {t("Descartar")}
                    </Button>
                  </div>
                </div>
                <ol className="suggest-evidence" aria-label={t("Imágenes parecidas")}>
                  {item.evidence.map((e) => (
                    <li key={e.rowId} data-tooltip={`${t("Similitud")}: ${Math.round(e.similarity * 100)} %`}>
                      <Thumbnail id={e.assetId} alt="" />
                      <small>{e.value}</small>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      </div>
      <footer>
        <span className="hint">
          {t("{n} aceptadas").replace("{n}", String(accepted.length))}
        </span>
        <Button onClick={onClose}>{t("Cancelar")}</Button>
        <Button
          disabled={!result?.items.some((i) => confidenceLevel(i.confidence) === "high")}
          onClick={() => void apply(result!.items.filter((i) => confidenceLevel(i.confidence) === "high" && decided[i.rowId] !== "reject"))}
        >
          {t("Aceptar todas las de confianza alta")}
        </Button>
        <Button primary disabled={!accepted.length} onClick={() => void apply(accepted)} data-testid="suggest-apply">
          {t("Guardar las aceptadas")}
        </Button>
      </footer>
    </Modal>
  );
}

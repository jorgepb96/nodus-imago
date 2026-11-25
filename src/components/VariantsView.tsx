// Variants and circulation: the same image in several records (copies,
// reproductions, other scans, crops), each family in date order so its first
// dated appearance and later reuses can be read.
import { useCallback, useEffect, useState } from "react";
import { Columns2, Copy, Fingerprint, RefreshCw, Route } from "lucide-react";
import type { Job, SearchInput } from "../../shared/imago";
import type { CirculationSummary, Sensitivity, VariantFamily, VariantStatus } from "../../shared/variants";
import { useT, formatNumber } from "../i18n";
import { Button, Thumbnail } from "./ui";

const MATCH: Record<string, string> = {
  identical: "Mismo archivo",
  near: "Copia o reproducción",
  similar: "Recorte o versión",
  confirmed: "Confirmada por ti",
};

export function VariantsView({
  databaseId,
  search,
  jobs,
  onOpenRecord,
  onCompare,
}: {
  databaseId: string;
  /** The records of the view on screen (data source and filters); every
   * database is searched in full when «everywhere» is ticked. */
  search?: SearchInput;
  jobs: Job[];
  onOpenRecord: (rowId: string) => void;
  onCompare: (assetIds: string[]) => void;
}) {
  const t = useT();
  const [sensitivity, setSensitivity] = useState<Sensitivity>("balanced");
  const [everywhere, setEverywhere] = useState(false);
  const [status, setStatus] = useState<VariantStatus | null>(null);
  const [families, setFamilies] = useState<VariantFamily[] | null>(null);
  const [summary, setSummary] = useState<CirculationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = everywhere ? undefined : [databaseId];
  const running = jobs.some((j) => j.kind === "fingerprints" && ["queued", "running"].includes(j.state));
  const progress = jobs.find((j) => j.kind === "fingerprints" && ["queued", "running"].includes(j.state));
  const scopeKey = JSON.stringify(scope),
    // Only the conditions: the variants of the records the view keeps.
    filterKey = everywhere || !search ? "" : JSON.stringify({ databaseIds: search.databaseIds, filters: search.filters, filterLogic: search.filterLogic, filterGroups: search.filterGroups });
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = JSON.parse(scopeKey) as string[] | undefined;
      const [s, f] = await Promise.all([
        window.imago.call("variantsStatus", { databaseIds: ids }),
        window.imago.call("variantFamilies", { databaseIds: ids, sensitivity, ...(filterKey ? { search: JSON.parse(filterKey) as SearchInput } : {}) }),
      ]);
      setStatus(s);
      setFamilies(f);
      // The circulation summary arrives on its own: the families never wait for it.
      void window.imago
        .call("circulationSummary", { databaseIds: ids, sensitivity, ...(filterKey ? { search: JSON.parse(filterKey) as SearchInput } : {}) })
        .then(setSummary)
        .catch(() => setSummary(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [scopeKey, filterKey, sensitivity]);
  useEffect(() => {
    void load();
  }, [load, running]);
  const images = families?.reduce((n, f) => n + f.members.length, 0) ?? 0;

  return (
    <div className="variants-view" data-testid="variants-view">
      <div className="variants-head">
        <div>
          <h2>{t("Variantes y circulación")}</h2>
          <p>
            {t("Agrupa las imágenes que son la misma fotografía o el mismo grabado en distintos registros: copias, reproducciones en prensa, otros escaneos, recortes o versiones retocadas. Cada grupo se ordena por fecha para ver dónde aparece primero y cómo se reutiliza.")}
          </p>
        </div>
        <div className="variants-controls">
          <div className="segmented" role="group" aria-label={t("Sensibilidad")}>
            {(
              [
                ["strict", "Solo casi idénticas", "Copias y escaneos de la misma imagen, con diferencias mínimas."],
                ["balanced", "Equilibrada", "Copias y reproducciones, y también recortes cuando hay vectores de imagen."],
                ["broad", "Amplia", "Incluye imágenes muy parecidas: puede agrupar tomas distintas del mismo motivo."],
              ] as const
            ).map(([value, label, help]) => (
              <button key={value} type="button" className={sensitivity === value ? "active" : ""} data-tooltip={t(help)} onClick={() => setSensitivity(value)}>
                {t(label)}
              </button>
            ))}
          </div>
          <label className="check-label">
            <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />
            {t("Buscar en todas las bases de datos")}
          </label>
          <Button icon aria-label={t("Actualizar")} data-tooltip={t("Actualizar")} onClick={() => void load()}>
            <RefreshCw size={14} />
          </Button>
        </div>
      </div>
      {status && (status.missing > 0 || running) && (
        <div className="variants-prepare" role="status">
          <Fingerprint size={18} />
          <span>
            {running && progress
              ? `${t("Calculando huellas visuales")}: ${formatNumber(progress.done, 0)} / ${formatNumber(progress.total, 0)}`
              : t("{n} imágenes no tienen todavía huella visual. Se calcula una vez por imagen, en este ordenador, y tarda unos minutos en colecciones grandes.").replace("{n}", formatNumber(status.missing, 0))}
          </span>
          {!running && (
            <Button
              primary
              data-testid="variants-prepare"
              onClick={() =>
                void window.imago
                  .call("variantsPrepare", { databaseIds: scope })
                  .catch((e) => setError(String(e?.message ?? e)))
              }
            >
              {t("Calcular huellas")}
            </Button>
          )}
        </div>
      )}
      {status && sensitivity !== "strict" && status.vectors === 0 && (
        <p className="hint variants-note">
          {t("Sin vectores de imagen, los recortes y las versiones retocadas no se detectan. Indexa las imágenes para la búsqueda semántica si quieres incluirlos.")}
        </p>
      )}
      {error && <p className="error">{t(error)}</p>}
      {families && (
        <p className="variants-summary">
          {families.length
            ? t("{f} grupos con {n} imágenes").replace("{f}", formatNumber(families.length, 0)).replace("{n}", formatNumber(images, 0))
            : loading
              ? t("Buscando…")
              : t("No se han encontrado imágenes repetidas con esta sensibilidad.")}
        </p>
      )}
      {summary && summary.families > 0 && <CirculationOverview summary={summary} onOpenRecord={onOpenRecord} />}
      <div className="variants-list">
        {families?.slice(0, 200).map((family) => (
          <section key={family.id} className="variant-family" data-testid="variant-family">
            <header>
              <Copy size={15} />
              <strong>
                {t("{n} apariciones").replace("{n}", String(family.members.length))}
              </strong>
              {family.firstYear !== null && (
                <span>
                  {family.firstYear === family.lastYear ? family.firstYear : `${family.firstYear}–${family.lastYear}`}
                </span>
              )}
              {family.databases.length > 1 && <span>{family.databases.join(" · ")}</span>}
              <span className="variants-spacer" />
              <Button onClick={() => onCompare(family.members.slice(0, 6).map((m) => m.assetId))}>
                <Columns2 size={14} />
                {t("Comparar")}
              </Button>
            </header>
            <ol className="variant-strip">
              {family.members.map((member, index) => (
                <li key={member.assetId}>
                  <button type="button" onClick={() => onOpenRecord(member.rowId)}>
                    <Thumbnail id={member.assetId} revision={member.revision} alt={member.title} />
                    <span className="variant-date">
                      {member.date ?? t("Sin fecha")}
                      {index === 0 && member.year !== null && <em>{t("Primera aparición fechada")}</em>}
                    </span>
                    <strong>{member.title}</strong>
                    <small>{member.databaseName}</small>
                    <span className={`variant-match match-${member.match}`}>{t(MATCH[member.match])}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

/** The circulation of the collection: what stands out, the most reproduced photographs, and first publications by year. */
function CirculationOverview({ summary, onOpenRecord }: { summary: CirculationSummary; onOpenRecord: (rowId: string) => void }) {
  const t = useT();
  const max = Math.max(1, ...summary.firstYears.map((y) => y.count));
  const span = summary.firstYears.length ? [summary.firstYears[0].year, summary.firstYears.at(-1)!.year] : null;
  // Years without first publications are drawn too, so gaps read as gaps.
  const years = span ? Array.from({ length: Math.min(200, span[1] - span[0] + 1) }, (_, i) => span[0] + i) : [];
  const countOf = new Map(summary.firstYears.map((y) => [y.year, y.count]));
  return (
    <section className="circ-overview" data-testid="circulation-overview">
      <h3>
        <Route size={16} /> {t("Circulación")}
      </h3>
      <div className="circ-facts">
        <span className="circ-fact">
          <b>{formatNumber(summary.published, 0)}</b> {t("de")} {formatNumber(summary.families, 0)} {t("fotografías con alguna publicación conocida")}
        </span>
        {summary.gap.median !== null && (
          <span className="circ-fact" data-tooltip={t("De {min} a {max} años, en {n} fotografías con fecha de toma").replace("{min}", String(summary.gap.min)).replace("{max}", String(summary.gap.max)).replace("{n}", String(summary.gap.n))}>
            <b>{formatNumber(summary.gap.median, 1)}</b> {t("años de mediana entre la toma y la primera publicación")}
          </span>
        )}
        {summary.captionsChange > 0 && (
          <span className="circ-fact">
            <b>{formatNumber(summary.captionsChange, 0)}</b> {t("fotografías publicadas con pies distintos")}
          </span>
        )}
      </div>
      <div className="circ-overview-grid">
        <div>
          <h4>{t("Las más reproducidas")}</h4>
          <ol className="circ-top">
            {summary.top.map((item) => (
              <li key={item.assetId}>
                <button type="button" onClick={() => onOpenRecord(item.rowId)}>
                  <Thumbnail id={item.assetId} revision={item.revision} alt={item.title} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {t("{n} usos").replace("{n}", String(item.uses))}
                      {item.first !== null && ` · ${item.first === item.last ? item.first : `${item.first}–${item.last}`}`}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        {years.length > 0 && (
          <div>
            <h4>{t("Primeras publicaciones por año")}</h4>
            <div className="circ-years" role="img" aria-label={t("Primeras publicaciones por año")}>
              {years.map((year) => (
                <span key={year} data-tooltip={`${year}: ${countOf.get(year) ?? 0}`} style={{ height: `${((countOf.get(year) ?? 0) / max) * 100}%` }} />
              ))}
            </div>
            <div className="circ-years-axis">
              <span>{span![0]}</span>
              <span>{span![1]}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Play,
  Save,
  Download,
  Plus,
  Trash2,
  Search,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
import type { DatabaseDetail } from "../../shared/databases";
import type { PropertyFilter, PropertyFilterGroup } from "../../shared/imago";
import {
  agreementColumn,
  defaultAgreementConfig,
} from "../../shared/agreement";
import type {
  AgreementConfig,
  AgreementExperiment,
  AgreementResult,
  Estimate,
  Rate,
} from "../../shared/agreement";
import { activeFilterCount } from "../../shared/viewCriteria";
import { Modal, Button, Spinner, Thumbnail } from "./ui";
import { CriteriaSelect } from "./CriteriaSelect";
import type { Perform } from "./Properties";
import { useT } from "../i18n";

const pct = (v: number | null) =>
  v == null
    ? "—"
    : (v * 100).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "%";
const decimal = (v: number | null) =>
  v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
const cohortSignature = (item: AgreementResult) =>
  JSON.stringify({
    mode: item.snapshot.input.config.mode,
    rules: {
      ignoreCase: item.snapshot.input.config.ignoreCase,
      placeholdersMissing: item.snapshot.input.config.placeholdersMissing ?? false,
      delimiter: item.snapshot.input.config.delimiter,
      cohort: item.snapshot.input.config.cohort,
      emptySetValid: item.snapshot.input.config.emptySetValid,
      weight: item.snapshot.input.config.weight,
      order: item.snapshot.input.config.categoryOrder,
    },
    categories: item.report.categories,
    ids: item.snapshot.rows.map((r) => r.id).sort(),
    reference: item.snapshot.input.config.referenceId,
    judgments: item.report.rows
      .map((r) => [
        r.source.id,
        item.snapshot.input.config.referenceId
          ? r.judgments[item.snapshot.input.config.referenceId]?.labels
          : null,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });

function RateDisplay({ rate }: { rate: Rate }) {
  const t = useT();
  return (
    <span className="agreement-rate">
      <strong>{pct(rate.value)}</strong>
      <small>
        {rate.count.toLocaleString()} / {rate.n.toLocaleString()}
      </small>
      {rate.interval && (
        <small
          title={t(
            "Intervalo de Wilson al 95%; supone registros independientes.",
          )}
        >
          {t("IC 95%")} {pct(rate.interval[0])}–{pct(rate.interval[1])}
        </small>
      )}
    </span>
  );
}
function EstimateDisplay({ estimate }: { estimate: Estimate }) {
  const t = useT();
  return (
    <span title={estimate.reason ? t(estimate.reason) : undefined}>
      {decimal(estimate.value)}
      {estimate.value == null && (
        <small className="muted">
          {" "}
          · {t(estimate.reason ?? "No estimable")}
        </small>
      )}
    </span>
  );
}
export function AgreementWorkbench({
  detail,
  filters,
  groups,
  logic,
  perform,
  onClose,
  onOpen,
}: {
  detail: DatabaseDetail;
  filters: PropertyFilter[];
  groups: PropertyFilterGroup[];
  logic: "and" | "or";
  perform: Perform;
  onClose: () => void;
  onOpen: (id: string) => Promise<void>;
}) {
  const t = useT(),
    api = window.imago;
  const [tab, setTab] = useState<
    "setup" | "results" | "experiments" | "method"
  >("setup");
  const [config, setConfig] = useState(defaultAgreementConfig);
  const [result, setResult] = useState<AgreementResult | null>(null);
  const [experiments, setExperiments] = useState<AgreementExperiment[]>([]);
  const [comparison, setComparison] = useState<
    { id: string; name: string; result: AgreementResult }[]
  >([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [experimentName, setExperimentName] = useState("");
  const [savedToken, setSavedToken] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [pairIndex, setPairIndex] = useState(0),
    [categorySearch, setCategorySearch] = useState("");
  const [categoryPage, setCategoryPage] = useState(0),
    [confusionPage, setConfusionPage] = useState(0);
  const [reviewQuery, setReviewQuery] = useState(""),
    [reviewKind, setReviewKind] = useState("modelDisagreement"),
    [reviewCategory, setReviewCategory] = useState("");
  const [reviewPage, setReviewPage] = useState(0);
  const columns = detail.columns.filter(agreementColumn),
    columnOptions = columns.map((c) => ({
      value: c.id,
      label: c.name,
      description: c.type,
    }));
  const ids = config.raters.map((r) => r.columnId);
  const filterKey = JSON.stringify({
    filters,
    filterGroups: groups,
    filterLogic: logic,
  });
  const refreshExperiments = async () =>
    setExperiments(
      await api.call("agreementList", { databaseId: detail.database.id }),
    );
  useEffect(() => {
    let disposed = false;
    void api
      .call("agreementList", { databaseId: detail.database.id })
      .then((items) => {
        if (!disposed) setExperiments(items);
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [api, detail.database.id]);
  const patch = (value: Partial<AgreementConfig>) =>
    setConfig((c) => ({ ...c, ...value }));
  const setRaters = (next: string[]) =>
    setConfig((c) => ({
      ...c,
      raters: next.slice(0, 8).map(
        (columnId) =>
          c.raters.find((r) => r.columnId === columnId) ?? {
            columnId,
            label: columns.find((col) => col.id === columnId)!.name,
            model: "",
            prompt: "",
          },
      ),
      aliases: c.aliases.filter(
        (a) => next.includes(a.columnId) || a.columnId === c.referenceId,
      ),
    }));
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await api.call("agreementRun", {
        databaseId: detail.database.id,
        config,
        filters,
        filterGroups: groups,
        filterLogic: logic,
      });
      setResult(next);
      setPairIndex(0);
      setCategoryPage(0);
      setConfusionPage(0);
      setReviewPage(0);
      setReviewCategory("");
      setReviewKind("modelDisagreement");
      setTab("results");
      setSavedToken("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const snapshotConfig = result?.snapshot.input.config;
  const stale =
    result &&
    (JSON.stringify(snapshotConfig) !== JSON.stringify(config) ||
      filterKey !==
        JSON.stringify({
          filters: result.snapshot.input.filters ?? [],
          filterGroups: result.snapshot.input.filterGroups ?? [],
          filterLogic: result.snapshot.input.filterLogic ?? "and",
        }));
  const nameOf = (id: string, item = result) =>
    item?.snapshot.input.config.referenceId === id
      ? `${item.snapshot.columns.find((c) => c.id === id)?.name ?? id} · ${t("Investigador")}`
      : item?.snapshot.input.config.raters.find((r) => r.columnId === id)
          ?.label ||
        item?.snapshot.columns.find((c) => c.id === id)?.name ||
        id;
  const report = result?.report,
    selectedPair = report?.pairs[pairIndex];
  const categoryRows = (selectedPair?.classes ?? []).filter((c) =>
    c.label.toLocaleLowerCase().includes(categorySearch.toLocaleLowerCase()),
  );
  const confusionRows = (selectedPair?.confusion ?? []).filter(
    (c) =>
      !categorySearch ||
      `${c.a} ${c.b}`
        .toLocaleLowerCase()
        .includes(categorySearch.toLocaleLowerCase()),
  );
  const reviewed = useMemo(() => {
    if (!result) return [];
    return result.report.rows.filter((row) => {
      const matchesKind =
        reviewKind === "all" ||
        (reviewKind === "incomplete"
          ? !row.complete
          : row[
              reviewKind as
                "modelDisagreement" | "humanDisagreement" | "unanimousDifferent"
            ]);
      const matchesCategory =
        !reviewCategory ||
        Object.values(row.judgments).some((j) =>
          j.labels?.includes(reviewCategory),
        );
      return (
        matchesKind &&
        matchesCategory &&
        `${row.source.title} ${row.source.id} ${Object.values(row.judgments)
          .flatMap((j) => j.labels ?? [])
          .join(" ")}`
          .toLocaleLowerCase()
          .includes(reviewQuery.toLocaleLowerCase())
      );
    });
  }, [result, reviewKind, reviewCategory, reviewQuery]);
  const load = async (id: string, name: string, compare = false) => {
    setBusy(true);
    setError("");
    try {
      const loaded = await api.call("agreementLoad", { id });
      if (compare)
        setComparison((current) =>
          [
            ...current.filter((c) => c.id !== id),
            { id, name, result: loaded },
          ].slice(-4),
        );
      else {
        setResult(loaded);
        setConfig(loaded.snapshot.input.config);
        setPairIndex(0);
        setCategoryPage(0);
        setConfusionPage(0);
        setReviewPage(0);
        setReviewCategory("");
        setReviewKind("modelDisagreement");
        setTab("results");
        setSavedToken(loaded.token);
        setExperimentName(name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const comparable = useMemo(() => {
    if (comparison.length < 2) return true;
    const baseline = cohortSignature(comparison[0].result);
    return comparison.every((c) => cohortSignature(c.result) === baseline);
  }, [comparison]);
  const validSelection =
    ids.length + (config.referenceId ? 1 : 0) >= 2 &&
    ids.every((id) => columns.some((c) => c.id === id)) &&
    (!config.referenceId || columns.some((c) => c.id === config.referenceId));

  return (
    <Modal
      title={`${t("Concordancia")} · ${detail.database.name}`}
      wide
      layout="panels"
      onClose={onClose}
    >
      <div className="agreement-workbench">
        <nav
          className="view-tabs agreement-tabs"
          aria-label={t("Secciones de concordancia")}
        >
          {(
            [
              ["setup", "Configurar ensayo"],
              ["results", "Resultados"],
              ["experiments", "Ensayos guardados"],
              ["method", "Metodología"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              disabled={id === "results" && !result}
              onClick={() => setTab(id)}
            >
              {t(label)}
            </button>
          ))}
        </nav>
        {error && (
          <p className="agreement-notice" role="alert">
            {t(error)}
          </p>
        )}
        <div className="modal-body agreement-body" aria-busy={busy}>
          {tab === "setup" && (
            <div className="stack">
              <div className="agreement-intro">
                <BarChart3 size={24} />
                <div>
                  <h3>{t("Compara modelos y revisión humana")}</h3>
                  <p>
                    {t(
                      "Una columna por modelo o evaluador y, opcionalmente, otra con la clasificación del investigador. El cálculo usa todos los registros que cumplen los filtros de la vista.",
                    )}
                  </p>
                </div>
              </div>
              <p className="muted">
                {t(
                  "Unidad de análisis: un registro, aunque contenga varias imágenes.",
                )}{" "}
                · {activeFilterCount(filters, groups)} {t("filtros activos")}
              </p>
              <div className="agreement-grid">
                <label>
                  {t("Columnas de modelos / evaluadores (máximo 8)")}
                  <CriteriaSelect
                    label={t("Columnas de modelos / evaluadores (máximo 8)")}
                    multiple
                    options={columnOptions
                      .filter((c) => c.value !== config.referenceId)
                      .map((c) => ({
                        ...c,
                        disabled: !ids.includes(c.value) && ids.length >= 8,
                      }))}
                    values={ids}
                    onChange={setRaters}
                  />
                </label>
                <label>
                  {t("Referencia humana (opcional)")}
                  <CriteriaSelect
                    label={t("Referencia humana (opcional)")}
                    options={columnOptions.filter(
                      (c) => !ids.includes(c.value),
                    )}
                    values={config.referenceId ? [config.referenceId] : []}
                    onChange={(v) =>
                      patch({
                        referenceId: v[0],
                        aliases: config.aliases.filter(
                          (a) =>
                            a.columnId !== config.referenceId ||
                            ids.includes(a.columnId),
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  {t("Tipo de clasificación")}
                  <CriteriaSelect
                    label={t("Tipo de clasificación")}
                    options={[
                      {
                        value: "nominal",
                        label: t("Una categoría por registro"),
                      },
                      {
                        value: "multilabel",
                        label: t("Varias etiquetas por registro"),
                      },
                    ]}
                    values={[config.mode]}
                    onChange={(v) =>
                      patch({
                        mode: v[0] as AgreementConfig["mode"],
                        weight: "none",
                      })
                    }
                  />
                </label>
                <label>
                  {t("Datos incompletos")}
                  <CriteriaSelect
                    label={t("Datos incompletos")}
                    options={[
                      {
                        value: "pairwise",
                        label: t("Casos disponibles por pareja"),
                        description: t(
                          "Cada pareja tiene su propio denominador.",
                        ),
                      },
                      {
                        value: "complete",
                        label: t("Mismos casos completos para todos"),
                        description: t(
                          "Excluye registros sin algún evaluador seleccionado.",
                        ),
                      },
                    ]}
                    values={[config.cohort]}
                    onChange={(v) =>
                      patch({ cohort: v[0] as AgreementConfig["cohort"] })
                    }
                  />
                </label>
              </div>
              {!columns.length && (
                <p className="agreement-notice">
                  {t(
                    "Añade columnas de selección, selección múltiple o texto para comparar clasificaciones.",
                  )}
                </p>
              )}
              {config.mode === "multilabel" && (
                <div className="agreement-grid">
                  <label>
                    {t("Separador de etiquetas en columnas de texto")}
                    <input
                      maxLength={10}
                      value={config.delimiter}
                      onChange={(e) => patch({ delimiter: e.target.value })}
                    />
                    <small className="muted">
                      {t(
                        "Las propiedades de selección múltiple usan sus opciones, sin separador.",
                      )}
                    </small>
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={config.emptySetValid}
                      onChange={(e) =>
                        patch({ emptySetValid: e.target.checked })
                      }
                    />
                    {t(
                      "Tratar [] de selección múltiple como conjunto vacío válido",
                    )}
                  </label>
                </div>
              )}
              <div className="row wrap">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={config.ignoreCase}
                    onChange={(e) => patch({ ignoreCase: e.target.checked })}
                  />
                  {t("Ignorar mayúsculas")}
                </label>
                <label
                  className="check-label"
                  title={t("«-», «s.d.», «n/a», «?» y similares cuentan como juicio ausente.")}
                >
                  <input
                    type="checkbox"
                    checked={config.placeholdersMissing ?? false}
                    onChange={(e) =>
                      patch({ placeholdersMissing: e.target.checked })
                    }
                  />
                  {t("Tratar marcadores de vacío como ausentes")}
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={config.imagesOnly}
                    onChange={(e) => patch({ imagesOnly: e.target.checked })}
                  />
                  {t("Solo registros con imágenes")}
                </label>
              </div>
              <p className="muted">
                {t(
                  "Las tildes se conservan. Los vacíos no se convierten en coincidencias. Usa columnas categóricas, no descripciones completas.",
                )}
              </p>
              <details className="agreement-section">
                <summary>
                  {t(
                    "Identificar modelos, instrucciones y condiciones del ensayo",
                  )}
                </summary>
                {config.raters.map((r, i) => (
                  <fieldset key={r.columnId}>
                    <legend>
                      {columns.find((c) => c.id === r.columnId)?.name ??
                        r.columnId}
                    </legend>
                    <div className="agreement-grid">
                      <label>
                        {t("Nombre del evaluador")}
                        <input
                          maxLength={300}
                          value={r.label}
                          onChange={(e) =>
                            patch({
                              raters: config.raters.map((c, j) =>
                                i === j ? { ...c, label: e.target.value } : c,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        {t("Modelo, proveedor y versión")}
                        <input
                          maxLength={1000}
                          value={r.model}
                          onChange={(e) =>
                            patch({
                              raters: config.raters.map((c, j) =>
                                i === j ? { ...c, model: e.target.value } : c,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      {t("Instrucciones / prompt")}
                      <textarea
                        maxLength={30000}
                        value={r.prompt}
                        onChange={(e) =>
                          patch({
                            raters: config.raters.map((c, j) =>
                              i === j ? { ...c, prompt: e.target.value } : c,
                            ),
                          })
                        }
                      />
                    </label>
                  </fieldset>
                ))}
                <label>
                  {t("Notas metodológicas")}
                  <textarea
                    maxLength={30000}
                    value={config.notes}
                    onChange={(e) => patch({ notes: e.target.value })}
                  />
                </label>
                <p className="muted">
                  {t(
                    "Estos campos documentan el ensayo. Genera las clasificaciones desde Analizar y los ajustes de modelos; usa una columna independiente para cada ejecución.",
                  )}
                </p>
                <p className="muted">
                  {t(
                    "Se guarda también la procedencia disponible de las propuestas de IA. La identificación manual del ensayo no sustituye el historial de cada celda.",
                  )}
                </p>
              </details>
              <details className="agreement-section">
                <summary>{t("Equivalencias entre categorías")}</summary>
                <p className="muted">
                  {t(
                    "Cada equivalencia transforma una etiqueta de una columna en una categoría común. Se aplica una sola vez y no modifica los datos originales.",
                  )}
                </p>
                {config.aliases.map((a, i) => (
                  <div className="agreement-alias" key={i}>
                    <CriteriaSelect
                      label={t("Columna de la equivalencia")}
                      options={columnOptions.filter(
                        (c) =>
                          ids.includes(c.value) ||
                          c.value === config.referenceId,
                      )}
                      values={[a.columnId]}
                      onChange={(v) =>
                        patch({
                          aliases: config.aliases.map((c, j) =>
                            i === j ? { ...c, columnId: v[0] ?? "" } : c,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={t("Etiqueta original")}
                      placeholder={t("Etiqueta original")}
                      maxLength={500}
                      value={a.from}
                      onChange={(e) =>
                        patch({
                          aliases: config.aliases.map((c, j) =>
                            i === j ? { ...c, from: e.target.value } : c,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={t("Categoría común")}
                      placeholder={t("Categoría común")}
                      maxLength={500}
                      value={a.to}
                      onChange={(e) =>
                        patch({
                          aliases: config.aliases.map((c, j) =>
                            i === j ? { ...c, to: e.target.value } : c,
                          ),
                        })
                      }
                    />
                    <Button
                      icon
                      aria-label={t("Eliminar equivalencia")}
                      onClick={() =>
                        patch({
                          aliases: config.aliases.filter((_, j) => i !== j),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                ))}
                <Button
                  disabled={!ids.length || config.aliases.length >= 500}
                  onClick={() =>
                    patch({
                      aliases: [
                        ...config.aliases,
                        { columnId: ids[0], from: "", to: "" },
                      ],
                    })
                  }
                >
                  <Plus size={14} />
                  {t("Añadir equivalencia")}
                </Button>
              </details>
              {config.mode === "nominal" && (
                <details className="agreement-section">
                  <summary>
                    {t("Escala ordinal y kappa ponderado (opcional)")}
                  </summary>
                  <p>
                    {t(
                      "Las categorías temáticas son nominales. Activa pesos solo si tus categorías tienen un orden justificable, como grados de intensidad.",
                    )}
                  </p>
                  <CriteriaSelect
                    label={t("Ponderación de Cohen")}
                    options={[
                      { value: "none", label: t("Sin ponderación (nominal)") },
                      { value: "linear", label: t("Lineal (ordinal)") },
                      { value: "quadratic", label: t("Cuadrática (ordinal)") },
                    ]}
                    values={[config.weight]}
                    onChange={(v) =>
                      patch({ weight: v[0] as AgreementConfig["weight"] })
                    }
                  />
                  {config.weight !== "none" && (
                    <label>
                      {t(
                        "Categorías ordenadas de menor a mayor, una por línea",
                      )}
                      <textarea
                        value={config.categoryOrder.join("\n")}
                        onChange={(e) =>
                          patch({ categoryOrder: e.target.value.split("\n") })
                        }
                      />
                      <small className="muted">
                        {t(
                          "Incluye todas las categorías normalizadas, después de aplicar equivalencias. Máximo 100.",
                        )}
                      </small>
                    </label>
                  )}
                </details>
              )}
            </div>
          )}

          {tab === "results" && result && report && (
            <div className="stack">
              <div className="agreement-result-heading">
                <div>
                  <h3>{t("Instantánea del ensayo")}</h3>
                  <p>
                    {new Date(result.snapshot.createdAt).toLocaleString()} ·{" "}
                    {report.total.toLocaleString()} {t("registros analizados")}{" "}
                    · {report.categories.length} {t("categorías observadas")}
                  </p>
                </div>
                <Button onClick={() => setTab("setup")}>
                  {t("Editar configuración")}
                </Button>
              </div>
              {stale && (
                <p className="agreement-notice">
                  {t(
                    "La configuración o los filtros actuales difieren de esta instantánea. Guardar y exportar conservan el resultado mostrado; recalcular crea uno nuevo.",
                  )}
                </p>
              )}
              <p className="muted">
                {t(
                  "Los resultados son una instantánea; las ediciones posteriores y las nuevas tareas de IA no la alteran.",
                )}
              </p>
              {report.total === 0 ? (
                <p className="agreement-notice">
                  {t(
                    "No hay registros en este conjunto. Revisa los filtros y la opción de imágenes.",
                  )}
                </p>
              ) : (
                <>
                  <div className="agreement-cards">
                    <article>
                      <span>{t("Unanimidad entre modelos")}</span>
                      <RateDisplay rate={report.models.unanimity} />
                      <small>
                        {t("Solo registros con todos los modelos válidos.")}
                      </small>
                    </article>
                    {report.human && (
                      <>
                        <article>
                          <span>
                            {t(
                              "Al menos un modelo coincide con el investigador",
                            )}
                          </span>
                          <RateDisplay rate={report.human.any} />
                        </article>
                        <article>
                          <span>
                            {t(
                              "Todos los modelos coinciden con el investigador",
                            )}
                          </span>
                          <RateDisplay rate={report.human.all} />
                        </article>
                        <article>
                          <span>
                            {t("Mayoría estricta frente al investigador")}
                          </span>
                          <RateDisplay rate={report.human.majority} />
                          <small>
                            {report.human.noMajority}{" "}
                            {t("sin mayoría estricta")}
                          </small>
                        </article>
                      </>
                    )}
                  </div>
                  {report.human && (
                    <p className="muted">
                      {t(
                        "Los porcentajes «al menos uno» y «todos» usan los casos completos de todos los modelos y la referencia humana.",
                      )}{" "}
                      {report.human.unanimousDifferent}{" "}
                      {t(
                        "registros con unanimidad de modelos diferente de la referencia.",
                      )}
                    </p>
                  )}
                  <section className="agreement-section">
                    <h3>{t("Cobertura y datos excluidos")}</h3>
                    <p className="muted">
                      {report.complete} / {report.total}{" "}
                      {t("casos completos de todos los evaluadores")} ·{" "}
                      {result.snapshot.matched - report.total}{" "}
                      {t("excluidos por no tener imágenes")}
                    </p>
                    <div className="agreement-table">
                      <table>
                        <thead>
                          <tr>
                            <th>{t("Evaluador")}</th>
                            <th>{t("Válidos")}</th>
                            <th>{t("Vacíos")}</th>
                            <th>{t("Inválidos")}</th>
                            <th>{t("Cobertura")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.coverage.map((c) => (
                            <tr key={c.columnId}>
                              <th>{nameOf(c.columnId)}</th>
                              <td>{c.valid}</td>
                              <td>{c.missing}</td>
                              <td>{c.invalid}</td>
                              <td>
                                <progress
                                  value={c.valid}
                                  max={report.total || 1}
                                />
                                {pct(
                                  report.total ? c.valid / report.total : null,
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="muted">
                      {t(
                        "Inválidos: opciones borradas, texto demasiado largo o varias categorías en modo de categoría única. Revisa esos registros antes de interpretar el resultado.",
                      )}
                    </p>
                  </section>
                  <section className="agreement-section">
                    <h3>{t("Acuerdo del conjunto de evaluadores")}</h3>
                    <div className="agreement-table">
                      <table>
                        <thead>
                          <tr>
                            <th>{t("Grupo")}</th>
                            <th>{t("Casos completos")}</th>
                            <th>κ Fleiss</th>
                            <th>α Krippendorff ({t("nominal")})</th>
                            <th>{t("Casos / juicios para α")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            [
                              ["Solo modelos", report.models],
                              ...(report.human
                                ? [
                                    [
                                      "Modelos e investigador",
                                      report.all,
                                    ] as const,
                                  ]
                                : []),
                            ] as const
                          ).map(([name, g]) => (
                            <tr key={name}>
                              <th>{t(name)}</th>
                              <td>{g.complete}</td>
                              <td>
                                <EstimateDisplay estimate={g.fleiss} />
                              </td>
                              <td>
                                <EstimateDisplay estimate={g.alpha} />
                              </td>
                              <td>
                                {g.alphaUnits} / {g.alphaRatings}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="muted">
                      {t(
                        "Fleiss usa casos completos del grupo. Alfa nominal aprovecha registros con al menos dos juicios válidos, salvo que hayas elegido casos completos para todos.",
                      )}
                    </p>
                  </section>
                  <section className="agreement-section">
                    <h3>{t("Comparación por parejas")}</h3>
                    <p className="muted">
                      {t(
                        "Selecciona una pareja para explorar categorías y confusiones. Cada n cuenta registros, no etiquetas.",
                      )}
                    </p>
                    <div className="agreement-table">
                      <table>
                        <thead>
                          <tr>
                            <th>{t("Pareja")}</th>
                            <th>n</th>
                            <th>{t("Acuerdo exacto")}</th>
                            <th>κ Cohen</th>
                            {snapshotConfig?.weight !== "none" && (
                              <th>{t("κ ponderado")}</th>
                            )}
                            {snapshotConfig?.mode === "multilabel" && (
                              <th>Jaccard</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {report.pairs.map((p, i) => (
                            <tr
                              className={i === pairIndex ? "selected" : ""}
                              key={`${p.a}:${p.b}`}
                            >
                              <th>
                                <button
                                  className="agreement-link"
                                  onClick={() => {
                                    setPairIndex(i);
                                    setCategoryPage(0);
                                    setConfusionPage(0);
                                    setCategorySearch("");
                                  }}
                                >
                                  {nameOf(p.a)} ↔ {nameOf(p.b)}
                                </button>
                              </th>
                              <td title={`${p.excluded} ${t("excluidos")}`}>
                                {p.n}
                              </td>
                              <td>
                                <RateDisplay rate={p.exact} />
                              </td>
                              <td>
                                <EstimateDisplay estimate={p.kappa} />
                              </td>
                              {snapshotConfig?.weight !== "none" && (
                                <td>
                                  <EstimateDisplay estimate={p.weightedKappa} />
                                </td>
                              )}
                              {snapshotConfig?.mode === "multilabel" && (
                                <td>{decimal(p.jaccard)}</td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  {selectedPair && (
                    <section className="agreement-section">
                      <h3>
                        {nameOf(selectedPair.a)} → {nameOf(selectedPair.b)}
                      </h3>
                      <p className="muted">
                        {t(
                          "A es la referencia para las métricas direccionales. Con el investigador, A siempre es su columna. Coincidir con una referencia no demuestra por sí solo la verdad histórica.",
                        )}
                      </p>
                      <div className="agreement-pair-summary">
                        <span>
                          F1 micro: <b>{decimal(selectedPair.microF1)}</b>
                        </span>
                        <span>
                          F1 macro: <b>{decimal(selectedPair.macroF1)}</b>
                        </span>
                        <span>n = {selectedPair.n}</span>
                      </div>
                      <label className="agreement-search">
                        <Search size={15} />
                        <input
                          aria-label={t("Buscar categoría en resultados")}
                          placeholder={t("Buscar categoría en resultados")}
                          value={categorySearch}
                          onChange={(e) => {
                            setCategorySearch(e.target.value);
                            setCategoryPage(0);
                            setConfusionPage(0);
                          }}
                        />
                      </label>
                      <h4>{t("Categorías y sesgos de asignación")}</h4>
                      <p className="muted">
                        {t(
                          "La diferencia B − A muestra sobreasignación o infraasignación frente a la referencia en esta pareja.",
                        )}
                      </p>
                      <div className="agreement-table">
                        <table>
                          <thead>
                            <tr>
                              <th>{t("Categoría")}</th>
                              <th>A</th>
                              <th>B</th>
                              <th>B − A</th>
                              <th>{t("Ambos")}</th>
                              <th>{t("Precisión")}</th>
                              <th>{t("Sensibilidad")}</th>
                              <th>F1</th>
                              <th>κ {t("binario")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {categoryRows
                              .slice(categoryPage * 30, (categoryPage + 1) * 30)
                              .map((c) => (
                                <tr key={c.label}>
                                  <th>{c.label}</th>
                                  <td>{c.a}</td>
                                  <td>{c.b}</td>
                                  <td>
                                    {c.b - c.a > 0 ? "+" : ""}
                                    {c.b - c.a}
                                  </td>
                                  <td>{c.both}</td>
                                  <td>{pct(c.precision)}</td>
                                  <td>{pct(c.recall)}</td>
                                  <td>{decimal(c.f1)}</td>
                                  <td
                                    title={
                                      c.kappa.reason
                                        ? t(c.kappa.reason)
                                        : undefined
                                    }
                                  >
                                    {decimal(c.kappa.value)}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                      <Pages
                        page={categoryPage}
                        total={categoryRows.length}
                        size={30}
                        onChange={setCategoryPage}
                      />
                      <h4>
                        {snapshotConfig?.mode === "nominal"
                          ? t("Matriz de confusión (formato de pares)")
                          : t("Cruces de conjuntos de etiquetas")}
                      </h4>
                      <p className="muted">
                        {t(
                          "Se muestran los cruces observados, incluidos los acuerdos. A = filas de referencia; B = asignaciones comparadas. Los cruces no mostrados tienen frecuencia cero.",
                        )}
                      </p>
                      <div className="agreement-table">
                        <table>
                          <thead>
                            <tr>
                              <th>A</th>
                              <th>B</th>
                              <th>{t("Registros")}</th>
                              <th>{t("Porcentaje de la pareja")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {confusionRows
                              .slice(
                                confusionPage * 30,
                                (confusionPage + 1) * 30,
                              )
                              .map((c) => (
                                <tr
                                  key={JSON.stringify([c.a, c.b])}
                                  className={
                                    c.a !== c.b ? "agreement-disagreement" : ""
                                  }
                                >
                                  <th>{c.a}</th>
                                  <td>{c.b}</td>
                                  <td>{c.count}</td>
                                  <td>
                                    {pct(
                                      selectedPair.n
                                        ? c.count / selectedPair.n
                                        : null,
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                      <Pages
                        page={confusionPage}
                        total={confusionRows.length}
                        size={30}
                        onChange={setConfusionPage}
                      />
                    </section>
                  )}
                  <section className="agreement-section">
                    <h3>{t("Revisar registros y discrepancias")}</h3>
                    <div className="agreement-grid">
                      <CriteriaSelect
                        label={t("Tipo de discrepancia")}
                        options={[
                          {
                            value: "modelDisagreement",
                            label: t("Desacuerdo entre modelos"),
                          },
                          ...(report.human
                            ? [
                                {
                                  value: "humanDisagreement",
                                  label: t(
                                    "Algún modelo difiere del investigador",
                                  ),
                                },
                                {
                                  value: "unanimousDifferent",
                                  label: t(
                                    "Modelos unánimes que difieren del investigador",
                                  ),
                                },
                              ]
                            : []),
                          {
                            value: "incomplete",
                            label: t("Registros incompletos o inválidos"),
                          },
                          {
                            value: "all",
                            label: t("Todos los registros del ensayo"),
                          },
                        ]}
                        values={[reviewKind]}
                        onChange={(v) => {
                          setReviewKind(v[0] ?? "all");
                          setReviewPage(0);
                        }}
                      />
                      <CriteriaSelect
                        label={t("Filtrar revisión por categoría")}
                        options={report.categories.map((label) => ({
                          value: label,
                          label,
                        }))}
                        values={reviewCategory ? [reviewCategory] : []}
                        onChange={(v) => {
                          setReviewCategory(v[0] ?? "");
                          setReviewPage(0);
                        }}
                      />
                    </div>
                    <label className="agreement-search">
                      <Search size={15} />
                      <input
                        aria-label={t("Buscar registros del ensayo")}
                        placeholder={t("Buscar registros del ensayo")}
                        value={reviewQuery}
                        onChange={(e) => {
                          setReviewQuery(e.target.value);
                          setReviewPage(0);
                        }}
                      />
                    </label>
                    <p className="muted">
                      {reviewed.length} {t("registros")}
                    </p>
                    <div className="agreement-review-list">
                      {reviewed
                        .slice(reviewPage * 30, (reviewPage + 1) * 30)
                        .map((r) => (
                          <article key={r.source.id}>
                            <Thumbnail
                              id={r.source.image?.id}
                              revision={r.source.image?.revision}
                            />
                            <div>
                              <strong>{r.source.title || r.source.id}</strong>
                              <dl>
                                {report.coverage.map((c) => (
                                  <div key={c.columnId}>
                                    <dt>{nameOf(c.columnId)}</dt>
                                    <dd>
                                      {r.judgments[c.columnId].labels?.join(
                                        " · ",
                                      ) ||
                                        (r.judgments[c.columnId].labels !== null
                                          ? "∅"
                                          : t(
                                              r.judgments[c.columnId].issue ===
                                                "invalid"
                                                ? "Inválido"
                                                : "Sin dato",
                                            ))}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                            <Button
                              aria-label={`${t("Abrir registro")} ${r.source.title}`}
                              onClick={() =>
                                void perform(() => onOpen(r.source.id))
                              }
                            >
                              <ArrowUpRight size={15} />
                              {t("Abrir registro")}
                            </Button>
                          </article>
                        ))}
                    </div>
                    <Pages
                      page={reviewPage}
                      total={reviewed.length}
                      size={30}
                      onChange={setReviewPage}
                    />
                  </section>
                </>
              )}
              <section className="agreement-section">
                <h3>{t("Guardar una instantánea reproducible")}</h3>
                <p className="muted">
                  {t(
                    "Incluye valores originales, etiquetas normalizadas, opciones, filtros, instrucciones, procedencia disponible y resultados. No incluye los archivos de imagen.",
                  )}
                </p>
                <div className="row">
                  <input
                    aria-label={t("Nombre del ensayo")}
                    placeholder={t("Nombre del ensayo")}
                    maxLength={300}
                    value={experimentName}
                    onChange={(e) => setExperimentName(e.target.value)}
                  />
                  <Button
                    disabled={
                      !experimentName.trim() ||
                      savedToken === result.token ||
                      busy
                    }
                    onClick={() =>
                      void perform(async () => {
                        await api.call("agreementSave", {
                          token: result.token,
                          name: experimentName,
                        });
                        setSavedToken(result.token);
                        await refreshExperiments();
                      })
                    }
                  >
                    <Save size={14} />
                    {t(
                      savedToken === result.token
                        ? "Guardado"
                        : "Guardar ensayo",
                    )}
                  </Button>
                </div>
                <div className="row wrap">
                  {(["csv", "json"] as const).map((format) => (
                    <Button
                      key={format}
                      onClick={() =>
                        void perform(async () => {
                          await api.call("agreementExport", {
                            token: result.token,
                            format,
                          });
                        })
                      }
                    >
                      <Download size={14} />
                      {t("Exportar")} {format.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </section>
              <details className="agreement-section">
                <summary>
                  {t("Configuración y procedencia de esta instantánea")}
                </summary>
                <p>
                  {t("Referencia humana")}:{" "}
                  {snapshotConfig?.referenceId
                    ? nameOf(snapshotConfig.referenceId)
                    : t("Sin referencia humana")}
                </p>
                <p>
                  {t("Modo")}:{" "}
                  {t(
                    snapshotConfig?.mode === "multilabel"
                      ? "Varias etiquetas por registro"
                      : "Una categoría por registro",
                  )}{" "}
                  ·{" "}
                  {t(
                    snapshotConfig?.cohort === "complete"
                      ? "Mismos casos completos para todos"
                      : "Casos disponibles por pareja",
                  )}
                </p>
                {snapshotConfig?.raters.map((r) => (
                  <article key={r.columnId}>
                    <h4>{r.label}</h4>
                    <p>{r.model || t("Modelo no documentado")}</p>
                    <pre>{r.prompt || t("Sin instrucciones documentadas")}</pre>
                  </article>
                ))}
                <pre>{snapshotConfig?.notes}</pre>
                {result.snapshot.provenance.map((p, i) => (
                  <details key={i}>
                    <summary>
                      {nameOf(p.columnId)} · {p.model} · {p.count}{" "}
                      {t("propuestas")} · {p.state}
                    </summary>
                    <p>
                      {p.revision} · {p.currentMatches}{" "}
                      {t("valores aceptados coinciden con la celda actual")}
                    </p>
                    <pre>{p.prompt}</pre>
                  </details>
                ))}
                <p className="muted">
                  {t(
                    "La procedencia registra propuestas históricas. Puede contener varios modelos o instrucciones por columna; revisa su homogeneidad antes de comparar ensayos.",
                  )}
                </p>
                <pre>{JSON.stringify(result.snapshot.input, null, 2)}</pre>
              </details>
            </div>
          )}

          {tab === "experiments" && (
            <div className="stack">
              <h3>{t("Ensayos guardados en esta base de datos")}</h3>
              <p className="muted">
                {t(
                  "Cada ensayo conserva sus datos y condiciones. Puedes abrirlo, reutilizar su configuración y calcular otro con los filtros actuales. Las copias de seguridad incluyen los ensayos.",
                )}
              </p>
              {!experiments.length && (
                <p>{t("Todavía no hay ensayos guardados.")}</p>
              )}
              <div className="agreement-experiments">
                {experiments.map((e) => (
                  <article key={e.id}>
                    <div>
                      <strong>{e.name}</strong>
                      <small>
                        {new Date(e.createdAt).toLocaleString()} · {e.total}{" "}
                        {t("registros")} · {e.complete} {t("completos")}
                      </small>
                    </div>
                    <div className="row wrap">
                      <Button
                        disabled={busy}
                        onClick={() => void load(e.id, e.name)}
                      >
                        {t("Abrir ensayo")}
                      </Button>
                      <Button
                        disabled={
                          busy ||
                          comparison.length >= 4 ||
                          comparison.some((c) => c.id === e.id)
                        }
                        onClick={() => void load(e.id, e.name, true)}
                      >
                        <Plus size={14} />
                        {t("Comparar")}
                      </Button>
                      <Button
                        icon={deleteId !== e.id}
                        disabled={busy}
                        aria-label={`${t("Eliminar ensayo")} ${e.name}`}
                        onClick={() => {
                          if (deleteId !== e.id) {
                            setDeleteId(e.id);
                            return;
                          }
                          void perform(async () => {
                            await api.call("agreementDelete", { id: e.id });
                            setSavedToken("");
                            setDeleteId("");
                            setComparison((c) =>
                              c.filter((item) => item.id !== e.id),
                            );
                            await refreshExperiments();
                          });
                        }}
                      >
                        <Trash2 size={15} />
                        {deleteId === e.id && t("Confirmar eliminación")}
                      </Button>
                      {deleteId === e.id && (
                        <Button onClick={() => setDeleteId("")}>
                          {t("Cancelar")}
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {!!comparison.length && (
                <section className="agreement-section">
                  <div className="row">
                    <h3>{t("Comparación de ensayos")}</h3>
                    <Button onClick={() => setComparison([])}>
                      {t("Limpiar comparación")}
                    </Button>
                  </div>
                  {!comparable && (
                    <p className="agreement-notice">
                      {t(
                        "Los ensayos difieren en registros, referencia humana, categorías o reglas de cálculo. Los porcentajes no permiten una comparación directa de rendimiento.",
                      )}
                    </p>
                  )}
                  <p className="muted">
                    {t(
                      "Compara también denominadores, cobertura, taxonomías e instrucciones. Cambiar el número de modelos cambia la interpretación de unanimidad y «al menos uno».",
                    )}
                  </p>
                  <div className="agreement-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Ensayo")}</th>
                          <th>{t("Modelos")}</th>
                          <th>n</th>
                          <th>{t("Unanimidad")}</th>
                          <th>{t("Al menos uno / humano")}</th>
                          <th>κ Fleiss</th>
                          <th>α</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.map((c) => (
                          <tr key={c.result.token}>
                            <th>{c.name}</th>
                            <td>
                              {c.result.snapshot.input.config.raters
                                .map((r) => r.model || r.label)
                                .join(" · ")}
                            </td>
                            <td>{c.result.report.total}</td>
                            <td>
                              <RateDisplay
                                rate={c.result.report.models.unanimity}
                              />
                            </td>
                            <td>
                              {c.result.report.human ? (
                                <RateDisplay rate={c.result.report.human.any} />
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              {decimal(c.result.report.models.fleiss.value)}
                            </td>
                            <td>
                              {decimal(c.result.report.models.alpha.value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <h4>{t("Cada modelo frente a la referencia humana")}</h4>
                  <div className="agreement-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Ensayo")}</th>
                          <th>{t("Modelo / evaluador")}</th>
                          <th>n</th>
                          <th>{t("Acuerdo exacto")}</th>
                          <th>κ Cohen</th>
                          <th>F1 micro</th>
                          <th>F1 macro</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.flatMap((c) =>
                          c.result.report.pairs
                            .filter(
                              (p) =>
                                p.a ===
                                c.result.snapshot.input.config.referenceId,
                            )
                            .map((p) => (
                              <tr key={`${c.result.token}:${p.b}`}>
                                <th>{c.name}</th>
                                <td>{nameOf(p.b, c.result)}</td>
                                <td>{p.n}</td>
                                <td>
                                  <RateDisplay rate={p.exact} />
                                </td>
                                <td>{decimal(p.kappa.value)}</td>
                                <td>{decimal(p.microF1)}</td>
                                <td>{decimal(p.macroF1)}</td>
                              </tr>
                            )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}
          {tab === "method" && <Methodology />}
        </div>
        <footer>
          <p className="muted">
            {t("Cálculo local · sin llamadas a modelos ni APIs")}
          </p>
          <Button disabled={busy} onClick={onClose}>
            {t("Cerrar")}
          </Button>
          <Button
            primary
            disabled={!validSelection || busy}
            onClick={() => void run()}
          >
            {busy ? (
              <Spinner />
            ) : result ? (
              <RefreshCw size={15} />
            ) : (
              <Play size={15} />
            )}{" "}
            {t(
              result
                ? "Recalcular con filtros actuales"
                : "Calcular concordancia",
            )}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
function Pages({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (page: number) => void;
}) {
  const t = useT();
  if (total <= size) return null;
  return (
    <div className="agreement-pagination">
      <Button disabled={page === 0} onClick={() => onChange(page - 1)}>
        {t("Anterior")}
      </Button>
      <span>
        {page + 1} / {Math.ceil(total / size)} · {total}
      </span>
      <Button
        disabled={(page + 1) * size >= total}
        onClick={() => onChange(page + 1)}
      >
        {t("Siguiente")}
      </Button>
    </div>
  );
}
function Methodology() {
  const t = useT();
  const paragraphs = [
    [
      "Unidad y muestra",
      "Cada registro es una unidad de análisis. Si contiene varias imágenes, no se cuentan como juicios independientes. Los filtros actuales definen la muestra; el cálculo no se limita a la página visible. Los ensayos almacenan los identificadores y valores originales de cada registro.",
    ],
    [
      "Acuerdo observado",
      "Unanimidad exige que todos los modelos seleccionados coincidan exactamente. «Al menos uno» exige coincidencia de algún modelo con la referencia humana; «todos», de todos ellos. Ambos usan registros completos de modelos y referencia. La mayoría es estricta: más de la mitad de los modelos debe dar la misma categoría o el mismo conjunto; se excluyen los casos sin mayoría de su porcentaje y se informa su número.",
    ],
    [
      "Cohen y ponderación",
      "κ = (Po − Pe) / (1 − Pe). Po es el acuerdo observado y Pe procede de los marginales de cada evaluador. El kappa nominal no presupone orden. El ponderado usa distancias lineales o cuadráticas entre categorías de una escala ordinal declarada. No es adecuado imponer un orden a temas históricos.",
    ],
    [
      "Fleiss y Krippendorff",
      "Fleiss usa un número fijo de evaluadores y casos completos del grupo. Alfa nominal usa coincidencias ponderadas por el número de juicios válidos de cada registro y excluye las unidades con menos de dos. Elegir casos completos para todos restringe también estos índices. No se asigna un valor ficticio cuando falta variación o muestra.",
    ],
    [
      "Multietiqueta",
      "El acuerdo exacto compara conjuntos sin atender al orden. Jaccard es la media de intersección / unión por registro; dos conjuntos vacíos válidos tienen Jaccard 1. El kappa binario por categoría compara presencia y ausencia en registros con ambos juicios válidos. No se informa un kappa nominal global ni Fleiss o alfa global para etiquetas mezcladas.",
    ],
    [
      "Referencia y categorías",
      "En cada pareja, A es la referencia direccional; si interviene el investigador, A es su columna. Precisión = ambos / B; sensibilidad = ambos / A; F1 = 2 × ambos / (A + B). F1 micro agrega recuentos y F1 macro promedia las categorías observadas en esa pareja. Las categorías ausentes en ambos no se incorporan artificialmente. No se asume que la clasificación humana sea infalible.",
    ],
    [
      "Vacíos, normalización y equivalencias",
      "Los vacíos y los valores inválidos se excluyen, no se consideran acuerdos. Puedes declarar [] como conjunto vacío válido en selección múltiple; una celda nula sigue siendo un dato ausente. Se normaliza Unicode NFKC y se recortan espacios; opcionalmente se ignoran mayúsculas. Las tildes se conservan. Las opciones de distintas columnas se comparan por etiqueta, no por identificador. Las equivalencias son explícitas y se aplican una sola vez.",
    ],
    [
      "Incertidumbre e interpretación",
      "El intervalo del acuerdo exacto es Wilson al 95% y presupone registros independientes. No es un intervalo de kappa ni una prueba de superioridad entre modelos. Imágenes del mismo libro, fotógrafo o serie pueden estar relacionadas; diseña el muestreo con esa dependencia en mente. Examina cobertura, prevalencia, confusiones y sesgos junto a los índices; un acuerdo alto no demuestra exactitud histórica.",
    ],
    [
      "Reproducibilidad",
      "Guardar conserva una instantánea local con configuración, opciones y valores originales, normalizados y procedencia disponible. Exporta JSON para reproducir todos los resultados; CSV ofrece tablas en formato largo con secciones de métricas, categorías, confusiones y registros. Las imágenes permanecen en la colección. Las nuevas ejecuciones no sobrescriben los ensayos anteriores.",
    ],
  ];
  return (
    <div className="stack agreement-method">
      <h3>{t("Cómo interpretar el análisis")}</h3>
      {paragraphs.map(([title, body]) => (
        <section key={title}>
          <h4>{t(title)}</h4>
          <p>{t(body)}</p>
        </section>
      ))}
      <section>
        <h4>{t("Referencias metodológicas")}</h4>
        <p>
          Cohen (1960), <em>A coefficient of agreement for nominal scales</em>.
          DOI: 10.1177/001316446002000104.
        </p>
        <p>
          Fleiss (1971),{" "}
          <em>Measuring nominal scale agreement among many raters</em>. DOI:
          10.1037/h0031619.
        </p>
        <p>
          Krippendorff (2013),{" "}
          <em>Computing Krippendorff’s Alpha-Reliability</em>, University of
          Pennsylvania.
        </p>
        <p>
          Wilson (1927),{" "}
          <em>
            Probable inference, the law of succession, and statistical inference
          </em>
          . DOI: 10.1080/01621459.1927.10502953.
        </p>
      </section>
    </div>
  );
}

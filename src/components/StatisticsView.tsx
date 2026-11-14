// Statistics view: build a statistic over the records the view selects
// (filters and search box), see it as a chart with its figures and test,
// and save it with the database to come back to it.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChartColumn,
  ChartLine,
  ClipboardCopy,
  Grid3x3,
  Hash,
  Plus,
  Save,
  Sigma,
  Trash2,
} from "lucide-react";
import type { DatabaseColumn, DatabaseDetail } from "../../shared/databases";
import type { Commands, SearchInput } from "../../shared/imago";
import {
  MULTI_TYPES,
  type SavedStatistic,
  type StatResult,
  type StatSpec,
} from "../../shared/statistics";
import type { ColumnPrefs } from "../columnPrefs";
import { formatNumber, uiLocale, useT } from "../i18n";
import { BarList, ColumnChart, Heatmap, LineChart } from "./charts";
import { CriteriaSelect } from "./CriteriaSelect";
import type { Perform } from "./Properties";
import { Button, Empty, Modal, Spinner } from "./ui";

type Kind = StatSpec["kind"];
const KINDS: { id: Kind; label: string; hint: string; icon: typeof Sigma }[] = [
  { id: "frequency", label: "Frecuencias", hint: "Cuántos registros tiene cada valor", icon: ChartColumn },
  { id: "crosstab", label: "Tabla cruzada · χ²", hint: "Relación entre dos propiedades, con prueba de chi cuadrado", icon: Grid3x3 },
  { id: "cooccurrence", label: "Coocurrencias", hint: "Qué etiquetas aparecen juntas en los mismos registros", icon: Sigma },
  { id: "trend", label: "Evolución", hint: "Registros por año o década, opcionalmente por categoría", icon: ChartLine },
  { id: "numeric", label: "Numérica", hint: "Distribución de una propiedad numérica", icon: Hash },
];
const NOT_CATEGORICAL = new Set([
  "title", "rich_text", "attachment", "files", "button", "ai_image", "relation", "unique_id",
]);
const categorical = (c: DatabaseColumn) => !NOT_CATEGORICAL.has(c.type);

/**
 * Properties worth counting first: few, repeated values (options or a
 * checkbox) before free text, whose values are usually all different.
 */
function rankCategorical(columns: DatabaseColumn[], single = false) {
  const score = (c: DatabaseColumn) => {
    if (["select", "status"].includes(c.type)) return c.options.length >= 2 && c.options.length <= 60 ? 0 : 2;
    if (c.type === "multi_select") return single ? 4 : c.options.length <= 120 ? 1 : 3;
    if (c.type === "checkbox") return 2;
    return 5;
  };
  return columns
    .filter(categorical)
    .map((c, i) => ({ c, s: score(c) * 1000 + i }))
    .sort((a, b) => a.s - b.s)
    .map(({ c }) => c);
}
function defaultSpec(kind: Kind, columns: DatabaseColumn[], yearColumn: string | null): StatSpec | null {
  const cats = rankCategorical(columns, kind === "crosstab"),
    multi = columns.find((c) => MULTI_TYPES.includes(c.type)),
    number = columns.find((c) => c.type === "number");
  switch (kind) {
    case "frequency":
      return cats[0] ? { kind, columnId: cats[0].id, limit: 20, chart: "bar" } : null;
    case "crosstab":
      return cats.length > 1
        ? { kind, rowColumnId: cats[0].id, colColumnId: cats[1].id, limit: 12, measure: "count" }
        : null;
    case "cooccurrence":
      return multi ? { kind, columnId: multi.id, limit: 15 } : null;
    case "trend":
      return yearColumn ? { kind, yearColumnId: yearColumn, seriesColumnId: null, bucket: "year", limit: 6 } : null;
    case "numeric":
      return number ? { kind, columnId: number.id, bins: 12 } : null;
  }
}
const pct = (n: number) => n.toLocaleString(uiLocale(), { style: "percent", maximumFractionDigits: 1 });
const pValue = (p: number) =>
  p < 0.001
    ? `p < ${(0.001).toLocaleString(uiLocale())}`
    : `p = ${p.toLocaleString(uiLocale(), { maximumFractionDigits: 3 })}`;

export function StatisticsView({
  detail,
  search,
  prefs,
  onPrefs,
  revision,
  perform,
}: {
  detail: DatabaseDetail;
  search: SearchInput;
  prefs: ColumnPrefs;
  onPrefs: (change: (current: ColumnPrefs) => ColumnPrefs) => void;
  revision: number;
  perform: Perform;
}) {
  const t = useT(),
    api = window.imago,
    databaseId = detail.database.id,
    [saved, setSaved] = useState<SavedStatistic[] | null>(null),
    [years, setYears] = useState<Commands["timelineCandidates"]["result"]>([]),
    [draft, setDraft] = useState<{ id: string | null; name: string; spec: StatSpec | null }>({
      id: null,
      name: "",
      spec: null,
    }),
    [result, setResult] = useState<StatResult | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [confirmDelete, setConfirmDelete] = useState(false),
    [copied, setCopied] = useState(false);
  const columns = detail.columns,
    name = (id: string | null | undefined) => columns.find((c) => c.id === id)?.name ?? "—";

  const load = useCallback(async () => {
    const [list, candidates] = await Promise.all([
      api.call("statisticsList", { databaseId }),
      api.call("timelineCandidates", { databaseId }),
    ]);
    setSaved(list);
    setYears(candidates);
    return { list, candidates };
  }, [api, databaseId]);
  useEffect(() => {
    let alive = true;
    void load()
      .then(({ list, candidates }) => {
        if (!alive) return;
        const open = list.find((s) => s.id === prefs.statistic) ?? list[0];
        if (open) setDraft({ id: open.id, name: open.name, spec: open.spec });
        else {
          const spec = defaultSpec("frequency", columns, candidates[0]?.columnId ?? null);
          setDraft({ id: null, name: spec ? `${t("Frecuencias")} · ${name(specColumn(spec))}` : "", spec });
        }
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // Loaded once per database; later changes go through the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId]);

  const specKey = JSON.stringify(draft.spec),
    searchKey = JSON.stringify(search);
  useEffect(() => {
    if (!draft.spec) return setResult(null);
    let alive = true;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      void api
        .call("statisticCompute", {
          search: { ...search, sorts: undefined, offset: undefined, limit: undefined },
          spec: draft.spec!,
        })
        .then((r) => alive && setResult(r))
        .catch((e) => alive && (setError(e.message), setResult(null)))
        .finally(() => alive && setLoading(false));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // The keys carry the spec and the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, searchKey, revision]);

  const savedSpec = saved?.find((s) => s.id === draft.id),
    dirty = !savedSpec || savedSpec.name !== draft.name || JSON.stringify(savedSpec.spec) !== specKey;
  const setSpec = (change: Partial<StatSpec>) =>
    setDraft((d) => (d.spec ? { ...d, spec: { ...d.spec, ...change } as StatSpec } : d));
  const choose = (s: SavedStatistic) => {
    setDraft({ id: s.id, name: s.name, spec: s.spec });
    onPrefs((p) => ({ ...p, statistic: s.id }));
  };
  const startNew = (kind: Kind = "frequency") => {
    const spec = defaultSpec(kind, columns, years[0]?.columnId ?? null);
    setDraft({
      id: null,
      name: spec ? `${t(KINDS.find((k) => k.id === kind)!.label)} · ${name(specColumn(spec))}` : t(KINDS.find((k) => k.id === kind)!.label),
      spec,
    });
  };
  const save = (asNew: boolean) =>
    void perform(async () => {
      if (!draft.spec) return;
      const stored = await api.call("statisticSave", {
        ...(draft.id && !asNew ? { id: draft.id } : {}),
        databaseId,
        name: draft.name.trim() || t("Estadística sin nombre"),
        spec: draft.spec,
      });
      await load();
      choose(stored);
    }, t("Estadística guardada"));

  const table = useMemo(() => (result ? resultTable(result, t) : null), [result, t]);
  const copy = () =>
    void perform(async () => {
      if (!table) return;
      await navigator.clipboard.writeText([table.head, ...table.rows].map((r) => r.join("\t")).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });

  const kind = draft.spec?.kind ?? "frequency",
    spec = draft.spec;
  const columnSelect = (label: string, value: string | null | undefined, options: DatabaseColumn[], onChange: (id: string) => void, extra?: { value: string; label: string }[]) => (
    <label className="stat-field">
      <span>{label}</span>
      <CriteriaSelect
        label={label}
        options={[...(extra ?? []), ...options.map((c) => ({ value: c.id, label: c.name }))]}
        values={value ? [value] : extra ? [extra[0].value] : []}
        placeholder={t("Elegir propiedad…")}
        onChange={(v) => onChange(v[0])}
      />
    </label>
  );
  const limitSelect = (value: number | undefined, choices: number[], label = t("Mostrar")) => (
    <label className="stat-field narrow">
      <span>{label}</span>
      <CriteriaSelect
        label={label}
        options={choices.map((n) => ({ value: String(n), label: t("Los {n} principales").replace("{n}", String(n)) }))}
        values={[String(value ?? choices[1])]}
        onChange={(v) => setSpec({ limit: Number(v[0]) } as Partial<StatSpec>)}
      />
    </label>
  );

  return (
    <div className="stats-view">
      <aside className="stats-list" aria-label={t("Estadísticas guardadas")}>
        <header>
          <strong>{t("Estadísticas guardadas")}</strong>
          <Button icon aria-label={t("Nueva estadística")} title={t("Nueva estadística")} onClick={() => startNew()}>
            <Plus size={15} />
          </Button>
        </header>
        {saved === null ? (
          <Spinner />
        ) : saved.length ? (
          <ul>
            {saved.map((s) => {
              const Icon = KINDS.find((k) => k.id === s.spec.kind)?.icon ?? Sigma;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={s.id === draft.id ? "active" : ""}
                    aria-current={s.id === draft.id}
                    onClick={() => choose(s)}
                  >
                    <Icon size={14} />
                    <span>{s.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">{t("Guarda una estadística para volver a ella cuando quieras.")}</p>
        )}
      </aside>
      <section className="stats-main">
        <div className="stats-editor">
          <div className="stats-title-row">
            <input
              className="stats-name"
              aria-label={t("Nombre de la estadística")}
              placeholder={t("Nombre de la estadística")}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
            <Button primary disabled={!spec || (!!draft.id && !dirty)} onClick={() => save(false)}>
              <Save size={14} />
              {t(draft.id ? (dirty ? "Guardar cambios" : "Guardada") : "Guardar")}
            </Button>
            {draft.id && (
              <Button disabled={!spec} onClick={() => save(true)}>
                {t("Guardar como nueva")}
              </Button>
            )}
            {draft.id && (
              <Button
                icon
                className="danger"
                aria-label={t("Eliminar estadística")}
                title={t("Eliminar estadística")}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={15} />
              </Button>
            )}
          </div>
          <div className="stats-kinds" role="tablist" aria-label={t("Tipo de estadística")}>
            {KINDS.map((k) => {
              const possible = !!defaultSpec(k.id, columns, years[0]?.columnId ?? null);
              return (
                <button
                  key={k.id}
                  type="button"
                  role="tab"
                  aria-selected={kind === k.id}
                  className={kind === k.id ? "active" : ""}
                  disabled={!possible}
                  title={possible ? t(k.hint) : t("Esta base no tiene propiedades para este cálculo.")}
                  onClick={() => {
                    if (kind === k.id) return;
                    // Another kind is another statistic: a saved one is never
                    // overwritten by switching tabs.
                    startNew(k.id);
                  }}
                >
                  <k.icon size={14} />
                  {t(k.label)}
                </button>
              );
            })}
          </div>
          {spec && (
            <div className="stats-fields">
              {spec.kind === "frequency" && (
                <>
                  {columnSelect(t("Propiedad"), spec.columnId, columns.filter(categorical), (id) => setSpec({ columnId: id }))}
                  {limitSelect(spec.limit, [10, 20, 30, 50])}
                </>
              )}
              {spec.kind === "crosstab" && (
                <>
                  {columnSelect(t("Filas"), spec.rowColumnId, columns.filter(categorical), (id) => setSpec({ rowColumnId: id }))}
                  {columnSelect(t("Columnas"), spec.colColumnId, columns.filter(categorical), (id) => setSpec({ colColumnId: id }))}
                  {limitSelect(spec.limit, [6, 12, 20, 30])}
                  <div className="stat-field">
                    <span>{t("Colorear por")}</span>
                    <div className="segmented" role="group" aria-label={t("Qué colorea el mapa de calor")}>
                      {(["count", "row", "residual"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={(spec.measure ?? "count") === m}
                          className={(spec.measure ?? "count") === m ? "active" : ""}
                          onClick={() => setSpec({ measure: m })}
                          title={t(
                            m === "residual"
                              ? "Residuos tipificados: azul, más de lo esperado; rojo, menos. Más allá de ±1,96 la diferencia es significativa al 5 %."
                              : m === "row"
                                ? "Porcentaje de cada fila"
                                : "Número de registros",
                          )}
                        >
                          {t(m === "count" ? "Recuentos" : m === "row" ? "% por fila" : "Residuos")}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {spec.kind === "cooccurrence" && (
                <>
                  {columnSelect(t("Propiedad de etiquetas"), spec.columnId, columns.filter((c) => MULTI_TYPES.includes(c.type)), (id) => setSpec({ columnId: id }))}
                  {limitSelect(spec.limit, [10, 15, 25, 40], t("Etiquetas"))}
                </>
              )}
              {spec.kind === "trend" && (
                <>
                  {columnSelect(
                    t("Fecha o año"),
                    spec.yearColumnId,
                    years.map((y) => columns.find((c) => c.id === y.columnId)!).filter(Boolean),
                    (id) => setSpec({ yearColumnId: id }),
                  )}
                  {columnSelect(
                    t("Separar por"),
                    spec.seriesColumnId ?? "",
                    columns.filter(categorical),
                    (id) => setSpec({ seriesColumnId: id || null }),
                    [{ value: "", label: t("Sin separar (total)") }],
                  )}
                  <div className="stat-field">
                    <span>{t("Agrupar por")}</span>
                    <div className="segmented" role="group" aria-label={t("Agrupar por")}>
                      {(["year", "decade"] as const).map((b) => (
                        <button
                          key={b}
                          type="button"
                          aria-pressed={(spec.bucket ?? "year") === b}
                          className={(spec.bucket ?? "year") === b ? "active" : ""}
                          onClick={() => setSpec({ bucket: b })}
                        >
                          {t(b === "year" ? "Años" : "Décadas")}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="stat-field">
                    <span>{t("Gráfico")}</span>
                    <div className="segmented" role="group" aria-label={t("Gráfico")}>
                      {(["line", "column"] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={(spec.chart ?? "line") === c}
                          className={(spec.chart ?? "line") === c ? "active" : ""}
                          disabled={c === "column" && !!spec.seriesColumnId}
                          onClick={() => setSpec({ chart: c })}
                        >
                          {t(c === "line" ? "Líneas" : "Columnas")}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {spec.kind === "numeric" &&
                columnSelect(t("Propiedad numérica"), spec.columnId, columns.filter((c) => c.type === "number"), (id) => setSpec({ columnId: id }))}
            </div>
          )}
        </div>
        {error && <p className="notice error">{t(error)}</p>}
        {!spec ? (
          <Empty
            title={t("Elige un tipo de estadística")}
            description={t("Esta base no tiene propiedades para este cálculo.")}
          />
        ) : !result ? (
          <div className="stats-loading">
            <Spinner />
          </div>
        ) : (
          <div className={"stats-result stat-viz" + (loading ? " is-loading" : "")} aria-busy={loading}>
            <ResultView result={result} spec={spec} name={name} />
            {table && (
              <details className="stats-table">
                <summary>
                  {t("Tabla de datos")}
                  <Button
                    onClick={(e) => {
                      e.preventDefault();
                      copy();
                    }}
                  >
                    <ClipboardCopy size={14} />
                    {t(copied ? "Copiada" : "Copiar tabla")}
                  </Button>
                </summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {table.head.map((h, i) => (
                          <th key={i}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((v, j) => (
                            <td key={j}>{v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}
      </section>
      {confirmDelete && draft.id && (
        <Modal title={t("Eliminar estadística")} onClose={() => setConfirmDelete(false)}>
          <div className="modal-body">
            <h3>{draft.name}</h3>
            <p>{t("Se elimina la estadística guardada; los registros no cambian.")}</p>
          </div>
          <footer>
            <Button onClick={() => setConfirmDelete(false)}>{t("Cancelar")}</Button>
            <Button
              className="danger"
              onClick={() =>
                void perform(async () => {
                  await api.call("statisticDelete", { id: draft.id! });
                  setConfirmDelete(false);
                  const { list } = await load();
                  if (list[0]) choose(list[0]);
                  else startNew();
                })
              }
            >
              <Trash2 size={14} />
              {t("Eliminar")}
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

function specColumn(spec: StatSpec) {
  return spec.kind === "crosstab" ? spec.rowColumnId : spec.kind === "trend" ? spec.yearColumnId : spec.columnId;
}

function Tiles({ items }: { items: [string, string][] }) {
  return (
    <dl className="stat-tiles">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResultView({
  result,
  spec,
  name,
}: {
  result: StatResult;
  spec: StatSpec;
  name: (id: string | null | undefined) => string;
}) {
  const t = useT(),
    n = (v: number) => v.toLocaleString(uiLocale());
  switch (result.kind) {
    case "frequency":
      return (
        <>
          <Tiles
            items={[
              [t("Registros analizados"), n(result.records)],
              [t("Valores distintos"), n(result.distinct)],
              [t("Sin valor"), `${n(result.empty)} (${pct(result.records ? result.empty / result.records : 0)})`],
            ]}
          />
          {result.categories.length ? (
            <BarList
              items={[
                ...result.categories.map((c) => ({ label: c.label, value: c.count, note: pct(c.share) })),
                ...(result.other ? [{ label: t("Otros"), value: result.other }] : []),
              ]}
            />
          ) : (
            <p className="muted">{t("Ningún registro tiene valor en esta propiedad.")}</p>
          )}
          {result.multi && (
            <p className="stat-note">
              {t("Un registro puede tener varias etiquetas: los porcentajes son de registros y pueden sumar más de 100 %.")}
            </p>
          )}
        </>
      );
    case "crosstab": {
      const measure = spec.kind === "crosstab" ? (spec.measure ?? "count") : "count";
      const values =
        measure === "residual"
          ? result.residuals
          : measure === "row"
            ? result.counts.map((r, i) => r.map((v) => (result.rowTotals[i] ? v / result.rowTotals[i] : 0)))
            : result.counts;
      const chi = result.chi;
      // A table much wider than tall reads better turned on its side.
      const flip = result.cols.length > result.rows.length && result.cols.length > 6,
        rowName = name(spec.kind === "crosstab" ? (flip ? spec.colColumnId : spec.rowColumnId) : null),
        colName = name(spec.kind === "crosstab" ? (flip ? spec.rowColumnId : spec.colColumnId) : null),
        at = <T,>(m: T[][], i: number, j: number) => (flip ? m[j][i] : m[i][j]),
        shownRows = flip ? result.cols : result.rows,
        shownCols = flip ? result.rows : result.cols;
      const strength = !chi
        ? null
        : chi.cramersV < 0.1
          ? "muy débil"
          : chi.cramersV < 0.2
            ? "débil"
            : chi.cramersV < 0.4
              ? "moderada"
              : "fuerte";
      return (
        <>
          <Tiles
            items={[
              [t("Registros analizados"), n(result.records)],
              [t("Chi cuadrado"), chi ? `χ² = ${chi.statistic.toLocaleString(uiLocale())} · ${t("gl")} = ${chi.df}` : "—"],
              [t("Significación"), chi ? pValue(chi.p) : "—"],
              [t("V de Cramér"), chi ? chi.cramersV.toLocaleString(uiLocale()) : "—"],
            ]}
          />
          {chi && (
            <p className="stat-verdict">
              {chi.p < 0.05
                ? `${t("Hay asociación entre")} ${name(spec.kind === "crosstab" ? spec.rowColumnId : null)} ${t("y")} ${name(spec.kind === "crosstab" ? spec.colColumnId : null)} (${pValue(chi.p)}), ${t("de intensidad")} ${t(strength!)}.`
                : `${t("No hay evidencia de asociación entre las dos propiedades")} (${pValue(chi.p)}).`}
            </p>
          )}
          {!chi && <p className="stat-note">{t("Hacen falta al menos dos valores en cada propiedad para la prueba.")}</p>}
          <Heatmap
            rows={shownRows}
            cols={shownCols}
            values={shownRows.map((_, i) => shownCols.map((_, j) => at(values, i, j)))}
            scale={measure === "residual" ? "diverging" : "sequential"}
            corner={
              <span className="heatmap-corner">
                {rowName} ↓ · {colName} →
              </span>
            }
            display={(v) =>
              measure === "row"
                ? pct(v)
                : measure === "residual"
                  ? v.toLocaleString(uiLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                  : n(v)
            }
            tooltip={(i, j) => {
              const r = flip ? j : i,
                c = flip ? i : j;
              return (
                `${result.rows[r]} × ${result.cols[c]}: ${n(result.counts[r][c])} ${t("registros")}` +
                ` · ${pct(result.rowTotals[r] ? result.counts[r][c] / result.rowTotals[r] : 0)} ${t("de la fila")} ${result.rows[r]}` +
                ` · ${t("residuo")} ${result.residuals[r][c].toLocaleString(uiLocale(), { maximumFractionDigits: 2 })}`
              );
            }}
          />
          {measure === "residual" && (
            <p className="stat-note">
              {t("Azul: más registros de los esperados si no hubiera relación; rojo: menos. Más allá de ±1,96 la diferencia es significativa al 5 %.")}
            </p>
          )}
          {chi && chi.lowExpected > 0.2 && (
            <p className="stat-note warning">
              {`${pct(chi.lowExpected)} ${t("de las celdas esperan menos de 5 registros: la prueba es menos fiable. Reduce el número de valores o agrupa categorías.")}`}
            </p>
          )}
          {result.multi && (
            <p className="stat-note warning">
              {t("Alguna propiedad tiene varias etiquetas por registro: cada combinación cuenta una vez y las celdas no son independientes, así que el valor p es orientativo.")}
            </p>
          )}
        </>
      );
    }
    case "cooccurrence":
      return (
        <>
          <Tiles
            items={[
              [t("Registros con etiquetas"), n(result.records)],
              [t("Etiquetas mostradas"), n(result.labels.length)],
              [t("Pares distintos"), n(result.pairs.length)],
            ]}
          />
          {result.labels.length > 1 ? (
            <Heatmap
              rows={result.labels}
              cols={result.labels}
              values={result.matrix.map((r, i) => r.map((v, j) => (i === j ? 0 : v)))}
              scale="sequential"
              display={(v, i, j) => (i === j ? "—" : v ? n(v) : "")}
              tooltip={(i, j) =>
                i === j
                  ? `${result.labels[i]}: ${n(result.singles[i])} ${t("registros")}`
                  : `${result.labels[i]} + ${result.labels[j]}: ${n(result.matrix[i][j])} ${t("registros")}`
              }
            />
          ) : (
            <p className="muted">{t("Hacen falta al menos dos etiquetas.")}</p>
          )}
          {!!result.pairs.length && (
            <>
              <h4 className="stat-subtitle">{t("Pares más frecuentes")}</h4>
              <BarList
                items={result.pairs.slice(0, 15).map((p) => ({
                  label: `${p.a} + ${p.b}`,
                  value: p.count,
                  note: `Jaccard ${p.jaccard.toLocaleString(uiLocale())} · lift ${p.lift.toLocaleString(uiLocale())}`,
                }))}
              />
              <p className="stat-note">
                {t("Lift mayor que 1: aparecen juntas más de lo que cabría esperar por azar. Jaccard: parte de los registros con alguna de las dos que tienen ambas.")}
              </p>
            </>
          )}
        </>
      );
    case "trend": {
      const labels = result.buckets.map((b) => (result.bucket === "decade" ? `${b}s` : String(b)));
      const chart = spec.kind === "trend" ? (spec.chart ?? "line") : "line";
      const peak = result.totals.length ? result.totals.indexOf(Math.max(...result.totals)) : -1;
      return (
        <>
          <Tiles
            items={[
              [t("Registros fechados"), n(result.records - result.undated)],
              [t("Sin fecha"), n(result.undated)],
              [t("Periodo"), labels.length ? `${labels[0]} – ${labels[labels.length - 1]}` : "—"],
              [t("Máximo"), peak >= 0 ? `${labels[peak]} (${n(result.totals[peak])})` : "—"],
            ]}
          />
          {!labels.length ? (
            <p className="muted">{t("Ningún registro tiene fecha en esta propiedad.")}</p>
          ) : result.series.length ? (
            <LineChart labels={labels} series={result.series} label={t("Evolución")} />
          ) : chart === "column" ? (
            <ColumnChart items={labels.map((l, i) => ({ label: l, value: result.totals[i] }))} label={t("Evolución")} />
          ) : (
            <LineChart labels={labels} series={[{ label: t("Registros"), values: result.totals }]} label={t("Evolución")} />
          )}
        </>
      );
    }
    case "numeric":
      return (
        <>
          <Tiles
            items={[
              [t("Con valor"), `${n(result.n)} / ${n(result.records)}`],
              [t("Media"), result.mean !== null ? formatNumber(result.mean) : "—"],
              [t("Mediana"), result.median !== null ? formatNumber(result.median) : "—"],
              [t("Desviación típica"), result.sd !== null ? formatNumber(result.sd) : "—"],
              [t("Mínimo – máximo"), result.min !== null ? `${formatNumber(result.min)} – ${formatNumber(result.max!)}` : "—"],
            ]}
          />
          {result.histogram.length ? (
            <ColumnChart
              items={result.histogram.map((h) => ({
                label: `${formatNumber(h.from)}–${formatNumber(h.to)}`,
                value: h.count,
              }))}
              label={t("Distribución")}
            />
          ) : (
            <p className="muted">{t("Ningún registro tiene valor en esta propiedad.")}</p>
          )}
        </>
      );
  }
}

/** The figures behind a result, for the table view and the clipboard. */
function resultTable(result: StatResult, t: (s: string) => string): { head: string[]; rows: string[][] } {
  switch (result.kind) {
    case "frequency":
      return {
        head: [t("Valor"), t("Registros"), t("Porcentaje")],
        rows: result.categories.map((c) => [c.label, String(c.count), pct(c.share)]),
      };
    case "crosstab":
      return {
        head: ["", ...result.cols, t("Total")],
        rows: [
          ...result.rows.map((r, i) => [r, ...result.counts[i].map(String), String(result.rowTotals[i])]),
          [t("Total"), ...result.colTotals.map(String), String(result.total)],
        ],
      };
    case "cooccurrence":
      return {
        head: [t("Etiqueta A"), t("Etiqueta B"), t("Registros"), "Jaccard", "Lift"],
        rows: result.pairs.map((p) => [p.a, p.b, String(p.count), String(p.jaccard), String(p.lift)]),
      };
    case "trend":
      return {
        head: [t("Periodo"), t("Total"), ...result.series.map((s) => s.label)],
        rows: result.buckets.map((b, i) => [
          result.bucket === "decade" ? `${b}s` : String(b),
          String(result.totals[i]),
          ...result.series.map((s) => String(s.values[i])),
        ]),
      };
    case "numeric":
      return {
        head: [t("Desde"), t("Hasta"), t("Registros")],
        rows: result.histogram.map((h) => [String(h.from), String(h.to), String(h.count)]),
      };
  }
}

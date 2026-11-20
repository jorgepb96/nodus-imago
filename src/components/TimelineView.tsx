// Timeline view: every record the view selects, placed by the year of a
// property (detected, or chosen by the user), with an overview of how many
// records fall in each year or decade.
import { CERTAINTY_LABELS, type Certainty } from "../../shared/historicalDate";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, ChevronDown } from "lucide-react";
import type { DatabaseDetail } from "../../shared/databases";
import type { Commands, SearchInput } from "../../shared/imago";
import type { ColumnPrefs } from "../columnPrefs";
import { uiLocale, useT } from "../i18n";
import { CriteriaSelect } from "./CriteriaSelect";
import { Button, Empty, Spinner, Thumbnail } from "./ui";

type Timeline = Commands["timeline"]["result"];
type Candidate = Commands["timelineCandidates"]["result"][number];
const FIRST = 12,
  STEP = 48;

export function TimelineView({
  detail,
  search,
  prefs,
  onPrefs,
  revision,
  onOpen,
  onProperties,
}: {
  detail: DatabaseDetail;
  search: SearchInput;
  prefs: ColumnPrefs;
  onPrefs: (change: (current: ColumnPrefs) => ColumnPrefs) => void;
  revision: number;
  onOpen: (rowId: string) => void;
  onProperties: () => void;
}) {
  const t = useT(),
    [candidates, setCandidates] = useState<Candidate[] | null>(null),
    [data, setData] = useState<Timeline | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [shown, setShown] = useState<Record<string, number>>({}),
    sections = useRef(new Map<string, HTMLElement>());
  const databaseId = detail.database.id,
    columnSignature = detail.columns.map((c) => `${c.id}:${c.type}`).join("|");
  useEffect(() => {
    let alive = true;
    setCandidates(null);
    void window.imago
      .call("timelineCandidates", { databaseId })
      .then((c) => alive && setCandidates(c))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [databaseId, columnSignature]);
  const chosen =
      prefs.timelineColumn && detail.columns.some((c) => c.id === prefs.timelineColumn)
        ? prefs.timelineColumn
        : null,
    detected = candidates?.[0]?.columnId ?? null,
    columnId = chosen ?? detected;
  const searchKey = JSON.stringify(search);
  useEffect(() => {
    if (!columnId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    void window.imago
      .call("timeline", { search: { ...search, sorts: undefined, offset: undefined, limit: undefined }, columnId })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setShown({});
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // searchKey carries the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnId, searchKey, revision]);

  // A record covers every year of its period («1950-1959»), not only the
  // middle one: the overview counts it in each, the groups follow periods.
  const items = useMemo(() => data?.items ?? [], [data]),
    first = items.length ? Math.min(...items.map((i) => i.start)) : 0,
    last = items.length ? Math.max(...items.map((i) => i.end)) : 0,
    span = items.length ? last - first : 0,
    periods = items.filter((i) => i.end - i.start >= 9).length,
    bucket =
      prefs.timelineBucket === "year" || prefs.timelineBucket === "decade"
        ? prefs.timelineBucket
        : // Dates written as periods are shown as those periods («1939–1949»),
          // never rounded to decades; long runs of single years by decade.
          span > 60 && periods <= items.length / 2
          ? "decade"
          : "year";
  type Group = { key: string; start: number; end: number; label: string; items: Timeline["items"] };
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const item of items) {
      // By decade: the decade of the period's middle year. By year: the year,
      // or the whole period when it spans several.
      const decade = Math.floor(item.year / 10) * 10;
      const [start, end] = bucket === "decade" ? [decade, decade + 9] : [item.start, item.end];
      const key = `${start}-${end}`;
      const label = bucket === "decade" ? `${decade}s` : start === end ? String(start) : `${start}–${end}`;
      (map.get(key) ?? map.set(key, { key, start, end, label, items: [] }).get(key)!).items.push(item);
    }
    return [...map.values()].sort((a, b) => a.start - b.start || a.end - b.end);
  }, [items, bucket]);
  // The overview speaks the data's own unit: one bar per decade when the
  // records are dated by decades, one per period when by periods, one per
  // year (or decade, past two centuries) when by years. Empty decades and
  // years stay, so gaps in the record show.
  type Bar = { id: string; label: string; count: number; group?: string };
  const overview = useMemo((): Bar[] => {
    if (!groups.length) return [];
    if (bucket === "decade") {
      const byStart = new Map(groups.map((g) => [g.start, g]));
      const out: Bar[] = [];
      for (let d = groups[0].start; d <= groups[groups.length - 1].start; d += 10) {
        const g = byStart.get(d);
        out.push({ id: String(d), label: `${d}s`, count: g?.items.length ?? 0, group: g?.key });
      }
      return out;
    }
    if (groups.some((g) => g.end > g.start))
      return groups.map((g) => ({ id: g.key, label: g.label, count: g.items.length, group: g.key }));
    const step = span > 200 ? 10 : 1;
    const counts = new Map<number, { count: number; group: string }>();
    for (const g of groups) {
      const k = Math.floor(g.start / step) * step;
      const c = counts.get(k);
      counts.set(k, { count: (c?.count ?? 0) + g.items.length, group: c?.group ?? g.key });
    }
    const out: Bar[] = [];
    for (let k = Math.floor(first / step) * step; k <= last; k += step)
      out.push({ id: String(k), label: step === 10 ? `${k}s` : String(k), count: counts.get(k)?.count ?? 0, group: counts.get(k)?.group });
    return out;
  }, [groups, bucket, span, first, last]);
  const max = Math.max(1, ...overview.map((o) => o.count));

  if (candidates && !candidates.length)
    return (
      <Empty
        title={t("Ninguna propiedad contiene años o fechas")}
        description={t(
          "Añade una propiedad de fecha o de año (por ejemplo, «Año» o «Fecha») para ver los registros en una línea de tiempo.",
        )}
      >
        <Button onClick={onProperties}>{t("Propiedades")}</Button>
      </Empty>
    );
  return (
    <div className="timeline-view">
      <div className="timeline-controls">
        <div className="timeline-field">
          <span>{t("Fechar por")}</span>
          <CriteriaSelect
            label={t("Propiedad de fecha o año")}
            options={(candidates ?? []).map((c) => ({
              value: c.columnId,
              label: c.columnId === detected && !chosen ? `${c.name} · ${t("detectada")}` : c.name,
              description: `${Math.round(c.share * 100)} % ${t("de registros con año")}`,
            }))}
            values={columnId ? [columnId] : []}
            placeholder={t("Elegir propiedad…")}
            onChange={(v) => onPrefs((p) => ({ ...p, timelineColumn: v[0] ?? null }))}
          />
        </div>
        <div className="segmented" role="group" aria-label={t("Agrupar por")}>
          {(["auto", "year", "decade"] as const).map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={(prefs.timelineBucket ?? "auto") === b}
              className={(prefs.timelineBucket ?? "auto") === b ? "active" : ""}
              onClick={() => onPrefs((p) => ({ ...p, timelineBucket: b }))}
            >
              {t(b === "auto" ? "Automático" : b === "year" ? "Años o periodos" : "Décadas")}
            </button>
          ))}
        </div>
        {data && (
          <p className="timeline-summary">
            <b>{data.items.length.toLocaleString(uiLocale())}</b> {t("registros fechados")}
            {!!data.undated && (
              <>
                {" · "}
                {data.undated.toLocaleString(uiLocale())} {t("sin fecha")}
              </>
            )}
            {!!items.length && (
              <>
                {" · "}
                {first}–{last}
              </>
            )}
          </p>
        )}
        {loading && <Spinner />}
      </div>
      {error && <p className="notice error">{t(error)}</p>}
      {!!overview.length && (
        <div className="timeline-overview" role="list" aria-label={t("Registros por periodo")}>
          {overview.map((o) => (
            <button
              key={o.id}
              type="button"
              role="listitem"
              className="timeline-bar"
              disabled={!o.count}
              data-tooltip={`${o.label} · ${o.count.toLocaleString(uiLocale())} ${t(o.count === 1 ? "registro" : "registros")}`}
              data-tooltip-instant=""
              aria-label={`${o.label}: ${o.count} ${t("registros")}`}
              onClick={() => {
                if (o.group) sections.current.get(o.group)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <span style={{ height: `${o.count ? Math.max(4, (o.count / max) * 100) : 0}%` }} />
            </button>
          ))}
        </div>
      )}
      {!!overview.length && (
        <div className={`timeline-axis-labels ${overview.length <= 16 ? "is-each" : ""}`} aria-hidden="true">
          {(overview.length <= 16
            ? overview
            : [overview[0], ...(overview.length > 2 ? [overview[Math.floor(overview.length / 2)]] : []), overview[overview.length - 1]]
          ).map((o) => (
            <span key={o.id}>{o.label}</span>
          ))}
        </div>
      )}
      {data && !data.items.length && !loading && (
        <Empty
          title={t("Ningún registro tiene fecha en esta propiedad")}
          description={t("Elige otra propiedad o revisa los filtros y la búsqueda.")}
        />
      )}
      <ol className="timeline">
        {groups.map(({ key, label, items }) => {
          const limit = shown[key] ?? FIRST;
          return (
            <li
              key={key}
              className="timeline-group"
              ref={(el) => {
                if (el) sections.current.set(key, el);
                else sections.current.delete(key);
              }}
            >
              <div className="timeline-marker">
                <CalendarRange size={13} />
                <h3>{label}</h3>
                <span>
                  {items.length.toLocaleString(uiLocale())} {t(items.length === 1 ? "registro" : "registros")}
                </span>
              </div>
              <div className="timeline-items">
                {items.slice(0, limit).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="timeline-card"
                    onClick={() => onOpen(item.id)}
                    aria-label={`${t("Abrir registro")} ${item.title} (${item.year})`}
                  >
                    <Thumbnail id={item.imageId ?? undefined} revision={item.revision} alt={item.title} />
                    <span className="timeline-card-title">{item.title}</span>
                    {item.period ? (
                      <small
                        className={`timeline-period certainty-${item.certainty}`}
                        data-tooltip={`${t("Periodo")}: ${item.period} · ${t(CERTAINTY_LABELS[item.certainty as Certainty] ?? "")}`}
                      >
                        {/* The cataloguing conventions: [1930] attributed, 1930? doubtful, ≈ approximate. */}
                        {item.certainty === "inferred" ? `[${item.period}]` : item.period}
                        {item.certainty === "uncertain" && "?"}
                        {item.certainty === "approx" && <span aria-hidden="true"> ≈</span>}
                      </small>
                    ) : (
                      bucket === "decade" && <small>{item.year}</small>
                    )}
                  </button>
                ))}
              </div>
              {items.length > limit && (
                <Button
                  className="timeline-more"
                  onClick={() => setShown((s) => ({ ...s, [key]: limit + STEP }))}
                >
                  <ChevronDown size={14} />
                  {t("Mostrar más")} ({(items.length - limit).toLocaleString(uiLocale())})
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

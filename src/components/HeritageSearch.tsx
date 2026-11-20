// A background search for heritage elements (Wikidata, OpenStreetMap or the
// centre of their town) and the review of what it proposes. The search runs
// in Imago's task queue: it pauses by itself if Imago closes or a service
// cannot be reached, and resumes where it stopped. Proposals are kept in the
// collection until they are applied or discarded, so nothing is lost when this
// window closes.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Pause, Play, Search, X } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { AuthorityLink } from "../../shared/authority";
import {
  resolvedPosition,
  typeFromInstances,
  typology,
  type HeritageCandidate,
  type HeritageElement,
  type HeritageScheme,
  type OsmCandidate,
} from "../../shared/heritage";
import type { Commands } from "../../shared/imago";
import { formatNumber, useLanguage, useT } from "../i18n";
import { refreshHeritage } from "../heritageStore";
import { Button } from "./ui";
import { HeritageIcon } from "./HeritageIcon";

type Source = "wikidata" | "osm" | "town";
type Proposal = Commands["heritageProposals"]["result"][number];
type Job = Commands["heritageJobs"]["result"][number];
const CONFIDENCE = { high: "Alta", medium: "Media", low: "Baja" } as const;

const COPY: Record<Source, { start: string; confirm: string; running: string; applied: string; none: string }> = {
  wikidata: {
    start: "Buscar en Wikidata {n} elementos sin enlazar",
    confirm: "Se enviarán a Wikidata los nombres de {n} elementos (solo el texto de cada uno). La búsqueda sigue en segundo plano aunque cierres esta ventana; si cierras Imago o falla la conexión, se pausa y sigue donde se quedó.",
    running: "Buscando en Wikidata: {d} de {n}",
    applied: "{n} elementos enlazados. Puedes revertirlo en «Vinculaciones anteriores».",
    none: "Sin candidatos: búscalo a mano en su ficha.",
  },
  osm: {
    start: "Situar con OpenStreetMap {n} elementos sin posición exacta",
    confirm: "Se enviarán a OpenStreetMap los nombres de {n} elementos, uno por segundo. Sigue en segundo plano aunque cierres esta ventana; si cierras Imago o falla la conexión, se pausa y sigue donde se quedó.",
    running: "Buscando en OpenStreetMap: {d} de {n}",
    applied: "{n} elementos situados con OpenStreetMap. Puedes revertirlo en «Vinculaciones anteriores».",
    none: "Tampoco está en OpenStreetMap: sitúalo a mano en su ficha.",
  },
  town: {
    start: "Situar en su localidad los {n} restantes (aproximado)",
    confirm: "Se usará el catálogo de lugares de la app y, para los pueblos que no conoce, OpenStreetMap (solo el nombre del pueblo). Las posiciones quedan marcadas como aproximadas.",
    running: "Situando en su localidad: {d} de {n}",
    applied: "{n} elementos situados en el centro de su localidad (aproximado). Puedes revertirlo en «Vinculaciones anteriores».",
    none: "No se ha reconocido su localidad.",
  },
};

export function HeritageSearch({
  column,
  source,
  elements,
  links,
  counts,
  scheme,
  onApplied,
}: {
  column: DatabaseColumn;
  source: Source;
  elements: Record<string, HeritageElement>;
  links: Record<string, AuthorityLink>;
  counts: Record<string, number>;
  scheme: HeritageScheme;
  onApplied: () => Promise<void>;
}) {
  const t = useT(),
    language = useLanguage(),
    copy = COPY[source];
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [show, setShow] = useState<"all" | "high" | "medium" | "low">("all");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const labels = useMemo(() => new Map(column.options.map((o) => [o.id, o.label])), [column.options]);

  const load = useCallback(async () => {
    const [found, jobs] = await Promise.all([
      window.imago.call("heritageProposals", { columnId: column.id, source }),
      window.imago.call("heritageJobs", { columnId: column.id }),
    ]);
    setProposals(found);
    setJob(jobs.find((j) => j.source === source) ?? null);
  }, [column.id, source]);
  // While a search runs, its proposals arrive one by one.
  useEffect(() => {
    void load().catch(() => {});
    const timer = setInterval(() => void load().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [load]);

  const waiting = new Set(proposals.map((p) => p.optionId));
  const pending = column.options.filter((o) => {
    if (waiting.has(o.id)) return false;
    if (source === "wikidata") return !links[o.id];
    if (source === "osm") return !links[o.id] && (elements[o.id]?.latitude == null || elements[o.id]?.coordSource === "town");
    return !resolvedPosition(o.id, elements);
  }).length;
  const confidence = (p: Proposal) => (p.candidates[p.chosen] as { confidence?: "high" | "medium" | "low" } | undefined)?.confidence;
  const visible = proposals.filter((p) => show === "all" || confidence(p) === show);
  const tally = { high: 0, medium: 0, low: 0, none: 0 };
  for (const p of proposals) tally[confidence(p) ?? "none"]++;
  const accepted = proposals.filter((p) => p.accepted && p.candidates[p.chosen]).length;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const update = (p: Proposal, change: { chosen?: number; accepted?: boolean }) =>
    void run(async () => {
      setProposals((all) => all.map((x) => (x.id === p.id ? { ...x, ...change } : x)));
      await window.imago.call("heritageProposalUpdate", { id: p.id, ...change });
    });
  const apply = () =>
    void run(async () => {
      const batch = await window.imago.call("heritageProposalsApply", { columnId: column.id, source });
      setMessage(t(copy.applied).replace("{n}", formatNumber(batch?.applied ?? 0, 0)));
      refreshHeritage(column.id);
      await onApplied();
    });
  const active = job && ["queued", "running"].includes(job.state);

  return (
    <section className="heritage-search" data-testid={`heritage-search-${source}`}>
      {confirm ? (
        <div className="authority-confirm" role="alertdialog">
          <p>{t(copy.confirm).replace("{n}", formatNumber(pending, 0))}</p>
          <Button onClick={() => setConfirm(false)}>{t("Cancelar")}</Button>
          <Button
            primary
            onClick={() =>
              void run(async () => {
                setConfirm(false);
                await window.imago.call("heritageIdentifyStart", { columnId: column.id, source });
              })
            }
          >
            {t("Empezar")}
          </Button>
        </div>
      ) : job ? (
        <div className="authority-confirm heritage-job" role="status">
          <p>
            {t(copy.running).replace("{d}", formatNumber(job.done, 0)).replace("{n}", formatNumber(job.total, 0))}
            {job.state === "paused" && <strong> · {t("En pausa")}</strong>}
            {job.message && <small>{t(job.message)}</small>}
          </p>
          <progress max={job.total} value={job.done} />
          {active ? (
            <Button onClick={() => void run(() => window.imago.call("controlJob", { id: job.id, action: "pause" }))}>
              <Pause size={13} /> {t("Pausar")}
            </Button>
          ) : (
            <Button primary onClick={() => void run(() => window.imago.call("controlJob", { id: job.id, action: "resume" }))}>
              <Play size={13} /> {t("Reanudar")}
            </Button>
          )}
          <Button onClick={() => void run(() => window.imago.call("controlJob", { id: job.id, action: "cancel" }))}>
            <X size={13} /> {t("Cancelar")}
          </Button>
        </div>
      ) : (
        <div className="authority-bulk">
          <Button disabled={!pending} onClick={() => setConfirm(true)} data-testid={`heritage-search-start-${source}`}>
            <Search size={14} />
            {t(copy.start).replace("{n}", formatNumber(pending, 0))}
          </Button>
        </div>
      )}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{t(error)}</p>}
      {proposals.length > 0 && (
        <>
          <div className="heritage-identify-tally">
            {source !== "town" && (
              <div className="segmented" role="group" aria-label={t("Confianza")}>
                {(["all", "high", "medium", "low"] as const).map((k) => (
                  <button key={k} type="button" className={show === k ? "active" : ""} onClick={() => setShow(k)}>
                    {k === "all" ? `${t("Todas")} · ${formatNumber(proposals.length, 0)}` : `${t(CONFIDENCE[k])} · ${formatNumber(tally[k], 0)}`}
                  </button>
                ))}
              </div>
            )}
            <Button onClick={() => void run(() => window.imago.call("heritageProposalsAccept", { ids: visible.filter((p) => p.candidates[p.chosen]).map((p) => p.id), accepted: true }))}>
              <Check size={13} /> {t("Aceptar las visibles")}
            </Button>
            <Button onClick={() => void run(() => window.imago.call("heritageProposalsAccept", { ids: visible.map((p) => p.id), accepted: false }))}>
              {t("Quitar las visibles")}
            </Button>
            <Button onClick={() => void run(() => window.imago.call("heritageProposalsDismiss", { ids: proposals.filter((p) => !p.accepted).map((p) => p.id) }))}>
              {t("Descartar las no aceptadas")}
            </Button>
            <Button primary disabled={!accepted} onClick={apply} data-testid={`heritage-search-apply-${source}`}>
              <Check size={14} /> {t("Aplicar {n} aceptadas").replace("{n}", formatNumber(accepted, 0))}
            </Button>
          </div>
          <ul className="authority-list heritage-proposals">
            {visible.slice(0, 500).map((p) => (
              <ProposalRow
                key={p.id}
                proposal={p}
                label={labels.get(p.optionId) ?? ""}
                count={counts[p.optionId] ?? 0}
                source={source}
                scheme={scheme}
                language={language}
                none={t(copy.none)}
                onUpdate={(change) => update(p, change)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ProposalRow({
  proposal: p,
  label,
  count,
  source,
  scheme,
  language,
  none,
  onUpdate,
}: {
  proposal: Proposal;
  label: string;
  count: number;
  source: Source;
  scheme: HeritageScheme;
  language: string;
  none: string;
  onUpdate: (change: { chosen?: number; accepted?: boolean }) => void;
}) {
  const t = useT();
  const raw = p.candidates[p.chosen];
  let title = "",
    detail = "",
    url: string | null = null,
    icon: string | undefined,
    level: "high" | "medium" | "low" | undefined;
  if (raw && source === "wikidata") {
    const c = raw as HeritageCandidate;
    const typed = typeFromInstances(c.link.instances);
    const info = typed && typology(scheme, typed.group, typed.type, language);
    title = c.link.label;
    detail = [c.link.id, c.link.description, info?.type ?? info?.group, c.link.coordinates ? t("Coordenadas") : null].filter(Boolean).join(" · ");
    url = c.link.uri;
    icon = info?.icon;
    level = c.confidence;
  } else if (raw && source === "osm") {
    const c = raw as OsmCandidate;
    const info = c.group ? typology(scheme, c.group, c.type, language) : null;
    title = c.name || c.display.split(",")[0];
    detail = [info?.type ?? info?.group, c.display].filter(Boolean).join(" · ");
    url = `https://www.openstreetmap.org/${c.osm}`;
    icon = info?.icon;
    level = c.confidence;
  } else if (raw) {
    const c = raw as { town?: string };
    title = c.town ?? "";
    detail = t("Centro de la localidad (aproximado)");
  }
  return (
    <li className={`authority-item ${p.accepted ? "accepted" : ""}`} data-testid="heritage-proposal">
      <div className="authority-value">
        <strong>{label}</strong>
        <small>
          {formatNumber(count, 0)} {t("registros")}
        </small>
      </div>
      <div className="authority-link">
        {raw ? (
          <>
            {level && <span className={`heritage-confidence ${level}`}>{t(CONFIDENCE[level])}</span>}
            <span className="authority-summary">
              <strong>
                {icon && <HeritageIcon name={icon} size={12} />} {title}
              </strong>
              <small>{detail}</small>
            </span>
            {p.candidates.length > 1 && (
              <select aria-label={t("Otro candidato")} value={p.chosen} onChange={(e) => onUpdate({ chosen: Number(e.target.value) })}>
                {p.candidates.map((x, i) => {
                  const c = x as HeritageCandidate & OsmCandidate;
                  return (
                    <option key={i} value={i}>
                      {source === "wikidata" ? `${c.link.label} (${c.link.id})` : c.display.slice(0, 80)}
                    </option>
                  );
                })}
              </select>
            )}
            {url && (
              <Button icon aria-label={t("Abrir en el navegador")} data-tooltip={url} onClick={() => void window.imago.call("openExternalLink", { url: url! })}>
                <ExternalLink size={13} />
              </Button>
            )}
            <Button
              icon
              aria-pressed={p.accepted}
              className={p.accepted ? "active" : ""}
              aria-label={t(p.accepted ? "Aceptada" : "Aceptar")}
              data-tooltip={t(p.accepted ? "Aceptada" : "Aceptar")}
              onClick={() => onUpdate({ accepted: !p.accepted })}
            >
              <Check size={14} />
            </Button>
          </>
        ) : (
          <span className="muted">{none}</span>
        )}
      </div>
    </li>
  );
}

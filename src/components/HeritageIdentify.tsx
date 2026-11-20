// Linking many heritage elements to Wikidata at once. Names are sent in small
// batches only after the person agrees; every proposal is reviewed (the
// confident ones come pre-accepted) and what is applied can be reverted as a
// whole.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, History, Search, Undo2, X } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { AuthorityLink } from "../../shared/authority";
import { typeFromInstances, typology, type HeritageCandidate, type HeritageElement, type HeritageScheme } from "../../shared/heritage";
import { formatNumber, useLanguage, useT } from "../i18n";
import { Button } from "./ui";
import { HeritageIcon } from "./HeritageIcon";

type Proposal = { candidates: HeritageCandidate[]; chosen: number; accepted: boolean; error?: string };
type Batch = { id: string; applied: number; createdAt: string; revertedAt: string | null };
const CHUNK = 10;
const CONFIDENCE = { high: "Alta", medium: "Media", low: "Baja" } as const;

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
  const t = useT(),
    language = useLanguage();
  const pending = useMemo(
    () =>
      column.options
        .filter((o) => !links[o.id])
        .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.label.localeCompare(b.label)),
    [column.options, links, counts],
  );
  const labels = useMemo(() => Object.fromEntries(column.options.map((o) => [o.id, o.label])), [column.options]);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [show, setShow] = useState<"all" | "high" | "medium" | "low">("all");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const stop = useRef(false);

  const loadBatches = () =>
    window.imago
      .call("heritageLinkBatches", { columnId: column.id })
      .then(setBatches)
      .catch(() => {});
  useEffect(() => {
    void loadBatches();
    return () => {
      stop.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column.id]);

  const run = async () => {
    setConfirm(false);
    setError(null);
    setMessage(null);
    stop.current = false;
    const list = pending.filter((o) => !proposals[o.id]);
    setProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length && !stop.current; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      try {
        const found = await window.imago.call("heritageCandidates", {
          items: chunk.map((o) => ({ optionId: o.id, label: o.label })),
        });
        setProposals((all) => {
          const next = { ...all };
          for (const f of found)
            next[f.optionId] = { candidates: f.candidates, chosen: 0, accepted: f.candidates[0]?.confidence === "high", error: f.error };
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        break;
      }
      setProgress({ done: Math.min(list.length, i + CHUNK), total: list.length });
    }
    setProgress(null);
  };

  const rows = useMemo(
    () =>
      pending
        .filter((o) => proposals[o.id])
        .filter((o) => {
          const p = proposals[o.id];
          const c = p.candidates[p.chosen];
          return show === "all" || c?.confidence === show;
        }),
    [pending, proposals, show],
  );
  const accepted = Object.entries(proposals).filter(([, p]) => p.accepted && p.candidates[p.chosen]);
  const tally = useMemo(() => {
    const out = { high: 0, medium: 0, low: 0, none: 0 };
    for (const p of Object.values(proposals)) {
      const c = p.candidates[p.chosen];
      if (!c) out.none++;
      else out[c.confidence]++;
    }
    return out;
  }, [proposals]);

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      // Parents: the elements already linked and those linked now, by Q-number.
      const byQ = new Map<string, string>();
      for (const [id, l] of Object.entries(links)) byQ.set(l.id, id);
      for (const [id, p] of accepted) byQ.set(p.candidates[p.chosen].link.id, id);
      const items = accepted.map(([optionId, p]) => {
        const link = p.candidates[p.chosen].link;
        const typed = typeFromInstances(link.instances);
        const inScheme = typed && scheme.groups.some((g) => g.key === typed.group && g.types.some((x) => x.key === typed.type));
        const parentId = (link.partOf ?? []).map((q) => byQ.get(q)).find((id) => id && id !== optionId) ?? null;
        return { optionId, link, group: inScheme ? typed!.group : null, type: inScheme ? typed!.type : null, parentId };
      });
      const batch = await window.imago.call("heritageApplyLinks", { columnId: column.id, items });
      setProposals((all) => Object.fromEntries(Object.entries(all).filter(([id]) => !items.some((x) => x.optionId === id))));
      setMessage(t("{n} elementos enlazados. Puedes revertir esta vinculación más abajo.").replace("{n}", formatNumber(batch.applied, 0)));
      await onApplied();
      await loadBatches();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const set = (optionId: string, change: Partial<Proposal>) =>
    setProposals((all) => ({ ...all, [optionId]: { ...all[optionId], ...change } }));

  return (
    <div className="heritage-identify" data-testid="heritage-identify">
      <p className="hint">
        {t(
          "Busca en Wikidata cada elemento sin enlazar a partir de su nombre («Elemento - Ciudad»). Las propuestas no se guardan hasta que las aplicas; las de confianza alta llegan aceptadas y puedes cambiar cualquiera. Al aplicar se guardan el enlace, las coordenadas, la tipología sugerida y el elemento del que forma parte, solo donde la ficha no los tenga.",
        )}
      </p>
      {confirm ? (
        <div className="authority-confirm" role="alertdialog">
          <p>
            {t("Se enviarán a Wikidata los nombres de {n} elementos (solo el texto de cada uno), en grupos de diez.").replace(
              "{n}",
              formatNumber(pending.filter((o) => !proposals[o.id]).length, 0),
            )}
          </p>
          <Button onClick={() => setConfirm(false)}>{t("Cancelar")}</Button>
          <Button primary onClick={() => void run()} data-testid="heritage-identify-confirm">
            {t("Buscar propuestas")}
          </Button>
        </div>
      ) : progress ? (
        <div className="authority-confirm" role="status">
          <p>
            {t("Buscando propuestas: {d} de {n}…")
              .replace("{d}", formatNumber(progress.done, 0))
              .replace("{n}", formatNumber(progress.total, 0))}
          </p>
          <progress max={progress.total} value={progress.done} />
          <Button onClick={() => (stop.current = true)}>{t("Detener")}</Button>
        </div>
      ) : (
        <div className="authority-bulk">
          <Button disabled={!pending.some((o) => !proposals[o.id])} onClick={() => setConfirm(true)} data-testid="heritage-identify-start">
            <Search size={14} />
            {t("Buscar propuestas para {n} elementos sin enlazar").replace("{n}", formatNumber(pending.filter((o) => !proposals[o.id]).length, 0))}
          </Button>
          {accepted.length > 0 && (
            <Button primary disabled={applying} onClick={() => void apply()} data-testid="heritage-identify-apply">
              <Check size={14} />
              {t("Aplicar {n} aceptadas").replace("{n}", formatNumber(accepted.length, 0))}
            </Button>
          )}
        </div>
      )}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{t(error)}</p>}
      {Object.keys(proposals).length > 0 && (
        <div className="heritage-identify-tally">
          <div className="segmented" role="group" aria-label={t("Confianza")}>
            {(["all", "high", "medium", "low"] as const).map((k) => (
              <button key={k} type="button" className={show === k ? "active" : ""} onClick={() => setShow(k)}>
                {k === "all" ? t("Todas") : `${t(CONFIDENCE[k])} · ${formatNumber(tally[k], 0)}`}
              </button>
            ))}
          </div>
          {tally.none > 0 && <span className="muted">{t("{n} sin candidatos").replace("{n}", formatNumber(tally.none, 0))}</span>}
          <Button
            onClick={() =>
              setProposals((all) =>
                Object.fromEntries(
                  Object.entries(all).map(([id, p]) => [id, { ...p, accepted: p.candidates[p.chosen]?.confidence === "high" ? true : p.accepted }]),
                ),
              )
            }
          >
            {t("Aceptar todas las de confianza alta")}
          </Button>
        </div>
      )}
      <ul className="authority-list heritage-proposals">
        {rows.slice(0, 500).map((o) => {
          const p = proposals[o.id];
          const c = p.candidates[p.chosen];
          const typed = c && typeFromInstances(c.link.instances);
          const info = typed && typology(scheme, typed.group, typed.type, language);
          const parent = c?.link.partOf?.map((q) => Object.entries(links).find(([, l]) => l.id === q)?.[0]).find(Boolean);
          return (
            <li key={o.id} className={`authority-item ${p.accepted ? "accepted" : ""}`} data-testid="heritage-proposal">
              <div className="authority-value">
                <strong>{o.label}</strong>
                <small>
                  {formatNumber(counts[o.id] ?? 0, 0)} {t("registros")}
                </small>
              </div>
              <div className="authority-link">
                {c ? (
                  <>
                    <span className={`heritage-confidence ${c.confidence}`}>{t(CONFIDENCE[c.confidence])}</span>
                    <span className="authority-summary">
                      <strong>
                        {info && <HeritageIcon name={info.icon} size={12} />} {c.link.label}
                      </strong>
                      <small>
                        {[
                          c.link.id,
                          c.link.description,
                          info?.type ?? info?.group,
                          c.link.coordinates ? t("Coordenadas") : null,
                          parent ? `${t("Forma parte de")} ${labels[parent]}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                    {p.candidates.length > 1 && (
                      <select
                        aria-label={t("Otro candidato")}
                        value={p.chosen}
                        onChange={(e) => set(o.id, { chosen: Number(e.target.value) })}
                      >
                        {p.candidates.map((x, i) => (
                          <option key={x.link.id} value={i}>
                            {x.link.label} ({x.link.id})
                          </option>
                        ))}
                      </select>
                    )}
                    <Button icon aria-label={t("Abrir en el navegador")} data-tooltip={c.link.uri} onClick={() => void window.imago.call("openExternalLink", { url: c.link.uri })}>
                      <ExternalLink size={13} />
                    </Button>
                    <Button
                      icon
                      aria-pressed={p.accepted}
                      aria-label={t(p.accepted ? "Aceptada" : "Aceptar")}
                      data-tooltip={t(p.accepted ? "Aceptada" : "Aceptar")}
                      className={p.accepted ? "active" : ""}
                      onClick={() => set(o.id, { accepted: !p.accepted })}
                    >
                      <Check size={14} />
                    </Button>
                    <Button icon aria-label={t("Descartar")} data-tooltip={t("Descartar")} onClick={() => set(o.id, { accepted: false, candidates: [] })}>
                      <X size={14} />
                    </Button>
                  </>
                ) : (
                  <span className="muted">{p.error ? t(p.error) : t("Sin candidatos: búscalo a mano en su ficha.")}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
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
                          await onApplied();
                          await loadBatches();
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

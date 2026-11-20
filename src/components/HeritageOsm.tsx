// Placing from OpenStreetMap the elements Wikidata does not have (streets,
// squares, cafés, cinemas…): their names are sent to Nominatim one a second,
// only after the person agrees; each proposal is reviewed; applying fills
// coordinates and typology only where they are missing, and can be reverted.
import { useMemo, useRef, useState } from "react";
import { Check, ExternalLink, MapPinned } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import { resolvedPosition, typology, type HeritageElement, type HeritageScheme, type OsmCandidate } from "../../shared/heritage";
import { formatNumber, useLanguage, useT } from "../i18n";
import { Button } from "./ui";
import { HeritageIcon } from "./HeritageIcon";

type Proposal = { candidates: OsmCandidate[]; chosen: number; accepted: boolean; error?: string };

export function HeritageOsm({
  column,
  elements,
  scheme,
  onApplied,
}: {
  column: DatabaseColumn;
  elements: Record<string, HeritageElement>;
  scheme: HeritageScheme;
  onApplied: () => Promise<void>;
}) {
  const t = useT(),
    language = useLanguage();
  const pending = useMemo(() => column.options.filter((o) => !resolvedPosition(o.id, elements)), [column.options, elements]);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);
  const labels = useMemo(() => new Map(column.options.map((o) => [o.id, o.label])), [column.options]);

  const run = async () => {
    setConfirm(false);
    setError(null);
    stop.current = false;
    const list = pending.filter((o) => !proposals[o.id]);
    setProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length && !stop.current; i += 10) {
      const chunk = list.slice(i, i + 10);
      try {
        const found = await window.imago.call("heritageOsmCandidates", { items: chunk.map((o) => ({ optionId: o.id, label: o.label })) });
        setProposals((all) => {
          const next = { ...all };
          for (const f of found) next[f.optionId] = { candidates: f.candidates, chosen: 0, accepted: f.candidates[0]?.confidence === "high", error: f.error };
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        break;
      }
      setProgress({ done: Math.min(list.length, i + 10), total: list.length });
    }
    setProgress(null);
  };
  const accepted = Object.entries(proposals).filter(([, p]) => p.accepted && p.candidates[p.chosen]);
  const apply = async () => {
    setError(null);
    try {
      const batch = await window.imago.call("heritageApplyPlaces", {
        columnId: column.id,
        items: accepted.map(([optionId, p]) => {
          const c = p.candidates[p.chosen];
          return { optionId, latitude: c.latitude, longitude: c.longitude, osm: c.osm, group: c.group, type: c.type };
        }),
      });
      setProposals((all) => Object.fromEntries(Object.entries(all).filter(([id]) => !accepted.some(([a]) => a === id))));
      setMessage(t("{n} elementos situados con OpenStreetMap. Puedes revertirlo en «Vinculaciones anteriores».").replace("{n}", formatNumber(batch.applied, 0)));
      await onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const set = (id: string, change: Partial<Proposal>) => setProposals((all) => ({ ...all, [id]: { ...all[id], ...change } }));
  const rows = Object.entries(proposals);

  return (
    <section className="heritage-osm" data-testid="heritage-osm">
      <h3>
        <MapPinned size={15} /> {t("OpenStreetMap: lo que Wikidata no tiene")}
      </h3>
      <p className="hint">
        {t("Calles, plazas, comercios o edificios sin ficha en Wikidata se pueden situar con el buscador de OpenStreetMap (Nominatim). Se envía solo el nombre de cada elemento, uno por segundo. Al aplicar se guardan las coordenadas y la tipología solo donde falten.")}
      </p>
      {confirm ? (
        <div className="authority-confirm" role="alertdialog">
          <p>{t("Se enviarán a OpenStreetMap los nombres de {n} elementos sin situar, uno por segundo.").replace("{n}", formatNumber(pending.filter((o) => !proposals[o.id]).length, 0))}</p>
          <Button onClick={() => setConfirm(false)}>{t("Cancelar")}</Button>
          <Button primary onClick={() => void run()}>
            {t("Buscar en OpenStreetMap")}
          </Button>
        </div>
      ) : progress ? (
        <div className="authority-confirm" role="status">
          <p>
            {t("Buscando en OpenStreetMap: {d} de {n}…").replace("{d}", formatNumber(progress.done, 0)).replace("{n}", formatNumber(progress.total, 0))}
          </p>
          <progress max={progress.total} value={progress.done} />
          <Button onClick={() => (stop.current = true)}>{t("Detener")}</Button>
        </div>
      ) : (
        <div className="authority-bulk">
          <Button disabled={!pending.some((o) => !proposals[o.id])} onClick={() => setConfirm(true)} data-testid="heritage-osm-start">
            <MapPinned size={14} />
            {t("Situar con OpenStreetMap {n} elementos sin coordenadas").replace("{n}", formatNumber(pending.filter((o) => !proposals[o.id]).length, 0))}
          </Button>
          {accepted.length > 0 && (
            <Button primary onClick={() => void apply()} data-testid="heritage-osm-apply">
              <Check size={14} /> {t("Aplicar {n} aceptadas").replace("{n}", formatNumber(accepted.length, 0))}
            </Button>
          )}
        </div>
      )}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{t(error)}</p>}
      {rows.length > 0 && (
        <ul className="authority-list heritage-proposals">
          {rows.slice(0, 400).map(([id, p]) => {
            const c = p.candidates[p.chosen];
            const info = c?.group ? typology(scheme, c.group, c.type, language) : null;
            return (
              <li key={id} className={`authority-item ${p.accepted ? "accepted" : ""}`}>
                <div className="authority-value">
                  <strong>{labels.get(id)}</strong>
                </div>
                <div className="authority-link">
                  {c ? (
                    <>
                      <span className={`heritage-confidence ${c.confidence}`}>{t(c.confidence === "high" ? "Alta" : c.confidence === "medium" ? "Media" : "Baja")}</span>
                      <span className="authority-summary">
                        <strong>
                          {info && <HeritageIcon name={info.icon} size={12} />} {c.name || c.display.split(",")[0]}
                        </strong>
                        <small>{[info?.type ?? info?.group, c.display].filter(Boolean).join(" · ")}</small>
                      </span>
                      {p.candidates.length > 1 && (
                        <select aria-label={t("Otro candidato")} value={p.chosen} onChange={(e) => set(id, { chosen: Number(e.target.value) })}>
                          {p.candidates.map((x, i) => (
                            <option key={x.osm} value={i}>
                              {x.display.slice(0, 80)}
                            </option>
                          ))}
                        </select>
                      )}
                      <Button
                        icon
                        aria-label={t("Abrir en el navegador")}
                        onClick={() => void window.imago.call("openExternalLink", { url: `https://www.openstreetmap.org/${c.osm}` })}
                      >
                        <ExternalLink size={13} />
                      </Button>
                      <Button
                        icon
                        aria-pressed={p.accepted}
                        className={p.accepted ? "active" : ""}
                        aria-label={t(p.accepted ? "Aceptada" : "Aceptar")}
                        onClick={() => set(id, { accepted: !p.accepted })}
                      >
                        <Check size={14} />
                      </Button>
                    </>
                  ) : (
                    <span className="muted">{p.error ? t(p.error) : t("Tampoco está en OpenStreetMap: sitúalo a mano en su ficha.")}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Linking the values of a property to authority records: Wikidata for people
// and places (with their Getty identifiers), Wikidata or Iconclass for
// subjects. Only the text of the values searched is sent, and only when the
// person asks; proposals are reviewed before they are kept.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Link2, MapPin, Search, Unlink, X } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { ValueCount } from "../../shared/cleanup";
import { AUTHORITY_SOURCES, type AuthorityKind, type AuthorityLink, type AuthoritySource } from "../../shared/authority";
import { useT, formatNumber } from "../i18n";
import { Button, Modal } from "./ui";

const guessKind = (name: string): AuthorityKind =>
  /autor|fot[oó]graf|cr[eé]dito|artista|editor|estudio|author|photographer|artist|publisher/i.test(name)
    ? "person"
    : /lugar|localidad|ciudad|municipio|provincia|patrimonio|monumento|place|location|city|site/i.test(name)
      ? "place"
      : "subject";

function LinkSummary({ link }: { link: AuthorityLink }) {
  const t = useT();
  const ids = [
    link.ulan && `ULAN ${link.ulan}`,
    link.tgn && `TGN ${link.tgn}`,
    link.aat && `AAT ${link.aat}`,
    link.iconclass && link.source !== "iconclass" && `Iconclass ${link.iconclass}`,
  ].filter(Boolean) as string[];
  const years = link.born || link.died ? `${link.born ?? "?"}–${link.died ?? ""}` : null;
  return (
    <span className="authority-summary">
      <strong>{link.label}</strong>
      <small>
        {[AUTHORITY_SOURCES[link.source] + " " + link.id, years, link.description].filter(Boolean).join(" · ")}
      </small>
      {(ids.length > 0 || link.coordinates) && (
        <span className="authority-ids">
          {ids.map((id) => (
            <i key={id}>{id}</i>
          ))}
          {link.coordinates && (
            <i>
              <MapPin size={11} /> {t("Coordenadas")}
            </i>
          )}
        </span>
      )}
    </span>
  );
}

export function AuthorityDialog({
  column,
  onClose,
  onDone,
}: {
  column: DatabaseColumn;
  onClose: () => void;
  onDone: (message: string, changed: boolean) => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<AuthorityKind>(() => guessKind(column.name));
  const [source, setSource] = useState<AuthoritySource>("wikidata");
  const [counts, setCounts] = useState<ValueCount[]>([]);
  const [links, setLinks] = useState<Record<string, AuthorityLink>>({});
  const [proposals, setProposals] = useState<Record<string, AuthorityLink[]>>({});
  const [open, setOpen] = useState<{ optionId: string; query: string } | null>(null);
  const [results, setResults] = useState<AuthorityLink[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);
  const effectiveSource: AuthoritySource = kind === "subject" ? source : "wikidata";

  useEffect(() => {
    void Promise.all([window.imago.call("valueCounts", { columnId: column.id }), window.imago.call("authorityLinks", { columnId: column.id })])
      .then(([c, l]) => {
        setCounts([...c].sort((a, b) => b.count - a.count));
        setLinks(l);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stop.current = true;
    };
  }, [column.id]);

  const pending = useMemo(() => counts.filter((c) => c.optionId && !links[c.optionId]), [counts, links]);
  const located = useMemo(() => Object.values(links).filter((l) => l.coordinates).length, [links]);
  const save = async (items: { optionId: string; link: AuthorityLink | null }[]) => {
    await window.imago.call("authoritySet", { columnId: column.id, items });
    setLinks((all) => {
      const next = { ...all };
      for (const { optionId, link } of items) {
        if (link) next[optionId] = link;
        else delete next[optionId];
      }
      return next;
    });
    setProposals((all) => {
      const next = { ...all };
      for (const { optionId } of items) delete next[optionId];
      return next;
    });
  };
  const search = async (query: string) => {
    setSearching(true);
    setError(null);
    try {
      setResults(await window.imago.call("authoritySearch", { source: effectiveSource, query, kind }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };
  const proposeAll = async () => {
    setConfirmBulk(false);
    stop.current = false;
    const list = pending.slice(0, 200);
    setBulk({ done: 0, total: list.length });
    for (const [i, item] of list.entries()) {
      if (stop.current) break;
      try {
        const found = await window.imago.call("authoritySearch", { source: effectiveSource, query: item.value, kind });
        if (found.length) setProposals((all) => ({ ...all, [item.optionId!]: found }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        break;
      }
      setBulk({ done: i + 1, total: list.length });
      // A pause between requests, out of courtesy to the public services.
      await new Promise((r) => setTimeout(r, 1000));
    }
    setBulk(null);
  };
  const proposed = Object.keys(proposals).length;

  return (
    <Modal icon={Link2} title={`${t("Enlazar con autoridades")} · ${column.name}`} onClose={onClose} wide>
      <div className="modal-body authority-dialog" data-testid="authority-dialog">
        <p className="hint">
          {t("Cada valor se puede enlazar con su registro en Wikidata, que incluye los identificadores de Getty (ULAN, TGN, AAT) cuando existen, o con Iconclass para temas iconográficos. Los enlaces se exportan junto a los datos. Solo se envía el texto de los valores que buscas.")}
        </p>
        <div className="authority-controls">
          <div className="segmented" role="group" aria-label={t("Qué contiene esta propiedad")}>
            {(["person", "place", "subject"] as const).map((k) => (
              <button key={k} type="button" className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
                {t(k === "person" ? "Personas y estudios" : k === "place" ? "Lugares y monumentos" : "Temas")}
              </button>
            ))}
          </div>
          {kind === "subject" && (
            <div className="segmented" role="group" aria-label={t("Fuente")}>
              {(["wikidata", "iconclass"] as const).map((s) => (
                <button key={s} type="button" className={source === s ? "active" : ""} onClick={() => setSource(s)}>
                  {AUTHORITY_SOURCES[s]}
                </button>
              ))}
            </div>
          )}
          <span className="authority-stats">
            {t("{l} de {n} valores enlazados").replace("{l}", formatNumber(Object.keys(links).length, 0)).replace("{n}", formatNumber(counts.length, 0))}
          </span>
        </div>
        {effectiveSource === "iconclass" && <p className="hint">{t("Iconclass no admite búsquedas en español: escribe el tema en inglés (por ejemplo, «procession» o «market»).")}</p>}
        {confirmBulk ? (
          <div className="authority-confirm" role="alertdialog">
            <p>
              {t("Se enviarán a {s} los nombres de {n} valores (solo el texto de cada valor), uno tras otro. Las propuestas no se guardan hasta que las aceptas.")
                .replace("{s}", AUTHORITY_SOURCES[effectiveSource])
                .replace("{n}", formatNumber(Math.min(200, pending.length), 0))}
            </p>
            <Button onClick={() => setConfirmBulk(false)}>{t("Cancelar")}</Button>
            <Button primary onClick={() => void proposeAll()} data-testid="authority-bulk-confirm">
              {t("Buscar propuestas")}
            </Button>
          </div>
        ) : bulk ? (
          <div className="authority-confirm" role="status">
            <p>{t("Buscando propuestas: {d} de {n}…").replace("{d}", String(bulk.done)).replace("{n}", String(bulk.total))}</p>
            <Button onClick={() => (stop.current = true)}>{t("Detener")}</Button>
          </div>
        ) : (
          <div className="authority-bulk">
            <Button disabled={!pending.length} onClick={() => setConfirmBulk(true)} data-testid="authority-bulk">
              <Search size={14} />
              {t("Proponer enlaces para los valores sin enlazar")}
            </Button>
            {proposed > 0 && (
              <Button
                onClick={() =>
                  void save(Object.entries(proposals).map(([optionId, found]) => ({ optionId, link: found[0] }))).then(() =>
                    onDone(t("{n} enlaces guardados.").replace("{n}", String(proposed)), false),
                  )
                }
                data-testid="authority-accept-all"
              >
                <Check size={14} />
                {t("Aceptar las {n} primeras propuestas").replace("{n}", String(proposed))}
              </Button>
            )}
            {kind === "place" && located > 0 && (
              <Button
                data-testid="authority-locate"
                data-tooltip={t("Crea una propiedad de ubicación con las coordenadas de Wikidata de cada lugar enlazado")}
                onClick={() =>
                  void window.imago
                    .call("authorityLocate", { columnId: column.id, name: t("Ubicación") })
                    .then((r) => onDone(t("{n} registros situados en el mapa.").replace("{n}", formatNumber(r.located, 0)), true))
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                }
              >
                <MapPin size={14} />
                {t("Situar los registros en el mapa")}
              </Button>
            )}
          </div>
        )}
        {error && <p className="error">{t(error)}</p>}
        <ul className="authority-list">
          {counts.slice(0, 400).map((item) => {
            const optionId = item.optionId!;
            const link = links[optionId],
              proposal = proposals[optionId]?.[0];
            const editing = open?.optionId === optionId;
            return (
              <li key={optionId} className="authority-item" data-testid="authority-item">
                <div className="authority-value">
                  <strong>{item.value}</strong>
                  <small>
                    {formatNumber(item.count, 0)} {t("registros")}
                  </small>
                </div>
                <div className="authority-link">
                  {link ? (
                    <>
                      <LinkSummary link={link} />
                      <Button
                        icon
                        aria-label={t("Abrir en el navegador")}
                        data-tooltip={link.uri}
                        onClick={() => void window.imago.call("openExternalLink", { url: link.uri })}
                      >
                        <ExternalLink size={13} />
                      </Button>
                      <Button icon aria-label={t("Quitar el enlace")} data-tooltip={t("Quitar el enlace")} onClick={() => void save([{ optionId, link: null }])}>
                        <Unlink size={13} />
                      </Button>
                    </>
                  ) : proposal ? (
                    <>
                      <span className="authority-proposal-label">{t("Propuesta")}</span>
                      <LinkSummary link={proposal} />
                      <Button icon aria-label={t("Aceptar")} data-tooltip={t("Aceptar")} onClick={() => void save([{ optionId, link: proposal }])}>
                        <Check size={14} />
                      </Button>
                      <Button
                        icon
                        aria-label={t("Descartar")}
                        data-tooltip={t("Descartar")}
                        onClick={() =>
                          setProposals((all) => {
                            const next = { ...all };
                            delete next[optionId];
                            return next;
                          })
                        }
                      >
                        <X size={14} />
                      </Button>
                    </>
                  ) : (
                    <span className="muted">{t("Sin enlazar")}</span>
                  )}
                  <Button
                    icon
                    aria-label={t("Buscar")}
                    data-tooltip={t("Buscar")}
                    onClick={() => {
                      if (editing) {
                        setOpen(null);
                        return;
                      }
                      setOpen({ optionId, query: item.value });
                      setResults(proposals[optionId] ?? null);
                    }}
                  >
                    <Search size={13} />
                  </Button>
                </div>
                {editing && (
                  <div className="authority-search">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void search(open.query);
                      }}
                    >
                      <input value={open.query} onChange={(e) => setOpen({ ...open, query: e.target.value })} aria-label={t("Texto que se busca")} />
                      <Button primary type="submit" disabled={searching || !open.query.trim()}>
                        <Search size={13} />
                        {t(searching ? "Buscando…" : "Buscar")}
                      </Button>
                    </form>
                    {results && !results.length && !searching && <p className="muted">{t("Sin resultados. Prueba con otra forma del nombre.")}</p>}
                    <ul>
                      {results?.map((r) => (
                        <li key={r.source + r.id}>
                          <LinkSummary link={r} />
                          <Button
                            onClick={() =>
                              void save([{ optionId, link: r }]).then(() => {
                                setOpen(null);
                                setResults(null);
                              })
                            }
                          >
                            <Link2 size={13} />
                            {t("Enlazar")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <footer>
        <Button onClick={onClose}>{t("Cerrar")}</Button>
      </footer>
    </Modal>
  );
}

// Parts of the heritage cell's list: what each element is and where, and
// adding a new element by name or straight from Wikidata (like a place from
// the gazetteer in a location cell). Wikidata is asked only on click.
import { useState } from "react";
import { Link2, MapPin, Plus, Search } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { AuthorityLink } from "../../shared/authority";
import { resolvedPosition, typeFromInstances, typology, type HeritageElement, type HeritageScheme } from "../../shared/heritage";
import { useLanguage, useT } from "../i18n";
import { HeritageIcon } from "./HeritageIcon";

/** Asks the open database to reload its properties (a new element was added). */
export const reloadDetail = () => window.dispatchEvent(new CustomEvent("imago:reload-detail"));

export function HeritageOptionMeta({
  optionId,
  elements,
  scheme,
  labels,
}: {
  optionId: string;
  elements: Record<string, HeritageElement>;
  scheme: HeritageScheme;
  labels: Map<string, string>;
}) {
  const t = useT(),
    language = useLanguage();
  const e = elements[optionId];
  const info = typology(scheme, e?.group ?? null, e?.type ?? null, language);
  const parent = e?.parentId ? labels.get(e.parentId) : null;
  const placed = !!resolvedPosition(optionId, elements);
  const text = [info?.type ?? info?.group, parent && `${t("en")} ${parent}`].filter(Boolean).join(" · ");
  if (!text && !placed) return null;
  return (
    <small className="heritage-option-meta">
      {text}
      {placed && <MapPin size={10} aria-label={t("Situado")} />}
    </small>
  );
}

export function HeritageAddFooter({
  column,
  query,
  scheme,
  onAdded,
}: {
  column: DatabaseColumn;
  query: string;
  scheme: HeritageScheme;
  onAdded: (optionId: string) => void;
}) {
  const t = useT(),
    language = useLanguage();
  const [results, setResults] = useState<AuthorityLink[] | null>(null);
  const [searched, setSearched] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = query.trim();
  if (!text) return null;
  const add = async (link: AuthorityLink | null) => {
    setBusy(true);
    setError(null);
    try {
      const id = await window.imago.call("heritageAddElement", { columnId: column.id, label: link && !text ? link.label : text, link });
      reloadDetail();
      onAdded(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const search = async () => {
    setBusy(true);
    setError(null);
    setSearched(text);
    try {
      setResults(await window.imago.call("authoritySearch", { source: "wikidata", query: text, kind: null }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResults([]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="heritage-add" onMouseDown={(e) => e.preventDefault()}>
      <button type="button" disabled={busy} onClick={() => void add(null)}>
        <Plus size={13} /> {t("Crear")} «{text}»
      </button>
      <button type="button" disabled={busy} onClick={() => void search()} data-tooltip={t("Solo se envía el texto escrito, y solo al pulsar.")}>
        <Search size={13} /> {t("Buscar «{q}» en Wikidata").replace("{q}", text)}
      </button>
      {error && <small className="error">{t(error)}</small>}
      {results && searched === text && (
        <div className="heritage-add-results" role="listbox" aria-label={t("Resultados de Wikidata")}>
          {!results.length && <small className="muted">{t("Sin resultados. Prueba con otra forma del nombre.")}</small>}
          {results.map((r) => {
            const typed = typeFromInstances(r.instances);
            const info = typed && typology(scheme, typed.group, typed.type, language);
            return (
              <button key={r.id} type="button" role="option" aria-selected={false} disabled={busy} onClick={() => void add(r)}>
                <HeritageIcon name={info?.icon} size={13} />
                <span>
                  <strong>{r.label}</strong>
                  <small>{[r.description, r.coordinates ? t("Coordenadas") : null, r.id].filter(Boolean).join(" · ")}</small>
                </span>
                <Link2 size={12} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

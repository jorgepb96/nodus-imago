// The records of a heritage property: each element with its Wikidata link,
// typology, the element it is part of and its coordinates; the typology
// itself; and linking many elements to Wikidata at once, reviewed first.
// Only the names searched are sent to Wikidata, and only when the person asks.
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Landmark, Link2, ListTree, MapPin, Plus, Search, Shapes, Tags, Trash2, Unlink, Wand2 } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { AuthorityLink } from "../../shared/authority";
import {
  childrenOf,
  descendantsAndSelf,
  emptyElement,
  foldText,
  heritageScheme,
  resolvedPosition,
  typeFromInstances,
  typeFromName,
  typology,
  type HeritageElement,
  type HeritageScheme,
} from "../../shared/heritage";
import { formatNumber, useLanguage, useT } from "../i18n";
import { refreshHeritage } from "../heritageStore";
import { Button, Modal } from "./ui";
import { HERITAGE_ICONS, HeritageIcon } from "./HeritageIcon";
import { LocationMap } from "./LocationMap";
import { HeritageIdentify } from "./HeritageIdentify";

type Filter = "all" | "unlinked" | "unplaced" | "untyped";
type View = "elements" | "scheme" | "identify";

export function HeritageDialog({
  column,
  onClose,
  onChanged,
}: {
  column: DatabaseColumn;
  onClose: () => void;
  /** The property's configuration changed (its typology): reload the database. */
  onChanged: () => void;
}) {
  const t = useT(),
    language = useLanguage();
  const [view, setView] = useState<View>("elements");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [links, setLinks] = useState<Record<string, AuthorityLink>>({});
  const [elements, setElements] = useState<Record<string, HeritageElement>>({});
  const [scheme, setScheme] = useState<HeritageScheme>(() => heritageScheme(column.config));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    Promise.all([
      window.imago.call("valueCounts", { columnId: column.id }),
      window.imago.call("authorityLinks", { columnId: column.id }),
      window.imago.call("heritageElements", { columnId: column.id }),
    ])
      .then(([c, l, e]) => {
        setCounts(Object.fromEntries(c.filter((x) => x.optionId).map((x) => [x.optionId!, x.count])));
        setLinks(l);
        setElements(e);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column.id]);

  const labels = useMemo(() => Object.fromEntries(column.options.map((o) => [o.id, o.label])), [column.options]);
  const list = useMemo(() => {
    const needle = foldText(query);
    return column.options
      .filter((o) => !needle || foldText(o.label).includes(needle))
      .filter((o) => {
        const e = elements[o.id];
        if (filter === "unlinked") return !links[o.id];
        if (filter === "unplaced") return !resolvedPosition(o.id, elements);
        if (filter === "untyped") return !e?.group;
        return true;
      })
      .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.label.localeCompare(b.label));
  }, [column.options, query, filter, elements, links, counts]);
  const stats = useMemo(
    () => ({
      total: column.options.length,
      linked: column.options.filter((o) => links[o.id]).length,
      placed: column.options.filter((o) => resolvedPosition(o.id, elements)).length,
      typed: column.options.filter((o) => elements[o.id]?.group).length,
    }),
    [column.options, links, elements],
  );

  // Elements whose name announces a typology they do not have yet.
  const inferable = useMemo(
    () => column.options.filter((o) => !elements[o.id]?.group && typeFromName(o.label)).length,
    [column.options, elements],
  );
  const [notice, setNotice] = useState<string | null>(null);
  const inferTypes = async () => {
    setError(null);
    try {
      const batch = await window.imago.call("heritageInferTypes", { columnId: column.id });
      setNotice(t("{n} elementos tipificados por su nombre. Puedes revertirlo en «Identificar en Wikidata › Vinculaciones anteriores».").replace("{n}", formatNumber(batch.applied, 0)));
      await reload();
      refreshHeritage(column.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveElement = async (element: HeritageElement) => {
    setError(null);
    try {
      await window.imago.call("heritageSave", { columnId: column.id, items: [element] });
      setElements((all) => ({ ...all, [element.optionId]: element }));
      refreshHeritage(column.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const saveLink = async (optionId: string, link: AuthorityLink | null) => {
    setError(null);
    try {
      await window.imago.call("authoritySet", { columnId: column.id, items: [{ optionId, link }] });
      setLinks((all) => {
        const next = { ...all };
        if (link) next[optionId] = link;
        else delete next[optionId];
        return next;
      });
      if (!link) return;
      // What Wikidata says fills only what the record lacks.
      const e = { ...emptyElement(optionId), ...elements[optionId] };
      if (link.coordinates && e.coordSource !== "manual")
        Object.assign(e, { latitude: link.coordinates.latitude, longitude: link.coordinates.longitude, coordSource: "wikidata" });
      const typed = typeFromInstances(link.instances);
      if (!e.group && typed && scheme.groups.some((g) => g.key === typed.group && g.types.some((x) => x.key === typed.type)))
        Object.assign(e, typed);
      if (!e.parentId && link.partOf?.length) {
        const parent = Object.entries(links).find(([id, l]) => id !== optionId && link.partOf!.includes(l.id))?.[0];
        if (parent) e.parentId = parent;
      }
      await saveElement(e);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal icon={Landmark} title={`${t("Elementos patrimoniales")} · ${column.name}`} onClose={onClose} wide>
      <div className="modal-body heritage-dialog" data-testid="heritage-dialog">
        <div className="heritage-toolbar">
          <div className="segmented" role="tablist" aria-label={t("Vista")}>
            <button type="button" className={view === "elements" ? "active" : ""} onClick={() => setView("elements")}>
              <ListTree size={13} /> {t("Elementos")}
            </button>
            <button type="button" className={view === "identify" ? "active" : ""} onClick={() => setView("identify")}>
              <Wand2 size={13} /> {t("Identificar en Wikidata")}
            </button>
            <button type="button" className={view === "scheme" ? "active" : ""} onClick={() => setView("scheme")}>
              <Shapes size={13} /> {t("Tipologías")}
            </button>
          </div>
          <span className="authority-stats">
            {t("{n} elementos · {l} enlazados · {p} situados · {k} con tipología")
              .replace("{n}", formatNumber(stats.total, 0))
              .replace("{l}", formatNumber(stats.linked, 0))
              .replace("{p}", formatNumber(stats.placed, 0))
              .replace("{k}", formatNumber(stats.typed, 0))}
          </span>
        </div>
        {error && <p className="error">{t(error)}</p>}
        {notice && <p className="success">{notice}</p>}
        {view === "elements" && inferable > 0 && (
          <div className="authority-bulk">
            <button type="button" className="button" onClick={() => void inferTypes()} data-testid="heritage-infer-types">
              <Tags size={14} />
              {t("Tipología por el nombre para {n} elementos").replace("{n}", formatNumber(inferable, 0))}
            </button>
            <span className="muted">{t("«Castillo de …» cuenta como castillo, «Iglesia de …» como iglesia, aunque Wikidata no lo conozca.")}</span>
          </div>
        )}
        {view === "elements" && (
          <div className="heritage-panes">
            <div className="heritage-list-pane">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Buscar elemento")}
                aria-label={t("Buscar elemento")}
              />
              <div className="segmented heritage-filters" role="group" aria-label={t("Filtrar")}>
                {(
                  [
                    ["all", "Todos"],
                    ["unlinked", "Sin Wikidata"],
                    ["unplaced", "Sin situar"],
                    ["untyped", "Sin tipología"],
                  ] as const
                ).map(([key, label]) => (
                  <button key={key} type="button" className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
                    {t(label)}
                  </button>
                ))}
              </div>
              <ul className="heritage-list" role="listbox" aria-label={t("Elementos")}>
                {list.slice(0, 600).map((o) => {
                  const e = elements[o.id];
                  const info = typology(scheme, e?.group ?? null, e?.type ?? null, language);
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected === o.id}
                        className={selected === o.id ? "active" : ""}
                        onClick={() => setSelected(o.id)}
                      >
                        <HeritageIcon name={info?.icon} size={14} />
                        <span className="heritage-list-label">{o.label}</span>
                        <span className="heritage-list-marks">
                          {links[o.id] && <Link2 size={11} aria-label={t("Enlazado")} />}
                          {resolvedPosition(o.id, elements) && <MapPin size={11} aria-label={t("Situado")} />}
                        </span>
                        <small>{formatNumber(counts[o.id] ?? 0, 0)}</small>
                      </button>
                    </li>
                  );
                })}
                {list.length > 600 && <li className="muted">{t("Escribe para ver más elementos")}</li>}
              </ul>
            </div>
            <div className="heritage-record-pane">
              {selected && labels[selected] !== undefined ? (
                <ElementRecord
                  key={selected}
                  optionId={selected}
                  label={labels[selected]}
                  count={counts[selected] ?? 0}
                  element={{ ...emptyElement(selected), ...elements[selected] }}
                  elements={elements}
                  labels={labels}
                  link={links[selected] ?? null}
                  scheme={scheme}
                  onSave={saveElement}
                  onLink={(link) => saveLink(selected, link)}
                  onSelect={setSelected}
                />
              ) : (
                <p className="muted heritage-empty">{t("Elige un elemento para ver y completar su ficha.")}</p>
              )}
            </div>
          </div>
        )}
        {view === "scheme" && (
          <SchemeEditor
            scheme={scheme}
            elements={elements}
            onSave={async (next) => {
              setError(null);
              try {
                // Elements whose type no longer exists lose it.
                const lost = Object.values(elements).filter(
                  (e) => e.group && !next.groups.some((g) => g.key === e.group && (!e.type || g.types.some((x) => x.key === e.type))),
                );
                await window.imago.call("updateColumn", { id: column.id, config: { ...column.config, heritageScheme: next } });
                if (lost.length)
                  await window.imago.call("heritageSave", {
                    columnId: column.id,
                    items: lost.map((e) => {
                      const group = next.groups.find((g) => g.key === e.group);
                      return group ? { ...e, type: null } : { ...e, group: null, type: null };
                    }),
                  });
                setScheme(next);
                await reload();
                refreshHeritage(column.id);
                onChanged();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
        )}
        {view === "identify" && (
          <HeritageIdentify
            column={column}
            links={links}
            elements={elements}
            counts={counts}
            scheme={scheme}
            onApplied={async () => {
              await reload();
              refreshHeritage(column.id);
            }}
          />
        )}
      </div>
      <footer>
        <Button onClick={onClose}>{t("Cerrar")}</Button>
      </footer>
    </Modal>
  );
}

function ElementRecord({
  optionId,
  label,
  count,
  element,
  elements,
  labels,
  link,
  scheme,
  onSave,
  onLink,
  onSelect,
}: {
  optionId: string;
  label: string;
  count: number;
  element: HeritageElement;
  elements: Record<string, HeritageElement>;
  labels: Record<string, string>;
  link: AuthorityLink | null;
  scheme: HeritageScheme;
  onSave: (e: HeritageElement) => Promise<void>;
  onLink: (link: AuthorityLink | null) => Promise<void>;
  onSelect: (id: string) => void;
}) {
  const t = useT(),
    language = useLanguage();
  const [search, setSearch] = useState<string | null>(null);
  const [results, setResults] = useState<AuthorityLink[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [lat, setLat] = useState(element.latitude?.toString() ?? "");
  const [lon, setLon] = useState(element.longitude?.toString() ?? "");
  const [searchError, setSearchError] = useState<string | null>(null);
  const position = resolvedPosition(optionId, elements);
  const children = useMemo(() => childrenOf(elements).get(optionId) ?? [], [elements, optionId]);
  // A parent can be any element but this one and its parts.
  const blocked = useMemo(() => new Set(descendantsAndSelf(optionId, elements)), [optionId, elements]);
  const parents = useMemo(
    () =>
      Object.entries(labels)
        .filter(([id]) => !blocked.has(id))
        .sort((a, b) => a[1].localeCompare(b[1])),
    [labels, blocked],
  );
  const group = scheme.groups.find((g) => g.key === element.group) ?? null;
  const runSearch = async (text: string) => {
    setSearching(true);
    setSearchError(null);
    try {
      setResults(await window.imago.call("authoritySearch", { source: "wikidata", query: text, kind: null }));
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };
  const saveCoordinates = () => {
    const latitude = lat.trim() ? Number(lat.replace(",", ".")) : null,
      longitude = lon.trim() ? Number(lon.replace(",", ".")) : null;
    if (latitude === null || longitude === null) {
      void onSave({ ...element, latitude: null, longitude: null, coordSource: null });
      return;
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
    void onSave({ ...element, latitude, longitude, coordSource: "manual" });
  };

  return (
    <div className="heritage-record" data-testid="heritage-record">
      <header>
        <h3>{label}</h3>
        <small className="muted">
          {formatNumber(count, 0)} {t("registros")}
        </small>
      </header>

      <section>
        <h4>Wikidata</h4>
        {link ? (
          <div className="heritage-link">
            <span className="authority-summary">
              <strong>{link.label}</strong>
              <small>{[link.id, link.description].filter(Boolean).join(" · ")}</small>
            </span>
            <Button icon aria-label={t("Abrir en el navegador")} data-tooltip={link.uri} onClick={() => void window.imago.call("openExternalLink", { url: link.uri })}>
              <ExternalLink size={13} />
            </Button>
            <Button icon aria-label={t("Quitar el enlace")} data-tooltip={t("Quitar el enlace")} onClick={() => void onLink(null)}>
              <Unlink size={13} />
            </Button>
          </div>
        ) : (
          <p className="muted">{t("Sin enlazar")}</p>
        )}
        {search === null ? (
          <Button
            onClick={() => {
              const text = label.split(/\s+[-–—]\s+/).slice(0, 2).join(" ");
              setSearch(text);
              void runSearch(text);
            }}
          >
            <Search size={13} /> {t(link ? "Cambiar enlace" : "Buscar en Wikidata")}
          </Button>
        ) : (
          <div className="authority-search">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch(search);
              }}
            >
              <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t("Texto que se busca")} />
              <Button primary type="submit" disabled={searching || !search.trim()}>
                <Search size={13} /> {t(searching ? "Buscando…" : "Buscar")}
              </Button>
            </form>
            {searchError && <p className="error">{t(searchError)}</p>}
            {results && !results.length && !searching && <p className="muted">{t("Sin resultados. Prueba con otra forma del nombre.")}</p>}
            <ul>
              {results?.map((r) => (
                <li key={r.id}>
                  <span className="authority-summary">
                    <strong>{r.label}</strong>
                    <small>{[r.id, r.description, r.coordinates ? t("Coordenadas") : null].filter(Boolean).join(" · ")}</small>
                  </span>
                  <Button
                    onClick={() =>
                      void onLink(r).then(() => {
                        setSearch(null);
                        setResults(null);
                      })
                    }
                  >
                    <Link2 size={13} /> {t("Enlazar")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="heritage-typology">
        <h4>{t("Tipología")}</h4>
        <label>
          {t("Grupo")}
          <select
            value={element.group ?? ""}
            onChange={(e) => void onSave({ ...element, group: e.target.value || null, type: null })}
          >
            <option value="">{t("Sin tipología")}</option>
            {scheme.groups.map((g) => (
              <option key={g.key} value={g.key}>
                {language === "en" ? g.labelEn || g.label : g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Tipo")}
          <select
            value={element.type ?? ""}
            disabled={!group}
            onChange={(e) => void onSave({ ...element, type: e.target.value || null })}
          >
            <option value="">—</option>
            {group?.types.map((x) => (
              <option key={x.key} value={x.key}>
                {language === "en" ? x.labelEn || x.label : x.label}
              </option>
            ))}
          </select>
        </label>
        {group && <HeritageIcon name={typology(scheme, element.group, element.type)?.icon} size={22} className="heritage-record-icon" />}
      </section>

      <section>
        <h4>{t("Forma parte de")}</h4>
        <select value={element.parentId ?? ""} onChange={(e) => void onSave({ ...element, parentId: e.target.value || null })}>
          <option value="">{t("Ninguno")}</option>
          {parents.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        {children.length > 0 && (
          <p className="heritage-children">
            {t("Sus partes:")}{" "}
            {children.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <button type="button" className="link-button" onClick={() => onSelect(id)}>
                  {labels[id]}
                </button>
              </span>
            ))}
          </p>
        )}
      </section>

      <section>
        <h4>{t("Coordenadas")}</h4>
        <div className="heritage-coordinates">
          <input value={lat} onChange={(e) => setLat(e.target.value)} onBlur={saveCoordinates} placeholder={t("Latitud")} aria-label={t("Latitud")} inputMode="decimal" />
          <input value={lon} onChange={(e) => setLon(e.target.value)} onBlur={saveCoordinates} placeholder={t("Longitud")} aria-label={t("Longitud")} inputMode="decimal" />
          {link?.coordinates && element.coordSource === "manual" && (
            <Button
              onClick={() => {
                setLat(String(link.coordinates!.latitude));
                setLon(String(link.coordinates!.longitude));
                void onSave({ ...element, latitude: link.coordinates!.latitude, longitude: link.coordinates!.longitude, coordSource: "wikidata" });
              }}
            >
              {t("Usar las de Wikidata")}
            </Button>
          )}
        </div>
        <p className="muted">
          {element.coordSource === "manual"
            ? t("Coordenadas puestas a mano: Wikidata no las cambia.")
            : element.coordSource === "wikidata"
              ? t("Coordenadas de Wikidata.")
              : element.coordSource === "osm"
                ? `${t("Coordenadas de OpenStreetMap")} (${element.osm ?? ""}).`
              : position?.inherited
                ? `${t("Sin coordenadas propias: se usa la posición del conjunto")} (${labels[position.from] ?? ""}).`
                : t("Sin coordenadas: no aparece en el mapa.")}
        </p>
        {position && <LocationMap latitude={position.latitude} longitude={position.longitude} name={label} />}
      </section>
    </div>
  );
}

function SchemeEditor({
  scheme,
  elements,
  onSave,
}: {
  scheme: HeritageScheme;
  elements: Record<string, HeritageElement>;
  onSave: (scheme: HeritageScheme) => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<HeritageScheme>(() => structuredClone(scheme));
  const [saving, setSaving] = useState(false);
  const used = useMemo(() => {
    const out = new Map<string, number>();
    for (const e of Object.values(elements)) {
      if (e.group) out.set(e.group, (out.get(e.group) ?? 0) + 1);
      if (e.group && e.type) out.set(`${e.group}/${e.type}`, (out.get(`${e.group}/${e.type}`) ?? 0) + 1);
    }
    return out;
  }, [elements]);
  const key = (label: string, taken: string[]) => {
    const base =
      foldText(label)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 30) || "tipo";
    let k = base,
      n = 2;
    while (taken.includes(k)) k = `${base}-${n++}`;
    return k;
  };
  const update = (fn: (s: HeritageScheme) => void) =>
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  const valid = draft.groups.every((g) => g.label.trim() && g.types.every((x) => x.label.trim()));
  const removedInUse = Object.values(elements).filter((e) => {
    if (!e.group) return false;
    const group = draft.groups.find((g) => g.key === e.group);
    return !group || (!!e.type && !group.types.some((x) => x.key === e.type));
  }).length;

  return (
    <div className="heritage-scheme" data-testid="heritage-scheme">
      <p className="hint">
        {t("Cada elemento puede tener un grupo y un tipo. Los iconos se ven en las celdas, en el mapa de patrimonio y en las estadísticas.")}
      </p>
      {draft.groups.map((g, gi) => (
        <fieldset key={g.key} className="heritage-scheme-group">
          <legend>
            <HeritageIcon name={g.icon} size={16} />
            <input
              value={g.label}
              aria-label={t("Nombre del grupo")}
              onChange={(e) => update((s) => void (s.groups[gi].label = e.target.value))}
            />
            <select value={g.icon} aria-label={t("Icono")} onChange={(e) => update((s) => void (s.groups[gi].icon = e.target.value))}>
              {Object.keys(HERITAGE_ICONS).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <small className="muted">{formatNumber(used.get(g.key) ?? 0, 0)}</small>
            <Button icon aria-label={t("Quitar el grupo")} data-tooltip={t("Quitar el grupo")} onClick={() => update((s) => void s.groups.splice(gi, 1))}>
              <Trash2 size={13} />
            </Button>
          </legend>
          <ul>
            {g.types.map((x, ti) => (
              <li key={x.key}>
                <HeritageIcon name={x.icon ?? g.icon} size={13} />
                <input
                  value={x.label}
                  aria-label={t("Nombre del tipo")}
                  onChange={(e) => update((s) => void (s.groups[gi].types[ti].label = e.target.value))}
                />
                <small className="muted">{formatNumber(used.get(`${g.key}/${x.key}`) ?? 0, 0)}</small>
                <Button icon aria-label={t("Quitar el tipo")} data-tooltip={t("Quitar el tipo")} onClick={() => update((s) => void s.groups[gi].types.splice(ti, 1))}>
                  <Trash2 size={12} />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            onClick={() =>
              update((s) => {
                const label = t("Nuevo tipo");
                s.groups[gi].types.push({ key: key(label, s.groups[gi].types.map((y) => y.key)), label, labelEn: "" });
              })
            }
          >
            <Plus size={13} /> {t("Añadir tipo")}
          </Button>
        </fieldset>
      ))}
      <div className="heritage-scheme-actions">
        <Button
          onClick={() =>
            update((s) => {
              const label = t("Nuevo grupo");
              s.groups.push({ key: key(label, s.groups.map((g) => g.key)), label, labelEn: "", icon: "Landmark", types: [] });
            })
          }
        >
          <Plus size={13} /> {t("Añadir grupo")}
        </Button>
        {removedInUse > 0 && (
          <span className="warning">
            {t("{n} elementos se quedarán sin tipología.").replace("{n}", formatNumber(removedInUse, 0))}
          </span>
        )}
        <Button
          primary
          disabled={!valid || saving}
          onClick={() => {
            setSaving(true);
            void onSave(draft).finally(() => setSaving(false));
          }}
        >
          {t("Guardar tipologías")}
        </Button>
      </div>
    </div>
  );
}

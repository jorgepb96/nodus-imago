// «Variantes y apariciones», a tab of the record panel: the versions of the
// image on screen across every database, which the researcher confirms,
// rejects, names and compares, and the works in which the photograph appears,
// from the records of its family and from reproductions added by hand.
import { useEffect, useState } from "react";
import { BookOpen, Camera, Check, Columns2, Download, Layers, Pencil, Plus, Route, Search, Settings2, Trash2, Undo2, X } from "lucide-react";
import { tableToCsv } from "../../shared/databaseExport";
import type { DatabaseColumn, DatabaseSummary } from "../../shared/databases";
import type { ImageAsset, RecordRow } from "../../shared/imago";
import type {
  AppearanceFields,
  ImageAppearance,
  ImageVariantMember,
  ImageVariants,
  Sensitivity,
  VariantKind,
  VariantVerdict,
  WorkLink,
  ImageCirculation,
  CirculationEntry,
} from "../../shared/variants";
import { VARIANT_KINDS } from "../../shared/variants";
import { useT } from "../i18n";
import { Button, Thumbnail } from "./ui";
import type { Perform } from "./Properties";

const KIND_LABEL: Record<VariantKind, string> = {
  copy: "Copia u otro escaneo",
  crop: "Recorte",
  retouch: "Retoque",
  reproduction: "Reproducción impresa",
  other_take: "Otra toma",
};
const MATCH_LABEL: Record<ImageVariantMember["match"], string> = {
  identical: "Mismo archivo",
  near: "Copia o reproducción",
  similar: "Recorte, retoque o similar",
  confirmed: "Confirmada",
};
const GROUPS: { key: string; title: string; keep: (m: ImageVariantMember) => boolean }[] = [
  { key: "identical", title: "Idénticas: el mismo archivo", keep: (m) => m.match === "identical" },
  { key: "near", title: "Copias, reproducciones u otros escaneos", keep: (m) => m.match === "near" },
  { key: "similar", title: "Recortes, retoques o similares", keep: (m) => m.match === "similar" },
  { key: "confirmed", title: "Añadidas o confirmadas por ti", keep: (m) => m.match === "confirmed" },
];
const FIELDS_KEY = "imago.appearanceFields";
const readFields = (): Record<string, AppearanceFields> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(FIELDS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};
type Draft = { id?: string; work: string; author: string; year: string; page: string; caption: string; note: string };
const EMPTY_DRAFT: Draft = { work: "", author: "", year: "", page: "", caption: "", note: "" };

export function RecordVariants({
  row,
  image,
  perform,
  onOpenRecord,
  onCompare,
  onCount,
  onChanged,
}: {
  row: RecordRow;
  /** The image the panel is on. */
  image: ImageAsset | undefined;
  perform: Perform;
  onOpenRecord?: (rowId: string) => void;
  onCompare?: (assetIds: string[]) => void;
  /** How many versions were found, for the tab's label. */
  onCount?: (count: number) => void;
  /** Records changed (gathered into a work): the panel and the table reload. */
  onChanged?: () => void;
}) {
  const t = useT();
  const [sensitivity, setSensitivity] = useState<Sensitivity>("balanced"),
    [variants, setVariants] = useState<ImageVariants | null>(null),
    [appearances, setAppearances] = useState<ImageAppearance[] | null>(null),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [picked, setPicked] = useState<string[]>([]),
    [fields, setFields] = useState(readFields),
    [columns, setColumns] = useState<Record<string, { name: string; columns: DatabaseColumn[] }>>({}),
    [draft, setDraft] = useState<Draft | null>(null),
    [finding, setFinding] = useState(false),
    [query, setQuery] = useState(""),
    [found, setFound] = useState<RecordRow[]>([]),
    [work, setWork] = useState<WorkLink | null>(null),
    [circulation, setCirculation] = useState<ImageCirculation | null>(null),
    [gathering, setGathering] = useState<{ title: string; databaseId: string } | null>(null),
    [worksDbs, setWorksDbs] = useState<DatabaseSummary[]>([]);
  const imageId = image?.id;
  const fieldsKey = JSON.stringify(fields);
  useEffect(() => {
    if (!imageId) return;
    let cancelled = false;
    setError(null);
    void Promise.all([
      window.imago.call("imageVariants", { assetId: imageId, sensitivity }),
      window.imago.call("imageAppearances", { assetId: imageId, sensitivity, fields: JSON.parse(fieldsKey) }),
      window.imago.call("workOf", { rowId: row.id }).catch(() => null),
      window.imago.call("imageCirculation", { assetId: imageId, sensitivity, fields: JSON.parse(fieldsKey) }).catch(() => null),
    ])
      .then(([v, a, w, c]) => {
        if (cancelled) return;
        setVariants(v);
        setAppearances(a);
        setWork(w);
        setCirculation(c);
        onCount?.(v.members.length);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, sensitivity, fieldsKey, revision]);
  useEffect(() => {
    setPicked([]);
    setGathering(null);
  }, [imageId]);
  // The properties of each database in the list, to choose work, page and caption.
  const databaseIds = [...new Set((appearances ?? []).flatMap((a) => (a.databaseId ? [a.databaseId] : [])))];
  const databasesKey = databaseIds.join("|");
  useEffect(() => {
    for (const id of databasesKey ? databasesKey.split("|") : [])
      if (!columns[id])
        void window.imago
          .call("detail", { id })
          .then((d) => setColumns((current) => ({ ...current, [id]: { name: d.database.name, columns: d.columns } })))
          .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databasesKey]);
  if (!image)
    return (
      <div className="record-variants" data-testid="record-variants">
        <p className="hint">{t("Este registro no tiene imagen: añade una para buscar sus variantes y apariciones.")}</p>
      </div>
    );
  const reload = () => setRevision((n) => n + 1);
  const judge = (other: ImageVariantMember, verdict: VariantVerdict | null, kind: VariantKind | null = null) =>
    void perform(async () => {
      await window.imago.call("variantVerdict", { assetId: image.id, otherAssetId: other.assetId, verdict, kind });
      reload();
    });
  const toggle = (assetId: string) =>
    setPicked((current) => (current.includes(assetId) ? current.filter((id) => id !== assetId) : current.length < 6 ? [...current, assetId] : current));
  const saveFields = (databaseId: string, part: keyof AppearanceFields, value: string) => {
    const next = { ...fields, [databaseId]: { ...fields[databaseId] } };
    if (value === "auto") delete next[databaseId][part];
    else next[databaseId][part] = value === "none" ? null : value;
    setFields(next);
    try {
      localStorage.setItem(FIELDS_KEY, JSON.stringify(next));
    } catch {
      /* Local interface preference. */
    }
  };
  const saveDraft = () =>
    draft &&
    void perform(async () => {
      const year = draft.year.trim() ? Number(draft.year) : null;
      if (year !== null && !Number.isInteger(year)) throw new Error("Escribe el año con cifras.");
      await window.imago.call("appearanceSave", {
        ...(draft.id ? { id: draft.id } : {}),
        assetId: image.id,
        work: draft.work,
        author: draft.author || null,
        year,
        page: draft.page || null,
        caption: draft.caption || null,
        note: draft.note || null,
      });
      setDraft(null);
      reload();
    });
  const find = async (text: string) => {
    setQuery(text);
    if (text.trim().length < 2) return setFound([]);
    const page = await window.imago.call("search", { query: text, mode: "literal", match: "partial", limit: 12 });
    setFound(page.rows.filter((r) => r.id !== row.id && r.images.length));
  };
  const members = variants?.members ?? [];
  // The records of the family (one per record, this one included) and those not yet under the work.
  const familyRows = [...new Set([row.id, ...members.map((m) => m.rowId)])];
  const missing = work ? familyRows.filter((id) => id !== work.workId && !work.reproductions.includes(id)) : [];
  const startGathering = () =>
    void perform(async () => {
      const dbs = (await window.imago.call("listDatabases")).filter((d) => d.kind === "works");
      setWorksDbs(dbs);
      setGathering({ title: row.title, databaseId: dbs[0]?.id ?? "" });
    });
  const gather = (title: string | null, databaseId: string | null) =>
    void perform(async () => {
      await window.imago.call("createWorkFromFamily", { assetId: image.id, sensitivity, databaseId: databaseId || null, title });
      setGathering(null);
      reload();
      onChanged?.();
    });
  const card = (m: ImageVariantMember, rejected = false) => {
    const chosen = picked.includes(m.assetId);
    return (
      <article key={m.assetId} className={"rv-card" + (chosen ? " is-picked" : "") + (rejected ? " is-rejected" : "")} data-testid="variant-card">
        <div className="rv-media">
          <button type="button" className="rv-thumb" onClick={() => onOpenRecord?.(m.rowId)} aria-label={`${t("Abrir registro")} ${m.title}`}>
            <Thumbnail id={m.assetId} revision={m.revision} alt={m.title} />
          </button>
          {!rejected && (
            <label className="rv-pick" data-tooltip={t("Seleccionar para comparar")}>
              <input type="checkbox" checked={chosen} onChange={() => toggle(m.assetId)} aria-label={`${t("Comparar")} ${m.title}`} />
            </label>
          )}
        </div>
        <div className="rv-info">
          <strong title={m.title}>{m.title}</strong>
          <small>
            {m.databaseName}
            {m.date ? ` · ${m.date}` : ""}
          </small>
          <div className="rv-tags">
            <span className={`variant-match match-${m.match}`}>{t(MATCH_LABEL[m.match])}</span>
            {m.verdict === "same" && m.match !== "confirmed" && <span className="rv-verdict">{t("Confirmada")}</span>}
            {m.verdict === "same" && (
              <select
                className="rv-kind"
                aria-label={`${t("Tipo de relación")} · ${m.title}`}
                value={m.kind ?? ""}
                onChange={(e) => judge(m, "same", (e.target.value || null) as VariantKind | null)}
              >
                <option value="">{t("Tipo…")}</option>
                {VARIANT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(KIND_LABEL[k])}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="rv-actions">
          {!rejected && m.verdict !== "same" && m.match !== "identical" && (
            <Button icon data-testid="variant-confirm" aria-label={`${t("Confirmar")} ${m.title}`} data-tooltip={t("Confirmar: es la misma fotografía")} onClick={() => judge(m, "same")}>
              <Check size={15} />
            </Button>
          )}
          {!rejected && m.match !== "identical" && (
            <Button icon data-testid="variant-reject" aria-label={`${t("Descartar")} ${m.title}`} data-tooltip={t("Descartar: no es la misma fotografía")} onClick={() => judge(m, "different")}>
              <X size={15} />
            </Button>
          )}
          {(rejected || m.verdict === "same") && (
            <Button icon data-testid="variant-undo" aria-label={`${t("Deshacer")} ${m.title}`} data-tooltip={t("Deshacer tu decisión")} onClick={() => judge(m, null)}>
              <Undo2 size={15} />
            </Button>
          )}
        </div>
      </article>
    );
  };
  return (
    <div className="record-variants" data-testid="record-variants">
      <section className="rv-section">
        <header className="rv-head">
          <h3>{t("Variantes de esta fotografía")}</h3>
          <label className="rv-sensitivity">
            {t("Sensibilidad")}
            <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value as Sensitivity)}>
              <option value="strict">{t("Estricta")}</option>
              <option value="balanced">{t("Equilibrada")}</option>
              <option value="broad">{t("Amplia")}</option>
            </select>
          </label>
        </header>
        <p className="hint">
          {t("Las versiones de esta imagen en todas tus bases de datos. Confirma o descarta cada coincidencia: tus decisiones se guardan aparte de la detección automática y también se aplican en la vista Variantes.")}
        </p>
        {error && <p className="error">{t(error)}</p>}
        {work && (
          <div className="rv-work" data-testid="variant-work">
            <Camera size={16} />
            <span>
              <span>
                {t("Obra")}: <strong>{work.title}</strong>
              </span>
              <small>
                {work.databaseName} · {(work.reproductions.length === 1 ? t("1 reproducción enlazada") : t("{n} reproducciones enlazadas")).replace("{n}", work.reproductions.length.toLocaleString())}
              </small>
            </span>
            {!!missing.length && (
              <Button data-testid="variant-work-link" onClick={() => gather(null, work.databaseId)}>
                <Layers size={14} />
                {(missing.length === 1 ? t("Enlazar la que falta") : t("Enlazar las {n} que faltan")).replace("{n}", missing.length.toLocaleString())}
              </Button>
            )}
            <Button onClick={() => onOpenRecord?.(work.workId)}>{t("Abrir obra")}</Button>
          </div>
        )}
        {gathering && (
          <form
            className="rv-gather"
            data-testid="variant-gather-form"
            onSubmit={(e) => {
              e.preventDefault();
              gather(gathering.title, gathering.databaseId || null);
            }}
          >
            <p>
              {(familyRows.length === 1
                ? t("Se creará una ficha de obra para esta fotografía y se enlazará con esta ficha.")
                : t("Se creará una ficha de obra para esta fotografía y se enlazarán con ella las {n} fichas de la familia.")
              ).replace("{n}", familyRows.length.toLocaleString())}{" "}
              {t(worksDbs.length ? "Los datos de la fotografía se escriben una vez, en la obra." : "Irá a una base nueva, «Fotografías», donde los datos de la fotografía se escriben una vez.")}
            </p>
            <label>
              {t("Título de la obra")}
              <input autoFocus required value={gathering.title} onChange={(e) => setGathering({ ...gathering, title: e.target.value })} />
            </label>
            {worksDbs.length > 1 && (
              <label>
                {t("Base de datos")}
                <select value={gathering.databaseId} onChange={(e) => setGathering({ ...gathering, databaseId: e.target.value })}>
                  {worksDbs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <footer>
              <Button type="button" onClick={() => setGathering(null)}>
                {t("Cancelar")}
              </Button>
              <Button primary type="submit" data-testid="variant-gather-apply" disabled={!gathering.title.trim()}>
                <Layers size={14} />
                {t("Reunir en una obra")}
              </Button>
            </footer>
          </form>
        )}
        <div className="rv-group">
          <div className="rv-group-head">
            <h4>{t("Esta imagen")}</h4>
            <div className="rv-toolbar-actions">
              <Button
                data-testid="variants-compare"
                disabled={picked.length < 2}
                data-tooltip={t("Abre las imágenes seleccionadas en la mesa de comparación")}
                onClick={() => onCompare?.(picked)}
              >
                <Columns2 size={14} />
                {t("Comparar")} {picked.length ? `(${picked.length})` : ""}
              </Button>
              <Button data-testid="variants-add" aria-expanded={finding} onClick={() => setFinding(!finding)}>
                <Plus size={14} />
                {t("Añadir a la familia")}
              </Button>
              {!work && (
                <Button
                  data-testid="variants-gather"
                  aria-expanded={!!gathering}
                  data-tooltip={t("Una ficha para la fotografía (fotógrafo, fecha de toma, lugar) con la que se enlazan todas sus versiones")}
                  onClick={() => (gathering ? setGathering(null) : startGathering())}
                >
                  <Layers size={14} />
                  {t("Reunir en una obra")}
                </Button>
              )}
            </div>
          </div>
          <div className="rv-cards">
            <article className={"rv-card rv-self" + (picked.includes(image.id) ? " is-picked" : "")}>
              <div className="rv-media">
                <Thumbnail id={image.id} revision={image.revision} alt={row.title} />
                <label className="rv-pick" data-tooltip={t("Seleccionar para comparar")}>
                  <input type="checkbox" checked={picked.includes(image.id)} onChange={() => toggle(image.id)} aria-label={t("Comparar esta imagen")} />
                </label>
              </div>
              <div className="rv-info">
                <strong title={row.title}>{row.title}</strong>
                <small>{row.databaseName}</small>
                <div className="rv-tags">
                  <span className="variant-match match-self">{t("Esta ficha")}</span>
                </div>
              </div>
            </article>
          </div>
        </div>
        {finding && (
          <div className="rv-find">
            <label className="rv-search">
              <Search size={14} />
              <input
                autoFocus
                value={query}
                placeholder={t("Busca el registro de la otra versión…")}
                aria-label={t("Buscar registro para añadir a la familia")}
                onChange={(e) => void find(e.target.value).catch(() => {})}
              />
            </label>
            <div className="rv-found">
              {found.flatMap((r) =>
                r.images
                  .filter((img) => !members.some((m) => m.assetId === img.id))
                  .slice(0, 3)
                  .map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      className="rv-found-item"
                      data-testid="variant-candidate"
                      onClick={() =>
                        void perform(async () => {
                          await window.imago.call("variantVerdict", { assetId: image.id, otherAssetId: img.id, verdict: "same", kind: null });
                          setFinding(false);
                          setQuery("");
                          setFound([]);
                          reload();
                        })
                      }
                    >
                      <Thumbnail id={img.id} revision={img.revision} alt={r.title} />
                      <span>
                        <strong>{r.title}</strong>
                        <small>{r.databaseName}</small>
                      </span>
                      <Plus size={14} />
                    </button>
                  )),
              )}
              {query.trim().length >= 2 && !found.length && <p className="hint">{t("Ningún registro con imagen coincide.")}</p>}
            </div>
          </div>
        )}
        {variants && !members.length && <p className="hint rv-empty">{t("No se han encontrado otras versiones de esta imagen.")}</p>}
        {GROUPS.map((g) => {
          const list = members.filter(g.keep);
          return list.length ? (
            <div key={g.key} className="rv-group" data-testid={`variant-group-${g.key}`}>
              <div className="rv-group-head">
                <h4>
                  {t(g.title)} <span>{list.length}</span>
                </h4>
              </div>
              <div className="rv-cards">{list.map((m) => card(m))}</div>
            </div>
          ) : null;
        })}
        {!!variants?.rejected.length && (
          <details className="rv-group rv-rejected" data-testid="variant-group-rejected">
            <summary>
              {t("Descartadas por ti")} <span>{variants.rejected.length}</span>
            </summary>
            <div className="rv-cards">{variants.rejected.map((m) => card(m, true))}</div>
          </details>
        )}
      </section>
      <section className="rv-section" data-testid="appearances">
        <header className="rv-head">
          <h3>
            <BookOpen size={16} /> {t("Obras en las que aparece")}
          </h3>
          <Button data-testid="appearance-add" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            <Plus size={14} />
            {t("Añadir aparición")}
          </Button>
        </header>
        <p className="hint">
          {t("Cada registro de la familia es una aparición, y una por cada fuente con la que esté enlazado; la página, la figura y el pie de foto salen del vínculo o de sus propiedades. Añade a mano las reproducciones que no tengas en tus bases de datos.")}
        </p>
        {draft && (
          <form
            className="rv-draft"
            data-testid="appearance-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveDraft();
            }}
          >
            <label className="wide">
              {t("Obra")}
              <input required autoFocus value={draft.work} onChange={(e) => setDraft({ ...draft, work: e.target.value })} placeholder={t("Libro, revista, álbum…")} />
            </label>
            <label>
              {t("Autor")}
              <input value={draft.author} onChange={(e) => setDraft({ ...draft, author: e.target.value })} />
            </label>
            <label>
              {t("Año")}
              <input inputMode="numeric" value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} />
            </label>
            <label>
              {t("Página")}
              <input value={draft.page} onChange={(e) => setDraft({ ...draft, page: e.target.value })} />
            </label>
            <label className="wide">
              {t("Pie de foto original")}
              <textarea rows={2} value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} />
            </label>
            <label className="wide">
              {t("Nota")}
              <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </label>
            <footer>
              <Button type="button" onClick={() => setDraft(null)}>
                {t("Cancelar")}
              </Button>
              <Button primary type="submit" disabled={!draft.work.trim()}>
                {t("Guardar")}
              </Button>
            </footer>
          </form>
        )}
        {appearances && (
          <table className="rv-appearances">
            <thead>
              <tr>
                <th>{t("Año")}</th>
                <th>{t("Obra")}</th>
                <th>{t("Página")}</th>
                <th>{t("Pie de foto")}</th>
                <th>{t("Registro")}</th>
              </tr>
            </thead>
            <tbody>
              {appearances.map((a) => (
                <tr key={(a.manual ? "m:" : "r:") + a.id} className={a.match === "self" ? "is-self" : ""} data-testid="appearance-row">
                  <td className="rv-year">{a.year ?? a.date ?? "—"}</td>
                  <td>
                    <strong>{a.work ?? "—"}</strong>
                    {a.workDetail && <small>{a.workDetail}</small>}
                  </td>
                  <td>{[a.page, a.figure ? `fig. ${a.figure}` : ""].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="rv-caption">{a.caption ?? (a.manual ? "—" : a.title)}</td>
                  <td className="rv-record">
                    {a.manual ? (
                      <span className="rv-manual">
                        <span>{t("Añadida a mano")}</span>
                        <Button
                          icon
                          aria-label={`${t("Editar")} ${a.work}`}
                          onClick={() =>
                            setDraft({
                              id: a.id,
                              work: a.work ?? "",
                              author: a.author ?? "",
                              year: a.year ? String(a.year) : "",
                              page: a.page ?? "",
                              caption: a.caption ?? "",
                              note: a.note ?? "",
                            })
                          }
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          icon
                          data-testid="appearance-delete"
                          aria-label={`${t("Eliminar")} ${a.work}`}
                          onClick={() =>
                            window.confirm(t("¿Eliminar esta aparición añadida a mano?")) &&
                            void perform(async () => {
                              await window.imago.call("appearanceDelete", { id: a.id });
                              reload();
                            })
                          }
                        >
                          <Trash2 size={13} />
                        </Button>
                      </span>
                    ) : a.match === "self" ? (
                      <span className="rv-self-label">{t("Esta ficha")}</span>
                    ) : (
                      <button type="button" className="text-link" onClick={() => a.rowId && onOpenRecord?.(a.rowId)}>
                        {a.title} ↗
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!!databaseIds.length && (
          <details className="rv-fields" data-testid="appearance-fields">
            <summary>
              <Settings2 size={13} /> {t("Qué propiedades dan la obra, la página y el pie de foto")}
            </summary>
            {databaseIds.map((id) => {
              const info = columns[id],
                used = appearances?.find((a) => a.databaseId === id)?.fields;
              if (!info) return null;
              const options = info.columns.filter((c) => !["attachment", "files", "ai"].includes(c.type));
              return (
                <div key={id} className="rv-fields-db">
                  <strong>{info.name}</strong>
                  {(["work", "page", "caption"] as const).map((part) => {
                    const chosen = fields[id]?.[part];
                    const detected = options.find((c) => c.id === used?.[part]);
                    return (
                      <label key={part}>
                        {t(part === "work" ? "Obra" : part === "page" ? "Página" : "Pie de foto")}
                        <select
                          data-testid={`appearance-field-${part}`}
                          value={chosen === undefined ? "auto" : chosen === null ? "none" : chosen}
                          onChange={(e) => saveFields(id, part, e.target.value)}
                        >
                          <option value="auto">
                            {t("Detectada")}: {detected ? detected.name : t("ninguna")}
                          </option>
                          <option value="none">{t("Ninguna")}</option>
                          {options.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </details>
        )}
      </section>
      {circulation && (
        <CirculationSection
          circulation={circulation}
          image={image}
          row={row}
          perform={perform}
          onOpenRecord={onOpenRecord}
          onChanged={reload}
        />
      )}
    </div>
  );
}

const KIND_SHORT: Record<VariantKind, string> = KIND_LABEL;

/**
 * «Circulación»: the taking and every use of the photograph in date order,
 * with when the work printed it and when the copy was made, the part of the
 * image each one keeps, a caption that changes, and «Procede de».
 */
function CirculationSection({
  circulation,
  image,
  row,
  perform,
  onOpenRecord,
  onChanged,
}: {
  circulation: ImageCirculation;
  image: ImageAsset;
  row: RecordRow;
  perform: Perform;
  onOpenRecord?: (rowId: string) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const { capture, entries } = circulation;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const first = circulation.firstPublication ? byId.get(circulation.firstPublication) : null;
  const label = (e: CirculationEntry) => [e.work ?? e.title ?? t("Sin obra"), e.publicationYear ?? e.copyYear].filter(Boolean).join(" · ");
  const setOrigin = (e: CirculationEntry, source: CirculationEntry | null) =>
    e.assetId &&
    void perform(async () => {
      await window.imago.call("imageOrigin", { assetId: e.assetId!, sourceAssetId: source?.assetId ?? null });
      onChanged();
    });
  const exportCsv = () =>
    void perform(async () => {
      const yes = t("sí");
      const header = [
        t("Momento"),
        t("Año"),
        t("Fecha de la copia"),
        t("Obra"),
        t("Página"),
        t("Figura o lámina"),
        t("Pie de foto"),
        t("Nota"),
        t("Registro"),
        t("Base de datos"),
        t("Relación con esta imagen"),
        t("Parte conservada"),
        t("Procede de"),
        t("Primera publicación"),
        t("El pie cambia"),
        t("Pie anterior"),
      ];
      const rows: string[][] = [
        // The taking: its date, the photographer and place, and where they come from.
        [t("Toma"), String(capture.year ?? ""), capture.date ?? "", capture.workTitle ?? "", "", "", "", [capture.photographer, capture.place].filter(Boolean).join(" · "), capture.workTitle ? "" : row.title, "", "", "", "", "", "", ""],
        ...entries.map((e) => [
          t(e.publicationYear !== null ? "Publicación" : "Copia"),
          String(e.publicationYear ?? e.copyYear ?? ""),
          e.copyDate ?? String(e.copyYear ?? ""),
          e.work ?? "",
          e.page ?? "",
          e.figure ?? "",
          e.caption ?? "",
          e.note ?? "",
          e.manual ? t("Añadida a mano") : (e.title ?? ""),
          e.databaseName ?? "",
          e.match === "self" ? t("Esta ficha") : e.kind ? t(KIND_SHORT[e.kind]) : e.match ? t(MATCH_LABEL[e.match]) : "",
          e.crop ? `${Math.round(e.crop.kept * 100)} %` : "",
          e.parent ? label(byId.get(e.parent)!) : "",
          e.id === circulation.firstPublication ? yes : "",
          e.captionChanged ? yes : "",
          e.previousCaption ?? "",
        ]),
      ];
      const file = await window.imago.call("saveCsv", { fileName: `${t("Circulación")} - ${row.title}`, text: tableToCsv(header, rows) });
      if (file) onChanged();
    });
  /** The image on screen with the part a use keeps, or the use with the part the image on screen keeps. */
  const cropView = (e: CirculationEntry) => {
    if (!e.crop) return null;
    const wider = e.crop.of === "other" ? { id: image.id, revision: image.revision } : { id: e.assetId!, revision: e.revision };
    const r = e.crop.rect;
    return (
      <figure className="circ-crop" data-testid="circulation-crop" data-tooltip={t(e.crop.of === "other" ? "La parte de la imagen en pantalla que conserva este uso" : "La parte de este uso que conserva la imagen en pantalla")}>
        <span className="circ-crop-frame">
          <img src={`imago://asset/${wider.id}/thumb${wider.revision ? "?v=" + encodeURIComponent(wider.revision) : ""}`} alt="" />
          <i style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
        </span>
        <figcaption>
          {(e.crop.of === "other" ? t("Conserva el {n} % de la imagen en pantalla") : t("La imagen en pantalla conserva el {n} % de esta")).replace("{n}", String(Math.round(e.crop.kept * 100)))}
        </figcaption>
      </figure>
    );
  };
  return (
    <section className="rv-section rv-circulation" data-testid="circulation">
      <header className="rv-head">
        <h3>
          <Route size={16} /> {t("Circulación")}
        </h3>
        <Button data-testid="circulation-export" onClick={exportCsv}>
          <Download size={14} />
          {t("Exportar CSV")}
        </Button>
      </header>
      <p className="hint">{t("De la toma a cada publicación, en orden de fecha: cuándo la imprimió cada obra, cuándo se hizo cada copia, qué parte de la imagen conserva y con qué pie se publicó.")}</p>
      <div className="circ-facts">
        {first && (
          <span className="circ-fact" data-testid="circulation-first">
            <b>{t("Primera publicación conocida")}</b> {first.publicationYear} · {first.work}
          </span>
        )}
        {circulation.gapYears !== null && circulation.gapYears >= 0 && (
          <span className="circ-fact">
            <b>{circulation.gapYears}</b> {t(circulation.gapYears === 1 ? "año entre la toma y la primera publicación" : "años entre la toma y la primera publicación")}
          </span>
        )}
        <span className="circ-fact">
          <b>{entries.length}</b> {t(entries.length === 1 ? "uso" : "usos")}
        </span>
        {circulation.captions > 1 && (
          <span className="circ-fact">
            <b>{circulation.captions}</b> {t("pies distintos")}
          </span>
        )}
      </div>
      <ol className="circ-timeline">
        <li className="circ-item circ-capture" data-testid="circulation-capture">
          <span className="circ-when">
            <strong>{capture.year ?? "—"}</strong>
            <small>{t("Toma")}</small>
          </span>
          <div className="circ-card">
            <div className="circ-main">
              <strong>
                <Camera size={14} /> {capture.date ?? t("Fecha de toma desconocida")}
              </strong>
              {(capture.photographer || capture.place) && <span>{[capture.photographer, capture.place].filter(Boolean).join(" · ")}</span>}
              <small>
                {capture.from === "work"
                  ? t("De la obra fotográfica «{title}»").replace("{title}", capture.workTitle ?? "")
                  : t("De esta ficha: reúne las versiones en una obra para fijar la fecha de toma")}
              </small>
            </div>
            {capture.workId && (
              <button type="button" className="text-link" onClick={() => onOpenRecord?.(capture.workId!)}>
                {t("Abrir obra")} ↗
              </button>
            )}
          </div>
        </li>
        {entries.map((e, i) => {
          const earlier = entries.slice(0, i).filter((x) => x.assetId && x.contentHash !== e.contentHash);
          const suggested = !e.parent && e.suggestedParent ? byId.get(e.suggestedParent) : null;
          return (
            <li
              key={e.id}
              className={"circ-item" + (e.match === "self" ? " is-self" : "") + (e.id === circulation.firstPublication ? " is-first" : "")}
              style={{ ["--depth" as string]: e.depth }}
              data-testid="circulation-entry"
            >
              <span className="circ-when">
                <strong>{e.publicationYear ?? e.copyYear ?? "—"}</strong>
                {e.publicationYear !== null && e.copyYear !== null && e.copyYear !== e.publicationYear && (
                  <small>
                    {t("copia")} {e.copyDate ?? e.copyYear}
                  </small>
                )}
                {e.publicationYear === null && e.copyYear !== null && <small>{t("copia")}</small>}
              </span>
              <div className="circ-card">
                {e.assetId ? (
                  <button type="button" className="circ-thumb" onClick={() => e.rowId && onOpenRecord?.(e.rowId)} aria-label={`${t("Abrir registro")} ${e.title ?? ""}`}>
                    <Thumbnail id={e.assetId} revision={e.revision} alt={e.title ?? ""} />
                  </button>
                ) : (
                  <span className="circ-thumb circ-thumb-empty">
                    <BookOpen size={18} />
                  </span>
                )}
                <div className="circ-main">
                  {e.parent && byId.get(e.parent) && (
                    <small className="circ-branch">
                      ↳ {t("Procede de")} {label(byId.get(e.parent)!)}
                    </small>
                  )}
                  <strong>{e.work ?? t("Sin obra")}</strong>
                  {(e.workDetail || e.page || e.figure) && (
                    <small>{[e.workDetail, e.page ? `p. ${e.page}` : "", e.figure ? `fig. ${e.figure}` : ""].filter(Boolean).join(" · ")}</small>
                  )}
                  {e.caption && (
                    <p className="circ-caption">
                      «{e.caption}»
                      {e.captionChanged && (
                        <span className="circ-changed" data-testid="circulation-caption-changed" data-tooltip={`${t("Pie anterior")}: «${e.previousCaption}»`}>
                          {t("El pie cambia")}
                        </span>
                      )}
                    </p>
                  )}
                  {e.captionChanged && e.previousCaption && <small className="circ-previous">{t("Antes")}: «{e.previousCaption}»</small>}
                  <div className="rv-tags">
                    {e.id === circulation.firstPublication && <span className="circ-tag is-first">{t("Primera publicación conocida")}</span>}
                    {e.match === "self" ? (
                      <span className="variant-match match-self">{t("Esta ficha")}</span>
                    ) : e.kind ? (
                      <span className="variant-match match-confirmed">{t(KIND_SHORT[e.kind])}</span>
                    ) : e.match ? (
                      <span className={`variant-match match-${e.match}`}>{t(MATCH_LABEL[e.match])}</span>
                    ) : (
                      <span className="rv-manual">{t("Añadida a mano")}</span>
                    )}
                  </div>
                  {e.assetId && earlier.length > 0 && (
                    <label className="circ-origin">
                      {t("Procede de")}
                      <select
                        value={e.parent ?? ""}
                        data-testid="circulation-origin"
                        onChange={(ev) => setOrigin(e, byId.get(ev.target.value) ?? null)}
                      >
                        <option value="">{t("Sin indicar")}</option>
                        {earlier.map((x) => (
                          <option key={x.id} value={x.id}>
                            {label(x)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {suggested && (
                    <p className="circ-suggest" data-testid="circulation-suggestion">
                      {t("¿Procede de «{work}»? Es un recorte de esa imagen.").replace("{work}", label(suggested))}
                      <Button onClick={() => setOrigin(e, suggested)}>{t("Sí")}</Button>
                    </p>
                  )}
                </div>
                {cropView(e)}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

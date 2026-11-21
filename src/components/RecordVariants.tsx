// «Variantes y apariciones», a tab of the record panel: the versions of the
// image on screen across every database, which the researcher confirms,
// rejects, names and compares, and the works in which the photograph appears,
// from the records of its family and from reproductions added by hand.
import { useEffect, useState } from "react";
import { BookOpen, Check, Columns2, Pencil, Plus, Search, Settings2, Trash2, Undo2, X } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { ImageAsset, RecordRow } from "../../shared/imago";
import type {
  AppearanceFields,
  ImageAppearance,
  ImageVariantMember,
  ImageVariants,
  Sensitivity,
  VariantKind,
  VariantVerdict,
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
}: {
  row: RecordRow;
  /** The image the panel is on. */
  image: ImageAsset | undefined;
  perform: Perform;
  onOpenRecord?: (rowId: string) => void;
  onCompare?: (assetIds: string[]) => void;
  /** How many versions were found, for the tab's label. */
  onCount?: (count: number) => void;
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
    [found, setFound] = useState<RecordRow[]>([]);
  const imageId = image?.id;
  const fieldsKey = JSON.stringify(fields);
  useEffect(() => {
    if (!imageId) return;
    let cancelled = false;
    setError(null);
    void Promise.all([
      window.imago.call("imageVariants", { assetId: imageId, sensitivity }),
      window.imago.call("imageAppearances", { assetId: imageId, sensitivity, fields: JSON.parse(fieldsKey) }),
    ])
      .then(([v, a]) => {
        if (cancelled) return;
        setVariants(v);
        setAppearances(a);
        onCount?.(v.members.length);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, sensitivity, fieldsKey, revision]);
  useEffect(() => setPicked([]), [imageId]);
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
          {t("Cada registro de la familia es una aparición; la obra, la página y el pie de foto salen de sus propiedades. Añade a mano las reproducciones que no tengas en tus bases de datos.")}
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
                  <td>{a.page ?? "—"}</td>
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
    </div>
  );
}

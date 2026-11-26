// Relations between databases: turning a property that names records (a book
// id, a title) into a relation, bringing a property of the related records
// into this database, showing a relation in both databases, and the records
// linked with a record, shown in its panel (a book's photographs).
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Link2, Loader2, Pencil, Unlink } from "lucide-react";
import { LINK_FIELD_LABELS, LINK_FIELDS, LINK_ROLLUP_TARGETS, cleanLinkDetails, linkPlace, relationHasPlace, type DatabaseColumn, type DatabaseDetail, type LinkDetails } from "../../shared/databases";
import type { RecordRow } from "../../shared/imago";
import { useT } from "../i18n";
import { Button, Modal, Thumbnail } from "./ui";
import type { Perform } from "./Properties";

const KIND_LABELS: Partial<Record<NonNullable<DatabaseDetail["database"]["kind"]>, string>> = {
  sources: "Fuentes",
  works: "Obras fotográficas",
  people: "Personas",
  events: "Acontecimientos",
};
type Preview = Awaited<ReturnType<typeof window.imago.call<"convertToRelation">>>;
const MATCHABLE = new Set(["title", "text", "select", "multi_select", "status", "number", "url", "unique_id", "formula"]);

/** «Convertir en relación»: values matched to records of another database. */
export function ConvertRelationDialog({
  column,
  detail,
  details,
  perform,
  onDone,
  onClose,
}: {
  column: DatabaseColumn;
  detail: DatabaseDetail;
  details: DatabaseDetail[];
  perform: Perform;
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const others = details.filter((d) => d.database.id !== detail.database.id);
  const [target, setTarget] = useState(
    () => (others.find((d) => d.database.kind === "sources") ?? others[0])?.database.id ?? "",
  );
  const [match, setMatch] = useState<string | null>(null),
    [auto, setAuto] = useState(true),
    [keepCopy, setKeepCopy] = useState(true),
    [createMissing, setCreateMissing] = useState(false),
    [twoWay, setTwoWay] = useState(true),
    [inverseName, setInverseName] = useState(detail.database.name),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const targetDetail = details.find((d) => d.database.id === target) ?? null;
  const candidates = useMemo(
    () => (targetDetail?.columns ?? []).filter((c) => MATCHABLE.has(c.type)),
    [targetDetail],
  );
  // The target property that matches most values, found by trying each one.
  useEffect(() => {
    if (!target || !auto) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      let best: { id: string | null; preview: Preview } | null = null;
      for (const c of candidates.slice(0, 12)) {
        const id = c.type === "title" ? null : c.id;
        const p = await window.imago.call("convertToRelation", { id: column.id, targetDatabaseId: target, matchColumnId: id, apply: false });
        if (cancelled) return;
        if (!best || p.linked > best.preview.linked) best = { id, preview: p };
      }
      if (cancelled) return;
      setMatch(best?.id ?? null);
      setPreview(best?.preview ?? null);
      setBusy(false);
    })().catch((e) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [target, auto, candidates, column.id]);
  const choose = (id: string | null) => {
    setAuto(false);
    setMatch(id);
    setBusy(true);
    void window.imago
      .call("convertToRelation", { id: column.id, targetDatabaseId: target, matchColumnId: id, apply: false })
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const [applying, setApplying] = useState(false);
  const apply = () =>
    void perform(async () => {
      setApplying(true);
      await window.imago.call("convertToRelation", {
        id: column.id,
        targetDatabaseId: target,
        matchColumnId: match,
        keepCopy,
        createMissing,
        inverseName: twoWay ? inverseName.trim() || detail.database.name : null,
        apply: true,
      });
      onDone();
      onClose();
    }).finally(() => setApplying(false));
  const targetName = targetDetail?.database.name ?? "";
  return (
    <Modal icon={Link2} title={t("Convertir en relación")} onClose={onClose}>
      <form
        className="modal-body relation-form"
        data-testid="convert-relation"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <p className="hint">
          {t("Cada valor de «{name}» se enlaza con el registro de la otra base que tenga el mismo valor. Mayúsculas, acentos de anchura y espacios de más no cuentan.").replace("{name}", column.name)}
        </p>
        <div className="relation-form-grid">
          <label>
            {t("Base de datos relacionada")}
            <select
              value={target}
              data-testid="convert-target"
              onChange={(e) => {
                setTarget(e.target.value);
                setAuto(true);
              }}
            >
              {others.map((d) => (
                <option key={d.database.id} value={d.database.id}>
                  {d.database.name}
                  {d.database.kind && KIND_LABELS[d.database.kind] ? ` · ${t(KIND_LABELS[d.database.kind]!)}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Propiedad con los mismos valores")}
            <select value={match ?? "__title__"} data-testid="convert-match" onChange={(e) => choose(e.target.value === "__title__" ? null : e.target.value)}>
              {candidates.map((c) => (
                <option key={c.id} value={c.type === "title" ? "__title__" : c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="relation-preview" aria-live="polite" data-testid="convert-preview">
          {busy ? (
            <p className="hint">
              <Loader2 size={13} className="spin" /> {t(auto ? "Buscando la propiedad que coincide…" : "Comprobando coincidencias…")}
            </p>
          ) : preview ? (
            <>
              <p>
                <strong>{preview.linked.toLocaleString()}</strong> {t("de")} {preview.total.toLocaleString()}{" "}
                {t("registros con valor se enlazarán.")}
                {!!preview.ambiguous &&
                  ` ${(preview.ambiguous === 1 ? t("1 valor casa con varios registros: se usa el primero.") : t("{n} valores casan con varios registros: se usa el primero.")).replace("{n}", preview.ambiguous.toLocaleString())}`}
              </p>
              {!!preview.unmatched.length && (
                <details>
                  <summary>
                    {(preview.unmatched.length === 1 ? t("1 valor sin registro en «{db}»") : t("{n} valores sin registro en «{db}»"))
                      .replace("{n}", preview.unmatched.length.toLocaleString())
                      .replace("{db}", targetName)}
                    {preview.unmatchedRows
                      ? ` · ${preview.unmatchedRows.toLocaleString()} ${t(preview.unmatchedRows === 1 ? "registro sin enlazar" : "registros sin enlazar")}`
                      : ""}
                  </summary>
                  <ul className="relation-unmatched">
                    {preview.unmatched.map((u) => (
                      <li key={u.value}>
                        <span>{u.value}</span>
                        <small>{u.rows}</small>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : null}
          {error && <p className="error">{t(error)}</p>}
        </div>
        <fieldset className="relation-options">
          <label className="check-label">
            <input type="checkbox" checked={keepCopy} onChange={(e) => setKeepCopy(e.target.checked)} />
            {t("Conservar los valores originales en una copia de la propiedad")}
          </label>
          <label className="check-label">
            <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
            {t("Crear en «{db}» los registros que falten").replace("{db}", targetName)}
          </label>
          <label className="check-label">
            <input type="checkbox" checked={twoWay} onChange={(e) => setTwoWay(e.target.checked)} />
            {t("Mostrar también en «{db}» como").replace("{db}", targetName)}
            <input
              className="relation-inline-name"
              value={inverseName}
              disabled={!twoWay}
              aria-label={t("Nombre de la propiedad en la otra base")}
              onChange={(e) => setInverseName(e.target.value)}
            />
          </label>
        </fieldset>
        <p className="hint">{t("Las vistas guardadas que filtraban por esta propiedad pasan a filtrar por los registros enlazados.")}</p>
        <footer className="modal-actions">
          <Button type="button" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button primary type="submit" data-testid="convert-apply" disabled={busy || applying || !preview || !target}>
            {applying && <Loader2 size={14} className="spin" />}
            {t(applying ? "Convirtiendo…" : "Convertir")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

/** «Traer una propiedad»: a rollup that shows a property of the related records. */
export function LookupDialog({
  relation,
  details,
  perform,
  onDone,
  onClose,
}: {
  relation: DatabaseColumn;
  details: DatabaseDetail[];
  perform: Perform;
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const target = details.find((d) => d.database.id === relation.config.relationTargetDatabaseId) ?? null;
  const own = details.find((d) => d.database.id === relation.databaseId) ?? null;
  // What each link records comes first when the relation has it.
  const place = relationHasPlace(relation, own?.database.kind, target?.database.kind);
  const linkOptions = LINK_FIELDS.filter((f) => place || f === "note").map((f) => ({
    id: LINK_ROLLUP_TARGETS[f],
    name: t(LINK_FIELD_LABELS[f]),
    linkField: true,
  }));
  const options = [
    ...linkOptions,
    ...(target?.columns ?? [])
      .filter((c) => !["attachment", "files", "relation", "button", "ai_image", "rollup"].includes(c.type))
      .map((c) => ({ id: c.id, name: c.name, linkField: false, title: c.type === "title" })),
  ];
  const [picked, setPicked] = useState(
    (target?.columns ?? []).find((c) => !["title", "attachment", "files", "relation", "button", "ai_image", "rollup"].includes(c.type))?.id ?? options[0]?.id ?? "",
  );
  const chosen = options.find((c) => c.id === picked);
  return (
    <Modal icon={ArrowLeftRight} title={t("Traer una propiedad de «{db}»").replace("{db}", target?.database.name ?? "")} onClose={onClose}>
      <form
        className="modal-body relation-form"
        data-testid="lookup-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!chosen) return;
          void perform(async () => {
            await window.imago.call("addColumn", {
              databaseId: relation.databaseId,
              name: `${chosen.name} (${relation.name})`,
              type: "rollup",
              config: {
                rollupRelationColumnId: relation.id,
                rollupTargetColumnId: "title" in chosen && chosen.title ? "__title__" : chosen.id,
                // One value per link, in the links' order.
                rollupFunction: chosen.linkField ? "show" : "show_unique",
              },
            });
            onDone();
            onClose();
          });
        }}
      >
        <p className="hint">
          {t("Una propiedad calculada que muestra, en cada registro, el valor de los registros enlazados por «{name}». No copia datos: se actualiza sola y se puede filtrar, ordenar y contar.").replace("{name}", relation.name)}
        </p>
        <label>
          {t("Propiedad")}
          <select value={picked} data-testid="lookup-property" onChange={(e) => setPicked(e.target.value)}>
            {!!linkOptions.length && (
              <optgroup label={t("De cada vínculo")}>
                {linkOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={t("De «{db}»").replace("{db}", target?.database.name ?? "")}>
              {options
                .filter((c) => !c.linkField)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
        <footer className="modal-actions">
          <Button type="button" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button primary type="submit" data-testid="lookup-apply" disabled={!chosen}>
            {t("Añadir propiedad")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

/** In the property editor: whether a relation also shows in the other database. */
export function RelationPairing({
  column,
  databaseName,
  databaseKind,
  perform,
  onChanged,
}: {
  column: DatabaseColumn;
  /** This database's name: the twin's default name. */
  databaseName: string;
  databaseKind?: DatabaseDetail["database"]["kind"];
  perform: Perform;
  onChanged: () => void;
}) {
  const t = useT();
  const targetId = column.config.relationTargetDatabaseId as string | undefined;
  const [target, setTarget] = useState<DatabaseDetail | null>(null),
    [name, setName] = useState(databaseName),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    void window.imago
      .call("detail", { id: targetId })
      .then((d) => !cancelled && setTarget(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [targetId, revision]);
  if (!target) return null;
  const twin = target.columns.find((c) => c.id === column.config.relationInverseColumnId) ?? null;
  const done = () => {
    setRevision((n) => n + 1);
    onChanged();
  };
  const place = relationHasPlace(column, databaseKind, target.database.kind);
  return (
    <div className="relation-pairing" data-testid="relation-pairing">
      <label className="check-label">
        <input
          type="checkbox"
          data-testid="relation-place"
          checked={place}
          onChange={(e) =>
            void perform(async () => {
              await window.imago.call("setRelationPlace", { columnId: column.id, place: e.target.checked });
              done();
            })
          }
        />
        {t("Cada vínculo guarda la página, la figura y el pie de foto")}
      </label>
      {twin ? (
        <>
          <p>
            <ArrowLeftRight size={14} />
            <span>{t("También se ve en «{db}» como «{name}».").replace("{db}", target.database.name).replace("{name}", twin.name)}</span>
          </p>
          <Button
            type="button"
            data-testid="relation-unpair"
            onClick={() =>
              void perform(async () => {
                await window.imago.call("unpairRelation", { columnId: column.id });
                done();
              })
            }
          >
            <Unlink size={14} />
            {t("Dejar de sincronizar las dos propiedades")}
          </Button>
        </>
      ) : (
        <>
          <p>
            <span>{t("Esta relación solo se ve aquí. Puedes mostrarla también en «{db}», con los enlaces que ya tiene.").replace("{db}", target.database.name)}</span>
          </p>
          <div className="relation-pairing-row">
            <input value={name} aria-label={t("Nombre de la propiedad en la otra base")} onChange={(e) => setName(e.target.value)} />
            <Button
              type="button"
              data-testid="relation-pair"
              onClick={() =>
                void perform(async () => {
                  await window.imago.call("pairRelation", { columnId: column.id, name });
                  done();
                })
              }
            >
              <ArrowLeftRight size={14} />
              {t("Mostrar también en «{db}»").replace("{db}", target.database.name)}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** «p. 12 · fig. 3 · “caption”»: what a link records, in one line. */
export function linkSummary(details: LinkDetails | null | undefined) {
  return [linkPlace(details), details?.caption ? `«${details.caption}»` : "", details?.note ?? ""].filter(Boolean).join(" · ");
}

/**
 * Where a linked record shows this one (page, figure, caption) and a note:
 * a small form under the link. Page, figure and caption only where they
 * apply (links to or from Sources, or turned on for the relation).
 */
export function LinkDetailsForm({
  rowId,
  columnId,
  targetId,
  details,
  place,
  perform,
  onDone,
}: {
  /** The record holding the relation, the relation and the linked record. */
  rowId: string;
  columnId: string;
  targetId: string;
  details: LinkDetails | null | undefined;
  place: boolean;
  perform: Perform;
  onDone: (saved: boolean) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<LinkDetails>({ ...details });
  const field = (key: keyof LinkDetails, label: string, wide = false, long = false) => (
    <label className={wide ? "wide" : undefined}>
      {t(label)}
      {long ? (
        <textarea rows={2} value={draft[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      ) : (
        <input value={draft[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      )}
    </label>
  );
  return (
    <form
      className="link-details-form"
      data-testid="link-details-form"
      onSubmit={(e) => {
        e.preventDefault();
        void perform(async () => {
          await window.imago.call("setLinkDetails", { rowId, columnId, targetId, details: cleanLinkDetails(draft) });
          onDone(true);
        });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone(false);
        }
      }}
    >
      {place && field("page", "Página")}
      {place && field("figure", "Figura o lámina")}
      {place && field("caption", "Pie de foto", true, true)}
      {field("note", "Nota", true)}
      <footer>
        <Button type="button" onClick={() => onDone(false)}>
          {t("Cancelar")}
        </Button>
        <Button primary type="submit" data-testid="link-details-save">
          {t("Guardar")}
        </Button>
      </footer>
    </form>
  );
}

type LinkedGroup = Awaited<ReturnType<typeof window.imago.call<"linkedRecords">>>[number];

/** The records linked with a record: their images when they have them (a book's photographs). */
export function LinkedRecords({
  row,
  onOpenRecord,
  perform,
}: {
  row: RecordRow;
  onOpenRecord?: (rowId: string) => void;
  /** Without it the details of each link are shown but not edited. */
  perform?: Perform;
}) {
  const t = useT();
  const [groups, setGroups] = useState<LinkedGroup[]>([]),
    [editing, setEditing] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void window.imago
      .call("linkedRecords", { rowId: row.id })
      .then((g) => !cancelled && setGroups(g))
      .catch(() => !cancelled && setGroups([]));
    return () => {
      cancelled = true;
    };
  }, [row.id, row.updatedAt, revision]);
  if (!groups.length) return null;
  return (
    <section className="linked-records" data-testid="linked-records">
      <h3>{t("Registros enlazados")}</h3>
      {groups.map((g) => {
        const withImages = g.rows.some((r) => r.images.length);
        const key = (r: RecordRow) => `${g.columnId}:${g.direction}:${r.id}`;
        const edit = (r: RecordRow) =>
          perform && (
            <Button
              icon
              className="linked-edit"
              data-testid="linked-edit"
              aria-label={`${t(g.place ? "Página, pie y nota de" : "Nota de")} ${r.title}`}
              data-tooltip={t(g.place ? "Página, figura, pie de foto y nota de este vínculo" : "Nota de este vínculo")}
              onClick={() => setEditing(editing === key(r) ? null : key(r))}
            >
              <Pencil size={12} />
            </Button>
          );
        const form = g.rows.find((r) => key(r) === editing);
        return (
          <div key={g.columnId + g.direction} className="linked-group" data-testid="linked-group">
            <h4>
              {g.name}
              <small>
                {g.databaseName && g.databaseName !== g.name ? `${g.databaseName} · ` : ""}
                {g.total.toLocaleString()}
              </small>
            </h4>
            {withImages ? (
              <div className="linked-grid">
                {g.rows.slice(0, 60).map((r) => (
                  <div key={r.id} className="linked-tile-wrap">
                    <button type="button" className="linked-tile" onClick={() => onOpenRecord?.(r.id)} aria-label={`${t("Abrir registro")} ${r.title}`} data-tooltip={r.title}>
                      <Thumbnail id={r.images[0]?.id} revision={r.images[0]?.revision} alt={r.title} />
                      <small>{r.title}</small>
                      {linkPlace(g.details[r.id]) && <small className="linked-place">{linkPlace(g.details[r.id])}</small>}
                    </button>
                    {edit(r)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="linked-chips">
                {g.rows.slice(0, 60).map((r) => (
                  <span key={r.id} className="linked-chip-wrap">
                    <button type="button" className="linked-chip" onClick={() => onOpenRecord?.(r.id)}>
                      {r.title}
                      {linkPlace(g.details[r.id]) && <small className="linked-place"> · {linkPlace(g.details[r.id])}</small>}
                    </button>
                    {edit(r)}
                  </span>
                ))}
              </div>
            )}
            {form && perform && (
              <div className="linked-form">
                <p className="hint">
                  <strong>{form.title}</strong>
                </p>
                <LinkDetailsForm
                  // The link is held by whichever record has the relation.
                  rowId={g.direction === "out" ? row.id : form.id}
                  columnId={g.columnId}
                  targetId={g.direction === "out" ? form.id : row.id}
                  details={g.details[form.id]}
                  place={g.place}
                  perform={perform}
                  onDone={(saved) => {
                    setEditing(null);
                    if (saved) setRevision((n) => n + 1);
                  }}
                />
              </div>
            )}
            {g.total > 60 && <p className="hint">{t("Y {n} más.").replace("{n}", (g.total - 60).toLocaleString())}</p>}
          </div>
        );
      })}
    </section>
  );
}

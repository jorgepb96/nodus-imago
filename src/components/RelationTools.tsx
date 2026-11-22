// Relations between databases: turning a property that names records (a book
// id, a title) into a relation, bringing a property of the related records
// into this database, showing a relation in both databases, and the records
// linked with a record, shown in its panel (a book's photographs).
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Link2, Loader2, Unlink } from "lucide-react";
import type { DatabaseColumn, DatabaseDetail } from "../../shared/databases";
import type { RecordRow } from "../../shared/imago";
import { useT } from "../i18n";
import { Button, Modal, Thumbnail } from "./ui";
import type { Perform } from "./Properties";

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
                  {d.database.kind === "sources" ? ` · ${t("Fuentes")}` : ""}
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
  const options = (target?.columns ?? []).filter((c) => !["attachment", "files", "relation", "button", "ai_image", "rollup"].includes(c.type));
  const [picked, setPicked] = useState(options.find((c) => c.type !== "title")?.id ?? options[0]?.id ?? "");
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
                rollupTargetColumnId: chosen.type === "title" ? "__title__" : chosen.id,
                rollupFunction: "show_unique",
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
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
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
  perform,
  onChanged,
}: {
  column: DatabaseColumn;
  /** This database's name: the twin's default name. */
  databaseName: string;
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
  return (
    <div className="relation-pairing" data-testid="relation-pairing">
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

type LinkedGroup = Awaited<ReturnType<typeof window.imago.call<"linkedRecords">>>[number];

/** The records linked with a record: their images when they have them (a book's photographs). */
export function LinkedRecords({ row, onOpenRecord }: { row: RecordRow; onOpenRecord?: (rowId: string) => void }) {
  const t = useT();
  const [groups, setGroups] = useState<LinkedGroup[]>([]);
  useEffect(() => {
    let cancelled = false;
    void window.imago
      .call("linkedRecords", { rowId: row.id })
      .then((g) => !cancelled && setGroups(g))
      .catch(() => !cancelled && setGroups([]));
    return () => {
      cancelled = true;
    };
  }, [row.id, row.updatedAt]);
  if (!groups.length) return null;
  return (
    <section className="linked-records" data-testid="linked-records">
      <h3>{t("Registros enlazados")}</h3>
      {groups.map((g) => {
        const withImages = g.rows.some((r) => r.images.length);
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
                  <button key={r.id} type="button" className="linked-tile" onClick={() => onOpenRecord?.(r.id)} aria-label={`${t("Abrir registro")} ${r.title}`} data-tooltip={r.title}>
                    <Thumbnail id={r.images[0]?.id} revision={r.images[0]?.revision} alt={r.title} />
                    <small>{r.title}</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="linked-chips">
                {g.rows.slice(0, 60).map((r) => (
                  <button key={r.id} type="button" className="linked-chip" onClick={() => onOpenRecord?.(r.id)}>
                    {r.title}
                  </button>
                ))}
              </div>
            )}
            {g.total > 60 && <p className="hint">{t("Y {n} más.").replace("{n}", (g.total - 60).toLocaleString())}</p>}
          </div>
        );
      })}
    </section>
  );
}

// Values written in different ways, grouped for review: equal ones are
// marked to merge, probable ones are left for the person to decide. Each
// group keeps the name chosen (the most used one by default, or a new one).
import { useEffect, useMemo, useState } from "react";
import { Combine } from "lucide-react";
import type { DatabaseColumn } from "../../shared/databases";
import type { ValueCluster } from "../../shared/cleanup";
import { useT, formatNumber } from "../i18n";
import { Button, Modal } from "./ui";

type Choice = { on: boolean; target: string; custom: boolean };

export function CleanupDialog({
  column,
  onClose,
  onDone,
}: {
  column: DatabaseColumn;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const [clusters, setClusters] = useState<ValueCluster[] | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.imago
      .call("valueClusters", { columnId: column.id })
      .then((list) => {
        setClusters(list);
        setChoices(list.map((c) => ({ on: c.kind === "same", target: c.suggestion, custom: false })));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [column.id]);
  const update = (i: number, change: Partial<Choice>) => setChoices((all) => all.map((c, j) => (j === i ? { ...c, ...change } : c)));
  const marked = useMemo(() => (clusters ?? []).filter((_, i) => choices[i]?.on), [clusters, choices]);
  // Records that change: those of every value that is not the one kept.
  const changes = (clusters ?? []).reduce(
    (sum, c, i) => (choices[i]?.on ? sum + c.members.filter((m) => m.value !== choices[i].target.trim()).reduce((s, m) => s + m.count, 0) : sum),
    0,
  );
  return (
    <Modal icon={Combine} title={`${t("Unificar valores parecidos")} · ${column.name}`} onClose={onClose} wide>
      <div className="modal-body cleanup-dialog" data-testid="cleanup-dialog">
        <p className="hint">
          {t("Grupos de valores que probablemente son lo mismo escrito de otra forma: mayúsculas, acentos, puntuación, orden de las palabras, iniciales o una letra distinta. Los iguales vienen marcados; revisa los parecidos antes de unirlos. Se puede deshacer.")}
        </p>
        {error && <p className="error">{t(error)}</p>}
        {!clusters && !error && <p className="muted">{t("Buscando valores parecidos…")}</p>}
        {clusters && !clusters.length && <p className="muted">{t("No hay valores parecidos en esta propiedad.")}</p>}
        <ul className="cleanup-list">
          {clusters?.map((cluster, i) => {
            const choice = choices[i];
            if (!choice) return null;
            return (
              <li key={cluster.members.map((m) => m.value).join("|")} className={`cleanup-group${choice.on ? " is-on" : ""}`} data-testid="cleanup-group">
                <label className="cleanup-toggle">
                  <input type="checkbox" checked={choice.on} onChange={(e) => update(i, { on: e.target.checked })} />
                  <span className={`cleanup-kind kind-${cluster.kind}`}>
                    {t(cluster.kind === "same" ? "Iguales" : "Parecidos")}
                  </span>
                </label>
                <div className="cleanup-members" role="radiogroup" aria-label={t("Nombre que se conserva")}>
                  {cluster.members.map((m) => (
                    <label key={m.value} className="cleanup-member">
                      <input
                        type="radio"
                        name={`cleanup-${i}`}
                        checked={!choice.custom && choice.target === m.value}
                        onChange={() => update(i, { target: m.value, custom: false, on: true })}
                      />
                      <span>{m.value}</span>
                      <small>{formatNumber(m.count, 0)}</small>
                    </label>
                  ))}
                  <label className="cleanup-member cleanup-custom">
                    <input type="radio" name={`cleanup-${i}`} checked={choice.custom} onChange={() => update(i, { custom: true, on: true })} />
                    <input
                      aria-label={t("Otro nombre")}
                      placeholder={t("Otro nombre")}
                      value={choice.custom ? choice.target : ""}
                      onFocus={() => !choice.custom && update(i, { custom: true, target: "", on: true })}
                      onChange={(e) => update(i, { target: e.target.value, custom: true })}
                    />
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <footer>
        <span className="hint">
          {t("{g} grupos marcados · {r} registros cambiarán").replace("{g}", String(marked.length)).replace("{r}", formatNumber(changes, 0))}
        </span>
        <Button onClick={onClose}>{t("Cancelar")}</Button>
        <Button
          primary
          data-testid="cleanup-apply"
          disabled={busy || !marked.length || marked.some((_, j) => !choices[(clusters ?? []).indexOf(marked[j])]?.target.trim())}
          onClick={() =>
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                const groups = (clusters ?? []).flatMap((c, i) =>
                  choices[i].on
                    ? [{ members: c.members.map((m) => m.optionId ?? m.value), target: choices[i].target.trim() }]
                    : [],
                );
                const changed = await window.imago.call("valueMerge", { columnId: column.id, groups });
                onDone(t("{n} registros actualizados. Puedes deshacerlo con «Deshacer».").replace("{n}", formatNumber(changed, 0)));
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          <Combine size={14} />
          {t("Unir los marcados")}
        </Button>
      </footer>
    </Modal>
  );
}

// Undo and Redo for a scope of change batches. Each button says what it would
// change; anything larger than one value is confirmed first, so a bulk change
// made elsewhere (a merge, a whole column placed on the map) is never reverted
// by a click meant for something else.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Redo2, Undo2 } from "lucide-react";
import type { HistoryScope, HistoryStep } from "../../shared/imago";
import { formatNumber, uiLocale, useT } from "../i18n";
import { Button, Modal } from "./ui";

type Direction = "undo" | "redo";

const KIND: Record<string, string> = {
  proposals: "propuestas aceptadas",
  cleanup: "Unificar valores",
  locate: "Situar los registros en el mapa",
  link: "datos del vínculo",
  ai: "relleno con IA",
};

export function HistoryButtons({
  scope,
  tick,
  perform,
  onDone,
}: {
  scope: HistoryScope;
  /** Changes whenever the collection may have changed. */
  tick: number;
  perform: (work: () => Promise<void>) => Promise<void>;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const [state, setState] = useState<{
    undo: HistoryStep | null;
    redo: HistoryStep | null;
  }>({ undo: null, redo: null });
  const [confirm, setConfirm] = useState<{
    direction: Direction;
    step: HistoryStep;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void window.imago
      .call("historyState", { scope })
      .then((s) => live && setState(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [scope, tick]);

  const describe = (step: HistoryStep) => {
    const what = step.kind ? t(KIND[step.kind]) : t("edición");
    const columns = step.columns.length
      ? ` · ${step.columns.map((c) => `«${c}»`).join(", ")}`
      : "";
    const when = new Date(step.createdAt).toLocaleString(uiLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return `${formatNumber(step.changes, 0)} ${t(step.changes === 1 ? "cambio" : "cambios")}${columns} · ${what} · ${when}`;
  };
  const run = (direction: Direction) =>
    void perform(async () => {
      setConfirm(null);
      const n = await window.imago.call(direction, { scope });
      onDone(
        n
          ? `${formatNumber(n, 0)} ${t(direction === "undo" ? "cambios deshechos" : "cambios rehechos")}`
          : t(
              direction === "undo"
                ? "No hay cambios que deshacer."
                : "No hay cambios que rehacer.",
            ),
      );
    });
  const click = (direction: Direction) => {
    const step = state[direction];
    if (step && step.changes > 1) setConfirm({ direction, step });
    else run(direction);
  };

  return (
    <>
      <Button
        disabled={!state.undo}
        data-tooltip={
          state.undo
            ? `${t("Deshacer")}: ${describe(state.undo)}`
            : t("No hay cambios que deshacer.")
        }
        onClick={() => click("undo")}
      >
        <Undo2 size={14} />
        {t("Deshacer")}
      </Button>
      <Button
        disabled={!state.redo}
        data-tooltip={
          state.redo
            ? `${t("Rehacer")}: ${describe(state.redo)}`
            : t("No hay cambios que rehacer.")
        }
        onClick={() => click("redo")}
      >
        <Redo2 size={14} />
        {t("Rehacer")}
      </Button>
      {confirm &&
        // Outside the toolbar, whose button styles would otherwise reach it.
        createPortal(
          <Modal
            icon={confirm.direction === "undo" ? Undo2 : Redo2}
            title={t(confirm.direction === "undo" ? "Deshacer" : "Rehacer")}
            onClose={() => setConfirm(null)}
          >
            <div className="modal-body">
              <p>
                {t(
                  confirm.direction === "undo"
                    ? "Se devolverán los valores anteriores de este cambio:"
                    : "Se volverá a aplicar este cambio:",
                )}
              </p>
              <p>
                <strong>{describe(confirm.step)}</strong>
              </p>
            </div>
            <footer>
              <Button onClick={() => setConfirm(null)}>{t("Cancelar")}</Button>
              <Button primary onClick={() => run(confirm.direction)}>
                {t(confirm.direction === "undo" ? "Deshacer" : "Rehacer")}
              </Button>
            </footer>
          </Modal>,
          document.body,
        )}
    </>
  );
}

// The AI button in an AI property's header: fill the empty cells, or
// regenerate the whole column after a confirmation.
import { useState, type RefObject } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import type { DatabaseColumn, DatabaseDetail } from "../../shared/databases";
import { useT } from "../i18n";
import { CriteriaPopover } from "./CriteriaSelect";
import type { Perform } from "./Properties";
import { Button, Modal } from "./ui";

export function AiColumnMenu({
  detail,
  column,
  anchor,
  language,
  perform,
  onClose,
  onQueued,
}: {
  detail: DatabaseDetail;
  column: DatabaseColumn;
  anchor: RefObject<HTMLElement>;
  language: string;
  perform: Perform;
  onClose: () => void;
  onQueued: () => void;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const queue = (overwrite: boolean) =>
    void perform(
      async () => {
        await window.imago.call("analyze", {
          databaseId: detail.database.id,
          columnIds: [column.id],
          language,
          detailed: true,
          overwrite,
        });
        onQueued();
        onClose();
      },
      overwrite
        ? "Columna añadida a la cola de tareas."
        : "Celdas vacías añadidas a la cola de tareas.",
    );
  if (confirm)
    return (
      <Modal
        icon={RefreshCw}
        title={t("Regenerar toda la columna")}
        onClose={() => {
          setConfirm(false);
          onClose();
        }}
      >
        <div className="modal-body">
          <h3>{column.name}</h3>
          <p>
            {t(
              "La IA volverá a generar todas las celdas de esta propiedad y sustituirá los valores actuales, también los que hayas editado a mano. Puedes deshacerlo después.",
            )}
          </p>
        </div>
        <footer>
          <Button
            type="button"
            onClick={() => {
              setConfirm(false);
              onClose();
            }}
          >
            {t("Cancelar")}
          </Button>
          <Button type="button" primary onClick={() => queue(true)}>
            {t("Regenerar")}
          </Button>
        </footer>
      </Modal>
    );
  return (
    <CriteriaPopover
      anchor={anchor}
      onClose={onClose}
      width={260}
      label={`${t("IA de la propiedad")} ${column.name}`}
      className="column-menu"
    >
      <div role="menu" className="column-menu-group">
        <button
          type="button"
          role="menuitem"
          className="column-menu-item"
          onClick={() => queue(false)}
        >
          <Sparkles size={15} />
          <span>{t("Rellenar celdas vacías")}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="column-menu-item"
          onClick={() => setConfirm(true)}
        >
          <RefreshCw size={15} />
          <span>{t("Regenerar toda la columna…")}</span>
        </button>
      </div>
    </CriteriaPopover>
  );
}

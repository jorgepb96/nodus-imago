// Right-click menu on a table column header, adapted from Notion's: rename,
// change type, filter, sort, calculate, freeze, hide, wrap, insert, duplicate,
// edit and delete. Destructive changes (deleting, a type change that empties
// values) ask first in a modal.
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  EyeOff,
  Filter,
  Loader2,
  Pin,
  PinOff,
  Repeat2,
  Settings2,
  Sigma,
  Trash2,
  WrapText,
  X,
} from "lucide-react";
import {
  columnTypeDef,
  ROLLUP_FUNCTIONS,
  type DatabaseColumn,
  type DatabaseColumnType,
  type DatabaseDetail,
  type RollupFunction,
} from "../../shared/databases";
import {
  calculationsFor,
  canHide,
  CONVERTIBLE_TYPES,
  type ColumnPrefs,
} from "../columnPrefs";
import { useT } from "../i18n";
import { CriteriaPopover } from "./CriteriaSelect";
import type { Perform } from "./Properties";
import { Button, Modal } from "./ui";

type View = "main" | "type" | "calc";
type Confirm =
  | { kind: "delete" }
  | { kind: "convert"; type: DatabaseColumnType; total: number; lost: number };

const UNDELETABLE = new Set<DatabaseColumnType>(["title"]);
const UNDUPLICABLE = new Set<DatabaseColumnType>([
  "title",
  "attachment",
  "files",
  "relation",
  "ai_image",
]);

export function ColumnMenu({
  detail,
  column,
  anchor,
  prefs,
  sort,
  perform,
  onClose,
  onDetail,
  onPrefs,
  onFilter,
  onSort,
  onEdit,
  onInserted,
  initialView = "main",
}: {
  initialView?: "main" | "calc";
  detail: DatabaseDetail;
  column: DatabaseColumn;
  anchor: RefObject<HTMLElement>;
  prefs: ColumnPrefs;
  sort: "asc" | "desc" | null;
  perform: Perform;
  onClose: () => void;
  /** The database's new layout after a structural change. */
  onDetail: (detail: DatabaseDetail) => void;
  onPrefs: (change: (current: ColumnPrefs) => ColumnPrefs) => void;
  onFilter: () => void;
  onSort: (direction: "asc" | "desc" | null) => void;
  onEdit: () => void;
  /** A property was inserted: reopen the menu on it so it can be named. */
  onInserted: (columnId: string) => void;
}) {
  const t = useT(),
    api = window.imago,
    [view, setView] = useState<View>(initialView),
    [name, setName] = useState(column.name),
    [confirm, setConfirm] = useState<Confirm | null>(null),
    [working, setWorking] = useState(false),
    panel = useRef<HTMLDivElement>(null),
    renameRef = useRef<HTMLInputElement>(null);
  const index = detail.columns.findIndex((c) => c.id === column.id),
    frozen =
      prefs.freezeThrough !== null &&
      detail.columns.findIndex((c) => c.id === prefs.freezeThrough) >= index,
    wrapped = prefs.wrap.includes(column.id),
    convertible = (CONVERTIBLE_TYPES as readonly string[]).includes(
      column.type,
    ),
    calc = prefs.calc[column.id];

  // Rename on close as Notion does: the name typed is kept unless it is empty.
  const commitName = async () => {
    const next = name.trim();
    if (!next || next === column.name) return;
    await api.call("updateColumn", { id: column.id, name: next });
    onDetail(await api.call("detail", { id: detail.database.id }));
  };
  const close = () => {
    void perform(commitName);
    onClose();
  };
  const run = (work: () => Promise<void>) => {
    void perform(async () => {
      await commitName();
      await work();
    });
    onClose();
  };

  useEffect(() => {
    if (view === "main") {
      renameRef.current?.focus();
      renameRef.current?.select();
    } else
      panel.current
        ?.querySelector<HTMLElement>('[role="menuitem"],[role="menuitemradio"]')
        ?.focus();
  }, [view]);

  // Up/down move between items; Escape or ← leaves a submenu.
  const keys = (event: React.KeyboardEvent) => {
    const items = [
      ...(panel.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled]),[role="menuitemradio"]',
      ) ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (
      view !== "main" &&
      (event.key === "Escape" ||
        (event.key === "ArrowLeft" &&
          document.activeElement !== renameRef.current))
    ) {
      event.preventDefault();
      event.stopPropagation();
      setView("main");
    } else if (event.key === "Escape") {
      // Escape closes without renaming, like cancelling an edit.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchor.current?.focus();
    }
  };

  const convert = (type: DatabaseColumnType) =>
    void perform(async () => {
      await commitName();
      const preview = await api.call("convertColumn", {
        id: column.id,
        type,
        apply: false,
      });
      if (preview.lost > 0) {
        setConfirm({ kind: "convert", type, ...preview });
        return;
      }
      await api.call("convertColumn", { id: column.id, type, apply: true });
      onDetail(await api.call("detail", { id: detail.database.id }));
      onClose();
    });

  const insert = (side: "left" | "right") =>
    run(async () => {
      const taken = new Set(detail.columns.map((c) => c.name));
      let label = t("Propiedad"),
        n = 2;
      while (taken.has(label)) label = `${t("Propiedad")} ${n++}`;
      const created = await api.call("addColumn", {
        databaseId: detail.database.id,
        name: label,
        type: "text",
      });
      const order = detail.columns.map((c) => c.id);
      order.splice(index + (side === "right" ? 1 : 0), 0, created.id);
      onDetail(
        await api.call("reorderColumns", {
          databaseId: detail.database.id,
          columnIds: order,
        }),
      );
      onInserted(created.id);
    });

  if (confirm)
    return (
      <Modal
        title={t(
          confirm.kind === "delete" ? "Eliminar propiedad" : "Cambiar tipo",
        )}
        onClose={onClose}
      >
        <div className="modal-body">
          <h3>{column.name}</h3>
          {confirm.kind === "delete" ? (
            <p>
              {t(
                "¿Eliminar esta propiedad y todos sus valores? Esta operación no se puede deshacer.",
              )}
            </p>
          ) : (
            <p>
              {`${confirm.lost.toLocaleString()} ${t("de")} ${confirm.total.toLocaleString()} ${t(
                "valores no encajan en el tipo",
              )} «${t(columnTypeDef(confirm.type).label)}» ${t(
                "y se vaciarán. Esta operación no se puede deshacer.",
              )}`}
            </p>
          )}
        </div>
        <footer>
          <Button disabled={working} onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button
            className="danger"
            disabled={working}
            aria-busy={working}
            onClick={() =>
              void perform(async () => {
                setWorking(true);
                try {
                  if (confirm.kind === "delete") {
                    await api.call("deleteColumn", { id: column.id });
                    onPrefs((p) => ({
                      ...p,
                      hidden: p.hidden.filter((id) => id !== column.id),
                      wrap: p.wrap.filter((id) => id !== column.id),
                      freezeThrough:
                        p.freezeThrough === column.id
                          ? (detail.columns[index - 1]?.id ?? null)
                          : p.freezeThrough,
                    }));
                  } else
                    await api.call("convertColumn", {
                      id: column.id,
                      type: confirm.type,
                      apply: true,
                    });
                  onDetail(
                    await api.call("detail", { id: detail.database.id }),
                  );
                  onClose();
                } finally {
                  setWorking(false);
                }
              })
            }
          >
            {working ? (
              <Loader2 size={14} className="spin" />
            ) : confirm.kind === "delete" ? (
              <Trash2 size={14} />
            ) : (
              <Repeat2 size={14} />
            )}
            {working
              ? t(confirm.kind === "delete" ? "Eliminando…" : "Convirtiendo…")
              : t(confirm.kind === "delete" ? "Eliminar" : "Convertir")}
          </Button>
        </footer>
      </Modal>
    );

  const item = (
    icon: React.ReactNode,
    label: string,
    action: () => void,
    options: {
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
      submenu?: boolean;
    } = {},
  ) => (
    <button
      type="button"
      role="menuitem"
      className={"column-menu-item" + (options.danger ? " danger" : "")}
      disabled={options.disabled}
      aria-haspopup={options.submenu ? "menu" : undefined}
      onClick={action}
      onKeyDown={(e) => {
        if (options.submenu && e.key === "ArrowRight") {
          e.preventDefault();
          action();
        }
      }}
    >
      {icon}
      <span>{label}</span>
      {options.checked && <Check size={14} className="column-menu-end" />}
      {options.submenu && (
        <ChevronRight size={14} className="column-menu-end" />
      )}
    </button>
  );

  const back = (title: string) => (
    <div className="column-menu-back">
      <button
        type="button"
        aria-label={t("Volver")}
        title={t("Volver")}
        onClick={() => setView("main")}
      >
        <ChevronLeft size={15} />
      </button>
      <strong>{title}</strong>
    </div>
  );

  return (
    <CriteriaPopover
      anchor={anchor}
      onClose={close}
      width={264}
      label={`${t("Opciones de la propiedad")} ${column.name}`}
      className="column-menu"
    >
      <div ref={panel} role="menu" onKeyDownCapture={keys}>
        {view === "main" && (
          <>
            <form
              className="column-menu-rename"
              onSubmit={(e) => {
                e.preventDefault();
                close();
              }}
            >
              <input
                ref={renameRef}
                aria-label={t("Nombre de la propiedad")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </form>
            <div className="column-menu-group">
              {item(<Settings2 size={15} />, t("Editar propiedad"), () => {
                void perform(commitName);
                onClose();
                onEdit();
              })}
              {item(
                <Repeat2 size={15} />,
                t("Cambiar tipo"),
                () => setView("type"),
                { submenu: true, disabled: !convertible },
              )}
            </div>
            <div className="column-menu-group">
              {item(<Filter size={15} />, t("Filtrar"), () =>
                run(async () => onFilter()),
              )}
              {item(
                <ArrowUp size={15} />,
                t("Orden ascendente"),
                () => run(async () => onSort(sort === "asc" ? null : "asc")),
                { checked: sort === "asc" },
              )}
              {item(
                <ArrowDown size={15} />,
                t("Orden descendente"),
                () => run(async () => onSort(sort === "desc" ? null : "desc")),
                { checked: sort === "desc" },
              )}
              {item(<Sigma size={15} />, t("Calcular"), () => setView("calc"), {
                submenu: true,
              })}
            </div>
            <div className="column-menu-group">
              {item(
                frozen ? <PinOff size={15} /> : <Pin size={15} />,
                t(
                  frozen
                    ? "Dejar de fijar columnas"
                    : "Fijar hasta esta columna",
                ),
                () =>
                  run(async () =>
                    onPrefs((p) => ({
                      ...p,
                      freezeThrough: frozen ? null : column.id,
                    })),
                  ),
              )}
              {item(
                <EyeOff size={15} />,
                t("Ocultar"),
                () =>
                  run(async () =>
                    onPrefs((p) => ({
                      ...p,
                      hidden: [...new Set([...p.hidden, column.id])],
                    })),
                  ),
                { disabled: !canHide(column) },
              )}
              {item(
                <WrapText size={15} />,
                t("Ajustar texto"),
                () =>
                  run(async () =>
                    onPrefs((p) => ({
                      ...p,
                      wrap: wrapped
                        ? p.wrap.filter((id) => id !== column.id)
                        : [...p.wrap, column.id],
                    })),
                  ),
                { checked: wrapped },
              )}
            </div>
            <div className="column-menu-group">
              {item(
                <ArrowLeftToLine size={15} />,
                t("Insertar a la izquierda"),
                () => insert("left"),
              )}
              {item(
                <ArrowRightToLine size={15} />,
                t("Insertar a la derecha"),
                () => insert("right"),
              )}
              {item(
                <Copy size={15} />,
                t("Duplicar propiedad"),
                () =>
                  run(async () => {
                    await api.call("duplicateColumn", {
                      id: column.id,
                      copy: t("(copia)").replace(/[()]/g, ""),
                    });
                    onDetail(
                      await api.call("detail", { id: detail.database.id }),
                    );
                  }),
                { disabled: UNDUPLICABLE.has(column.type) },
              )}
              {item(
                <Trash2 size={15} />,
                t("Eliminar propiedad"),
                () => {
                  void perform(commitName);
                  setConfirm({ kind: "delete" });
                },
                { danger: true, disabled: UNDELETABLE.has(column.type) },
              )}
            </div>
          </>
        )}
        {view === "type" && (
          <>
            {back(t("Cambiar tipo"))}
            <div className="column-menu-group">
              {CONVERTIBLE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="menuitemradio"
                  aria-checked={column.type === type}
                  className="column-menu-item"
                  onClick={() =>
                    column.type === type ? setView("main") : convert(type)
                  }
                >
                  <span>{t(columnTypeDef(type).label)}</span>
                  {column.type === type && (
                    <Check size={14} className="column-menu-end" />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
        {view === "calc" && (
          <>
            {back(t("Calcular"))}
            <div className="column-menu-group">
              {[null, ...calculationsFor(column)].map(
                (fn: RollupFunction | null) => (
                  <button
                    key={fn ?? "none"}
                    type="button"
                    role="menuitemradio"
                    aria-checked={(calc ?? null) === fn}
                    className="column-menu-item"
                    onClick={() =>
                      run(async () =>
                        onPrefs((p) => {
                          const next = { ...p.calc };
                          if (fn) next[column.id] = fn;
                          else delete next[column.id];
                          return { ...p, calc: next };
                        }),
                      )
                    }
                  >
                    {fn === null && <X size={15} />}
                    <span>
                      {fn
                        ? t(ROLLUP_FUNCTIONS.find((f) => f.id === fn)!.label)
                        : t("Ninguno")}
                    </span>
                    {(calc ?? null) === fn && (
                      <Check size={14} className="column-menu-end" />
                    )}
                  </button>
                ),
              )}
            </div>
          </>
        )}
      </div>
    </CriteriaPopover>
  );
}

// The «···» menu of a select option, opened from the option list of a cell:
// rename it, delete it (the caller confirms) and pick its colour from a
// predefined palette or any colour the user chooses.
import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowDownAZ, ArrowUpZA, Check, ChevronRight, Hand, Shapes, Trash2 } from "lucide-react";
import type { DatabaseColumnConfig, DatabaseSelectOption } from "../../shared/databases";
import { useT } from "../i18n";
import { CriteriaPopover } from "./CriteriaSelect";
import { DatabaseIconPicker, OptionIcon } from "./DatabaseIcon";

/** Colour shown for an option without one (the chips' default). */
export const DEFAULT_OPTION_COLOR = "#6366f1";

/** Named colours offered for an option; null keeps the default. */
export const OPTION_PALETTE: { label: string; color: string | null }[] = [
  { label: "Predeterminado", color: null },
  { label: "Gris", color: "#6b7280" },
  { label: "Marrón", color: "#9a6b4f" },
  { label: "Naranja", color: "#f97316" },
  { label: "Amarillo", color: "#eab308" },
  { label: "Verde", color: "#22c55e" },
  { label: "Azul", color: "#3b82f6" },
  { label: "Morado", color: "#8b5cf6" },
  { label: "Rosa", color: "#ec4899" },
  { label: "Rojo", color: "#ef4444" },
];

export type OptionSort = NonNullable<DatabaseColumnConfig["optionSort"]>;

/** The options in the order a column shows them: by hand or by name. */
export function sortOptions<T extends { label: string; position: number }>(options: T[], sort: OptionSort = "manual"): T[] {
  const list = [...options].sort((a, b) => a.position - b.position);
  if (sort === "manual") return list;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  list.sort((a, b) => collator.compare(a.label, b.label));
  return sort === "name-desc" ? list.reverse() : list;
}

const SORTS: { id: OptionSort; label: string; icon: typeof Hand }[] = [
  { id: "manual", label: "Manual", icon: Hand },
  { id: "name-asc", label: "Por nombre (A → Z)", icon: ArrowDownAZ },
  { id: "name-desc", label: "Por nombre (Z → A)", icon: ArrowUpZA },
];

const same = (a: string | null, b: string | null) =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

export function OptionEditMenu({
  anchor,
  option,
  icon,
  onIcon,
  sort,
  onSort,
  onRename,
  onColor,
  onDelete,
  onClose,
}: {
  anchor: RefObject<HTMLElement>;
  option: DatabaseSelectOption;
  /** The option's decorative icon («Name:colour») and how to change it. */
  icon: string | null;
  onIcon: (icon: string | null) => Promise<void>;
  /** The order of the whole list, chosen here too. */
  sort: OptionSort;
  onSort: (sort: OptionSort) => Promise<void>;
  onRename: (label: string) => Promise<void>;
  onColor: (color: string | null) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT(),
    [name, setName] = useState(option.label),
    [error, setError] = useState<string | null>(null),
    [custom, setCustom] = useState(option.color ?? DEFAULT_OPTION_COLOR),
    customTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    // The name last saved: blur, Enter and closing the menu all commit it, once.
    committed = useRef(option.label),
    iconAnchor = useRef<HTMLButtonElement>(null),
    [picking, setPicking] = useState(false);
  useEffect(() => {
    setName(option.label);
    committed.current = option.label;
  }, [option.label]);
  useEffect(() => () => clearTimeout(customTimer.current), []);
  const attempt = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const rename = () => {
    const next = name.trim();
    if (!next) {
      setName(committed.current);
      return;
    }
    if (next === committed.current) return;
    committed.current = next;
    void attempt(() => onRename(next));
  };
  // Closing by a click outside or Escape removes the field before it blurs.
  const close = () => {
    rename();
    onClose();
  };
  const named = OPTION_PALETTE.some((p) => same(p.color, option.color));
  return (
    <CriteriaPopover anchor={anchor} onClose={close} width={240} label={t("Editar opción")} className="option-edit">
      <input
        className="option-edit-name"
        aria-label={t("Nombre de la opción")}
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={rename}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            rename();
          }
        }}
      />
      {error && <p className="option-edit-error" role="alert">{t(error)}</p>}
      <button type="button" className="option-edit-item" onClick={onDelete}>
        <Trash2 size={15} />
        {t("Eliminar")}
      </button>
      <button
        ref={iconAnchor}
        type="button"
        className="option-edit-item"
        aria-expanded={picking}
        onClick={() => setPicking(!picking)}
      >
        {icon ? <OptionIcon value={icon} size={15} /> : <Shapes size={15} />}
        <span className="option-edit-label">{t("Icono")}</span>
        <small className="option-edit-hint">{t(icon ? "Cambiar" : "Ninguno")}</small>
        <ChevronRight size={14} />
      </button>
      {picking && (
        <CriteriaPopover
          anchor={iconAnchor}
          onClose={() => setPicking(false)}
          width={340}
          label={t("Icono de la opción")}
          className="sidebar-db-icon-popover option-icon-popover"
        >
          <header>
            <strong>{t("Icono de la opción")}</strong>
          </header>
          <DatabaseIconPicker value={icon} onChange={(next) => void attempt(() => onIcon(next))} />
        </CriteriaPopover>
      )}
      <div className="option-edit-heading">{t("Ordenar")}</div>
      {SORTS.map(({ id, label, icon: Icon }) => (
        <button
          type="button"
          key={id}
          className="option-edit-item"
          aria-pressed={sort === id}
          onClick={() => sort !== id && void attempt(() => onSort(id))}
        >
          <Icon size={15} />
          <span className="option-edit-label">{t(label)}</span>
          {sort === id && <Check size={15} />}
        </button>
      ))}
      <div className="option-edit-heading">{t("Colores")}</div>
      {OPTION_PALETTE.map((p) => (
        <button
          type="button"
          key={p.label}
          className="option-edit-item"
          aria-pressed={same(p.color, option.color)}
          onClick={() => void attempt(() => onColor(p.color))}
        >
          <span className="option-swatch" style={{ "--chip": p.color ?? DEFAULT_OPTION_COLOR } as React.CSSProperties} />
          <span className="option-edit-label">{t(p.label)}</span>
          {same(p.color, option.color) && <Check size={15} />}
        </button>
      ))}
      <label className="option-edit-item option-edit-custom">
        <input
          type="color"
          aria-label={t("Elegir un color")}
          value={custom}
          onChange={(e) => {
            // The system picker reports every step of a drag: save once the
            // colour rests.
            const color = e.target.value;
            setCustom(color);
            clearTimeout(customTimer.current);
            customTimer.current = setTimeout(() => void attempt(() => onColor(color)), 400);
          }}
        />
        <span className="option-edit-label">{t("Personalizado…")}</span>
        {!named && <Check size={15} />}
      </label>
    </CriteriaPopover>
  );
}

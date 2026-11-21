// The views of a database a researcher chooses to see: which tabs are shown
// (built-in views and saved ones) and the saved views themselves — a kind of
// view with its filters and sort, over the same records (nothing is copied).
import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BookmarkPlus,
  CalendarRange,
  ChartColumn,
  ChartScatter,
  Copy,
  Eye,
  EyeOff,
  LayoutGrid,
  ListTree,
  Map as MapIcon,
  Pencil,
  Share2,
  Table2,
} from "lucide-react";
import type { DatabaseViewId, SavedView } from "../../shared/savedViews";
import { savedViewKey } from "../../shared/savedViews";
import { useT } from "../i18n";
import { CriteriaPopover } from "./CriteriaSelect";
import { Button, Modal } from "./ui";

/** The built-in views: their tab label and icon. */
export const VIEW_INFO: Record<DatabaseViewId, { label: string; Icon: LucideIcon }> = {
  table: { label: "Tabla", Icon: Table2 },
  gallery: { label: "Galería", Icon: LayoutGrid },
  map: { label: "Mapa", Icon: MapIcon },
  tree: { label: "Árbol", Icon: ListTree },
  timeline: { label: "Cronología", Icon: CalendarRange },
  stats: { label: "Estadísticas", Icon: ChartColumn },
  variants: { label: "Variantes", Icon: Copy },
  network: { label: "Red", Icon: Share2 },
  visualmap: { label: "Mapa visual", Icon: ChartScatter },
};

/** Toolbar panel with an eye per view, like «Propiedades visibles». */
export function ViewVisibility({
  views,
  saved,
  hidden,
  onHidden,
}: {
  /** The built-in views this database offers. */
  views: DatabaseViewId[];
  saved: SavedView[];
  hidden: string[];
  onHidden: (hidden: string[]) => void;
}) {
  const t = useT(),
    anchor = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false);
  const entries = [
    ...views.map((id) => ({ key: id as string, label: t(VIEW_INFO[id].label), Icon: VIEW_INFO[id].Icon })),
    ...saved.map((v) => ({ key: savedViewKey(v.id), label: v.name, Icon: VIEW_INFO[v.view].Icon })),
  ];
  const set = new Set(hidden),
    hiddenCount = entries.filter((e) => set.has(e.key)).length,
    shownCount = entries.length - hiddenCount;
  return (
    <div className="view-controls">
      <button
        ref={anchor}
        className={`button ${hiddenCount ? "selected" : ""}`}
        aria-expanded={open}
        aria-label={t("Vistas visibles")}
        data-testid="view-visibility"
        onClick={() => setOpen(!open)}
      >
        {hiddenCount ? <EyeOff size={14} /> : <Eye size={14} />}
        {t("Vistas visibles")}
        {!!hiddenCount && (
          <span className="small-count" title={t("Vistas ocultas")}>
            {hiddenCount}
          </span>
        )}
      </button>
      {open && (
        <CriteriaPopover
          anchor={anchor}
          onClose={() => setOpen(false)}
          width={300}
          closeOnFocusOutside={false}
          label={t("Vistas visibles")}
          className="column-visibility"
        >
          <header>
            <strong>{t("Vistas visibles")}</strong>
            <span>
              {shownCount} / {entries.length}
            </span>
          </header>
          <ul>
            {entries.map(({ key, label, Icon }) => {
              const shown = !set.has(key);
              // At least one view stays visible.
              const last = shown && shownCount === 1;
              return (
                <li key={key} className={shown ? "" : "is-hidden"}>
                  <span title={label}>
                    <Icon size={13} /> {label}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shown}
                    disabled={last}
                    aria-label={`${t(shown ? "Ocultar" : "Mostrar")} ${label}`}
                    title={last ? t("Siempre queda al menos una vista") : t(shown ? "Ocultar" : "Mostrar")}
                    onClick={() => onHidden(shown ? [...hidden, key] : hidden.filter((h) => h !== key))}
                  >
                    {shown ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                </li>
              );
            })}
          </ul>
          <footer>
            <Button disabled={!hiddenCount} onClick={() => onHidden([])}>
              {t("Mostrar todas")}
            </Button>
          </footer>
        </CriteriaPopover>
      )}
    </div>
  );
}

/** Naming a new saved view, or editing one. */
export function SavedViewDialog({
  view,
  current,
  views,
  hasCriteria,
  onSave,
  onClose,
}: {
  /** The view being edited; none: a new one from the current filters and sort. */
  view: SavedView | null;
  /** The kind of view on screen, proposed for a new one. */
  current: DatabaseViewId;
  views: DatabaseViewId[];
  /** Whether filters or a sort are set now (to update an edited view with them). */
  hasCriteria: boolean;
  onSave: (input: { name: string; view: DatabaseViewId; useCurrent: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(view?.name ?? ""),
    [kind, setKind] = useState<DatabaseViewId>(view?.view ?? current),
    [useCurrent, setUseCurrent] = useState(!view),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), view: kind, useCurrent });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal icon={view ? Pencil : BookmarkPlus} title={t(view ? "Editar vista" : "Guardar vista")} onClose={onClose}>
      <form
        className="modal-body saved-view-form"
        data-testid="saved-view-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="hint">
          {t("Una vista guarda los filtros y el orden con el tipo de vista. No copia los registros: sigue siendo la misma base de datos.")}
        </p>
        <label>
          {t("Nombre")}
          <input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("Por ejemplo: Fotos de Granada")} />
        </label>
        <label>
          {t("Tipo de vista")}
          <select value={kind} onChange={(e) => setKind(e.target.value as DatabaseViewId)}>
            {views.map((id) => (
              <option key={id} value={id}>
                {t(VIEW_INFO[id].label)}
              </option>
            ))}
          </select>
        </label>
        {view && (
          <label className="check-label">
            <input type="checkbox" checked={useCurrent} disabled={!hasCriteria && !useCurrent} onChange={(e) => setUseCurrent(e.target.checked)} />
            {t("Usar los filtros y el orden que hay ahora")}
          </label>
        )}
        {error && <p className="error">{t(error)}</p>}
        <footer className="modal-actions">
          <Button type="button" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button primary type="submit" disabled={busy || !name.trim()}>
            {t("Guardar")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

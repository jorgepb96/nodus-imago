// The views of a database a researcher chooses to see: which tabs are shown
// (built-in views and saved ones) and the saved views themselves — a kind of
// view with its filters and sort, over the same records (nothing is copied).
import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Ban,
  BookmarkPlus,
  CalendarRange,
  ChartColumn,
  ChartScatter,
  Check,
  ChevronDown,
  Copy,
  Database,
  Eye,
  EyeOff,
  LayoutGrid,
  ListTree,
  Map as MapIcon,
  Palette,
  Pencil,
  Share2,
  Table2,
} from "lucide-react";
import type { DatabaseViewId, SavedView, ViewColor, ViewColorHue } from "../../shared/savedViews";
import { savedViewKey, VIEW_COLOR_HUES, VIEW_COLOR_TONES } from "../../shared/savedViews";
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

const HUE_LABEL: Record<ViewColorHue, string> = {
  gray: "Gris",
  brown: "Marrón",
  red: "Rojo",
  orange: "Naranja",
  yellow: "Amarillo",
  green: "Verde",
  blue: "Azul",
  purple: "Morado",
  pink: "Rosa",
};

/** The colour of a view tab: none by default, or a hue in a pastel or a normal tone. */
export function ViewColorPicker({ value, onChange }: { value: ViewColor | null; onChange: (color: ViewColor | null) => void }) {
  const t = useT();
  return (
    <div className="view-color-picker" role="group" aria-label={t("Color de la vista")}>
      <div className="view-color-head">
        <Palette size={13} />
        {t("Color")}
      </div>
      {VIEW_COLOR_TONES.map((tone) => (
        <div key={tone} className="view-color-row">
          <span>{t(tone === "pastel" ? "Pastel" : "Normal")}</span>
          <div className="view-color-swatches">
            {VIEW_COLOR_HUES.map((hue) => {
              const color = `${tone}:${hue}` as ViewColor,
                name = `${t(HUE_LABEL[hue])} · ${t(tone === "pastel" ? "Pastel" : "Normal")}`;
              return (
                <button
                  key={hue}
                  type="button"
                  className={`view-color-swatch tone-${tone}` + (value === color ? " selected" : "")}
                  style={{ "--view-hue": `var(--view-${hue})` } as React.CSSProperties}
                  aria-pressed={value === color}
                  aria-label={name}
                  data-tooltip={name}
                  data-testid={`view-color-${tone}-${hue}`}
                  onClick={() => onChange(value === color ? null : color)}
                />
              );
            })}
          </div>
        </div>
      ))}
      <div className="view-color-row view-color-clear">
        <span />
        <button type="button" className="view-color-none" disabled={!value} data-testid="view-color-none" onClick={() => onChange(null)}>
          <Ban size={13} />
          {t("Sin color")}
        </button>
      </div>
    </div>
  );
}

/**
 * Where a view other than the table takes its records from: the main table
 * (the whole database) or the records a saved view keeps. Filters set on top
 * narrow them further. The table itself always shows the whole database.
 */
export function DataSourcePicker({
  saved,
  source,
  onSource,
}: {
  saved: SavedView[];
  /** «saved:<id>», or null for the main table. */
  source: string | null;
  onSource: (key: string | null) => void;
}) {
  const t = useT(),
    anchor = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false);
  const current = saved.find((v) => savedViewKey(v.id) === source) ?? null;
  const CurrentIcon = current ? VIEW_INFO[current.view].Icon : Table2;
  const pick = (key: string | null) => {
    onSource(key);
    setOpen(false);
  };
  return (
    <div className="data-source">
      <span className="data-source-caption">{t("Fuente")}</span>
      <button
        ref={anchor}
        type="button"
        className={`data-source-button ${current ? "selected" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${t("Fuente de los datos")}: ${current ? current.name : t("Tabla principal")}`}
        data-testid="data-source"
        data-tooltip={t("De dónde toma sus registros esta vista: la tabla principal o una vista guardada")}
        onClick={() => setOpen(!open)}
      >
        <CurrentIcon size={13} />
        <span className="data-source-label">{current ? current.name : t("Tabla principal")}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <CriteriaPopover
          anchor={anchor}
          onClose={() => setOpen(false)}
          width={320}
          closeOnFocusOutside={false}
          label={t("Fuente de los datos")}
          className="column-visibility data-source-menu"
        >
          <header>
            <strong>{t("Fuente de los datos")}</strong>
          </header>
          <p className="hint">
            {t("La galería, el mapa, la cronología, las estadísticas, las variantes, la red y el mapa visual se calculan sobre estos registros. Los filtros que añadas se aplican encima.")}
          </p>
          <ul role="radiogroup" aria-label={t("Fuente de los datos")}>
            <li>
              <button type="button" role="radio" aria-checked={!current} data-testid="data-source-all" onClick={() => pick(null)}>
                <Database size={13} />
                <span>{t("Tabla principal")}</span>
                {!current && <Check size={14} />}
              </button>
            </li>
            {saved.map((v) => {
              const Icon = VIEW_INFO[v.view].Icon,
                chosen = current?.id === v.id;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    data-testid="data-source-option"
                    onClick={() => pick(savedViewKey(v.id))}
                  >
                    <Icon size={13} />
                    <span title={v.name}>{v.name}</span>
                    {chosen && <Check size={14} />}
                  </button>
                </li>
              );
            })}
          </ul>
          {!saved.length && <p className="hint">{t("Guarda una vista con filtros para usarla como fuente de los datos.")}</p>}
        </CriteriaPopover>
      )}
    </div>
  );
}

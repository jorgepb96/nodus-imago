import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useT } from "../i18n";

/** Native top-layer popover: remains inside its React/DOM parent, escapes all
 * scrolling containers and can contain more independently positioned pickers. */
export function CriteriaPopover({
  anchor,
  onClose,
  children,
  className = "",
  width = 360,
  label,
  closeOnFocusOutside = true,
}: {
  anchor: RefObject<HTMLElement>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  width?: number;
  label?: string;
  /** The main filter panel stays open when deleting the focused rule. Nested
   * pickers still close when focus moves to another control. */
  closeOnFocusOutside?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useLayoutEffect(() => {
    const node = ref.current!;
    node.setAttribute("popover", "manual");
    const position = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const available = window.innerWidth - 24,
        size = Math.min(width, available);
      node.style.width = `${size}px`;
      node.style.maxHeight = `${Math.min(620, window.innerHeight - 24)}px`;
      const height = Math.min(
        node.scrollHeight || 320,
        620,
        window.innerHeight - 24,
      );
      const top =
        rect.bottom + height + 8 <= window.innerHeight - 12
          ? rect.bottom + 6
          : Math.max(12, rect.top - height - 6);
      node.style.top = `${top}px`;
      node.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - size - 12))}px`;
    };
    node.showPopover();
    position();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!node.contains(target) && !anchor.current?.contains(target))
        close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || node.querySelector(":popover-open")) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
      anchor.current?.focus();
    };
    const focusOutside = (event: FocusEvent) => {
      const previous = event.target as Node | null;
      setTimeout(() => {
        if (
          node.isConnected &&
          !node.contains(document.activeElement) &&
          !anchor.current?.contains(document.activeElement)
        ) {
          // Removing the focused rule/selection leaves focus on body. Keep the
          // editor open and restore a useful focus target rather than treating
          // removal as an intentional move outside the popover.
          if (document.activeElement === document.body && previous && !previous.isConnected) {
            node.querySelector<HTMLElement>('input:not([disabled]),button:not([disabled])')?.focus();
          } else close.current();
        }
      }, 0);
    };
    const observer = new ResizeObserver(position);
    observer.observe(node);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    document.addEventListener("pointerdown", outside);
    node.addEventListener("keydown", escape);
    if (closeOnFocusOutside) node.addEventListener("focusout", focusOutside);
    return () => {
      observer.disconnect();
      if (node.isConnected && node.matches(":popover-open")) node.hidePopover();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      document.removeEventListener("pointerdown", outside);
      node.removeEventListener("keydown", escape);
      if (closeOnFocusOutside) node.removeEventListener("focusout", focusOutside);
    };
  }, [anchor, width, closeOnFocusOutside]);
  return (
    <div
      ref={ref}
      className={`criteria-popover ${className}`}
      role={label ? "dialog" : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}
export type CriteriaOption = {
  value: string;
  label: string;
  description?: string;
  color?: string | null;
  disabled?: boolean;
};
export function CriteriaSelect({
  label,
  options,
  values,
  onChange,
  multiple = false,
  placeholder,
  disabled = false,
  query: externalQuery,
  onQueryChange,
  loading = false,
  more = false,
  onMore,
  custom = false,
  selectedOptions = [],
}: {
  label: string;
  options: CriteriaOption[];
  values: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  query?: string;
  onQueryChange?: (value: string) => void;
  loading?: boolean;
  more?: boolean;
  onMore?: () => void;
  custom?: boolean;
  selectedOptions?: CriteriaOption[];
}) {
  const t = useT(),
    id = useId(),
    anchor = useRef<HTMLButtonElement>(null),
    search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false),
    [ownQuery, setOwnQuery] = useState(""),
    [active, setActive] = useState(0);
  const [known, setKnown] = useState(options);
  useEffect(() => {
    setKnown((previous) => [
      ...new Map(
        [...previous, ...options].map((option) => [option.value, option]),
      ).values(),
    ]);
  }, [options]);
  const query = externalQuery ?? ownQuery;
  const fold = (text: string) =>
    text
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const filtered = onQueryChange
    ? options
    : options.filter((option) =>
        fold(`${option.label} ${option.description ?? ""}`).includes(
          fold(query),
        ),
      );
  const labels = values.map(
    (value) =>
      options.find((option) => option.value === value)?.label ??
      selectedOptions.find((option) => option.value === value)?.label ??
      known.find((option) => option.value === value)?.label ??
      value,
  );
  const setQuery = (value: string) => {
    setOwnQuery(value);
    onQueryChange?.(value);
    setActive(0);
  };
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, id, open]);
  const pick = (value: string) => {
    if (multiple && !values.includes(value) && values.length >= 1000) return;
    onChange(
      multiple
        ? values.includes(value)
          ? values.filter((item) => item !== value)
          : [...values, value]
        : [value],
    );
    if (!multiple) {
      setOpen(false);
      anchor.current?.focus();
    }
  };
  return (
    <div className="criteria-select">
      <button
        ref={anchor}
        type="button"
        className="criteria-select-trigger"
        aria-label={label}
        aria-describedby={`${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          if (!open) setQuery("");
        }}
      >
        <span
          id={`${id}-value`}
          className={labels.length ? "" : "muted"}
          title={labels.join(", ")}
        >
          {labels.length
            ? labels.slice(0, 2).join(", ") +
              (labels.length > 2 ? ` +${labels.length - 2}` : "")
            : (placeholder ?? t("Seleccionar…"))}
        </span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <CriteriaPopover
          anchor={anchor}
          onClose={() => setOpen(false)}
          className="criteria-select-menu"
          width={320}
        >
          <div className="criteria-menu-search">
            <Search size={14} />
            <input
              ref={search}
              aria-label={`${t("Buscar")}: ${label}`}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={id}
              aria-activedescendant={
                filtered[active] ? `${id}-${active}` : undefined
              }
              placeholder={t("Buscar…")}
              value={query}
              maxLength={300}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (
                  ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  setActive((index) =>
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? Math.max(0, filtered.length - 1)
                        : (index +
                            (event.key === "ArrowDown"
                              ? 1
                              : filtered.length - 1)) %
                          Math.max(1, filtered.length),
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const item = filtered[active];
                  if (item && !item.disabled) pick(item.value);
                  else if (custom && query.trim()) pick(query.trim());
                }
              }}
            />
            {query && (
              <button
                type="button"
                aria-label={t("Limpiar búsqueda")}
                onClick={() => setQuery("")}
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div
            id={id}
            className="criteria-menu-options"
            role="listbox"
            aria-label={label}
            aria-multiselectable={multiple}
          >
            {filtered.map((option, index) => (
              <button
                type="button"
                key={option.value}
                role="option"
                tabIndex={-1}
                id={`${id}-${index}`}
                aria-selected={values.includes(option.value)}
                disabled={option.disabled}
                className={active === index ? "keyboard-active" : ""}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option.value)}
              >
                <span
                  className={`criteria-option-check ${multiple ? "multiple" : ""}`}
                >
                  {values.includes(option.value) && <Check size={12} />}
                </span>
                {option.color && (
                  <i
                    className="criteria-option-color"
                    style={{ background: option.color }}
                  />
                )}
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
              </button>
            ))}
            {loading && (
              <p className="hint" role="status">
                {t("Cargando opciones…")}
              </p>
            )}
            {!filtered.length && !loading && (
              <p className="hint">{t("Sin coincidencias")}</p>
            )}
          </div>
          {custom &&
            query.trim() &&
            !options.some((option) => option.value === query.trim()) && (
              <button
                className="criteria-menu-action"
                type="button"
                onClick={() => pick(query.trim())}
              >
                {t("Usar este valor")}: {query.trim()}
              </button>
            )}
          {more && (
            <button
              className="criteria-menu-action"
              type="button"
              disabled={loading}
              onClick={onMore}
            >
              {t("Cargar más opciones")}
            </button>
          )}
          {multiple && (
            <div className="criteria-menu-footer">
              <button
                type="button"
                onClick={() =>
                  onChange(
                    [
                      ...new Set([
                        ...values,
                        ...filtered
                          .filter((option) => !option.disabled)
                          .map((option) => option.value),
                      ]),
                    ].slice(0, 1000),
                  )
                }
              >
                {t("Seleccionar resultados")}
              </button>
              <button type="button" onClick={() => onChange([])}>
                {t("Limpiar selección")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  anchor.current?.focus();
                }}
              >
                {t("Listo")}
              </button>
            </div>
          )}
        </CriteriaPopover>
      )}
    </div>
  );
}

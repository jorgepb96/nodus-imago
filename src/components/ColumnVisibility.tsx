// Toolbar panel listing a database's properties with an eye toggle each, so
// columns can be shown or hidden in the table (and their tags in the gallery).
import { useRef, useState } from "react";
import { Eye, EyeOff, Search } from "lucide-react";
import type { DatabaseDetail } from "../../shared/databases";
import { canHide, type ColumnPrefs } from "../columnPrefs";
import { useT } from "../i18n";
import { CriteriaPopover } from "./CriteriaSelect";
import { Button } from "./ui";

export function ColumnVisibility({
  detail,
  prefs,
  onPrefs,
}: {
  detail: DatabaseDetail;
  prefs: ColumnPrefs;
  onPrefs: (change: (current: ColumnPrefs) => ColumnPrefs) => void;
}) {
  const t = useT(),
    anchor = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const hidden = new Set(prefs.hidden),
    hideable = detail.columns.filter(canHide),
    hiddenCount = hideable.filter((c) => hidden.has(c.id)).length,
    needle = query.trim().toLocaleLowerCase(),
    listed = detail.columns.filter((c) => !needle || c.name.toLocaleLowerCase().includes(needle));
  const setHidden = (ids: string[]) => onPrefs((p) => ({ ...p, hidden: ids }));
  return (
    <div className="view-controls">
      <button
        ref={anchor}
        className={`button ${hiddenCount ? "selected" : ""}`}
        aria-expanded={open}
        aria-label={t("Propiedades visibles")}
        onClick={() => setOpen(!open)}
      >
        {hiddenCount ? <EyeOff size={14} /> : <Eye size={14} />}
        {t("Propiedades visibles")}
        {!!hiddenCount && (
          <span className="small-count" title={t("Propiedades ocultas")}>
            {hiddenCount}
          </span>
        )}
      </button>
      {open && (
        <CriteriaPopover
          anchor={anchor}
          onClose={() => setOpen(false)}
          width={300}
          // "Show all" / "Hide all" disable themselves when clicked; that
          // must not read as leaving the panel.
          closeOnFocusOutside={false}
          label={t("Propiedades visibles")}
          className="column-visibility"
        >
          <header>
            <strong>{t("Propiedades visibles")}</strong>
            <span>
              {detail.columns.length - hiddenCount} / {detail.columns.length}
            </span>
          </header>
          <label className="column-visibility-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              placeholder={t("Buscar propiedad")}
              aria-label={t("Buscar propiedad")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ul>
            {listed.map((c) => {
              const shown = !hidden.has(c.id) || !canHide(c);
              return (
                <li key={c.id} className={shown ? "" : "is-hidden"}>
                  <span title={c.name}>{c.name}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shown}
                    disabled={!canHide(c)}
                    aria-label={`${t(shown ? "Ocultar" : "Mostrar")} ${c.name}`}
                    title={canHide(c) ? t(shown ? "Ocultar" : "Mostrar") : t("El título siempre se muestra")}
                    onClick={() =>
                      setHidden(
                        shown
                          ? [...prefs.hidden, c.id]
                          : prefs.hidden.filter((id) => id !== c.id),
                      )
                    }
                  >
                    {shown ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                </li>
              );
            })}
            {!listed.length && <li className="muted">{t("Sin coincidencias")}</li>}
          </ul>
          <footer>
            <Button disabled={!hiddenCount} onClick={() => setHidden([])}>
              {t("Mostrar todas")}
            </Button>
            <Button
              disabled={hiddenCount === hideable.length}
              onClick={() => setHidden(hideable.map((c) => c.id))}
            >
              {t("Ocultar todas")}
            </Button>
          </footer>
        </CriteriaPopover>
      )}
    </div>
  );
}

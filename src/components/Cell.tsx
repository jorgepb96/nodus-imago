import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Info } from "lucide-react";
import {
  decodeMultiSelect,
  encodeMultiSelect,
  decodeCheckbox,
} from "../../shared/databases";
import { decodeDatabaseDate } from "../../shared/databaseProperties";
import type { DatabaseColumn } from "../../shared/databases";
import { useT } from "../i18n";
import { MarkdownView } from "./MarkdownView";
import { RichTextEditor } from "./RichTextEditor";
import { LocationCell } from "./LocationCell";
import { HistoricalDateCell } from "./HistoricalDateCell";
import { TextCellPopover } from "./TextCellPopover";
import { HeritageIcon } from "./HeritageIcon";
import { heritageScheme, isHeritageColumn, typology } from "../../shared/heritage";
import { useHeritage } from "../heritageStore";
import { HeritageAddFooter, HeritageOptionMeta } from "./HeritageCellParts";

/** Table text cells that open the expanded editor on click, as in Notion. */
const EXPANDABLE_TYPES = ["title", "text", "rich_text", "ai"];
export function Cell({
  column,
  value,
  onSave,
  compact = false,
  wrap = false,
}: {
  column: DatabaseColumn;
  value: string | null;
  onSave: (v: string | null) => Promise<void>;
  compact?: boolean;
  /** Table cell showing its whole text over several lines. */
  wrap?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? ""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [expanded, setExpanded] = useState<Element | null>(null);
  const t = useT(),
    textareaRef = useRef<HTMLTextAreaElement>(null),
    expandedOpen = useRef(false);
  useEffect(() => setDraft(value ?? ""), [value, column.type]);
  // Enter and the blur that follows both close the editor: save only once.
  const collapse = () => {
    if (!expandedOpen.current) return;
    expandedOpen.current = false;
    setExpanded(null);
    if (draft !== (value ?? "")) void save(draft || null);
  };
  const save = async (v: string | null) => {
    setBusy(true);
    try {
      await onSave(v);
    } finally {
      setBusy(false);
    }
  };
  if (["attachment", "files"].includes(column.type))
    return <span className="muted">{t("Imágenes")}</span>;
  if (["select", "multi_select", "status"].includes(column.type)) {
    const selected =
      column.type === "multi_select"
        ? decodeMultiSelect(value)
        : value
          ? [value]
          : [];
    return (
      <OptionPicker
        column={column}
        selected={selected}
        busy={busy}
        onToggle={(id) =>
          void save(
            column.type === "multi_select"
              ? encodeMultiSelect(
                  selected.includes(id)
                    ? selected.filter((x) => x !== id)
                    : [...selected, id],
                )
              : selected.includes(id)
                ? null
                : id,
          )
        }
      />
    );
  }
  if (column.type === "checkbox")
    return (
      <input
        type="checkbox"
        aria-label={column.name}
        checked={decodeCheckbox(value)}
        disabled={busy}
        onChange={(e) => void save(e.target.checked ? "1" : "0")}
      />
    );
  if (
    [
      "formula",
      "rollup",
      "unique_id",
      "created_time",
      "last_edited_time",
      "created_by",
      "last_edited_by",
      "comparison",
      "button",
      "ai_image",
    ].includes(column.type)
  )
    return <span className="computed">{value ?? "—"}</span>;
  if (column.type === "date")
    return (
      <input
        className="cell-input"
        aria-label={column.name}
        type="date"
        value={decodeDatabaseDate(value)?.start.slice(0, 10) ?? ""}
        disabled={busy}
        onChange={(e) => void save(e.target.value || null)}
      />
    );
  if (column.type === "historical_date")
    return <HistoricalDateCell name={column.name} value={value} onSave={onSave} compact={compact} />;
  if (column.type === "location")
    return (
      <LocationCell
        name={column.name}
        value={value}
        onSave={onSave}
        compact={compact}
      />
    );
  if (!compact && column.type === "rich_text")
    return <RichTextEditor name={column.name} value={value} onSave={onSave} />;
  const displayed = draft;
  const props = {
    className: "cell-input",
    "aria-label": column.name,
    value: displayed,
    disabled: busy,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: () => {
      if (draft !== (value ?? "")) void save(draft || null);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement))
        (e.target as HTMLInputElement).blur();
    },
  };
  if (!compact && ["text", "rich_text", "ai"].includes(column.type)) {
    const wrap = (before: string, after = before) => {
      const element = textareaRef.current;
      const start = element?.selectionStart ?? draft.length,
        end = element?.selectionEnd ?? draft.length,
        selected = draft.slice(start, end) || t("texto");
      setDraft(
        draft.slice(0, start) + before + selected + after + draft.slice(end),
      );
      requestAnimationFrame(() => {
        element?.focus();
        element?.setSelectionRange(
          start + before.length,
          start + before.length + selected.length,
        );
      });
    };
    const prefixLine = (prefix: string) => {
      const element = textareaRef.current,
        start = element?.selectionStart ?? draft.length,
        lineStart = draft.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      setDraft(draft.slice(0, lineStart) + prefix + draft.slice(lineStart));
      requestAnimationFrame(() => {
        element?.focus();
        element?.setSelectionRange(
          start + prefix.length,
          start + prefix.length,
        );
      });
    };
    return (
      <div className="markdown-cell">
        {column.type === "rich_text" && (
          <div
            className="markdown-toolbar"
            role="toolbar"
            aria-label={t("Formato")}
          >
            <button
              type="button"
              aria-label={t("Negrita")}
              title={t("Negrita")}
              onMouseDown={(event) => {
                event.preventDefault();
                wrap("**");
              }}
            >
              <b>B</b>
            </button>
            <button
              type="button"
              aria-label={t("Cursiva")}
              title={t("Cursiva")}
              onMouseDown={(event) => {
                event.preventDefault();
                wrap("*");
              }}
            >
              <i>I</i>
            </button>
            <button
              type="button"
              aria-label={t("Título")}
              title={t("Título")}
              onMouseDown={(event) => {
                event.preventDefault();
                prefixLine("## ");
              }}
            >
              H
            </button>
            <button
              type="button"
              aria-label={t("Lista")}
              title={t("Lista")}
              onMouseDown={(event) => {
                event.preventDefault();
                prefixLine("- ");
              }}
            >
              •
            </button>
            <button
              type="button"
              aria-label={t("Enlace")}
              title={t("Enlace")}
              onMouseDown={(event) => {
                event.preventDefault();
                wrap("[", "](https://)");
              }}
            >
              ↗
            </button>
            <button
              type="button"
              aria-label={t("Código")}
              title={t("Código")}
              onMouseDown={(event) => {
                event.preventDefault();
                wrap("`");
              }}
            >
              &lt;/&gt;
            </button>
            <button
              type="button"
              aria-label={preview ? t("Editar") : t("Vista previa")}
              title={preview ? t("Editar") : t("Vista previa")}
              onClick={() => setPreview(!preview)}
            >
              {preview ? t("Editar") : t("Vista previa")}
            </button>
          </div>
        )}
        {preview ? (
          <MarkdownView text={draft} />
        ) : (
          <textarea {...props} ref={textareaRef} rows={3} />
        )}
      </div>
    );
  }
  if (compact && !wrap && EXPANDABLE_TYPES.includes(column.type))
    return (
      <>
        <input
          {...props}
          type="text"
          onMouseDown={(event) => {
            // A click opens the whole text over the cell; keyboard focus (Tab)
            // still edits in place.
            if (event.button !== 0 || busy) return;
            event.preventDefault();
            expandedOpen.current = true;
            setExpanded(event.currentTarget.closest("td") ?? event.currentTarget);
          }}
        />
        {expanded && (
          <TextCellPopover
            anchor={expanded}
            label={column.name}
            value={draft}
            onChange={setDraft}
            onClose={collapse}
          />
        )}
      </>
    );
  if (wrap && !["number", "time"].includes(column.type))
    return (
      <textarea
        {...props}
        className="cell-input cell-wrap"
        rows={1}
        onKeyDown={(e) => {
          // Enter saves as in a single-line cell; Shift+Enter adds a line.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    );
  return (
    <input
      {...props}
      type={
        column.type === "number"
          ? "number"
          : column.type === "time"
            ? "time"
            : "text"
      }
    />
  );
}

/** Normalised text for option search: case- and accent-insensitive. */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
/** How many matching options the open menu draws at once. */
const OPTION_RENDER_LIMIT = 200;

/**
 * Option list for select-like cells. The menu is only rendered while open: a
 * grid page with a 600-option vocabulary would otherwise mount every option in
 * every row. Large vocabularies get a search box.
 */
function OptionPicker({
  column,
  selected,
  busy,
  onToggle,
}: {
  column: DatabaseColumn;
  selected: string[];
  busy: boolean;
  onToggle: (id: string) => void;
}) {
  const t = useT(),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    picker = useRef<HTMLDetailsElement>(null),
    menu = useRef<HTMLDivElement>(null);
  // Heritage elements carry the icon of their typology.
  const heritage = isHeritageColumn(column),
    elements = useHeritage(heritage ? column.id : null),
    scheme = heritage ? heritageScheme(column.config) : null;
  const labels = new Map(column.options.map((o) => [o.id, o.label]));
  const iconOf = (optionId: string) => {
    if (!scheme) return null;
    const e = elements[optionId];
    return <HeritageIcon name={typology(scheme, e?.group ?? null, e?.type ?? null)?.icon} size={11} className="chip-icon" />;
  };
  // The list floats above the page (top layer), so a table with few rows or
  // a scrolling container never cuts it; it opens upwards when there is no
  // room below.
  useLayoutEffect(() => {
    const node = menu.current,
      anchor = picker.current?.querySelector("summary");
    if (!open || !node || !anchor) return;
    node.setAttribute("popover", "manual");
    node.showPopover?.();
    const place = () => {
      const r = anchor.getBoundingClientRect(),
        h = Math.min(node.scrollHeight, 300),
        below = window.innerHeight - r.bottom - 12;
      node.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - node.offsetWidth - 8))}px`;
      node.style.top =
        below >= h || below >= r.top
          ? `${r.bottom + 5}px`
          : `${Math.max(8, r.top - h - 5)}px`;
    };
    place();
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!node.contains(target) && !picker.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", close);
      if (node.isConnected && node.matches(":popover-open")) node.hidePopover();
    };
  }, [open]);
  const needle = fold(query.trim());
  const matches = open
    ? column.options.filter((o) => !needle || fold(o.label).includes(needle))
    : [];
  // Selected options first, so a long list never hides what the cell holds.
  const ordered = [
    ...matches.filter((o) => selected.includes(o.id)),
    ...matches.filter((o) => !selected.includes(o.id)),
  ];
  return (
    <details
      ref={picker}
      className="option-picker"
      open={open}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open) setQuery("");
      }}
    >
      <summary aria-label={column.name}>
        <span className="chips">
          {selected.length ? (
            column.options
              .filter((o) => selected.includes(o.id))
              .map((o) => (
                <span
                  className="chip"
                  key={o.id}
                  style={
                    { "--chip": o.color ?? "#6366f1" } as React.CSSProperties
                  }
                >
                  {iconOf(o.id)}
                  {o.label}
                </span>
              ))
          ) : (
            <span className="muted">—</span>
          )}
        </span>
      </summary>
      {open && (
        <div className="option-menu" ref={menu}>
          {(column.options.length > 10 || heritage) && (
            <input
              className="option-search"
              type="search"
              autoFocus
              aria-label={t("Buscar opción")}
              placeholder={t("Buscar opción")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {ordered.slice(0, OPTION_RENDER_LIMIT).map((o) => (
            <label key={o.id}>
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                disabled={busy}
                onChange={() => onToggle(o.id)}
              />
              <i style={{ background: o.color ?? "#6366f1" }} />
              {iconOf(o.id)}
              {heritage ? (
                <span className="option-label heritage-option">
                  {o.label}
                  <HeritageOptionMeta optionId={o.id} elements={elements} scheme={scheme!} labels={labels} />
                </span>
              ) : (
                <span className="option-label">{o.label}</span>
              )}
              {column.config.optionLinks?.[o.label.toLocaleLowerCase()] && (
                <button
                  type="button"
                  className="option-info"
                  aria-label={`${t("Más información sobre")} ${o.label}`}
                  data-tooltip={t("Abrir en Wikipedia")}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void window.imago.call("openExternalLink", {
                      url: column.config.optionLinks![o.label.toLocaleLowerCase()],
                    });
                  }}
                >
                  <Info size={13} />
                </button>
              )}
            </label>
          ))}
          {ordered.length > OPTION_RENDER_LIMIT && (
            <p className="muted">
              {(ordered.length - OPTION_RENDER_LIMIT).toLocaleString()}{" "}
              {t("opciones más: escribe para filtrar")}
            </p>
          )}
          {column.options.length > 0 && !ordered.length && (
            <p className="muted">{t("Sin coincidencias")}</p>
          )}
          {!column.options.length && !heritage && (
            <p>
              {t("Añadir opción")}: {t("Propiedades")}
            </p>
          )}
          {heritage && !column.options.some((o) => fold(o.label) === needle) && (
            <HeritageAddFooter
              column={column}
              query={query}
              scheme={scheme!}
              onAdded={(id) => {
                setQuery("");
                if (!selected.includes(id)) onToggle(id);
              }}
            />
          )}
        </div>
      )}
    </details>
  );
}

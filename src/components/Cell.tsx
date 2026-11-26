import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { GripVertical, Info, MoreHorizontal, Trash2 } from "lucide-react";
import {
  decodeMultiSelect,
  encodeMultiSelect,
  decodeCheckbox,
} from "../../shared/databases";
import { decodeDatabaseDate } from "../../shared/databaseProperties";
import type { DatabaseColumn, DatabaseSelectOption } from "../../shared/databases";
import { useT } from "../i18n";
import { MarkdownView } from "./MarkdownView";
import { RichTextEditor } from "./RichTextEditor";
import { LocationCell } from "./LocationCell";
import { HistoricalDateCell } from "./HistoricalDateCell";
import { TextCellPopover } from "./TextCellPopover";
import { HeritageIcon } from "./HeritageIcon";
import { OptionIcon } from "./DatabaseIcon";
import { optionIconValue } from "../../shared/databaseIcons";
import { heritageScheme, isHeritageColumn, typology } from "../../shared/heritage";
import { useHeritage } from "../heritageStore";
import { HeritageAddFooter, HeritageOptionMeta } from "./HeritageCellParts";
import { DEFAULT_OPTION_COLOR, OptionEditMenu, sortOptions, type OptionSort } from "./OptionEditMenu";
import { Button, Modal } from "./ui";

/** Table text cells that open the expanded editor on click, as in Notion. */
const EXPANDABLE_TYPES = ["title", "text", "rich_text", "ai"];
export function Cell({
  column,
  value,
  onSave,
  compact = false,
  wrap = false,
  onOptionsChanged,
}: {
  column: DatabaseColumn;
  value: string | null;
  onSave: (v: string | null) => Promise<void>;
  compact?: boolean;
  /** Table cell showing its whole text over several lines. */
  wrap?: boolean;
  /** Select cells: their options can be renamed, recoloured, reordered and
   * deleted from the list; called once the column's options changed. */
  onOptionsChanged?: () => void;
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
        onOptionsChanged={onOptionsChanged}
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
/**
 * The options of a select property: a chip list that opens a searchable
 * menu where options are chosen, renamed, coloured, given an icon, ordered
 * and deleted. `floating` shows the menu alone, already open with its search
 * focused (the visual tag picker beside a region): a click or Enter picks an
 * option, Enter with no exact match creates one, Escape closes.
 */
export function OptionPicker({
  column,
  selected,
  busy,
  onToggle,
  onOptionsChanged,
  floating,
}: {
  column: DatabaseColumn;
  selected: string[];
  busy: boolean;
  onToggle: (id: string) => void;
  onOptionsChanged?: () => void;
  floating?: {
    onPick: (id: string) => void;
    onCreate: (label: string) => void;
    onClose: () => void;
    placeholder?: string;
    /** A dictionary: another select property whose terms are offered too (picked by their own id). */
    extra?: { title: string; column: DatabaseColumn };
  };
}) {
  const t = useT(),
    isFloating = !!floating,
    [open, setOpen] = useState(isFloating),
    [active, setActive] = useState(0),
    [query, setQuery] = useState(""),
    picker = useRef<HTMLDetailsElement>(null),
    menu = useRef<HTMLDivElement>(null);
  // Option editing: the «···» menu of one option, the deletion waiting for
  // confirmation, the option being dragged and where it would land.
  const [editing, setEditing] = useState<string | null>(null),
    [deleting, setDeleting] = useState<DatabaseSelectOption | null>(null),
    [deleteBusy, setDeleteBusy] = useState(false),
    [editError, setEditError] = useState<string | null>(null),
    [dragged, setDragged] = useState<string | null>(null),
    [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null),
    editAnchor = useRef<HTMLElement | null>(null);
  // Heritage elements carry the icon of their typology.
  const heritage = isHeritageColumn(column),
    elements = useHeritage(heritage ? column.id : null),
    scheme = heritage ? heritageScheme(column.config) : null;
  const labels = new Map(column.options.map((o) => [o.id, o.label]));
  // Heritage elements show their typology; other options the icon chosen for them.
  const iconOf = (optionId: string) => {
    if (!scheme) return <OptionIcon value={optionIconValue(column.config, optionId)} size={11} />;
    const e = elements[optionId];
    return <HeritageIcon name={typology(scheme, e?.group ?? null, e?.type ?? null)?.icon} size={11} className="chip-icon" />;
  };
  // The list floats above the page (top layer), so a table with few rows or
  // a scrolling container never cuts it; it opens upwards when there is no
  // room below.
  useLayoutEffect(() => {
    const node = menu.current,
      anchor = picker.current?.querySelector("summary");
    if (isFloating || !open || !node || !anchor) return;
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
  }, [open, isFloating]);
  // Heritage options are elements with their own records, edited elsewhere.
  const editable = !!onOptionsChanged && !heritage && !!column.id;
  // Edits run one after another on a working copy of the options, so a rename
  // followed at once by a colour never saves over it with the stale list.
  // A new order shows at once, while it is saved: kept until the column's
  // options come back from the database.
  const [pending, setPending] = useState<{ order: string[]; sort: OptionSort } | null>(null);
  useEffect(() => setPending(null), [column.options, column.config]);
  // The list's order: by hand (positions) or by name, chosen in «···».
  const sort: OptionSort = pending?.sort ?? column.config.optionSort ?? "manual";
  const shown = (options: DatabaseSelectOption[]) => {
    if (!pending) return sortOptions(options, sort);
    const at = new Map(pending.order.map((id, i) => [id, i]));
    return [...options].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity));
  };
  const working = useRef<DatabaseSelectOption[]>([]),
    workingConfig = useRef(column.config),
    queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    working.current = sortOptions(column.options);
    workingConfig.current = column.config;
  }, [column.options, column.config]);
  const enqueue = (work: () => Promise<void>) => {
    const run = queue.current.then(async () => {
      await work();
      onOptionsChanged?.();
    });
    queue.current = run.catch(() => undefined);
    return run;
  };
  const saveList = async (next: DatabaseSelectOption[], dropFromCells = false) => {
    await window.imago.call("saveOptions", {
      columnId: column.id,
      options: next.map(({ id, label, color }) => ({ id, label, color })),
      ...(dropFromCells ? { dropFromCells } : {}),
    });
    working.current = next.map((o, position) => ({ ...o, position }));
  };
  const saveConfig = async (change: Partial<DatabaseColumn["config"]>) => {
    const config = { ...workingConfig.current, ...change };
    await window.imago.call("updateColumn", { id: column.id, config });
    workingConfig.current = config;
  };
  const saveSort = (optionSort: OptionSort) => saveConfig({ optionSort });
  // Option icons live in the column's config, keyed by option id.
  const saveIcon = (id: string, icon: string | null) => {
    const icons = { ...(workingConfig.current.optionIcons ?? {}) };
    if (icon) icons[id] = icon;
    else delete icons[id];
    return saveConfig({ optionIcons: icons });
  };
  const edit = (change: (list: DatabaseSelectOption[]) => DatabaseSelectOption[], dropFromCells = false) =>
    enqueue(() => saveList(change(working.current), dropFromCells));
  const patch = (id: string, change: Partial<DatabaseSelectOption>) =>
    edit((list) => list.map((o) => (o.id === id ? { ...o, ...change } : o)));
  // A name order also rewrites the positions, so every other list (filters,
  // properties) follows it; manual keeps the positions as they are.
  const chooseSort = (next: OptionSort) => {
    setPending({ order: sortOptions(column.options, next === "manual" ? sort : next).map((o) => o.id), sort: next });
    return enqueue(async () => {
      if (next !== "manual") await saveList(sortOptions(working.current, next));
      await saveSort(next);
    }).catch((e) => {
      setPending(null);
      throw e;
    });
  };
  // Dragging places the option among those shown, and the order becomes manual.
  const move = (id: string, target: string, after: boolean) => {
    if (id === target) return;
    setEditError(null);
    const list = shown(column.options);
    const moving = list.find((o) => o.id === id);
    const rest = list.filter((o) => o.id !== id);
    const at = rest.findIndex((o) => o.id === target);
    if (!moving || at < 0) return;
    rest.splice(after ? at + 1 : at, 0, moving);
    const order = rest.map((o) => o.id);
    setPending({ order, sort: "manual" });
    enqueue(async () => {
      // The working copy holds any edit saved since (a new colour, a name).
      // Any option added meanwhile goes last instead of being dropped.
      const byId = new Map(working.current.map((o) => [o.id, o]));
      const placed = order.map((oid) => byId.get(oid)).filter((o): o is DatabaseSelectOption => !!o);
      await saveList([...placed, ...working.current.filter((o) => !order.includes(o.id))]);
      if ((workingConfig.current.optionSort ?? "manual") !== "manual") await saveSort("manual");
    }).catch((e) => {
      setPending(null);
      setEditError(e instanceof Error ? e.message : String(e));
    });
  };
  const needle = fold(query.trim());
  const matches = open
    ? shown(column.options).filter((o) => !needle || fold(o.label).includes(needle))
    : [];
  // An editable list keeps its own order, the one its options are dragged
  // into, and is drawn whole however long it is (the cell's chips already show
  // what it holds). While searching, and where options cannot be edited, the
  // selected ones come first and a long list is drawn in part.
  const reorderable = editable && !needle;
  const limit = reorderable ? Infinity : OPTION_RENDER_LIMIT;
  const ordered = reorderable
    ? matches
    : [
        ...matches.filter((o) => selected.includes(o.id)),
        ...matches.filter((o) => !selected.includes(o.id)),
      ];
  const editingOption = editing ? column.options.find((o) => o.id === editing) : undefined;
  // Floating: Enter picks the exact match, or the one moved to with the
  // arrows, and creates the tag when none matches exactly.
  const typed = query.trim();
  // The dictionary's terms not yet among the options, matching the search.
  const extraColumn = floating?.extra?.column ?? null;
  const ownLabels = new Set(column.options.map((o) => fold(o.label)));
  const extraList = extraColumn
    ? sortOptions(extraColumn.options, extraColumn.config.optionSort ?? "manual").filter((o) => !ownLabels.has(fold(o.label)) && (!needle || fold(o.label).includes(needle)))
    : [];
  const choices = [...ordered, ...extraList];
  const exact = choices.find((o) => fold(o.label) === fold(typed));
  // The highlighted row: an option (0…) or «Create …» (-1).
  const canCreate = !!typed && !exact;
  const onFloatingKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!floating) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      floating.onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(choices.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(canCreate ? -1 : 0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active === -1 && canCreate) floating.onCreate(typed);
      else if (choices[active]) floating.onPick(choices[active].id);
      else if (canCreate) floating.onCreate(typed);
    }
  };
  // Typing highlights the exact match, else «Create …», else the first option.
  const exactIndex = exact ? choices.findIndex((o) => o.id === exact.id) : -1;
  useEffect(() => setActive(exactIndex >= 0 ? exactIndex : typed ? -1 : 0), [typed, exactIndex]);
  return (
    <>
    {floating ? (
      <div className="option-menu tag-picker" ref={menu} data-testid="tag-picker" role="dialog" aria-label={t("Etiqueta de la región")}>
        <input
          className="option-search"
          type="search"
          autoFocus
          aria-label={t("Buscar o crear etiqueta")}
          placeholder={floating.placeholder ?? t("Buscar o crear etiqueta…")}
          value={query}
          data-testid="tag-picker-input"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onFloatingKey}
        />
        {editError && <p className="annotation-error" role="alert">{t(editError)}</p>}
        {typed && !exact && (
          <button
            type="button"
            className={`tag-picker-create${active === -1 ? " is-active" : ""}`}
            data-testid="tag-picker-create"
            onClick={() => floating.onCreate(typed)}
          >
            {t("Crear «{tag}»").replace("{tag}", typed)} <kbd>↵</kbd>
          </button>
        )}
        <div className="tag-picker-list">
          {ordered.slice(0, 200).map((o, i) => (
            <div key={o.id} className={`option-row${editable ? " is-editable" : ""}${i === active ? " is-active" : ""}`} data-testid="tag-picker-option">
              <button type="button" className="tag-picker-choice" onMouseEnter={() => setActive(i)} onClick={() => floating.onPick(o.id)}>
                <i style={{ background: o.color ?? DEFAULT_OPTION_COLOR }} />
                {iconOf(o.id)}
                <span className="option-label">{o.label}</span>
              </button>
              {editable && (
                <button
                  type="button"
                  className={`option-more${editing === o.id ? " is-open" : ""}`}
                  aria-label={`${t("Editar opción")} ${o.label}`}
                  aria-expanded={editing === o.id}
                  onClick={(e) => {
                    editAnchor.current = e.currentTarget;
                    setEditError(null);
                    setEditing(editing === o.id ? null : o.id);
                  }}
                >
                  <MoreHorizontal size={15} />
                </button>
              )}
            </div>
          ))}
          {extraList.length > 0 && extraColumn && (
            <>
              <p className="tag-picker-group">{floating.extra!.title}</p>
              {extraList.slice(0, 300).map((o, j) => {
                const i = ordered.length + j;
                return (
                  <div key={o.id} className={`option-row is-dictionary${i === active ? " is-active" : ""}`} data-testid="tag-picker-term">
                    <button type="button" className="tag-picker-choice" onMouseEnter={() => setActive(i)} onClick={() => floating.onPick(o.id)}>
                      <i style={{ background: o.color ?? DEFAULT_OPTION_COLOR }} />
                      <OptionIcon value={optionIconValue(extraColumn.config, o.id)} size={11} />
                      <span className="option-label">{o.label}</span>
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
        {!typed && !column.options.length && <p className="muted">{t("Escribe el nombre de la primera etiqueta y pulsa Intro.")}</p>}
        {editingOption && (
          <OptionEditMenu
            anchor={editAnchor as React.RefObject<HTMLElement>}
            option={editingOption}
            icon={optionIconValue(column.config, editingOption.id)}
            onIcon={(icon) => enqueue(() => saveIcon(editingOption.id, icon))}
            sort={sort}
            onSort={chooseSort}
            onClose={() => setEditing(null)}
            onRename={(label) => patch(editingOption.id, { label })}
            onColor={(color) => patch(editingOption.id, { color })}
            onDelete={() => {
              setDeleting(editingOption);
              setEditing(null);
            }}
          />
        )}
      </div>
    ) : (
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
            shown(column.options)
              .filter((o) => selected.includes(o.id))
              .map((o) => (
                <span
                  className="chip"
                  key={o.id}
                  style={
                    { "--chip": o.color ?? DEFAULT_OPTION_COLOR } as React.CSSProperties
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
          {editError && <p className="annotation-error" role="alert">{t(editError)}</p>}
          {ordered.slice(0, limit).map((o) => (
            <div
              key={o.id}
              className={`option-row${editable ? " is-editable" : ""}${dragged === o.id ? " is-dragged" : ""}${
                dropAt?.id === o.id ? (dropAt.after ? " drop-after" : " drop-before") : ""
              }`}
              onDragOver={(e) => {
                if (!dragged || dragged === o.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const r = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                if (dropAt?.id !== o.id || dropAt.after !== after) setDropAt({ id: o.id, after });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt((d) => (d?.id === o.id ? null : d));
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged && dropAt) move(dragged, dropAt.id, dropAt.after);
                setDragged(null);
                setDropAt(null);
              }}
            >
              {reorderable && (
                <span
                  className="option-grip"
                  draggable
                  aria-hidden="true"
                  data-tooltip={t("Arrastra para cambiar la posición")}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", o.label);
                    const row = e.currentTarget.parentElement;
                    if (row) e.dataTransfer.setDragImage(row, 12, row.offsetHeight / 2);
                    setDragged(o.id);
                  }}
                  onDragEnd={() => {
                    setDragged(null);
                    setDropAt(null);
                  }}
                >
                  <GripVertical size={14} />
                </span>
              )}
            <label>
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                disabled={busy}
                onChange={() => onToggle(o.id)}
              />
              <i style={{ background: o.color ?? DEFAULT_OPTION_COLOR }} />
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
              {editable && (
                <button
                  type="button"
                  className={`option-more${editing === o.id ? " is-open" : ""}`}
                  aria-label={`${t("Editar opción")} ${o.label}`}
                  aria-expanded={editing === o.id}
                  onClick={(e) => {
                    editAnchor.current = e.currentTarget;
                    setEditError(null);
                    setEditing(editing === o.id ? null : o.id);
                  }}
                >
                  <MoreHorizontal size={15} />
                </button>
              )}
            </div>
          ))}
          {editingOption && (
            <OptionEditMenu
              anchor={editAnchor as React.RefObject<HTMLElement>}
              option={editingOption}
              icon={optionIconValue(column.config, editingOption.id)}
              onIcon={(icon) => enqueue(() => saveIcon(editingOption.id, icon))}
              sort={sort}
              onSort={chooseSort}
              onClose={() => setEditing(null)}
              onRename={(label) => patch(editingOption.id, { label })}
              onColor={(color) => patch(editingOption.id, { color })}
              onDelete={() => {
                setDeleting(editingOption);
                setEditing(null);
                setOpen(false);
              }}
            />
          )}
          {ordered.length > limit && (
            <p className="muted">
              {(ordered.length - limit).toLocaleString()}{" "}
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
    )}
    {deleting && (
      <Modal icon={Trash2} title={t("Eliminar opción")} onClose={() => !deleteBusy && setDeleting(null)}>
        <div className="modal-body">
          <h3>{deleting.label}</h3>
          <p>
            {t("¿Eliminar esta opción? Se quitará de todos los registros que la tienen. Esta operación no se puede deshacer.")}
          </p>
          {editError && <p className="annotation-error" role="alert">{t(editError)}</p>}
        </div>
        <footer>
          <Button disabled={deleteBusy} onClick={() => setDeleting(null)}>
            {t("Cancelar")}
          </Button>
          <Button
            className="danger"
            disabled={deleteBusy}
            aria-busy={deleteBusy}
            onClick={() => {
              setDeleteBusy(true);
              setEditError(null);
              edit((list) => list.filter((o) => o.id !== deleting.id), true)
                .then(() =>
                  workingConfig.current.optionIcons?.[deleting.id]
                    ? enqueue(() => saveIcon(deleting.id, null))
                    : undefined,
                )
                .then(() => setDeleting(null))
                .catch((e) => setEditError(e instanceof Error ? e.message : String(e)))
                .finally(() => setDeleteBusy(false));
            }}
          >
            <Trash2 size={14} />
            {t("Eliminar")}
          </Button>
        </footer>
      </Modal>
    )}
    </>
  );
}

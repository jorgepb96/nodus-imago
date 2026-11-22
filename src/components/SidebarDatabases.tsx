// The databases listed in the sidebar: open one with a click, rename it in
// place (double click or F2), change its icon, and put them in any order by
// dragging (or Alt+↑/↓ from the keyboard). A menu (right click, the menu key
// or the «⋯» on hover) gathers every action.
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, MoreHorizontal, Palette, Pencil, Settings2 } from "lucide-react";
import type { DatabaseSummary } from "../../shared/databases";
import { useT } from "../i18n";
import { CriteriaPopover } from "./CriteriaSelect";
import { DatabaseIcon, DatabaseIconPicker } from "./DatabaseIcon";

type Side = "before" | "after";

/** `ids` with `id` moved before or after `target`. */
export function moveDatabaseId(ids: readonly string[], id: string, target: string, side: Side): string[] {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return [...ids];
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(target) + (side === "after" ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export function SidebarDatabases({
  databases,
  activeId,
  onOpen,
  onRename,
  onIcon,
  onReorder,
  onEdit,
}: {
  databases: DatabaseSummary[];
  /** The database on screen, if any. */
  activeId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onIcon: (id: string, icon: string | null) => Promise<void>;
  onReorder: (ids: string[]) => Promise<void>;
  /** The full dialog: name, icon and kind. */
  onEdit: (id: string) => void;
}) {
  const t = useT();
  // The order just chosen, shown at once until the list comes back in it.
  const [pending, setPending] = useState<string[] | null>(null);
  useEffect(() => setPending(null), [databases]);
  const byId = new Map(databases.map((d) => [d.id, d]));
  const ordered = pending
    ? [...pending.flatMap((id) => byId.get(id) ?? []), ...databases.filter((d) => !pending.includes(d.id))]
    : databases;
  const ids = ordered.map((d) => d.id);

  const [renaming, setRenaming] = useState<string | null>(null),
    [draft, setDraft] = useState(""),
    [menu, setMenu] = useState<string | null>(null),
    [iconFor, setIconFor] = useState<string | null>(null),
    [dragId, setDragId] = useState<string | null>(null),
    [drop, setDrop] = useState<{ id: string; side: Side } | null>(null);
  const anchors = useRef(new Map<string, HTMLElement>()),
    anchor = useRef<HTMLElement>(null as unknown as HTMLElement);
  const anchorAt = (id: string) => {
    anchor.current = anchors.current.get(id) ?? anchor.current;
  };

  const reorder = (next: string[]) => {
    if (next.join() === ids.join()) return;
    setPending(next);
    void onReorder(next).catch(() => setPending(null));
  };
  const move = (id: string, by: -1 | 1) => {
    const at = ids.indexOf(id),
      neighbour = ids[at + by];
    if (neighbour) reorder(moveDatabaseId(ids, id, neighbour, by < 0 ? "before" : "after"));
  };
  const startRename = (d: DatabaseSummary) => {
    setMenu(null);
    setDraft(d.name);
    setRenaming(d.id);
  };
  const finishRename = (id: string, save: boolean) => {
    const name = draft.trim(),
      before = byId.get(id)?.name;
    setRenaming(null);
    if (save && name && name !== before) void onRename(id, name);
    // Focus back on the item, for the keyboard.
    requestAnimationFrame(() => anchors.current.get(id)?.focus());
  };
  const openMenu = (id: string) => {
    anchorAt(id);
    setIconFor(null);
    setMenu(id);
  };

  const menuDb = menu ? byId.get(menu) : undefined,
    iconDb = iconFor ? byId.get(iconFor) : undefined;
  return (
    <>
      {ordered.map((d) =>
        renaming === d.id ? (
          <form
            key={d.id}
            className="sidebar-db-rename"
            onSubmit={(event) => {
              event.preventDefault();
              finishRename(d.id, true);
            }}
          >
            <DatabaseIcon icon={d.icon} kind={d.kind} size={15} />
            <input
              autoFocus
              value={draft}
              maxLength={200}
              aria-label={t("Nombre de la base de datos")}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => finishRename(d.id, true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  finishRename(d.id, false);
                }
              }}
            />
          </form>
        ) : (
          <button
            key={d.id}
            ref={(node) => {
              if (node) anchors.current.set(d.id, node);
              else anchors.current.delete(d.id);
            }}
            title={d.name}
            className={[
              activeId === d.id && "active",
              dragId === d.id && "dragging",
              drop?.id === d.id && `drop-${drop.side}`,
              menu === d.id && "menu-open",
            ]
              .filter(Boolean)
              .join(" ")}
            data-database-id={d.id}
            aria-haspopup="menu"
            draggable
            onClick={(event) => {
              if ((event.target as HTMLElement).closest(".sidebar-db-more")) return openMenu(d.id);
              onOpen(d.id);
            }}
            onDoubleClick={(event) => {
              if ((event.target as HTMLElement).closest(".sidebar-db-more")) return;
              startRename(d);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(d.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "F2") {
                event.preventDefault();
                startRename(d);
              } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault();
                openMenu(d.id);
              } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                event.preventDefault();
                move(d.id, event.key === "ArrowUp" ? -1 : 1);
                requestAnimationFrame(() => anchors.current.get(d.id)?.focus());
              }
            }}
            onDragStart={(event) => {
              setDragId(d.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", d.name);
            }}
            onDragEnd={() => {
              setDragId(null);
              setDrop(null);
            }}
            onDragOver={(event) => {
              if (!dragId || dragId === d.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const box = event.currentTarget.getBoundingClientRect(),
                side: Side = event.clientY < box.top + box.height / 2 ? "before" : "after";
              if (drop?.id !== d.id || drop.side !== side) setDrop({ id: d.id, side });
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragId && drop) reorder(moveDatabaseId(ids, dragId, drop.id, drop.side));
              setDragId(null);
              setDrop(null);
            }}
          >
            <DatabaseIcon icon={d.icon} kind={d.kind} size={15} />
            <span className="nav-title">{d.name}</span>
            <small>{d.rowCount.toLocaleString()}</small>
            <span className="sidebar-db-more" aria-hidden="true" data-tooltip={t("Opciones de la base de datos")}>
              <MoreHorizontal size={14} />
            </span>
          </button>
        ),
      )}
      {menuDb && (
        <CriteriaPopover
          anchor={anchor}
          onClose={() => setMenu(null)}
          width={230}
          label={t("Opciones de la base de datos")}
          className="sidebar-db-menu"
        >
          <button type="button" data-testid="sidebar-db-rename" onClick={() => startRename(menuDb)}>
            <Pencil size={14} />
            <span>{t("Cambiar nombre")}</span>
            <kbd>F2</kbd>
          </button>
          <button
            type="button"
            data-testid="sidebar-db-icon"
            onClick={() => {
              setMenu(null);
              setIconFor(menuDb.id);
            }}
          >
            <Palette size={14} />
            <span>{t("Cambiar icono")}</span>
          </button>
          <button
            type="button"
            disabled={ids[0] === menuDb.id}
            onClick={() => {
              move(menuDb.id, -1);
              setMenu(null);
            }}
          >
            <ArrowUp size={14} />
            <span>{t("Subir")}</span>
            <kbd>Alt ↑</kbd>
          </button>
          <button
            type="button"
            disabled={ids[ids.length - 1] === menuDb.id}
            onClick={() => {
              move(menuDb.id, 1);
              setMenu(null);
            }}
          >
            <ArrowDown size={14} />
            <span>{t("Bajar")}</span>
            <kbd>Alt ↓</kbd>
          </button>
          <hr />
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              onEdit(menuDb.id);
            }}
          >
            <Settings2 size={14} />
            <span>{t("Nombre, icono y tipo")}…</span>
          </button>
          <p className="hint">{t("Arrastra las bases de datos para cambiar su orden.")}</p>
        </CriteriaPopover>
      )}
      {iconDb && (
        <CriteriaPopover
          anchor={anchor}
          onClose={() => setIconFor(null)}
          width={340}
          label={t("Icono de la base de datos")}
          className="sidebar-db-icon-popover"
        >
          <header>
            <strong>{t("Icono de la base de datos")}</strong>
          </header>
          <DatabaseIconPicker value={iconDb.icon} kind={iconDb.kind} onChange={(icon) => void onIcon(iconDb.id, icon)} />
        </CriteriaPopover>
      )}
    </>
  );
}

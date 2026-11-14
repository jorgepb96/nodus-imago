// The chat history, adapted from Nodus Research's: tools, search, then the
// folders (with subfolders), the highlighted chats and the other chats.
// Chats move between folders from their menu, by dragging them onto a
// folder or with the multiple selection.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArrowLeft,
  Bookmark,
  BookOpen,
  Building2,
  Calendar,
  Camera,
  Castle,
  Check,
  ChevronRight,
  Church,
  Clock,
  Film,
  Flag,
  FlaskConical,
  Folder,
  FolderInput,
  FolderPlus,
  Globe,
  Image,
  Images,
  Landmark,
  Lightbulb,
  ListChecks,
  Map as MapIcon,
  MapPin,
  Minus,
  MoreVertical,
  Newspaper,
  Palette,
  Pencil,
  Pin,
  Plus,
  Search,
  Ship,
  SquarePen,
  Star,
  Tag,
  Trash2,
  TrainFront,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ChatConversationSummary, ChatFolder } from "../../../shared/chat";
import { useT } from "../../i18n";

export const FOLDER_COLORS = ["#737373", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];
export const FOLDER_ICONS: Record<string, LucideIcon> = {
  folder: Folder, images: Images, image: Image, camera: Camera, film: Film, newspaper: Newspaper,
  book: BookOpen, bookmark: Bookmark, map: MapIcon, pin: MapPin, globe: Globe, landmark: Landmark,
  building: Building2, church: Church, castle: Castle, ship: Ship, train: TrainFront, users: Users,
  calendar: Calendar, clock: Clock, tag: Tag, star: Star, flag: Flag, flask: FlaskConical,
  lightbulb: Lightbulb, archive: Archive, palette: Palette,
};
const FolderIcon = ({ folder, size = 15 }: { folder: Pick<ChatFolder, "icon" | "color">; size?: number }) => {
  const Icon = FOLDER_ICONS[folder.icon ?? "folder"] ?? Folder;
  return (
    <span className="shrink-0" style={{ color: folder.color ?? undefined, display: "inline-flex" }}>
      <Icon size={size} />
    </span>
  );
};

export function useRelativeTime() {
  const t = useT();
  return (iso: string) => {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const minutes = Math.round((Date.now() - then) / 60000);
    if (minutes < 1) return t("ahora");
    if (minutes < 60) return t("hace {n} min").replace("{n}", String(minutes));
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t("hace {n} h").replace("{n}", String(hours));
    const days = Math.round(hours / 24);
    if (days < 7) return t("hace {n} d").replace("{n}", String(days));
    return new Date(iso).toLocaleDateString(document.documentElement.lang === "en" ? "en-GB" : "es-ES");
  };
}

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
const CHAT_DRAG = "application/x-imago-chat";
const FOLDER_DRAG = "application/x-imago-chat-folder";

type Row =
  | { kind: "header"; id: string; label: string }
  | { kind: "folder"; folder: ChatFolder; depth: number; expanded: boolean; count: number; hasChildren: boolean }
  | { kind: "chat"; conversation: ChatConversationSummary; depth: number; key: string }
  | { kind: "empty"; id: string; label: string };

export type ChatSidebarProps = {
  conversations: ChatConversationSummary[];
  folders: ChatFolder[];
  activeId: string | null;
  runningIds: ReadonlySet<string>;
  archivedCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
  onNewConversation: (folderId?: string | null) => void;
  onOpenConversation: (id: string) => void;
  onRename: (conversation: ChatConversationSummary, title: string) => Promise<void>;
  onPin: (conversation: ChatConversationSummary, pinned: boolean) => Promise<void>;
  onArchive: (conversations: ChatConversationSummary[], archived: boolean) => Promise<void>;
  onDelete: (conversations: ChatConversationSummary[]) => void;
  onMove: (conversations: ChatConversationSummary[], folderId: string | null) => Promise<void>;
  onFolderSave: (input: { id?: string; parentId?: string | null; name?: string; color?: string | null; icon?: string | null }) => Promise<ChatFolder>;
  onFolderDelete: (folder: ChatFolder) => void;
};

/** Folders in tree order with their depth. */
export function folderOutline(folders: ChatFolder[], parentId: string | null = null, depth = 0): { folder: ChatFolder; depth: number }[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }))
    .flatMap((folder) => [{ folder, depth }, ...folderOutline(folders, folder.id, depth + 1)]);
}

export function ChatSidebar(props: ChatSidebarProps) {
  const t = useT(),
    relative = useRelativeTime();
  const { conversations, folders, activeId, runningIds } = props;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<
    | { kind: "chat"; conversation: ChatConversationSummary; row: string; anchor: DOMRect }
    | { kind: "folder"; folder: ChatFolder; anchor: DOMRect }
    | null
  >(null);
  const [styling, setStyling] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const anchorId = useRef<string | null>(null);
  const [moveMenu, setMoveMenu] = useState<DOMRect | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const inFolder = (c: ChatConversationSummary) => !!c.folderId && folderById.has(c.folderId);

  const run = (action: () => Promise<unknown>) => {
    setNotice(null);
    void action().catch((reason: unknown) => setNotice(t(reason instanceof Error ? reason.message : String(reason))));
  };

  const rows = useMemo<Row[]>(() => {
    const needle = fold(query.trim());
    const out: Row[] = [];
    if (needle) {
      const matchedFolders = folders.filter((f) => fold(f.name).includes(needle));
      const matchedChats = conversations.filter(
        (c) => fold(c.title).includes(needle) || (c.folderId && fold(folderById.get(c.folderId)?.name ?? "").includes(needle)),
      );
      if (matchedFolders.length)
        out.push(
          { kind: "header", id: "h-folders", label: t("Carpetas") },
          ...matchedFolders.map((folder) => ({ kind: "folder" as const, folder, depth: 0, expanded: false, count: 0, hasChildren: false })),
        );
      if (matchedChats.length)
        out.push(
          { kind: "header", id: "h-chats", label: t("Chats") },
          ...matchedChats.map((conversation) => ({ kind: "chat" as const, conversation, depth: 0, key: `s:${conversation.id}` })),
        );
      if (!out.length) out.push({ kind: "empty", id: "none", label: t("Sin resultados") });
      return out;
    }
    const chatsIn = new Map<string, ChatConversationSummary[]>();
    for (const c of conversations) if (inFolder(c)) chatsIn.set(c.folderId!, [...(chatsIn.get(c.folderId!) ?? []), c]);
    const total = (id: string): number =>
      (chatsIn.get(id)?.length ?? 0) + folders.filter((f) => f.parentId === id).reduce((n, f) => n + total(f.id), 0);
    if (folders.length) {
      out.push({ kind: "header", id: "h-folders", label: t("Carpetas") });
      const walk = (parentId: string | null, depth: number) => {
        for (const { folder } of folderOutline(folders, parentId).filter((entry) => entry.depth === 0)) {
          const open = expanded.has(folder.id);
          const hasChildren = folders.some((f) => f.parentId === folder.id) || !!chatsIn.get(folder.id)?.length;
          out.push({ kind: "folder", folder, depth, expanded: open, count: total(folder.id), hasChildren });
          if (!open) continue;
          walk(folder.id, depth + 1);
          for (const conversation of chatsIn.get(folder.id) ?? [])
            out.push({ kind: "chat", conversation, depth: depth + 1, key: `f:${conversation.id}` });
        }
      };
      walk(null, 0);
    }
    const pinned = conversations
      .filter((c) => c.pinnedAt && !c.archived)
      .sort((a, b) => (a.pinnedAt ?? "").localeCompare(b.pinnedAt ?? ""));
    if (pinned.length)
      out.push(
        { kind: "header", id: "h-pinned", label: t("Chats destacados") },
        ...pinned.map((conversation) => ({ kind: "chat" as const, conversation, depth: 0, key: `p:${conversation.id}` })),
      );
    const rest = conversations.filter((c) => !(c.pinnedAt && !c.archived) && !inFolder(c));
    if (rest.length) {
      if (out.length) out.push({ kind: "header", id: "h-chats", label: t("Chats") });
      out.push(...rest.map((conversation) => ({ kind: "chat" as const, conversation, depth: 0, key: `c:${conversation.id}` })));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, conversations, folders, folderById, expanded, t]);

  const chatOrder = useMemo(() => [...new Set(rows.flatMap((r) => (r.kind === "chat" ? [r.conversation.id] : [])))], [rows]);
  const selected = conversations.filter((c) => selectedIds.has(c.id));
  const allSelected = chatOrder.length > 0 && chatOrder.every((id) => selectedIds.has(id));
  const allArchived = selected.length > 0 && selected.every((c) => c.archived);
  const toggleSelected = (id: string, range: boolean) => {
    const anchor = anchorId.current;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (range && anchor && anchor !== id && chatOrder.includes(anchor) && chatOrder.includes(id)) {
        const [from, to] = [chatOrder.indexOf(anchor), chatOrder.indexOf(id)].sort((a, b) => a - b);
        for (const chat of chatOrder.slice(from, to + 1)) next.add(chat);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!range) anchorId.current = id;
  };
  const endSelection = () => {
    setSelecting(false);
    setSelectedIds(new Set());
    anchorId.current = null;
    setMoveMenu(null);
  };
  const toggleFolder = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const newFolder = (parentId: string | null) =>
    run(async () => {
      const created = await props.onFolderSave({ parentId, name: t("Nueva carpeta") });
      setQuery("");
      if (parentId) setExpanded((current) => new Set([...current, parentId]));
      setRenaming(`folder:${created.id}`);
    });

  // Dragging a chat onto a folder files it there; onto the list, out of its folder.
  const dropProps = (folderId: string | null) => ({
    onDragOver: (event: DragEvent) => {
      const types = event.dataTransfer.types;
      if (!types.includes(CHAT_DRAG) && !types.includes(FOLDER_DRAG)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(folderId ?? "root");
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget((current) => (current === (folderId ?? "root") ? null : current));
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      const chatId = event.dataTransfer.getData(CHAT_DRAG),
        movedFolder = event.dataTransfer.getData(FOLDER_DRAG);
      if (chatId) {
        const conversation = conversations.find((c) => c.id === chatId);
        if (conversation && (conversation.folderId ?? null) !== folderId) run(() => props.onMove([conversation], folderId));
        if (folderId) setExpanded((current) => new Set([...current, folderId]));
      } else if (movedFolder && movedFolder !== folderId) run(() => props.onFolderSave({ id: movedFolder, parentId: folderId }));
    },
  });

  const menuFolder = menu?.kind === "folder" ? menu.folder : null;
  const stylingFolder = styling ? folderById.get(styling) : undefined;
  return (
    <>
      <div className="research-chat-history-tools">
        <div className="chat-history-tool-row">
          <button type="button" className="research-chat-history-tool" data-testid="chat-new-conversation" onClick={() => props.onNewConversation(null)} aria-label={t("Nueva conversación")} data-tooltip={t("Nueva conversación")}>
            <Plus size={16} />
          </button>
          <button type="button" className="research-chat-history-tool" data-testid="chat-new-folder" onClick={() => newFolder(null)} aria-label={t("Nueva carpeta")} data-tooltip={t("Nueva carpeta")}>
            <FolderPlus size={16} />
          </button>
          {conversations.length > 0 && (
            <button
              type="button"
              className={`research-chat-history-tool push ${selecting ? "is-on" : ""}`}
              data-testid="chat-select-mode"
              aria-pressed={selecting}
              onClick={() => (selecting ? endSelection() : setSelecting(true))}
              aria-label={selecting ? t("Terminar selección") : t("Seleccionar varios chats")}
              data-tooltip={selecting ? t("Terminar selección") : t("Seleccionar varios chats")}
            >
              <ListChecks size={16} />
            </button>
          )}
        </div>
        <label className="research-chat-search">
          <Search size={14} aria-hidden="true" />
          <input
            data-testid="chat-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Buscar…")}
            aria-label={t("Buscar en el historial")}
          />
        </label>
        {selecting && (
          <div className="research-chat-selection" role="toolbar" aria-label={t("Chats seleccionados")}>
            <div className="research-chat-selection-row">
              <button
                type="button"
                className="research-chat-selection-count"
                aria-pressed={allSelected}
                data-tooltip={allSelected ? t("Quitar la selección") : t("Seleccionar todos")}
                onClick={() => {
                  setSelectedIds(allSelected ? new Set() : new Set(chatOrder));
                  anchorId.current = null;
                }}
              >
                <span className={`research-history-check ${allSelected ? "is-checked" : selected.length ? "is-mixed" : ""}`} aria-hidden="true">
                  {allSelected ? <Check size={11} /> : selected.length ? <Minus size={11} /> : null}
                </span>
                <span>{t("{n} seleccionado(s)").replace("{n}", String(selected.length))}</span>
              </button>
              <span className="chat-selection-actions">
                <button
                  type="button"
                  className="research-history-action"
                  disabled={!selected.length}
                  aria-label={allArchived ? t("Desarchivar") : t("Archivar")}
                  data-tooltip={allArchived ? t("Desarchivar") : t("Archivar")}
                  onClick={() =>
                    run(async () => {
                      await props.onArchive(selected, !allArchived);
                      setSelectedIds(new Set());
                    })
                  }
                >
                  <Archive size={14} />
                </button>
                <button
                  type="button"
                  className="research-history-action"
                  disabled={!selected.length}
                  aria-label={t("Mover a carpeta")}
                  data-tooltip={t("Mover a carpeta")}
                  aria-haspopup="menu"
                  onClick={(event) => setMoveMenu(event.currentTarget.getBoundingClientRect())}
                >
                  <FolderInput size={14} />
                </button>
                <button
                  type="button"
                  className="research-history-action is-danger"
                  disabled={!selected.length}
                  aria-label={t("Eliminar")}
                  data-tooltip={t("Eliminar")}
                  onClick={() => props.onDelete(selected)}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
            <p className="research-chat-selection-hint">{t("Clic para seleccionar. Mayús + clic selecciona un intervalo.")}</p>
          </div>
        )}
        {notice && (
          <p role="alert" className="chat-history-notice">
            {notice}
          </p>
        )}
      </div>
      <div className={`chat-history-list ${dropTarget === "root" ? "is-drop-root" : ""}`} {...dropProps(null)}>
        {!rows.length && <div className="chat-history-empty">{t("Aún no hay conversaciones. Escribe abajo para empezar.")}</div>}
        {rows.map((row) => {
          if (row.kind === "header")
            return (
              <div key={row.id} className="research-history-heading">
                {row.label}
              </div>
            );
          if (row.kind === "empty")
            return (
              <div key={row.id} className="chat-history-empty">
                {row.label}
              </div>
            );
          if (row.kind === "folder") {
            const { folder } = row;
            const key = `folder:${folder.id}`;
            const searching = !!query.trim();
            return (
              <div
                key={key}
                className={`research-history-row research-folder-row ${menuFolder?.id === folder.id ? "is-menu-open" : ""} ${dropTarget === folder.id ? "is-drop-inside" : ""}`}
                style={{ paddingLeft: 6 + row.depth * 14 }}
                data-testid={`chat-folder-${folder.id}`}
                draggable={!searching && renaming !== key}
                onDragStart={(event) => {
                  event.dataTransfer.setData(FOLDER_DRAG, folder.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                {...dropProps(folder.id)}
              >
                <button
                  type="button"
                  className={`research-folder-toggle ${row.expanded ? "is-open" : ""}`}
                  aria-label={row.expanded ? t("Contraer") : t("Expandir")}
                  style={{ visibility: row.hasChildren || searching ? "visible" : "hidden" }}
                  onClick={() => {
                    if (searching) setQuery("");
                    toggleFolder(folder.id);
                  }}
                >
                  <ChevronRight size={13} />
                </button>
                {renaming === key ? (
                  <>
                    <FolderIcon folder={folder} />
                    <RenameField
                      value={folder.name}
                      onDone={(name) => {
                        setRenaming(null);
                        if (name && name !== folder.name) run(() => props.onFolderSave({ id: folder.id, name }));
                      }}
                    />
                  </>
                ) : (
                  <button
                    type="button"
                    className="research-history-main"
                    aria-expanded={row.expanded}
                    onClick={() => {
                      if (searching) {
                        setQuery("");
                        setExpanded((current) => new Set([...current, folder.id]));
                      } else toggleFolder(folder.id);
                    }}
                  >
                    <FolderIcon folder={folder} />
                    <span className="chat-history-title">{folder.name}</span>
                    {!searching && <span className="research-folder-count">{row.count || ""}</span>}
                  </button>
                )}
                <span className="research-history-row-actions">
                  <button
                    type="button"
                    className="research-history-action"
                    aria-label={t("Nuevo chat en la carpeta")}
                    data-tooltip={t("Nuevo chat en la carpeta")}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onNewConversation(folder.id);
                    }}
                  >
                    <SquarePen size={14} />
                  </button>
                  <button
                    type="button"
                    className="research-history-action"
                    aria-label={t("Más acciones")}
                    data-tooltip={t("Más acciones")}
                    aria-haspopup="menu"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenu({ kind: "folder", folder, anchor: event.currentTarget.getBoundingClientRect() });
                    }}
                  >
                    <MoreVertical size={14} />
                  </button>
                </span>
              </div>
            );
          }
          const { conversation } = row;
          const pinned = !!conversation.pinnedAt && !conversation.archived;
          const isSelected = selectedIds.has(conversation.id);
          return (
            <div
              key={row.key}
              className={`research-history-row research-history-chat ${conversation.id === activeId ? "is-active" : ""} ${pinned ? "is-pinned" : ""} ${menu?.kind === "chat" && menu.row === row.key ? "is-menu-open" : ""} ${selecting && isSelected ? "is-selected" : ""}`}
              style={row.depth ? { paddingLeft: 10 + row.depth * 14 + 16 } : undefined}
              data-testid={`chat-conversation-${conversation.id}`}
              draggable={!selecting && renaming !== row.key}
              onDragStart={(event) => {
                event.dataTransfer.setData(CHAT_DRAG, conversation.id);
                event.dataTransfer.effectAllowed = "move";
              }}
            >
              {selecting ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  className="research-history-main"
                  onMouseDown={(event) => {
                    if (event.shiftKey) event.preventDefault();
                  }}
                  onClick={(event) => toggleSelected(conversation.id, event.shiftKey)}
                >
                  <span className={`research-history-check ${isSelected ? "is-checked" : ""}`} aria-hidden="true">
                    {isSelected && <Check size={11} />}
                  </span>
                  <span className={`chat-history-title ${conversation.archived ? "is-archived" : ""}`}>{conversation.title}</span>
                </button>
              ) : renaming === row.key ? (
                <RenameField
                  value={conversation.title}
                  onDone={(title) => {
                    setRenaming(null);
                    if (title && title !== conversation.title) run(() => props.onRename(conversation, title));
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="research-history-main"
                  aria-current={conversation.id === activeId ? "page" : undefined}
                  title={`${relative(conversation.updatedAt)} · ${t("{n} mensaje(s)").replace("{n}", String(conversation.messageCount))}`}
                  onClick={() => props.onOpenConversation(conversation.id)}
                >
                  <span className={`chat-history-title ${conversation.archived ? "is-archived" : ""}`}>{conversation.title}</span>
                  {runningIds.has(conversation.id) && <span className="research-history-running" role="img" aria-label={t("Generando…")} />}
                </button>
              )}
              {!selecting && (
                <span className="research-history-row-actions">
                  {!conversation.archived && (
                    <button
                      type="button"
                      className={`research-history-action ${pinned ? "is-on" : ""}`}
                      aria-pressed={pinned}
                      aria-label={pinned ? t("Quitar de destacados") : t("Destacar chat")}
                      data-tooltip={pinned ? t("Quitar de destacados") : t("Destacar chat")}
                      onClick={(event) => {
                        event.stopPropagation();
                        run(() => props.onPin(conversation, !pinned));
                      }}
                    >
                      <Pin size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="research-history-action"
                    aria-label={t("Más acciones")}
                    data-tooltip={t("Más acciones")}
                    aria-haspopup="menu"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenu({ kind: "chat", conversation, row: row.key, anchor: event.currentTarget.getBoundingClientRect() });
                    }}
                  >
                    <MoreVertical size={14} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {props.archivedCount > 0 && (
        <button type="button" className="chat-history-archived" onClick={props.onToggleArchived}>
          <Archive size={13} />
          {props.showArchived ? t("Ocultar archivadas") : t("Ver archivadas ({n})").replace("{n}", String(props.archivedCount))}
        </button>
      )}
      {menu?.kind === "chat" && (
        <ChatMenu
          conversation={menu.conversation}
          folders={folders}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onRename={() => setRenaming(menu.row)}
          onPin={(pinned) => run(() => props.onPin(menu.conversation, pinned))}
          onArchive={() => run(() => props.onArchive([menu.conversation], !menu.conversation.archived))}
          onDelete={() => props.onDelete([menu.conversation])}
          onMove={(folderId) => run(() => props.onMove([menu.conversation], folderId))}
          onNewFolder={() =>
            run(async () => {
              const created = await props.onFolderSave({ name: t("Nueva carpeta") });
              await props.onMove([menu.conversation], created.id);
              setRenaming(`folder:${created.id}`);
            })
          }
        />
      )}
      {moveMenu && (
        <FloatingMenu anchor={moveMenu} label={t("Mover a carpeta")} onClose={() => setMoveMenu(null)}>
          {selected.some((c) => c.folderId) && (
            <MenuItem
              icon={X}
              label={t("Sacar de la carpeta")}
              onSelect={() => {
                setMoveMenu(null);
                run(async () => {
                  await props.onMove(selected, null);
                  setSelectedIds(new Set());
                });
              }}
            />
          )}
          {folderOutline(folders).map(({ folder, depth }) => (
            <MenuItem
              key={folder.id}
              icon={FOLDER_ICONS[folder.icon ?? "folder"] ?? Folder}
              color={folder.color}
              indent={depth}
              label={folder.name}
              onSelect={() => {
                setMoveMenu(null);
                run(async () => {
                  await props.onMove(selected, folder.id);
                  setSelectedIds(new Set());
                });
              }}
            />
          ))}
        </FloatingMenu>
      )}
      {menuFolder && menu && (
        <FloatingMenu anchor={menu.anchor} label={menuFolder.name} onClose={() => setMenu(null)}>
          <MenuItem icon={SquarePen} label={t("Nuevo chat en la carpeta")} onSelect={() => { setMenu(null); props.onNewConversation(menuFolder.id); }} />
          <MenuItem icon={Pencil} label={t("Renombrar")} onSelect={() => { setMenu(null); setRenaming(`folder:${menuFolder.id}`); }} />
          <MenuItem icon={Palette} label={t("Icono y color")} onSelect={() => { setMenu(null); setStyling(menuFolder.id); }} />
          <MenuItem icon={FolderPlus} label={t("Nueva subcarpeta")} onSelect={() => { setMenu(null); newFolder(menuFolder.id); }} />
          {menuFolder.parentId && (
            <MenuItem icon={ArrowLeft} label={t("Sacar de la carpeta")} onSelect={() => { setMenu(null); run(() => props.onFolderSave({ id: menuFolder.id, parentId: null })); }} />
          )}
          <hr className="research-history-menu-separator" />
          <MenuItem icon={Trash2} danger label={t("Eliminar carpeta")} onSelect={() => { setMenu(null); props.onFolderDelete(menuFolder); }} />
        </FloatingMenu>
      )}
      {stylingFolder && (
        <AppearanceDialog
          folder={stylingFolder}
          onClose={() => setStyling(null)}
          onChange={(patch) => run(() => props.onFolderSave({ id: stylingFolder.id, ...patch }))}
        />
      )}
    </>
  );
}

function ChatMenu({
  conversation,
  folders,
  anchor,
  onClose,
  onRename,
  onPin,
  onArchive,
  onDelete,
  onMove,
  onNewFolder,
}: {
  conversation: ChatConversationSummary;
  folders: ChatFolder[];
  anchor: DOMRect;
  onClose: () => void;
  onRename: () => void;
  onPin: (pinned: boolean) => void;
  onArchive: () => void;
  onDelete: () => void;
  onMove: (folderId: string | null) => void;
  onNewFolder: () => void;
}) {
  const t = useT();
  // The menu swaps its list in place: the chat's actions or the folders.
  const [list, setList] = useState<"actions" | "folders">("actions");
  const pinned = !!conversation.pinnedAt && !conversation.archived;
  const act = (action: () => void) => {
    onClose();
    action();
  };
  return (
    <FloatingMenu anchor={anchor} label={conversation.title} onClose={onClose} focusKey={list}>
      {list === "folders" ? (
        <>
          <MenuItem icon={ArrowLeft} label={t("Mover a carpeta")} keepOpen onSelect={() => setList("actions")} />
          <hr className="research-history-menu-separator" />
          {conversation.folderId && <MenuItem icon={X} label={t("Sacar de la carpeta")} onSelect={() => act(() => onMove(null))} />}
          {folderOutline(folders).map(({ folder, depth }) => (
            <MenuItem
              key={folder.id}
              radio
              checked={folder.id === conversation.folderId}
              icon={FOLDER_ICONS[folder.icon ?? "folder"] ?? Folder}
              color={folder.color}
              indent={depth}
              label={folder.name}
              onSelect={() => act(() => folder.id !== conversation.folderId && onMove(folder.id))}
            />
          ))}
          <MenuItem icon={FolderPlus} label={t("Nueva carpeta")} onSelect={() => act(onNewFolder)} />
        </>
      ) : (
        <>
          <MenuItem icon={Pencil} label={t("Renombrar")} onSelect={() => act(onRename)} />
          <hr className="research-history-menu-separator" />
          {!conversation.archived && <MenuItem icon={Pin} label={pinned ? t("Quitar de destacados") : t("Destacar chat")} onSelect={() => act(() => onPin(!pinned))} />}
          <MenuItem icon={Archive} label={conversation.archived ? t("Desarchivar") : t("Archivar")} onSelect={() => act(onArchive)} />
          <MenuItem icon={Trash2} danger label={t("Eliminar")} onSelect={() => act(onDelete)} />
          <hr className="research-history-menu-separator" />
          <MenuItem icon={FolderInput} label={t("Mover a carpeta")} trailing={<ChevronRight size={13} />} keepOpen onSelect={() => setList("folders")} />
        </>
      )}
    </FloatingMenu>
  );
}

/** A menu anchored to the button that opened it, kept inside the window. */
export function FloatingMenu({
  anchor,
  label,
  onClose,
  children,
  focusKey,
}: {
  anchor: DOMRect;
  label: string;
  onClose: () => void;
  children: ReactNode;
  focusKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const width = menu.offsetWidth,
      height = menu.offsetHeight;
    const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
    const below = anchor.bottom + 4 + height <= window.innerHeight - 8;
    setStyle({ left, top: below ? anchor.bottom + 4 : Math.max(8, anchor.top - height - 4) });
    menu.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [anchor, focusKey]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
        const index = items.indexOf(document.activeElement as HTMLElement);
        items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} role="menu" aria-label={label} className="research-history-menu" style={style}>
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon: Icon,
  label,
  onSelect,
  danger,
  trailing,
  color,
  indent = 0,
  radio,
  checked,
  keepOpen,
}: {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  trailing?: ReactNode;
  color?: string | null;
  indent?: number;
  radio?: boolean;
  checked?: boolean;
  keepOpen?: boolean;
}) {
  return (
    <button
      type="button"
      role={radio ? "menuitemradio" : "menuitem"}
      aria-checked={radio ? !!checked : undefined}
      aria-haspopup={keepOpen && trailing ? "menu" : undefined}
      className={`research-history-menu-item ${danger ? "is-danger" : ""}`}
      style={indent ? { paddingLeft: 10 + indent * 14 } : undefined}
      onClick={onSelect}
    >
      <span style={{ color: color ?? undefined, display: "inline-flex" }}>
        <Icon size={15} />
      </span>
      <span className="research-history-menu-label">{label}</span>
      {radio && checked && <Check size={14} className="research-history-menu-check" />}
      {trailing}
    </button>
  );
}

function RenameField({ value, onDone }: { value: string; onDone: (value: string | null) => void }) {
  const t = useT();
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (result: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(result?.trim() || null);
  };
  return (
    <input
      autoFocus
      className="research-history-rename"
      aria-label={t("Nombre")}
      value={text}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(text);
        if (event.key === "Escape") {
          event.stopPropagation();
          finish(null);
        }
      }}
    />
  );
}

/** A folder's colour and icon; each choice applies at once. */
function AppearanceDialog({
  folder,
  onClose,
  onChange,
}: {
  folder: ChatFolder;
  onClose: () => void;
  onChange: (patch: { icon?: string; color?: string | null }) => void;
}) {
  const t = useT();
  const custom = folder.color && !FOLDER_COLORS.includes(folder.color);
  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div className="research-project-style-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={t("Icono y color")} className="research-project-style">
        <div className="research-project-swatches">
          {FOLDER_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`research-project-swatch ${folder.color === color ? "is-selected" : ""}`}
              style={{ backgroundColor: color }}
              aria-label={color}
              aria-pressed={folder.color === color}
              onClick={() => onChange({ color })}
            />
          ))}
          <label className={`research-project-swatch is-custom ${custom ? "is-selected" : ""}`} data-tooltip={t("Color personalizado")}>
            <input type="color" value={folder.color ?? "#3b82f6"} aria-label={t("Color personalizado")} onChange={(event) => onChange({ color: event.target.value.toLowerCase() })} />
          </label>
          {folder.color && (
            <button type="button" className="research-project-swatch is-none" aria-label={t("Sin color")} data-tooltip={t("Sin color")} onClick={() => onChange({ color: null })}>
              <X size={14} />
            </button>
          )}
        </div>
        <hr className="research-history-menu-separator" />
        <div className="research-project-icons">
          {Object.entries(FOLDER_ICONS).map(([name, Icon]) => (
            <button
              key={name}
              type="button"
              className={`research-project-icon ${(folder.icon ?? "folder") === name ? "is-selected" : ""}`}
              aria-label={name}
              aria-pressed={(folder.icon ?? "folder") === name}
              onClick={() => onChange({ icon: name })}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
        <hr className="research-history-menu-separator" />
        <button type="button" className="research-history-menu-item" onClick={onClose}>
          {t("Cerrar")}
        </button>
      </div>
    </div>,
    document.body,
  );
}

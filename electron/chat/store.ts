// Conversations of the database chat and the folders that organise them.
// A folder can hold subfolders; deleting one keeps its chats, which return
// to the general history (foreign key ON DELETE SET NULL).
import { randomUUID as uuid } from "node:crypto";
import type Database from "better-sqlite3";
import type { ModelChoice } from "../../shared/aiConfig";
import type {
  ChatConversation,
  ChatConversationSummary,
  ChatFolder,
  ChatMessage,
  ChatMode,
} from "../../shared/chat";

const now = () => new Date().toISOString();
const SUMMARY = `id,title,folder_id folderId,database_ids_json,model_json,mode,pinned_at pinnedAt,archived,message_count messageCount,created_at createdAt,updated_at updatedAt`;
type SummaryRow = Omit<ChatConversationSummary, "databaseIds" | "model" | "archived"> & {
  database_ids_json: string;
  model_json: string | null;
  archived: number;
};
const summary = ({ database_ids_json, model_json, archived, ...row }: SummaryRow): ChatConversationSummary => ({
  ...row,
  databaseIds: JSON.parse(database_ids_json),
  model: model_json ? JSON.parse(model_json) : null,
  archived: !!archived,
});

export class ChatStore {
  constructor(private db: Database.Database) {}

  list(includeArchived: boolean): ChatConversationSummary[] {
    return (
      this.db
        .prepare(
          `SELECT ${SUMMARY} FROM chat_conversations ${includeArchived ? "" : "WHERE archived=0"} ORDER BY updated_at DESC`,
        )
        .all() as SummaryRow[]
    ).map(summary);
  }
  archivedCount(): number {
    return (this.db.prepare("SELECT count(*) n FROM chat_conversations WHERE archived=1").get() as { n: number }).n;
  }
  get(id: string): ChatConversation {
    const row = this.db
      .prepare(`SELECT ${SUMMARY},messages_json FROM chat_conversations WHERE id=?`)
      .get(id) as (SummaryRow & { messages_json: string }) | undefined;
    if (!row) throw new Error("Conversación no encontrada.");
    const { messages_json, ...rest } = row;
    return { ...summary(rest), messages: JSON.parse(messages_json) as ChatMessage[] };
  }
  create(input: { title?: string; databaseIds: string[]; folderId?: string | null; model?: ModelChoice | null; mode?: ChatMode }) {
    const id = uuid(),
      at = now();
    if (input.folderId) this.folder(input.folderId);
    this.db
      .prepare(
        "INSERT INTO chat_conversations(id,title,folder_id,database_ids_json,model_json,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        input.title?.trim() || "Chat",
        input.folderId ?? null,
        JSON.stringify(input.databaseIds),
        input.model ? JSON.stringify(input.model) : null,
        input.mode ?? "fast",
        at,
        at,
      );
    return this.get(id);
  }
  update(input: {
    ids: string[];
    title?: string;
    folderId?: string | null;
    pinned?: boolean;
    archived?: boolean;
    databaseIds?: string[];
    model?: ModelChoice | null;
    mode?: ChatMode;
  }) {
    if (input.folderId) this.folder(input.folderId);
    const sets: string[] = [],
      values: unknown[] = [];
    const set = (sql: string, value: unknown) => {
      sets.push(sql);
      values.push(value);
    };
    if (input.title !== undefined) set("title=?", input.title.trim() || "Chat");
    if (input.folderId !== undefined) set("folder_id=?", input.folderId);
    if (input.pinned !== undefined) set("pinned_at=?", input.pinned ? now() : null);
    if (input.archived !== undefined) {
      set("archived=?", input.archived ? 1 : 0);
      // An archived chat leaves the highlighted list.
      if (input.archived) sets.push("pinned_at=NULL");
    }
    if (input.databaseIds !== undefined) set("database_ids_json=?", JSON.stringify(input.databaseIds));
    if (input.model !== undefined) set("model_json=?", input.model ? JSON.stringify(input.model) : null);
    if (input.mode !== undefined) set("mode=?", input.mode);
    if (!sets.length) return;
    const statement = this.db.prepare(`UPDATE chat_conversations SET ${sets.join(",")} WHERE id=?`);
    this.db.transaction(() => {
      for (const id of input.ids) statement.run(...values, id);
    })();
  }
  delete(ids: string[]) {
    const statement = this.db.prepare("DELETE FROM chat_conversations WHERE id=?");
    this.db.transaction(() => {
      for (const id of ids) statement.run(id);
    })();
  }
  /** Replaces the messages after a turn; the title is set by the first question. */
  saveMessages(id: string, messages: ChatMessage[], title?: string) {
    const done = this.db
      .prepare(
        `UPDATE chat_conversations SET messages_json=?,message_count=?,updated_at=?${title ? ",title=?" : ""} WHERE id=?`,
      )
      .run(...[JSON.stringify(messages), messages.length, now(), ...(title ? [title] : []), id]);
    if (!done.changes) throw new Error("Conversación no encontrada.");
  }

  folders(): ChatFolder[] {
    return this.db
      .prepare(
        "SELECT id,parent_id parentId,name,color,icon,position,created_at createdAt FROM chat_folders ORDER BY position,name COLLATE NOCASE",
      )
      .all() as ChatFolder[];
  }
  private folder(id: string): ChatFolder {
    const folder = this.folders().find((f) => f.id === id);
    if (!folder) throw new Error("Carpeta no encontrada.");
    return folder;
  }
  saveFolder(input: { id?: string; parentId?: string | null; name?: string; color?: string | null; icon?: string | null }) {
    const folders = this.folders();
    if (input.parentId) {
      this.folder(input.parentId);
      // A folder cannot move inside itself or one of its subfolders.
      for (let cursor: string | null = input.parentId; cursor; cursor = folders.find((f) => f.id === cursor)?.parentId ?? null)
        if (cursor === input.id) throw new Error("Una carpeta no puede ir dentro de sí misma.");
    }
    if (input.id) {
      const current = this.folder(input.id);
      this.db
        .prepare("UPDATE chat_folders SET parent_id=?,name=?,color=?,icon=? WHERE id=?")
        .run(
          input.parentId !== undefined ? input.parentId : current.parentId,
          input.name?.trim() || current.name,
          input.color !== undefined ? input.color : current.color,
          input.icon !== undefined ? input.icon : current.icon,
          input.id,
        );
      return this.folder(input.id);
    }
    const id = uuid(),
      position = folders.filter((f) => f.parentId === (input.parentId ?? null)).length;
    this.db
      .prepare("INSERT INTO chat_folders VALUES(?,?,?,?,?,?,?)")
      .run(id, input.parentId ?? null, input.name?.trim() || "Carpeta", input.color ?? null, input.icon ?? null, position, now());
    return this.folder(id);
  }
  deleteFolder(id: string) {
    this.db.prepare("DELETE FROM chat_folders WHERE id=?").run(id);
  }
  /** Chats that read a database that no longer exists keep only the others. */
  pruneDatabase(databaseId: string) {
    for (const chat of this.list(true))
      if (chat.databaseIds.includes(databaseId))
        this.update({ ids: [chat.id], databaseIds: chat.databaseIds.filter((d) => d !== databaseId) });
  }
}

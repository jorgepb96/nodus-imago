// The published announcements, adapted from Nodus (electron/announcements.ts),
// fetched about as rarely as anything can be and still be called current: one
// conditional GET a little after startup and one every four hours, like the
// update check. The response's ETag is sent back as If-None-Match, so the usual
// answer is a 304 with no body. Nothing about this install is sent: no
// identifier, no collection data, only the request for a public file.
//
// Main-process only, so the renderer's CSP needs no new host. State (the last
// good payload, its ETag, the read and dismissed marks, and whether the channel
// is on) is one JSON in userData, so the panel works offline. When the channel
// is off, no request is made at all.
import fs from "node:fs";
import path from "node:path";
import {
  ANNOUNCEMENTS_URL,
  isAnnouncementVisible,
  parseAnnouncements,
  sortAnnouncements,
  type Announcement,
  type AnnouncementEntry,
  type AnnouncementRefreshResult,
  type AnnouncementsState,
} from "../shared/announcements";

const STATE_FILE = "announcements.json";
const FETCH_TIMEOUT_MS = 6_000;
const STARTUP_DELAY_MS = 20_000;
const INTERVAL_MS = 4 * 3600_000;

type Stored = {
  /** Validator from the last 200, replayed as If-None-Match. */
  etag?: string;
  /** Last successful check, for diagnostics only. */
  checkedAt?: number;
  /** The raw payload exactly as served, re-parsed on every read. */
  payload?: unknown;
  /** id → when it was read (ms); pruned to the ids still published. */
  read?: Record<string, number>;
  /** id → when it was dismissed (ms); pruned to the ids still published. */
  dismissed?: Record<string, number>;
  /** The reader turned the channel off in Settings. */
  disabled?: boolean;
};

export class Announcements {
  private checking: Promise<AnnouncementRefreshResult> | null = null;
  private startup?: ReturnType<typeof setTimeout>;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private options: {
      userData: string;
      version: string;
      fetch: typeof fetch;
      /** The list or its marks changed: the interface reloads it. */
      changed: () => void;
      /** Overridable so a check can be served from a local file server. */
      url?: string;
      /** IMAGO_DISABLE_ANNOUNCEMENTS=1: never ask (tests, automated runs). */
      disabled?: boolean;
    },
  ) {}
  private get file() {
    return path.join(this.options.userData, STATE_FILE);
  }
  private read(): Stored {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return parsed && typeof parsed === "object" ? (parsed as Stored) : {};
    } catch {
      return {};
    }
  }
  private write(state: Stored) {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } catch (error) {
      console.warn("[announcements] could not save their state:", error);
    }
  }
  private enabled(state = this.read()) {
    return !this.options.disabled && !state.disabled;
  }
  /** The notices this build should show today, newest first, with their read marks. */
  list(): AnnouncementsState {
    const state = this.read();
    const { announcements } = parseAnnouncements(state.payload);
    const read = state.read ?? {},
      dismissed = state.dismissed ?? {};
    const visible = announcements.filter(
      (a) => isAnnouncementVisible(a, { now: Date.now(), version: this.options.version }) && !dismissed[a.id],
    );
    return {
      enabled: this.enabled(state),
      announcements: this.enabled(state)
        ? sortAnnouncements(visible).map((a): AnnouncementEntry => ({ ...a, read: !!read[a.id] }))
        : [],
    };
  }
  /** One notice read: opening the panel never clears them all at once. */
  markRead(id: string): AnnouncementsState {
    const state = this.read();
    if (!state.read?.[id]) {
      this.write({ ...state, read: { ...(state.read ?? {}), [id]: Date.now() } });
      this.options.changed();
    }
    return this.list();
  }
  /**
   * Dismisses every notice shown now. The ids are kept rather than the cached
   * payload deleted, so the next check does not bring the same notices back;
   * notices published later have new ids and still show.
   */
  clear(): AnnouncementsState {
    const visible = this.list().announcements;
    if (!visible.length) return this.list();
    const state = this.read(),
      dismissed = { ...(state.dismissed ?? {}) },
      now = Date.now();
    for (const a of visible) dismissed[a.id] = now;
    this.write({ ...state, dismissed });
    this.options.changed();
    return this.list();
  }
  /** Turns the channel on or off; turning it on asks straight away. */
  configure(enabled: boolean): AnnouncementsState {
    const state = this.read();
    this.write({ ...state, disabled: !enabled });
    this.options.changed();
    if (enabled) void this.refresh("enabled");
    return this.list();
  }
  /**
   * Asks for the list. Never throws and never discards the last good payload;
   * a check made while another is in flight waits for that same request.
   */
  async refresh(reason: string): Promise<AnnouncementRefreshResult> {
    if (!this.enabled()) return { status: "disabled", checkedAt: Date.now() };
    if (this.checking) return this.checking;
    this.checking = this.perform(reason);
    try {
      return await this.checking;
    } finally {
      this.checking = null;
    }
  }
  private async perform(reason: string): Promise<AnnouncementRefreshResult> {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const state = this.read();
      // No cache-buster: the point is to let the server answer 304.
      const response = await this.options.fetch(this.options.url || ANNOUNCEMENTS_URL, {
        signal: controller.signal,
        headers: state.etag ? { "If-None-Match": state.etag } : {},
        redirect: "error",
      });
      if (response.status === 304) {
        const checkedAt = Date.now();
        this.write({ ...state, checkedAt });
        return { status: "not-modified", checkedAt };
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 512 * 1024) throw new Error("The announcements file is too large.");
      const payload = JSON.parse(text);
      const { announcements, rejected } = parseAnnouncements(payload);
      if (rejected) console.warn(`[announcements] ignored ${rejected} malformed entr${rejected === 1 ? "y" : "ies"}`);
      const checkedAt = Date.now();
      this.write({
        ...state,
        etag: response.headers.get("etag") ?? undefined,
        checkedAt,
        payload,
        read: prune(state.read ?? {}, announcements),
        dismissed: prune(state.dismissed ?? {}, announcements),
      });
      console.log(`[announcements] ${announcements.length} notice(s) after check (${reason})`);
      this.options.changed();
      return { status: "updated", checkedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("[announcements] check skipped:", message);
      return { status: "error", checkedAt: Date.now(), error: message };
    } finally {
      clearTimeout(timer);
    }
  }
  /** A first check a little after startup (never competing with it), then every four hours. */
  start() {
    if (this.timer) return;
    this.startup = setTimeout(() => void this.refresh("startup"), STARTUP_DELAY_MS);
    this.startup.unref?.();
    this.timer = setInterval(() => void this.refresh("scheduled"), INTERVAL_MS);
    this.timer.unref?.();
  }
  close() {
    clearTimeout(this.startup);
    clearInterval(this.timer);
  }
}

/** Marks of notices no longer published are dropped, so the maps stay small. */
function prune(marks: Record<string, number>, announcements: readonly Announcement[]) {
  const live = new Set(announcements.map((a) => a.id));
  return Object.fromEntries(Object.entries(marks).filter(([id]) => live.has(id)));
}

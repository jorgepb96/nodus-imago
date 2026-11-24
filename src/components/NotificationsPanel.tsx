// The notification centre in the header, ported from Nodus
// (src/components/NotificationsPanel.tsx): the bell's panel lists the notices
// published between releases («Avisos de Imago»), newest first, each unread
// until it is read one at a time. Imago's activity lives in its queue (the
// clock beside the bell), so this panel carries the notices only.
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, RefreshCw, Trash2, X } from "lucide-react";
import {
  announcementCopyFor,
  type AnnouncementEntry,
  type AnnouncementRefreshResult,
} from "../../shared/announcements";
import { LanguageContext, useT } from "../i18n";
import { Button, Modal } from "./ui";

/**
 * The published notices and this install's read marks, live: the bell's
 * count and the panel read the same list, so they never disagree.
 */
export function useAnnouncements() {
  const [announcements, setAnnouncements] = useState<AnnouncementEntry[]>([]);
  const [enabled, setEnabled] = useState(true);
  const load = useCallback(() => {
    void window.imago
      .call("announcementsList")
      .then((state) => {
        setAnnouncements(state.announcements);
        setEnabled(state.enabled);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    return window.imago.onChange((scope) => {
      if (scope === "announcements") load();
    });
  }, [load]);
  const markRead = useCallback((id: string) => {
    void window.imago
      .call("announcementsMarkRead", { id })
      .then((state) => setAnnouncements(state.announcements))
      .catch(() => {});
  }, []);
  const clear = useCallback(() => {
    void window.imago
      .call("announcementsClear")
      .then((state) => setAnnouncements(state.announcements))
      .catch(() => {});
  }, []);
  const refresh = useCallback(async (): Promise<AnnouncementRefreshResult> => {
    const state = await window.imago.call("announcementsRefresh");
    setAnnouncements(state.announcements);
    setEnabled(state.enabled);
    return state.refresh;
  }, []);
  return {
    announcements,
    enabled,
    unread: announcements.reduce((total, entry) => total + (entry.read ? 0 : 1), 0),
    markRead,
    clear,
    refresh,
  };
}

function refreshMessage(result: AnnouncementRefreshResult) {
  switch (result.status) {
    case "updated":
      return "Notificaciones actualizadas.";
    case "not-modified":
      return "Sin novedades.";
    case "disabled":
      return "Los avisos están desactivados.";
    case "error":
      return "No se pudieron actualizar las notificaciones.";
  }
}

/** A published date, in the reader's locale rather than the ISO the file carries. */
function announcementDate(date: string, language: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(language);
}

function AnnouncementRow({ entry, onMarkRead }: { entry: AnnouncementEntry; onMarkRead: (id: string) => void }) {
  const t = useT(),
    language = useContext(LanguageContext),
    copy = announcementCopyFor(entry, language);
  return (
    <li className={`announcement-row${entry.read ? " is-read" : ""}`} data-testid={`announcement-${entry.id}`}>
      <span aria-hidden="true" className={`announcement-dot is-${entry.severity}`} />
      <div>
        {/* Plain text on purpose: these strings came off the network, and the
            moment they are rendered as markup the published file becomes a way
            to inject into the app. */}
        <p className="announcement-title">{copy.title}</p>
        <p className="announcement-body">{copy.body}</p>
        <div className="announcement-actions">
          <span>{announcementDate(entry.date, language)}</span>
          {entry.url && (
            <button
              type="button"
              onClick={() => {
                // Following the link is reading it; nobody should have to say so twice.
                onMarkRead(entry.id);
                void window.imago.call("openExternalLink", { url: entry.url! });
              }}
            >
              <ExternalLink size={12} />
              {copy.linkLabel ?? t("Abrir enlace")}
            </button>
          )}
          {!entry.read && (
            <button type="button" onClick={() => onMarkRead(entry.id)}>
              <Check size={12} />
              {t("Marcar como leído")}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The panel under the bell: placed under its button, closed by Escape or a
 * click elsewhere, with a manual refresh and «Limpiar» (after confirming).
 */
export function NotificationsPanel({
  anchor,
  onClose,
  announcements,
  enabled,
  onMarkRead,
  onRefresh,
  onClear,
  onOpenSettings,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  announcements: AnnouncementEntry[];
  enabled: boolean;
  onMarkRead: (id: string) => void;
  onRefresh: () => Promise<AnnouncementRefreshResult>;
  onClear: () => void;
  onOpenSettings: () => void;
}) {
  const t = useT(),
    panel = useRef<HTMLDivElement>(null),
    [pos, setPos] = useState<{ left: number; top: number; width: number; originX: number } | null>(null),
    [confirming, setConfirming] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [feedback, setFeedback] = useState<AnnouncementRefreshResult | null>(null);
  useLayoutEffect(() => {
    const compute = () => {
      const r = anchor.getBoundingClientRect(),
        width = Math.min(420, window.innerWidth - 32),
        left = Math.max(16, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 16));
      setPos({ left, top: r.bottom + 8, width, originX: r.left + r.width / 2 - left });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [anchor]);
  useEffect(() => {
    if (confirming) return;
    const down = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || panel.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-notifications-trigger]")) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [confirming, onClose]);
  const refresh = async () => {
    setRefreshing(true);
    setFeedback(null);
    try {
      setFeedback(await onRefresh());
    } catch {
      setFeedback({ status: "error", checkedAt: Date.now() });
    } finally {
      setRefreshing(false);
    }
  };
  if (!pos) return null;
  return createPortal(
    <div
      ref={panel}
      className="notifications-panel"
      role="dialog"
      aria-label={t("Notificaciones")}
      data-testid="header-notifications-panel"
      style={{ left: pos.left, top: pos.top, width: pos.width, transformOrigin: `${pos.originX}px top` }}
    >
      <header>
        <strong>{t("Notificaciones")}</strong>
        <span>
          <Button
            icon
            aria-label={t(refreshing ? "Actualizando…" : "Actualizar")}
            disabled={refreshing || !enabled}
            onClick={() => void refresh()}
            data-testid="header-notifications-refresh"
          >
            <RefreshCw size={14} className={refreshing ? "spin" : ""} />
          </Button>
          {announcements.length > 0 && <Button onClick={() => setConfirming(true)}>{t("Limpiar")}</Button>}
          <Button icon aria-label={t("Cerrar")} onClick={onClose}>
            <X size={15} />
          </Button>
        </span>
      </header>
      {feedback && (
        <p role="status" className={`notifications-feedback${feedback.status === "error" ? " is-error" : ""}`} data-status={feedback.status}>
          {t(refreshMessage(feedback))}
        </p>
      )}
      {!enabled ? (
        <div className="notifications-empty">
          <p>{t("Los avisos están desactivados.")}</p>
          <Button
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
          >
            {t("Activarlos en Ajustes")}
          </Button>
        </div>
      ) : announcements.length ? (
        <div className="notifications-list">
          <div className="notifications-section">{t("Avisos de Imago")}</div>
          <ul>
            {announcements.map((entry) => (
              <AnnouncementRow key={entry.id} entry={entry} onMarkRead={onMarkRead} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="notifications-empty">{t("No hay notificaciones.")}</p>
      )}
      {confirming && (
        <Modal icon={Trash2} title={t("Limpiar notificaciones")} onClose={() => setConfirming(false)}>
          <div className="modal-body">
            <p>{t("Se quitarán los avisos que ves ahora. Los avisos que se publiquen más adelante seguirán apareciendo.")}</p>
          </div>
          <footer>
            <Button onClick={() => setConfirming(false)}>{t("Cancelar")}</Button>
            <Button
              primary
              onClick={() => {
                setConfirming(false);
                onClear();
              }}
            >
              {t("Limpiar")}
            </Button>
          </footer>
        </Modal>
      )}
    </div>,
    document.body,
  );
}

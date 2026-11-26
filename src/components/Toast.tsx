// The message at the bottom of the window (a confirmation, or an error in
// red). Modal windows live in the browser's top layer, above any z-index, and
// blur what lies behind them: the message joins the top layer too (a manual
// popover) and rises above every window opened after it, so it is never hidden
// or blurred by one.
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";
import { Button } from "./ui";

export function Toast({ message, error, onClose }: { message: string; error: boolean; onClose: () => void }) {
  const t = useT(),
    node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = node.current;
    if (!el?.showPopover) return;
    el.setAttribute("popover", "manual");
    const raise = () => {
      if (!el.isConnected) return;
      try {
        if (el.matches(":popover-open")) el.hidePopover();
        el.showPopover();
      } catch {
        /* Not in the document any more. */
      }
    };
    raise();
    // A window opened later goes above it: it rises again.
    const observer = new MutationObserver((changes) => {
      if (changes.some((c) => c.target instanceof HTMLDialogElement && (c.target as HTMLDialogElement).open)) raise();
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => {
      observer.disconnect();
      if (el.isConnected && el.matches(":popover-open")) el.hidePopover();
    };
  }, [message]);
  return (
    <div ref={node} className={"toast " + (error ? "error" : "")} role={error ? "alert" : "status"} data-testid="toast">
      <span>{t(message)}</span>
      <Button icon aria-label={t("Cerrar")} onClick={onClose}>
        <X size={14} />
      </Button>
    </div>
  );
}

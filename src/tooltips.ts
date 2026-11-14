// One tooltip layer for the whole window. Native `title` tooltips are slow
// to appear in Electron and never show for keyboard focus, and icon-only
// buttons often carry just an aria-label. This shows either text in the
// app's style after a short hover, or at once when a control is reached
// with the keyboard. The texts already come translated through t().

const SHOW_DELAY = 450,
  // Moving from one control to the next keeps tooltips flowing, as in macOS.
  WARM_WINDOW = 400;
const LABELLED =
  'button[aria-label],summary[aria-label],a[aria-label],[role="button"][aria-label],[role="switch"][aria-label],[role="tab"][aria-label],[role="menuitem"][aria-label],input[type="checkbox"][aria-label],input[type="radio"][aria-label]';

/** The text a control's tooltip shows, or null when it needs none. */
export function tooltipText(element: Element): string | null {
  const stored = element.getAttribute("data-tooltip");
  if (stored?.trim()) return stored.trim();
  // A label is only worth showing when it is not already visible as text.
  if (element.matches(LABELLED) && !element.textContent?.trim())
    return element.getAttribute("aria-label")?.trim() || null;
  return null;
}

function target(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  // Take over native titles so the two tooltips never show together.
  for (let el: Element | null = node; el && el !== document.body; el = el.parentElement) {
    const title = el.getAttribute("title");
    if (title !== null) {
      if (title.trim()) {
        el.setAttribute("data-tooltip", title);
        // The title was also its accessible name or description: keep it.
        if (!el.hasAttribute("aria-label") && !el.textContent?.trim())
          el.setAttribute("aria-label", title);
        else if (
          el.getAttribute("aria-label") !== title &&
          !el.hasAttribute("aria-description")
        )
          el.setAttribute("aria-description", title);
      }
      el.removeAttribute("title");
    }
    if (tooltipText(el)) return el as HTMLElement;
  }
  return null;
}

export function installTooltips() {
  const tip = document.createElement("div");
  tip.className = "app-tooltip";
  tip.setAttribute("role", "tooltip");
  // Screen readers already read the control's own label or title.
  tip.setAttribute("aria-hidden", "true");
  tip.setAttribute("popover", "manual");
  document.body.append(tip);
  let current: HTMLElement | null = null,
    timer: number | undefined,
    hiddenAt = 0;
  const place = (anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect(),
      w = tip.offsetWidth,
      h = tip.offsetHeight,
      gap = 6;
    const below = r.bottom + gap + h <= window.innerHeight - 8;
    tip.dataset.side = below ? "bottom" : "top";
    tip.style.top = `${below ? r.bottom + gap : Math.max(8, r.top - gap - h)}px`;
    tip.style.left = `${Math.round(
      Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)),
    )}px`;
  };
  const show = (anchor: HTMLElement) => {
    const text = tooltipText(anchor);
    if (
      !text ||
      !anchor.isConnected ||
      !(anchor.matches(":hover") || anchor.matches(":focus-visible"))
    )
      return;
    current = anchor;
    tip.textContent = text;
    // Re-entering the top layer keeps the tooltip above open dialogs.
    if (tip.matches(":popover-open")) tip.hidePopover();
    tip.showPopover();
    place(anchor);
    tip.classList.add("visible");
  };
  const hide = () => {
    window.clearTimeout(timer);
    if (current) hiddenAt = Date.now();
    current = null;
    tip.classList.remove("visible");
    if (tip.matches(":popover-open")) tip.hidePopover();
  };
  const schedule = (anchor: HTMLElement, immediate: boolean) => {
    if (anchor === current) return;
    window.clearTimeout(timer);
    if (immediate || Date.now() - hiddenAt < WARM_WINDOW) {
      hide();
      show(anchor);
    } else {
      hide();
      timer = window.setTimeout(() => show(anchor), SHOW_DELAY);
    }
  };
  document.addEventListener("pointerover", (event) => {
    if ((event as PointerEvent).pointerType === "touch") return;
    const anchor = target(event.target);
    // Chart marks answer at once, like a reading aid, not a hint.
    if (anchor) schedule(anchor, anchor.hasAttribute("data-tooltip-instant"));
    else if (current || timer) hide();
  });
  document.addEventListener("pointerout", (event) => {
    const to = (event as PointerEvent).relatedTarget as Node | null;
    if (current && to && current.contains(to)) return;
    if (!to || !target(to)) hide();
  });
  document.addEventListener("focusin", (event) => {
    const anchor = target(event.target);
    // Keyboard focus only: a click already shows what the control does.
    if (anchor && anchor.matches(":focus-visible")) schedule(anchor, true);
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Enter" || event.key === " ") hide();
  }, true);
  // Scrolling moves the control away from a visible tooltip; a pending one
  // still appears if the pointer rests on the control afterwards.
  window.addEventListener(
    "scroll",
    () => {
      if (current) hide();
    },
    true,
  );
  window.addEventListener("blur", hide);
}

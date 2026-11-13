import {
  useEffect,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { X, Loader2, Image as ImageIcon } from "lucide-react";
import { useT } from "../i18n";
export function Button({
  children,
  primary = false,
  icon = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  icon?: boolean;
}) {
  return (
    <button
      {...props}
      className={`button ${primary ? "primary" : ""} ${icon ? "icon-button" : ""} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  layout = "standard",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Panel layouts provide their own padded body, navigation and footer areas. */
  layout?: "standard" | "panels";
}) {
  const ref = useRef<HTMLDialogElement>(null),
    t = useT();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <h2>{title}</h2>
        <Button icon onClick={onClose} aria-label={t("Cerrar")}>
          <X size={18} />
        </Button>
      </header>
      <div
        className={`modal-content${layout === "panels" ? " modal-content-panels" : ""}`}
      >
        {children}
      </div>
    </dialog>
  );
}
export function Spinner() {
  return <Loader2 size={18} className="spin" />;
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <ImageIcon size={28} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="row center">{children}</div>
    </div>
  );
}
export function Thumbnail({
  id,
  revision,
  large = false,
  alt = "",
}: {
  id?: string;
  revision?: string;
  large?: boolean;
  alt?: string;
}) {
  const ref = useRef<HTMLImageElement>(null),
    t = useT();
  useEffect(() => {
    if (ref.current) {
      ref.current.hidden = false;
      ref.current.parentElement?.classList.remove("unavailable");
    }
  }, [id, revision]);
  return (
    <div className={`image-frame ${large ? "large" : ""}`}>
      {id ? (
        <>
          <img
            ref={ref}
            loading={large ? "eager" : "lazy"}
            src={`imago://asset/${id}/${large ? "preview" : "thumb"}${revision ? "?v=" + encodeURIComponent(revision) : ""}`}
            alt={alt}
            onError={(e) => {
              e.currentTarget.hidden = true;
              e.currentTarget.parentElement?.classList.add("unavailable");
            }}
          />
          <span className="image-error">
            <ImageIcon size={25} />
            {t("Sin imagen")}
          </span>
        </>
      ) : (
        <span className="image-placeholder">
          <ImageIcon size={26} />
        </span>
      )}
    </div>
  );
}

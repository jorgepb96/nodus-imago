// What's New, ported from Nodus Research (src/components/WhatsNewModal.tsx):
// shown once after the app updates, focused on the latest release, with the
// older ones in the version picker. The Imago mark takes Nodi's place.
import { memo, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ChartColumn,
  ChartScatter,
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  Database,
  FileText,
  Link2,
  MapPin,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import type { ReleaseNote, ReleaseNoteScope } from "../../shared/releaseNotes";
import { RELEASE_EMPTY_SECTION, RELEASE_SECTION_LABELS, releaseNoteSections } from "../../shared/releaseNotesPresentation";
import { NODUS_SOCIAL_LINKS } from "../../shared/socialLinks";
import { LanguageContext, useT } from "../i18n";
import { ImagoMark } from "./ImagoMark";
import "./WhatsNewModal.css";

const RELEASE_SCOPE_META: Record<ReleaseNoteScope, { icon: (size: number) => ReactNode; color: string; label: string }> = {
  general: { icon: (s) => <Sparkles size={s} />, color: "#64748b", label: "General" },
  catalogue: { icon: (s) => <Database size={s} />, color: "#4f46e5", label: "Catálogo" },
  search: { icon: (s) => <Search size={s} />, color: "#0891b2", label: "Búsqueda" },
  visual: { icon: (s) => <ChartScatter size={s} />, color: "#7c3aed", label: "Mapa visual" },
  compare: { icon: (s) => <Columns2 size={s} />, color: "#0f766e", label: "Comparar y variantes" },
  places: { icon: (s) => <MapPin size={s} />, color: "#ea580c", label: "Lugares" },
  ai: { icon: (s) => <Sparkles size={s} />, color: "#9333ea", label: "IA" },
  analysis: { icon: (s) => <ChartColumn size={s} />, color: "#2563eb", label: "Análisis" },
  authorities: { icon: (s) => <Link2 size={s} />, color: "#059669", label: "Autoridades" },
  publish: { icon: (s) => <FileText size={s} />, color: "#db2777", label: "Citar y publicar" },
};

/** Brand marks drawn as Nodus Research draws them (its ICON_PATHS). */
const BRAND_PATHS: Record<"paypal" | "kofi" | "reddit" | "youtube" | "x", string> = {
  paypal:
    '<path d="M8.2 3h5.7c3.1 0 5.2 1.7 4.8 4.8-.5 3.8-3.1 5.5-6.7 5.5h-1.5L9.7 19H5.9L8.2 3Z"/><path d="M10.4 6.5h3c1.2 0 1.9.6 1.7 1.6-.2 1.2-1 1.8-2.4 1.8h-1.8l-.5-3.4Z"/><path d="M11 13.3h2.1c2.1 0 3.8-.6 5-1.7-.7 3.2-3 4.8-6.2 4.8h-.8L10.5 21H7.2l.5-3.4h2.7l.6-4.3Z"/>',
  kofi: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9Z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3v2.5M13 2.5v3"/>',
  reddit:
    '<path fill="currentColor" stroke="none" d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-6.991 4.87-3.861 0-6.99-2.176-6.99-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12c-.688 0-1.25.562-1.25 1.25 0 .687.562 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>',
  youtube:
    '<path fill="currentColor" stroke="none" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12l-6.273 3.568Z"/>',
  x: '<path fill="currentColor" stroke="none" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.153h7.594l5.243 6.932ZM4.298 3.24h2.188L19.649 20.644H17.61Z"/>',
};
function BrandIcon({ name, size = 16 }: { name: keyof typeof BRAND_PATHS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: BRAND_PATHS[name] }}
    />
  );
}

const STARTUP_VERSION_HISTORY_LIMIT = 12;

interface VersionBranch {
  version: string;
  notes: ReleaseNote[];
}
interface VersionMajor {
  version: string;
  branches: VersionBranch[];
}

/** Build a major -> minor -> release hierarchy while preserving newest-first order. */
function buildVersionHierarchy(notes: ReleaseNote[]): VersionMajor[] {
  const majors = new Map<string, Map<string, ReleaseNote[]>>();
  for (const note of notes) {
    const [major = "0", minor = "0"] = note.version.split(".");
    let branches = majors.get(major);
    if (!branches) {
      branches = new Map();
      majors.set(major, branches);
    }
    const branch = `${major}.${minor}`;
    branches.set(branch, [...(branches.get(branch) ?? []), note]);
  }
  return [...majors].map(([version, branches]) => ({
    version,
    branches: [...branches].map(([branchVersion, branchNotes]) => ({ version: branchVersion, notes: branchNotes })),
  }));
}

const VersionPicker = memo(function VersionPicker({
  notes,
  value,
  onChange,
}: {
  notes: ReleaseNote[];
  value: string;
  onChange: (version: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hierarchy = useMemo(() => buildVersionHierarchy(notes), [notes]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="whats-new-version-picker">
      <button
        type="button"
        className="whats-new-version-trigger"
        data-testid="whats-new-version-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span>{t("Versiones")}</span>
        <b>v{value}</b>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="whats-new-version-menu" data-testid="whats-new-version-menu" role="listbox" aria-label={t("Versiones")}>
          {hierarchy.map((major) => (
            <div key={major.version} className="whats-new-version-major">
              <div className="whats-new-version-major-label">Nodus Imago {major.version}.x</div>
              {major.branches.map((branch) => (
                <div key={branch.version} className="whats-new-version-branch" role="group" aria-label={`Nodus Imago ${major.version}.x · v${branch.version}.x`}>
                  <div className="whats-new-version-branch-label">v{branch.version}.x</div>
                  {branch.notes.map((note) => {
                    const selected = note.version === value;
                    return (
                      <button
                        type="button"
                        key={note.version}
                        className="whats-new-version-option"
                        data-testid={`whats-new-version-${note.version}`}
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onChange(note.version);
                          setOpen(false);
                        }}
                      >
                        <span>v{note.version}</span>
                        <time dateTime={note.date}>{note.date}</time>
                        {selected && <Check size={13} />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export function WhatsNewModal({
  current,
  notes: available,
  startup = true,
  onClose,
}: {
  /** The installed version. */
  current: string;
  /** Every release up to the installed one, newest first. */
  notes: ReleaseNote[];
  /** Shown after an update (recent history) rather than from Settings (all of it). */
  startup?: boolean;
  onClose: () => void;
}) {
  const t = useT(),
    lang = useContext(LanguageContext);
  const [notes] = useState(() => (startup ? available.slice(0, STARTUP_VERSION_HISTORY_LIMIT) : available));
  const [selectedVersion, setSelectedVersion] = useState(() => notes[0]?.version ?? "");
  const selectedNote = notes.find((note) => note.version === selectedVersion) ?? notes[0];
  const open = (url: string) => void window.imago.call("openExternalLink", { url });
  if (!selectedNote) return null;
  const confetti = Array.from({ length: 14 }, (_, index) => ({
    left: `${8 + ((index * 17) % 86)}%`,
    delay: `${(index % 7) * 0.18}s`,
    color: ["#2dd4bf", "#818cf8", "#fbbf24", "#f472b6"][index % 4],
  }));

  return (
    <div className="whats-new-backdrop" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("Novedades")}
        className="whats-new-cinema"
        data-testid="whats-new-cinematic-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="whats-new-hero">
          <div className="whats-new-aurora" aria-hidden="true" />
          <div className="whats-new-stars" aria-hidden="true" />
          {confetti.map((piece, index) => (
            <i
              key={index}
              className="whats-new-confetti"
              style={{ "--confetti-left": piece.left, "--confetti-delay": piece.delay, "--confetti-color": piece.color } as CSSProperties}
            />
          ))}
          <button className="whats-new-close" onClick={onClose} aria-label={t("Cerrar")}>
            <X size={16} />
          </button>
          <div className="whats-new-hero-copy">
            <div className="whats-new-kicker">
              <Star size={14} /> {t("Novedades")}
            </div>
            <h2>{t("Nodus Imago acaba de mejorar")}</h2>
            <p>{t("Consulta las nuevas funciones y mejoras de esta versión.")}</p>
            <div className="whats-new-version">
              <span>{selectedNote.version === current.split("-")[0] ? t("Nueva versión") : t("Versiones")}</span>
              <b>v{selectedNote.version}</b>
            </div>
          </div>
          <div className="whats-new-nodi whats-new-imago">
            <div className="whats-new-nodi-glow" />
            <ImagoMark size={150} />
            <span>{t("¡Tenemos novedades!")}</span>
          </div>
        </header>

        <div className="whats-new-scroll">
          <div className="whats-new-section-header">
            <div className="whats-new-section-title">
              <span>{t("Lo más destacado")}</span>
              <i />
            </div>
            <VersionPicker notes={notes} value={selectedNote.version} onChange={setSelectedVersion} />
          </div>
          <section key={selectedNote.version} className="whats-new-release-card" data-testid="whats-new-selected-release">
            <div className="whats-new-release-version">v{selectedNote.version}</div>
            {releaseNoteSections(selectedNote).map(({ category, highlights }) => (
              <section key={category} className="whats-new-release-section" data-category={category}>
                <h3 className="whats-new-category-title">{RELEASE_SECTION_LABELS[lang][category]}</h3>
                {highlights.length === 0 && <p className="whats-new-category-empty">{RELEASE_EMPTY_SECTION[lang]}</p>}
                <ul>
                  {highlights.map((h, i) => {
                    const meta = RELEASE_SCOPE_META[h.scope];
                    const scopeLabel = t(meta.label);
                    const tooltipId = `whats-new-scope-label-${selectedNote.version.replaceAll(".", "-")}-${category}-${i}`;
                    return (
                      <li key={i}>
                        <span
                          className={`whats-new-scope whats-new-scope-${h.scope}`}
                          data-testid={`whats-new-scope-${h.scope}`}
                          style={{ "--wn-scope-color": meta.color } as CSSProperties}
                          tabIndex={0}
                          aria-label={scopeLabel}
                          aria-describedby={tooltipId}
                        >
                          {meta.icon(13)}
                          <span id={tooltipId} role="tooltip" className="whats-new-scope-tooltip">
                            {scopeLabel}
                          </span>
                        </span>
                        <span>{h[lang] ?? h.en}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </section>

          <aside className="whats-new-support" data-testid="whats-new-paypal-support">
            <div className="whats-new-support-icons">
              <div className="whats-new-support-icon">
                <BrandIcon name="paypal" size={22} />
              </div>
              <div className="whats-new-support-icon whats-new-support-icon-kofi">
                <BrandIcon name="kofi" size={22} />
              </div>
            </div>
            <div className="whats-new-flex">
              <span className="whats-new-support-label">OPEN SOURCE · {t("APOYO OPCIONAL")}</span>
              <h3>{t("Apoya el proyecto")}</h3>
              <p>
                {t("Si Nodus Imago te ayuda a investigar con imágenes y quieres contribuir voluntariamente a su desarrollo, puedes apoyar el proyecto mediante PayPal o Ko-fi. La donación es completamente opcional: no desbloquea funciones ni cambia el acceso a la aplicación.")}
              </p>
            </div>
          </aside>

          <aside className="whats-new-social" data-testid="whats-new-social">
            <div className="whats-new-flex">
              <span className="whats-new-social-label">{t("COMUNIDAD")}</span>
              <h3>{t("Sigue a Nodus")}</h3>
              <p>{t("Cada versión, los tutoriales nuevos y las dudas de otras personas se comentan en los perfiles públicos del proyecto.")}</p>
            </div>
            <div className="whats-new-social-links">
              {NODUS_SOCIAL_LINKS.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  className={`whats-new-social-button whats-new-social-${link.id}`}
                  data-testid={`whats-new-social-${link.id}`}
                  aria-label={link.label}
                  title={link.label}
                  onClick={() => open(link.url)}
                >
                  <BrandIcon name={link.id} size={15} />
                  {!link.glyphIsWordmark && link.label}
                </button>
              ))}
            </div>
          </aside>
        </div>

        <footer className="whats-new-footer">
          <span>
            <ImagoMark size={14} /> NODUS IMAGO · v{current}
          </span>
          <div className="whats-new-footer-support-group">
            <button className="whats-new-paypal-button whats-new-footer-support" data-testid="whats-new-footer-support-paypal" onClick={() => open("https://paypal.me/Jorgepb96")}>
              <BrandIcon name="paypal" size={16} /> {t("Apoyar")}
            </button>
            <button className="whats-new-kofi-button whats-new-footer-support-kofi" data-testid="whats-new-footer-support-kofi" onClick={() => open("https://ko-fi.com/nodus_app")}>
              <BrandIcon name="kofi" size={16} /> Ko-fi
            </button>
            <span className="whats-new-footer-divider" aria-hidden="true" />
            {NODUS_SOCIAL_LINKS.map((link) => (
              <button
                key={link.id}
                type="button"
                className={`whats-new-footer-social whats-new-social-${link.id}`}
                data-testid={`whats-new-footer-social-${link.id}`}
                aria-label={link.label}
                title={link.label}
                onClick={() => open(link.url)}
              >
                <BrandIcon name={link.id} size={15} />
              </button>
            ))}
          </div>
          <button onClick={onClose} data-testid="whats-new-close">
            {t("Explorar las novedades")} <ChevronRight size={14} />
          </button>
        </footer>
      </section>
    </div>
  );
}

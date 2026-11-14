// First-run introduction, adapted from Nodus Research's essential guide:
// choose the language, see what Nodus Imago does in a few slides, decide how
// to search by meaning (local model, API or literal only) and, at the end,
// start the guided tour of the interface. Replayable from Settings.
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Cloud,
  Compass,
  Cpu,
  Database,
  Images,
  Lightbulb,
  Lock,
  ScanSearch,
  Search,
  ShieldCheck,
  Sparkles,
  Type,
} from "lucide-react";
import type { ModelPreparation } from "../../shared/modelPreparation";
import { SLIDES } from "../welcomeSlides";
import { useT } from "../i18n";
import { ImagoMark } from "./ImagoMark";

/** Bump when the introduction changes enough to show it again. */
export const WELCOME_VERSION = 1;

type Choice = "local" | "api" | "literal";
const formatBytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

export function Welcome({
  language,
  onLanguage,
  onFinish,
}: {
  language: "es" | "en";
  onLanguage: (language: "es" | "en") => Promise<void>;
  /** `tour`: start the guided tour; `models` in `choice`: open model settings. */
  onFinish: (result: { tour: boolean; choice: Choice | null }) => void;
}) {
  const t = useT(),
    [chosen, setChosen] = useState(false),
    [index, setIndex] = useState(0),
    [choice, setChoice] = useState<Choice | null>(null),
    [plan, setPlan] = useState<ModelPreparation | null>(null),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState<string | null>(null);
  const modelStep = SLIDES.length,
    lastStep = SLIDES.length + 1,
    total = SLIDES.length + 2;
  useEffect(() => {
    void window.imago
      .call("modelPreparation")
      .then(setPlan)
      .catch(() => {});
  }, []);
  // Arrows move through the slides, as in Nodus' guide.
  useEffect(() => {
    if (!chosen) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,select,textarea")) return;
      if (e.key === "ArrowRight" && index < modelStep) setIndex((i) => i + 1);
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [chosen, index, modelStep]);

  const finish = async (tour: boolean) => {
    if (choice === "local" && plan && !plan.ready) {
      setPreparing(true);
      setError(null);
      try {
        await window.imago.call("prepareModels", { consent: true });
      } catch (e) {
        setPreparing(false);
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    onFinish({ tour, choice });
  };

  if (!chosen)
    return (
      <div className="welcome-cinema welcome-center" role="dialog" aria-modal="true" aria-labelledby="welcome-language-title">
        <div className="welcome-aurora" aria-hidden="true" />
        <main className="welcome-language-card">
          <ImagoMark size={64} />
          <p className="welcome-brand">NODUS IMAGO</p>
          <h1 id="welcome-language-title">Elige tu idioma · Choose your language</h1>
          <p>Puedes cambiarlo cuando quieras en Ajustes. · You can change it at any time in Settings.</p>
          <div className="welcome-languages">
            {(
              [
                ["es", "Español", "linear-gradient(#aa151b 0 25%, #f1bf00 25% 75%, #aa151b 75%)"],
                ["en", "English", "linear-gradient(135deg, #19335f 0 45%, #f5f5f5 45% 55%, #b31942 55%)"],
              ] as const
            ).map(([code, label, flag]) => (
              <button
                key={code}
                type="button"
                className={"welcome-language" + (language === code ? " current" : "")}
                style={{ "--flag": flag } as React.CSSProperties}
                onClick={() =>
                  void onLanguage(code).then(() => {
                    setChosen(true);
                    setIndex(0);
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </main>
      </div>
    );

  const slide = SLIDES[index];
  return (
    <div className="welcome-cinema" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-aurora" aria-hidden="true" />
      <header className="welcome-topbar">
        <span>
          NODUS IMAGO · {t("INTRODUCCIÓN")}
        </span>
        <button type="button" onClick={() => onFinish({ tour: false, choice: null })}>
          {t("Saltar introducción")}
        </button>
      </header>
      <nav className="welcome-progress" aria-label={`${index + 1}/${total}`}>
        {Array.from({ length: total }, (_, i) => (
          <button
            key={i}
            type="button"
            className={i <= index ? "active" : ""}
            aria-label={`${t("Paso")} ${i + 1}`}
            aria-current={i === index ? "step" : undefined}
            onClick={() => setIndex(i)}
          />
        ))}
      </nav>
      <main className="welcome-stage">
        <aside className="welcome-mark" aria-hidden="true">
          <ImagoMark size={132} />
        </aside>
        <article className="welcome-card" key={index}>
          {slide ? (
            <>
              <div className="welcome-eyebrow">
                {slide.icon}
                {t(slide.eyebrow)}
              </div>
              <h1 id="welcome-title">{t(slide.title)}</h1>
              <p className="welcome-summary">{t(slide.summary)}</p>
              {slide.points && (
                <ul className="welcome-points">
                  {slide.points.map((p) => (
                    <li key={p.title}>
                      <span className="welcome-point-icon">{p.icon}</span>
                      <div>
                        <b>{t(p.title)}</b>
                        <span>{t(p.body)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {slide.tip && (
                <p className="welcome-tip">
                  <Lightbulb size={16} />
                  {t(slide.tip)}
                </p>
              )}
            </>
          ) : index === modelStep ? (
            <>
              <div className="welcome-eyebrow">
                <Cpu size={15} />
                {t("MODELOS")}
              </div>
              <h1 id="welcome-title">{t("¿Cómo quieres buscar por significado?")}</h1>
              <p className="welcome-summary">
                {t("Elige ahora o más tarde en Ajustes. La búsqueda literal funciona siempre, sin modelos.")}
              </p>
              <div className="welcome-choices" role="radiogroup" aria-label={t("Modelos")}>
                {(
                  [
                    [
                      "local",
                      <Cpu size={20} key="i" />,
                      "En este equipo",
                      plan?.ready
                        ? t("El modelo local ya está preparado en este equipo.")
                        : `${t("EmbeddingGemma 2 se descarga una vez")}${plan ? ` (${formatBytes(plan.remainingBytes)})` : ""} ${t("y funciona sin conexión. Indexar una colección grande lleva tiempo; puedes seguir trabajando mientras tanto.")}`,
                      t("Recomendado"),
                    ],
                    [
                      "api",
                      <Cloud size={20} key="i" />,
                      "Mediante una API",
                      t("Para equipos con menos recursos: Gemini, OpenAI u otro proveedor compatible calcula los vectores. Requiere una clave y envía las imágenes al proveedor."),
                      null,
                    ],
                    [
                      "literal",
                      <Type size={20} key="i" />,
                      "Solo búsqueda literal",
                      t("Sin descargas ni conexiones. Podrás activar la búsqueda por significado más adelante."),
                      null,
                    ],
                  ] as const
                ).map(([id, icon, title, body, badge]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={choice === id}
                    className={"welcome-choice" + (choice === id ? " selected" : "")}
                    onClick={() => setChoice(id)}
                  >
                    {badge && <span className="welcome-badge">{badge}</span>}
                    <span className="welcome-choice-icon">{icon}</span>
                    <b>{t(title)}</b>
                    <span>{body}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="welcome-eyebrow">
                <Check size={15} />
                {t("LISTO")}
              </div>
              <h1 id="welcome-title">{t("Todo preparado")}</h1>
              <p className="welcome-summary">
                {t(
                  choice === "local"
                    ? "Al empezar, el modelo se descargará en segundo plano; verás su progreso en Tareas."
                    : choice === "api"
                      ? "Al empezar te llevo a Ajustes para conectar el proveedor de embeddings."
                      : "Puedes preparar la búsqueda por significado cuando quieras desde Ajustes.",
                )}
              </p>
              <p className="welcome-summary">
                {t("Te enseño en un minuto dónde está cada cosa con un recorrido por la aplicación. Puedes repetirlo cuando quieras desde Ajustes.")}
              </p>
              {error && <p className="welcome-error" role="alert">{t(error)}</p>}
            </>
          )}
        </article>
      </main>
      <footer className="welcome-footer">
        <button
          type="button"
          className="welcome-button ghost"
          disabled={index === 0 || preparing}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft size={16} />
          {t("Anterior")}
        </button>
        <span>{t("Usa las flechas para avanzar a tu ritmo")}</span>
        {index < lastStep ? (
          <button
            type="button"
            className="welcome-button primary"
            disabled={index === modelStep && !choice}
            onClick={() => setIndex((i) => i + 1)}
          >
            {t(index === modelStep ? "Continuar" : "Siguiente")}
            <ArrowRight size={16} />
          </button>
        ) : (
          <div className="welcome-final-actions">
            <button type="button" className="welcome-button ghost" disabled={preparing} onClick={() => void finish(false)}>
              {t("Empezar sin recorrido")}
            </button>
            <button type="button" className="welcome-button primary" disabled={preparing} onClick={() => void finish(true)}>
              <Compass size={16} />
              {t(preparing ? "Preparando…" : "Hacer el recorrido")}
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

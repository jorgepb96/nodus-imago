// The Tutorials section: a searchable list of short guided tutorials, each
// one a single task followed on the real interface (src/tutorials.ts).
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Camera,
  Check,
  FileImage,
  FileSpreadsheet,
  Link2,
  PartyPopper,
  PencilLine,
  Clock3,
  Columns2,
  Compass,
  Crop,
  Database,
  Download,
  FileText,
  GraduationCap,
  HardDrive,
  History,
  ImagePlus,
  Info,
  Lightbulb,
  MapPin,
  MessageSquare,
  MessageSquareText,
  Network,
  Play,
  ScanSearch,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Wand2,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { formatNumber, useT } from "../i18n";
import { nextTutorial, searchTutorials, TUTORIAL_LEVELS, TUTORIALS, type Tutorial, type TutorialLevel } from "../tutorials";

const ICONS: Record<string, LucideIcon> = {
  "first-database": Database,
  "attach-image": ImagePlus,
  "ai-describe": Sparkles,
  "ai-tags": Tags,
  "ai-transcribe": FileText,
  "add-place": MapPin,
  annotate: MessageSquareText,
  "crop-rotate": Crop,
  "similar-images": ScanSearch,
  "semantic-search": Search,
  "filter-sort": SlidersHorizontal,
  compare: Columns2,
  suggest: Lightbulb,
  automations: Workflow,
  chat: MessageSquare,
  timeline: History,
  statistics: BarChart3,
  patterns: Network,
  restore: Wand2,
  "cite-export": Download,
  backups: HardDrive,
  "edit-properties": PencilLine,
  "import-catalog": FileSpreadsheet,
  "then-now": Camera,
  authorities: Link2,
  plates: FileImage,
};

const DONE_KEY = "imago.tutorials.done";
/** Tutorials finished on this computer: a convenience, so it may be empty. */
export function readDoneTutorials(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
export function markTutorialDone(id: string) {
  try {
    const done = new Set(readDoneTutorials()).add(id);
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    /* A convenience only. */
  }
}

const minutesText =(t: (s: string) => string, tutorial: Tutorial) =>
  (tutorial.steps.length === 1 ? t("1 paso") : t("{n} pasos").replace("{n}", String(tutorial.steps.length))) +
  " · " +
  t("{m} min").replace("{m}", String(tutorial.minutes));

export function TutorialsView({
  done,
  onStart,
  onTour,
  compact = false,
  finished,
}: {
  /** Ids of the tutorials already finished. */
  done: string[];
  onStart: (tutorial: Tutorial) => void;
  /** Replay the general tour of the screen. */
  onTour: () => void;
  /** Inside the window opened from the top bar: no page heading. */
  compact?: boolean;
  /** The tutorial just finished, to congratulate and suggest the next one. */
  finished?: Tutorial | null;
}) {
  const t = useT(),
    [query, setQuery] = useState(""),
    [level, setLevel] = useState<TutorialLevel | "all">("all");
  const found = useMemo(() => searchTutorials(query, t), [query, t]);
  const shown = level === "all" ? found : found.filter((tutorial) => tutorial.level === level);
  const count = (id: TutorialLevel | "all") =>
    id === "all" ? found.length : found.filter((tutorial) => tutorial.level === id).length;
  const doneCount = TUTORIALS.filter((tutorial) => done.includes(tutorial.id)).length,
    next = nextTutorial(done),
    percent = Math.round((doneCount / TUTORIALS.length) * 100),
    browsing = !query && level === "all";
  // Each tutorial keeps its number in the path, also when filtered.
  const number = (tutorial: Tutorial) => TUTORIALS.indexOf(tutorial) + 1;
  const levelOf = (tutorial: Tutorial) => TUTORIAL_LEVELS.findIndex((l) => l.id === tutorial.level);

  const card = (tutorial: Tutorial) => {
    const Icon = ICONS[tutorial.id] ?? GraduationCap,
      finishedThis = done.includes(tutorial.id),
      isNext = next?.id === tutorial.id;
    return (
      <article
        key={tutorial.id}
        className={"tutorial-card" + (finishedThis ? " is-done" : "") + (isNext ? " is-next" : "")}
        data-testid={`tutorial-${tutorial.id}`}
      >
        <header>
          <span className="tutorial-icon" aria-hidden="true">
            <Icon size={18} />
          </span>
          <span className="tutorial-category">
            {t("Nivel {n}").replace("{n}", String(levelOf(tutorial) + 1))} · {number(tutorial)}
          </span>
          {finishedThis ? (
            <span className="tutorial-done">
              <Check size={12} />
              {t("Hecho")}
            </span>
          ) : (
            isNext && <span className="tutorial-next-badge">{t("Siguiente")}</span>
          )}
        </header>
        <h2>{t(tutorial.title)}</h2>
        <p>{t(tutorial.summary)}</p>
        {tutorial.needs && (
          <p className="tutorial-needs">
            <Info size={13} aria-hidden="true" />
            <span>
              <b>{t("Necesitas")}:</b> {t(tutorial.needs)}
            </span>
          </p>
        )}
        <footer>
          <span className="tutorial-meta">
            <Clock3 size={12} aria-hidden="true" />
            {minutesText(t, tutorial)}
          </span>
          <button type="button" className={"button" + (finishedThis ? "" : " primary")} onClick={() => onStart(tutorial)}>
            <Play size={13} />
            {t(finishedThis ? "Repetir" : "Empezar")}
          </button>
        </footer>
      </article>
    );
  };

  return (
    <div className={"tutorials-page" + (compact ? " is-compact" : "")} data-testid="tutorials">
      {!compact && (
        <header className="tutorials-head">
          <span className="tutorials-head-icon" aria-hidden="true">
            <GraduationCap size={22} />
          </span>
          <div>
            <h1>{t("Tutoriales")}</h1>
            <p>
              {t("Aprende Nodus Imago paso a paso. Cada tutorial enseña una sola tarea sobre la pantalla real: tú la haces y el tutorial te señala dónde. Están ordenados de lo esencial a lo más avanzado.")}
            </p>
          </div>
        </header>
      )}

      {finished && (
        <section className="tutorial-finished" role="status" data-testid="tutorial-finished">
          <PartyPopper size={22} aria-hidden="true" />
          <div>
            <h2>{t("¡Bien hecho! Has terminado «{t}».").replace("{t}", t(finished.title))}</h2>
            <p>
              {next
                ? t("Ya sabes una cosa más. Cuando quieras, sigue con el siguiente del itinerario.")
                : t("Has completado todo el itinerario: ya conoces todo lo que hace Nodus Imago.")}
            </p>
          </div>
        </section>
      )}

      <section className="tutorials-path" aria-label={t("Tu progreso")}>
        <div className="tutorials-path-top">
          <strong>{t("Tu progreso")}</strong>
          <span data-testid="tutorials-progress">
            {t("{d} de {n} terminados")
              .replace("{d}", formatNumber(doneCount, 0))
              .replace("{n}", formatNumber(TUTORIALS.length, 0))}
          </span>
        </div>
        <div
          className="tutorials-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={t("Tu progreso")}
        >
          <i style={{ width: `${percent}%` }} />
        </div>
        {next ? (
          <div className="tutorials-continue">
            <span className="tutorials-continue-label">{t(doneCount ? "Continúa por aquí" : "Empieza por aquí")}</span>
            <span className="tutorials-continue-title">
              {number(next)}. {t(next.title)}
              <small>{minutesText(t, next)}</small>
            </span>
            <button type="button" className="button primary" data-testid="tutorial-continue" onClick={() => onStart(next)}>
              {t("Empezar")}
              <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <p className="tutorials-complete">{t("Has completado todo el itinerario. Puedes repetir cualquier tutorial cuando quieras.")}</p>
        )}
      </section>

      <div className="tutorials-search" role="search">
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          aria-label={t("Buscar tutoriales")}
          placeholder={t("Busca lo que quieres aprender: etiquetas, mapa, comentar…")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="tutorials-search"
        />
        {query && (
          <button type="button" className="tutorials-clear" aria-label={t("Borrar la búsqueda")} onClick={() => setQuery("")}>
            <X size={15} />
          </button>
        )}
      </div>

      <div className="tutorials-filters" role="group" aria-label={t("Niveles")}>
        {[{ id: "all" as const, label: "Todos" }, ...TUTORIAL_LEVELS].map(({ id, label }, index) => (
          <button
            key={id}
            type="button"
            className={level === id ? "active" : ""}
            aria-pressed={level === id}
            disabled={id !== "all" && !count(id)}
            onClick={() => setLevel(id)}
          >
            {id !== "all" && <b>{index}</b>}
            {t(label)}
            <span>{count(id)}</span>
          </button>
        ))}
      </div>

      {browsing && (
        <section className="tutorial-tour">
          <Compass size={20} aria-hidden="true" />
          <div>
            <h2>{t("Recorrido por la pantalla")}</h2>
            <p>{t("Si es tu primera vez, empieza aquí: un recorrido que señala cada parte de la pantalla y explica para qué sirve.")}</p>
          </div>
          <button type="button" className="button" onClick={onTour}>
            <Play size={14} />
            {t("Ver el recorrido")}
          </button>
        </section>
      )}

      {!shown.length ? (
        <p className="tutorials-empty" role="status">
          {t("Ningún tutorial coincide con «{q}». Prueba con otra palabra, como «imagen», «IA» o «mapa».").replace("{q}", query)}
        </p>
      ) : query ? (
        <div className="tutorial-grid">{shown.map(card)}</div>
      ) : (
        TUTORIAL_LEVELS.filter((l) => level === "all" || l.id === level).map((l) => {
          const items = shown.filter((tutorial) => tutorial.level === l.id),
            finishedHere = items.filter((tutorial) => done.includes(tutorial.id)).length;
          if (!items.length) return null;
          return (
            <section key={l.id} className="tutorial-level" data-testid={`level-${l.id}`}>
              <header>
                <span className={"tutorial-level-number" + (finishedHere === items.length ? " is-done" : "")} aria-hidden="true">
                  {finishedHere === items.length ? <Check size={15} /> : TUTORIAL_LEVELS.indexOf(l) + 1}
                </span>
                <div>
                  <h2>
                    {t("Nivel {n}").replace("{n}", String(TUTORIAL_LEVELS.indexOf(l) + 1))} · {t(l.label)}
                  </h2>
                  <p>{t(l.summary)}</p>
                </div>
                <span className="tutorial-level-count">
                  {finishedHere}/{items.length}
                </span>
              </header>
              <div className="tutorial-grid">{items.map(card)}</div>
            </section>
          );
        })
      )}
    </div>
  );
}

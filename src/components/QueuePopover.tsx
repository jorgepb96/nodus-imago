import { useEffect, useRef, useState } from "react";
import { X, Pause, Play, Clock3 } from "lucide-react";
import type { Job } from "../../shared/imago";
import { Button } from "./ui";
import { Jobs } from "./Settings";
import type { Perform } from "./Properties";
export type QueueFilter = "all" | "images" | "analyze" | "index" | "download";
export function QueuePopover({
  jobs,
  initialFilter,
  onClose,
  perform,
  onChanged,
  parallelJobs,
}: {
  jobs: Job[];
  initialFilter: QueueFilter;
  onClose: () => void;
  perform: Perform;
  onChanged: () => void;
  parallelJobs: number;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [filter, setFilter] = useState(initialFilter),
    [history, setHistory] = useState(false);
  useEffect(() => setFilter(initialFilter), [initialFilter]);
  useEffect(() => {
    const listener = (e: PointerEvent) => {
      if (
        !ref.current?.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest("[data-queue-trigger]")
      )
        onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", listener);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", listener);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const filtered = jobs.filter(
      (j) =>
        (filter === "all" || j.kind === filter) &&
        (history || !["completed", "cancelled"].includes(j.state)),
    ),
    running = jobs.filter((j) => j.state === "running").length;
  return (
    <div
      ref={ref}
      className="queue-popover"
      role="dialog"
      aria-label="Colas y tareas"
    >
      <header>
        <div className="row">
          <Clock3 size={17} />
          <strong>Colas y tareas</strong>
        </div>
        <Button icon aria-label="Cerrar" onClick={onClose}>
          <X size={16} />
        </Button>
      </header>
      <div className="queue-summary">
        <span>
          <b>{running}</b> en ejecución · hasta {parallelJobs} trabajos
          simultáneos
        </span>
        <div className="row">
          <Button
            icon
            title="Pausar todas"
            onClick={() =>
              void perform(async () => {
                for (const j of jobs.filter((j) =>
                  ["running", "queued"].includes(j.state),
                ))
                  await window.imago.call("controlJob", {
                    id: j.id,
                    action: "pause",
                  });
                onChanged();
              })
            }
          >
            <Pause size={14} />
          </Button>
          <Button
            icon
            title="Reanudar todas"
            onClick={() =>
              void perform(async () => {
                for (const j of jobs.filter((j) => j.state === "paused"))
                  await window.imago.call("controlJob", {
                    id: j.id,
                    action: "resume",
                  });
                onChanged();
              })
            }
          >
            <Play size={14} />
          </Button>
        </div>
      </div>
      <div className="queue-tabs">
        {[
          ["all", "Todas"],
          ["images", "Imágenes"],
          ["analyze", "IA"],
          ["index", "Embeddings"],
          ["download", "Descargas"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "active" : ""}
            onClick={() => setFilter(id as QueueFilter)}
          >
            {label}
            <span>
              {
                jobs.filter(
                  (j) =>
                    (id === "all" || j.kind === id) &&
                    ["queued", "running", "paused"].includes(j.state),
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="queue-content">
        <Jobs jobs={filtered} perform={perform} onChanged={onChanged} />
      </div>
      <footer>
        <label className="check-label">
          <input
            type="checkbox"
            checked={history}
            onChange={(e) => setHistory(e.target.checked)}
          />
          Mostrar completadas
        </label>
        <span className="muted">El progreso se conserva al cerrar Imago.</span>
      </footer>
    </div>
  );
}

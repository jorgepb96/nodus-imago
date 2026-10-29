import {
  Database,
  Image,
  ScanSearch,
  Layers3,
  ArrowRight,
  Plus,
  Upload,
  Cpu,
  Clock3,
  ShieldCheck,
} from "lucide-react";
import type { Status, Job } from "../../shared/imago";
import type { DatabaseSummary } from "../../shared/databases";
import { Button } from "./ui";
import { useT } from "../i18n";
export function Home({
  status,
  databases,
  onCreate,
  onImport,
  onDatabase,
  onModels,
  onSearch,
  onQueue,
}: {
  status: Status | null;
  databases: DatabaseSummary[];
  onCreate: () => void;
  onImport: () => void;
  onDatabase: (id: string) => void;
  onModels: () => void;
  onSearch: () => void;
  onQueue: () => void;
}) {
  const t = useT(),
    jobs = status?.jobs ?? [],
    live = jobs.filter((j) =>
      ["running", "queued", "paused"].includes(j.state),
    ),
    failed = jobs.filter((j) => j.state === "failed"),
    images = status?.images ?? 0,
    indexed = status?.indexed ?? 0;
  return (
    <div className="nodus-home">
      <section className="home-hero">
        <div className="home-hero-icon">
          <Image size={29} />
        </div>
        <div>
          <div className="home-kicker">
            NODUS IMAGO <i />
          </div>
          <h1>{t("Tu espacio de investigación visual")}</h1>
          <p>{t("Organiza tus imágenes, describe tus fuentes y encuentra conexiones en una colección local.")}</p>
        </div>
      </section>
      <section className="home-next">
        <div>
          <span className="home-section-label">{t("SIGUIENTE PASO")}</span>
          <h2>
            {!databases.length
              ? t("Crea tu primera base de datos")
              : !images
                ? t("Incorpora tus fuentes visuales")
                : !indexed
                  ? t("Prepara la búsqueda multimodal")
                  : t("Explora tu colección")}
          </h2>
          <p>
            {!databases.length
              ? t("Importa una tabla existente o empieza con un esquema definido por ti.")
              : !images
                ? t("Abre una base de datos e importa imágenes o vincula una carpeta de originales.")
                : !indexed
                  ? t("Configura tus modelos locales para indexar imágenes y recuperar resultados por su significado.")
                  : t("Combina consultas, imágenes de referencia y propiedades de tus bases de datos.")}
          </p>
        </div>
        <div className="row">
          {!databases.length ? (
            <>
              <Button onClick={onImport}>
                <Upload size={15} />
                {t("Importar CSV")}
              </Button>
              <Button primary onClick={onCreate}>
                <Plus size={15} />
                {t("Nueva base de datos")}
              </Button>
            </>
          ) : (
            <Button primary onClick={images && !indexed ? onModels : onSearch}>
              <ScanSearch size={16} />
              {images && !indexed ? t("Configurar modelos") : t("Abrir búsqueda")}
            </Button>
          )}
        </div>
      </section>
      <section className="corpus-health">
        <header>
          <span className="health-icon">
            <Layers3 size={21} />
          </span>
          <div>
            <h2>{t("Estado de la colección")}</h2>
            <p>{t("Fuentes, imágenes e indexación de tu espacio de trabajo.")}</p>
          </div>
          <span className="spacer" />
          <small>{(status?.rows ?? 0).toLocaleString()} {t("registros")}</small>
        </header>
        <div className="health-stats">
          <button
            onClick={() =>
              databases[0] ? onDatabase(databases[0].id) : onCreate()
            }
          >
            <span>
              <Database size={14} />
              {t("Bases de datos")}
            </span>
            <b>{databases.length}</b>
            <small>{t("Esquemas independientes")}</small>
          </button>
          <button
            onClick={() =>
              databases[0] ? onDatabase(databases[0].id) : onCreate()
            }
          >
            <span>
              <Image size={14} />
              {t("Imágenes")}
            </span>
            <b>{images.toLocaleString()}</b>
            <small>{t("Originales intactos")}</small>
          </button>
          <button onClick={onModels}>
            <span>
              <ScanSearch size={14} />
              {t("Embeddings")}
            </span>
            <b>
              {indexed.toLocaleString()}
              <em> / {images.toLocaleString()}</em>
            </b>
            <progress value={indexed} max={Math.max(1, images)} />
            <small>{t("Con el modelo y dimensiones activos")}</small>
          </button>
          <button onClick={onQueue}>
            <span>
              <Clock3 size={14} />
              {t("Colas activas")}
            </span>
            <b>{live.length}</b>
            <small>
              {jobs.filter((j) => j.state === "running").length} {t("en paralelo ·")}{" "}
              {failed.length} {t("con errores")}
            </small>
          </button>
        </div>
        <div className="home-actions">
          <span className="home-section-label">{t("PRÓXIMAS ACCIONES")}</span>
          <button onClick={onImport}>
            <i className="dot indigo" />
            <span>
              {t("Importa una base de datos")}
              <small>{t("CSV, Nodus y Notion; conserva tu clasificación.")}</small>
            </span>
            <ArrowRight size={16} />
          </button>
          <button onClick={onModels}>
            <i className="dot green" />
            <span>
              {t("Configura la descripción y clasificación")}
              <small>{t("Modelos locales o APIs opcionales, seleccionables por columna.")}</small>
            </span>
            <ArrowRight size={16} />
          </button>
          <button onClick={onQueue}>
            <i className="dot amber" />
            <span>
              {t("Supervisa tus colas de trabajo")}
              <small>{t("Procesa distintas columnas en paralelo, pausa y reanuda cada trabajo.")}</small>
            </span>
            <ArrowRight size={16} />
          </button>
        </div>
      </section>
      {!!databases.length && (
        <section className="home-recent">
          <h2>{t("Bases de datos recientes")}</h2>
          <div>
            {databases.slice(0, 4).map((d) => (
              <button key={d.id} onClick={() => onDatabase(d.id)}>
                <Database size={21} />
                <strong>{d.name}</strong>
                <span>{d.rowCount.toLocaleString()} {t("registros")}</span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        </section>
      )}
      <p className="home-private">
        <ShieldCheck size={13} />
        {status?.settings.remoteEnabled
          ? t("APIs opcionales activadas. Solo se utilizan en las tareas que selecciones.")
          : t("Todo permanece en este equipo. Sin cuentas ni telemetría.")}
      </p>
    </div>
  );
}

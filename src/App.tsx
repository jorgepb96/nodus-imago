import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  Database,
  Search,
  Settings as SettingsIcon,
  Plus,
  Upload,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  Table2,
  SlidersHorizontal,
  FolderInput,
  ImagePlus,
  ArrowUpRight,
  Download,
  X,
  Filter,
  Bookmark,
  ScanSearch,
  Sparkles,
  Undo2,
  Trash2,
  Check,
  MoreHorizontal,
  RefreshCw,
  Home as HomeIcon,
  Monitor,
  Moon,
  Sun,
  Clock3,
  Image as ImageIcon,
  KeyRound,
} from "lucide-react";
import type { DatabaseDetail, DatabaseSummary } from "../shared/databases";
import { decodeMultiSelect } from "../shared/databases";
import type { CsvImportPlanData } from "../shared/databaseCsv";
import type {
  ImagePlan,
  Page,
  Proposal,
  PropertyFilter,
  RecordRow,
  SavedSearch,
  SearchInput,
  Settings as Preferences,
  Status,
} from "../shared/imago";
import { LanguageContext, useT } from "./i18n";
import { applyTheme } from "./theme/apply";
import { Button, Empty, Modal, Spinner, Thumbnail } from "./components/ui";
import { Cell } from "./components/Cell";
import { Properties, type Perform } from "./components/Properties";
import { CsvImport, ImageImport } from "./components/ImportDialogs";
import { Filters } from "./components/Filters";
import { RecordPanel } from "./components/RecordPanel";
import { Settings, Jobs } from "./components/Settings";
import { Home } from "./components/Home";
import { ImagoMark } from "./components/ImagoMark";
import { QueuePopover, type QueueFilter } from "./components/QueuePopover";

export default function App() {
  const [language, setLanguage] = useState<"es" | "en">("es");
  return (
    <LanguageContext.Provider value={language}>
      <Workspace onLanguage={setLanguage} />
    </LanguageContext.Provider>
  );
}
function Workspace({ onLanguage }: { onLanguage: (v: "es" | "en") => void }) {
  const t = useT(),
    api = window.imago;
  const [area, setArea] = useState<
      "home" | "databases" | "search" | "settings"
    >("home"),
    [databases, setDatabases] = useState<DatabaseSummary[]>([]),
    [databaseId, setDatabaseId] = useState(""),
    [detail, setDetail] = useState<DatabaseDetail | null>(null),
    [status, setStatus] = useState<Status | null>(null),
    [tick, setTick] = useState(0),
    [busy, setBusy] = useState(0),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    );
  const [collapsed, setCollapsed] = useState(false),
    [settingsTab, setSettingsTab] = useState("api"),
    [queueFilter, setQueueFilter] = useState<QueueFilter | null>(null);
  const [page, setPage] = useState<Page>({ rows: [], total: 0 }),
    [loading, setLoading] = useState(false),
    [view, setView] = useState<"gallery" | "table">("gallery"),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState(""),
    [mode, setMode] = useState<"literal" | "semantic" | "hybrid">("literal"),
    [match, setMatch] = useState<"words" | "phrase" | "partial">("words"),
    [scope, setScope] = useState<string[] | undefined>(),
    [imageQuery, setImageQuery] = useState<{
      token: string;
      fileName: string;
    } | null>(null),
    [similarId, setSimilarId] = useState<string | undefined>(),
    [weight, setWeight] = useState(0.5),
    [offset, setOffset] = useState(0),
    [sortColumn, setSortColumn] = useState(""),
    [descending, setDescending] = useState(false),
    [executed, setExecuted] = useState<SearchInput>({}),
    [filters, setFilters] = useState<PropertyFilter[]>([]),
    [logic, setLogic] = useState<"and" | "or">("and"),
    [showFilters, setShowFilters] = useState(false),
    [allDetails, setAllDetails] = useState<DatabaseDetail[]>([]),
    [saved, setSaved] = useState<SavedSearch[]>([]);
  const [modal, setModal] = useState<
      | "create"
      | "rename"
      | "properties"
      | "deleteRows"
      | "deleteDatabase"
      | "saveSearch"
      | "analyze"
      | "proposals"
      | "jobs"
      | null
    >(null),
    [name, setName] = useState(""),
    [csv, setCsv] = useState<CsvImportPlanData | null>(null),
    [imagePlan, setImagePlan] = useState<ImagePlan | null>(null),
    [openRow, setOpenRow] = useState<RecordRow | null>(null),
    [recordDetail, setRecordDetail] = useState<DatabaseDetail | null>(null),
    [proposals, setProposals] = useState<Proposal[]>([]),
    [analysisColumns, setAnalysisColumns] = useState<string[]>([]),
    [analysisLanguage, setAnalysisLanguage] = useState("Español"),
    [detailed, setDetailed] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(),
    sequence = useRef(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      for (const details of document.querySelectorAll("details[open]"))
        if (!details.contains(target) || target.closest(".actions-menu button"))
          details.removeAttribute("open");
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 14000 : 6000);
  }, []);
  const perform: Perform = useCallback(
    async (work, message) => {
      setBusy((n) => n + 1);
      try {
        await work();
        if (message) notify(message);
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), true);
      } finally {
        setBusy((n) => n - 1);
      }
    },
    [notify],
  );
  useEffect(() => {
    if (!api) return;
    return api.onChange(refresh);
  }, [api, refresh]);
  useEffect(() => {
    if (!api) return;
    return api.onDrop((result) => {
      if (result.error) notify(result.error, true);
      else if (result.plan) setImagePlan(result.plan);
      else if (result.queryImage) {
        setImageQuery(result.queryImage);
        setSimilarId(undefined);
      }
    });
  }, [api, notify]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void Promise.all([
      api.call("status"),
      api.call("listDatabases"),
      api.call("savedSearches"),
    ])
      .then(([s, ds, ss]) => {
        if (cancelled) return;
        setStatus(s);
        setDatabases(ds);
        setSaved(ss);
        onLanguage(s.settings.language);
        applyTheme(s.settings);
      })
      .catch((e) => notify(e.message, true));
    return () => {
      cancelled = true;
    };
  }, [api, tick, notify, onLanguage]);
  useEffect(() => {
    if (!status?.jobs.some((j) => ["queued", "running"].includes(j.state)))
      return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [status?.jobs, refresh]);
  useEffect(() => {
    if (!status) return;
    const media = matchMedia("(prefers-color-scheme: dark)"),
      listener = () => applyTheme(status.settings);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [status]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void Promise.all(databases.map((d) => api.call("detail", { id: d.id })))
      .then((ds) => {
        if (!cancelled) setAllDetails(ds);
      })
      .catch((e) => notify(e.message, true));
    return () => {
      cancelled = true;
    };
  }, [api, databases, notify]);
  useEffect(() => {
    setDetail(allDetails.find((d) => d.database.id === databaseId) ?? null);
  }, [databaseId, allDetails]);
  useEffect(() => {
    setSelected(new Set());
    setOffset(0);
    setSortColumn("");
  }, [area, databaseId]);
  useEffect(() => {
    if (
      !api ||
      area === "settings" ||
      area === "home" ||
      (area === "databases" && !databaseId)
    ) {
      setPage({ rows: [], total: 0 });
      return;
    }
    const id = ++sequence.current;
    setLoading(true);
    const input =
      area === "search"
        ? { ...executed, offset, limit: 100 }
        : {
            databaseIds: [databaseId],
            filters,
            filterLogic: logic,
            sortColumn: sortColumn || undefined,
            descending,
            offset,
            limit: 100,
          };
    void api
      .call("search", input)
      .then((p) => {
        if (id === sequence.current) setPage(p);
      })
      .catch((e) => {
        if (id === sequence.current) notify(e.message, true);
      })
      .finally(() => {
        if (id === sequence.current) setLoading(false);
      });
  }, [
    api,
    area,
    databaseId,
    executed,
    filters,
    logic,
    offset,
    sortColumn,
    descending,
    tick,
    notify,
  ]);
  useEffect(() => {
    // Deleting rows or a changed result set can leave the page beyond the end.
    if (offset > 0 && offset >= page.total) setOffset(0);
  }, [offset, page.total]);
  const openRowId = openRow?.id;
  useEffect(() => {
    if (openRowId)
      void api
        .call("getRow", { id: openRowId })
        .then(setOpenRow)
        .catch(() => setOpenRow(null));
  }, [api, openRowId, tick]);
  const navigate = (id: string) => {
    setArea("databases");
    setDatabaseId(id);
    setExecuted({});
    setQuery("");
    setFilters([]);
    setShowFilters(false);
    setSimilarId(undefined);
  };
  const open = async (row: RecordRow) => {
    const d = await api.call("detail", { id: row.databaseId });
    setRecordDetail(d);
    setOpenRow(await api.call("getRow", { id: row.id }));
  };
  const select = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const startCsv = () =>
    void perform(async () => {
      const p = await api.call("csvPreview");
      if (p) setCsv(p);
    });
  const startImages = (source: "files" | "folder") => {
    if (!detail) return;
    void perform(async () => {
      const plan = await api.call("imagePreview", {
        databaseId: detail.database.id,
        source,
      });
      if (plan) setImagePlan(plan);
    });
  };
  const importExternal = (command: "nodusImport" | "notionImport") =>
    void perform(async () => {
      const result = await api.call(command);
      if (result) {
        refresh();
        notify(
          `${result.databases} bases · ${result.attachments} adjuntos. ${result.notices.join(" ")}`,
        );
      }
    });
  const searchNow = () => {
    setOffset(0);
    setSelected(new Set());
    setExecuted({
      query,
      mode,
      match,
      databaseIds: scope,
      filters,
      filterLogic: logic,
      imageToken: imageQuery?.token,
      similarAssetId: similarId,
      semanticWeight: weight,
    });
  };
  const similar = (id: string) => {
    setOpenRow(null);
    setArea("search");
    setMode("semantic");
    setQuery("");
    setSimilarId(id);
    setImageQuery(null);
    setOffset(0);
    setSelected(new Set());
    setExecuted({
      mode: "semantic",
      databaseIds: scope,
      similarAssetId: id,
      filters,
      filterLogic: logic,
    });
  };
  const modelReady = status?.models.some(
    (m) => m.task === "embedding" && m.verified,
  );
  const visibleDetails =
    area === "search"
      ? allDetails.filter(
          (d) => scope === undefined || scope.includes(d.database.id),
        )
      : detail
        ? [detail]
        : [];
  const exportRows = (format: "csv" | "json" | "xlsx") =>
    void perform(async () => {
      const rows = selected.size
          ? await Promise.all(
              [...selected].map((id) => api.call("getRow", { id })),
            )
          : [],
        dbIds = selected.size
          ? [...new Set(rows.map((r) => r.databaseId))]
          : databaseId
            ? [databaseId]
            : [];
      for (const id of dbIds)
        await api.call("export", {
          databaseId: id,
          format,
          rowIds: selected.size
            ? [...selected].filter((rowId) =>
                rows.some((r) => r.id === rowId && r.databaseId === id),
              )
            : undefined,
        });
    });
  const proposalValue = (p: Proposal) => {
    const column = allDetails
      .flatMap((d) => d.columns)
      .find((c) => c.id === p.columnId);
    if (!column) return p.value ?? "—";
    if (column.type === "multi_select") {
      try {
        const ids = JSON.parse(p.value ?? "[]") as string[];
        return (
          ids
            .map((id) => column.options.find((o) => o.id === id)?.label ?? id)
            .join(", ") || "—"
        );
      } catch {
        return p.value ?? "—";
      }
    }
    if (["select", "status"].includes(column.type))
      return (
        column.options.find((o) => o.id === p.value)?.label ?? p.value ?? "—"
      );
    return p.value?.trim() ? p.value : "—";
  };
  const tags = (row: RecordRow) => {
    const d = allDetails.find((d) => d.database.id === row.databaseId);
    return (
      d?.columns
        .filter((c) => ["multi_select", "select", "status"].includes(c.type))
        .flatMap((c) => {
          const selected =
            c.type === "multi_select"
              ? decodeMultiSelect(row.cells[c.id] ?? null)
              : [row.cells[c.id]];
          return c.options.filter((o) => selected.includes(o.id));
        })
        .slice(0, 4) ?? []
    );
  };
  if (!api)
    return (
      <div className="desktop-required">
        <Aperture size={38} />
        <h1>Nodus Imago</h1>
        <p>
          Abre la aplicación de escritorio para acceder a tu colección local.
        </p>
        <code>npm run dev</code>
      </div>
    );
  return (
    <div
      className={
        "app-shell nodus-layout " + (collapsed ? "sidebar-collapsed" : "")
      }
    >
      <header className="nodus-header app-titlebar">
        <button
          className="nodus-header-brand"
          title={collapsed ? t("Mostrar menú lateral") : t("Ocultar menú lateral")}
          aria-label={t("Menú lateral")}
          onClick={() => setCollapsed(!collapsed)}
        >
          <ImagoMark size={28} />
          {collapsed ? (
            <ChevronRight size={14} className="collapse-chevron" />
          ) : (
            <ChevronLeft size={14} className="collapse-chevron" />
          )}
        </button>
        <button
          className="interface-trigger"
          onClick={() => {
            setSettingsTab("appearance");
            setArea("settings");
          }}
        >
          <Monitor size={15} />
          <span>{t("Interfaz · Imago")}</span>
          <ChevronRight size={12} />
        </button>
        <span className="nodus-vault-badge">
          <ImagoMark size={16} />
          IMAGO
        </span>
        <div className="nodus-header-actions">
          {!!busy && <Spinner />}
          <Button
            icon
            title={t("Búsqueda")}
            aria-label={t("Búsqueda")}
            onClick={() => setArea("search")}
          >
            <Search size={18} />
          </Button>
          <Button
            icon
            title={t("Cambiar tema")}
            aria-label={t("Cambiar tema")}
            onClick={() =>
              void perform(async () => {
                await api.call("updateSettings", {
                  mode: document.documentElement.classList.contains("dark")
                    ? "light"
                    : "dark",
                });
                refresh();
              })
            }
          >
            {document.documentElement.classList.contains("dark") ? (
              <Sun size={18} />
            ) : (
              <Moon size={18} />
            )}
          </Button>
          {(
            [
              { filter: "images", label: t("Cola de imágenes"), Icon: ImageIcon },
              { filter: "analyze", label: t("Cola de IA"), Icon: Sparkles },
              { filter: "all", label: t("Colas y tareas"), Icon: Clock3 },
            ] as const
          ).map(({ filter, label, Icon }) => {
            const count =
              status?.jobs.filter(
                (j) =>
                  (filter === "all" || j.kind === filter) &&
                  ["running", "queued", "paused", "failed"].includes(
                    j.state,
                  ),
              ).length ?? 0;
            return (
              <span className="header-queue-action" key={filter}>
                <Button
                  icon
                  data-queue-trigger
                  aria-label={label}
                  title={label}
                  onClick={() =>
                    setQueueFilter(queueFilter === filter ? null : filter)
                  }
                >
                  <Icon size={18} />
                </Button>
                {count > 0 && <small>{count}</small>}
              </span>
            );
          })}
          <span className="header-divider" />
          <Button
            icon
            title={t("Ajustes")}
            aria-label={t("Ajustes")}
            onClick={() => {
              setSettingsTab("api");
              setArea("settings");
            }}
          >
            <SettingsIcon size={19} />
          </Button>
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <nav>
            <button
              title="Inicio"
              className={area === "home" ? "active" : ""}
              onClick={() => setArea("home")}
            >
              <HomeIcon size={18} />
              <span className="nav-title">{t("Inicio")}</span>
            </button>
            <button
              title="Bases de datos"
              className={area === "databases" ? "active" : ""}
              onClick={() => {
                setArea("databases");
                setDatabaseId("");
                setExecuted({});
                setQuery("");
                setFilters([]);
                setShowFilters(false);
              }}
            >
              <Database size={18} />
              <span className="nav-title">{t("Bases de datos")}</span>
              <span className="nav-count">{databases.length}</span>
            </button>
            <div className="nav-group-label">{t("EXPLORAR")}</div>
            <button
              title="Búsqueda"
              className={area === "search" ? "active" : ""}
              onClick={() => {
                setArea("search");
                setOffset(0);
              }}
            >
              <Search size={18} />
              <span className="nav-title">{t("Búsqueda")}</span>
            </button>
          </nav>
          <div className="sidebar-databases">
            <div className="row">
              <span className="nav-label">{t("COLECCIONES")}</span>
              <Button
                icon
                aria-label={t("Nueva base de datos")}
                onClick={() => {
                  setName("");
                  setModal("create");
                }}
              >
                <Plus size={14} />
              </Button>
            </div>
            {databases.map((d) => (
              <button
                key={d.id}
                title={d.name}
                className={
                  area === "databases" && databaseId === d.id ? "active" : ""
                }
                onClick={() => navigate(d.id)}
              >
                <span className="database-dot" />
                <span className="nav-title">{d.name}</span>
                <small>{d.rowCount.toLocaleString()}</small>
              </button>
            ))}
          </div>
          <div className="sidebar-bottom">
            <button
              title="Ajustes"
              className={area === "settings" ? "active" : ""}
              onClick={() => {
                setSettingsTab("api");
                setArea("settings");
              }}
            >
              <SettingsIcon size={18} />
              <span className="nav-title">{t("Ajustes")}</span>
            </button>
            <div className="privacy">
              <ShieldCheck size={14} />
              <span>
                {status?.settings.remoteEnabled
                  ? t("APIs opcionales activadas")
                  : t("Local y privado")}
              </span>
            </div>
          </div>
        </aside>
        <main
          className="workspace"
          data-drop-target={
            area === "search" && mode !== "literal"
              ? "search"
              : area === "databases" && detail
                ? databaseId
                : ""
          }
        >
          {area === "home" ? (
            <Home
              status={status}
              databases={databases}
              onCreate={() => {
                setName("");
                setModal("create");
              }}
              onImport={startCsv}
              onDatabase={navigate}
              onModels={() => {
                setSettingsTab("models");
                setArea("settings");
              }}
              onSearch={() => setArea("search")}
              onQueue={() => setQueueFilter("all")}
            />
          ) : area === "settings" ? (
            status && (
              <Settings
                status={status}
                initialTab={settingsTab}
                onChanged={refresh}
                perform={perform}
                notify={notify}
                details={allDetails}
              />
            )
          ) : (
            <>
              {area === "databases" && !detail ? (
                <div className="collection-home">
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">{t("Colección local")}</span>
                      <h1>{t("Bases de datos")}</h1>
                      <p>
                        {t(
                          "Un espacio para investigar a través de las imágenes.",
                        )}
                      </p>
                    </div>
                    <Button
                      primary
                      onClick={() => {
                        setName("");
                        setModal("create");
                      }}
                    >
                      <Plus size={16} />
                      {t("Nueva base de datos")}
                    </Button>
                  </div>
                  <div className="home-summary">
                    <span>
                      <b>{databases.length}</b> {t("bases de datos")}
                    </span>
                    <span>
                      <b>{status?.rows.toLocaleString() ?? 0}</b>{" "}
                      {t("registros")}
                    </span>
                    <span>
                      <b>{status?.images.toLocaleString() ?? 0}</b>{" "}
                      {t("imágenes")}
                    </span>
                  </div>
                  {databases.length ? (
                    <div className="database-cards">
                      {databases.map((d) => (
                        <button key={d.id} onClick={() => navigate(d.id)}>
                          <span className="database-card-icon">
                            <Database size={23} />
                          </span>
                          <h3>{d.name}</h3>
                          <p>
                            {d.rowCount.toLocaleString()} {t("registros")}
                          </p>
                          <span className="database-card-footer">
                            <code>{d.shortId}</code>
                            <ArrowUpRight size={16} />
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="collection-welcome">
                      <div className="welcome-art">
                        <div />
                        <div />
                        <div>
                          <Aperture size={42} strokeWidth={1} />
                        </div>
                      </div>
                      <span className="eyebrow">{t("Iniciar colección")}</span>
                      <h2>{t("Investigar empieza por mirar.")}</h2>
                      <p>
                        {t("Importa, describe y conecta tus fuentes visuales.")}
                      </p>
                      <div className="row center">
                        <Button primary onClick={startCsv}>
                          <Upload size={16} />
                          {t("Importar")} CSV
                        </Button>
                        <Button
                          onClick={() => {
                            setName("");
                            setModal("create");
                          }}
                        >
                          <Plus size={16} />
                          {t("Nueva base de datos")}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="import-sources">
                    <button onClick={startCsv}>
                      <Upload size={19} />
                      <span>
                        <strong>{t("CSV o TSV")}</strong>
                        <small>Columnas, opciones y registros</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                    <button onClick={() => importExternal("nodusImport")}>
                      <Database size={19} />
                      <span>
                        <strong>{t("Copiar datos de Nodus")}</strong>
                        <small>Importación segura desde SQLite</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                    <button onClick={() => importExternal("notionImport")}>
                      <FolderInput size={19} />
                      <span>
                        <strong>{t("ZIP de Notion")}</strong>
                        <small>Tablas y archivos de imagen</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="data-page">
                  {area === "search" ? (
                    <>
                      <div className="page-heading search-heading">
                        <div>
                          <span className="eyebrow">
                            {t("Explorar colección")}
                          </span>
                          <h1>{t("Búsqueda")}</h1>
                          <p>{t("Encuentra conexiones entre tus imágenes, textos y metadatos.")}</p>
                        </div>
                        <Button
                          onClick={() => {
                            setName("");
                            setModal("saveSearch");
                          }}
                        >
                          <Bookmark size={15} />
                          {t("Guardar búsqueda")}
                        </Button>
                      </div>
                      <form
                        className="search-box"
                        onSubmit={(e) => {
                          e.preventDefault();
                          searchNow();
                        }}
                      >
                        <div className="search-input-row">
                          <Search size={21} />
                          <input
                            aria-label={t("Buscar")}
                            placeholder={t(
                              mode === "literal"
                                ? "Buscar en títulos, etiquetas y propiedades…"
                                : "Describe las imágenes que quieres encontrar…",
                            )}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                          <Button
                            icon
                            aria-label={t("Adjuntar imagen")}
                            disabled={mode === "literal"}
                            onClick={() =>
                              void perform(async () => {
                                const image = await api.call("queryImage");
                                if (image) {
                                  setImageQuery(image);
                                  setSimilarId(undefined);
                                }
                              })
                            }
                            type="button"
                          >
                            <ImagePlus size={19} />
                          </Button>
                          <Button primary type="submit">
                            {t("Buscar")}
                            <ArrowUpRight size={14} />
                          </Button>
                        </div>
                        <div className="search-options">
                          <div className="segmented">
                            {(["literal", "semantic", "hybrid"] as const).map(
                              (m) => (
                                <button
                                  key={m}
                                  type="button"
                                  disabled={m !== "literal" && !modelReady}
                                  className={mode === m ? "active" : ""}
                                  onClick={() => {
                                    setMode(m);
                                    if (m === "literal") {
                                      setImageQuery(null);
                                      setSimilarId(undefined);
                                    }
                                  }}
                                >
                                  {m !== "literal" && <Sparkles size={12} />}{" "}
                                  {t(
                                    m === "literal"
                                      ? "Literal"
                                      : m === "semantic"
                                        ? "Semántica"
                                        : "Híbrida",
                                  )}
                                </button>
                              ),
                            )}
                          </div>
                          <details className="scope-picker">
                            <summary>
                              <Database size={14} />
                              {scope === undefined
                                ? t("Todas las bases de datos")
                                : `${scope.length} ${t("bases de datos")}`}
                              <ChevronRight size={12} />
                            </summary>
                            <div className="option-menu">
                              <label>
                                <input
                                  type="checkbox"
                                  checked={scope === undefined}
                                  onChange={() =>
                                    setScope(
                                      scope === undefined ? [] : undefined,
                                    )
                                  }
                                />
                                {t("Todas las bases de datos")}
                              </label>
                              {databases.map((d) => (
                                <label key={d.id}>
                                  <input
                                    type="checkbox"
                                    checked={
                                      scope === undefined ||
                                      scope.includes(d.id)
                                    }
                                    onChange={() =>
                                      setScope(
                                        (
                                          scope ?? databases.map((d) => d.id)
                                        ).includes(d.id)
                                          ? (
                                              scope ??
                                              databases.map((d) => d.id)
                                            ).filter((id) => id !== d.id)
                                          : [...(scope ?? []), d.id],
                                      )
                                    }
                                  />
                                  {d.name}
                                </label>
                              ))}
                            </div>
                          </details>
                        </div>
                        {(imageQuery || similarId) && (
                          <div className="query-image">
                            <ScanSearch size={15} />
                            <span>
                              {imageQuery?.fileName ??
                                t("Buscar imágenes similares")}
                            </span>
                            <Button
                              type="button"
                              icon
                              aria-label={t("Quitar imagen")}
                              onClick={() => {
                                setImageQuery(null);
                                setSimilarId(undefined);
                              }}
                            >
                              <X size={13} />
                            </Button>
                            <small>
                              {t("Texto + imagen: media de vectores normalizados, con el mismo peso.")}
                            </small>
                          </div>
                        )}
                        {mode === "hybrid" && (
                          <label className="hybrid-weight">
                            Literal{" "}
                            <input
                              aria-label="Peso semántico"
                              type="range"
                              min="0"
                              max="1"
                              step=".05"
                              value={weight}
                              onChange={(e) =>
                                setWeight(Number(e.target.value))
                              }
                            />
                            {t("Semántica")} {Math.round(weight * 100)}%
                          </label>
                        )}
                      </form>
                      {!modelReady && (
                        <p className="search-note">
                          <ShieldCheck size={14} />
                          {t("La búsqueda literal está lista. Instala un modelo local en")}{" "}
                          <button onClick={() => setArea("settings")}>
                            {t("Configuración")}
                          </button>{" "}
                          {t("para activar la búsqueda multimodal.")}
                        </p>
                      )}
                      {!!saved.length && (
                        <div className="saved-searches">
                          <Bookmark size={13} />
                          {saved.map((s) => (
                            <span key={s.id}>
                              <button
                                onClick={() => {
                                  const i = s.input;
                                  setExecuted(i);
                                  setQuery(i.query ?? "");
                                  setMode(i.mode ?? "literal");
                                  setScope(i.databaseIds);
                                  setFilters(i.filters ?? []);
                                  setLogic(i.filterLogic ?? "and");
                                  setMatch(i.match ?? "words");
                                  setWeight(i.semanticWeight ?? 0.5);
                                  setImageQuery(null);
                                  setSimilarId(i.similarAssetId);
                                  setOffset(0);
                                  setSelected(new Set());
                                }}
                              >
                                {s.name}
                              </button>
                              <button
                                aria-label={t("Eliminar")}
                                onClick={() =>
                                  void perform(async () => {
                                    await api.call("removeSearch", {
                                      id: s.id,
                                    });
                                    refresh();
                                  })
                                }
                              >
                                <X size={11} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    detail && (
                      <div className="page-heading database-heading">
                        <div>
                          <span className="eyebrow">
                            {detail.database.shortId}
                          </span>
                          <h1>{detail.database.name}</h1>
                          <p>
                            {detail.database.rowCount.toLocaleString()}{" "}
                            {t("registros")} · {t("Colección local")}
                          </p>
                        </div>
                        <div className="row">
                          <Button onClick={() => setModal("properties")}>
                            <SlidersHorizontal size={15} />
                            {t("Propiedades")}
                          </Button>
                          <details className="actions-menu">
                            <summary className="button">
                              <MoreHorizontal size={18} />
                            </summary>
                            <div className="option-menu">
                              <button onClick={startCsv}>
                                {t("Importar")} CSV
                              </button>
                              <button
                                onClick={() => {
                                  setName(detail.database.name);
                                  setModal("rename");
                                }}
                              >
                                {t("Nombre")}
                              </button>
                              <button
                                onClick={() => setModal("deleteDatabase")}
                              >
                                {t("Eliminar")}
                              </button>
                            </div>
                          </details>
                        </div>
                      </div>
                    )
                  )}
                  <div className="data-toolbar">
                    <div className="view-tabs">
                      <button
                        className={view === "gallery" ? "active" : ""}
                        onClick={() => setView("gallery")}
                      >
                        <LayoutGrid size={15} />
                        {t("Galería")}
                      </button>
                      <button
                        className={view === "table" ? "active" : ""}
                        onClick={() => setView("table")}
                      >
                        <Table2 size={15} />
                        {t("Tabla")}
                      </button>
                    </div>
                    <div className="row toolbar-actions">
                      <Button
                        className={showFilters ? "selected" : ""}
                        onClick={() => setShowFilters(!showFilters)}
                      >
                        <Filter size={14} />
                        {t("Filtros")}
                        {!!filters.length && (
                          <span className="small-count">{filters.length}</span>
                        )}
                      </Button>
                      {area === "search" ? (
                        <select
                          aria-label={t("Tipo")}
                          value={match}
                          onChange={(e) =>
                            setMatch(e.target.value as typeof match)
                          }
                        >
                          <option value="words">{t("Palabras")}</option>
                          <option value="phrase">{t("Frase exacta")}</option>
                          <option value="partial">
                            {t("Coincidencia parcial")}
                          </option>
                        </select>
                      ) : (
                        <>
                          <details className="actions-menu">
                            <summary className="button">
                              <Upload size={14} />
                              {t("Importar")}
                            </summary>
                            <div className="option-menu">
                              <button onClick={() => startImages("files")}>
                                {t("Importar imágenes")}
                              </button>
                              <button onClick={() => startImages("folder")}>
                                {t("Importar carpeta")}
                              </button>
                              <button onClick={startCsv}>
                                {t("CSV o TSV")}
                              </button>
                            </div>
                          </details>
                          <Button
                            primary
                            onClick={() =>
                              void perform(async () => {
                                const row = await api.call("createRow", {
                                  databaseId,
                                });
                                refresh();
                                await open(row);
                              })
                            }
                          >
                            <Plus size={15} />
                            {t("Añadir registro")}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {showFilters && (
                    <Filters
                      details={visibleDetails}
                      filters={filters}
                      onChange={(v) => {
                        setFilters(v);
                        setOffset(0);
                        setSelected(new Set());
                      }}
                      logic={logic}
                      setLogic={(v) => {
                        setLogic(v);
                        setOffset(0);
                        setSelected(new Set());
                      }}
                      equivalences={status?.settings.fieldEquivalences ?? []}
                    />
                  )}
                  {showFilters && area === "search" && (
                    <p className="hint filter-apply-hint">
                      {t("Los filtros y su lógica se aplican al pulsar Buscar.")}
                    </p>
                  )}
                  <div className="result-meta">
                    <span>
                      {loading ? (
                        <Spinner />
                      ) : (
                        <>
                          <b>{page.total.toLocaleString()}</b>{" "}
                          {t(area === "search" ? "Resultados" : "registros")}
                        </>
                      )}
                      {page.indexed !== undefined && (
                        <small>
                          {" "}
                          · {page.indexed} imágenes indexadas · similitud ≠
                          certeza
                        </small>
                      )}
                    </span>
                    <div className="row">
                      {area === "databases" && detail && (
                        <>
                          <select
                            className="sort-select"
                            aria-label={t("Ordenar por")}
                            value={sortColumn}
                            onChange={(e) => {
                              setSortColumn(e.target.value);
                              setOffset(0);
                            }}
                          >
                            <option value="">{t("Orden original")}</option>
                            {detail.columns
                              .filter(
                                (c) =>
                                  !["attachment", "files"].includes(c.type),
                              )
                              .map((c) => (
                                <option value={c.id} key={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                          {sortColumn && (
                            <label className="check-label">
                              <input
                                type="checkbox"
                                checked={descending}
                                onChange={(e) =>
                                  setDescending(e.target.checked)
                                }
                              />
                              {t("Descendente")}
                            </label>
                          )}
                        </>
                      )}
                      {(area === "databases" || selected.size > 0) && (
                        <details className="actions-menu">
                          <summary className="button export-button">
                            <Download size={14} />
                            {t("Exportar")}
                          </summary>
                          <div className="option-menu">
                            {(["csv", "json", "xlsx"] as const).map((f) => (
                              <button key={f} onClick={() => exportRows(f)}>
                                {f.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                  {!!selected.size && (
                    <div className="selection-bar">
                      <Check size={15} />
                      <strong>
                        {selected.size} {t("seleccionados")}
                      </strong>
                      <Button
                        onClick={() => {
                          setAnalysisColumns([]);
                          setAnalysisLanguage(
                            status?.settings.language === "en"
                              ? "English"
                              : "Español",
                          );
                          setModal("analyze");
                        }}
                      >
                        <Sparkles size={14} />
                        {t("Analizar")}
                      </Button>
                      <Button onClick={() => setModal("deleteRows")}>
                        <Trash2 size={14} />
                        {t("Eliminar")}
                      </Button>
                      <Button
                        onClick={() =>
                          void perform(async () => {
                            const n = await api.call("undo");
                            notify(
                              n
                                ? `${n} ${t("cambios deshechos")}`
                                : t(
                                    "No hay cambios de propuestas que deshacer.",
                                  ),
                            );
                            refresh();
                          })
                        }
                      >
                        <Undo2 size={14} />
                        {t("Deshacer")}
                      </Button>
                      <span className="spacer" />
                      <Button
                        icon
                        aria-label={t("Borrar selección")}
                        onClick={() => setSelected(new Set())}
                      >
                        <X size={15} />
                      </Button>
                    </div>
                  )}
                  {!page.rows.length && !loading ? (
                    <Empty
                      title={t(
                        area === "search"
                          ? "No se han encontrado resultados"
                          : "No hay registros todavía",
                      )}
                      description={t(
                        area === "search"
                          ? "Prueba otra consulta o revisa los filtros."
                          : "Importa una tabla o añade tus primeras imágenes.",
                      )}
                    >
                      {area === "databases" && (
                        <Button primary onClick={() => startImages("folder")}>
                          <FolderInput size={16} />
                          {t("Importar carpeta")}
                        </Button>
                      )}
                    </Empty>
                  ) : view === "gallery" ? (
                    <div className="gallery">
                      {page.rows.map((row) => (
                        <article
                          key={row.id}
                          className={
                            "gallery-card " +
                            (selected.has(row.id) ? "is-selected" : "")
                          }
                        >
                          <div className="gallery-image">
                            <button
                              className="image-open"
                              aria-label={t("Abrir registro") + " " + row.title}
                              onClick={() => void perform(() => open(row))}
                            >
                              <Thumbnail
                                id={row.images.find((a) => a.width > 0)?.id}
                                alt={row.title}
                              />
                            </button>
                            <input
                              type="checkbox"
                              aria-label={t("seleccionar") + " " + row.title}
                              checked={selected.has(row.id)}
                              onChange={() => select(row.id)}
                            />
                            {row.images.length > 1 && (
                              <span className="image-count">
                                <ImagePlus size={11} />
                                {row.images.length}
                              </span>
                            )}
                          </div>
                          <button
                            className="card-text"
                            onClick={() => void perform(() => open(row))}
                          >
                            <h3>{row.title}</h3>
                            {area === "search" && (
                              <p>
                                <Database size={11} />
                                {row.databaseName}
                              </p>
                            )}
                            <div className="chips">
                              {tags(row).map((o) => (
                                <span
                                  className="chip"
                                  key={o.id}
                                  style={
                                    {
                                      "--chip": o.color ?? "#6366f1",
                                    } as React.CSSProperties
                                  }
                                >
                                  {o.label}
                                </span>
                              ))}
                            </div>
                            {row.snippet && (
                              <p className="result-snippet">{row.snippet}</p>
                            )}
                            {row.score !== undefined && (
                              <small className="similarity">
                                Similitud {row.score.toFixed(3)}
                              </small>
                            )}
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="table-scroll data-table">
                      <table>
                        <thead>
                          <tr>
                            <th className="select-col">
                              <input
                                type="checkbox"
                                aria-label={t("Incluir todas")}
                                checked={
                                  page.rows.length > 0 &&
                                  page.rows.every((r) => selected.has(r.id))
                                }
                                onChange={() =>
                                  setSelected(
                                    page.rows.every((r) => selected.has(r.id))
                                      ? new Set()
                                      : new Set(page.rows.map((r) => r.id)),
                                  )
                                }
                              />
                            </th>
                            {area === "search" ? (
                              <>
                                <th>{t("Título")}</th>
                                <th>{t("Bases de datos")}</th>
                                <th>{t("Imágenes")}</th>
                                <th>{t("Resultados")}</th>
                              </>
                            ) : (
                              detail?.columns.map((c) => (
                                <th key={c.id}>
                                  <span>{c.name}</span>
                                </th>
                              ))
                            )}
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {page.rows.map((row) => (
                            <tr
                              key={row.id}
                              className={
                                selected.has(row.id) ? "is-selected" : ""
                              }
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={
                                    t("seleccionar") + " " + row.title
                                  }
                                  checked={selected.has(row.id)}
                                  onChange={() => select(row.id)}
                                />
                              </td>
                              {area === "search" ? (
                                <>
                                  <td>
                                    <button
                                      className="text-link"
                                      onClick={() =>
                                        void perform(() => open(row))
                                      }
                                    >
                                      {row.title}
                                    </button>
                                  </td>
                                  <td>{row.databaseName}</td>
                                  <td>{row.images.length}</td>
                                  <td className="snippet-cell">
                                    {row.snippet ??
                                      (row.score !== undefined
                                        ? row.score.toFixed(3)
                                        : "—")}
                                  </td>
                                </>
                              ) : (
                                detail?.columns.map((c) => (
                                  <td key={c.id}>
                                    {["attachment", "files"].includes(
                                      c.type,
                                    ) ? (
                                      <button
                                        className="cell-images"
                                        onClick={() =>
                                          void perform(() => open(row))
                                        }
                                      >
                                        <Thumbnail
                                          id={
                                            row.images.find(
                                              (a) => a.columnId === c.id,
                                            )?.id
                                          }
                                        />
                                        <span>
                                          {row.images.filter(
                                            (a) => a.columnId === c.id,
                                          ).length || "—"}
                                        </span>
                                      </button>
                                    ) : c.type === "relation" ? (
                                      <button
                                        className="text-link"
                                        onClick={() =>
                                          void perform(() => open(row))
                                        }
                                      >
                                        {t("Relación")} ↗
                                      </button>
                                    ) : (
                                      <Cell
                                        compact
                                        column={c}
                                        value={row.cells[c.id] ?? null}
                                        onSave={(v) =>
                                          perform(async () => {
                                            await api.call("setCell", {
                                              rowId: row.id,
                                              columnId: c.id,
                                              value: v,
                                            });
                                            refresh();
                                          })
                                        }
                                      />
                                    )}
                                  </td>
                                ))
                              )}
                              <td>
                                <Button
                                  icon
                                  aria-label={t("Abrir registro")}
                                  onClick={() => void perform(() => open(row))}
                                >
                                  <ArrowUpRight size={14} />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="pagination">
                    <Button
                      icon
                      aria-label={t("Anterior")}
                      disabled={!offset}
                      onClick={() => setOffset(Math.max(0, offset - 100))}
                    >
                      <ChevronLeft size={16} />
                    </Button>
                    <span>
                      {page.total ? offset + 1 : 0}–
                      {Math.min(offset + 100, page.total)} {t("de")}{" "}
                      {page.total.toLocaleString()}
                    </span>
                    <Button
                      icon
                      aria-label={t("Siguiente")}
                      disabled={offset + 100 >= page.total}
                      onClick={() => setOffset(offset + 100)}
                    >
                      <ChevronRight size={16} />
                    </Button>
                    <span className="spacer" />
                    <Button
                      onClick={() =>
                        void perform(async () => {
                          setProposals(await api.call("proposals"));
                          setModal("proposals");
                        })
                      }
                    >
                      <Sparkles size={14} />
                      {t("Revisar propuestas")}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {queueFilter && (
        <QueuePopover
          jobs={status?.jobs ?? []}
          initialFilter={queueFilter}
          parallelJobs={status?.parallelCapacity ?? 1}
          onClose={() => setQueueFilter(null)}
          perform={perform}
          onChanged={refresh}
        />
      )}
      {toast && (
        <div
          className={"toast " + (toast.error ? "error" : "")}
          role={toast.error ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <Button icon aria-label={t("Cerrar")} onClick={() => setToast(null)}>
            <X size={14} />
          </Button>
        </div>
      )}
      {(modal === "create" || modal === "rename") && (
        <Modal
          title={t(
            modal === "rename" ? "Renombrar base de datos" : "Nueva base de datos",
          )}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                if (modal === "rename") {
                  await api.call("renameDatabase", { id: databaseId, name });
                } else {
                  const d = await api.call("createDatabase", { name });
                  navigate(d.database.id);
                }
                refresh();
                setModal(null);
              });
            }}
          >
            <div className="modal-body">
              <label>
                {t("Nombre")}
                <input
                  autoFocus
                  required
                  value={name}
                  placeholder="Archivo fotográfico"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {modal === "create" && (
                <p className="hint">
                  Define tus propias propiedades y clasificaciones. Puedes
                  importar o añadir imágenes en cualquier momento.
                </p>
              )}
              {(imageQuery || similarId) && (
                <p className="hint">
                  {t(
                    "La imagen de consulta no se guarda en la búsqueda. Vuelve a adjuntarla o a elegir la imagen de referencia al recuperarla.",
                  )}
                </p>
              )}
            </div>
            <footer>
              <Button type="button" onClick={() => setModal(null)}>
                {t("Cancelar")}
              </Button>
              <Button primary type="submit">
                {modal === "rename" ? t("Guardar") : t("Crear")}
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {modal === "saveSearch" && (
        <Modal title={t("Guardar búsqueda")} onClose={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await api.call("saveSearch", {
                  name,
                  input: {
                    query,
                    mode,
                    match,
                    databaseIds: scope,
                    filters,
                    filterLogic: logic,
                    semanticWeight: weight,
                  },
                });
                refresh();
                setModal(null);
              });
            }}
          >
            <div className="modal-body">
              <label>
                {t("Nombre")}
                <input
                  autoFocus
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </div>
            <footer>
              <Button primary>{t("Guardar")}</Button>
            </footer>
          </form>
        </Modal>
      )}
      {(modal === "deleteRows" || modal === "deleteDatabase") && (
        <Modal
          title={t("Confirmar eliminación")}
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <h3>
              {modal === "deleteRows"
                ? `${selected.size} ${t("registros")}`
                : detail?.database.name}
            </h3>
            <p>{t("Esta operación elimina sus datos y asociaciones.")}</p>
          </div>
          <footer>
            <Button onClick={() => setModal(null)}>{t("Cancelar")}</Button>
            <Button
              className="danger"
              onClick={() =>
                void perform(async () => {
                  if (modal === "deleteRows")
                    await api.call("deleteRows", { ids: [...selected] });
                  else {
                    await api.call("deleteDatabase", { id: databaseId });
                    setDatabaseId("");
                  }
                  setModal(null);
                  setSelected(new Set());
                  refresh();
                })
              }
            >
              {t("Eliminar")}
            </Button>
          </footer>
        </Modal>
      )}
      {modal === "properties" && detail && (
        <Properties
          detail={detail}
          status={status!}
          perform={perform}
          onChanged={refresh}
          onClose={() => setModal(null)}
        />
      )}
      {csv && (
        <CsvImport
          plan={csv}
          perform={perform}
          onClose={() => setCsv(null)}
          onDone={(id) => {
            setCsv(null);
            refresh();
            navigate(id);
          }}
        />
      )}
      {imagePlan && detail && (
        <ImageImport
          initialPlan={imagePlan}
          detail={detail}
          perform={perform}
          onClose={() => setImagePlan(null)}
          onDone={() => {
            setImagePlan(null);
            refresh();
            setModal("jobs");
          }}
        />
      )}
      {modal === "jobs" && (
        <Modal title={t("Tareas")} wide onClose={() => setModal(null)}>
          <div className="modal-body">
            <Jobs
              jobs={status?.jobs ?? []}
              perform={perform}
              onChanged={refresh}
            />
          </div>
        </Modal>
      )}
      {modal === "analyze" && (
        <Modal title={t("Generar propuestas")} onClose={() => setModal(null)}>
          <div className="modal-body stack">
            <p>
              {selected.size} {t("registros")} · Solo se proponen cambios en
              propiedades vacías.
            </p>
            {visibleDetails
              .flatMap((d) => d.columns)
              .filter((c) =>
                [
                  "text",
                  "rich_text",
                  "select",
                  "status",
                  "multi_select",
                  "ai",
                ].includes(c.type),
              )
              .map((c) => (
                <label className="check-label" key={c.id}>
                  <input
                    type="checkbox"
                    checked={analysisColumns.includes(c.id)}
                    onChange={() =>
                      setAnalysisColumns(
                        analysisColumns.includes(c.id)
                          ? analysisColumns.filter((id) => id !== c.id)
                          : [...analysisColumns, c.id],
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
            <label>
              {t("Idioma")}
              <input
                value={analysisLanguage}
                onChange={(e) => setAnalysisLanguage(e.target.value)}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={detailed}
                onChange={(e) => setDetailed(e.target.checked)}
              />
              {t("Descripción detallada")}
            </label>
          </div>
          <footer>
            <Button
              primary
              disabled={!analysisColumns.length}
              onClick={() =>
                void perform(async () => {
                  await api.call("analyze", {
                    rowIds: [...selected],
                    columnIds: analysisColumns,
                    language: analysisLanguage,
                    detailed,
                  });
                  refresh();
                  setModal("jobs");
                })
              }
            >
              {t("Generar propuestas")}
            </Button>
          </footer>
        </Modal>
      )}
      {modal === "proposals" && (
        <Modal
          wide
          title={t("Revisar propuestas")}
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <div className="row">
              <Button
                primary
                disabled={!proposals.length}
                onClick={() =>
                  void perform(async () => {
                    const r = await api.call("reviewProposals", {
                      ids: proposals.map((p) => p.id),
                      action: "accept",
                    });
                    notify(
                      `${r.applied} aceptadas · ${r.conflicts} conflictos.`,
                    );
                    setProposals(await api.call("proposals"));
                    refresh();
                  })
                }
              >
                {t("Aceptar todas")}
              </Button>
              <Button
                disabled={!proposals.length}
                onClick={() =>
                  void perform(async () => {
                    await api.call("reviewProposals", {
                      ids: proposals.map((p) => p.id),
                      action: "reject",
                    });
                    setProposals(await api.call("proposals"));
                    refresh();
                  })
                }
              >
                {t("Rechazar todas")}
              </Button>
              <Button
                onClick={() =>
                  void perform(async () => {
                    const n = await api.call("undo");
                    notify(
                      n
                        ? `${n} ${t("cambios deshechos")}`
                        : t("No hay cambios de propuestas que deshacer."),
                    );
                    refresh();
                  })
                }
              >
                <Undo2 size={14} />
                {t("Deshacer")}
              </Button>
            </div>
            {!proposals.length && (
              <p className="muted">No hay propuestas pendientes.</p>
            )}
            {proposals.map((p) => (
              <article className="proposal" key={p.id}>
                <span className="eyebrow">
                  {p.title} · {p.columnName}
                </span>
                <p>{proposalValue(p)}</p>
                <small className="muted">
                  {p.model} · {p.revision.slice(0, 10)} ·{" "}
                  {new Date(p.createdAt).toLocaleString()}
                </small>
                <details>
                  <summary>Instrucciones</summary>
                  <p className="hint">{p.prompt}</p>
                </details>
                <div className="row">
                  <Button
                    primary
                    onClick={() =>
                      void perform(async () => {
                        const r = await api.call("reviewProposals", {
                          ids: [p.id],
                          action: "accept",
                        });
                        if (r.conflicts)
                          notify(
                            "El valor ha cambiado o contiene una anotación humana. No se sobrescribió.",
                            true,
                          );
                        setProposals(await api.call("proposals"));
                        refresh();
                      })
                    }
                  >
                    {t("Aceptar")}
                  </Button>
                  <Button
                    onClick={() =>
                      void perform(async () => {
                        await api.call("reviewProposals", {
                          ids: [p.id],
                          action: "reject",
                        });
                        setProposals(await api.call("proposals"));
                      })
                    }
                  >
                    {t("Rechazar")}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </Modal>
      )}
      {openRow && recordDetail && (
        <RecordPanel
          row={openRow}
          detail={recordDetail}
          onClose={() => setOpenRow(null)}
          onChanged={refresh}
          onSimilar={similar}
          perform={perform}
        />
      )}
    </div>
  );
}

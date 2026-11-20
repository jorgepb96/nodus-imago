import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
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
  ListTree,
  CalendarRange,
  ChartColumn,
  SlidersHorizontal,
  FolderInput,
  ImagePlus,
  ArrowUpRight,
  Download,
  X,
  Bookmark,
  ScanSearch,
  Sparkles,
  Loader2,
  ChartScatter,
  Trash2,
  Check,
  MoreHorizontal,
  RefreshCw,
  Home as HomeIcon,
  Monitor,
  Moon,
  Sun,
  Clock3,
  KeyRound,
  Map as MapIcon,
  BarChart3,
  GripVertical,
  MessageSquare,
  SquareDashedMousePointer,
  Columns2,
  Copy,
  Wand2,
  GraduationCap,
  Lightbulb,
  FileImage,
  Globe,
  Images,
  Share2,
  Star,
  StarOff,
} from "lucide-react";
import type {
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseDetail,
  DatabaseSummary,
} from "../shared/databases";
import { decodeMultiSelect, isAiColumn } from "../shared/databases";
import type { CsvImportPlanData } from "../shared/databaseCsv";
import type {
  ImagePlan,
  Page,
  Proposal,
  PropertyFilter,
  PropertyFilterGroup,
  ViewSort,
  RecordRow,
  SavedSearch,
  SearchInput,
  Settings as Preferences,
  Status,
  StandardImport,
} from "../shared/imago";
import { LanguageContext, uiLocale, useT } from "./i18n";
import { UpdateBanner } from "./components/UpdateBanner";
import { applyTheme } from "./theme/apply";
import { applyAppIcon } from "./theme/appIcon";
import { Button, Empty, Modal, Spinner, Thumbnail } from "./components/ui";
import { Cell } from "./components/Cell";
import { Properties, type Perform } from "./components/Properties";
import { AddPropertyMenu } from "./components/AddPropertyMenu";
import { AiColumnMenu } from "./components/AiColumnMenu";
import { ColumnTypeIcon } from "./components/ColumnTypeIcon";
import { isHeritageColumn } from "../shared/heritage";
import { HistoryButtons } from "./components/HistoryButtons";
import { CsvImport, ImageImport } from "./components/ImportDialogs";
import { CriteriaBar, ViewControls } from "./components/ViewControls";
import { CriteriaPopover, CriteriaSelect } from "./components/CriteriaSelect";
import { askIndexQuality, IndexQualityDialog } from "./components/IndexQualityDialog";
import { ChatView } from "./components/chat/ChatView";
import { CompareView } from "./components/CompareView";
import { VariantsView } from "./components/VariantsView";
import { RestorationsView } from "./components/RestorationsView";
import { SuggestDialog } from "./components/SuggestDialog";
import { PlatesDialog } from "./components/PlatesDialog";
import { IiifDialog } from "./components/IiifDialog";
import { NetworkView } from "./components/NetworkView";
import { VisualMapView } from "./components/VisualMapView";
import { CleanupDialog } from "./components/CleanupDialog";
import { AuthorityDialog } from "./components/AuthorityDialog";
import { HeritageDialog } from "./components/HeritageDialog";
import { refreshHeritage } from "./heritageStore";
import { citationTemplate } from "../shared/citation";
import {
  filterOperators,
  pruneViewCriteria,
  restoreViewCriteria,
} from "../shared/viewCriteria";
import { ColumnMenu } from "./components/ColumnMenu";
import { ColumnVisibility } from "./components/ColumnVisibility";
import { StickyScrollbar } from "./components/StickyScrollbar";
import { Welcome, WELCOME_VERSION } from "./components/Welcome";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { RELEASE_NOTES, releaseNotesUpTo } from "../shared/releaseNotes";
import { version as APP_VERSION } from "../package.json";
import { GuidedTour, TOUR_VERSION, type TourArea } from "./components/GuidedTour";
import { markTutorialDone, readDoneTutorials, TutorialsView } from "./components/TutorialsView";
import type { Tutorial } from "./tutorials";
import { TimelineView } from "./components/TimelineView";
import { StatisticsView } from "./components/StatisticsView";
import {
  DatabaseSearch,
  EMPTY_DATABASE_SEARCH,
  type DatabaseSearchState,
} from "./components/DatabaseSearch";
import {
  readColumnPrefs,
  useColumnPrefs,
  visibleColumns,
  type DatabaseViewId,
} from "./columnPrefs";
import { decodeDatabaseDate } from "../shared/databaseProperties";
import { ROLLUP_FUNCTIONS } from "../shared/databases";
import { RecordPanel } from "./components/RecordPanel";
import { Settings, Jobs } from "./components/Settings";
import { Home } from "./components/Home";
import { ImagoMark } from "./components/ImagoMark";
import { buildHierarchy, type HierarchyNode } from "../shared/hierarchy";
import { QueuePopover, type QueueFilter } from "./components/QueuePopover";
import { DatabaseMap } from "./components/DatabaseMap";
import { AgreementWorkbench } from "./components/AgreementWorkbench";
import { Automations } from "./components/Automations";

export default function App() {
  const [language, setLanguage] = useState<"es" | "en">("es");
  // Numbers and dates follow the interface language, not the system's.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <LanguageContext.Provider value={language}>
      <Workspace onLanguage={setLanguage} />
    </LanguageContext.Provider>
  );
}
/** A stored date (YYYY-MM-DD…) as the reader's short date. */
function formatDay(value: string) {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (!day) return value;
  const date = new Date(`${day}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(uiLocale());
}
function Workspace({ onLanguage }: { onLanguage: (v: "es" | "en") => void }) {
  const t = useT(),
    api = window.imago;
  const [area, setArea] = useState<
      "home" | "databases" | "search" | "settings" | "chat" | "compare" | "restorations" | "tutorials"
    >("home"),
    [databases, setDatabases] = useState<DatabaseSummary[]>([]),
    [databaseId, setDatabaseId] = useState(""),
    [detail, setDetail] = useState<DatabaseDetail | null>(null),
    [status, setStatus] = useState<Status | null>(null),
    // The quality choice before the first indexing: shown once on its own
    // per session, and whenever the researcher asks to index.
    [qualityDismissed, setQualityDismissed] = useState(false),
    [qualityAsked, setQualityAsked] = useState(false),
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
    // Search starts in the gallery; a database sets its own view on opening.
    [view, setView] = useState<DatabaseViewId>("gallery"),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState(""),
    // Search starts as Hybrid (words and meaning together); it is Literal
    // while no model is ready for semantic search.
    [chosenMode, setMode] = useState<"literal" | "semantic" | "hybrid">("hybrid"),
    [match, setMatch] = useState<"words" | "phrase" | "partial">("words"),
    [sources, setSources] = useState<"both" | "images" | "text">("both"),
    [scope, setScope] = useState<string[] | undefined>(),
    [imageQuery, setImageQuery] = useState<{
      token: string;
      fileName: string;
    } | null>(null),
    [similarId, setSimilarId] = useState<string | undefined>(),
    [weight, setWeight] = useState(0.5),
    [offset, setOffset] = useState(0),
    [sorts, setSorts] = useState<ViewSort[]>([]),
    [executed, setExecuted] = useState<SearchInput>({}),
    [filters, setFilters] = useState<PropertyFilter[]>([]),
    [filterGroups, setFilterGroups] = useState<PropertyFilterGroup[]>([]),
    [logic, setLogic] = useState<"and" | "or">("and"),
    [criteriaContext, setCriteriaContext] = useState(""),
    [allDetails, setAllDetails] = useState<DatabaseDetail[]>([]),
    [saved, setSaved] = useState<SavedSearch[]>([]);
  const mode = status?.semanticReady ? chosenMode : "literal";
  const [modal, setModal] = useState<
      | "create"
      | "rename"
      | "properties"
      | "agreement"
      | "automations"
      | "suggest"
      | "plates"
      | "iiif"
      | "cleanup"
      | "authorities"
      | "heritage"
      | "deleteRows"
      | "deleteDatabase"
      | "saveSearch"
      | "analyze"
      | "proposals"
      | "jobs"
      | "bulkAdd"
      | null
    >(null),
    [name, setName] = useState(""),
    [toolColumn, setToolColumn] = useState<string | null>(null),
    [bulkCount, setBulkCount] = useState(5),
    [csv, setCsv] = useState<CsvImportPlanData | null>(null),
    [imagePlan, setImagePlan] = useState<ImagePlan | null>(null),
    [draggingFiles, setDraggingFiles] = useState(false),
    [openRow, setOpenRow] = useState<RecordRow | null>(null),
    [recordDetail, setRecordDetail] = useState<DatabaseDetail | null>(null),
    [proposals, setProposals] = useState<Proposal[]>([]),
    [analysisColumns, setAnalysisColumns] = useState<string[]>([]),
    [analysisLanguage, setAnalysisLanguage] = useState("Español"),
    [detailed, setDetailed] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(),
    sequence = useRef(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  // The database's own search box (literal, semantic or both).
  const [dbSearch, setDbSearch] = useState<DatabaseSearchState>(EMPTY_DATABASE_SEARCH);
  useEffect(() => {
    setDbSearch((current) => (current.query ? { ...current, query: "" } : current));
  }, [databaseId]);
  const criteriaKey =
    area === "databases" && databaseId
      ? `database:${databaseId}`
      : area === "search"
        ? "search"
        : "";
  const columnSignature = allDetails
    .flatMap((detail) => detail.columns.map((column) => column.id))
    .sort()
    .join("|");
  useEffect(() => {
    if (criteriaKey === criteriaContext) return;
    if (!criteriaKey) {
      setCriteriaContext("");
      return;
    }
    if (allDetails.length !== databases.length || !status) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(`imago.criteria.${criteriaKey}`);
    } catch {
      /* Storage may be unavailable. */
    }
    const restored = pruneViewCriteria(
      restoreViewCriteria(raw),
      new Set(columnSignature.split("|")),
    );
    setFilters(restored.filters);
    setFilterGroups(restored.groups);
    setLogic(restored.logic);
    setSorts(restored.sorts);
    setOffset(0);
    setSelected(new Set());
    setCriteriaContext(criteriaKey);
  }, [
    criteriaKey,
    criteriaContext,
    columnSignature,
    allDetails.length,
    databases.length,
    status,
  ]);
  useEffect(() => {
    if (!criteriaKey || criteriaContext !== criteriaKey) return;
    try {
      localStorage.setItem(
        `imago.criteria.${criteriaKey}`,
        JSON.stringify({ filters, groups: filterGroups, logic, sorts }),
      );
    } catch {
      /* Local interface preference. */
    }
  }, [criteriaKey, criteriaContext, filters, filterGroups, logic, sorts]);
  useEffect(() => {
    if (
      !criteriaKey ||
      criteriaKey !== criteriaContext ||
      allDetails.length !== databases.length
    )
      return;
    const previous = { filters, groups: filterGroups, logic, sorts };
    const pruned = pruneViewCriteria(
      previous,
      new Set(columnSignature.split("|")),
    );
    if (JSON.stringify(previous) !== JSON.stringify(pruned)) {
      setFilters(pruned.filters);
      setFilterGroups(pruned.groups);
      setSorts(pruned.sorts);
    }
  }, [
    columnSignature,
    criteriaContext,
    criteriaKey,
    allDetails.length,
    databases.length,
    filters,
    filterGroups,
    logic,
    sorts,
  ]);
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
  useEffect(() => {
    const ask = () => setQualityAsked(true);
    window.addEventListener("imago:index-quality", ask);
    return () => window.removeEventListener("imago:index-quality", ask);
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
    return api.onChange(() => refresh());
  }, [api, refresh]);
  useEffect(() => {
    if (!api) return;
    return api.onDrop((result) => {
      setDraggingFiles(false);
      if (result.error) notify(result.error, true);
      else if (result.plan) {
        // Images dropped on a database: one new record per image, at once.
        const plan = result.plan;
        if (!plan.matches.length) {
          notify(t("No hay imágenes compatibles entre los archivos soltados."), true);
          return;
        }
        void perform(async () => {
          await api.call("importImages", {
            token: plan.token,
            storage: "copy",
            createUnmatched: true,
            columnId: plan.columnId,
            assignments: plan.matches.map((m) => ({
              pathToken: m.pathToken,
              rowId: null,
            })),
          });
          refresh();
        }, plan.matches.length === 1
          ? "Creando un registro con la imagen…"
          : "Creando un registro por cada imagen…");
      }
      else if (result.queryImage) {
        setImageQuery(result.queryImage);
        setSimilarId(undefined);
      }
    });
  }, [api, notify, perform, refresh, t]);
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
        void applyAppIcon(
          document.documentElement.classList.contains("dark"),
        ).catch(() => {});
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
      listener = () => {
        applyTheme(status.settings);
        void applyAppIcon(
          document.documentElement.classList.contains("dark"),
        ).catch(() => {});
      };
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
  }, [area, databaseId]);
  // What a database view shows: its filters plus its search box. The table,
  // gallery, timeline, statistics and column calculations all use it.
  const viewSearch = useMemo<SearchInput>(() => {
    const query = dbSearch.query.trim(),
      semantic = query && dbSearch.mode !== "literal" && !!status?.semanticReady;
    return {
      databaseIds: [databaseId],
      filters,
      filterLogic: logic,
      filterGroups,
      ...(query
        ? semantic
          ? {
              query,
              mode: dbSearch.mode,
              semanticSources: dbSearch.sources,
              semanticLimit: dbSearch.limit,
              match: "words" as const,
            }
          : { query, match: "words" as const }
        : {}),
    };
  }, [databaseId, filters, logic, filterGroups, dbSearch, status?.semanticReady]);
  const viewSearchKey = JSON.stringify(viewSearch);
  // The last pages seen, by query: coming back to a database (from the
  // comparison table, say) shows its rows at once while they are refreshed,
  // instead of an empty table until the query answers.
  const pageCache = useRef(new Map<string, typeof page>());
  useEffect(() => {
    const id = ++sequence.current;
    if (
      !api ||
      area === "settings" ||
      area === "home" ||
      area === "chat" ||
      area === "compare" ||
      area === "restorations" ||
      area === "tutorials" ||
      (area === "databases" && !databaseId) ||
      criteriaContext !== criteriaKey
    ) {
      setPage({ rows: [], total: 0 });
      setLoading(false);
      return;
    }
    setLoading(true);
    const input =
      area === "search"
        ? { ...executed, offset, limit: 100 }
        : {
            ...viewSearch,
            sorts,
            offset,
            limit: 100,
          };
    const cacheKey = JSON.stringify(input),
      cached = pageCache.current.get(cacheKey);
    // The cached page answers exactly this query: show it until the fresh one.
    if (cached) setPage(cached);
    void api
      .call("search", input)
      .then((p) => {
        pageCache.current.delete(cacheKey);
        pageCache.current.set(cacheKey, p);
        if (pageCache.current.size > 12) pageCache.current.delete(pageCache.current.keys().next().value!);
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
    criteriaContext,
    criteriaKey,
    filters,
    logic,
    offset,
    filterGroups,
    sorts,
    tick,
    viewSearch,
    notify,
  ]);
  useEffect(() => {
    // Deleting rows or a changed result set can leave the page beyond the end.
    if (offset > 0 && offset >= page.total) setOffset(0);
  }, [offset, page.total]);
  const openRowId = openRow?.id;
  useEffect(() => {
    let cancelled = false;
    if (openRowId)
      void api
        .call("getRow", { id: openRowId })
        .then((row) => {
          if (!cancelled)
            setOpenRow((current) =>
              current?.id === openRowId ? row : current,
            );
        })
        .catch(() => {
          if (!cancelled)
            setOpenRow((current) =>
              current?.id === openRowId ? null : current,
            );
        });
    return () => {
      cancelled = true;
    };
  }, [api, openRowId, tick]);
  // First run: introduction (language, what Imago does, models), then the
  // guided tour. Test drivers never see them unless a test asks.
  const [welcomeOpen, setWelcomeOpen] = useState(false),
    [tourOpen, setTourOpen] = useState(false),
    [afterTour, setAfterTour] = useState<"api" | null>(null),
    // The tutorial being followed, and those finished on this computer.
    [tutorial, setTutorial] = useState<Tutorial | null>(null),
    [doneTutorials, setDoneTutorials] = useState(readDoneTutorials),
    // The tutorials window of the top bar, and the tutorial just finished
    // (it opens the window to congratulate and point to the next one).
    [tutorialsOpen, setTutorialsOpen] = useState(false),
    [justFinished, setJustFinished] = useState<Tutorial | null>(null),
    welcomeChecked = useRef(false);
  // After an update: what is new, once (as in Nodus Research). A first
  // installation sees the introduction instead and starts from this version.
  const [whatsNew, setWhatsNew] = useState<"startup" | "settings" | null>(null);
  useEffect(() => {
    if (!status || welcomeChecked.current) return;
    welcomeChecked.current = true;
    if (status.automated) return;
    if ((status.settings.welcomeVersion ?? 0) < WELCOME_VERSION) {
      setWelcomeOpen(true);
      if (!status.settings.welcomeVersion) void api.call("updateSettings", { whatsNewVersion: APP_VERSION }).catch(() => {});
      return;
    }
    if (status.settings.whatsNewVersion !== APP_VERSION) {
      if (RELEASE_NOTES.some((n) => n.version === APP_VERSION.split("-")[0])) setWhatsNew("startup");
      else void api.call("updateSettings", { whatsNewVersion: APP_VERSION }).catch(() => {});
    }
  }, [status, api]);
  const [compareSeed, setCompareSeed] = useState<string[] | null>(null);
  const finishStandardImport = (result: StandardImport) => {
    notify(
      t("Importados {r} registros con {p} imágenes y {a} anotaciones.")
        .replace("{r}", String(result.records))
        .replace("{p}", String(result.photos))
        .replace("{a}", String(result.annotations)) +
        (result.failed ? " " + t("{n} imágenes no se pudieron leer.").replace("{n}", String(result.failed)) : ""),
      result.failed > 0,
    );
    refresh();
    navigate(result.databaseId);
  };
  const [analysisTask, setAnalysisTask] = useState<"describe" | "transcribe">("describe");
  const [restoreSeed, setRestoreSeed] = useState<string | null>(null);
  const clearRestoreSeed = useCallback(() => setRestoreSeed(null), [setRestoreSeed]);
  const clearCompareSeed = useCallback(() => setCompareSeed(null), [setCompareSeed]);
  const openApiSettings = () => {
    setSettingsTab("api");
    setArea("settings");
  };
  // The chat beside a database: open or closed, and its width, are remembered.
  const [chatPanel, setChatPanel] = useState(() => {
    try {
      return localStorage.getItem("imago.chat.panelOpen") === "1";
    } catch {
      return false;
    }
  });
  const [chatWidth, setChatWidth] = useState(() => {
    try {
      return Number(localStorage.getItem("imago.chat.panelWidth")) || 440;
    } catch {
      return 440;
    }
  });
  const toggleChatPanel = (open: boolean) => {
    setChatPanel(open);
    try {
      localStorage.setItem("imago.chat.panelOpen", open ? "1" : "0");
    } catch {
      /* A preference only. */
    }
  };
  const resizeChat = (width: number, save = true) => {
    const next = Math.round(Math.max(340, Math.min(width, window.innerWidth * 0.7)));
    setChatWidth(next);
    if (save)
      try {
        localStorage.setItem("imago.chat.panelWidth", String(next));
      } catch {
        /* A preference only. */
      }
  };
  const openEmbeddingSettings = () => {
    setSettingsTab("models");
    setArea("settings");
  };
  const tourArea = useCallback(
    (target: TourArea, tab?: string) => {
      setArea(target);
      if (target === "settings") setSettingsTab(tab ?? "api");
      if (target === "databases") {
        const first = databaseId || databases[0]?.id;
        if (first && first !== databaseId) setDatabaseId(first);
        setView("table");
      }
    },
    [databaseId, databases],
  );
  /** The database's layout again, after its properties or options changed. */
  const reloadDetail = async (id: string) => {
    const next = await api.call("detail", { id });
    setDetail((current) => (current?.database.id === id ? next : current));
    setAllDetails((all) => all.map((d) => (d.database.id === id ? next : d)));
    refreshHeritage();
    refresh();
  };
  const navigate = (id: string) => {
    setArea("databases");
    setDatabaseId(id);
    // A database opens in Table, or in the view the researcher featured.
    setView(readColumnPrefs(id).defaultView ?? "table");
    setExecuted({});
    setQuery("");
    setFilters([]);
    setSimilarId(undefined);
  };
  const open = async (row: RecordRow) => {
    const d = await api.call("detail", { id: row.databaseId });
    setRecordDetail(d);
    setOpenRow(await api.call("getRow", { id: row.id }));
  };
  // The last box ticked or unticked: Shift+click applies the same to every
  // record between it and the one clicked, as in a file manager.
  const selectAnchor = useRef<string | null>(null);
  const select = (id: string, range = false) => {
    const anchor = selectAnchor.current;
    selectAnchor.current = id;
    setSelected((old) => {
      const next = new Set(old),
        on = !old.has(id);
      const from = range && anchor ? page.rows.findIndex((r) => r.id === anchor) : -1,
        to = page.rows.findIndex((r) => r.id === id);
      const ids = from >= 0 && to >= 0 ? page.rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((r) => r.id) : [id];
      for (const rowId of ids) {
        if (on) next.add(rowId);
        else next.delete(rowId);
      }
      return next;
    });
  };
  /** A checkbox change, with Shift held when it came from a Shift+click. */
  const selectFrom = (id: string, event: React.ChangeEvent<HTMLInputElement>) =>
    select(id, (event.nativeEvent as MouseEvent).shiftKey === true);
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
  const attachImage = (row: RecordRow) => {
    const target =
      allDetails.find((entry) => entry.database.id === row.databaseId) ??
      (detail?.database.id === row.databaseId ? detail : undefined);
    if (!target) return;
    const imageColumn = target.columns.find(
      (column) => column.type === "attachment" || column.type === "files",
    );
    void perform(async () => {
      const plan = await api.call("imagePreview", {
        databaseId: target.database.id,
        columnId: imageColumn?.id,
        source: "files",
      });
      if (!plan) return;
      if (!plan.matches.length) {
        notify(t("No hay imágenes válidas."), true);
        return;
      }
      await api.call("importImages", {
        token: plan.token,
        storage: "copy",
        createUnmatched: true,
        columnId: imageColumn?.id,
        assignments: plan.matches.map((match) => ({
          pathToken: match.pathToken,
          rowId: row.id,
        })),
      });
      refresh();
      notify(
        `${plan.matches.length.toLocaleString()} ${t(
          plan.matches.length === 1 ? "imagen en cola" : "imágenes en cola",
        )}`,
      );
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
      filterGroups,
      sorts,
      imageToken: imageQuery?.token,
      similarAssetId: similarId,
      semanticWeight: weight,
      semanticSources: sources,
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
      filterGroups,
      sorts,
    });
  };
  const modelReady = !!status?.semanticReady;
  // Notion-style table columns: drag a header to move it (the order is saved
  // with the database, so the record panel and exports follow it), drag its
  // right edge to resize (width kept per database on this device), or move it
  // with Alt+←/→ from the keyboard.
  const [dragColumn, setDragColumn] = useState<string | null>(null),
    [dropColumn, setDropColumn] = useState<{
      id: string;
      side: "before" | "after";
    } | null>(null),
    [columnMenu, setColumnMenu] = useState<string | null>(null),
    [menuView, setMenuView] = useState<"main" | "calc">("main"),
    [viewMenuAt, setViewMenuAt] = useState<{ id: DatabaseViewId; tab: HTMLElement } | null>(null),
    [editColumn, setEditColumn] = useState<string | null>(null),
    [createType, setCreateType] = useState<DatabaseColumnType | null>(null),
    [addPropertyOpen, setAddPropertyOpen] = useState(false),
    [aiMenu, setAiMenu] = useState<string | null>(null),
    [aiPending, setAiPending] = useState<Set<string>>(() => new Set()),
    [cellStream, setCellStream] = useState<Record<string, string>>({}),
    [filterRequest, setFilterRequest] = useState(0),
    [sortRequest, setSortRequest] = useState(0),
    [summaries, setSummaries] = useState<Record<string, string>>({}),
    [stickyLeft, setStickyLeft] = useState<Record<string, number>>({});
  const [prefs, updatePrefs] = useColumnPrefs(detail?.database.id ?? null),
    columnWidths = prefs.widths,
    menuAnchor = useRef<HTMLElement | null>(null),
    addPropertyAnchor = useRef<HTMLElement | null>(null),
    aiMenuAnchor = useRef<HTMLElement | null>(null),
    tableRef = useRef<HTMLTableElement>(null),
    tableScrollRef = useRef<HTMLDivElement>(null),
    shownColumns = detail ? visibleColumns(detail.columns, prefs) : [],
    // Frozen columns: the selection box and every shown column up to the one
    // chosen stay put while the table scrolls sideways.
    frozenAt = shownColumns.findIndex((c) => c.id === prefs.freezeThrough),
    frozenIds = frozenAt < 0 ? [] : shownColumns.slice(0, frozenAt + 1).map((c) => c.id),
    frozenKey = frozenIds.join("|");
  const saveWidths = (next: Record<string, number>) =>
    updatePrefs((p) => ({ ...p, widths: next }));
  // AI properties write into their cells live; the saved value replaces it.
  useEffect(
    () =>
      api.onCellStream?.(({ rowId, columnId, text }) => {
        const key = rowId + ":" + columnId;
        setCellStream((current) => {
          if (text != null) return { ...current, [key]: text };
          if (!(key in current)) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
        if (text == null) {
          setAiPending((current) => {
            if (!current.has(key)) return current;
            const next = new Set(current);
            next.delete(key);
            return next;
          });
          refresh();
        }
      }),
    [api, refresh],
  );
  useEffect(() => {
    // The cell spinners last while an analysis is waiting or running.
    if (
      !status?.jobs.some(
        (j) => j.kind === "analyze" && ["queued", "running"].includes(j.state),
      )
    )
      setAiPending((current) => (current.size ? new Set() : current));
  }, [status?.jobs]);
  /** One table cell for a property: images as a thumbnail, relations as a
   * link to the record and everything else as an editable cell. */
  const renderCell = (row: RecordRow, c: DatabaseColumn) => {
    if (["attachment", "files"].includes(c.type)) {
      const images = row.images.filter((a) => a.columnId === c.id);
      return (
        <button
          className="cell-images"
          onClick={() => void perform(() => open(row))}
        >
          <Thumbnail revision={images[0]?.revision} id={images[0]?.id} />
          <span>{images.length || "—"}</span>
        </button>
      );
    }
    if (c.type === "relation")
      return (
        <button
          className="text-link"
          onClick={() => void perform(() => open(row))}
        >
          {t("Relación")} ↗
        </button>
      );
    const cell = (
      <Cell
        compact
        wrap={area !== "search" && prefs.wrap.includes(c.id)}
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
    );
    if (!isAiColumn(c) || area === "search") return cell;
    const key = row.id + ":" + c.id,
      live = cellStream[key],
      pending = aiPending.has(key) || live !== undefined;
    return (
      <div className="ai-cell">
        <div className="ai-cell-value">
          {live !== undefined && c.type !== "ai" ? (
            // A selection being filled shows its tags as chips as they arrive.
            <span className="chips ai-cell-live-chips" aria-live="polite">
              {live
                .split(", ")
                .filter(Boolean)
                .map((label, i) => (
                  <span
                    className="chip"
                    key={i}
                    style={
                      {
                        "--chip":
                          c.options.find(
                            (o) => o.label.toLowerCase() === label.toLowerCase(),
                          )?.color ?? "#7c3aed",
                      } as React.CSSProperties
                    }
                  >
                    {label}
                  </span>
                ))}
            </span>
          ) : live !== undefined ? (
            <span className="ai-cell-live" aria-live="polite">
              {live}
            </span>
          ) : (
            cell
          )}
        </div>
        <button
          type="button"
          className={"ai-cell-button" + (pending ? " pending" : "")}
          disabled={pending}
          aria-label={t("Generar con IA")}
          data-tooltip={
            pending
              ? t("En cola…")
              : row.cells[c.id]
                ? t("Regenerar con IA")
                : t("Generar con IA")
          }
          onClick={(e) => {
            e.stopPropagation();
            void perform(async () => {
              await api.call("analyze", {
                rowIds: [row.id],
                columnIds: [c.id],
                language: status?.settings.language ?? "es",
                detailed: true,
                overwrite: true,
              });
              setAiPending((current) => new Set(current).add(key));
              refresh();
            });
          }}
        >
          {pending ? (
            <Loader2 size={13} className="spin" />
          ) : (
            <Sparkles size={13} />
          )}
        </button>
      </div>
    );
  };
  const columnStyle = (id: string): React.CSSProperties | undefined => {
    const width = columnWidths[id],
      left = stickyLeft[id];
    if (!width && left === undefined) return undefined;
    return {
      ...(width ? { width, minWidth: width, maxWidth: width } : {}),
      ...(left !== undefined ? { left } : {}),
    };
  };
  useLayoutEffect(() => {
    const table = tableRef.current;
    const ids = frozenKey ? frozenKey.split("|") : [];
    if (!table || !ids.length) {
      setStickyLeft((current) => (Object.keys(current).length ? {} : current));
      return;
    }
    const measure = () => {
      // Each frozen column sticks after the widths before it (offsetLeft
      // would include the sticky shift while the table is scrolled).
      const next: Record<string, number> = {};
      let left =
        table.querySelector<HTMLElement>("thead th.select-col")?.getBoundingClientRect().width ?? 0;
      for (const id of ids) {
        const th = table.querySelector<HTMLElement>(`th[data-column="${id}"]`);
        if (!th) continue;
        next[id] = Math.round(left * 100) / 100;
        left += th.getBoundingClientRect().width;
      }
      setStickyLeft((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    table.querySelectorAll("thead th").forEach((th) => observer.observe(th));
    return () => observer.disconnect();
  }, [frozenKey, columnWidths, page.rows]);
  // Column calculations follow the rows the table shows: same filters,
  // every page.
  const summaryKey = JSON.stringify([
    detail?.database.id,
    prefs.calc,
    viewSearchKey,
    tick,
    area,
  ]);
  useEffect(() => {
    const entries = Object.entries(prefs.calc).filter(([id]) =>
      detail?.columns.some((c) => c.id === id),
    );
    if (!api || !detail || area !== "databases" || !entries.length) {
      setSummaries({});
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.all(
        entries.map(([columnId, fn]) =>
          api
            .call("columnSummary", {
              search: viewSearch,
              columnId,
              fn,
            })
            .then((r) => [columnId, r.value] as const)
            .catch(() => [columnId, ""] as const),
        ),
      ).then((results) => {
        if (!cancelled) setSummaries(Object.fromEntries(results));
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // summaryKey carries every input that changes the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, summaryKey]);
  const summaryText = (fn: string, value: string) => {
    if (!value) return "—";
    if (fn === "date_range") {
      const range = decodeDatabaseDate(value);
      return range
        ? `${formatDay(range.start)} → ${formatDay(range.end ?? range.start)}`
        : value;
    }
    if (fn === "earliest_date" || fn === "latest_date") return formatDay(value);
    const number = Number(value);
    return Number.isFinite(number) && /^-?[\d.]+$/.test(value)
      ? number.toLocaleString(uiLocale())
      : value;
  };
  /** The view a database opens in; right-clicking a tab features another. */
  const featuredView = area === "databases" && detail ? (prefs.defaultView ?? null) : null;
  const viewMenu = viewMenuAt?.id ?? null,
    // A stable anchor: the popover repositions whenever its anchor changes.
    viewMenuAnchor = useMemo(() => ({ current: viewMenuAt?.tab ?? null }), [viewMenuAt]);
  const openViewMenu = (id: DatabaseViewId, tab: HTMLElement) => setViewMenuAt({ id, tab });
  const viewTab = (id: DatabaseViewId) =>
    area === "databases" && detail
      ? {
          "data-tour": `view-${id}`,
          "aria-haspopup": "menu" as const,
          onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            openViewMenu(id, event.currentTarget);
          },
          onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              openViewMenu(id, event.currentTarget);
            }
          },
        }
      : {};
  const featuredMark = (id: DatabaseViewId) =>
    featuredView === id ? (
      <Star
        size={11}
        className="view-featured"
        fill="currentColor"
        aria-label={t("Vista destacada")}
        data-tooltip={t("Vista destacada: la base de datos se abre en ella")}
      />
    ) : null;
  const openColumnMenu = (columnId: string, header: HTMLElement) => {
    menuAnchor.current = header;
    if (!header.matches("button")) setMenuView("main");
    setColumnMenu(columnId);
  };
  const filterColumn = (columnId: string) => {
    const column = detail?.columns.find((c) => c.id === columnId);
    if (!column) return;
    const op = filterOperators(column)[0];
    if (op)
      setFilters((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          columnId,
          databaseId: column.databaseId,
          op,
          value: ["any", "all", "none"].includes(op) ? [] : "",
        },
      ]);
    setFilterRequest((n) => n + 1);
  };
  const changeCriteria = (
    nextFilters: PropertyFilter[],
    nextGroups: PropertyFilterGroup[],
    nextLogic: "and" | "or",
  ) => {
    setFilters(nextFilters);
    setFilterGroups(nextGroups);
    setLogic(nextLogic);
    setOffset(0);
    setSelected(new Set());
  };
  const changeSorts = (nextSorts: ViewSort[]) => {
    setSorts(nextSorts);
    setOffset(0);
    setSelected(new Set());
    if (area === "search")
      setExecuted((previous) => ({
        ...previous,
        sortColumn: undefined,
        descending: undefined,
        sorts: nextSorts,
      }));
  };
  const sortColumn = (columnId: string, direction: "asc" | "desc" | null) => {
    setSorts((current) => {
      const rest = current.filter((s) => s.columnId !== columnId);
      return direction ? [{ columnId, direction }, ...rest] : rest;
    });
    setOffset(0);
  };
  const moveColumn = (id: string, target: string, side: "before" | "after") => {
    if (!detail || id === target) return;
    const ids = detail.columns.map((c) => c.id).filter((c) => c !== id);
    ids.splice(ids.indexOf(target) + (side === "after" ? 1 : 0), 0, id);
    if (ids.every((c, i) => detail.columns[i].id === c)) return;
    const byId = new Map(detail.columns.map((c) => [c.id, c]));
    setDetail({ ...detail, columns: ids.map((c) => byId.get(c)!) });
    void perform(async () => {
      setDetail(
        await api.call("reorderColumns", {
          databaseId: detail.database.id,
          columnIds: ids,
        }),
      );
      refresh();
    });
  };
  // Dragging a column edge resizes that column's cells directly, frame by
  // frame, and saves the width once on release: re-rendering the whole table
  // on every pointer move froze large databases. Two vertical guides span the
  // table while dragging (where the edge was and where it is), with the width
  // in pixels; Escape puts the column back as it was.
  const startResize = (id: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const header = (event.currentTarget as HTMLElement).parentElement!,
      startX = event.clientX,
      box = header.getBoundingClientRect(),
      startWidth = Math.round(box.width),
      cells = tableRef.current
        ? [...tableRef.current.querySelectorAll<HTMLElement>(`[data-column="${CSS.escape(id)}"]`)]
        : [header],
      before = cells.map((cell) => [cell.style.width, cell.style.minWidth, cell.style.maxWidth]),
      area = (tableScrollRef.current ?? header).getBoundingClientRect(),
      top = Math.max(0, area.top),
      height = Math.max(0, Math.min(window.innerHeight, area.bottom) - top);
    const guide = (className: string, left: number) => {
      const line = document.createElement("div");
      line.className = className;
      line.setAttribute("aria-hidden", "true");
      Object.assign(line.style, { top: `${top}px`, height: `${height}px`, left: `${left}px` });
      document.body.append(line);
      return line;
    };
    const origin = guide("column-resize-guide is-origin", box.right),
      edge = guide("column-resize-guide", box.right),
      label = document.createElement("span");
    label.className = "column-resize-width";
    edge.append(label);
    let latest = startWidth,
      frame = 0;
    const paint = () => {
      frame = 0;
      for (const cell of cells) {
        cell.style.width = cell.style.minWidth = cell.style.maxWidth = `${latest}px`;
      }
      edge.style.left = `${header.getBoundingClientRect().right}px`;
      label.textContent = `${latest} px`;
    };
    paint();
    const move = (e: MouseEvent) => {
      latest = Math.round(Math.min(800, Math.max(80, startWidth + e.clientX - startX)));
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const finish = (keep: boolean) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", up);
      if (frame) cancelAnimationFrame(frame);
      origin.remove();
      edge.remove();
      document.body.classList.remove("resizing-column");
      if (!keep) {
        cells.forEach((cell, i) => {
          [cell.style.width, cell.style.minWidth, cell.style.maxWidth] = before[i];
        });
        return;
      }
      if (latest !== startWidth || columnWidths[id] !== undefined)
        updatePrefs((p) => ({ ...p, widths: { ...p.widths, [id]: latest } }));
    };
    const up = () => finish(true);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    document.body.classList.add("resizing-column");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", up);
  };
  const visibleDetails =
    area === "search"
      ? allDetails.filter(
          (d) => scope === undefined || scope.includes(d.database.id),
        )
      : detail
        ? [detail]
        : [];
  // Search results span databases: show each one's visible properties in its
  // own order, merging same-named properties of the same type into one column.
  const searchColumns = useMemo(() => {
    if (area !== "search") return [];
    const merged = new Map<
      string,
      { key: string; name: string; byDatabase: Map<string, DatabaseColumn> }
    >();
    for (const d of allDetails) {
      if (scope !== undefined && !scope.includes(d.database.id)) continue;
      for (const c of visibleColumns(d.columns, readColumnPrefs(d.database.id))) {
        if (c.type === "title") continue;
        const key = `${c.type}:${c.name.trim().toLocaleLowerCase()}`;
        const entry = merged.get(key) ?? {
          key,
          name: c.name,
          byDatabase: new Map<string, DatabaseColumn>(),
        };
        entry.byDatabase.set(d.database.id, c);
        merged.set(key, entry);
      }
    }
    return [...merged.values()];
  }, [area, allDetails, scope]);
  const searchDatabases = new Set(page.rows.map((row) => row.databaseId)).size;
  const searchMatches = page.rows.some(
    (row) => row.snippet || row.score !== undefined,
  );
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
        .filter(
          (c) =>
            ["multi_select", "select", "status"].includes(c.type) &&
            !(area === "databases" && prefs.hidden.includes(c.id)),
        )
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
  const hierarchyColumn = detail?.columns.find(
      (column) =>
        column.type === "relation" &&
        column.config.relationTargetDatabaseId === detail.database.id,
    ),
    effectiveView =
      (view === "tree" && (!hierarchyColumn || area !== "databases")) ||
      (["map", "timeline", "stats", "variants", "network", "visualmap"].includes(view) && area !== "databases")
        ? "table"
        : view,
    hierarchy = useMemo(
      () =>
        hierarchyColumn && effectiveView === "tree"
          ? buildHierarchy(page.rows, hierarchyColumn.id)
          : [],
      [hierarchyColumn, page.rows, effectiveView],
    ),
    activeJobs =
      status?.jobs.filter((job) =>
        ["running", "queued", "paused", "failed"].includes(job.state),
      ).length ?? 0;
  if (!api)
    return (
      <div className="desktop-required">
        <ImagoMark size={56} />
        <h1>Nodus Imago</h1>
        <p>{t("Abre la aplicación de escritorio para acceder a tu colección local.")}</p>
        <code>npm run dev</code>
      </div>
    );
  const renderHierarchy = (
    nodes: HierarchyNode<Page["rows"][number]>[],
    depth = 0,
  ) => (
    <ul className="hierarchy-level">
      {nodes.map((node) => (
        <li key={node.row.id}>
          <button
            type="button"
            className="hierarchy-row"
            style={{ "--depth": depth } as React.CSSProperties}
            onClick={() => void perform(() => open(node.row))}
          >
            <span className="hierarchy-dot" />
            <span>{node.row.title}</span>
            {node.row.images.length > 0 && (
              <small>{node.row.images.length}</small>
            )}
          </button>
          {node.children.length > 0 &&
            renderHierarchy(node.children, depth + 1)}
        </li>
      ))}
    </ul>
  );
  /** Page controls and the proposals review, above and below the records. */
  const pager = (top = false) => (
    <div className={"pagination" + (top ? " is-top" : "")} data-testid={top ? "pagination-top" : undefined}>
      {!["map", "timeline", "stats", "variants", "network", "visualmap"].includes(effectiveView) && (
        <>
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
        </>
      )}
      <span className="spacer" />
      <Button
        data-tour={top ? "review-proposals" : undefined}
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
          data-tour="header-sidebar"
          title={
            collapsed ? t("Mostrar menú lateral") : t("Ocultar menú lateral")
          }
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
          data-tour="header-interface"
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
        <div className="nodus-header-actions" data-tour="header-actions">
          {!!busy && <Spinner />}
          <Button
            icon
            data-tour="header-tutorials"
            className={tutorialsOpen ? "is-active" : ""}
            title={t("Tutoriales")}
            aria-label={t("Tutoriales")}
            onClick={() => setTutorialsOpen(true)}
          >
            <GraduationCap size={18} />
          </Button>
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
          <span className="header-queue-action" data-tour="header-queue">
            <Button
              icon
              data-queue-trigger
              aria-label={t("Colas y tareas")}
              title={t("Colas y tareas")}
              onClick={() => setQueueFilter(queueFilter ? null : "all")}
            >
              <Clock3 size={18} />
            </Button>
            {activeJobs > 0 && <small>{activeJobs}</small>}
          </span>
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
      {api && (
        <UpdateBanner
          onRecovery={() => {
            setSettingsTab("storage");
            setArea("settings");
          }}
          onError={(message) => notify(message, true)}
        />
      )}
      <div className="app-body">
        <aside className="sidebar">
          <nav>
            <button
              title={t("Inicio")}
              data-tour="nav-home"
              className={area === "home" ? "active" : ""}
              onClick={() => setArea("home")}
            >
              <HomeIcon size={18} />
              <span className="nav-title">{t("Inicio")}</span>
            </button>
            <button
              title={t("Bases de datos")}
              className={area === "databases" ? "active" : ""}
              onClick={() => {
                setArea("databases");
                setDatabaseId("");
                setExecuted({});
                setQuery("");
                setFilters([]);
              }}
            >
              <Database size={18} />
              <span className="nav-title">{t("Bases de datos")}</span>
              <span className="nav-count">{databases.length}</span>
            </button>
            <div className="nav-group-label">{t("EXPLORAR")}</div>
            <button
              title={t("Búsqueda")}
              data-tour="nav-search"
              className={area === "search" ? "active" : ""}
              onClick={() => {
                setArea("search");
                setOffset(0);
              }}
            >
              <Search size={18} />
              <span className="nav-title">{t("Búsqueda")}</span>
            </button>
            <button
              title={t("Chat")}
              data-tour="nav-chat"
              className={area === "chat" ? "active" : ""}
              onClick={() => setArea("chat")}
            >
              <MessageSquare size={18} />
              <span className="nav-title">{t("Chat")}</span>
            </button>
            <button
              title={t("Mesa de comparación")}
              data-tour="nav-compare"
              className={area === "compare" ? "active" : ""}
              onClick={() => setArea("compare")}
            >
              <Columns2 size={18} />
              <span className="nav-title">{t("Mesa de comparación")}</span>
            </button>
            <button
              title={t("Restauraciones")}
              data-tour="nav-restorations"
              className={area === "restorations" ? "active" : ""}
              onClick={() => setArea("restorations")}
            >
              <Wand2 size={18} />
              <span className="nav-title">{t("Restauraciones")}</span>
            </button>
          </nav>
          <div className="sidebar-databases" data-tour="collections" data-tour-fit="content">
            <div className="row">
              <span className="nav-label">{t("COLECCIONES")}</span>
              <Button
                icon
                data-tour="db-new"
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
              title={t("Tutoriales")}
              data-tour="nav-tutorials"
              className={area === "tutorials" ? "active" : ""}
              onClick={() => setArea("tutorials")}
            >
              <GraduationCap size={18} />
              <span className="nav-title">{t("Tutoriales")}</span>
            </button>
            <button
              title={t("Ajustes")}
              data-tour="nav-settings"
              className={area === "settings" ? "active" : ""}
              onClick={() => {
                setSettingsTab("api");
                setArea("settings");
              }}
            >
              <SettingsIcon size={18} />
              <span className="nav-title">{t("Ajustes")}</span>
            </button>
          </div>
        </aside>
        <main
          className={"workspace" + (draggingFiles ? " dropping-files" : "")}
          onDragOver={(e) => {
            if (
              area === "databases" &&
              detail &&
              e.dataTransfer.types.includes("Files") &&
              !draggingFiles
            )
              setDraggingFiles(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              setDraggingFiles(false);
          }}
          onDrop={() => setDraggingFiles(false)}
          data-drop-target={
            area === "search" && mode !== "literal"
              ? "search"
              : area === "databases" && detail
                ? databaseId
                : ""
          }
        >
          {draggingFiles && (
            <div className="drop-files-hint" role="status">
              <ImagePlus size={18} />
              {t("Suelta las imágenes: se creará un registro por cada una")}
            </div>
          )}
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
          ) : area === "tutorials" ? (
            <TutorialsView
              done={doneTutorials}
              onStart={(next) => {
                setTourOpen(false);
                setTutorial(next);
              }}
              onTour={() => {
                setTutorial(null);
                setTourOpen(true);
              }}
            />
          ) : area === "restorations" ? (
            status && (
              <RestorationsView
                settings={status.settings}
                databases={databases}
                seed={restoreSeed}
                onSeedUsed={clearRestoreSeed}
                onSettings={async (patch) => {
                  await api.call("updateSettings", patch);
                  refresh();
                }}
                onOpenSettings={openApiSettings}
              />
            )
          ) : area === "compare" ? (
            <CompareView
              databases={databases}
              seed={compareSeed}
              onSeedUsed={clearCompareSeed}
              onOpenRecord={(rowId) =>
                void perform(async () => {
                  const row = await api.call("getRow", { id: rowId });
                  await open(row);
                })
              }
            />
          ) : area === "chat" ? (
            status && (
              <div className="chat-page">
                <ChatView
                  settings={status.settings}
                  databases={databases}
                  initialDatabaseIds={databaseId ? [databaseId] : undefined}
                  onOpenSettings={openApiSettings}
                />
              </div>
            )
          ) : area === "settings" ? (
            status && (
              <Settings
                status={status}
                onReplayWelcome={() => setWelcomeOpen(true)}
                onWhatsNew={() => setWhatsNew("settings")}
                onReplayTour={() => setTourOpen(true)}
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
                          <ImagoMark size={48} />
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
                        <small>{t("Columnas, opciones y registros")}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                    <button onClick={() => importExternal("nodusImport")}>
                      <Database size={19} />
                      <span>
                        <strong>{t("Copiar datos de Nodus")}</strong>
                        <small>{t("Importación segura desde SQLite")}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                    <button onClick={() => importExternal("notionImport")}>
                      <FolderInput size={19} />
                      <span>
                        <strong>{t("ZIP de Notion")}</strong>
                        <small>{t("Tablas y archivos de imagen")}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                    <button
                      data-testid="import-tropy"
                      onClick={() =>
                        void perform(async () => {
                          const result = await api.call("tropyImport");
                          if (result) finishStandardImport(result);
                        })
                      }
                    >
                      <Images size={19} />
                      <span>
                        <strong>{t("Proyecto de Tropy")}</strong>
                        <small>{t("Metadatos, notas, etiquetas, fotos y selecciones (JSON-LD)")}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                    <button data-testid="import-iiif" onClick={() => setModal("iiif")}>
                      <Globe size={19} />
                      <span>
                        <strong>{t("Manifiesto IIIF")}</strong>
                        <small>{t("Objetos de bibliotecas y archivos digitales (BNE, Gallica, Europeana…)")}</small>
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
                          <p>
                            {t(
                              "Encuentra conexiones entre tus imágenes, textos y metadatos.",
                            )}
                          </p>
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
                            data-tour="search-input"
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
                            data-tour="search-image"
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
                          <div className="segmented" data-tour="search-modes">
                            {(["hybrid", "semantic", "literal"] as const).map(
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
                          {mode !== "literal" && (
                            <div
                              className="segmented semantic-sources"
                              role="group"
                              aria-label={t("Comparar la consulta con")}
                              title={t(
                                "Las imágenes muestran lo que se ve; la ficha, lo que el registro dice (título y propiedades). Ambas se combinan por posición, no por puntuación.",
                              )}
                            >
                              {(["both", "images", "text"] as const).map(
                                (s) => (
                                  <button
                                    key={s}
                                    type="button"
                                    className={sources === s ? "active" : ""}
                                    onClick={() => setSources(s)}
                                  >
                                    {t(
                                      s === "both"
                                        ? "Imagen + ficha"
                                        : s === "images"
                                          ? "Solo imagen"
                                          : "Solo ficha",
                                    )}
                                  </button>
                                ),
                              )}
                            </div>
                          )}
                          <div className="scope-picker">
                            <CriteriaSelect
                              label={t("Bases de datos de la búsqueda")}
                              options={databases.map((database) => ({
                                value: database.id,
                                label: database.name,
                                description: `${database.rowCount} ${t("registros")}`,
                              }))}
                              values={
                                scope ??
                                databases.map((database) => database.id)
                              }
                              multiple
                              placeholder={t("Seleccionar bases de datos…")}
                              onChange={(values) =>
                                setScope(
                                  values.length === databases.length
                                    ? undefined
                                    : values,
                                )
                              }
                            />
                          </div>
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
                              {t(
                                "Texto + imagen: media de vectores normalizados, con el mismo peso.",
                              )}
                            </small>
                          </div>
                        )}
                        {mode === "hybrid" && (
                          <label className="hybrid-weight">
                            Literal{" "}
                            <input
                              aria-label={t("Peso semántico")}
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
                          {t(
                            "La búsqueda literal está lista. Instala un modelo local en",
                          )}{" "}
                          <button onClick={() => setArea("settings")}>
                            {t("Configuración")}
                          </button>{" "}
                          {t("para activar la búsqueda multimodal.")}
                        </p>
                      )}
                      {modelReady && status?.autoIndex.quality && (
                        <p className="search-note" role="status">
                          <RefreshCw size={14} />
                          {status.autoIndex.quality.assets.toLocaleString()}{" "}
                          {t("imágenes sin indexar para la búsqueda semántica.")}{" "}
                          <button onClick={askIndexQuality}>{t("Elegir calidad e indexar")}</button>
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
                                  setFilterGroups(i.filterGroups ?? []);
                                  setSorts(
                                    i.sorts ??
                                      (i.sortColumn
                                        ? [
                                            {
                                              columnId: i.sortColumn,
                                              direction: i.descending
                                                ? "desc"
                                                : "asc",
                                            },
                                          ]
                                        : []),
                                  );
                                  setMatch(
                                    !i.match || i.match === "any"
                                      ? "words"
                                      : i.match,
                                  );
                                  setWeight(i.semanticWeight ?? 0.5);
                                  setSources(i.semanticSources ?? "both");
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
                          <Button
                            data-tour="db-chat"
                            aria-pressed={chatPanel}
                            className={chatPanel ? "is-active" : ""}
                            data-tooltip={t(chatPanel ? "Cerrar el chat" : "Abrir el chat junto a la base de datos")}
                            onClick={() => toggleChatPanel(!chatPanel)}
                          >
                            <MessageSquare size={15} />
                            {t("Chat")}
                          </Button>
                          <Button data-tour="db-properties" onClick={() => setModal("properties")}>
                            <SlidersHorizontal size={15} />
                            {t("Propiedades")}
                          </Button>
                          <details className="actions-menu">
                            <summary
                              className="button"
                              aria-label={t("Más acciones de la base")}
                              title={t("Más acciones de la base")}
                            >
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
                                onClick={() =>
                                  void perform(async () => {
                                    const result = await api.call("annotationsExport", { databaseId: detail.database.id });
                                    if (result)
                                      notify(t("{n} anotaciones exportadas.").replace("{n}", String(result.total)));
                                  })
                                }
                              >
                                {t("Exportar anotaciones (W3C)")}
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
                    <div className="view-tabs" data-tour="db-views">
                      <button
                        className={effectiveView === "table" ? "active" : ""}
                        {...viewTab("table")}
                        onClick={() => setView("table")}
                      >
                        <Table2 size={15} />
                        {t("Tabla")}
                        {featuredMark("table")}
                      </button>
                      <button
                        className={effectiveView === "gallery" ? "active" : ""}
                        {...viewTab("gallery")}
                        onClick={() => setView("gallery")}
                      >
                        <LayoutGrid size={15} />
                        {t("Galería")}
                        {featuredMark("gallery")}
                      </button>
                      {area === "databases" && (
                        <button
                          className={effectiveView === "map" ? "active" : ""}
                          {...viewTab("map")}
                          onClick={() => {
                            setView("map");
                            setSelected(new Set());
                          }}
                        >
                          <MapIcon size={15} />
                          {t("Mapa")}
                          {featuredMark("map")}
                        </button>
                      )}
                      {area === "databases" && hierarchyColumn && (
                        <button
                          className={effectiveView === "tree" ? "active" : ""}
                          {...viewTab("tree")}
                          onClick={() => setView("tree")}
                        >
                          <ListTree size={15} />
                          {t("Árbol")}
                          {featuredMark("tree")}
                        </button>
                      )}
                      {area === "databases" && (
                        <button
                          className={effectiveView === "timeline" ? "active" : ""}
                          {...viewTab("timeline")}
                          onClick={() => {
                            setView("timeline");
                            setSelected(new Set());
                          }}
                        >
                          <CalendarRange size={15} />
                          {t("Cronología")}
                          {featuredMark("timeline")}
                        </button>
                      )}
                      {area === "databases" && (
                        <button
                          className={effectiveView === "stats" ? "active" : ""}
                          {...viewTab("stats")}
                          onClick={() => {
                            setView("stats");
                            setSelected(new Set());
                          }}
                        >
                          <ChartColumn size={15} />
                          {t("Estadísticas")}
                          {featuredMark("stats")}
                        </button>
                      )}
                      {area === "databases" && (
                        <button
                          className={effectiveView === "variants" ? "active" : ""}
                          {...viewTab("variants")}
                          data-tooltip={t("La misma imagen en varios registros: copias, reproducciones y recortes")}
                          onClick={() => {
                            setView("variants");
                            setSelected(new Set());
                          }}
                        >
                          <Copy size={15} />
                          {t("Variantes")}
                          {featuredMark("variants")}
                        </button>
                      )}
                      {area === "databases" && (
                        <button
                          className={effectiveView === "network" ? "active" : ""}
                          {...viewTab("network")}
                          data-tooltip={t("Qué fotógrafos, lugares y temas aparecen juntos en los mismos registros")}
                          onClick={() => {
                            setView("network");
                            setSelected(new Set());
                          }}
                        >
                          <Share2 size={15} />
                          {t("Red")}
                          {featuredMark("network")}
                        </button>
                      )}
                      {area === "databases" && (
                        <button
                          className={effectiveView === "visualmap" ? "active" : ""}
                          {...viewTab("visualmap")}
                          data-tooltip={t("Las imágenes colocadas por parecido: las que se parecen aparecen juntas")}
                          onClick={() => {
                            setView("visualmap");
                            setSelected(new Set());
                          }}
                        >
                          <ChartScatter size={15} />
                          {t("Mapa visual")}
                          {featuredMark("visualmap")}
                        </button>
                      )}
                    </div>
                    <div
                      className="row toolbar-actions"
                      data-tour={area === "databases" ? "db-toolbar" : undefined}
                    >
                      {area === "databases" && detail && (
                        <Button
                          disabled={
                            criteriaContext !== criteriaKey ||
                            detail.database.id !== databaseId
                          }
                          data-tour="db-agreement"
                          onClick={() => setModal("agreement")}
                        >
                          <BarChart3 size={14} />
                          {t("Concordancia")}
                        </Button>
                      )}
                      {area === "databases" && detail && (
                        <Button
                          data-tour="db-suggest"
                          data-tooltip={t("Propone valores para los registros vacíos a partir de las imágenes más parecidas")}
                          onClick={() => setModal("suggest")}
                        >
                          <Lightbulb size={14} />
                          {t("Completar")}
                        </Button>
                      )}
                      {area === "databases" && detail && (
                        <Button data-tour="db-automations" onClick={() => setModal("automations")}>
                          <Sparkles size={14} />
                          {t("Automatizaciones")}
                        </Button>
                      )}
                      {area === "databases" &&
                        detail &&
                        ["table", "gallery", "tree"].includes(effectiveView) && (
                          <ColumnVisibility
                            detail={detail}
                            prefs={prefs}
                            onPrefs={updatePrefs}
                          />
                        )}
                      <ViewControls
                        openRequest={filterRequest}
                        sortRequest={sortRequest}
                        deferred={area === "search"}
                        details={visibleDetails}
                        filters={filters}
                        groups={filterGroups}
                        logic={logic}
                        sorts={sorts}
                        equivalences={status?.settings.fieldEquivalences ?? []}
                        onChange={changeCriteria}
                        onSorts={changeSorts}
                      />
                      {area === "search" ? (
                        <CriteriaSelect
                          label={t("Tipo de coincidencia")}
                          options={[
                            { value: "words", label: t("Palabras") },
                            { value: "phrase", label: t("Frase exacta") },
                            {
                              value: "partial",
                              label: t("Coincidencia parcial"),
                            },
                          ]}
                          values={[match]}
                          onChange={(values) =>
                            setMatch(values[0] as typeof match)
                          }
                        />
                      ) : (
                        <>
                          <details className="actions-menu" data-tour="db-import">
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
                              <span className="option-menu-label">{t("Como base de datos nueva")}</span>
                              <button
                                data-testid="menu-import-tropy"
                                onClick={() =>
                                  void perform(async () => {
                                    const result = await api.call("tropyImport");
                                    if (result) finishStandardImport(result);
                                  })
                                }
                              >
                                {t("Proyecto de Tropy")}
                              </button>
                              <button data-testid="menu-import-iiif" onClick={() => setModal("iiif")}>
                                {t("Manifiesto IIIF")}
                              </button>
                            </div>
                          </details>
                          <Button
                            primary
                            onClick={() => {
                              setBulkCount(5);
                              setModal("bulkAdd");
                            }}
                          >
                            <Plus size={15} />
                            {t("Añadir registros")}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {area === "databases" && detail && effectiveView !== "map" && (
                    <DatabaseSearch
                      key={detail.database.id}
                      value={dbSearch}
                      onChange={(next) => {
                        setDbSearch(next);
                        setOffset(0);
                        setSelected(new Set());
                      }}
                      modelReady={modelReady}
                    />
                  )}
                  <CriteriaBar
                    details={visibleDetails}
                    filters={filters}
                    groups={filterGroups}
                    logic={logic}
                    sorts={sorts}
                    onChange={changeCriteria}
                    onSorts={changeSorts}
                    onOpenFilters={() => setFilterRequest((n) => n + 1)}
                    onOpenSorts={() => setSortRequest((n) => n + 1)}
                  />
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
                          · {page.indexed.toLocaleString()}{" "}
                          {t("imágenes indexadas")}
                          {page.textIndexed !== undefined &&
                            ` · ${page.textIndexed.toLocaleString()} ${t("fichas indexadas")}`}{" "}
                          {!!status?.autoIndex.pending &&
                            ` · ${status.autoIndex.pending.toLocaleString()} ${t("pendientes de indexar (solo en la búsqueda literal)")}`}{" "}
                          · {t("similitud ≠ certeza")}
                        </small>
                      )}
                    </span>
                    <div className="row">
                      {(area === "databases" || selected.size > 0) && (
                        <details className="actions-menu" data-tour="db-export">
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
                        data-tour="selection-analyze"
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
                      <Button
                        data-tour="selection-compare"
                        data-tooltip={t("Abre las imágenes principales en una mesa de comparación (hasta seis)")}
                        onClick={() =>
                          void perform(async () => {
                            const ids = [...selected].slice(0, 6);
                            const rows = await Promise.all(
                              ids.map(
                                (id) =>
                                  page.rows.find((r) => r.id === id) ??
                                  api.call("getRow", { id }),
                              ),
                            );
                            const assets = rows
                              .map((r) => r.images.find((i) => i.width > 0)?.id)
                              .filter((id): id is string => !!id);
                            if (!assets.length)
                              throw new Error("Los registros seleccionados no tienen imágenes.");
                            setCompareSeed(assets);
                            setArea("compare");
                          })
                        }
                      >
                        <Columns2 size={14} />
                        {t("Comparar")}
                      </Button>
                      {area === "databases" && detail && (
                        <Button
                          data-tour="selection-plates"
                          data-tooltip={t("PDF con las imágenes numeradas y sus pies, para un trabajo académico, un artículo o un libro")}
                          onClick={() => setModal("plates")}
                        >
                          <FileImage size={14} />
                          {t("Láminas")}
                        </Button>
                      )}
                      <Button onClick={() => setModal("deleteRows")}>
                        <Trash2 size={14} />
                        {t("Eliminar")}
                      </Button>
                      <HistoryButtons
                        scope="all"
                        tick={tick}
                        perform={perform}
                        onDone={(message) => {
                          notify(message);
                          refresh();
                        }}
                      />
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
                  {!["map", "timeline", "stats", "variants", "network", "visualmap"].includes(effectiveView) && pager(true)}
                  {effectiveView === "timeline" && detail && criteriaContext === criteriaKey ? (
                    <TimelineView
                      key={detail.database.id}
                      detail={detail}
                      search={viewSearch}
                      prefs={prefs}
                      onPrefs={updatePrefs}
                      revision={tick}
                      onOpen={(id) => void perform(async () => open(await api.call("getRow", { id })))}
                      onProperties={() => setModal("properties")}
                    />
                  ) : effectiveView === "visualmap" && detail && criteriaContext === criteriaKey ? (
                    <VisualMapView
                      key={detail.database.id}
                      detail={detail}
                      search={viewSearch}
                      revision={tick}
                      onOpen={(id) => void perform(async () => open(await api.call("getRow", { id })))}
                      onSelect={(ids) => setSelected(new Set(ids))}
                    />
                  ) : effectiveView === "network" && detail && criteriaContext === criteriaKey ? (
                    <NetworkView
                      key={detail.database.id}
                      detail={detail}
                      search={viewSearch}
                      revision={tick}
                      onFilter={(node) => {
                        setFilters((current) => [
                          ...current,
                          node.optionId
                            ? { columnId: node.columnId, op: "any", value: [node.optionId] }
                            : { columnId: node.columnId, op: "equals", value: node.label },
                        ]);
                        setView("gallery");
                      }}
                    />
                  ) : effectiveView === "variants" && detail ? (
                    <VariantsView
                      key={detail.database.id}
                      databaseId={detail.database.id}
                      jobs={status?.jobs ?? []}
                      onOpenRecord={(id) => void perform(async () => open(await api.call("getRow", { id })))}
                      onCompare={(assets) => {
                        setCompareSeed(assets);
                        setArea("compare");
                      }}
                    />
                  ) : effectiveView === "stats" && detail && criteriaContext === criteriaKey ? (
                    <StatisticsView
                      key={detail.database.id}
                      detail={detail}
                      search={viewSearch}
                      prefs={prefs}
                      onPrefs={updatePrefs}
                      revision={tick}
                      perform={perform}
                    />
                  ) : effectiveView === "map" &&
                  detail &&
                  criteriaContext === criteriaKey ? (
                    <DatabaseMap
                      key={detail.database.id}
                      detail={detail}
                      onCompare={(assets) => {
                        setCompareSeed(assets);
                        setArea("compare");
                      }}
                      filters={filters}
                      groups={filterGroups}
                      sorts={sorts}
                      logic={logic}
                      revision={tick}
                      onOpen={(id) =>
                        void perform(async () =>
                          open(await api.call("getRow", { id })),
                        )
                      }
                      onProperties={() => setModal("properties")}
                    />
                  ) : !page.rows.length && !loading ? (
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
                  ) : effectiveView === "tree" && hierarchyColumn ? (
                    <div className="hierarchy-view">
                      <p className="muted">
                        {t("Jerarquía según la relación de la base.")}{" "}
                        {page.total > page.rows.length &&
                          t("Mostrando solo la página actual.")}
                      </p>
                      {hierarchy.length ? (
                        renderHierarchy(hierarchy)
                      ) : (
                        <p className="muted">{t("Sin relaciones todavía.")}</p>
                      )}
                    </div>
                  ) : effectiveView === "gallery" ? (
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
                                revision={
                                  row.images.find((a) => a.width > 0)?.revision
                                }
                                alt={row.title}
                              />
                            </button>
                            <input
                              type="checkbox"
                              aria-label={t("seleccionar") + " " + row.title}
                              checked={selected.has(row.id)}
                              onChange={(event) => selectFrom(row.id, event)}
                            />
                            <button
                              type="button"
                              className="image-add"
                              aria-label={t("Añadir imagen")}
                              title={t("Añadir imagen")}
                              onClick={(event) => {
                                event.stopPropagation();
                                attachImage(row);
                              }}
                            >
                              <ImagePlus size={13} />
                            </button>
                            {row.images.length > 1 && (
                              <span className="image-count">
                                <ImagePlus size={11} />
                                {row.images.length}
                              </span>
                            )}
                            {!!row.annotations?.length && (
                              <span
                                className="image-regions"
                                data-tooltip={t("Zonas anotadas")}
                              >
                                <SquareDashedMousePointer size={11} />
                                {row.annotations.length}
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
                                {t("Similitud")} {row.score.toFixed(3)}
                              </small>
                            )}
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <>
                    <div className="table-scroll data-table" ref={tableScrollRef}>
                      <table ref={tableRef}>
                        <thead data-tour={area === "databases" ? "db-columns" : undefined}>
                          <tr>
                            <th
                              className={
                                "select-col" + (frozenIds.length ? " frozen" : "")
                              }
                            >
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
                                {searchDatabases > 1 && (
                                  <th>{t("Base de datos")}</th>
                                )}
                                {searchColumns.map((column) => (
                                  <th key={column.key}>{column.name}</th>
                                ))}
                                {searchMatches && <th>{t("Coincidencia")}</th>}
                              </>
                            ) : (
                              shownColumns.map((c, index, all) => (
                                <th
                                  key={c.id}
                                  data-column={c.id}
                                  className={
                                    "column-header" +
                                    (frozenIds.includes(c.id) ? " frozen" : "") +
                                    (frozenIds.at(-1) === c.id ? " frozen-edge" : "") +
                                    (columnMenu === c.id ? " menu-open" : "") +
                                    (dragColumn === c.id ? " dragging" : "") +
                                    (dropColumn?.id === c.id
                                      ? " drop-" + dropColumn.side
                                      : "")
                                  }
                                  style={columnStyle(c.id)}
                                  tabIndex={0}
                                  aria-label={`${c.name} · ${t("Arrastra para mover la columna o usa Alt + flechas")}`}
                                  aria-haspopup="menu"
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    openColumnMenu(c.id, e.currentTarget);
                                  }}
                                  onKeyDown={(e) => {
                                    if (
                                      e.key === "ContextMenu" ||
                                      (e.shiftKey && e.key === "F10")
                                    ) {
                                      e.preventDefault();
                                      openColumnMenu(c.id, e.currentTarget);
                                      return;
                                    }
                                    if (
                                      !e.altKey ||
                                      !["ArrowLeft", "ArrowRight"].includes(e.key)
                                    )
                                      return;
                                    e.preventDefault();
                                    const left = e.key === "ArrowLeft",
                                      neighbour = all[index + (left ? -1 : 1)];
                                    if (neighbour)
                                      moveColumn(c.id, neighbour.id, left ? "before" : "after");
                                  }}
                                  onDragOver={(e) => {
                                    if (!dragColumn || dragColumn === c.id) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                    const box = e.currentTarget.getBoundingClientRect(),
                                      side =
                                        e.clientX < box.left + box.width / 2
                                          ? "before"
                                          : "after";
                                    if (dropColumn?.id !== c.id || dropColumn.side !== side)
                                      setDropColumn({ id: c.id, side });
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    if (dragColumn && dropColumn)
                                      moveColumn(dragColumn, dropColumn.id, dropColumn.side);
                                    setDragColumn(null);
                                    setDropColumn(null);
                                  }}
                                >
                                  <span
                                    className="column-header-label"
                                    draggable
                                    onDragStart={(e) => {
                                      setDragColumn(c.id);
                                      e.dataTransfer.effectAllowed = "move";
                                      e.dataTransfer.setData("text/plain", c.name);
                                    }}
                                    onDragEnd={() => {
                                      setDragColumn(null);
                                      setDropColumn(null);
                                    }}
                                  >
                                    <GripVertical size={10} className="column-grip" />
                                    <ColumnTypeIcon
                                      type={c.type}
                                      heritage={isHeritageColumn(c)}
                                      ai={c.type !== "ai" && isAiColumn(c)}
                                    />
                                    <span>{c.name}</span>
                                  </span>
                                  {isAiColumn(c) && (
                                    <button
                                      type="button"
                                      className="column-ai-button"
                                      aria-label={`${t("Generar con IA")} · ${c.name}`}
                                      data-tooltip={t("Generar con IA")}
                                      aria-haspopup="menu"
                                      aria-expanded={aiMenu === c.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        aiMenuAnchor.current = e.currentTarget;
                                        setAiMenu((open) => (open === c.id ? null : c.id));
                                      }}
                                    >
                                      <Sparkles size={13} />
                                    </button>
                                  )}
                                  <span
                                    className="column-resize"
                                    role="separator"
                                    aria-orientation="vertical"
                                    aria-label={t("Cambiar el ancho de la columna")}
                                    title={t("Arrastra para cambiar el ancho; doble clic para restablecerlo")}
                                    onMouseDown={(e) => startResize(c.id, e)}
                                    onDoubleClick={() => {
                                      const next = { ...columnWidths };
                                      delete next[c.id];
                                      saveWidths(next);
                                    }}
                                  />
                                </th>
                              ))
                            )}
                            <th className="add-property-col">
                              {area === "databases" && detail && (
                                <button
                                  type="button"
                                  className="add-property-button"
                                  aria-label={t("Añadir propiedad")}
                                  data-tooltip={t("Añadir propiedad")}
                                  aria-haspopup="menu"
                                  aria-expanded={addPropertyOpen}
                                  onClick={(e) => {
                                    addPropertyAnchor.current = e.currentTarget;
                                    setAddPropertyOpen((open) => !open);
                                  }}
                                >
                                  <Plus size={14} />
                                </button>
                              )}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {page.rows.map((row, rowIndex) => (
                            <tr
                              key={row.id}
                              className={
                                selected.has(row.id) ? "is-selected" : ""
                              }
                            >
                              <td className={frozenIds.length ? "frozen" : undefined}>
                                <input
                                  type="checkbox"
                                  data-tour={rowIndex === 0 ? "row-select" : undefined}
                                  aria-label={
                                    t("seleccionar") + " " + row.title
                                  }
                                  checked={selected.has(row.id)}
                                  onChange={(event) => selectFrom(row.id, event)}
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
                                  {searchDatabases > 1 && (
                                    <td>{row.databaseName}</td>
                                  )}
                                  {searchColumns.map((column) => {
                                    const c = column.byDatabase.get(
                                      row.databaseId,
                                    );
                                    return (
                                      <td key={column.key}>
                                        {c ? (
                                          renderCell(row, c)
                                        ) : (
                                          <span className="muted">—</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                  {searchMatches && (
                                    <td className="snippet-cell">
                                      {row.snippet ??
                                        (row.score !== undefined
                                          ? row.score.toFixed(3)
                                          : "—")}
                                    </td>
                                  )}
                                </>
                              ) : (
                                shownColumns.map((c) => (
                                  <td
                                    key={c.id}
                                    data-column={c.id}
                                    style={columnStyle(c.id)}
                                    className={
                                      (frozenIds.includes(c.id) ? "frozen" : "") +
                                      (frozenIds.at(-1) === c.id ? " frozen-edge" : "") +
                                      (prefs.wrap.includes(c.id) ? " wrap" : "")
                                    }
                                  >
                                    {renderCell(row, c)}
                                  </td>
                                ))
                              )}
                              <td className="row-actions">
                                <Button
                                  icon
                                  data-tour={rowIndex === 0 ? "row-image-add" : undefined}
                                  aria-label={t("Añadir imagen")}
                                  title={t("Añadir imagen")}
                                  onClick={() => attachImage(row)}
                                >
                                  <ImagePlus size={14} />
                                </Button>
                                <Button
                                  icon
                                  data-tour={rowIndex === 0 ? "row-open" : undefined}
                                  aria-label={t("Abrir registro")}
                                  onClick={() => void perform(() => open(row))}
                                >
                                  <ArrowUpRight size={14} />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {area === "databases" && detail && (
                          <tfoot>
                            <tr className="column-calcs">
                              <td className={frozenIds.length ? "frozen" : undefined} />
                              {shownColumns.map((c) => {
                                const fn = prefs.calc[c.id],
                                  label = fn
                                    ? ROLLUP_FUNCTIONS.find((f) => f.id === fn)?.label
                                    : undefined;
                                return (
                                  <td
                                    key={c.id}
                                    data-column={c.id}
                                    style={columnStyle(c.id)}
                                    className={
                                      (frozenIds.includes(c.id) ? "frozen" : "") +
                                      (frozenIds.at(-1) === c.id ? " frozen-edge" : "")
                                    }
                                  >
                                    <button
                                      type="button"
                                      className={"column-calc" + (fn ? " active" : "")}
                                      aria-label={`${t("Calcular")} ${c.name}`}
                                      onClick={(e) => {
                                        setMenuView("calc");
                                        openColumnMenu(c.id, e.currentTarget);
                                      }}
                                    >
                                      {fn && label ? (
                                        <>
                                          <span>{t(label)}</span>
                                          <strong>
                                            {c.id in summaries
                                              ? summaryText(fn, summaries[c.id])
                                              : "…"}
                                          </strong>
                                        </>
                                      ) : (
                                        <span className="column-calc-hint">
                                          {t("Calcular")}
                                        </span>
                                      )}
                                    </button>
                                  </td>
                                );
                              })}
                              <td />
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                    <StickyScrollbar target={tableScrollRef} />
                    </>
                  )}
                  {pager()}
                </div>
              )}
            </>
          )}
        </main>
        {area === "databases" && detail && chatPanel && status && (
          <aside className="chat-side" style={{ width: chatWidth }} data-testid="chat-side">
            <div
              className="chat-side-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("Cambiar el ancho del chat")}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") resizeChat(chatWidth + 24);
                if (event.key === "ArrowRight") resizeChat(chatWidth - 24);
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                const start = event.clientX,
                  width = chatWidth,
                  handle = event.currentTarget;
                handle.classList.add("is-dragging");
                const move = (e: PointerEvent) => resizeChat(width + start - e.clientX, false);
                const up = (e: PointerEvent) => {
                  handle.classList.remove("is-dragging");
                  resizeChat(width + start - e.clientX);
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
            />
            <ChatView
              compact
              settings={status.settings}
              databases={databases}
              initialDatabaseIds={[detail.database.id]}
              onClose={() => toggleChatPanel(false)}
              onExpand={() => setArea("chat")}
              onOpenSettings={openApiSettings}
            />
          </aside>
        )}
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
      {status && welcomeOpen && (
        <Welcome
          language={status.settings.language}
          onLanguage={async (language) => {
            await api.call("updateSettings", { language });
            onLanguage(language);
            refresh();
          }}
          onFinish={({ tour, choice }) => {
            setWelcomeOpen(false);
            void api
              .call("updateSettings", { welcomeVersion: WELCOME_VERSION })
              .then(refresh)
              .catch(() => {});
            setAfterTour(choice === "api" ? "api" : null);
            if (tour) setTourOpen(true);
            else if (choice === "api") openEmbeddingSettings();
            else setArea("home");
          }}
        />
      )}
      {whatsNew && !welcomeOpen && (
        <WhatsNewModal
          current={APP_VERSION}
          notes={releaseNotesUpTo(APP_VERSION)}
          startup={whatsNew === "startup"}
          onClose={() => {
            setWhatsNew(null);
            void api.call("updateSettings", { whatsNewVersion: APP_VERSION }).then(refresh).catch(() => {});
          }}
        />
      )}
      {tutorial && !tourOpen && !welcomeOpen && (
        <GuidedTour
          key={tutorial.id}
          steps={tutorial.steps}
          label="Tutorial"
          strict
          onArea={tourArea}
          onClose={() => setTutorial(null)}
          onDone={() => {
            markTutorialDone(tutorial.id);
            setDoneTutorials((done) => (done.includes(tutorial.id) ? done : [...done, tutorial.id]));
            setJustFinished(tutorial);
            setTutorialsOpen(true);
          }}
        />
      )}
      {tutorialsOpen && (
        <Modal
          icon={GraduationCap}
          title={t("Tutoriales")}
          wide
          onClose={() => {
            setTutorialsOpen(false);
            setJustFinished(null);
          }}
        >
          <div className="modal-body tutorials-modal" data-testid="tutorials-modal">
            <TutorialsView
              compact
              done={doneTutorials}
              finished={justFinished}
              onStart={(next) => {
                setTutorialsOpen(false);
                setJustFinished(null);
                setTourOpen(false);
                setTutorial(next);
              }}
              onTour={() => {
                setTutorialsOpen(false);
                setJustFinished(null);
                setTutorial(null);
                setTourOpen(true);
              }}
            />
          </div>
        </Modal>
      )}
      {tourOpen && !welcomeOpen && (
        <GuidedTour
          onArea={tourArea}
          onClose={() => {
            setTourOpen(false);
            void api
              .call("updateSettings", { tourVersion: TOUR_VERSION })
              .then(refresh)
              .catch(() => {});
            if (afterTour === "api") openEmbeddingSettings();
            setAfterTour(null);
          }}
        />
      )}
      {toast && (
        <div
          className={"toast " + (toast.error ? "error" : "")}
          role={toast.error ? "alert" : "status"}
        >
          <span>{t(toast.message)}</span>
          <Button icon aria-label={t("Cerrar")} onClick={() => setToast(null)}>
            <X size={14} />
          </Button>
        </div>
      )}
      {modal === "bulkAdd" && detail && (
        <Modal icon={Plus} title={t("Añadir registros")} onClose={() => setModal(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const count = Number(bulkCount);
                const ids = await api.call("createRows", {
                  databaseId: detail.database.id,
                  count,
                });
                setModal(null);
                refresh();
                if (ids.length === 1) {
                  await open(await api.call("getRow", { id: ids[0] }));
                } else {
                  notify(`${ids.length} ${t("registros creados")}`);
                }
              });
            }}
          >
            <div className="modal-body stack">
              <label>
                {t("Número de registros")}
                <input
                  autoFocus
                  type="number"
                  min={1}
                  max={1000}
                  required
                  value={bulkCount}
                  onChange={(event) => setBulkCount(Number(event.target.value))}
                />
              </label>
              <p className="hint">
                {t("Puedes crear hasta 1.000 registros vacíos de una vez.")}
              </p>
            </div>
            <footer>
              <Button type="button" onClick={() => setModal(null)}>
                {t("Cancelar")}
              </Button>
              <Button primary type="submit">
                {t("Crear")} {Number(bulkCount) || ""}
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {(modal === "create" || modal === "rename") && (
        <Modal icon={Database}
          title={t(
            modal === "rename"
              ? "Renombrar base de datos"
              : "Nueva base de datos",
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
                  placeholder={t("Archivo fotográfico")}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {modal === "create" && (
                <p className="hint">
                  {t(
                    "Define tus propias propiedades y clasificaciones. Puedes importar o añadir imágenes en cualquier momento.",
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
        <Modal icon={Bookmark} title={t("Guardar búsqueda")} onClose={() => setModal(null)}>
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
                    filterGroups,
                    sorts,
                    semanticWeight: weight,
                    semanticSources: sources,
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
              {(imageQuery || similarId) && (
                <p className="hint">
                  {t(
                    "La imagen de consulta no se guarda en la búsqueda. Vuelve a adjuntarla o a elegir la imagen de referencia al recuperarla.",
                  )}
                </p>
              )}
            </div>
            <footer>
              <Button primary>{t("Guardar")}</Button>
            </footer>
          </form>
        </Modal>
      )}
      {(modal === "deleteRows" || modal === "deleteDatabase") && (
        <Modal icon={Trash2}
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
      {status?.autoIndex.quality && (qualityAsked || !qualityDismissed) && (
        <IndexQualityDialog
          quality={status.autoIndex.quality}
          onClose={() => {
            setQualityAsked(false);
            setQualityDismissed(true);
          }}
          onStart={(visionBudget) =>
            perform(async () => {
              await api.call("startIndexing", { visionBudget });
              setQualityAsked(false);
              setQualityDismissed(true);
              notify(t("Indexación iniciada. Puedes seguirla en Tareas."));
              refresh();
            })
          }
        />
      )}
      {viewMenu && detail && area === "databases" && (
        <CriteriaPopover
          anchor={viewMenuAnchor as React.RefObject<HTMLElement>}
          onClose={() => setViewMenuAt(null)}
          width={250}
          label={t("Opciones de la vista")}
          className="column-menu view-menu"
        >
          <div role="menu" className="column-menu-group">
            <button
              type="button"
              role="menuitem"
              className="column-menu-item"
              autoFocus
              data-testid="view-feature"
              onClick={() => {
                const next = featuredView === viewMenu ? null : viewMenu;
                updatePrefs((current) => ({ ...current, defaultView: next }));
                setViewMenuAt(null);
              }}
            >
              {featuredView === viewMenu ? <StarOff size={15} /> : <Star size={15} />}
              <span>{t(featuredView === viewMenu ? "Quitar destacado" : "Destacar")}</span>
            </button>
          </div>
          <p className="view-menu-note">
            {t("La vista destacada es la que se abre al entrar en esta base de datos. Sin ninguna, se abre la tabla.")}
          </p>
        </CriteriaPopover>
      )}
      {columnMenu &&
        detail &&
        area === "databases" &&
        detail.columns.some((c) => c.id === columnMenu) && (
          <ColumnMenu
            key={columnMenu + menuView}
            detail={detail}
            column={detail.columns.find((c) => c.id === columnMenu)!}
            anchor={menuAnchor as React.RefObject<HTMLElement>}
            initialView={menuView}
            prefs={prefs}
            sort={sorts.find((s) => s.columnId === columnMenu)?.direction ?? null}
            perform={perform}
            onClose={() => {
              setColumnMenu(null);
              setMenuView("main");
            }}
            onDetail={(next) => {
              setDetail(next);
              setAllDetails((all) =>
                all.map((d) => (d.database.id === next.database.id ? next : d)),
              );
              refresh();
            }}
            onPrefs={updatePrefs}
            onFilter={() => filterColumn(columnMenu)}
            onSort={(direction) => sortColumn(columnMenu, direction)}
            onEdit={() => {
              setEditColumn(columnMenu);
              setModal("properties");
            }}
            onCleanup={() => {
              setToolColumn(columnMenu);
              setModal("cleanup");
            }}
            onAuthorities={() => {
              setToolColumn(columnMenu);
              setModal("authorities");
            }}
            onHeritage={() => {
              setToolColumn(columnMenu);
              setModal("heritage");
            }}
            onInserted={(id) =>
              // Wait for the new header to render, then name it from its menu.
              requestAnimationFrame(() => {
                const th = tableRef.current?.querySelector<HTMLElement>(
                  `th[data-column="${id}"]`,
                );
                if (th) {
                  th.scrollIntoView({ block: "nearest", inline: "nearest" });
                  openColumnMenu(id, th);
                }
              })
            }
          />
        )}
      {aiMenu &&
        detail &&
        area === "databases" &&
        detail.columns.some((c) => c.id === aiMenu) && (
          <AiColumnMenu
            detail={detail}
            column={detail.columns.find((c) => c.id === aiMenu)!}
            anchor={aiMenuAnchor as React.RefObject<HTMLElement>}
            language={status?.settings.language ?? "es"}
            perform={perform}
            onClose={() => setAiMenu(null)}
            onQueued={refresh}
          />
        )}
      {addPropertyOpen && detail && area === "databases" && (
        <AddPropertyMenu
          detail={detail}
          anchor={addPropertyAnchor as React.RefObject<HTMLElement>}
          perform={perform}
          language={status?.settings.language ?? "es"}
          onClose={() => setAddPropertyOpen(false)}
          onSetup={(type) => {
            setCreateType(type);
            setModal("properties");
          }}
          onCreated={async (id) => {
            const next = await window.imago.call("detail", {
              id: detail.database.id,
            });
            setDetail(next);
            setAllDetails((all) =>
              all.map((d) => (d.database.id === next.database.id ? next : d)),
            );
            refresh();
            // Wait for the new header to render, then name it from its menu.
            requestAnimationFrame(() => {
              const th = tableRef.current?.querySelector<HTMLElement>(
                `th[data-column="${id}"]`,
              );
              if (th) {
                th.scrollIntoView({ block: "nearest", inline: "nearest" });
                openColumnMenu(id, th);
              }
            });
          }}
        />
      )}
      {modal === "properties" && detail && (
        <Properties
          initialColumnId={editColumn}
          initialCreateType={createType}
          detail={detail}
          status={status!}
          perform={perform}
          onChanged={refresh}
          onClose={() => {
            setModal(null);
            setEditColumn(null);
            setCreateType(null);
          }}
        />
      )}
      {modal === "iiif" && (
        <IiifDialog
          onClose={() => setModal(null)}
          onImported={(result) => {
            setModal(null);
            finishStandardImport(result);
          }}
        />
      )}
      {modal === "cleanup" && detail && toolColumn && detail.columns.some((c) => c.id === toolColumn) && (
        <CleanupDialog
          column={detail.columns.find((c) => c.id === toolColumn)!}
          onClose={() => setModal(null)}
          onDone={(message) => {
            notify(message);
            setModal(null);
            void reloadDetail(detail.database.id);
          }}
        />
      )}
      {modal === "authorities" && detail && toolColumn && detail.columns.some((c) => c.id === toolColumn) && (
        <AuthorityDialog
          column={detail.columns.find((c) => c.id === toolColumn)!}
          onClose={() => setModal(null)}
          onDone={(message, changed) => {
            notify(message);
            if (changed) {
              setModal(null);
              void reloadDetail(detail.database.id);
            }
          }}
        />
      )}
      {modal === "heritage" && detail && toolColumn && detail.columns.some((c) => c.id === toolColumn) && (
        <HeritageDialog
          column={detail.columns.find((c) => c.id === toolColumn)!}
          onClose={() => setModal(null)}
          onChanged={() => void reloadDetail(detail.database.id)}
        />
      )}
      {modal === "plates" && detail && status && (
        <PlatesDialog
          detail={detail}
          rowIds={[...selected]}
          template={status.settings.citationTemplates?.[detail.database.id]}
          onTemplate={async (template) => {
            await api.call("updateSettings", {
              citationTemplates: { ...(status.settings.citationTemplates ?? {}), [detail.database.id]: template },
            });
            refresh();
          }}
          onClose={() => setModal(null)}
          onDone={(message) => {
            notify(message);
            setModal(null);
          }}
        />
      )}
      {modal === "suggest" && detail && (
        <SuggestDialog
          key={detail.database.id}
          detail={detail}
          onClose={() => setModal(null)}
          onApplied={(count) => {
            setModal(null);
            notify(t("{n} valores guardados. Puedes deshacerlo con «Deshacer».").replace("{n}", String(count)));
            refresh();
          }}
        />
      )}
      {modal === "automations" && detail && (
        <Automations
          key={detail.database.id}
          detail={detail}
          perform={perform}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "agreement" && detail && (
        <AgreementWorkbench
          key={detail.database.id}
          detail={detail}
          filters={filters}
          groups={filterGroups}
          logic={logic}
          perform={perform}
          onClose={() => setModal(null)}
          onOpen={async (id) => {
            await open(await api.call("getRow", { id }));
          }}
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
        <Modal icon={Clock3} title={t("Tareas")} wide onClose={() => setModal(null)}>
          <div className="modal-body" data-tour="jobs-list">
            <Jobs
              jobs={status?.jobs ?? []}
              perform={perform}
              onChanged={refresh}
            />
          </div>
        </Modal>
      )}
      {modal === "analyze" && (
        <Modal icon={Sparkles} title={t("Generar propuestas")} onClose={() => setModal(null)}>
          <div className="modal-body stack" data-tour="analyze-form">
            <p>
              {selected.size} {t("registros")} ·{" "}
              {t("Solo se proponen cambios en propiedades vacías.")}
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
            <fieldset className="analysis-task" data-tour="analyze-task">
              <legend>{t("Para las propiedades de texto")}</legend>
              <label className="check-label">
                <input
                  type="radio"
                  name="analysis-task"
                  checked={analysisTask === "describe"}
                  onChange={() => setAnalysisTask("describe")}
                />
                {t("Describir lo que se ve en la imagen")}
              </label>
              <label className="check-label">
                <input
                  type="radio"
                  name="analysis-task"
                  checked={analysisTask === "transcribe"}
                  onChange={() => setAnalysisTask("transcribe")}
                />
                {t("Transcribir el texto visible: reversos, sellos, inscripciones, firmas y pies de foto")}
              </label>
              <small className="hint">
                {t("La transcripción lee todas las imágenes del registro (por ejemplo, el anverso y el reverso), conserva la ortografía original y marca lo que no se puede leer como [ilegible].")}
              </small>
            </fieldset>
            {analysisTask === "describe" && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={detailed}
                  onChange={(e) => setDetailed(e.target.checked)}
                />
                {t("Descripción detallada")}
              </label>
            )}
          </div>
          <footer>
            <Button
              primary
              data-tour="analyze-run"
              disabled={!analysisColumns.length}
              onClick={() =>
                void perform(async () => {
                  await api.call("analyze", {
                    rowIds: [...selected],
                    columnIds: analysisColumns,
                    language: analysisLanguage,
                    detailed,
                    task: analysisTask,
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
        <Modal icon={Sparkles}
          wide
          title={t("Revisar propuestas")}
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <div className="row" data-tour="proposals-actions">
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
              <HistoryButtons
                scope="proposals"
                tick={tick}
                perform={perform}
                onDone={(message) => {
                  notify(message);
                  void api.call("proposals").then(setProposals);
                  refresh();
                }}
              />
            </div>
            {!proposals.length && (
              <p className="muted">{t("No hay propuestas pendientes.")}</p>
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
                  <summary>{t("Instrucciones")}</summary>
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
          detail={
            // The open database's detail follows column moves live.
            detail?.database.id === recordDetail.database.id
              ? detail
              : recordDetail
          }
          hidden={
            detail?.database.id === recordDetail.database.id
              ? prefs.hidden
              : readColumnPrefs(recordDetail.database.id).hidden
          }
          onClose={() => setOpenRow(null)}
          onChanged={refresh}
          onSimilar={similar}
          citation={
            status?.settings.citationTemplates?.[recordDetail.database.id] ??
            citationTemplate(recordDetail.columns, "chicago", [openRow])
          }
          onOpenRecord={(rowId) =>
            void perform(async () => open(await api.call("getRow", { id: rowId })))
          }
          onCompare={(assets) => {
            setOpenRow(null);
            setCompareSeed(assets);
            setArea("compare");
          }}
          onRestore={(assetId) => {
            setOpenRow(null);
            setRestoreSeed(assetId);
            setArea("restorations");
          }}
          perform={perform}
        />
      )}
    </div>
  );
}

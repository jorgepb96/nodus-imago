import type {
  DatabaseColumn,
  DatabaseColumnConfig,
  DatabaseColumnType,
  DatabaseDetail,
  DatabaseRow,
  DatabaseSummary,
} from "./databases";
import type { CsvImportPlanData } from "./databaseCsv";
import type { ApiProfile, ApiProvider, ModelChoice } from "./aiConfig";
import type { GazetteerPlace } from "./places";
import type { DatabaseLocationValue } from "./databaseProperties";
import type { ModelPreparation } from "./modelPreparation";
import type {
  AgreementInput,
  AgreementResult,
  AgreementExperiment,
} from "./agreement";

export type MapRecord = {
  id: string;
  title: string;
  location: DatabaseLocationValue | null;
  image: { id: string; revision?: string } | null;
  imageCount: number;
  /** Placed by a heritage element (its own coordinates or its whole's). */
  placement?: { optionId: string; inherited: boolean } | null;
};
export type MapRecordsInput = {
  databaseId: string;
  /** A location property, or a heritage property (records at their elements). */
  columnId: string;
  /** With a heritage property: the location used for records with no placed element. */
  fallbackColumnId?: string | null;
  filters?: PropertyFilter[];
  filterLogic?: "and" | "or";
  filterGroups?: PropertyFilterGroup[];
  sorts?: ViewSort[];
};

/** One element on the heritage map: where it is and how many records show it. */
export type HeritageMapElement = {
  optionId: string;
  label: string;
  latitude: number;
  longitude: number;
  inherited: boolean;
  /** Placed at the centre of its town only. */
  approximate?: boolean;
  group: string | null;
  type: string | null;
  parentId: string | null;
  /** Records of the view that show it (with its parts when asked). */
  count: number;
  rowIds: string[];
};
export type ImageAsset = {
  id: string;
  revision?: string;
  rowId: string;
  columnId: string;
  fileName: string;
  contentHash: string;
  bytes: number;
  width: number;
  height: number;
  position: number;
  missing: boolean;
  metadata: Record<string, unknown>;
  description: string | null;
};
/** A region of an image, in fractions of its width and height (0–1). */
export type ImageAnnotation = {
  id: string;
  assetId: string;
  rowId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  note: string;
  tags: string[];
  color: string | null;
  createdAt: string;
  updatedAt: string;
  /** A region, or a point (w = h = 0). */
  kind?: "rect" | "point";
  /** The heritage element (option) this mark shows. */
  optionId?: string | null;
};
/** What an import from Tropy or IIIF created. */
export type StandardImport = { databaseId: string; records: number; photos: number; failed: number; annotations: number };
export type RecordRow = DatabaseRow & {
  images: ImageAsset[];
  /** Regions marked on the record's images, with their notes. */
  annotations?: ImageAnnotation[];
  databaseName: string;
  title: string;
  snippet?: string;
  score?: number;
};
export type EquivalenceGroup = {
  id: string;
  name: string;
  columnIds: string[];
};
export type PropertyFilter = {
  id?: string;
  disabled?: boolean;
  databaseId?: string;
  columnId: string;
  columnIds?: string[];
  groupId?: string;
  op: PropertyFilterOp;
  value: string | string[];
};
export type PropertyFilterOp =
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "equals"
  | "not_equals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "any"
  | "all"
  | "none"
  | "empty"
  | "not_empty"
  | "checked"
  | "unchecked"
  | "relative_date"
  | "has_coordinates"
  | "no_coordinates"
  /** Heritage properties: elements of these types («grupo/tipo») or groups,
   * parts of these elements, marked on the photo, not linked to Wikidata. */
  | "heritage_type"
  | "heritage_group"
  | "part_of"
  | "heritage_marked"
  | "heritage_unlinked"
  /** «Etiquetas visuales»: records whose images were not all reviewed, or reviewed with nothing to tag. */
  | "visual_unreviewed"
  | "visual_reviewed_empty";
export type PropertyFilterGroup = {
  id: string;
  logic: "and" | "or";
  filters: PropertyFilter[];
  groups?: PropertyFilterGroup[];
};
export type ViewSort = {
  columnId: string;
  direction: "asc" | "desc";
  /** Where records without a value go. Defaults to the end in both directions. */
  empty?: "first" | "last";
  /** Option properties sort by their option order unless told to use the
   * option label (alphabetical) or, for multiple selection, how many are set. */
  by?: "label" | "count";
};
export type SearchInput = {
  databaseIds?: string[];
  query?: string;
  mode?: "literal" | "semantic" | "hybrid";
  /** "any" (any significant word, ranked) is used by the lexical lane of hybrid search. */
  match?: "words" | "phrase" | "partial" | "any";
  filters?: PropertyFilter[];
  filterLogic?: "and" | "or";
  filterGroups?: PropertyFilterGroup[];
  sorts?: ViewSort[];
  limit?: number;
  offset?: number;
  sortColumn?: string;
  descending?: boolean;
  imageToken?: string;
  similarAssetId?: string;
  semanticWeight?: number;
  /** What a text query is compared with: images, the records' own text, or both (default). */
  semanticSources?: "both" | "images" | "text";
  /** Keep only the N closest records by meaning (a database's search box). */
  semanticLimit?: number;
};
export type Page = {
  rows: RecordRow[];
  total: number;
  indexed?: number;
  /** Records whose text has a vector for the current model. */
  textIndexed?: number;
};
export type ImageMatch = {
  pathToken: string;
  fileName: string;
  rowId: string | null;
  candidates: string[];
  status: "safe" | "ambiguous" | "unmatched";
  strategy?: string;
};
export type ImagePlan = {
  token: string;
  files: number;
  columnId?: string;
  matches: ImageMatch[];
};
export type Job = {
  id: string;
  label: string;
  kind: string;
  state: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  done: number;
  total: number;
  failed: number;
  skipped: number;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  /** An indexing pass: how many records (their text) and images it holds. */
  indexRows?: number | null;
  indexAssets?: number | null;
};
export type Proposal = {
  id: string;
  rowId: string;
  columnId: string;
  before: string | null;
  value: string | null;
  model: string;
  revision: string;
  prompt: string;
  createdAt: string;
  state: string;
  title: string;
  columnName: string;
};
/** Which change batches an Undo or Redo button may touch. */
export type HistoryScope = "all" | "proposals";
/** How a change batch was made; null is a single edit. */
export type HistoryKind = "proposals" | "cleanup" | "locate" | "link" | "ai" | null;
/** What the next Undo or Redo in a scope would change, shown before it runs. */
export type HistoryStep = {
  kind: HistoryKind;
  changes: number;
  columns: string[];
  createdAt: string;
};
export type Provenance = {
  id: string;
  columnId: string;
  columnName: string;
  value: string | null;
  model: string;
  revision: string;
  prompt: string;
  state: "pending" | "accepted" | "rejected";
  createdAt: string;
};
export type ModelInfo = {
  available?: boolean;
  unavailableReason?: string;
  experimental?: boolean;
  id: string;
  label: string;
  task: "embedding" | "vision" | "runtime";
  repository: string;
  revision: string;
  license: string;
  estimatedGB: number;
  installed: boolean;
  verified: boolean;
  status: string;
  files: number;
  bytes: number;
};
export type Settings = {
  embeddingModel: string;
  /** Provider and model when embeddingModel is "api-embedding". */
  embeddingApi?: import("./embeddingApi").EmbeddingApiChoice;
  /** Index new and edited content on its own; local on and API off when absent. */
  autoIndex?: { local?: boolean; api?: boolean };
  /** EmbeddingGemma 2 visual token budget (Gemma 4 sizes); 280 when absent. */
  visionBudget?: 70 | 140 | 280;
  /** The researcher chose the image quality when images were first indexed. */
  indexQualityChosen?: boolean;
  /** Introduction and guided tour already seen (their version). */
  welcomeVersion?: number;
  /** The last version whose news were shown after an update. */
  whatsNewVersion?: string;
  tourVersion?: number;
  mode: "light" | "dark" | "system";
  theme: string;
  accent: string;
  language: "es" | "en";
  profile: "light" | "balanced" | "advanced";
  dimensions: 256 | 512 | 768;
  python: string;
  device: "cpu" | "mps" | "cuda";
  visionModel: string;
  descriptionModel: ModelChoice;
  classificationModel: ModelChoice;
  remoteEnabled: boolean;
  apiProfiles: Partial<Record<ApiProvider, ApiProfile>>;
  apiDelayMs: number;
  parallelJobs: number;
  /** Cells sent at once to an API model (local models run one at a time). */
  apiParallel?: number;
  fieldEquivalences: EquivalenceGroup[];
  /** Image models of the restoration workshop ("provider|model") and the favourites. */
  imageModels?: string[];
  favoriteImageModels?: string[];
  /** AI property tasks the user saved. */
  aiUserPresets?: import("./databaseAi").AiUserPreset[];
  /** Citation template of each database (property names in braces). */
  citationTemplates?: Record<string, string>;
  /** Mark added to restored images when they are downloaded. */
  watermark?: import("./restoration").Watermark;
};
export type Status = {
  root: string;
  databases: number;
  rows: number;
  images: number;
  indexed: number;
  /** Records whose own text has a vector for the active model. */
  textIndexed: number;
  /** Whether the active embedding backend can answer semantic queries now. */
  semanticReady: boolean;
  autoIndex: import("../electron/autoIndex").AutoIndexState;
  platform: string;
  memoryGB: number;
  parallelCapacity: number;
  cpus: number;
  settings: Settings;
  models: ModelInfo[];
  jobs: Job[];
  /** Launched by a test driver: first-run screens stay out of the way. */
  automated?: boolean;
};
export type SavedSearch = { id: string; name: string; input: SearchInput };
export type Commands = {
  updateStatus:{input:void;result:import("./updates").UpdateStatus};
  updateConfigure:{input:import("./updates").UpdatePreferences;result:void};
  updateCheck:{input:void;result:import("./updates").UpdateStatus};
  updateDownload:{input:void;result:void};
  updateInstall:{input:{password?:string}|void;result:void};
  reloadInterface: {input:void;result:void};
  backupStatus:{input:void;result:import("./backups").BackupStatus};
  backupChooseFolder:{input:void;result:string|null};
  backupConfigure:{input:import("./backups").BackupPreferences;result:void};
  backupSetPassword:{input:{password:string};result:void};
  backupRun:{input:{password?:string}|void;result:import("./backups").BackupEntry|null};
  backupPickRestore:{input:void;result:{token:string;encrypted:boolean;passwordStored:boolean}|null};
  backupInspect:{input:{token:string;password?:string};result:{databases:number;rows:number;files:number;createdAt:string;legacy:boolean}};
  backupRestore:{input:{token:string;password?:string;replace:boolean;restoreCredentials:boolean};result:{databases:number;credentialsRestored:number;credentialsPreserved:number;warnings:string[]}|null};
  backupVerify:{input:{id:string;password?:string};result:{databases:number;rows:number;files:number;legacy:boolean}};
  backupArchive:{input:{id:string;archived:boolean};result:void};
  backupReveal:{input:{id?:string};result:void};
  automationList: {
    input: { databaseId: string };
    result: import("./automations").AutomationRule[];
  };
  automationHistory: {
    input: { databaseId: string };
    result: import("./automations").AutomationRun[];
  };
  automationSave: {
    input: import("./automations").AutomationRule;
    result: import("./automations").AutomationRule;
  };
  automationDelete: { input: { id: string }; result: void };
  automationRun: { input: { id: string }; result: number };
  pageDocument: {
    input: { rowId: string; columnId: string };
    result: import("./pageBlocks").PageDocument;
  };
  embeddingApiProbe: {
    input: import("./embeddingApi").EmbeddingApiChoice;
    result: { dimensions: number; multimodal: boolean; ms: number };
  };
  inferenceDiagnostics: {
    input: void;
    result: {
      backend: string;
      dimensions: number;
      contract: string;
      processId: number | null;
      serviceRss: number;
    };
  };
  modelPreparation: { input: void; result: ModelPreparation };
  prepareModels: { input: { consent: true }; result: string | null };
  openExternalLink: { input: { url: string }; result: void };
  /** Notices published between releases (see docs/announcements.md). */
  announcementsList: { input: void; result: import("./announcements").AnnouncementsState };
  announcementsMarkRead: { input: { id: string }; result: import("./announcements").AnnouncementsState };
  announcementsClear: { input: void; result: import("./announcements").AnnouncementsState };
  announcementsConfigure: { input: { enabled: boolean }; result: import("./announcements").AnnouncementsState };
  announcementsRefresh: {
    input: void;
    result: import("./announcements").AnnouncementsState & { refresh: import("./announcements").AnnouncementRefreshResult };
  };
  agreementRun: { input: AgreementInput; result: AgreementResult };
  agreementList: {
    input: { databaseId: string };
    result: AgreementExperiment[];
  };
  agreementSave: {
    input: { token: string; name: string };
    result: AgreementExperiment;
  };
  agreementLoad: { input: { id: string }; result: AgreementResult };
  agreementDelete: { input: { id: string }; result: void };
  agreementExport: {
    input: { token: string; format: "json" | "csv" };
    result: boolean;
  };
  propertyChoices: {
    input: {
      columnIds: string[];
      query?: string;
      offset?: number;
      selected?: string[];
    };
    result: {
      choices: { value: string; label: string; count: number }[];
      selections: { value: string; label: string; count: number }[];
      more: boolean;
    };
  };
  mapRecords: {
    input: MapRecordsInput;
    result: { records: MapRecord[]; total: number };
  };
  heritageMap: {
    input: Omit<MapRecordsInput, "fallbackColumnId"> & { includeParts: boolean };
    result: { elements: HeritageMapElement[]; unplaced: number; records: number };
  };
  searchPlaces: { input: { query: string }; result: GazetteerPlace[] };
  openMapAttribution: { input: void; result: void };
  status: { input: void; result: Status };
  listDatabases: { input: void; result: DatabaseSummary[] };
  createDatabase: { input: { name: string; kind?: import("./databases").DatabaseKind }; result: DatabaseDetail };
  convertToRelation: {
    input: {
      id: string;
      targetDatabaseId: string;
      matchColumnId?: string | null;
      keepCopy?: boolean;
      createMissing?: boolean;
      inverseName?: string | null;
      apply: boolean;
    };
    result: {
      total: number;
      linked: number;
      ambiguous: number;
      unmatchedRows: number;
      unmatched: { value: string; rows: number }[];
      matchColumnId: string;
      applied?: boolean;
    };
  };
  pairRelation: { input: { columnId: string; name: string }; result: import("./databases").DatabaseColumn };
  unpairRelation: { input: { columnId: string }; result: void };
  linkedRecords: {
    input: { rowId: string };
    result: {
      columnId: string;
      name: string;
      databaseName: string;
      direction: "out" | "in";
      total: number;
      rows: RecordRow[];
      /** Whether the links record page, figure and caption. */
      place: boolean;
      /** What each link records, by the other record's id. */
      details: Record<string, import("./databases").LinkDetails>;
    }[];
  };
  /** What the link between a record and one it links to records; null clears it. One step of the history. */
  setLinkDetails: {
    input: { rowId: string; columnId: string; targetId: string; details: import("./databases").LinkDetails | null };
    result: import("./databases").LinkDetails | null;
  };
  /** Whether a relation's links record page, figure and caption (both sides of a two-way relation). */
  setRelationPlace: { input: { columnId: string; place: boolean }; result: void };
  setDatabaseKind: { input: { id: string; kind: import("./databases").DatabaseKind | null }; result: void };
  /** A drawn icon and its colour («Name» or «Name:colour»), or null for the kind's icon. */
  setDatabaseIcon: { input: { id: string; icon: string | null }; result: void };
  renameDatabase: { input: { id: string; name: string }; result: void };
  /** The databases in the order the researcher dragged them in the sidebar. */
  reorderDatabases: { input: { ids: string[] }; result: void };
  deleteDatabase: { input: { id: string }; result: void };
  detail: { input: { id: string }; result: DatabaseDetail };
  addColumn: {
    input: {
      databaseId: string;
      name: string;
      type: DatabaseColumnType;
      config?: DatabaseColumnConfig;
    };
    result: DatabaseColumn;
  };
  updateColumn: {
    input: { id: string; name?: string; config?: DatabaseColumnConfig };
    result: void;
  };
  deleteColumn: { input: { id: string }; result: void };
  convertColumn: {
    input: { id: string; type: DatabaseColumnType; apply: boolean };
    /** heritage: element records and photo marks a heritage property would lose. */
    result: { total: number; lost: number; heritage?: { elements: number; marks: number } | null };
  };
  duplicateColumn: {
    input: { id: string; copy?: string };
    result: DatabaseColumn;
  };
  statisticsList: {
    input: { databaseId: string };
    result: import("./statistics").SavedStatistic[];
  };
  statisticSave: {
    input: { id?: string; databaseId: string; name: string; spec: import("./statistics").StatSpec };
    result: import("./statistics").SavedStatistic;
  };
  statisticDelete: { input: { id: string }; result: void };
  savedViewsList: { input: { databaseId: string }; result: import("./savedViews").SavedView[] };
  savedViewSave: {
    input: { id?: string; databaseId: string; name: string; view: import("./savedViews").DatabaseViewId; criteria: import("./savedViews").SavedViewCriteria };
    result: import("./savedViews").SavedView;
  };
  savedViewDelete: { input: { id: string }; result: void };
  statisticCompute: {
    input: { search: SearchInput; spec: import("./statistics").StatSpec };
    result: import("./statistics").StatResult;
  };
  timelineCandidates: {
    input: { databaseId: string };
    result: { columnId: string; name: string; type: string; dated: number; share: number; score: number }[];
  };
  detailSearch: {
    input: { assetId: string; region: { x: number; y: number; w: number; h: number }; databaseIds?: string[]; inside?: boolean };
    result: import("./detailSearch").DetailMatch[];
  };
  neighbourSuggestions: {
    input: { databaseId: string; columnId: string; limit?: number };
    result: { items: import("./suggest").NeighbourSuggestion[]; withVectors: number; known: number; missing: number };
  };
  neighbourSuggestionsApply: { input: { items: { rowId: string; columnId: string; value: string }[] }; result: number };
  restorationsList: { input: { assetId?: string }; result: import("./restoration").Restoration[] };
  restorationDelete: { input: { id: string }; result: void };
  /** Handled in the main process, which holds the keys. */
  restorationRun: {
    input: {
      assetId: string;
      region: { x: number; y: number; w: number; h: number } | null;
      provider: ApiProvider;
      model: string;
      task: import("./restoration").RestorationTask;
      prompt: string;
      /** What is known about the photograph (the researcher's note and record fields), sent after the instructions. */
      context?: string;
      /** Start from an earlier version of the same image instead of the original. */
      baseId?: string | null;
      /** Colourising: keep the light and detail of the source, take only the colour. */
      keepDetail?: boolean;
    };
    result: import("./restoration").Restoration;
  };
  restorationCancel: { input: void; result: void };
  /** The fields of the record an image belongs to, to tell the model. */
  restorationContext: { input: { assetId: string }; result: { label: string; value: string }[] };
  /** How closely a version keeps the original's light and shapes. */
  restorationCheck: { input: { id: string }; result: import("./restoration").RestorationCheck };
  /** Handled in the main process: W3C Web Annotations of a database, saved as JSON-LD. */
  annotationsExport: { input: { databaseId: string }; result: { file: string; total: number } | null };
  /** Handled in the main process: a Tropy JSON-LD export, chosen in a dialog. */
  tropyImport: { input: void; result: StandardImport | null };
  iiifImport: { input: { url: string; perCanvas: boolean }; result: StandardImport };
  /** Handled in the main process: numbered figures with captions, as PDF. */
  /** Saves a CSV the interface composed (a circulation, a table) where the researcher chooses. */
  saveCsv: { input: { fileName: string; text: string }; result: string | null };
  /** The facts of a methodology report for some databases, with the app's environment. */
  methodologyData: { input: { databaseIds: string[] }; result: import("./methodology").MethodologyData };
  /** Prints a methodology report (and saves its technical annex) where the researcher chooses. */
  methodologyPdf: { input: { html: string; fileName: string; annex: string | null }; result: { file: string; annex: string | null } | null };
  platesExport: {
    input: { rowIds: string[]; template: string; title: string; label: string; listTitle: string; start: number };
    result: { file: string; figures: number } | null;
  };
  /** Handled in the main process: candidates for a value in Wikidata or Iconclass. */
  authoritySearch: {
    input: { source: import("./authority").AuthoritySource; query: string; kind?: import("./authority").AuthorityKind | null };
    result: import("./authority").AuthorityLink[];
  };
  authorityLinks: { input: { columnId: string }; result: Record<string, import("./authority").AuthorityLink> };
  authoritySet: { input: { columnId: string; items: { optionId: string; link: import("./authority").AuthorityLink | null }[] }; result: number };
  authorityLocate: { input: { columnId: string; name: string }; result: { columnId: string; located: number } };
  heritageElements: { input: { columnId: string }; result: Record<string, import("./heritage").HeritageElement> };
  heritageSave: { input: { columnId: string; items: import("./heritage").HeritageElement[] }; result: number };
  /** Handled in the main process: Wikidata candidates for up to 20 elements. */
  heritageCandidates: {
    input: { items: { optionId: string; label: string }[] };
    result: { optionId: string; candidates: import("./heritage").HeritageCandidate[]; error?: string }[];
  };
  heritageApplyLinks: {
    input: {
      columnId: string;
      items: { optionId: string; link: import("./authority").AuthorityLink; group?: string | null; type?: string | null; parentId?: string | null }[];
    };
    result: { id: string; applied: number; createdAt: string; revertedAt: string | null };
  };
  heritageAddElement: { input: { columnId: string; label: string; link: import("./authority").AuthorityLink | null }; result: string };
  /** A vision model's suggestions for the whole image and/or zones of it. */
  heritageSuggest: {
    input: {
      assetId: string;
      columnId: string;
      whole: boolean;
      zones: { x: number; y: number; w: number; h: number }[];
      choice: import("./aiConfig").ModelChoice;
    };
    result: {
      targets: { zone: { x: number; y: number; w: number; h: number } | null; suggestions: import("./heritage").HeritageSuggestion[] }[];
      known: number;
    };
  };
  /** Which of these records already show the element. */
  heritageRowsWith: { input: { columnId: string; optionId: string; rowIds: string[] }; result: string[] };
  heritageAddToRows: {
    input: { columnId: string; optionId: string; items: { rowId: string; assetId?: string; box?: { x: number; y: number; w: number; h: number } | null }[] };
    result: number;
  };
  heritageInferTypes: { input: { columnId: string }; result: { id: string; applied: number; createdAt: string; revertedAt: string | null } };
  heritageApplyPlaces: {
    input: {
      columnId: string;
      items: { optionId: string; latitude: number; longitude: number; osm?: string | null; town?: boolean; group?: string | null; type?: string | null }[];
    };
    result: { id: string; applied: number; createdAt: string; revertedAt: string | null };
  };
  /** Starts a background search (Wikidata, OpenStreetMap or towns) for what still needs it. */
  heritageIdentifyStart: { input: { columnId: string; source: "wikidata" | "osm" | "town" }; result: string | null };
  heritageJobs: {
    input: { columnId: string };
    result: { id: string; state: string; done: number; total: number; failed: number; message: string | null; source: "wikidata" | "osm" | "town" }[];
  };
  heritageProposals: {
    input: { columnId: string; source: "wikidata" | "osm" | "town" };
    result: { id: string; optionId: string; source: "wikidata" | "osm" | "town"; candidates: any[]; chosen: number; accepted: boolean }[];
  };
  heritageProposalUpdate: { input: { id: string; chosen?: number; accepted?: boolean }; result: null };
  heritageProposalsAccept: { input: { ids: string[]; accepted: boolean }; result: null };
  heritageProposalsDismiss: { input: { ids: string[] }; result: null };
  heritageProposalsApply: {
    input: { columnId: string; source: "wikidata" | "osm" | "town" };
    result: { id: string; applied: number; createdAt: string; revertedAt: string | null } | null;
  };
  heritageLinkBatches: { input: { columnId: string }; result: { id: string; applied: number; createdAt: string; revertedAt: string | null }[] };
  heritageRevertBatch: { input: { id: string }; result: number };
  valueClusters: { input: { columnId: string }; result: import("./cleanup").ValueCluster[] };
  valueCounts: { input: { columnId: string }; result: import("./cleanup").ValueCount[] };
  valueMerge: { input: { columnId: string; groups: { members: string[]; target: string }[] }; result: number };
  /** Handled in the main process: present-day photographs near a place. */
  commonsNearby: {
    input: { latitude: number; longitude: number; radius?: number };
    result: import("./commons").CommonsPhoto[];
  };
  restorationExport: {
    input: { id: string; format: "png" | "jpeg"; watermark: import("./restoration").Watermark };
    result: string | null;
  };
  variantsStatus: { input: { databaseIds?: string[] }; result: import("./variants").VariantStatus };
  variantsPrepare: { input: { databaseIds?: string[] }; result: string | null };
  variantFamilies: {
    input: { databaseIds?: string[]; sensitivity: import("./variants").Sensitivity; search?: SearchInput };
    result: import("./variants").VariantFamily[];
  };
  /** The circulation of the families: the photographs reproduced most, when first published, how long after the taking. */
  circulationSummary: {
    input: { databaseIds?: string[]; sensitivity: import("./variants").Sensitivity; search?: SearchInput };
    result: import("./variants").CirculationSummary;
  };
  variantsOf: {
    input: { assetId: string; sensitivity?: import("./variants").Sensitivity };
    result: import("./variants").VariantFamily | null;
  };
  imageVariants: {
    input: { assetId: string; sensitivity?: import("./variants").Sensitivity };
    result: import("./variants").ImageVariants;
  };
  variantVerdict: {
    input: {
      assetId: string;
      otherAssetId: string;
      verdict: import("./variants").VariantVerdict | null;
      kind?: import("./variants").VariantKind | null;
    };
    result: boolean;
  };
  /** Where a photograph went: its taking and every use in date order. */
  imageCirculation: {
    input: { assetId: string; sensitivity?: import("./variants").Sensitivity; fields?: Record<string, import("./variants").AppearanceFields> };
    result: import("./variants").ImageCirculation;
  };
  /** «Procede de»: the image one was reproduced from; null clears it. */
  imageOrigin: { input: { assetId: string; sourceAssetId: string | null }; result: boolean };
  /** An image's visual tag regions, whether it was reviewed, and the database's «Etiquetas visuales». */
  visualTagsList: {
    input: { assetId: string };
    result: { regions: import("./visualTags").VisualTagRegion[]; reviewed: boolean; column: import("./databases").DatabaseColumn | null };
  };
  /** Saves a region with a tag (an existing one, or a new one by name). */
  visualTagSave: {
    input: { id?: string; assetId: string; x: number; y: number; w: number; h: number; optionId?: string | null; label?: string | null };
    result: import("./visualTags").VisualTagRegion;
  };
  visualTagDelete: { input: { id: string }; result: boolean };
  /** Marks an image as reviewed (also with nothing to tag) or not. */
  visualTagReview: { input: { assetId: string; reviewed: boolean }; result: boolean };
  visualTagsSummary: {
    input: { databaseId: string };
    result: import("./visualTags").VisualTagsSummary;
  };
  /** The work a record is linked to (in a works database), or null. */
  workOf: { input: { rowId: string }; result: import("./variants").WorkLink | null };
  /** Gathers an image's family into one work, created when the record has none. */
  createWorkFromFamily: {
    input: { assetId: string; sensitivity?: import("./variants").Sensitivity; databaseId?: string | null; title?: string | null };
    result: { workId: string; databaseId: string; linked: number; skipped: number; created: boolean };
  };
  imageAppearances: {
    input: {
      assetId: string;
      sensitivity?: import("./variants").Sensitivity;
      fields?: Record<string, import("./variants").AppearanceFields>;
    };
    result: import("./variants").ImageAppearance[];
  };
  appearanceSave: {
    input: {
      id?: string;
      assetId: string;
      work: string;
      author?: string | null;
      year?: number | null;
      page?: string | null;
      caption?: string | null;
      note?: string | null;
    };
    result: import("./variants").ManualAppearance;
  };
  appearanceDelete: { input: { id: string }; result: boolean };
  boardsList: { input: void; result: import("./compare").CompareBoard[] };
  boardGet: {
    input: { id: string };
    result: import("./compare").CompareBoard & { items: import("./compare").CompareItem[] };
  };
  boardSave: {
    input: { id?: string; name?: string; assetIds?: string[] };
    result: import("./compare").CompareBoard;
  };
  boardDelete: { input: { id: string }; result: void };
  compareItems: { input: { assetIds: string[] }; result: import("./compare").CompareItem[] };
  annotationsList: { input: { assetId?: string; rowId?: string }; result: ImageAnnotation[] };
  annotationSave: {
    input: {
      id?: string;
      assetId: string;
      x: number;
      y: number;
      w: number;
      h: number;
      note: string;
      tags: string[];
      color?: string | null;
      kind?: "rect" | "point";
      optionId?: string | null;
    };
    result: ImageAnnotation;
  };
  annotationDelete: { input: { id: string }; result: void };
  annotationTags: { input: { databaseId: string }; result: string[] };
  chatList: {
    input: { includeArchived?: boolean };
    result: {
      conversations: import("./chat").ChatConversationSummary[];
      folders: import("./chat").ChatFolder[];
      archivedCount: number;
    };
  };
  chatGet: { input: { id: string }; result: import("./chat").ChatConversation };
  chatCreate: {
    input: {
      title?: string;
      databaseIds: string[];
      folderId?: string | null;
      model?: import("./aiConfig").ModelChoice | null;
      mode?: import("./chat").ChatMode;
    };
    result: import("./chat").ChatConversation;
  };
  chatUpdate: {
    input: {
      ids: string[];
      title?: string;
      folderId?: string | null;
      pinned?: boolean;
      archived?: boolean;
      databaseIds?: string[];
      model?: import("./aiConfig").ModelChoice | null;
      mode?: import("./chat").ChatMode;
    };
    result: void;
  };
  chatDelete: { input: { ids: string[] }; result: void };
  chatFolderSave: {
    input: { id?: string; parentId?: string | null; name?: string; color?: string | null; icon?: string | null };
    result: import("./chat").ChatFolder;
  };
  chatFolderDelete: { input: { id: string }; result: void };
  visualMap: {
    input: { search: SearchInput; colorColumnId?: string | null };
    result: import("./visualMap").VisualMap;
  };
  network: {
    input: {
      search: SearchInput;
      columnIds: string[];
      minWeight?: number;
      maxNodes?: number;
      yearColumnId?: string | null;
      from?: number | null;
      to?: number | null;
    };
    result: import("./network").Network;
  };
  timeline: {
    input: { search: SearchInput; columnId: string };
    result: {
      items: {
        id: string;
        title: string;
        year: number;
        /** First and last year the date covers (a period spans several). */
        start: number;
        end: number;
        imageId: string | null;
        revision?: string;
        period?: string;
        certainty?: string;
      }[];
      undated: number;
      total: number;
    };
  };
  columnSummary: {
    input: {
      search: SearchInput;
      columnId: string;
      fn: import("./databases").RollupFunction;
    };
    result: { value: string; records: number };
  };
  reorderColumns: {
    input: { databaseId: string; columnIds: string[] };
    result: DatabaseDetail;
  };
  saveOptions: {
    input: {
      columnId: string;
      options: { id?: string; label: string; color: string | null }[];
      /** Removed options still in use are taken out of the records that hold
       * them instead of refusing the change (the user confirmed it). */
      dropFromCells?: boolean;
    };
    result: void;
  };
  createRow: { input: { databaseId: string }; result: RecordRow };
  createRows: {
    input: { databaseId: string; count: number };
    result: string[];
  };
  getRow: { input: { id: string }; result: RecordRow };
  setCell: {
    input: { rowId: string; columnId: string; value: string | null };
    result: void;
  };
  deleteRows: { input: { ids: string[] }; result: void };
  search: { input: SearchInput; result: Page };
  csvPreview: { input: void; result: CsvImportPlanData | null };
  csvImport: {
    input: {
      kind?: import("./databases").DatabaseKind;
      token: string;
      name: string;
      types: DatabaseColumnType[];
      headers: string[];
      nullMarkersAsEmpty?: boolean;
    };
    result: DatabaseDetail;
  };
  imagePreview: {
    input: {
      databaseId: string;
      columnId?: string;
      referenceColumnId?: string;
      source: "files" | "folder";
      pattern?: string;
      partial?: boolean;
    };
    result: ImagePlan | null;
  };
  rematchImages: {
    input: {
      token: string;
      referenceColumnId?: string;
      pattern?: string;
      partial?: boolean;
    };
    result: ImagePlan;
  };
  importImages: {
    input: {
      token: string;
      storage: "copy" | "link";
      createUnmatched: boolean;
      columnId?: string;
      assignments: { pathToken: string; rowId: string | null }[];
    };
    result: string;
  };
  queryImage: {
    input: void;
    result: { token: string; fileName: string } | null;
  };
  setPrimary: { input: { id: string }; result: void };
  deleteImage: { input: { id: string }; result: string };
  deleteImages: { input: { ids: string[] }; result: number };
  reassignImages: {
    input: { ids: string[]; rowId: string; columnId?: string };
    result: number;
  };
  reassignImage: {
    input: { id: string; rowId: string; columnId: string };
    result: void;
  };
  relinkImage: { input: { id: string }; result: boolean };
  /** A quarter turn of the image as shown; the original file is never changed. */
  rotateImage: { input: { id: string; direction: "left" | "right" }; result: { rotation: 0 | 90 | 180 | 270 } };
  /** Crop as shown (fractions), or `null` to show the whole image again. The original is never changed. */
  cropImage: {
    input: { id: string; crop: { x: number; y: number; w: number; h: number } | null };
    result: { crop: { x: number; y: number; w: number; h: number } | null };
  };
  export: {
    input: {
      databaseId: string;
      format: "csv" | "json" | "xlsx";
      rowIds?: string[];
    };
    result: boolean;
  };
  backup: { input: void; result: boolean };
  restore: { input: void; result: number | null };
  notionImport: {
    input: void;
    result: {
      databases: number;
      attachments: number;
      notices: string[];
    } | null;
  };
  nodusImport: {
    input: void;
    result: {
      databases: number;
      attachments: number;
      notices: string[];
    } | null;
  };
  probeExperimentalPython: {
    input: void;
    result: {
      torch: string;
      torchvision: string;
      transformers: string;
      sentence_transformers: string;
      pillow: string;
    };
  };
  probeRuntime: {
    input: void;
    result: {
      backend: string;
      pythonRequired: boolean;
      integratedRuntime: boolean;
      available: boolean;
    };
  };
  updateSettings: { input: Partial<Settings>; result: Settings };
  jobs: { input: void; result: Job[] };
  controlJob: {
    input: { id: string; action: "pause" | "resume" | "cancel" };
    result: void;
  };
  pauseAllJobs: { input: void; result: void };
  /** Remove finished tasks from the list; returns how many were removed. */
  clearJobs: { input: void; result: number };
  resumePausedJobs: { input: void; result: void };
  rebuildText: { input: void; result: number };
  indexImages: { input: { databaseIds?: string[] }; result: string };
  /** First indexing of images, at the image quality the researcher chose. */
  startIndexing: { input: { visionBudget: 70 | 140 | 280 }; result: string };
  downloadModel: { input: { id: string }; result: string };
  importModel: { input: { id: string }; result: boolean };
  deleteModel: { input: { id: string }; result: void };
  verifyModel: { input: { id: string }; result: boolean };
  modelLicense: {
    input: { id: string };
    result: { label: string; text: string; source: string };
  };
  analyze: {
    input: {
      rowIds?: string[];
      databaseId?: string;
      columnIds: string[];
      language: string;
      detailed: boolean;
      task?: "describe" | "transcribe";
      overwrite?: boolean;
    };
    result: string;
  };
  credentialsStatus: {
    input: void;
    result: {
      encryptionAvailable: boolean;
      providers: Record<string, boolean>;
    };
  };
  setApiKey: { input: { provider: ApiProvider; key: string }; result: void };
  clearApiKey: { input: { provider: ApiProvider }; result: void };
  listProviderModels: { input: { provider: ApiProvider }; result: import("./aiConfig").ProviderModel[] };
  /** The image models of the providers with a saved key, read from their catalogues. */
  imageModelCatalog: { input: { refresh?: boolean }; result: import("./aiConfig").ImageCatalogModel[] };
  provenance: { input: { rowId: string }; result: Provenance[] };
  proposals: { input: void; result: Proposal[] };
  reviewProposals: {
    input: { ids: string[]; action: "accept" | "reject" };
    result: { applied: number; conflicts: number };
  };
  undo: { input: { scope: HistoryScope }; result: number };
  redo: { input: { scope: HistoryScope }; result: number };
  historyState: {
    input: { scope: HistoryScope };
    result: { undo: HistoryStep | null; redo: HistoryStep | null };
  };
  mcpStatus: { input: void; result: import("./mcp").McpStatus };
  mcpConfigure: { input: Partial<import("./mcp").McpConfig>; result: import("./mcp").McpStatus };
  mcpRegenerateToken: { input: void; result: import("./mcp").McpStatus };
  mcpTunnelStatus: { input: void; result: import("./mcpTunnel").McpTunnelStatus };
  mcpTunnelConnect: { input: import("./mcpTunnel").McpTunnelConnectInput; result: import("./mcpTunnel").McpTunnelStatus };
  mcpTunnelDisconnect: { input: void; result: import("./mcpTunnel").McpTunnelStatus };
  mcpTunnelForget: { input: void; result: import("./mcpTunnel").McpTunnelStatus };
  mcpTunnelDiagnostics: { input: void; result: void };
  savedSearches: { input: void; result: SavedSearch[] };
  saveSearch: { input: { name: string; input: SearchInput }; result: void };
  removeSearch: { input: { id: string }; result: void };
};
export interface ImagoApi {
  call<K extends keyof Commands>(
    command: K,
    ...args: Commands[K]["input"] extends void ? [] : [Commands[K]["input"]]
  ): Promise<Commands[K]["result"]>;
  /** «jobs»: only the queue moved; «data»: records the views show may differ;
   * «mcp»: the local MCP server's state or activity. */
  onChange(listener: (scope: "jobs" | "data" | "announcements" | "mcp") => void): () => void;
  /** Runs one chat turn in the main process; deltas arrive through onChatDelta. */
  chatSend(request: import("./chat").ChatTurnRequest): Promise<import("./chat").ChatTurnResult>;
  chatCancel(conversationId: string): Promise<void>;
  onChatDelta(listener: (delta: import("./chat").ChatDelta) => void): () => void;
  /** Text an AI property is writing into a cell; null when it is done. */
  onCellStream(
    listener: (delta: { rowId: string; columnId: string; text: string | null }) => void,
  ): () => void;
  setAppIcon(dataUrl: string): Promise<void>;
  onDrop(
    listener: (payload: {
      plan?: ImagePlan;
      queryImage?: { token: string; fileName: string };
      error?: string;
    }) => void,
  ): () => void;
}
declare global {
  interface Window {
    imago: ImagoApi;
  }
}

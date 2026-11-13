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
};
export type MapRecordsInput = {
  databaseId: string;
  columnId: string;
  filters?: PropertyFilter[];
  filterLogic?: "and" | "or";
  filterGroups?: PropertyFilterGroup[];
  sorts?: ViewSort[];
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
export type RecordRow = DatabaseRow & {
  images: ImageAsset[];
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
  | "no_coordinates";
export type PropertyFilterGroup = {
  id: string;
  logic: "and" | "or";
  filters: PropertyFilter[];
  groups?: PropertyFilterGroup[];
};
export type ViewSort = {
  columnId: string;
  direction: "asc" | "desc";
};
export type SearchInput = {
  databaseIds?: string[];
  query?: string;
  mode?: "literal" | "semantic" | "hybrid";
  match?: "words" | "phrase" | "partial";
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
};
export type Page = { rows: RecordRow[]; total: number; indexed?: number };
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
  fieldEquivalences: EquivalenceGroup[];
};
export type Status = {
  root: string;
  databases: number;
  rows: number;
  images: number;
  indexed: number;
  platform: string;
  memoryGB: number;
  parallelCapacity: number;
  cpus: number;
  settings: Settings;
  models: ModelInfo[];
  jobs: Job[];
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
  searchPlaces: { input: { query: string }; result: GazetteerPlace[] };
  openMapAttribution: { input: void; result: void };
  status: { input: void; result: Status };
  listDatabases: { input: void; result: DatabaseSummary[] };
  createDatabase: { input: { name: string }; result: DatabaseDetail };
  renameDatabase: { input: { id: string; name: string }; result: void };
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
  saveOptions: {
    input: {
      columnId: string;
      options: { id?: string; label: string; color: string | null }[];
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
      token: string;
      name: string;
      types: DatabaseColumnType[];
      headers: string[];
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
  resumePausedJobs: { input: void; result: void };
  rebuildText: { input: void; result: number };
  indexImages: { input: { databaseIds?: string[] }; result: string };
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
  listProviderModels: { input: { provider: ApiProvider }; result: string[] };
  provenance: { input: { rowId: string }; result: Provenance[] };
  proposals: { input: void; result: Proposal[] };
  reviewProposals: {
    input: { ids: string[]; action: "accept" | "reject" };
    result: { applied: number; conflicts: number };
  };
  undo: { input: void; result: number };
  savedSearches: { input: void; result: SavedSearch[] };
  saveSearch: { input: { name: string; input: SearchInput }; result: void };
  removeSearch: { input: { id: string }; result: void };
};
export interface ImagoApi {
  call<K extends keyof Commands>(
    command: K,
    ...args: Commands[K]["input"] extends void ? [] : [Commands[K]["input"]]
  ): Promise<Commands[K]["result"]>;
  onChange(listener: () => void): () => void;
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

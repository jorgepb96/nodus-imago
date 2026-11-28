import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID as uuid } from "node:crypto";
import sharp from "sharp";
import { Repository } from "./db/repository";
import {
  Images,
  imagePipeline,
  orientedImage,
  orientedDimensions,
  hashFile,
  writeAtomicImage,
} from "./import/images";
import { Models } from "./ai/models";
import { InferenceHost } from "./ai/host";
import { Engine } from "./ai/engine";
import { JobQueue, type ChangeScope } from "./jobs";
import { buildCsvImportPlan } from "../shared/databaseCsv";
import { parseCsv } from "../shared/csvParser";
import {
  databaseToCsv,
  databaseToJson,
  databaseToMatrix,
  withLinkNoteColumns,
} from "../shared/databaseExport";
import { buildXlsx } from "./export/xlsx";
import { writeBackup, restoreBackup, verifyBackup } from "./export/backup";
import { importNodus } from "./import/nodus";
import { importNotion } from "./import/notion";
import type { CompletionRequest, EmbeddingRequest } from "./ai/apiProviders";
import { embeddingApiMultimodal } from "../shared/embeddingApi";
import { assetView, viewKey } from "../shared/imageRotation";
import { AutoIndexer } from "./autoIndex";
import { Statistics } from "./db/statistics";
import { SavedViews } from "./db/savedViews";
import { ChatStore } from "./chat/store";
import { Annotations } from "./db/annotations";
import { CompareBoards } from "./db/compare";
import { Variants } from "./db/variants";
import { Appearances } from "./db/appearances";
import { Works } from "./db/works";
import { VisualTags } from "./db/visualTags";
import { Circulation } from "./db/circulation";
import { VisualMaps } from "./db/visualMap";
import { ValueCleanup } from "./db/cleanup";
import { Authorities } from "./db/authorities";
import { Heritage, type HeritageSource } from "./db/heritage";
import { HeritageFinder, type Towns } from "./heritage/finder";
import { Gazetteer } from "./geo/gazetteer";
import { decodeMultiSelect, encodeMultiSelect } from "../shared/databases";
import { buildAiCellPrompt, buildAiRowContext } from "../shared/databaseAi";
import { foldText, heritageDictionaryOptions, heritageRegionPrompt, knownForRecord, matchSuggestion, parseHeritageRegions } from "../shared/heritage";
import { parseVisualTagSuggestions, regionOverlap, visualTagSuggestionPrompt, type VisualTagChoice } from "../shared/visualTags";
import { modelChoiceLabel } from "../shared/aiConfig";
import { Restorations } from "./db/restorations";
import { Upscaler } from "./ai/upscaler";
import { Workshop } from "./workshop/workshop";
import { exportLabel } from "../shared/workshop";
import { version as APP_VERSION } from "../package.json";
import { UPSCALE_ENV_ID, UPSCALE_MODEL_ID, UPSCALE_RUNTIME_ID } from "../shared/upscale";
import { NeighbourSuggestions } from "./db/suggest";
import { DetailSearch } from "./ai/detailSearch";
import { preparePlates } from "./export/plates";
import { collectMethodology } from "./export/methodology";
import { annotationsW3c, importIiif, importTropy } from "./import/standards";
import { buildNetwork } from "./db/network";
import { ChatData } from "./chat/data";
import type { SearchInput } from "../shared/imago";

/** Statistics and the timeline describe one database at a time. */
function singleDatabase(search: SearchInput): string {
  if (search.databaseIds?.length !== 1)
    throw new Error("Elige una sola base de datos.");
  return search.databaseIds[0];
}

/** Commands that change what records say or which images they hold. */
const CONTENT_WRITES = new Set([
  "createRow", "createRows", "setCell", "deleteRows", "csvImport", "importImages",
  "notionImport", "nodusImport", "restore", "_restoreBackup", "reviewProposals",
  "undo", "redo", "addColumn", "updateColumn", "deleteColumn", "saveOptions", "deleteImage",
  "convertColumn", "duplicateColumn", "reorderColumns",
  "deleteImages", "reassignImage", "reassignImages", "relinkImage", "rotateImage", "cropImage", "setPrimary",
  "automationRun", "renameDatabase", "rebuildText", "annotationSave", "annotationDelete", "heritageAddToRows", "neighbourSuggestionsApply", "iiifImport", "_tropyImport",
  "setLinkDetails", "setRelationPlace", "imageOrigin", "visualTagSave", "visualTagDelete", "visualTagReview", "visualTagUndo", "visualTagRedo", "visualTagDictionary", "visualTagApplySuggestions", "convertToRelation", "pairRelation", "createWorkFromFamily",
]);
import { AgreementResearch } from "./research/agreement";

import { Automations } from "./automations";
import { asLanguage, LANGUAGE_NAMES } from "../shared/language";

type HeritageAsset = { row_id: string; content_hash: string; metadata_json: string };
const heritageImageVersion = (asset: HeritageAsset, columnId: string, sourceId: unknown) => createHash("sha256")
  .update(JSON.stringify([columnId, sourceId, asset.row_id, asset.content_hash, viewKey(assetView(asset.metadata_json))])).digest("hex");

/** Settings that never affect a runtime or a running task. */
const INTERFACE_SETTINGS = new Set([
  "mode",
  "theme",
  "accent",
  "language",
  "welcomeVersion",
  "tourVersion",
  "whatsNewVersion",
]);

export class Service {
  private storageTask: Promise<unknown> | null = null;
  private backupAbort: AbortController | null = null;
  private restoring = false;
  private closing = false;
  automations: Automations;
  research: AgreementResearch;
  repo: Repository;
  statistics: Statistics;
  savedViews: SavedViews;
  chats: ChatStore;
  annotations: Annotations;
  boards: CompareBoards;
  variants: Variants;
  appearances: Appearances;
  works: Works;
  visualTags: VisualTags;
  circulation: Circulation;
  visualMaps: VisualMaps;
  cleanup: ValueCleanup;
  authorities: Authorities;
  heritage: Heritage;
  /** The bundled gazetteer (set by the worker), for background heritage searches. */
  gazetteerPath?: string;
  private gazetteer?: Gazetteer;
  heritageFinder = new HeritageFinder(() => {
    if (!this.gazetteerPath) throw new Error("Catálogo de lugares no disponible.");
    return (this.gazetteer ??= new Gazetteer(this.gazetteerPath));
  });
  /** Towns of a running heritage search, worked out once per run. */
  private heritageTowns = new WeakMap<object, Promise<Towns>>();
  restorations: Restorations;
  upscaler: Upscaler;
  workshop: Workshop;
  suggestions: NeighbourSuggestions;
  details: DetailSearch;
  chatData: ChatData;
  images: Images;
  models: Models;
  host: InferenceHost;
  engine: Engine;
  queue: JobQueue;
  autoIndex: AutoIndexer;
  csvPlans = new Map<string, ReturnType<typeof buildCsvImportPlan>>();
  queryImages = new Map<string, string>();
  private derivedImages = new Map<string, Promise<string>>();
  /** Every record a view selects: its filters and its search box. */
  private selected(search: SearchInput) {
    return this.engine.matchIds({
      ...search,
      offset: undefined,
      limit: undefined,
      sorts: undefined,
      sortColumn: undefined,
    });
  }
  constructor(
    root: string,
    script: string,
    public changed: (scope?: ChangeScope) => void,
    remote?: (
      input: CompletionRequest | EmbeddingRequest,
      signal: AbortSignal,
      onDelta?: (text: string) => void,
    ) => Promise<unknown>,
  ) {
    this.repo = new Repository(root);
    this.statistics = new Statistics(this.repo);
    this.savedViews = new SavedViews(this.repo);
    this.chats = new ChatStore(this.repo.db);
    this.annotations = new Annotations(this.repo);
    this.boards = new CompareBoards(this.repo);
    this.restorations = new Restorations(this.repo);
    this.chatData = new ChatData(this.repo);
    this.research = new AgreementResearch(this.repo);
    this.images = new Images(this.repo);
    this.models = new Models(this.repo);
    this.host = new InferenceHost(this.repo, script);
    this.engine = new Engine(
      this.repo,
      this.models,
      this.host,
      remote as
        | ((
            input: CompletionRequest,
            signal: AbortSignal,
            onDelta?: (text: string) => void,
          ) => Promise<string>)
        | undefined,
    );
    if (remote)
      this.engine.remoteEmbed = (input, signal) =>
        remote(input, signal) as Promise<number[][]>;
    this.queue = new JobQueue(
      this.repo,
      this.images,
      this.models,
      this.engine,
      changed,
    );
    this.visualMaps = new VisualMaps(this.repo, () => this.engine.contract());
    this.cleanup = new ValueCleanup(this.repo);
    this.authorities = new Authorities(this.repo);
    this.heritage = new Heritage(this.repo);
    this.variants = new Variants(this.repo, this.boards, () => {
      try {
        return this.engine.contract();
      } catch {
        return null;
      }
    });
    this.queue.fingerprint = (payload, index) => this.variants.fingerprintOne(payload, index);
    // Local AI upscaling: its own Python process, next to the inference script.
    this.upscaler = new Upscaler(this.repo, this.models, path.join(path.dirname(script), "upscale.py"));
    this.upscaler.remote = remote as ((input: unknown, signal: AbortSignal) => Promise<unknown>) | undefined;
    this.upscaler.seal = (id) => this.restorations.seal(id);
    // The image workshop renders in a thread of its own (dist-electron/workshop/renderWorker.cjs).
    this.workshop = new Workshop(this.repo, path.join(__dirname, "workshop", "renderWorker.cjs"));
    this.queue.upscaleOne = async (payload, index, signal, message) => {
      await this.upscaler.runItem(payload, index, signal, message);
      return "imported";
    };
    this.queue.upscaleEnvironment = (signal, message) => this.upscaler.prepareEnvironment(signal, message);
    this.works = new Works(this.repo, this.variants);
    this.visualTags = new VisualTags(this.repo);
    this.appearances = new Appearances(this.repo, this.variants, this.works);
    this.circulation = new Circulation(this.repo, this.variants, this.appearances, this.works);
    this.details = new DetailSearch(this.repo, this.engine);
    this.suggestions = new NeighbourSuggestions(this.repo, () => {
      try {
        return this.engine.contract();
      } catch {
        return null;
      }
    });
    this.automations = new Automations(
      this.repo,
      (rowId, columnIds) =>
        this.engine.enqueueAnalysis({
          rowIds: [rowId],
          columnIds,
          language: LANGUAGE_NAMES[asLanguage(this.repo.getSettings().language)],
          detailed: false,
        }),
      () => {
        this.autoIndex.touch();
        this.queue.pump();
        changed();
      },
    );
    this.automations.start();
    this.autoIndex = new AutoIndexer(this.repo, this.engine, this.queue);
    this.autoIndex.suspended = () => this.restoring || this.closing;
    this.autoIndex.start();
    // Background heritage searches: one element at a time, kept as proposals.
    this.queue.heritageOne = async (payload, index) => {
      const item = payload.items[index];
      const source = payload.source as HeritageSource;
      const column = this.repo.column(payload.columnId);
      if (!column.options.some((o) => o.id === item.optionId)) return "skipped";
      const towns = await (this.heritageTowns.get(payload) ??
        this.heritageTowns.set(payload, this.heritageFinder.towns(payload.items, false)).get(payload)!);
      await this.heritageFinder.ensureTown(towns, item.optionId);
      if (source === "wikidata") {
        const [found] = await this.heritageFinder.wikidata([item], this.repo.getSettings().language, towns);
        this.heritage.saveProposal(payload.columnId, item.optionId, source, null, found.candidates, found.candidates[0]?.confidence === "high");
      } else if (source === "osm") {
        const candidates = await this.heritageFinder.osm(item, towns);
        this.heritage.saveProposal(payload.columnId, item.optionId, source, null, candidates, candidates[0]?.confidence === "high");
      } else {
        const at = towns.near(item.optionId);
        if (!at) return "skipped";
        this.heritage.saveProposal(payload.columnId, item.optionId, source, null, [{ ...at, town: towns.town(item.optionId) }], true);
      }
      return "imported";
    };
    this.queue.visualTagOne = async (payload, index, signal) => {
      const assetId = payload.assetIds[index];
      let target: ReturnType<VisualTags["suggestionTarget"]>;
      try {
        target = this.visualTags.suggestionTarget(assetId, payload.dictionaryId);
      } catch {
        return "skipped"; // The image or the dictionary is gone.
      }
      const kept = this.visualTags.storedSuggestions(assetId, payload.dictionaryId);
      if (kept && modelChoiceLabel(kept.choice) === modelChoiceLabel(payload.choice)) return "skipped";
      const raw = await this.engine.askImage(
        payload.choice, assetId, null, visualTagSuggestionPrompt(target.dictionary.options),
        AbortSignal.any([signal, AbortSignal.timeout(180_000)]), "tags",
      );
      if (this.visualTags.suggestionTarget(assetId, payload.dictionaryId).imageVersion !== target.imageVersion) return "skipped";
      this.visualTags.storeSuggestions(assetId, payload.dictionaryId, target.imageVersion, payload.choice,
        parseVisualTagSuggestions(raw, target.dictionary.options));
      return "imported";
    };
    this.queue.onFinished = (kind) => {
      if (kind === "images") this.autoIndex.soon();
    };
    this.queue.pump();
  }
  private unfinishedJobs() {
    return this.repo
      .jobs()
      .some((job) => ["queued", "running", "paused"].includes(job.state));
  }
  async run(command: string, input: any = undefined): Promise<any> {
    if (this.closing && !["_close", "_cancelBackup"].includes(command))
      throw Error("Imago se está cerrando.");
    if (CONTENT_WRITES.has(command)) this.autoIndex.touch();
    if (
      this.restoring &&
      ![
        "status",
        "jobs",
        "listDatabases",
        "detail",
        "getRow",
        "_asset",
        "_settings",
        "_close",
        "_cancelBackup",
        "_writeBackup",
        "_verifyBackup",
        "_restoreBackup",
        "_endRestore",
      ].includes(command)
    )
      throw Error(
        "Espera a que termine la restauración; no se han modificado los datos.",
      );
    switch (command) {
      case "automationList":
        return this.automations.list(input.databaseId);
      case "automationHistory":
        return this.automations.history(input.databaseId);
      case "automationSave":
        return this.automations.save(input);
      case "automationDelete":
        return this.automations.delete(input.id);
      case "automationRun":
        return this.automations.run(input.id);
      case "embeddingApiProbe": {
        // One short text, sent only after the user presses the button; the
        // returned size tells the user which dimensions the model really gives.
        const settings = this.repo.getSettings(),
          started = Date.now();
        const [vector] = await this.engine.remoteEmbed(
          {
            embedding: true,
            provider: input.provider,
            model: input.model.trim(),
            dimensions: input.dimensions,
            profiles: settings.apiProfiles,
            remoteEnabled: settings.remoteEnabled,
            inputs: [
              { text: "Fotografía histórica de una plaza", role: "query" },
            ],
          },
          new AbortController().signal,
        );
        return {
          dimensions: vector.length,
          multimodal: embeddingApiMultimodal(input),
          ms: Date.now() - started,
        };
      }
      case "inferenceDiagnostics":
        return {
          backend: this.repo.getSettings().embeddingModel,
          dimensions: this.engine.dimensions(),
          contract: this.engine.contract(),
          processId:
            this.repo.getSettings().embeddingModel ===
            "harrier-oss-v1-0.6b-q8_0"
              ? this.engine.harrier.pid
              : this.engine.onnx.pid,
          serviceRss: process.memoryUsage().rss,
        };
      case "modelPreparation":
        return this.models.preparation(this.engine.contract());
      case "prepareModels": {
        const id = await this.models.enqueuePreparation(this.engine.contract());
        this.queue.pump();
        return id;
      }
      case "probeExperimentalPython":
        return this.host.request({ operation: "probe" });
      case "agreementRun":
        return this.research.run(input);
      case "agreementList":
        return this.research.list(input.databaseId);
      case "agreementSave":
        return this.research.save(input.token, input.name);
      case "agreementLoad":
        return this.research.load(input.id);
      case "agreementDelete":
        return this.research.delete(input.id);
      case "agreementExport":
        return this.research.export(input.token, input.format, input.file);
      case "status":
        return {
          root: this.repo.root,
          ...this.repo.stats(),
          indexed: (
            this.repo.db
              .prepare(
                "SELECT count(DISTINCT a.content_hash) n FROM image_assets a JOIN embeddings e ON e.content_hash=a.content_hash AND e.contract=?",
              )
              .get(this.engine.contract()) as any
          ).n,
          textIndexed: (
            this.repo.db
              .prepare(
                "SELECT count(*) n FROM record_embeddings WHERE contract=?",
              )
              .get(this.engine.textContract()) as { n: number }
          ).n,
          autoIndex: this.autoIndex.state(),
          automated: process.env.IMAGO_AUTOMATED === "1",
          semanticReady: (() => {
            try {
              this.engine.ready(this.repo.getSettings().embeddingModel);
              return true;
            } catch {
              return false;
            }
          })(),
          platform: process.platform + " " + process.arch,
          memoryGB: Math.round(os.totalmem() / 2 ** 30),
          parallelCapacity: this.queue.concurrency(),
          cpus: os.cpus().length,
          settings: this.repo.getSettings(),
          models: this.models.list(),
          jobs: this.repo.jobs(),
        };
      case "listDatabases":
        return this.repo.list();
      case "createDatabase":
        return this.repo.create(input.name, true, undefined, input.kind ?? null);
      case "convertToRelation": {
        const result = this.repo.convertToRelation(input.id, input);
        if (input.apply) this.changed();
        return result;
      }
      case "pairRelation":
        return this.repo.pairRelation(input.columnId, input.name);
      case "unpairRelation":
        return this.repo.unpairRelation(input.columnId);
      case "linkedRecords":
        return this.repo.linkedRecords(input.rowId);
      case "setLinkDetails":
        return this.repo.setLinkDetails(input.rowId, input.columnId, input.targetId, input.details);
      case "setRelationPlace":
        return this.repo.setRelationPlace(input.columnId, input.place);
      case "setDatabaseKind":
        return this.repo.setKind(input.id, input.kind);
      case "setDatabaseIcon":
        return this.repo.setIcon(input.id, input.icon);
      case "reorderDatabases":
        return this.repo.reorderDatabases(input.ids);
      case "renameDatabase":
        this.repo.detail(input.id);
        return this.repo.db
          .prepare("UPDATE db_databases SET name=? WHERE id=?")
          .run(input.name, input.id);
      case "deleteDatabase": {
        if (this.unfinishedJobs())
          throw new Error(
            "Termina o cancela las tareas antes de eliminar una base de datos.",
          );
        const removedColumns = this.repo
          .detail(input.id)
          .columns.map((column) => column.id);
        return this.repo.db.transaction(() => {
          this.repo.db
            .prepare(
              "DELETE FROM history WHERE row_id IN (SELECT id FROM db_rows WHERE database_id=?)",
            )
            .run(input.id);
          const result = this.repo.db
            .prepare("DELETE FROM db_databases WHERE id=?")
            .run(input.id);
          this.repo.pruneEquivalences(removedColumns);
          this.chats.pruneDatabase(input.id);
          for (const database of this.repo.list())
            this.repo.recompute(database.id);
          this.repo.db
            .prepare(
              "DELETE FROM embeddings WHERE content_hash NOT IN (SELECT content_hash FROM image_assets)",
            )
            .run();
          return result;
        })();
      }
      case "detail":
        return this.repo.detail(input.id);
      case "pageDocument":
        return this.repo.pageDocument(input.rowId, input.columnId);
      case "addColumn":
        return this.repo.addColumn(
          input.databaseId,
          input.name,
          input.type,
          input.config,
        );
      case "updateColumn":
        return this.repo.updateColumn(input.id, input.name, input.config);
      case "deleteColumn":
        return this.repo.deleteColumn(input.id);
      case "convertColumn":
        return this.repo.convertColumn(input.id, input.type, input.apply);
      case "duplicateColumn":
        return this.repo.duplicateColumn(input.id, input.copy);
      case "statisticsList":
        return this.statistics.list(input.databaseId);
      case "statisticSave":
        return this.statistics.save(input);
      case "statisticDelete":
        return this.statistics.delete(input.id);
      case "savedViewsList":
        return this.savedViews.list(input.databaseId);
      case "savedViewSave":
        return this.savedViews.save(input);
      case "savedViewDelete":
        return this.savedViews.delete(input.id);
      case "statisticCompute": {
        const databaseId = singleDatabase(input.search);
        return this.statistics.compute(databaseId, await this.selected(input.search), input.spec);
      }
      case "timelineCandidates":
        return this.statistics.yearCandidates(input.databaseId);
      case "timeline": {
        const databaseId = singleDatabase(input.search);
        return this.statistics.timeline(databaseId, await this.selected(input.search), input.columnId);
      }
      case "columnSummary":
        return this.repo.columnSummary(
          input.search,
          input.columnId,
          input.fn,
          input.search.mode && input.search.mode !== "literal"
            ? await this.selected(input.search)
            : undefined,
        );
      case "reorderColumns":
        return this.repo.reorderColumns(input.databaseId, input.columnIds);
      case "saveOptions":
        return this.repo.saveOptions(input.columnId, input.options, { dropFromCells: input.dropFromCells });
      case "createRow":
        return this.repo.createRow(input.databaseId);
      case "createRows":
        return this.repo.createRows(input.databaseId, input.count);
      case "getRow":
        return this.repo.getRow(input.id);
      case "setCell":
        return this.repo.setCell(input.rowId, input.columnId, input.value);
      case "deleteRows":
        return this.repo.deleteRows(input.ids);
      case "search": {
        if (input.imageToken && !this.queryImages.has(input.imageToken))
          throw new Error("Imagen de consulta caducada.");
        return this.engine.search(
          input,
          input.imageToken ? this.queryImages.get(input.imageToken) : undefined,
        );
      }
      case "mapRecords":
        return this.repo.mapRecords(input);
      case "heritageMap":
        return this.heritage.map(input);
      case "propertyChoices":
        return this.repo.propertyChoices(input);
      case "csvPreview": {
        const file = input.file,
          stat = await fs.stat(file);
        if (stat.size > 128 * 2 ** 20)
          throw new Error("El CSV supera 128 MB. Divide la importación.");
        const plan = buildCsvImportPlan(
          parseCsv(await fs.readFile(file, "utf8")),
        );
        if (!plan.headers.length) throw new Error("El CSV está vacío.");
        const token = uuid();
        if (this.csvPlans.size > 5)
          this.csvPlans.delete(this.csvPlans.keys().next().value!);
        this.csvPlans.set(token, plan);
        return {
          token,
          fileName: path.basename(file),
          headers: plan.headers,
          suggestedTypes: plan.suggestedTypes,
          suggestions: plan.suggestions,
          rowCount: plan.rows.length,
          sampleRows: plan.rows.slice(0, 5),
        };
      }
      case "csvImport": {
        const p = this.csvPlans.get(input.token);
        if (!p) throw new Error("Vista previa caducada.");
        if (input.headers.length !== p.headers.length)
          throw new Error("Número de columnas incorrecto.");
        const d = this.repo.importCsv(
          input.name,
          input.headers,
          input.types,
          p.rows,
          { nullMarkersAsEmpty: input.nullMarkersAsEmpty === true },
        );
        this.csvPlans.delete(input.token);
        // The kind only says what the database is for: no property is added.
        if (input.kind) {
          this.repo.setKind(d.database.id, input.kind);
          return this.repo.detail(d.database.id);
        }
        return d;
      }
      case "imagePreview":
        return this.images.preview(
          input.databaseId,
          input.paths,
          input.columnId,
          input.referenceColumnId,
          input.pattern,
          input.partial,
        );
      case "rematchImages":
        return this.images.rematch(
          input.token,
          input.referenceColumnId,
          input.pattern,
          input.partial,
        );
      case "importImages": {
        const id = this.images.enqueue(
          input.token,
          input.storage,
          input.createUnmatched,
          input.assignments,
          input.columnId,
        );
        this.queue.pump();
        return id;
      }
      case "queryImage": {
        const token = uuid();
        if (this.queryImages.size > 10)
          this.queryImages.delete(this.queryImages.keys().next().value!);
        await imagePipeline(input.file).then((i) => i.metadata());
        this.queryImages.set(token, input.file);
        return { token, fileName: path.basename(input.file) };
      }
      case "deleteImage":
        return this.repo.deleteImage(input.id);
      case "setPrimary": {
        const a = this.repo.asset(input.id);
        this.repo.db.transaction(() => {
          this.repo.db
            .prepare(
              "UPDATE image_assets SET position=position+1 WHERE row_id=?",
            )
            .run(a.row_id);
          this.repo.db
            .prepare("UPDATE image_assets SET position=0 WHERE id=?")
            .run(a.id);
          this.repo.touchRows([a.row_id]);
          this.repo.indexRow(a.row_id);
        })();
        return;
      }
      case "reassignImage": {
        const a = this.repo.asset(input.id),
          row = this.repo.getRow(input.rowId),
          c = this.repo.column(input.columnId);
        if (
          c.databaseId !== row.databaseId ||
          !["attachment", "files"].includes(c.type)
        )
          throw new Error("Destino de imagen incompatible.");
        this.repo.db.transaction(() => {
          this.repo.db
            .prepare(
              "UPDATE image_assets SET database_id=?,row_id=?,column_id=? WHERE id=?",
            )
            .run(row.databaseId, row.id, c.id, a.id);
          this.repo.normalizeImagePositions(a.row_id);
          this.repo.normalizeImagePositions(row.id);
          this.repo.touchRows([a.row_id, row.id]);
          this.repo.indexRow(a.row_id);
          this.repo.indexRow(row.id);
        })();
        return;
      }
      case "deleteImages":
        return this.repo.deleteImages(input.ids);
      case "reassignImages":
        return this.repo.reassignImages(input.ids, input.rowId, input.columnId);
      case "rotateImage":
        return this.repo.rotateImage(input.id, input.direction);
      case "cropImage": {
        const a = this.repo.asset(input.id);
        return this.repo.cropImage(input.id, input.crop, await orientedDimensions(a.original_path));
      }
      case "relinkImage": {
        const a = this.repo.asset(input.id);
        if ((await hashFile(input.file)) !== a.content_hash)
          throw new Error(
            "El archivo seleccionado no es el original: su hash es diferente.",
          );
        this.repo.db
          .prepare(
            "UPDATE image_assets SET original_path=?,managed=0,metadata_json=json_set(metadata_json,'$.imagoRelinkRevision',?) WHERE id=?",
          )
          .run(input.file, uuid(), input.id);
        this.repo.touchRows([a.row_id]);
        this.repo.indexRow(a.row_id);
        return true;
      }
      case "export": {
        const detail = this.repo.detail(input.databaseId);
        const rows = [];
        if (input.rowIds) {
          for (let i = 0; i < input.rowIds.length; i += 200)
            rows.push(
              ...this.repo
                .hydrate(input.rowIds.slice(i, i + 200))
                .filter((r) => r.databaseId === input.databaseId),
            );
        } else {
          let offset = 0;
          while (true) {
            const p = this.repo.literal({
              databaseIds: [input.databaseId],
              limit: 200,
              offset,
            });
            rows.push(...p.rows);
            offset += p.rows.length;
            if (offset >= p.total || !p.rows.length) break;
          }
        }
        const format = input.format;
        // Linked values carry their URIs and Getty identifiers in a column of their own.
        const authorities = this.authorities.exportColumns(detail.columns, rows);
        // JSON carries every link's details; tables get a column for captions and notes.
        const exported = format === "json" ? authorities : withLinkNoteColumns(authorities.columns, authorities.rows);
        const data =
          format === "csv"
            ? databaseToCsv(exported.columns, exported.rows)
            : format === "json"
              ? databaseToJson(exported.columns, exported.rows)
              : (() => {
                  const m = databaseToMatrix(exported.columns, exported.rows);
                  return buildXlsx(m.header, m.body);
                })();
        await fs.writeFile(input.file, data);
        return true;
      }
      case "_cancelBackup":
        this.backupAbort?.abort();
        return;
      case "_beginRestore":
        if (this.storageTask)
          throw Error("Ya hay una operación de copias en curso.");
        this.restoring = true;
        this.automations.close();
        this.queue.pauseAll();
        await this.queue.task;
        return;
      case "_endRestore":
        this.restoring = false;
        if (!this.closing && !this.automations.timer) this.automations.start();
        return;
      case "_verifyBackup": {
        if (this.storageTask)
          throw Error("Ya hay una operación de copias en curso.");
        const task = verifyBackup(this.repo, input.file);
        this.storageTask = task;
        try {
          return await task;
        } finally {
          this.storageTask = null;
        }
      }
      case "backup":
      case "_writeBackup": {
        if (this.storageTask)
          throw Error("Ya hay una operación de copias en curso.");
        this.backupAbort = new AbortController();
        const task = writeBackup(this.repo, input.file, {
          application: input.application,
          signal: this.backupAbort.signal,
        });
        this.storageTask = task;
        try {
          await task;
          return true;
        } finally {
          this.storageTask = null;
          this.backupAbort = null;
        }
      }
      case "_restoreBackup": {
        if (this.storageTask)
          throw Error("Ya hay una operación de copias en curso.");
        const ownLock = !this.restoring;
        this.restoring = true;
        this.automations.close();
        this.queue.pauseAll();
        const task = (async () => {
          await this.queue.task;
          return restoreBackup(this.repo, input.file, {
            replace: input.replace,
          });
        })();
        this.storageTask = task;
        try {
          const restored = await task;
          this.visualTags.clearUndo();
          return restored;
        } finally {
          this.storageTask = null;
          if (ownLock) {
            this.restoring = false;
            if (!this.closing) this.automations.start();
          }
        }
      }
      case "restore":
        if (this.repo.stats().databases || this.unfinishedJobs())
          throw Error(
            "Restaura en una instalación vacía y sin trabajos activos para preservar todos los identificadores. Exporta primero tus datos actuales.",
          );
        return this.run("_restoreBackup", { file: input.file, replace: false });
      case "notionImport":
        return importNotion(this.repo, this.images, input.file);
      case "nodusImport":
        return importNodus(this.repo, input.file);
      case "probeRuntime":
        return this.engine.probe();
      case "updateSettings": {
        // Appearance and what the interface has already shown (introduction,
        // tour, What's New) never touch a runtime, so they are saved even while
        // tasks run: the introduction often ends as indexing starts.
        if (Object.keys(input).every((key) => INTERFACE_SETTINGS.has(key)))
          return this.repo.updateSettings(input);
        if (
          this.repo
            .jobs()
            .some((job) => ["queued", "running"].includes(job.state))
        ) {
          if (input.remoteEnabled === false && Object.keys(input).length === 1)
            this.queue.pauseAll();
          else
            throw new Error(
              "Pausa o cancela las tareas antes de cambiar la configuración.",
            );
        }
        // Pausing must actually allow reconfiguration. Wait for cancelled
        // in-flight requests to settle before replacing their runtime settings.
        await this.queue.task;
        this.host.close();
        await this.engine.resetRuntimes();
        return this.repo.updateSettings(input);
      }
      case "jobs":
        return this.repo.jobs();
      case "controlJob":
        return this.queue.control(input.id, input.action);
      case "clearJobs":
        return this.repo.clearJobs();
      case "pauseAllJobs":
        this.queue.pauseAll();
        return;
      case "resumePausedJobs":
        this.queue.resumeAll();
        return;
      case "rebuildText":
        return this.repo.rebuildText();
      case "startIndexing": {
        // The first indexing of images, with the quality the researcher chose.
        // The quality is part of the vectors' contract: refuse while a pass
        // that would be invalidated is running.
        if (
          this.repo
            .jobs()
            .some((job) => job.kind === "index" && ["queued", "running"].includes(job.state))
        )
          throw new Error("Espera a que termine la indexación en curso.");
        this.repo.updateSettings({ visionBudget: input.visionBudget, indexQualityChosen: true });
        const id = this.engine.enqueueIndex();
        this.queue.pump();
        return id;
      }
      case "indexImages": {
        const id = this.engine.enqueueIndex(input.databaseIds);
        this.queue.pump();
        return id;
      }
      case "downloadModel": {
        const m = this.models.get(input.id);
        const existing = this.repo.db
          .prepare(
            "SELECT id FROM jobs WHERE kind='download' AND json_extract(payload_json,'$.id')=? AND state IN ('queued','running','paused')",
          )
          .get(m.id) as any;
        if (existing) {
          this.repo.db
            .prepare(
              "UPDATE jobs SET state='queued',updated_at=? WHERE id=? AND state='paused'",
            )
            .run(new Date().toISOString(), existing.id);
          this.queue.pump();
          return existing.id;
        }
        const id = this.repo.newJob("download", { id: m.id }, m.files.length);
        this.queue.pump();
        return id;
      }
      case "importModel":
        if (this.unfinishedJobs())
          throw new Error(
            "Pausa o cancela las tareas antes de importar un modelo.",
          );
        await this.engine.resetRuntimes();
        return this.models.importDirectory(input.id, input.directory);
      case "verifyModel":
        if (this.unfinishedJobs())
          throw new Error(
            "Pausa o cancela las tareas antes de verificar un modelo.",
          );
        this.host.close();
        await this.engine.resetRuntimes();
        return this.models.verify(input.id);
      case "deleteModel":
        if ([UPSCALE_MODEL_ID, UPSCALE_RUNTIME_ID, UPSCALE_ENV_ID].includes(input.id)) return this.run("upscaleUninstall");
        if (this.unfinishedJobs())
          throw new Error(
            "Pausa o cancela las tareas antes de eliminar un modelo.",
          );
        this.host.close();
        await this.engine.resetRuntimes();
        await fs.rm(this.models.directory(input.id), {
          recursive: true,
          force: true,
        });
        {
          const model = this.models.get(input.id),
            parent = path.join(this.repo.root, "models", model.id),
            prefix = model.revision + ".previous-";
          for (const name of await fs.readdir(parent).catch(() => []))
            if (
              name.startsWith(prefix) &&
              /^[a-f0-9-]{36}$/.test(name.slice(prefix.length))
            )
              await fs.rm(path.join(parent, name), {
                recursive: true,
                force: true,
              });
        }
        return;
      case "analyze": {
        const id = this.engine.enqueueAnalysis(input);
        this.queue.pump();
        return id;
      }
      case "provenance":
        return this.repo.provenance(input.rowId);
      case "proposals":
        return this.repo.proposals();
      case "reviewProposals":
        return this.repo.reviewProposals(input.ids, input.action);
      case "undo":
        return this.repo.undo(input.scope);
      case "redo":
        return this.repo.redo(input.scope);
      case "historyState":
        return this.repo.historyState(input.scope);
      case "savedSearches":
        return this.repo.db
          .prepare(
            "SELECT id,name,input_json FROM saved_searches ORDER BY name",
          )
          .all()
          .map((s: any) => ({
            id: s.id,
            name: s.name,
            input: JSON.parse(s.input_json),
          }));
      case "saveSearch":
        this.repo.db
          .prepare("INSERT INTO saved_searches VALUES(?,?,?)")
          .run(uuid(), input.name, JSON.stringify(input.input));
        return;
      case "removeSearch":
        this.repo.db
          .prepare("DELETE FROM saved_searches WHERE id=?")
          .run(input.id);
        return;
      case "_asset": {
        const a = this.repo.asset(input.id),
          framed = assetView(a.metadata_json),
          // «full»: the turned image without its crop, to edit the crop.
          view = input.variant === "full" ? { ...framed, crop: null } : framed,
          key = viewKey(view),
          suffix = input.variant === "thumb" ? ".webp" : "-preview.webp",
          // A turned or cropped image has derived files of its own: other
          // records may hold the same original as it is.
          target = path.join(
            this.repo.root,
            "thumbnails",
            a.content_hash + (key ? `-${key}` : "") + suffix,
          );
        try {
          await fs.access(a.original_path);
        } catch {
          throw new Error("Original ausente. Vuelve a vincularlo en la ficha.");
        }
        let preparation = this.derivedImages.get(target);
        if (!preparation) {
          preparation = (async () => {
            try {
              await fs.access(target);
            } catch {
              const image = await orientedImage(a.original_path, view);
              await writeAtomicImage(
                image
                  .resize(
                    input.variant === "thumb" ? 480 : 2200,
                    input.variant === "thumb" ? 480 : 2200,
                    { fit: "inside", withoutEnlargement: true },
                  )
                  .webp(),
                target,
              );
            }
            return target;
          })();
          this.derivedImages.set(target, preparation);
          void preparation
            .finally(() => {
              if (this.derivedImages.get(target) === preparation)
                this.derivedImages.delete(target);
            })
            .catch(() => {});
        }
        return preparation;
      }
      case "_mcpImage": {
        // An image for a model connected through MCP: as Imago shows it
        // (turned and cropped), as a JPEG every client can read.
        const size = Math.min(2200, Math.max(256, Math.round(input.maxSize ?? 1568)));
        const file: string = await this.run("_asset", { id: input.id, variant: size <= 480 ? "thumb" : "preview" });
        const { data, info } = await sharp(file)
          .resize(size, size, { fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 85 })
          .toBuffer({ resolveWithObject: true });
        return { data: data.toString("base64"), mimeType: "image/jpeg", width: info.width, height: info.height };
      }
      case "_mcpSetCells": {
        // Every cell a tool call writes, at once and as one Undo step: if one
        // is refused, none is written.
        const batch = uuid();
        this.repo.db.transaction(() => {
          for (const cell of input.cells as { rowId: string; columnId: string; value: string | null }[])
            this.repo.setCell(cell.rowId, cell.columnId, cell.value, true, batch);
        })();
        this.autoIndex.touch();
        return input.cells.length;
      }
      case "_mcpImageOwner":
        return (
          (this.repo.db.prepare("SELECT row_id FROM image_assets WHERE id=?").get(input.id) as { row_id: string } | undefined)
            ?.row_id ?? null
        );
      case "valueClusters":
        return this.cleanup.clusters(input.columnId);
      case "valueCounts":
        return this.cleanup.counts(input.columnId);
      case "valueMerge": {
        const changed = this.cleanup.merge(input.columnId, input.groups);
        this.changed();
        return changed;
      }
      case "authorityLinks":
        return this.authorities.links(input.columnId);
      case "authoritySet":
        return this.authorities.set(input.columnId, input.items);
      case "heritageElements":
        return this.heritage.elements(input.columnId);
      case "heritageSave": {
        const saved = this.heritage.save(input.columnId, input.items);
        this.changed();
        return saved;
      }
      case "heritageApplyLinks": {
        const batch = this.heritage.applyLinks(input.columnId, input.items);
        this.changed();
        return batch;
      }
      case "heritageAddElement": {
        const created = this.heritage.addElement(input.columnId, input.label, input.link);
        this.changed();
        return created;
      }
      case "heritageSelectDictionary": {
        const column = this.heritage.selectDictionary(input.databaseId, input.sourceId);
        this.changed();
        return column;
      }
      case "heritageSuggest": {
        const column = this.heritage.heritageColumn(input.columnId);
        const asset = this.repo.asset(input.assetId) as HeritageAsset;
        const row = this.repo.getRow(asset.row_id);
        if (row.databaseId !== column.databaseId) throw new Error("Elige una propiedad de patrimonio de esta base de datos.");
        if (input.choice.provider === "local" && this.models.get(input.choice.model).task !== "vision")
          throw new Error("Elige un modelo que admita imágenes.");
        const columns = this.repo.detail(row.databaseId).columns;
        const language = this.repo.getSettings().language;
        const context = buildAiRowContext(columns, row, { excludeColumnId: column.id, language }).slice(0, 4000);
        const options = heritageDictionaryOptions(column, columns);
        const assigned = new Set(decodeMultiSelect(row.cells[column.id] ?? null));
        const nearby = new Set(knownForRecord(options, `${row.title} ${context}`));
        const priority = (option: typeof options[number]) => assigned.has(option.id) ? 0 : nearby.has(option.label) ? 1 : 2;
        const dictionary = [...options].sort((a, b) => priority(a) - priority(b))
          .slice(0, input.choice.provider === "local" ? 120 : undefined);
        const allowNew = input.allowNew === true;
        const targets: ({ x: number; y: number; w: number; h: number } | null)[] = [...(input.whole ? [null] : []), ...input.zones];
        if (!targets.length) throw new Error("Elige la imagen completa o al menos una zona.");
        const imageVersion = heritageImageVersion(asset, column.id, column.config.heritageSource);
        const results = [];
        for (const zone of targets) {
          const prompt = buildAiCellPrompt(heritageRegionPrompt(dictionary, allowNew, !!zone, language), context, language);
          const signal = AbortSignal.timeout(input.choice.provider === "local" ? 180_000 : 300_000);
          const raw = await this.engine.askImage(input.choice, input.assetId, zone, prompt, signal, "heritage");
          const suggestions = parseHeritageRegions(raw, dictionary, allowNew).map((item) => {
            const box = item.box;
            const shown = zone && box ? { x: zone.x + box.x * zone.w, y: zone.y + box.y * zone.h, w: box.w * zone.w, h: box.h * zone.h } : box ?? zone;
            const optionId = item.optionId ?? matchSuggestion(item, options);
            return {
              ...item,
              name: options.find((option) => option.id === optionId)?.label ?? item.name,
              place: optionId ? null : item.place,
              optionId,
              box: shown && shown.w >= 0.005 && shown.h >= 0.005 ? shown : null,
            };
          });
          results.push({ zone, suggestions });
        }
        if (heritageImageVersion(this.repo.asset(input.assetId) as HeritageAsset, column.id,
          this.heritage.heritageColumn(column.id).config.heritageSource) !== imageVersion)
          throw new Error("La imagen o el diccionario han cambiado. Vuelve a generar las sugerencias.");
        return { targets: results, known: dictionary.length, imageVersion };
      }
      case "heritageApplySuggestions": {
        const db = this.repo.db;
        const count = db.transaction(() => {
          const column = this.heritage.heritageColumn(input.columnId);
          const asset = this.repo.asset(input.assetId) as HeritageAsset;
          const row = this.repo.getRow(asset.row_id);
          if (row.databaseId !== column.databaseId || heritageImageVersion(asset, column.id, column.config.heritageSource) !== input.imageVersion)
            throw new Error("La imagen o el diccionario han cambiado. Vuelve a generar las sugerencias.");
          const dictionary = heritageDictionaryOptions(column, this.repo.detail(row.databaseId).columns);
          const own = new Set(column.options.map((item) => item.id));
          const saved = new Set(decodeMultiSelect(row.cells[column.id] ?? null));
          const marks = this.annotations.list({ assetId: input.assetId });
          let count = 0;
          for (const item of input.items) {
            const entry = item.optionId && dictionary.find((option) => option.id === item.optionId);
            if (item.optionId ? !entry : !input.allowNew)
              throw new Error("La imagen o el diccionario han cambiado. Vuelve a generar las sugerencias.");
            const label = entry ? entry.label : item.place ? `${item.name} - ${item.place}` : item.name;
            const existing = column.options.find((option) => foldText(option.label) === foldText(label))?.id;
            const optionId = entry && own.has(entry.id) ? entry.id : existing ?? this.heritage.addElement(column.id, label, entry ? null : item.link);
            const box = item.box;
            if (box && !marks.some((mark) => mark.optionId === optionId && mark.kind !== "point" && regionOverlap(mark, box) >= 0.8)) {
              marks.push(this.annotations.save({ assetId: input.assetId, ...box, note: "", tags: [], optionId }));
              count++;
            } else if (!saved.has(optionId)) count++;
            saved.add(optionId);
          }
          const current = decodeMultiSelect(this.repo.getRow(row.id).cells[column.id] ?? null);
          if (current.length !== saved.size) this.repo.setCell(row.id, column.id, encodeMultiSelect([...saved]));
          return count;
        })();
        this.changed();
        return count;
      }
      case "heritageRowsWith": {
        const column = this.heritage.heritageColumn(input.columnId);
        const cell = this.repo.db.prepare("SELECT value_text v FROM db_cells WHERE row_id=? AND column_id=?");
        return input.rowIds.filter((rowId: string) =>
          decodeMultiSelect((cell.get(rowId, column.id) as { v: string | null } | undefined)?.v ?? null).includes(input.optionId),
        );
      }
      case "heritageAddToRows": {
        // One element added to many records (and, where a zone is given, marked
        // there), as one «Deshacer» batch for the cells.
        const column = this.heritage.heritageColumn(input.columnId);
        if (!column.options.some((o) => o.id === input.optionId)) throw new Error("Identificador de opción ajeno a la propiedad.");
        const db = this.repo.db;
        let added = 0;
        db.transaction(() => {
          const before = (db.prepare("SELECT coalesce(max(id),0) id FROM history").get() as { id: number }).id;
          for (const item of input.items) {
            if (item.assetId && item.box)
              this.annotations.save({ assetId: item.assetId, ...item.box, note: "", tags: [], optionId: input.optionId });
            const ids = decodeMultiSelect(this.repo.getRow(item.rowId).cells[column.id] ?? null);
            if (!ids.includes(input.optionId)) this.repo.setCell(item.rowId, column.id, encodeMultiSelect([...ids, input.optionId]));
            added++;
          }
          db.prepare("UPDATE history SET batch_id=? WHERE id>?").run(uuid(), before);
        })();
        this.changed();
        return added;
      }
      case "heritageInferTypes": {
        const batch = this.heritage.inferTypes(input.columnId);
        this.changed();
        return batch;
      }
      case "heritageApplyPlaces": {
        const batch = this.heritage.applyPlaces(input.columnId, input.items);
        this.changed();
        return batch;
      }
      case "heritageIdentifyStart": {
        // A background search, paused automatically if Imago closes or a
        // service cannot be reached; it resumes where it stopped.
        const column = this.heritage.heritageColumn(input.columnId);
        const items = this.heritage.pendingItems(input.columnId, input.source);
        if (!items.length) return null;
        const names = { wikidata: "Identificar en Wikidata", osm: "Situar con OpenStreetMap", town: "Situar en su localidad" } as const;
        const id = this.repo.newJob("heritage", { columnId: input.columnId, source: input.source, items, label: `${names[input.source as HeritageSource]} · ${column.name}` }, items.length);
        this.queue.pump();
        this.changed();
        return id;
      }
      case "heritageJobs":
        return (
          this.repo.db
            .prepare(
              "SELECT id,state,done,total,failed,message,json_extract(payload_json,'$.source') source FROM jobs WHERE kind='heritage' AND json_extract(payload_json,'$.columnId')=? AND state IN ('queued','running','paused','failed') ORDER BY created_at DESC",
            )
            .all(input.columnId) as unknown[]
        );
      case "heritageProposals":
        return this.heritage.proposals(input.columnId, input.source);
      case "heritageProposalUpdate":
        this.heritage.updateProposal(input.id, input);
        return null;
      case "heritageProposalsAccept":
        this.heritage.acceptProposals(input.ids, input.accepted);
        return null;
      case "heritageProposalsDismiss":
        this.heritage.dismissProposals(input.ids);
        return null;
      case "heritageProposalsApply": {
        const batch = this.heritage.applyProposals(input.columnId, input.source);
        this.changed();
        return batch;
      }
      case "heritageLinkBatches":
        return this.heritage.batches(input.columnId);
      case "heritageRevertBatch": {
        const reverted = this.heritage.revertBatch(input.id);
        this.changed();
        return reverted;
      }
      case "authorityLocate": {
        const result = this.authorities.locate(input.columnId, input.name);
        this.changed();
        return result;
      }
      case "visualMap": {
        const databaseId = singleDatabase(input.search);
        return this.visualMaps.map(databaseId, await this.selected(input.search), input.colorColumnId);
      }
      case "network": {
        const databaseId = singleDatabase(input.search);
        return buildNetwork(this.repo, databaseId, await this.selected(input.search), input);
      }
      case "_annotationsW3c":
        return annotationsW3c(this.repo, input.databaseId);
      case "_tropyImport":
        return importTropy(this.repo, this.images, input.file);
      case "iiifImport":
        return importIiif(this.repo, this.images, input);
      case "_methodologyData": {
        const { databaseIds } = input as { databaseIds: string[] };
        // The circulation needs the variant families; a collection without fingerprints has none.
        const circulation = await this.variants
          .families({ databaseIds, sensitivity: "balanced" })
          .then((families) => this.circulation.summary(families))
          .catch(() => null);
        return collectMethodology({ repo: this.repo, contract: this.engine.contract(), dimensions: this.engine.dimensions(), circulation }, { databaseIds });
      }
      case "_platesPrepare":
        return preparePlates(this.repo, input);
      case "detailSearch":
        return this.details.search(input);
      case "neighbourSuggestions":
        return this.suggestions.suggest(input);
      case "neighbourSuggestionsApply":
        return this.suggestions.apply(input.items);
      case "restorationsList":
        return this.restorations.list(input ?? {});
      case "upscaleStatus":
        return this.upscaler.status(!!input?.refresh);
      case "upscaleInstall": {
        const id = await this.upscaler.install();
        this.queue.pump();
        return id;
      }
      case "upscaleUninstall":
        if (this.repo.jobs().some((job) => ["upscale", "prepare"].includes(job.kind) && ["queued", "running"].includes(job.state)))
          throw new Error("Pausa o cancela los escalados y la instalación antes de eliminar el modelo.");
        for (const job of this.repo.jobs())
          if (job.kind === "prepare" && job.state === "paused") this.queue.control(job.id, "cancel", false);
        await this.upscaler.uninstall();
        return;
      case "upscaleProbe":
        await this.upscaler.probe();
        return this.upscaler.status(true);
      case "upscaleEnqueue": {
        const api = input.engine?.kind === "api";
        if (api && !this.repo.getSettings().remoteEnabled) throw new Error("Las APIs remotas están desactivadas en Ajustes.");
        if (!api && !(await this.upscaler.status()).ready) throw new Error("Instala el escalado local en Ajustes › Modelos locales.");
        const settings = this.repo.getSettings();
        this.repo.updateSettings({
          upscale: { ...settings.upscale, scale: input.scale, creativity: input.creativity, fit: input.fit, maxOutputSide: input.maxOutputSide },
        });
        const label = input.items.length === 1 ? `Escalar ×${input.scale}` : `Escalar ${input.items.length} imágenes ×${input.scale}`;
        const id = this.repo.newJob("upscale", { label, ...input }, input.items.length);
        this.queue.pump();
        return id;
      }
      case "upscaleActive": {
        const job = this.repo.db
          .prepare("SELECT id,payload_json FROM jobs WHERE kind='upscale' AND state IN ('queued','running','paused') ORDER BY created_at DESC LIMIT 1")
          .get() as { id: string; payload_json: string } | undefined;
        if (!job) return null;
        const payload = JSON.parse(job.payload_json);
        return { id: job.id, items: payload.items, scale: payload.scale, creativity: payload.creativity };
      }
      case "upscalesList":
        return this.restorations.list({ assetId: input?.assetId, kind: "upscale" });
      case "restorationDelete":
        return this.restorations.delete(input.id);
      case "_restorationInput":
        return this.restorations.input(input.assetId, input.region, input.baseId);
      case "restorationContext":
        return this.restorations.context(input.assetId);
      case "restorationCheck":
        return this.restorations.check(input.id);
      case "_restorationDiff":
        return this.restorations.diff(input.id);
      case "_restorationStore":
        return this.restorations.store(input);
      case "_restorationFile":
        return this.restorations.file(input.id);
      case "_restorationExport": {
        // What the version is and how it was made, for the XMP and the JSON history.
        const assetId = (this.repo.db.prepare("SELECT asset_id FROM restorations WHERE id=?").get(input.id) as { asset_id: string } | undefined)?.asset_id;
        const version = assetId ? this.workshop.versions(assetId).find((v) => v.id === input.id) : undefined;
        const asset = assetId ? (this.repo.asset(assetId) as { file_name: string; content_hash: string }) : null;
        return this.restorations.export({
          ...input,
          meta: version && asset
            ? { label: exportLabel(version.ops), ops: version.ops, original: `${asset.file_name} (SHA-256 ${asset.content_hash})`, app: `Nodus Imago ${APP_VERSION}`, sha256: version.sha256, createdAt: version.createdAt }
            : undefined,
        });
      }
      case "workshopPreview":
        return this.workshop.preview(input);
      case "_workshopFile":
        return this.workshop.file(input.name);
      case "workshopAnalyze":
        return this.workshop.analyze(input.assetId, input.versionId ?? null);
      case "workshopSave":
        return this.workshop.save(input);
      case "workshopVersions":
        return this.workshop.versions(input.assetId);
      case "workshopIntegrity":
        return this.workshop.integrity(input.assetId);
      case "variantsStatus":
        return this.variants.status(input.databaseIds);
      case "variantsPrepare": {
        const id = this.variants.prepare(input.databaseIds);
        this.queue.pump();
        this.changed();
        return id;
      }
      case "variantFamilies":
        return this.variants.families({
          databaseIds: input.databaseIds,
          sensitivity: input.sensitivity,
          rowIds: input.search ? await this.selected(input.search) : undefined,
        });
      case "circulationSummary":
        return this.circulation.summary(
          await this.variants.families({
            databaseIds: input.databaseIds,
            sensitivity: input.sensitivity,
            rowIds: input.search ? await this.selected(input.search) : undefined,
          }),
        );
      case "variantsOf":
        return this.variants.of(input.assetId, input.sensitivity);
      case "imageVariants":
        return this.variants.ofImage(input.assetId, input.sensitivity);
      case "variantVerdict":
        this.variants.setVerdict(input.assetId, input.otherAssetId, input.verdict, input.kind ?? null);
        this.changed();
        return true;
      case "imageCirculation":
        return this.circulation.of(input.assetId, input.sensitivity, input.fields);
      case "imageOrigin":
        this.variants.setOrigin(input.assetId, input.sourceAssetId);
        this.changed();
        return true;
      case "visualTagsList":
        return this.visualTags.selection(input.assetId);
      case "visualTagSave": {
        const saved = this.visualTags.save(input);
        // A new label or a dictionary term may have created a column or option.
        const suppliedIds = input.tags?.flatMap((tag: VisualTagChoice) => "optionId" in tag ? [tag.optionId] : []) ?? (input.optionId ? [input.optionId] : []);
        const column = (input.tags || input.optionId || input.label) && saved.optionIds.some((id) => !suppliedIds.includes(id))
          ? this.visualTags.column((this.repo.asset(input.assetId) as { database_id: string }).database_id)
          : undefined;
        this.changed();
        return { ...saved, column };
      }
      case "visualTagDelete":
        this.visualTags.delete(input.id);
        this.changed();
        return true;
      case "visualTagReview":
        this.visualTags.setReviewed(input.assetId, input.reviewed, input.dictionaryId);
        this.changed();
        return true;
      case "visualTagPending":
        return this.visualTags.pendingImages(input.databaseId, input.dictionaryId, input.rowIds);
      case "visualTagUndo": {
        const action = this.visualTags.undo(input.assetId, input.dictionaryId);
        if (action) this.changed();
        return action;
      }
      case "visualTagRedo": {
        const action = this.visualTags.redo(input.assetId, input.dictionaryId);
        if (action) this.changed();
        return action;
      }
      case "visualTagDictionary":
        this.visualTags.setDictionary(input.databaseId, input.columnId);
        this.changed();
        return true;
      case "visualTagsSummary":
        return this.visualTags.summary(input.databaseId);
      case "visualTagModels": {
        const models = this.models.list();
        const runtimeReady = models.some((model) => model.id === "llama-runtime" && model.verified);
        return models.filter((model) => model.task === "vision" && model.available !== false && model.verified &&
          (this.models.get(model.id).backend !== "llama" || runtimeReady))
          .map((model) => ({ choice: { provider: "local", model: model.id }, name: model.label, remote: false }));
      }
      case "visualTagSuggest": {
        const { dictionary, imageVersion } = this.visualTags.suggestionTarget(input.assetId, input.dictionaryId);
        if (input.choice.provider === "local" && this.models.get(input.choice.model).task !== "vision")
          throw new Error("Elige un modelo que admita imágenes.");
        const raw = await this.engine.askImage(
          input.choice, input.assetId, null, visualTagSuggestionPrompt(dictionary.options),
          AbortSignal.timeout(input.choice.provider === "local" ? 180_000 : 300_000), "tags",
        );
        if (this.visualTags.suggestionTarget(input.assetId, input.dictionaryId).imageVersion !== imageVersion)
          throw new Error("La imagen o el diccionario han cambiado. Vuelve a generar las sugerencias.");
        const regions = parseVisualTagSuggestions(raw, dictionary.options);
        this.visualTags.storeSuggestions(input.assetId, input.dictionaryId, imageVersion, input.choice, regions);
        return { imageVersion, regions };
      }
      case "visualTagStoredSuggestions":
        return this.visualTags.storedSuggestions(input.assetId, input.dictionaryId);
      case "visualTagQueue": {
        // The next images analysed in the background; their suggestions wait
        // for review in the viewer.
        if (input.choice.provider === "local" && this.models.get(input.choice.model).task !== "vision")
          throw new Error("Elige un modelo que admita imágenes.");
        this.visualTags.suggestionTarget(input.assetIds[0], input.dictionaryId);
        const id = this.repo.newJob("visualTags", { dictionaryId: input.dictionaryId, choice: input.choice, assetIds: input.assetIds }, input.assetIds.length);
        this.queue.pump();
        this.changed("jobs");
        return id;
      }
      case "visualTagApplySuggestions": {
        const added = this.visualTags.applySuggestions(input);
        if (added) this.changed();
        return added;
      }
      case "workOf":
        return this.works.workOf(input.rowId);
      case "createWorkFromFamily": {
        const result = await this.works.fromFamily(input);
        this.changed();
        return result;
      }
      case "imageAppearances":
        return this.appearances.list(input.assetId, input.sensitivity, input.fields);
      case "appearanceSave": {
        const saved = this.appearances.save(input);
        this.changed();
        return saved;
      }
      case "appearanceDelete":
        this.appearances.delete(input.id);
        this.changed();
        return true;
      case "boardsList":
        return this.boards.list();
      case "boardGet":
        return this.boards.get(input.id);
      case "boardSave":
        return this.boards.save(input);
      case "boardDelete":
        return this.boards.delete(input.id);
      case "compareItems":
        return this.boards.items(input.assetIds);
      case "annotationsList":
        return this.annotations.list(input);
      case "annotationSave":
        return this.annotations.save(input);
      case "annotationDelete":
        return this.annotations.delete(input.id);
      case "annotationTags":
        return this.annotations.tags(input.databaseId);
      case "chatList":
        return {
          conversations: this.chats.list(!!input?.includeArchived),
          folders: this.chats.folders(),
          archivedCount: this.chats.archivedCount(),
        };
      case "chatGet":
        return this.chats.get(input.id);
      case "chatCreate":
        return this.chats.create(input);
      case "chatUpdate":
        return this.chats.update(input);
      case "chatDelete":
        return this.chats.delete(input.ids);
      case "chatFolderSave":
        return this.chats.saveFolder(input);
      case "chatFolderDelete":
        return this.chats.deleteFolder(input.id);
      case "_chatSaveMessages":
        return this.chats.saveMessages(input.id, input.messages, input.title);
      case "_chatContext":
        return this.chatData.context(input.databaseIds, input.mode, input.language);
      case "_chatDataset":
        return this.chatData.dataset(input.databaseIds);
      case "_settings":
        return this.repo.getSettings();
      case "_modelInfo":
        return this.models.get(input.id);
      case "_close":
        if (this.closing) return;
        this.closing = true;
        this.autoIndex.stop();
        this.automations.close();
        this.backupAbort?.abort();
        await this.storageTask?.catch(() => {});
        await this.queue.close();
        this.upscaler.close();
        this.workshop.close();
        this.engine.close();
        this.repo.close();
        return;
      default:
        throw new Error("Operación no admitida.");
    }
  }
}

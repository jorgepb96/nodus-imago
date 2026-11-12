import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID as uuid } from "node:crypto";
import { Repository } from "./db/repository";
import {
  Images,
  imagePipeline,
  hashFile,
  writeAtomicImage,
} from "./import/images";
import { Models } from "./ai/models";
import { InferenceHost } from "./ai/host";
import { Engine } from "./ai/engine";
import { JobQueue } from "./jobs";
import { buildCsvImportPlan } from "../shared/databaseCsv";
import { parseCsv } from "../shared/csvParser";
import {
  databaseToCsv,
  databaseToJson,
  databaseToMatrix,
} from "../shared/databaseExport";
import { buildXlsx } from "./export/xlsx";
import { writeBackup, restoreBackup } from "./export/backup";
import { importNodus } from "./import/nodus";
import { importNotion } from "./import/notion";
import type { CompletionRequest } from "./ai/apiProviders";
import { AgreementResearch } from "./research/agreement";

export class Service {
  research: AgreementResearch;
  repo: Repository;
  images: Images;
  models: Models;
  host: InferenceHost;
  engine: Engine;
  queue: JobQueue;
  csvPlans = new Map<string, ReturnType<typeof buildCsvImportPlan>>();
  queryImages = new Map<string, string>();
  constructor(
    root: string,
    script: string,
    public changed: () => void,
    complete?: (
      input: CompletionRequest,
      signal: AbortSignal,
    ) => Promise<string>,
  ) {
    this.repo = new Repository(root);
    this.research = new AgreementResearch(this.repo);
    this.images = new Images(this.repo);
    this.models = new Models(this.repo);
    this.host = new InferenceHost(this.repo, script);
    this.engine = new Engine(this.repo, this.models, this.host, complete);
    this.queue = new JobQueue(
      this.repo,
      this.images,
      this.models,
      this.engine,
      changed,
    );
    this.queue.pump();
  }
  private unfinishedJobs() {
    return this.repo
      .jobs()
      .some((job) => ["queued", "running", "paused"].includes(job.state));
  }
  async run(command: string, input: any = undefined): Promise<any> {
    switch (command) {
      case "inferenceDiagnostics": return { backend: this.repo.getSettings().embeddingModel, dimensions: this.engine.dimensions(), contract: this.engine.contract(), processId: this.repo.getSettings().embeddingModel === "harrier-oss-v1-0.6b-q8_0" ? this.engine.harrier.pid : this.engine.onnx.pid, serviceRss: process.memoryUsage().rss };
      case "modelPreparation": return this.models.preparation(this.engine.contract());
      case "prepareModels": {
        const id = await this.models.enqueuePreparation(this.engine.contract()); this.queue.pump(); return id;
      }
      case "probeExperimentalPython": return this.host.request({ operation: "probe" });
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
        return this.repo.create(input.name);
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
      case 'pageDocument':return this.repo.pageDocument(input.rowId,input.columnId);
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
      case "saveOptions":
        return this.repo.saveOptions(input.columnId, input.options);
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
        );
        this.csvPlans.delete(input.token);
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
        const data =
          format === "csv"
            ? databaseToCsv(detail.columns, rows)
            : format === "json"
              ? databaseToJson(detail.columns, rows)
              : (() => {
                  const m = databaseToMatrix(detail.columns, rows);
                  return buildXlsx(m.header, m.body);
                })();
        await fs.writeFile(input.file, data);
        return true;
      }
      case "backup":
        await writeBackup(this.repo, input.file);
        return true;
      case "restore":
        return restoreBackup(this.repo, input.file);
      case "notionImport":
        return importNotion(this.repo, this.images, input.file);
      case "nodusImport":
        return importNodus(this.repo, input.file);
      case "probeRuntime":
        return this.engine.probe();
      case "updateSettings": {
        if (
          Object.keys(input).every((key) =>
            ["mode", "theme", "accent", "language"].includes(key),
          )
        )
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
      case "pauseAllJobs":
        this.queue.pauseAll();
        return;
      case "rebuildText":
        return this.repo.rebuildText();
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
          const model = this.models.get(input.id), parent = path.join(this.repo.root, "models", model.id), prefix = model.revision + ".previous-";
          for (const name of await fs.readdir(parent).catch(() => [])) if (name.startsWith(prefix) && /^[a-f0-9-]{36}$/.test(name.slice(prefix.length))) await fs.rm(path.join(parent, name), { recursive: true, force: true });
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
        return this.repo.undo();
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
          suffix = input.variant === "thumb" ? ".webp" : "-preview.webp",
          target = path.join(
            this.repo.root,
            "thumbnails",
            a.content_hash + suffix,
          );
        try {
          await fs.access(a.original_path);
        } catch {
          throw new Error("Original ausente. Vuelve a vincularlo en la ficha.");
        }
        try {
          await fs.access(target);
        } catch {
          const image = await imagePipeline(a.original_path);
          await writeAtomicImage(
            image
              .rotate()
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
      }
      case "_settings":
        return this.repo.getSettings();
      case "_modelInfo":
        return this.models.get(input.id);
      case "_close":
        await this.queue.close();
        this.engine.close();
        this.repo.close();
        return;
      default:
        throw new Error("Operación no admitida.");
    }
  }
}

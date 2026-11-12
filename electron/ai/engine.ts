import { createHash } from "node:crypto";
import { Repository, now } from "../db/repository";
import { Models } from "./models";
import { InferenceHost } from "./host";
import { hashFile } from "../import/images";
import { normalizeVector, fuseRanks } from "../../shared/vectors";
import type { Page, SearchInput } from "../../shared/imago";
import { randomUUID as uuid } from "node:crypto";
import {
  buildAiCellPrompt,
  buildAiRowContext,
  aiColumnSystem,
} from "../../shared/databaseAi";
import {
  PROVIDERS,
  providerBase,
  isLoopbackUrl,
  type ModelChoice,
} from "../../shared/aiConfig";
import type { CompletionRequest } from "./apiProviders";
import { imagePipeline, withInferenceImage } from "../import/images";
import { LlamaPool } from "./llama";
import {
  parseClassification,
  parseDescription,
} from "../../shared/visionOutput";
import { OnnxHost } from "./onnxHost";
import { HarrierHost } from "./harrier";
import { ONNX_ID, HARRIER_ID, LEGACY_EMBEDDING_ID, HARRIER_IMAGE_PROMPT, embeddingBackendContract, embeddingDimensions } from "../../shared/embeddingBackends";

const LANGUAGE_NAMES: Record<string, string> = {
  es: "español",
  "es-es": "español",
  español: "español",
  en: "English",
  "en-us": "English",
  "en-gb": "English",
  english: "English",
  fr: "français",
  de: "Deutsch",
  pt: "português",
  "pt-br": "português",
  it: "italiano",
  ca: "català",
  gl: "galego",
  eu: "euskara",
};
function targetLanguage(value: string): string {
  const clean = value?.trim();
  if (!clean) return "español";
  return LANGUAGE_NAMES[clean.toLocaleLowerCase()] ?? clean;
}

export class Engine {
  llama: LlamaPool;
  onnx = new OnnxHost();
  harrier: HarrierHost;
  constructor(
    public repo: Repository,
    public models: Models,
    public host: InferenceHost,
    public complete: (
      input: CompletionRequest,
      signal: AbortSignal,
    ) => Promise<string> = async () => {
      throw new Error("Las APIs no están disponibles en este proceso.");
    },
  ) {
    this.llama = new LlamaPool(repo, models);
    this.harrier = new HarrierHost(models);
  }
  close() {
    this.llama.close();
    void this.onnx.close();
    this.harrier.close();
  }
  async resetRuntimes() {
    await this.onnx.close(); this.harrier.close(); this.llama.close(); this.llama = new LlamaPool(this.repo, this.models);
  }
  dimensions() { const s = this.repo.getSettings(); return embeddingDimensions(s.embeddingModel, s.dimensions); }
  contract() {
    const s = this.repo.getSettings();
    if (s.embeddingModel !== LEGACY_EMBEDDING_ID)
      return createHash("sha256").update(embeddingBackendContract(s.embeddingModel, s.dimensions, this.models.get("lfm3-vl-2b").revision)).digest("hex");
    const
      m = this.models.get("embeddinggemma2");
    return createHash("sha256")
      .update(
        JSON.stringify({
          model: m.repository,
          revision: m.revision,
          dimensions: s.dimensions,
          dtype: "float32",
          backend: "sentence-transformers-6.2.0",
          visionTokens: 280,
          audio: false,
          protocol: 1,
          normalization: "l2-after-mrl",
          imagePreparation: "oriented-srgb-png-2200-v1",
        }),
      )
      .digest("hex");
  }
  async probe() {
    const model = this.repo.getSettings().embeddingModel;
    return { backend: model, pythonRequired: model === LEGACY_EMBEDDING_ID, integratedRuntime: model === ONNX_ID, available: this.models.available(model) };
  }
  ready(id: string) {
    if (!this.models.list().some((m) => m.id === id && m.verified))
      throw new Error("Instala y verifica el modelo local en Configuración.");
  }
  async embed(
    inputs: { image?: string; text?: string; role?: string }[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const settings = this.repo.getSettings();
    this.ready(settings.embeddingModel);
    const prepared = inputs.map((item) => ({ ...item }));
    const encode = async (index: number): Promise<any> => {
      if (index < prepared.length) {
        const item = prepared[index];
        if (item.image)
          return withInferenceImage(
            this.repo.root,
            item.image,
            async (file) => {
              item.image = file;
              return encode(index + 1);
            },
          );
        return encode(index + 1);
      }
      if (settings.embeddingModel === ONNX_ID) return this.onnx.embed(this.models.directory(ONNX_ID), settings.profile === "light" ? 1 : settings.profile === "balanced" ? 2 : 4, settings.dimensions, prepared, signal);
      if (settings.embeddingModel === HARRIER_ID) {
        const results: number[][] = [];
        for (const item of prepared) {
          let text = item.text ?? "";
          if (item.image) {
            const hash = await hashFile(item.image), contract = this.contract();
            const cached = this.repo.db.prepare("SELECT text FROM image_captions WHERE content_hash=? AND contract=?").get(hash, contract) as { text: string } | undefined;
            if (!cached) this.ready("lfm3-vl-2b");
            text = cached?.text ?? parseDescription(await this.llama.describe("lfm3-vl-2b", item.image, HARRIER_IMAGE_PROMPT, signal ?? new AbortController().signal));
            if (!cached) this.repo.db.prepare("INSERT INTO image_captions VALUES(?,?,?) ON CONFLICT DO NOTHING").run(hash, contract, text);
          }
          results.push(await this.harrier.embed(text, item.role ?? "document", signal));
        }
        return results;
      }
      return this.host.request(
        {
          task: "embedding",
          directory: this.models.directory("embeddinggemma2"),
          device: settings.device,
          threads:
            settings.profile === "light"
              ? 1
              : settings.profile === "balanced"
                ? 2
                : 4,
          dimensions: settings.dimensions,
          inputs: prepared,
        },
        signal,
      );
    };
    const vectors = await encode(0);
    if (!Array.isArray(vectors) || vectors.length !== inputs.length)
      throw new Error("El runtime devolvió un lote de vectores inválido.");
    return vectors.map((v) => {
      if (!Array.isArray(v) || v.length !== this.dimensions())
        throw new Error("Dimensiones de embedding incorrectas.");
      return normalizeVector(v, this.dimensions());
    });
  }
  enqueueIndex(databaseIds?: string[]) {
    this.ready(this.repo.getSettings().embeddingModel);
    if (this.repo.getSettings().embeddingModel === HARRIER_ID) { this.ready("lfm3-vl-2b"); this.ready("llama-runtime"); }
    const params = databaseIds?.length ? databaseIds : [];
    if (databaseIds && !databaseIds.length)
      throw new Error("Selecciona alguna base de datos.");
    const assets = this.repo.db
      .prepare(
        `SELECT min(id) id FROM image_assets WHERE width>0 ${params.length ? "AND database_id IN (" + params.map(() => "?").join(",") + ")" : ""} GROUP BY content_hash`,
      )
      .all(...params) as { id: string }[];
    return this.repo.newJob(
      "index",
      { assets: assets.map((a) => a.id), contract: this.contract() },
      assets.length,
    );
  }
  async indexOne(
    payload: { assets: string[]; contract: string },
    index: number,
    signal: AbortSignal,
  ) {
    if (payload.contract !== this.contract())
      throw Object.assign(new Error("La configuración del modelo ha cambiado. Crea una nueva tarea de indexación."), { fatal: true });
    const asset = this.repo.asset(payload.assets[index]);
    if ((await hashFile(asset.original_path)) !== asset.content_hash)
      throw new Error(
        "El original ha cambiado. Vuelve a importarlo antes de indexar.",
      );
    if (
      this.repo.db
        .prepare("SELECT 1 FROM embeddings WHERE content_hash=? AND contract=?")
        .get(asset.content_hash, payload.contract)
    )
      return "skipped" as const;
    const [vector] = await this.embed([{ image: asset.original_path }], signal);
    this.repo.db
      .prepare(
        "INSERT INTO embeddings VALUES(?,?,?) ON CONFLICT(content_hash,contract) DO NOTHING",
      )
      .run(
        asset.content_hash,
        payload.contract,
        Buffer.from(new Float32Array(vector).buffer),
      );
    return "imported" as const;
  }
  async search(input: SearchInput, queryImage?: string): Promise<Page> {
    if (!input.mode || input.mode === "literal")
      return this.repo.literal(input);
    this.ready(this.repo.getSettings().embeddingModel);
    if (!input.query?.trim() && !queryImage && !input.similarAssetId)
      throw new Error("Escribe una consulta o adjunta una imagen.");
    const settings = this.repo.getSettings(),
      contract = this.contract(),
      vectors: number[][] = [];
    if (input.similarAssetId) {
      const a = this.repo.asset(input.similarAssetId);
      const saved = this.repo.db
        .prepare(
          "SELECT vector FROM embeddings WHERE content_hash=? AND contract=?",
        )
        .get(a.content_hash, contract) as { vector: Buffer } | undefined;
      if ((await hashFile(a.original_path)) !== a.content_hash)
        throw new Error("La imagen original ha cambiado. Vuelve a importarla.");
      if (saved)
        vectors.push(
          Array.from(
            new Float32Array(
              saved.vector.buffer,
              saved.vector.byteOffset,
              saved.vector.byteLength / 4,
            ),
          ),
        );
      else vectors.push((await this.embed([{ image: a.original_path }]))[0]);
    }
    const inputs = [];
    if (input.query?.trim()) inputs.push({ text: input.query, role: "query" });
    if (queryImage) inputs.push({ image: queryImage });
    if (inputs.length) vectors.push(...(await this.embed(inputs)));
    const vector = normalizeVector(
      Array.from(
        { length: this.dimensions() },
        (_, i) => vectors.reduce((sum, v) => sum + v[i], 0) / vectors.length,
      ),
    );
    // Structured filtering happens before ranking, across all rows in scope.
    const allowed = new Set<string>();
    let offset = 0;
    while (true) {
      const page = this.repo.literal({
        ...input,
        query: undefined,
        sortColumn: undefined,
        sorts: undefined,
        limit: 200,
        offset,
      });
      page.rows.forEach((r) => allowed.add(r.id));
      offset += page.rows.length;
      if (offset >= page.total || !page.rows.length) break;
    }
    const scope = input.databaseIds;
    if (scope && !scope.length) return { rows: [], total: 0, indexed: 0 };
    const values = this.repo.db
      .prepare(
        `SELECT a.row_id,a.content_hash,e.vector FROM image_assets a JOIN embeddings e ON e.content_hash=a.content_hash AND e.contract=? ${scope?.length ? "WHERE a.database_id IN (" + scope.map(() => "?").join(",") + ")" : ""}`,
      )
      .all(contract, ...(scope ?? [])) as {
      row_id: string;
      content_hash: string;
      vector: Buffer;
    }[];
    const scores = new Map<string, number>();
    for (const a of values) {
      if (!allowed.has(a.row_id)) continue;
      const v = new Float32Array(
        a.vector.buffer,
        a.vector.byteOffset,
        a.vector.byteLength / 4,
      );
      if (v.length !== vector.length)
        throw new Error("Índice vectorial incompatible. Reconstrúyelo.");
      let score = 0;
      for (let i = 0; i < v.length; i++) score += v[i] * vector[i];
      if (score > (scores.get(a.row_id) ?? -Infinity))
        scores.set(a.row_id, score);
    }
    const semantic = [...scores]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id]) => id);
    let ranked = semantic;
    if (input.mode === "hybrid" && input.query?.trim()) {
      const literal: string[] = [];
      let start = 0;
      while (true) {
        const p = this.repo.literal({
          ...input,
          limit: 200,
          offset: start,
          sortColumn: undefined,
          sorts: undefined,
        });
        literal.push(...p.rows.map((r) => r.id));
        start += p.rows.length;
        if (start >= p.total || !p.rows.length) break;
      }
      ranked = fuseRanks(literal, semantic, input.semanticWeight ?? 0.5)
        .filter(([, score]) => score > 0)
        .map(([id]) => id);
    }
    if (input.sorts?.length || input.sortColumn) {
      const page = this.repo.literal({ ...input, query: undefined }, ranked);
      page.rows.forEach((row) => {
        row.score = scores.get(row.id);
      });
      return {
        ...page,
        indexed: new Set(values.map((value) => value.content_hash)).size,
      };
    }
    const rows = this.repo.hydrate(
      ranked.slice(
        input.offset ?? 0,
        (input.offset ?? 0) + (input.limit ?? 100),
      ),
    );
    rows.forEach((r) => {
      r.score = scores.get(r.id);
    });
    return {
      rows,
      total: ranked.length,
      indexed: new Set(values.map((v) => v.content_hash)).size,
    };
  }
  enqueueAnalysis(input: {
    rowIds?: string[];
    databaseId?: string;
    columnIds: string[];
    language: string;
    detailed: boolean;
  }) {
    const settings = this.repo.getSettings();
    const verifiedModels = new Set(
      this.models
        .list()
        .filter((model) => model.verified)
        .map((model) => model.id),
    );
    const rowIds =
      input.rowIds ??
      (input.databaseId
        ? (
            this.repo.db
              .prepare(
                "SELECT id FROM db_rows WHERE database_id=? ORDER BY position",
              )
              .all(input.databaseId) as { id: string }[]
          ).map((r) => r.id)
        : []);
    const items: { rowId: string; columnId: string; choice: ModelChoice }[] =
      [];
    for (const rowId of rowIds) {
      const row = this.repo.getRow(rowId);
      if (!row.images.some((a) => a.width > 0)) continue;
      for (const columnId of input.columnIds) {
        const c = this.repo.column(columnId);
        if (
          c.databaseId !== row.databaseId ||
          ![
            "text",
            "rich_text",
            "select",
            "multi_select",
            "status",
            "ai",
          ].includes(c.type)
        )
          continue;
        if (
          ["select", "multi_select", "status"].includes(c.type) &&
          !c.options.length
        )
          continue;
        if (row.cells[columnId]) continue;
        const configured = c.config.aiModel;
        const choice: ModelChoice = configured
          ? {
              provider: (configured.provider === "nodus"
                ? "local"
                : configured.provider) as ModelChoice["provider"],
              model: configured.model,
            }
          : ["select", "multi_select", "status"].includes(c.type)
            ? settings.classificationModel
            : settings.descriptionModel;
        if (choice.provider === "local") {
          if (!verifiedModels.has(choice.model))
            throw new Error(
              "Instala y verifica el modelo local en Configuración.",
            );
          if (
            this.models.get(choice.model).backend === "llama" &&
            !verifiedModels.has("llama-runtime")
          )
            throw new Error(
              "Instala y verifica el motor de visión llama.cpp en Ajustes.",
            );
        } else {
          if (!Object.hasOwn(PROVIDERS, choice.provider))
            throw new Error("Proveedor de columna no compatible.");
          const base = providerBase(choice.provider, settings.apiProfiles);
          if (!settings.remoteEnabled && !isLoopbackUrl(base))
            throw new Error(
              "Las APIs remotas están desactivadas. Actívalas expresamente en Ajustes.",
            );
        }
        items.push({ rowId, columnId, choice });
      }
    }
    if (!items.length)
      throw new Error(
        "No hay propiedades vacías compatibles en los registros seleccionados.",
      );
    return this.repo.newJob(
      "analyze",
      {
        ...input,
        items,
        label: input.columnIds
          .map((id) => this.repo.column(id).name)
          .join(" · "),
      },
      items.length,
    );
  }
  async analyzeOne(
    payload: {
      language: string;
      detailed: boolean;
      items: { rowId: string; columnId: string; choice: ModelChoice }[];
    },
    index: number,
    signal: AbortSignal,
  ) {
    const item = payload.items[index],
      choice = item.choice,
      row = this.repo.getRow(item.rowId),
      column = this.repo.column(item.columnId);
    if (
      row.cells[column.id] ||
      this.repo.db
        .prepare(
          "SELECT 1 FROM proposals WHERE row_id=? AND column_id=? AND state='pending'",
        )
        .get(row.id, column.id)
    )
      return "skipped" as const;
    const sourceImages = row.images.filter(
      (a) =>
        a.width > 0 &&
        (!column.config.aiSourceColumnId ||
          a.columnId === column.config.aiSourceColumnId),
    );
    const image = sourceImages[0];
    if (!image) return "skipped" as const;
    const asset = this.repo.asset(image.id);
    if ((await hashFile(asset.original_path)) !== asset.content_hash)
      throw new Error("El original cambió.");
    const options = ["select", "multi_select", "status"].includes(column.type);
    const instruction =
      (column.config.aiPrompt ? column.config.aiPrompt + "\n\n" : "") +
      (options
        ? `Classify the visible image for the field ${JSON.stringify(column.name)}. Choose only from this exact list of labels: ${JSON.stringify(column.options.map((o) => o.label))}. Return ONLY a JSON array of exact label strings, at most ${column.type === "multi_select" ? "5" : "1"}. Return [] if none applies. Do not invent labels, do not explain, and do not use any other format.`
        : `Describe only directly observable details of this photograph in ${targetLanguage(payload.language)}. ${payload.detailed ? "Write a detailed paragraph." : "Write one or two brief sentences."} Answer exclusively in ${targetLanguage(payload.language)}, even if text in the image uses another language. Do not guess identities, dates, locations or historical context. State uncertainty explicitly. Return only the description, with no reasoning, labels, JSON or preamble.`);
    const settings = this.repo.getSettings(),
      language = settings.language;
    const context = buildAiRowContext(
      this.repo.detail(row.databaseId).columns,
      row,
      { excludeColumnId: column.id, language },
    );
    const prompt = buildAiCellPrompt(instruction, context, language);
    let result: string, modelName: string, revision: string;
    if (choice.provider === "local") {
      this.ready(choice.model);
      const model = this.models.get(choice.model);
      modelName = model.repository;
      revision = model.revision;
      if (model.backend === "llama") {
        result = await withInferenceImage(
          this.repo.root,
          asset.original_path,
          (file) =>
            this.llama.describe(
              choice.model,
              file,
              prompt,
              signal,
              options ? "json" : "text",
            ),
        );
      } else
        result = await withInferenceImage(
          this.repo.root,
          asset.original_path,
          (file) =>
            this.host.request(
              {
                task: "vision",
                directory: this.models.directory(choice.model),
                device: settings.device,
                threads: settings.profile === "light" ? 1 : 2,
                image: file,
                prompt,
              },
              signal,
            ),
        );
    } else {
      const parts = [];
      for (const source of sourceImages.slice(0, 2)) {
        const a = this.repo.asset(source.id);
        if ((await hashFile(a.original_path)) !== a.content_hash)
          throw new Error(
            "Una imagen de origen ha cambiado. Vuelve a importarla.",
          );
        const pipeline = await imagePipeline(a.original_path);
        const buffer = await pipeline
          .rotate()
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        parts.push({
          base64: buffer.toString("base64"),
          mediaType: "image/jpeg",
        });
      }
      result = await this.complete(
        {
          choice,
          profiles: settings.apiProfiles,
          remoteEnabled: settings.remoteEnabled,
          minIntervalMs: settings.apiDelayMs,
          prompt,
          system: aiColumnSystem(language),
          images: parts,
        },
        signal,
      );
      modelName = choice.provider + "/" + choice.model;
      revision = "API · " + providerBase(choice.provider, settings.apiProfiles);
    }
    if (typeof result !== "string" || !result.trim())
      throw new Error("El modelo no ha devuelto texto.");
    if (process.env.IMAGO_DEBUG_AI)
      console.error("[imago-ai] " + JSON.stringify(result));
    let value: string | null;
    if (options) {
      const labels = parseClassification(
        result,
        column.options.map((option) => option.label),
        column.type === "multi_select" ? 5 : 1,
      );
      const selected = labels.map(
        (label) =>
          column.options.find(
            (option) =>
              option.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
          )!.id,
      );
      value =
        column.type === "multi_select"
          ? JSON.stringify([...new Set(selected)])
          : (selected[0] ?? null);
    } else {
      value = parseDescription(result);
    }
    this.repo.db
      .prepare(
        "INSERT INTO proposals(id,row_id,column_id,before_value,value,model,revision,prompt,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        uuid(),
        row.id,
        column.id,
        row.cells[column.id] ?? null,
        value,
        modelName,
        revision,
        prompt,
        now(),
      );
    return "imported" as const;
  }
}

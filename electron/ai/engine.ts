import { createHash } from "node:crypto";
import { Repository, now, recordTextHash } from "../db/repository";
import { recordEmbeddingText } from "../../shared/recordEmbedding";
import { Models } from "./models";
import { InferenceHost } from "./host";
import { hashFile } from "../import/images";
import {
  normalizeVector,
  fuseRanks,
  fuseRankLists,
} from "../../shared/vectors";
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
import type { CompletionRequest, EmbeddingRequest } from "./apiProviders";
import { imagePipeline, withInferenceImage } from "../import/images";
import { LlamaPool } from "./llama";
import {
  parseClassification,
  parseDescription,
} from "../../shared/visionOutput";
import { OnnxHost } from "./onnxHost";
import { HarrierHost } from "./harrier";
import {
  API_EMBEDDING_ID,
  DEFAULT_EMBEDDING_API,
  embeddingApiMultimodal,
  type EmbeddingApiChoice,
} from "../../shared/embeddingApi";
import {
  ONNX_ID,
  HARRIER_ID,
  LEGACY_EMBEDDING_ID,
  HARRIER_IMAGE_PROMPT,
  embeddingBackendContract,
  embeddingDimensions,
} from "../../shared/embeddingBackends";

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
  /** Embedding requests brokered by the main process (which holds the keys). */
  remoteEmbed: (
    input: EmbeddingRequest,
    signal: AbortSignal,
  ) => Promise<number[][]> = async () => {
    throw new Error("Las APIs no están disponibles en este proceso.");
  };
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
    await this.onnx.close();
    this.harrier.close();
    this.llama.close();
    this.llama = new LlamaPool(this.repo, this.models);
  }
  apiChoice(): EmbeddingApiChoice {
    return this.repo.getSettings().embeddingApi ?? DEFAULT_EMBEDDING_API;
  }
  dimensions() {
    const s = this.repo.getSettings();
    if (s.embeddingModel === API_EMBEDDING_ID)
      return this.apiChoice().dimensions;
    return embeddingDimensions(s.embeddingModel, s.dimensions);
  }
  /**
   * How images enter the vector space: embedded directly ("native"), through a
   * local LFM3 description ("caption"), or not at all for a text-only API model
   * without LFM3 ("none", records are then searched by their own text).
   */
  imageMode(): "native" | "caption" | "none" {
    const s = this.repo.getSettings();
    if (s.embeddingModel === HARRIER_ID) return "caption";
    if (s.embeddingModel !== API_EMBEDDING_ID) return "native";
    if (embeddingApiMultimodal(this.apiChoice())) return "native";
    return this.models
      .list()
      .some((m) => m.id === "lfm3-vl-2b" && m.verified) &&
      this.models.list().some((m) => m.id === "llama-runtime" && m.verified)
      ? "caption"
      : "none";
  }
  contract() {
    const s = this.repo.getSettings();
    if (s.embeddingModel === API_EMBEDDING_ID) {
      const choice = this.apiChoice(),
        mode = this.imageMode();
      return createHash("sha256")
        .update(
          JSON.stringify({
            protocol: "imago.api-embedding/1",
            provider: choice.provider,
            // The endpoint is part of the identity: two servers may expose
            // different weights under the same model name.
            endpoint: providerBase(choice.provider, s.apiProfiles),
            model: choice.model.trim(),
            dimensions: choice.dimensions,
            text: "embeddingApiText/1",
            images:
              mode === "native"
                ? "oriented-srgb-jpeg-1536-q90-v1"
                : mode === "caption"
                  ? {
                      visionRevision: this.models.get("lfm3-vl-2b").revision,
                      prompt: HARRIER_IMAGE_PROMPT,
                    }
                  : "none",
            normalization: "l2",
          }),
        )
        .digest("hex");
    }
    if (s.embeddingModel !== LEGACY_EMBEDDING_ID)
      return createHash("sha256")
        .update(
          embeddingBackendContract(
            s.embeddingModel,
            s.dimensions,
            this.models.get("lfm3-vl-2b").revision,
            s.visionBudget ?? 280,
          ),
        )
        .digest("hex");
    const m = this.models.get("embeddinggemma2");
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
  /**
   * Contract of record text vectors. With EmbeddingGemma the visual token
   * budget only changes how images are seen, so text vectors keep one identity
   * across budgets and are not recomputed when the budget changes.
   */
  textContract() {
    const s = this.repo.getSettings();
    if (s.embeddingModel === ONNX_ID && (s.visionBudget ?? 280) !== 280)
      return createHash("sha256")
        .update(
          embeddingBackendContract(
            s.embeddingModel,
            s.dimensions,
            this.models.get("lfm3-vl-2b").revision,
            280,
          ),
        )
        .digest("hex");
    return this.contract();
  }
  async probe() {
    const model = this.repo.getSettings().embeddingModel;
    return {
      backend: model,
      pythonRequired: model === LEGACY_EMBEDDING_ID,
      integratedRuntime: model === ONNX_ID,
      available: this.models.available(model),
    };
  }
  ready(id: string) {
    if (id === API_EMBEDDING_ID) {
      const s = this.repo.getSettings(),
        choice = this.apiChoice();
      if (
        !s.remoteEnabled &&
        !isLoopbackUrl(providerBase(choice.provider, s.apiProfiles))
      )
        throw new Error(
          "Activa el uso opcional de APIs en Ajustes para usar embeddings remotos.",
        );
      return;
    }
    if (!this.models.list().some((m) => m.id === id && m.verified))
      throw new Error("Instala y verifica el modelo local en Configuración.");
  }
  /** Describe an image with local LFM3 once per contract; the text is cached. */
  private async captionFor(png: string, signal?: AbortSignal) {
    const hash = await hashFile(png),
      contract = this.contract();
    const cached = this.repo.db
      .prepare(
        "SELECT text FROM image_captions WHERE content_hash=? AND contract=?",
      )
      .get(hash, contract) as { text: string } | undefined;
    if (cached) return cached.text;
    this.ready("lfm3-vl-2b");
    const text = parseDescription(
      await this.llama.describe(
        "lfm3-vl-2b",
        png,
        HARRIER_IMAGE_PROMPT,
        signal ?? new AbortController().signal,
      ),
    );
    this.repo.db
      .prepare(
        "INSERT INTO image_captions VALUES(?,?,?) ON CONFLICT DO NOTHING",
      )
      .run(hash, contract, text);
    return text;
  }
  /** Embeddings through the API broker, in provider-sized batches. */
  private async apiEmbed(
    inputs: { image?: string; text?: string; role?: string }[],
    signal?: AbortSignal,
  ) {
    const settings = this.repo.getSettings(),
      choice = this.apiChoice(),
      mode = this.imageMode();
    const items: EmbeddingRequest["inputs"] = [];
    for (const item of inputs) {
      if (!item.image) {
        items.push({
          text: item.text ?? "",
          role: item.role === "query" ? "query" : "document",
        });
        continue;
      }
      if (mode === "native") {
        const jpeg = await (
          await imagePipeline(item.image)
        )
          .rotate()
          .resize(1536, 1536, { fit: "inside", withoutEnlargement: true })
          .toColourspace("srgb")
          .removeAlpha()
          .jpeg({ quality: 90 })
          .toBuffer();
        items.push({ image: jpeg.toString("base64"), mimeType: "image/jpeg" });
      } else if (mode === "caption")
        items.push({
          text: await withInferenceImage(this.repo.root, item.image, (png) =>
            this.captionFor(png, signal),
          ),
          role: "document",
        });
      else
        throw new Error(
          "Este modelo de embeddings solo admite texto. Instala LFM3 para describir las imágenes o elige un modelo multimodal.",
        );
    }
    const vectors: number[][] = [];
    for (let i = 0; i < items.length;) {
      // Gemini accepts at most six images per request; text batches are larger.
      const size = items[i] && "image" in items[i] ? 6 : 32;
      const chunk = items.slice(i, i + size);
      vectors.push(
        ...(await this.remoteEmbed(
          {
            embedding: true,
            provider: choice.provider,
            model: choice.model.trim(),
            dimensions: choice.dimensions,
            profiles: settings.apiProfiles,
            remoteEnabled: settings.remoteEnabled,
            minIntervalMs: settings.apiDelayMs,
            inputs: chunk,
          },
          signal ?? new AbortController().signal,
        )),
      );
      i += chunk.length;
    }
    for (const v of vectors)
      if (v.length !== choice.dimensions)
        throw Object.assign(
          new Error(
            `El modelo devolvió vectores de ${v.length} dimensiones; ajusta las dimensiones a ${v.length} en Ajustes.`,
          ),
          { fatal: true },
        );
    return vectors;
  }
  async embed(
    inputs: { image?: string; text?: string; role?: string }[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const settings = this.repo.getSettings();
    this.ready(settings.embeddingModel);
    if (settings.embeddingModel === API_EMBEDDING_ID) {
      const vectors = await this.apiEmbed(inputs, signal);
      if (vectors.length !== inputs.length)
        throw new Error("El proveedor devolvió un lote de vectores inválido.");
      return vectors.map((v) => normalizeVector(v, this.dimensions()));
    }
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
      if (settings.embeddingModel === ONNX_ID)
        return this.onnx.embed(
          this.models.directory(ONNX_ID),
          settings.profile === "light"
            ? 1
            : settings.profile === "balanced"
              ? 2
              : 4,
          settings.dimensions,
          prepared,
          signal,
          settings.visionBudget ?? 280,
        );
      if (settings.embeddingModel === HARRIER_ID) {
        const results: number[][] = [];
        for (const item of prepared) {
          let text = item.text ?? "";
          if (item.image) text = await this.captionFor(item.image, signal);
          results.push(
            await this.harrier.embed(text, item.role ?? "document", signal),
          );
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
  /**
   * What the next indexing pass would process, without loading any record:
   * images with no vector for this contract, and records with no text vector
   * or one marked stale by Repository.indexRow after an edit.
   */
  pendingIndex(databaseIds?: string[]) {
    const params = databaseIds?.length ? databaseIds : [];
    const scope = params.length
      ? "database_id IN (" + params.map(() => "?").join(",") + ")"
      : "1";
    const contract = this.contract(),
      textContract = this.textContract();
    // Images already embedded under this contract are not queued again, so a
    // resumed or repeated indexing pass starts where the last one stopped.
    const assets =
      this.imageMode() === "none"
        ? []
        : (
            this.repo.db
              .prepare(
                `SELECT min(id) id FROM image_assets a WHERE width>0 AND ${scope} AND NOT EXISTS(SELECT 1 FROM embeddings e WHERE e.content_hash=a.content_hash AND e.contract=?) GROUP BY content_hash`,
              )
              .all(...params, contract) as { id: string }[]
          ).map((a) => a.id);
    // A stale vector keeps serving searches until the new one replaces it, so
    // renaming a property never empties the text lane.
    const rows = (
      this.repo.db
        .prepare(
          `SELECT r.id FROM db_rows r LEFT JOIN record_embeddings e ON e.row_id=r.id AND e.contract=? WHERE ${scope.replace("database_id", "r.database_id")} AND (e.row_id IS NULL OR e.stale=1) ORDER BY r.database_id,r.position`,
        )
        .all(textContract, ...params) as { id: string }[]
    ).map((r) => r.id);
    return { rows, assets, contract };
  }
  enqueueIndex(
    databaseIds?: string[],
    options: { auto?: boolean; recordsOnly?: boolean } = {},
  ) {
    this.ready(this.repo.getSettings().embeddingModel);
    if (this.imageMode() === "caption") {
      this.ready("lfm3-vl-2b");
      this.ready("llama-runtime");
    }
    if (databaseIds && !databaseIds.length)
      throw new Error("Selecciona alguna base de datos.");
    const pending = this.pendingIndex(databaseIds),
      { rows, contract } = pending,
      assets = options.recordsOnly ? [] : pending.assets;
    return this.repo.newJob(
      "index",
      {
        rows,
        assets,
        contract,
        ...(options.auto ? { auto: true, label: "Indexación automática" } : {}),
      },
      rows.length + assets.length,
    );
  }
  /** Rough duration of a pass on this backend, for the automatic threshold. */
  estimateSeconds(pending: { rows: number; assets: number }) {
    const s = this.repo.getSettings();
    if (s.embeddingModel === API_EMBEDDING_ID)
      return pending.rows / 32 + pending.assets / 6;
    const image =
      s.embeddingModel === ONNX_ID
        ? ({ 70: 1.2, 140: 2.7, 280: 5.3 } as const)[s.visionBudget ?? 280]
        : 15;
    return pending.rows * 0.6 + pending.assets * image;
  }
  async indexOne(
    payload: { assets: string[]; rows?: string[]; contract: string },
    index: number,
    signal: AbortSignal,
  ) {
    if (payload.contract !== this.contract())
      throw Object.assign(
        new Error(
          "La configuración del modelo ha cambiado. Crea una nueva tarea de indexación.",
        ),
        { fatal: true },
      );
    const rows = payload.rows ?? [];
    if (index < rows.length)
      return this.indexRecord(
        rows[index],
        payload.contract,
        signal,
        rows.slice(index),
      );
    const asset = this.repo.asset(payload.assets[index - rows.length]);
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
    const vector =
      this.takePrefetched("image:" + asset.content_hash) ??
      (await this.prefetchImages(
        asset,
        payload.assets.slice(index - rows.length + 1, index - rows.length + 6),
        signal,
      ));
    signal.throwIfAborted();
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
  /**
   * Vectors computed ahead of the queue cursor. Remote models answer a batch in
   * about the time of one item, so the next records or images of the same job
   * travel in the same request. Local runtimes gain nothing and stay one by one.
   */
  private prefetched = new Map<string, number[]>();
  private takePrefetched(key: string) {
    const full = this.contract() + ":" + key,
      vector = this.prefetched.get(full);
    this.prefetched.delete(full);
    return vector;
  }
  private batching() {
    return this.repo.getSettings().embeddingModel === API_EMBEDDING_ID;
  }
  private remember(entries: [string, number[]][]) {
    const contract = this.contract();
    if (this.prefetched.size > 512) this.prefetched.clear();
    for (const [key, vector] of entries)
      this.prefetched.set(contract + ":" + key, vector);
  }
  private async prefetchImages(
    asset: { content_hash: string; original_path: string },
    upcoming: string[],
    signal: AbortSignal,
  ) {
    const batch = [asset];
    if (this.batching())
      for (const id of upcoming) {
        const next = this.repo.db
          .prepare(
            "SELECT content_hash,original_path FROM image_assets WHERE id=?",
          )
          .get(id) as
          { content_hash: string; original_path: string } | undefined;
        if (!next || batch.some((b) => b.content_hash === next.content_hash))
          continue;
        if (
          (await hashFile(next.original_path).catch(() => "")) !==
          next.content_hash
        )
          continue;
        batch.push(next);
      }
    const vectors = await this.embed(
      batch.map((b) => ({ image: b.original_path })),
      signal,
    );
    this.remember(
      batch.slice(1).map((b, i) => ["image:" + b.content_hash, vectors[i + 1]]),
    );
    return vectors[0];
  }
  /** Embed a record's own text (title and properties) for the text lane. */
  async indexRecord(
    rowId: string,
    contract: string,
    signal: AbortSignal,
    upcoming: string[] = [rowId],
  ) {
    // Text vectors do not depend on the visual budget; see textContract().
    void contract;
    contract = this.textContract();
    const found = this.repo.db
      .prepare("SELECT database_id FROM db_rows WHERE id=?")
      .get(rowId) as { database_id: string } | undefined;
    if (!found) return "skipped" as const;
    const row = this.repo.getRow(rowId),
      text = recordEmbeddingText(this.recordColumns(found.database_id), row);
    if (!text) return "skipped" as const;
    const hash = recordTextHash(text);
    if (
      this.repo.db
        .prepare(
          "UPDATE record_embeddings SET stale=0 WHERE row_id=? AND contract=? AND text_hash=?",
        )
        .run(rowId, contract, hash).changes
    )
      return "skipped" as const;
    let vector = this.takePrefetched(`record:${rowId}:${hash}`);
    if (!vector) {
      const batch = [{ rowId, hash, text }];
      if (this.batching())
        for (const id of upcoming.slice(1, 32)) {
          const next = this.repo.db
            .prepare("SELECT database_id FROM db_rows WHERE id=?")
            .get(id) as { database_id: string } | undefined;
          if (!next) continue;
          const nextText = recordEmbeddingText(
            this.recordColumns(next.database_id),
            this.repo.getRow(id),
          );
          if (nextText)
            batch.push({
              rowId: id,
              hash: recordTextHash(nextText),
              text: nextText,
            });
        }
      const vectors = await this.embed(
        batch.map((b) => ({ text: b.text, role: "document" })),
        signal,
      );
      this.remember(
        batch
          .slice(1)
          .map((b, i) => [`record:${b.rowId}:${b.hash}`, vectors[i + 1]]),
      );
      vector = vectors[0];
    }
    signal.throwIfAborted();
    // The record may have changed while it was being embedded; keep only a
    // vector that still describes its current text.
    const current = recordEmbeddingText(
      this.recordColumns(found.database_id),
      this.repo.getRow(rowId),
    );
    if (recordTextHash(current) !== hash) return "skipped" as const;
    this.repo.db
      .prepare(
        "INSERT INTO record_embeddings(row_id,contract,text_hash,vector,stale) VALUES(?,?,?,?,0) ON CONFLICT(row_id,contract) DO UPDATE SET text_hash=excluded.text_hash,vector=excluded.vector,stale=0",
      )
      .run(rowId, contract, hash, Buffer.from(new Float32Array(vector).buffer));
    return "imported" as const;
  }
  private columnCache = new Map<
    string,
    { signature: string; columns: ReturnType<Repository["detail"]>["columns"] }
  >();
  /** Column definitions for a database, reused while its schema and options are unchanged. */
  private recordColumns(databaseId: string) {
    const signature = (
      this.repo.db
        .prepare(
          "SELECT (SELECT count(*)||':'||coalesce(max(updated_at),'') FROM db_columns WHERE database_id=?)||'|'||(SELECT count(*)||':'||coalesce(max(updated_at),'') FROM db_select_options WHERE database_id=?) s",
        )
        .get(databaseId, databaseId) as { s: string }
    ).s;
    const cached = this.columnCache.get(databaseId);
    if (cached?.signature === signature) return cached.columns;
    const columns = this.repo.detail(databaseId).columns;
    this.columnCache.set(databaseId, { signature, columns });
    return columns;
  }
  async search(input: SearchInput, queryImage?: string): Promise<Page> {
    if (!input.mode || input.mode === "literal")
      return this.repo.literal(input);
    const { ranked, scores, indexed, textIndexed } = await this.rank(input, queryImage);
    if (input.sorts?.length || input.sortColumn) {
      const page = this.repo.literal({ ...input, query: undefined }, ranked);
      page.rows.forEach((row) => {
        row.score = scores.get(row.id);
      });
      return { ...page, indexed, textIndexed };
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
    return { rows, total: ranked.length, indexed, textIndexed };
  }
  /**
   * Every record a search selects, in its order: the records the timeline
   * and the statistics count when the database's search box is in use.
   */
  async matchIds(input: SearchInput): Promise<string[]> {
    if (!input.mode || input.mode === "literal" || !input.query?.trim())
      return this.repo.literalIds({ ...input, mode: undefined });
    return (await this.rank(input)).ranked;
  }
  private async rank(input: SearchInput, queryImage?: string) {
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
    const allowed = new Set(
      this.repo.literalIds({
        ...input,
        query: undefined,
        sortColumn: undefined,
        sorts: undefined,
      }),
    );
    const scope = input.databaseIds;
    if (scope && !scope.length)
      return {
        ranked: [] as string[],
        scores: new Map<string, number>(),
        indexed: 0,
        textIndexed: 0,
      };
    const marks = scope?.length ? scope.map(() => "?").join(",") : "";
    const sources = input.semanticSources ?? "both",
      textQuery = Boolean(input.query?.trim()),
      // An image (or "similar to") query without words is visual by nature.
      useImages = sources !== "text" || !textQuery,
      useText = textQuery && sources !== "images";
    const score = (blob: Buffer) => {
      const v = new Float32Array(
        blob.buffer,
        blob.byteOffset,
        blob.byteLength / 4,
      );
      if (v.length !== vector.length)
        throw new Error("Índice vectorial incompatible. Reconstrúyelo.");
      let total = 0;
      for (let i = 0; i < v.length; i++) total += v[i] * vector[i];
      return total;
    };
    const values = this.repo.db
      .prepare(
        `SELECT a.row_id,a.content_hash,e.vector FROM image_assets a JOIN embeddings e ON e.content_hash=a.content_hash AND e.contract=? ${marks ? "WHERE a.database_id IN (" + marks + ")" : ""}`,
      )
      .all(contract, ...(scope ?? [])) as {
      row_id: string;
      content_hash: string;
      vector: Buffer;
    }[];
    const imageScores = new Map<string, number>();
    if (useImages)
      for (const a of values) {
        if (!allowed.has(a.row_id)) continue;
        const value = score(a.vector);
        if (value > (imageScores.get(a.row_id) ?? -Infinity))
          imageScores.set(a.row_id, value);
      }
    const texts = this.repo.db
      .prepare(
        `SELECT e.row_id,e.vector FROM record_embeddings e JOIN db_rows r ON r.id=e.row_id WHERE e.contract=? ${marks ? "AND r.database_id IN (" + marks + ")" : ""}`,
      )
      .all(this.textContract(), ...(scope ?? [])) as {
      row_id: string;
      vector: Buffer;
    }[];
    const textScores = new Map<string, number>();
    if (useText)
      for (const t of texts)
        if (allowed.has(t.row_id)) textScores.set(t.row_id, score(t.vector));
    const byScore = (map: Map<string, number>) =>
      [...map]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([id]) => id);
    // Image and text similarities live on different scales, so the two lanes
    // are combined by rank (reciprocal rank fusion), never by raw cosine.
    const lanes = [byScore(imageScores), byScore(textScores)].filter(
      (lane) => lane.length,
    );
    let semantic =
      lanes.length > 1
        ? fuseRankLists(
            lanes.map((ids) => ({ ids, weight: 1 })),
            60,
            "mean",
          ).map(([id]) => id)
        : (lanes[0] ?? []);
    const scores = new Map<string, number>();
    for (const map of [imageScores, textScores])
      for (const [id, value] of map)
        if (value > (scores.get(id) ?? -Infinity)) scores.set(id, value);
    // A database's search box keeps only the closest records, so the
    // search narrows the table instead of ranking every record.
    if (input.semanticLimit) semantic = semantic.slice(0, input.semanticLimit);
    let ranked = semantic;
    if (input.mode === "hybrid" && input.query?.trim()) {
      // The lexical lane accepts any significant word, ranked by BM25: a
      // sentence-long description almost never contains every one of its words.
      // The database box keeps its literal matches exact (every word).
      const literal = this.repo.literalIds({
        ...input,
        match: input.semanticLimit
          ? (input.match ?? "words")
          : input.match === "phrase"
            ? "phrase"
            : "any",
        sortColumn: undefined,
        sorts: undefined,
      });
      ranked = fuseRanks(literal, semantic, input.semanticWeight ?? 0.5)
        .filter(([, value]) => value > 0)
        .map(([id]) => id);
    }
    const indexed = new Set(values.map((value) => value.content_hash)).size,
      textIndexed = texts.length;
    return { ranked, scores, indexed, textIndexed };
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
      signal.throwIfAborted();
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
    signal.throwIfAborted();
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

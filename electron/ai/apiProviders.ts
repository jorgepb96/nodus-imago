import { Secrets } from "../secrets/store";
import {
  PROVIDERS,
  providerBase,
  isLoopbackUrl,
  type ApiProfile,
  type ApiProvider,
  type ImageCatalogModel,
  type ModelChoice,
  type ProviderModel,
} from "../../shared/aiConfig";
import {
  anthropicVisionContent,
  openAiVisionContent,
  type VisionImagePart,
} from "../../shared/visionContent";
import {
  embeddingApiMultimodal,
  embeddingApiResizable,
  embeddingApiText,
  geminiNativeBase,
  type EmbeddingApiProvider,
} from "../../shared/embeddingApi";
import { splitSse, sseData, streamDelta } from "../../shared/chat";
import { IMAGE_API, SUGGESTED_IMAGE_MODELS } from "../../shared/restoration";
export type CompletionRequest = {
  choice: ModelChoice;
  profiles: Partial<Record<ApiProvider, ApiProfile>>;
  remoteEnabled: boolean;
  prompt: string;
  system: string;
  images: VisionImagePart[];
  minIntervalMs?: number;
  /** Stream the answer: pieces of text reach the caller as they arrive. */
  stream?: boolean;
};
/** An embedding call brokered by the main process: the worker never sees keys. */
export type EmbeddingRequest = {
  embedding: true;
  provider: EmbeddingApiProvider;
  model: string;
  dimensions: number;
  profiles: Partial<Record<ApiProvider, ApiProfile>>;
  remoteEnabled: boolean;
  minIntervalMs?: number;
  inputs: (
    | { text: string; role: "query" | "document" }
    | { image: string; mimeType: "image/jpeg" | "image/png" }
  )[];
};
export class ApiFailure extends Error {
  fatal = true;
}
export class ApiProviders {
  nextRequest = new Map<string, number>();
  constructor(
    public secrets: Secrets,
    public fetcher: typeof fetch = fetch,
    public authorizeEndpoint?: (
      provider: ApiProvider,
      base: string,
    ) => Promise<boolean>,
  ) {}
  keyStatus() {
    return {
      encryptionAvailable: this.secrets.encryption.available(),
      providers: Object.fromEntries(
        Object.keys(PROVIDERS).map((p) => [
          p,
          !!this.secrets.get(p as ApiProvider),
        ]),
      ),
    };
  }
  private async request(
    provider: ApiProvider,
    base: string,
    route: string,
    body: unknown,
    signal: AbortSignal,
    expectedBase?: string,
    limits: { bytes: number; timeoutMs: number } = { bytes: 8 * 2 ** 20, timeoutMs: 120_000 },
  ) {
    const response = await this.open(provider, base, route, body, signal, expectedBase, limits.timeoutMs);
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    if (!response.body) throw new ApiFailure("Respuesta vacía.");
    for await (const chunk of response.body as any) {
      bytes += chunk.length;
      if (bytes > limits.bytes)
        throw new ApiFailure("Respuesta del proveedor demasiado grande.");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  /** Sends one request (with key checks and retries) and returns the open response. */
  private async open(
    provider: ApiProvider,
    base: string,
    route: string,
    body: unknown,
    signal: AbortSignal,
    expectedBase?: string,
    timeoutMs = 120_000,
  ): Promise<Response> {
    const key = this.secrets.get(provider);
    if (key) {
      const official = PROVIDERS[provider].baseUrl;
      const expected =
        expectedBase ?? (official ? providerBase(provider, {}) : null);
      if (
        base !== expected &&
        !(await this.authorizeEndpoint?.(provider, base))
      )
        throw new ApiFailure(
          "Autoriza el destino personalizado antes de enviarle una clave guardada.",
        );
    }
    if (!key && !isLoopbackUrl(base))
      throw new ApiFailure("Configura la clave del proveedor en Ajustes.");
    const form = typeof FormData !== "undefined" && body instanceof FormData;
    const headers: Record<string, string> = form ? {} : { "Content-Type": "application/json" };
    if (provider === "anthropic") {
      if (key) headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    } else if (provider === "gemini" && expectedBase) {
      // Gemini's native endpoints (embeddings) take the key in their own header.
      if (key) headers["x-goog-api-key"] = key;
    } else if (key) headers.Authorization = `Bearer ${key}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs),
        combined = AbortSignal.any([signal, timeout]);
      let response: Response;
      try {
        response = await this.fetcher(base + route, {
          method: body ? "POST" : "GET",
          headers,
          body: form ? (body as FormData) : body ? JSON.stringify(body) : undefined,
          signal: combined,
          redirect: "error",
        });
      } catch (error) {
        if (signal.aborted) throw new Error("Solicitud cancelada.");
        throw new ApiFailure(
          "No se pudo conectar con el proveedor. Comprueba el endpoint y la conexión.",
        );
      }
      if (response.ok) return response;
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
        const delay = Math.min(
          30_000,
          Math.max(
            1000,
            Number(response.headers.get("retry-after")) * 1000 ||
              1000 * 2 ** attempt,
          ),
        );
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new Error("Solicitud cancelada."));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, delay);
          signal.addEventListener("abort", abort, { once: true });
        });
        continue;
      }
      throw new ApiFailure(
        `${PROVIDERS[provider].label}: HTTP ${response.status}. Revisa la clave, el modelo y su compatibilidad con imágenes. La tarea puede reanudarse.`,
      );
    }
    throw new ApiFailure("El proveedor no está disponible.");
  }
  /** A vision completion streamed piece by piece (AI properties). */
  completeStream(
    input: CompletionRequest,
    onText: (text: string) => void,
    signal: AbortSignal,
  ) {
    const anthropic = input.choice.provider === "anthropic";
    return this.chatStream(
      {
        choice: input.choice,
        profiles: input.profiles,
        remoteEnabled: input.remoteEnabled,
        system: input.system,
        messages: [
          {
            role: "user",
            content: anthropic
              ? anthropicVisionContent(input.prompt, input.images)
              : openAiVisionContent(input.prompt, input.images),
          },
        ],
        maxTokens: 1200,
      },
      onText,
      signal,
    );
  }
  async complete(input: CompletionRequest, signal: AbortSignal) {
    if (input.choice.provider === "local")
      throw new Error("El modelo local no usa esta conexión.");
    const provider = input.choice.provider,
      base = providerBase(provider, input.profiles);
    if (!input.remoteEnabled && !isLoopbackUrl(base))
      throw new ApiFailure(
        "Las APIs remotas están desactivadas. No se ha enviado ningún dato.",
      );
    const start = Math.max(Date.now(), this.nextRequest.get(provider) ?? 0);
    this.nextRequest.set(
      provider,
      start + Math.min(60000, Math.max(0, input.minIntervalMs ?? 0)),
    );
    if (start > Date.now())
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new Error("Solicitud cancelada."));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, start - Date.now());
        signal.addEventListener("abort", abort, { once: true });
      });
    const result =
      provider === "anthropic"
        ? await this.request(
            provider,
            base,
            "/messages",
            {
              model: input.choice.model,
              max_tokens: 1000,
              system: input.system,
              messages: [
                {
                  role: "user",
                  content: anthropicVisionContent(input.prompt, input.images),
                },
              ],
            },
            signal,
          )
        : await this.request(
            provider,
            base,
            "/chat/completions",
            {
              model: input.choice.model,
              messages: [
                { role: "system", content: input.system },
                {
                  role: "user",
                  content: openAiVisionContent(input.prompt, input.images),
                },
              ],
              ...(provider === "openai"
                ? { max_completion_tokens: 1000 }
                : { max_tokens: 1000 }),
              stream: false,
            },
            signal,
          );
    const text =
      provider === "anthropic"
        ? result.content
            ?.filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n")
        : result.choices?.[0]?.message?.content;
    if (typeof text !== "string")
      throw new Error("El proveedor no devolvió una respuesta de texto.");
    return text;
  }
  /**
   * A chat answer, streamed. `onText` receives each piece of text as it
   * arrives; the full text is returned at the end. Works with Anthropic and
   * with every OpenAI-compatible endpoint (OpenAI, OpenRouter, Gemini,
   * Ollama, LM Studio…).
   */
  async chatStream(
    input: {
      choice: ModelChoice;
      profiles: Partial<Record<ApiProvider, ApiProfile>>;
      remoteEnabled: boolean;
      system: string;
      /** Plain text, or a provider's vision content array. */
      messages: { role: "user" | "assistant"; content: unknown }[];
      maxTokens?: number;
    },
    onText: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    if (input.choice.provider === "local")
      throw new ApiFailure("El chat usa un modelo de un proveedor o de un servidor local (Ollama, LM Studio).");
    const provider = input.choice.provider,
      base = providerBase(provider, input.profiles);
    if (!input.remoteEnabled && !isLoopbackUrl(base))
      throw new ApiFailure(
        "Las APIs remotas están desactivadas. No se ha enviado ningún dato.",
      );
    const maxTokens = input.maxTokens ?? 4096;
    const anthropic = provider === "anthropic";
    const response = await this.open(
      provider,
      base,
      anthropic ? "/messages" : "/chat/completions",
      anthropic
        ? {
            model: input.choice.model,
            max_tokens: maxTokens,
            system: input.system,
            messages: input.messages,
            stream: true,
          }
        : {
            model: input.choice.model,
            messages: [{ role: "system", content: input.system }, ...input.messages],
            ...(provider === "openai"
              ? { max_completion_tokens: maxTokens }
              : { max_tokens: maxTokens }),
            stream: true,
          },
      signal,
      undefined,
      10 * 60_000,
    );
    if (!response.body) throw new ApiFailure("Respuesta vacía.");
    const decoder = new TextDecoder();
    let buffer = "",
      text = "";
    // A provider that ignores `stream` answers with plain JSON.
    if (!/event-stream/i.test(response.headers.get("content-type") ?? "")) {
      for await (const chunk of response.body as any) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 8 * 2 ** 20)
          throw new ApiFailure("Respuesta del proveedor demasiado grande.");
      }
      const result = JSON.parse(buffer);
      const answer = anthropic
        ? result.content?.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
        : result.choices?.[0]?.message?.content;
      if (typeof answer !== "string")
        throw new Error("El proveedor no devolvió una respuesta de texto.");
      onText(answer);
      return answer;
    }
    try {
      const chunks = async function* () {
        for await (const chunk of response.body as any) yield decoder.decode(chunk, { stream: true });
        // The last event may arrive without its blank line.
        yield decoder.decode() + "\n\n";
      };
      for await (const piece of chunks()) {
        buffer += piece;
        const { events, rest } = splitSse(buffer);
        buffer = rest;
        for (const event of events) {
          const data = sseData(event);
          if (data == null) continue;
          const delta = streamDelta(anthropic ? "anthropic" : "openai", data);
          if (delta.error) throw new ApiFailure(`${PROVIDERS[provider].label}: ${delta.error}`);
          if (delta.text) {
            text += delta.text;
            if (text.length > 2 * 2 ** 20)
              throw new ApiFailure("Respuesta del proveedor demasiado grande.");
            onText(delta.text);
          }
        }
      }
    } catch (error) {
      if (signal.aborted) throw new Error("Solicitud cancelada.");
      throw error;
    }
    return text;
  }
  /**
   * An edited image: OpenAI's image edits, Gemini's native image output, or
   * the chat completions with image output of OpenRouter and compatible
   * servers. Returns the image bytes.
   */
  async editImage(
    input: {
      choice: { provider: ApiProvider; model: string };
      profiles: Partial<Record<ApiProvider, ApiProfile>>;
      remoteEnabled: boolean;
      prompt: string;
      image: Buffer;
      mimeType: "image/jpeg" | "image/png";
      /** The aspect ratio closest to the image sent ("3:4"), so the answer keeps its shape. */
      aspect?: string;
    },
    signal: AbortSignal,
  ): Promise<Buffer> {
    const { provider, model } = input.choice,
      style = IMAGE_API[provider];
    if (!style) throw new ApiFailure("Este proveedor no genera imágenes. Elige OpenAI, Gemini, OpenRouter o un servidor compatible.");
    const base = providerBase(provider, input.profiles);
    if (!input.remoteEnabled && !isLoopbackUrl(base))
      throw new ApiFailure("Las APIs remotas están desactivadas. No se ha enviado ningún dato.");
    const limits = { bytes: 64 * 2 ** 20, timeoutMs: 5 * 60_000 };
    const b64 = input.image.toString("base64");
    let out: string | undefined;
    // What the model said instead of an image (a refusal, a question): shown in the error.
    let said = "";
    if (style === "openai-images") {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", input.prompt);
      form.append("n", "1");
      form.append("image", new Blob([new Uint8Array(input.image)], { type: input.mimeType }), input.mimeType === "image/png" ? "image.png" : "image.jpg");
      const result = await this.request(provider, base, "/images/edits", form, signal, undefined, limits);
      out = result.data?.[0]?.b64_json;
    } else if (style === "gemini") {
      const native = geminiNativeBase(base),
        id = model.trim().replace(/^models\//, "");
      const result = await this.request(
        provider,
        native,
        `/models/${encodeURIComponent(id)}:generateContent`,
        {
          contents: [{ role: "user", parts: [{ text: input.prompt }, { inline_data: { mime_type: input.mimeType, data: b64 } }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"], ...(input.aspect ? { imageConfig: { aspectRatio: input.aspect } } : {}) },
        },
        signal,
        geminiNativeBase(providerBase(provider, {})),
        limits,
      );
      const candidate = result.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        const data = part.inline_data?.data ?? part.inlineData?.data;
        if (typeof data === "string") out = data;
        else if (typeof part.text === "string" && !part.thought) said += part.text;
      }
      const reason = candidate?.finishReason ?? result.promptFeedback?.blockReason;
      if (!out && reason && reason !== "STOP") said = `${said} (${reason})`.trim();
    } else {
      const result = await this.request(
        provider,
        base,
        "/chat/completions",
        {
          model,
          modalities: ["image", "text"],
          ...(provider === "openrouter" && input.aspect ? { image_config: { aspect_ratio: input.aspect } } : {}),
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: input.prompt },
                { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${b64}` } },
              ],
            },
          ],
        },
        signal,
        undefined,
        limits,
      );
      const message = result.choices?.[0]?.message;
      const url: unknown = message?.images?.[0]?.image_url?.url ?? message?.images?.[0]?.url;
      if (typeof url === "string") out = /^data:image\/[a-z+]+;base64,/.exec(url) ? url.slice(url.indexOf(",") + 1) : undefined;
      if (!out && Array.isArray(message?.content))
        for (const part of message.content) {
          const u = part?.image_url?.url;
          if (typeof u === "string" && u.startsWith("data:image/")) out = u.slice(u.indexOf(",") + 1);
          else if (typeof part?.text === "string") said += part.text;
        }
      if (typeof message?.content === "string") said += message.content;
    }
    if (!out)
      throw new ApiFailure(
        said.trim()
          ? `${PROVIDERS[provider].label}: el modelo no devolvió ninguna imagen. Respondió: «${said.trim().slice(0, 300)}»`
          : `${PROVIDERS[provider].label}: el modelo no devolvió ninguna imagen. Comprueba que el modelo genera imágenes.`,
      );
    const bytes = Buffer.from(out, "base64");
    if (bytes.length < 100) throw new ApiFailure("La imagen recibida está vacía o dañada.");
    return bytes;
  }
  async embed(
    input: EmbeddingRequest,
    signal: AbortSignal,
  ): Promise<number[][]> {
    const provider = input.provider,
      base = providerBase(provider, input.profiles);
    if (!input.remoteEnabled && !isLoopbackUrl(base))
      throw new ApiFailure(
        "Las APIs remotas están desactivadas. No se ha enviado ningún dato.",
      );
    if (!input.inputs.length) return [];
    const images = input.inputs.some((item) => "image" in item);
    if (images && !embeddingApiMultimodal(input))
      throw new ApiFailure(
        "Este modelo de embeddings solo admite texto; no se ha enviado ninguna imagen.",
      );
    const start = Math.max(Date.now(), this.nextRequest.get(provider) ?? 0);
    this.nextRequest.set(
      provider,
      start + Math.min(60000, Math.max(0, input.minIntervalMs ?? 0)),
    );
    if (start > Date.now())
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new Error("Solicitud cancelada."));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, start - Date.now());
        signal.addEventListener("abort", abort, { once: true });
      });
    let vectors: unknown[];
    if (provider === "gemini") {
      const native = geminiNativeBase(base),
        model = input.model.trim().replace(/^models\//, ""),
        legacy = !/gemini-embedding-2/.test(model);
      const result = await this.request(
        provider,
        native,
        `/models/${encodeURIComponent(model)}:batchEmbedContents`,
        {
          requests: input.inputs.map((item) => ({
            model: `models/${model}`,
            content: {
              parts: [
                "image" in item
                  ? {
                      inline_data: {
                        mime_type: item.mimeType,
                        data: item.image,
                      },
                    }
                  : {
                      text: legacy
                        ? item.text
                        : embeddingApiText(model, item.role, item.text),
                    },
              ],
            },
            output_dimensionality: input.dimensions,
            ...(legacy && "role" in item
              ? {
                  taskType:
                    item.role === "query"
                      ? "RETRIEVAL_QUERY"
                      : "RETRIEVAL_DOCUMENT",
                }
              : {}),
          })),
        },
        signal,
        geminiNativeBase(providerBase(provider, {})),
      );
      vectors = (result.embeddings ?? []).map((e: any) => e?.values);
    } else {
      const result = await this.request(
        provider,
        base,
        "/embeddings",
        {
          model: input.model,
          input: input.inputs.map((item) =>
            embeddingApiText(
              input.model,
              (item as { role: "query" | "document" }).role,
              (item as { text: string }).text,
            ),
          ),
          encoding_format: "float",
          ...(embeddingApiResizable(input)
            ? { dimensions: input.dimensions }
            : {}),
        },
        signal,
      );
      const data = [...(result.data ?? [])].sort(
        (a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0),
      );
      vectors = data.map((e: any) => e?.embedding);
    }
    if (
      vectors.length !== input.inputs.length ||
      vectors.some(
        (v) =>
          !Array.isArray(v) ||
          !v.length ||
          !v.every((x) => typeof x === "number" && Number.isFinite(x)) ||
          !v.some((x) => x !== 0),
      )
    )
      throw new ApiFailure(
        `${PROVIDERS[provider].label}: el modelo de embeddings devolvió vectores vacíos, inválidos o en distinto número que las entradas.`,
      );
    return vectors as number[][];
  }
  /**
   * A provider's catalogue, as Nodus lists it: each model with its name,
   * context, whether it accepts images and whether it returns them. Sorted by
   * id; OpenRouter by upstream provider, then id. OpenRouter's catalogue is
   * public, so it is read without a key when none is saved.
   */
  async list(
    provider: ApiProvider,
    profiles: Partial<Record<ApiProvider, ApiProfile>>,
    remoteEnabled: boolean,
    signal: AbortSignal,
  ): Promise<ProviderModel[]> {
    const base = providerBase(provider, profiles);
    if (!remoteEnabled && !isLoopbackUrl(base))
      throw new ApiFailure(
        "Activa el uso opcional de APIs para consultar este catálogo.",
      );
    const limits = { bytes: 32 * 2 ** 20, timeoutMs: 30_000 };
    let result: any;
    if (provider === "gemini")
      result = await this.request(
        provider,
        geminiNativeBase(base),
        "/models?pageSize=1000",
        null,
        signal,
        geminiNativeBase(providerBase(provider, {})),
        limits,
      );
    else if (provider === "anthropic")
      result = await this.request(provider, base, "/models?limit=1000", null, signal, undefined, limits);
    else if (provider === "openrouter" && !this.secrets.get(provider) && base === providerBase(provider, {}))
      result = await this.publicCatalog(`${base}/models`, signal, limits);
    else result = await this.request(provider, base, "/models", null, signal, undefined, limits);
    const rows: any[] = Array.isArray(result?.data) ? result.data : Array.isArray(result?.models) ? result.models : [];
    const models = rows.map((m) => catalogModel(provider, m)).filter((m): m is ProviderModel => !!m);
    return provider === "openrouter"
      ? models.sort((a, b) => (a.group === b.group ? a.id.localeCompare(b.id) : (a.group ?? "").localeCompare(b.group ?? "")))
      : models.sort((a, b) => a.id.localeCompare(b.id));
  }
  /** A public catalogue (OpenRouter's), read without any key. */
  private async publicCatalog(url: string, signal: AbortSignal, limits: { bytes: number; timeoutMs: number }) {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(limits.timeoutMs)]),
        redirect: "error",
      });
    } catch {
      if (signal.aborted) throw new Error("Solicitud cancelada.");
      throw new ApiFailure("No se pudo conectar con el proveedor. Comprueba el endpoint y la conexión.");
    }
    if (!response.ok) throw new ApiFailure(`HTTP ${response.status} al consultar el catálogo.`);
    const text = await response.text();
    if (text.length > limits.bytes) throw new ApiFailure("Respuesta del proveedor demasiado grande.");
    return JSON.parse(text);
  }
  private imageCache: { signature: string; at: number; models: ImageCatalogModel[] } | null = null;
  /**
   * The image models of the providers that can edit images and have a saved
   * key, read from their catalogues (kept for ten minutes). A provider whose
   * catalogue cannot be read offers its suggested models instead.
   */
  async imageCatalog(
    profiles: Partial<Record<ApiProvider, ApiProfile>>,
    remoteEnabled: boolean,
    refresh: boolean,
    signal: AbortSignal,
  ): Promise<ImageCatalogModel[]> {
    const candidates = (["openai", "gemini", "openrouter"] as const).filter((p) => IMAGE_API[p] && this.secrets.get(p));
    const signature = JSON.stringify([candidates, candidates.map((p) => profiles[p]?.baseUrl ?? ""), remoteEnabled]);
    if (!refresh && this.imageCache?.signature === signature && Date.now() - this.imageCache.at < 10 * 60_000)
      return this.imageCache.models;
    const groups = await Promise.all(
      candidates.map(async (provider) => {
        try {
          const found = (await this.list(provider, profiles, remoteEnabled, signal))
            .filter((m) => m.imageOutput)
            .map((m) => ({ provider, model: m.id, ...(m.name && m.name !== m.id ? { name: m.name } : {}) }));
          if (found.length) return found;
        } catch {
          if (signal.aborted) throw new Error("Solicitud cancelada.");
        }
        return (SUGGESTED_IMAGE_MODELS[provider] ?? []).map((model) => ({ provider, model }));
      }),
    );
    const models = groups.flat();
    this.imageCache = { signature, at: Date.now(), models };
    return models;
  }
}

const contextOf = (...values: unknown[]) =>
  values.find((v): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1024);
/** One row of a provider's /models answer, as a catalogue model. */
function catalogModel(provider: ApiProvider, m: any): ProviderModel | null {
  if (provider === "gemini") {
    if (typeof m?.name !== "string") return null;
    const id = m.name.replace(/^models\//, ""),
      methods: string[] = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
    return {
      id,
      ...(typeof m.displayName === "string" ? { name: m.displayName } : {}),
      contextLength: contextOf(m.inputTokenLimit),
      // Imagen answers through «predict», which Imago does not use.
      imageOutput: /image/i.test(id) && !/^imagen/i.test(id) && methods.includes("generateContent"),
    };
  }
  if (typeof m?.id !== "string" || !m.id.trim()) return null;
  const input: string[] | undefined = m.architecture?.input_modalities,
    output: string[] | undefined = m.architecture?.output_modalities;
  const vision = Array.isArray(input) ? input.includes("image") : typeof m.capabilities?.vision === "boolean" ? m.capabilities.vision : undefined;
  return {
    id: m.id,
    ...(typeof m.name === "string" ? { name: m.name } : typeof m.display_name === "string" ? { name: m.display_name } : {}),
    ...(provider === "openrouter" ? { group: m.id.includes("/") ? m.id.split("/")[0] : "other" } : {}),
    contextLength: contextOf(m.context_length, m.top_provider?.context_length, m.context_window, m.max_context_length, m.max_model_len, m.max_input_tokens),
    vision,
    // An edit needs an image in and an image out; OpenAI edits with its image models.
    imageOutput:
      provider === "openai"
        ? /^(gpt-image|chatgpt-image)/.test(m.id)
        : Array.isArray(output) && output.includes("image") && vision !== false,
  };
}

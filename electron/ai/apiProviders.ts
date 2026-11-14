import { Secrets } from "../secrets/store";
import {
  PROVIDERS,
  providerBase,
  isLoopbackUrl,
  type ApiProfile,
  type ApiProvider,
  type ModelChoice,
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
export type CompletionRequest = {
  choice: ModelChoice;
  profiles: Partial<Record<ApiProvider, ApiProfile>>;
  remoteEnabled: boolean;
  prompt: string;
  system: string;
  images: VisionImagePart[];
  minIntervalMs?: number;
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
  ) {
    const response = await this.open(provider, base, route, body, signal, expectedBase);
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    if (!response.body) throw new ApiFailure("Respuesta vacía.");
    for await (const chunk of response.body as any) {
      bytes += chunk.length;
      if (bytes > 8 * 2 ** 20)
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
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
          body: body ? JSON.stringify(body) : undefined,
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
      messages: { role: "user" | "assistant"; content: string }[];
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
  async list(
    provider: ApiProvider,
    profiles: Partial<Record<ApiProvider, ApiProfile>>,
    remoteEnabled: boolean,
    signal: AbortSignal,
  ) {
    const base = providerBase(provider, profiles);
    if (!remoteEnabled && !isLoopbackUrl(base))
      throw new ApiFailure(
        "Activa el uso opcional de APIs para consultar este catálogo.",
      );
    const result = await this.request(provider, base, "/models", null, signal);
    return (result.data ?? [])
      .filter((m: any) => typeof m.id === "string")
      .map((m: any) => m.id as string)
      .sort();
  }
}

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
export type CompletionRequest = {
  choice: ModelChoice;
  profiles: Partial<Record<ApiProvider, ApiProfile>>;
  remoteEnabled: boolean;
  prompt: string;
  system: string;
  images: VisionImagePart[];
  minIntervalMs?: number;
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
  ) {
    const key = this.secrets.get(provider);
    if (key) {
      const official = PROVIDERS[provider].baseUrl;
      const expected = official ? providerBase(provider, {}) : null;
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
    } else if (key) headers.Authorization = `Bearer ${key}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const timeout = AbortSignal.timeout(120_000),
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
      if (response.ok) {
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

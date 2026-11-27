// Provider identifiers, labels and endpoints adapted from Nodus shared/providers.ts
// and electron/ai/providers.ts. Managed OAuth/chat subscriptions are outside Imago.
export const PROVIDERS = {
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  gemini: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  cerebras: { label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  xiaomi: { label: "Xiaomi MiMo", baseUrl: "https://api.xiaomimimo.com/v1" },
  ollama: { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  lmstudio: { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  custom: { label: "Personalizado · OpenAI compatible", baseUrl: "" },
} as const;
export type ApiProvider = keyof typeof PROVIDERS;
export type ModelChoice = { provider: "local" | ApiProvider; model: string };
/**
 * A provider's endpoint and its favourite models: the ones starred in
 * Settings, offered by every model selector (as Nodus's favourites).
 */
export type ApiProfile = { baseUrl: string; models: string[] };
/** A model of a provider's catalogue, with what the listing says about it. */
export type ProviderModel = {
  id: string;
  name?: string;
  /** OpenRouter: the upstream provider, the part of the id before «/». */
  group?: string;
  /** Most tokens of context, when the catalogue publishes it. */
  contextLength?: number;
  /** Accepts images; undefined when the catalogue does not say. */
  vision?: boolean;
  /** Returns images: usable in AI restoration. */
  imageOutput?: boolean;
};
/** An image model of a provider with a saved key, for AI restoration. */
export type ImageCatalogModel = { provider: ApiProvider; model: string; name?: string };
export type VisionCatalogModel = { choice: ModelChoice; name: string; remote: boolean };
export function isLoopbackUrl(value: string) {
  try {
    const u = new URL(value);
    return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}
/**
 * Whether a provider is reached over the network with the endpoint saved:
 * every cloud provider, and a local server or gateway outside this computer.
 * Its key can only be entered while remote APIs are allowed.
 */
export function remoteProvider(provider: ApiProvider, profiles: Partial<Record<ApiProvider, ApiProfile>>) {
  const base = profiles[provider]?.baseUrl || PROVIDERS[provider].baseUrl;
  return !base || !isLoopbackUrl(base);
}
export function providerBase(
  provider: ApiProvider,
  profiles: Partial<Record<ApiProvider, ApiProfile>>,
): string {
  const value = (profiles[provider]?.baseUrl || PROVIDERS[provider].baseUrl)
    .trim()
    .replace(/\/+$/, "");
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !["https:", "http:"].includes(u.protocol) ||
    (u.protocol === "http:" && !isLoopbackUrl(value))
  )
    throw new Error(
      "Usa HTTPS, o HTTP solo para servicios de este equipo. No incluyas claves en la URL.",
    );
  return u.href.replace(/\/+$/, "");
}
export function modelChoiceLabel(choice: ModelChoice) {
  return (
    (choice.provider === "local" ? "Local" : PROVIDERS[choice.provider].label) +
    " · " +
    choice.model
  );
}

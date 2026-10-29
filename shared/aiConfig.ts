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
export type ApiProfile = { baseUrl: string; models: string[] };
export function isLoopbackUrl(value: string) {
  try {
    const u = new URL(value);
    return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
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

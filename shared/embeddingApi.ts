// Embeddings served by an API, as in Nodus Research (OpenAI, Gemini,
// OpenRouter, Ollama, LM Studio or any OpenAI-compatible endpoint). Imago adds
// multimodal models: Gemini Embedding 2 places images and text in one space,
// like the local EmbeddingGemma 2, so a modest computer can index a large image
// collection without running the vision encoder itself.
import type { ApiProvider } from "./aiConfig";

export const API_EMBEDDING_ID = "api-embedding";
export type EmbeddingApiChoice = {
  provider: EmbeddingApiProvider;
  model: string;
  dimensions: number;
};
export const EMBEDDING_API_PROVIDERS = [
  "gemini",
  "openai",
  "openrouter",
  "ollama",
  "lmstudio",
  "custom",
] as const satisfies readonly ApiProvider[];
export type EmbeddingApiProvider = (typeof EMBEDDING_API_PROVIDERS)[number];

/** Suggested models per provider, first one the default. */
export const EMBEDDING_API_MODELS: Record<EmbeddingApiProvider, string[]> = {
  gemini: ["gemini-embedding-2", "gemini-embedding-001"],
  openai: ["text-embedding-3-small", "text-embedding-3-large"],
  openrouter: ["baai/bge-m3", "openai/text-embedding-3-small"],
  ollama: ["embeddinggemma", "nomic-embed-text", "bge-m3"],
  lmstudio: ["text-embedding-nomic-embed-text-v1.5"],
  custom: [""],
};
export const DEFAULT_EMBEDDING_API: EmbeddingApiChoice = {
  provider: "gemini",
  model: "gemini-embedding-2",
  dimensions: 768,
};
/** Vector sizes offered in Settings; a provider may also return its native size. */
export const EMBEDDING_API_DIMENSIONS = [256, 384, 512, 768, 1024, 1536, 3072];

/** Whether the model embeds images itself, in the same space as text. */
export function embeddingApiMultimodal(
  choice: Pick<EmbeddingApiChoice, "provider" | "model">,
) {
  return (
    choice.provider === "gemini" &&
    /^(models\/)?gemini-embedding-2\b/.test(choice.model.trim())
  );
}

/** Whether the provider can return a requested number of dimensions. */
export function embeddingApiResizable(
  choice: Pick<EmbeddingApiChoice, "provider" | "model">,
) {
  return (
    choice.provider === "gemini" ||
    (choice.provider === "openai" && /text-embedding-3/.test(choice.model))
  );
}

/**
 * Text as the model was trained to receive it. Gemini Embedding 2 and
 * EmbeddingGemma use task prefixes in the text; Gemini Embedding 001 takes a
 * task type instead (sent separately); E5 and Nomic use their own prefixes.
 */
export function embeddingApiText(
  model: string,
  role: "query" | "document",
  text: string,
): string {
  const id = model.toLowerCase();
  if (/gemini-embedding-2|embeddinggemma/.test(id))
    return role === "query"
      ? `task: search result | query: ${text}`
      : `title: none | text: ${text}`;
  if (/nomic-embed/.test(id))
    return (role === "query" ? "search_query: " : "search_document: ") + text;
  if (/(^|[/-])e5\b|multilingual-e5/.test(id))
    return (role === "query" ? "query: " : "passage: ") + text;
  return text;
}

/** Gemini's native endpoint lives beside its OpenAI-compatible one. */
export function geminiNativeBase(openAiCompatibleBase: string) {
  return openAiCompatibleBase.replace(/\/openai$/, "");
}

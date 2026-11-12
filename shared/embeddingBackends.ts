import {
  EMBEDDING_GEMMA2_REVISION,
  prepareEmbeddingGemma2Input,
} from "./embeddingGemma2";
import {
  createEmbeddingContract,
  canonicalizeEmbeddingContract,
} from "./embeddingContract";
export { prepareEmbeddingGemma2Input };
export const HARRIER_ID = "harrier-oss-v1-0.6b-q8_0";
export const ONNX_ID = "embeddinggemma2-onnx";
export const LEGACY_EMBEDDING_ID = "embeddinggemma2";
// Exact web_search_query training instruction reused from Nodus embeddingInputProfiles.ts.
export const HARRIER_QUERY_PREFIX =
  "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ";
export const HARRIER_REVISION = "d79decec1ab9442e969e79804515b9c31683d30e";
export const HARRIER_IMAGE_PROMPT =
  "Describe only visible content of this image in English for an image retrieval index. Include subjects, setting, objects, actions and composition. Do not infer names, dates or places. No introduction or commentary. Maximum 150 words.";
export const defaultEmbeddingModel = (platform: string, arch: string) =>
  platform === "darwin" && arch === "x64" ? HARRIER_ID : ONNX_ID;
export const embeddingDimensions = (model: string, dimensions: number) =>
  model === HARRIER_ID ? 1024 : dimensions;
export function embeddingBackendContract(
  model: string,
  dimensions: number,
  visionRevision: string,
) {
  return canonicalizeEmbeddingContract(
    createEmbeddingContract({
      provider: "imago",
      model,
      dim: embeddingDimensions(model, dimensions),
      protocol:
        model === HARRIER_ID
          ? "imago.harrier-local-caption/1"
          : "imago.embeddinggemma2-multimodal/1",
      task:
        model === HARRIER_ID
          ? { query: HARRIER_QUERY_PREFIX, document: "" }
          : {
              query: "task: search result | query: ",
              document: "title: {title|none} | text: ",
            },
      preprocessing:
        model === HARRIER_ID
          ? {
              weights: HARRIER_REVISION,
              runtime: "llama.cpp-b11981",
              pooling: "last",
              maxTokens: 8192,
              inputCharacters: 8000,
              visionRevision,
              imagePrompt: HARRIER_IMAGE_PROMPT,
              imagePreparation: "oriented-srgb-png-2200-v1",
            }
          : {
              weights: EMBEDDING_GEMMA2_REVISION,
              runtime: "onnxruntime-node-1.30.0",
              transformers: "4.3.1",
              tokenizer: EMBEDDING_GEMMA2_REVISION,
              maxTokens: 8192,
              specialTokens: true,
              truncation: false,
              output: "sentence_embedding",
              projection: "onnx-model",
              reduction: "matryoshka-prefix",
              titleFallback: "none",
              visionTokens: 280,
              audio: false,
              imagePreparation: "oriented-srgb-png-2200-v1",
            },
      normalization: "l2-after-reduction",
      quantization: model === HARRIER_ID ? "Q8_0" : "onnx-q8",
      configVersion: 1,
    }),
  );
}

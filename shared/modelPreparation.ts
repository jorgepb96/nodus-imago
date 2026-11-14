import type { ModelInfo } from "./imago";
export type ModelPreparation = {
  embeddingModel: string;
  requirements: ModelInfo[];
  remainingBytes: number;
  freeBytes: number;
  destination: string;
  supported: boolean;
  ready: boolean;
  activeDimensions: number;
  priorVectors: number;
  runtime: "onnx-cpu" | "llama-cpu" | "python-experimental" | "api";
};
export type ModelPreparationStep = { id: string; fileIndex: number | null };

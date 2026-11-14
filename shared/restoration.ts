// AI restoration workshop: tasks, the providers that can edit images, and
// what a saved version records. The original image is never modified: each
// result is a separate version linked to it, with the model and instructions
// that produced it.
import type { ApiProvider } from "./aiConfig";

export type RestorationTask = "restore" | "repair" | "sharpen" | "colorize" | "custom";
export type WatermarkPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";
export type Watermark = { enabled: boolean; text: string; position: WatermarkPosition };
export type ImageApiStyle = "openai-images" | "gemini" | "chat-images";

/** How each provider is asked for an edited image; absent: it cannot produce images. */
export const IMAGE_API: Partial<Record<ApiProvider, ImageApiStyle>> = {
  openai: "openai-images",
  gemini: "gemini",
  openrouter: "chat-images",
  custom: "chat-images",
  ollama: "chat-images",
  lmstudio: "chat-images",
};
/** Image models offered for each provider; any other id can be added by hand. */
export const SUGGESTED_IMAGE_MODELS: Partial<Record<ApiProvider, string[]>> = {
  openai: ["gpt-image-1", "gpt-image-1-mini"],
  gemini: ["gemini-2.5-flash-image"],
  openrouter: ["google/gemini-2.5-flash-image", "openai/gpt-5-image-mini"],
};

export type Restoration = {
  id: string;
  assetId: string;
  rowId: string;
  title: string;
  provider: ApiProvider;
  model: string;
  task: RestorationTask;
  prompt: string;
  /** The region restored, in fractions of the image; null: the whole image. */
  region: { x: number; y: number; w: number; h: number } | null;
  width: number;
  height: number;
  createdAt: string;
};

type Language = "es" | "en";
const FIDELITY: Record<Language, string> = {
  es: "Conserva exactamente la composición, el encuadre, las personas, los rostros, la ropa, los edificios y los textos. No añadas ni elimines elementos.",
  en: "Keep the composition, framing, people, faces, clothing, buildings and text exactly as they are. Do not add or remove anything.",
};
const TASKS: Record<Exclude<RestorationTask, "custom">, Record<Language, string>> = {
  restore: {
    es: "Restaura esta fotografía histórica: elimina el polvo, los arañazos, las manchas y el ruido, y corrige el desvanecimiento. Mantén el grano y la tonalidad original de la época (blanco y negro, sepia o virado).",
    en: "Restore this historical photograph: remove dust, scratches, stains and noise, and correct fading. Keep the grain and the original tone of the period (black and white, sepia or toned).",
  },
  repair: {
    es: "Repara los daños físicos de esta imagen histórica: roturas, pliegues, esquinas perdidas, zonas borradas o manchas de humedad. Reconstruye solo lo dañado, de forma coherente con lo que se ve alrededor y sin inventar detalles.",
    en: "Repair the physical damage in this historical image: tears, creases, missing corners, erased areas or water stains. Rebuild only what is damaged, consistently with its surroundings and without inventing details.",
  },
  sharpen: {
    es: "Mejora la nitidez y la legibilidad de esta imagen histórica sin cambiar su contenido: define bordes y detalles, y reduce el desenfoque leve y el ruido.",
    en: "Improve the sharpness and legibility of this historical image without changing its content: define edges and details, and reduce slight blur and noise.",
  },
  colorize: {
    es: "Colorea esta fotografía en blanco y negro con colores verosímiles para su época y lugar, con tonos naturales y moderados. Conserva la luz y los detalles.",
    en: "Colourise this black-and-white photograph with colours plausible for its period and place, using natural, moderate tones. Keep the light and the details.",
  },
};
export const TASK_LABELS: Record<RestorationTask, string> = {
  restore: "Restaurar",
  repair: "Reparar daños",
  sharpen: "Mejorar nitidez",
  colorize: "Colorear",
  custom: "Instrucciones propias",
};
export const TASK_HELP: Record<RestorationTask, string> = {
  restore: "Quita polvo, arañazos, manchas y ruido, y corrige el desvanecimiento.",
  repair: "Reconstruye roturas, pliegues, esquinas perdidas y zonas borradas.",
  sharpen: "Define bordes y detalles sin cambiar el contenido.",
  colorize: "Añade colores verosímiles a una fotografía en blanco y negro.",
  custom: "Escribe tú lo que debe hacer el modelo.",
};

/** The instructions sent to the model for a task. */
export function restorationPrompt(task: RestorationTask, language: Language, region: boolean): string {
  if (task === "custom") return "";
  const crop =
    region
      ? language === "en"
        ? " This image is a crop of a larger one: return it with the same framing and size."
        : " Esta imagen es un recorte de otra mayor: devuélvela con el mismo encuadre y tamaño."
      : "";
  return `${TASKS[task][language]} ${FIDELITY[language]}${crop}`;
}

export const encodeImageModel = (provider: ApiProvider, model: string) => `${provider}|${model}`;
export function decodeImageModel(value: string): { provider: ApiProvider; model: string } | null {
  const [provider, ...rest] = value.split("|");
  const model = rest.join("|").trim();
  return provider && model && IMAGE_API[provider as ApiProvider] ? { provider: provider as ApiProvider, model } : null;
}

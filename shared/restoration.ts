// AI restoration workshop: tasks, the providers that can edit images, and
// what a saved version records. The original image is never modified: each
// result is a separate version linked to it, with the model and instructions
// that produced it.
import type { ApiProvider } from "./aiConfig";

export type RestorationTask = "restore" | "repair" | "sharpen" | "colorize" | "custom" | "upscale";
/** The tasks of the restoration workshop; "upscale" versions come from the AI upscaling section. */
export const RESTORATION_TASKS: Exclude<RestorationTask, "upscale">[] = ["restore", "repair", "sharpen", "colorize", "custom"];
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
  gemini: ["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-2.5-flash-image"],
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
  /** The version it started from; null: the original. */
  baseId: string | null;
  width: number;
  height: number;
  createdAt: string;
  /** Only right after a run: how faithful it is, and anything the user should know. */
  check?: RestorationCheck;
  notes?: string[];
  /** AI upscaling: how the version was made (scale, creativity, profile…); null for other tasks. */
  params?: import("./upscale").UpscaleParams | null;
};

import type { Language } from "./language";
const FIDELITY: Record<Language, string> = {
  es: "Fidelidad absoluta: conserva exactamente el encuadre, la composición, la perspectiva y las proporciones; las personas, sus rasgos, expresiones y peinados; la ropa, los edificios, los objetos, los textos, las inscripciones y los números. No cambies la forma de la fotografía: no recortes, no amplíes y no añadas viñetas ovaladas, marcos, esquineros ni bordes. No redibujes las caras ni lo que se ve bien: retoca solo lo dañado. No inventes detalles, no embellezcas, no suavices la piel y no modernices nada.",
  en: "Absolute fidelity: keep the framing, composition, perspective and proportions exactly; the people, their features, expressions and hair; the clothing, buildings, objects, text, inscriptions and numbers. Do not change the shape of the photograph: do not crop, zoom or add oval vignettes, frames, album corners or borders. Do not redraw faces or anything that is clearly visible: retouch only what is damaged. Do not invent details, beautify, smooth skin or modernise anything.",
  fr: "Fidélité absolue : conservez exactement le cadrage, la composition, la perspective et les proportions ; les personnes, leurs traits, expressions et coiffures ; les vêtements, les bâtiments, les objets, les textes, les inscriptions et les chiffres. Ne changez pas la forme de la photographie : ne la recadrez pas, ne l'agrandissez pas et n'ajoutez ni vignettes ovales, ni cadres, ni coins d'album, ni bordures. Ne redessinez pas les visages ni ce qui est bien visible : retouchez uniquement ce qui est abîmé. N'inventez pas de détails, n'embellissez pas, ne lissez pas la peau et ne modernisez rien.",
};
const TASKS: Record<Exclude<RestorationTask, "custom" | "upscale">, Record<Language, string>> = {
  restore: {
    es: "Restaura esta fotografía antigua como lo haría un restaurador profesional: elimina el polvo, las motas, los arañazos, las grietas finas, las manchas y el ruido, y corrige el desvanecimiento: recupera la densidad y el contraste de los tonos apagados. Mantén el grano, la textura y la tonalidad de la época (blanco y negro, sepia o virado): no la colorees.",
    en: "Restore this old photograph as a professional restorer would: remove dust, specks, scratches, fine cracks, stains and noise, and correct fading: recover the density and contrast of washed-out tones. Keep the grain, texture and tone of the period (black and white, sepia or toned): do not colourise it.",
    fr: "Restaurez cette photographie ancienne comme le ferait un restaurateur professionnel : éliminez la poussière, les petites taches, les rayures, les fines craquelures, les salissures et le bruit, et corrigez la décoloration : retrouvez la densité et le contraste des tons ternis. Conservez le grain, la texture et la tonalité de l'époque (noir et blanc, sépia ou virage) : ne la colorisez pas.",
  },
  repair: {
    es: "Repara los daños físicos de esta fotografía antigua. Son daños, y hay que eliminarlos: las manchas blancas o claras donde se ha desprendido la emulsión, las grietas, los pliegues, las roturas, los arañazos, las manchas de humedad y las esquinas o bordes perdidos. Rellena cada daño continuando lo que se ve a su alrededor (el fondo, la ropa, el pelo, la piel), con la misma textura, nitidez y grano que el resto, para que no se note dónde estaba. Mantén la tonalidad de la época: no la colorees.",
    en: "Repair the physical damage in this old photograph. These are damage and must be removed: white or light patches where the emulsion has flaked off, cracks, creases, tears, scratches, water stains and missing corners or edges. Fill each damaged spot by continuing what is around it (background, clothing, hair, skin), with the same texture, sharpness and grain as the rest, so that it cannot be seen where it was. Keep the tone of the period: do not colourise it.",
    fr: "Réparez les dommages physiques de cette photographie ancienne. Ce sont des dommages, et il faut les supprimer : les taches blanches ou claires là où l'émulsion s'est détachée, les craquelures, les plis, les déchirures, les rayures, les taches d'humidité et les coins ou bords manquants. Comblez chaque dommage en prolongeant ce qui l'entoure (le fond, les vêtements, les cheveux, la peau), avec la même texture, la même netteté et le même grain que le reste, pour qu'on ne remarque pas où il se trouvait. Conservez la tonalité de l'époque : ne la colorisez pas.",
  },
  sharpen: {
    es: "Mejora la nitidez y la legibilidad de esta imagen antigua sin cambiar su contenido: define bordes y detalles, y reduce el desenfoque leve y el ruido. No añadas texturas ni detalles que no estén.",
    en: "Improve the sharpness and legibility of this old image without changing its content: define edges and details, and reduce slight blur and noise. Do not add textures or details that are not there.",
    fr: "Améliorez la netteté et la lisibilité de cette image ancienne sans en changer le contenu : définissez les contours et les détails, et réduisez le léger flou et le bruit. N'ajoutez pas de textures ni de détails qui n'y sont pas.",
  },
  colorize: {
    es: "Colorea esta fotografía en blanco y negro con colores verosímiles para su época y su lugar: tonos naturales, sobrios y coherentes con la luz de la escena. Cambia solo el color: conserva cada detalle, la textura, las luces y las sombras.",
    en: "Colourise this black-and-white photograph with colours plausible for its period and place: natural, restrained tones consistent with the light of the scene. Change only the colour: keep every detail, the texture, the highlights and the shadows.",
    fr: "Colorisez cette photographie en noir et blanc avec des couleurs vraisemblables pour son époque et son lieu : des tons naturels, sobres et cohérents avec la lumière de la scène. Ne changez que la couleur : conservez chaque détail, la texture, les lumières et les ombres.",
  },
};
export const TASK_LABELS: Record<RestorationTask, string> = {
  restore: "Restaurar",
  repair: "Reparar daños",
  sharpen: "Mejorar nitidez",
  colorize: "Colorear",
  custom: "Instrucciones propias",
  upscale: "Escalado IA",
};
export const TASK_HELP: Record<RestorationTask, string> = {
  restore: "Quita polvo, arañazos, manchas y ruido, y corrige el desvanecimiento.",
  repair: "Rellena desconchones, grietas, pliegues, roturas y esquinas perdidas.",
  sharpen: "Define bordes y detalles sin cambiar el contenido.",
  colorize: "Añade colores verosímiles a una fotografía en blanco y negro.",
  custom: "Escribe tú lo que debe hacer el modelo.",
  upscale: "Amplía la imagen ×2 o ×4 con un modelo local.",
};

/** The instructions sent to the model for a task. */
export function restorationPrompt(task: RestorationTask, language: Language, region: boolean): string {
  if (task === "custom" || task === "upscale") return "";
  const crop = region
    ? language === "en"
      ? " This image is a crop of a larger one and will be pasted back in place: return it with the same framing, size and exposure, without changing its edges."
      : language === "fr"
      ? " Cette image est un détail d'une image plus grande et sera replacée à son emplacement : renvoyez-la avec le même cadrage, la même taille et la même exposition, sans modifier ses bords."
      : " Esta imagen es un recorte de otra mayor y se volverá a pegar en su sitio: devuélvela con el mismo encuadre, tamaño y exposición, sin cambiar sus bordes."
    : "";
  return `${TASKS[task][language]} ${FIDELITY[language]}${crop}`;
}

/** Most context sent with an image: a long catalogue entry, but bounded. */
export const RESTORATION_CONTEXT_MAX = 4000;

/**
 * What the model is told about the photograph, after its instructions: what
 * the researcher knows and the fields of the record it belongs to. It guides
 * plausible colours and details; it never asks for anything to be added.
 */
export function restorationContext(
  input: { note?: string; fields?: { label: string | null; value: string }[] },
  language: Language,
  /** Colourising uses it for colours; the other tasks must not change any. */
  task: RestorationTask = "colorize",
): string {
  const lines = [
    input.note?.trim() ?? "",
    ...(input.fields ?? []).map((f) => (f.label ? `${f.label}: ${f.value}` : f.value)),
  ].filter(Boolean);
  if (!lines.length) return "";
  const colour = task === "colorize" || task === "custom";
  const head = colour
    ? language === "en"
      ? "What is known about this photograph (use it only to choose plausible colours, materials and details; never add anything that is not visible):"
      : language === "fr"
      ? "Ce que l'on sait de cette photographie (utilisez-le uniquement pour choisir des couleurs, des matières et des détails vraisemblables ; n'ajoutez rien qui ne soit visible) :"
      : "Lo que se sabe de esta fotografía (úsalo solo para elegir colores, materiales y detalles verosímiles; no añadas nada que no se vea):"
    : language === "en"
      ? "What is known about this photograph (use it only to understand what it shows; do not change its colours or tone, and never add anything that is not visible):"
      : language === "fr"
      ? "Ce que l'on sait de cette photographie (utilisez-le uniquement pour comprendre ce qu'elle montre ; ne changez ni ses couleurs ni sa tonalité, et n'ajoutez rien qui ne soit visible) :"
      : "Lo que se sabe de esta fotografía (úsalo solo para entender lo que muestra; no cambies sus colores ni su tonalidad, y no añadas nada que no se vea):";
  return `${head}\n${lines.join("\n").slice(0, RESTORATION_CONTEXT_MAX)}`;
}

/** The full request: the task's instructions and, after them, the context. */
export function restorationRequest(prompt: string, context: string): string {
  return context.trim() ? `${prompt.trim()}\n\n${context.trim()}` : prompt.trim();
}

/** Aspect ratios image models accept; the closest to the image is asked for. */
const ASPECTS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
export function closestAspect(width: number, height: number): string {
  const ratio = Math.log(width / Math.max(1, height));
  return ASPECTS.reduce((best, a) => {
    const [w, h] = a.split(":").map(Number);
    const [bw, bh] = best.split(":").map(Number);
    return Math.abs(Math.log(w / h) - ratio) < Math.abs(Math.log(bw / bh) - ratio) ? a : best;
  });
}

/**
 * How closely a version keeps the structure of the original (light, shapes
 * and position), from 0 to 1. Colour does not count, so a colourised version
 * that kept every detail is close to 1.
 */
export type RestorationCheck = { similarity: number; level: "faithful" | "changed" | "different" };
export const checkLevel = (similarity: number): RestorationCheck["level"] =>
  similarity >= 0.8 ? "faithful" : similarity >= 0.6 ? "changed" : "different";

export const encodeImageModel = (provider: ApiProvider, model: string) => `${provider}|${model}`;
export function decodeImageModel(value: string): { provider: ApiProvider; model: string } | null {
  const [provider, ...rest] = value.split("|");
  const model = rest.join("|").trim();
  return provider && model && IMAGE_API[provider as ApiProvider] ? { provider: provider as ApiProvider, model } : null;
}

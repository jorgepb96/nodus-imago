// AI upscaling through an online service (fal.ai, Replicate, Stability AI).
// The researcher may never have used an API: every service says in plain
// words what it is, where to get a key and what it costs; a few models are
// recommended with what they are good for, and the rest can be searched.

export const UPSCALE_SERVICES = {
  fal: {
    label: "fal.ai",
    site: "https://fal.ai",
    keysUrl: "https://fal.ai/dashboard/keys",
    billingUrl: "https://fal.ai/dashboard/billing",
    about: "Plataforma con muchos modelos de escalado (Topaz, SeedVR2, Recraft…) y precios muy bajos. La más recomendable para empezar.",
  },
  replicate: {
    label: "Replicate",
    site: "https://replicate.com",
    keysUrl: "https://replicate.com/account/api-tokens",
    billingUrl: "https://replicate.com/account/billing",
    about: "Plataforma con cientos de modelos abiertos. Se paga por segundo de uso o por imagen, según el modelo.",
  },
  stability: {
    label: "Stability AI",
    site: "https://platform.stability.ai",
    keysUrl: "https://platform.stability.ai/account/keys",
    billingUrl: "https://platform.stability.ai/account/credits",
    about: "Los creadores de Stable Diffusion. Tres escaladores propios con precio fijo por imagen.",
  },
} as const;
export type UpscaleService = keyof typeof UPSCALE_SERVICES;
export const UPSCALE_SERVICE_IDS = Object.keys(UPSCALE_SERVICES) as UpscaleService[];

/** How much a model may change the picture, in the words shown to the researcher. */
export type UpscaleStyle = "faithful" | "balanced" | "creative" | "unknown";
export const STYLE_LABELS: Record<UpscaleStyle, string> = {
  faithful: "Fiel",
  balanced: "Reconstruye",
  creative: "Creativo",
  unknown: "Sin clasificar",
};
export const STYLE_HELP: Record<UpscaleStyle, string> = {
  faithful: "Amplía sin inventar: lo más seguro para fuentes.",
  balanced: "Reconstruye detalle de forma realista; puede añadir textura que no estaba.",
  creative: "Inventa detalle con libertad: útil para divulgar, no como documento.",
  unknown: "No sabemos cuánto cambia la imagen: compáralo con el original.",
};

/** A price: per image, or per megapixels of output (blocks of `per` MP). */
export type UpscalePrice = { amount: number; per: "image" | "megapixel"; blockMP?: number; source: "service" | "reference" };

/** What a service model is used for in Imago. */
export type ServiceTask = "upscale" | "restore" | "colorize";

export type ApiUpscaleModel = {
  service: UpscaleService;
  /** Upscaling when absent. */
  task?: ServiceTask;
  /** It reads written instructions (a prompt); otherwise it always does the same thing. */
  instructed?: boolean;
  /** fal endpoint id, Replicate «owner/name» or Stability «fast|conservative|creative». */
  id: string;
  name: string;
  description?: string;
  style: UpscaleStyle;
  price?: UpscalePrice;
  /** Recommended models carry a short reason in plain words. */
  recommended?: string;
  /** Scales the model accepts; empty: the model decides the size itself. */
  scales?: number[];
  runs?: number;
};

export const modelKey = (m: Pick<ApiUpscaleModel, "service" | "id">) => `${m.service}|${m.id}`;

/**
 * Models we know: what they are good for and their published price (checked
 * in November 2026; the service's own figure replaces it when it gives one).
 */
export const KNOWN_API_MODELS: ApiUpscaleModel[] = [
  {
    service: "fal",
    id: "topaz/upscale/image/precision",
    name: "Topaz Precision",
    style: "faithful",
    price: { amount: 0.08, per: "megapixel", blockMP: 24, source: "reference" },
    recommended: "El estándar de los fotógrafos profesionales: amplía respetando el original. La opción más segura para fuentes.",
    scales: [2, 4],
  },
  {
    service: "fal",
    id: "fal-ai/seedvr/upscale/image",
    name: "SeedVR2",
    style: "balanced",
    price: { amount: 0.001, per: "megapixel", source: "reference" },
    recommended: "Muy barato (alrededor de un céntimo por foto) y muy bueno con fotos borrosas o dañadas. Puede añadir algo de detalle.",
    scales: [2, 4],
  },
  {
    service: "fal",
    id: "fal-ai/recraft/upscale/crisp",
    name: "Recraft Crisp",
    style: "faithful",
    price: { amount: 0.004, per: "image", source: "reference" },
    recommended: "Casi gratis. Mejora la nitidez sin inventar, pero ayuda poco en fotos muy deterioradas.",
    scales: [],
  },
  {
    service: "fal",
    id: "topaz/upscale/image/generative",
    name: "Topaz Wonder (generativo)",
    style: "balanced",
    price: { amount: 0.24, per: "megapixel", blockMP: 24, source: "reference" },
    scales: [2, 4],
  },
  { service: "fal", id: "fal-ai/clarity-upscaler", name: "Clarity Upscaler", style: "creative", price: { amount: 0.03, per: "megapixel", source: "reference" }, scales: [2, 4] },
  { service: "fal", id: "fal-ai/creative-upscaler", name: "Creative Upscaler", style: "creative", scales: [2, 4] },
  { service: "fal", id: "fal-ai/esrgan", name: "Real-ESRGAN", style: "faithful", scales: [2, 4] },
  { service: "fal", id: "fal-ai/aura-sr", name: "AuraSR", style: "balanced", scales: [4] },
  { service: "fal", id: "fal-ai/recraft/upscale/creative", name: "Recraft Creative", style: "creative", price: { amount: 0.25, per: "image", source: "reference" }, scales: [] },
  { service: "fal", id: "topaz/upscale/image/creative", name: "Topaz Bloom (creativo)", style: "creative", price: { amount: 0.96, per: "megapixel", blockMP: 24, source: "reference" }, scales: [2, 4] },
  { service: "fal", id: "clarityai/crystal-upscaler", name: "Crystal Upscaler", style: "balanced", scales: [2, 4] },
  { service: "fal", id: "bria/upscale/creative", name: "Bria Creative Upscale", style: "creative", price: { amount: 0.04, per: "image", source: "reference" }, scales: [] },
  {
    service: "replicate",
    id: "topazlabs/image-upscale",
    name: "Topaz Image Upscale",
    style: "faithful",
    price: { amount: 0.05, per: "megapixel", blockMP: 12, source: "reference" },
    recommended: "Topaz en Replicate: amplía respetando el original.",
    scales: [2, 4],
  },
  { service: "replicate", id: "nightmareai/real-esrgan", name: "Real-ESRGAN", style: "faithful", price: { amount: 0.002, per: "image", source: "reference" }, scales: [2, 4] },
  { service: "replicate", id: "recraft-ai/recraft-crisp-upscale", name: "Recraft Crisp", style: "faithful", price: { amount: 0.004, per: "image", source: "reference" }, scales: [] },
  {
    service: "stability",
    id: "fast",
    name: "Stability Fast",
    style: "faithful",
    price: { amount: 0.02, per: "image", source: "reference" },
    recommended: "Rápido y barato (2 céntimos). Siempre amplía ×4; para fotos de hasta 1,5 megapíxeles.",
    scales: [4],
  },
  {
    service: "stability",
    id: "conservative",
    name: "Stability Conservative",
    style: "faithful",
    price: { amount: 0.4, per: "image", source: "reference" },
    recommended: "Pensado para no alterar la imagen; resultado de unos 4 megapíxeles. Más caro.",
    scales: [],
  },
  { service: "stability", id: "creative", name: "Stability Creative", style: "creative", price: { amount: 0.6, per: "image", source: "reference" }, scales: [] },
];

/**
 * Restoration and colourising models we know (prices published by each
 * service, checked in November 2026). Specialised ones do one thing and read
 * no instructions; «instructed» ones follow the prompt.
 */
export const KNOWN_EDIT_MODELS: ApiUpscaleModel[] = [
  // Restoration
  {
    service: "replicate",
    id: "microsoft/bringing-old-photos-back-to-life",
    task: "restore",
    name: "Bringing Old Photos Back to Life",
    style: "faithful",
    price: { amount: 0.0096, per: "image", source: "reference" },
    recommended: "Hecho para fotos antiguas: quita arañazos, polvo y manchas sin repintar la escena. Menos de un céntimo.",
  },
  {
    service: "replicate",
    id: "flux-kontext-apps/restore-image",
    task: "restore",
    name: "FLUX Kontext Restore",
    style: "balanced",
    price: { amount: 0.04, per: "image", source: "reference" },
    recommended: "Repara roturas, pliegues y zonas perdidas con mucha calidad. Reconstruye lo que falta: compáralo con el original.",
  },
  { service: "replicate", id: "topazlabs/dust-and-scratch-v2", task: "restore", name: "Topaz Dust & Scratch", style: "faithful", price: { amount: 0.08, per: "image", source: "reference" } },
  { service: "replicate", id: "sczhou/codeformer", task: "restore", name: "CodeFormer (caras)", style: "balanced", price: { amount: 0.005, per: "image", source: "reference" } },
  { service: "replicate", id: "tencentarc/gfpgan", task: "restore", name: "GFPGAN (caras)", style: "balanced", price: { amount: 0.004, per: "image", source: "reference" } },
  { service: "replicate", id: "mv-lab/instructir", task: "restore", name: "InstructIR", instructed: true, style: "faithful", price: { amount: 0.027, per: "image", source: "reference" } },
  {
    service: "fal",
    id: "topaz/restore/image",
    task: "restore",
    name: "Topaz Restore",
    style: "balanced",
    recommended: "Restauración profesional de Topaz para fotos dañadas o de poca calidad.",
  },
  { service: "fal", id: "bria/fibo-edit/restore", task: "restore", name: "Bria Restore", style: "balanced" },
  { service: "fal", id: "fal-ai/image-apps-v2/photo-restoration", task: "restore", name: "Photo Restoration", style: "creative" },
  { service: "fal", id: "fal-ai/codeformer", task: "restore", name: "CodeFormer (caras)", style: "balanced", price: { amount: 0.0021, per: "megapixel", source: "reference" } },
  // Colourising
  {
    service: "replicate",
    id: "piddnad/ddcolor",
    task: "colorize",
    name: "DDColor",
    style: "faithful",
    price: { amount: 0.001, per: "image", source: "reference" },
    recommended: "Colores naturales y sobrios, sin tocar la imagen. Una décima de céntimo por foto: ideal para probar.",
  },
  {
    service: "replicate",
    id: "arielreplicate/deoldify_image",
    task: "colorize",
    name: "DeOldify",
    style: "faithful",
    price: { amount: 0.042, per: "image", source: "reference" },
    recommended: "El colorizador clásico de fotos antiguas: colores cálidos, de época.",
  },
  { service: "replicate", id: "cjwbw/bigcolor", task: "colorize", name: "BigColor", style: "faithful", price: { amount: 0.037, per: "image", source: "reference" } },
  { service: "replicate", id: "topazlabs/image-colorization", task: "colorize", name: "Topaz Colorization", style: "faithful", price: { amount: 0.08, per: "image", source: "reference" } },
  { service: "fal", id: "fal-ai/ddcolor", task: "colorize", name: "DDColor", style: "faithful", recommended: "Colores naturales y sobrios, sin tocar la imagen." },
  { service: "fal", id: "bria/fibo-edit/colorize", task: "colorize", name: "Bria Colorize", style: "balanced" },
];

/** The cost of one image, in USD, for an output of `outputMP` megapixels; null when unknown. */
export function estimateCost(price: UpscalePrice | undefined, outputMP: number): number | null {
  if (!price) return null;
  if (price.per === "image") return price.amount;
  if (price.blockMP) return price.amount * Math.max(1, Math.ceil(outputMP / price.blockMP));
  return price.amount * Math.max(0.1, outputMP);
}
export function formatCost(usd: number | null, language: "es" | "en" | "fr" = "es"): string {
  if (usd === null) return "?";
  const value = usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2);
  return language === "en" ? `$${value}` : `${value.replace(".", ",")} $`;
}

/** Price limits offered to filter the catalogue (USD per image). */
export const PRICE_LIMITS = [0.01, 0.05, 0.1, 0.5, 1] as const;

/** Is this a model that enlarges images? (catalogues mix them with editors and generators). */
export function looksLikeUpscaler(text: string): boolean {
  return /upscal|super[- ]?res|esrgan|aura-?sr|seedvr|increase[- ]resolution|swinir|\bsr\b|enhance resolution|high-?res/i.test(text);
}

/** Is this a model for that task? (search results mix in generators and editors of every kind). */
export function looksLikeTask(task: ServiceTask, text: string): boolean {
  if (task === "upscale") return looksLikeUpscaler(text);
  if (/video|depth|sketch|cartoon|anime|try-?on|headshot|hair|eye color|swap|lora|trigger/i.test(text)) return false;
  // Models that age photographs (the opposite), or only adjust colours already there.
  if (/into an? old|make (it|them|photos?) (look )?old|vintage (effect|filter|look)|\baging\b|\badjust\b|white balance/i.test(text)) return false;
  return task === "colorize"
    ? /coloriz|colouriz|deoldify|ddcolor|bigcolor|black[- ]and[- ]white.*colou?r/i.test(text)
    : /restor|scratch|old photo|damaged|codeformer|gfpgan|deblur|denois|instructir/i.test(text);
}

/** What the worker sends to the main process for one API upscale (the image as PNG, base64). */
export type ApiUpscaleRequest = {
  upscaleApi: true;
  service: UpscaleService;
  model: string;
  image: string;
  width: number;
  height: number;
  scale: number;
  /** Written instructions, for models that read them (restoring, colourising). */
  prompt?: string;
};
export type ApiUpscaleResult = { image: string; mimeType: string; seconds: number; cost: number | null; note?: string };

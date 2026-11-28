// AI upscaling with Kandinsky ImageSR 2.0, run on this computer. What a run
// asks for, the memory profiles the model can run with (after the Pinokio
// launcher «Kandinsky ImageSR 2.0 Studio», MIT), the profile recommended for
// the hardware found, and how many 1024 px tiles an image costs: the model
// works one tile at a time, so tiles are what time and memory depend on.

export const UPSCALE_MODEL_ID = "kandinsky-imagesr-2";
export const UPSCALE_RUNTIME_ID = "upscale-runtime";
/** The Python environment the runtime prepares; not a download of its own. */
export const UPSCALE_ENV_ID = "upscale-env";
/** Bumped whenever the environment's requirements change, so it is rebuilt. */
export const UPSCALE_ENV_VERSION = "1";
export const UPSCALE_MODEL_NAME = "Kandinsky ImageSR 2.0";
export const UPSCALE_REPOSITORY = "kandinskylab/Kandinsky-ImageSR-2.0";
/** The label of the queued installation (a «prepare» job of its own, shown in Settings by the upscaler's card). */
export const UPSCALE_INSTALL_LABEL = `Instalar ${UPSCALE_MODEL_NAME}`;

export type UpscaleScale = 2 | 4;
export type UpscaleProfile = "full" | "balanced" | "low" | "minimum" | "cpu";
export type UpscaleProfileChoice = UpscaleProfile | "auto";

/** What a saved version records about the run that produced it. */
export type UpscaleParams = {
  scale: UpscaleScale;
  /** 0 (faithful) to 8 (creative); the model's calibrated levels (local engine only). */
  creativity: number;
  /** Where it ran: this computer (Kandinsky) or an online service. */
  engine?: "local" | "api";
  /** Online: the service, the model's id and name, and the estimated cost in USD. */
  service?: import("./upscaleApi").UpscaleService;
  model?: string;
  name?: string;
  cost?: number | null;
  profile: UpscaleProfile | "";
  device: string;
  dtype: string;
  revision: string;
  /** Input size actually sent (after any reduction) and output size. */
  input: [number, number];
  output: [number, number];
  tiles: number;
  seconds: number;
  /** The input was reduced by this factor to save tiles or stay under the limit; 1: not reduced. */
  reduced: number;
};

export const PROFILE_LABELS: Record<UpscaleProfile, string> = {
  full: "Completo",
  balanced: "Equilibrado",
  low: "Memoria baja",
  minimum: "Mínimo",
  cpu: "Solo procesador",
};
export const PROFILE_HELP: Record<UpscaleProfile, string> = {
  full: "Todo el modelo en la GPU, sin pérdidas. El más rápido; necesita mucha memoria.",
  balanced: "Pesos en 8 bits: la mitad de memoria, resultado prácticamente idéntico.",
  low: "Los bloques del modelo pasan de la RAM a la GPU uno a uno. Sin pérdidas.",
  minimum: "Como «Memoria baja» y además decodifica por partes. Para GPU de 3-4 GB.",
  cpu: "Sin GPU. Funciona en cualquier equipo con RAM suficiente, pero es lento.",
};

/** Creativity levels: 0 keeps closest to the original; 8 invents most detail. */
export const CREATIVITY_MAX = 8;

/** The hardware found on this computer (by the app, and by PyTorch once installed). */
export type UpscaleHardware = {
  platform: string;
  arch: string;
  cpu: string;
  threads: number;
  ramGB: number;
  /** Memory other programs leave free now, when it can be read. */
  availableGB: number | null;
  gpu: {
    kind: "apple" | "nvidia" | "amd" | "intel" | "none";
    name: string;
    /** Dedicated memory; on Apple Silicon, what the GPU may use of the shared memory. */
    vramGB: number | null;
    freeGB: number | null;
    /** NVIDIA compute capability (major.minor) and driver version. */
    capability?: number;
    driver?: string;
  };
  /** Set once the environment is installed and PyTorch has been asked. */
  probed?: boolean;
};

export type UpscaleRecommendation = {
  supported: boolean;
  profile: UpscaleProfile;
  /** Why this profile, in one sentence (Spanish; translated in the interface). */
  reason: string;
  warnings: string[];
  /** Seconds one 1024 px tile is expected to take with this profile. */
  secondsPerTile: number;
  /** Memory the run needs, roughly (weights plus working memory). */
  memoryGB: number;
};

/** Memory each profile needs: [GPU or shared memory, system RAM], in GB, measured. */
const NEEDS: Record<UpscaleProfile, [number, number]> = {
  full: [11.5, 12],
  balanced: [6.5, 10],
  low: [4.5, 16],
  minimum: [2, 16],
  cpu: [0, 16],
};
/** Seconds per 1024 px tile, measured or reported; replaced by this computer's own timings after a run. */
export function expectedSecondsPerTile(hardware: Pick<UpscaleHardware, "gpu" | "threads">, profile: UpscaleProfile): number {
  if (profile === "cpu") return Math.round(40 * Math.max(1, 16 / Math.max(2, hardware.threads)));
  if (hardware.gpu.kind === "apple") {
    // Measured on a base M2 (10-core GPU): 40 s balanced. Pro/Max/Ultra chips have 2-8x the GPU cores.
    const name = hardware.gpu.name.toLowerCase();
    const factor = /ultra/.test(name) ? 0.2 : /max/.test(name) ? 0.35 : /pro/.test(name) ? 0.6 : 1;
    return Math.round((profile === "full" ? 34 : 40) * factor);
  }
  // NVIDIA: H100 0.3 s, RTX 5090 0.5 s per tile; mid-range cards a few times that.
  const vram = hardware.gpu.vramGB ?? 8;
  const base = vram >= 20 ? 0.6 : vram >= 12 ? 1.5 : 3;
  return Math.round(base * ({ full: 1, balanced: 1.1, low: 1.15, minimum: 1.3 } as Record<string, number>)[profile] * 10) / 10;
}

/**
 * The profile this computer should use: the fastest one whose memory fits,
 * with what is free now taken into account (a 16 GB Mac with a browser open
 * has far less than 16 GB to give). Lossless profiles first; int8 when only
 * it fits on the GPU.
 */
export function recommendProfile(hardware: UpscaleHardware): UpscaleRecommendation {
  const warnings: string[] = [];
  const ram = hardware.ramGB;
  const result = (profile: UpscaleProfile, reason: string, supported = true): UpscaleRecommendation => {
    const available = hardware.availableGB;
    const need = hardware.gpu.kind === "apple" || profile === "cpu" ? Math.max(NEEDS[profile][0], 8) : NEEDS[profile][1];
    if (supported && available !== null && available < need * 0.6)
      warnings.push("Ahora mismo hay poca memoria libre: cierra otros programas antes de escalar o el equipo irá muy lento.");
    return {
      supported,
      profile,
      reason,
      warnings,
      secondsPerTile: expectedSecondsPerTile(hardware, profile),
      memoryGB: profile === "cpu" ? 12 : NEEDS[profile][0],
    };
  };
  if (hardware.platform === "darwin" && hardware.arch !== "arm64")
    return result("cpu", "Los Mac con Intel no tienen versiones actuales de PyTorch: el escalado local no está disponible.", false);
  if (ram < 8) return result("cpu", "Hacen falta al menos 8 GB de RAM para cargar el modelo.", false);
  if (hardware.gpu.kind === "apple") {
    if (ram >= 24) return result("full", "Apple Silicon con memoria de sobra: el modelo completo en la GPU.");
    if (ram < 16) warnings.push("Con menos de 16 GB funciona, pero muy justo: cierra el resto de programas mientras escala.");
    return result("balanced", "Apple Silicon con memoria compartida limitada: pesos en 8 bits para que quepa con holgura.");
  }
  if (hardware.gpu.kind === "nvidia" && (hardware.gpu.capability ?? 7.5) >= 5) {
    const vram = hardware.gpu.freeGB ?? hardware.gpu.vramGB ?? 0;
    if (vram >= 12.5 && ram >= 12) return result("full", "GPU NVIDIA con memoria de sobra: el modelo completo, sin pérdidas.");
    if (vram >= 5.5 && ram >= 16) return result("low", "GPU NVIDIA de memoria media: los bloques se cargan uno a uno, sin pérdidas.");
    if (vram >= 8.5) return result("balanced", "GPU NVIDIA de memoria media y poca RAM: pesos en 8 bits.");
    if (vram >= 2.5 && ram >= 16) return result("minimum", "GPU NVIDIA pequeña: bloques uno a uno y decodificación por partes.");
  }
  if (hardware.gpu.kind === "amd" || hardware.gpu.kind === "intel")
    warnings.push("La aceleración con GPU AMD o Intel aún no está disponible: se usará el procesador.");
  if (ram < 16) return result("cpu", "Sin una GPU compatible hacen falta al menos 16 GB de RAM.", false);
  warnings.push("Sin GPU compatible el escalado es lento: mejor por zonas o imágenes pequeñas.");
  return result("cpu", "No hay una GPU compatible: se usará el procesador.");
}

/** The tile origins along one side, exactly as the pipeline computes them. */
export function tilePositions(length: number, tile: number, stride: number): number[] {
  if (length <= tile) return [0];
  const positions: number[] = [];
  for (let p = 0; p < length - tile; p += stride) positions.push(p);
  if (positions[positions.length - 1] + tile < length) positions.push(length - tile);
  return positions;
}
/** Output tiles of 1024 px, 25 % overlap (the model's configuration). */
const TILE = 1024,
  OVERLAP = 0.25;
export function tileCount(width: number, height: number, scale: UpscaleScale): number {
  const lq = TILE / scale,
    stride = Math.max(1, Math.floor(lq * (1 - OVERLAP)));
  return tilePositions(Math.max(width, lq), lq, stride).length * tilePositions(Math.max(height, lq), lq, stride).length;
}

export type UpscalePlan = {
  /** Size sent to the model, after any reduction. */
  input: [number, number];
  output: [number, number];
  tiles: number;
  /** Tiles at the full size, before saving any. */
  tilesAtFullSize: number;
  /** 1: not reduced; below 1: the input was reduced by this factor. */
  reduced: number;
  /** Why it was reduced. */
  reason: "none" | "limit" | "tiles";
};
/** Most a run may reduce an image to save tiles: an image barely over a tile boundary. */
export const FIT_MAX_REDUCTION = 0.12;

/**
 * What a run will do with an image of this size: the output stays within the
 * longest side allowed, and, when `fit` is on, an image just over a tile
 * boundary is reduced a little (never more than 12 %) to need fewer tiles:
 * 566 px wide at ×2 is four tiles, 512 px is one.
 */
export function planUpscale(width: number, height: number, scale: UpscaleScale, options: { maxOutputSide: number; fit: boolean }): UpscalePlan {
  let factor = 1,
    reason: UpscalePlan["reason"] = "none";
  if (Math.max(width, height) * scale > options.maxOutputSide) {
    factor = options.maxOutputSide / scale / Math.max(width, height);
    reason = "limit";
  }
  const size = (f: number): [number, number] => [Math.max(1, Math.floor(width * f)), Math.max(1, Math.floor(height * f))];
  const tilesAtFullSize = tileCount(...size(factor), scale);
  let best = { f: factor, tiles: tilesAtFullSize };
  if (options.fit && tilesAtFullSize > 1) {
    const lq = TILE / scale,
      stride = Math.floor(lq * (1 - OVERLAP));
    // Each side can drop to the largest length with one tile row fewer.
    const lengths = (n: number) => (n <= 1 ? [] : [lq + (n - 2) * stride]);
    const [w, h] = size(factor);
    const nw = tilePositions(Math.max(w, lq), lq, stride).length,
      nh = tilePositions(Math.max(h, lq), lq, stride).length;
    const candidates = [...lengths(nw).map((l) => l / w), ...lengths(nh).map((l) => l / h)];
    for (const c of candidates) {
      if (c >= 1 || c < 1 - FIT_MAX_REDUCTION) continue;
      const f = factor * c;
      const tiles = tileCount(...size(f), scale);
      // Only worth it when it saves at least a quarter of the tiles.
      if (tiles <= best.tiles * 0.75 && (tiles < best.tiles || f > best.f)) best = { f, tiles };
    }
    if (best.f !== factor) reason = "tiles";
  }
  const input = size(best.f);
  return {
    input,
    output: [input[0] * scale, input[1] * scale],
    tiles: best.tiles,
    tilesAtFullSize,
    reduced: Math.round(best.f * 1000) / 1000,
    reason,
  };
}

/** Longest output sides offered; 8192 px is the official demo's limit. */
export const OUTPUT_LIMITS = [4096, 8192, 12288] as const;

export type UpscaleItem = { assetId: string; region: { x: number; y: number; w: number; h: number } | null; baseId: string | null };
/** The engine of a run: Kandinsky on this computer, or a model of an online service. */
export type UpscaleEngine = { kind: "local" } | { kind: "api"; service: import("./upscaleApi").UpscaleService; model: string; name: string };
/** Input limits of some online models (Stability's work on small images only). */
export const API_INPUT_LIMITS: Record<string, { maxPixels: number; maxSide?: number }> = {
  "stability|fast": { maxPixels: 1_048_576, maxSide: 1536 },
  "stability|creative": { maxPixels: 1_048_576 },
  "stability|conservative": { maxPixels: 9_437_184 },
};
export type UpscaleJobPayload = {
  label: string;
  engine?: UpscaleEngine;
  items: UpscaleItem[];
  scale: UpscaleScale;
  creativity: number;
  fit: boolean;
  maxOutputSide: number;
  /** Version ids made by the job, in item order (null where an item failed). */
  results?: (string | null)[];
};

/** The state of the local upscaler, shown in Settings and in the section. */
export type UpscaleStatus = {
  hardware: UpscaleHardware;
  recommendation: UpscaleRecommendation;
  /** The profile in use: the user's choice or the recommended one. */
  profile: UpscaleProfile;
  choice: UpscaleProfileChoice;
  installed: { runtime: boolean; model: boolean; environment: boolean };
  ready: boolean;
  /** Bytes still to download and the space all of it takes once installed. */
  downloadBytes: number;
  diskBytes: number;
  /** Bytes on disk now (weights and environment). */
  usedBytes: number;
  /** Seconds per tile measured on this computer, by profile. */
  measured: Partial<Record<UpscaleProfile, number>>;
  /** The preparation job in progress, if any. */
  preparing: string | null;
  revision: string;
  license: string;
};

/** Expected seconds for a plan with the given seconds per tile, plus loading the model the first time. */
export const estimateSeconds = (tiles: number, secondsPerTile: number, loading = 0) => Math.round(tiles * secondsPerTile + loading);
export function formatDuration(seconds: number, language: "es" | "en" | "fr" = "es"): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return language === "en" ? `${h} h ${m} min` : `${h} h ${m} min`;
}

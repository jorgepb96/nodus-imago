// Online upscaling services: fal.ai, Replicate and Stability AI. Runs in the
// main process, which holds the keys. Each service has its own way of
// listing models, receiving the image and returning the result; this file
// hides those differences behind catalog() and run().
import sharp from "sharp";
import type { Secrets } from "../secrets/store";
import {
  KNOWN_API_MODELS,
  KNOWN_EDIT_MODELS,
  UPSCALE_SERVICE_IDS,
  estimateCost,
  looksLikeTask,
  type ServiceTask,
  type ApiUpscaleModel,
  type ApiUpscaleRequest,
  type ApiUpscaleResult,
  type UpscalePrice,
  type UpscaleService,
} from "../../shared/upscaleApi";

const MAX_DOWNLOAD = 200 * 2 ** 20;
const KNOWN = [...KNOWN_API_MODELS, ...KNOWN_EDIT_MODELS];
const known = new Map(KNOWN.map((m) => [`${m.service}|${m.id}`, m]));
const taskOf = (m: ApiUpscaleModel): ServiceTask => m.task ?? "upscale";
/** What each task looks for in the services' catalogues. */
const SEARCHES: Record<ServiceTask, { fal: string[]; replicate: { collections: string[]; queries: string[] } }> = {
  upscale: { fal: ["upscale", "super resolution"], replicate: { collections: ["super-resolution"], queries: [] } },
  restore: { fal: ["restoration", "restore photo", "scratch"], replicate: { collections: ["ai-image-restoration"], queries: ["old photo restoration"] } },
  colorize: { fal: ["colorize", "colorization"], replicate: { collections: [], queries: ["colorize", "colorization"] } },
};
/** Inputs some models need to do their job well (the rest keep their defaults). */
const MODEL_INPUTS: Record<string, Record<string, unknown>> = {
  "replicate|microsoft/bringing-old-photos-back-to-life": { with_scratch: true, HR: false },
  "replicate|sczhou/codeformer": { background_enhance: false, face_upsample: false, codeformer_fidelity: 0.7 },
  // «Stable» leaves fewer grey patches on people than «Artistic».
  "replicate|arielreplicate/deoldify_image": { model_name: "Stable" },
};
type Schema = {
  image: string;
  scale?: { name: string; min?: number; max?: number; values?: (number | string)[]; integer?: boolean };
  format?: { name: string; png: string };
  /** The field that takes written instructions, when the model reads them. */
  prompt?: string;
  /** Required choices without a default: the first one (a model refuses the request without them). */
  fill?: Record<string, unknown>;
};

class ServiceError extends Error {
  fatal = false;
}
const fail = (message: string, fatal = false) => Object.assign(new ServiceError(message), { fatal });
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), reject(new Error("Escalado cancelado."))), { once: true });
  });

export class UpscaleServices {
  private caches = new Map<ServiceTask, { at: number; signature: string; models: ApiUpscaleModel[] }>();
  private schemas = new Map<string, Schema>();
  constructor(
    public secrets: Secrets,
    public fetcher: typeof fetch = fetch,
  ) {}

  keyStatus(): Record<UpscaleService, boolean> {
    return Object.fromEntries(UPSCALE_SERVICE_IDS.map((s) => [s, !!this.secrets.get(s)])) as Record<UpscaleService, boolean>;
  }
  private key(service: UpscaleService) {
    const key = this.secrets.get(service);
    if (!key) throw fail(`Falta la clave de ${service === "fal" ? "fal.ai" : service === "replicate" ? "Replicate" : "Stability AI"}. Añádela en Escalado IA o en Ajustes › Proveedores.`, true);
    return key;
  }
  private auth(service: UpscaleService, key: string) {
    return service === "fal" ? `Key ${key}` : `Bearer ${key}`;
  }

  private async json(url: string, init: RequestInit = {}, signal?: AbortSignal, timeoutMs = 60_000): Promise<any> {
    let response: Response;
    // «Too many requests» (accounts with little credit have tight limits): wait and try again.
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs);
      response = await this.fetcher(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (response.status !== 429 || attempt >= 6) break;
      const after = Number(response.headers.get("retry-after"));
      await response.text().catch(() => "");
      await wait(Math.min(30_000, (Number.isFinite(after) && after > 0 ? after : 2 ** attempt * 2) * 1000), signal ?? new AbortController().signal);
    }
    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    if (!response.ok) {
      const detail = body?.detail ?? body?.error?.message ?? body?.errors?.join?.(" ") ?? body?.message ?? body?.raw ?? "";
      const message =
        response.status === 401 || response.status === 403
          ? "El servicio no acepta la clave. Comprueba que la has copiado entera y que sigue activa."
          : response.status === 402
            ? "No queda saldo en tu cuenta del servicio. Añade crédito en su web y vuelve a intentarlo."
            : response.status === 429
              ? "El servicio está recibiendo demasiadas peticiones; espera un momento y reanuda la tarea."
              : `El servicio respondió con un error (${response.status}). ${String(detail).slice(0, 300)}`;
      throw fail(message, [401, 402, 403].includes(response.status));
    }
    return body;
  }

  /** Checks a key and, where the service says it, the balance left. */
  async check(service: UpscaleService): Promise<{ ok: true; balance?: string }> {
    const key = this.key(service);
    if (service === "fal") {
      await this.json("https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/esrgan", { headers: { Authorization: this.auth(service, key) } });
      return { ok: true };
    }
    if (service === "replicate") {
      await this.json("https://api.replicate.com/v1/account", { headers: { Authorization: this.auth(service, key) } });
      return { ok: true };
    }
    const balance = await this.json("https://api.stability.ai/v1/user/balance", { headers: { Authorization: this.auth(service, key) } });
    return { ok: true, balance: typeof balance?.credits === "number" ? `${(balance.credits / 100).toFixed(2)} $` : undefined };
  }

  // ------------------------------------------------------------------ catalog
  /** Every model of the services for a task, with the price where it is known; cached for an hour. */
  async catalog(refresh = false, task: ServiceTask = "upscale"): Promise<ApiUpscaleModel[]> {
    const status = this.keyStatus();
    const signature = JSON.stringify(status);
    const cached = this.caches.get(task);
    if (!refresh && cached && cached.signature === signature && Date.now() - cached.at < 3_600_000) return cached.models;
    const found = new Map<string, ApiUpscaleModel>(KNOWN.filter((m) => taskOf(m) === task).map((m) => [`${m.service}|${m.id}`, { ...m }]));
    await Promise.all([this.falCatalog(found, status.fal, task).catch(() => {}), status.replicate ? this.replicateCatalog(found, task).catch(() => {}) : Promise.resolve()]);
    const models = [...found.values()];
    this.caches.set(task, { at: Date.now(), signature, models });
    return models;
  }
  private async falCatalog(found: Map<string, ApiUpscaleModel>, withKey: boolean, task: ServiceTask) {
    const key = withKey ? this.secrets.get("fal") : null;
    const headers: Record<string, string> = key ? { Authorization: `Key ${key}` } : {};
    const seen = new Set<string>();
    for (const q of SEARCHES[task].fal) {
      const body = await this.json(`https://api.fal.ai/v1/models?q=${encodeURIComponent(q)}&category=image-to-image&status=active&limit=100`, { headers });
      for (const m of body?.models ?? []) {
        const id = String(m.endpoint_id ?? "");
        const meta = m.metadata ?? {};
        const text = `${id} ${meta.display_name ?? ""} ${(meta.tags ?? []).join(" ")} ${meta.description ?? ""}`;
        if (!id || seen.has(id) || !looksLikeTask(task, text) || /video/i.test(id)) continue;
        // A model listed for another task stays there (an upscaler is not a restorer).
        const other = known.get(`fal|${id}`);
        if (other && taskOf(other) !== task) continue;
        seen.add(id);
        const k = `fal|${id}`;
        const base = found.get(k);
        found.set(k, {
          ...(base ?? { service: "fal", id, style: "unknown", ...(task === "upscale" ? {} : { task }) }),
          name: base?.name ?? meta.display_name ?? id,
          description: String(meta.description ?? "").slice(0, 400) || base?.description,
        } as ApiUpscaleModel);
      }
    }
    // The service's own prices, when there is a key (the pricing API asks for one).
    if (!key) return;
    const ids = [...found.values()].filter((m) => m.service === "fal").map((m) => m.id);
    for (let i = 0; i < ids.length; i += 50) {
      const query = ids.slice(i, i + 50).map((id) => `endpoint_id=${encodeURIComponent(id)}`).join("&");
      const body = await this.json(`https://api.fal.ai/v1/models/pricing?${query}`, { headers });
      for (const p of body?.prices ?? []) {
        const m = found.get(`fal|${p.endpoint_id}`);
        const price = falPrice(p.unit_price, p.unit);
        if (m && price) m.price = price;
      }
    }
  }
  private async replicateCatalog(found: Map<string, ApiUpscaleModel>, task: ServiceTask) {
    const key = this.key("replicate");
    const headers = { Authorization: `Bearer ${key}` };
    const add = (m: any) => {
      const id = `${m?.owner}/${m?.name}`;
      if (!m?.owner || !m?.name || /video/i.test(id)) return;
      const other = known.get(`replicate|${id}`);
      if (other && taskOf(other) !== task) return;
      // Collections are curated; search results are checked against the task.
      if (!other && task !== "upscale" && !looksLikeTask(task, `${id} ${m.description ?? ""}`)) return;
      const k = `replicate|${id}`;
      const base = found.get(k);
      found.set(k, {
        ...(base ?? { service: "replicate", id, style: "unknown", ...(task === "upscale" ? {} : { task }) }),
        name: base?.name ?? m.name,
        description: String(m.description ?? "").slice(0, 400) || base?.description,
        runs: typeof m.run_count === "number" ? m.run_count : undefined,
      } as ApiUpscaleModel);
    };
    for (const c of SEARCHES[task].replicate.collections) {
      const body = await this.json(`https://api.replicate.com/v1/collections/${c}`, { headers });
      for (const m of body?.models ?? []) add(m);
    }
    // Search results: only models in real use (little-used ones may be wrappers that pass the image on elsewhere).
    for (const q of SEARCHES[task].replicate.queries) {
      const body = await this.json(`https://api.replicate.com/v1/search?query=${encodeURIComponent(q)}&limit=25`, { headers }).catch(() => null);
      for (const m of body?.models ?? []) {
        const model = m.model ?? m;
        if (known.has(`replicate|${model?.owner}/${model?.name}`) || (model?.run_count ?? 0) >= 5000) add(model);
      }
    }
  }

  // ---------------------------------------------------------------------- run
  async run(request: ApiUpscaleRequest, signal: AbortSignal): Promise<ApiUpscaleResult> {
    const started = Date.now();
    const png = Buffer.from(request.image, "base64");
    const model = known.get(`${request.service}|${request.model}`) ?? this.caches.get("upscale")?.models.find((m) => m.service === request.service && m.id === request.model);
    const url =
      request.service === "fal" ? await this.runFal(request, png, signal) : request.service === "replicate" ? await this.runReplicate(request, png, signal) : null;
    const result = url ? await this.download(url, request.service, signal) : await this.runStability(request, png, signal);
    const outputMP = (request.width * request.height * request.scale * request.scale) / 1e6;
    return { ...result, seconds: Math.round((Date.now() - started) / 100) / 10, cost: estimateCost(model?.price, outputMP) };
  }

  /** Restores or colourises one image with a service model, at its own size; the prompt goes to models that read one. */
  async edit(
    request: { service: UpscaleService; model: string; task: Exclude<ServiceTask, "upscale">; image: Buffer; width: number; height: number; prompt: string },
    signal: AbortSignal,
  ): Promise<{ image: Buffer; cost: number | null; seconds: number }> {
    if (request.service === "stability") throw fail("Stability AI no tiene modelos de restauración ni de color; elige uno de fal.ai o de Replicate.", true);
    const started = Date.now();
    const png = request.image;
    const upscale: ApiUpscaleRequest = {
      upscaleApi: true,
      service: request.service,
      model: request.model,
      image: png.toString("base64"),
      width: request.width,
      height: request.height,
      scale: 1,
      prompt: request.prompt,
    };
    if (request.service === "replicate") {
      const jpeg = await sharp(png).jpeg({ quality: 95 }).toBuffer();
      if (jpeg.length < 8 * 2 ** 20) upscale.inline = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    }
    const attempt = (plain: boolean) => (request.service === "fal" ? this.runFal(upscale, png, signal, plain) : this.runReplicate(upscale, png, signal, plain));
    let url: string;
    try {
      url = await attempt(false);
    } catch (error) {
      // Our settings for a model may not suit every image: once more with the model's own.
      if (signal.aborted || (error as ServiceError).fatal || !MODEL_INPUTS[`${request.service}|${request.model}`]) throw error;
      url = await attempt(true);
    }
    const result = await this.download(url, request.service, signal);
    const model = known.get(`${request.service}|${request.model}`) ?? this.caches.get(request.task)?.models.find((m) => m.service === request.service && m.id === request.model);
    return { image: Buffer.from(result.image, "base64"), cost: estimateCost(model?.price, (request.width * request.height) / 1e6), seconds: Math.round((Date.now() - started) / 100) / 10 };
  }

  private async download(url: string, service: UpscaleService, signal: AbortSignal): Promise<{ image: string; mimeType: string }> {
    const u = new URL(url);
    if (u.protocol === "data:") {
      const [head, data] = url.split(",", 2);
      return { image: data, mimeType: /data:([^;]+)/.exec(head)?.[1] ?? "image/png" };
    }
    if (u.protocol !== "https:") throw fail("El servicio devolvió una dirección no segura.");
    // Replicate's own file URLs need the key; the CDN ones do not.
    const headers: Record<string, string> = service === "replicate" && u.hostname === "api.replicate.com" ? { Authorization: `Bearer ${this.key("replicate")}` } : {};
    const response = await this.fetcher(url, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]) });
    if (!response.ok || !response.body) throw fail(`No se pudo descargar el resultado (${response.status}).`);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body as any) {
      bytes += chunk.length;
      if (bytes > MAX_DOWNLOAD) throw fail("El resultado es demasiado grande.");
      chunks.push(chunk);
    }
    return { image: Buffer.concat(chunks).toString("base64"), mimeType: response.headers.get("content-type") ?? "image/png" };
  }

  /** Reads a model's input fields: which one takes the image, which the scale, which the format. */
  private schemaOf(raw: Record<string, any>, required: string[] = [], components: Record<string, any> = {}): Schema {
    // Enums may sit behind a reference («allOf: [{ $ref }]»): read them in place.
    const properties: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      const ref: string | undefined = v?.allOf?.[0]?.$ref ?? v?.$ref;
      properties[k] = ref ? { ...components[ref.split("/").pop()!], ...v } : v;
    }
    const names = Object.keys(properties);
    const image =
      ["image_url", "image", "input_image", "img", "image_uri", "media", "input"].find((n) => names.includes(n)) ??
      names.find((n) => /image/i.test(n) && (properties[n].format === "uri" || properties[n].type === "string")) ??
      required[0] ??
      "image_url";
    const scaleName = ["upscale_factor", "scale", "upscaling_factor", "scale_factor", "upscale", "outscale"].find((n) => names.includes(n));
    let scale: Schema["scale"];
    if (scaleName) {
      const p = properties[scaleName];
      const values = p.enum ?? p.allOf?.[0]?.enum;
      scale = { name: scaleName, min: p.minimum, max: p.maximum, values: Array.isArray(values) ? values : undefined, integer: p.type === "integer" };
    }
    const fmt = ["output_format", "format"].find((n) => names.includes(n));
    const enumValues: string[] = (fmt && (properties[fmt].enum ?? properties[fmt].allOf?.[0]?.enum)) || [];
    const png = enumValues.find((v) => /png/i.test(v));
    const prompt = ["prompt", "instruction", "instructions", "edit_instruction"].find((n) => names.includes(n) && properties[n].type !== "array");
    const fill: Record<string, unknown> = {};
    for (const n of required) {
      const p = properties[n];
      const choices = p?.enum ?? p?.allOf?.[0]?.enum;
      if (n !== image && p && p.default === undefined && Array.isArray(choices) && choices.length) fill[n] = choices[0];
    }
    return { image, scale, format: fmt && png ? { name: fmt, png } : undefined, prompt, fill };
  }
  private scaleValue(schema: Schema, scale: number): number | string | undefined {
    const s = schema.scale;
    if (!s) return undefined;
    if (s.values?.length) {
      // Choices may be numbers (2, 4) or words («2x», «4x», «None»): the closest to the scale asked for.
      const numeric = (v: number | string) => (typeof v === "number" ? v : Number(/(\d+(?:\.\d+)?)/.exec(v)?.[1] ?? NaN));
      const usable = s.values.filter((v) => Number.isFinite(numeric(v)));
      if (!usable.length) return undefined;
      return usable.reduce((a, b) => (Math.abs(numeric(b) - scale) < Math.abs(numeric(a) - scale) ? b : a));
    }
    let v = scale;
    if (typeof s.max === "number") v = Math.min(v, s.max);
    if (typeof s.min === "number") v = Math.max(v, s.min);
    return s.integer ? Math.round(v) : v;
  }

  private async runFal(request: ApiUpscaleRequest, png: Buffer, signal: AbortSignal, plain = false): Promise<string> {
    const key = this.key("fal");
    const auth = { Authorization: `Key ${key}` };
    let schema = this.schemas.get(`fal|${request.model}`);
    if (!schema) {
      try {
        const spec = await this.json(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(request.model)}`);
        const post = Object.values(spec?.paths ?? {}).map((p: any) => p?.post).find((p: any) => p?.requestBody);
        const ref: string | undefined = post?.requestBody?.content?.["application/json"]?.schema?.$ref;
        const input = ref ? spec.components.schemas[ref.split("/").pop()!] : null;
        schema = this.schemaOf(input?.properties ?? {}, input?.required ?? [], spec?.components?.schemas ?? {});
      } catch {
        schema = { image: "image_url", scale: { name: "upscale_factor" } };
      }
      this.schemas.set(`fal|${request.model}`, schema);
    }
    // The image goes to fal's storage (data URIs are discouraged above a few KB).
    let imageUrl = `data:image/png;base64,${request.image}`;
    try {
      const init = await this.json(
        "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
        { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ content_type: "image/png", file_name: "imago.png" }) },
        signal,
      );
      if (init?.upload_url && init?.file_url) {
        const put = await this.fetcher(init.upload_url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: new Uint8Array(png), signal });
        if (put.ok) imageUrl = init.file_url;
      }
    } catch {
      /* Falls back to the data URI. */
    }
    const input: Record<string, unknown> = { ...schema.fill, ...(plain ? {} : MODEL_INPUTS[`fal|${request.model}`]), [schema.image]: imageUrl };
    const scale = this.scaleValue(schema, request.scale);
    if (schema.scale && scale !== undefined) input[schema.scale.name] = scale;
    if (schema.format) input[schema.format.name] = schema.format.png;
    if (schema.prompt && request.prompt) input[schema.prompt] = request.prompt;
    const job = await this.json(
      `https://queue.fal.run/${request.model}`,
      { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(input) },
      signal,
    );
    if (!job?.status_url || !job?.response_url) throw fail("El servicio no ha aceptado la tarea.");
    const cancel = () => void this.fetcher(job.cancel_url, { method: "PUT", headers: auth }).catch(() => {});
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (let n = 0; ; n++) {
        const status = await this.json(job.status_url, { headers: auth }, signal);
        if (status?.error) throw fail(`El modelo no ha podido procesar la imagen: ${String(status.error).slice(0, 300)}`);
        if (status?.status === "COMPLETED") break;
        if (n > 900) throw fail("El servicio tarda demasiado; inténtalo más tarde.");
        await wait(n < 10 ? 1000 : 2000, signal);
      }
      const out = await this.json(job.response_url, { headers: auth }, signal);
      const url = out?.image?.url ?? out?.images?.[0]?.url ?? out?.output?.url;
      if (!url) throw fail("El servicio no ha devuelto ninguna imagen.");
      return url;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  private async runReplicate(request: ApiUpscaleRequest, png: Buffer, signal: AbortSignal, plain = false): Promise<string> {
    const key = this.key("replicate");
    const auth = { Authorization: `Bearer ${key}` };
    const model = await this.json(`https://api.replicate.com/v1/models/${request.model}`, { headers: auth }, signal);
    const version: string | undefined = model?.latest_version?.id;
    const inputSchema = model?.latest_version?.openapi_schema?.components?.schemas?.Input;
    const schema = this.schemaOf(inputSchema?.properties ?? {}, inputSchema?.required ?? [], model?.latest_version?.openapi_schema?.components?.schemas ?? {});
    // Restoring and colourising: the image goes inside the request (older models
    // find their input by its file extension, which uploaded files lack).
    // Otherwise files go up first, and a data URL is the fallback.
    let imageUrl = request.inline ?? `data:image/png;base64,${request.image}`;
    if (!request.inline)
      try {
        const form = new FormData();
        form.append("content", new Blob([new Uint8Array(png)], { type: "image/png" }), "imago.png");
        const file = await this.json("https://api.replicate.com/v1/files", { method: "POST", headers: auth, body: form }, signal);
        if (file?.urls?.get) imageUrl = file.urls.get;
      } catch {
        /* Falls back to the data URL. */
      }
    const input: Record<string, unknown> = { ...schema.fill, ...(plain ? {} : MODEL_INPUTS[`replicate|${request.model}`]), [schema.image]: imageUrl };
    const scale = this.scaleValue(schema, request.scale);
    if (schema.scale && scale !== undefined) input[schema.scale.name] = scale;
    if (schema.format) input[schema.format.name] = schema.format.png;
    if (schema.prompt && request.prompt) input[schema.prompt] = request.prompt;
    const prediction = await this.json(
      version ? "https://api.replicate.com/v1/predictions" : `https://api.replicate.com/v1/models/${request.model}/predictions`,
      { method: "POST", headers: { ...auth, "Content-Type": "application/json", Prefer: "wait=30" }, body: JSON.stringify(version ? { version, input } : { input }) },
      signal,
      90_000,
    );
    const cancel = () => prediction?.urls?.cancel && void this.fetcher(prediction.urls.cancel, { method: "POST", headers: auth }).catch(() => {});
    signal.addEventListener("abort", cancel, { once: true });
    try {
      let p = prediction;
      for (let n = 0; !["succeeded", "failed", "canceled"].includes(p?.status); n++) {
        if (n > 900) throw fail("El servicio tarda demasiado; inténtalo más tarde.");
        await wait(n < 10 ? 1000 : 2000, signal);
        p = await this.json(p.urls.get, { headers: auth }, signal);
      }
      if (p.status !== "succeeded") throw fail(`El modelo no ha podido procesar la imagen: ${String(p.error ?? p.status).slice(0, 300)}`);
      const out = p.output;
      const url = typeof out === "string" ? out : Array.isArray(out) ? out[out.length - 1] : (out?.image ?? out?.url ?? out?.output);
      if (typeof url !== "string") throw fail("El servicio no ha devuelto ninguna imagen.");
      return url;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  private async runStability(request: ApiUpscaleRequest, png: Buffer, signal: AbortSignal): Promise<{ image: string; mimeType: string }> {
    const key = this.key("stability");
    if (!["fast", "conservative", "creative"].includes(request.model)) throw fail("Modelo de Stability desconocido.");
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(png)], { type: "image/png" }), "imago.png");
    form.append("output_format", "png");
    if (request.model !== "fast") {
      // The prompt is required; it only asks for a faithful, sharper copy.
      form.append("prompt", "a faithful, sharp, high-resolution copy of this historical photograph, same content, no changes");
      form.append("creativity", request.model === "creative" ? "0.1" : "0.2");
    }
    const url = `https://api.stability.ai/v2beta/stable-image/upscale/${request.model}`;
    const response = await this.fetcher(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, Accept: request.model === "creative" ? "application/json" : "image/*" },
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
    });
    const fromResponse = async (r: Response) => {
      if (r.headers.get("finish-reason") === "CONTENT_FILTERED") throw fail("El servicio ha bloqueado la imagen por su filtro de contenido.");
      return { image: Buffer.from(await r.arrayBuffer()).toString("base64"), mimeType: r.headers.get("content-type") ?? "image/png" };
    };
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw fail(
        response.status === 401
          ? "El servicio no acepta la clave. Comprueba que la has copiado entera."
          : response.status === 402
            ? "No queda saldo en tu cuenta de Stability AI. Añade créditos en su web."
            : `Stability AI respondió con un error (${response.status}). ${(body?.errors ?? []).join(" ")}`,
        [401, 402, 403].includes(response.status),
      );
    }
    if (request.model !== "creative") return fromResponse(response);
    const { id } = (await response.json()) as { id: string };
    for (let n = 0; n < 90; n++) {
      await wait(10_000, signal);
      const r = await this.fetcher(`https://api.stability.ai/v2beta/results/${id}`, { headers: { Authorization: `Bearer ${key}`, Accept: "image/*" }, signal });
      if (r.status === 202) continue;
      if (!r.ok) throw fail(`Stability AI respondió con un error (${r.status}).`);
      return fromResponse(r);
    }
    throw fail("El servicio tarda demasiado; inténtalo más tarde.");
  }
}

/** fal's unit price, as one of our prices (images or megapixels). */
function falPrice(amount: unknown, unit: unknown): UpscalePrice | undefined {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined;
  const u = String(unit ?? "").toLowerCase();
  if (/image|request|call|generation/.test(u)) return { amount, per: "image", source: "service" };
  if (/megapixel|mp\b/.test(u)) {
    const block = Number(/(\d+)\s*(megapixel|mp)/.exec(u)?.[1]);
    return { amount, per: "megapixel", blockMP: block > 1 ? block : undefined, source: "service" };
  }
  return undefined;
}

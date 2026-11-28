// Local AI upscaling with Kandinsky ImageSR 2.0. Everything runs on this
// computer: an optional Python environment (prepared once with uv, from
// pinned packages), the model's verified weights, and runtime/upscale.py,
// which has no network access. Each result is a new version of the image,
// kept with the restorations and marked as made by AI; the original is only
// read. The memory profile is chosen from the hardware found here.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { randomUUID as uuid } from "node:crypto";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import sharp from "sharp";
import * as tar from "tar";
import { Archive } from "../import/archive";
import { orientedImage } from "../import/images";
import { assetView } from "../../shared/imageRotation";
import type { Repository } from "../db/repository";
import type { Models } from "./models";
import { ensureDiskSpace } from "../storage/disk";
import { UPSCALE_SERVICES, type ApiUpscaleRequest, type ApiUpscaleResult } from "../../shared/upscaleApi";
import {
  PROFILE_LABELS,
  UPSCALE_ENV_ID,
  UPSCALE_ENV_VERSION,
  UPSCALE_INSTALL_LABEL,
  UPSCALE_MODEL_ID,
  UPSCALE_MODEL_NAME,
  UPSCALE_RUNTIME_ID,
  API_INPUT_LIMITS,
  planUpscale,
  recommendProfile,
  type UpscaleHardware,
  type UpscaleJobPayload,
  type UpscaleParams,
  type UpscaleProfile,
  type UpscaleStatus,
} from "../../shared/upscale";

const run = (file: string, args: string[], timeout = 5000) =>
  new Promise<string>((resolve) =>
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout) => resolve(error ? "" : String(stdout))),
  );

/** Memory other programs leave free now (what can be reclaimed without swapping), in GB. */
async function availableMemoryGB(): Promise<number | null> {
  try {
    if (process.platform === "darwin") {
      const out = await run("/usr/bin/vm_stat", []);
      const page = Number(/page size of (\d+)/.exec(out)?.[1] ?? 16384);
      const pages = (name: string) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
      const free = pages("Pages free") + pages("Pages inactive") + pages("Pages speculative") + pages("Pages purgeable");
      return out ? Math.round(((free * page) / 2 ** 30) * 10) / 10 : null;
    }
    if (process.platform === "linux") {
      const info = await fsp.readFile("/proc/meminfo", "utf8");
      const kb = Number(/MemAvailable:\s+(\d+)/.exec(info)?.[1]);
      return kb ? Math.round((kb / 2 ** 20) * 10) / 10 : null;
    }
    return Math.round((os.freemem() / 2 ** 30) * 10) / 10;
  } catch {
    return null;
  }
}

/** The GPU, as the system reports it, before PyTorch is installed. */
async function detectGpu(ramGB: number): Promise<UpscaleHardware["gpu"]> {
  if (process.platform === "darwin")
    return process.arch === "arm64"
      ? // The GPU shares the memory; macOS lets Metal use about three quarters of it.
        { kind: "apple", name: os.cpus()[0]?.model ?? "Apple Silicon", vramGB: Math.round(ramGB * 0.74 * 10) / 10, freeGB: null }
      : { kind: "none", name: "", vramGB: null, freeGB: null };
  const smi = await run("nvidia-smi", ["--query-gpu=name,memory.total,memory.free,driver_version,compute_cap", "--format=csv,noheader,nounits"]);
  const line = smi.split(/\r?\n/).find((l) => l.trim());
  if (line) {
    const [name, total, free, driver, cap] = line.split(",").map((s) => s.trim());
    return {
      kind: "nvidia",
      name,
      vramGB: Math.round((Number(total) / 1024) * 10) / 10,
      freeGB: Math.round((Number(free) / 1024) * 10) / 10,
      driver,
      capability: Number(cap) || undefined,
    };
  }
  if (process.platform === "linux") {
    for (const card of await fsp.readdir("/sys/class/drm").catch(() => [] as string[])) {
      const vendor = await fsp.readFile(`/sys/class/drm/${card}/device/vendor`, "utf8").catch(() => "");
      if (/0x1002/.test(vendor)) return { kind: "amd", name: "AMD", vramGB: null, freeGB: null };
      if (/0x8086/.test(vendor)) return { kind: "intel", name: "Intel", vramGB: null, freeGB: null };
    }
  }
  if (process.platform === "win32") {
    const names = await run("powershell.exe", ["-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name"], 6000);
    if (/radeon|amd/i.test(names)) return { kind: "amd", name: names.split(/\r?\n/)[0].trim(), vramGB: null, freeGB: null };
    if (/intel.*arc/i.test(names)) return { kind: "intel", name: names.split(/\r?\n/)[0].trim(), vramGB: null, freeGB: null };
  }
  return { kind: "none", name: "", vramGB: null, freeGB: null };
}

/** The PyTorch build for this machine: [version, index URL or null for PyPI]. */
export function torchBuild(hardware: UpscaleHardware): [string, string | null] {
  const index = "https://download.pytorch.org/whl/";
  if (process.platform === "darwin") return ["2.15.0", null];
  const gpu = hardware.gpu;
  if (gpu.kind === "nvidia" && gpu.capability && gpu.capability >= 5) {
    const driver = Number(gpu.driver?.split(".")[0] ?? 0);
    if (gpu.capability < 7.5) return ["2.14.1", index + "cu126"]; // Maxwell, Pascal, Volta
    if (driver >= 580) return ["2.14.1", index + "cu130"];
    if (driver >= 570) return ["2.11.0", index + "cu128"];
    return ["2.14.1", index + "cu126"];
  }
  return ["2.15.0", index + "cpu"];
}
/** Everything else the environment needs, pinned (tested together with torch 2.15 on macOS). */
export const UPSCALE_REQUIREMENTS = [
  "diffusers==0.43.0",
  "accelerate==1.16.0",
  "safetensors==0.8.0",
  "huggingface-hub==2.5.0",
  "numpy==2.5.5",
  "pillow==13.0.0",
  "torchao==0.18.0",
];

type Pending = {
  id: number;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  progress?: (done: number, total: number) => void;
};

export class Upscaler {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: Pending | null = null;
  private nextId = 0;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private stderr = "";
  private hardwareCache: { at: number; value: UpscaleHardware } | null = null;
  private probed: Partial<UpscaleHardware> | null = null;
  /** Sends a request to the main process, which holds the keys of the online services. */
  remote?: (input: unknown, signal: AbortSignal) => Promise<unknown>;
  constructor(
    public repo: Repository,
    public models: Models,
    public script: string,
  ) {}

  // ---------------------------------------------------------------- hardware
  async hardware(refresh = false): Promise<UpscaleHardware> {
    if (!refresh && this.hardwareCache && Date.now() - this.hardwareCache.at < 30_000) return this.hardwareCache.value;
    const ramGB = Math.round((os.totalmem() / 2 ** 30) * 10) / 10;
    const value: UpscaleHardware = {
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model?.trim() ?? process.arch,
      threads: os.cpus().length,
      ramGB,
      availableGB: await availableMemoryGB(),
      gpu: await detectGpu(ramGB),
    };
    // What PyTorch reported once installed is more exact (free VRAM, Metal's budget).
    if (this.probed?.gpu) value.gpu = { ...value.gpu, ...this.probed.gpu };
    value.probed = !!this.probed;
    this.hardwareCache = { at: Date.now(), value };
    return value;
  }

  // ------------------------------------------------------------- installation
  envDirectory() {
    return path.join(this.repo.root, "models", UPSCALE_ENV_ID, UPSCALE_ENV_VERSION);
  }
  python() {
    return process.platform === "win32"
      ? path.join(this.envDirectory(), "venv", "Scripts", "python.exe")
      : path.join(this.envDirectory(), "venv", "bin", "python");
  }
  private envReady() {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(this.envDirectory(), "environment.json"), "utf8"));
      return info.version === UPSCALE_ENV_VERSION && fs.existsSync(this.python());
    } catch {
      return false;
    }
  }
  private async folderBytes(dir: string): Promise<number> {
    let total = 0;
    for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await this.folderBytes(p);
      else if (entry.isFile()) total += (await fsp.lstat(p).catch(() => ({ size: 0 }))).size;
    }
    return total;
  }

  async status(refresh = false): Promise<UpscaleStatus> {
    const hardware = await this.hardware(refresh);
    const recommendation = recommendProfile(hardware);
    const settings = this.repo.getSettings().upscale ?? {};
    const choice = settings.profile ?? "auto";
    const list = this.models.list();
    const model = list.find((m) => m.id === UPSCALE_MODEL_ID),
      runtime = list.find((m) => m.id === UPSCALE_RUNTIME_ID);
    const environment = this.envReady();
    const catalog = this.models.get(UPSCALE_MODEL_ID);
    let downloadBytes = 0;
    for (const id of [UPSCALE_MODEL_ID, UPSCALE_RUNTIME_ID]) {
      const m = list.find((x) => x.id === id);
      if (m && !m.verified) downloadBytes += this.models.get(id).files.reduce((s, f) => s + f.size, 0) - m.bytes;
    }
    const envBytes = environment ? await this.folderBytes(this.envDirectory()) : 0;
    const envEstimate = hardware.gpu.kind === "nvidia" ? 5.5e9 : process.platform === "darwin" ? 1e9 : 1.2e9;
    if (!environment) downloadBytes += envEstimate * 0.6;
    const preparing = this.repo.db
      .prepare("SELECT id FROM jobs WHERE kind='prepare' AND state IN ('queued','running','paused') AND json_extract(payload_json,'$.upscale')=1 LIMIT 1")
      .get() as { id: string } | undefined;
    return {
      hardware,
      recommendation,
      choice,
      profile: choice === "auto" ? recommendation.profile : choice,
      installed: { runtime: !!runtime?.verified, model: !!model?.verified, environment },
      ready: !!model?.verified && environment,
      downloadBytes: Math.max(0, Math.round(downloadBytes)),
      diskBytes: Math.round(catalog.files.reduce((s, f) => s + f.size, 0) + envEstimate),
      usedBytes: (model?.bytes ?? 0) + (runtime?.bytes ?? 0) + envBytes,
      measured: settings.measured ?? {},
      preparing: preparing?.id ?? null,
      revision: catalog.revision,
      license: catalog.license,
    };
  }

  /** Queues the download of uv and the weights, their checks, and the environment. */
  async install(): Promise<string> {
    const status = await this.status(true);
    if (!status.recommendation.supported && status.choice === "auto") throw new Error(status.recommendation.reason);
    if (status.preparing) {
      this.repo.db.prepare("UPDATE jobs SET state='queued' WHERE id=? AND state='paused'").run(status.preparing);
      return status.preparing;
    }
    await ensureDiskSpace(this.repo.root, status.downloadBytes + 2e9);
    const list = this.models.list();
    const steps: { id: string; fileIndex: number | null }[] = [];
    for (const id of [UPSCALE_RUNTIME_ID, UPSCALE_MODEL_ID]) {
      if (list.find((m) => m.id === id)?.verified) continue;
      this.models.get(id).files.forEach((_, fileIndex) => steps.push({ id, fileIndex }));
      steps.push({ id, fileIndex: null });
    }
    if (!status.installed.environment) steps.push({ id: UPSCALE_ENV_ID, fileIndex: null });
    if (!steps.length) throw new Error("El escalado local ya está instalado.");
    return this.repo.newJob("prepare", { label: UPSCALE_INSTALL_LABEL, steps, upscale: 1 }, steps.length);
  }

  /** Unpacks uv into the runtime folder (no links, no paths outside it). */
  async unpackRuntime() {
    const model = this.models.get(UPSCALE_RUNTIME_ID),
      root = this.models.directory(UPSCALE_RUNTIME_ID),
      archive = path.join(root, model.files[0].path),
      bin = path.join(root, "bin");
    await fsp.rm(bin, { recursive: true, force: true });
    await fsp.mkdir(bin, { recursive: true });
    if (archive.endsWith(".zip")) {
      const zip = await Archive.open(archive);
      try {
        await zip.preflight(bin);
        for (const [name] of zip.entries) {
          if (name.endsWith("/")) continue;
          const target = path.join(bin, path.basename(name));
          await zip.extract(name, target);
        }
      } finally {
        zip.close();
      }
    } else
      await tar.x({
        file: archive,
        cwd: bin,
        strict: true,
        strip: 1,
        filter: (p, entry) =>
          !path.isAbsolute(p) && !p.split(/[\\/]/).includes("..") && !("type" in entry && ["SymbolicLink", "Link"].includes(entry.type)),
      });
    const uv = this.uv();
    if (!fs.existsSync(uv)) throw new Error("El archivo de uv no contiene el ejecutable.");
    if (process.platform !== "win32") await fsp.chmod(uv, 0o755);
  }
  private uv() {
    return path.join(this.models.directory(UPSCALE_RUNTIME_ID), "bin", process.platform === "win32" ? "uv.exe" : "uv");
  }

  /**
   * Creates the Python environment: a managed Python 3.12, PyTorch for this
   * GPU and the pinned packages. Nothing from the model is executed.
   */
  async prepareEnvironment(signal: AbortSignal, message: (text: string) => void) {
    if (!fs.existsSync(this.uv())) await this.unpackRuntime();
    // Built in place: it only counts as ready once environment.json is written last.
    const dir = this.envDirectory();
    const stage = dir;
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    const hardware = await this.hardware(true);
    await ensureDiskSpace(path.dirname(dir), hardware.gpu.kind === "nvidia" ? 7e9 : 2.5e9);
    const env = {
      ...process.env,
      UV_PYTHON_INSTALL_DIR: path.join(stage, "python"),
      UV_CACHE_DIR: path.join(stage, "cache"),
      UV_NO_CONFIG: "1",
      UV_LINK_MODE: "copy",
      UV_PYTHON_PREFERENCE: "only-managed",
      VIRTUAL_ENV: "",
      PYTHONHOME: "",
      PYTHONPATH: "",
    };
    const python = process.platform === "win32" ? path.join(stage, "venv", "Scripts", "python.exe") : path.join(stage, "venv", "bin", "python");
    const step = (args: string[], label: string) =>
      new Promise<void>((resolve, reject) => {
        message(label);
        const child = spawn(this.uv(), args, { env, shell: false, windowsHide: true });
        let tail = "";
        const read = (data: Buffer) => {
          tail = (tail + data.toString()).slice(-4000);
          const line = data.toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
          const downloading = line && /Downloading|Downloaded|Installed|Prepared/.exec(line) ? line.replace(/\s+/g, " ").slice(0, 120) : null;
          if (downloading) message(`${label} · ${downloading}`);
        };
        child.stdout.on("data", read);
        child.stderr.on("data", read);
        const abort = () => child.kill();
        signal.addEventListener("abort", abort, { once: true });
        child.on("error", reject);
        child.on("close", (code) => {
          signal.removeEventListener("abort", abort);
          if (signal.aborted) reject(new Error("Instalación pausada."));
          else if (code === 0) resolve();
          else reject(new Error(`${label}: ${tail.trim().split(/\r?\n/).slice(-3).join(" ")}`));
        });
      });
    try {
      await step(["venv", "--python", "3.12", path.join(stage, "venv")], "Preparando Python 3.12");
      const [version, index] = torchBuild(hardware);
      await step(
        ["pip", "install", "--python", python, `torch==${version}`, ...(index ? ["--index-url", index] : [])],
        `Instalando PyTorch ${version}${index ? " · " + index.split("/").pop() : ""}`,
      );
      await step(["pip", "install", "--python", python, ...UPSCALE_REQUIREMENTS], "Instalando diffusers y dependencias");
      message("Comprobando el entorno");
      const probe = await this.oneShot(python, { operation: "probe" });
      await fsp.writeFile(
        path.join(stage, "environment.json"),
        JSON.stringify({ version: UPSCALE_ENV_VERSION, torch: version, index, probe, createdAt: new Date().toISOString() }, null, 2),
      );
      await fsp.rm(path.join(stage, "cache"), { recursive: true, force: true });
    } catch (error) {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  /** Runs one request in a fresh process (for the probe while installing). */
  private oneShot(python: string, request: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const child = spawn(python, ["-u", this.script], { shell: false, windowsHide: true, env: this.childEnv() });
      let err = "";
      child.stderr.on("data", (d) => (err = (err + d).slice(-3000)));
      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        try {
          const message = JSON.parse(line);
          if (message.id !== 1 || message.progress) return;
          child.stdin.end();
          message.ok ? resolve(message.result) : reject(new Error(message.error));
        } catch {
          /* not a protocol line */
        }
      });
      child.on("error", reject);
      child.on("close", (code) => code && reject(new Error("El entorno de escalado no arranca: " + err.trim().split(/\r?\n/).pop())));
      child.stdin.write(JSON.stringify({ ...request, id: 1 }) + "\n");
    });
  }
  private childEnv() {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "LANG", "CUDA_VISIBLE_DEVICES", "LD_LIBRARY_PATH"])
      if (process.env[key]) env[key] = process.env[key];
    return { ...env, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1", PYTHONNOUSERSITE: "1", PYTORCH_ENABLE_MPS_FALLBACK: "1" };
  }

  /** Removes the weights, uv and the environment (versions already made are kept). */
  async uninstall() {
    this.close();
    for (const id of [UPSCALE_MODEL_ID, UPSCALE_RUNTIME_ID, UPSCALE_ENV_ID])
      await fsp.rm(path.join(this.repo.root, "models", id), { recursive: true, force: true });
    this.probed = null;
    this.hardwareCache = null;
  }

  // ---------------------------------------------------------------- process
  close() {
    clearTimeout(this.idle);
    const child = this.child;
    this.child = null;
    child?.kill();
    if (this.pending) {
      this.pending.reject(new Error("Escalado detenido."));
      this.pending = null;
    }
  }
  private start() {
    if (this.child) return this.child;
    if (!this.envReady()) throw new Error("Instala el escalado local en Ajustes › Modelos locales.");
    this.stderr = "";
    const child = spawn(this.python(), ["-u", this.script], { shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: this.childEnv() });
    this.child = child;
    child.stderr.on("data", (data) => (this.stderr = (this.stderr + data.toString()).slice(-4000)));
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const p = this.pending;
      if (!p || p.id !== message.id) return;
      if (message.progress) return p.progress?.(message.progress.done, message.progress.total);
      this.pending = null;
      if (message.ok) p.resolve(message.result);
      else {
        const error = new Error(message.cancelled ? "Escalado cancelado." : this.explain(message.error));
        (error as { cancelled?: boolean }).cancelled = !!message.cancelled;
        p.reject(error);
      }
    });
    const failed = () => {
      if (this.child !== child) return;
      this.child = null;
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        p.reject(new Error(this.explain(this.stderr.trim().split(/\r?\n/).slice(-2).join(" ") || "El proceso de escalado se cerró.")));
      }
    };
    child.on("error", failed);
    child.on("exit", failed);
    return child;
  }
  private explain(error: string) {
    if (/out of memory|OutOfMemory|MPS backend out of memory/i.test(error))
      return "No hay memoria suficiente para este perfil. Elige uno más ligero en Ajustes › Modelos locales, cierra otros programas o escala por zonas.";
    return error;
  }
  private request(input: Record<string, unknown>, progress?: (done: number, total: number) => void): Promise<any> {
    if (this.pending) return Promise.reject(new Error("Ya hay un escalado en curso."));
    clearTimeout(this.idle);
    const child = this.start();
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending = { id, resolve, reject, progress };
      child.stdin.write(JSON.stringify({ ...input, id }) + "\n");
    }).finally(() => {
      // The model takes several GB: let it go soon after the last image.
      this.idle = setTimeout(() => this.close(), 90_000);
    });
  }
  async probe() {
    const result = await this.request({ operation: "probe" });
    const gpu: Partial<UpscaleHardware["gpu"]> = {};
    if (result.cuda) {
      Object.assign(gpu, {
        kind: "nvidia",
        name: result.cuda.name,
        vramGB: Math.round((result.cuda.totalBytes / 2 ** 30) * 10) / 10,
        freeGB: Math.round((result.cuda.freeBytes / 2 ** 30) * 10) / 10,
        capability: Number(result.cuda.capability),
      });
    } else if (result.mps) gpu.vramGB = Math.round((result.mps.recommendedBytes / 2 ** 30) * 10) / 10;
    this.probed = { gpu: gpu as UpscaleHardware["gpu"] };
    this.hardwareCache = null;
    return result;
  }

  // ---------------------------------------------------------------- one item
  /** The source as shown (turned and cropped), or the version it starts from. */
  private async source(assetId: string, baseId: string | null): Promise<Buffer> {
    if (baseId) {
      const base = this.repo.db.prepare("SELECT file,asset_id FROM restorations WHERE id=?").get(baseId) as { file: string; asset_id: string } | undefined;
      if (!base || base.asset_id !== assetId) throw new Error("Versión no encontrada.");
      return fsp.readFile(base.file);
    }
    const asset = this.repo.asset(assetId) as { original_path: string; metadata_json: string };
    return (await orientedImage(asset.original_path, assetView(asset.metadata_json))).png().toBuffer();
  }

  /** The source of an item, cut to its region if it has one. */
  private async itemImage(item: UpscaleJobPayload["items"][number]) {
    let image = sharp(await this.source(item.assetId, item.baseId));
    const meta = await image.metadata();
    const [w, h] = [meta.width ?? 1, meta.height ?? 1];
    if (item.region) {
      const left = Math.max(0, Math.min(w - 1, Math.round(item.region.x * w))),
        top = Math.max(0, Math.min(h - 1, Math.round(item.region.y * h)));
      image = sharp(
        await image
          .extract({ left, top, width: Math.max(8, Math.min(w - left, Math.round(item.region.w * w))), height: Math.max(8, Math.min(h - top, Math.round(item.region.h * h))) })
          .png()
          .toBuffer(),
      );
    }
    const cut = await image.metadata();
    return { image, width: cut.width ?? 1, height: cut.height ?? 1 };
  }

  /** Upscales one item with an online service and stores it as a version. */
  private async runApiItem(payload: UpscaleJobPayload, index: number, signal: AbortSignal, message: (text: string) => void): Promise<string> {
    const engine = payload.engine as Extract<NonNullable<UpscaleJobPayload["engine"]>, { kind: "api" }>;
    const item = payload.items[index];
    const asset = this.repo.asset(item.assetId) as { row_id: string } | undefined;
    if (!asset) throw new Error("La imagen ya no existe.");
    if (!this.remote) throw Object.assign(new Error("Los servicios en línea no están disponibles."), { fatal: true });
    const { image, width, height } = await this.itemImage(item);
    // The output stays within the size allowed; some models only take small images.
    let plan = planUpscale(width, height, payload.scale, { maxOutputSide: payload.maxOutputSide, fit: false });
    const limit = API_INPUT_LIMITS[`${engine.service}|${engine.model}`];
    if (limit) {
      const [iw, ih] = plan.input;
      const f = Math.min(1, Math.sqrt(limit.maxPixels / (iw * ih)), limit.maxSide ? limit.maxSide / Math.max(iw, ih) : 1);
      if (f < 1) {
        const input: [number, number] = [Math.max(1, Math.floor(iw * f)), Math.max(1, Math.floor(ih * f))];
        plan = { ...plan, input, output: [input[0] * payload.scale, input[1] * payload.scale], reduced: Math.round(plan.reduced * f * 1000) / 1000, reason: "limit" };
      }
    }
    const png = await image.resize(plan.input[0], plan.input[1], { fit: "fill", kernel: "lanczos3" }).removeAlpha().toColourspace("srgb").png().toBuffer();
    const total = payload.items.length;
    const label = UPSCALE_SERVICES[engine.service].label;
    message(`${total > 1 ? `${index + 1}/${total} · ` : ""}Enviando a ${label}…`);
    const request: ApiUpscaleRequest = { upscaleApi: true, service: engine.service, model: engine.model, image: png.toString("base64"), width: plan.input[0], height: plan.input[1], scale: payload.scale };
    const result = (await this.remote(request, signal)) as ApiUpscaleResult;
    if (signal.aborted) throw new Error("Escalado cancelado.");
    // Saved as PNG whatever the service returned, so every version opens the same way.
    // Some models choose their own size (SeedVR2 enlarges ~×6): a larger result is brought to the size asked for.
    let decoded = sharp(Buffer.from(result.image, "base64"));
    const got = await decoded.metadata();
    const [ew, eh] = [plan.input[0] * payload.scale, plan.input[1] * payload.scale];
    if ((got.width ?? 0) > ew * 1.05 || (got.height ?? 0) > eh * 1.05) decoded = decoded.resize(ew, eh, { fit: "fill", kernel: "lanczos3" });
    const output = await decoded.removeAlpha().png({ compressionLevel: 6 }).toBuffer();
    const meta = await sharp(output).metadata();
    const id = uuid(),
      folder = path.join(this.repo.root, "restorations"),
      file = path.join(folder, id + ".png");
    await fsp.mkdir(folder, { recursive: true });
    await fsp.writeFile(file, output);
    const params: UpscaleParams = {
      scale: payload.scale,
      creativity: 0,
      engine: "api",
      service: engine.service,
      model: engine.model,
      name: engine.name,
      cost: result.cost,
      profile: "",
      device: "api",
      dtype: "",
      revision: new Date().toISOString().slice(0, 10),
      input: plan.input,
      output: [meta.width ?? 0, meta.height ?? 0],
      tiles: 0,
      seconds: result.seconds,
      reduced: plan.reduced,
    };
    const prompt = [
      `${engine.name} (${label}, ${engine.model})`,
      `×${payload.scale}`,
      `${plan.input[0]}×${plan.input[1]} → ${meta.width}×${meta.height} px`,
      result.cost !== null ? `~${result.cost.toFixed(3)} USD` : "",
      plan.reduced < 1 ? `entrada reducida al ${Math.round(plan.reduced * 100)} %` : "",
      `fecha ${params.revision}`,
    ]
      .filter(Boolean)
      .join(" · ");
    this.repo.db
      .prepare(
        "INSERT INTO restorations(id,asset_id,row_id,provider,model,task,prompt,region_json,file,width,height,created_at,base_id,params_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(id, item.assetId, asset.row_id, engine.service, engine.model, "upscale", prompt, item.region ? JSON.stringify(item.region) : null, file, meta.width ?? 0, meta.height ?? 0, new Date().toISOString(), item.baseId ?? null, JSON.stringify(params));
    return id;
  }


  /** Upscales one item of a queued job and stores it as a version. */
  async runItem(payload: UpscaleJobPayload, index: number, signal: AbortSignal, message: (text: string) => void): Promise<string> {
    if (payload.engine?.kind === "api") return this.runApiItem(payload, index, signal, message);
    const item = payload.items[index];
    const asset = this.repo.asset(item.assetId) as { row_id: string } | undefined;
    if (!asset) throw new Error("La imagen ya no existe.");
    const status = await this.status();
    if (!status.ready) throw Object.assign(new Error("Instala el escalado local en Ajustes › Modelos locales."), { fatal: true });
    const profile = status.profile;
    const { image, width: cutWidth, height: cutHeight } = await this.itemImage(item);
    const plan = planUpscale(cutWidth, cutHeight, payload.scale, { maxOutputSide: payload.maxOutputSide, fit: payload.fit });
    const staging = path.join(this.repo.root, "staging");
    const folder = path.join(this.repo.root, "restorations");
    await fsp.mkdir(staging, { recursive: true });
    await fsp.mkdir(folder, { recursive: true });
    const id = uuid(),
      input = path.join(staging, `upscale-${id}.png`),
      output = path.join(folder, id + ".png"),
      cancel = path.join(staging, `upscale-${id}.cancel`);
    await image
      .resize(plan.input[0], plan.input[1], { fit: "fill", kernel: plan.reduced < 1 ? "lanczos3" : "nearest" })
      .removeAlpha()
      .toColourspace("srgb")
      .png()
      .toFile(input);
    const abort = () => void fsp.writeFile(cancel, "").catch(() => {});
    signal.addEventListener("abort", abort, { once: true });
    const total = payload.items.length;
    const started = Date.now();
    message(`${total > 1 ? `${index + 1}/${total} · ` : ""}${this.child ? "Preparando la imagen…" : "Cargando el modelo…"}`);
    try {
      const secondsPerTile = status.measured[profile] ?? status.recommendation.secondsPerTile;
      const result = await this.request(
        {
          operation: "upscale",
          directory: this.models.directory(UPSCALE_MODEL_ID),
          device: profile === "cpu" ? "cpu" : "auto",
          profile,
          input,
          output,
          scale: payload.scale,
          creativity: payload.creativity,
          cancel,
          threads: os.cpus().length,
        },
        (done, tiles) => {
          const left = Math.max(0, tiles - done) * secondsPerTile;
          message(
            `${total > 1 ? `${index + 1}/${total} · ` : ""}${done === 0 ? "Cargando el modelo…" : `tesela ${done}/${tiles}`}${
              done > 0 && left > 0 ? ` · ~${left < 60 ? Math.ceil(left) + " s" : Math.ceil(left / 60) + " min"}` : ""
            }`,
          );
        },
      );
      const params: UpscaleParams = {
        scale: payload.scale,
        creativity: payload.creativity,
        profile: result.profile,
        device: result.device,
        dtype: `${result.dtype}${result.quant === "int8" ? " + int8" : ""}`,
        revision: status.revision,
        input: plan.input,
        output: [result.width, result.height],
        tiles: result.tiles,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        reduced: plan.reduced,
      };
      this.learn(result.profile, result.seconds / Math.max(1, result.tiles));
      const prompt = [
        `${UPSCALE_MODEL_NAME} (${status.revision.slice(0, 12)})`,
        `×${payload.scale}`,
        `creatividad ${payload.creativity}/8`,
        `perfil ${PROFILE_LABELS[result.profile as UpscaleProfile] ?? result.profile} (${result.device}, ${params.dtype})`,
        `${plan.input[0]}×${plan.input[1]} → ${result.width}×${result.height} px`,
        plan.reduced < 1 ? `entrada reducida al ${Math.round(plan.reduced * 100)} %` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      this.repo.db
        .prepare(
          "INSERT INTO restorations(id,asset_id,row_id,provider,model,task,prompt,region_json,file,width,height,created_at,base_id,params_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          item.assetId,
          asset.row_id,
          "local",
          "kandinsky-imagesr-2.0",
          "upscale",
          prompt,
          item.region ? JSON.stringify(item.region) : null,
          output,
          result.width,
          result.height,
          new Date().toISOString(),
          item.baseId ?? null,
          JSON.stringify(params),
        );
      return id;
    } catch (error) {
      await fsp.rm(output, { force: true }).catch(() => {});
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      await fsp.rm(input, { force: true }).catch(() => {});
      await fsp.rm(cancel, { force: true }).catch(() => {});
    }
  }
  /** A running average of this computer's seconds per tile, for honest estimates. */
  private learn(profile: UpscaleProfile, seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const settings = this.repo.getSettings();
    const upscale = settings.upscale ?? {};
    const previous = upscale.measured?.[profile];
    const value = Math.round((previous ? previous * 0.6 + seconds * 0.4 : seconds) * 10) / 10;
    this.repo.updateSettings({ upscale: { ...upscale, measured: { ...upscale.measured, [profile]: Math.min(36000, value) } } });
  }
}

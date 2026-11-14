// Channel semantics and explicit restart/verified-backup gate follow Nodus Research.
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { updateArtifactArchitecture } from "../shared/updateArtifacts.mjs";
import { valid, gt, prerelease } from "semver";
import {
  updatePreferencesSchema,
  type UpdatePreferences,
  type UpdateStatus,
} from "../shared/updates";
type Info = {
  version: string;
  files?: { url: string; sha512: string; size?: number }[];
  downloadedFile?: string;
};
export interface NativeUpdater {
  channel: string | null;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<{
    isUpdateAvailable: boolean;
    updateInfo: Info;
    cancellationToken?: { cancel: () => void };
    downloadPromise?: Promise<unknown> | null;
  } | null>;
  downloadUpdate(token?: any): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}
export async function sha512File(file: string) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("base64");
}
export function compatibleUpdateAssets(
  info: Info,
  platform: string,
  arch: string,
  packageType = "AppImage",
) {
  const extension =
    platform === "darwin" ? "zip" : platform === "win32" ? "exe" : packageType;
  return (info.files ?? []).filter((f) => {
    try {
      const file = decodeURIComponent(
        new URL(f.url, "https://releases.invalid/").pathname,
      )
        .split("/")
        .pop()!;
      return (
        file.startsWith("Nodus-Imago-") &&
        file.endsWith(
          `-${updateArtifactArchitecture(platform, arch, extension)}.${extension}`,
        ) &&
        Buffer.from(f.sha512, "base64").length === 64
      );
    } catch {
      return false;
    }
  });
}
export class Updates {
  private state: UpdateStatus;
  private checkTask: Promise<UpdateStatus> | null = null;
  private downloadTask: Promise<unknown> | null = null;
  private installation = false;
  private configTask: Promise<unknown> = Promise.resolve();
  private downloaded: { file: string; sha512: string; version: string } | null =
    null;
  private cancellation: { cancel: () => void } | undefined;
  private epoch = 0;
  private timer?: ReturnType<typeof setInterval>;
  private startup?: ReturnType<typeof setTimeout>;
  private closed = false;
  constructor(
    private updater: NativeUpdater,
    private options: {
      userData: string;
      version: string;
      packaged: boolean;
      disabled: boolean;
      platform: string;
      arch: string;
      packageType?: string;
      changed: () => void;
      /** Lock the collection and, when `backup` is true, write a verified copy. */
      prepare: (password: string | undefined, backup: boolean) => Promise<void>;
      finish: (success: boolean) => Promise<void>;
      canInstall: () => Promise<void>;
      /** Backups configured (folder) and usable unattended (folder + stored password). */
      recovery?: () => Promise<{ configured: boolean; ready: boolean }>;
    },
  ) {
    let preferences = updatePreferencesSchema.parse({});
    try {
      preferences = updatePreferencesSchema.parse(
        JSON.parse(
          require("node:fs").readFileSync(
            path.join(options.userData, "updates.json"),
            "utf8",
          ),
        ),
      );
    } catch {}
    this.state = {
      preferences,
      status: options.packaged && !options.disabled ? "idle" : "disabled",
      currentVersion: options.version,
      version: null,
      progress: null,
      message:
        options.packaged && !options.disabled
          ? ""
          : "Las actualizaciones solo están disponibles en la aplicación empaquetada.",
      checkedAt: null,
    };
    this.channel();
    updater.on("update-available", (info: Info) => {
      if (this.accepts(info.version) && !this.downloaded && !this.installation)
        this.emit({
          status: "available",
          version: info.version,
          message: "Hay una nueva versión disponible.",
        });
    });
    updater.on("download-progress", (p: { percent: number }) => {
      if (!this.installation && this.accepts(this.state.version ?? ""))
        this.emit({
          status: "downloading",
          progress: Number.isFinite(p.percent)
            ? Math.max(0, Math.min(100, p.percent))
            : null,
          message: "Descargando actualización…",
        });
    });
    updater.on("update-downloaded", (info: Info) => {
      void this.acceptDownloaded(info).catch((e) => this.error(e));
    });
    updater.on("error", (error: Error) => {
      if (this.installation) {
        this.installation = false;
        void this.options.finish(false).catch(() => {});
      }
      if (!this.closed)
        this.error(
          error,
          this.state.status === "downloading"
            ? "update-download-failed"
            : "update-check-failed",
        );
    });
  }
  status() {
    return { ...this.state, preferences: { ...this.state.preferences } };
  }
  private emit(patch: Partial<UpdateStatus>) {
    // A new state carries its own error code; an old one never lingers.
    this.state = { ...this.state, errorCode: undefined, ...patch };
    this.options.changed();
    return this.status();
  }
  private error(error: unknown, errorCode?: UpdateStatus["errorCode"]) {
    return this.emit({
      status: "error",
      progress: null,
      errorCode,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  private accepts(version: string) {
    return (
      !!valid(version) &&
      gt(version, this.options.version) &&
      (this.state.preferences.beta || !prerelease(version))
    );
  }
  private channel() {
    this.updater.channel = this.state.preferences.beta ? "beta" : "latest";
    this.updater.allowPrerelease = this.state.preferences.beta;
    this.updater.allowDowngrade = false;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
  }
  configure(value: UpdatePreferences) {
    const task = this.configTask.then(() => this.savePreferences(value));
    this.configTask = task.catch(() => {});
    return task;
  }
  private async savePreferences(value: UpdatePreferences) {
    if (this.installation) throw Error("La instalación ya está en curso.");
    const preferences = updatePreferencesSchema.parse(value);
    const channelChanged = preferences.beta !== this.state.preferences.beta;
    if (channelChanged) {
      this.epoch++;
      this.cancellation?.cancel();
      this.downloaded = null;
      this.emit({
        version: null,
        progress: null,
        status:
          this.options.packaged && !this.options.disabled ? "idle" : "disabled",
      });
    }
    this.state.preferences = preferences;
    this.channel();
    const file = path.join(this.options.userData, "updates.json"),
      temp = file + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temp, JSON.stringify(preferences), { mode: 0o600 });
      await fs.rename(temp, file);
    } finally {
      await fs.rm(temp, { force: true });
    }
    this.options.changed();
  }
  async check(): Promise<UpdateStatus> {
    if (this.closed || !this.options.packaged || this.options.disabled)
      return this.status();
    if (this.checkTask) return this.checkTask;
    if (this.installation || this.downloadTask) return this.status();
    if (this.downloaded)
      return this.emit({
        status: "downloaded",
        progress: 100,
        message:
          "Actualización verificada. Puedes instalarla y reiniciar cuando quieras.",
      });
    const epoch = this.epoch;
    this.channel();
    this.emit({
      status: "checking",
      message: "Buscando actualizaciones…",
      progress: null,
    });
    const task = (async () => {
      try {
        const result = await this.updater.checkForUpdates();
        if (epoch !== this.epoch || this.closed) return this.status();
        this.state.checkedAt = new Date().toISOString();
        this.cancellation = result?.cancellationToken;
        if (
          result?.isUpdateAvailable === true &&
          this.accepts(result.updateInfo.version)
        ) {
          if (
            !compatibleUpdateAssets(
              result.updateInfo,
              this.options.platform,
              this.options.arch,
              this.options.packageType,
            ).length
          )
            throw Error(
              "La release no contiene un paquete compatible con este dispositivo.",
            );
          this.emit({
            status: "available",
            version: result.updateInfo.version,
            message: "Hay una nueva versión disponible.",
          });
          if (this.state.preferences.autoDownload)
            void this.download().catch(() => {});
        } else
          this.emit({
            status: "not-available",
            version: null,
            message: "Nodus Imago está actualizado.",
            progress: null,
          });
        return this.status();
      } catch (e) {
        if (epoch === this.epoch && !this.closed)
          return this.error(e, "update-check-failed");
        return this.status();
      }
    })();
    this.checkTask = task;
    try {
      return await task;
    } finally {
      if (this.checkTask === task) this.checkTask = null;
    }
  }
  async download() {
    if (this.closed || this.installation || this.downloaded) return;
    if (this.downloadTask) return this.downloadTask;
    if (
      this.state.status !== "available" ||
      !this.accepts(this.state.version ?? "")
    )
      throw Error("Comprueba primero si hay una actualización compatible.");
    const epoch = this.epoch;
    this.emit({
      status: "downloading",
      progress: 0,
      message: "Descargando actualización…",
    });
    const task = this.updater.downloadUpdate(this.cancellation);
    this.downloadTask = task;
    try {
      await task;
    } catch (e) {
      if (epoch === this.epoch && !this.closed)
        this.error(e, "update-download-failed");
      throw e;
    } finally {
      if (this.downloadTask === task) this.downloadTask = null;
    }
  }
  private async acceptDownloaded(info: Info) {
    if (
      this.closed ||
      this.installation ||
      !this.accepts(info.version) ||
      !info.downloadedFile
    )
      return;
    const epoch = this.epoch;
    const file = info.downloadedFile;
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error("El paquete de actualización no es un archivo válido.");
    const hash = await sha512File(file);
    if (
      !compatibleUpdateAssets(
        info,
        this.options.platform,
        this.options.arch,
        this.options.packageType,
      ).some((f) => f.sha512 === hash && (!f.size || f.size === stat.size))
    )
      throw Error(
        "La integridad o arquitectura de la actualización no coincide.",
      );
    if (epoch !== this.epoch || this.closed || !this.accepts(info.version))
      return;
    this.downloaded = { file, sha512: hash, version: info.version };
    this.emit({
      status: "downloaded",
      version: info.version,
      progress: 100,
      message:
        "Actualización verificada. Puedes instalarla y reiniciar cuando quieras.",
    });
  }
  /**
   * Install the verified download, with Nodus Research's safety contract:
   * a beta needs a verified copy (fail-closed); a stable release makes one
   * whenever copies are configured, and a failed copy never blocks it.
   */
  async install(password?: string) {
    if (this.installation) throw Error("La instalación ya está en curso.");
    if (
      !this.downloaded ||
      this.state.status !== "downloaded" ||
      !this.accepts(this.downloaded.version)
    )
      throw Error("No hay una actualización verificada para instalar.");
    const beta = !!prerelease(this.downloaded.version);
    // Claimed before any await, so a second click cannot start a second install.
    this.installation = true;
    const recovery = (this.options.recovery
      ? await this.options.recovery().catch(() => null)
      : null) ?? {
      configured: true,
      ready: true,
    };
    if (beta && !(recovery.configured && (recovery.ready || !!password))) {
      this.installation = false;
      const error = Error(
        "La beta no se instalará hasta que configures las copias de seguridad con una carpeta y una contraseña.",
      );
      this.emit({ status: "downloaded", errorCode: "pre-update-backup-required", message: error.message, progress: 100 });
      throw error;
    }
    const backup = beta || recovery.configured;
    let prepared = false;
    try {
      await this.options.canInstall();
      if ((await sha512File(this.downloaded.file)) !== this.downloaded.sha512) {
        this.downloaded = null;
        throw Error(
          "El paquete cambió después de verificarse. Vuelve a descargar la actualización.",
        );
      }
      let backupWarning: string | undefined;
      if (backup)
        this.emit({
          status: "backing-up",
          message: "Creando una copia cifrada y verificada antes de actualizar…",
        });
      prepared = true;
      try {
        await this.options.prepare(password, backup);
      } catch (e) {
        if (beta || !backup) {
          if (beta)
            throw Object.assign(
              Error(
                `La beta no se instaló porque no pudo crearse una copia de seguridad verificable: ${e instanceof Error ? e.message : String(e)}`,
              ),
              { code: "pre-update-backup-failed" },
            );
          throw e;
        }
        // Stable: the problem is reported, the release still installs.
        backupWarning = e instanceof Error ? e.message : String(e);
      }
      if ((await sha512File(this.downloaded.file)) !== this.downloaded.sha512)
        throw Error("El paquete cambió durante la copia de seguridad.");
      await this.options.finish(true);
      this.emit({
        status: "installing",
        backupWarning,
        message: "Cerrando Imago para instalar la actualización…",
      });
      this.updater.autoInstallOnAppQuit = false;
      this.updater.quitAndInstall(false, true);
    } catch (e) {
      if (prepared) await this.options.finish(false);
      this.installation = false;
      const code =
        (e as { code?: string })?.code === "pre-update-backup-failed"
          ? "pre-update-backup-failed"
          : "update-install-failed";
      this.error(e, code);
      // The verified download stays available for another attempt.
      if (this.downloaded)
        this.emit({
          status: "downloaded",
          errorCode: code,
          progress: 100,
          message: e instanceof Error ? e.message : String(e),
        });
      throw e;
    }
  }
  /**
   * As in Nodus, the interface makes the startup check (once per session, with
   * its progress bar) and the main process keeps the periodic one. The delayed
   * fallback covers a window that never asks, without checking twice.
   */
  start() {
    if (this.closed || this.state.status === "disabled" || this.timer) return;
    this.startup = setTimeout(() => {
      if (this.state.preferences.automaticChecks && !this.state.checkedAt)
        void this.check();
    }, 60000);
    this.startup.unref?.();
    this.timer = setInterval(() => {
      if (this.state.preferences.automaticChecks) void this.check();
    }, 4 * 3600000);
    this.timer.unref?.();
  }
  close() {
    this.closed = true;
    this.cancellation?.cancel();
    clearTimeout(this.startup);
    clearInterval(this.timer);
  }
}

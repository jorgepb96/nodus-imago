import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { z } from "zod";
import {
  updatePreferencesSchema,
  type UpdatePreferences,
} from "../../shared/updates";
import { Secrets } from "../secrets/store";
import { PROVIDERS, type ApiProvider } from "../../shared/aiConfig";
import {
  backupDue,
  backupPreferencesSchema,
  type BackupPreferences,
  type BackupEntry,
  type BackupStatus,
} from "../../shared/backups";
import {
  encryptedBackup,
  encryptBackup,
  decryptBackup,
  sealMetadata,
  openMetadata,
} from "./backupCrypto";
import { hashFile } from "../import/images";
import { ensureDiskSpace } from "../storage/disk";
const entrySchema = z
  .object({
    id: z.uuid(),
    file: z.string().max(4000),
    createdAt: z.iso.datetime(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    encrypted: z.boolean(),
    keyId: z.string(),
    archived: z.boolean(),
    verifiedAt: z.string(),
    reason: z.enum(["manual", "automatic", "before-restore", "before-update"]),
  })
  .strict();
const configSchema = z
  .object({
    format: z.literal("nodus.imago.backups/1"),
    preferences: backupPreferencesSchema,
    folder: z.string(),
    masterId: z.string(),
    lastSuccess: z.string().nullable(),
    lastAttempt: z.string().nullable(),
    lastError: z.string().nullable(),
    entries: z.array(entrySchema).max(10000),
  })
  .strict();
const applicationSchema = z
  .object({
    version: z.literal(1),
    client: z.record(z.string().max(300), z.string().max(1000000)),
    preferences: backupPreferencesSchema,
    credentials: z.string().max(2000000).optional(),
    updates: updatePreferencesSchema.optional(),
  })
  .strict();
type Inspection = {
  databases: number;
  rows: number;
  files: number;
  createdAt: string;
  application?: string;
  legacy: boolean;
};
type Callbacks = {
  write: (file: string, application: string) => Promise<void>;
  verify: (file: string) => Promise<Inspection>;
  restore: (file: string, replace: boolean) => Promise<number>;
  client: () => Promise<Record<string, string>>;
  applyClient: (client: Record<string, string>) => Promise<void>;
  cancel: () => Promise<unknown>;
  lockRestore: () => Promise<unknown>;
  unlockRestore: () => Promise<unknown>;
  changed: () => void;
  updates?: () => UpdatePreferences;
  applyUpdates?: (preferences: UpdatePreferences) => Promise<unknown>;
};
// Never replace a file that appeared after preflight (e.g. a cloud-sync race).
// Hard links publish atomically; filesystems without them use exclusive copying.
export async function publishBackupFile(
  source: string,
  destination: string,
  expectedHash: string,
) {
  try {
    await fsp.link(source, destination);
  } catch (error) {
    if (
      !["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "ENOSYS"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
    await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    const handle = await fsp.open(destination, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  if ((await hashFile(destination)) !== expectedHash)
    throw Error(
      "La copia publicada no coincide; el archivo de origen se conserva.",
    );
  await fsp.unlink(source);
}
export class DesktopBackups {
  private config: z.infer<typeof configSchema>;
  private active: Promise<unknown> | null = null;
  private controller: AbortController | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private registryInvalid = false;
  private saveTask: Promise<unknown> = Promise.resolve();
  private phase = "";
  private picks = new Map<
    string,
    { file: string; hash?: string; keyId?: string }
  >();
  constructor(
    private userData: string,
    private secrets: Secrets,
    private callbacks: Callbacks,
    private clock = () => new Date(),
  ) {
    this.config = {
      format: "nodus.imago.backups/1",
      preferences: backupPreferencesSchema.parse({}),
      folder: "",
      masterId: "",
      lastSuccess: null,
      lastAttempt: null,
      lastError: null,
      entries: [],
    };
    try {
      const file = path.join(userData, "backups.json");
      if (fs.existsSync(file)) {
        if (fs.statSync(file).size > 64 * 2 ** 20)
          throw Error("Configuración demasiado grande.");
        this.config = configSchema.parse(
          JSON.parse(fs.readFileSync(file, "utf8")),
        );
      }
    } catch {
      this.registryInvalid = true;
      this.config.lastError =
        "Configuración de copias ilegible; las copias automáticas están desactivadas. El archivo original se conserva.";
    }
  }
  private password(id = this.config.masterId) {
    return id ? this.secrets.get(`backup_${id}`) : null;
  }
  async status(): Promise<BackupStatus> {
    return {
      preferences: this.config.preferences,
      folder: this.config.folder,
      passwordStored: !!this.password(),
      secureStorageAvailable: this.secrets.encryption.available(),
      busy: !!this.active,
      phase: this.phase,
      lastSuccess: this.config.lastSuccess,
      lastError: this.config.lastError,
      entries: await Promise.all(
        this.config.entries
          .slice()
          .reverse()
          .map(async (entry) => ({
            ...entry,
            available: await fsp
              .lstat(entry.file)
              .then((s) => s.isFile() && !s.isSymbolicLink())
              .catch(() => false),
          })),
      ),
    };
  }
  private save() {
    const task = this.saveTask.then(() => this.saveImpl());
    this.saveTask = task.catch(() => {});
    return task;
  }
  private async saveImpl() {
    await fsp.mkdir(this.userData, { recursive: true });
    if (this.registryInvalid) {
      await fsp.copyFile(
        path.join(this.userData, "backups.json"),
        path.join(this.userData, "backups.corrupt-" + uuid() + ".json"),
      );
      this.registryInvalid = false;
    }
    const temp = path.join(this.userData, "backups-" + uuid() + ".tmp");
    try {
      const file = await fsp.open(temp, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(this.config));
        await file.sync();
      } finally {
        await file.close();
      }
      await fsp.rename(temp, path.join(this.userData, "backups.json"));
    } finally {
      await fsp.rm(temp, { force: true });
    }
    this.callbacks.changed();
  }
  async configure(preferences: BackupPreferences) {
    if (this.active) throw Error("Espera a que termine la copia.");
    if (preferences.enabled && (!this.config.folder || !this.password()))
      throw Error(
        "Elige una carpeta y guarda la contraseña maestra antes de activar las copias automáticas.",
      );
    this.config.preferences = backupPreferencesSchema.parse(preferences);
    await this.save();
  }
  async folder(folder: string) {
    if (this.active) throw Error("Espera a que termine la copia.");
    const resolved = await fsp.realpath(folder),
      collection = await fsp.realpath(this.userData);
    if (resolved === collection || resolved.startsWith(collection + path.sep))
      throw Error(
        "Guarda las copias fuera de la colección para poder recuperarla.",
      );
    if (!(await fsp.stat(resolved)).isDirectory())
      throw Error("Selecciona una carpeta.");
    this.config.folder = resolved;
    await this.save();
    return resolved;
  }
  async setPassword(password: string) {
    if (this.active) throw Error("Espera a que termine la copia.");
    if (password.trim().length < 8 || password.length > 1024)
      throw Error("La contraseña debe tener entre 8 y 1024 caracteres.");
    const id = uuid();
    this.secrets.set(`backup_${id}`, password.trim());
    this.config.masterId = id;
    await this.save();
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 60000);
    this.timer.unref?.();
    void this.tick();
  }
  async tick() {
    if (this.closed || this.active || !this.config.preferences.enabled) return;
    const now = this.clock();
    if (
      this.config.lastAttempt &&
      now.getTime() >= Date.parse(this.config.lastAttempt) &&
      now.getTime() - Date.parse(this.config.lastAttempt) < 5 * 60000
    )
      return;
    if (backupDue(this.config.preferences, this.config.lastSuccess, now))
      await this.create(undefined, "automatic").catch(() => {});
  }
  private async operation<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) throw Error("El gestor de copias se está cerrando.");
    if (this.active) throw Error("Ya hay una operación de copias en curso.");
    this.controller = new AbortController();
    const task = Promise.resolve().then(work);
    this.active = task;
    this.callbacks.changed();
    try {
      return await task;
    } finally {
      this.active = null;
      this.controller = null;
      this.phase = "";
      this.callbacks.changed();
    }
  }
  private async ensureFolder() {
    if (!this.config.folder) throw Error("Selecciona una carpeta de copias.");
    if (!(await fsp.stat(this.config.folder)).isDirectory())
      throw Error("La carpeta de copias no está disponible.");
    return this.config.folder;
  }
  async create(
    destination?: string,
    reason: BackupEntry["reason"] = "manual",
    passwordOverride?: string,
  ) {
    return this.operation(() =>
      this.createImpl(destination, reason, passwordOverride),
    );
  }
  private async createImpl(
    destination?: string,
    reason: BackupEntry["reason"] = "manual",
    passwordOverride?: string,
  ) {
    if (this.config.entries.length >= 10000)
      throw Error(
        "El historial ha alcanzado su capacidad de 10.000 copias. Todos los archivos y registros anteriores se conservan.",
      );
    const at = this.clock().toISOString();
    this.config.lastAttempt = at;
    await this.save();
    let workspace: string | undefined, temp: string | undefined;
    try {
      const password = passwordOverride || this.password();
      if (reason !== "manual" && !password)
        throw Error("Falta la contraseña maestra en el almacén seguro.");
      const folder = destination
        ? path.dirname(destination)
        : await this.ensureFolder();
      if (destination && fs.existsSync(destination))
        throw Error(
          "El destino ya existe. Elige otro nombre para conservar la copia anterior.",
        );
      const resolved = await fsp.realpath(folder),
        profile = await fsp.realpath(this.userData);
      if (resolved === profile || resolved.startsWith(profile + path.sep))
        throw Error("Guarda las copias fuera del perfil de Imago.");
      workspace = await fsp.mkdtemp(path.join(this.userData, ".imago-backup-"));
      await fsp.chmod(workspace, 0o700);
      const client = await this.callbacks.client();
      const credentials: Record<string, string> = {};
      if (password)
        for (const p of Object.keys(PROVIDERS) as ApiProvider[]) {
          const key = this.secrets.get(p);
          if (key) credentials[p] = key;
        }
      const application = JSON.stringify(
        applicationSchema.parse({
          version: 1,
          client,
          preferences: this.config.preferences,
          updates: this.callbacks.updates?.(),
          ...(password
            ? { credentials: await sealMetadata(credentials, password) }
            : {}),
        }),
      );
      const plain = path.join(workspace, "payload.imago");
      this.phase = "Guardando datos y originales";
      this.callbacks.changed();
      await this.callbacks.write(plain, application);
      this.controller!.signal.throwIfAborted();
      this.phase = "Verificando la copia";
      this.callbacks.changed();
      await this.callbacks.verify(plain);
      this.controller!.signal.throwIfAborted();
      const id = uuid(),
        file =
          destination ??
          path.join(
            folder,
            `nodus-imago-${at.replace(/[:.]/g, "-")}-${id}.imago`,
          );
      temp = file + ".partial-" + id;
      if (password) {
        await ensureDiskSpace(folder, (await fsp.stat(plain)).size + 128);
        this.phase = "Cifrando y comprobando integridad";
        this.callbacks.changed();
        await encryptBackup(plain, temp, password, this.controller!.signal);
        if (
          (await decryptBackup(
            temp,
            null,
            password,
            this.controller!.signal,
          )) !== (await hashFile(plain))
        )
          throw Error(
            "La copia cifrada no coincide con los datos verificados.",
          );
      } else await fsp.rename(plain, temp);
      this.controller!.signal.throwIfAborted();
      const sha256 = await hashFile(temp),
        bytes = (await fsp.stat(temp)).size;
      const handle = await fsp.open(temp, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (fs.existsSync(file))
        throw Error(
          "El destino ya existe; no se ha sustituido ningún archivo.",
        );
      await publishBackupFile(temp, file, sha256);
      temp = undefined;
      const entry: BackupEntry = {
        id,
        file,
        createdAt: at,
        bytes,
        sha256,
        encrypted: !!password,
        keyId: password && !passwordOverride ? this.config.masterId : "",
        archived: false,
        verifiedAt: this.clock().toISOString(),
        reason,
      };
      this.config.entries.push(entry);
      this.config.lastSuccess = at;
      this.config.lastError = null;
      await this.save();
      if (reason === "automatic" && this.config.preferences.retentionEnabled)
        await this.retention().catch((e) => {
          this.config.lastError =
            "Copia verificada; no se archivaron las antiguas: " + e.message;
        });
      await this.save();
      return entry;
    } catch (error) {
      this.config.lastError =
        error instanceof Error ? error.message : String(error);
      await this.save().catch(() => {});
      throw error;
    } finally {
      if (temp) await fsp.rm(temp, { force: true });
      if (workspace) await fsp.rm(workspace, { recursive: true, force: true });
    }
  }
  private entry(id: string) {
    const entry = this.config.entries.find((e) => e.id === id);
    if (!entry) throw Error("Copia no registrada.");
    return entry;
  }
  private async inspectFile(file: string, password?: string) {
    const encrypted = await encryptedBackup(file);
    if (!encrypted) return this.callbacks.verify(file);
    if (!password)
      throw Error("Introduce la contraseña original de esta copia.");
    const folder = path.join(this.userData, "backup-staging");
    await fsp.mkdir(folder, { recursive: true, mode: 0o700 });
    const temp = path.join(folder, uuid() + ".imago");
    try {
      await ensureDiskSpace(folder, (await fsp.stat(file)).size);
      await decryptBackup(file, temp, password, this.controller?.signal);
      return await this.callbacks.verify(temp);
    } finally {
      await fsp.rm(temp, { force: true });
    }
  }
  async verify(id: string, password?: string) {
    return this.operation(async () => {
      const entry = this.entry(id);
      if ((await hashFile(entry.file)) !== entry.sha256)
        throw Error("La copia ha cambiado o está dañada.");
      const result = await this.inspectFile(
        entry.file,
        password ?? this.password(entry.keyId) ?? undefined,
      );
      entry.verifiedAt = this.clock().toISOString();
      await this.save();
      return {
        databases: result.databases,
        rows: result.rows,
        files: result.files,
        legacy: result.legacy,
      };
    });
  }
  private async archiveEntry(entry: BackupEntry, archived: boolean) {
    if ((await hashFile(entry.file)) !== entry.sha256)
      throw Error("No se moverá una copia modificada o dañada.");
    const parent = archived
      ? path.dirname(entry.file)
      : path.dirname(path.dirname(entry.file));
    const targetFolder = archived
      ? path.join(parent, "Archivadas-Imago")
      : parent;
    await fsp.mkdir(targetFolder, { recursive: true });
    const target = path.join(targetFolder, path.basename(entry.file));
    if (fs.existsSync(target))
      throw Error("Ya existe un archivo con ese nombre.");
    await publishBackupFile(entry.file, target, entry.sha256);
    entry.file = target;
    entry.archived = archived;
    await this.save();
  }
  async archive(id: string, archived: boolean) {
    return this.operation(async () => {
      const entry = this.entry(id);
      if (entry.archived === archived) return;
      await this.archiveEntry(entry, archived);
    });
  }
  private async retention() {
    const entries = this.config.entries
      .filter(
        (e) =>
          e.reason === "automatic" &&
          !e.archived &&
          path.dirname(e.file) === this.config.folder,
      )
      .reverse();
    if (entries.length <= this.config.preferences.keepLast) return;
    for (const entry of entries.slice(0, 3)) {
      if ((await hashFile(entry.file)) !== entry.sha256)
        throw Error("Una de las tres copias recientes está dañada.");
      await this.inspectFile(
        entry.file,
        this.password(entry.keyId) ?? undefined,
      );
    }
    for (const entry of entries.slice(this.config.preferences.keepLast))
      await this.archiveEntry(entry, true);
  }
  async pick(file: string) {
    const token = uuid();
    if (this.picks.size > 20) this.picks.clear();
    const keyId = this.config.entries.find(
      (entry) => path.resolve(entry.file) === path.resolve(file),
    )?.keyId;
    this.picks.set(token, { file, keyId });
    return {
      token,
      encrypted: await encryptedBackup(file),
      passwordStored: !!(keyId && this.password(keyId)),
    };
  }
  async inspect(token: string, password?: string) {
    return this.operation(async () => {
      const pick = this.picks.get(token);
      if (!pick) throw Error("Selecciona de nuevo la copia.");
      pick.hash = undefined;
      const before = await hashFile(pick.file);
      const result = await this.inspectFile(
        pick.file,
        password ??
          (pick.keyId ? (this.password(pick.keyId) ?? undefined) : undefined),
      );
      if ((await hashFile(pick.file)) !== before)
        throw Error("La copia cambió durante la comprobación.");
      pick.hash = before;
      return {
        databases: result.databases,
        rows: result.rows,
        files: result.files,
        createdAt: result.createdAt,
        legacy: result.legacy,
      };
    });
  }
  async restore(
    token: string,
    password: string | undefined,
    replace: boolean,
    restoreCredentials: boolean,
  ) {
    // Safety copy is a separate operation; it must succeed before any replacement.
    const pick = this.picks.get(token);
    if (!pick?.hash) throw Error("Comprueba la copia antes de restaurarla.");
    password ??= pick.keyId
      ? (this.password(pick.keyId) ?? undefined)
      : undefined;
    return this.operation(async () => {
      await this.callbacks.lockRestore();
      try {
        if (replace)
          await this.createImpl(
            undefined,
            "before-restore",
            this.password() ? undefined : password,
          );
        if ((await hashFile(pick.file)) !== pick.hash)
          throw Error(
            "La copia cambió después de comprobarla. Selecciónala de nuevo.",
          );
        const staging = path.join(this.userData, "backup-staging");
        await fsp.mkdir(staging, { recursive: true, mode: 0o700 });
        let plain = pick.file,
          temp: string | undefined;
        try {
          if (await encryptedBackup(pick.file)) {
            if (!password)
              throw Error("Introduce la contraseña original de la copia.");
            temp = path.join(staging, uuid() + ".imago");
            await ensureDiskSpace(staging, (await fsp.stat(pick.file)).size);
            await decryptBackup(
              pick.file,
              temp,
              password,
              this.controller!.signal,
            );
            plain = temp;
          }
          const verified = await this.callbacks.verify(plain),
            application = verified.application
              ? applicationSchema.parse(JSON.parse(verified.application))
              : null;
          const credentials =
            application?.credentials && password
              ? await openMetadata(application.credentials, password)
              : {};
          const parsed = z
            .partialRecord(
              z.enum(Object.keys(PROVIDERS) as [ApiProvider, ...ApiProvider[]]),
              z.string().max(10000),
            )
            .parse(credentials);
          if (
            restoreCredentials &&
            Object.keys(parsed).length &&
            !this.secrets.encryption.available()
          )
            throw Error(
              "El almacén seguro no está disponible. Puedes restaurar sin las claves de API.",
            );
          this.controller!.signal.throwIfAborted();
          const databases = await this.callbacks.restore(plain, replace);
          const warnings: string[] = [];
          let credentialsRestored = 0,
            credentialsPreserved = 0;
          if (restoreCredentials)
            for (const [provider, key] of Object.entries(parsed)) {
              if (this.secrets.get(provider as ApiProvider)) {
                credentialsPreserved++;
                continue;
              }
              try {
                this.secrets.set(provider as ApiProvider, key!);
                credentialsRestored++;
              } catch {
                warnings.push(
                  "No se pudo guardar la clave de " +
                    provider +
                    "; los datos sí se restauraron.",
                );
              }
            }
          if (application) {
            this.config.preferences = {
              ...application.preferences,
              enabled: false,
            };
            if (application.updates && this.callbacks.applyUpdates) {
              try {
                await this.callbacks.applyUpdates({
                  ...application.updates,
                  automaticChecks: false,
                  beta: false,
                });
              } catch {
                warnings.push(
                  "No se pudieron restaurar los ajustes de actualización.",
                );
              }
            }
            try {
              await this.callbacks.applyClient(application.client);
            } catch {
              warnings.push(
                "No se pudo restaurar la distribución de las vistas.",
              );
            }
          }
          this.config.lastError = warnings.join(" ") || null;
          await this.save().catch(() =>
            warnings.push(
              "Datos restaurados; no se pudo guardar la configuración de copias.",
            ),
          );
          this.picks.delete(token);
          return {
            databases,
            credentialsRestored,
            credentialsPreserved,
            warnings,
          };
        } finally {
          if (temp) await fsp.rm(temp, { force: true });
        }
      } finally {
        await this.callbacks.unlockRestore();
      }
    });
  }
  file(id: string) {
    return this.entry(id).file;
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.controller?.abort();
    await this.callbacks.cancel().catch(() => {});
    await this.active?.catch(() => {});
    await this.saveTask.catch(() => {});
  }
}

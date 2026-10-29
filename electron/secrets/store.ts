import fs from "node:fs";
import path from "node:path";
import type { ApiProvider } from "../../shared/aiConfig";
// Adapted from Nodus secretStore: one encrypted file per provider, shared across
// collections, atomic writes and no plaintext fallback. Imago never reads Nodus keys.
export interface SecretEncryption {
  available: () => boolean;
  encrypt: (key: string) => Buffer;
  decrypt: (data: Buffer) => string;
}
export class Secrets {
  constructor(
    public directory: string,
    public encryption: SecretEncryption,
  ) {}
  private file(provider: ApiProvider) {
    return path.join(this.directory, `ai_key_${provider}.bin`);
  }
  get(provider: ApiProvider) {
    if (!this.encryption.available()) return null;
    try {
      return this.encryption.decrypt(fs.readFileSync(this.file(provider)));
    } catch {
      return null;
    }
  }
  set(provider: ApiProvider, key: string) {
    if (!key.trim()) {
      this.clear(provider);
      return;
    }
    if (!this.encryption.available())
      throw new Error(
        "El almacén seguro del sistema no está disponible; la clave no se ha guardado.",
      );
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const destination = this.file(provider),
      temporary = destination + ".tmp";
    try {
      const encrypted = this.encryption.encrypt(key.trim());
      if (this.encryption.decrypt(encrypted) !== key.trim())
        throw new Error(
          "No se ha podido verificar la clave cifrada. La clave anterior se conserva.",
        );
      fs.writeFileSync(temporary, encrypted, {
        mode: 0o600,
      });
      fs.renameSync(temporary, destination);
      if (this.get(provider) !== key.trim())
        throw new Error("No se ha podido verificar la clave cifrada.");
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  clear(provider: ApiProvider) {
    fs.rmSync(this.file(provider), { force: true });
  }
}

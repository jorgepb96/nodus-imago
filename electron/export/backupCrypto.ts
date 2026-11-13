// Same cipher/KDF parameters as Nodus electron/export/backupCrypto.ts.
// Imago has its own bounded envelope; it does not claim .nodus compatibility.
import fs from "node:fs";
import fsp from "node:fs/promises";
import {
  randomBytes,
  scrypt,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
const MAGIC = Buffer.from("IMAGOENC1\n"),
  HEADER = MAGIC.length + 16 + 12,
  TAG = 16;
async function key(password: string, salt: Buffer) {
  if (password.trim().length < 8 || password.length > 1024)
    throw Error("La contraseña debe tener entre 8 y 1024 caracteres.");
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.trim(),
      salt,
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 2 ** 20 },
      (e, k) => (e ? reject(e) : resolve(k)),
    ),
  );
}
export async function encryptedBackup(file: string) {
  const h = await fsp.open(file, "r");
  try {
    const b = Buffer.alloc(MAGIC.length);
    await h.read(b, 0, b.length, 0);
    return b.equals(MAGIC);
  } finally {
    await h.close();
  }
}
export async function encryptBackup(
  source: string,
  destination: string,
  password: string,
  signal?: AbortSignal,
) {
  const salt = randomBytes(16),
    iv = randomBytes(12),
    secret = await key(password, salt),
    cipher = createCipheriv("aes-256-gcm", secret, iv),
    output = fs.createWriteStream(destination, { flags: "wx", mode: 0o600 });
  let created = false;
  output.once("open", () => {
    created = true;
  });
  try {
    output.write(Buffer.concat([MAGIC, salt, iv]));
    await pipeline(fs.createReadStream(source), cipher, output, { signal });
    await fsp.appendFile(destination, cipher.getAuthTag());
  } catch (e) {
    if (created) await fsp.rm(destination, { force: true });
    throw e;
  } finally {
    secret.fill(0);
  }
}
export async function decryptBackup(
  source: string,
  destination: string | null,
  password: string,
  signal?: AbortSignal,
) {
  const h = await fsp.open(source, "r");
  let secret: Buffer | undefined,
    created = false;
  try {
    const stat = await h.stat();
    if (stat.size < HEADER + TAG) throw Error("Copia cifrada incompleta.");
    const header = Buffer.alloc(HEADER),
      tag = Buffer.alloc(TAG);
    await h.read(header, 0, HEADER, 0);
    await h.read(tag, 0, TAG, stat.size - TAG);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC))
      throw Error("Formato cifrado no reconocido.");
    secret = await key(
      password,
      header.subarray(MAGIC.length, MAGIC.length + 16),
    );
    const decipher = createDecipheriv(
      "aes-256-gcm",
      secret,
      header.subarray(MAGIC.length + 16),
    );
    decipher.setAuthTag(tag);
    const hash = createHash("sha256");
    const output = destination
      ? fs.createWriteStream(destination, { flags: "wx", mode: 0o600 })
      : new Writable({
          write(chunk, _enc, cb) {
            hash.update(chunk);
            cb();
          },
        });
    if (destination)
      output.once("open", () => {
        created = true;
      });
    await pipeline(
      h.createReadStream({
        start: HEADER,
        end: stat.size - TAG - 1,
        autoClose: false,
      }),
      decipher,
      output,
      { signal },
    );
    return destination ? null : hash.digest("hex");
  } catch (e) {
    if (destination && created) await fsp.rm(destination, { force: true });
    if (signal?.aborted) throw e;
    throw Error("Contraseña incorrecta o copia cifrada dañada.");
  } finally {
    secret?.fill(0);
    await h.close();
  }
}
export async function sealMetadata(value: unknown, password: string) {
  const salt = randomBytes(16),
    iv = randomBytes(12),
    secret = await key(password, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", secret, iv),
      body = Buffer.concat([
        cipher.update(JSON.stringify(value)),
        cipher.final(),
      ]);
    return Buffer.concat([salt, iv, cipher.getAuthTag(), body]).toString(
      "base64",
    );
  } finally {
    secret.fill(0);
  }
}
export async function openMetadata(value: string, password: string) {
  const b = Buffer.from(value, "base64");
  if (b.length < 44 || b.length > 1024 * 1024)
    throw Error("Credenciales de copia inválidas.");
  const secret = await key(password, b.subarray(0, 16));
  try {
    const d = createDecipheriv("aes-256-gcm", secret, b.subarray(16, 28));
    d.setAuthTag(b.subarray(28, 44));
    return JSON.parse(
      Buffer.concat([d.update(b.subarray(44)), d.final()]).toString(),
    );
  } finally {
    secret.fill(0);
  }
}

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { ensureDiskSpace } from "../storage/disk";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import type { Entry, ZipFile } from "yauzl";

// Same safety boundaries as Nodus notionZipImport; never extract entry paths.
export class Archive {
  constructor(
    public zip: ZipFile,
    public entries: Map<string, Entry>,
  ) {}
  static async open(file: string, maxBytes = 32 * 2 ** 30) {
    const zip = await new Promise<ZipFile>((resolve, reject) =>
      yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) =>
        error ? reject(error) : resolve(zip!),
      ),
    );
    try {
      const entries = new Map<string, Entry>();
      let bytes = 0;
      await new Promise<void>((resolve, reject) => {
        zip.on("error", reject);
        zip.on("end", resolve);
        zip.on("entry", (entry: Entry) => {
          const name = entry.fileName.replace(/\\/g, "/");
          bytes += entry.uncompressedSize;
          if (
            entries.size >= 100000 ||
            !Number.isSafeInteger(bytes) || bytes > maxBytes ||
            name.startsWith("/") ||
            /^[a-z]:/i.test(name) ||
            name.split("/").includes("..") ||
            name.includes("\0") ||
            entries.has(name) ||
            ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
          ) {
            reject(new Error("ZIP inseguro o demasiado grande."));
            return;
          }
          entries.set(name, entry);
          zip.readEntry();
        });
        zip.readEntry();
      });
      return new Archive(zip, entries);
    } catch (error) {
      zip.close();
      throw error;
    }
  }
  stream(name: string) {
    const entry = this.entries.get(name);
    if (!entry || name.endsWith("/"))
      throw new Error("Archivo ausente del ZIP: " + name);
    return new Promise<NodeJS.ReadableStream>((resolve, reject) =>
      this.zip.openReadStream(entry, (error, stream) =>
        error ? reject(error) : resolve(stream!),
      ),
    );
  }
  async preflight(destination: string, multiplier = 1) {
    const bytes = [...this.entries.values()].reduce(
      (sum, entry) => sum + entry.uncompressedSize,
      0,
    );
    await ensureDiskSpace(destination, Math.ceil(bytes * multiplier));
  }
  async read(name: string, max = 32 * 2 ** 20) {
    const entry = this.entries.get(name);
    if (!entry || entry.uncompressedSize > max)
      throw new Error("Entrada ausente o demasiado grande: " + name);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of (await this.stream(name)) as any) {
      bytes += chunk.length;
      if (bytes > max) throw new Error("Entrada demasiado grande.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async extract(name: string, destination: string) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error("Archivo ausente del ZIP: " + name);
    await ensureDiskSpace(path.dirname(destination), entry.uncompressedSize);
    let bytes = 0,
      created = false;
    const input = await this.stream(name);
    const output = fs.createWriteStream(destination, { flags: "wx" });
    output.once("open", () => {
      created = true;
    });
    try {
      await pipeline(
        input as any,
        new Transform({
          transform(chunk, _encoding, callback) {
            bytes += chunk.length;
            callback(
              bytes > entry.uncompressedSize
                ? new Error("La entrada ZIP excede su cuota declarada.")
                : null,
              chunk,
            );
          },
        }),
        output,
      );
      if (bytes !== entry.uncompressedSize)
        throw new Error("Entrada ZIP incompleta.");
    } catch (error) {
      output.destroy();
      if (created) await fsp.rm(destination, { force: true });
      throw error;
    }
  }
  close() {
    this.zip.close();
  }
}

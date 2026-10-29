import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import type { Entry, ZipFile } from "yauzl";

// Same safety boundaries as Nodus notionZipImport; never extract entry paths.
export class Archive {
  constructor(
    public zip: ZipFile,
    public entries: Map<string, Entry>,
  ) {}
  static async open(file: string) {
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
            bytes > 32 * 2 ** 30 ||
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
    await pipeline(
      (await this.stream(name)) as any,
      fs.createWriteStream(destination, { flags: "wx" }),
    );
  }
  close() {
    this.zip.close();
  }
}

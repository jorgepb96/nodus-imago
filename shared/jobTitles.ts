// The name a task shows in the queue. An indexing pass can hold the text of
// records, images or both, and says which.
import type { Job } from "./imago";

const TITLES: Record<string, string> = {
  images: "Importar imágenes",
  analyze: "Analizar",
  download: "Descargar",
  prepare: "Preparar modelos",
  fingerprints: "Calcular huellas visuales",
};

export function jobTitle(job: Pick<Job, "kind" | "indexRows" | "indexAssets">): string {
  if (job.kind !== "index") return TITLES[job.kind] ?? job.kind;
  const rows = job.indexRows ?? 0,
    assets = job.indexAssets ?? 0;
  if (rows && assets) return "Indexar fichas e imágenes";
  if (rows) return "Indexar fichas";
  return "Indexar imágenes";
}

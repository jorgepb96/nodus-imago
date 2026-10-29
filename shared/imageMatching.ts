// Builds on Nodus's catalogue-code matcher. Unlike its first-row policy,
// duplicate identifiers always remain ambiguous in Imago.
import {
  extractCode,
  fileMatchKey,
  normalizeKey,
  codeTemplateToRegex,
} from "./databaseBulk";
import type { BulkRowRef } from "./databaseBulk";
export function matchImages(
  files: { token: string; name: string }[],
  rows: BulkRowRef[],
  pattern?: string,
  partial = false,
) {
  if (pattern && (pattern.length > 120 || /[()|]|\\[1-9]/.test(pattern)))
    throw new Error(
      "Usa un patrón lineal sin grupos ni alternativas (por ejemplo /[A-Z]+[0-9]+/ o @@###).",
    );
  const re = pattern ? codeTemplateToRegex(pattern) : undefined;
  if (pattern && !re) throw new Error("Patrón no válido.");
  const keys = new Map<string, Set<string>>(),
    codes = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, id: string) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
  };
  for (const row of rows) {
    const value = row.refValue ?? "";
    add(keys, normalizeKey(value), row.rowId);
    const code = extractCode(value, re ?? undefined);
    if (code) add(codes, code, row.rowId);
  }
  return files.map((file) => {
    const full = normalizeKey(file.name),
      stem = fileMatchKey(file.name);
    let candidates = [
        ...new Set([...(keys.get(full) ?? []), ...(keys.get(stem) ?? [])]),
      ],
      strategy = "exact";
    if (!candidates.length) {
      const code = extractCode(stem, re ?? undefined);
      candidates = code ? [...(codes.get(code) ?? [])] : [];
      strategy = "code";
    }
    if (
      !candidates.length &&
      partial &&
      files.length * rows.length <= 1_000_000
    ) {
      candidates = rows
        .filter((r) => {
          const v = normalizeKey(r.refValue ?? "");
          return (
            v.length >= 4 &&
            (stem.includes(v) || (v.includes(stem) && stem.length >= 4))
          );
        })
        .map((r) => r.rowId);
      strategy = "partial";
    }
    const status =
      candidates.length === 1 && strategy !== "partial"
        ? ("safe" as const)
        : candidates.length
          ? ("ambiguous" as const)
          : ("unmatched" as const);
    return {
      pathToken: file.token,
      fileName: file.name,
      rowId: status === "safe" ? candidates[0] : null,
      candidates,
      status,
      strategy,
    };
  });
}

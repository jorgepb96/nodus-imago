export function normalizeVector(
  vector: number[],
  dimensions = vector.length,
): number[] {
  if (
    !Number.isInteger(dimensions) ||
    dimensions < 64 ||
    dimensions > 4096 ||
    vector.length < dimensions ||
    !vector.every(Number.isFinite)
  )
    throw new Error("Vector incompatible.");
  const reduced = vector.slice(0, dimensions),
    norm = Math.hypot(...reduced);
  if (norm < 1e-12 || !Number.isFinite(norm)) throw new Error("Vector vacío.");
  return reduced.map((v) => v / norm);
}
export function fuseRanks(
  literal: string[],
  semantic: string[],
  weight = 0.5,
  k = 60,
) {
  const scores = new Map<string, number>();
  for (const [list, w] of [
    [literal, 1 - weight],
    [semantic, weight],
  ] as const)
    list.forEach((id, i) =>
      scores.set(id, (scores.get(id) ?? 0) + w / (k + i + 1)),
    );
  return [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Weighted reciprocal rank fusion of any number of ranked id lists.
 *
 * With `presence: "mean"`, an id is scored over the lists it appears in rather
 * than summed across all of them. Use it when a list omits an id because the
 * id has no vector in that lane (a record without an image, or an image not
 * indexed yet), not because it ranked badly: absence then is not evidence of
 * irrelevance, and a record found only by its text is not outranked by worse
 * records that merely exist in both lanes.
 */
export function fuseRankLists(
  lists: { ids: string[]; weight: number }[],
  k = 60,
  presence: "sum" | "mean" = "sum",
) {
  const scores = new Map<string, number>(),
    weights = new Map<string, number>();
  for (const { ids, weight } of lists)
    ids.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + i + 1));
      weights.set(id, (weights.get(id) ?? 0) + weight);
    });
  const fused = [...scores].map(([id, score]) =>
    presence === "mean"
      ? ([id, score / (weights.get(id) || 1)] as [string, number])
      : ([id, score] as [string, number]),
  );
  return fused.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

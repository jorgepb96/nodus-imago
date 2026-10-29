export function normalizeVector(
  vector: number[],
  dimensions = vector.length,
): number[] {
  if (
    ![256, 512, 768].includes(dimensions) ||
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

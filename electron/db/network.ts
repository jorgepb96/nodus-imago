// Co-occurrence network over the records a view selects: a node per value of
// the chosen properties, an edge between values of different properties that
// share records, weighted by how many. The most frequent values are kept.
import type { Repository } from "./repository";
import { exportCellText } from "../../shared/databaseExport";
import { categoryValues, yearOf } from "../../shared/statistics";
import type { Network, NetworkEdge, NetworkNode } from "../../shared/network";

export function buildNetwork(
  repo: Repository,
  databaseId: string,
  ids: string[],
  input: { columnIds: string[]; minWeight?: number; maxNodes?: number; yearColumnId?: string | null; from?: number | null; to?: number | null },
): Network {
  const columns = repo.detail(databaseId).columns;
  const chosen = input.columnIds.map((id) => {
    const c = columns.find((x) => x.id === id);
    if (!c) throw new Error("La propiedad no pertenece a esta base de datos.");
    return c;
  });
  const yearColumn = input.yearColumnId ? columns.find((c) => c.id === input.yearColumnId) : undefined;
  const counts = new Map<string, NetworkNode>();
  const perRecord: string[][] = [];
  let records = 0;
  for (let i = 0; i < ids.length; i += 500)
    for (const row of repo.hydrate(ids.slice(i, i + 500))) {
      if (yearColumn && (input.from != null || input.to != null)) {
        const year = yearOf(yearColumn, row.cells[yearColumn.id] ?? null, exportCellText(yearColumn, row));
        if (year == null || (input.from != null && year < input.from) || (input.to != null && year > input.to)) continue;
      }
      records++;
      const keys: string[] = [];
      for (const column of chosen) {
        for (const label of new Set(categoryValues(column, row.cells[column.id] ?? null, exportCellText(column, row)))) {
          const id = `${column.id}:${label.toLocaleLowerCase()}`;
          const node = counts.get(id) ?? {
            id,
            columnId: column.id,
            property: column.name,
            label,
            optionId: column.options.find((o) => o.label === label)?.id ?? null,
            count: 0,
          };
          node.count++;
          counts.set(id, node);
          keys.push(id);
        }
      }
      perRecord.push(keys);
    }
  // The most frequent values of each property, in proportion.
  const maxNodes = input.maxNodes ?? 60;
  const kept = new Set<string>();
  for (const column of chosen)
    [...counts.values()]
      .filter((n) => n.columnId === column.id)
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.ceil(maxNodes / chosen.length))
      .forEach((n) => kept.add(n.id));
  const weights = new Map<string, number>();
  for (const keys of perRecord) {
    const present = keys.filter((k) => kept.has(k));
    for (let a = 0; a < present.length; a++)
      for (let b = a + 1; b < present.length; b++) {
        const [x, y] = [present[a], present[b]].sort();
        if (counts.get(x)!.columnId === counts.get(y)!.columnId) continue;
        weights.set(`${x}\u0000${y}`, (weights.get(`${x}\u0000${y}`) ?? 0) + 1);
      }
  }
  const edges: NetworkEdge[] = [...weights]
    .filter(([, w]) => w >= (input.minWeight ?? 2))
    .map(([key, weight]) => {
      const [source, target] = key.split("\u0000");
      return { source, target, weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 400);
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
  const nodes = [...counts.values()].filter((n) => kept.has(n.id) && linked.has(n.id));
  return { nodes, edges, records, hidden: counts.size - nodes.length };
}

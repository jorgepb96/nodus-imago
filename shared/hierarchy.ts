export interface HierarchySourceRow {
  id: string;
  title: string;
  cells: Record<string, string | null>;
}

export interface HierarchyNode<T extends HierarchySourceRow = HierarchySourceRow> {
  row: T;
  children: HierarchyNode<T>[];
}

/** Decode the JSON array stored in a local db_row relation cell. */
export function relationTargets(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/** Build parent → children nodes from a self-relation. Rows whose parent is
 * missing or part of a cycle stay at the root, so every row remains reachable. */
export function buildHierarchy<T extends HierarchySourceRow>(
  rows: T[],
  parentColumnId: string,
): HierarchyNode<T>[] {
  const byId = new Map(rows.map((row) => [row.id, row])),
    children = new Map<string, T[]>(),
    parentOf = new Map<string, string>(),
    roots: T[] = [];
  for (const row of rows) {
    const parent = relationTargets(row.cells[parentColumnId]).find(
      (id) => id !== row.id && byId.has(id),
    );
    if (parent) {
      parentOf.set(row.id, parent);
      const list = children.get(parent) ?? [];
      list.push(row);
      children.set(parent, list);
    } else roots.push(row);
  }
  // A cycle without a root must not disappear from the tree. Start a new root
  // from the first unvisited member and let the visited guard cut the loop.
  const visited = new Set<string>();
  const make = (row: T): HierarchyNode<T> => {
    visited.add(row.id);
    return {
      row,
      children: (children.get(row.id) ?? [])
        .filter((child) => !visited.has(child.id))
        .map(make),
    };
  };
  const result = roots.map(make);
  for (const row of rows) {
    if (!visited.has(row.id) && !parentOf.get(row.id)) result.push(make(row));
  }
  for (const row of rows) if (!visited.has(row.id)) result.push(make(row));
  return result;
}

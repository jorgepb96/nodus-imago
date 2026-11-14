// A network of property values: which photographers, places, subjects…
// appear together in the same records. See electron/db/network.ts.
export type NetworkNode = { id: string; columnId: string; property: string; label: string; optionId: string | null; count: number };
export type NetworkEdge = { source: string; target: string; weight: number };
export type Network = { nodes: NetworkNode[]; edges: NetworkEdge[]; records: number; hidden: number };

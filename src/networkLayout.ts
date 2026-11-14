// Positions of the network of relations: a force layout in a fixed frame,
// pure and deterministic so that it can be tested.
import type { Network, NetworkNode } from "../shared/network";

export const NETWORK_WIDTH = 1000,
  NETWORK_HEIGHT = 640;
const W = NETWORK_WIDTH,
  H = NETWORK_HEIGHT;
export type Placed = NetworkNode & { x: number; y: number; r: number };

/**
 * Force layout (Fruchterman–Reingold): every pair repels, shared records pull,
 * a weak pull keeps the centre, and circles never overlap. Deterministic.
 */
export function layout(
  network: Network,
  propertyOrder: string[],
  tuning: { spread?: number; gravityX?: number; gravityY?: number } = {},
): Placed[] {
  const { spread = 0.75, gravityX = 0.05, gravityY = 0.08 } = tuning;
  const count = Math.max(1, network.nodes.length);
  const nodes: Placed[] = network.nodes.map((n, i) => {
    // Start each property in its own sector of a circle.
    const sector = propertyOrder.indexOf(n.columnId),
      angle = ((sector + (i % 11) / 11) / Math.max(1, propertyOrder.length)) * Math.PI * 2,
      ring = 160 + (i % 5) * 30;
    return { ...n, x: W / 2 + Math.cos(angle) * ring, y: H / 2 + Math.sin(angle) * ring * 0.8, r: Math.min(22, 5 + Math.sqrt(n.count) * 1.1) };
  });
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const max = Math.max(1, ...network.edges.map((e) => e.weight));
  // Ideal distance between two points for the space available.
  const k = Math.sqrt((W * H) / count) * spread;
  const steps = 360;
  for (let step = 0; step < steps; step++) {
    const temperature = 40 * (1 - step / steps) + 1;
    const fx = new Float64Array(nodes.length),
      fy = new Float64Array(nodes.length);
    for (let a = 0; a < nodes.length; a++)
      for (let b = a + 1; b < nodes.length; b++) {
        const dx = nodes[a].x - nodes[b].x,
          dy = nodes[a].y - nodes[b].y,
          d = Math.max(1, Math.hypot(dx, dy)),
          f = (k * k) / d;
        fx[a] += (dx / d) * f;
        fy[a] += (dy / d) * f;
        fx[b] -= (dx / d) * f;
        fy[b] -= (dy / d) * f;
      }
    for (const e of network.edges) {
      const a = index.get(e.source)!,
        b = index.get(e.target)!;
      const dx = nodes[b].x - nodes[a].x,
        dy = nodes[b].y - nodes[a].y,
        d = Math.max(1, Math.hypot(dx, dy)),
        f = ((d * d) / k) * (0.3 + (0.7 * e.weight) / max);
      fx[a] += (dx / d) * f;
      fy[a] += (dy / d) * f;
      fx[b] -= (dx / d) * f;
      fy[b] -= (dy / d) * f;
    }
    nodes.forEach((n, i) => {
      fx[i] += (W / 2 - n.x) * gravityX * (k / 10);
      fy[i] += (H / 2 - n.y) * gravityY * (k / 10);
      const length = Math.max(1e-6, Math.hypot(fx[i], fy[i])),
        move = Math.min(length, temperature);
      n.x += (fx[i] / length) * move;
      n.y += (fy[i] / length) * move;
    });
    separate(nodes);
    keepInside(nodes);
  }
  // Fill the frame: the simulation finds the shape, the frame sets the size.
  if (nodes.length > 1) {
    const left = Math.min(...nodes.map((n) => n.x - n.r)),
      right = Math.max(...nodes.map((n) => n.x + n.r)),
      top = Math.min(...nodes.map((n) => n.y - n.r)),
      bottom = Math.max(...nodes.map((n) => n.y + n.r + 14));
    // Wider at the sides: labels are centred under their circles.
    const marginX = 80,
      marginY = 24,
      sx = Math.min(2.5, (W - 2 * marginX) / Math.max(1, right - left)),
      sy = Math.min(2.5, (H - 2 * marginY) / Math.max(1, bottom - top));
    const cx = (left + right) / 2,
      cy = (top + bottom) / 2;
    for (const n of nodes) {
      n.x = W / 2 + (n.x - cx) * sx;
      n.y = H / 2 + (n.y - cy) * sy;
    }
    for (let pass = 0; pass < 30; pass++) {
      separate(nodes);
      keepInside(nodes);
    }
  }
  return nodes;
}

/** Pushes apart circles that overlap, leaving room for their labels. */
function separate(nodes: Placed[]) {
  for (let pass = 0; pass < 2; pass++)
    for (let a = 0; a < nodes.length; a++)
      for (let b = a + 1; b < nodes.length; b++) {
        const dx = nodes[b].x - nodes[a].x,
          dy = nodes[b].y - nodes[a].y,
          d = Math.max(0.01, Math.hypot(dx, dy)),
          gap = nodes[a].r + nodes[b].r + 10;
        if (d >= gap) continue;
        const push = (gap - d) / 2;
        nodes[a].x -= (dx / d) * push;
        nodes[a].y -= (dy / d) * push;
        nodes[b].x += (dx / d) * push;
        nodes[b].y += (dy / d) * push;
      }
}

function keepInside(nodes: Placed[]) {
  for (const n of nodes) {
    n.x = Math.min(W - n.r - 4, Math.max(n.r + 4, n.x));
    n.y = Math.min(H - n.r - 16, Math.max(n.r + 4, n.y));
  }
}

/**
 * Tiny TSP solver for reordering POI waypoints into a shorter tour.
 *
 * GraphHopper (open-source) routes *through* points in the given order but
 * does NOT reorder them. For scenario B ("visit these 3 estates") we want the
 * efficient visiting order. We approximate with great-circle (haversine)
 * distances — fast and good enough for 2–5 nearby POIs where straight-line
 * order ≈ road order — then GraphHopper computes the real road geometry.
 *
 * Algorithm: nearest-neighbour construction (start fixed) + 2-opt improvement.
 */

export interface LonLat {
  lon: number;
  lat: number;
}

/** Great-circle distance in meters. */
export function haversine(a: LonLat, b: LonLat): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Reorder `waypoints` for the shortest tour starting from `start`.
 * Returns the reordered waypoints AND the visiting order (0-based indices into
 * the original waypoints) so the UI can number the stops 1..n.
 *
 * @param loop if true, the tour is closed (returns to start) — influences cost.
 */
export function optimizeOrder(
  start: LonLat,
  waypoints: LonLat[],
  loop = false,
): { order: LonLat[]; indices: number[] } {
  if (waypoints.length <= 1) {
    return {
      order: [...waypoints],
      indices: waypoints.map((_, i) => i),
    };
  }

  // Build the full node list: node 0 = start, 1..n = waypoints.
  const nodes: LonLat[] = [start, ...waypoints];
  const n = nodes.length;

  // Distance matrix.
  const d: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = haversine(nodes[i], nodes[j]);
      d[i][j] = dist;
      d[j][i] = dist;
    }
  }

  // Nearest-neighbour from node 0 (start fixed), visiting all waypoint nodes.
  const visited = new Array(n).fill(false);
  visited[0] = true;
  const seq = [0];
  let current = 0;
  for (let step = 1; step < n; step++) {
    let best = -1;
    let bestDist = Infinity;
    for (let j = 1; j < n; j++) {
      if (!visited[j] && d[current][j] < bestDist) {
        bestDist = d[current][j];
        best = j;
      }
    }
    visited[best] = true;
    seq.push(best);
    current = best;
  }

  // 2-opt over the waypoint segment (keep start fixed at position 0).
  // For a closed tour we also consider the return-to-start edge.
  const improved = twoOpt(seq, d, loop);
  // Broken Or-opt/relocate is deliberately absent from the production path.
  // 2-opt only commits strictly improving moves.
  const wpSeq = improved.slice(1);
  return {
    order: wpSeq.map((nodeIdx) => nodes[nodeIdx]),
    indices: wpSeq.map((nodeIdx) => nodeIdx - 1), // back to 0-based waypoint index
  };
}

/** 2-opt improvement on a node-index sequence. Node 0 (start) stays first. */
function twoOpt(seq: number[], d: number[][], closed: boolean): number[] {
  const path = [...seq];
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 100) {
    improved = false;
    // indices 1..len-1 are reversible among themselves (start fixed at 0)
    const len = path.length;
    for (let i = 1; i < len - 1; i++) {
      for (let k = i + 1; k < len; k++) {
        const before = edgeCost(path, d, closed, i, k);
        // reverse segment [i, k]
        const reversed = [...path];
        let a = i;
        let b = k;
        while (a < b) {
          [reversed[a], reversed[b]] = [reversed[b], reversed[a]];
          a++;
          b--;
        }
        const after = edgeCost(reversed, d, closed, i, k);
        if (after + 1e-6 < before) {
          path.splice(0, path.length, ...reversed);
          improved = true;
        }
      }
    }
  }
  return path;
}

/** Total tour cost, only affected edges around the reversed window. */
function edgeCost(
  path: number[],
  d: number[][],
  closed: boolean,
  i: number,
  k: number,
): number {
  const len = path.length;
  const prev = path[i - 1];
  const first = path[i];
  const last = path[k];
  let cost = d[prev][first] + d[last][next(path, k, closed, len)];
  return cost;
}

function next(
  path: number[],
  k: number,
  closed: boolean,
  len: number,
): number {
  if (k + 1 < len) return path[k + 1];
  // window ends at the last node — next is back to start only if closed tour
  return closed ? path[0] : path[k];
}

/** Full open/closed tour cost for regression checks. */
export function tourCost(start: LonLat, waypoints: LonLat[], indices: number[], loop = false): number {
  if (!indices.length) return 0;
  let total = 0;
  let previous = start;
  for (const index of indices) {
    total += haversine(previous, waypoints[index]);
    previous = waypoints[index];
  }
  return total + (loop ? haversine(previous, start) : 0);
}

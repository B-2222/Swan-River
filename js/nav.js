// Coarse navigation grid over the real river for boat AI (police, ferries), with A* and path smoothing.
import { W, sdfAt, navigable } from './world.js';

const C = 30; // metres per nav cell
let NX = 0, NZ = 0, X0 = 0, Z0 = 0, cost = null;

export function buildNav() {
  X0 = W.X0; Z0 = W.Z0;
  NX = Math.floor(W.NX * W.CELL / C); NZ = Math.floor(W.NZ * W.CELL / C);
  cost = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = X0 + (i + 0.5) * C, z = Z0 + (j + 0.5) * C, s = sdfAt(x, z);
    cost[j * NX + i] = navigable(x, z, -6) ? 1 + 2.5 * Math.exp(s / 15) : 0; // 0 = blocked; prefer mid-channel
  }
}

const cellOf = (x, z) => [Math.floor((x - X0) / C), Math.floor((z - Z0) / C)];
const inside = (i, j) => i >= 0 && j >= 0 && i < NX && j < NZ;

function nearestOpen(i, j) {
  if (inside(i, j) && cost[j * NX + i] > 0) return [i, j];
  for (let r = 1; r < 12; r++) for (let a = -r; a <= r; a++) for (const [di, dj] of [[a, -r], [a, r], [-r, a], [r, a]]) {
    const ii = i + di, jj = j + dj;
    if (inside(ii, jj) && cost[jj * NX + ii] > 0) return [ii, jj];
  }
  return null;
}

export function navClear(x0, z0, x1, z1, margin = -5) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 15);
  for (let k = 1; k <= n; k++) { const t = k / n; if (sdfAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) > margin) return false; }
  return true;
}

// A* from (x0,z0) to (x1,z1); returns [[x,z],...] or null. maxNodes bounds the cost per call.
export function findPath(x0, z0, x1, z1, maxNodes = 120000) {
  if (!cost) return null;
  let s = cellOf(x0, z0), g = cellOf(x1, z1);
  // allow targets out in the ocean beyond the grid
  g = [Math.max(0, Math.min(NX - 1, g[0])), Math.max(0, Math.min(NZ - 1, g[1]))];
  s = nearestOpen(s[0], s[1]); g = nearestOpen(g[0], g[1]);
  if (!s || !g) return null;
  const N = NX * NZ;
  const gScore = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = []; // [f, idx]
  const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const si = s[1] * NX + s[0], gi = g[1] * NX + g[0];
  const h = (i) => { const x = i % NX, z = (i / NX) | 0; const dx = Math.abs(x - g[0]), dz = Math.abs(z - g[1]); return (dx + dz + (1.414 - 2) * Math.min(dx, dz)); };
  gScore[si] = 0; push(h(si), si);
  let expanded = 0;
  const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  while (heap.length) {
    const [, cur] = pop();
    if (closed[cur]) continue;
    if (cur === gi) break;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const cx = cur % NX, cz = (cur / NX) | 0;
    for (const [dx, dz, w] of nb) {
      const nx = cx + dx, nz = cz + dz;
      if (!inside(nx, nz)) continue;
      const ni = nz * NX + nx;
      const c = cost[ni];
      if (c <= 0 || closed[ni]) continue;
      if (dx && dz && (cost[cz * NX + nx] <= 0 || cost[nz * NX + cx] <= 0)) continue; // no corner cutting
      const ng = gScore[cur] + w * c;
      if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = cur; push(ng + h(ni), ni); }
    }
  }
  if (came[gi] < 0 && gi !== si) return null;
  const cells = [];
  for (let k = gi; k >= 0; k = came[k]) { cells.push(k); if (k === si) break; }
  cells.reverse();
  const pts = cells.map(k => [X0 + ((k % NX) + 0.5) * C, Z0 + (((k / NX) | 0) + 0.5) * C]);
  pts.push([x1, z1]);
  // string pulling
  const out = [[x0, z0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !navClear(out[out.length - 1][0], out[out.length - 1][1], pts[b][0], pts[b][1], -8)) b--;
    out.push(pts[b]); a = b;
  }
  return out;
}

// pick a random open water point within r metres of (x,z)
export function randomWater(x, z, r, minDepth = -20, tries = 40) {
  for (let k = 0; k < tries; k++) {
    const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * r;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (navigable(px, pz, minDepth)) return [px, pz];
  }
  return null;
}

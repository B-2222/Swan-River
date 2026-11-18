// Loads the map data built from OpenStreetMap (see tools/build.py) and answers spatial queries.
// World units are metres. x = east, z = south (so north is -z). Origin is lon 115.80, lat -32.00.
import * as THREE from '../vendor/three.module.min.js';

export const W = {
  json: null, NX: 0, NZ: 0, X0: 0, Z0: 0, CELL: 15,
  H: null,      // terrain/seabed height per cell (m)
  SDF: null,    // signed distance to shore per cell (m, + is land), clamped to +-64
  COVER: null,  // land cover class per cell
  OCEAN: null,  // 0..1 ocean factor (swell strength)
  landTex: null, minimapImg: null, islands: [],
};

export const COVER = { URBAN: 0, WATER: 1, SAND: 2, PARK: 3, BUSH: 4, INDUS: 5, ROAD: 6, GOLF: 7, COMM: 8, WET: 9, PARKING: 10, PITCH: 11, ROCK: 12, OCEAN: 13, BLD: 14, LAKE: 15 };

async function loadPixels(url) {
  const blob = await (await fetch(url)).blob();
  let bmp;
  try { bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
  catch (e) { bmp = await createImageBitmap(blob); }
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
}

function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
}

export async function loadWorld(progress) {
  const base = './data/';
  let done = 0; const total = 5;
  const tick = (label) => { done++; progress && progress(done / total, label); };
  const [json, terr, cov, landImg, mini] = await Promise.all([
    fetch(base + 'world.json').then(r => r.json()).then(v => { tick('Bridges, jetties and buildings'); return v; }),
    loadPixels(base + 'terrain.png').then(v => { tick('River bed and shoreline'); return v; }),
    loadPixels(base + 'cover.png').then(v => { tick('Parks, beaches and bush'); return v; }),
    loadImage(base + 'landcover.jpg').then(v => { tick('Suburbs and streets'); return v; }),
    loadImage(base + 'minimap.jpg').then(v => { tick('Map'); return v; }),
  ]);
  W.json = json;
  const g = json.grid;
  W.NX = g.nx; W.NZ = g.nz; W.X0 = g.x0; W.Z0 = g.z0; W.CELL = g.cell;
  const n = W.NX * W.NZ;
  W.H = new Float32Array(n); W.SDF = new Float32Array(n); W.COVER = new Uint8Array(n);
  const td = terr.data, cd = cov.data;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    W.H[i] = ((td[o] << 8) | td[o + 1]) / 10 - 50;
    W.SDF[i] = (td[o + 2] - 128) / 2;
    W.COVER[i] = cd[o];
  }
  // ocean factor: blurred ocean mask so the swell fades in through the harbour entrance
  const oc = new Float32Array(n);
  for (let i = 0; i < n; i++) oc[i] = W.COVER[i] === COVER.OCEAN ? 1 : 0;
  W.OCEAN = boxBlur(boxBlur(oc, W.NX, W.NZ, 8), W.NX, W.NZ, 8);
  const tex = new THREE.Texture(landImg);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  W.landTex = tex;
  W.minimapImg = mini;
  W.islands = (json.islands || []).map(isl => ({ name: isl.name, pts: isl.pts, bbox: bboxOf(isl.pts) }));
  return W;
}

function bboxOf(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
  return [a, b, c, d];
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * k;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * k;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// ---------------------------------------------------------------- queries
const OCEAN_X = -5600; // beyond the grid, everything west of this is ocean

function islandSdf(x, z) {
  for (const isl of W.islands) {
    const b = isl.bbox;
    if (x < b[0] - 80 || x > b[2] + 80 || z < b[1] - 80 || z > b[3] + 80) continue;
    let inside = false, dmin = Infinity;
    const p = isl.pts;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
      const dx = xj - xi, dz = zj - zi;
      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz || 1)));
      const ex = xi + t * dx - x, ez = zi + t * dz - z;
      dmin = Math.min(dmin, ex * ex + ez * ez);
    }
    const d = Math.sqrt(dmin);
    return Math.max(-64, Math.min(64, inside ? d : -d));
  }
  return -64;
}

function inGrid(x, z) {
  return x >= W.X0 && z >= W.Z0 && x < W.X0 + W.NX * W.CELL && z < W.Z0 + W.NZ * W.CELL;
}

function bilerp(arr, x, z) {
  let fx = (x - W.X0) / W.CELL - 0.5, fz = (z - W.Z0) / W.CELL - 0.5;
  fx = Math.max(0, Math.min(W.NX - 1.001, fx)); fz = Math.max(0, Math.min(W.NZ - 1.001, fz));
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz;
  const i = iz * W.NX + ix;
  const a = arr[i], b = arr[i + 1], c = arr[i + W.NX], d = arr[i + W.NX + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

export function heightAt(x, z) {
  if (!inGrid(x, z)) {
    if (x < OCEAN_X) { const s = islandSdf(x, z); return s > 0 ? Math.min(2 + s * 0.15, 30) : -18; }
    return 8;
  }
  return bilerp(W.H, x, z);
}

// navigable water (river or ocean, not a suburban lake)
export function navigable(x, z, depth = -4) {
  return sdfAt(x, z) < depth && coverAt(x, z) !== COVER.LAKE;
}

export function sdfAt(x, z) {
  if (!inGrid(x, z)) return x < OCEAN_X ? islandSdf(x, z) : 64;
  return bilerp(W.SDF, x, z);
}

export function oceanAt(x, z) {
  if (!inGrid(x, z)) return x < OCEAN_X ? 1 : 0;
  return bilerp(W.OCEAN, x, z);
}

export function coverAt(x, z) {
  if (!inGrid(x, z)) return x < OCEAN_X ? COVER.OCEAN : COVER.URBAN;
  const ix = Math.max(0, Math.min(W.NX - 1, ((x - W.X0) / W.CELL) | 0));
  const iz = Math.max(0, Math.min(W.NZ - 1, ((z - W.Z0) / W.CELL) | 0));
  return W.COVER[iz * W.NX + ix];
}

// gradient of the signed distance: points from water towards land
export function sdfGrad(x, z, out) {
  const e = 4;
  const gx = (sdfAt(x + e, z) - sdfAt(x - e, z)) / (2 * e);
  const gz = (sdfAt(x, z + e) - sdfAt(x, z - e)) / (2 * e);
  const l = Math.hypot(gx, gz) || 1;
  out.x = gx / l; out.z = gz / l;
  return out;
}

const LON0 = 115.80, LAT0 = -32.00, KX = 94492.0, KZ = 110887.0;
export function toXZ(lon, lat) { return [(lon - LON0) * KX, (LAT0 - lat) * KZ]; }
export function toLonLat(x, z) { return [x / KX + LON0, LAT0 - z / KZ]; }

// line of sight across water (land in between blocks it)
export function waterLOS(x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.ceil(d / 20);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (sdfAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) > 6 && heightAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) > 4) return false;
  }
  return true;
}

// Static world built from the OSM data: buildings with textured facades, bridges, jetties, moorings, landmarks,
// the Water Police base at Point Direction, trees, and collision data.
import * as THREE from '../vendor/three.module.min.js';
import { W, heightAt, sdfAt, coverAt, COVER, toXZ, sdfGrad } from './world.js';
import { merge, M, boatModel, treeGeos, col, policeBoat, policeChequer, rbox } from './models.js';

// ------------------------------------------------------------------ collision registry
export const Obs = {
  cell: 64, grid: new Map(), decks: new Map(),
  key(ix, iz) { return ix * 100003 + iz; },
  addSeg(ax, az, bx, bz, r, top, kind = 'wall') {
    const s = { ax, az, bx, bz, r, top, kind };
    const x0 = Math.floor((Math.min(ax, bx) - r) / this.cell), x1 = Math.floor((Math.max(ax, bx) + r) / this.cell);
    const z0 = Math.floor((Math.min(az, bz) - r) / this.cell), z1 = Math.floor((Math.max(az, bz) + r) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = this.key(i, j); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(s); }
  },
  addCircle(x, z, r, top, kind = 'boat') { this.addSeg(x, z, x, z, r, top, kind); },
  addDeck(ax, az, bx, bz, hw, ya, yb, name) {
    const s = { ax, az, bx, bz, hw, ya, yb, name };
    const x0 = Math.floor((Math.min(ax, bx) - hw) / this.cell), x1 = Math.floor((Math.max(ax, bx) + hw) / this.cell);
    const z0 = Math.floor((Math.min(az, bz) - hw) / this.cell), z1 = Math.floor((Math.max(az, bz) + hw) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = this.key(i, j); if (!this.decks.has(k)) this.decks.set(k, []); this.decks.get(k).push(s); }
  },
  resolve(p, r, y) {
    const list = this.grid.get(this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell)));
    if (!list) return null;
    let res = null;
    for (const s of list) {
      if (y > s.top + 0.2) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.z - s.az) * dz) / L2)) : 0;
      let ex = p.x - (s.ax + dx * t), ez = p.z - (s.az + dz * t);
      const d = Math.hypot(ex, ez), min = s.r + r;
      if (d < min) {
        if (d < 1e-4) { ex = 1; ez = 0; } else { ex /= d; ez /= d; }
        const depth = min - d;
        p.x += ex * depth; p.z += ez * depth;
        if (!res || depth > res.depth) res = { nx: ex, nz: ez, depth, kind: s.kind };
      }
    }
    return res;
  },
  deckAt(x, z) {
    const list = this.decks.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return null;
    for (const s of list) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (L2 || 1)));
      if (Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) < s.hw) return { y: s.ya + (s.yb - s.ya) * t, name: s.name };
    }
    return null;
  },
};

function b64(s) { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
const stdVC = (o = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, ...o });
const shadowy = (m, cast = true, recv = true) => { m.castShadow = cast; m.receiveShadow = recv; return m; };

// ------------------------------------------------------------------ facade textures
function rngf(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function facade(kind) {
  const S = { tower: [16, 8, 1.5, 3.8, 512, 512], office: [12, 8, 2.0, 3.6, 512, 512], apt: [8, 8, 3.0, 3.2, 512, 512], house: [6, 2, 4.0, 3.0, 512, 128], shed: [8, 2, 3.0, 5.0, 512, 128] }[kind];
  const [cols, rows, cw, ch, W_, H_] = S;
  const c = document.createElement('canvas'); c.width = W_; c.height = H_;
  const e = document.createElement('canvas'); e.width = W_; e.height = H_;
  const x = c.getContext('2d'), y = e.getContext('2d');
  const R = rngf(kind.length * 977 + 13);
  y.fillStyle = '#000'; y.fillRect(0, 0, W_, H_);
  const px = W_ / cols, py = H_ / rows;
  // base wall with grain (white: tinted by vertex colour)
  x.fillStyle = kind === 'tower' ? '#a9b7c2' : '#e9e6df'; x.fillRect(0, 0, W_, H_);
  for (let i = 0; i < 2500; i++) { const g = 200 + R() * 55; x.fillStyle = `rgba(${g},${g},${g},0.08)`; x.fillRect(R() * W_, R() * H_, 2 + R() * 4, 2 + R() * 4); }
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const X = k * px, Y = H_ - (r + 1) * py; // row 0 at the bottom of the texture (v = 0 at ground)
    const lit = R() < (kind === 'house' ? 0.5 : 0.38);
    const warm = R() < 0.75 ? '#ffd28a' : '#e8f0ff';
    const glass = (gx, gy, gw, gh) => {
      const gr = x.createLinearGradient(gx, gy, gx, gy + gh);
      gr.addColorStop(0, '#5e7586'); gr.addColorStop(1, '#25333e');
      x.fillStyle = gr; x.fillRect(gx, gy, gw, gh);
      if (lit) { y.fillStyle = warm; y.fillRect(gx + 1, gy + 1, gw - 2, gh - 2); }
    };
    if (kind === 'tower') {
      glass(X + 1, Y + py * 0.18, px - 2, py * 0.8);
      x.fillStyle = '#7d8c97'; x.fillRect(X, Y + py * 0.04, px, py * 0.14);
      x.fillStyle = '#c9d2d8'; x.fillRect(X, Y, 1.5, py);
    } else if (kind === 'office') {
      glass(X, Y + py * 0.3, px, py * 0.5);
      x.fillStyle = '#d8d6d0'; x.fillRect(X, Y + py * 0.3, 2, py * 0.5);
    } else if (kind === 'apt') {
      glass(X + px * 0.15, Y + py * 0.22, px * 0.55, py * 0.6);
      x.fillStyle = '#9a9a96'; x.fillRect(X, Y + py * 0.86, px, py * 0.06);     // balcony slab
      x.fillStyle = 'rgba(40,40,40,0.55)'; x.fillRect(X, Y + py * 0.62, px, 2); // railing
    } else if (kind === 'house') {
      if (k % 2 === 0) { glass(X + px * 0.25, Y + py * 0.3, px * 0.5, py * 0.42); x.strokeStyle = '#f8f8f8'; x.lineWidth = 3; x.strokeRect(X + px * 0.25, Y + py * 0.3, px * 0.5, py * 0.42); }
      else if (k === 3) { x.fillStyle = '#6b4a35'; x.fillRect(X + px * 0.38, Y + py * 0.25, px * 0.24, py * 0.75); }
    } else if (kind === 'shed') {
      for (let s = 0; s < px; s += 6) { x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(X + s, Y, 2, py); }
      if (k === 2) { x.fillStyle = '#7d8790'; x.fillRect(X + px * 0.1, Y + py * 0.3, px * 0.8, py * 0.7); }
    }
  }
  const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  return { map: mk(c, true), emissive: mk(e, true), sizeU: cols * cw, sizeV: rows * ch };
}
function roofTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'); const R = rngf(kind === 'tile' ? 5 : 9);
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256);
  if (kind === 'tile') { for (let r = 0; r < 256; r += 16) { x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, r, 256, 3); for (let k = (r / 16 % 2) * 8; k < 256; k += 16) { x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(k, r, 2, 16); } } }
  else { for (let i = 0; i < 4000; i++) { const g = 150 + R() * 100; x.fillStyle = `rgba(${g},${g},${g},0.25)`; x.fillRect(R() * 256, R() * 256, 2, 2); } x.fillStyle = 'rgba(0,0,0,0.15)'; for (let i = 0; i < 6; i++) x.fillRect(R() * 220, R() * 220, 18 + R() * 20, 12 + R() * 14); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ buildings
const WALLS = [0xe9dfc7, 0xf4f2ec, 0xd8c39a, 0xc58a6a, 0xcfccc6, 0xd6cbb5, 0xe6dab8].map(col);
const HOUSE_ROOFS = [0xa3523a, 0x4a4d52, 0x6d7a86, 0xcdbb93, 0x8d4433, 0x3b3d41, 0x9a5f46].map(col);
const GLASS = [0x9fb6c9, 0x86a1b8, 0xb3c4d0, 0x8fa5b3, 0xa7bfcf, 0x7d98ad, 0xbccad5].map(col);
let BMATS = null;
function buildingMaterials() {
  if (BMATS) return BMATS;
  BMATS = {};
  for (const k of ['tower', 'office', 'apt', 'house', 'shed']) {
    const f = facade(k);
    BMATS[k] = new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true,
      roughness: k === 'tower' ? 0.12 : 0.85, metalness: k === 'tower' ? 0.55 : 0.0 });
    BMATS[k].userData.size = [f.sizeU, f.sizeV];
  }
  BMATS.tile = new THREE.MeshStandardMaterial({ map: roofTexture('tile'), vertexColors: true, roughness: 0.75 });
  BMATS.flat = new THREE.MeshStandardMaterial({ map: roofTexture('flat'), vertexColors: true, roughness: 0.9 });
  return BMATS;
}

function buildBuildings(scene, skip) {
  const B = W.json.buildings;
  const counts = b64(B.counts), heights = new Uint16Array(b64(B.heights).buffer), styles = b64(B.styles);
  const coords = new Int16Array(b64(B.coords).buffer);
  const mats = buildingMaterials();
  const buckets = new Map();
  const bucket = (key, m) => { const k = key + '|' + m; if (!buckets.has(k)) buckets.set(k, { m, pos: [], nor: [], uv: [], colr: [] }); return buckets.get(k); };
  let off = 0;
  for (let b = 0; b < B.n; b++) {
    const n = counts[b];
    const pts = [];
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { const x = coords[(off + i) * 2] / 2, z = coords[(off + i) * 2 + 1] / 2; pts.push([x, z]); cx += x; cz += z; }
    off += n;
    cx /= n; cz /= n;
    if (skip.some(s => Math.hypot(s[0] - cx, s[1] - cz) < s[2])) continue;
    const h = heights[b] / 10, style = styles[b] >> 4, ci = styles[b] & 15;
    const key = Math.floor(cx / 1000) + ',' + Math.floor(cz / 1000);
    addBuilding(bucket, key, pts, h, style, ci, mats);
  }
  const meshes = [];
  for (const bk of buckets.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bk.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(bk.colr, 3));
    g.computeBoundingSphere();
    const m = shadowy(new THREE.Mesh(g, mats[bk.m]));
    m.matrixAutoUpdate = false;
    scene.add(m); meshes.push(m);
  }
  return meshes;
}

function addBuilding(bucket, key, pts, h, style, ci, mats) {
  const n = pts.length;
  let base = Infinity, gmax = -Infinity;
  for (const p of pts) { const g = heightAt(p[0], p[1]); base = Math.min(base, g); gmax = Math.max(gmax, g); }
  base = Math.max(base, 0.2) - 0.4;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const ccw = area > 0; area = Math.abs(area) / 2;
  const isHouse = style === 1, isTower = style === 2, isRoof = style === 3;
  let kind = isTower ? 'tower' : isHouse ? 'house' : h >= 25 ? (ci % 3 ? 'office' : 'apt') : h >= 8 ? (ci % 2 ? 'apt' : 'office') : area > 600 ? 'shed' : 'house';
  const wallTop = Math.max(gmax, 0.2) + (isHouse ? Math.max(2.8, h - 2.3) : h);
  const wallC = isTower ? GLASS[ci % 7] : WALLS[ci % 7];
  const bottom = isRoof ? wallTop - 0.5 : base;
  const [su, sv] = mats[kind].userData.size;
  const bw = bucket(key, kind);
  let along = (ci * 7.3) % su;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const nx = (ccw ? dz : -dz) / l, nz = (ccw ? -dx : dx) / l;
    const u0 = along / su, u1 = (along + l) / su; along += l;
    const v0 = 0, v1 = (wallTop - bottom) / sv;
    const A0 = [a[0], bottom, a[1], u0, v0], B0 = [b[0], bottom, b[1], u1, v0], A1 = [a[0], wallTop, a[1], u0, v1], B1 = [b[0], wallTop, b[1], u1, v1];
    const tri = ccw ? [A0, A1, B0, B0, A1, B1] : [A0, B0, A1, B0, B1, A1];
    for (const v of tri) { bw.pos.push(v[0], v[1], v[2]); bw.nor.push(nx, 0, nz); bw.uv.push(v[3], v[4]); bw.colr.push(wallC.r, wallC.g, wallC.b); }
  }
  if (isHouse) {
    const br = bucket(key, 'tile');
    let mx = 0, mz = 0; for (const p of pts) { mx += p[0]; mz += p[1]; } mx /= n; mz /= n;
    const rh = 2.0, rc = HOUSE_ROOFS[ci % 7];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      // small eave overhang
      const ea = [a[0] + (a[0] - mx) * 0.08, a[1] + (a[1] - mz) * 0.08], eb = [b[0] + (b[0] - mx) * 0.08, b[1] + (b[1] - mz) * 0.08];
      const v1 = new THREE.Vector3(ea[0], wallTop, ea[1]), v2 = new THREE.Vector3(eb[0], wallTop, eb[1]), v3 = new THREE.Vector3(mx, wallTop + rh, mz);
      const nrm = new THREE.Vector3().subVectors(v2, v1).cross(new THREE.Vector3().subVectors(v3, v1)).normalize();
      const tri = nrm.y >= 0 ? [v1, v2, v3] : [v1, v3, v2];
      if (nrm.y < 0) nrm.negate();
      const el = Math.hypot(eb[0] - ea[0], eb[1] - ea[1]);
      const uvs = nrm.y >= 0 ? [[0, 0], [el / 6, 0], [el / 12, 0.6]] : [[0, 0], [el / 12, 0.6], [el / 6, 0]];
      tri.forEach((v, k) => { br.pos.push(v.x, v.y, v.z); br.nor.push(nrm.x, nrm.y, nrm.z); br.uv.push(uvs[k][0], uvs[k][1]); br.colr.push(rc.r, rc.g, rc.b); });
    }
  } else {
    const br = bucket(key, 'flat');
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []); } catch (e) { tris = []; }
    const rc = isTower ? col(0x55595e) : col(0xa6a8aa).multiplyScalar(0.85 + (ci % 3) * 0.07);
    for (const t of tris) {
      const a = pts[t[0]], b = pts[t[1]], d = pts[t[2]];
      const cr = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
      for (const v of (cr < 0 ? [a, b, d] : [a, d, b])) { br.pos.push(v[0], wallTop, v[1]); br.nor.push(0, 1, 0); br.uv.push(v[0] / 20, v[1] / 20); br.colr.push(rc.r, rc.g, rc.b); }
    }
  }
}

// ------------------------------------------------------------------ bridges
function buildBridges(scene) {
  const parts = [], lamps = [], arches = [];
  for (const br of W.json.bridges) {
    const P = br.pts, w = br.w, n = P.length;
    const foot = /footway|cycleway|path|pedestrian/.test(br.kind);
    const th = br.rail ? 1.6 : foot ? 0.7 : 1.4;
    const topC = br.rail ? col(0x5b534c) : foot ? col(br.name.includes('Matagarup') || br.name.includes('Elizabeth') ? 0xd9d6cf : 0x8f7f6a) : col(0x3e3f42);
    const sideC = col(0xbab6ad);
    const pos = [], colors = [];
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const sx = -tz, sz = tx;
      L.push([P[i][0] + sx * w / 2, P[i][2], P[i][1] + sz * w / 2]);
      R.push([P[i][0] - sx * w / 2, P[i][2], P[i][1] - sz * w / 2]);
    }
    const quad = (a, b, c, d, cc) => { for (const v of [a, b, c, b, d, c]) { pos.push(v[0], v[1], v[2]); colors.push(cc.r, cc.g, cc.b); } };
    const dn = (v, d) => [v[0], v[1] - d, v[2]], up = (v, d) => [v[0], v[1] + d, v[2]];
    const railH = foot ? 1.1 : 0.95;
    for (let i = 0; i < n - 1; i++) {
      quad(L[i], L[i + 1], R[i], R[i + 1], topC);
      quad(dn(R[i], th), dn(R[i + 1], th), dn(L[i], th), dn(L[i + 1], th), sideC.clone().multiplyScalar(0.55));
      quad(dn(L[i], th), dn(L[i + 1], th), L[i], L[i + 1], sideC);
      quad(R[i], R[i + 1], dn(R[i], th), dn(R[i + 1], th), sideC);
      quad(L[i], L[i + 1], up(L[i], railH), up(L[i + 1], railH), sideC);
      quad(up(R[i], railH), up(R[i + 1], railH), R[i], R[i + 1], sideC);
      // lane markings on road decks
      if (!foot && !br.rail && i % 2 === 0) {
        const mx = (P[i][0] + P[i + 1][0]) / 2, mz = (P[i][1] + P[i + 1][1]) / 2, my = (P[i][2] + P[i + 1][2]) / 2 + 0.02;
        const tx = P[i + 1][0] - P[i][0], tz = P[i + 1][1] - P[i][1], l = Math.hypot(tx, tz) || 1;
        parts.push({ geo: new THREE.BoxGeometry(Math.min(3, l * 0.5), 0.02, 0.15), color: 0xeeeeee, m: M(mx, my, mz, 0, -Math.atan2(tz, tx), 0) });
      }
      Obs.addDeck(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], w / 2 + 0.5, P[i][2], P[i + 1][2], br.name);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    parts.push({ geo: g });
    for (const p of br.piers) {
      const hgt = p[3] - th + 8, across = w * 0.92;
      parts.push({ geo: new THREE.BoxGeometry(1.8, hgt, across), color: 0xaba79e, m: M(p[0], p[3] - th - hgt / 2, p[1], 0, -p[2], 0) });
      const ax = Math.cos(p[2]), az = Math.sin(p[2]), sx = -az, sz = ax;
      Obs.addSeg(p[0] + sx * across / 2, p[1] + sz * across / 2, p[0] - sx * across / 2, p[1] - sz * across / 2, 1.0, p[3] - th, 'pier');
    }
    if (!foot && !br.rail) {
      let acc = 0;
      for (let i = 0; i < n - 1; i++) { acc += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); if (acc > 34) { acc = 0; lamps.push(L[i], R[i]); } }
    }
    if (br.name === 'Matagarup Bridge' || br.name === 'Elizabeth Quay Bridge') arches.push(br);
  }
  scene.add(shadowy(new THREE.Mesh(merge(parts), stdVC({ side: THREE.DoubleSide, roughness: 0.85 }))));
  const lampMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6).translate(0, 3.5, 0), new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.5, metalness: 0.6 }), lamps.length);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.18, 0.5), headMat, lamps.length);
  lamps.forEach((p, i) => { lampMesh.setMatrixAt(i, M(p[0], p[1], p[2])); heads.setMatrixAt(i, M(p[0], p[1] + 7, p[2])); });
  scene.add(lampMesh); scene.add(heads);
  for (const br of arches) {
    const big = br.name === 'Matagarup Bridge';
    const P = br.pts, n = P.length;
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const off = big ? 4.5 + 2 * Math.sin(t * Math.PI * 2) : 2.2;
        const hgt = big ? 70 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.08) / 0.84))), 1.1) : 20 * Math.sin(Math.PI * t);
        pts.push(new THREE.Vector3(P[i][0] - tz * off * side, P[i][2] + hgt, P[i][1] + tx * off * side));
      }
      scene.add(shadowy(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, big ? 0.9 : 0.35, 10), new THREE.MeshStandardMaterial({ color: big ? 0xe4e7ea : 0xf6f6f6, roughness: 0.35, metalness: 0.3 }))));
      const hang = [];
      for (let i = 2; i < n - 2; i += 2) { const top = pts[i], yb = P[i][2], len = top.y - yb; if (len > 2) hang.push({ geo: new THREE.CylinderGeometry(0.05, 0.05, len, 4), color: 0xcfd2d4, m: M(top.x, yb + len / 2, top.z) }); }
      if (hang.length) scene.add(new THREE.Mesh(merge(hang), stdVC({ metalness: 0.5, roughness: 0.4 })));
    }
  }
  return { headMat };
}

// ------------------------------------------------------------------ jetties, piers, breakwaters
function buildPiers(scene) {
  const parts = [];
  const deckC = col(0x8a6d4f), pileC = col(0x4e3d2e), rockC = col(0x8b8174);
  const DECK = 1.15;
  for (const p of W.json.piers) {
    if (p.line) {
      const pts = p.line, w = p.w, rock = !!p.bw;
      const y = rock ? 2.2 : DECK;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
        if (l < 0.3) continue;
        const ang = Math.atan2(dz, dx), mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        if (rock) parts.push({ geo: new THREE.BoxGeometry(l + w * 0.5, 5.5, w), color: rockC, m: M(mx, y - 2.75, mz, 0, -ang, 0) });
        else {
          parts.push({ geo: new THREE.BoxGeometry(l + 0.2, 0.3, w), color: deckC, m: M(mx, y, mz, 0, -ang, 0) });
          const np = Math.max(1, Math.floor(l / 4));
          for (let k = 0; k <= np; k++) {
            const t = k / np, px = a[0] + dx * t, pz = a[1] + dz * t, sx = -dz / l * w * 0.45, sz = dx / l * w * 0.45;
            for (const s of [1, -1]) parts.push({ geo: new THREE.CylinderGeometry(0.15, 0.15, 5.4, 6), color: pileC, m: M(px + sx * s, y - 2.6, pz + sz * s) });
          }
        }
        Obs.addSeg(a[0], a[1], b[0], b[1], w / 2, y, rock ? 'rock' : 'jetty');
      }
    } else if (p.poly) {
      const pts = p.poly, rock = !!p.bw, y = rock ? 2.2 : DECK;
      let tris = [];
      try { tris = THREE.ShapeUtils.triangulateShape(pts.map(v => new THREE.Vector2(v[0], v[1])), []); } catch (e) { /* skip */ }
      const pos = [], cl = [], cc = rock ? rockC : deckC;
      for (const t of tris) {
        const a = pts[t[0]], b = pts[t[1]], d = pts[t[2]];
        const cr = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
        for (const v of (cr < 0 ? [a, b, d] : [a, d, b])) { pos.push(v[0], y, v[1]); cl.push(cc.r, cc.g, cc.b); }
      }
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], sc = rock ? rockC : pileC;
        for (const v of [[a[0], y, a[1]], [b[0], y, b[1]], [a[0], -3, a[1]], [b[0], y, b[1]], [b[0], -3, b[1]], [a[0], -3, a[1]]]) { pos.push(v[0], v[1], v[2]); cl.push(sc.r, sc.g, sc.b); }
        Obs.addSeg(a[0], a[1], b[0], b[1], 0.6, y, rock ? 'rock' : 'jetty');
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
      g.computeVertexNormals();
      parts.push({ geo: g });
    }
  }
  scene.add(shadowy(new THREE.Mesh(merge(parts), stdVC({ side: THREE.DoubleSide, roughness: 0.9 }))));
}

// flatten a model group into one vertex-coloured geometry (for instancing)
export function groupGeometry(group) {
  group.updateMatrixWorld(true);
  const parts = [];
  group.traverse(o => { if (o.isMesh && o.material && o.material.color) parts.push({ geo: o.geometry, color: o.material.vertexColors ? null : o.material.color.getHex(), m: o.matrixWorld.clone() }); });
  return merge(parts.map(p => p.color === null ? { geo: p.geo, m: p.m } : p));
}

// ------------------------------------------------------------------ moored boats (real marinas + swing moorings)
const BOAT_TYPES = ['yacht', 'cruiser', 'runabout', 'tinny'];
const BOAT_R = [4.2, 5.0, 2.8, 1.9];
function buildMoored(scene) {
  const geos = BOAT_TYPES.map(t => groupGeometry(boatModel(t)));
  const mat = stdVC({ roughness: 0.4 });
  const byChunk = new Map();
  for (const b of W.json.moored) {
    const key = Math.floor(b[0] / 1500) + ',' + Math.floor(b[1] / 1500);
    if (!byChunk.has(key)) byChunk.set(key, []);
    byChunk.get(key).push(b);
    Obs.addCircle(b[0], b[1], BOAT_R[b[3]], 1.6, 'boat');
  }
  const groups = [];
  for (const list of byChunk.values()) {
    const g = new THREE.Group();
    let cx = 0, cz = 0;
    for (let t = 0; t < 4; t++) {
      const sel = list.filter(b => b[3] === t);
      if (!sel.length) continue;
      const im = new THREE.InstancedMesh(geos[t], mat, sel.length);
      sel.forEach((b, i) => im.setMatrixAt(i, M(b[0], -0.05, b[1], 0, b[2], 0)));
      im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true;
      g.add(im);
    }
    for (const b of list) { cx += b[0]; cz += b[1]; }
    g.userData.c = [cx / list.length, cz / list.length];
    scene.add(g); groups.push(g);
  }
  return groups;
}

// ------------------------------------------------------------------ trees
function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = s * 16807 % 2147483647) / 2147483647; }
function buildTreeChunk(geos, mat, cx, cz) {
  const R = rng(cx * 7919 + cz * 104729 + 13);
  const lists = { gum: [], pine: [], palm: [] };
  const S = 1000;
  for (let k = 0; k < 2600; k++) {
    const x = cx * S + R() * S, z = cz * S + R() * S;
    const c = coverAt(x, z);
    let p = 0;
    if (c === COVER.BUSH) p = 0.6; else if (c === COVER.PARK) p = 0.16; else if (c === COVER.URBAN) p = 0.09;
    else if (c === COVER.GOLF) p = 0.12; else if (c === COVER.WET) p = 0.3; else if (c === COVER.COMM) p = 0.03; else if (c === COVER.SAND) p = 0.02;
    if (R() > p) continue;
    const h = heightAt(x, z);
    if (h < 0.8 || sdfAt(x, z) < 4) continue;
    const s = 0.7 + R() * 0.7, ocean = x < -3000;
    let type = 'gum';
    if (ocean && (c === COVER.SAND || c === COVER.PARK) && R() < 0.8) type = 'pine';
    else if (c === COVER.PARK && sdfAt(x, z) < 40 && R() < 0.25) type = 'palm';
    else if (R() < 0.04) type = 'pine';
    lists[type].push(M(x, h - 0.2, z, 0, R() * 6.28, 0, s, s * (0.85 + R() * 0.3), s));
  }
  const g = new THREE.Group();
  for (const t of ['gum', 'pine', 'palm']) {
    const L = lists[t];
    if (!L.length) continue;
    const im = new THREE.InstancedMesh(geos[t], mat, L.length);
    L.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true;
    im.layers.set(1);
    g.add(im);
  }
  return g;
}

// ------------------------------------------------------------------ landmarks
function buildLandmarks(scene) {
  const lm = W.json.landmarks;
  const parts = [];
  const at = (name) => lm[name];
  const ground = (p) => Math.max(heightAt(p[0], p[1]), 0);
  if (at('The Bell Tower')) { const p = at('The Bell Tower'); const g = ground(p);
    parts.push({ geo: new THREE.ConeGeometry(4.5, 30, 6), color: 0x5f9e8a, m: M(p[0], g + 52 + 15, p[1]) });
    parts.push({ geo: new THREE.BoxGeometry(1.2, 34, 9), color: 0x6fae96, m: M(p[0] + 4, g + 40, p[1], 0, 0.3, 0.12) });
    parts.push({ geo: new THREE.BoxGeometry(1.2, 34, 9), color: 0x6fae96, m: M(p[0] - 4, g + 40, p[1], 0, -0.3, -0.12) });
  }
  if (at('State War Memorial')) { const p = at('State War Memorial'); const g = ground(p);
    parts.push({ geo: new THREE.CylinderGeometry(0.6, 1.8, 18, 4), color: 0xe8e1d0, m: M(p[0], g + 9, p[1], 0, Math.PI / 4, 0) });
    parts.push({ geo: new THREE.BoxGeometry(14, 1.2, 14), color: 0xd9d1bf, m: M(p[0], g + 0.6, p[1]) });
  }
  if (at('DNA Tower')) { const p = at('DNA Tower'); const g = ground(p);
    for (let i = 0; i < 22; i++) parts.push({ geo: new THREE.BoxGeometry(2.2, 0.25, 0.6), color: 0xf4f4f4, m: M(p[0], g + 0.7 * i, p[1], 0, i * 0.42, 0) });
    parts.push({ geo: new THREE.CylinderGeometry(0.25, 0.25, 15.5, 6), color: 0xdddddd, m: M(p[0], g + 7.7, p[1]) });
  }
  if (at('Crawley Edge Boatshed')) { const p = at('Crawley Edge Boatshed');
    parts.push({ geo: new THREE.BoxGeometry(5.6, 3.0, 6.2), color: 0x3f9be0, m: M(p[0], 2.7, p[1]) });
    parts.push({ geo: new THREE.BoxGeometry(5.8, 0.3, 6.4), color: 0xf4f4f4, m: M(p[0], 1.2, p[1]) });
    parts.push({ geo: new THREE.CylinderGeometry(0.01, 4.4, 1.8, 4, 1), color: 0xeeeeee, m: M(p[0], 5.1, p[1], 0, Math.PI / 4, 0, 1, 1, 1.05) });
    parts.push({ geo: new THREE.BoxGeometry(1.6, 2.1, 0.1), color: 0xffffff, m: M(p[0], 2.4, p[1] + 3.12) });
    for (const dx of [-2.5, 2.5]) for (const dz of [-2.8, 2.8]) parts.push({ geo: new THREE.BoxGeometry(0.3, 4, 0.3), color: 0x4e3d2e, m: M(p[0] + dx, -0.8, p[1] + dz) });
    Obs.addCircle(p[0], p[1], 4, 5, 'jetty');
  }
  const lighthouse = (x, z, c, h = 12) => {
    const g = Math.max(heightAt(x, z), 2.2);
    parts.push({ geo: new THREE.CylinderGeometry(1.3, 1.8, h, 14), color: c, m: M(x, g + h / 2, z) });
    parts.push({ geo: new THREE.CylinderGeometry(1.0, 1.0, 1.6, 10), color: 0x333333, m: M(x, g + h + 0.8, z) });
    parts.push({ geo: new THREE.ConeGeometry(1.3, 1.2, 10), color: c, m: M(x, g + h + 2.2, z) });
    Obs.addCircle(x, z, 2.2, g + h, 'rock');
  };
  for (const poi of W.json.pois) if (poi.k === 'lighthouse' && /North Mole/.test(poi.n)) lighthouse(poi.x, poi.z, 0xd62828);
  if (at('South Mole Lighthouse')) { const p = at('South Mole Lighthouse'); lighthouse(p[0], p[1], 0x2e9e4f); }
  if (at('Round House')) { const p = at('Round House'); const g = ground(p); parts.push({ geo: new THREE.CylinderGeometry(7, 7, 4.5, 16), color: 0xd7c9a3, m: M(p[0], g + 2.2, p[1]) }); }
  const cranes = W.json.pois.filter(q => q.k === 'crane' && q.z > 4400 && q.z < 5800 && q.x < -4000);
  const tmp = { x: 0, z: 0 };
  for (const q of cranes) {
    const g = Math.max(heightAt(q.x, q.z), 2);
    sdfGrad(q.x, q.z, tmp);
    const T = new THREE.Matrix4().makeTranslation(q.x, g, q.z).multiply(new THREE.Matrix4().makeRotationY(Math.atan2(tmp.x, tmp.z)));
    const C = (geo, c, m) => parts.push({ geo, color: c, m: T.clone().multiply(m) });
    for (const sx of [-8, 8]) for (const sz of [-9, 9]) C(new THREE.BoxGeometry(1.4, 46, 1.4), 0xc23b22, M(sx, 23, sz));
    C(new THREE.BoxGeometry(18, 3, 2), 0xc23b22, M(0, 30, -9)); C(new THREE.BoxGeometry(18, 3, 2), 0xc23b22, M(0, 30, 9));
    C(new THREE.BoxGeometry(4, 3.5, 95), 0xe8e8e8, M(0, 47, -16));
    C(new THREE.BoxGeometry(10, 6, 10), 0xf2f2f2, M(0, 51, 14));
    C(new THREE.BoxGeometry(2, 20, 2), 0xc23b22, M(0, 58, 9));
  }
  const [rx, rz] = toXZ(115.5395, -32.0070);
  parts.push({ geo: new THREE.CylinderGeometry(2.2, 3, 39, 14), color: 0xf2efe6, m: M(rx, 39.5, rz) });
  parts.push({ geo: new THREE.CylinderGeometry(2.0, 2.0, 3, 10), color: 0x333333, m: M(rx, 60.5, rz) });
  scene.add(shadowy(new THREE.Mesh(merge(parts), stdVC({ roughness: 0.6 }))));
}

// ------------------------------------------------------------------ Water Police base, Point Direction (end of Harvest Road, North Fremantle)
export const POLICE_BASE = { x: 0, z: 0, dockX: 0, dockZ: 0 };
function buildPoliceBase(scene) {
  const p = W.json.landmarks['Fremantle Water Police'];
  if (!p) return;
  const [x, z] = p;
  const gr = { x: 0, z: 0 };
  sdfGrad(x, z, gr); // points inland
  const wx = -gr.x, wz = -gr.z; // towards the river
  const yaw = Math.atan2(wx, wz);
  const g0 = Math.max(heightAt(x, z), 1.5);
  const grp = new THREE.Group();
  grp.position.set(x, g0, z); grp.rotation.y = yaw; // local +z faces the river
  const add = (geo, m, px, py, pz, rx = 0, ry = 0, rz = 0) => { const o = shadowy(new THREE.Mesh(geo, m)); o.position.set(px, py, pz); o.rotation.set(rx, ry, rz); grp.add(o); return o; };
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f2ef, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2b3d4c, roughness: 0.08, metalness: 0.6 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.7 });
  const chq = new THREE.MeshStandardMaterial({ map: policeChequer(), roughness: 0.5 });
  add(new THREE.BoxGeometry(30, 7.4, 16), white, 0, 3.7, 0);
  add(new THREE.BoxGeometry(26, 2.6, 0.2), glass, 0, 5.4, 8.05);
  add(new THREE.BoxGeometry(26, 2.4, 0.2), glass, 0, 1.8, 8.05);
  for (const s of [-1, 1]) add(new THREE.PlaneGeometry(14, 0.8), chq, 0, 3.4, s * 8.06, 0, s > 0 ? 0 : Math.PI, 0);
  add(new THREE.PlaneGeometry(30, 0.8), chq, 0, 3.4, 8.07, 0, 0, 0);
  add(new THREE.BoxGeometry(31, 0.5, 17), grey, 0, 7.6, 0);
  // sign
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const cx = c.getContext('2d'); cx.fillStyle = '#0b2e8a'; cx.fillRect(0, 0, 512, 96); cx.fillStyle = '#fff'; cx.font = 'bold 54px Arial, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('WATER POLICE', 256, 50);
  const st = new THREE.CanvasTexture(c); st.colorSpace = THREE.SRGBColorSpace;
  add(new THREE.PlaneGeometry(10, 1.9), new THREE.MeshStandardMaterial({ map: st, roughness: 0.5 }), -6, 8.9, 8.2);
  add(new THREE.BoxGeometry(10.4, 2.2, 0.2), grey, -6, 8.9, 8.05);
  // radio mast and antennas
  add(new THREE.CylinderGeometry(0.2, 0.35, 26, 6), grey, 11, 20, -4);
  for (const yy of [16, 22, 30]) add(new THREE.BoxGeometry(2.4, 0.12, 0.12), grey, 11, yy, -4);
  // slipway to the river
  add(new THREE.BoxGeometry(6, 0.3, 22), new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.95 }), 10, -0.6, 16, -0.12, 0, 0);
  scene.add(grp);
  POLICE_BASE.x = x; POLICE_BASE.z = z;
  // police boats moored at the base pontoons (OSM piers named "Fremantle Water Police")
  const piers = W.json.piers.filter(q => q.line && q.name === 'Fremantle Water Police');
  let k = 0;
  for (const pr of piers) {
    const a = pr.line[0], b = pr.line[pr.line.length - 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    for (const side of [1, -1]) {
      const ox = -dz / l * 3.6 * side, oz = dx / l * 3.6 * side;
      const mx = (a[0] + b[0]) / 2 + ox, mz = (a[1] + b[1]) / 2 + oz;
      if (sdfAt(mx, mz) > -2) continue;
      const boat = policeBoat(k % 2 ? 'jetboat' : 'rib');
      boat.position.set(mx, 0, mz); boat.rotation.y = Math.atan2(-dx, -dz);
      scene.add(boat);
      Obs.addCircle(mx, mz, 3, 2, 'boat');
      POLICE_BASE.dockX = mx; POLICE_BASE.dockZ = mz;
      k++;
    }
  }
}

// container ship alongside North Quay
function buildPort(scene) {
  const [ax, az] = toXZ(115.7420, -32.0470), [bx, bz] = toXZ(115.7460, -32.0430);
  let dx = bx - ax, dz = bz - az; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  let nx = -dz, nz = dx; if (nz < 0) { nx = -nx; nz = -nz; }
  let px = (ax + bx) / 2, pz = (az + bz) / 2;
  for (let i = 0; i < 400 && sdfAt(px, pz) > -19; i++) { px += nx; pz += nz; }
  const ship = boatModel('ship');
  ship.position.set(px, 0, pz); ship.rotation.y = Math.atan2(-dx, -dz);
  scene.add(ship);
  for (let s = -100; s <= 100; s += 25) Obs.addCircle(px + dx * s, pz + dz * s, 16, 18, 'ship');
}

export function createStatic(scene) {
  const skip = [];
  const lm = W.json.landmarks;
  if (lm['Crawley Edge Boatshed']) skip.push([lm['Crawley Edge Boatshed'][0], lm['Crawley Edge Boatshed'][1], 8]);
  if (lm['Fremantle Water Police']) skip.push([lm['Fremantle Water Police'][0], lm['Fremantle Water Police'][1], 22]);
  const buildings = buildBuildings(scene, skip);
  const bridges = buildBridges(scene);
  buildPiers(scene);
  const moored = buildMoored(scene);
  buildLandmarks(scene);
  buildPoliceBase(scene);
  buildPort(scene);
  const tg = treeGeos(), tmat = stdVC({ roughness: 0.9 });
  const treeChunks = new Map();
  const mats = buildingMaterials();
  function update(cam, quality, night) {
    for (const k of ['tower', 'office', 'apt', 'house', 'shed']) mats[k].emissiveIntensity = night * 1.6;
    bridges.headMat.emissiveIntensity = night * 3;
    const bd = [3500, 5500, 8000][quality];
    for (const m of buildings) m.visible = m.geometry.boundingSphere.center.distanceTo(cam) < bd + m.geometry.boundingSphere.radius;
    const md = [1500, 2200, 3000][quality];
    for (const g of moored) g.visible = Math.hypot(g.userData.c[0] - cam.x, g.userData.c[1] - cam.z) < md;
    const td = [1600, 2400, 3300][quality];
    const cx = Math.floor(cam.x / 1000), cz = Math.floor(cam.z / 1000), r = Math.ceil(td / 1000);
    let built = 0;
    for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) {
      const k = i + ',' + j;
      const d = Math.hypot((i + 0.5) * 1000 - cam.x, (j + 0.5) * 1000 - cam.z);
      if (d > td) { const t = treeChunks.get(k); if (t) t.visible = false; continue; }
      if (!treeChunks.has(k)) { if (built >= 1) continue; built++; const g = buildTreeChunk(tg, tmat, i, j); scene.add(g); treeChunks.set(k, g); }
      treeChunks.get(k).visible = true;
    }
    for (const [k, g] of treeChunks) { const [i, j] = k.split(',').map(Number); if (Math.abs(i - cx) > r + 1 || Math.abs(j - cz) > r + 1) g.visible = false; }
  }
  return { update };
}

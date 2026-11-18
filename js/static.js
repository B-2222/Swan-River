// Static world built from the OSM data: buildings, bridges, jetties, moorings, landmarks, trees, and collision data.
import * as THREE from 'three';
import { W, heightAt, sdfAt, coverAt, COVER, toXZ, sdfGrad } from './world.js';
import { merge, M, boatGeo, treeGeos, col } from './models.js';

// ------------------------------------------------------------------ collision registry
export const Obs = {
  cell: 64, grid: new Map(), decks: new Map(),
  key(ix, iz) { return ix * 100003 + iz; },
  addSeg(ax, az, bx, bz, r, top, kind = 'wall') {
    const s = { ax, az, bx, bz, r, top, kind };
    const x0 = Math.floor((Math.min(ax, bx) - r) / this.cell), x1 = Math.floor((Math.max(ax, bx) + r) / this.cell);
    const z0 = Math.floor((Math.min(az, bz) - r) / this.cell), z1 = Math.floor((Math.max(az, bz) + r) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = this.key(i, j); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(s);
    }
  },
  addCircle(x, z, r, top, kind = 'boat') { this.addSeg(x, z, x, z, r, top, kind); },
  addDeck(ax, az, bx, bz, hw, ya, yb, name) {
    const s = { ax, az, bx, bz, hw, ya, yb, name };
    const x0 = Math.floor((Math.min(ax, bx) - hw) / this.cell), x1 = Math.floor((Math.max(ax, bx) + hw) / this.cell);
    const z0 = Math.floor((Math.min(az, bz) - hw) / this.cell), z1 = Math.floor((Math.max(az, bz) + hw) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = this.key(i, j); if (!this.decks.has(k)) this.decks.set(k, []); this.decks.get(k).push(s);
    }
  },
  // push a circle at (p.x, p.z) out of walls. Returns {hit, nx, nz, depth, kind} or null
  resolve(p, r, y) {
    const list = this.grid.get(this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell)));
    if (!list) return null;
    let res = null;
    for (const s of list) {
      if (y > s.top + 0.2) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.z - s.az) * dz) / L2)) : 0;
      const cx = s.ax + dx * t, cz = s.az + dz * t;
      let ex = p.x - cx, ez = p.z - cz;
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
  // bridge deck overhead at (x,z): returns {y (deck top), name} or null
  deckAt(x, z) {
    const list = this.decks.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return null;
    for (const s of list) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (L2 || 1)));
      const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
      if (d < s.hw) return { y: s.ya + (s.yb - s.ya) * t, name: s.name };
    }
    return null;
  },
};

function b64(s) { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }

// ------------------------------------------------------------------ materials
export const nightU = { value: 0 };
function buildingMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWin; varying float vWin; varying vec3 vWP; varying vec3 vNw;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin; vWP = (modelMatrix * vec4(position, 1.0)).xyz; vNw = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying float vWin; varying vec3 vWP; varying vec3 vNw; float winLit = 0.0;
        float bhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vWin > 0.0) {
          float along = abs(vNw.x) > abs(vNw.z) ? vWP.z : vWP.x;
          vec2 cell = vec2(along / (vWin > 0.75 ? 2.6 : 3.4), vWP.y / 3.3);
          vec2 f = fract(cell);
          float w = step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.82);
          float glass = vWin > 0.75 ? 0.75 : 0.45;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.14, 0.18) + diffuseColor.rgb * 0.25, w * glass);
          winLit = w * step(0.42, bhash(floor(cell) + floor(vWP.xz / 40.0)));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * winLit * uNight * 1.3;`);
  };
  return m;
}
const lambertVC = () => new THREE.MeshLambertMaterial({ vertexColors: true });

// ------------------------------------------------------------------ buildings
const WALLS = [0xe9dfc7, 0xf2f0ea, 0xd8c39a, 0xb8735a, 0xc9c6c0, 0xd6cbb5, 0xe3d6b0].map(col);
const HOUSE_ROOFS = [0xa3523a, 0x45484d, 0x6d7a86, 0xcdbb93, 0x7d3b2e, 0x3b3d41, 0x8f5a44].map(col);
const GLASS = [0x7f9db5, 0x5d7f9c, 0x9fb4c2, 0x6f8797, 0x8aa6b8, 0x4f6b80, 0xa5b7c4].map(col);

function buildBuildings(scene, skip) {
  const B = W.json.buildings;
  const counts = b64(B.counts), heights = new Uint16Array(b64(B.heights).buffer), styles = b64(B.styles);
  const coords = new Int16Array(b64(B.coords).buffer);
  const chunks = new Map();
  let off = 0;
  const mat = buildingMaterial();
  for (let b = 0; b < B.n; b++) {
    const n = counts[b];
    const pts = [];
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { const x = coords[(off + i) * 2] / 2, z = coords[(off + i) * 2 + 1] / 2; pts.push([x, z]); cx += x; cz += z; }
    off += n;
    cx /= n; cz /= n;
    if (skip.some(s => Math.hypot(s[0] - cx, s[1] - cz) < s[2])) continue;
    const h = heights[b] / 10, style = styles[b] >> 4, ci = styles[b] & 15;
    const key = Math.floor(cx / 1000) * 1000 + Math.floor(cz / 1000);
    if (!chunks.has(key)) chunks.set(key, { pos: [], nor: [], colr: [], win: [] });
    addBuilding(chunks.get(key), pts, h, style, ci);
  }
  const meshes = [];
  for (const c of chunks.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c.colr, 3));
    g.setAttribute('aWin', new THREE.Float32BufferAttribute(c.win, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    scene.add(m); meshes.push(m);
  }
  return meshes;
}

function addBuilding(c, pts, h, style, ci) {
  const n = pts.length;
  let base = Infinity, gmax = -Infinity;
  for (const p of pts) { const g = heightAt(p[0], p[1]); base = Math.min(base, g); gmax = Math.max(gmax, g); }
  base = Math.max(base, 0.2) - 0.4;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const ccw = area > 0;
  const isHouse = style === 1, isTower = style === 2, isRoof = style === 3;
  const wallTop = Math.max(gmax, 0.2) + (isHouse ? Math.max(2.8, h - 2.3) : h);
  const wallC = isTower ? GLASS[ci % 7] : WALLS[ci % 7];
  const winA = isTower ? 1.0 : (h > 8 ? 0.7 : 0.4);
  const bottom = isRoof ? wallTop - 0.5 : base;
  const P = c.pos, N = c.nor, C = c.colr, Wn = c.win;
  const push = (x, y, z, nx, ny, nz, cc, w) => { P.push(x, y, z); N.push(nx, ny, nz); C.push(cc.r, cc.g, cc.b); Wn.push(w); };
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const nx = (ccw ? dz : -dz) / l, nz = (ccw ? -dx : dx) / l;
    const shade = 0.9 + 0.1 * Math.abs(nx);
    const cc = wallC.clone().multiplyScalar(shade);
    const A0 = [a[0], bottom, a[1]], B0 = [b[0], bottom, b[1]], A1 = [a[0], wallTop, a[1]], B1 = [b[0], wallTop, b[1]];
    const tri = ccw ? [A0, A1, B0, B0, A1, B1] : [A0, B0, A1, B0, B1, A1];
    for (const v of tri) push(v[0], v[1], v[2], nx, 0, nz, cc, winA);
  }
  if (isHouse) {
    let mx = 0, mz = 0; for (const p of pts) { mx += p[0]; mz += p[1]; } mx /= n; mz /= n;
    const rh = 2.2, rc = HOUSE_ROOFS[ci % 7];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const v1 = new THREE.Vector3(a[0], wallTop, a[1]), v2 = new THREE.Vector3(b[0], wallTop, b[1]), v3 = new THREE.Vector3(mx, wallTop + rh, mz);
      const nrm = new THREE.Vector3().subVectors(v2, v1).cross(new THREE.Vector3().subVectors(v3, v1)).normalize();
      const tri = nrm.y >= 0 ? [v1, v2, v3] : [v1, v3, v2];
      if (nrm.y < 0) nrm.negate();
      for (const v of tri) push(v.x, v.y, v.z, nrm.x, nrm.y, nrm.z, rc, 0);
    }
  } else {
    const contour = pts.map(p => new THREE.Vector2(p[0], p[1]));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
    const rc = isTower ? col(0x4a4f55) : col(0x9a9c9e).multiplyScalar(0.85 + (ci % 3) * 0.07);
    for (const t of tris) {
      const a = pts[t[0]], b = pts[t[1]], d = pts[t[2]];
      const cr = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
      const tri = cr < 0 ? [a, b, d] : [a, d, b];
      for (const v of tri) push(v[0], wallTop, v[1], 0, 1, 0, rc, 0);
    }
  }
}

// ------------------------------------------------------------------ bridges
function buildBridges(scene) {
  const parts = [];
  const lamps = [];
  const arches = [];
  for (const br of W.json.bridges) {
    const P = br.pts, w = br.w, n = P.length;
    const foot = /footway|cycleway|path|pedestrian/.test(br.kind);
    const th = br.rail ? 1.6 : foot ? 0.7 : 1.4;
    const topC = br.rail ? col(0x6b6158) : foot ? col(br.name.includes('Matagarup') || br.name.includes('Elizabeth') ? 0xd9d6cf : 0x8f7f6a) : col(0x4b4c4f);
    const sideC = col(0xb3afa6);
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
    const dn = (v, d) => [v[0], v[1] - d, v[2]];
    const up = (v, d) => [v[0], v[1] + d, v[2]];
    const railH = foot ? 1.1 : 0.95;
    for (let i = 0; i < n - 1; i++) {
      quad(L[i], L[i + 1], R[i], R[i + 1], topC);                         // deck top
      quad(dn(R[i], th), dn(R[i + 1], th), dn(L[i], th), dn(L[i + 1], th), sideC.clone().multiplyScalar(0.6)); // underside
      quad(dn(L[i], th), dn(L[i + 1], th), L[i], L[i + 1], sideC);          // sides
      quad(R[i], R[i + 1], dn(R[i], th), dn(R[i + 1], th), sideC);
      quad(L[i], L[i + 1], up(L[i], railH), up(L[i + 1], railH), sideC);    // parapets
      quad(up(R[i], railH), up(R[i + 1], railH), R[i], R[i + 1], sideC);
      quad(up(L[i + 1], railH), up(L[i], railH), L[i + 1], L[i], sideC);
      quad(R[i + 1], R[i], up(R[i + 1], railH), up(R[i], railH), sideC);
      // deck collision overhead + under-bridge detection
      Obs.addDeck(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], w / 2 + 0.5, P[i][2], P[i + 1][2], br.name);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    parts.push({ geo: g });
    // piers
    for (const p of br.piers) {
      const hgt = p[3] - th + 8;
      const across = w * 0.92;
      parts.push({ geo: new THREE.BoxGeometry(1.8, hgt, across), color: 0xa9a59c, m: M(p[0], p[3] - th - hgt / 2, p[1], 0, -p[2], 0) });
      const ax = Math.cos(p[2]), az = Math.sin(p[2]);
      const sx = -az, sz = ax;
      Obs.addSeg(p[0] + sx * across / 2, p[1] + sz * across / 2, p[0] - sx * across / 2, p[1] - sz * across / 2, 1.0, p[3] - th, 'pier');
    }
    // lamp posts on road bridges
    if (!foot && !br.rail) {
      let acc = 0;
      for (let i = 0; i < n - 1; i++) {
        const seg = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
        acc += seg;
        if (acc > 34) { acc = 0; lamps.push([L[i][0], L[i][1], L[i][2]], [R[i][0], R[i][1], R[i][2]]); }
      }
    }
    if (br.name === 'Matagarup Bridge' || br.name === 'Elizabeth Quay Bridge') arches.push(br);
  }
  const mesh = new THREE.Mesh(merge(parts), lambertVC());
  scene.add(mesh);
  // lamps
  const lampGeo = merge([{ geo: new THREE.CylinderGeometry(0.08, 0.1, 7, 5), color: 0x777777, m: M(0, 3.5, 0) }]);
  const lampMesh = new THREE.InstancedMesh(lampGeo, lambertVC(), lamps.length);
  const headMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.25, 0.5), headMat, lamps.length);
  lamps.forEach((p, i) => { lampMesh.setMatrixAt(i, M(p[0], p[1], p[2])); heads.setMatrixAt(i, M(p[0], p[1] + 7, p[2])); });
  scene.add(lampMesh); scene.add(heads);
  // arches (Matagarup's 72 m steel arches, Elizabeth Quay's white S ribs)
  for (const br of arches) {
    const big = br.name === 'Matagarup Bridge';
    const P = br.pts, n = P.length;
    for (const side of big ? [-1, 1] : [-1, 1]) {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const off = big ? 4.5 + 2 * Math.sin(t * Math.PI * 2) : 2.2;
        const hgt = big ? 70 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.08) / 0.84))), 1.1) : 20 * Math.sin(Math.PI * t);
        pts.push(new THREE.Vector3(P[i][0] - tz * off * side, P[i][2] + hgt, P[i][1] + tx * off * side));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, big ? 0.9 : 0.35, 8), new THREE.MeshLambertMaterial({ color: big ? 0xdfe2e4 : 0xf6f6f6 }));
      scene.add(tube);
      // hangers
      const hang = [];
      for (let i = 2; i < n - 2; i += 2) {
        const top = pts[i]; const yb = P[i][2];
        const len = top.y - yb;
        if (len < 2) continue;
        hang.push({ geo: new THREE.CylinderGeometry(0.05, 0.05, len, 4), color: 0xcfd2d4, m: M(top.x, yb + len / 2, top.z) });
      }
      if (hang.length) scene.add(new THREE.Mesh(merge(hang), lambertVC()));
    }
  }
  return { headMat, lampCount: lamps.length };
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
        const ang = Math.atan2(dz, dx);
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        if (rock) {
          parts.push({ geo: new THREE.BoxGeometry(l + w * 0.5, 5.5, w), color: rockC, m: M(mx, y - 2.75, mz, 0, -ang, 0) });
        } else {
          parts.push({ geo: new THREE.BoxGeometry(l + 0.2, 0.32, w), color: deckC, m: M(mx, y, mz, 0, -ang, 0) });
          const np = Math.max(1, Math.floor(l / 4));
          for (let k = 0; k <= np; k++) {
            const t = k / np, px = a[0] + dx * t, pz = a[1] + dz * t;
            const sx = -dz / l * w * 0.45, sz = dx / l * w * 0.45;
            for (const s of [1, -1]) parts.push({ geo: new THREE.BoxGeometry(0.3, 5.4, 0.3), color: pileC, m: M(px + sx * s, y - 2.6, pz + sz * s) });
          }
        }
        Obs.addSeg(a[0], a[1], b[0], b[1], w / 2, y, rock ? 'rock' : 'jetty');
      }
    } else if (p.poly) {
      const pts = p.poly, rock = !!p.bw;
      const y = rock ? 2.2 : DECK;
      const contour = pts.map(v => new THREE.Vector2(v[0], v[1]));
      let tris = [];
      try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { /* skip */ }
      const pos = [], cl = [];
      const cc = rock ? rockC : deckC;
      for (const t of tris) {
        const a = pts[t[0]], b = pts[t[1]], d = pts[t[2]];
        const cr = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
        for (const v of (cr < 0 ? [a, b, d] : [a, d, b])) { pos.push(v[0], y, v[1]); cl.push(cc.r, cc.g, cc.b); }
      }
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const side = rock ? rockC : pileC;
        for (const v of [[a[0], y, a[1]], [b[0], y, b[1]], [a[0], -3, a[1]], [b[0], y, b[1]], [b[0], -3, b[1]], [a[0], -3, a[1]]]) { pos.push(v[0], v[1], v[2]); cl.push(side.r, side.g, side.b); }
        Obs.addSeg(a[0], a[1], b[0], b[1], 0.6, y, rock ? 'rock' : 'jetty');
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
      g.computeVertexNormals();
      parts.push({ geo: g });
    }
  }
  const mat = lambertVC(); mat.side = THREE.DoubleSide;
  // chunk the merged geometry by location for culling
  scene.add(new THREE.Mesh(merge(parts), mat));
}

// ------------------------------------------------------------------ moored boats (real marinas + swing moorings)
const BOAT_TYPES = ['yacht', 'cruiser', 'runabout', 'tinny'];
const BOAT_R = [4.2, 5.0, 2.8, 1.9];
function buildMoored(scene) {
  const geos = BOAT_TYPES.map(t => boatGeo(t));
  const mat = lambertVC();
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
      im.computeBoundingSphere();
      g.add(im);
    }
    for (const b of list) { cx += b[0]; cz += b[1]; }
    g.userData.c = [cx / list.length, cz / list.length];
    scene.add(g); groups.push(g);
  }
  return groups;
}

// ------------------------------------------------------------------ trees (scattered from land cover, per 1 km chunk)
function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = s * 16807 % 2147483647) / 2147483647; }
function buildTreeChunk(geos, mat, cx, cz) {
  const R = rng(cx * 7919 + cz * 104729 + 13);
  const lists = { gum: [], pine: [], palm: [] };
  const S = 1000;
  for (let k = 0; k < 2600; k++) {
    const x = cx * S + R() * S, z = cz * S + R() * S;
    const c = coverAt(x, z);
    let p = 0;
    if (c === COVER.BUSH) p = 1; else if (c === COVER.PARK) p = 0.16; else if (c === COVER.URBAN) p = 0.09;
    else if (c === COVER.GOLF) p = 0.12; else if (c === COVER.WET) p = 0.3; else if (c === COVER.COMM) p = 0.03;
    else if (c === COVER.SAND) p = 0.02;
    if (R() > p) continue;
    const h = heightAt(x, z);
    if (h < 0.8 || sdfAt(x, z) < 4) continue;
    const s = 0.7 + R() * 0.7;
    const ocean = x < -3000;
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
    im.computeBoundingSphere();
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
  // The Bell Tower (Swan Bells): copper sails and spire on top of the OSM glass tower
  if (at('The Bell Tower')) { const p = at('The Bell Tower'); const g = ground(p);
    parts.push({ geo: new THREE.ConeGeometry(4.5, 30, 6), color: 0x5f9e8a, m: M(p[0], g + 52 + 15, p[1]) });
    parts.push({ geo: new THREE.BoxGeometry(1.2, 34, 9), color: 0x6fae96, m: M(p[0] + 4, g + 40, p[1], 0, 0.3, 0.12) });
    parts.push({ geo: new THREE.BoxGeometry(1.2, 34, 9), color: 0x6fae96, m: M(p[0] - 4, g + 40, p[1], 0, -0.3, -0.12) });
  }
  // Kings Park State War Memorial obelisk and DNA tower
  if (at('State War Memorial')) { const p = at('State War Memorial'); const g = ground(p);
    parts.push({ geo: new THREE.CylinderGeometry(0.6, 1.8, 18, 4), color: 0xe8e1d0, m: M(p[0], g + 9, p[1], 0, Math.PI / 4, 0) });
    parts.push({ geo: new THREE.BoxGeometry(14, 1.2, 14), color: 0xd9d1bf, m: M(p[0], g + 0.6, p[1]) });
  }
  if (at('DNA Tower')) { const p = at('DNA Tower'); const g = ground(p);
    for (let i = 0; i < 22; i++) parts.push({ geo: new THREE.BoxGeometry(2.2, 0.25, 0.6), color: 0xf4f4f4, m: M(p[0], g + 0.7 * i, p[1], 0, i * 0.42, 0) });
    parts.push({ geo: new THREE.CylinderGeometry(0.25, 0.25, 15.5, 6), color: 0xdddddd, m: M(p[0], g + 7.7, p[1]) });
  }
  // Crawley Edge Boatshed: the little blue shed on its jetty in Matilda Bay
  if (at('Crawley Edge Boatshed')) { const p = at('Crawley Edge Boatshed');
    parts.push({ geo: new THREE.BoxGeometry(5.6, 3.0, 6.2), color: 0x3f9be0, m: M(p[0], 2.7, p[1]) });
    parts.push({ geo: new THREE.BoxGeometry(5.8, 0.3, 6.4), color: 0xf4f4f4, m: M(p[0], 1.2, p[1]) });
    const roof = new THREE.CylinderGeometry(0.01, 4.4, 1.8, 4, 1);
    parts.push({ geo: roof, color: 0xeeeeee, m: M(p[0], 5.1, p[1], 0, Math.PI / 4, 0, 1, 1, 1.05) });
    parts.push({ geo: new THREE.BoxGeometry(1.6, 2.1, 0.1), color: 0xffffff, m: M(p[0], 2.4, p[1] + 3.12) });
    for (const dx of [-2.5, 2.5]) for (const dz of [-2.8, 2.8]) parts.push({ geo: new THREE.BoxGeometry(0.3, 4, 0.3), color: 0x4e3d2e, m: M(p[0] + dx, -0.8, p[1] + dz) });
    Obs.addCircle(p[0], p[1], 4, 5, 'jetty');
  }
  // lighthouses: North Mole red (port side entering), South Mole green
  const lighthouse = (x, z, c, h = 12) => {
    const g = Math.max(heightAt(x, z), 2.2);
    parts.push({ geo: new THREE.CylinderGeometry(1.3, 1.8, h, 10), color: c, m: M(x, g + h / 2, z) });
    parts.push({ geo: new THREE.CylinderGeometry(1.0, 1.0, 1.6, 8), color: 0x333333, m: M(x, g + h + 0.8, z) });
    parts.push({ geo: new THREE.ConeGeometry(1.3, 1.2, 8), color: c, m: M(x, g + h + 2.2, z) });
    Obs.addCircle(x, z, 2.2, g + h, 'rock');
  };
  for (const poi of W.json.pois) if (poi.k === 'lighthouse' && /North Mole/.test(poi.n)) lighthouse(poi.x, poi.z, 0xd62828);
  if (at('South Mole Lighthouse')) { const p = at('South Mole Lighthouse'); lighthouse(p[0], p[1], 0x2e9e4f); }
  // Round House on Arthur Head
  if (at('Round House')) { const p = at('Round House'); const g = ground(p);
    parts.push({ geo: new THREE.CylinderGeometry(7, 7, 4.5, 12), color: 0xd7c9a3, m: M(p[0], g + 2.2, p[1]) });
  }
  // Fremantle Port container cranes on North Quay (from OSM crane nodes)
  const cranes = W.json.pois.filter(q => q.k === 'crane').filter(q => { const ll = [q.x, q.z]; return ll[1] > 4600 && ll[1] < 5800 && ll[0] < -4000; });
  const tmp = { x: 0, z: 0 };
  for (const q of cranes) {
    const g = Math.max(heightAt(q.x, q.z), 2);
    sdfGrad(q.x, q.z, tmp);
    const ang = Math.atan2(-tmp.x, -tmp.z); // boom points over the water
    const R = new THREE.Matrix4().makeRotationY(ang);
    const T = new THREE.Matrix4().makeTranslation(q.x, g, q.z);
    const C = (geo, c, m) => parts.push({ geo, color: c, m: T.clone().multiply(R).multiply(m) });
    for (const sx of [-8, 8]) for (const sz of [-9, 9]) C(new THREE.BoxGeometry(1.4, 46, 1.4), 0xc23b22, M(sx, 23, sz));
    C(new THREE.BoxGeometry(18, 3, 2), 0xc23b22, M(0, 30, -9)); C(new THREE.BoxGeometry(18, 3, 2), 0xc23b22, M(0, 30, 9));
    C(new THREE.BoxGeometry(4, 3.5, 95), 0xe8e8e8, M(0, 47, -16));
    C(new THREE.BoxGeometry(10, 6, 10), 0xf2f2f2, M(0, 51, 14));
    C(new THREE.BoxGeometry(2, 20, 2), 0xc23b22, M(0, 58, 9));
  }
  // Fremantle Water Police base sign
  if (at('Fremantle Water Police')) { const p = at('Fremantle Water Police'); const g = ground(p);
    parts.push({ geo: new THREE.CylinderGeometry(0.1, 0.1, 10, 5), color: 0xdddddd, m: M(p[0] + 8, g + 5, p[1]) });
    parts.push({ geo: new THREE.BoxGeometry(0.1, 1.2, 2.2), color: 0x0b2e8a, m: M(p[0] + 8, g + 9.3, p[1] + 1.1) });
  }
  // Wadjemup (Rottnest) lighthouse
  const [rx, rz] = toXZ(115.5395, -32.0070);
  parts.push({ geo: new THREE.CylinderGeometry(2.2, 3, 39, 12), color: 0xf2efe6, m: M(rx, 20 + 19.5, rz) });
  parts.push({ geo: new THREE.CylinderGeometry(2.0, 2.0, 3, 10), color: 0x333333, m: M(rx, 20 + 40.5, rz) });
  scene.add(new THREE.Mesh(merge(parts), lambertVC()));
}

// container ship along North Quay, tugs in the harbour
function buildPort(scene) {
  // North Quay runs north-east between these points (from the OSM shoreline)
  const [ax, az] = toXZ(115.7420, -32.0470), [bx, bz] = toXZ(115.7460, -32.0430);
  let dx = bx - ax, dz = bz - az; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  let nx = -dz, nz = dx; if (nz < 0) { nx = -nx; nz = -nz; } // perpendicular pointing south, into the harbour
  let px = (ax + bx) / 2, pz = (az + bz) / 2;
  for (let i = 0; i < 400 && sdfAt(px, pz) > -19; i++) { px += nx; pz += nz; }
  const ship = new THREE.Mesh(boatGeo('ship'), lambertVC());
  ship.position.set(px, 0, pz);
  ship.rotation.y = Math.atan2(-dx, -dz);
  scene.add(ship);
  for (let s = -100; s <= 100; s += 25) Obs.addCircle(px + dx * s, pz + dz * s, 16, 18, 'ship');
  return ship;
}

export function createStatic(scene) {
  const skip = [];
  const lm = W.json.landmarks;
  if (lm['Crawley Edge Boatshed']) skip.push([lm['Crawley Edge Boatshed'][0], lm['Crawley Edge Boatshed'][1], 8]);
  const buildings = buildBuildings(scene, skip);
  const bridges = buildBridges(scene);
  buildPiers(scene);
  const moored = buildMoored(scene);
  buildLandmarks(scene);
  buildPort(scene);
  const tg = treeGeos(), tmat = lambertVC();
  const treeChunks = new Map();
  let builtThisFrame = 0;
  function update(cam, quality, night) {
    nightU.value = night;
    bridges.headMat.color.setRGB(0.35 + night * 1.2, 0.33 + night * 1.0, 0.3 + night * 0.6);
    const bd = [3500, 5500, 8000][quality];
    for (const m of buildings) m.visible = m.geometry.boundingSphere.center.distanceTo(cam) < bd + m.geometry.boundingSphere.radius;
    const md = [1500, 2200, 3000][quality];
    for (const g of moored) g.visible = Math.hypot(g.userData.c[0] - cam.x, g.userData.c[1] - cam.z) < md;
    // trees
    const td = [1600, 2400, 3300][quality];
    const cx = Math.floor(cam.x / 1000), cz = Math.floor(cam.z / 1000), r = Math.ceil(td / 1000);
    builtThisFrame = 0;
    for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) {
      const k = i + ',' + j;
      const d = Math.hypot((i + 0.5) * 1000 - cam.x, (j + 0.5) * 1000 - cam.z);
      if (d > td) { const t = treeChunks.get(k); if (t) t.visible = false; continue; }
      if (!treeChunks.has(k)) {
        if (builtThisFrame >= 1) continue;
        builtThisFrame++;
        const g = buildTreeChunk(tg, tmat, i, j); scene.add(g); treeChunks.set(k, g);
      }
      treeChunks.get(k).visible = true;
    }
    for (const [k, g] of treeChunks) {
      const [i, j] = k.split(',').map(Number);
      if (Math.abs(i - cx) > r + 1 || Math.abs(j - cz) > r + 1) g.visible = false;
    }
  }
  return { update };
}

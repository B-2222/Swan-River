// Procedural low-poly models with vertex colours (no external assets).
import * as THREE from 'three';

const tmpM = new THREE.Matrix4();
export const col = (hex) => new THREE.Color(hex);

// Merge parts [{geo, color, m (Matrix4)}] into one non-indexed geometry with a colour attribute.
export function merge(parts) {
  const pos = [], nor = [], colr = [];
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.m) g.applyMatrix4(p.m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pa = g.attributes.position.array, na = g.attributes.normal.array;
    const ca = g.attributes.color ? g.attributes.color.array : null;
    const c = p.color ? (p.color.isColor ? p.color : new THREE.Color(p.color)) : new THREE.Color(1, 1, 1);
    for (let i = 0; i < pa.length; i++) { pos.push(pa[i]); nor.push(na[i]); }
    for (let i = 0; i < pa.length / 3; i++) {
      if (ca) colr.push(ca[i * 3], ca[i * 3 + 1], ca[i * 3 + 2]); else colr.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.computeBoundingSphere();
  return g;
}
export const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);

// Lofted planing hull. Bow points to -z. Origin at the waterline centre.
export function hull(L, B, D, o = {}) {
  const hullC = col(o.hull ?? 0xffffff), deckC = col(o.deck ?? 0xffffff), stripeC = o.stripe != null ? col(o.stripe) : null;
  const N = 16, pos = [], colors = [], idx = [];
  const rings = [];
  for (let s = 0; s <= N; s++) {
    const t = s / N;
    const wc = t < 0.42 ? Math.pow(Math.sin(t / 0.42 * Math.PI / 2), o.fine ?? 0.6) : 1 - (t - 0.42) * (o.sternTaper ?? 0.1);
    const hw = Math.max(0.001, B / 2 * wc);
    const keel = -D * 0.42 + (t < 0.4 ? D * 0.55 * Math.pow(1 - t / 0.4, 2) : 0);
    const deck = D * 0.58 + D * 0.22 * Math.pow(1 - t, 2.2) * (o.sheer ?? 1);
    const chine = keel + (deck - keel) * 0.32;
    const z = -L / 2 + t * L;
    const crown = o.crown ?? D * 0.08;
    const prof = [[0, deck + crown], [hw * 0.86, deck], [hw, deck - D * 0.12], [hw * 0.96, chine], [hw * 0.45, keel + (chine - keel) * 0.3], [0, keel]];
    const ring = [];
    const all = prof.concat(prof.slice(1, -1).reverse().map(p => [-p[0], p[1]]));
    for (const p of all) {
      ring.push(pos.length / 3);
      pos.push(p[0], p[1], z);
      const stripeY = deck - D * 0.12;
      let c = p[1] > deck - D * 0.06 ? deckC : hullC;
      if (stripeC && Math.abs(p[1] - stripeY) < D * 0.09 && p[0] !== 0) c = stripeC;
      colors.push(c.r, c.g, c.b);
    }
    rings.push(ring);
  }
  const R = rings[0].length;
  for (let s = 0; s < N; s++) for (let k = 0; k < R; k++) {
    const a = rings[s][k], b = rings[s][(k + 1) % R], c = rings[s + 1][k], d = rings[s + 1][(k + 1) % R];
    idx.push(a, c, b, b, c, d);
  }
  // transom
  const last = rings[N];
  const ci = pos.length / 3; pos.push(0, 0, L / 2); colors.push(hullC.r, hullC.g, hullC.b);
  for (let k = 0; k < R; k++) idx.push(ci, last[(k + 1) % R], last[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ jet skis
export const SKIS = [
  { id: 'rxpx', name: 'Sea-Doo RXP-X 325', hp: 325, topKn: 58, len: 3.27, beam: 1.27, mass: 361, accel: 1.0, turn: 1.15, tail: 1.0,
    hull: 0x1a1d21, deck: 0x14b39a, stripe: 0xf2f2f2, seat: 0x101214, blurb: 'Supercharged 1630 ACE. Race hull, carves like it is on rails.' },
  { id: 'gp', name: 'Yamaha GP SVHO', hp: 250, topKn: 57, len: 3.35, beam: 1.24, mass: 355, accel: 1.12, turn: 1.0, tail: 1.05,
    hull: 0xf4f6f8, deck: 0x1f57c4, stripe: 0x0b1f4a, seat: 0x111111, blurb: 'Supercharged 1.9 L. Brutal off the line.' },
  { id: 'ultra', name: 'Kawasaki Ultra 310R', hp: 310, topKn: 59, len: 3.66, beam: 1.21, mass: 435, accel: 0.95, turn: 0.85, tail: 1.2,
    hull: 0x16181a, deck: 0x69c21a, stripe: 0xffffff, seat: 0x0e0e0e, blurb: 'Longest hull, highest top end, biggest wall of water.' },
  { id: 'spark', name: 'Sea-Doo Spark Trixx', hp: 90, topKn: 43, len: 2.79, beam: 1.18, mass: 200, accel: 0.8, turn: 1.45, tail: 0.7,
    hull: 0xf5f5f0, deck: 0xff7a1a, stripe: 0x222222, seat: 0x1b1b1b, blurb: 'Light and flicky. Spins, hops and slides all day.' },
];

export function jetSkiModel(spec) {
  const L = spec.len, B = spec.beam;
  const parts = [];
  parts.push({ geo: hull(L, B, 0.72, { hull: spec.hull, deck: spec.deck, stripe: spec.stripe, fine: 0.55, crown: 0.12 }) });
  // hood / front cowl
  parts.push({ geo: ico(0.5, 1), color: spec.deck, m: M(0, 0.62, -L * 0.22, 0, 0, 0, 0.95, 0.42, 1.25) });
  // handlebar pod and bars
  parts.push({ geo: box(0.32, 0.32, 0.4), color: spec.hull, m: M(0, 0.82, -L * 0.07, -0.5) });
  parts.push({ geo: cyl(0.025, 0.025, 0.78, 6), color: 0x222222, m: M(0, 0.98, -L * 0.02, 0, 0, Math.PI / 2) });
  // seat
  parts.push({ geo: box(0.44, 0.2, 1.1), color: spec.seat, m: M(0, 0.68, L * 0.14) });
  parts.push({ geo: box(0.46, 0.06, 1.12), color: spec.stripe, m: M(0, 0.57, L * 0.14) });
  // sponsons and pump
  parts.push({ geo: box(0.08, 0.1, 0.5), color: 0x333333, m: M(B * 0.47, -0.12, L * 0.36) });
  parts.push({ geo: box(0.08, 0.1, 0.5), color: 0x333333, m: M(-B * 0.47, -0.12, L * 0.36) });
  parts.push({ geo: cyl(0.1, 0.12, 0.3, 8), color: 0x2a2a2a, m: M(0, -0.1, L * 0.5, Math.PI / 2) });
  // mirrors
  parts.push({ geo: box(0.12, 0.07, 0.03), color: 0x111111, m: M(0.32, 0.92, -L * 0.12) });
  parts.push({ geo: box(0.12, 0.07, 0.03), color: 0x111111, m: M(-0.32, 0.92, -L * 0.12) });
  return merge(parts);
}

// rider wearing a PFD (life jackets are compulsory on PWCs in WA)
export function riderModel(shirt = 0x2266aa, pfd = 0xff6a00, skin = 0xe0ac7e) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const legs = merge([
    { geo: box(0.17, 0.5, 0.17), color: 0x1f2a44, m: M(0.16, 0.55, 0.2, -0.9) },
    { geo: box(0.17, 0.5, 0.17), color: 0x1f2a44, m: M(-0.16, 0.55, 0.2, -0.9) },
    { geo: box(0.16, 0.48, 0.16), color: 0x1f2a44, m: M(0.2, 0.42, -0.1, 0.5) },
    { geo: box(0.16, 0.48, 0.16), color: 0x1f2a44, m: M(-0.2, 0.42, -0.1, 0.5) },
  ]);
  const body = merge([
    { geo: box(0.42, 0.55, 0.26), color: pfd, m: M(0, 0.32, 0) },
    { geo: box(0.44, 0.08, 0.28), color: 0x222222, m: M(0, 0.18, 0) },
    { geo: ico(0.13, 1), color: skin, m: M(0, 0.76, -0.02) },
    { geo: box(0.2, 0.05, 0.05), color: 0x111111, m: M(0, 0.78, -0.13) },
    { geo: box(0.25, 0.06, 0.25), color: shirt, m: M(0, 0.87, 0.0) },
    { geo: box(0.1, 0.48, 0.1), color: skin, m: M(0.27, 0.32, -0.22, -1.1, 0, -0.25) },
    { geo: box(0.1, 0.48, 0.1), color: skin, m: M(-0.27, 0.32, -0.22, -1.1, 0, 0.25) },
  ]);
  const lm = new THREE.Mesh(legs, mat), bm = new THREE.Mesh(body, mat);
  bm.position.set(0, 0.62, 0.1);
  g.add(lm); g.add(bm);
  g.userData.torso = bm;
  return g;
}

// ------------------------------------------------------------------ boats
export function boatGeo(type, o = {}) {
  const p = [];
  if (type === 'yacht') {
    p.push({ geo: hull(9.5, 3.1, 1.5, { hull: o.hull ?? 0xf6f6f2, deck: 0xe8e2d4, stripe: o.stripe ?? 0x1c3d6e }) });
    p.push({ geo: box(2.0, 0.7, 3.2), color: 0xf0f0ea, m: M(0, 1.35, 0.6) });
    p.push({ geo: box(2.02, 0.22, 2.4), color: 0x223344, m: M(0, 1.45, 0.4) });
    p.push({ geo: cyl(0.07, 0.09, 13, 6), color: 0xd8d8d8, m: M(0, 7.4, -1.0) });
    p.push({ geo: cyl(0.05, 0.05, 4, 5), color: 0xd8d8d8, m: M(0, 2.3, 1.0, Math.PI / 2) });
    if (o.sail) {
      const s = new THREE.BufferGeometry();
      s.setAttribute('position', new THREE.Float32BufferAttribute([0, 2.2, -0.9, 0, 13.4, -0.95, 0, 2.3, 3.0, 0, 2.2, -0.9, 0, 2.3, 3.0, 0, 13.4, -0.95,
        0, 2.0, -1.2, 0, 12.0, -1.15, 0, 1.4, -4.5, 0, 2.0, -1.2, 0, 1.4, -4.5, 0, 12.0, -1.15], 3));
      s.computeVertexNormals();
      p.push({ geo: s, color: 0xfbfbf6 });
    }
  } else if (type === 'cruiser') {
    p.push({ geo: hull(11.5, 3.8, 1.7, { hull: 0xfafafa, deck: 0xf2f0ea, stripe: o.stripe ?? 0x1d4f73 }) });
    p.push({ geo: box(3.0, 1.4, 5.0), color: 0xf7f7f5, m: M(0, 1.8, 0.8) });
    p.push({ geo: box(3.05, 0.5, 4.2), color: 0x1d2a33, m: M(0, 2.0, 0.6) });
    p.push({ geo: box(2.6, 0.9, 2.8), color: 0xf2f2f0, m: M(0, 2.95, 1.2) });
    p.push({ geo: box(2.7, 0.08, 3.2), color: 0x2b2f33, m: M(0, 3.45, 1.2) });
  } else if (type === 'runabout') {
    p.push({ geo: hull(6.2, 2.4, 1.1, { hull: o.hull ?? 0xffffff, deck: 0xf4f1e8, stripe: o.stripe ?? 0xc0262d }) });
    p.push({ geo: box(2.0, 0.5, 0.08), color: 0x334455, m: M(0, 1.1, -0.4, -0.5) });
    p.push({ geo: box(0.6, 0.45, 0.6), color: 0xe8e2d0, m: M(0.5, 0.8, 0.5) });
    p.push({ geo: box(0.6, 0.45, 0.6), color: 0xe8e2d0, m: M(-0.5, 0.8, 0.5) });
    p.push({ geo: box(0.5, 0.9, 0.5), color: 0x222222, m: M(0, 0.6, 3.2) });
  } else if (type === 'tinny') {
    p.push({ geo: hull(4.2, 1.8, 0.75, { hull: 0xa9aeb2, deck: 0x9aa0a4, stripe: null, fine: 0.9 }) });
    p.push({ geo: box(1.4, 0.08, 0.35), color: 0x8a9095, m: M(0, 0.45, 0.4) });
    p.push({ geo: box(0.35, 0.8, 0.45), color: 0x1d1d1d, m: M(0, 0.55, 2.15) });
  } else if (type === 'ferry') {
    // Perth Water ferry: catamaran with an enclosed cabin
    for (const sx of [-2.6, 2.6]) p.push({ geo: hull(21, 1.9, 1.6, { hull: 0xf5f5f5, deck: 0xf5f5f5, stripe: 0x0f7a4f, fine: 1.2 }), m: M(sx, 0, 0) });
    p.push({ geo: box(7.2, 0.5, 20), color: 0xf2f2ee, m: M(0, 1.15, 0.2) });
    p.push({ geo: box(6.6, 2.2, 14), color: 0xf8f8f6, m: M(0, 2.5, 0.8) });
    p.push({ geo: box(6.7, 0.9, 13.4), color: 0x1f2d38, m: M(0, 2.8, 0.8) });
    p.push({ geo: box(3.2, 1.3, 3.2), color: 0xf6f6f4, m: M(0, 4.2, -2.6) });
    p.push({ geo: box(3.25, 0.5, 3.0), color: 0x1f2d38, m: M(0, 4.35, -2.6) });
    p.push({ geo: box(6.8, 0.25, 14.2), color: 0x0f7a4f, m: M(0, 3.65, 0.8) });
  } else if (type === 'fastcat') {
    // Rottnest fast ferry (high speed catamaran)
    for (const sx of [-3.8, 3.8]) p.push({ geo: hull(38, 2.6, 2.6, { hull: 0xf7f7f7, deck: 0xf7f7f7, stripe: 0xd62828, fine: 1.3 }), m: M(sx, 0, 0) });
    p.push({ geo: box(10.4, 1.0, 34), color: 0xf2f2f2, m: M(0, 2.2, 1) });
    p.push({ geo: box(9.6, 3.0, 26), color: 0xf8f8f8, m: M(0, 4.0, 2) });
    p.push({ geo: box(9.7, 1.1, 25), color: 0x18222c, m: M(0, 4.4, 2) });
    p.push({ geo: box(7.5, 2.0, 12), color: 0xf8f8f8, m: M(0, 6.4, -1) });
    p.push({ geo: box(7.6, 0.8, 11.5), color: 0x18222c, m: M(0, 6.6, -1) });
    p.push({ geo: box(9.8, 0.4, 26), color: 0xd62828, m: M(0, 5.6, 2) });
  } else if (type === 'ship') {
    // container ship alongside North Quay
    p.push({ geo: hull(225, 32, 18, { hull: 0x1d2f4a, deck: 0x7a2a22, stripe: 0x8a1c1c, fine: 1.4, sheer: 0.3 }), m: M(0, -6, 0) });
    p.push({ geo: box(28, 22, 14), color: 0xf2f2f2, m: M(0, 16, 88) });
    p.push({ geo: box(28.5, 2.5, 12), color: 0x1d2730, m: M(0, 24, 86) });
    p.push({ geo: box(4, 8, 4), color: 0xc8102e, m: M(0, 31, 92) });
    const cc = [0xb7312c, 0x1f5fa6, 0x2e8b57, 0xe0a100, 0x7c7c7c, 0xd2691e, 0x6a1b9a, 0xf0f0f0];
    let k = 0;
    for (let z = -92; z < 70; z += 13.5) for (let x = -12; x <= 12; x += 2.6) {
      const hgt = 2.6 * (2 + ((k * 7) % 5));
      p.push({ geo: box(2.45, hgt, 12.6), color: cc[(k * 13 + Math.floor(x)) % cc.length], m: M(x, 4 + hgt / 2, z) });
      k++;
    }
  } else if (type === 'tug') {
    p.push({ geo: hull(28, 10, 4.5, { hull: 0x1b1b1b, deck: 0xc0392b, stripe: 0xffffff, fine: 0.7 }) });
    p.push({ geo: box(7, 4, 9), color: 0xf2f2f2, m: M(0, 4.5, -2) });
    p.push({ geo: box(7.1, 1.2, 8.5), color: 0x1b2630, m: M(0, 5.6, -2) });
    p.push({ geo: box(1.6, 3.5, 1.6), color: 0xc0392b, m: M(0, 8, 0) });
  } else if (type === 'kayak') {
    p.push({ geo: hull(4.2, 0.62, 0.35, { hull: o.hull ?? 0xffcc00, deck: o.hull ?? 0xffcc00, fine: 1.0 }) });
    p.push({ geo: box(0.36, 0.5, 0.26), color: 0xff4400, m: M(0, 0.45, 0.2) });
    p.push({ geo: ico(0.11, 0), color: 0xe0ac7e, m: M(0, 0.8, 0.2) });
    p.push({ geo: cyl(0.02, 0.02, 2.2, 4), color: 0x222222, m: M(0, 0.55, 0.0, 0, 0, Math.PI / 2 - 0.25) });
  }
  return merge(p);
}

// ------------------------------------------------------------------ Water Police
let policeTex = null;
function policeDecal() {
  if (policeTex) return policeTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const x = c.getContext('2d');
  // Sillitoe-style blue and white chequer band with POLICE lettering
  for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) {
    x.fillStyle = (i + j) % 2 ? '#ffffff' : '#0b2e8a'; x.fillRect(i * 16, j * 16, 16, 16);
  }
  x.fillStyle = '#ffffff'; x.fillRect(150, 4, 212, 56);
  x.fillStyle = '#0b2e8a'; x.font = 'bold 50px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('POLICE', 256, 34);
  policeTex = new THREE.CanvasTexture(c);
  policeTex.colorSpace = THREE.SRGBColorSpace;
  return policeTex;
}

// kind: 'patrol' (17.7 m Cygnet V class), 'jetboat' (7.6 m), 'rib' (8.5 m)
export function policeBoat(kind) {
  const g = new THREE.Group();
  let L, B, D;
  const p = [];
  if (kind === 'patrol') {
    L = 17.7; B = 5.2; D = 2.4;
    p.push({ geo: hull(L, B, D, { hull: 0xf4f6f8, deck: 0xe9ecef, stripe: 0x0b2e8a }) });
    p.push({ geo: box(4.2, 2.4, 7.5), color: 0xf6f7f8, m: M(0, 2.6, -0.5) });
    p.push({ geo: box(4.25, 0.9, 7.0), color: 0x16222e, m: M(0, 3.1, -0.8) });
    p.push({ geo: box(3.4, 1.0, 3.4), color: 0xf6f7f8, m: M(0, 4.3, -0.2) });
    p.push({ geo: cyl(0.08, 0.08, 3.2, 6), color: 0xcccccc, m: M(0, 6.2, 0.4) });
  } else if (kind === 'jetboat') {
    L = 7.6; B = 2.6; D = 1.3;
    p.push({ geo: hull(L, B, D, { hull: 0x2b2f35, deck: 0xf2f4f6, stripe: 0x0b2e8a }) });
    p.push({ geo: box(2.1, 1.5, 2.2), color: 0xf2f4f6, m: M(0, 1.4, 0.2) });
    p.push({ geo: box(2.15, 0.6, 2.0), color: 0x16222e, m: M(0, 1.7, 0.0) });
  } else {
    L = 8.5; B = 2.9; D = 1.2;
    p.push({ geo: hull(L, B, D, { hull: 0x30343a, deck: 0x2a2d31, stripe: 0x0b2e8a }) });
    p.push({ geo: box(1.2, 1.2, 1.0), color: 0xf2f4f6, m: M(0, 1.2, 0.2) });
    p.push({ geo: box(2.2, 0.5, 0.7), color: 0x111111, m: M(0, 0.9, 1.6) });
    p.push({ geo: box(0.7, 1.0, 0.8), color: 0x111111, m: M(0, 0.6, L * 0.47) });
  }
  const mesh = new THREE.Mesh(merge(p), new THREE.MeshLambertMaterial({ vertexColors: true }));
  g.add(mesh);
  // side decals
  const decalMat = new THREE.MeshBasicMaterial({ map: policeDecal(), transparent: false, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.62, D * 0.32), decalMat);
    pl.position.set(s * B * 0.505, D * 0.33, L * 0.06);
    pl.rotation.y = s * Math.PI / 2;
    g.add(pl);
  }
  // light bar
  const lbY = kind === 'patrol' ? 4.95 : kind === 'jetboat' ? 2.25 : 1.9;
  const red = new THREE.MeshBasicMaterial({ color: 0x550000 }), blue = new THREE.MeshBasicMaterial({ color: 0x000055 });
  const lr = new THREE.Mesh(box(0.6, 0.22, 0.28), red), lb = new THREE.Mesh(box(0.6, 0.22, 0.28), blue);
  lr.position.set(-0.32, lbY, kind === 'patrol' ? -0.2 : 0.2); lb.position.set(0.32, lbY, kind === 'patrol' ? -0.2 : 0.2);
  g.add(lr); g.add(lb);
  g.userData = { L, B, red, blue, kind };
  return g;
}

// ------------------------------------------------------------------ people, cars, trees
export const personParts = {
  torso: box(0.42, 0.58, 0.24).translate(0, 1.2, 0),
  head: ico(0.12, 1).translate(0, 1.62, 0),
  hips: box(0.4, 0.22, 0.24).translate(0, 0.86, 0),
  legL: box(0.15, 0.82, 0.16).translate(0, -0.41, 0),   // pivot at hip
  legR: box(0.15, 0.82, 0.16).translate(0, -0.41, 0),
  armL: box(0.11, 0.62, 0.11).translate(0, -0.29, 0),   // pivot at shoulder
  armR: box(0.11, 0.62, 0.11).translate(0, -0.29, 0),
};

export function carGeos() {
  const body = merge([
    { geo: box(1.8, 0.62, 4.4), m: M(0, 0.62, 0) },
    { geo: box(1.7, 0.18, 0.9), m: M(0, 0.98, -1.6) },
  ]);
  const dark = merge([
    { geo: box(1.62, 0.55, 2.3), color: 0x1d2730, m: M(0, 1.2, 0.25) },
    { geo: cyl(0.33, 0.33, 0.22, 10), color: 0x111111, m: M(0.86, 0.33, 1.35, 0, 0, Math.PI / 2) },
    { geo: cyl(0.33, 0.33, 0.22, 10), color: 0x111111, m: M(-0.86, 0.33, 1.35, 0, 0, Math.PI / 2) },
    { geo: cyl(0.33, 0.33, 0.22, 10), color: 0x111111, m: M(0.86, 0.33, -1.35, 0, 0, Math.PI / 2) },
    { geo: cyl(0.33, 0.33, 0.22, 10), color: 0x111111, m: M(-0.86, 0.33, -1.35, 0, 0, Math.PI / 2) },
    { geo: box(1.5, 0.12, 0.05), color: 0xffffcc, m: M(0, 0.75, -2.21) },
    { geo: box(1.5, 0.12, 0.05), color: 0xaa1111, m: M(0, 0.78, 2.21) },
  ]);
  return { body, dark };
}

export function treeGeos() {
  const gum = merge([
    { geo: cyl(0.16, 0.3, 5.5, 6), color: 0xbdb2a0, m: M(0, 2.75, 0) },
    { geo: cyl(0.08, 0.12, 2.4, 5), color: 0xbdb2a0, m: M(0.6, 5.4, 0, 0, 0, -0.6) },
    { geo: ico(1.9, 0), color: 0x5d6b3c, m: M(0.4, 6.8, 0.3, 0, 0, 0, 1.2, 0.7, 1.1) },
    { geo: ico(1.6, 0), color: 0x6b7a44, m: M(-0.9, 6.0, -0.4, 0, 0, 0, 1.1, 0.7, 1.0) },
    { geo: ico(1.4, 0), color: 0x55633a, m: M(1.4, 5.6, -0.8, 0, 0, 0, 1, 0.7, 1) },
  ]);
  const pineParts = [{ geo: cyl(0.18, 0.35, 16, 6), color: 0x6b5a48, m: M(0, 8, 0) }];
  for (let i = 0; i < 6; i++) pineParts.push({ geo: cyl(0.2, 2.6 - i * 0.3, 0.9, 7), color: i % 2 ? 0x2f5130 : 0x284a2a, m: M(0, 4.5 + i * 2.1, 0) });
  const pine = merge(pineParts);
  const palmParts = [{ geo: cyl(0.22, 0.3, 9, 6), color: 0x8c7a5c, m: M(0, 4.5, 0) }];
  for (let i = 0; i < 7; i++) palmParts.push({ geo: box(0.5, 0.06, 3.2), color: 0x4f7a2a, m: M(Math.sin(i * 0.9) * 1.3, 8.8, Math.cos(i * 0.9) * 1.3, 0.45, i * 0.9, 0) });
  const palm = merge(palmParts);
  return { gum, pine, palm };
}

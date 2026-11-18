// Procedural models with physically based materials. Bow points to -z, +x is starboard, +y is up.
import * as THREE from '../vendor/three.module.min.js';

export const col = (hex) => new THREE.Color(hex);
export const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// ------------------------------------------------------------------ materials (shared)
const matCache = new Map();
export function mat(kind, color = 0xffffff, extra = {}) {
  const key = kind + ':' + color + ':' + JSON.stringify(extra);
  if (matCache.has(key)) return matCache.get(key);
  let m;
  const c = new THREE.Color(color);
  switch (kind) {
    case 'gel': m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, ...extra }); break;
    case 'paint': m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.1, ...extra }); break;
    case 'plastic': m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0, ...extra }); break;
    case 'rubber': m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0, ...extra }); break;
    case 'fabric': m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0, ...extra }); break;
    case 'skin': m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0, ...extra }); break;
    case 'metal': m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.9, ...extra }); break;
    case 'alu': m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.8, ...extra }); break;
    case 'glass': m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.05, metalness: 0.3, ...extra }); break;
    case 'glow': m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1, roughness: 0.4, ...extra }); break;
    case 'vc': m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, ...extra }); break;
    default: m = new THREE.MeshStandardMaterial({ color: c, ...extra });
  }
  matCache.set(key, m);
  return m;
}

// ------------------------------------------------------------------ geometry helpers
// loft through cross-sections: sections = [[[x,y,z], ...], ...] all with the same point count
export function loft(sections, o = {}) {
  const pos = [], idx = [], uv = [];
  const n = sections[0].length;
  sections.forEach((s, i) => s.forEach((p, k) => { pos.push(p[0], p[1], p[2]); uv.push(k / (n - 1), i / (sections.length - 1)); }));
  const ring = o.closed ? n : n - 1;
  for (let i = 0; i < sections.length - 1; i++) for (let k = 0; k < ring; k++) {
    const a = i * n + k, b = i * n + (k + 1) % n, c = (i + 1) * n + k, d = (i + 1) * n + (k + 1) % n;
    if (o.flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const cap = (s, base, flip) => {
    let cx = 0, cy = 0, cz = 0; s.forEach(p => { cx += p[0]; cy += p[1]; cz += p[2]; });
    const ci = pos.length / 3; pos.push(cx / n, cy / n, cz / n); uv.push(0.5, 0.5);
    for (let k = 0; k < n; k++) { const a = base + k, b = base + (k + 1) % n; if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
  };
  if (o.capStart) cap(sections[0], 0, !o.flip);
  if (o.capEnd) cap(sections[sections.length - 1], (sections.length - 1) * n, !!o.flip);
  if (o.ref) { // orient every face away from an interior reference point
    for (let t = 0; t < idx.length; t += 3) {
      const A = idx[t] * 3, Bi = idx[t + 1] * 3, C = idx[t + 2] * 3;
      const ux = pos[Bi] - pos[A], uy = pos[Bi + 1] - pos[A + 1], uz = pos[Bi + 2] - pos[A + 2];
      const vx = pos[C] - pos[A], vy = pos[C + 1] - pos[A + 1], vz = pos[C + 2] - pos[A + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const cx = (pos[A] + pos[Bi] + pos[C]) / 3, cy = (pos[A + 1] + pos[Bi + 1] + pos[C + 1]) / 3, cz = (pos[A + 2] + pos[Bi + 2] + pos[C + 2]) / 3;
      const r = o.ref(cx, cy, cz);
      if (nx * (cx - r[0]) + ny * (cy - r[1]) + nz * (cz - r[2]) < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// merge geometries (any mix of indexed / non-indexed) with per-part colours into one vertex-coloured geometry
export function merge(parts) {
  const pos = [], nor = [], colr = [];
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.m) g.applyMatrix4(p.m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pa = g.attributes.position.array, na = g.attributes.normal.array;
    const ca = g.attributes.color ? g.attributes.color.array : null;
    const c = new THREE.Color(p.color ?? 0xffffff);
    for (let i = 0; i < pa.length; i++) { pos.push(pa[i]); nor.push(na[i]); }
    for (let i = 0; i < pa.length / 3; i++) { if (ca) colr.push(ca[i * 3], ca[i * 3 + 1], ca[i * 3 + 2]); else colr.push(c.r, c.g, c.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.computeBoundingSphere();
  return g;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function rbox(w, h, d, r = 0.05, s = 3) { // rounded box via a scaled sphere-ish capsule trick
  const g = new THREE.BoxGeometry(w, h, d, s, s, s);
  const p = g.attributes.position, v = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const cx = Math.max(-hx, Math.min(hx, v.x)), cy = Math.max(-hy, Math.min(hy, v.y)), cz = Math.max(-hz, Math.min(hz, v.z));
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz, l = Math.hypot(dx, dy, dz) || 1;
    p.setXYZ(i, cx + dx / l * r, cy + dy / l * r, cz + dz / l * r);
  }
  g.computeVertexNormals();
  return g;
}
export { rbox };

// ------------------------------------------------------------------ planing hull
// Generic deep-V planing hull, open on top (rail at railY). Returns the geometry and a rail(t) helper.
export function hullShell(L, B, o = {}) {
  const N = o.stations ?? 24;
  const keel0 = o.keel ?? -0.28, rail0 = o.rail ?? 0.3, sheer = o.sheer ?? 0.18, rocker = o.rocker ?? 0.42, dead = o.deadrise ?? 0.22;
  const hw = (t) => B / 2 * (t < 0.42 ? Math.pow(Math.sin(t / 0.42 * Math.PI / 2), o.fine ?? 0.62) : 1 - (t - 0.42) * (o.taper ?? 0.12));
  const keel = (t) => keel0 + rocker * Math.pow(Math.max(0, 1 - t / 0.38), 2);
  const rail = (t) => rail0 + sheer * Math.pow(Math.max(0, 1 - t / 0.5), 2);
  const secs = [];
  for (let s = 0; s <= N; s++) {
    const t = s / N, z = -L / 2 + t * L, w = Math.max(0.002, hw(t)), k = keel(t), r = rail(t);
    const chine = k + w * dead + 0.02;
    const half = [[0, k], [w * 0.4, k + w * 0.4 * dead], [w * 0.9, chine - 0.01], [w * 1.0, chine + 0.025], [w * 1.04, (chine + r) * 0.5], [w * 1.0, r]];
    const sec = [];
    for (let i = half.length - 1; i >= 1; i--) sec.push([-half[i][0], half[i][1], z]);
    for (let i = 0; i < half.length; i++) sec.push([half[i][0], half[i][1], z]);
    secs.push(sec);
  }
  const g = loft(secs, { ref: (x, y, z) => { const t = Math.max(0, Math.min(1, (z + L / 2) / L)); return [0, (keel(t) + rail(t)) / 2, z]; } });
  // transom
  const last = secs[secs.length - 1];
  const tr = loft([last, last.map(p => [0, (p[1] + rail(1)) * 0.5, p[2]])], { ref: (x, y, z) => [0, y, z - 1] });
  return { geo: g, transom: tr, hw, keel, rail, secs };
}

// ------------------------------------------------------------------ jet skis (published specs, approximate top speeds)
export const SKIS = [
  { id: 'rxpx', name: 'Sea-Doo RXP-X 325', hp: 325, topKn: 58, len: 3.27, beam: 1.27, mass: 361, accel: 1.0, turn: 1.15, tail: 1.0,
    hull: 0x1b1e22, deck: 0x0fb5a0, accent: 0xf2f2f2, seat: 0x15171a, blurb: 'Supercharged Rotax 1630 ACE. Race hull, carves like it is on rails.' },
  { id: 'gp', name: 'Yamaha GP SVHO', hp: 250, topKn: 57, len: 3.35, beam: 1.24, mass: 355, accel: 1.08, turn: 1.0, tail: 1.05,
    hull: 0xeef1f4, deck: 0x1f57c4, accent: 0x0b1f4a, seat: 0x16181b, blurb: 'Supercharged 1.9 L. Brutal off the line.' },
  { id: 'ultra', name: 'Kawasaki Ultra 310R', hp: 310, topKn: 59, len: 3.66, beam: 1.21, mass: 435, accel: 0.95, turn: 0.88, tail: 1.2,
    hull: 0x17191b, deck: 0x6cc419, accent: 0xffffff, seat: 0x101113, blurb: 'Longest hull, highest top end, biggest wall of water.' },
  { id: 'spark', name: 'Sea-Doo Spark Trixx', hp: 90, topKn: 43, len: 2.79, beam: 1.18, mass: 200, accel: 0.85, turn: 1.4, tail: 0.75,
    hull: 0xf4f4ef, deck: 0xff7a1a, accent: 0x222222, seat: 0x1b1b1b, blurb: 'Light and flicky. Spins, hops and slides all day.' },
];

export function jetSkiModel(spec) {
  const L = spec.len, B = spec.beam;
  const g = new THREE.Group();
  const hull = hullShell(L, B, { keel: -0.27, rail: 0.27, sheer: 0.2, rocker: 0.4, deadrise: 0.4, fine: 0.58 });
  // two-tone: hull colour below, accent stripe band along the topsides
  const hullMesh = new THREE.Mesh(hull.geo, mat('gel', spec.hull));
  g.add(hullMesh);
  g.add(new THREE.Mesh(hull.transom, mat('gel', spec.hull)));
  // ---- top deck: hood dome at the front, footwells either side of the seat, swim platform at the back
  const N = 28, secs = [];
  const hoodTop = (t) => 0.27 + 0.58 * Math.sin(Math.min(1, t / 0.34) * Math.PI / 2) * (1 - smooth(0.36, 0.5, t) * 0.55);
  const foot = 0.36;
  for (let s = 0; s <= N; s++) {
    const t = s / N, z = -L / 2 + t * L;
    const w = Math.max(0.002, hull.hw(t)), r = hull.rail(t);
    const seatMask = smooth(0.4, 0.52, t) * (1 - smooth(0.88, 0.96, t));
    const top = hoodTop(t) * (1 - seatMask) + foot * seatMask;
    const lip = r + 0.07;
    // half profile from rail inwards
    const dome = [[w, r], [w * 0.97, lip], [w * 0.8, r + (top - r) * 0.55], [w * 0.55, r + (top - r) * 0.85], [w * 0.28, top - 0.01], [0, top]];
    const well = [[w, r], [w * 0.97, lip], [w * 0.86, foot], [w * 0.5, foot], [w * 0.25, foot], [0, foot]];
    const stern = 1 - smooth(0.9, 1.0, t) * 0.0;
    const half = dome.map((p, i) => [p[0] * (1 - seatMask) + well[i][0] * seatMask, (p[1] * (1 - seatMask) + well[i][1] * seatMask) * stern]);
    const sec = [];
    for (let i = 0; i < half.length; i++) sec.push([half[i][0], half[i][1], z]);
    for (let i = half.length - 2; i >= 0; i--) sec.push([-half[i][0], half[i][1], z]);
    secs.push(sec);
  }
  const deck = loft(secs, { ref: (x, y, z) => [0, y - 1, z] });
  g.add(new THREE.Mesh(deck, mat('gel', spec.deck)));
  // accent stripe: thin band just under the rail along the middle of the ski
  const stripe = [];
  for (let s = 6; s <= 22; s++) {
    const t = s / N, z = -L / 2 + t * L, w = hull.hw(t) * 1.045, r = hull.rail(t);
    const lo = r - 0.06 - 0.05 * Math.sin((t - 0.2) * 3);
    stripe.push([[w, r - 0.015, z], [w, lo, z]]);
  }
  for (const side of [1, -1]) {
    const sg = loft(stripe.map(sec => sec.map(p => [p[0] * side, p[1], p[2]])), { ref: (x, y, z) => [0, y, z] });
    g.add(new THREE.Mesh(sg, mat('gel', spec.accent)));
  }
  // footwell mats
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(box(0.2, 0.02, L * 0.36), mat('rubber', 0x2b2e33));
    m.position.set(side * B * 0.34, foot + 0.012, L * 0.18); g.add(m);
  }
  // seat: rounded, two-tone, with a step-up for the passenger
  const seatSecs = [];
  for (let s = 0; s <= 14; s++) {
    const t = 0.44 + s / 14 * 0.44, z = -L / 2 + t * L;
    const w = 0.2 + 0.05 * Math.sin((t - 0.44) / 0.44 * Math.PI);
    const top = 0.76 + 0.03 * Math.sin((t - 0.44) / 0.44 * Math.PI * 2) - (t - 0.44) * 0.05;
    const prof = [];
    for (let a = 0; a <= 10; a++) {
      const th = a / 10 * Math.PI;
      prof.push([Math.cos(th) * w, foot + (top - foot) * (0.55 + 0.45 * Math.pow(Math.sin(th), 0.4)), z]);
    }
    prof.push([-w, foot, z], [w, foot, z]);
    seatSecs.push(prof);
  }
  g.add(new THREE.Mesh(loft(seatSecs, { closed: true, capStart: true, capEnd: true, ref: (x, y, z) => [0, foot + 0.15, z] }), mat('fabric', spec.seat)));
  // handlebar pod, bars, grips, mirrors, display
  const podZ = -L / 2 + 0.43 * L;
  const pod = new THREE.Mesh(rbox(0.36, 0.34, 0.42, 0.06), mat('gel', spec.deck));
  pod.position.set(0, 0.86, podZ); pod.rotation.x = -0.35; g.add(pod);
  const steer = new THREE.Group(); steer.position.set(0, 1.0, podZ + 0.08); g.add(steer);
  const bar = new THREE.Mesh(cyl(0.017, 0.017, 0.74, 8), mat('metal', 0x1a1a1a)); bar.rotation.z = Math.PI / 2; steer.add(bar);
  for (const sx of [-0.33, 0.33]) {
    const grip = new THREE.Mesh(cyl(0.026, 0.026, 0.13, 10), mat('rubber', 0x111111)); grip.rotation.z = Math.PI / 2; grip.position.x = sx; steer.add(grip);
    const stalk = new THREE.Mesh(cyl(0.01, 0.01, 0.18, 5), mat('plastic', 0x111111)); stalk.position.set(sx * 0.85, 0.08, -0.1); stalk.rotation.x = -0.6; steer.add(stalk);
    const mirror = new THREE.Mesh(rbox(0.13, 0.07, 0.03, 0.012), mat('plastic', 0x111111)); mirror.position.set(sx * 0.95, 0.15, -0.18); steer.add(mirror);
  }
  const dash = new THREE.Mesh(box(0.2, 0.09, 0.01), mat('glow', 0x0a3a44, { emissiveIntensity: 0.6 }));
  dash.position.set(0, 0.95, podZ + 0.15); dash.rotation.x = -0.9; g.add(dash);
  // jet pump, steering nozzle and the iBR reverse gate
  const pump = new THREE.Mesh(cyl(0.11, 0.12, 0.3, 14), mat('metal', 0x3a3d42)); pump.rotation.x = Math.PI / 2; pump.position.set(0, -0.12, L / 2 - 0.02); g.add(pump);
  const nozzle = new THREE.Group(); nozzle.position.set(0, -0.12, L / 2 + 0.12); g.add(nozzle);
  const nz = new THREE.Mesh(cyl(0.07, 0.095, 0.2, 14, 1, true), mat('metal', 0x55595e)); nz.rotation.x = Math.PI / 2; nz.position.z = 0.08; nozzle.add(nz);
  const gate = new THREE.Group(); gate.position.set(0, 0.12, 0.05); nozzle.add(gate);
  const gm = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('plastic', 0x16181a)); gm.rotation.x = Math.PI / 2; gm.position.z = 0.12; gm.scale.set(1, 1, 0.8); gate.add(gm);
  gate.rotation.x = -1.2;
  // ride plate, sponsons, grab handle
  const plate = new THREE.Mesh(box(0.36, 0.02, 0.5), mat('metal', 0x2c2f33)); plate.position.set(0, -0.25, L / 2 - 0.25); g.add(plate);
  for (const side of [1, -1]) {
    const sp = new THREE.Mesh(rbox(0.06, 0.12, 0.5, 0.02), mat('plastic', 0x1c1e21)); sp.position.set(side * hull.hw(0.8) * 1.02, -0.06, L * 0.3); g.add(sp);
  }
  const grab = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 6, 16, Math.PI), mat('plastic', 0x111111));
  grab.position.set(0, foot + 0.02, L / 2 - 0.2); grab.rotation.x = -Math.PI / 2; g.add(grab);
  const bumper = new THREE.Mesh(rbox(0.12, 0.05, 0.18, 0.02), mat('rubber', 0x111111)); bumper.position.set(0, hull.rail(0) + 0.02, -L / 2 + 0.06); g.add(bumper);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { steer, nozzle, gate, seatY: 0.76, footY: foot, podZ, L, B };
  return g;
}

// ------------------------------------------------------------------ rider with simple two-bone IK
export class Rider {
  constructor(o = {}) {
    this.g = new THREE.Group();
    const skin = mat('skin', o.skin ?? 0xd9a27a), pfd = mat('fabric', o.pfd ?? 0xff5a0a), shorts = mat('fabric', o.shorts ?? 0x1d3557);
    const dark = mat('fabric', 0x15171a), shirt = mat('fabric', o.shirt ?? 0x223344);
    const cap = (r, l, m) => { const x = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10), m); x.castShadow = true; this.g.add(x); return x; };
    this.pelvis = cap(0.14, 0.12, shorts); this.pelvis.rotation.z = Math.PI / 2;
    this.torso = new THREE.Group(); this.g.add(this.torso);
    const vest = new THREE.Mesh(rbox(0.42, 0.5, 0.28, 0.1), pfd); vest.position.y = 0.27; vest.castShadow = true; this.torso.add(vest);
    for (const yy of [0.12, 0.28, 0.42]) { const strap = new THREE.Mesh(box(0.43, 0.035, 0.29), dark); strap.position.y = yy; this.torso.add(strap); }
    const neck = new THREE.Mesh(cyl(0.05, 0.055, 0.1, 8), skin); neck.position.y = 0.56; this.torso.add(neck);
    this.head = new THREE.Group(); this.head.position.y = 0.68; this.torso.add(this.head);
    const hd = new THREE.Mesh(sph(0.105), skin); hd.scale.set(0.95, 1.1, 1); hd.castShadow = true; this.head.add(hd);
    const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.112, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('fabric', o.cap ?? 0x111111)); capTop.position.y = 0.02; this.head.add(capTop);
    const brim = new THREE.Mesh(box(0.16, 0.012, 0.1), mat('fabric', o.cap ?? 0x111111)); brim.position.set(0, 0.03, 0.12); this.head.add(brim); // worn backwards
    const sunnies = new THREE.Mesh(box(0.19, 0.04, 0.03), mat('glass', 0x101820)); sunnies.position.set(0, 0.0, -0.1); this.head.add(sunnies);
    this.armU = [cap(0.048, 0.2, shirt), cap(0.048, 0.2, shirt)];
    this.armF = [cap(0.042, 0.2, skin), cap(0.042, 0.2, skin)];
    this.hands = [new THREE.Mesh(sph(0.045, 8, 6), skin), new THREE.Mesh(sph(0.045, 8, 6), skin)]; this.hands.forEach(h => this.g.add(h));
    this.legU = [cap(0.075, 0.3, shorts), cap(0.075, 0.3, shorts)];
    this.legL = [cap(0.06, 0.32, skin), cap(0.06, 0.32, skin)];
    this.feet = [new THREE.Mesh(rbox(0.1, 0.07, 0.26, 0.03), mat('rubber', 0x222222)), new THREE.Mesh(rbox(0.1, 0.07, 0.26, 0.03), mat('rubber', 0x222222))];
    this.feet.forEach(f => this.g.add(f));
    this.tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion() };
  }
  seg(mesh, A, B, r) {
    const d = this.tmp.d.subVectors(B, A); const l = d.length();
    mesh.position.addVectors(A, B).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(this.tmp.up, d.normalize());
    mesh.scale.set(1, Math.max(0.2, (l) / (mesh.geometry.parameters.length + 2 * r) * 1.0), 1);
  }
  ik(A, T, la, lb, pole, outElbow) {
    const d = new THREE.Vector3().subVectors(T, A); let dist = d.length();
    dist = Math.min(dist, la + lb - 0.001);
    d.normalize();
    const ca = (la * la + dist * dist - lb * lb) / (2 * la * dist);
    const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
    const p = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d))).normalize();
    outElbow.copy(A).addScaledVector(d, la * ca).addScaledVector(p, la * sa);
    return outElbow;
  }
  // pose in the ski's local frame. lean: -1..1 (into turn), crouch 0..1, fwd -1..1, grips & feet in local coords
  pose(o) {
    const { seatY, seatZ, gripL, gripR, footL, footR, lean = 0, crouch = 0, fwd = 0, stand = 0 } = o;
    const hipY = seatY + 0.12 + stand * 0.38 - crouch * 0.08;
    const hip = new THREE.Vector3(lean * 0.12, hipY, seatZ - fwd * 0.08);
    this.pelvis.position.copy(hip);
    this.torso.position.copy(hip);
    this.torso.rotation.set(-0.35 - fwd * 0.3 - crouch * 0.25 + stand * 0.15, 0, -lean * 0.4);
    this.head.rotation.set(0.25 + fwd * 0.2, 0, lean * 0.25);
    this.torso.updateMatrix();
    const sh = [new THREE.Vector3(-0.21, 0.47, 0), new THREE.Vector3(0.21, 0.47, 0)].map(v => v.applyMatrix4(this.torso.matrix));
    const grips = [gripL, gripR], feet = [footL, footR];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const elbow = this.ik(sh[i], grips[i], 0.29, 0.28, new THREE.Vector3(side * 0.6, -0.5, 0.3), new THREE.Vector3());
      this.seg(this.armU[i], sh[i], elbow, 0.048); this.seg(this.armF[i], elbow, grips[i], 0.042);
      this.hands[i].position.copy(grips[i]);
      const hj = new THREE.Vector3(hip.x + side * 0.11, hip.y - 0.04, hip.z);
      const knee = this.ik(hj, feet[i], 0.44, 0.44, new THREE.Vector3(side * 0.35, 0.3, -1), new THREE.Vector3());
      this.seg(this.legU[i], hj, knee, 0.075); this.seg(this.legL[i], knee, feet[i], 0.06);
      this.feet[i].position.set(feet[i].x, feet[i].y + 0.03, feet[i].z - 0.06);
    }
  }
}

// ------------------------------------------------------------------ civilian boats
function outboard(scale = 1, color = 0x1a1a1a) {
  return merge([
    { geo: rbox(0.42 * scale, 0.55 * scale, 0.62 * scale, 0.1 * scale), color, m: M(0, 0.55 * scale, 0) },
    { geo: box(0.12 * scale, 0.9 * scale, 0.22 * scale), color: 0x2a2a2a, m: M(0, -0.1 * scale, 0.05 * scale) },
    { geo: box(0.3 * scale, 0.04 * scale, 0.35 * scale), color: 0x2a2a2a, m: M(0, -0.45 * scale, 0.05 * scale) },
  ]);
}

export function boatModel(type, o = {}) {
  const g = new THREE.Group();
  const add = (geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
  const shell = (L, B, opts, hullCol, deckCol) => {
    const h = hullShell(L, B, opts);
    add(h.geo, mat('gel', hullCol)); add(h.transom, mat('gel', hullCol));
    // flat deck cap at the rail
    const secs = h.secs.map(s => { const r = s[0][1]; const z = s[0][2]; const w = Math.abs(s[0][0]); return [[w, r, z], [0, r + 0.04, z], [-w, r, z]]; });
    add(loft(secs, { ref: (x, y, z) => [0, y - 1, z] }), mat('paint', deckCol));
    return h;
  };
  let L = 6, B = 2.4;
  if (type === 'runabout') {
    L = 6.2; B = 2.4;
    const h = shell(L, B, { keel: -0.45, rail: 0.55, sheer: 0.25, deadrise: 0.4 }, o.hull ?? 0xffffff, 0xf2efe6);
    add(box(B * 0.92, 0.06, 0.08), mat('paint', o.stripe ?? 0xc0262d), 0, 0.35, 0);
    add(box(1.9, 0.45, 0.06), mat('glass', 0x2a3a48, { transparent: true, opacity: 0.6 }), 0, 0.85, -0.6, -0.5);
    add(rbox(0.7, 0.5, 0.7, 0.12), mat('fabric', 0xe9e4d4), 0.5, 0.75, 0.6); add(rbox(0.7, 0.5, 0.7, 0.12), mat('fabric', 0xe9e4d4), -0.5, 0.75, 0.6);
    add(rbox(B * 0.8, 0.4, 0.7, 0.12), mat('fabric', 0xe9e4d4), 0, 0.72, 2.0);
    add(outboard(1.1), mat('vc', 0, { roughness: 0.4 }), 0, 0.3, L / 2 + 0.25);
  } else if (type === 'cruiser') {
    L = 11.5; B = 3.8;
    shell(L, B, { keel: -0.7, rail: 0.9, sheer: 0.3, deadrise: 0.38 }, 0xfafafa, 0xece6d8);
    add(rbox(3.0, 1.3, 5.2, 0.25), mat('gel', 0xf8f8f6), 0, 1.6, 0.6);
    add(rbox(3.04, 0.45, 4.6, 0.15), mat('glass', 0x1a2530), 0, 1.75, 0.4);
    add(rbox(2.6, 0.8, 2.9, 0.2), mat('gel', 0xf4f4f2), 0, 2.6, 1.3);
    add(box(2.8, 0.06, 3.3), mat('fabric', 0x2b3036), 0, 3.6, 1.4);
    for (const sx of [-1.25, 1.25]) for (const sz of [0.2, 2.6]) add(cyl(0.02, 0.02, 0.6, 5), mat('metal', 0xdddddd), sx, 3.3, sz);
    add(box(B * 1.01, 0.12, L * 0.7), mat('paint', o.stripe ?? 0x1d4f73), 0, 0.55, 0);
  } else if (type === 'yacht') {
    L = 9.5; B = 3.1;
    shell(L, B, { keel: -0.6, rail: 0.75, sheer: 0.25, deadrise: 0.5, fine: 0.8 }, o.hull ?? 0xf6f6f2, 0xd9cdb4);
    add(rbox(1.9, 0.55, 3.0, 0.15), mat('gel', 0xf2f0ea), 0, 1.0, 0.4);
    add(box(1.92, 0.16, 2.2), mat('glass', 0x22313d), 0, 1.1, 0.3);
    add(cyl(0.06, 0.08, 13, 8), mat('alu', 0xd8d8d8), 0, 7.4, -1.0);
    add(cyl(0.045, 0.045, 4, 6), mat('alu', 0xd8d8d8), 0, 2.0, 1.0, Math.PI / 2);
    add(box(0.3, 1.6, 0.6), mat('metal', 0x333333), 0, -1.2, 0.3);
    if (o.sail) {
      const sail = (pts) => { const s = new THREE.BufferGeometry(); s.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); s.computeVertexNormals(); return s; };
      const mainPts = [], jibPts = [];
      for (let i = 0; i < 6; i++) { // slightly curved mainsail
        const y0 = 2.2 + i * 1.86, y1 = y0 + 1.86, c0 = 0.25 * Math.sin(i / 6 * Math.PI), c1 = 0.25 * Math.sin((i + 1) / 6 * Math.PI);
        const d0 = 3.9 * (1 - i / 6), d1 = 3.9 * (1 - (i + 1) / 6);
        mainPts.push(c0, y0, -1, c1, y1, -1, c0 * 1.5, y0, -1 + d0, c1, y1, -1, c1 * 1.5, y1, -1 + d1, c0 * 1.5, y0, -1 + d0);
      }
      jibPts.push(0, 1.4, -4.6, 0.3, 6.5, -2.9, 0, 12.4, -1.05);
      add(sail(mainPts), mat('fabric', 0xfafaf5, { side: THREE.DoubleSide }));
      add(sail(jibPts), mat('fabric', 0xfafaf5, { side: THREE.DoubleSide }));
    }
  } else if (type === 'tinny') {
    L = 4.2; B = 1.7;
    shell(L, B, { keel: -0.25, rail: 0.35, sheer: 0.08, deadrise: 0.15, fine: 0.9 }, 0xa8adb2, 0x9aa0a4);
    g.children.forEach(c => { c.material = mat('alu', 0xa9aeb2); });
    add(box(1.4, 0.06, 0.3), mat('alu', 0x8e9499), 0, 0.3, 0.3);
    add(outboard(0.7), mat('vc', 0, { roughness: 0.4 }), 0, 0.15, L / 2 + 0.15);
    const f = new THREE.Group(); f.position.set(0, 0.35, 1.2); g.add(f);
    f.add(new THREE.Mesh(rbox(0.36, 0.5, 0.24, 0.08), mat('fabric', 0x3a5a40))).position.y = 0.3;
    const hd = new THREE.Mesh(sph(0.1), mat('skin', 0xe0ac7e)); hd.position.y = 0.68; f.add(hd);
    const hat = new THREE.Mesh(cyl(0.16, 0.16, 0.02, 12), mat('fabric', 0xd9c79a)); hat.position.y = 0.76; f.add(hat);
  } else if (type === 'kayak') {
    L = 4.2; B = 0.65;
    shell(L, B, { keel: -0.12, rail: 0.18, sheer: 0.05, deadrise: 0.4, fine: 1.2, taper: 0.9 }, o.hull ?? 0xffcc00, o.hull ?? 0xffcc00);
    add(rbox(0.36, 0.42, 0.24, 0.08), mat('fabric', 0xff4400), 0, 0.42, 0.2);
    add(sph(0.1), mat('skin', 0xe0ac7e), 0, 0.75, 0.2);
    add(cyl(0.018, 0.018, 2.2, 5), mat('plastic', 0x222222), 0, 0.5, 0.0, 0, 0, Math.PI / 2 - 0.25);
  } else if (type === 'ferry') {
    L = 21; B = 7.2;
    for (const sx of [-2.6, 2.6]) { const h = hullShell(21, 1.9, { keel: -0.9, rail: 0.9, sheer: 0.3, fine: 1.2, deadrise: 0.5 }); const m = add(h.geo, mat('gel', 0xf5f5f5)); m.position.x = sx; }
    add(box(7.2, 0.5, 20), mat('paint', 0xf0f0ec), 0, 1.15, 0.2);
    add(rbox(6.6, 2.2, 14, 0.3), mat('gel', 0xf8f8f6), 0, 2.5, 0.8);
    add(rbox(6.7, 0.9, 13.4, 0.2), mat('glass', 0x1b2a35), 0, 2.8, 0.8);
    add(rbox(3.2, 1.3, 3.2, 0.2), mat('gel', 0xf6f6f4), 0, 4.2, -2.6);
    add(box(3.25, 0.5, 3.0), mat('glass', 0x1b2a35), 0, 4.35, -2.6);
    add(box(6.8, 0.25, 14.2), mat('paint', 0x0f7a4f), 0, 3.65, 0.8);
    add(box(7.25, 0.18, 20), mat('paint', 0x0f7a4f), 0, 0.85, 0.2);
  } else if (type === 'fastcat') {
    L = 38; B = 10.4;
    for (const sx of [-3.8, 3.8]) { const h = hullShell(38, 2.6, { keel: -1.4, rail: 1.4, sheer: 0.5, fine: 1.4, deadrise: 0.5 }); const m = add(h.geo, mat('gel', 0xf7f7f7)); m.position.x = sx; }
    add(box(10.4, 1.0, 34), mat('paint', 0xf2f2f2), 0, 2.2, 1);
    add(rbox(9.6, 3.0, 26, 0.5), mat('gel', 0xf8f8f8), 0, 4.0, 2);
    add(rbox(9.7, 1.1, 25, 0.3), mat('glass', 0x16212b), 0, 4.4, 2);
    add(rbox(7.5, 2.0, 12, 0.4), mat('gel', 0xf8f8f8), 0, 6.4, -1);
    add(rbox(7.6, 0.8, 11.5, 0.2), mat('glass', 0x16212b), 0, 6.6, -1);
    add(box(9.8, 0.4, 26), mat('paint', 0xd62828), 0, 5.6, 2);
  } else if (type === 'ship') {
    L = 225; B = 32;
    const h = hullShell(225, 32, { keel: -12, rail: 6, sheer: 2, rocker: 4, deadrise: 0.05, fine: 1.4, taper: 0.05 });
    add(h.geo, mat('paint', 0x1d2f4a)); add(h.transom, mat('paint', 0x1d2f4a));
    add(box(31, 0.6, 220), mat('paint', 0x6a2a22), 0, 5.5, 0);
    add(box(32.2, 3, 222), mat('paint', 0x8a1c1c), 0, -9, 0);
    add(rbox(28, 22, 14, 1), mat('paint', 0xf2f2f2), 0, 17, 88);
    add(box(28.5, 2.5, 12), mat('glass', 0x1d2730), 0, 24, 86);
    add(box(4, 8, 4), mat('paint', 0xc8102e), 0, 31, 92);
    const cc = [0xb7312c, 0x1f5fa6, 0x2e8b57, 0xe0a100, 0x7c7c7c, 0xd2691e, 0x6a1b9a, 0xf0f0f0];
    const parts = [];
    let k = 0;
    for (let z = -92; z < 70; z += 13.5) for (let x = -12; x <= 12; x += 2.6) {
      const hgt = 2.6 * (2 + ((k * 7) % 5));
      parts.push({ geo: box(2.45, hgt, 12.6), color: cc[(k * 13 + Math.floor(x)) % cc.length], m: M(x, 6 + hgt / 2, z) });
      k++;
    }
    add(merge(parts), mat('vc', 0, { roughness: 0.7, metalness: 0.3 }));
  } else if (type === 'tug') {
    L = 28; B = 10;
    shell(28, 10, { keel: -2.5, rail: 2.2, sheer: 0.8, deadrise: 0.3, fine: 0.7 }, 0x1b1b1b, 0xc0392b);
    add(rbox(7, 4, 9, 0.4), mat('paint', 0xf2f2f2), 0, 4.5, -2);
    add(box(7.1, 1.2, 8.5), mat('glass', 0x1b2630), 0, 5.6, -2);
    add(box(1.6, 3.5, 1.6), mat('paint', 0xc0392b), 0, 8, 0);
  }
  g.userData.L = L; g.userData.B = B;
  return g;
}

// ------------------------------------------------------------------ Water Police
let policeTex = null;
export function policeChequer() {
  if (policeTex) return policeTex;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 64;
  const x = c.getContext('2d');
  for (let i = 0; i < 64; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#ffffff' : '#0b2e8a'; x.fillRect(i * 16, j * 16, 16, 16); }
  for (const cx of [256, 768]) {
    x.fillStyle = '#ffffff'; x.fillRect(cx - 110, 4, 220, 56);
    x.fillStyle = '#0b2e8a'; x.font = 'bold 48px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('POLICE', cx, 35);
  }
  policeTex = new THREE.CanvasTexture(c);
  policeTex.colorSpace = THREE.SRGBColorSpace; policeTex.wrapS = THREE.RepeatWrapping; policeTex.anisotropy = 4;
  return policeTex;
}

// kind: 'patrol' (17.7 m Cygnet V class), 'jetboat' (7.6 m), 'rib' (8.5 m RHIB)
export function policeBoat(kind) {
  const g = new THREE.Group();
  const add = (geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
  const chequer = new THREE.MeshStandardMaterial({ map: policeChequer(), roughness: 0.5 });
  let L, B, lbY, lbZ;
  if (kind === 'rib') {
    L = 8.5; B = 2.9;
    const h = hullShell(L, B * 0.82, { keel: -0.45, rail: 0.35, sheer: 0.15, deadrise: 0.45 });
    add(h.geo, mat('paint', 0x2a2d31)); add(h.transom, mat('paint', 0x2a2d31));
    // inflatable collar following the rail, wrapped in the chequer band
    const pts = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; const s = t < 0.5 ? t * 2 : 2 - t * 2; const side = t < 0.5 ? 1 : -1; const tt = 1 - s; const z = -L / 2 + tt * L * 0.98; pts.push(new THREE.Vector3(side * (h.hw(tt) + 0.18), h.rail(tt) + 0.12, z)); }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.27, 12, false);
    const tm = add(tube, chequer);
    tube.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 0) a[i] = v * 6; });
    add(loft(h.secs.map(s => { const r = s[0][1], z = s[0][2], w = Math.abs(s[0][0]); return [[w, r, z], [0, r + 0.03, z], [-w, r, z]]; }), { ref: (x, y, z) => [0, y - 1, z] }), mat('rubber', 0x3a3d42));
    add(rbox(1.2, 1.1, 1.0, 0.12), mat('paint', 0xf2f4f6), 0, 0.95, 0.2);
    add(box(1.2, 0.5, 0.05), mat('glass', 0x2a3a48, { transparent: true, opacity: 0.55 }), 0, 1.65, -0.25, -0.4);
    for (const sx of [-0.8, 0.8]) add(cyl(0.035, 0.035, 1.9, 6), mat('alu', 0xcccccc), sx, 1.4, 0.9);
    add(box(1.8, 0.08, 1.4), mat('paint', 0xf2f4f6), 0, 2.35, 0.9);
    for (const sx of [-0.45, 0.45]) add(outboard(1.25, 0x23262a), mat('vc', 0, { roughness: 0.4 }), sx, 0.25, L / 2 + 0.25);
    lbY = 2.48; lbZ = 0.9;
  } else if (kind === 'jetboat') {
    L = 7.6; B = 2.6;
    const h = hullShell(L, B, { keel: -0.5, rail: 0.75, sheer: 0.2, deadrise: 0.35, fine: 0.7 });
    add(h.geo, mat('alu', 0xb9bec4)); add(h.transom, mat('alu', 0xb9bec4));
    add(loft(h.secs.map(s => { const r = s[0][1], z = s[0][2], w = Math.abs(s[0][0]); return [[w, r, z], [0, r + 0.03, z], [-w, r, z]]; }), { ref: (x, y, z) => [0, y - 1, z] }), mat('alu', 0x9aa1a8));
    for (const side of [1, -1]) {
      const band = add(new THREE.PlaneGeometry(L * 0.7, 0.32), chequer, side * (B / 2 + 0.035), 0.42, -0.1, 0, side * Math.PI / 2, 0);
      band.castShadow = false;
    }
    add(rbox(2.1, 1.5, 2.6, 0.18), mat('paint', 0xf2f4f6), 0, 1.5, 0.0);
    add(rbox(2.15, 0.62, 2.3, 0.1), mat('glass', 0x16222e), 0, 1.75, -0.1);
    lbY = 2.32; lbZ = 0.1;
  } else {
    L = 17.7; B = 5.2;
    const h = hullShell(L, B, { keel: -1.3, rail: 1.3, sheer: 0.5, deadrise: 0.38, fine: 0.75 });
    add(h.geo, mat('gel', 0xf4f6f8)); add(h.transom, mat('gel', 0xf4f6f8));
    add(loft(h.secs.map(s => { const r = s[0][1], z = s[0][2], w = Math.abs(s[0][0]); return [[w, r, z], [0, r + 0.05, z], [-w, r, z]]; }), { ref: (x, y, z) => [0, y - 1, z] }), mat('paint', 0xc9cdd1));
    for (const side of [1, -1]) {
      const band = add(new THREE.PlaneGeometry(L * 0.72, 0.62), chequer, side * (B / 2 + 0.06), 0.7, -0.4, 0, side * Math.PI / 2, 0);
      band.castShadow = false;
    }
    add(rbox(4.2, 2.4, 7.5, 0.3), mat('gel', 0xf6f7f8), 0, 2.5, -0.5);
    add(rbox(4.25, 0.9, 7.0, 0.15), mat('glass', 0x16222e), 0, 3.0, -0.8);
    add(rbox(3.4, 1.0, 3.4, 0.2), mat('gel', 0xf6f7f8), 0, 4.2, -0.2);
    add(cyl(0.08, 0.08, 3.2, 6), mat('alu', 0xcccccc), 0, 6.2, 0.4);
    add(box(1.8, 0.08, 0.3), mat('plastic', 0x222222), 0, 6.9, 0.4);
    for (const sx of [-2.4, 2.4]) add(cyl(0.03, 0.03, L * 0.75, 5), mat('alu', 0xdddddd), sx, 2.0, 0, Math.PI / 2);
    lbY = 4.85; lbZ = -0.2;
  }
  // light bar (red and blue flash)
  const red = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff0000, emissiveIntensity: 0, roughness: 0.3 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x000033, emissive: 0x1a3cff, emissiveIntensity: 0, roughness: 0.3 });
  const lr = new THREE.Mesh(rbox(0.6, 0.18, 0.26, 0.05), red), lb = new THREE.Mesh(rbox(0.6, 0.18, 0.26, 0.05), blue);
  lr.position.set(-0.32, lbY, lbZ); lb.position.set(0.32, lbY, lbZ);
  g.add(lr); g.add(lb);
  g.userData = { L, B, red, blue, kind };
  return g;
}

// ------------------------------------------------------------------ people (instanced parts), cars, trees
export const personParts = {
  torso: new THREE.CapsuleGeometry(0.17, 0.3, 2, 8).scale(1, 1, 0.68).translate(0, 1.2, 0),
  head: new THREE.SphereGeometry(0.11, 10, 8).scale(0.95, 1.1, 1).translate(0, 1.64, 0),
  hair: new THREE.SphereGeometry(0.118, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.66, 0.01),
  hips: new THREE.CapsuleGeometry(0.15, 0.1, 2, 8).scale(1, 1, 0.7).translate(0, 0.9, 0),
  legL: new THREE.CapsuleGeometry(0.07, 0.68, 2, 6).translate(0, -0.41, 0),
  legR: new THREE.CapsuleGeometry(0.07, 0.68, 2, 6).translate(0, -0.41, 0),
  armL: new THREE.CapsuleGeometry(0.05, 0.5, 2, 6).translate(0, -0.3, 0),
  armR: new THREE.CapsuleGeometry(0.05, 0.5, 2, 6).translate(0, -0.3, 0),
};

export function carGeos() {
  // lofted sedan body
  const secs = [];
  const prof = (z, top, bottom, w, round) => {
    const s = [];
    for (let a = 0; a <= 8; a++) { const th = a / 8 * Math.PI; s.push([Math.cos(th) * w * (1 - round * (1 - Math.sin(th)) * 0.0), bottom + (top - bottom) * Math.pow(Math.sin(th), round), z]); }
    s.push([-w, bottom, z], [w, bottom, z]);
    return s;
  };
  const stations = [[-2.25, 0.62, 0.3, 0.8], [-2.1, 0.8, 0.25, 0.86], [-1.3, 0.92, 0.25, 0.9], [-0.6, 0.98, 0.25, 0.9], [0.9, 0.98, 0.25, 0.9], [1.7, 0.95, 0.25, 0.9], [2.15, 0.85, 0.28, 0.86], [2.25, 0.62, 0.32, 0.8]];
  for (const [z, top, bot, w] of stations) secs.push(prof(z, top, bot, w, 0.25));
  const body = loft(secs, { closed: true, capStart: true, capEnd: true, ref: (x, y, z) => [0, 0.55, z * 0.9] });
  const cab = [];
  for (const [z, top, w] of [[-0.75, 0.95, 0.8], [-0.2, 1.42, 0.72], [0.9, 1.42, 0.72], [1.55, 0.97, 0.8]]) cab.push(prof(z, top, 0.9, w, 0.5));
  const cabin = loft(cab, { closed: true, capStart: true, capEnd: true, ref: (x, y, z) => [0, 1.05, z * 0.8 + 0.1] });
  const dark = merge([
    { geo: cabin, color: 0x1a232c },
    ...[[0.82, 1.35], [-0.82, 1.35], [0.82, -1.35], [-0.82, -1.35]].map(([x, z]) => ({ geo: cyl(0.33, 0.33, 0.22, 14), color: 0x111111, m: M(x, 0.33, z, 0, 0, Math.PI / 2) })),
    { geo: box(1.3, 0.1, 0.05), color: 0xfff6d0, m: M(0, 0.72, -2.26) },
    { geo: box(1.3, 0.1, 0.05), color: 0xaa1111, m: M(0, 0.78, 2.26) },
  ]);
  return { body, dark };
}

export function treeGeos() {
  const jitter = (geo, amt, seed) => { const p = geo.attributes.position; let s = seed; for (let i = 0; i < p.count; i++) { s = (s * 16807) % 2147483647; const k = 1 + ((s / 2147483647) - 0.5) * amt; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } geo.computeVertexNormals(); return geo; };
  const blob = (r, seed) => jitter(new THREE.IcosahedronGeometry(r, 0), 0.3, seed);
  const gum = merge([
    { geo: cyl(0.14, 0.32, 6, 7), color: 0xcfc6b4, m: M(0, 3, 0, 0, 0, 0.05) },
    { geo: cyl(0.07, 0.12, 3, 5), color: 0xcfc6b4, m: M(0.7, 6.2, 0.1, 0, 0, -0.7) },
    { geo: cyl(0.06, 0.1, 2.6, 5), color: 0xcfc6b4, m: M(-0.6, 6.0, -0.2, 0.2, 0, 0.7) },
    { geo: blob(1.9, 3), color: 0x5c6b3a, m: M(0.9, 7.7, 0.2, 0, 0, 0, 1.25, 0.65, 1.1) },
    { geo: blob(1.7, 7), color: 0x6c7b44, m: M(-1.0, 7.2, -0.3, 0, 0, 0, 1.15, 0.7, 1.05) },
    { geo: blob(1.4, 11), color: 0x56653a, m: M(0.2, 8.6, -0.8, 0, 0, 0, 1.1, 0.6, 1.0) },
    { geo: blob(1.2, 13), color: 0x73804a, m: M(-0.2, 6.4, 1.1, 0, 0, 0, 1.1, 0.65, 1.0) },
  ]);
  const pineParts = [{ geo: cyl(0.16, 0.36, 18, 7), color: 0x6b5a48, m: M(0, 9, 0) }];
  for (let i = 0; i < 7; i++) {
    const y = 5 + i * 2.0, r = 2.8 - i * 0.32;
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + i; pineParts.push({ geo: new THREE.ConeGeometry(0.5, r, 4), color: i % 2 ? 0x2f5130 : 0x264a28, m: M(Math.cos(a) * r * 0.45, y, Math.sin(a) * r * 0.45, Math.PI / 2, 0, -a + Math.PI / 2, 1, 1, 0.5) }); }
  }
  pineParts.push({ geo: new THREE.ConeGeometry(0.7, 2.5, 6), color: 0x2f5130, m: M(0, 19, 0) });
  const pine = merge(pineParts);
  const palmParts = [];
  for (let i = 0; i < 6; i++) palmParts.push({ geo: cyl(0.2, 0.24, 1.6, 7), color: i % 2 ? 0x8c7a5c : 0x7d6c50, m: M(Math.sin(i * 0.25) * 0.4, 0.8 + i * 1.55, 0) });
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2;
    palmParts.push({ geo: box(0.55, 0.05, 3.4), color: i % 2 ? 0x4f7a2a : 0x5f8a33, m: M(0.4 + Math.cos(a) * 1.5, 9.4, Math.sin(a) * 1.5, 0.5 * Math.sin(a) * 0, -a + Math.PI / 2, 0.45) });
  }
  const palm = merge(palmParts);
  return { gum, pine, palm };
}

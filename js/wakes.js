// Boat wakes you can see and jump.
//
// Every moving boat leaves breadcrumbs along the path it actually took. Each breadcrumb remembers how fast
// the boat was going and when it passed, so the wake follows the boat's real track (a turning boat leaves a
// curved wake, not a V glued to its stern). A Kelvin wake spreads out from the track at about 19.5 degrees
// (tan = 0.354), so a crumb that is `age` seconds old has its wave crest 0.354 * speed * age metres either
// side of the track. Across the crest the surface is a short wave packet: a big leading ridge, a trough and a
// smaller ridge behind, which is the ramp you launch off.
//
// The same numbers drive both the physics (heightAt, on the CPU) and the water mesh (the GLSL in WAKE_GLSL
// reading the data texture), so what you see is exactly what the ski hits.
import * as THREE from '../vendor/three.module.min.js';

export const WAKE_BOATS = 8;       // boats drawn at once (the nearest ones with a live wake)
export const WAKE_PTS = 32;        // points per wake trail
const COLS = WAKE_PTS + 2;         // texel 0: params, texel 1: bounding box, then the trail
const ARM = 0.354;                 // tan(19.47 deg), the Kelvin angle
const TAU = 28;                    // seconds for a wake to die away

// per boat type: wave height (m) at full speed and wavelength across the crest (m)
export function wakeShape(b) {
  const lam = Math.max(6, Math.min(14, 3.5 + b.L * 0.26));
  return { amp: b.wakeAmp || 0, lam, sig: lam * 0.72 };
}

export class Wakes {
  constructor() {
    this.data = new Float32Array(WAKE_BOATS * COLS * 4);
    this.tex = new THREE.DataTexture(this.data, COLS, WAKE_BOATS, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.count = 0;
    this.maxAmp = 0;
  }

  // boats: everything with x, z, yaw, speed, L, B, wakeAmp. focus: where the player is.
  update(boats, focus, time) {
    // 1. lay breadcrumbs
    for (const b of boats) {
      if (!b.trail) b.trail = [];
      const tr = b.trail;
      const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
      const sx = b.x - fx * b.L * 0.45, sz = b.z - fz * b.L * 0.45; // the stern
      const gap = Math.max(3, Math.min(12, b.speed * 0.55)); // about 30 crumbs cover ~17 s of track
      const last = tr[0];
      if (b.speed > 1.2 && (!last || Math.hypot(sx - last.x, sz - last.z) > gap)) tr.unshift({ x: sx, z: sz, t: time, v: b.speed });
      while (tr.length > WAKE_PTS - 1 || (tr.length && time - tr[tr.length - 1].t > TAU * 1.6)) tr.pop();
      b._stern = [sx, sz];
    }
    // 2. pick the nearest boats that have a wake worth drawing
    const live = boats.filter((b) => b.trail.length > 1 && (b.wakeAmp || 0) > 0.03)
      .map((b) => ({ b, d: Math.hypot(b.x - focus.x, b.z - focus.z) }))
      .filter((o) => o.d < 900)
      .sort((p, q) => p.d - q.d)
      .slice(0, WAKE_BOATS);
    // 3. pack them into the texture (and keep a CPU copy for the physics)
    const D = this.data;
    D.fill(0);
    this.maxAmp = 0;
    live.forEach(({ b }, row) => {
      const { amp, lam, sig } = wakeShape(b);
      const pts = [{ x: b._stern[0], z: b._stern[1], t: time, v: b.speed }, ...b.trail];
      const n = Math.min(pts.length, WAKE_PTS);
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (let j = 0; j < n; j++) {
        const p = pts[j], age = Math.max(0, time - p.t);
        const arm = b.B * 0.5 + ARM * p.v * age;
        // bigger and faster = bigger wake; it spreads out and dies away with age; the oldest crumb fades to 0
        let a = amp * Math.min(1, p.v / 10) * Math.exp(-age / TAU) / Math.sqrt(1 + arm / 25);
        if (j === n - 1) a = 0;
        const o = (row * COLS + 2 + j) * 4;
        D[o] = p.x; D[o + 1] = p.z; D[o + 2] = arm; D[o + 3] = a;
        const r = arm + sig * 2.2;
        x0 = Math.min(x0, p.x - r); x1 = Math.max(x1, p.x + r); z0 = Math.min(z0, p.z - r); z1 = Math.max(z1, p.z + r);
        this.maxAmp = Math.max(this.maxAmp, a);
      }
      const o = row * COLS * 4;
      D[o] = n; D[o + 1] = lam; D[o + 2] = sig;
      D[o + 4] = x0; D[o + 5] = z0; D[o + 6] = x1; D[o + 7] = z1;
    });
    this.count = live.length;
    this.tex.needsUpdate = true;
  }

  // wake height at (x, z): the same maths as WAKE_GLSL
  heightAt(x, z) {
    const D = this.data;
    let h = 0;
    for (let row = 0; row < this.count; row++) {
      const o = row * COLS * 4;
      if (x < D[o + 4] || x > D[o + 6] || z < D[o + 5] || z > D[o + 7]) continue;
      const n = D[o], lam = D[o + 1], sig = D[o + 2];
      let best = 1e18, arm = 0, amp = 0;
      for (let j = 0; j < n - 1; j++) {
        const a = o + (2 + j) * 4, c = a + 4;
        const ax = D[a], az = D[a + 1], ex = D[c] - ax, ez = D[c + 1] - az;
        const l2 = ex * ex + ez * ez;
        let t = l2 > 1e-6 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - ax - ex * t, dz = z - az - ez * t, d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; arm = D[a + 2] + (D[c + 2] - D[a + 2]) * t; amp = D[a + 3] + (D[c + 3] - D[a + 3]) * t; }
      }
      const d = Math.sqrt(best) - arm;
      h += amp * Math.cos(6.2831853 * d / lam) * Math.exp(-(d * d) / (sig * sig));
    }
    return h;
  }
}

// GLSL twin of heightAt. Needs: uniform sampler2D tWakes; uniform float uWakeN;
export const WAKE_GLSL = /* glsl */ `
  float wakeH(vec2 p) {
    float h = 0.0;
    for (int row = 0; row < ${WAKE_BOATS}; row++) {
      if (float(row) >= uWakeN) break;
      vec4 prm = texelFetch(tWakes, ivec2(0, row), 0);
      vec4 bb = texelFetch(tWakes, ivec2(1, row), 0);
      if (p.x < bb.x || p.x > bb.z || p.y < bb.y || p.y > bb.w) continue;
      int n = int(prm.x);
      float best = 1e18, arm = 0.0, amp = 0.0;
      vec4 A = texelFetch(tWakes, ivec2(2, row), 0);
      for (int j = 0; j < ${WAKE_PTS - 1}; j++) {
        if (j >= n - 1) break;
        vec4 C = texelFetch(tWakes, ivec2(3 + j, row), 0);
        vec2 e = C.xy - A.xy;
        float l2 = dot(e, e);
        float t = l2 > 1e-6 ? clamp(dot(p - A.xy, e) / l2, 0.0, 1.0) : 0.0;
        vec2 q = p - A.xy - e * t;
        float d2 = dot(q, q);
        if (d2 < best) { best = d2; arm = mix(A.z, C.z, t); amp = mix(A.w, C.w, t); }
        A = C;
      }
      float d = sqrt(best) - arm;
      h += amp * cos(6.2831853 * d / prm.y) * exp(-(d * d) / (prm.z * prm.z));
    }
    return h;
  }
`;

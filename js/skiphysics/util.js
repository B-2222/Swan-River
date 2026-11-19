// Small math + noise helpers shared by everything. No three.js dependency.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// Frame-rate independent exponential approach. tau = time constant in seconds.
export const damp = (cur, target, tau, dt) => target + (cur - target) * Math.exp(-dt / Math.max(tau, 1e-5));
export const sign = (x) => (x < 0 ? -1 : 1);
export const DEG = Math.PI / 180;

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Deterministic RNG (mulberry32)
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Periodic gradient noise (2D). `period` tiles seamlessly, which lets us bake
// repeatable textures on the CPU.
// ---------------------------------------------------------------------------
export function makeNoise2D(seed = 1) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rng() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  // period = 0 means non-periodic
  function noise(x, y, period = 0) {
    let x0 = Math.floor(x);
    let y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    if (period > 0) {
      x0 = ((x0 % period) + period) % period;
      y0 = ((y0 % period) + period) % period;
      x1 = ((x1 % period) + period) % period;
      y1 = ((y1 % period) + period) % period;
    }
    x0 &= 255;
    y0 &= 255;
    x1 &= 255;
    y1 &= 255;
    const h00 = perm[perm[x0] + y0];
    const h10 = perm[perm[x1] + y0];
    const h01 = perm[perm[x0] + y1];
    const h11 = perm[perm[x1] + y1];
    const n00 = gx[h00] * fx + gy[h00] * fy;
    const n10 = gx[h10] * (fx - 1) + gy[h10] * fy;
    const n01 = gx[h01] * fx + gy[h01] * (fy - 1);
    const n11 = gx[h11] * (fx - 1) + gy[h11] * (fy - 1);
    const u = fade(fx);
    const v = fade(fy);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.41;
  }

  function fbm(x, y, octaves = 4, period = 0, gain = 0.5, lac = 2) {
    let amp = 0.5;
    let sum = 0;
    let norm = 0;
    let f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * f, y * f, period ? period * f : 0);
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  }
  return { noise, fbm };
}

// Procedurally baked, seamlessly tiling noise texture (from jetskirider src/textures.js, makeNoiseTexture only).

import * as THREE from '../../vendor/three.module.min.js';
import { makeNoise2D, makeRng, clamp } from '../skiphysics/util.js';

// RGBA noise: R,G = two cloud-like fbm fields, B = foam "lace" (cell edges
// are 0, cell centres 1), A = fine fbm.
export function makeNoiseTexture(size = 256) {
  const N1 = makeNoise2D(11);
  const N2 = makeNoise2D(29);
  const N3 = makeNoise2D(53);
  const data = new Uint8Array(size * size * 4);

  // tileable worley points
  const cells = 9;
  const rng = makeRng(77);
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    px[i] = rng();
    py[i] = rng();
  }
  const lace = (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const gx = cx + i;
        const gy = cy + j;
        const id = (((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells);
        const dx = gx + px[id] - x;
        const dy = gy + py[id] - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    }
    return clamp((f2 - f1) * 1.6, 0, 1);
  };

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const o = (j * size + i) * 4;
      const r = N1.fbm(u * 4, v * 4, 5, 4) * 0.5 + 0.5;
      const g = N2.fbm(u * 6, v * 6, 5, 6) * 0.5 + 0.5;
      const warp = N3.fbm(u * 8, v * 8, 2, 8) * 0.035;
      const b = lace(u + warp, v - warp) * 0.75 + lace(u * 3 + 0.37 - warp, v * 3 + 0.11 + warp) * 0.25;
      const a = N3.fbm(u * 16, v * 16, 4, 16) * 0.5 + 0.5;
      data[o] = clamp(r, 0, 1) * 255;
      data[o + 1] = clamp(g, 0, 1) * 255;
      data[o + 2] = clamp(b, 0, 1) * 255;
      data[o + 3] = clamp(a, 0, 1) * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Land and shoreline mesh built from the OSM-derived height grid, in level-of-detail chunks.
import * as THREE from '../vendor/three.module.min.js';
import { W } from './world.js';

const CH = 64; // cells per chunk side

function makeDetailTexture() {
  const s = 128, data = new Uint8Array(s * s * 4);
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const base = new Float32Array(s * s);
  for (let i = 0; i < s * s; i++) base[i] = rnd();
  for (let pass = 0; pass < 2; pass++) {
    const t = base.slice();
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      let a = 0;
      for (let k = -1; k <= 1; k++) for (let l = -1; l <= 1; l++) a += t[((y + k + s) % s) * s + ((x + l + s) % s)];
      base[y * s + x] = a / 9;
    }
  }
  for (let i = 0; i < s * s; i++) {
    const v = Math.max(0, Math.min(255, (base[i] - 0.5) * 3 * 255 + 128));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, s, s);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

export function createTerrain(scene) {
  const detail = makeDetailTexture();
  const mat = new THREE.MeshLambertMaterial({ map: W.landTex });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tDetail = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying float vNy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = position; vNy = normal.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying float vNy;\nuniform sampler2D tDetail;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float dt = texture2D(tDetail, vWP.xz / 9.0).r * 0.6 + texture2D(tDetail, vWP.xz / 61.0).r * 0.4;
        diffuseColor.rgb *= 0.78 + dt * 0.44;
        float beach = 1.0 - smoothstep(0.5, 1.1, vWP.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.55, 0.40) * (0.9 + dt * 0.2), beach * 0.5);
        float rock = smoothstep(0.82, 0.6, vNy);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.66, 0.50) * (0.8 + dt * 0.35), rock);
        float wetline = 1.0 - smoothstep(0.0, 0.55, vWP.y);
        diffuseColor.rgb *= 1.0 - wetline * 0.35;`);
  };

  const ncx = Math.ceil((W.NX - 1) / CH), ncz = Math.ceil((W.NZ - 1) / CH);
  const chunks = [];
  for (let cz = 0; cz < ncz; cz++) for (let cx = 0; cx < ncx; cx++) {
    const i0 = cx * CH, j0 = cz * CH, i1 = Math.min(i0 + CH, W.NX - 1), j1 = Math.min(j0 + CH, W.NZ - 1);
    let mx = -1e9;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) mx = Math.max(mx, W.H[j * W.NX + i]);
    if (mx < -0.7) continue; // fully under water: the water shader draws the river bed
    const cxm = W.X0 + ((i0 + i1) / 2 + 0.5) * W.CELL, czm = W.Z0 + ((j0 + j1) / 2 + 0.5) * W.CELL;
    chunks.push({ i0, j0, i1, j1, cxm, czm, lod: -1, geos: {}, mesh: null });
  }

  function build(c, step) {
    const nx = Math.floor((c.i1 - c.i0) / step) + 1, nz = Math.floor((c.j1 - c.j0) / step) + 1;
    const ix = (k) => Math.min(c.i0 + k * step, c.i1), jz = (k) => Math.min(c.j0 + k * step, c.j1);
    const nxs = (c.i1 - c.i0) % step ? nx + 1 : nx, nzs = (c.j1 - c.j0) % step ? nz + 1 : nz;
    const vcount = nxs * nzs + 2 * (nxs + nzs);
    const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), uv = new Float32Array(vcount * 2);
    const idx = [];
    const H = W.H, NX = W.NX, NZ = W.NZ, C = W.CELL;
    const hAt = (i, j) => H[Math.max(0, Math.min(NZ - 1, j)) * NX + Math.max(0, Math.min(NX - 1, i))];
    let v = 0;
    const put = (i, j, drop) => {
      const x = W.X0 + (i + 0.5) * C, z = W.Z0 + (j + 0.5) * C;
      const h = hAt(i, j);
      pos[v * 3] = x; pos[v * 3 + 1] = h - drop; pos[v * 3 + 2] = z;
      const dx = hAt(i + 1, j) - hAt(i - 1, j), dz = hAt(i, j + 1) - hAt(i, j - 1);
      const l = Math.hypot(dx, 2 * C, dz);
      nor[v * 3] = -dx / l; nor[v * 3 + 1] = 2 * C / l; nor[v * 3 + 2] = -dz / l;
      uv[v * 2] = (i + 0.5) / NX; uv[v * 2 + 1] = 1 - (j + 0.5) / NZ;
      return v++;
    };
    const grid = [];
    for (let b = 0; b < nzs; b++) {
      const row = [];
      for (let a = 0; a < nxs; a++) row.push(put(ix(a), jz(b), 0));
      grid.push(row);
    }
    for (let b = 0; b < nzs - 1; b++) for (let a = 0; a < nxs - 1; a++) {
      const p = grid[b][a], q = grid[b][a + 1], r = grid[b + 1][a], s = grid[b + 1][a + 1];
      idx.push(p, r, q, q, r, s);
    }
    // skirts to hide cracks between levels of detail
    const skirt = (list, flip) => {
      const low = list.map(k => {
        const x = pos[k * 3], z = pos[k * 3 + 2];
        const i = Math.round((x - W.X0) / C - 0.5), j = Math.round((z - W.Z0) / C - 0.5);
        return put(i, j, 6 + step * 2);
      });
      for (let k = 0; k < list.length - 1; k++) {
        const a = list[k], b = list[k + 1], c2 = low[k], d = low[k + 1];
        if (flip) idx.push(a, b, c2, b, d, c2); else idx.push(a, c2, b, b, c2, d);
      }
    };
    skirt(grid[0], true); skirt(grid[nzs - 1], false);
    skirt(grid.map(r => r[0]), false); skirt(grid.map(r => r[nxs - 1]), true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, v * 2), 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  const group = new THREE.Group();
  scene.add(group);
  let budget = 0;
  function update(cam, quality) {
    const far = [4500, 7000, 9500][quality];
    budget = 3; // limit geometry builds per frame to avoid hitches
    for (const c of chunks) {
      const d = Math.hypot(c.cxm - cam.x, c.czm - cam.z);
      if (d > far) { if (c.mesh) c.mesh.visible = false; continue; }
      const lod = d < 1300 ? 1 : d < 2800 ? 2 : d < 5200 ? 4 : 8;
      if (lod !== c.lod) {
        if (!c.geos[lod]) {
          if (budget <= 0 && c.mesh) { c.mesh.visible = true; continue; }
          budget--;
          c.geos[lod] = build(c, lod);
        }
        if (!c.mesh) { c.mesh = new THREE.Mesh(c.geos[lod], mat); c.mesh.matrixAutoUpdate = false; group.add(c.mesh); }
        else c.mesh.geometry = c.geos[lod];
        c.lod = lod;
      }
      c.mesh.visible = true;
    }
  }
  function prewarm(cam, quality) { for (let k = 0; k < 40; k++) update(cam, quality); }
  return { update, prewarm, material: mat };
}

// Rottnest and Garden Island, from the GSHHS full resolution shoreline (outside the OSM grid)
export function createIslands(scene) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  for (const isl of W.islands) {
    const shape = new THREE.Shape(isl.pts.map(p => new THREE.Vector2(p[0], -p[1])));
    const geo = new THREE.ShapeGeometry(shape, 1);
    geo.rotateX(-Math.PI / 2);
    // raise the interior with distance from the coast
    const pos = geo.attributes.position;
    const col = [];
    const pts = isl.pts;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let dmin = Infinity;
      for (let k = 0; k < pts.length; k += 2) dmin = Math.min(dmin, Math.hypot(pts[k][0] - x, pts[k][1] - z));
      const h = Math.min(1.5 + dmin * 0.06, isl.name.startsWith('Rott') ? 40 : 25);
      pos.setY(i, h);
      const sand = dmin < 60;
      col.push(sand ? 0.86 : 0.42, sand ? 0.80 : 0.5, sand ? 0.62 : 0.3);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    scene.add(m);
    // beach skirt down to the water
    const ring = [];
    for (const p of pts) ring.push(p);
    const sk = new THREE.BufferGeometry();
    const sp = [], si = [];
    for (let i = 0; i < ring.length; i++) { sp.push(ring[i][0], 1.5, ring[i][1], ring[i][0] * 1.0, -3, ring[i][1]); }
    for (let i = 0; i < ring.length - 1; i++) { const a = i * 2; si.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    sk.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sk.setIndex(si); sk.computeVertexNormals();
    scene.add(new THREE.Mesh(sk, new THREE.MeshLambertMaterial({ color: 0xd8caa0, side: THREE.DoubleSide })));
  }
}

// Water surface: depth-tinted Swan River (tannin brown-green), ocean swell beyond the moles, foam and wakes.
import * as THREE from '../vendor/three.module.min.js';
import { W, oceanAt } from './world.js';

// Wave set shared by the shader and the physics so the jet ski rides the same surface you see.
// dirX, dirZ, wavelength, amplitude, isSwell
const WAVES = [
  [0.80, 0.60, 7.0, 0.050, 0], [-0.40, 0.92, 4.3, 0.032, 0], [0.95, -0.31, 11.0, 0.060, 0],
  [0.707, -0.707, 72.0, 0.55, 1], [0.55, -0.835, 44.0, 0.30, 1], [0.86, -0.51, 27.0, 0.16, 1],
];
const G = 9.81;
const WK = WAVES.map(w => { const k = 2 * Math.PI / w[2]; const l = Math.hypot(w[0], w[1]); return [w[0] / l, w[1] / l, k, w[3], Math.sqrt(G * k), w[4]]; });
export const waveState = { chop: 1.0, time: 0 };

export function waveHeight(x, z, t = waveState.time, ocean = oceanAt(x, z)) {
  let h = 0;
  for (const w of WK) {
    const amp = w[5] ? w[3] * ocean : w[3] * waveState.chop * (1 + ocean);
    h += amp * Math.sin(w[2] * (w[0] * x + w[1] * z) - w[4] * t);
  }
  return h;
}
// returns slope (dh/dx, dh/dz)
export function waveSlope(x, z, out, t = waveState.time, ocean = oceanAt(x, z)) {
  let sx = 0, sz = 0;
  for (const w of WK) {
    const amp = w[5] ? w[3] * ocean : w[3] * waveState.chop * (1 + ocean);
    const c = amp * w[2] * Math.cos(w[2] * (w[0] * x + w[1] * z) - w[4] * t);
    sx += c * w[0]; sz += c * w[1];
  }
  out.x = sx; out.z = sz; return out;
}

function glslWaves() {
  let s = '';
  WK.forEach((w, i) => {
    const amp = w[5] ? `${w[3].toFixed(4)} * oc` : `${w[3].toFixed(4)} * uChop * (1.0 + oc)`;
    s += `{ float ph = ${w[2].toFixed(6)} * dot(vec2(${w[0].toFixed(6)}, ${w[1].toFixed(6)}), p) - ${w[4].toFixed(6)} * uTime;
      float a = (${amp}) * fade; h += a * sin(ph); float c = a * ${w[2].toFixed(6)} * cos(ph);
      d += vec2(${w[0].toFixed(6)}, ${w[1].toFixed(6)}) * c; }\n`;
  });
  return s;
}

function makeNormalMap() {
  const s = 256; const hgt = new Float32Array(s * s);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 48; k++) {
    const fx = Math.round((rnd() - 0.5) * 18), fy = Math.round((rnd() - 0.5) * 18), ph = rnd() * 6.283;
    const a = 1 / (1 + Math.hypot(fx, fy));
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) hgt[y * s + x] += a * Math.sin(6.2832 * (fx * x + fy * y) / s + ph);
  }
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = hgt[y * s + (x + 1) % s] - hgt[y * s + (x - 1 + s) % s];
    const dy = hgt[((y + 1) % s) * s + x] - hgt[((y - 1 + s) % s) * s + x];
    const l = Math.hypot(dx * 3, dy * 3, 1);
    const o = (y * s + x) * 4;
    data[o] = (-dx * 3 / l * 0.5 + 0.5) * 255; data[o + 1] = (-dy * 3 / l * 0.5 + 0.5) * 255; data[o + 2] = (1 / l * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, s, s);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

function makeDataTexture() {
  const n = W.NX * W.NZ, d = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    d[i * 4] = Math.max(0, Math.min(255, (W.H[i] + 30) / 90 * 255));
    d[i * 4 + 1] = Math.max(0, Math.min(255, W.OCEAN[i] * 255));
    d[i * 4 + 2] = Math.max(0, Math.min(255, (W.SDF[i] + 64) / 128 * 255));
    d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, W.NX, W.NZ);
  t.flipY = false; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

// foam/wake canvas that scrolls with the player (1 px = 1 m)
export class Wake {
  constructor(size = 512) {
    this.size = size; this.cx = 0; this.cz = 0;
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, size, size);
    this.tmp = document.createElement('canvas'); this.tmp.width = this.tmp.height = size;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
  }
  recenter(x, z) {
    const dx = Math.round(x - this.cx), dz = Math.round(z - this.cz);
    if (Math.abs(dx) < 96 && Math.abs(dz) < 96) return;
    const t = this.tmp.getContext('2d');
    t.fillStyle = '#000'; t.fillRect(0, 0, this.size, this.size);
    t.drawImage(this.canvas, -dx, -dz);
    this.ctx.drawImage(this.tmp, 0, 0);
    this.cx += dx; this.cz += dz;
  }
  stamp(x, z, r, a) {
    const px = x - this.cx + this.size / 2, pz = z - this.cz + this.size / 2;
    if (px < -r || pz < -r || px > this.size + r || pz > this.size + r) return;
    const c = this.ctx;
    const g = c.createRadialGradient(px, pz, 0, px, pz, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(px, pz, r, 0, 6.2832); c.fill();
  }
  update(dt) {
    const c = this.ctx;
    c.fillStyle = `rgba(0,0,0,${Math.min(1, dt * 0.55)})`;
    c.fillRect(0, 0, this.size, this.size);
    this.tex.needsUpdate = true;
  }
}

export function createWater(scene, sky) {
  const wake = new Wake(512);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uChop: { value: 1 }, uCenter: { value: new THREE.Vector2() }, uDisp: { value: 1 },
    tData: { value: makeDataTexture() }, tLand: { value: W.landTex }, tNormal: { value: makeNormalMap() }, tWake: { value: wake.tex },
    uGrid: { value: new THREE.Vector4(W.X0, W.Z0, W.NX * W.CELL, W.NZ * W.CELL) },
    uWake: { value: new THREE.Vector3(0, 0, 512) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
    uZenith: { value: new THREE.Color(0.2, 0.4, 0.8) }, uHorizon: { value: new THREE.Color(0.7, 0.8, 0.9) },
    uLight: { value: 1 },
  }]);
  uniforms.tData.value = makeDataTexture();
  uniforms.tLand.value = W.landTex; uniforms.tNormal.value = makeNormalMap(); uniforms.tWake.value = wake.tex;

  const vert = `
    #include <common>
    #include <fog_pars_vertex>
    #include <logdepthbuf_pars_vertex>
    uniform float uTime, uChop, uDisp; uniform vec2 uCenter; uniform vec4 uGrid; uniform sampler2D tData;
    varying vec3 vWP; varying vec3 vN; varying float vOc;
    void main() {
      vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
      vec2 p = wp.xz;
      vec2 guv = (p - uGrid.xy) / uGrid.zw;
      float oc = texture2D(tData, guv).g;
      if (guv.x < 0.0) oc = 1.0;
      vec2 rel = abs(p - uCenter);
      float fade = uDisp * (1.0 - smoothstep(780.0, 1010.0, max(rel.x, rel.y)));
      float h = 0.0; vec2 d = vec2(0.0);
      ${glslWaves()}
      wp.y += h;
      vWP = wp; vOc = oc;
      vN = normalize(vec3(-d.x, 1.0, -d.y));
      vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
    }`;
  const frag = `
    #include <common>
    #include <fog_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    uniform float uTime, uChop, uLight; uniform vec4 uGrid; uniform vec3 uWake;
    uniform sampler2D tData, tLand, tNormal, tWake;
    uniform vec3 uSunDir, uSunColor, uZenith, uHorizon;
    varying vec3 vWP; varying vec3 vN; varying float vOc;
    void main() {
      #include <logdepthbuf_fragment>
      vec2 guv = (vWP.xz - uGrid.xy) / uGrid.zw;
      vec4 dt = texture2D(tData, guv);
      float bed = dt.r * 90.0 - 30.0;
      float sdf = dt.b * 128.0 - 64.0;
      if (guv.x < 0.0) { bed = -20.0; sdf = -64.0; }
      if (sdf > 0.6 || bed > 1.5) discard;
      float depth = max(0.0, vWP.y - bed);
      float dist = length(cameraPosition - vWP);
      // detail normals
      vec2 q = vWP.xz;
      vec3 n1 = texture2D(tNormal, q / 21.0 + vec2(0.021, 0.013) * uTime).xzy * 2.0 - 1.0;
      vec3 n2 = texture2D(tNormal, q / 7.7 + vec2(-0.018, 0.027) * uTime).xzy * 2.0 - 1.0;
      float dstr = (0.35 + 0.35 * uChop) * (1.0 - smoothstep(150.0, 2500.0, dist) * 0.8);
      vec3 n = normalize(vN + vec3(n1.x + n2.x, 0.0, n1.z + n2.z) * dstr);
      vec3 V = normalize(cameraPosition - vWP);
      // colour through the water: Swan River is tannin stained, the ocean is clear blue
      vec3 bedCol = texture2D(tLand, vec2(guv.x, 1.0 - guv.y)).rgb;
      float murk = 1.0 - exp(-depth * mix(0.55, 0.22, vOc));
      vec3 deep = mix(vec3(0.030, 0.085, 0.080), vec3(0.010, 0.080, 0.170), vOc);
      vec3 shallowTint = mix(vec3(0.62, 0.68, 0.52), vec3(0.45, 0.85, 0.80), vOc);
      vec3 col = mix(bedCol * shallowTint, deep, murk) * uLight;
      // reflection of the sky
      vec3 R = reflect(-V, n);
      R.y = abs(R.y);
      vec3 skyc = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.6));
      float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
      col = mix(col, skyc, F * 0.85);
      float sd = max(dot(R, uSunDir), 0.0);
      col += uSunColor * (pow(sd, 400.0) * 5.0 + pow(sd, 40.0) * 0.15) * step(0.0, uSunDir.y);
      // shoreline foam
      float shore = smoothstep(-7.0, -0.6, sdf) * (1.0 - step(0.5, sdf));
      float fn = texture2D(tNormal, q / 9.0 + uTime * 0.03).r;
      float band = 0.5 + 0.5 * sin(sdf * 1.4 + uTime * 1.6 + fn * 4.0);
      float foam = shore * smoothstep(0.35, 0.9, band * fn + shore * 0.35) * (0.4 + 0.6 * vOc);
      // wake foam from the canvas
      vec2 wuv = (vWP.xz - uWake.xy) / uWake.z + 0.5;
      if (wuv.x > 0.0 && wuv.x < 1.0 && wuv.y > 0.0 && wuv.y < 1.0) {
        float wk = texture2D(tWake, wuv).r;
        float br = texture2D(tNormal, q / 3.0 + uTime * 0.05).g;
        foam += wk * (0.55 + 0.45 * br);
      }
      // whitecaps on swell crests
      foam += vOc * smoothstep(0.55, 0.85, vWP.y) * 0.5;
      col = mix(col, vec3(0.92, 0.95, 0.97) * max(uLight, 0.25), clamp(foam, 0.0, 0.95));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, fog: true });
  const near = new THREE.Mesh(new THREE.PlaneGeometry(2048, 2048, 200, 200).rotateX(-Math.PI / 2), mat);
  near.frustumCulled = false;
  const farMat = mat.clone();
  farMat.uniforms = Object.assign({}, uniforms, { uDisp: { value: 0 } }); // shares everything except displacement
  // far ring: four flat quads around the near patch
  const ringGeo = new THREE.BufferGeometry();
  const H = 1024, O = 45000;
  const quads = [[-O, -O, O, -H], [-O, H, O, O], [-O, -H, -H, H], [H, -H, O, H]];
  const pos = [], idx = [];
  quads.forEach((q, i) => {
    const b = i * 4;
    pos.push(q[0], 0, q[1], q[2], 0, q[1], q[0], 0, q[3], q[2], 0, q[3]);
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  });
  ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ringGeo.setIndex(idx);
  const far = new THREE.Mesh(ringGeo, farMat);
  far.frustumCulled = false;
  scene.add(near); scene.add(far);

  function update(dt, t, camPos, focus) {
    const step = 8;
    const cx = Math.round(camPos.x / step) * step, cz = Math.round(camPos.z / step) * step;
    near.position.set(cx, 0, cz); far.position.set(cx, 0, cz);
    uniforms.uCenter.value.set(cx, cz);
    uniforms.uTime.value = t;
    uniforms.uChop.value = waveState.chop;
    wake.recenter(focus.x, focus.z);
    wake.update(dt);
    uniforms.uWake.value.set(wake.cx, wake.cz, wake.size);
    uniforms.uSunDir.value.copy(sky.sunDir);
    uniforms.uSunColor.value.copy(sky.sunColor);
    uniforms.uZenith.value.copy(sky.zenith);
    uniforms.uHorizon.value.copy(sky.horizon);
    uniforms.uLight.value = sky.light;
  }
  return { update, wake, uniforms };
}

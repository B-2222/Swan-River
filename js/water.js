// Water: physically based surface (sky reflections, sun glints, shadows), coloured by the real river depth,
// Fremantle Doctor wind chop that is calmer in the lee of the shore, ocean swell through the moles, foam and wakes.
import * as THREE from '../vendor/three.module.min.js';
import { W, oceanAt, sdfAt } from './world.js';

// Wave set shared by the shader and the physics so the jet ski rides the same surface you see.
// dirX, dirZ, wavelength, amplitude, isSwell
const WAVES = [
  [0.80, 0.60, 6.5, 0.045, 0], [-0.40, 0.92, 4.1, 0.028, 0], [0.95, -0.31, 10.5, 0.06, 0], [0.62, 0.78, 16.0, 0.07, 0],
  [0.707, -0.707, 120.0, 0.45, 1], [0.55, -0.835, 70.0, 0.28, 1], [0.86, -0.51, 40.0, 0.16, 1],
];
const G = 9.81;
const WK = WAVES.map(w => { const k = 2 * Math.PI / w[2]; const l = Math.hypot(w[0], w[1]); return [w[0] / l, w[1] / l, k, w[3], Math.sqrt(G * k), w[4]]; });
export const waveState = { chop: 1.0, time: 0 };
const shelter = (s) => Math.max(0.35, Math.min(1, -s / 110));

// hull = true: a 3 m planing hull bridges short ripples, so the short chop is felt at reduced strength
export function waveHeight(x, z, t = waveState.time, ocean = oceanAt(x, z), hull = false) {
  const sh = shelter(sdfAt(x, z));
  let h = 0;
  for (const w of WK) {
    let amp = w[5] ? w[3] * ocean : w[3] * waveState.chop * (1 + ocean) * sh;
    if (hull && w[2] > 0.75) amp *= 0.35;
    h += amp * Math.sin(w[2] * (w[0] * x + w[1] * z) - w[4] * t);
  }
  return h;
}

// Height, slope (dh/dx, dh/dz) and vertical speed (dh/dt) of the visible surface in one pass,
// for physics that samples the water directly (see physworld.js).
export function waveSample(x, z, t = waveState.time, out = {}) {
  const ocean = oceanAt(x, z), sh = shelter(sdfAt(x, z));
  let h = 0, dx = 0, dz = 0, dt = 0;
  for (const w of WK) {
    const amp = w[5] ? w[3] * ocean : w[3] * waveState.chop * (1 + ocean) * sh;
    const ph = w[2] * (w[0] * x + w[1] * z) - w[4] * t;
    const s = Math.sin(ph), c = amp * Math.cos(ph);
    h += amp * s; dx += c * w[2] * w[0]; dz += c * w[2] * w[1]; dt -= c * w[4];
  }
  out.h = h; out.dx = dx; out.dz = dz; out.dt = dt;
  return out;
}

function glslWaves() {
  let s = '';
  WK.forEach((w) => {
    const amp = w[5] ? `${w[3].toFixed(4)} * oc` : `${w[3].toFixed(4)} * uChop * (1.0 + oc) * sh`;
    s += `{ float ph = ${w[2].toFixed(6)} * dot(vec2(${w[0].toFixed(6)}, ${w[1].toFixed(6)}), p) - ${w[4].toFixed(6)} * uTime;
      float a = (${amp}) * fade; h += a * sin(ph); float c = a * ${w[2].toFixed(6)} * cos(ph);
      d += vec2(${w[0].toFixed(6)}, ${w[1].toFixed(6)}) * c; }\n`;
  });
  return s;
}

function makeNormalMap() {
  const s = 256; const hgt = new Float32Array(s * s);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 60; k++) {
    const fx = Math.round((rnd() - 0.5) * 22), fy = Math.round((rnd() - 0.5) * 22), ph = rnd() * 6.283;
    const a = 1 / (1 + Math.hypot(fx, fy));
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) hgt[y * s + x] += a * Math.sin(6.2832 * (fx * x + fy * y) / s + ph);
  }
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = hgt[y * s + (x + 1) % s] - hgt[y * s + (x - 1 + s) % s];
    const dy = hgt[((y + 1) % s) * s + x] - hgt[((y - 1 + s) % s) * s + x];
    const l = Math.hypot(dx * 3, dy * 3, 1), o = (y * s + x) * 4;
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

// foam / wake canvas that scrolls with the player (1 px = 1 m)
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
    c.fillStyle = `rgba(0,0,0,${Math.min(1, dt * 0.5)})`;
    c.fillRect(0, 0, this.size, this.size);
    this.tex.needsUpdate = true;
  }
}

export function createWater(scene, sky, renderer) {
  const wake = new Wake(512);
  const shared = {
    uTime: { value: 0 }, uChop: { value: 1 }, uCenter: { value: new THREE.Vector2() },
    tData: { value: makeDataTexture() }, tLand: { value: W.landTex }, tNormal: { value: makeNormalMap() }, tWake: { value: wake.tex },
    uGrid: { value: new THREE.Vector4(W.X0, W.Z0, W.NX * W.CELL, W.NZ * W.CELL) },
    uWake: { value: new THREE.Vector3(0, 0, 512) },
    tReflect: { value: null }, uTexMatrix: { value: new THREE.Matrix4() }, uPlanar: { value: 0 },
  };
  const makeMat = (disp) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0, envMapIntensity: 1.0 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, shared, { uDisp: { value: disp } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uChop, uDisp; uniform vec2 uCenter; uniform vec4 uGrid; uniform sampler2D tData;
          varying vec3 vWP; varying vec3 vNw; varying float vOc;`)
        .replace('#include <beginnormal_vertex>', `
          vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
          vec2 p = wp0.xz;
          vec2 guv = (p - uGrid.xy) / uGrid.zw;
          vec4 td = texture2D(tData, guv);
          float oc = guv.x < 0.0 ? 1.0 : td.g;
          float sdfv = guv.x < 0.0 ? -64.0 : td.b * 128.0 - 64.0;
          float sh = clamp(-sdfv / 110.0, 0.35, 1.0);
          vec2 rel = abs(p - uCenter);
          float fade = uDisp * (1.0 - smoothstep(780.0, 1010.0, max(rel.x, rel.y)));
          float h = 0.0; vec2 d = vec2(0.0);
          ${glslWaves()}
          vec3 objectNormal = normalize(vec3(-d.x, 1.0, -d.y));
          vNw = objectNormal; vOc = oc;
          #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
          #endif`)
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position); transformed.y += h; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uChop, uPlanar; uniform vec4 uGrid; uniform vec3 uWake; uniform mat4 uTexMatrix;
          uniform sampler2D tData, tLand, tNormal, tWake, tReflect;
          varying vec3 vWP; varying vec3 vNw; varying float vOc;
          float foamAmt = 0.0; vec3 nWorld = vec3(0.0, 1.0, 0.0);`)
        .replace('#include <color_fragment>', `
          vec2 guv = (vWP.xz - uGrid.xy) / uGrid.zw;
          vec4 dt = texture2D(tData, guv);
          float bed = dt.r * 90.0 - 30.0;
          float sdf = dt.b * 128.0 - 64.0;
          if (guv.x < 0.0) { bed = -20.0; sdf = -64.0; }
          if (sdf > 0.6 || bed > 1.5) discard;
          float depth = max(0.0, vWP.y - bed);
          float dist = length(cameraPosition - vWP);
          // the river bed shows through the shallows; deep water goes dark tannin green (river) or blue (ocean)
          vec3 bedCol = texture2D(tLand, vec2(guv.x, 1.0 - guv.y)).rgb;
          float murk = 1.0 - exp(-depth * mix(0.75, 0.28, vOc));
          vec3 deep = mix(vec3(0.010, 0.040, 0.042), vec3(0.004, 0.030, 0.075), vOc);
          vec3 shallowTint = mix(vec3(0.42, 0.50, 0.36), vec3(0.30, 0.75, 0.72), vOc);
          diffuseColor.rgb = mix(bedCol * shallowTint, deep, murk);
          // foam: shoreline lapping, wakes, whitecaps on swell crests
          vec2 q = vWP.xz;
          float shore = smoothstep(-6.0, -0.5, sdf);
          float fn = texture2D(tNormal, q / 9.0 + uTime * 0.03).r;
          float band = 0.5 + 0.5 * sin(sdf * 1.4 + uTime * 1.6 + fn * 4.0);
          foamAmt = shore * smoothstep(0.45, 0.95, band * fn + shore * 0.3) * (0.35 + 0.65 * vOc);
          vec2 wuv = (vWP.xz - uWake.xy) / uWake.z + 0.5;
          if (wuv.x > 0.0 && wuv.x < 1.0 && wuv.y > 0.0 && wuv.y < 1.0) {
            float wk = texture2D(tWake, wuv).r;
            float br = texture2D(tNormal, q / 2.6 + uTime * 0.05).g;
            foamAmt += wk * smoothstep(0.25, 0.75, br + wk * 0.4);
          }
          foamAmt += vOc * smoothstep(0.45, 0.75, vWP.y) * 0.4;
          foamAmt = clamp(foamAmt, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.88), foamAmt);`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(roughness + smoothstep(200.0, 3000.0, length(cameraPosition - vWP)) * 0.12, 0.7, foamAmt);`)
        .replace('#include <normal_fragment_maps>', `
          vec2 q2 = vWP.xz;
          float dfar = 1.0 - smoothstep(120.0, 2200.0, length(cameraPosition - vWP)) * 0.75;
          vec3 n1 = texture2D(tNormal, q2 / 23.0 + vec2(0.021, 0.013) * uTime).xzy * 2.0 - 1.0;
          vec3 n2 = texture2D(tNormal, q2 / 7.9 + vec2(-0.018, 0.027) * uTime).xzy * 2.0 - 1.0;
          float strength = (0.18 + 0.22 * uChop) * dfar;
          nWorld = normalize(vNw + vec3(n1.x + n2.x, 0.0, n1.z + n2.z) * strength);
          normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);`)
        .replace('#include <opaque_fragment>', `
          if (uPlanar > 0.5) {
            vec4 rc = uTexMatrix * vec4(vWP, 1.0);
            vec2 ruv = rc.xy / rc.w + nWorld.xz * 0.035;
            vec3 refl = texture2D(tReflect, ruv).rgb;
            vec3 Vv = normalize(cameraPosition - vWP);
            float F = 0.02 + 0.98 * pow(1.0 - max(dot(nWorld, Vv), 0.0), 5.0);
            outgoingLight = mix(outgoingLight, refl, F * 0.9 * (1.0 - foamAmt));
          }
          #include <opaque_fragment>`);
    };
    return m;
  };
  const nearMat = makeMat(1), farMat = makeMat(0);
  const near = new THREE.Mesh(new THREE.PlaneGeometry(2048, 2048, 220, 220).rotateX(-Math.PI / 2), nearMat);
  near.frustumCulled = false; near.receiveShadow = true;
  const ringGeo = new THREE.BufferGeometry();
  const H = 1024, O = 45000;
  const quads = [[-O, -O, O, -H], [-O, H, O, O], [-O, -H, -H, H], [H, -H, O, H]];
  const pos = [], idx = [], nrm = [];
  quads.forEach((q, i) => { const b = i * 4; pos.push(q[0], 0, q[1], q[2], 0, q[1], q[0], 0, q[3], q[2], 0, q[3]); nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0); idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); });
  ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ringGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); ringGeo.setIndex(idx);
  const far = new THREE.Mesh(ringGeo, farMat);
  far.frustumCulled = false;
  scene.add(near); scene.add(far);

  // ---- planar reflections (High quality): mirror the camera across the water plane
  const mirror = new THREE.PerspectiveCamera();
  mirror.layers.set(0);
  let rt = null;
  const plane = new THREE.Plane(), clipPlane = new THREE.Vector4(), qv = new THREE.Vector4(), rotM = new THREE.Matrix4();
  const view = new THREE.Vector3(), target = new THREE.Vector3(), lookAt = new THREE.Vector3(), camPos = new THREE.Vector3(), refPos = new THREE.Vector3(), nrmUp = new THREE.Vector3(0, 1, 0);
  function renderReflection(renderer, scene, camera, hide) {
    if (!shared.uPlanar.value) return;
    const w = Math.max(256, Math.floor(renderer.domElement.width * 0.5)), h = Math.max(256, Math.floor(renderer.domElement.height * 0.5));
    if (!rt || rt.width !== w || rt.height !== h) { if (rt) rt.dispose(); rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }); shared.tReflect.value = rt.texture; }
    camPos.setFromMatrixPosition(camera.matrixWorld);
    refPos.set(camPos.x, 0, camPos.z);
    view.subVectors(refPos, camPos);
    if (view.dot(nrmUp) > 0) return;
    view.reflect(nrmUp).negate().add(refPos);
    rotM.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rotM).add(camPos);
    target.subVectors(refPos, lookAt).reflect(nrmUp).negate().add(refPos);
    mirror.position.copy(view);
    mirror.up.set(0, 1, 0).applyMatrix4(rotM).reflect(nrmUp);
    mirror.lookAt(target);
    mirror.far = 9000; mirror.near = camera.near; mirror.fov = camera.fov; mirror.aspect = camera.aspect;
    mirror.updateMatrixWorld(); mirror.updateProjectionMatrix();
    shared.uTexMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
    plane.setFromNormalAndCoplanarPoint(nrmUp, refPos).applyMatrix4(mirror.matrixWorldInverse);
    clipPlane.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = mirror.projectionMatrix.elements;
    qv.x = (Math.sign(clipPlane.x) + pm[8]) / pm[0]; qv.y = (Math.sign(clipPlane.y) + pm[9]) / pm[5]; qv.z = -1; qv.w = (1 + pm[10]) / pm[14];
    clipPlane.multiplyScalar(2 / clipPlane.dot(qv));
    pm[2] = clipPlane.x; pm[6] = clipPlane.y; pm[10] = clipPlane.z + 1 - 0.003; pm[14] = clipPlane.w;
    near.visible = far.visible = false;
    const hidden = hide.filter(o => o.visible); hidden.forEach(o => o.visible = false);
    const old = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, mirror);
    renderer.setRenderTarget(old);
    near.visible = far.visible = true; hidden.forEach(o => o.visible = true);
  }

  function update(dt, t, camPos, focus) {
    const step = 2048 / 220;
    const cx = Math.round(camPos.x / step) * step, cz = Math.round(camPos.z / step) * step;
    near.position.set(cx, 0, cz); far.position.set(cx, 0, cz);
    shared.uCenter.value.set(cx, cz);
    shared.uTime.value = t;
    shared.uChop.value = waveState.chop;
    wake.recenter(focus.x, focus.z);
    wake.update(dt);
    shared.uWake.value.set(wake.cx, wake.cz, wake.size);
  }
  function setPlanar(on) { shared.uPlanar.value = on ? 1 : 0; nearMat.envMapIntensity = farMat.envMapIntensity = on ? 0.35 : 1.0; }
  return { update, wake, renderReflection, setPlanar, meshes: [near, far] };
}

// FoamField from jetskirider src/water.js (only this class). A scrolling render
// target that follows the ski: anything can stamp white water into it (R = white
// foam, G = aerated milky water) and it slowly fades, spreads and breaks up.

import * as THREE from '../../vendor/three.module.min.js';

const FOAM_SIZE = 300; // metres covered by the foam map
const FOAM_RES = 1024;
const MAX_STAMPS = 6000;

export class FoamField {
  constructor(renderer) {
    this.renderer = renderer;
    this.size = FOAM_SIZE;
    this.res = FOAM_RES;
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(this.res, this.res, opts);
    this.rtB = new THREE.WebGLRenderTarget(this.res, this.res, opts);
    this.center = new THREE.Vector2(0, 0);
    this.prevCenter = new THREE.Vector2(0, 0);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.decayMat = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { value: null },
        uShift: { value: new THREE.Vector2() },
        uTexel: { value: 1 / this.res },
        uDecayR: { value: 1 },
        uDecayG: { value: 1 },
        uSub: { value: 0 },
        uBlur: { value: 0.01 },
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPrev;
        uniform vec2 uShift;
        uniform float uTexel, uDecayR, uDecayG, uSub, uBlur;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv + uShift;
          vec2 e = vec2(uTexel * 0.85, 0.0);
          vec4 c = texture2D(uPrev, uv) * (1.0 - 4.0 * uBlur)
                 + (texture2D(uPrev, uv + e.xy) + texture2D(uPrev, uv - e.xy)
                 +  texture2D(uPrev, uv + e.yx) + texture2D(uPrev, uv - e.yx)) * uBlur;
          vec2 inb = step(vec2(0.002), uv) * step(uv, vec2(0.998));
          c *= inb.x * inb.y;
          c.r = max(min(c.r, 2.2) * uDecayR - uSub, 0.0);
          c.g = max(min(c.g, 1.6) * uDecayG - uSub * 0.3, 0.0);
          gl_FragColor = c;
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.decayMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    // stamps
    this.stampPos = new Float32Array(MAX_STAMPS * 3); // x, z, radius
    this.stampDat = new Float32Array(MAX_STAMPS * 2); // foam, aeration
    this.stampCount = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.stampPos, 3);
    this.aDat = new THREE.BufferAttribute(this.stampDat, 2);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aDat.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aDat', this.aDat);
    this.stampGeo = g;
    this.stampMat = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: this.center },
        uSize: { value: this.size },
        uRes: { value: this.res },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      vertexShader: /* glsl */ `
        attribute vec2 aDat;
        uniform vec2 uCenter;
        uniform float uSize, uRes;
        varying vec2 vDat;
        void main() {
          vDat = aDat;
          vec2 ndc = (position.xy - uCenter) / uSize * 2.0;
          gl_Position = vec4(ndc, 0.0, 1.0);
          gl_PointSize = max(position.z / uSize * uRes * 2.0, 1.5);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vDat;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.15, d);
          gl_FragColor = vec4(vDat.x * a, vDat.y * a, 0.0, 0.0);
        }`,
    });
    this.points = new THREE.Points(g, this.stampMat);
    this.points.frustumCulled = false;
    this.stampScene = new THREE.Scene();
    this.stampScene.add(this.points);
    this.clear();
  }

  get texture() {
    return this.rtA.texture;
  }

  clear() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const cc = new THREE.Color();
    r.getClearColor(cc);
    const ca = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rtA);
    r.clear();
    r.setRenderTarget(this.rtB);
    r.clear();
    r.setRenderTarget(prev);
    r.setClearColor(cc, ca);
    this.stampCount = 0;
  }

  // radius in metres; foam = white-water amount, aer = aerated turquoise amount
  stamp(x, z, radius, foam, aer = foam * 0.5) {
    if (this.stampCount >= MAX_STAMPS) return;
    const i = this.stampCount++;
    this.stampPos[i * 3] = x;
    this.stampPos[i * 3 + 1] = z;
    this.stampPos[i * 3 + 2] = radius;
    this.stampDat[i * 2] = foam;
    this.stampDat[i * 2 + 1] = aer;
  }

  update(focusX, focusZ, dt) {
    const r = this.renderer;
    const texel = this.size / this.res;
    this.prevCenter.copy(this.center);
    const nx = Math.round(focusX / texel) * texel;
    const nz = Math.round(focusZ / texel) * texel;
    // decay + scroll: A -> B
    const u = this.decayMat.uniforms;
    u.uPrev.value = this.rtA.texture;
    u.uShift.value.set((nx - this.prevCenter.x) / this.size, (nz - this.prevCenter.y) / this.size);
    u.uDecayR.value = Math.exp(-dt / 4.2);
    u.uDecayG.value = Math.exp(-dt / 11);
    u.uSub.value = dt * 0.02;
    u.uBlur.value = Math.min(0.08, dt * 0.9);
    this.center.set(nx, nz);
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.rtB);
    r.render(this.quadScene, this.cam);
    if (this.stampCount > 0) {
      this.stampGeo.setDrawRange(0, this.stampCount);
      this.aPos.clearUpdateRanges();
      this.aDat.clearUpdateRanges();
      this.aPos.addUpdateRange(0, this.stampCount * 3);
      this.aDat.addUpdateRange(0, this.stampCount * 2);
      this.aPos.needsUpdate = true;
      this.aDat.needsUpdate = true;
      r.render(this.stampScene, this.cam);
    }
    this.stampCount = 0;
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    const t = this.rtA;
    this.rtA = this.rtB;
    this.rtB = t;
  }
}

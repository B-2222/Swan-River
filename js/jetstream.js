// The rooster tail as a continuous jet of water: a ribbon tube through "core" water parcels fired from the
// nozzle. Parcels fly ballistically (gravity + air drag), so the visible plume is the real streakline left
// behind a moving ski. As parcels age the stream thickens and breaks up into droplets (handed to Spray).
import * as THREE from '../vendor/three.module.min.js';

const R = 12; // vertices around the tube

export class JetStream {
  constructor(scene, max = 64) {
    this.max = max;
    this.cores = []; // newest first: {p: Vector3, v: Vector3, age, life, scale}
    this.emitT = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * R * 3);
    this.nrm = new Float32Array(max * R * 3);
    this.att = new Float32Array(max * R * 3); // alpha, along, around
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAtt', new THREE.BufferAttribute(this.att, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < max - 1; i++) for (let k = 0; k < R; k++) {
      const a = i * R + k, b = i * R + (k + 1) % R, c = (i + 1) * R + k, d = (i + 1) * R + (k + 1) % R;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geo = g;
    this.uniforms = { uTime: { value: 0 }, uLight: { value: 1 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uTint: { value: new THREE.Color(1, 1, 1) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 aAtt; varying vec3 vAtt; varying vec3 vN; varying vec3 vWP;
        void main() { vAtt = aAtt; vN = normal; vWP = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uTime, uLight; uniform vec3 uSun, uTint; varying vec3 vAtt; varying vec3 vN; varying vec3 vWP;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          #include <logdepthbuf_fragment>
          vec3 V = normalize(cameraPosition - vWP);
          vec3 N = normalize(vN);
          float facing = abs(dot(N, V));
          // streaks running along the jet, churning as it flies
          float s = vnoise(vec2(vAtt.z * 7.0, vAtt.y * 16.0 - uTime * 11.0)) * 0.55 + vnoise(vec2(vAtt.z * 21.0, vAtt.y * 41.0 - uTime * 17.0)) * 0.45;
          float a = vAtt.x * (0.25 + 0.75 * facing) * smoothstep(0.25, 0.8, s + vAtt.x * 0.25);
          if (a < 0.01) discard;
          float lit = 0.55 + 0.45 * max(dot(N, uSun), 0.0) + 0.25 * pow(max(dot(-V, uSun), 0.0), 6.0);
          vec3 col = mix(vec3(0.62, 0.74, 0.80), vec3(0.97, 0.99, 1.0), s) * lit * uTint * (0.3 + 0.7 * uLight);
          gl_FragColor = vec4(col, clamp(a, 0.0, 0.8));
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.t1 = new THREE.Vector3(); this.b1 = new THREE.Vector3(); this.b2 = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
  }
  // src: {on, x, y, z, vx, vy, vz, scale}
  update(dt, src, spray, light, sunDir, tint) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uLight.value = light;
    if (sunDir) this.uniforms.uSun.value.copy(sunDir);
    if (tint) this.uniforms.uTint.value.copy(tint);
    if (src && src.on) {
      this.emitT -= dt;
      while (this.emitT <= 0) {
        this.emitT += 1 / 45;
        if (this.cores.length >= this.max) this.cores.pop();
        const j = 0.9 + Math.random() * 0.2;
        this.cores.unshift({ p: new THREE.Vector3(src.x, src.y, src.z), v: new THREE.Vector3(src.vx * j + (Math.random() - 0.5) * 1.2, src.vy * (0.92 + Math.random() * 0.12), src.vz * j + (Math.random() - 0.5) * 1.2),
          age: 0, scale: src.scale * (0.75 + Math.random() * 0.5), life: 1.0, chain: true });
      }
    } else if (this.cores.length) this.cores[0].chain = false; // break the chain so a new burst starts a new tube
    const drag = Math.exp(-1.1 * dt);
    for (const c of this.cores) {
      c.age += dt;
      c.v.x *= drag; c.v.z *= drag; c.v.y = c.v.y * drag - 9.81 * dt;
      c.p.addScaledVector(c.v, dt);
      // the stream breaks up into droplets as it ages and falls
      if (spray && c.age > 0.1 && Math.random() < dt * (20 + c.age * 40)) {
        const n = 2 + (Math.random() < 0.5 ? 1 : 0);
        for (let k = 0; k < n; k++) spray.emit(c.p.x + (Math.random() - 0.5) * c.scale, c.p.y, c.p.z + (Math.random() - 0.5) * c.scale,
          c.v.x + (Math.random() - 0.5) * 3, c.v.y + (Math.random() - 0.3) * 2, c.v.z + (Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.6 * c.scale, 0.9 + Math.random() * 0.6);
      }
    }
    this.cores = this.cores.filter(c => c.age < c.life && !(c.p.y < -0.4 && c.v.y < 0));
    // build the tube through the chained cores
    let n = 0;
    const P = this.pos, Nn = this.nrm, A = this.att;
    for (let i = 0; i < this.cores.length; i++) {
      const c = this.cores[i];
      if (i > 0 && !this.cores[i - 1].chain) break;
      const prev = this.cores[Math.max(0, i - 1)].p, next = this.cores[Math.min(this.cores.length - 1, i + 1)].p;
      this.t1.subVectors(prev, next); if (this.t1.lengthSq() < 1e-6) this.t1.set(0, 1, 0); this.t1.normalize();
      this.b1.crossVectors(this.t1, this.up); if (this.b1.lengthSq() < 1e-6) this.b1.set(1, 0, 0); this.b1.normalize();
      this.b2.crossVectors(this.b1, this.t1).normalize();
      const r = c.scale * (0.14 + c.age * 1.1);
      const alpha = Math.min(1, c.age / 0.05) * (1 - Math.min(1, Math.max(0, (c.age - 0.25) / 0.4))) * 0.85;
      for (let k = 0; k < R; k++) {
        const a = k / R * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const wob = 1 + 0.18 * Math.sin(k * 2.1 + c.age * 23 + i);
        const nx = (this.b1.x * ca * 1.8 + this.b2.x * sa) * wob, ny = (this.b1.y * ca * 1.8 + this.b2.y * sa) * wob, nz = (this.b1.z * ca * 1.8 + this.b2.z * sa) * wob;
        const o = (n * R + k) * 3;
        P[o] = c.p.x + nx * r; P[o + 1] = c.p.y + ny * r; P[o + 2] = c.p.z + nz * r;
        const l = Math.hypot(nx, ny, nz) || 1;
        Nn[o] = nx / l; Nn[o + 1] = ny / l; Nn[o + 2] = nz / l;
        A[o] = alpha; A[o + 1] = c.age; A[o + 2] = k / R;
      }
      n++;
    }
    this.geo.setDrawRange(0, Math.max(0, n - 1) * R * 6);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true; this.geo.attributes.aAtt.needsUpdate = true;
  }
  clear() { this.cores.length = 0; }
}

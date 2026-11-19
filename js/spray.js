// Rooster tails, carve spray and splashes as a GPU point cloud, plus hit testing against people/cars/boats.
import * as THREE from '../vendor/three.module.min.js';

export class Spray {
  constructor(scene, N = 9000) {
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.age = new Float32Array(N).fill(99);
    this.life = new Float32Array(N).fill(1);
    this.size = new Float32Array(N);
    this.alpha = new Float32Array(N);
    this.src = new Uint8Array(N); // 0 = the player's water, 1 = other boats
    this.next = 0;
    this.light = 1;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr); g.setAttribute('aSize', this.sizeAttr); g.setAttribute('aAlpha', this.alphaAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.uniforms = { uScale: { value: 600 }, uLight: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA; varying float vSeed;
        void main() { vSeed = fract(position.x * 0.37 + position.z * 0.71);
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          vA = aAlpha * smoothstep(1.0, 5.0, -mv.z);
          gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.5), 0.0, 160.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uLight; uniform vec3 uTint; varying float vA; varying float vSeed;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 c = gl_PointCoord - 0.5; float r = length(c);
          if (r > 0.5) discard;
          float n = (sin(atan(c.y, c.x) * 5.0 + vSeed * 30.0) * 0.5 + 0.5) * 0.12;
          float a = smoothstep(0.5, 0.05, r + n * r * 2.0) * vA;
          vec3 col = mix(vec3(0.78, 0.88, 0.95), vec3(1.0), smoothstep(0.4, 0.0, r)) * uTint * (0.35 + 0.65 * uLight);
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, size, life, src = 0) {
    const i = this.next; this.next = (this.next + 1) % this.N;
    this.src[i] = src;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size;
  }
  splash(x, y, z, n, power) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, s = (0.4 + Math.random()) * power;
      this.emit(x, y, z, Math.cos(a) * s, power * (0.8 + Math.random()), Math.sin(a) * s, 0.5 + Math.random() * 0.6, 1.2 + Math.random());
    }
  }
  // foam (optional FoamField): droplets that come down on the water turn it white where they land
  update(dt, light, tint, foam) {
    const g = 9.81, drag = Math.exp(-1.1 * dt);
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.N; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      const o = i * 3;
      this.age[i] += dt;
      V[o] *= drag; V[o + 1] = V[o + 1] * drag - g * dt; V[o + 2] *= drag;
      P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
      if (P[o + 1] < -0.2 && V[o + 1] < 0) {
        if (foam && !this.src[i]) foam.stamp(P[o], P[o + 2], 0.3 + Math.min(this.size[i], 3) * 0.18, 0.22, 0.14);
        this.age[i] = this.life[i]; this.alpha[i] = 0; continue;
      }
      const t = this.age[i] / this.life[i];
      this.alpha[i] = (1 - t) * (t < 0.08 ? t / 0.08 : 1) * 0.8;
      this.size[i] *= 1 + dt * 0.9; // spray spreads into mist
    }
    this.posAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true; this.alphaAttr.needsUpdate = true;
    this.uniforms.uLight.value = light;
    if (tint) this.uniforms.uTint.value.copy(tint);
  }
  // targets: [{x, z, y0, y1, r, hit(count)}]; returns number of targets hit
  hitTest(targets) {
    if (!targets.length) return 0;
    const cell = 4, grid = new Map();
    for (const t of targets) {
      t._n = 0;
      const x0 = Math.floor((t.x - t.r) / cell), x1 = Math.floor((t.x + t.r) / cell);
      const z0 = Math.floor((t.z - t.r) / cell), z1 = Math.floor((t.z + t.r) / cell);
      for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
        const k = i * 73856093 ^ j * 19349663;
        if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t);
      }
    }
    const P = this.pos;
    for (let i = 0; i < this.N; i += 2) {
      if (this.age[i] >= this.life[i] || this.age[i] < 0.05 || this.src[i]) continue;
      const o = i * 3, x = P[o], y = P[o + 1], z = P[o + 2];
      const list = grid.get(Math.floor(x / cell) * 73856093 ^ Math.floor(z / cell) * 19349663);
      if (!list) continue;
      for (const t of list) {
        if (y < t.y0 || y > t.y1) continue;
        const dx = x - t.x, dz = z - t.z;
        if (dx * dx + dz * dz < t.r * t.r) { t._n++; this.age[i] = this.life[i] * 0.9; }
      }
    }
    let hits = 0;
    for (const t of targets) if (t._n > 0) { hits++; t.hit(t._n); }
    return hits;
  }
}

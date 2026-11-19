// Spray: CPU-simulated ballistic droplets drawn as velocity-stretched instanced
// billboards. When a droplet lands it stamps foam into the ocean's foam map,
// which is what turns the water white where spray comes down.
// (Swan River: the only change is the logdepthbuf chunks, because this game's renderer uses a
// logarithmic depth buffer; without them every droplet fails the depth test against the water.)

import * as THREE from '../../vendor/three.module.min.js';

export class Spray {
  constructor({ max = 16000, noiseTex }) {
    this.max = max;
    this.count = 0;
    const n = max;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.foamAmt = new Float32Array(n);
    this.seed = new Float32Array(n);

    this.aPos = new Float32Array(n * 3);
    this.aVel = new Float32Array(n * 3);
    this.aDat = new Float32Array(n * 4);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.bPos = new THREE.InstancedBufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.bVel = new THREE.InstancedBufferAttribute(this.aVel, 3).setUsage(THREE.DynamicDrawUsage);
    this.bDat = new THREE.InstancedBufferAttribute(this.aDat, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.bPos);
    g.setAttribute('iVel', this.bVel);
    g.setAttribute('iDat', this.bDat);
    g.instanceCount = 0;
    this.geometry = g;
    this.uniforms = {
      uNoise: { value: noiseTex },
      uLit: { value: new THREE.Color(1, 1, 1) },
      uShade: { value: new THREE.Color(0.6, 0.7, 0.8) },
      uStretch: { value: 0.034 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 iPos;
        attribute vec3 iVel;
        attribute vec4 iDat; // age01, size, seed, alpha
        uniform float uStretch;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vSeed;
        void main() {
          float size = iDat.y;
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
          float sp = length(vv.xy);
          vec2 d = sp > 0.001 ? vv.xy / sp : vec2(0.0, 1.0);
          float st = min(sp * uStretch, size * 3.0);
          vec2 c = position.xy;
          mv.xy += d * c.y * (size + st) + vec2(d.y, -d.x) * c.x * size;
          gl_Position = projectionMatrix * mv;
          vUv = c + 0.5;
          // thin out droplets that are stretched so streaks do not over-brighten
          vAlpha = iDat.w * size / (size + st * 0.3);
          vSeed = iDat.z;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uNoise;
        uniform vec3 uLit;
        uniform vec3 uShade;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vSeed;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p = vUv * 2.0 - 1.0;
          float r = dot(p, p);
          if (r > 1.0) discard;
          vec2 o = vec2(vSeed * 3.17, vSeed * 7.31);
          float n = texture2D(uNoise, vUv * 0.55 + o).r;
          float fine = texture2D(uNoise, vUv * 1.7 + o.yx).a;
          float lace = texture2D(uNoise, vUv * 0.8 + o * 1.7).b;
          // broken, clumpy coverage instead of a soft puff: reads as thrown water
          float d = n * 0.55 + fine * 0.3 + lace * 0.3;
          // ragged outline: push the edge in and out with noise so droplets
          // are never clean discs
          float rr = r * (0.55 + 1.5 * n);
          float a = smoothstep(1.0, 0.25, rr) * smoothstep(0.4, 0.76, d + (1.0 - rr) * 0.42);
          a *= vAlpha;
          float l = clamp(0.58 + 0.42 * p.y + (n - 0.5) * 0.9, 0.0, 1.0);
          gl_FragColor = vec4(mix(uShade, uLit, l), clamp(a, 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  setLight(tod) {
    const s = tod.sun;
    const k = tod.ambient;
    this.uniforms.uLit.value.setRGB(0.72 * k + 0.4 * s[0], 0.74 * k + 0.4 * s[1], 0.76 * k + 0.4 * s[2]);
    this.uniforms.uShade.value.setRGB(
      (0.34 * tod.zenith[0] + 0.3 * tod.horizon[0] + 0.2) * k,
      (0.34 * tod.zenith[1] + 0.3 * tod.horizon[1] + 0.22) * k,
      (0.34 * tod.zenith[2] + 0.3 * tod.horizon[2] + 0.25) * k
    );
  }

  clear() {
    this.count = 0;
  }

  // opts: grav (1), drag (0.3), alpha (0.9), foam (0..1 foam stamped on landing)
  emit(x, y, z, vx, vy, vz, life, s0, s1, grav = 1, drag = 0.3, alpha = 0.9, foam = 0.3) {
    let i = this.count;
    if (i >= this.max) {
      // recycle a random particle when saturated
      i = (Math.random() * this.max) | 0;
    } else this.count++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    this.grav[i] = grav; this.drag[i] = drag; this.alpha[i] = alpha;
    this.foamAmt[i] = foam;
    this.seed[i] = Math.random();
  }

  // surfaceAt(x, z) -> water (or ground) height. bound: nothing is above this.
  update(dt, surfaceAt, bound, foam) {
    const { px, py, pz, vx, vy, vz, age, life, s0, s1, grav, drag, alpha, foamAmt, seed } = this;
    const P = this.aPos, V = this.aVel, D = this.aDat;
    let n = this.count;
    let i = 0;
    while (i < n) {
      let a = age[i] + dt;
      let dead = a >= life[i];
      if (!dead) {
        const dk = Math.max(0, 1 - drag[i] * dt);
        vx[i] *= dk; vz[i] *= dk;
        vy[i] = vy[i] * dk - 9.81 * grav[i] * dt;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
        if (py[i] < bound && vy[i] < 0) {
          const h = surfaceAt(px[i], pz[i]);
          if (py[i] < h) {
            dead = true;
            if (foamAmt[i] > 0 && foam) {
              const t = a / life[i];
              const sz = s0[i] + (s1[i] - s0[i]) * Math.sqrt(t);
              foam.stamp(px[i], pz[i], 0.22 + sz * 0.7, foamAmt[i], foamAmt[i] * 0.6);
            }
          }
        }
      }
      if (dead) {
        n--;
        if (i !== n) {
          px[i] = px[n]; py[i] = py[n]; pz[i] = pz[n];
          vx[i] = vx[n]; vy[i] = vy[n]; vz[i] = vz[n];
          age[i] = age[n]; life[i] = life[n]; s0[i] = s0[n]; s1[i] = s1[n];
          grav[i] = grav[n]; drag[i] = drag[n]; alpha[i] = alpha[n]; foamAmt[i] = foamAmt[n]; seed[i] = seed[n];
        }
        continue;
      }
      age[i] = a;
      const t = a / life[i];
      const i3 = i * 3, i4 = i * 4;
      P[i3] = px[i]; P[i3 + 1] = py[i]; P[i3 + 2] = pz[i];
      V[i3] = vx[i]; V[i3 + 1] = vy[i]; V[i3 + 2] = vz[i];
      D[i4] = t;
      D[i4 + 1] = s0[i] + (s1[i] - s0[i]) * Math.sqrt(t);
      D[i4 + 2] = seed[i];
      const fadeIn = t < 0.05 ? t / 0.05 : 1;
      const fo = 1 - t;
      D[i4 + 3] = alpha[i] * fadeIn * Math.min(1, fo * 1.6) * Math.sqrt(fo);
      i++;
    }
    this.count = n;
    this.geometry.instanceCount = n;
    if (n > 0) {
      for (const [b, k] of [[this.bPos, 3], [this.bVel, 3], [this.bDat, 4]]) {
        b.clearUpdateRanges();
        b.addUpdateRange(0, n * k);
        b.needsUpdate = true;
      }
    }
  }
}

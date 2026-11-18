// Sky dome and lighting. Southern hemisphere: the sun rises in the east, crosses the NORTH, sets over the Indian Ocean.
import * as THREE from 'three';

const C = (r, g, b) => new THREE.Color(r, g, b);
const lerpC = (a, b, t) => a.clone().lerp(b, t);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createSky(scene, renderer) {
  const sky = {
    hour: 15.5, sunDir: new THREE.Vector3(), sunColor: C(1, 1, 1), zenith: C(0.2, 0.4, 0.8), horizon: C(0.7, 0.8, 0.9),
    light: 1, night: 0, dayLength: 24 * 60, // real seconds per game day
  };
  const uniforms = {
    uSunDir: { value: sky.sunDir }, uZenith: { value: sky.zenith }, uHorizon: { value: sky.horizon }, uSunColor: { value: sky.sunColor },
    uNight: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;
      void main() { vDir = normalize(position); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSunDir, uZenith, uHorizon, uSunColor; uniform float uNight;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        #include <logdepthbuf_fragment>
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.5));
        if (h < 0.0) col = mix(uHorizon, uHorizon * 0.6, -h * 5.0);
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 1200.0) * 8.0 + pow(sd, 60.0) * 0.25 + pow(sd, 6.0) * 0.12) * step(-0.05, uSunDir.y);
        // horizon glow toward the sun at dusk
        float glow = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 4.0);
        col += uSunColor * glow * (1.0 - smoothstep(0.0, 0.35, h)) * 0.25 * (1.0 - smoothstep(0.1, 0.5, uSunDir.y));
        // stars and moon
        if (uNight > 0.01 && h > 0.0) {
          vec3 g = floor(d * 520.0);
          float hs = hash(g);
          float s = step(0.9986, hs) * (0.4 + 0.6 * fract(hs * 91.7));
          col += vec3(s) * uNight * 0.8 * smoothstep(0.02, 0.25, h);
          vec3 moon = normalize(vec3(-0.4, 0.55, 0.35));
          float md = dot(d, moon);
          col += vec3(0.9, 0.9, 0.8) * smoothstep(0.9993, 0.9996, md) * uNight + vec3(0.1, 0.12, 0.18) * pow(max(md, 0.0), 30.0) * uNight;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(40000, 32, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a5040, 1.2);
  scene.add(sun); scene.add(sun.target); scene.add(hemi);
  scene.fog = new THREE.FogExp2(0xaaccee, 0.00012);

  function update(dt, camPos, advance = true) {
    if (advance) sky.hour = (sky.hour + dt * 24 / sky.dayLength) % 24;
    const t = sky.hour;
    const rise = 5.2, set = 19.1; // Perth in November
    const f = (t - rise) / (set - rise);
    let e, az;
    if (f >= 0 && f <= 1) { e = Math.sin(Math.PI * f) * 1.32; az = Math.PI * f; }   // az 0 = east, pi/2 = north, pi = west
    else {
      const nl = 24 - (set - rise);
      const g = (((t - set) % 24) + 24) % 24 / nl;
      e = -0.4 * Math.sin(Math.PI * g); az = Math.PI + Math.PI * g;
    }
    sky.sunDir.set(Math.cos(az) * Math.cos(e), Math.sin(e), -Math.sin(az) * Math.cos(e)).normalize();
    const day = smooth(-0.12, 0.25, sky.sunDir.y);
    const dusk = smooth(0.45, 0.05, sky.sunDir.y) * smooth(-0.15, 0.02, sky.sunDir.y);
    sky.night = 1 - smooth(-0.2, 0.02, sky.sunDir.y);
    sky.zenith.copy(lerpC(lerpC(C(0.012, 0.02, 0.05), C(0.16, 0.38, 0.82), day), C(0.22, 0.3, 0.6), dusk * 0.5));
    sky.horizon.copy(lerpC(lerpC(C(0.03, 0.05, 0.10), C(0.68, 0.82, 0.95), day), C(1.0, 0.56, 0.32), dusk * 0.8));
    sky.sunColor.copy(lerpC(C(1.0, 0.96, 0.88), C(1.0, 0.52, 0.22), dusk));
    sky.light = 0.18 + 0.82 * day;
    sun.position.copy(camPos).addScaledVector(sky.sunDir, 2000);
    sun.target.position.copy(camPos);
    sun.intensity = 2.8 * day + 0.05;
    sun.color.copy(sky.sunColor);
    hemi.intensity = 0.25 + 1.1 * day;
    hemi.color.copy(lerpC(C(0.25, 0.3, 0.5), C(0.75, 0.85, 1.0), day));
    hemi.groundColor.copy(lerpC(C(0.05, 0.05, 0.06), C(0.42, 0.38, 0.30), day));
    scene.fog.color.copy(sky.horizon).multiplyScalar(0.95);
    scene.fog.density = 0.000105 + sky.night * 0.00006;
    uniforms.uNight.value = sky.night;
    dome.position.copy(camPos);
  }
  sky.update = update;
  sky.sun = sun;
  sky.timeString = () => {
    const h = Math.floor(sky.hour), m = Math.floor((sky.hour - h) * 60);
    const ap = h >= 12 ? 'pm' : 'am'; const hh = ((h + 11) % 12) + 1;
    return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
  };
  return sky;
}

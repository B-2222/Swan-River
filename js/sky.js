// Sky: a deep-blue Perth summer sky with drifting fair-weather clouds, sunsets over the ocean and a starry night.
// It also lights the world through an environment map. Southern hemisphere: the sun crosses the NORTH.
import * as THREE from '../vendor/three.module.min.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lin = (hex) => new THREE.Color(hex); // three converts hex (sRGB) to linear for us

const vert = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vWP;
  void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;
const frag = `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uZenith, uMid, uHorizon, uSunCol, uSunDir, uMoon; uniform float uNight, uTime, uCloud, uDay;
  varying vec3 vWP;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vWP - cameraPosition);
    float y = d.y;
    float up = max(y, 0.0);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, up));
    col = mix(col, uZenith, smoothstep(0.12, 0.75, up));
    float c = max(dot(d, uSunDir), 0.0);
    col += uSunCol * (pow(c, 6.0) * 0.18 + pow(c, 48.0) * 0.45) * uDay;
    col += uSunCol * smoothstep(0.99955, 0.9998, c) * 30.0 * step(-0.02, uSunDir.y);
    // fair-weather cumulus on a flat cloud deck
    if (y > 0.015 && uCloud > 0.0) {
      vec2 uv = d.xz / (y + 0.08) * 1.6 + vec2(uTime * 0.004, uTime * 0.0025);
      float n = fbm(uv);
      float cover = smoothstep(0.55 - uCloud * 0.12, 0.85, n) * smoothstep(0.015, 0.2, y);
      float shade = 0.75 + 0.35 * fbm(uv * 1.7 + 3.1) + pow(c, 4.0) * 0.3;
      vec3 cc = mix(vec3(0.62, 0.66, 0.72), vec3(1.0), shade - 0.4) * (0.03 + 0.97 * uDay) + uSunCol * 0.12 * uDay * (1.0 - uDay) * 4.0 + vec3(0.03, 0.025, 0.02) * uNight;
      col = mix(col, cc, cover * 0.9);
    }
    if (uNight > 0.01) {
      vec3 g = floor(d * 520.0); float hs = hash3(g);
      float s = step(0.9986, hs) * (0.4 + 0.6 * fract(hs * 91.7)) * smoothstep(0.02, 0.25, y);
      float md = dot(d, uMoon);
      col += (vec3(s) * 0.7 + vec3(0.9, 0.9, 0.8) * smoothstep(0.9993, 0.9996, md) * 1.2 + vec3(0.04, 0.05, 0.09) * pow(max(md, 0.0), 24.0)) * uNight;
    }
    if (y < 0.0) col = mix(uHorizon, uHorizon * 0.55, smoothstep(0.0, 0.3, -y));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

function skyMaterial(uniforms) {
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false });
  m.toneMapped = false;
  return m;
}

const P = {
  dayZ: lin(0x1c5fd0), dayM: lin(0x4f8fe0), dayH: lin(0xa9cdef),
  setZ: lin(0x30508f), setM: lin(0x7d8fbf), setH: lin(0xffa565),
  nightZ: lin(0x02040c), nightM: lin(0x050a1a), nightH: lin(0x0c1630),
};
const mixC = (a, b, t) => a.clone().lerp(b, t);

export function createSky(scene, renderer) {
  const sky = { hour: 15.5, sunDir: new THREE.Vector3(0, 1, 0), sunColor: new THREE.Color(1, 1, 1), light: 1, night: 0, dayLength: 24 * 60, envMap: null };
  const uniforms = {
    uZenith: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
    uSunDir: { value: sky.sunDir }, uMoon: { value: new THREE.Vector3(-0.4, 0.55, 0.35).normalize() }, uNight: { value: 0 }, uTime: { value: 0 }, uCloud: { value: 0.55 }, uDay: { value: 1 },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), skyMaterial(uniforms));
  dome.frustumCulled = false; dome.renderOrder = -10;
  scene.add(dome);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMaterial(uniforms)));
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null, lastEnvHour = -99;

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4436, 0.25);
  scene.add(sun); scene.add(sun.target); scene.add(hemi);
  scene.fog = new THREE.FogExp2(0xaaccee, 0.00005);

  function refreshEnv() {
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0, 1, 1000);
    scene.environment = envRT.texture;
    sky.envMap = envRT.texture;
  }

  function update(dt, camPos, advance = true) {
    if (advance) sky.hour = (sky.hour + dt * 24 / sky.dayLength) % 24;
    uniforms.uTime.value += dt;
    const t = sky.hour, rise = 5.2, set = 19.1; // Perth in November
    const f = (t - rise) / (set - rise);
    let e, az;
    if (f >= 0 && f <= 1) { e = Math.sin(Math.PI * f) * 1.32; az = Math.PI * f; } // az 0 = east, pi/2 = north, pi = west
    else { const nl = 24 - (set - rise); const g = ((((t - set) % 24) + 24) % 24) / nl; e = -0.4 * Math.sin(Math.PI * g); az = Math.PI + Math.PI * g; }
    sky.sunDir.set(Math.cos(az) * Math.cos(e), Math.sin(e), -Math.sin(az) * Math.cos(e)).normalize();
    const day = smooth(-0.1, 0.18, sky.sunDir.y);
    const low = (1 - smooth(0.03, 0.35, sky.sunDir.y)) * smooth(-0.15, 0.0, sky.sunDir.y);
    sky.night = 1 - smooth(-0.18, 0.02, sky.sunDir.y);
    uniforms.uNight.value = sky.night; uniforms.uDay.value = day;
    // sunset colours on the western (ocean) side are handled by the glow; the dome blends day, dusk and night
    uniforms.uZenith.value.copy(mixC(mixC(P.nightZ, P.dayZ, day), P.setZ, low * 0.6));
    uniforms.uMid.value.copy(mixC(mixC(P.nightM, P.dayM, day), P.setM, low * 0.7));
    uniforms.uHorizon.value.copy(mixC(mixC(P.nightH, P.dayH, day), P.setH, low * 0.85));
    sky.light = 0.12 + 0.88 * day;
    sky.sunColor.setRGB(1.0, 0.95 - low * 0.4, 0.88 - low * 0.6);
    uniforms.uSunCol.value.copy(sky.sunColor);
    if (sky.sunDir.y > -0.05) {
      sun.position.copy(camPos).addScaledVector(sky.sunDir, 1500);
      sun.color.copy(sky.sunColor);
      sun.intensity = 3.4 * smooth(-0.03, 0.15, sky.sunDir.y);
    } else { // moonlight
      sun.position.copy(camPos).addScaledVector(uniforms.uMoon.value, 1500);
      sun.color.setRGB(0.55, 0.65, 0.9);
      sun.intensity = 0.3 * sky.night;
    }
    sun.target.position.copy(camPos);
    hemi.intensity = 0.15 + 0.2 * day;
    if (Math.abs(sky.hour - lastEnvHour) > 0.2 || lastEnvHour < 0) { lastEnvHour = sky.hour; refreshEnv(); }
    // fog fades distant land into the real horizon colour (fog mixes in display space, so store sRGB values)
    const h = uniforms.uHorizon.value.clone().lerp(uniforms.uMid.value, 0.25);
    const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    scene.fog.color.setRGB(enc(h.r), enc(h.g), enc(h.b), THREE.LinearSRGBColorSpace);
    scene.fog.density = 0.000045 + sky.night * 0.00004 + low * 0.00002;
    dome.position.copy(camPos);
  }
  sky.update = update;
  sky.sun = sun;
  sky.forceEnv = () => { lastEnvHour = -99; };
  sky.timeString = () => {
    const h = Math.floor(sky.hour), m = Math.floor((sky.hour - h) * 60);
    const ap = h >= 12 ? 'pm' : 'am'; const hh = ((h + 11) % 12) + 1;
    return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
  };
  return sky;
}

// People on the foreshore, jetties and bridges, swimmers, Heirisson Island kangaroos, and traffic on the bridges.
import * as THREE from '../vendor/three.module.min.js';
import { W, heightAt, sdfAt, sdfGrad, toXZ, COVER, coverAt } from './world.js';
import { personParts, carGeos, merge, M } from './models.js';

const rnd = (seed) => { let s = (seed * 9301 + 49297) % 233280; return () => (s = (s * 9301 + 49297) % 233280) / 233280; };
const pick = (a, r = Math.random) => a[Math.floor(r() * a.length)];

export const LINES = {
  soaked: ['OI!', 'Ya flamin\' galah!', 'Get off the river, ya hoon!', 'Mate! My phone!', 'Strewth!', 'Not cool, bro!',
    'Fair dinkum?!', 'My hot chips!!', 'That\'s 8 knots, mate!', 'Ya drongo!', 'Rack off!', 'Yeah nah, not cool!', 'Crikey, that\'s cold!',
    'My new kicks!', 'MUM! I got wet!', 'Bloody jet skis...', 'Oi, I just did my hair!', 'You\'re dreamin\', mate!', 'Unreal. Absolutely unreal.'],
  kid: ['AGAIN! AGAIN!', 'That was sick!', 'Do it again!', 'Mum, look!'],
  fisher: ['You scared off me bream!', 'Oi! I had a bite!', 'Spooked the herring, ya goose!', 'Me bait\'s soaked!'],
  tourist: ['My photo!!', 'The boatshed pic is ruined!', 'Is this normal in Perth?!', 'My camera!'],
  cheer: ['Send it!', 'Sick!', 'Yeeew!', 'Mad air!', 'Do a donut!', 'Big rooster tail!', 'Legend!'],
  driver: ['Can\'t see!', 'My windscreen!', 'Oi! Just washed it!', 'What the...!'],
  roo: ['*angry kangaroo noises*', '*thump thump thump*'],
  caller: ['Right. I\'m calling the Water Police.', 'Got you on video, mate. Calling the cops.', 'Hello, Water Police? There\'s a hoon on a jet ski...', 'That\'s going straight to the police.'],
  cop: ['Mate. I\'m a police officer.', 'Wrong bloke to soak, champ.', 'Off duty, not off the clock. Calling it in.'],
};
const HAIR = [0x2b1d14, 0x4a3020, 0x6b4a2b, 0xc9a66b, 0x111111, 0x8a8a8a, 0xa0522d];

const SHIRTS = [0xe63946, 0xf1faee, 0x457b9d, 0x1d3557, 0xffb703, 0x2a9d8f, 0xe76f51, 0x8338ec, 0x06d6a0, 0x222222, 0xffffff, 0xff006e, 0x3a86ff, 0xfb8500];
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x7a4a2a];
const SHORTS = [0x264653, 0x1d3557, 0x3d405b, 0x6c757d, 0xc9ada7, 0x2b2d42, 0x588157];

// --------------------------------------------------------------- spots
function buildSpots() {
  const spots = [];
  const add = (x, z, ang, kind, count, y = null) => spots.push({ x, z, ang, kind, count, y, active: false, people: [] });
  // shoreline parks and beaches (from OSM)
  for (const s of W.json.spots) {
    const sand = s[3] === COVER.SAND;
    add(s[0], s[1], s[2], sand ? 'beach' : 'park', sand ? 3 : 2);
  }
  // jetties and piers: fishermen at the ends and along
  for (const p of W.json.piers) {
    if (!p.line || p.bw) continue;
    const pts = p.line;
    let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (L < 12) continue;
    const e = pts[pts.length - 1], q = pts[pts.length - 2];
    add(e[0], e[1], Math.atan2(e[0] - q[0], e[1] - q[1]), 'jetty', L > 60 ? 4 : 2, 1.3);
  }
  // bridges: fishing off the Fremantle bridges, walkers and cyclists on the shared paths
  for (const b of W.json.bridges) {
    const foot = /footway|cycleway|path/.test(b.kind);
    if (!foot && !/Walyalup|Stirling|Canning Bridge|Causeway/.test(b.name)) continue;
    for (let i = 2; i < b.pts.length - 2; i += 4) {
      const p = b.pts[i], q = b.pts[i + 1];
      const tx = q[0] - p[0], tz = q[1] - p[1], l = Math.hypot(tx, tz) || 1;
      const off = foot ? 0 : b.w / 2 - 1.0;
      add(p[0] - tz / l * off, p[1] + tx / l * off, Math.atan2(-tz, tx), foot ? 'bridgewalk' : 'bridgefish', 1, p[2]);
    }
  }
  // famous crowd spots
  const hot = [
    ['Crawley Edge Boatshed', 115.8263, -31.9740, 'tourist', 9], ['Elizabeth Quay', 115.8580, -31.9577, 'park', 10], ['Barrack Street Jetty', 115.8588, -31.9598, 'park', 8],
    ['Mends Street Jetty', 115.8538, -31.9712, 'park', 6], ['Bathers Beach', 115.7428, -32.0585, 'beach', 9], ['Point Walter', 115.7863, -32.0118, 'beach', 10],
    ['Matilda Bay', 115.8226, -31.9785, 'park', 8], ['Como Beach', 115.8588, -31.9905, 'beach', 7], ['Cottesloe Beach', 115.7522, -31.9960, 'beach', 14],
    ['Bicton Baths', 115.7780, -32.0283, 'beach', 6], ['Sir James Mitchell Park', 115.8440, -31.9700, 'park', 6], ['Claisebrook Cove', 115.8792, -31.9520, 'park', 6],
    ['Heirisson Island', 115.8758, -31.9688, 'roo', 7], ['Optus Stadium', 115.8875, -31.9530, 'park', 8], ['Port Beach', 115.7480, -32.0300, 'beach', 8],
  ];
  for (const [n, lon, lat, kind, c] of hot) {
    const [x, z] = toXZ(lon, lat);
    if (kind === 'tourist') {
      // the Crawley Edge Boatshed sits at the end of its own jetty: line the tourists up along it
      let best = null;
      for (const p of W.json.piers) {
        if (!p.line) continue;
        for (const q of p.line) { const d = Math.hypot(q[0] - x, q[1] - z); if (d < 90 && (!best || d < best.d)) best = { d, p }; }
      }
      if (best) {
        const L = best.p.line;
        for (let k = 0; k < L.length - 1; k++) for (let t = 0.2; t < 1; t += 0.35) {
          const px = L[k][0] + (L[k + 1][0] - L[k][0]) * t, pz = L[k][1] + (L[k + 1][1] - L[k][1]) * t;
          add(px, pz, Math.atan2(-(L[k + 1][1] - L[k][1]), L[k + 1][0] - L[k][0]), 'tourist', 2, 1.3);
        }
        continue;
      }
    }
    // snap to land near the water
    let bx = x, bz = z, best = 1e9;
    for (let r = 40; r <= 240 && best > 1e8; r += 50) for (let k = 0; k < 80; k++) {
      const px = x + (Math.random() - 0.5) * r * 2, pz = z + (Math.random() - 0.5) * r * 2;
      const s = sdfAt(px, pz);
      if (kind === 'roo' ? s > 15 : (s > 1.5 && s < 9)) { const d = Math.hypot(px - x, pz - z); if (d < best) { best = d; bx = px; bz = pz; } }
    }
    if (best > 1e8) continue;
    const g = { x: 0, z: 0 }; sdfGrad(bx, bz, g);
    add(bx, bz, Math.atan2(-g.x, -g.z), kind, c);
  }
  // swimmers off the popular beaches
  const swim = [[115.7860, -32.0098], [115.8592, -31.9915], [115.7505, -31.9958], [115.7790, -32.0290], [115.7430, -32.0592], [115.7500, -32.0300]];
  for (const [lon, lat] of swim) {
    const [x, z] = toXZ(lon, lat);
    for (let k = 0; k < 40; k++) {
      const px = x + (Math.random() - 0.5) * 120, pz = z + (Math.random() - 0.5) * 120;
      const s = sdfAt(px, pz);
      if (s < -4 && s > -16) { add(px, pz, Math.random() * 6.28, 'swim', 3); break; }
    }
  }
  return spots;
}

// --------------------------------------------------------------- people renderer
const CAP = 300;
export class People {
  constructor(scene) {
    this.spots = buildSpots();
    this.grid = new Map();
    this.spots.forEach((s, i) => { const k = Math.floor(s.x / 250) + ',' + Math.floor(s.z / 250); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(i); });
    this.list = [];
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.parts = {};
    for (const [name, geo] of Object.entries(personParts)) {
      const im = new THREE.InstancedMesh(geo, mat, CAP);
      im.count = 0; im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color());
      im.castShadow = true; im.layers.set(1);
      scene.add(im); this.parts[name] = im;
    }
    const rodGeo = new THREE.CylinderGeometry(0.015, 0.02, 2.6, 4).translate(0, 1.3, 0);
    this.rods = new THREE.InstancedMesh(rodGeo, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }), 80);
    this.rods.count = 0; this.rods.frustumCulled = false; this.rods.layers.set(1); scene.add(this.rods);
    this.phones = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.15, 0.015), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x3366aa, emissiveIntensity: 0.4, roughness: 0.2 }), 80);
    this.phones.count = 0; this.phones.frustumCulled = false; this.phones.layers.set(1); scene.add(this.phones);
    const roo = merge([
      { geo: new THREE.SphereGeometry(0.42, 8, 6), color: 0x9a6b45, m: M(0, 0.85, 0, 0.5, 0, 0, 1, 1.4, 1) },
      { geo: new THREE.SphereGeometry(0.17, 8, 6), color: 0x9a6b45, m: M(0, 1.55, -0.28, 0, 0, 0, 1, 1, 1.5) },
      { geo: new THREE.ConeGeometry(0.06, 0.2, 4), color: 0x7a5235, m: M(0.08, 1.75, -0.2) },
      { geo: new THREE.ConeGeometry(0.06, 0.2, 4), color: 0x7a5235, m: M(-0.08, 1.75, -0.2) },
      { geo: new THREE.CylinderGeometry(0.05, 0.12, 1.1, 5), color: 0x8a5d3b, m: M(0, 0.35, 0.65, 1.2) },
      { geo: new THREE.BoxGeometry(0.18, 0.12, 0.6), color: 0x7a5235, m: M(0.16, 0.06, -0.1) },
      { geo: new THREE.BoxGeometry(0.18, 0.12, 0.6), color: 0x7a5235, m: M(-0.16, 0.06, -0.1) },
    ]);
    this.roos = new THREE.InstancedMesh(roo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 30);
    this.roos.count = 0; this.roos.frustumCulled = false; this.roos.castShadow = true; this.roos.layers.set(1); scene.add(this.roos);
    this.timer = 0;
    this.tmpM = new THREE.Matrix4(); this.tmpQ = new THREE.Quaternion(); this.tmpV = new THREE.Vector3(); this.tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
    this.one = new THREE.Vector3(1, 1, 1);
  }
  spawnSpot(s, idx) {
    const r = rnd(idx + 11);
    let n = Math.floor(r() * (s.count + 1));
    if (s.kind === 'tourist' || s.kind === 'roo') n = s.count;
    if ((s.kind === 'park' || s.kind === 'beach') && r() < 0.35) n = 0;
    for (let k = 0; k < n && this.list.length < CAP - 8; k++) {
      const a = r() * 6.283, d = r() * (s.y != null ? 0.7 : (s.kind === 'park' || s.kind === 'beach' ? 8 : 1.5));
      let x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
      let kind = 'stand';
      if (s.kind === 'beach') kind = pick(['stand', 'sit', 'sit', 'walk', 'stand']);
      else if (s.kind === 'park') kind = pick(['stand', 'walk', 'sit', 'stand']);
      else if (s.kind === 'jetty' || s.kind === 'bridgefish') kind = 'fish';
      else if (s.kind === 'bridgewalk') kind = 'walk';
      else if (s.kind === 'tourist') kind = r() < 0.6 ? 'selfie' : 'stand';
      else if (s.kind === 'swim') kind = 'swim';
      else if (s.kind === 'roo') kind = 'roo';
      if (kind !== 'swim' && kind !== 'fish' && s.y == null && sdfAt(x, z) < 1.2) { x = s.x; z = s.z; }
      const y = s.y != null ? s.y : (kind === 'swim' ? -1.15 : Math.max(heightAt(x, z), 0.4));
      const kid = r() < 0.15 && kind !== 'fish';
      // most people just yell; some are filming you and will ring the Water Police, a few are off-duty cops
      const rr = r();
      const role = kid || kind === 'swim' || kind === 'roo' ? 'normal' : rr < (s.kind === 'tourist' ? 0.25 : 0.12) ? 'caller' : rr < (s.kind === 'tourist' ? 0.28 : 0.15) ? 'cop' : 'normal';
      this.list.push({
        spot: idx, x, z, y, home: [x, z], face: s.ang + (r() - 0.5) * 1.2, kind, baseKind: kind, kid,
        role, shirt: new THREE.Color(role === 'cop' ? 0x1b2a4a : pick(SHIRTS, r)), skin: new THREE.Color(pick(SKINS, r)), shorts: new THREE.Color(role === 'cop' ? 0x2a2f38 : pick(SHORTS, r)), hair: new THREE.Color(pick(HAIR, r)),
        phase: r() * 10, walkDir: r() < 0.5 ? 1 : -1, walked: 0, wet: 0, react: 0, fall: 0, cooldown: 0, cheer: 0, flee: 0, onBridge: s.y != null && s.kind !== 'jetty',
      });
    }
    s.active = true;
  }
  update(dt, player, events) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.5;
      const R = 380;
      const cx = Math.floor(player.x / 250), cz = Math.floor(player.z / 250);
      for (let i = cx - 2; i <= cx + 2; i++) for (let j = cz - 2; j <= cz + 2; j++) {
        const L = this.grid.get(i + ',' + j); if (!L) continue;
        for (const idx of L) { const s = this.spots[idx]; if (!s.active && Math.hypot(s.x - player.x, s.z - player.z) < R) this.spawnSpot(s, idx); }
      }
      this.list = this.list.filter(p => {
        const s = this.spots[p.spot];
        if (Math.hypot(s.x - player.x, s.z - player.z) > 470) { s.active = false; return false; }
        return true;
      });
    }
    const t = performance.now() / 1000;
    const g = { x: 0, z: 0 };
    let n = 0, nr = 0, nroo = 0, nph = 0;
    for (const p of this.list) {
      p.cooldown -= dt; p.react -= dt; p.cheer -= dt; p.flee -= dt; p.calling = (p.calling || 0) - dt;
      p.wet = Math.max(0, p.wet - dt * 0.05);
      let walking = false;
      if (p.fall > 0) { p.fall = Math.max(0, p.fall - dt * 0.33); }
      else if (p.flee > 0 && p.kind !== 'swim' && !p.onBridge) {
        sdfGrad(p.x, p.z, g);
        p.face = Math.atan2(-g.x, -g.z) + Math.PI; // face away from the water
        const sp = p.kind === 'roo' ? 6 : 3.2;
        const nx = p.x + g.x * sp * dt, nz = p.z + g.z * sp * dt;
        if (sdfAt(nx, nz) < 60) { p.x = nx; p.z = nz; p.y = Math.max(heightAt(p.x, p.z), 0.4); }
        walking = true;
      } else if (p.kind === 'walk') {
        const fx = Math.sin(p.face), fz = Math.cos(p.face);
        const nx = p.x + fx * 1.3 * dt, nz = p.z + fz * 1.3 * dt;
        p.walked += 1.3 * dt;
        const ok = p.onBridge ? true : (sdfAt(nx, nz) > 2.5 && sdfAt(nx, nz) < 30);
        if (!ok || p.walked > 40) { p.face += Math.PI; p.walked = 0; }
        else { p.x = nx; p.z = nz; if (!p.onBridge) p.y = Math.max(heightAt(p.x, p.z), 0.4); }
        walking = true;
      } else if (p.kind === 'swim') {
        p.x += Math.sin(t * 0.3 + p.phase) * 0.15 * dt; p.y = -1.15 + Math.sin(t * 2 + p.phase) * 0.06;
      } else if (p.kind === 'roo' && Math.random() < dt * 0.15) {
        p.face += (Math.random() - 0.5) * 2;
      }
      if (p.react > 0 || p.cheer > 0) walking = false;
      // build matrices
      if (p.kind === 'roo') {
        if (nroo < 30) {
          const hop = p.flee > 0 ? Math.abs(Math.sin(t * 9 + p.phase)) * 0.6 : 0;
          this.tmpE.set(0, p.face, 0); this.tmpQ.setFromEuler(this.tmpE);
          this.roos.setMatrixAt(nroo++, this.tmpM.compose(this.tmpV.set(p.x, p.y + hop, p.z), this.tmpQ, this.one));
        }
        continue;
      }
      if (n >= CAP) continue;
      const sc = p.kid ? 0.68 : 1;
      const sit = p.kind === 'sit' && p.react <= 0;
      const swim = p.kind === 'swim';
      const lie = p.fall > 0 ? Math.min(1, p.fall * 3) : 0;
      this.tmpE.set(-lie * 1.45, p.face, 0); this.tmpQ.setFromEuler(this.tmpE);
      const base = new THREE.Matrix4().compose(this.tmpV.set(p.x, p.y - (sit ? 0.45 : 0) * sc - lie * 0.1, p.z), this.tmpQ, new THREE.Vector3(sc, sc, sc));
      const ph = t * (walking ? 7 : 1.5) + p.phase;
      const swing = walking ? Math.sin(ph) * 0.6 : 0;
      let aL = walking ? -swing : 0.05, aR = walking ? swing : 0.05, rL = 0.12, rR = -0.12;
      if (p.kind === 'fish') { aR = -1.1; rR = -0.1; }
      const filming = p.role === 'caller' && Math.hypot(p.x - player.x, p.z - player.z) < 160;
      if (filming || p.calling > 0) { aR = p.calling > 0 ? -2.6 : -1.5; rR = p.calling > 0 ? -0.9 : -0.15; }
      if (p.kind === 'selfie') { aR = -2.4; rR = -0.2; }
      if (swim) { aL = Math.sin(t * 2.4 + p.phase) * 2; aR = Math.sin(t * 2.4 + p.phase + Math.PI) * 2; }
      if (p.react > 0) { aL = aR = -2.6; rL = 0.5; rR = -0.5; }               // hands up, cop the spray
      else if (p.cheer > 0) { aL = aR = -2.9 + Math.sin(t * 12 + p.phase) * 0.3; rL = 0.3; rR = -0.3; }
      else if (p.wet > 0.5 && p.cooldown > 0) { aR = -2.7 + Math.sin(t * 14) * 0.4; } // shaking a fist
      const legA = sit ? -1.5 : swing, legB = sit ? -1.5 : -swing;
      const bob = walking ? Math.abs(Math.sin(ph)) * 0.04 : 0;
      const set = (name, m, c) => { const im = this.parts[name]; im.setMatrixAt(n, m); im.setColorAt(n, c); };
      const T = (x, y, z, rx = 0, rz = 0) => base.clone().multiply(new THREE.Matrix4().compose(this.tmpV.set(x, y, z), this.tmpQ.setFromEuler(this.tmpE.set(rx, 0, rz)), this.one));
      const wetShirt = p.wet > 0.3 ? p.shirt.clone().multiplyScalar(0.6) : p.shirt;
      set('torso', T(0, bob, 0), wetShirt);
      set('head', T(0, bob, 0), p.skin);
      set('hair', T(0, bob, 0), p.role === 'cop' ? p.shirt : p.hair);
      set('hips', T(0, bob, 0), p.shorts);
      set('legL', T(0.11, 0.86, 0, legA), p.skin);
      set('legR', T(-0.11, 0.86, 0, legB), p.skin);
      set('armL', T(0.28, 1.46 + bob, 0, aL, rL), p.skin);
      set('armR', T(-0.28, 1.46 + bob, 0, aR, rR), p.skin);
      if ((filming || p.calling > 0) && nph < 80 && p.react <= 0) this.phones.setMatrixAt(nph++, T(-0.28, 1.46 + bob, 0, aR, rR).multiply(new THREE.Matrix4().makeTranslation(0, -0.6, 0.04)));
      if (p.kind === 'fish' && nr < 80 && p.react <= 0) {
        this.rods.setMatrixAt(nr++, T(-0.3, 1.0, -0.35, -0.9, 0));
      }
      p.n = n;
      n++;
    }
    for (const im of Object.values(this.parts)) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    this.rods.count = nr; this.rods.instanceMatrix.needsUpdate = true;
    this.phones.count = nph; this.phones.instanceMatrix.needsUpdate = true;
    this.roos.count = nroo; this.roos.instanceMatrix.needsUpdate = true;
  }
  // spray targets near the player
  targets(player, onHit) {
    const out = [];
    for (const p of this.list) {
      const dx = p.x - player.x, dz = p.z - player.z;
      if (dx * dx + dz * dz > 90 * 90) continue;
      const h = p.kind === 'roo' ? 1.8 : (p.kid ? 1.2 : 1.8);
      out.push({ x: p.x, z: p.z, y0: p.y - 0.4, y1: p.y + h + 0.5, r: 1.4, hit: (cnt) => onHit(p, cnt) });
    }
    return out;
  }
  swimmerNear(x, z, r = 50) {
    for (const p of this.list) if (p.kind === 'swim' && Math.hypot(p.x - x, p.z - z) < r) return true;
    // swimmer spots not yet spawned but within range also count
    return false;
  }
  cheerNear(x, z, r, cb) {
    for (const p of this.list) {
      if (p.kind === 'roo' || p.react > 0 || p.cooldown > 0) continue;
      if (Math.hypot(p.x - x, p.z - z) < r && Math.random() < 0.45) { p.cheer = 2.2; if (cb && Math.random() < 0.15) cb(p); }
    }
  }
}

// --------------------------------------------------------------- traffic
const CAR_COLORS = [0xffffff, 0xf2f2f2, 0x111111, 0x8d99ae, 0xc1121f, 0x1d3557, 0x9a8c98, 0xd4d4d4, 0x2a9d8f, 0xe9c46a, 0x5e6472, 0x3a5a40];
const CAR_CAP = 420;
export class Traffic {
  constructor(scene) {
    this.paths = W.json.traffic.map((t) => {
      const cum = [0];
      for (let i = 1; i < t.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(t.pts[i][0] - t.pts[i - 1][0], t.pts[i][1] - t.pts[i - 1][1]));
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const p of t.pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
      return { ...t, cum, len: cum[cum.length - 1], bbox: [a, b, c, d], cars: null };
    }).filter(p => p.len > 60);
    const g = carGeos();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.45 });
    this.body = new THREE.InstancedMesh(g.body, mat, CAR_CAP);
    this.dark = new THREE.InstancedMesh(g.dark, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.3 }), CAR_CAP);
    for (const im of [this.body, this.dark]) { im.count = 0; im.frustumCulled = false; im.castShadow = true; im.layers.set(1); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); }
    this.body.setColorAt(0, new THREE.Color());
    this.timer = 0; this.active = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.e = new THREE.Euler(); this.one = new THREE.Vector3(1, 1, 1);
  }
  at(path, s, out) {
    const cum = path.cum, P = path.pts;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const t = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
    const a = P[lo], b = P[hi];
    out.x = a[0] + (b[0] - a[0]) * t; out.z = a[1] + (b[1] - a[1]) * t; out.y = a[2] + (b[2] - a[2]) * t;
    out.dx = b[0] - a[0]; out.dz = b[1] - a[1]; out.dy = b[2] - a[2];
    const l = Math.hypot(out.dx, out.dz) || 1; out.dx /= l; out.dz /= l; out.slope = out.dy / l;
    return out;
  }
  update(dt, player) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 1;
      const R = 900;
      this.active = this.paths.filter(p => player.x > p.bbox[0] - R && player.x < p.bbox[2] + R && player.z > p.bbox[1] - R && player.z < p.bbox[3] + R);
      for (const p of this.active) if (!p.cars) {
        p.cars = [];
        const spacing = p.bridge ? 45 : 70;
        for (let s = Math.random() * spacing; s < p.len; s += spacing * (0.6 + Math.random() * 0.9)) {
          const dir = p.oneway ? 1 : (Math.random() < 0.5 ? 1 : -1);
          p.cars.push({ s, dir, speed: p.speed * (0.8 + Math.random() * 0.3), color: new THREE.Color(CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]),
            lane: p.lanes > 1 ? (Math.random() < 0.5 ? 1.8 : 5.2) : 1.9, slow: 0, honk: 0 });
        }
      }
      for (const p of this.paths) if (p.cars && !this.active.includes(p)) p.cars = null;
    }
    const o = {};
    let n = 0;
    this.near = [];
    for (const p of this.active) {
      if (!p.cars) continue;
      for (const c of p.cars) {
        c.slow = Math.max(0, c.slow - dt); c.honk -= dt;
        const sp = c.speed * (c.slow > 0 ? 0.25 : 1);
        c.s += c.dir * sp * dt;
        if (c.s > p.len) c.s -= p.len; if (c.s < 0) c.s += p.len;
        this.at(p, c.s, o);
        // drive on the left
        const lx = o.dz * c.dir, lz = -o.dx * c.dir;
        const off = p.oneway ? (p.lanes > 1 ? c.lane - 3.5 : 0) : c.lane;
        const x = o.x + lx * off, z = o.z + lz * off;
        const dx = x - player.x, dz = z - player.z;
        if (dx * dx + dz * dz > 1000 * 1000 || n >= CAR_CAP) continue;
        const yaw = Math.atan2(-o.dx * c.dir, -o.dz * c.dir);
        this.e.set(Math.atan(o.slope) * c.dir, yaw, 0, 'YXZ'); this.q.setFromEuler(this.e);
        this.m.compose(this.v.set(x, o.y, z), this.q, this.one);
        this.body.setMatrixAt(n, this.m); this.dark.setMatrixAt(n, this.m);
        this.body.setColorAt(n, c.wet > 0 ? c.color.clone().multiplyScalar(0.7) : c.color);
        c.x = x; c.z = z; c.y = o.y;
        if (dx * dx + dz * dz < 110 * 110) this.near.push(c);
        n++;
      }
    }
    this.body.count = this.dark.count = n;
    this.body.instanceMatrix.needsUpdate = true; this.dark.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
  targets(onHit) {
    return (this.near || []).map(c => ({ x: c.x, z: c.z, y0: c.y - 0.5, y1: c.y + 2.6, r: 3.0, hit: (cnt) => onHit(c, cnt) }));
  }
}

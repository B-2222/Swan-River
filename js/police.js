// WA Water Police: patrols, witnessing offences, wanted level, pursuit with A* through the river, PolAir helicopter.
import * as THREE from '../vendor/three.module.min.js';
import { sdfAt, toXZ, waterLOS, W } from './world.js';
import { policeBoat, merge, M } from './models.js';
import { AIBoat } from './boats.js';
import { findPath, navClear, randomWater } from './nav.js';
import { KN } from './jetski.js';

// Amounts from the Western Australian Marine (Infringements) Regulations schedule and DoT/news reporting (see README)
export const FINES = {
  speed: { label: 'Exceeding 8 knots in a speed restricted area', amt: 160 },
  bridge: { label: 'Exceeding 8 knots through a bridge arch', amt: 160 },
  swimmer: { label: 'Exceeding 8 knots within 50 m of a person in the water', amt: 200 },
  night: { label: 'Exceeding 10 knots between sunset and sunrise', amt: 160 },
  freestyle: { label: 'Freestyling / wave jumping outside the Narrows PWC area', amt: 300 },
  reckless: { label: 'Reckless operation of a PWC (soaking people)', amt: 300 },
  police: { label: 'Reckless operation of a PWC (soaking a police vessel)', amt: 300 },
  evade: { label: 'Failing to stop for the Water Police', amt: 0, note: 'Court summons' },
};
const STAR_HEAT = [10, 30, 60, 100, 150];
const COP_LINES = ['WATER POLICE! STOP YOUR VESSEL!', 'Jet ski rider, pull up NOW!', 'Bring it back to idle, mate!', 'We\'ve got your rego!',
  'Engine off, hands on the bars!', 'Stop the vessel immediately!'];

function water(lon, lat) {
  let [x, z] = toXZ(lon, lat);
  if (sdfAt(x, z) > -10) { const p = randomWater(x, z, 250, -15, 80); if (p) [x, z] = p; }
  return [x, z];
}

export class Police {
  constructor(scene, cb) {
    this.scene = scene; this.cb = cb; // cb: {msg, bubble, busted, siren}
    this.units = []; this.heat = 0; this.stars = 0; this.unseen = 99; this.offences = []; this.cool = {};
    this.lastKnown = null; this.bustTimer = 0; this.evadeTimer = 0; this.heli = null; this.flash = 0;
    this.base = water(115.7593, -32.0314); // Fremantle Water Police, North Fremantle
    this.routes = [
      { kind: 'jetboat', pts: [[115.8570, -31.9625], [115.8760, -31.9690], [115.8530, -31.9685], [115.8462, -31.9662], [115.8320, -31.9770]].map(p => water(...p)) },
      { kind: 'rib', pts: [[115.8300, -31.9920], [115.8550, -31.9960], [115.8500, -32.0060], [115.7980, -32.0070], [115.7800, -31.9960]].map(p => water(...p)) },
      { kind: 'patrol', pts: [this.base, water(115.7440, -32.0480), water(115.7250, -32.0560), water(115.7560, -32.0420), water(115.7720, -32.0215)] },
    ];
    for (const r of this.routes) this.addUnit(r.kind, r.pts[0][0], r.pts[0][1], r);
  }
  addUnit(kind, x, z, route = null) {
    const obj = policeBoat(kind);
    const spec = { patrol: [30, 0.5, 2.2], jetboat: [46, 1.25, 4.5], rib: [50, 1.1, 5] }[kind];
    const b = new AIBoat(this.scene, obj, { x, z, yaw: Math.random() * 6.28, max: spec[0] * KN, turn: spec[1], accel: spec[2], L: obj.userData.L, B: obj.userData.B, wakeAmp: kind === 'patrol' ? 0.7 : 0.4 });
    const u = { boat: b, kind, route, ri: 0, state: 'patrol', seen: false, repath: 0, talk: 2 + Math.random() * 3 };
    b.desired = 12 * KN;
    if (route) { u.ri = 1; b.goTo(route.pts[1][0], route.pts[1][1]); }
    this.units.push(u);
    return u;
  }
  starsFor(h) { let s = 0; for (const t of STAR_HEAT) if (h >= t) s++; return s; }
  addHeat(h) {
    const before = this.stars;
    this.heat = Math.min(200, this.heat + h);
    this.stars = this.starsFor(this.heat);
    if (this.stars > before) this.cb.msg(this.stars === 1 ? 'The Water Police are onto you!' : `Wanted level ${this.stars}!`, 'police');
  }
  offence(type, extraHeat = 0) {
    const now = performance.now() / 1000;
    if (this.cool[type] && now - this.cool[type] < 20) return false;
    this.cool[type] = now;
    this.offences.push(type);
    this.addHeat(extraHeat);
    const f = FINES[type];
    this.cb.msg(`Offence: ${f.label}${f.amt ? ` ($${f.amt})` : ''}`, 'bad');
    return true;
  }
  // anyone with eyes on the ski?
  sees(ski, night) {
    const r = night ? 300 : 480;
    for (const u of this.units) {
      const b = u.boat, d = Math.hypot(b.x - ski.x, b.z - ski.z);
      u.dist = d;
      u.seen = d < r && waterLOS(b.x, b.z, ski.x, ski.z);
    }
    let any = this.units.some(u => u.seen);
    if (this.heli && Math.hypot(this.heli.position.x - ski.x, this.heli.position.z - ski.z) < 700) any = true;
    return any;
  }
  report(x, z, heat) { // civilian complaint
    this.addHeat(heat);
    if (!this.lastKnown) this.lastKnown = [x, z];
  }
  update(dt, ski, ctx) {
    const seen = this.sees(ski, ctx.night);
    this.seenNow = seen;
    if (seen) { this.unseen = 0; this.lastKnown = [ski.x, ski.z]; } else this.unseen += dt;
    // ---------------- offences witnessed
    if (seen) {
      if (ctx.speeding) { this.offence(ctx.speeding, 14); this.addHeat(dt * 2.5); }
      if (ctx.freestyle) { if (!this.offence('freestyle', 10)) this.addHeat(3); }
    }
    // ---------------- evasion
    const need = 8 + this.stars * 4;
    if (this.stars > 0 && this.unseen > need) {
      this.heat = Math.max(0, this.heat - dt * 30);
      const s = this.starsFor(this.heat);
      if (s === 0 && this.stars > 0) { this.cb.msg('You lost the Water Police!', 'good'); this.cb.escaped && this.cb.escaped(); this.lastKnown = null; }
      this.stars = s;
    } else if (this.stars === 0) this.heat = Math.max(0, this.heat - dt * 0.6);
    // ---------------- reinforcements
    const want = this.stars === 0 ? 3 : Math.min(8, 3 + this.stars);
    if (this.units.length < want && Math.random() < dt * 0.4) {
      const p = randomWater(ski.x, ski.z, 1200, -12, 60);
      if (p && Math.hypot(p[0] - ski.x, p[1] - ski.z) > 500) {
        const u = this.addUnit(Math.random() < 0.55 ? 'jetboat' : 'rib', p[0], p[1]);
        u.state = 'respond';
        this.cb.msg('More Water Police units responding', 'police');
      }
    }
    if (this.stars === 0 && this.units.length > 3) {
      const extra = this.units.filter(u => !u.route && (u.dist || 0) > 900);
      for (const u of extra.slice(0, this.units.length - 3)) { u.boat.remove(); this.units.splice(this.units.indexOf(u), 1); }
    }
    // ---------------- helicopter
    if (this.stars >= 3 && !this.heli) { this.heli = this.makeHeli(ski); this.cb.msg('PolAir is overhead!', 'police'); }
    if (this.heli) this.updateHeli(dt, ski, ctx);
    if (this.stars < 2 && this.heli && this.unseen > 6) { this.scene.remove(this.heli); this.heli = null; }
    // ---------------- unit AI
    this.flash += dt;
    let nearestPursuer = Infinity;
    for (const u of this.units) {
      const b = u.boat;
      u.repath -= dt; u.talk -= dt;
      const chasing = this.stars > 0 && (u.seen || (u.dist < 1600 && this.lastKnown));
      if (chasing) u.state = 'pursue';
      else if (this.stars > 0 && this.lastKnown) u.state = 'respond';
      else if (u.state !== 'patrol') { u.state = 'patrol'; u.repath = 0; }
      if (u.state === 'pursue') {
        b.desired = b.max;
        const lead = Math.min(1.2, u.dist / 30);
        const tx = (u.seen ? ski.x + ski.vx * lead : this.lastKnown[0]), tz = (u.seen ? ski.z + ski.vz * lead : this.lastKnown[1]);
        if (navClear(b.x, b.z, tx, tz, -4)) { b.path = [[b.x, b.z], [tx, tz]]; b.pi = 1; }
        else if (u.repath <= 0) { u.repath = 2.5; b.path = findPath(b.x, b.z, tx, tz, 90000) || [[b.x, b.z], [tx, tz]]; b.pi = 1; }
        // slow down to match the ski when alongside
        if (u.dist < 25) b.desired = Math.max(ski.speed * 0.9, 3);
        if (u.seen) nearestPursuer = Math.min(nearestPursuer, u.dist);
        if (u.dist < 140 && u.talk <= 0) { u.talk = 4 + Math.random() * 3; this.cb.bubble(b.x, 4, b.z, COP_LINES[Math.floor(Math.random() * COP_LINES.length)], 'cop'); }
      } else if (u.state === 'respond') {
        b.desired = b.max * 0.8;
        if (u.repath <= 0 || b.arrived(40)) {
          u.repath = 4;
          const lk = this.lastKnown || [ski.x, ski.z];
          const p = b.arrived(40) ? (randomWater(lk[0], lk[1], 400, -10) || lk) : lk;
          b.goTo(p[0], p[1]);
        }
      } else {
        b.desired = 12 * KN;
        if (u.route && (b.arrived(40) || u.repath === 0)) {
          u.repath = 1; u.ri = (u.ri + 1) % u.route.pts.length;
          const p = u.route.pts[u.ri]; b.goTo(p[0], p[1]);
        } else if (!u.route && b.arrived(40)) {
          const p = randomWater(b.x, b.z, 800, -15); if (p) b.goTo(p[0], p[1]);
        }
        // pull over warnings for speeding with 0 stars
        if (u.seen && ctx.speeding && u.dist < 200 && u.talk <= 0) { u.talk = 6; this.cb.bubble(b.x, 4, b.z, 'Water Police! Slow it down to 8 knots!', 'cop'); }
      }
      b.update(dt, ctx.wake, ctx.spray, this.units.map(q => q.boat));
      // lights
      const on = u.state !== 'patrol';
      const ph = Math.floor((this.flash + u.boat.x * 0.01) * 6) % 2;
      const glow = ctx.night ? 1.6 : 1.0;
      b.obj.userData.red.color.setRGB(on && ph ? glow : 0.3, 0.02, 0.02);
      b.obj.userData.blue.color.setRGB(0.02, 0.05, on && !ph ? glow : 0.3);
    }
    this.cb.siren(this.stars > 0 ? nearestPursuer : Infinity);
    // ---------------- busted?
    const close = this.units.some(u => u.state === 'pursue' && u.dist < 16);
    if (this.stars > 0 && close && (ski.forwardSpeed < 3 * KN || ski.wipeout > 0)) {
      this.bustTimer += dt;
      if (this.bustTimer > (ski.wipeout > 0 ? 0.8 : 2.2)) { this.bust(); }
    } else this.bustTimer = Math.max(0, this.bustTimer - dt);
    // fail to stop
    if (this.stars > 0 && nearestPursuer < 120 && ski.speed > 10 * KN) {
      this.evadeTimer += dt;
      if (this.evadeTimer > 7) { this.evadeTimer = 0; this.offence('evade', 22); }
    } else this.evadeTimer = Math.max(0, this.evadeTimer - dt * 0.5);
  }
  bust() {
    const list = this.offences.length ? this.offences.slice() : ['speed'];
    this.cb.busted(list);
    this.offences = []; this.heat = 0; this.stars = 0; this.bustTimer = 0; this.lastKnown = null; this.cool = {};
    for (const u of this.units) u.state = 'patrol';
    if (this.heli) { this.scene.remove(this.heli); this.heli = null; }
  }
  // spray hitting a police boat
  targets(onHit) {
    return this.units.filter(u => u.dist < 120).map(u => ({ x: u.boat.x, z: u.boat.z, y0: 0, y1: 4, r: u.boat.B * 0.6 + 1, hit: (n) => onHit(u, n) }));
  }
  makeHeli(ski) {
    const g = new THREE.Group();
    const body = merge([
      { geo: new THREE.SphereGeometry(1.4, 12, 8), color: 0xf4f6f8, m: M(0, 0, 0, 0, 0, 0, 1, 1, 1.7) },
      { geo: new THREE.BoxGeometry(2.9, 0.5, 4.5), color: 0x0b2e8a, m: M(0, -0.2, 0) },
      { geo: new THREE.CylinderGeometry(0.25, 0.45, 5.5, 6), color: 0xf4f6f8, m: M(0, 0.3, 4.6, Math.PI / 2) },
      { geo: new THREE.BoxGeometry(0.15, 1.6, 0.9), color: 0x0b2e8a, m: M(0, 0.9, 7.2) },
      { geo: new THREE.BoxGeometry(0.12, 0.12, 4), color: 0x222222, m: M(1, -1.6, 0) },
      { geo: new THREE.BoxGeometry(0.12, 0.12, 4), color: 0x222222, m: M(-1, -1.6, 0) },
      { geo: new THREE.SphereGeometry(0.9, 8, 6), color: 0x1d2a33, m: M(0, 0.25, -1.4, 0, 0, 0, 1, 0.7, 0.8) },
    ]);
    g.add(new THREE.Mesh(body, new THREE.MeshLambertMaterial({ vertexColors: true })));
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.35), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    rotor.position.y = 1.5; g.add(rotor); g.userData.rotor = rotor;
    const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 70, 16, 1, true).translate(0, -35, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff6d0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    g.add(beam); g.userData.beam = beam;
    g.position.set(ski.x + 400, 90, ski.z + 400);
    this.scene.add(g);
    return g;
  }
  updateHeli(dt, ski, ctx) {
    const h = this.heli, t = performance.now() / 1000;
    const tx = ski.x + Math.cos(t * 0.3) * 45, tz = ski.z + Math.sin(t * 0.3) * 45, ty = 75;
    h.position.x += (tx - h.position.x) * Math.min(1, dt * 0.6);
    h.position.z += (tz - h.position.z) * Math.min(1, dt * 0.6);
    h.position.y += (ty - h.position.y) * Math.min(1, dt * 0.5);
    h.lookAt(ski.x, h.position.y - 20, ski.z);
    h.userData.rotor.rotation.y += dt * 40;
    const beam = h.userData.beam;
    beam.visible = ctx.night > 0.3;
    if (beam.visible) {
      const d = new THREE.Vector3(ski.x - h.position.x, -h.position.y, ski.z - h.position.z);
      const len = d.length();
      beam.scale.set(1, len / 70, 1);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.normalize());
      beam.quaternion.premultiply(h.quaternion.clone().invert());
    }
  }
}

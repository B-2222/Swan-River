// WA Water Police. They respond when:
//  * someone filming you (or an off-duty cop) rings it in after you soak them: a unit is sent to that spot,
//  * a patrol actually SEES you soak someone, spray a police boat or ram one: straight into a pursuit,
//  * you keep speeding or freestyling right in front of a patrol after being warned: they pull you over.
// Ordinary speeding or jumps out of sight do nothing. Break line of sight and stay hidden to escape.
import * as THREE from '../vendor/three.module.min.js';
import { sdfAt, toXZ, waterLOS } from './world.js';
import { policeBoat, merge, M } from './models.js';
import { AIBoat } from './boats.js';
import { findPath, navClear, randomWater } from './nav.js';
import { KN } from './jetski.js';
import { POLICE_BASE } from './static.js';

// Amounts from the WA Marine (Infringements) Regulations schedule and DoT/news reporting (see README)
export const FINES = {
  speed: { label: 'Exceeding 8 knots in a speed restricted area', amt: 160 },
  bridge: { label: 'Exceeding 8 knots through a bridge arch', amt: 160 },
  swimmer: { label: 'Exceeding 8 knots within 50 m of a person in the water', amt: 200 },
  night: { label: 'Exceeding 10 knots between sunset and sunrise', amt: 160 },
  freestyle: { label: 'Freestyling / wave jumping outside the Narrows PWC area', amt: 300 },
  reckless: { label: 'Reckless operation of a PWC (soaking people)', amt: 300 },
  police: { label: 'Reckless operation of a PWC (soaking or ramming a police vessel)', amt: 300 },
  evade: { label: 'Failing to stop for the Water Police', amt: 0, note: 'Court summons' },
};
const STAR_HEAT = [10, 30, 60, 100, 150];
const COP_LINES = ['WATER POLICE! STOP YOUR VESSEL!', 'Jet ski rider, pull up NOW!', 'Bring it back to idle, mate!', 'Engine off, hands on the bars!', 'Stop the vessel immediately!'];
const WARN = { speed: 'Water Police. Slow it down to the limit.', bridge: 'Water Police. 8 knots under the bridge.', swimmer: 'Water Police. Swimmers! Slow down!', night: 'Water Police. 10 knots at night, mate.', freestyle: 'Water Police. No freestyling here. Take it to the PWC area.' };

function water(lon, lat) {
  let [x, z] = toXZ(lon, lat);
  if (sdfAt(x, z) > -10) { const p = randomWater(x, z, 250, -15, 80); if (p) [x, z] = p; }
  return [x, z];
}

export class Police {
  constructor(scene, cb) {
    this.scene = scene; this.cb = cb; // cb: {msg, bubble, busted, siren, escaped}
    this.units = []; this.heat = 0; this.stars = 0; this.unseen = 99; this.offences = []; this.cool = {};
    this.lastKnown = null; this.bustTimer = 0; this.evadeTimer = 0; this.heli = null; this.flash = 0;
    this.call = null; // an open call-out from a member of the public
    this.base = POLICE_BASE.dockX ? [POLICE_BASE.dockX, POLICE_BASE.dockZ] : water(115.7593, -32.0314);
    this.routes = [
      { kind: 'jetboat', pts: [[115.8740, -31.9690], [115.8570, -31.9625], [115.8530, -31.9685], [115.8760, -31.9700]].map(p => water(...p)) },
      { kind: 'rib', pts: [[115.8100, -32.0050], [115.8300, -31.9920], [115.8550, -31.9960], [115.7980, -32.0070]].map(p => water(...p)) },
      { kind: 'patrol', pts: [this.base, water(115.7440, -32.0480), water(115.7250, -32.0560), water(115.7560, -32.0420), water(115.7720, -32.0215)] },
    ];
    for (const r of this.routes) this.addUnit(r.kind, r.pts[0][0], r.pts[0][1], r);
  }
  addUnit(kind, x, z, route = null) {
    const obj = policeBoat(kind);
    const spec = { patrol: [30, 0.5, 2.2], jetboat: [46, 1.25, 4.5], rib: [50, 1.1, 5] }[kind];
    const b = new AIBoat(this.scene, obj, { x, z, yaw: Math.random() * 6.28, max: spec[0] * KN, turn: spec[1], accel: spec[2], L: obj.userData.L, B: obj.userData.B, wakeAmp: kind === 'patrol' ? 0.7 : 0.4 });
    const u = { boat: b, kind, route, ri: 0, state: 'patrol', seen: false, repath: 0, talk: 2 + Math.random() * 3, warned: {}, warnT: 0, soaked: 0, dist: 1e9 };
    b.desired = 12 * KN;
    if (route) { u.ri = 1; b.goTo(route.pts[1][0], route.pts[1][1]); }
    this.units.push(u);
    return u;
  }
  starsFor(h) { let s = 0; for (const t of STAR_HEAT) if (h >= t) s++; return s; }
  setMinStars(n) { if (this.stars < n) { this.heat = Math.max(this.heat, STAR_HEAT[n - 1] + 1); this.updateStars(); } }
  addHeat(h) { this.heat = Math.min(200, this.heat + h); this.updateStars(); }
  updateStars() {
    const before = this.stars;
    this.stars = this.starsFor(this.heat);
    if (this.stars > before) this.cb.msg(this.stars === 1 ? 'The Water Police are onto you!' : `Wanted level ${this.stars}!`, 'police');
  }
  offence(type) {
    const now = performance.now() / 1000;
    if (this.cool[type] && now - this.cool[type] < 20) return false;
    this.cool[type] = now;
    this.offences.push(type);
    const f = FINES[type];
    this.cb.msg(`Offence: ${f.label}${f.amt ? ` ($${f.amt})` : ''}`, 'bad');
    return true;
  }
  sees(ski, night) {
    const r = night ? 300 : 460;
    for (const u of this.units) {
      const b = u.boat, d = Math.hypot(b.x - ski.x, b.z - ski.z);
      u.dist = d;
      u.seen = d < r && waterLOS(b.x, b.z, ski.x, ski.z);
    }
    let any = this.units.some(u => u.seen);
    if (this.heli && Math.hypot(this.heli.position.x - ski.x, this.heli.position.z - ski.z) < 700) any = true;
    return any;
  }
  nearestSeer(max = 300) { let best = null; for (const u of this.units) if (u.seen && u.dist < max && (!best || u.dist < best.dist)) best = u; return best; }
  // a member of the public rang it in
  report(x, z, who) {
    const dispatched = this.units.filter(u => u.state !== 'pursue').sort((a, b) => Math.hypot(a.boat.x - x, a.boat.z - z) - Math.hypot(b.boat.x - x, b.boat.z - z))[0];
    this.call = { x, z, t: 45, unit: dispatched };
    this.lastKnown = [x, z];
    this.offence('reckless');
    this.setMinStars(who === 'cop' ? 2 : 1);
    this.cb.msg(who === 'cop' ? 'You soaked an off-duty cop. Units are on the way!' : 'Someone rang the Water Police on you!', 'police');
    if (dispatched) { dispatched.state = 'respond'; dispatched.repath = 0; }
  }
  // a patrol watched you soak somebody
  witnessedSoak() {
    const u = this.nearestSeer(280);
    if (!u) return false;
    this.offence('reckless');
    this.setMinStars(2);
    u.talk = 4; this.cb.bubble(u.boat.x, 4, u.boat.z, 'We saw that! STOP YOUR VESSEL!', 'cop');
    return true;
  }
  sprayedCop() { this.offence('police'); this.setMinStars(3); }
  rammed() { this.offence('police'); this.setMinStars(2); }

  update(dt, ski, ctx) {
    const seen = this.sees(ski, ctx.night);
    this.seenNow = seen;
    if (seen) { this.unseen = 0; if (this.stars > 0) this.lastKnown = [ski.x, ski.z]; } else this.unseen += dt;
    // ---------------- warnings first, then a pull-over if you keep it up right in front of them
    const near = this.nearestSeer(170);
    if (near && this.stars === 0 && (ctx.speeding || ctx.freestyle)) {
      const kind = ctx.freestyle ? 'freestyle' : ctx.speeding;
      if (!near.warned[kind]) { near.warned[kind] = true; near.talk = 5; this.cb.bubble(near.boat.x, 4, near.boat.z, WARN[kind], 'cop'); this.cb.msg('Water Police warning: ' + WARN[kind].replace('Water Police. ', ''), 'police'); }
      else near.warnT += ctx.freestyle ? 1.5 : dt;
      if (near.warnT > 7) { near.warnT = 0; this.offence(kind); this.setMinStars(1); this.cb.bubble(near.boat.x, 4, near.boat.z, 'Right, that\'s it. Pull over!', 'cop'); }
    }
    for (const u of this.units) if (!u.seen) u.warnT = Math.max(0, u.warnT - dt * 0.2);
    // ---------------- call-outs time out if they never find you
    if (this.call) {
      this.call.t -= dt;
      if (seen) this.call = null;
      else if (this.call.t <= 0) { this.call = null; if (this.stars <= 1) { this.heat = 0; this.stars = 0; this.lastKnown = null; this.cb.msg('The Water Police call-out was stood down', 'good'); } }
    }
    // ---------------- evasion
    const need = 8 + this.stars * 4;
    if (this.stars > 0 && !this.call && this.unseen > need) {
      this.heat = Math.max(0, this.heat - dt * 30);
      const s = this.starsFor(this.heat);
      if (s === 0 && this.stars > 0) { this.cb.msg('You lost the Water Police!', 'good'); this.cb.escaped && this.cb.escaped(); this.lastKnown = null; }
      this.stars = s;
    }
    // ---------------- reinforcements from the Point Direction base (or out of sight nearby)
    const want = this.stars <= 1 ? 3 : Math.min(8, 2 + this.stars);
    if (this.units.length < want && Math.random() < dt * 0.35) {
      const db = Math.hypot(this.base[0] - ski.x, this.base[1] - ski.z);
      const p = db < 3500 ? this.base : randomWater(ski.x, ski.z, 1200, -12, 60);
      if (p && (p === this.base || Math.hypot(p[0] - ski.x, p[1] - ski.z) > 600)) {
        const u = this.addUnit(Math.random() < 0.55 ? 'jetboat' : 'rib', p[0], p[1]);
        u.state = 'respond';
        this.cb.msg(p === this.base ? 'Another unit is leaving the Water Police base' : 'More Water Police units responding', 'police');
      }
    }
    if (this.stars === 0 && this.units.length > 3) {
      const extra = this.units.filter(u => !u.route && u.dist > 900);
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
      u.repath -= dt; u.talk -= dt; u.soaked -= dt; u.drench = Math.max(0, (u.drench || 0) - dt * 15);
      const chasing = this.stars > 0 && (u.seen || (u.dist < 1600 && this.lastKnown && !this.call));
      if (chasing) u.state = 'pursue';
      else if (this.stars > 0 && this.lastKnown && (!this.call || u === this.call.unit || this.stars > 1)) u.state = 'respond';
      else if (u.state !== 'patrol') { u.state = 'patrol'; u.repath = 0; }
      if (u.state === 'pursue') {
        b.desired = b.max;
        const lead = Math.min(1.2, u.dist / 30);
        const tx = u.seen ? ski.x + ski.vx * lead : this.lastKnown[0], tz = u.seen ? ski.z + ski.vz * lead : this.lastKnown[1];
        if (navClear(b.x, b.z, tx, tz, -4)) { b.path = [[b.x, b.z], [tx, tz]]; b.pi = 1; }
        else if (u.repath <= 0) { u.repath = 2.5; b.path = findPath(b.x, b.z, tx, tz, 90000) || [[b.x, b.z], [tx, tz]]; b.pi = 1; }
        if (u.dist < 25) b.desired = Math.max(ski.speed * 0.9, 3);
        if (u.seen) nearestPursuer = Math.min(nearestPursuer, u.dist);
        if (u.dist < 140 && u.talk <= 0) { u.talk = 5 + Math.random() * 3; this.cb.bubble(b.x, 4, b.z, COP_LINES[Math.floor(Math.random() * COP_LINES.length)], 'cop'); }
      } else if (u.state === 'respond') {
        b.desired = b.max * 0.85;
        if (u.repath <= 0 || b.arrived(40)) {
          u.repath = 4;
          const lk = this.lastKnown || [ski.x, ski.z];
          const p = b.arrived(40) ? (randomWater(lk[0], lk[1], 400, -10) || lk) : lk;
          b.goTo(p[0], p[1]);
        }
      } else {
        b.desired = 12 * KN;
        if (u.route && (b.arrived(40) || u.repath === 0)) { u.repath = 1; u.ri = (u.ri + 1) % u.route.pts.length; const p = u.route.pts[u.ri]; b.goTo(p[0], p[1]); }
        else if (!u.route && b.arrived(40)) { const p = randomWater(b.x, b.z, 800, -15); if (p) b.goTo(p[0], p[1]); }
      }
      b.update(dt, ctx.wake, ctx.spray, this.units.map(q => q.boat));
      const on = u.state !== 'patrol';
      const ph = Math.floor((this.flash + u.boat.x * 0.01) * 6) % 2;
      b.obj.userData.red.emissiveIntensity = on && ph ? 6 : 0.05;
      b.obj.userData.blue.emissiveIntensity = on && !ph ? 6 : 0.05;
    }
    this.cb.siren(this.stars > 0 ? nearestPursuer : Infinity);
    // ---------------- pulled over?
    const close = this.units.some(u => u.state === 'pursue' && u.dist < 16);
    if (this.stars > 0 && close && (ski.forwardSpeed < 3 * KN || ski.wipeout > 0)) {
      this.bustTimer += dt;
      if (this.bustTimer > (ski.wipeout > 0 ? 0.8 : 2.2)) this.bust();
    } else this.bustTimer = Math.max(0, this.bustTimer - dt);
    if (this.stars > 0 && nearestPursuer < 120 && ski.speed > 10 * KN) {
      this.evadeTimer += dt;
      if (this.evadeTimer > 7) { this.evadeTimer = 0; if (this.offence('evade')) this.addHeat(22); }
    } else this.evadeTimer = Math.max(0, this.evadeTimer - dt * 0.5);
  }
  bust() {
    const list = this.offences.length ? this.offences.slice() : ['speed'];
    this.cb.busted(list);
    this.clearAll();
    if (this.heli) { this.scene.remove(this.heli); this.heli = null; }
  }
  clearAll() { this.heat = 0; this.stars = 0; this.call = null; this.lastKnown = null; this.offences = []; this.cool = {}; this.bustTimer = 0; for (const u of this.units) { u.state = 'patrol'; u.warned = {}; u.warnT = 0; } }
  targets(onHit) {
    return this.units.filter(u => u.dist < 120).map(u => ({ x: u.boat.x, z: u.boat.z, y0: 0, y1: 4, r: u.boat.B * 0.6 + 1, hit: (n) => onHit(u, n) }));
  }
  makeHeli(ski) {
    const g = new THREE.Group();
    const body = merge([
      { geo: new THREE.SphereGeometry(1.4, 16, 12), color: 0xf4f6f8, m: M(0, 0, 0, 0, 0, 0, 1, 1, 1.7) },
      { geo: new THREE.BoxGeometry(2.9, 0.5, 4.5), color: 0x0b2e8a, m: M(0, -0.2, 0) },
      { geo: new THREE.CylinderGeometry(0.25, 0.45, 5.5, 8), color: 0xf4f6f8, m: M(0, 0.3, 4.6, Math.PI / 2) },
      { geo: new THREE.BoxGeometry(0.15, 1.6, 0.9), color: 0x0b2e8a, m: M(0, 0.9, 7.2) },
      { geo: new THREE.BoxGeometry(0.12, 0.12, 4), color: 0x222222, m: M(1, -1.6, 0) },
      { geo: new THREE.BoxGeometry(0.12, 0.12, 4), color: 0x222222, m: M(-1, -1.6, 0) },
      { geo: new THREE.SphereGeometry(0.9, 10, 8), color: 0x1d2a33, m: M(0, 0.25, -1.4, 0, 0, 0, 1, 0.7, 0.8) },
    ]);
    g.add(new THREE.Mesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2 })));
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.35), new THREE.MeshStandardMaterial({ color: 0x222222 }));
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
    const tx = ski.x + Math.cos(t * 0.3) * 45, tz = ski.z + Math.sin(t * 0.3) * 45;
    h.position.x += (tx - h.position.x) * Math.min(1, dt * 0.6);
    h.position.z += (tz - h.position.z) * Math.min(1, dt * 0.6);
    h.position.y += (75 - h.position.y) * Math.min(1, dt * 0.5);
    h.lookAt(ski.x, h.position.y - 20, ski.z);
    h.userData.rotor.rotation.y += dt * 40;
    const beam = h.userData.beam;
    beam.visible = !!ctx.night;
    if (beam.visible) {
      const d = new THREE.Vector3(ski.x - h.position.x, -h.position.y, ski.z - h.position.z);
      beam.scale.set(1, d.length() / 70, 1);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.normalize());
      beam.quaternion.premultiply(h.quaternion.clone().invert());
    }
  }
}

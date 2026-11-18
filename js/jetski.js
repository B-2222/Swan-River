// Player jet ski as a rigid body on the water.
//
// How a real PWC works (and what this simulates):
// * Water is drawn through an intake grate under the hull, accelerated by the impeller and fired out of the
//   steering nozzle at the stern. Thrust is applied at the nozzle and is limited by engine power at speed.
// * Steering is thrust vectoring: the handlebars swing the nozzle. No throttle means almost no steering,
//   so there is an off-throttle steering assist that gives a short burst of thrust when you turn hard off throttle.
// * Trim tilts the nozzle: trim up lifts the bow (faster, more porpoising, bigger rooster tail), trim down plants it.
// * Braking/reverse (iBR style): a gate drops over the nozzle and redirects thrust forward, as hard as you squeeze.
// * If the intake leaves the water (jumps, big rolls) the pump ventilates: revs flare and thrust disappears.
// * The deep-V planing hull floats on buoyancy at rest, then dynamic pressure lifts it onto the plane.
//   The chines and strakes resist sideways slip, which is what lets it carve. Rider weight leans it into turns.
import * as THREE from '../vendor/three.module.min.js';
import { sdfAt, heightAt, sdfGrad, navigable } from './world.js';
import { waveHeight } from './water.js';
import { jetSkiModel, Rider } from './models.js';
import { Obs } from './static.js';
import { JetStream } from './jetstream.js';

export const KN = 0.514444; // m/s per knot
const RHO = 1000, G = 9.81;
const tmpG = { x: 0, z: 0 };
const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class JetSki {
  constructor(scene, spec) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.jet = new JetStream(scene);
    this.pos = V(); this.vel = V(); this.quat = new THREE.Quaternion(); this.w = V();
    this.events = [];
    this.extraBumps = null;
    this.throttle = 0; this.rpm = 0.1; this.steerA = 0; this.trim = 0; this.gate = 0; this.otas = 0;
    this.air = false; this.airTime = 0; this.spin = 0; this.wipeout = 0; this.drift = 0; this.wet = 1; this.intakeWet = 1;
    this.flipT = 0; this.underBridge = null; this.lastVy = 0; this.thrustNow = 0;
    this._f = V(); this._t = V(); this._r = V(); this._p = V(); this._n = V(); this._vp = V(); this._tmp = V(); this._x = V(); this._q = new THREE.Quaternion();
    this._vt = V(); this._xw = V(); this._fw = V(); this._up = V(); this._ab = V(); this._rn = V(); this._dir = V(); this._ip = V();
    this.setSpec(spec);
  }
  setSpec(spec) {
    this.spec = spec;
    if (this.model) this.group.remove(this.model);
    if (this.rider) this.group.remove(this.rider.g);
    this.model = jetSkiModel(spec);
    this.group.add(this.model);
    this.rider = new Rider({ pfd: 0xff5a0a, shorts: 0x1d3557, shirt: 0x24303d, cap: 0x111111 });
    this.group.add(this.rider.g);
    const L = spec.len, B = spec.beam;
    this.mass = spec.mass + 90; // rider and fuel
    this.power = spec.hp * 745.7;
    this.staticThrust = this.power * 0.021 * spec.accel;
    this.vmax = spec.topKn * KN;
    const H = 0.85;
    this.I = new THREE.Vector3(this.mass / 12 * (L * L + H * H) * 0.75, this.mass / 12 * (L * L + B * B) * 0.75, this.mass / 12 * (B * B + H * H) * 1.1);
    // hull panels: 7 stations x 3 columns over the planing bottom (matches the model's hull lines)
    const hw = (t) => B / 2 * (t < 0.42 ? Math.pow(Math.sin(t / 0.42 * Math.PI / 2), 0.58) : 1 - (t - 0.42) * 0.12);
    const keel = (t) => -0.27 + 0.4 * Math.pow(Math.max(0, 1 - t / 0.38), 2);
    const rail = (t) => 0.27 + 0.2 * Math.pow(Math.max(0, 1 - t / 0.5), 2);
    this.panels = [];
    const ts = [0.07, 0.2, 0.34, 0.48, 0.62, 0.76, 0.9];
    let area = 0;
    const beta = Math.atan(0.4);
    for (const t of ts) {
      const z = -L / 2 + t * L, w = hw(t);
      const dk = (keel(Math.min(1, t + 0.01)) - keel(Math.max(0, t - 0.01))) / (0.02 * L); // slope of the keel line
      for (const c of [-1, 0, 1]) {
        const x = c * w * 0.62, y = keel(t) + Math.abs(x) * 0.4;
        const a = (L / ts.length) * (2 * w / 3);
        const n = new THREE.Vector3(c * Math.sin(beta), -(c ? Math.cos(beta) : 1), dk).normalize();
        this.panels.push({ r: new THREE.Vector3(x, y, z), a, n, dmax: rail(t) - y + 0.8, aft: t });
        area += a;
      }
    }
    this.area = area;
    this.nozzle = new THREE.Vector3(0, -0.06, L / 2 + 0.1);
    this.intake = new THREE.Vector3(0, keel(0.62) + 0.02, -L / 2 + 0.62 * L);
    this.L = L; this.B = B;
  }
  place(x, z, yaw) {
    this.pos.set(x, 0.1, z); this.vel.set(0, 0, 0); this.w.set(0, 0, 0);
    this.quat.setFromAxisAngle(UP, yaw);
    this.wipeout = 0; this.air = false; this.flipT = 0;
    this.rider.g.visible = true;
    this.jet.clear();
  }
  // ---- getters used by the rest of the game
  get x() { return this.pos.x; } get y() { return this.pos.y; } get z() { return this.pos.z; }
  set x(v) { this.pos.x = v; } set z(v) { this.pos.z = v; }
  get vx() { return this.vel.x; } get vz() { return this.vel.z; } get vy() { return this.vel.y; }
  set vx(v) { this.vel.x = v; } set vz(v) { this.vel.z = v; }
  get yaw() { const f = this._x.set(0, 0, -1).applyQuaternion(this.quat); return Math.atan2(-f.x, -f.z); }
  get fwd() { const y = this.yaw; return { x: -Math.sin(y), z: -Math.cos(y) }; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get forwardSpeed() { const f = this.fwd; return this.vel.x * f.x + this.vel.z * f.z; }
  get yawRate() { return this.w.y; }
  get pitch() { const f = this._x.set(0, 0, -1).applyQuaternion(this.quat); return Math.asin(Math.max(-1, Math.min(1, f.y))); }
  get roll() { const r = this._x.set(1, 0, 0).applyQuaternion(this.quat); return Math.asin(Math.max(-1, Math.min(1, -r.y))); }

  surface(x, z) { return waveHeight(x, z, undefined, undefined, true) + (this.extraBumps ? this.extraBumps(x, z) : 0); }

  // one physics sub-step
  step(h, inp) {
    const m = this.mass, q = this.quat;
    const F = this._f.set(0, -m * G, 0), T = this._t.set(0, 0, 0);
    const xw = this._xw.set(1, 0, 0).applyQuaternion(q);
    const fw = this._fw.set(0, 0, -1).applyQuaternion(q);
    const up = this._up.set(0, 1, 0).applyQuaternion(q);
    const slide = this.drift > 0.5;
    let wetA = 0;
    for (const p of this.panels) {
      const r = this._r.copy(p.r).applyQuaternion(q);
      const P = this._p.copy(this.pos).add(r);
      const d = this.surface(P.x, P.z) - P.y;
      if (d <= 0) continue;
      const dd = Math.min(d, p.dmax);
      const wf = Math.min(1, d / 0.06);
      wetA += p.a * wf;
      const n = this._n.copy(p.n).applyQuaternion(q);
      const vp = this._vp.copy(this.w).cross(r).add(this.vel);
      const sp = vp.length();
      const f = this._tmp.set(0, RHO * G * p.a * dd, 0);              // buoyancy
      const un = vp.dot(n);                                            // water rushing into the panel
      let pr = 2400 * un;                                              // heave / pitch / roll damping
      if (un > 0) pr += 0.5 * RHO * 0.26 * sp * un;                    // planing pressure (~ v * v sin(trim))
      f.addScaledVector(n, -pr * p.a * wf);
      const vt = this._vt.copy(vp).addScaledVector(n, -un);           // skin friction
      f.addScaledVector(vt, -0.5 * RHO * 0.0052 * p.a * wf * vt.length());
      const vlat = vp.dot(xw);                                         // chines and strakes bite sideways
      const grip = (slide ? 0.22 : 1) * (p.aft > 0.5 ? 1.4 : 0.3);
      f.addScaledVector(xw, -(0.5 * RHO * 2.4 * Math.abs(vlat) + 900) * vlat * p.a * wf * grip);
      F.add(f);
      T.add(r.cross(f));
    }
    this.wet = wetA / this.area;
    // ---- jet pump
    const ip = this._ip.copy(this.intake).applyQuaternion(q).add(this.pos);
    const di = this.surface(ip.x, ip.z) - ip.y;
    const iw = Math.max(0, Math.min(1, (di + 0.02) / 0.08));
    this.intakeWet += (iw - this.intakeWet) * Math.min(1, h * (iw > this.intakeWet ? 25 : 5));
    const vf = this.vel.dot(fw);
    const thr = this.wipeout > 0 ? 0 : this.throttle;
    const brake = this.wipeout > 0 ? 0 : inp.brake;
    if (thr < 0.08 && Math.abs(inp.steer) > 0.6 && vf > 6 && brake < 0.1) this.otas = Math.min(2, this.otas + h);
    else if (thr > 0.1 || Math.abs(inp.steer) < 0.3) this.otas = 0;
    const assist = this.otas > 0 && this.otas < 1.5 ? 0.3 : 0;
    this.gate += ((brake > 0.05 ? 1 : 0) - this.gate) * Math.min(1, h * 8);
    const want = this.gate > 0.5 ? brake * 0.75 : Math.max(thr, assist);
    const rpmT = Math.max(0.1, want) * (this.intakeWet > 0.3 ? 1 : 1.25);
    this.rpm += (rpmT - this.rpm) * Math.min(1, h * (rpmT > this.rpm ? 5 : 3));
    let thrust = Math.min(this.staticThrust, 0.45 * this.power / Math.max(Math.abs(vf), 1)) * Math.min(1, Math.max(0, this.rpm - 0.1) / 0.9) * this.intakeWet;
    if (vf > this.vmax) thrust *= Math.max(0, 1 - (vf - this.vmax) * 0.6); // electronic top speed limiter
    if (this.gate > 0.5 && vf < 0) thrust *= Math.max(0, Math.min(1, (vf + 2.6) / 1.5)); // reverse tops out around 5 knots
    const delta = this.steerA * 0.38, tau = this.trim * 0.1;
    const dir = this._dir;
    if (this.gate > 0.5) dir.set(-Math.sin(delta) * 0.6, -0.25, Math.cos(delta)).normalize().multiplyScalar(0.5);
    else dir.set(Math.sin(delta), -Math.sin(tau), -Math.cos(delta) * Math.cos(tau));
    dir.applyQuaternion(q).multiplyScalar(thrust);
    const rn = this._rn.copy(this.nozzle).applyQuaternion(q);
    F.add(dir); T.add(rn.cross(dir));
    this.thrustNow = thrust;
    // ---- rider weight shift: lean into turns, kick the stern out in a slide, body english in the air
    const lean = this.wipeout > 0 ? 0 : inp.steer;
    T.addScaledVector(fw, -lean * (this.wet > 0.05 ? 260 : 60));
    if (slide && this.wet > 0.05) T.addScaledVector(up, inp.steer * 700);
    // the hull carves round the swung nozzle: chines plus rider weight turn the thrust into yaw
    if (this.wet > 0.01) T.addScaledVector(up, this.steerA * (thrust * 0.9 + 130 * Math.max(0, vf)) * (this.gate > 0.5 ? -0.5 : 1));
    if (this.wet > 0.02) T.addScaledVector(xw, -this.w.dot(xw) * 1400); // pitch damping from the long planing surface
    if (this.wet < 0.02) { T.addScaledVector(up, inp.steer * 420); T.addScaledVector(xw, -(inp.trim || 0) * 260); }
    // ---- air drag and angular damping
    const v = this.vel.length();
    F.addScaledVector(this.vel, -0.5 * 1.2 * 0.9 * 0.85 * v);
    T.addScaledVector(this.w, this.wet > 0.02 ? -260 : -25);
    // ---- integrate (semi-implicit Euler)
    this.vel.addScaledVector(F, h / m);
    const Tb = T.applyQuaternion(this._q.copy(q).invert());
    const ab = this._ab.set(Tb.x / this.I.x, Tb.y / this.I.y, Tb.z / this.I.z).applyQuaternion(q);
    this.w.addScaledVector(ab, h);
    this.pos.addScaledVector(this.vel, h);
    const wx = this.w.x * h * 0.5, wy = this.w.y * h * 0.5, wz = this.w.z * h * 0.5;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    q.set(qx + (wx * qw + wy * qz - wz * qy), qy + (wy * qw + wz * qx - wx * qz), qz + (wz * qw + wx * qy - wy * qx), qw - (wx * qx + wy * qy + wz * qz)).normalize();
  }

  update(dt, inp, spray, wake, tailScale, light, sunDir, tint) {
    const ev = this.events; ev.length = 0;
    const crashed = this.wipeout > 0;
    this.throttle += ((crashed ? 0 : inp.throttle) - this.throttle) * Math.min(1, dt * 10);
    this.steerA += ((crashed ? 0 : inp.steer) - this.steerA) * Math.min(1, dt * 7);
    this.trim += ((inp.trim || 0) - this.trim) * Math.min(1, dt * 1.5);
    this.drift += ((inp.slide && !crashed && this.speed > 5 ? 1 : 0) - this.drift) * Math.min(1, dt * 6);
    const wasAir = this.air;
    const preVy = this.vel.y;
    if (inp.hop && !crashed && this.wet > 0.02 && this.speed > 3) { // pull the bars and pop the hull out
      this.vel.y += 3.8 + this.speed * 0.04;
      this.w.addScaledVector(this._x.set(1, 0, 0).applyQuaternion(this.quat), 1.1);
      ev.push({ type: 'hop' });
    }
    inp.hop = false;
    const n = Math.max(2, Math.ceil(dt / (1 / 240)));
    for (let i = 0; i < n; i++) this.step(dt / n, inp);
    // ---- airborne bookkeeping
    this.air = this.wet < 0.01;
    if (!this.air) this.dryT = 0; else this.dryT = (this.dryT || 0) + dt;
    if (this.air) { if (!wasAir) { this.airTime = 0; this.spin = 0; } this.airTime += dt; this.spin += this.w.y * dt; this.lastVy = this.vel.y; }
    else if (wasAir && this.airTime > 0.3) {
      const impact = Math.max(0, -this.lastVy);
      const surf = this.surface(this.pos.x, this.pos.z);
      ev.push({ type: 'land', air: this.airTime, impact, spin: this.spin });
      spray.splash(this.pos.x, surf, this.pos.z, Math.min(220, 30 + impact * 18), 1.6 + impact * 0.5);
      const u = this._x.set(0, 1, 0).applyQuaternion(this.quat);
      if ((u.y < 0.3 && this.airTime > 0.5) || impact > 14) this.crash(u.y < 0.3 ? 'Landed it sideways!' : 'Stacked it on landing!');
    }
    if (!this.air && preVy < -2.5 && this.vel.y > -0.5 && this.speed > 8) ev.push({ type: 'slap', power: -preVy });
    // ---- the shore
    const sd = sdfAt(this.pos.x, this.pos.z);
    if (sd > 25) {
      for (let r = 20; r < 3000; r += 20) {
        let found = false;
        for (let a = 0; a < 6.283; a += 0.3) { const px = this.pos.x + Math.cos(a) * r, pz = this.pos.z + Math.sin(a) * r; if (navigable(px, pz, -8)) { this.pos.x = px; this.pos.z = pz; this.vel.set(0, 0, 0); found = true; break; } }
        if (found) break;
      }
    } else if (sd > -1.2) {
      const gh = heightAt(this.pos.x, this.pos.z);
      if (gh > this.pos.y - 0.6) {
        sdfGrad(this.pos.x, this.pos.z, tmpG);
        const push = sd + 1.2;
        this.pos.x -= tmpG.x * push; this.pos.z -= tmpG.z * push;
        const vn = this.vel.x * tmpG.x + this.vel.z * tmpG.z;
        if (vn > 0) {
          this.vel.x -= vn * tmpG.x * 1.4; this.vel.z -= vn * tmpG.z * 1.4;
          this.w.multiplyScalar(0.6);
          if (vn > 10 && !crashed) this.crash(gh > 2 ? 'Ate the river wall!' : 'Beached it!');
          else if (vn > 3) ev.push({ type: 'bump', power: vn });
        }
      }
    }
    // jetties, bridge piers, moored boats, breakwaters
    const p = { x: this.pos.x, z: this.pos.z };
    const hit = Obs.resolve(p, 1.1, this.pos.y);
    if (hit) {
      this.pos.x = p.x; this.pos.z = p.z;
      const vn = -(this.vel.x * hit.nx + this.vel.z * hit.nz);
      if (vn > 0) {
        this.vel.x += hit.nx * vn * 1.3; this.vel.z += hit.nz * vn * 1.3; this.w.multiplyScalar(0.5);
        if (vn > 9 && !crashed) this.crash(hit.kind === 'pier' ? 'Smashed a bridge pylon!' : hit.kind === 'boat' ? 'T-boned a moored boat!' : hit.kind === 'jetty' ? 'Took out a jetty!' : 'Hit the rocks!');
        else if (vn > 2.5) ev.push({ type: 'bump', power: vn });
      }
    }
    // under bridges (and no jumping through the deck)
    const deck = Obs.deckAt(this.pos.x, this.pos.z);
    this.underBridge = deck && deck.y > this.pos.y + 1.5 ? deck : null;
    if (deck && this.pos.y + 1.6 > deck.y - 1.4 && this.pos.y < deck.y - 1.0) { this.vel.y = Math.min(this.vel.y, -1); this.pos.y = deck.y - 3.0; ev.push({ type: 'bump', power: 6 }); }
    // capsized?
    const u = this._x.set(0, 1, 0).applyQuaternion(this.quat);
    if (u.y < 0.15 && !this.air) { this.flipT += dt; if (this.flipT > 0.6 && !crashed) this.crash('Rolled it!'); } else this.flipT = 0;
    if (this.wipeout > 0) {
      this.wipeout -= dt;
      if (this.wipeout <= 0) {
        this.quat.setFromAxisAngle(UP, this.yaw); this.w.set(0, 0, 0);
        this.rider.g.visible = true; ev.push({ type: 'remount' });
      }
    }
    this.emitSpray(dt, spray, wake, tailScale, light, sunDir, tint);
    // ---- visuals
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat);
    const ud = this.model.userData;
    ud.nozzle.rotation.y = this.steerA * 0.38;
    ud.nozzle.rotation.x = -this.trim * 0.1;
    ud.gate.rotation.x = -1.2 + this.gate * 1.25;
    ud.steer.rotation.y = this.steerA * 0.45;
    if (this.wipeout <= 0) this.poseRider(dt);
  }

  poseRider(dt) {
    const ud = this.model.userData, L = this.L, B = this.B;
    const st = this.steerA * 0.45, gz = ud.podZ + 0.08;
    const grip = (sx) => new THREE.Vector3(Math.cos(st) * sx, 1.0, gz - Math.sin(st) * sx);
    this.crouchT = (this.crouchT || 0) + ((this.air ? 0 : Math.min(1, Math.max(0, -this.vel.y * 0.15))) - (this.crouchT || 0)) * Math.min(1, dt * 8);
    const stand = this.air || this.drift > 0.5 ? 0.6 : Math.min(0.35, this.speed / 60);
    this.standT = (this.standT || 0) + (stand - (this.standT || 0)) * Math.min(1, dt * 4);
    const fz = L * 0.03 - this.standT * 0.12;
    this.rider.pose({
      seatY: ud.seatY, seatZ: L * 0.1, gripL: grip(-0.33), gripR: grip(0.33),
      footL: new THREE.Vector3(-B * 0.34, ud.footY + 0.02, fz), footR: new THREE.Vector3(B * 0.34, ud.footY + 0.02, fz),
      lean: this.steerA * 0.9, crouch: this.crouchT, fwd: this.throttle * 0.6 - this.gate * 0.5, stand: this.standT,
    });
  }

  emitSpray(dt, spray, wake, tailScale, light, sunDir, tint) {
    const s = this.spec, q = this.quat;
    const fw = this._fw.set(0, 0, -1).applyQuaternion(q), xw = this._xw.set(1, 0, 0).applyQuaternion(q);
    const spd = this.speed;
    const N = this._rn.copy(this.nozzle).applyQuaternion(q).add(this.pos);
    const surfN = this.surface(N.x, N.z);
    const crashed = this.wipeout > 0;
    // ---- rooster tail: the jet stream slams into the surface behind the ski and erupts in a thick column.
    // It grows when the nozzle rides high (trim up, stern lifted) and when the nozzle is swung in a turn.
    const jet = this.thrustNow / this.staticThrust;
    const exposure = Math.max(0, Math.min(1, (N.y - surfN + 0.3) / 0.35));
    const swing = Math.abs(this.steerA);
    const sf = Math.max(0, Math.min(1, (spd - 1.5) / (this.vmax * 0.7)));
    const on = !crashed && this.intakeWet > 0.3 && this.wet > 0.02 && jet > 0.08 && spd > 2;
    const jd = this._dir.set(-Math.sin(this.steerA * 0.38), 0, Math.cos(this.steerA * 0.38)).applyQuaternion(q); // where the jet water goes
    jd.y = 0; jd.normalize();
    const upV = tailScale * s.tail * (3 + spd * 0.3 + jet * 2.5) * (0.8 + 0.3 * exposure + 0.25 * swing) * Math.min(1, 0.35 + sf);
    const outV = (3 + spd * 0.45) * (0.7 + swing * 0.5); // the jet leaves the nozzle backwards
    this.jet.update(dt, on ? {
      on: true, x: N.x + jd.x * 0.4, y: surfN + 0.15, z: N.z + jd.z * 0.4,
      vx: this.vel.x * 0.3 + jd.x * outV, vy: upV, vz: this.vel.z * 0.3 + jd.z * outV,
      scale: (0.6 + 0.4 * tailScale) * (0.7 + 0.5 * sf) * (s.tail),
    } : null, spray, light, sunDir, tint);
    if (on) {
      // dense droplets around the column so it reads as a thick wall of water
      const rate = 650 * jet * (0.3 + 0.7 * sf) * (0.6 + 0.4 * tailScale) * (0.7 + 0.3 * exposure + 0.3 * swing);
      let n = rate * dt; n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const up = upV * (0.55 + Math.random() * 0.55), out = outV * (0.6 + Math.random() * 0.6);
        spray.emit(N.x + (Math.random() - 0.5) * 0.5, surfN + 0.1, N.z + (Math.random() - 0.5) * 0.5,
          this.vel.x * 0.35 + jd.x * out + (Math.random() - 0.5) * 2.2, up, this.vel.z * 0.35 + jd.z * out + (Math.random() - 0.5) * 2.2,
          0.6 + Math.random() * 0.6 + spd * 0.015, 1.4 + Math.random() * 1.0);
      }
      // chine "wings": the white sheets peeling off both sides of a planing hull
      if (spd > 7) {
        const m = Math.floor(spd * 4 * dt * (0.6 + 0.4 * tailScale)) + (Math.random() < 0.5 ? 1 : 0);
        for (let k = 0; k < m; k++) {
          const sd = Math.random() < 0.5 ? -1 : 1, along = this.L * (0.05 + Math.random() * 0.15);
          const px = this.pos.x + fw.x * along + xw.x * sd * this.B * 0.5, pz = this.pos.z + fw.z * along + xw.z * sd * this.B * 0.5;
          spray.emit(px, this.surface(px, pz) + 0.05, pz, this.vel.x * 0.7 + xw.x * sd * spd * 0.3, 1.2 + spd * 0.07 * Math.random(), this.vel.z * 0.7 + xw.z * sd * spd * 0.3,
            0.3 + Math.random() * 0.25, 0.6 + Math.random() * 0.4);
        }
      }
    }
    // ---- carve sheet: when the hull skids sideways a wall of water flies off the outside rail
    if (!crashed && this.wet > 0.02) {
      const vlat = this.vel.dot(xw);
      const carve = Math.min(1, Math.max(0, (Math.abs(vlat) - 1.5) / 6) + this.drift * 0.5) * Math.min(1, spd / 10);
      if (carve > 0.08) {
        const sd = vlat > 0 ? 1 : -1;
        const m = Math.floor(carve * 800 * dt * (0.6 + 0.4 * tailScale)) + 1;
        for (let k = 0; k < m; k++) {
          const along = (Math.random() - 0.3) * this.L * 0.7;
          const px = this.pos.x + fw.x * along + xw.x * sd * 0.7, pz = this.pos.z + fw.z * along + xw.z * sd * 0.7;
          const out = (5 + spd * 0.75) * (0.6 + Math.random() * 0.6) * (0.7 + 0.3 * tailScale);
          spray.emit(px, this.surface(px, pz) + 0.15, pz, this.vel.x * 0.4 + xw.x * sd * out, (2.5 + spd * 0.22) * (0.6 + Math.random() * 0.7) * (0.8 + 0.2 * tailScale), this.vel.z * 0.4 + xw.z * sd * out,
            0.5 + Math.random() * 0.45, 1.2 + Math.random() * 0.8);
        }
      }
    }
    if (wake && spd > 1 && this.wet > 0.02) {
      const sx = this.pos.x - fw.x * this.L * 0.5, sz = this.pos.z - fw.z * this.L * 0.5;
      wake.stamp(sx, sz, 1.3 + spd * 0.06, Math.min(0.9, 0.25 + spd / 30));
      if (this.drift > 0.4 || Math.abs(this.vel.dot(xw)) > 3) wake.stamp(this.pos.x, this.pos.z, 2.4, 0.6);
    }
  }

  crash(reason) {
    if (this.wipeout > 0) return;
    this.wipeout = 2.8;
    this.events.push({ type: 'crash', reason });
    this.rider.g.visible = false;
  }
}

// chase camera: follows the heading smoothly (ignores the ski's roll and pitch)
export class ChaseCam {
  constructor(camera) { this.cam = camera; this.mode = 0; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.shake = 0; this.init = false; this.yaw = 0; }
  update(dt, ski) {
    const spd = ski.speed;
    let yaw = ski.yaw;
    if (spd > 4) { const vy = Math.atan2(-ski.vx, -ski.vz); let d = vy - yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; yaw += d * 0.35; }
    if (!this.init) this.yaw = yaw;
    let dy = yaw - this.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    this.yaw += dy * Math.min(1, dt * 4.5);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const modes = [[8 + spd * 0.08, 3.2], [15 + spd * 0.1, 5.5], [0, 0], [26, 22]];
    const [dist, h] = modes[this.mode];
    const tgt = new THREE.Vector3();
    const look = new THREE.Vector3(ski.x + fx * (5 + spd * 0.25), Math.max(ski.y, -0.5) + 1.3, ski.z + fz * (5 + spd * 0.25));
    if (this.mode === 2) {
      tgt.copy(new THREE.Vector3(0, 1.75, ski.L * 0.05).applyQuaternion(ski.quat).add(ski.pos)); this.pos.copy(tgt);
      look.copy(new THREE.Vector3(0, 1.2, -30).applyQuaternion(ski.quat).add(ski.pos));
    } else {
      tgt.set(ski.x - fx * dist, Math.max(ski.y, 0) * 0.6 + h, ski.z - fz * dist);
      const gh = Math.max(heightAt(tgt.x, tgt.z), 0);
      if (tgt.y < gh + 1.5) tgt.y = gh + 1.5;
      if (!this.init) { this.pos.copy(tgt); this.look.copy(look); this.init = true; }
      this.pos.lerp(tgt, 1 - Math.exp(-dt * (this.mode === 3 ? 2.5 : 6)));
    }
    this.look.lerp(look, 1 - Math.exp(-dt * 10));
    this.cam.position.copy(this.pos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      this.cam.position.x += (Math.random() - 0.5) * this.shake; this.cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.cam.lookAt(this.look);
    const fovT = 60 + Math.min(16, spd * 0.45);
    this.cam.fov += (fovT - this.cam.fov) * Math.min(1, dt * 3);
    this.cam.updateProjectionMatrix();
  }
}

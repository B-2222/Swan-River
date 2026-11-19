// Player jet ski. The handling is SkiPhysics (js/skiphysics, copied from b-2222/jetskirider): a 6-DOF
// rigid body on 11 hull points with tyre-like lateral grip, a jet pump with thrust vectoring, VTS trim,
// iBR braking, and a power slide where the rider rolls the hull onto its side until the V lets go.
// It floats on the game's own water (js/physworld.js: the same waves the water shader draws, boat
// wakes, the real river bed and land). This file wraps it for the game: input, crashes, the shore,
// jetties, bridges, spray and the 3D model.
//
// Axes: SkiPhysics body +X is the bow, the game model's bow is -Z, so the model sits inside the
// physics body rotated -90 degrees about Y. SkiPhysics steer +1 is right, the game's input steer +1 is left.
import * as THREE from '../vendor/three.module.min.js';
import { sdfAt, heightAt, sdfGrad, navigable } from './world.js';
import { waveHeight, waveState } from './water.js';
import { jetSkiModel, Rider } from './models.js';
import { Obs } from './static.js';
import { JetStream } from './jetstream.js';
import { SkiPhysics } from './skiphysics/physics.js';
import { makePhysWorld, physSpecFor } from './physworld.js';

export const KN = 0.514444; // m/s per knot
const tmpG = { x: 0, z: 0 };
const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const R_MODEL = new THREE.Quaternion().setFromAxisAngle(UP, -Math.PI / 2); // model (bow -Z) -> physics body (bow +X)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class JetSki {
  constructor(scene, spec) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.body = new THREE.Group(); // model + rider, offset so the hull sits right on the physics body
    this.body.quaternion.copy(R_MODEL);
    this.group.add(this.body);
    scene.add(this.group);
    this.jet = new JetStream(scene);
    this.pos = V(); this.vel = V(); this.quat = new THREE.Quaternion(); this.w = V();
    this.events = [];
    this.extraBumps = null;
    this.world = makePhysWorld({ extraBumps: (x, z) => (this.extraBumps ? this.extraBumps(x, z) : 0) });
    this.throttle = 0; this.steerS = 0; this.gate = 0;
    this.air = false; this.airTime = 0; this.spin = 0; this.wipeout = 0; this.drift = 0;
    this.flipT = 0; this.underBridge = null; this.lastVy = 0;
    this._x = V(); this._fw = V(); this._xw = V(); this._rn = V(); this._dir = V(); this._pq = new THREE.Quaternion();
    this.setSpec(spec);
  }
  setSpec(spec) {
    this.spec = spec;
    if (this.model) this.body.remove(this.model);
    if (this.rider) this.body.remove(this.rider.g);
    this.model = jetSkiModel(spec);
    this.body.add(this.model);
    this.rider = new Rider({ pfd: 0xff5a0a, shorts: 0x1d3557, shirt: 0x24303d, cap: 0x111111 });
    this.body.add(this.rider.g);
    this.pspec = physSpecFor(spec);
    const keep = this.phys;
    this.phys = new SkiPhysics(this.pspec, this.world);
    if (keep) {
      for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'qx', 'qy', 'qz', 'qw', 'wx', 'wy', 'wz', 'time']) this.phys[k] = keep[k];
    }
    this.L = spec.len; this.B = spec.beam;
    this.vmax = this.pspec.top;
    // the model's transom (+Z L/2) on the physics nozzle station (40% of L behind the centre of mass)
    this.offset = new THREE.Vector3(0, -0.15, -(0.5 - 0.4) * this.pspec.L);
    this.body.position.copy(this.offset).applyQuaternion(R_MODEL);
    this.sync();
  }
  place(x, z, yaw) {
    this.phys.time = waveState.time;
    this.phys.reset(x, z, yaw + Math.PI / 2);
    this.phys.trim = 0; this.phys.leanIn = 0; this.steerS = 0;
    this.wipeout = 0; this.air = false; this.flipT = 0; this.drift = 0;
    this.rider.g.visible = true;
    this.jet.clear();
    this.sync();
  }
  sync() {
    const p = this.phys;
    this.pos.set(p.px, p.py, p.pz);
    this.vel.set(p.vx, p.vy, p.vz);
    this.w.set(p.wx, p.wy, p.wz);
    this.quat.copy(this._pq.set(p.qx, p.qy, p.qz, p.qw)).multiply(R_MODEL);
  }
  // a point given in the model's own coordinates (bow -Z) to world space
  local(x, y, z, out = V()) { return out.set(x, y, z).add(this.offset).applyQuaternion(this.quat).add(this.pos); }
  // ---- getters used by the rest of the game
  get tele() { return this.phys.tele; }
  get x() { return this.phys.px; } get y() { return this.phys.py; } get z() { return this.phys.pz; }
  set x(v) { this.phys.px = v; this.pos.x = v; } set z(v) { this.phys.pz = v; this.pos.z = v; }
  get vx() { return this.phys.vx; } get vz() { return this.phys.vz; } get vy() { return this.phys.vy; }
  set vx(v) { this.phys.vx = v; this.vel.x = v; } set vz(v) { this.phys.vz = v; this.vel.z = v; }
  get yaw() { return Math.atan2(-this.phys.fhx, -this.phys.fhz); }
  get fwd() { return { x: this.phys.fhx, z: this.phys.fhz }; }
  get speed() { return Math.hypot(this.phys.vx, this.phys.vz); }
  get forwardSpeed() { return this.phys.vx * this.phys.fhx + this.phys.vz * this.phys.fhz; }
  get yawRate() { return this.phys.wy; }
  get pitch() { return this.phys.tele.pitch; }
  get roll() { return this.phys.tele.roll; }
  get slip() { return this.phys.tele.slip; }
  get wet() { return this.phys.tele.wet; }
  get steerA() { return -this.phys.steerAngle / this.pspec.steerMax; } // game convention: + = left

  surface(x, z) { return waveHeight(x, z, undefined, undefined, true) + (this.extraBumps ? this.extraBumps(x, z) : 0); }

  update(dt, inp, spray, wake, tailScale, light, sunDir, tint) {
    const ev = this.events; ev.length = 0;
    const crashed = this.wipeout > 0;
    const p = this.phys, T = p.tele, c = p.ctrl;
    // ---- controls. Keyboard steering ramps in like the bars being turned (quicker at low speed,
    // snappier when reversing direction) so it is precise instead of all-or-nothing.
    const steerT = crashed ? 0 : -inp.steer;
    const speedN = clamp01(T.speed / this.pspec.top);
    const rate = steerT === 0 ? 7 : Math.sign(steerT) !== Math.sign(this.steerS) && this.steerS !== 0 ? 9 : 5.5 - 2.2 * speedN;
    this.steerS += Math.max(-rate * dt, Math.min(rate * dt, steerT - this.steerS));
    this.throttle += ((crashed ? 0 : inp.throttle) - this.throttle) * Math.min(1, dt * 10);
    c.throttle = crashed ? 0 : inp.throttle;
    c.brake = crashed ? 0 : inp.brake;
    c.steer = this.steerS;
    c.lean = crashed ? 0 : inp.slide ? 1 : inp.back ? -1 : 0; // Shift = throw it into a slide, hold Space = pull back
    c.trimCmd = crashed ? 0 : inp.trim || 0;
    this.gate += ((c.brake > 0.05 ? 1 : 0) - this.gate) * Math.min(1, dt * 8);
    const wasAir = this.air;
    const preVy = p.vy;
    if (inp.hop && !crashed && T.wet > 0.05 && this.speed > 3) { // pull the bars and pop the hull out
      p.vy += 3.4 + this.speed * 0.04;
      p.wx += T.rx * 1.1; p.wy += T.ry * 1.1; p.wz += T.rz * 1.1;
      ev.push({ type: 'hop' });
    }
    inp.hop = false;
    // ---- physics at 240 Hz on the same clock as the water shader
    const n = Math.max(1, Math.min(20, Math.ceil(dt / (1 / 240))));
    p.time = waveState.time - dt;
    for (let i = 0; i < n; i++) p.step(dt / n);
    this.sync();
    // a committed power slide: the hull has let go and is travelling sideways
    const sliding = this.speed > 5 && T.wet > 0.02 && (T.unhooked > 0.3 || Math.abs(T.slip) > 0.45);
    this.drift += ((sliding && !crashed ? 1 : 0) - this.drift) * Math.min(1, dt * 6);
    // ---- airborne bookkeeping
    this.air = T.airborne;
    if (this.air) { if (!wasAir) { this.airTime = 0; this.spin = 0; } this.airTime += dt; this.spin += p.wy * dt; this.lastVy = p.vy; }
    else if (wasAir && this.airTime > 0.3) {
      const impact = Math.max(0, -this.lastVy);
      const surf = this.surface(p.px, p.pz);
      ev.push({ type: 'land', air: this.airTime, impact, spin: this.spin });
      spray.splash(p.px, surf, p.pz, Math.min(220, 30 + impact * 18), 1.6 + impact * 0.5);
      if ((T.uy < 0.3 && this.airTime > 0.5) || impact > 14) this.crash(T.uy < 0.3 ? 'Landed it sideways!' : 'Stacked it on landing!');
    }
    if (!this.air && preVy < -2.5 && p.vy > -0.5 && this.speed > 8) ev.push({ type: 'slap', power: -preVy });
    // ---- the shore
    const sd = sdfAt(p.px, p.pz);
    if (sd > 25) {
      for (let r = 20; r < 3000; r += 20) {
        let found = false;
        for (let a = 0; a < 6.283; a += 0.3) { const px = p.px + Math.cos(a) * r, pz = p.pz + Math.sin(a) * r; if (navigable(px, pz, -8)) { p.reset(px, pz, p.yaw); found = true; break; } }
        if (found) break;
      }
    } else if (sd > -1.2) {
      const gh = heightAt(p.px, p.pz);
      if (gh > p.py - 0.6) {
        sdfGrad(p.px, p.pz, tmpG);
        const push = sd + 1.2;
        p.px -= tmpG.x * push; p.pz -= tmpG.z * push;
        const vn = p.vx * tmpG.x + p.vz * tmpG.z;
        if (vn > 0) {
          p.vx -= vn * tmpG.x * 1.4; p.vz -= vn * tmpG.z * 1.4;
          p.wx *= 0.6; p.wy *= 0.6; p.wz *= 0.6;
          if (vn > 10 && !crashed) this.crash(gh > 2 ? 'Ate the river wall!' : 'Beached it!');
          else if (vn > 3) ev.push({ type: 'bump', power: vn });
        }
      }
    }
    // jetties, bridge piers, moored boats, breakwaters
    const pt = { x: p.px, z: p.pz };
    const hit = Obs.resolve(pt, 1.1, p.py);
    if (hit) {
      p.px = pt.x; p.pz = pt.z;
      const vn = -(p.vx * hit.nx + p.vz * hit.nz);
      if (vn > 0) {
        p.vx += hit.nx * vn * 1.3; p.vz += hit.nz * vn * 1.3; p.wx *= 0.5; p.wy *= 0.5; p.wz *= 0.5;
        if (vn > 9 && !crashed) this.crash(hit.kind === 'pier' ? 'Smashed a bridge pylon!' : hit.kind === 'boat' ? 'T-boned a moored boat!' : hit.kind === 'jetty' ? 'Took out a jetty!' : 'Hit the rocks!');
        else if (vn > 2.5) ev.push({ type: 'bump', power: vn });
      }
    }
    // under bridges (and no jumping through the deck)
    const deck = Obs.deckAt(p.px, p.pz);
    this.underBridge = deck && deck.y > p.py + 1.5 ? deck : null;
    if (deck && p.py + 1.6 > deck.y - 1.4 && p.py < deck.y - 1.0) { p.vy = Math.min(p.vy, -1); p.py = deck.y - 3.0; ev.push({ type: 'bump', power: 6 }); }
    // capsized?
    if (T.uy < 0.15 && !this.air) { this.flipT += dt; if (this.flipT > 0.6 && !crashed) this.crash('Rolled it!'); } else this.flipT = 0;
    if (this.wipeout > 0) {
      this.wipeout -= dt;
      if (this.wipeout <= 0) {
        p.reset(p.px, p.pz, p.yaw); p.leanIn = 0; this.steerS = 0;
        this.rider.g.visible = true; ev.push({ type: 'remount' });
      }
    }
    this.sync();
    this.emitSpray(dt, spray, wake, tailScale, light, sunDir, tint);
    // ---- visuals
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this._pq.set(p.qx, p.qy, p.qz, p.qw));
    const ud = this.model.userData;
    ud.nozzle.rotation.y = this.steerA * this.pspec.steerMax;
    ud.nozzle.rotation.x = -p.trim * 0.15;
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
    const li = this.phys.leanIn;
    this.rider.pose({
      seatY: ud.seatY, seatZ: L * 0.1, gripL: grip(-0.33), gripR: grip(0.33),
      footL: new THREE.Vector3(-B * 0.34, ud.footY + 0.02, fz), footR: new THREE.Vector3(B * 0.34, ud.footY + 0.02, fz),
      lean: this.steerA * (0.9 + 0.5 * li), crouch: this.crouchT, fwd: this.throttle * 0.6 - this.gate * 0.5 + li * 0.3 - (this.phys.ctrl.lean < 0 ? 0.5 : 0), stand: this.standT,
    });
  }

  emitSpray(dt, spray, wake, tailScale, light, sunDir, tint) {
    const s = this.spec, q = this.quat, T = this.phys.tele;
    const fw = this._fw.set(0, 0, -1).applyQuaternion(q), xw = this._xw.set(1, 0, 0).applyQuaternion(q);
    const spd = this.speed;
    const N = this._rn.set(T.nozzle.x, T.nozzle.y, T.nozzle.z);
    const surfN = this.surface(N.x, N.z);
    const crashed = this.wipeout > 0;
    // ---- rooster tail: the jet stream slams into the surface behind the ski and erupts in a thick column.
    // It grows when the nozzle rides high (trim up, stern lifted) and when the nozzle is swung in a turn.
    const jet = Math.max(0, T.power || 0) * T.pumpLoad;
    const exposure = Math.max(0, Math.min(1, (N.y - surfN + 0.3) / 0.35));
    const swing = Math.abs(this.steerA);
    const sf = Math.max(0, Math.min(1, (spd - 1.5) / (this.vmax * 0.7)));
    const on = !crashed && T.pumpLoad > 0.3 && T.wet > 0.02 && jet > 0.08 && spd > 2 && T.reverse < 0.05;
    const jd = this._dir.set(T.jetDir.x, 0, T.jetDir.z); // where the jet water goes
    if (jd.lengthSq() < 1e-4) jd.set(-fw.x, 0, -fw.z);
    jd.normalize();
    const trimUp = Math.max(0, this.phys.trim);
    const upV = tailScale * s.tail * (3 + spd * 0.3 + jet * 2.5) * (0.8 + 0.3 * exposure + 0.25 * swing + 0.2 * trimUp) * Math.min(1, 0.35 + sf);
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
    if (!crashed && T.wet > 0.02) {
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
    if (wake && spd > 1 && T.wet > 0.02) {
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

// Cameras: 0 chase, 1 far chase, 2 first person, 3 rear passenger (sitting behind the rider, looking
// back over the stern at the rooster tail), 4 drone. Holding V looks back from any camera.
export const CAM_NAMES = ['Chase cam', 'Far chase cam', 'First person', 'Passenger looking back', 'Drone'];
export class ChaseCam {
  constructor(camera) { this.cam = camera; this.mode = 0; this.lookBack = false; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.shake = 0; this.init = false; this.yaw = 0; this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); }
  get modes() { return CAM_NAMES.length; }
  update(dt, ski) {
    const spd = ski.speed;
    let yaw = ski.yaw;
    if (spd > 4) { const vy = Math.atan2(-ski.vx, -ski.vz); let d = vy - yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; yaw += d * 0.35; }
    if (!this.init) this.yaw = yaw;
    let dy = yaw - this.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    this.yaw += dy * Math.min(1, dt * 4.5);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const mode = this.lookBack && this.mode !== 3 ? 3 : this.mode;
    const tgt = this._a;
    const look = this._b.set(ski.x + fx * (5 + spd * 0.25), Math.max(ski.y, -0.5) + 1.3, ski.z + fz * (5 + spd * 0.25));
    if (mode === 2) {
      ski.local(0, 1.75, ski.L * 0.05, tgt); this.pos.copy(tgt);
      ski.local(0, 1.2, -30, look);
      this.init = true;
    } else if (mode === 3) {
      // the passenger's head, behind the rider on the back of the seat, facing aft
      ski.local(0, 1.35, ski.L * 0.2, tgt); this.pos.copy(tgt);
      ski.local(0, -6.5, 30, look);
      look.y = Math.max(look.y, ski.y - 7);
      this.init = true;
    } else {
      const [dist, h] = mode === 4 ? [26, 22] : mode === 1 ? [15 + spd * 0.1, 5.5] : [8 + spd * 0.08, 3.2];
      tgt.set(ski.x - fx * dist, Math.max(ski.y, 0) * 0.6 + h, ski.z - fz * dist);
      const gh = Math.max(heightAt(tgt.x, tgt.z), 0);
      if (tgt.y < gh + 1.5) tgt.y = gh + 1.5;
      if (!this.init || this.wasClose) { this.pos.copy(tgt); this.look.copy(look); this.init = true; }
      this.pos.lerp(tgt, 1 - Math.exp(-dt * (mode === 4 ? 2.5 : 6)));
    }
    if (mode === 2 || mode === 3) { if (!this.wasClose || this.lastMode !== mode) this.look.copy(look); this.wasClose = true; }
    else this.wasClose = false;
    this.lastMode = mode;
    this.look.lerp(look, 1 - Math.exp(-dt * (mode === 3 ? 14 : 10)));
    this.cam.position.copy(this.pos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      this.cam.position.x += (Math.random() - 0.5) * this.shake; this.cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.cam.lookAt(this.look);
    const fovT = mode === 3 ? 78 : 60 + Math.min(16, spd * 0.45);
    this.cam.fov += (fovT - this.cam.fov) * Math.min(1, dt * 3);
    this.cam.updateProjectionMatrix();
  }
}

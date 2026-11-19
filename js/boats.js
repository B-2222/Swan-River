// AI boats: Perth Water ferry (Elizabeth Quay <-> Mends Street), Rottnest fast cat, ski boats, yachts, tinnies and kayaks.
import * as THREE from '../vendor/three.module.min.js';
import { sdfAt, sdfGrad, toXZ } from './world.js';
import { boatModel } from './models.js';
import { waveHeight } from './water.js';
import { findPath, navClear, randomWater } from './nav.js';
import { zoneAt } from './zones.js';
import { KN } from './jetski.js';

const tmpG = { x: 0, z: 0 };

export class AIBoat {
  constructor(scene, obj, o) {
    this.obj = obj; this.obj.rotation.order = 'YXZ'; scene.add(obj); this.scene = scene;
    this.x = o.x; this.z = o.z; this.yaw = o.yaw || 0; this.speed = 0; this.target = null; this.path = null; this.pi = 0;
    this.max = o.max; this.accel = o.accel || 2; this.turn = o.turn || 0.6; this.L = o.L; this.B = o.B; this.cruise = o.cruise || o.max;
    this.wakeAmp = o.wakeAmp || 0.3; this.obeyZones = !!o.obey; this.night = false; this.desired = o.cruise || o.max;
    this.stuck = 0; this.repath = 0;
  }
  goTo(x, z, usePath = true) {
    this.target = [x, z];
    if (usePath && !navClear(this.x, this.z, x, z, -6)) {
      this.path = findPath(this.x, this.z, x, z) || [[this.x, this.z], [x, z]];
    } else this.path = [[this.x, this.z], [x, z]];
    this.pi = 1;
  }
  get waypoint() { return this.path && this.pi < this.path.length ? this.path[this.pi] : null; }
  arrived(r = 25) { return !this.waypoint || (this.pi === this.path.length - 1 && Math.hypot(this.path[this.pi][0] - this.x, this.path[this.pi][1] - this.z) < r); }
  update(dt, wake, spray, others) {
    let want = this.desired;
    const wp = this.waypoint;
    let steer = 0;
    if (wp) {
      const dx = wp[0] - this.x, dz = wp[1] - this.z, d = Math.hypot(dx, dz);
      if (d < Math.max(18, this.speed * 1.5) && this.pi < this.path.length - 1) this.pi++;
      const want_yaw = Math.atan2(-dx, -dz);
      let dy = want_yaw - this.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      steer = Math.max(-1, Math.min(1, dy * 2));
      if (this.pi === this.path.length - 1 && d < 60) want = Math.min(want, d * 0.15 + 0.5);
      if (Math.abs(dy) > 1.2) want = Math.min(want, this.max * 0.35);
    } else want = 0;
    // shore avoidance: probe ahead
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const look = 12 + this.speed * 2.2;
    const ahead = sdfAt(this.x + fx * look, this.z + fz * look);
    if (ahead > -6) {
      sdfGrad(this.x + fx * look, this.z + fz * look, tmpG);
      const side = Math.cos(this.yaw) * tmpG.x - Math.sin(this.yaw) * tmpG.z; // > 0: land is on the right
      steer += side > 0 ? 1 : -1;
      want = Math.min(want, this.max * 0.4);
    }
    if (this.obeyZones) {
      const zn = zoneAt(this.x, this.z, this.night, false);
      if (zn.limit) want = Math.min(want, zn.limit * KN * 0.95);
    }
    // separation from others
    if (others) for (const o of others) {
      if (o === this) continue;
      const dx = o.x - this.x, dz = o.z - this.z, d = Math.hypot(dx, dz);
      if (d < (this.L + (o.L || 3)) * 0.8 && d > 0.01) { this.x -= dx / d * 0.5; this.z -= dz / d * 0.5; }
    }
    this.yaw += Math.max(-1, Math.min(1, steer)) * this.turn * Math.min(1, 0.3 + this.speed / 6) * dt;
    this.speed += Math.max(-this.accel * 1.5 * dt, Math.min(this.accel * dt, want - this.speed));
    const nx = this.x + -Math.sin(this.yaw) * this.speed * dt, nz = this.z + -Math.cos(this.yaw) * this.speed * dt;
    if (sdfAt(nx, nz) < -2.5) { this.x = nx; this.z = nz; this.stuck = 0; }
    else { this.speed *= 0.5; this.yaw += dt * 1.5; this.stuck += dt; }
    if (this.stuck > 4 && this.target) { this.stuck = 0; this.goTo(this.target[0], this.target[1]); }
    // pose on the waves
    const h = waveHeight(this.x, this.z);
    const hb = waveHeight(this.x + fx * this.L * 0.4, this.z + fz * this.L * 0.4), hs = waveHeight(this.x - fx * this.L * 0.4, this.z - fz * this.L * 0.4);
    const plane = Math.min(1, this.speed / (this.max + 0.01));
    this.obj.position.set(this.x, h + plane * 0.15 * Math.min(1, 8 / this.L), this.z);
    this.obj.rotation.set(Math.atan2(hb - hs, this.L * 0.8) + plane * 0.06, this.yaw, -steer * 0.08 * plane);
    // wake + spray
    if (this.speed > 1.5 && wake) {
      const sx = this.x - fx * this.L * 0.5, sz = this.z - fz * this.L * 0.5;
      wake.stamp(sx, sz, this.B * 0.45 + 0.5, Math.min(0.85, 0.2 + this.speed / 25));
      if (spray && this.speed > 6 && Math.random() < this.speed * dt * 0.8) {
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
        for (const s of [-1, 1]) spray.emit(this.x + fx * this.L * 0.3 + rx * s * this.B * 0.5, h + 0.3, this.z + fz * this.L * 0.3 + rz * s * this.B * 0.5,
          rx * s * 3 + fx * this.speed * 0.5, 1.5 + Math.random() * 1.5, rz * s * 3 + fz * this.speed * 0.5, 0.5 + Math.random() * 0.3, 0.9, 1);
      }
    }
  }
  remove() { this.scene.remove(this.obj); }
}

function meshOf(type, o) { return boatModel(type, o); }

export class Boats {
  constructor(scene) {
    this.scene = scene; this.list = []; this.timer = 0; this.night = false;
    // Perth Water ferry: Elizabeth Quay ferry terminal <-> Mends Street Jetty (South Perth)
    this.eq = toXZ(115.8562, -31.9592); this.mends = toXZ(115.8540, -31.9702);
    this.ferry = new AIBoat(scene, meshOf('ferry'), { x: this.eq[0], z: this.eq[1] + 30, max: 10 * KN, accel: 0.8, turn: 0.45, L: 21, B: 7, wakeAmp: 0.5, obey: true });
    this.ferry.kind = 'ferry'; this.ferry.dock = 0; this.ferry.wait = 5; this.ferry.goTo(this.mends[0], this.mends[1] - 25, false);
    // Rottnest fast cat from Barrack Street Jetty down the river and out to sea
    this.barrack = toXZ(115.8588, -31.9612);
    this.cat = null; this.catTimer = 8;
  }
  spawnCat() {
    const b = new AIBoat(this.scene, meshOf('fastcat'), { x: this.barrack[0], z: this.barrack[1] + 20, yaw: Math.PI * 0.5, max: 30 * KN, accel: 1.2, turn: 0.35, L: 38, B: 10.4, wakeAmp: 1.6, obey: true }); // a 38 m cat at 30 knots throws a serious wake
    b.kind = 'fastcat';
    const sea = toXZ(115.700, -32.040);
    b.goTo(sea[0], sea[1]);
    this.cat = b;
  }
  spawnRandom(player) {
    const p = randomWater(player.x, player.z, 1100, -30);
    if (!p || Math.hypot(p[0] - player.x, p[1] - player.z) < 250) return;
    const r = Math.random();
    let type, o = {}, max, L, B, wakeAmp, turn = 0.7;
    if (r < 0.32) { type = 'runabout'; max = (22 + Math.random() * 14) * KN; L = 6.2; B = 2.4; wakeAmp = 0.55; o = { hull: [0xffffff, 0x1d3557, 0xc1121f, 0x111111][Math.floor(Math.random() * 4)] }; }
    else if (r < 0.5) { type = 'cruiser'; max = (12 + Math.random() * 8) * KN; L = 11.5; B = 3.8; wakeAmp = 0.75; turn = 0.4; }
    else if (r < 0.75) { type = 'yacht'; max = (4 + Math.random() * 3) * KN; L = 9.5; B = 3.1; wakeAmp = 0.1; turn = 0.3; o = { sail: true }; }
    else if (r < 0.88) { type = 'tinny'; max = (6 + Math.random() * 10) * KN; L = 4.2; B = 1.8; wakeAmp = 0.15; }
    else { type = 'kayak'; max = 1.6; L = 4.2; B = 0.7; wakeAmp = 0; turn = 0.8; o = { hull: [0xffcc00, 0xff4d00, 0x2ec4b6][Math.floor(Math.random() * 3)] }; }
    const b = new AIBoat(this.scene, meshOf(type, o), { x: p[0], z: p[1], yaw: Math.random() * 6.28, max, L, B, wakeAmp, turn, obey: type !== 'kayak' && Math.random() < 0.85 });
    b.kind = type;
    const d = randomWater(p[0], p[1], 1500, -30);
    if (d) b.goTo(d[0], d[1]);
    this.list.push(b);
  }
  all() { const a = [...this.list, this.ferry]; if (this.cat) a.push(this.cat); return a; }
  update(dt, player, wake, spray, quality) {
    this.timer -= dt;
    const want = [5, 9, 13][quality];
    if (this.timer <= 0) {
      this.timer = 1.5;
      this.list = this.list.filter(b => { if (Math.hypot(b.x - player.x, b.z - player.z) > 1800) { b.remove(); return false; } return true; });
      if (this.list.length < want) this.spawnRandom(player);
    }
    for (const b of this.list) { b.night = this.night; if (b.arrived(30)) { const d = randomWater(b.x, b.z, 1500, -30); if (d) b.goTo(d[0], d[1]); } }
    // ferry shuttles and waits at each jetty
    const f = this.ferry;
    if (f.arrived(12)) {
      f.wait -= dt; f.desired = 0;
      if (f.wait <= 0) { f.dock = 1 - f.dock; f.wait = 25; f.desired = f.max; const t = f.dock ? this.eq : this.mends; f.goTo(t[0], t[1] + (f.dock ? 30 : -25), false); }
    }
    if (!this.cat) { this.catTimer -= dt; if (this.catTimer <= 0) this.spawnCat(); }
    else if (this.cat.arrived(60)) { this.cat.remove(); this.cat = null; this.catTimer = 240; }
    const all = this.all();
    for (const b of all) b.update(dt, wake, spray, all);
  }

  collide(ski, list = this.all()) {
    for (const b of list) {
      const dx = ski.x - b.x, dz = ski.z - b.z;
      // treat the boat as a capsule along its heading
      const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
      const t = Math.max(-b.L * 0.45, Math.min(b.L * 0.45, dx * fx + dz * fz));
      const cx = b.x + fx * t, cz = b.z + fz * t;
      const ex = ski.x - cx, ez = ski.z - cz, d = Math.hypot(ex, ez), r = b.B * 0.5 + 0.9;
      if (d < r && d > 0.01) {
        ski.x = cx + ex / d * r; ski.z = cz + ez / d * r;
        const rel = (ski.vx - (-Math.sin(b.yaw) * b.speed)) * ex / d + (ski.vz - (-Math.cos(b.yaw) * b.speed)) * ez / d;
        if (rel < 0) { ski.vx -= rel * ex / d * 1.3; ski.vz -= rel * ez / d * 1.3; }
        return { boat: b, impact: -rel };
      }
    }
    return null;
  }
}

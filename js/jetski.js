// Player jet ski: physics (planing, jet steering, power slides, hops, swell jumps), model, spray emission.
import * as THREE from '../vendor/three.module.min.js';
import { sdfAt, heightAt, sdfGrad, oceanAt, navigable } from './world.js';
import { waveHeight, waveSlope } from './water.js';
import { jetSkiModel, riderModel } from './models.js';
import { Obs } from './static.js';

export const KN = 0.514444; // m/s per knot
const tmpG = { x: 0, z: 0 }, tmpS = { x: 0, z: 0 };

export class JetSki {
  constructor(scene, spec) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    scene.add(this.group);
    this.setSpec(spec);
    this.x = 0; this.z = 0; this.y = 0; this.vx = 0; this.vz = 0; this.vy = 0;
    this.yaw = 0; this.yawRate = 0; this.pitch = 0; this.roll = 0;
    this.throttle = 0; this.air = false; this.airTime = 0; this.spin = 0;
    this.wipeout = 0; this.drift = 0; this.underBridge = null;
    this.events = [];
    this.extraBumps = null; // function(x,z) -> wake height from boats
  }
  setSpec(spec) {
    this.spec = spec;
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.rider) this.group.remove(this.rider);
    this.mesh = new THREE.Mesh(jetSkiModel(spec), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.group.add(this.mesh);
    this.rider = riderModel(0x1d3557, 0xff5a00);
    this.rider.position.set(0, 0.45, spec.len * 0.12);
    this.group.add(this.rider);
    this.vmax = spec.topKn * KN;
    this.thrust = 12.5 * spec.accel;
    this.c1 = 0.04;
    this.c2 = (this.thrust * 0.55 - this.c1 * this.vmax) / (this.vmax * this.vmax);
  }
  place(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw; this.vx = this.vz = this.vy = 0; this.y = 0; this.yawRate = 0; this.wipeout = 0;
    this.rider.visible = true;
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get fwd() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }
  get forwardSpeed() { const f = this.fwd; return this.vx * f.x + this.vz * f.z; }

  surface(x, z) { return waveHeight(x, z) + (this.extraBumps ? this.extraBumps(x, z) : 0); }

  update(dt, inp, spray, wake, tailScale) {
    const ev = this.events; ev.length = 0;
    const s = this.spec;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let vf = this.vx * fx + this.vz * fz, vs = this.vx * rx + this.vz * rz;
    const spd = Math.hypot(this.vx, this.vz);
    const surf = this.surface(this.x, this.z);
    const onWater = this.y <= surf + 0.12;
    const crashed = this.wipeout > 0;
    let throttle = crashed ? 0 : inp.throttle, brake = crashed ? 0 : inp.brake, steer = crashed ? 0 : inp.steer;
    this.throttle += (throttle - this.throttle) * Math.min(1, dt * 6);
    this.drift += ((inp.slide && !crashed && spd > 5 ? 1 : 0) - this.drift) * Math.min(1, dt * 5);

    if (onWater) {
      // jet thrust and hull drag (planing hump around 9 knots)
      const T = this.throttle * this.thrust * (1 - 0.45 * Math.min(1, Math.max(0, vf) / this.vmax)) + 0.25;
      const hump = 1.9 * Math.exp(-Math.pow((Math.abs(vf) - 4.6) / 2.2, 2));
      const drag = this.c1 * vf + this.c2 * vf * Math.abs(vf) + hump * Math.sign(vf) * (1 - this.throttle * 0.4);
      let a = T - drag;
      if (brake > 0) a -= vf > 0.5 ? 7.5 * brake : 3.2 * brake * (vf > -3 ? 1 : 0); // iBR braking then reverse
      vf += a * dt;
      // lateral grip (hull bites less while power sliding)
      const grip = (this.drift > 0.5 ? 0.9 : 5.0) * (1 + Math.min(1, spd / 20));
      const lost = vs * (1 - Math.exp(-grip * dt));
      vs -= lost;
      vf -= Math.abs(lost) * 0.18; // carving scrubs speed
      // jet steering: needs thrust to turn (just like a real ski)
      const auth = 0.22 + 0.78 * Math.min(1, this.throttle + brake * 0.6);
      const spdN = Math.min(1, spd / this.vmax);
      const maxRate = s.turn * (2.2 - 0.95 * spdN) * (1 + this.drift * 0.45);
      const target = steer * maxRate * auth * (spd < 1 && this.throttle < 0.1 ? 0.3 : 1);
      this.yawRate += (target - this.yawRate) * Math.min(1, dt * 7);
      // buoyancy: rides higher once planing
      const plane = Math.min(1, Math.max(0, (spd - 5) / 8));
      const draft = 0.22 - 0.16 * plane;
      const ay = 70 * (surf - draft - this.y) - 10 * this.vy;
      this.vy += ay * dt;
      if (this.air) { // landed
        const impact = -this.vy0;
        ev.push({ type: 'land', air: this.airTime, impact, spin: this.spin });
        spray.splash(this.x, surf, this.z, Math.min(160, 20 + impact * 14), 1.5 + impact * 0.5);
        if (Math.abs(this.roll) > 1.0 || (impact > 11 && Math.abs(this.pitch) > 0.7)) this.crash('Stacked it on landing!');
        this.air = false; this.spin = 0;
      }
      this.airTime = 0;
      // hop (pop the nose out like a freestyle rider)
      if (inp.hop && !crashed && spd > 3) { this.vy = 4.6 + spd * 0.06; this.y = surf + 0.15; ev.push({ type: 'hop' }); inp.hop = false; }
    } else {
      // airborne
      this.vy -= 9.81 * 1.15 * dt;
      if (!this.air) { this.air = true; this.airTime = 0; this.spin = 0; }
      this.airTime += dt; this.vy0 = this.vy;
      this.yawRate += (steer * 3.2 - this.yawRate) * Math.min(1, dt * 2.5);
      this.spin += this.yawRate * dt;
      vf -= vf * 0.02 * dt;
    }
    this.yaw += this.yawRate * dt;
    // rebuild velocity in the new heading (keeps momentum in slides)
    const nfx = -Math.sin(this.yaw), nfz = -Math.cos(this.yaw), nrx = Math.cos(this.yaw), nrz = -Math.sin(this.yaw);
    if (onWater) {
      const redirect = this.drift > 0.5 ? 0.1 : 0.88; // how much the hull carries momentum round the turn
      const wx = vf * fx + vs * rx, wz = vf * fz + vs * rz;
      const f2 = wx * nfx + wz * nfz, s2 = wx * nrx + wz * nrz;
      const vf2 = vf * redirect + f2 * (1 - redirect);
      this.vx = vf2 * nfx + s2 * nrx; this.vz = vf2 * nfz + s2 * nrz;
    } else {
      this.vx = vf * fx + vs * rx; this.vz = vf * fz + vs * rz;
    }
    if (this.wipeout > 0) { this.vx *= Math.exp(-1.5 * dt); this.vz *= Math.exp(-1.5 * dt); }
    this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;

    // ---- collisions: river banks
    const sd = sdfAt(this.x, this.z);
    if (sd > 25) { // somehow well inland: hop back to the nearest water
      for (let r = 20; r < 3000; r += 20) {
        let found = false;
        for (let a = 0; a < 6.283; a += 0.3) {
          const px = this.x + Math.cos(a) * r, pz = this.z + Math.sin(a) * r;
          if (navigable(px, pz, -8)) { this.x = px; this.z = pz; this.vx = this.vz = 0; found = true; break; }
        }
        if (found) break;
      }
    } else if (sd > -1.0) {
      const gh = heightAt(this.x, this.z);
      if (gh > this.y - 0.45) {
        sdfGrad(this.x, this.z, tmpG);
        const push = sd + 1.0;
        this.x -= tmpG.x * push; this.z -= tmpG.z * push;
        const vn = this.vx * tmpG.x + this.vz * tmpG.z;
        if (vn > 0) {
          this.vx -= vn * tmpG.x * 1.4; this.vz -= vn * tmpG.z * 1.4;
          if (vn > 10 && !crashed) this.crash(gh > 2 ? 'Ate the river wall!' : 'Beached it!');
          else if (vn > 3) ev.push({ type: 'bump', power: vn });
        }
      }
    }
    // jetties, bridge piers, moored boats, breakwaters
    const p = { x: this.x, z: this.z };
    const hit = Obs.resolve(p, 1.1, this.y);
    if (hit) {
      this.x = p.x; this.z = p.z;
      const vn = -(this.vx * hit.nx + this.vz * hit.nz);
      if (vn > 0) {
        this.vx += hit.nx * vn * 1.3; this.vz += hit.nz * vn * 1.3;
        if (vn > 9 && !crashed) this.crash(hit.kind === 'pier' ? 'Smashed a bridge pylon!' : hit.kind === 'boat' ? 'T-boned a moored boat!' : hit.kind === 'jetty' ? 'Took out a jetty!' : 'Hit the rocks!');
        else if (vn > 2.5) ev.push({ type: 'bump', power: vn });
      }
    }
    // under bridges
    const deck = Obs.deckAt(this.x, this.z);
    this.underBridge = deck && deck.y > this.y + 1.5 ? deck : null;
    if (deck && this.y + 1.5 > deck.y - 1.4 && this.y < deck.y - 1.0) { this.vy = Math.min(this.vy, -1); this.y = deck.y - 2.9; ev.push({ type: 'bump', power: 6 }); }

    // ---- attitude
    waveSlope(this.x, this.z, tmpS);
    const slopeF = tmpS.x * nfx + tmpS.z * nfz, slopeS = tmpS.x * nrx + tmpS.z * nrz;
    const accelLift = this.throttle * 0.1 * (1 - Math.min(1, spd / this.vmax)) + (spd > 3 && spd < 8 ? 0.12 : 0);
    let tp = onWater ? Math.atan(slopeF) + accelLift : Math.max(-0.7, Math.min(0.5, Math.atan2(this.vy, Math.max(spd, 1)) * 0.8));
    if (this.wipeout > 0) tp = 0;
    const tr = onWater ? -steer * 0.42 * Math.min(1, spd / 10) * (1 + this.drift * 0.5) - Math.atan(slopeS) : this.roll * 0.98;
    this.pitch += (tp - this.pitch) * Math.min(1, dt * (onWater ? 6 : 2));
    this.roll += (tr - this.roll) * Math.min(1, dt * 4);

    // ---- spray, wake
    const sternX = this.x - nfx * s.len * 0.5, sternZ = this.z - nfz * s.len * 0.5;
    if (onWater && !crashed) {
      const sf = Math.max(0, Math.min(1, (spd - 2.5) / (this.vmax * 0.85)));
      const turnBoost = 1 + Math.abs(this.yawRate) * 0.35 + this.drift * 0.6;
      const rate = (this.throttle > 0.05 ? 900 : 120) * sf * (0.6 + 0.4 * tailScale) * Math.min(1.8, turnBoost);
      let n = rate * dt; n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const up = tailScale * s.tail * (5 + spd * 0.45) * (0.7 + Math.random() * 0.55) * this.throttle * (0.85 + 0.15 * turnBoost);
        const back = spd * (0.25 + Math.random() * 0.15);
        // the steering nozzle swivels, so a hard turn throws the tail out sideways
        const side = (Math.random() - 0.5) * (1.5 + spd * 0.05) + steer * spd * (0.5 + 0.25 * tailScale) * this.throttle;
        spray.emit(sternX + (Math.random() - 0.5) * 0.3, surf + 0.1, sternZ + (Math.random() - 0.5) * 0.3,
          this.vx * 0.3 - nfx * back + nrx * side, up, this.vz * 0.3 - nfz * back + nrz * side,
          0.35 + Math.random() * 0.35 + spd * 0.012, 1.4 + Math.random() * 1.1);
      }
      // carve sheet: big fan off the outside rail when sliding or turning hard
      const carve = Math.min(1, Math.abs(vs) / 6 + this.drift * 0.7) * sf;
      if (carve > 0.15) {
        const sideDir = vs > 0 ? 1 : -1;
        const m = Math.floor(carve * 650 * dt * (0.6 + 0.4 * tailScale)) + 1;
        for (let k = 0; k < m; k++) {
          const along = (Math.random() - 0.3) * s.len * 0.7;
          const out = (5 + spd * 0.75) * (0.6 + Math.random() * 0.6) * (0.7 + 0.3 * tailScale);
          spray.emit(this.x + nfx * along + nrx * sideDir * 0.7, surf + 0.15, this.z + nfz * along + nrz * sideDir * 0.7,
            this.vx * 0.4 + nrx * sideDir * out, (2.5 + spd * 0.22) * (0.6 + Math.random() * 0.7) * (0.8 + 0.2 * tailScale), this.vz * 0.4 + nrz * sideDir * out,
            0.45 + Math.random() * 0.4, 1.2 + Math.random() * 0.8);
        }
      }
      if (spd > 1) {
        wake.stamp(sternX, sternZ, 1.3 + spd * 0.06, Math.min(0.9, 0.25 + spd / 30));
        if (this.drift > 0.4 || Math.abs(vs) > 3) wake.stamp(this.x, this.z, 2.2, 0.6);
      }
    }
    if (this.wipeout > 0) {
      this.wipeout -= dt;
      if (this.wipeout <= 0) { this.rider.visible = true; this.rider.position.set(0, 0.45, s.len * 0.12); this.rider.rotation.set(0, 0, 0); ev.push({ type: 'remount' }); }
      else { this.rider.position.y = Math.max(-0.6, this.rider.position.y - dt * 0.8); this.rider.rotation.z += dt * 2; }
    }
    // ---- apply transform
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(this.pitch, this.yaw, this.roll);
    const lean = -steer * 0.25 * Math.min(1, spd / 8);
    if (this.wipeout <= 0) { this.rider.rotation.z = lean * 0.6; this.rider.rotation.x = -0.15 - this.throttle * 0.15; }
  }

  crash(reason) {
    if (this.wipeout > 0) return;
    this.wipeout = 2.6;
    this.events.push({ type: 'crash', reason });
    this.rider.position.set(1.4, 0.2, 0.5);
  }
}

// chase camera with a few modes
export class ChaseCam {
  constructor(camera) { this.cam = camera; this.mode = 0; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.shake = 0; this.init = false; }
  update(dt, ski) {
    const f = ski.fwd, spd = ski.speed;
    const modes = [[8.5 + spd * 0.08, 3.0], [17 + spd * 0.12, 6.5], [0, 0], [26, 22]];
    const [dist, h] = modes[this.mode];
    const tgt = new THREE.Vector3();
    const look = new THREE.Vector3(ski.x + f.x * (4 + spd * 0.3), ski.y + 1.2, ski.z + f.z * (4 + spd * 0.3));
    if (this.mode === 2) {
      tgt.set(ski.x + f.x * 0.2, ski.y + 1.75, ski.z + f.z * 0.2);
      look.set(ski.x + f.x * 30, ski.y + 0.8, ski.z + f.z * 30);
      this.pos.copy(tgt);
    } else {
      // trail the velocity a little so slides look sideways
      const vx = ski.vx / (spd || 1), vz = ski.vz / (spd || 1);
      const blend = Math.min(1, spd / 12) * 0.35;
      const dx = f.x * (1 - blend) + vx * blend, dz = f.z * (1 - blend) + vz * blend;
      const l = Math.hypot(dx, dz) || 1;
      tgt.set(ski.x - dx / l * dist, Math.max(ski.y, 0) + h, ski.z - dz / l * dist);
      const gh = Math.max(heightAt(tgt.x, tgt.z), 0);
      if (tgt.y < gh + 1.5) tgt.y = gh + 1.5;
      if (!this.init) { this.pos.copy(tgt); this.look.copy(look); this.init = true; }
      const k = 1 - Math.exp(-dt * (this.mode === 3 ? 2.5 : 5.5));
      this.pos.lerp(tgt, k);
    }
    this.look.lerp(look, 1 - Math.exp(-dt * 9));
    this.cam.position.copy(this.pos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      this.cam.position.x += (Math.random() - 0.5) * this.shake; this.cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.cam.lookAt(this.look);
    const fovT = 62 + Math.min(14, spd * 0.4);
    this.cam.fov += (fovT - this.cam.fov) * Math.min(1, dt * 3);
    this.cam.updateProjectionMatrix();
  }
}

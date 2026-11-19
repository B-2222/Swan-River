// Everything wet the hull throws around: bow and chine spray, the wall of water
// in a powerslide, the carve sheet, landing splashes, and the foam wake left on
// the surface. (From jetskirider src/effects.js with the jet / rooster tail and
// iBR braking sections removed; the game has its own rooster tail.)

import { clamp, smoothstep } from '../skiphysics/util.js';

const rnd = Math.random;
const rs = () => rnd() * 2 - 1;

export class SkiEffects {
  constructor(spray, foam, world) {
    this.spray = spray;
    this.foam = foam;
    this.world = world;
    this.acc = { carve: 0 };
    this.sideAcc = new Float32Array(16);
    this.density = 1;
    this.sprayLevel = 0; // 0..1, for audio
  }

  update(dt, phys, time) {
    const T = phys.tele;
    const S = this.spray;
    const F = this.foam;
    const dn = this.density;
    const fhx = phys.fhx, fhz = phys.fhz;
    const rhx = -fhz, rhz = fhx;
    let level = 0;

    // ---------------------------------------------------- hull + slide spray
    const pts = phys.points;
    const PP = phys.ptPos, PV = phys.ptVel, PD = phys.ptDepth;
    const spd = T.speed;
    let leadL = false, leadR = false;
    // side points are stored stern->bow per side; walk bow->stern so the first
    // wet one on each side is where the hull meets the water
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      if (p.deck || p.z === 0) continue;
      const depth = PD[i];
      if (depth <= 0.005 || depth > 0.42) continue;
      const side = p.z > 0 ? 1 : -1;
      const x = PP[i * 3], z = PP[i * 3 + 2];
      const wy = PP[i * 3 + 1] + depth;
      const pvx = PV[i * 3], pvz = PV[i * 3 + 2];
      const up = pvx * fhx + pvz * fhz;
      const vp = pvx * rhx + pvz * rhz;
      const isLead = side > 0 ? !leadR : !leadL;
      if (side > 0) leadR = true;
      else leadL = true;

      // forward-speed spray off the chine
      let rate = 0;
      if (up > 3.5) rate = (isLead ? 34 : 5) * (up - 3.5);
      if (rate > 420) rate = 420;
      // sideways slide: the leading side shovels water
      const leading = side * vp > 1.5;
      let sRate = 0;
      if (leading) sRate = 30 * (Math.abs(vp) - 1.5) * (0.6 + Math.min(spd, 20) * 0.03);
      if (sRate > 380) sRate = 380;
      // sliding backwards: transom + bow plough
      if (up < -2) sRate += 16 * (-up - 2);

      this.sideAcc[i] += (rate + sRate) * dt * dn;
      let n = this.sideAcc[i] | 0;
      this.sideAcc[i] -= n;
      if (n > 80) n = 80;
      const fr = rate / (rate + sRate + 1e-3);
      const avp = Math.abs(vp);
      for (let k = 0; k < n; k++) {
        if (rnd() < fr) {
          const o = 1.2 + up * (0.12 + rnd() * 0.16);
          const u2 = 0.9 + up * (0.05 + rnd() * 0.1);
          S.emit(x + rs() * 0.25 * fhx, wy + 0.03, z + rs() * 0.25 * fhz,
            pvx * (0.55 + rnd() * 0.3) + rhx * side * o, u2, pvz * (0.55 + rnd() * 0.3) + rhz * side * o,
            0.6 + rnd() * 0.8, 0.05 + rnd() * 0.04, 0.18 + rnd() * 0.25, 1, 0.5, 0.85, 0.08);
        } else {
          const o = (avp * (0.75 + rnd() * 0.7) + 1.5) * (leading ? side : rs());
          const u2 = 1.6 + avp * (0.3 + rnd() * 0.5) + Math.abs(Math.min(up, 0)) * 0.3 * rnd();
          const big = rnd() < 0.12;
          S.emit(x + rs() * 0.5 * fhx, wy + 0.03, z + rs() * 0.5 * fhz,
            pvx * 0.3 + rhx * o, u2, pvz * 0.3 + rhz * o,
            0.8 + rnd() * 1.1, big ? 0.15 : 0.06 + rnd() * 0.05, big ? 0.7 + rnd() * 0.5 : 0.22 + rnd() * 0.3, 1, big ? 1.2 : 0.4, big ? 0.16 : 0.9, 0.1);
        }
      }
      level += (rate + sRate) * 0.0012;

      // wake foam
      const mv = Math.hypot(pvx, pvz);
      if (mv > 1.5) {
        const k = clamp(mv / 16, 0, 1.2) + clamp(avp / 8, 0, 0.9);
        F.stamp(x + rs() * 0.12, z + rs() * 0.12, 0.26 + Math.min(avp, 8) * 0.03, k * dt * (1.3 + Math.min(avp, 6) * 0.12), k * dt * 1.6);
      }
    }
    // keel wash under the hull centre
    if (T.wet > 0.1 && spd > 2) {
      const k = clamp(spd / 18, 0, 1);
      F.stamp(phys.px - fhx * 0.6, phys.pz - fhz * 0.6, 0.38, k * dt * 1.3, k * dt * 2.6);
    }

    // --------------------------------------------------------- carve spray
    // Banked over in a turn the hull bottom faces outward and peels a sheet
    // of water off the outside. Faster and steeper = bigger fan.
    {
      const bank = Math.abs(T.roll);
      const carve = clamp((bank - 0.12) / 0.5, 0, 1.3) * clamp((T.u - 6) / 18, 0, 1.6) * Math.min(1, T.wet * 3);
      if (carve > 0.02) {
        const out = T.roll > 0 ? -1 : 1; // rolled right (right turn) -> spray goes left
        this.acc.carve = (this.acc.carve || 0) + 620 * carve * dn * dt;
        let n = this.acc.carve | 0;
        this.acc.carve -= n;
        const L = phys.spec.L;
        const wy = this.world.waterHeight(phys.px, phys.pz, phys.time);
        for (let i = 0; i < n; i++) {
          const along = (rnd() * 0.75 - 0.3) * L;
          const o = (2.5 + spd * (0.16 + rnd() * 0.3) * (0.5 + carve * 0.5)) * out;
          S.emit(phys.px + fhx * along + rhx * out * 0.35, wy + 0.04, phys.pz + fhz * along + rhz * out * 0.35,
            phys.vx * (0.55 + rnd() * 0.3) + rhx * o, 1.2 + spd * (0.07 + rnd() * 0.12) * carve, phys.vz * (0.55 + rnd() * 0.3) + rhz * o,
            0.6 + rnd() * 0.9, 0.05 + rnd() * 0.05, 0.2 + rnd() * 0.3, 1, 0.45, 0.9, 0.1);
        }
        F.stamp(phys.px + rhx * out * 0.6, phys.pz + rhz * out * 0.6, 0.5, carve * dt * 3, carve * dt * 2.5);
        level += carve * 0.4;
      }
    }

    // ------------------------------------------------------- landing splash
    if (T.impact > 2.4) {
      const im = Math.min(T.impact, 14);
      const n = (Math.min(45 * im, 480) * dn) | 0;
      const L = phys.spec.L * 0.5, B = phys.spec.B * 0.5;
      const wy = this.world.waterHeight(phys.px, phys.pz, phys.time);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const lx = Math.cos(a) * L * (0.6 + rnd() * 0.4), lz = Math.sin(a) * B * (0.8 + rnd() * 0.3);
        const ox = fhx * lx + rhx * lz, oz = fhz * lx + rhz * lz;
        const ol = Math.hypot(ox, oz) + 1e-3;
        const sp = (1.5 + im * (0.25 + rnd() * 0.5));
        const big = rnd() < 0.12;
        S.emit(phys.px + ox, wy + 0.05, phys.pz + oz,
          phys.vx * 0.55 + (ox / ol) * sp, 1.5 + im * (0.25 + rnd() * 0.55), phys.vz * 0.55 + (oz / ol) * sp,
          0.8 + rnd() * 1.2, big ? 0.18 : 0.06 + rnd() * 0.06, big ? 0.8 + rnd() * 0.6 : 0.25 + rnd() * 0.35, 1, big ? 1.2 : 0.4, big ? 0.16 : 0.9, 0.12);
      }
      for (let i = 0; i < 10; i++) {
        F.stamp(phys.px + rs() * L, phys.pz + rs() * L, 1.2 + rnd() * 0.8, 0.5 + im * 0.07, 0.5);
      }
      this.lastImpact = im;
      this.impactFlag = im;
      T.impact = 0;
    } else if (T.impact > 0) {
      T.impact = 0;
    }
    this.sprayLevel = clamp(level, 0, 1);
  }
}

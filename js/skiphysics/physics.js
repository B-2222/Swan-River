// Jet ski rigid-body physics. Pure JS (no three.js) so it can be tested headless.
//
// Body frame:  +X forward (bow), +Y up, +Z starboard (right).
// The origin is the centre of mass, level with the bond line, 40% of the hull
// length ahead of the transom.
//
// Model summary
//  - 6-DOF rigid body, quaternion orientation.
//  - Hull sampled at 11 points. Each wet point produces buoyancy, heave
//    damping, slam, planing lift, longitudinal drag and a tyre-like lateral
//    "grip" force that saturates and breaks loose (that is the powerslide).
//  - Because grip is produced per point, the centre of lateral resistance
//    moves with attitude: bow planted -> the stern whips round (180s);
//    bow high (trim up / wheelie) -> loose, flat slides.
//  - The jet pump thrust acts at the steering nozzle along the nozzle axis
//    (steer yaw + VTS trim pitch). No water at the intake grate = no thrust.

import { clamp, smoothstep, damp, sign } from './util.js';

const G = 9.81;
const SUB_MAX = 0.45; // depth at which a hull point counts as fully submerged
const ARM_K = 0.45;

function buildPoints(spec) {
  const L = spec.L;
  const B = spec.B;
  const sb = spec.sternBias;
  const P = [];
  const add = (x, y, z, w, wl, rocker, lift) => P.push({ x: x * L, y, z: z * B, w, wl, rocker, lift, deck: false });
  for (const s of [-1, 1]) {
    add(-0.35, -0.33, 0.33 * s, 0.11, 0.1 * sb, 0.0, 0.55);
    add(-0.13, -0.35, 0.36 * s, 0.12, 0.11 * sb, 0.0, 0.9);
    add(0.11, -0.35, 0.35 * s, 0.11, 0.13, 0.012, 1.5);
    add(0.34, -0.29, 0.26 * s, 0.08, 0.09, 0.075, 1.6);
  }
  add(0.53, -0.12, 0, 0.06, 0.08, 0.2, 1.6);
  add(-0.24, -0.42, 0, 0.06, 0.08 * sb, 0.0, 0.8);
  add(0.18, -0.42, 0, 0.04, 0.16, 0.02, 1.5);
  let sw = 0;
  let swl = 0;
  for (const p of P) {
    sw += p.w;
    swl += p.wl;
  }
  for (const p of P) {
    p.w /= sw;
    p.wl /= swl;
  }
  // Deck points: only float the hull when it is upside down.
  for (const [x, z] of [
    [0.3, 0],
    [-0.2, 0.3],
    [-0.2, -0.3],
  ]) {
    P.push({ x: x * L, y: 0.42, z: z * B, w: 0.3, wl: 0, rocker: 0, lift: 0, deck: true });
  }
  return P;
}

export class SkiPhysics {
  constructor(spec, world) {
    this.world = world;
    this.setSpec(spec);
    this.px = 0;
    this.py = 0;
    this.pz = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.qx = 0;
    this.qy = 0;
    this.qz = 0;
    this.qw = 1;
    this.wx = 0;
    this.wy = 0;
    this.wz = 0;
    this.ctrl = { throttle: 0, brake: 0, steer: 0, lean: 0, trimCmd: 0 };
    this.trim = 0; // -1 (bow down) .. +1 (bow up)
    this.steerAngle = 0;
    this.rpmN = 0.1;
    this.pumpLoad = 1;
    this.leanIn = 0;
    this.powLag = 0;
    this.fhx = 1;
    this.fhz = 0;
    this.time = 0;
    this.frozen = false;
    this._s = {};
    this._n = { x: 0, y: 1, z: 0 };
    const n = this.points.length;
    this.ptPos = new Float32Array(n * 3);
    this.ptVel = new Float32Array(n * 3);
    this.ptDepth = new Float32Array(n);
    this.tele = {
      speed: 0, u: 0, v: 0, slip: 0, pitch: 0, roll: 0, yawRate: 0,
      airborne: false, airTime: 0, wet: 0, ground: 0,
      pumpLoad: 1, nozzleDepth: 0.1, exposure: 0, thrustN: 0, rpmN: 0.1,
      jetSpeed: 0, trimAngle: 0, steerAngle: 0, impact: 0, reverse: 0,
      fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0, rx: 0, ry: 0, rz: 1,
      nozzle: { x: 0, y: 0, z: 0 },
      jetDir: { x: -1, y: 0, z: 0 },
      nozzleVel: { x: 0, y: 0, z: 0 },
      waterAtNozzle: 0,
      gLat: 0, gLong: 0,
    };
  }

  setSpec(spec) {
    this.spec = spec;
    this.points = buildPoints(spec);
    this.m = spec.mass;
    // Water forces scale with hull size, not with mass, so a heavy ski sits
    // deeper, reacts slower and stays planted while a light one skips around.
    this.mh = 300 * (spec.L * spec.B) / (2.79 * 1.18);
    this.Ix = spec.mass * Math.pow(spec.B * 0.34, 2); // roll
    this.Iy = spec.mass * Math.pow(spec.L * 0.27, 2); // yaw
    this.Iz = spec.mass * Math.pow(spec.L * 0.265, 2); // pitch
    const light = spec.style === 'spark';
    this.leanRate = spec.leanRate ?? (light ? 1.5 : 0.7); // how fast the rider can roll the hull onto its side
    this.unhook = spec.unhook ?? (light ? 0.28 : 0.36); // grip left once the V is out of the water
    this.carve = spec.carve ?? (light ? 0.62 : 0.6); // full-lock demand as a fraction of grip
    this.hopK = spec.hop ?? (light ? 1 : 0.5);
    this.nozzleL = { x: -0.4 * spec.L, y: -0.245, z: 0 };
    this.intakeL = { x: -0.17 * spec.L, y: -0.45, z: 0 };
    // Quadratic drag solved so that thrust == drag at the rated top speed.
    this.vFree = spec.top * 1.06;
    const tTop = spec.thrust * (1 - 0.78 * Math.pow(spec.top / this.vFree, 2));
    this.dragQ = (tTop - 0.45 * spec.top * spec.top) / (spec.top * spec.top) / spec.mass;
    if (this.ptPos && this.ptPos.length !== this.points.length * 3) {
      this.ptPos = new Float32Array(this.points.length * 3);
      this.ptVel = new Float32Array(this.points.length * 3);
      this.ptDepth = new Float32Array(this.points.length);
    }
  }

  reset(x, z, yaw = 0) {
    this.px = x;
    this.pz = z;
    this.world.sample(x, z, this.time, this._s);
    this.py = Math.max(this._s.water, this._s.ground) + 0.2;
    this.vx = this.vy = this.vz = 0;
    this.wx = this.wy = this.wz = 0;
    this.qx = 0;
    this.qz = 0;
    this.qy = Math.sin(yaw / 2);
    this.qw = Math.cos(yaw / 2);
    this.steerAngle = 0;
    this.rpmN = 0.1;
    this.tele.airTime = 0;
    this.frozen = false;
  }

  get yaw() {
    return Math.atan2(-this.fhz, this.fhx);
  }

  step(dt) {
    if (this.frozen) return;
    const sp = this.spec;
    const m = this.m;
    const c = this.ctrl;
    const T = this.tele;
    this.time += dt;
    const t = this.time;

    // --- basis vectors -----------------------------------------------------
    const qx = this.qx, qy = this.qy, qz = this.qz, qw = this.qw;
    const fx = 1 - 2 * (qy * qy + qz * qz), fy = 2 * (qx * qy + qw * qz), fz = 2 * (qx * qz - qw * qy);
    const ux = 2 * (qx * qy - qw * qz), uy = 1 - 2 * (qx * qx + qz * qz), uz = 2 * (qy * qz + qw * qx);
    const rx = 2 * (qx * qz + qw * qy), ry = 2 * (qy * qz - qw * qx), rz = 1 - 2 * (qx * qx + qy * qy);
    // horizontal heading; when the hull is near vertical keep the last good one
    let fl = Math.hypot(fx, fz);
    if (fl > 0.25) {
      const s = uy >= -0.2 ? 1 : 1;
      this.fhx = (fx / fl) * s;
      this.fhz = (fz / fl) * s;
    } else {
      // derive heading from the up vector (tail-stand): heading is opposite to
      // where the deck faces horizontally.
      const ul = Math.hypot(ux, uz);
      if (ul > 0.3) {
        const sgn = fy > 0 ? -1 : 1;
        this.fhx = (ux / ul) * sgn;
        this.fhz = (uz / ul) * sgn;
      }
    }
    const fhx = this.fhx, fhz = this.fhz;
    const rhx = -fhz, rhz = fhx; // right, horizontal
    const upright = smoothstep(0.0, 0.5, uy);

    // --- actuators ----------------------------------------------------------
    this.steerAngle = damp(this.steerAngle, c.steer * sp.steerMax, 0.045, dt);
    this.trim = clamp(this.trim + c.trimCmd * dt * 1.6, -1, 1);
    const trimAngle = this.trim > 0 ? this.trim * sp.trimUp : this.trim * sp.trimDown;
    const delta = this.steerAngle;

    const thr = c.brake > 0.05 ? 0 : c.throttle;
    const demand = Math.max(thr, c.brake * 0.75);
    let rpmT = 0.11 + 0.89 * demand;
    if (this.pumpLoad < 0.45 && demand > 0.15) rpmT = Math.min(1.05, rpmT + 0.3); // pump unloads, engine flares
    this.rpmN = damp(this.rpmN, rpmT, rpmT > this.rpmN ? 0.13 : 0.28, dt);
    let power = Math.pow(clamp((this.rpmN - 0.11) / 0.89, 0, 1), 1.7);
    {
      // throttle feathering near the tail-stand balance point
      const lim = (c.lean < 0 ? sp.wheelieMax : 0.5) + 0.12;
      power *= 0.12 + 0.88 * smoothstep(lim + 0.12, lim - 0.14, Math.asin(clamp(fy, -1, 1)) + 0.12 * (this.wx * rx + this.wy * ry + this.wz * rz));
    }

    // Throttle hit with the trim up: the jet is aimed at the sky, the stern
    // squats, the bow snaps up and the whole ski hops off the water.
    this.powLag = damp(this.powLag, power, 0.22, dt);
    const trimFrac = clamp(this.trim, 0, 1);
    const hop = Math.max(0, power - this.powLag) * trimFrac * this.hopK * this.pumpLoad;

    // Leaning in: holding full lock on the gas, the rider rolls the hull onto
    // its side. Once the V bottom comes out of the water the hull unhooks and
    // slides. Heavy skis take longer to tip; Shift (weight forward) helps.
    const rollNow = -Math.asin(clamp(ry, -1, 1));
    {
      // c.lean > 0 is the slide button: only then does the rider throw the
      // hull over. Without it the ski stays hooked up and carves.
      const want = c.lean > 0 && Math.abs(c.steer) > 0.3 && Math.hypot(this.vx, this.vz) > 4;
      const rate = want ? this.leanRate * (1 + trimFrac * 0.5) : -2.5;
      this.leanIn = clamp(this.leanIn + rate * dt, 0, 1);
    }
    const unhooked = this.leanIn * smoothstep(0.3, 0.65, Math.abs(rollNow)) * upright;
    const gripMul = 1 - (1 - this.unhook) * unhooked;

    let Fx = 0, Fy = -m * G, Fz = 0;
    let Tx = 0, Ty = 0, Tz = 0;
    const addForce = (ax, ay, az, bx, by, bz) => {
      // force (bx,by,bz) at world offset (ax,ay,az)
      Fx += bx; Fy += by; Fz += bz;
      Tx += ay * bz - az * by;
      Ty += az * bx - ax * bz;
      Tz += ax * by - ay * bx;
    };

    const ucm = this.vx * fhx + this.vz * fhz;
    const vcm = this.vx * rhx + this.vz * rhz;

    // --- hull points --------------------------------------------------------
    const S = this._s;
    const N = this._n;
    let wet = 0, groundN = 0, impact = 0, wetStern = 0, latCap = 0;
    const pts = this.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const ox = p.x * fx + p.y * ux + p.z * rx;
      const oy = p.x * fy + p.y * uy + p.z * ry;
      const oz = p.x * fz + p.y * uz + p.z * rz;
      const wxp = this.px + ox, wyp = this.py + oy, wzp = this.pz + oz;
      const pvx = this.vx + this.wy * oz - this.wz * oy;
      const pvy = this.vy + this.wz * ox - this.wx * oz;
      const pvz = this.vz + this.wx * oy - this.wy * ox;
      this.world.sample(wxp, wzp, t, S);
      const depth = S.water - wyp;
      this.ptPos[i * 3] = wxp; this.ptPos[i * 3 + 1] = wyp; this.ptPos[i * 3 + 2] = wzp;
      this.ptVel[i * 3] = pvx; this.ptVel[i * 3 + 1] = pvy; this.ptVel[i * 3 + 2] = pvz;
      this.ptDepth[i] = depth;

      // solid ground / ramps
      const pen = S.ground - wyp;
      if (pen > 0 && !p.deck) {
        this.world.groundNormal(wxp, wzp, N);
        const vn = pvx * N.x + pvy * N.y + pvz * N.z;
        let fn = m * p.w * (900 * pen * N.y - 42 * vn);
        if (fn > 0) {
          fn = Math.min(fn, m * p.w * 400);
          const tx = pvx - N.x * vn, ty = pvy - N.y * vn, tz = pvz - N.z * vn;
          const tl = Math.hypot(tx, ty, tz);
          const fr = (-S.mu * fn) / Math.max(tl, 0.6);
          addForce(ox, oy, oz, N.x * fn + tx * fr, N.y * fn + ty * fr, N.z * fn + tz * fr);
          groundN += p.w;
        }
      }

      if (depth <= 0) continue;
      const sub = Math.min(depth / SUB_MAX, 1);
      const relVy = pvy - S.vy;
      if (p.deck) {
        addForce(ox, oy, oz, 0, m * p.w * (G * 3 * sub - 5 * relVy * sub), 0);
        continue;
      }
      wet += p.w * Math.min(1, depth / 0.12);
      if (p.x < 0) wetStern += p.w * Math.min(1, depth / 0.1);

      // buoyancy + heave damping + slam
      let fyp = G * 3.0 * sub - 8.5 * relVy * (0.35 + 0.65 * sub);
      if (relVy < 0) {
        fyp += 2.6 * relVy * relVy * (0.3 + 0.7 * sub);
        if (depth < 0.25 && -relVy > impact) impact = -relVy;
      }

      // planing lift
      const up = pvx * fhx + pvz * fhz;
      if (up > 0.5 && upright > 0.1) {
        const slope = -(S.nx * fhx + S.nz * fhz);
        let aoa = fy + p.rocker + 0.035 + slope * 0.8 * Math.min(1, 24 / up) - relVy / Math.max(up, 4);
        aoa = clamp(aoa, -0.05, 0.42);
        fyp += Math.min(1.05 * p.lift * up * Math.min(up, 13) * aoa * Math.sqrt(sub), 60) * upright;
      }
      addForce(ox, oy, oz, 0, this.mh * p.w * fyp, 0);

      // horizontal hydrodynamics (applied at CoM height: yaw torque only)
      const vp = pvx * rhx + pvz * rhz;
      const wetL = 0.3 + 0.7 * Math.sqrt(sub);
      let fu = -(0.16 * up + this.dragQ * up * Math.abs(up)) * wetL * p.w * 0.82;
      if (up < 0) fu *= 1.7;
      const gripSub = Math.min(1, depth / 0.05);
      const vpk = 1.3 + 0.075 * Math.abs(ucm);
      const axs = Math.abs(vp / vpk);
      // tyre-like: builds to a peak, holds, then lets go progressively
      let g = axs < 1 ? (2 * axs) / (1 + axs * axs) : 1 - (1 - sp.slide) * smoothstep(1.2, 4.5, axs);
      const fl2 = -sign(vp) * (sp.grip * gripMul * g + 0.045 * vp * vp) * gripSub * p.wl;
      addForce(ox, 0, oz, fu * fhx * m, 0, fu * fhz * m);
      // Lateral force keeps only part of its yaw lever: enough for the centre
      // of lateral resistance to matter (planted bow = tail-happy) without
      // making the hull a weathervane.
      addForce(ox * ARM_K, 0, oz * ARM_K, fl2 * rhx * m, 0, fl2 * rhz * m);
      latCap += gripSub * p.wl;
    }
    wet = Math.min(wet * 1.15, 1);
    wetStern = Math.min(wetStern * 2.2, 1);

    // --- jet pump -----------------------------------------------------------
    const il = this.intakeL;
    const ix = il.x * fx + il.y * ux, iy = il.x * fy + il.y * uy, iz = il.x * fz + il.y * uz;
    this.world.sample(this.px + ix, this.pz + iz, t, S);
    let load = smoothstep(-0.07, 0.04, S.water - (this.py + iy));
    if (S.ground > S.water - 0.06) load = 0;
    this.pumpLoad = damp(this.pumpLoad, load, load > this.pumpLoad ? 0.03 : 0.09, dt);

    const nl = this.nozzleL;
    const nx = nl.x * fx + nl.y * ux, ny = nl.x * fy + nl.y * uy, nz = nl.x * fz + nl.y * uz;
    this.world.sample(this.px + nx, this.pz + nz, t, S);
    const nozzleDepth = S.water - (this.py + ny);
    T.waterAtNozzle = S.water;

    const ct = Math.cos(trimAngle), st = Math.sin(trimAngle);
    const cd = Math.cos(delta), sd = Math.sin(delta);
    // direction the water leaves the nozzle (body frame): aft, up with trim,
    // and to the side the bars are turned.
    const jl = { x: -ct * cd, y: st, z: ct * sd };
    const jx = jl.x * fx + jl.y * ux + jl.z * rx;
    const jy = jl.x * fy + jl.y * uy + jl.z * ry;
    const jz = jl.x * fz + jl.y * uz + jl.z * rz;

    let thrust = 0;
    let reverse = 0;
    if (c.brake > 0.05) {
      // iBR: the reverse gate drops over the jet and throws it forward + down
      reverse = c.brake;
      const tr = sp.thrust * 0.62 * power * this.pumpLoad;
      const lim = ucm < -4 ? smoothstep(-7, -4, ucm) : 1;
      addForce(nx, ny, nz,
        (-fx * 0.92 + ux * 0.28 - rx * sd * 0.6) * tr * lim,
        (-fy * 0.92 + uy * 0.28 - ry * sd * 0.6) * tr * lim,
        (-fz * 0.92 + uz * 0.28 - rz * sd * 0.6) * tr * lim);
      thrust = tr;
    } else {
      const fall = clamp(1 - 0.78 * Math.pow(Math.max(ucm, 0) / this.vFree, 2), 0.1, 1) * smoothstep(sp.top * 1.07, sp.top * 0.97, ucm);
      // Net forward thrust falls away with boat speed, but the sideways and
      // vertical components come from deflecting the whole jet (gross
      // momentum flux), so steering and trim stay powerful at speed.
      const gross = sp.thrust * power * this.pumpLoad;
      thrust = gross * fall;
      const a = -jl.x * thrust, b = -jl.y * gross * 0.85, d = -jl.z * gross * 0.8;
      addForce(nx, ny, nz, fx * a + ux * b, fy * a + uy * b, fz * a + uz * b);
      Fx += rx * d; Fy += ry * d; Fz += rz * d;
    }

    // --- steering ----------------------------------------------------------
    // The deflected jet shoves the stern sideways and the hull hooks up and
    // carves. Hooked up, yaw rate follows the bars up to the grip limit; push
    // past it and the stern breaks loose and the ski rotates much faster
    // (powerslide). Off the throttle there is very little steering, exactly
    // like the real thing.
    const sN = delta / sp.steerMax;
    const yawRateR = -(this.wx * ux + this.wy * uy + this.wz * uz);
    {
      const jetFrac = Math.sqrt(power * this.pumpLoad) * (c.brake > 0.05 ? 0.6 : 1);
      const au = Math.abs(ucm);
      const spdH = Math.hypot(this.vx, this.vz);
      const rHook = Math.min((au + 5 * jetFrac) / sp.turnR, (sp.grip * this.carve) / Math.max(au, 1));
      const slipA = spdH > 2 ? Math.abs(Math.atan2(vcm, Math.abs(ucm) + 0.5)) : 0;
      const li = this.leanIn;
      // only a committed slide lets the stern come round; otherwise the rider
      // eases the bars as soon as the hull starts to slip and it stays hooked up
      const loose = Math.max(smoothstep(0.16, 0.55, slipA), unhooked * 0.7) * smoothstep(3, 7, spdH) * smoothstep(0, 0.35, li);
      const hold = 1 - (1 - smoothstep(0, 0.35, li)) * smoothstep(0.1, 0.3, slipA) * 0.9;
      const rLoose = 0.8 + 1.7 * jetFrac;
      const rCmd = sN * (rHook + (Math.max(rLoose, rHook) - rHook) * loose) * hold;
      const auth = wetStern * upright * (0.16 * clamp(au / 6, 0, 1) + 0.84 * jetFrac);
      const ts = this.Iy * 7.5 * (rCmd - yawRateR) * auth;
      Tx -= ux * ts; Ty -= uy * ts; Tz -= uz * ts;
      T.rCmd = rCmd;
    }

    // --- banking: the V hull + rider lean the ski into the turn -------------
    const aLat = yawRateR * Math.max(ucm, 0);
    const bankRaw = clamp(Math.atan2(aLat, G) * 0.75 + sN * 0.1 * clamp(ucm / 8, 0, 1), -0.6, 0.6) + Math.sign(sN) * this.leanIn * 0.6;
    this.bankS = damp(this.bankS || 0, clamp(bankRaw, -0.92, 0.92), 0.22, dt);
    const bankT = this.bankS;
    const roll = -Math.asin(clamp(ry, -1, 1));
    const wRoll = this.wx * fx + this.wy * fy + this.wz * fz;
    const bankK = (wet * 0.85 + 0.15 * Math.min(1, groundN * 3)) * upright;
    const li = this.leanIn;
    let tb = ((150 + 120 * li) * (bankT - roll) - (24 + 8 * li) * wRoll) * Math.max(bankK, 0.55 * li * upright * Math.min(1, wet * 4 + groundN * 4));
    // the rider can only shove so hard, and never past the point of no return
    tb = this.Ix * clamp(tb, -55, 55) * smoothstep(1.35, 1.05, Math.abs(roll));
    Tx += fx * tb; Ty += fy * tb; Tz += fz * tb;

    // --- rider weight -------------------------------------------------------
    // lean > 0 = weight forward (nose down), lean < 0 = pull back (nose up)
    const air = wet < 0.02 && groundN < 0.02;
    let tp;
    const pitchNow = Math.asin(clamp(fy, -1, 1));
    const wPitch = this.wx * rx + this.wy * ry + this.wz * rz;
    if (c.lean < 0 && !air) {
      // pulling back: the rider hunts for the balance point instead of
      // looping the ski over backwards
      const target = sp.wheelieMax * -c.lean;
      tp = clamp(this.Iz * (26 * (target - pitchNow) - 7 * wPitch), -sp.leanTorque * 1.4, sp.leanTorque);
    } else {
      tp = -c.lean * sp.leanTorque * (air ? 0.75 : 0.3);
    }
    // engine + rider sit aft of the centre of buoyancy: static bow-up trim
    tp += m * G * 0.17 * wet * upright;
    // sliding backwards the bow trips and digs in, the stern lifts
    if (ucm < -0.8) tp -= this.Iz * 15 * Math.min(-ucm - 0.8, 6) / 6 * wet * upright;
    // sliding hard sideways also loads the bow a little
    tp -= this.Iz * 1.4 * Math.min(Math.abs(vcm), 10) / 10 * wet * upright * clamp(1 - this.trim, 0, 1);
    tp += this.Iz * 6 * hop * (wetStern * 0.8 + 0.2);
    // not pulling back: the rider's weight keeps the bow from standing up
    if (c.lean >= 0 && !air && pitchNow > 0.35) tp -= Math.min(this.Iz * (24 * (pitchNow - 0.35) + 5 * Math.max(wPitch, 0)), sp.leanTorque * 2.2);
    // At real speed the rider is braced and working the ski flat: without it
    // a 150 km/h hull would kite or stuff its nose on the first bit of chop.
    const stab = c.lean === 0 ? smoothstep(17, 32, Math.abs(ucm)) * upright : 0;
    if (stab > 0) {
      tp += clamp(this.Iz * (20 * (0.05 - pitchNow) - 7 * wPitch), -sp.leanTorque * 3, sp.leanTorque * 3) * stab;
      if (air) {
        const tr = this.Ix * clamp(-10 * roll - 4 * wRoll, -30, 30) * stab;
        Tx += fx * tr; Ty += fy * tr; Tz += fz * tr;
      }
    }
    Tx += rx * tp; Ty += ry * tp; Tz += rz * tp;
    if (air) {
      // a touch of body english in the air
      Ty += -sN * this.Iy * 1.6;
    }

    // --- aero + angular damping --------------------------------------------
    const spd = Math.hypot(this.vx, this.vy, this.vz);
    Fx -= 0.45 * spd * this.vx; Fy -= 0.45 * spd * this.vy; Fz -= 0.45 * spd * this.vz;
    {
      const wr = wRoll, wyaw = this.wx * ux + this.wy * uy + this.wz * uz, wp = this.wx * rx + this.wy * ry + this.wz * rz;
      const kR = 0.2 + 1.6 * wet, kY = 0.12 + 0.75 * wet, kP = 0.2 + 2.6 * wet;
      const dr = -this.Ix * kR * wr, dy = -this.Iy * (kY * wyaw + 0.5 * wet * wyaw * Math.abs(wyaw)), dp = -this.Iz * kP * wp;
      Tx += fx * dr + ux * dy + rx * dp;
      Ty += fy * dr + uy * dy + ry * dp;
      Tz += fz * dr + uz * dy + rz * dp;
    }

    // --- integrate ----------------------------------------------------------
    const ax = Fx / m, ay = Fy / m, az = Fz / m;
    this.vx += ax * dt; this.vy += ay * dt; this.vz += az * dt;
    this.px += this.vx * dt; this.py += this.vy * dt; this.pz += this.vz * dt;

    const tbx = (Tx * fx + Ty * fy + Tz * fz) / this.Ix;
    const tby = (Tx * ux + Ty * uy + Tz * uz) / this.Iy;
    const tbz = (Tx * rx + Ty * ry + Tz * rz) / this.Iz;
    this.wx += (fx * tbx + ux * tby + rx * tbz) * dt;
    this.wy += (fy * tbx + uy * tby + ry * tbz) * dt;
    this.wz += (fz * tbx + uz * tby + rz * tbz) * dt;
    const wl = Math.hypot(this.wx, this.wy, this.wz);
    if (wl > 14) {
      const k = 14 / wl;
      this.wx *= k; this.wy *= k; this.wz *= k;
    }
    const hx = 0.5 * dt;
    const dqx = (this.wx * qw + this.wy * qz - this.wz * qy) * hx;
    const dqy = (this.wy * qw + this.wz * qx - this.wx * qz) * hx;
    const dqz = (this.wz * qw + this.wx * qy - this.wy * qx) * hx;
    const dqw = -(this.wx * qx + this.wy * qy + this.wz * qz) * hx;
    let nqx = qx + dqx, nqy = qy + dqy, nqz = qz + dqz, nqw = qw + dqw;
    const ql = 1 / Math.hypot(nqx, nqy, nqz, nqw);
    this.qx = nqx * ql; this.qy = nqy * ql; this.qz = nqz * ql; this.qw = nqw * ql;

    // --- telemetry ----------------------------------------------------------
    T.speed = Math.hypot(this.vx, this.vz);
    T.u = ucm; T.v = vcm;
    T.slip = T.speed > 1.5 ? Math.atan2(vcm, Math.abs(ucm)) : 0;
    T.pitch = Math.asin(clamp(fy, -1, 1));
    T.roll = roll;
    T.yawRate = yawRateR;
    T.wet = wet;
    T.ground = groundN;
    T.airborne = air;
    T.airTime = air ? T.airTime + dt : 0;
    T.pumpLoad = this.pumpLoad;
    T.nozzleDepth = nozzleDepth;
    T.exposure = smoothstep(0.07, -0.05, nozzleDepth);
    T.thrustN = thrust / sp.thrust;
    T.power = power;
    T.rpmN = this.rpmN;
    T.jetSpeed = (9 + (sp.jet - 9) * power) * (0.25 + 0.75 * this.pumpLoad);
    T.trimAngle = trimAngle;
    T.steerAngle = delta;
    T.reverse = reverse;
    T.leanIn = this.leanIn;
    T.unhooked = unhooked;
    if (impact > T.impact) T.impact = impact;
    T.fx = fx; T.fy = fy; T.fz = fz; T.ux = ux; T.uy = uy; T.uz = uz; T.rx = rx; T.ry = ry; T.rz = rz;
    T.nozzle.x = this.px + nx; T.nozzle.y = this.py + ny; T.nozzle.z = this.pz + nz;
    T.jetDir.x = jx; T.jetDir.y = jy; T.jetDir.z = jz;
    T.nozzleVel.x = this.vx + this.wy * nz - this.wz * ny;
    T.nozzleVel.y = this.vy + this.wz * nx - this.wx * nz;
    T.nozzleVel.z = this.vz + this.wx * ny - this.wy * nx;
    T.gLong = (ax * fhx + az * fhz) / G;
    T.gLat = (ax * rhx + az * rhz) / G;
  }
}

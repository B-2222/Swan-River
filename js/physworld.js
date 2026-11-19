// The "world" object that js/skiphysics/physics.js (SkiPhysics) samples.
// It reads the game's own water surface (the same waves the water shader draws: Fremantle Doctor chop,
// ocean swell through the moles) and the real river bed / land heights from the OSM-built terrain grid.
// Both use the game's world axes: x east, z south, y up (heading 0 for SkiPhysics points east).
import { heightAt } from './world.js';
import { waveSample } from './water.js';
import { skiById } from './skiphysics/specs.js';

// opts.extraBumps(x, z): optional extra water height, e.g. boat wakes (Boats.wakeBumps)
export function makePhysWorld(opts = {}) {
  const ws = {};
  return {
    sample(x, z, t, out) {
      waveSample(x, z, t, ws);
      let h = ws.h, gx = ws.dx, gz = ws.dz;
      if (opts.extraBumps) {
        // boat wakes: height plus slope, so the planing hull really rides up the face and launches off it
        const e = 0.3, b0 = opts.extraBumps(x, z);
        if (b0 !== 0) { // exactly 0 only outside every wake
          h += b0;
          gx += (opts.extraBumps(x + e, z) - b0) / e;
          gz += (opts.extraBumps(x, z + e) - b0) / e;
        }
      }
      out.water = h;
      out.ground = heightAt(x, z);      // river bed (negative) or land; the ocean beyond the map is -18
      out.vy = ws.dt;                   // vertical speed of the surface
      const l = Math.hypot(gx, 1, gz);
      out.nx = -gx / l;                 // horizontal parts of the water surface normal (0 when flat)
      out.nz = -gz / l;
      out.mu = 0.5;
      return out;
    },
    // water surface height (used by the spray effects)
    waterHeight(x, z, t) { return waveSample(x, z, t, ws).h + (opts.extraBumps ? opts.extraBumps(x, z) : 0); },
    groundNormal(x, z, n) {
      const e = 2;
      const hx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
      const hz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      const l = Math.hypot(hx, 1, hz);
      n.x = -hx / l; n.y = 1 / l; n.z = -hz / l;
      return n;
    },
  };
}

// Flat calm water at height 0 over deep water, for tests and tuning.
export const flatWorld = {
  sample(x, z, t, out) { out.water = 0; out.ground = -30; out.vy = 0; out.nx = 0; out.nz = 0; out.mu = 0.5; return out; },
  groundNormal(x, z, n) { n.x = 0; n.y = 1; n.z = 0; return n; },
};

// Physics spec for each ski in the game's garage. Masses include an 80 kg rider.
// gripFast makes the hull bite harder at planing speed so it carves tight like a real ski (about 1.5 to
// 2.5 g on a hard turn); unhook is scaled down by the same factor so a committed power slide still
// lets go as easily as the stock jetskirider tune.
const tune = (s, gripFast, carve, turnR) => ({ ...s, gripFast, carve, turnR, unhook: (s.style === 'spark' ? 0.28 : 0.36) / (1 + gripFast) });
export function physSpecFor(spec) {
  if (spec.id === 'spark') return tune(skiById('trixx'), 1.6, 1.0, 2.2);
  if (spec.id === 'gp') return tune({ ...skiById('rxp'), id: 'gp', name: 'GP SVHO', L: 3.35, B: 1.24, mass: 435, thrust: 4750, top: 29.3, jet: 42, grip: 33 }, 1.25, 0.82, 3.1);
  if (spec.id === 'ultra') return tune({ ...skiById('rxt'), id: 'ultra', name: 'ULTRA 310R', L: 3.66, B: 1.21, mass: 515, thrust: 5300, top: 30.4, jet: 45, grip: 30, leanTorque: 280, big: true }, 1.1, 0.8, 3.4);
  return tune(skiById('rxp'), 1.4, 0.8, 3.0);
}

// The "world" object that js/skiphysics/physics.js (SkiPhysics) samples.
// It reads the game's own water surface (the same waves the water shader draws: Fremantle Doctor chop,
// ocean swell through the moles) and the real river bed / land heights from the OSM-built terrain grid.
// Both use the game's world axes: x east, z south, y up (heading 0 for SkiPhysics points east).
import { heightAt } from './world.js';
import { waveSample } from './water.js';

// opts.extraBumps(x, z): optional extra water height, e.g. boat wakes (Boats.wakeBumps)
export function makePhysWorld(opts = {}) {
  const ws = {};
  return {
    sample(x, z, t, out) {
      waveSample(x, z, t, ws);
      out.water = ws.h + (opts.extraBumps ? opts.extraBumps(x, z) : 0);
      out.ground = heightAt(x, z);      // river bed (negative) or land; the ocean beyond the map is -18
      out.vy = ws.dt;                   // vertical speed of the surface
      const l = Math.hypot(ws.dx, 1, ws.dz);
      out.nx = -ws.dx / l;              // horizontal parts of the water surface normal (0 when flat)
      out.nz = -ws.dz / l;
      out.mu = 0.5;
      return out;
    },
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

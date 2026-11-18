// Swan River Hoon: main loop.
import * as THREE from 'three';
import { loadWorld, W, sdfAt, heightAt, toXZ, oceanAt } from './world.js';
import { createTerrain, createIslands } from './terrain.js';
import { createWater, waveState } from './water.js';
import { createSky } from './sky.js';
import { createStatic } from './static.js';
import { JetSki, ChaseCam, KN } from './jetski.js';
import { Spray } from './spray.js';
import { People, Traffic, LINES } from './npc.js';
import { Boats } from './boats.js';
import { Police, FINES } from './police.js';
import { zoneAt, placeName } from './zones.js';
import { buildNav, randomWater } from './nav.js';
import { HUD } from './hud.js';
import { Sound } from './audio.js';
import { SKIS } from './models.js';
import { pollInput, takePressed, clearPressed, setupTouch, input } from './input.js';

const SPAWNS = [
  { id: 'eq', name: 'Elizabeth Quay', desc: 'Perth Water, under the CBD. 8 knot zone.', lon: 115.8600, lat: -31.9625, yaw: 1.4 },
  { id: 'boatshed', name: 'Crawley Edge Boatshed', desc: 'Matilda Bay. The blue boatshed and its tourists.', lon: 115.8285, lat: -31.9755, yaw: 3.1 },
  { id: 'pwc', name: 'Narrows PWC Area', desc: 'The legal jet ski freestyle area.', lon: 115.8410, lat: -31.9700, yaw: 0.6 },
  { id: 'walter', name: 'Point Walter', desc: 'The sand spit, Blackwall Reach cliffs next door.', lon: 115.7930, lat: -32.0075, yaw: -1.6 },
  { id: 'freo', name: 'Fremantle Harbour', desc: 'Ships, cranes and the run out through the moles.', lon: 115.7440, lat: -32.0478, yaw: 1.1 },
  { id: 'canning', name: 'Canning Bridge', desc: 'Como and Mount Pleasant. Low bridges.', lon: 115.8520, lat: -32.0025, yaw: 3.3 },
  { id: 'stadium', name: 'Optus Stadium', desc: 'Burswood, Matagarup Bridge and the Causeway.', lon: 115.8830, lat: -31.9590, yaw: 0.2 },
  { id: 'cott', name: 'Cottesloe', desc: 'Ocean side. Swell, beachgoers and the Indiana.', lon: 115.7440, lat: -31.9950, yaw: -1.2 },
];

const state = { running: false, paused: true, started: false, score: 0, combo: 1, comboT: 0, fines: 0, skiIdx: 0, spawnIdx: 0, tail: 1.6, gfx: 1,
  driftT: 0, driftPts: 0, bridgeCool: {}, donut: 0, donutT: 0, oceanBadge: false, rottoBadge: false, speedT: 0, freestyle: false, nearMissCool: 0, mapOpen: false };

const canvas = document.getElementById('c');
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 60000);
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, [1, 1.5, 2][state.gfx]) * (state.gfx === 0 ? 0.8 : 1);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
resize();
addEventListener('resize', resize);

let sky, terrain, water, world, spray, people, traffic, boats, police, ski, cam, hud;
const sound = new Sound();

function waterSpot(lon, lat) {
  let [x, z] = toXZ(lon, lat);
  if (sdfAt(x, z) > -12) { const p = randomWater(x, z, 300, -15, 200); if (p) [x, z] = p; }
  return [x, z];
}

async function boot() {
  const fill = document.getElementById('loadFill'), msgEl = document.getElementById('loadMsg');
  await loadWorld((f, label) => { fill.style.width = `${f * 70}%`; msgEl.textContent = `Loading ${label}...`; });
  const step = async (label, pct, fn) => { msgEl.textContent = label; fill.style.width = pct + '%'; await new Promise(r => setTimeout(r, 0)); return fn(); };
  sky = await step('Lighting up the sky...', 72, () => createSky(scene, renderer));
  terrain = await step('Shaping Kings Park and the river banks...', 76, () => createTerrain(scene));
  await step('Rottnest on the horizon...', 78, () => createIslands(scene));
  water = await step('Filling the Swan River...', 80, () => createWater(scene, sky));
  world = await step('Building the CBD, bridges and jetties...', 86, () => createStatic(scene));
  await step('Charting the channels...', 92, () => buildNav());
  spray = new Spray(scene);
  people = new People(scene);
  traffic = new Traffic(scene);
  boats = new Boats(scene);
  ski = new JetSki(scene, SKIS[0]);
  cam = new ChaseCam(camera);
  hud = new HUD(camera);
  police = new Police(scene, {
    msg: (t, c) => hud.msg(t, c),
    bubble: (x, y, z, t, c) => { hud.bubble(x, y, z, t, c); sound.speak(t, 'cop'); },
    busted: (list) => onBusted(list),
    siren: (d) => { state.sirenDist = d; },
    escaped: () => addScore(1500, 'ESCAPED!'),
  });
  ski.extraBumps = (x, z) => boats.wakeBumps(x, z);
  spawnAt(0);
  sky.hour = 15.5;
  sky.update(0, camera.position, false);
  terrain.prewarm(camera.position, state.gfx);
  fill.style.width = '100%';
  setupTouch();
  buildMenu();
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
  requestAnimationFrame(loop);
}

function spawnAt(i) {
  const s = SPAWNS[i];
  const [x, z] = waterSpot(s.lon, s.lat);
  ski.place(x, z, s.yaw);
  cam.init = false;
}

// ------------------------------------------------------------------ menu
function buildMenu() {
  const sl = document.getElementById('skiList'), sp = document.getElementById('spawnList');
  sl.innerHTML = ''; sp.innerHTML = '';
  SKIS.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'card' + (i === state.skiIdx ? ' sel' : '');
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');
    d.innerHTML = `<b><span class="swatch" style="background:${hex(s.deck)}"></span>${s.name}</b><small>${s.hp} hp &middot; ~${s.topKn} kn (${Math.round(s.topKn * 1.852)} km/h) &middot; ${s.len} m</small><small>${s.blurb}</small>`;
    d.onclick = () => { state.skiIdx = i; buildMenu(); };
    sl.appendChild(d);
  });
  SPAWNS.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'card' + (i === state.spawnIdx ? ' sel' : '');
    d.innerHTML = `<b>${s.name}</b><small>${s.desc}</small>`;
    d.onclick = () => { state.spawnIdx = i; state.respawn = true; buildMenu(); };
    sp.appendChild(d);
  });
  document.getElementById('startBtn').textContent = state.started ? 'BACK ON THE WATER' : 'HIT THE WATER';
}
document.getElementById('startBtn').onclick = () => {
  state.tail = parseFloat(document.getElementById('optTail').value);
  const g = parseInt(document.getElementById('optGfx').value, 10);
  if (g !== state.gfx) { state.gfx = g; resize(); }
  sound.voices = document.getElementById('optVoices').checked;
  sound.enabled = document.getElementById('optSound').checked;
  if (!state.started || state.timeChanged) { sky.hour = parseFloat(document.getElementById('optTime').value); state.timeChanged = false; }
  if (ski.spec !== SKIS[state.skiIdx]) ski.setSpec(SKIS[state.skiIdx]);
  if (!state.started || state.respawn) { spawnAt(state.spawnIdx); state.respawn = false; }
  sound.init();
  state.started = true; state.paused = false;
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  clearPressed();
  if (!state.welcomed) {
    state.welcomed = true;
    hud.big('SWAN RIVER', 'Hold W to send it. SHIFT to slide. Soak the foreshore.', 3.5);
  }
};
document.getElementById('optTime').onchange = () => { state.timeChanged = true; };
function openMenu() {
  state.paused = true;
  buildMenu();
  document.getElementById('menu').classList.remove('hidden');
}

// ------------------------------------------------------------------ scoring
function addScore(pts, label, sub = '') {
  state.combo = state.comboT > 0 ? Math.min(8, state.combo + 1) : 1;
  state.comboT = 3.5;
  const total = Math.round(pts * state.combo * (zoneNow && zoneNow.kind === 'pwc' ? 1.5 : 1));
  state.score += total;
  if (label) hud.big(label, `+${total}${state.combo > 1 ? `  x${state.combo}` : ''}${sub ? '  ' + sub : ''}`, 1.4);
  sound.ding();
}

function onBusted(list) {
  state.paused = true;
  const tbl = document.getElementById('fineTable');
  tbl.innerHTML = '';
  let total = 0;
  const counts = {};
  for (const t of list) counts[t] = (counts[t] || 0) + 1;
  for (const [t, n] of Object.entries(counts)) {
    const f = FINES[t];
    const tr = document.createElement('tr');
    const amt = f.amt * n; total += amt;
    tr.innerHTML = `<td>${f.label}${n > 1 ? ` &times;${n}` : ''}</td><td>${f.amt ? '$' + amt.toLocaleString() : f.note}</td>`;
    tbl.appendChild(tr);
  }
  const tr = document.createElement('tr'); tr.className = 'total';
  tr.innerHTML = `<td>Total</td><td>$${total.toLocaleString()}</td>`; tbl.appendChild(tr);
  state.fines += total;
  state.score = Math.max(0, state.score - total * 5);
  document.getElementById('busted').classList.remove('hidden');
}
document.getElementById('bustedBtn').onclick = () => {
  document.getElementById('busted').classList.add('hidden');
  state.paused = false;
  ski.vx = ski.vz = 0;
  clearPressed();
};

function soakPerson(p, n) {
  p.wet = Math.min(2, p.wet + n * 0.08);
  if (p.cooldown > 0) return;
  p.cooldown = 4; p.react = 1.4;
  if (n > 22 && p.kind !== 'swim' && p.kind !== 'roo') p.fall = 1;
  if (p.kind !== 'swim' && p.kind !== 'fish') p.flee = 2.5 + Math.random() * 2;
  const kind = p.kind === 'roo' ? 'roo' : p.kid ? 'kid' : p.kind === 'fish' ? 'fisher' : p.kind === 'selfie' ? 'tourist' : 'soaked';
  const lines = LINES[kind];
  const line = lines[Math.floor(Math.random() * lines.length)];
  hud.bubble(p.x, p.y, p.z, line);
  sound.speak(line, kind);
  sound.splash(0.8);
  const pts = p.kind === 'roo' ? 250 : p.kind === 'selfie' ? 200 : p.fall > 0 ? 180 : 100;
  addScore(pts, p.kind === 'roo' ? 'SOAKED A ROO!' : p.fall > 0 ? 'KNOCKED FLAT!' : 'SOAKED!');
  // somebody always calls it in
  police.report(ski.x, ski.z, police.seenNow ? 0 : 4);
  if (police.seenNow) police.offence('reckless', 12);
}
function soakCar(c, n) {
  if (c.honk > 0) return;
  c.honk = 5; c.slow = 2.5; c.wet = 1;
  sound.honk();
  const line = LINES.driver[Math.floor(Math.random() * LINES.driver.length)];
  hud.bubble(c.x, c.y, c.z, line);
  addScore(220, 'SOAKED A CAR!', 'on the bridge');
}
function soakCop(u, n) {
  if (u.soaked > 0) return;
  u.soaked = 5;
  hud.bubble(u.boat.x, 3, u.boat.z, 'You did NOT just do that.', 'cop');
  addScore(400, 'SOAKED THE COPS!');
  police.offence('police', 35);
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), zoneNow = null;
let fpsAcc = 0, fpsN = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  fpsAcc += now - last; fpsN++; if (fpsAcc > 1000) { state.fps = Math.round(fpsN * 1000 / fpsAcc); fpsAcc = 0; fpsN = 0; }
  last = now;
  if (!sky) return;
  if (state.paused) {
    sky.update(0, camera.position, false);
    water.update(dt, now / 1000, camera.position, ski);
    terrain.update(camera.position, state.gfx);
    world.update(camera.position, state.gfx, sky.night);
    if (!state.started) { // slow orbit behind the menu
      const t = now / 1000 * 0.05;
      camera.position.set(ski.x + Math.cos(t) * 60, 18, ski.z + Math.sin(t) * 60);
      camera.lookAt(ski.x, 4, ski.z);
    }
    renderer.render(scene, camera);
    return;
  }
  if (takePressed('escape') || takePressed('p')) { openMenu(); return; }
  update(dt, now / 1000, pollInput());
  if (state.mapOpen) hud.drawBigMap({ ski, police: police.units });
  renderer.render(scene, camera);
}

let simT = 0;
function update(dt, t, inp) {
  waveState.time = t;
  waveState.chop = sky.hour > 12 && sky.hour < 19 ? 1.15 : 0.6; // the Fremantle Doctor sea breeze in the arvo
  if (takePressed('c')) cam.mode = (cam.mode + 1) % 4;
  if (takePressed('m')) { state.mapOpen = !state.mapOpen; document.getElementById('bigmap').classList.toggle('hidden', !state.mapOpen); }
  if (takePressed('r')) { const p = randomWater(ski.x, ski.z, 400, -12, 200); if (p) { ski.place(p[0], p[1], ski.yaw); hud.msg('Back on the water'); } }
  if (takePressed('t')) { sky.hour = (sky.hour + 3) % 24; hud.msg(`Time skip: ${sky.timeString()}`); }
  if (takePressed('h')) sound.honk();
  sky.update(dt, camera.position);
  const night = sky.night > 0.5;
  boats.night = night;

  // ---- player
  ski.update(dt, inp, spray, water.wake, state.tail);
  const allBoats = boats.all();
  const hitBoat = boats.collide(ski, allBoats) || boats.collide(ski, police.units.map(u => u.boat));
  state.hitCool = (state.hitCool || 0) - dt;
  if (hitBoat && state.hitCool <= 0 && hitBoat.impact > 2) {
    state.hitCool = 1.5;
    if (hitBoat.impact > 9) ski.crash(hitBoat.boat.kind === 'ferry' ? 'Rammed the ferry!' : 'Boat collision!');
    else { cam.shake = 0.5; sound.thud(hitBoat.impact / 4); }
    if (police.units.some(u => u.boat === hitBoat.boat) && hitBoat.impact > 4) police.offence('police', 25);
  }
  state.freestyle = false;
  for (const e of ski.events) {
    if (e.type === 'land') {
      sound.splash(1 + e.impact * 0.1);
      cam.shake = Math.min(1.2, e.impact * 0.08);
      if (e.air > 0.55) {
        const spins = Math.floor(Math.abs(e.spin) / (Math.PI * 1.75));
        const label = spins >= 2 ? `${spins * 360}!` : spins === 1 ? '360!' : e.air > 1.4 ? 'MASSIVE AIR!' : 'AIR!';
        addScore(Math.round(e.air * 250 + spins * 600), label, `${e.air.toFixed(1)} s`);
        people.cheerNear(ski.x, ski.z, 140, (p) => hud.bubble(p.x, p.y, p.z, LINES.cheer[Math.floor(Math.random() * LINES.cheer.length)]));
        state.freestyle = true;
      }
    } else if (e.type === 'hop') state.freestyle = true;
    else if (e.type === 'crash') { hud.big('WIPEOUT!', e.reason, 2); sound.thud(3); sound.splash(2); cam.shake = 1.5; state.combo = 1; }
    else if (e.type === 'bump') { sound.thud(e.power / 5); cam.shake = Math.min(0.8, e.power * 0.06); }
  }
  // power slides
  const spdKn = ski.speed / KN;
  if (ski.drift > 0.5 && spdKn > 12) { state.driftT += dt; state.driftPts += dt * spdKn * 6; }
  else if (state.driftT > 0) {
    if (state.driftT > 1.2) addScore(Math.round(state.driftPts), 'POWER SLIDE!', `${state.driftT.toFixed(1)} s`);
    state.driftT = 0; state.driftPts = 0;
  }
  // donuts
  state.donutT -= dt;
  if (spdKn < 22 && Math.abs(ski.yawRate) > 1.4 && ski.throttle > 0.4) { state.donut += Math.abs(ski.yawRate) * dt; state.donutT = 0.6; }
  if (state.donutT <= 0) state.donut = 0;
  if (state.donut > Math.PI * 2) { state.donut = 0; addScore(300, 'DONUT!'); state.freestyle = true; }
  // under the bridges
  if (ski.underBridge && spdKn > 15) {
    const n = ski.underBridge.name || 'bridge';
    const tnow = t;
    if (!state.bridgeCool[n] || tnow - state.bridgeCool[n] > 25) { state.bridgeCool[n] = tnow; addScore(150, 'BRIDGE RUN!', n); }
  }
  // ocean and Rottnest milestones
  if (!state.oceanBadge && oceanAt(ski.x, ski.z) > 0.9) { state.oceanBadge = true; addScore(1000, 'OUT TO SEA!', 'through the Fremantle moles'); }
  if (!state.rottoBadge && ski.x < toXZ(115.565, 0)[0]) { state.rottoBadge = true; addScore(2500, 'ROTTO RUN!', 'Fremantle to Rottnest on a ski'); }
  // near misses
  state.nearMissCool -= dt;
  if (state.nearMissCool <= 0 && spdKn > 25) for (const b of allBoats) {
    const d = Math.hypot(b.x - ski.x, b.z - ski.z) - b.L * 0.4;
    if (d < 7 && d > 0) { state.nearMissCool = 3; addScore(120, 'CLOSE SHAVE!'); break; }
  }
  if (state.comboT > 0) { state.comboT -= dt; if (state.comboT <= 0) state.combo = 1; }

  // ---- zones and offences
  zoneNow = zoneAt(ski.x, ski.z, night, people.swimmerNear(ski.x, ski.z, 50));
  let speeding = null;
  if (zoneNow.limit && spdKn > zoneNow.limit + 2.5) { state.speedT += dt; }
  else state.speedT = 0;
  if (state.speedT > 1.2) speeding = zoneNow.kind === 'bridge' ? 'bridge' : zoneNow.kind === 'swimmer' ? 'swimmer' : zoneNow.kind === 'night' ? 'night' : 'speed';
  const freestyle = state.freestyle && zoneNow.kind !== 'pwc' && oceanAt(ski.x, ski.z) < 0.5;

  // ---- world
  const ctx = { night, speeding, freestyle, wake: water.wake, spray };
  police.update(dt, ski, ctx);
  for (const u of police.units) u.soaked = (u.soaked || 0) - dt;
  boats.update(dt, ski, water.wake, spray, state.gfx);
  people.update(dt, ski);
  traffic.update(dt, ski);
  const targets = [...people.targets(ski, soakPerson), ...traffic.targets(soakCar), ...police.targets(soakCop)];
  spray.hitTest(targets);
  spray.update(dt, sky.light, sky.sunColor.clone().lerp(new THREE.Color(1, 1, 1), 0.6));
  cam.update(dt, ski);
  water.update(dt, t, camera.position, ski);
  terrain.update(camera.position, state.gfx);
  world.update(camera.position, state.gfx, sky.night);
  sound.update(dt, ski, state.sirenDist ?? Infinity, ski.air);
  hud.update(dt, { ski, zone: zoneNow, place: placeName(ski.x, ski.z), stars: police.stars, seen: police.seenNow, score: state.score, combo: state.combo,
    fines: state.fines, clock: sky.timeString(), boats: allBoats, police: police.units });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('loadMsg').textContent = 'Could not load the river: ' + e.message;
});
// fixed-step simulation hook used by the automated tests
function sim(seconds, inp, fps = 30) {
  for (let i = 0; i < seconds * fps; i++) { simT += 1 / fps; update(1 / fps, 10000 + simT, Object.assign({ throttle: 0, brake: 0, steer: 0, slide: false, hop: false }, typeof inp === 'function' ? inp(i / fps) : inp)); }
}
window.__game = { sim, warm: () => { for (let i = 0; i < 40; i++) { terrain.update(camera.position, state.gfx); world.update(camera.position, state.gfx, sky.night); } }, toXZ, state, scene, renderer, camera, get water() { return water; }, get spray() { return spray; }, get cam() { return cam; }, get boats() { return boats; }, get traffic() { return traffic; }, get ski() { return ski; }, get police() { return police; }, get sky() { return sky; }, get people() { return people; }, input };

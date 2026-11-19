// Swan River: main loop.
import * as THREE from '../vendor/three.module.min.js';
import { loadWorld, W, sdfAt, heightAt, toXZ, oceanAt, navigable } from './world.js';
import { createTerrain, createIslands } from './terrain.js';
import { createWater, waveState, waveHeight, waveBound } from './water.js';
import { Spray as SkiSpray } from './skifx/particles.js';
import { SkiEffects } from './skifx/effects.js';
import { FoamField } from './skifx/foam.js';
import { makeNoiseTexture } from './skifx/textures.js';
import { Wakes } from './wakes.js';
import { createSky } from './sky.js';
import { createStatic, POLICE_BASE } from './static.js';
import { JetSki, ChaseCam, KN, CAM_NAMES } from './jetski.js';
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

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const state = { running: false, paused: true, started: false, score: 0, combo: 1, comboT: 0, fines: 0, skiIdx: 0, spawnIdx: 0, tail: 1.6, gfx: isTouch ? 1 : 2,
  driftT: 0, driftPts: 0, bridgeCool: {}, donut: 0, donutT: 0, oceanBadge: false, rottoBadge: false, speedT: 0, freestyle: false, nearMissCool: 0, mapOpen: false };
// rooster tail size, changeable on the water with [ and ] (or by clicking the TAIL chip under the speedo)
const TAILS = [[0.5, 'Small'], [1, 'Big'], [1.6, 'Massive'], [2.4, 'Ridiculous'], [3.4, 'Insane']];
function showTail() {
  const k = TAILS.reduce((b, t, i) => (Math.abs(t[0] - state.tail) < Math.abs(TAILS[b][0] - state.tail) ? i : b), 0);
  document.getElementById('tailName').textContent = TAILS[k][1];
  document.getElementById('optTail').value = String(TAILS[k][0]);
  return k;
}
function setTail(d) {
  const k = Math.max(0, Math.min(TAILS.length - 1, showTail() + d));
  state.tail = TAILS[k][0]; showTail();
  hud.msg(`Rooster tail: ${TAILS[k][1]}`);
  const c = document.getElementById('tailChip'); c.classList.add('pop'); setTimeout(() => c.classList.remove('pop'), 400);
}
document.getElementById('tailChip').onclick = () => setTail(state.tail >= TAILS[TAILS.length - 1][0] ? -(TAILS.length - 1) : 1);


const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 60000);
camera.layers.enable(1);
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, [1, 1.5, 2][state.gfx]) * (state.gfx === 0 ? 0.8 : 1);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
resize();
addEventListener('resize', resize);

let sky, terrain, water, world, spray, people, traffic, boats, police, ski, cam, hud;
// hull spray + white water (js/skifx, from jetskirider) and the boat wakes
let noiseTex, fxSpray, fxFoam, effects, wakes;
const fxLit = new THREE.Color(), fxShade = new THREE.Color();
const surfaceAt = (x, z) => Math.max(waveHeight(x, z) + wakes.heightAt(x, z), heightAt(x, z));
const sound = new Sound();

function waterSpot(lon, lat) {
  let [x, z] = toXZ(lon, lat);
  if (!navigable(x, z, -12)) { const p = randomWater(x, z, 300, -15, 200); if (p) [x, z] = p; }
  return [x, z];
}

function applyQuality() {
  const q = state.gfx;
  sky.sun.castShadow = q > 0;
  const size = q === 2 ? 4096 : 2048;
  if (sky.sun.shadow.mapSize.x !== size) { sky.sun.shadow.mapSize.set(size, size); if (sky.sun.shadow.map) { sky.sun.shadow.map.dispose(); sky.sun.shadow.map = null; } }
  const sc = sky.sun.shadow.camera;
  sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1000; sc.far = 2100; sc.updateProjectionMatrix();
  sky.sun.shadow.bias = -0.0004; sky.sun.shadow.normalBias = 0.05;
  water.setPlanar(q === 2);
}

async function boot() {
  const fill = document.getElementById('loadFill'), msgEl = document.getElementById('loadMsg');
  await loadWorld((f, label) => { fill.style.width = `${f * 70}%`; msgEl.textContent = `Loading ${label}...`; });
  const step = async (label, pct, fn) => { msgEl.textContent = label; fill.style.width = pct + '%'; await new Promise(r => setTimeout(r, 0)); return fn(); };
  sky = await step('Lighting up the sky...', 72, () => createSky(scene, renderer));
  terrain = await step('Shaping Kings Park and the river banks...', 76, () => createTerrain(scene));
  await step('Rottnest on the horizon...', 78, () => createIslands(scene));
  noiseTex = makeNoiseTexture(256);
  fxFoam = new FoamField(renderer);
  wakes = new Wakes();
  water = await step('Filling the Swan River...', 80, () => createWater(scene, sky, renderer, { foam: fxFoam, noise: noiseTex, wakes }));
  world = await step('Building the CBD, bridges and jetties...', 86, () => createStatic(scene));
  await step('Charting the channels...', 92, () => buildNav());
  spray = new Spray(scene);
  people = new People(scene);
  traffic = new Traffic(scene);
  boats = new Boats(scene);
  ski = new JetSki(scene, SKIS[0]);
  cam = new ChaseCam(camera);
  hud = new HUD(camera);
  hud.onMapClick = (x, z) => teleportTo(x, z, null, 'map');
  police = new Police(scene, {
    msg: (t, c) => hud.msg(t, c),
    bubble: (x, y, z, t, c) => hud.bubble(x, y, z, t, c),
    busted: (list) => onBusted(list),
    siren: (d) => { state.sirenDist = d; },
    escaped: () => addScore(1500, 'ESCAPED!'),
  });
  ski.extraBumps = (x, z) => wakes.heightAt(x, z);
  fxSpray = new SkiSpray({ max: 16000, noiseTex });
  scene.add(fxSpray.mesh);
  effects = new SkiEffects(fxSpray, fxFoam, ski.world);
  document.getElementById('optGfx').value = String(state.gfx);
  applyQuality();
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

// teleport anywhere on the river (blocked while the Water Police are after you)
function teleportTo(x, z, yaw, label) {
  if (police.stars > 0) { hud.msg('No teleporting while the Water Police are after you!', 'bad'); return false; }
  let p = [x, z];
  if (!navigable(x, z, -8)) { p = randomWater(x, z, 250, -10, 300) || randomWater(x, z, 600, -10, 600); if (!p) { hud.msg('Click closer to the river', 'bad'); return false; } }
  ski.place(p[0], p[1], yaw ?? ski.yaw);
  fxSpray.clear(); fxFoam.clear();
  cam.init = false;
  hud.msg(`Teleported to ${placeName(p[0], p[1])}`, 'good');
  state.mapOpen = false; document.getElementById('bigmap').classList.add('hidden');
  return true;
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
    d.innerHTML = `<b>${i + 1}. ${s.name}</b><small>${s.desc}</small>`;
    d.onclick = () => { state.spawnIdx = i; state.respawn = true; buildMenu(); };
    sp.appendChild(d);
  });
  document.getElementById('startBtn').textContent = state.started ? 'BACK ON THE WATER' : 'HIT THE WATER';
}
document.getElementById('startBtn').onclick = () => {
  state.tail = parseFloat(document.getElementById('optTail').value); showTail();
  const g = parseInt(document.getElementById('optGfx').value, 10);
  if (g !== state.gfx) { state.gfx = g; resize(); applyQuality(); aq.done = true; }
  sound.enabled = document.getElementById('optSound').checked;
  if (!state.started || state.timeChanged) { sky.hour = parseFloat(document.getElementById('optTime').value); state.timeChanged = false; sky.forceEnv(); }
  if (ski.spec !== SKIS[state.skiIdx]) ski.setSpec(SKIS[state.skiIdx]);
  if (!state.started) { spawnAt(state.spawnIdx); state.respawn = false; }
  else if (state.respawn) { state.respawn = false; const s = SPAWNS[state.spawnIdx]; const [x, z] = waterSpot(s.lon, s.lat); teleportTo(x, z, s.yaw); }
  sound.init();
  state.started = true; state.paused = false;
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  clearPressed();
  if (!state.welcomed) { state.welcomed = true; hud.big('SWAN RIVER', 'W to send it. SHIFT to slide. 1 to 8 or the map (M) to teleport.', 4); }
};
document.getElementById('optTime').onchange = () => { state.timeChanged = true; };
function openMenu() { state.paused = true; buildMenu(); document.getElementById('menu').classList.remove('hidden'); }

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
  if (p.kind !== 'swim' && p.kind !== 'fish' && p.role === 'normal') p.flee = 2.5 + Math.random() * 2;
  let kind = p.kind === 'roo' ? 'roo' : p.kid ? 'kid' : p.kind === 'fish' ? 'fisher' : p.kind === 'selfie' ? 'tourist' : 'soaked';
  // did a patrol see it? Otherwise only the wrong people ring it in
  const seen = police.witnessedSoak();
  if (!seen && (p.role === 'caller' || p.role === 'cop')) { kind = p.role; p.calling = 8; police.report(ski.x, ski.z, p.role); }
  const lines = LINES[kind];
  hud.bubble(p.x, p.y, p.z, lines[Math.floor(Math.random() * lines.length)]);
  sound.splash(0.8);
  const pts = p.kind === 'roo' ? 250 : p.kind === 'selfie' ? 200 : p.fall > 0 ? 180 : 100;
  addScore(pts, p.kind === 'roo' ? 'SOAKED A ROO!' : p.fall > 0 ? 'KNOCKED FLAT!' : 'SOAKED!');
}
function soakCar(c) {
  if (c.honk > 0) return;
  c.honk = 5; c.slow = 2.5; c.wet = 1;
  sound.honk();
  hud.bubble(c.x, c.y, c.z, LINES.driver[Math.floor(Math.random() * LINES.driver.length)]);
  addScore(220, 'SOAKED A CAR!', 'on the bridge');
}
function soakCop(u, n) {
  u.drench = (u.drench || 0) + n;
  if (u.soaked > 0 || u.drench < 25) return; // it takes a proper drenching, not a bit of mist
  u.soaked = 5;
  hud.bubble(u.boat.x, 3, u.boat.z, 'You did NOT just do that.', 'cop');
  addScore(400, 'SOAKED THE COPS!');
  police.sprayedCop();
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), zoneNow = null;
let fpsAcc = 0, fpsN = 0;
const tint = new THREE.Color();
function render() {
  renderer.shadowMap.needsUpdate = true;
  if (state.gfx === 2) water.renderReflection(renderer, scene, camera, [spray.points, ski.jet.mesh, fxSpray.mesh]);
  renderer.render(scene, camera);
}
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
    render();
    return;
  }
  if (takePressed('escape') || takePressed('p')) { openMenu(); return; }
  autoQuality(dt);
  update(dt, now / 1000, pollInput());
  if (state.mapOpen) hud.drawBigMap({ ski, police: police.units });
  render();
}

// if the computer can't keep up, step the graphics down once (shadows/reflections off) so it stays playable
const aq = { t: 0, frames: 0, done: false };
function autoQuality(dt) {
  if (aq.done || state.gfx === 0) return;
  aq.t += dt; aq.frames++;
  if (aq.t < 6) return;
  const fps = aq.frames / aq.t;
  aq.t = 0; aq.frames = 0;
  if (fps < 26) {
    state.gfx -= 1; resize(); applyQuality();
    document.getElementById('optGfx').value = String(state.gfx);
    hud.msg(`Graphics set to ${['Low', 'Medium', 'High'][state.gfx]} so it runs smoother (change it in the menu)`, 'good');
    if (state.gfx === 0) aq.done = true;
  } else aq.done = true;
}

// After the physics steps, in this order: hull spray -> droplets (landing ones stamp foam) -> foam field.
function updateWhiteWater(dt) {
  effects.density = state.gfx === 0 ? 0.55 : 1;
  effects.update(dt, ski.phys, waveState.time);
  // spray lit to match this scene's sun and sky (instead of jetskirider's time-of-day object)
  const k = 0.2 + 0.8 * sky.light;
  fxLit.setRGB(0.72 * k + 0.4 * sky.sunColor.r * sky.light, 0.74 * k + 0.4 * sky.sunColor.g * sky.light, 0.76 * k + 0.4 * sky.sunColor.b * sky.light);
  fxShade.setRGB(0.42 * k, 0.52 * k, 0.62 * k);
  fxSpray.uniforms.uLit.value.copy(fxLit);
  fxSpray.uniforms.uShade.value.copy(fxShade);
  fxSpray.update(dt, surfaceAt, waveBound() + wakes.maxAmp * 2 + 0.3, fxFoam);
  // jet wash: the pump's stream boils the surface white right behind the nozzle (the game's own rooster
  // tail droplets add more foam where they land, via spray.update above)
  const T = ski.tele, flow = Math.max(0, Math.min(1, (T.power || 0) * T.pumpLoad));
  if (flow > 0.02 && ski.wipeout <= 0 && T.reverse < 0.05 && T.nozzleDepth > -0.4) {
    const f = ski.fwd, wx = T.nozzle.x - f.x * 0.6, wz = T.nozzle.z - f.z * 0.6;
    const slow = Math.max(0.55, Math.min(1.6, 1.6 - ski.speed / 22)); // slow = water piles up, fast = stretched thin
    fxFoam.stamp(wx, wz, 0.45 + 0.3 * flow, (0.25 + flow * 1.3) * dt * 2.8 * slow, (0.3 + flow) * dt * 4);
    fxFoam.stamp(wx - f.x * 1.2, wz - f.z * 1.2, 0.55 + 0.35 * flow, flow * dt * 1.8 * slow, flow * dt * 5);
  }
  // boats near the ski churn white water behind them and peel it off their bows
  for (const b of [...boats.all(), ...police.units.map((u) => u.boat)]) {
    if (b.speed < 2 || Math.abs(b.x - ski.x) > 170 || Math.abs(b.z - ski.z) > 170) continue;
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw), rx = -fz, rz = fx, k2 = Math.min(1, b.speed / 12);
    fxFoam.stamp(b.x - fx * b.L * 0.5, b.z - fz * b.L * 0.5, b.B * 0.55 + 0.4, k2 * dt * 6, k2 * dt * 7);
    for (const sd of [-1, 1]) fxFoam.stamp(b.x + fx * b.L * 0.3 + rx * sd * b.B * 0.55, b.z + fz * b.L * 0.3 + rz * sd * b.B * 0.55, 0.6 + b.B * 0.12, k2 * dt * 3, k2 * dt * 2);
  }
  fxFoam.update(ski.phys.px, ski.phys.pz, dt);
}

let simT = 0;
function update(dt, t, inp) {
  waveState.time = t;
  waveState.chop = sky.hour > 12 && sky.hour < 19 ? 1.25 : 0.65; // the Fremantle Doctor sea breeze in the arvo
  if (takePressed('c')) { cam.mode = (cam.mode + 1) % CAM_NAMES.length; hud.msg(CAM_NAMES[cam.mode]); }
  cam.lookBack = !!inp.keys.v;
  if (takePressed(']') || takePressed('=')) setTail(1);
  if (takePressed('[') || takePressed('-')) setTail(-1);
  if (takePressed('m')) { state.mapOpen = !state.mapOpen; document.getElementById('bigmap').classList.toggle('hidden', !state.mapOpen); }
  if (takePressed('r')) { const p = randomWater(ski.x, ski.z, 400, -12, 200); if (p) { ski.place(p[0], p[1], ski.yaw); hud.msg('Back on the water'); } }
  if (takePressed('t')) { sky.hour = (sky.hour + 3) % 24; sky.forceEnv(); hud.msg(`Time skip: ${sky.timeString()}`); }
  if (takePressed('h')) sound.honk();
  for (let i = 0; i < SPAWNS.length; i++) if (takePressed(String(i + 1))) { const s = SPAWNS[i]; const [x, z] = waterSpot(s.lon, s.lat); teleportTo(x, z, s.yaw); }
  if (takePressed('0') && POLICE_BASE.dockX) teleportTo(POLICE_BASE.dockX + 40, POLICE_BASE.dockZ - 40, null);
  sky.update(dt, camera.position);
  // keep the sun's shadow box centred on the ski
  const sun = sky.sun;
  sun.target.position.set(ski.x, 0, ski.z);
  sun.position.copy(sun.target.position).addScaledVector(sun.position.clone().sub(camera.position).normalize(), 1500);
  const night = sky.night > 0.5;
  boats.night = night;

  // ---- player
  tint.copy(sky.sunColor).lerp(new THREE.Color(1, 1, 1), 0.6);
  wakes.update([...boats.all(), ...police.units.map((u) => u.boat)], ski, t);
  ski.update(dt, inp, spray, water.wake, state.tail, sky.light, sky.sunDir, tint);
  updateWhiteWater(dt);
  const allBoats = boats.all();
  const hitBoat = boats.collide(ski, allBoats) || boats.collide(ski, police.units.map(u => u.boat));
  state.hitCool = (state.hitCool || 0) - dt;
  if (hitBoat && state.hitCool <= 0 && hitBoat.impact > 2) {
    state.hitCool = 1.5;
    if (hitBoat.impact > 9) ski.crash(hitBoat.boat.kind === 'ferry' ? 'Rammed the ferry!' : 'Boat collision!');
    else { cam.shake = 0.5; sound.thud(hitBoat.impact / 4); }
    if (police.units.some(u => u.boat === hitBoat.boat) && hitBoat.impact > 4) police.rammed();
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
    else if (e.type === 'slap') { sound.thud(e.power / 8); cam.shake = Math.min(0.4, e.power * 0.04); }
  }
  const spdKn = ski.speed / KN;
  if (ski.drift > 0.5 && spdKn > 12) { state.driftT += dt; state.driftPts += dt * spdKn * 6; }
  else if (state.driftT > 0) { if (state.driftT > 1.2) addScore(Math.round(state.driftPts), 'POWER SLIDE!', `${state.driftT.toFixed(1)} s`); state.driftT = 0; state.driftPts = 0; }
  state.donutT -= dt;
  if (spdKn < 22 && Math.abs(ski.yawRate) > 1.4 && ski.throttle > 0.4) { state.donut += Math.abs(ski.yawRate) * dt; state.donutT = 0.6; }
  if (state.donutT <= 0) state.donut = 0;
  if (state.donut > Math.PI * 2) { state.donut = 0; addScore(300, 'DONUT!'); state.freestyle = true; }
  if (ski.underBridge && spdKn > 15) {
    const n = ski.underBridge.name || 'bridge';
    if (!state.bridgeCool[n] || t - state.bridgeCool[n] > 25) { state.bridgeCool[n] = t; addScore(150, 'BRIDGE RUN!', n); }
  }
  if (!state.oceanBadge && oceanAt(ski.x, ski.z) > 0.9) { state.oceanBadge = true; addScore(1000, 'OUT TO SEA!', 'through the Fremantle moles'); }
  if (!state.rottoBadge && ski.x < toXZ(115.565, 0)[0]) { state.rottoBadge = true; addScore(2500, 'ROTTO RUN!', 'Fremantle to Rottnest on a ski'); }
  state.nearMissCool -= dt;
  if (state.nearMissCool <= 0 && spdKn > 25) for (const b of allBoats) {
    const d = Math.hypot(b.x - ski.x, b.z - ski.z) - b.L * 0.4;
    if (d < 7 && d > 0) { state.nearMissCool = 3; addScore(120, 'CLOSE SHAVE!'); break; }
  }
  if (state.comboT > 0) { state.comboT -= dt; if (state.comboT <= 0) state.combo = 1; }

  // ---- zones and offences
  zoneNow = zoneAt(ski.x, ski.z, night, people.swimmerNear(ski.x, ski.z, 50));
  let speeding = null;
  if (zoneNow.limit && spdKn > zoneNow.limit + 2.5) state.speedT += dt; else state.speedT = 0;
  if (state.speedT > 1.2) speeding = zoneNow.kind === 'bridge' ? 'bridge' : zoneNow.kind === 'swimmer' ? 'swimmer' : zoneNow.kind === 'night' ? 'night' : 'speed';
  const freestyle = state.freestyle && zoneNow.kind !== 'pwc' && oceanAt(ski.x, ski.z) < 0.5;

  // ---- world
  const ctx = { night, speeding, freestyle, wake: water.wake, spray };
  police.update(dt, ski, ctx);
  boats.update(dt, ski, water.wake, spray, state.gfx);
  people.update(dt, ski);
  traffic.update(dt, ski);
  spray.hitTest([...people.targets(ski, soakPerson), ...traffic.targets(soakCar), ...police.targets(soakCop)]);
  spray.update(dt, sky.light, tint, fxFoam);
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
  for (let i = 0; i < seconds * fps; i++) { simT += 1 / fps; update(1 / fps, 10000 + simT, Object.assign({ throttle: 0, brake: 0, steer: 0, slide: false, hop: false, trim: 0 }, typeof inp === 'function' ? inp(i / fps) : inp)); }
}
window.__game = { sim, warm: () => { for (let i = 0; i < 40; i++) { terrain.update(camera.position, state.gfx); world.update(camera.position, state.gfx, sky.night); } }, toXZ, state, scene, renderer, camera,
  get water() { return water; }, get spray() { return spray; }, get cam() { return cam; }, get boats() { return boats; }, get traffic() { return traffic; },
  get ski() { return ski; }, get police() { return police; }, get sky() { return sky; }, get people() { return people; }, input, teleportTo, applyQuality,
  get fxSpray() { return fxSpray; }, get fxFoam() { return fxFoam; }, get effects() { return effects; }, get wakes() { return wakes; }, updateWhiteWater, waveState };

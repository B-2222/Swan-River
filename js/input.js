// Keyboard, gamepad and touch input.
export const input = { throttle: 0, brake: 0, steer: 0, slide: false, hop: false, back: false, trim: 0, keys: {}, pressed: new Set() };
let padHop = false;

const down = (k) => input.keys[k];
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (!input.keys[k]) { input.pressed.add(k); if (k === ' ') input.hop = true; }
  input.keys[k] = true;
  if (k === ' ') e.preventDefault();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { input.keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { input.keys = {}; });

const touch = { steer: 0, gas: false, brake: false, slide: false, back: false };
export function setupTouch() {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add('touch');
  const steerEl = document.getElementById('tSteer'), knob = document.getElementById('tKnob');
  let steerId = null;
  const setSteer = (cx) => {
    const r = steerEl.getBoundingClientRect();
    const v = Math.max(-1, Math.min(1, ((cx - r.left) / r.width - 0.5) * 2.2));
    touch.steer = v; knob.style.left = `${(v * 0.5 + 0.5) * (r.width - 60)}px`;
  };
  steerEl.addEventListener('touchstart', (e) => { steerId = e.changedTouches[0].identifier; setSteer(e.changedTouches[0].clientX); e.preventDefault(); }, { passive: false });
  steerEl.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === steerId) setSteer(t.clientX); e.preventDefault(); }, { passive: false });
  const endSteer = (e) => { for (const t of e.changedTouches) if (t.identifier === steerId) { steerId = null; touch.steer = 0; knob.style.left = '70px'; } };
  steerEl.addEventListener('touchend', endSteer); steerEl.addEventListener('touchcancel', endSteer);
  const btn = (id, on, off) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { on(); el.classList.add('on'); e.preventDefault(); }, { passive: false });
    const end = (e) => { off && off(); el.classList.remove('on'); e.preventDefault(); };
    el.addEventListener('touchend', end, { passive: false }); el.addEventListener('touchcancel', end, { passive: false });
  };
  btn('tGas', () => touch.gas = true, () => touch.gas = false);
  btn('tBrake', () => touch.brake = true, () => touch.brake = false);
  btn('tSlide', () => touch.slide = true, () => touch.slide = false);
  btn('tHop', () => { input.hop = true; touch.back = true; }, () => touch.back = false);
  const tail = document.getElementById('tTail');
  if (tail) tail.addEventListener('touchstart', (e) => { input.pressed.add(']'); e.preventDefault(); }, { passive: false });
  btn('tMenu', () => input.pressed.add('escape'));
}

export function pollInput() {
  let steer = 0, thr = 0, brk = 0, slide = false, back = !!down(' '), hopNow = false;
  if (down('a') || down('arrowleft')) steer += 1;
  if (down('d') || down('arrowright')) steer -= 1;
  if (down('w') || down('arrowup')) thr = 1;
  if (down('s') || down('arrowdown')) brk = 1;
  if (down('shift')) slide = true;
  let trim = 0; if (down('e')) trim += 1; if (down('q')) trim -= 1;
  let pads = [];
  try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { pads = []; }
  for (const p of pads) {
    if (!p) continue;
    if (Math.abs(p.axes[0]) > 0.15) steer -= p.axes[0];
    thr = Math.max(thr, p.buttons[7] ? p.buttons[7].value : 0, p.buttons[0] && p.buttons[0].pressed ? 1 : 0);
    brk = Math.max(brk, p.buttons[6] ? p.buttons[6].value : 0);
    if (p.buttons[2] && p.buttons[2].pressed) slide = true;
    if (p.buttons[3] && p.buttons[3].pressed) { back = true; hopNow = true; }
    if (p.buttons[4] && p.buttons[4].pressed) trim = -1;
    if (p.buttons[5] && p.buttons[5].pressed) trim = 1;
  }
  steer += touch.steer * -1;
  if (touch.gas) thr = 1; if (touch.brake) brk = 1; if (touch.slide) slide = true; if (touch.back) back = true;
  if (hopNow && !padHop) input.hop = true;
  padHop = hopNow;
  input.back = back;
  input.steer = Math.max(-1, Math.min(1, steer)); input.throttle = thr; input.brake = brk; input.slide = slide; input.trim = trim;
  return input;
}
export function takePressed(k) { if (input.pressed.has(k)) { input.pressed.delete(k); return true; } return false; }
export function clearPressed() { input.pressed.clear(); }

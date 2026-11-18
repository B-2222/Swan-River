// HUD: speedo, zone sign, wanted stars, score, feed, speech bubbles, minimap and full map.
import * as THREE from '../vendor/three.module.min.js';
import { W, toXZ } from './world.js';
import { ZONES } from './zones.js';
import { KN } from './jetski.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(camera) {
    this.cam = camera;
    this.el = { hud: $('hud'), place: $('place'), zone: $('zone'), zoneSign: $('zoneSign'), zoneLimit: $('zoneLimit'), zoneName: $('zoneName'), zoneRule: $('zoneRule'),
      stars: $('stars'), score: $('score'), combo: $('combo'), fines: $('fines'), clock: $('clock'), kn: $('spdKn'), kmh: $('spdKmh'), rpm: $('rpmFill'),
      ski: $('skiName'), feed: $('feed'), center: $('center'), bubbles: $('bubbles'), mm: $('minimap'), big: $('bigmap'), bigC: $('bigmapCanvas') };
    this.mmCtx = this.el.mm.getContext('2d');
    this.bubbleList = [];
    this.centerT = 0; this.tick = 0;
    this.v = new THREE.Vector3();
  }
  msg(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'msg ' + cls; d.textContent = text;
    this.el.feed.appendChild(d);
    while (this.el.feed.children.length > 5) this.el.feed.firstChild.remove();
    setTimeout(() => d.remove(), 3800);
  }
  big(text, sub = '', dur = 1.6) {
    this.el.center.innerHTML = ''; const t = document.createTextNode(text); this.el.center.appendChild(t);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; this.el.center.appendChild(s); }
    this.centerT = dur;
  }
  bubble(x, y, z, text, cls = '') {
    if (this.bubbleList.length > 5) { const o = this.bubbleList.shift(); o.el.remove(); }
    const el = document.createElement('div'); el.className = 'bubble ' + cls; el.textContent = text;
    this.el.bubbles.appendChild(el);
    this.bubbleList.push({ el, x, y, z, life: 2.8 });
  }
  update(dt, s) {
    // bubbles every frame
    const w = innerWidth, h = innerHeight;
    this.bubbleList = this.bubbleList.filter(b => {
      b.life -= dt;
      if (b.life <= 0) { b.el.remove(); return false; }
      this.v.set(b.x, b.y + 2.2 + (2.8 - b.life) * 0.4, b.z).project(this.cam);
      const vis = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      b.el.style.display = vis ? '' : 'none';
      b.el.style.left = `${(this.v.x * 0.5 + 0.5) * w}px`; b.el.style.top = `${(-this.v.y * 0.5 + 0.5) * h}px`;
      b.el.style.opacity = Math.min(1, b.life * 2);
      return true;
    });
    if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) this.el.center.innerHTML = ''; }
    this.drawMinimap(s);
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 0.1;
    const e = this.el;
    const kn = s.ski.speed / KN;
    e.kn.textContent = Math.round(kn);
    e.kmh.textContent = `${Math.round(s.ski.speed * 3.6)} km/h`;
    e.rpm.style.width = `${Math.min(100, (s.ski.throttle * 0.6 + s.ski.speed / s.ski.vmax * 0.5) * 100)}%`;
    e.ski.textContent = s.ski.spec.name;
    e.place.textContent = s.place;
    const z = s.zone;
    e.zoneName.textContent = z.name; e.zoneRule.textContent = z.rule;
    e.zoneLimit.textContent = z.limit ? z.limit : (z.kind === 'pwc' ? 'PWC' : 'OPEN');
    e.zoneLimit.style.fontSize = z.limit ? '18px' : '10px';
    e.zoneSign.className = z.limit ? '' : (z.kind === 'pwc' ? 'pwc' : 'open');
    e.zone.classList.toggle('warn', !!(z.limit && kn > z.limit + 2.5));
    let st = '';
    for (let i = 1; i <= 5; i++) st += `<span class="${i <= s.stars ? 'on' : ''}">&#9733;</span>`;
    e.stars.innerHTML = st;
    e.stars.classList.toggle('flash', s.stars > 0 && !s.seen);
    e.score.textContent = s.score.toLocaleString();
    e.combo.textContent = s.combo > 1 ? `x${s.combo} COMBO` : '';
    e.fines.textContent = s.fines ? `Fines: $${s.fines.toLocaleString()}` : '';
    e.clock.textContent = s.clock;
  }
  worldToMap(x, z) { return [(x - W.X0) / W.CELL, (z - W.Z0) / W.CELL]; } // minimap.jpg is 1 px per grid cell
  drawMinimap(s) {
    const c = this.mmCtx, S = 220, R = S / 2;
    const scale = 15 / 12.5; // map px -> canvas px (about 1.5 km radius)
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath(); c.arc(R, R, R, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#1e6aa3'; c.fillRect(0, 0, S, S);
    c.translate(R, R); c.rotate(s.ski.yaw);
    const [px, pz] = this.worldToMap(s.ski.x, s.ski.z);
    c.drawImage(W.minimapImg, -px * scale, -pz * scale, W.minimapImg.width * scale, W.minimapImg.height * scale);
    const dot = (x, z, col, r) => { const k = scale / W.CELL; c.fillStyle = col; c.beginPath(); c.arc((x - s.ski.x) * k, (z - s.ski.z) * k, r, 0, 6.283); c.fill(); };
    for (const b of s.boats) dot(b.x, b.z, '#ffffff', 2.5);
    const blink = Math.floor(performance.now() / 250) % 2;
    for (const u of s.police) dot(u.boat.x, u.boat.z, u.state === 'patrol' ? '#9db7ff' : (blink ? '#ff2b2b' : '#2b5cff'), 4.5);
    c.restore();
    // player arrow
    c.fillStyle = '#ffcc00'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(R, R - 9); c.lineTo(R + 6, R + 7); c.lineTo(R, R + 3); c.lineTo(R - 6, R + 7); c.closePath(); c.fill(); c.stroke();
    // north marker
    const na = s.ski.yaw;
    c.fillStyle = '#fff'; c.font = 'bold 13px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', R + Math.sin(na) * -(R - 12) * -1 * 1, R - Math.cos(na) * (R - 12));
  }
  drawBigMap(s) {
    const cv = this.el.bigC, img = W.minimapImg;
    const k = Math.min(innerWidth * 0.96 / img.width, innerHeight * 0.88 / img.height);
    cv.width = Math.floor(img.width * k); cv.height = Math.floor(img.height * k);
    const c = cv.getContext('2d');
    c.drawImage(img, 0, 0, cv.width, cv.height);
    const P = (x, z) => [(x - W.X0) / W.CELL * k, (z - W.Z0) / W.CELL * k];
    for (const zn of ZONES) {
      c.beginPath();
      zn.poly.forEach((p, i) => { const [a, b] = P(p[0], p[1]); i ? c.lineTo(a, b) : c.moveTo(a, b); });
      c.closePath(); c.globalAlpha = 0.28; c.fillStyle = zn.color; c.fill(); c.globalAlpha = 0.9; c.strokeStyle = zn.color; c.lineWidth = 1.5; c.stroke();
      c.globalAlpha = 1;
      const [lx, ly] = P(zn.poly[0][0], zn.poly[0][1]);
      c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.fillText(zn.limit ? `${zn.name} (${zn.limit} kn)` : zn.name, lx + 4, ly - 4);
    }
    const labels = [['Fremantle', 115.748, -32.054], ['Perth CBD', 115.858, -31.952], ['Kings Park', 115.832, -31.960], ['Melville Water', 115.82, -32.0],
      ['Canning River', 115.88, -32.03], ['Cottesloe', 115.755, -31.996], ['Optus Stadium', 115.889, -31.951], ['Point Walter', 115.787, -32.012], ['Matilda Bay', 115.825, -31.98]];
    c.font = 'bold 13px sans-serif'; c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = 3;
    for (const [n, lon, lat] of labels) { const [x, z] = toXZ(lon, lat); const [a, b] = P(x, z); c.strokeText(n, a, b); c.fillText(n, a, b); }
    for (const u of s.police) { const [a, b] = P(u.boat.x, u.boat.z); c.fillStyle = '#2b5cff'; c.beginPath(); c.arc(a, b, 5, 0, 6.283); c.fill(); }
    const [a, b] = P(s.ski.x, s.ski.z);
    c.save(); c.translate(a, b); c.rotate(-s.ski.yaw);
    c.fillStyle = '#ffcc00'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }
}

// Synthesised audio: supercharged engine, water rush, police wail siren, horns, splashes, and shouted lines.
export class Sound {
  constructor() { this.ctx = null; this.enabled = true; this.voices = true; this.lastSpeak = 0; this.voice = null; }
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.6; this.master.connect(c.destination);
    // engine
    this.eGain = c.createGain(); this.eGain.gain.value = 0;
    this.eFilter = c.createBiquadFilter(); this.eFilter.type = 'lowpass'; this.eFilter.frequency.value = 900; this.eFilter.Q.value = 3;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'square';
    this.o3 = c.createOscillator(); this.o3.type = 'sawtooth';
    const g2 = c.createGain(); g2.gain.value = 0.35; const g3 = c.createGain(); g3.gain.value = 0.25;
    this.o1.connect(this.eFilter); this.o2.connect(g2).connect(this.eFilter); this.o3.connect(g3).connect(this.eFilter);
    this.eFilter.connect(this.eGain).connect(this.master);
    [this.o1, this.o2, this.o3].forEach(o => o.start());
    // supercharger whine
    this.whine = c.createOscillator(); this.whine.type = 'sine'; this.wGain = c.createGain(); this.wGain.gain.value = 0;
    this.whine.connect(this.wGain).connect(this.master); this.whine.start();
    // water rush (noise)
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const n = c.createBufferSource(); n.buffer = buf; n.loop = true;
    this.nFilter = c.createBiquadFilter(); this.nFilter.type = 'bandpass'; this.nFilter.frequency.value = 800; this.nFilter.Q.value = 0.7;
    this.nGain = c.createGain(); this.nGain.gain.value = 0;
    n.connect(this.nFilter).connect(this.nGain).connect(this.master); n.start();
    // siren: classic wail
    this.sOsc = c.createOscillator(); this.sOsc.type = 'triangle'; this.sOsc.frequency.value = 900;
    this.sLfo = c.createOscillator(); this.sLfo.frequency.value = 0.35; const lg = c.createGain(); lg.gain.value = 420;
    this.sLfo.connect(lg).connect(this.sOsc.frequency);
    this.sGain = c.createGain(); this.sGain.gain.value = 0;
    this.sOsc.connect(this.sGain).connect(this.master); this.sOsc.start(); this.sLfo.start();
    if (window.speechSynthesis) {
      const pickVoice = () => { const vs = speechSynthesis.getVoices(); this.voice = vs.find(v => /en-AU/i.test(v.lang)) || vs.find(v => /en-GB/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null; };
      pickVoice(); speechSynthesis.onvoiceschanged = pickVoice;
    }
  }
  update(dt, ski, sirenDist, air) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = this.enabled ? 1 : 0;
    const spd = Math.min(1, ski.speed / ski.vmax);
    const rpm = Math.min(1, ski.throttle * 0.7 + spd * 0.5 + (air ? 0.25 * ski.throttle : 0));
    const f = 38 + rpm * 95;
    this.o1.frequency.setTargetAtTime(f, t, 0.05); this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05); this.o3.frequency.setTargetAtTime(f * 1.51, t, 0.05);
    this.eFilter.frequency.setTargetAtTime(400 + rpm * 2600, t, 0.05);
    this.eGain.gain.setTargetAtTime(on * (0.07 + rpm * 0.16) * (ski.wipeout > 0 ? 0.3 : 1), t, 0.08);
    this.whine.frequency.setTargetAtTime(900 + rpm * 2600, t, 0.08);
    this.wGain.gain.setTargetAtTime(on * rpm * rpm * 0.018, t, 0.1);
    this.nFilter.frequency.setTargetAtTime(500 + spd * 1500, t, 0.1);
    this.nGain.gain.setTargetAtTime(on * (air ? 0.02 : spd * 0.22 + 0.01), t, 0.08);
    const sv = sirenDist < 900 ? Math.max(0, 1 - sirenDist / 900) : 0;
    this.sGain.gain.setTargetAtTime(on * sv * sv * 0.12, t, 0.2);
  }
  burst(dur, freq, q, vol, type = 'bandpass') {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    s.connect(fl).connect(g).connect(this.master); s.start(); s.stop(c.currentTime + dur);
  }
  splash(p = 1) { this.burst(0.6 + p * 0.3, 600, 0.6, Math.min(0.6, 0.15 * p)); }
  thud(p = 1) { this.burst(0.25, 180, 1, Math.min(0.8, 0.2 * p), 'lowpass'); }
  honk() {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, g = c.createGain(); g.gain.setValueAtTime(0.06, c.currentTime); g.gain.setTargetAtTime(0, c.currentTime + 0.35, 0.05);
    for (const f of [392, 494]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(g); o.start(); o.stop(c.currentTime + 0.5); }
    g.connect(this.master);
  }
  ding() {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, g = c.createGain(); g.gain.setValueAtTime(0.08, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(880, c.currentTime); o.frequency.setValueAtTime(1320, c.currentTime + 0.08);
    o.connect(g).connect(this.master); o.start(); o.stop(c.currentTime + 0.4);
  }
  speak(text, kind = 'person') {
    if (!this.voices || !this.enabled || !window.speechSynthesis) return;
    const now = performance.now();
    if (now - this.lastSpeak < 1800 || speechSynthesis.speaking) return;
    this.lastSpeak = now;
    const u = new SpeechSynthesisUtterance(text.replace(/\*/g, ''));
    if (this.voice) u.voice = this.voice;
    u.rate = kind === 'cop' ? 1.05 : 1.15; u.pitch = kind === 'kid' ? 1.6 : kind === 'cop' ? 0.8 : 0.8 + Math.random() * 0.6; u.volume = 0.9;
    speechSynthesis.speak(u);
  }
}

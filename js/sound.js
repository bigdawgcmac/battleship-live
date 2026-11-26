/* Battleship Live: synthesized sound effects (Web Audio API, no audio files needed). */
window.Sound = (() => {
  'use strict';
  const MUTE_KEY = 'bslive:muted';
  const VOLUME = 0.8;
  let ctx = null, out = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* storage blocked */ }

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      // iPhone: treat game sound as media so it plays even when the ring/silent switch is on silent (iOS 17+).
      try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* unsupported */ }
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.25;
      out = ctx.createGain();
      out.gain.value = muted ? 0 : VOLUME;
      out.connect(comp); comp.connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    // 'suspended' before the first tap; 'interrupted' on iPhone after a call or switching apps.
    if (ctx.state !== 'running' && ctx.state !== 'closed' && ctx.resume) {
      try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* needs a tap */ }
    }
    return ctx;
  }
  const live = () => (muted ? null : ac());

  // Must run inside a tap/click/keypress: iPhone only starts audio from a user gesture.
  // Playing a one-sample silent buffer inside the gesture fully unlocks older iOS versions too.
  function unlock() {
    if (muted) return;
    const c = ac();
    if (!c || c.state === 'running') return;
    try {
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, 22050);
      s.connect(c.destination);
      s.start(0);
    } catch (e) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && !muted) ac(); });

  // ---- building blocks ----
  function env(t, pts, dest = out) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (const [dt, v] of pts) g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0001), t + dt);
    g.connect(dest);
    return g;
  }
  function osc(type, f0, f1, t, dur, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function noise(t, dur, dest) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    s.connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return s;
  }
  function filt(type, f, q, dest) {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    b.connect(dest);
    return b;
  }
  function shaper(amount, dest) {
    const ws = ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; curve[i] = (1 + amount) * x / (1 + amount * Math.abs(x)); }
    ws.curve = curve; ws.connect(dest);
    return ws;
  }
  function vibrato(param, t, dur, rate, depth) {
    const l = ctx.createOscillator(), g = ctx.createGain();
    l.frequency.value = rate; g.gain.value = depth;
    l.connect(g); g.connect(param); l.start(t); l.stop(t + dur);
  }
  function bubbles(t0, span, count, vol = 0.07) {
    for (let i = 0; i < count; i++) {
      const bt = t0 + Math.random() * span;
      const f = 300 + Math.random() * 550;
      osc('sine', f, f * 2.4, bt, 0.06, env(bt, [[0.005, vol], [0.07, 0.0001]]));
    }
  }
  function note(type, f, t, dur, vol, dest = out) {
    osc(type, f, f, t, dur, env(t, [[0.012, vol], [dur, 0.0001]], dest));
  }

  // ---- effects ----
  function launch() {
    if (!live()) return; const t = ctx.currentTime;
    osc('sine', 150, 45, t, 0.18, env(t, [[0.005, 0.7], [0.2, 0.0001]]));          // ignition thump
    const g = env(t, [[0.08, 0.55], [0.6, 0.4], [1.15, 0.0001]]);                    // whoosh
    const bp = filt('bandpass', 400, 1.4, g);
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.55);
    bp.frequency.exponentialRampToValueAtTime(900, t + 1.1);
    noise(t, 1.15, bp);
    const lp = filt('lowpass', 700, 0.7, env(t, [[0.05, 0.13], [0.95, 0.0001]]));     // rocket roar
    osc('sawtooth', 70, 160, t, 0.95, lp);
  }

  function whistle() {
    if (!live()) return; const t = ctx.currentTime;
    const o = osc('sine', 2100, 520, t, 1.1, env(t, [[0.12, 0.08], [0.85, 0.12], [1.1, 0.0001]]));
    vibrato(o.frequency, t, 1.15, 7, 22);
    const bp = filt('bandpass', 1800, 2, env(t, [[0.3, 0.05], [1.1, 0.0001]]));     // air hiss
    bp.frequency.setValueAtTime(2400, t); bp.frequency.exponentialRampToValueAtTime(700, t + 1.1);
    noise(t, 1.1, bp);
  }

  function splash() {
    if (!live()) return; const t = ctx.currentTime;
    osc('sine', 260, 70, t, 0.15, env(t, [[0.005, 0.45], [0.18, 0.0001]]));          // plunge
    const lp = filt('lowpass', 2600, 0.8, env(t, [[0.01, 0.9], [0.25, 0.35], [0.95, 0.0001]]));
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(380, t + 0.9);
    noise(t, 0.95, lp);                                                                // water body
    noise(t, 0.4, filt('highpass', 3500, 0.7, env(t, [[0.01, 0.25], [0.38, 0.0001]]))); // spray
    bubbles(t + 0.15, 0.75, 8);
  }

  function boomAt(t, scale = 1) {
    osc('sine', 120, 32, t, 0.8, env(t, [[0.005, 1.0 * scale], [0.9, 0.0001]]));      // sub thump
    const g = env(t, [[0.008, 1.0 * scale], [0.3, 0.45 * scale], [1.8, 0.0001]]);
    const lp = filt('lowpass', 2200, 0.6, shaper(6, g));
    lp.frequency.setValueAtTime(2200, t); lp.frequency.exponentialRampToValueAtTime(140, t + 1.6);
    noise(t, 1.85, lp);                                                                // blast
    for (let i = 0; i < 10; i++) {                                                     // crackle
      const ct = t + 0.08 + Math.random() * 0.9;
      noise(ct, 0.05, filt('highpass', 2500, 0.5, env(ct, [[0.002, (0.05 + Math.random() * 0.18) * scale], [0.04, 0.0001]])));
    }
  }
  function boom() { if (!live()) return; boomAt(ctx.currentTime); }

  function sunk() {
    if (!live()) return; const t = ctx.currentTime;
    boomAt(t, 1);
    boomAt(t + 0.38, 0.65);
    const bp = filt('bandpass', 380, 4, env(t + 0.3, [[0.25, 0.16], [1.6, 0.1], [2.6, 0.0001]]));
    const o = osc('sawtooth', 140, 42, t + 0.3, 2.6, bp);                              // hull groan
    vibrato(o.frequency, t + 0.3, 2.6, 3.5, 9);
    bubbles(t + 0.9, 2.2, 16, 0.06);
  }

  function ping() {
    if (!live()) return; const t = ctx.currentTime;
    [[0, 0.32], [0.32, 0.12], [0.64, 0.05]].forEach(([d, v]) =>
      osc('sine', 1180, 1170, t + d, 1.2, env(t + d, [[0.004, v], [1.2, 0.0001]])));
  }

  function place() {
    if (!live()) return; const t = ctx.currentTime;
    osc('square', 170, 80, t, 0.09, filt('lowpass', 900, 1, env(t, [[0.003, 0.22], [0.1, 0.0001]])));
    noise(t, 0.03, filt('bandpass', 2500, 1, env(t, [[0.002, 0.12], [0.03, 0.0001]])));
  }
  function tick() {
    if (!live()) return; const t = ctx.currentTime;
    osc('sine', 900, 700, t, 0.05, env(t, [[0.002, 0.12], [0.05, 0.0001]]));
  }
  function error() {
    if (!live()) return; const t = ctx.currentTime;
    const lp = filt('lowpass', 800, 1, out);
    note('square', 140, t, 0.09, 0.12, lp);
    note('square', 120, t + 0.12, 0.12, 0.12, lp);
  }
  function blip() {
    if (!live()) return; const t = ctx.currentTime;
    note('sine', 1400, t, 0.06, 0.1);
    note('sine', 1870, t + 0.07, 0.08, 0.08);
  }
  function join() {
    if (!live()) return; const t = ctx.currentTime;
    [660, 880, 1320].forEach((f, i) => note('triangle', f, t + i * 0.11, 0.35, 0.18));
  }
  function ready() {
    if (!live()) return; const t = ctx.currentTime;
    note('triangle', 523.25, t, 0.18, 0.2);
    note('triangle', 783.99, t + 0.14, 0.35, 0.2);
  }
  function start() {                                                                     // battle-stations klaxon
    if (!live()) return; const t = ctx.currentTime;
    const lp = filt('lowpass', 1500, 0.8, out);
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.42;
      osc('sawtooth', 330, 470, s, 0.34, env(s, [[0.02, 0.13], [0.3, 0.1], [0.36, 0.0001]], lp));
    }
  }
  function victory() {
    if (!live()) return; const t = ctx.currentTime;
    const seq = [523.25, 659.25, 783.99, 1046.5];
    seq.forEach((f, i) => { note('triangle', f, t + i * 0.13, 0.22, 0.2); note('square', f, t + i * 0.13, 0.12, 0.03); });
    const c = t + seq.length * 0.13 + 0.05;
    [523.25, 659.25, 783.99, 1046.5].forEach(f => { note('triangle', f, c, 1.4, 0.14); note('sawtooth', f / 2, c, 1.2, 0.02); });
  }
  function defeat() {
    if (!live()) return; const t = ctx.currentTime;
    const lp = filt('lowpass', 1100, 1, out);
    [392, 369.99, 349.23].forEach((f, i) => note('sawtooth', f, t + i * 0.42, 0.38, 0.13, lp));
    const s = t + 3 * 0.42;
    const o = osc('sawtooth', 329.63, 300, s, 1.3, env(s, [[0.02, 0.14], [1.3, 0.0001]], lp));
    vibrato(o.frequency, s, 1.3, 5, 6);
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
    if (out) out.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.02);
    if (!muted) unlock();
  }

  return {
    unlock,
    isMuted: () => muted,
    setMuted,
    launch, whistle, splash, boom, sunk, ping, place, tick, error, blip, join, ready, start, victory, defeat,
  };
})();

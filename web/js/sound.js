// Terra 3D — звуки. Всё синтезируется Web Audio на лету: никаких файлов, работает офлайн и в APK.
'use strict';

const Sound = (() => {
  const KEY = 'terra_sound';
  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (e) {}
  let ctx = null, master = null, noiseBuf = null;
  const lastAt = {};

  function ensure() {
    if (!enabled) return null;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp); comp.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }
  // Браузеры разрешают звук только после касания экрана
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, () => { if (enabled) ensure(); }, { passive: true, capture: true }));

  function throttle(name, ms) {
    const now = performance.now();
    if (lastAt[name] && now - lastAt[name] < ms) return false;
    lastAt[name] = now; return true;
  }

  function tone({ freq = 440, to = null, type = 'sine', dur = 0.12, vol = 0.25, delay = 0, attack = 0.005, filter = null }) {
    const c = ensure(); if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; osc.connect(f); node = f; }
    node.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  function noise({ dur = 0.3, vol = 0.3, delay = 0, from = 2000, to = 200, type = 'lowpass', q = 0.8 }) {
    const c = ensure(); if (!c) return;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  const notes = (base, steps) => steps.map(s => base * Math.pow(2, s / 12));

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (e) {}
      if (enabled) { ensure(); this.ui(); }
      return enabled;
    },
    // тап по планете
    tap(crit) {
      if (!throttle('tap', 45)) return;
      const f = 520 + Math.random() * 120;
      if (crit) { tone({ freq: f * 1.5, to: f * 3, type: 'triangle', dur: 0.18, vol: 0.22 }); tone({ freq: f * 2, type: 'sine', dur: 0.25, vol: 0.12, delay: 0.04 }); }
      else tone({ freq: f, to: f * 1.6, type: 'triangle', dur: 0.08, vol: 0.13 });
    },
    // мягкий щелчок интерфейса
    ui() { if (throttle('ui', 40)) tone({ freq: 880, to: 660, type: 'sine', dur: 0.05, vol: 0.08 }); },
    // покупка
    buy() {
      if (!throttle('buy', 60)) return;
      tone({ freq: 784, type: 'square', dur: 0.07, vol: 0.07, filter: 3000 });
      tone({ freq: 1175, type: 'square', dur: 0.12, vol: 0.07, delay: 0.06, filter: 3000 });
    },
    // монетка / награда
    coin() {
      notes(988, [0, 7, 12]).forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.14, vol: 0.12, delay: i * 0.06 }));
    },
    error() { if (throttle('err', 150)) tone({ freq: 180, to: 120, type: 'sawtooth', dur: 0.16, vol: 0.08, filter: 900 }); },
    // новая эпоха — фанфары
    evolve() {
      const chord = notes(392, [0, 4, 7, 12]);
      chord.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.5, vol: 0.14, delay: i * 0.11 }));
      notes(392, [12, 16, 19, 24]).forEach((f, i) => tone({ freq: f, type: 'sine', dur: 1.4, vol: 0.09, delay: 0.5 + i * 0.02, attack: 0.05 }));
      noise({ dur: 1.2, vol: 0.05, from: 6000, to: 800, type: 'bandpass', delay: 0.45 });
    },
    // тревога: летит астероид
    alarm() {
      for (let i = 0; i < 3; i++) tone({ freq: 660, to: 520, type: 'square', dur: 0.16, vol: 0.06, delay: i * 0.22, filter: 2200 });
    },
    hit(crit) {
      if (!throttle('hit', 50)) return;
      noise({ dur: 0.12, vol: crit ? 0.3 : 0.18, from: 2500, to: 300 });
      tone({ freq: crit ? 220 : 160, to: 70, type: 'sine', dur: 0.12, vol: 0.2 });
    },
    explode() {
      noise({ dur: 0.9, vol: 0.45, from: 3000, to: 60 });
      tone({ freq: 120, to: 35, type: 'sine', dur: 0.7, vol: 0.35 });
      setTimeout(() => this.coin(), 250);
    },
    // астероид упал на планету
    impact() {
      noise({ dur: 0.6, vol: 0.35, from: 900, to: 40 });
      tone({ freq: 90, to: 30, type: 'sine', dur: 0.6, vol: 0.35 });
    },
    rebirth() {
      noise({ dur: 1.6, vol: 0.12, from: 200, to: 6000, type: 'bandpass', q: 2 });
      notes(262, [0, 7, 12, 19, 24]).forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.9, vol: 0.1, delay: 0.3 + i * 0.12, attack: 0.03 }));
    },
    // перелёт между планетами
    travel() {
      noise({ dur: 1.4, vol: 0.18, from: 300, to: 3500, type: 'bandpass', q: 1.2 });
      tone({ freq: 110, to: 440, type: 'sawtooth', dur: 1.2, vol: 0.05, filter: 1200 });
    },
    unlock() {
      notes(523, [0, 4, 7, 11, 14]).forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.4, vol: 0.12, delay: i * 0.08 }));
    }
  };
})();

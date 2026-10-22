// Terra 3D — звуки и фоновая музыка. Всё синтезируется Web Audio на лету: никаких файлов, работает офлайн и в APK.
// Музыка — спокойный эмбиент: мягкие аккорды, бас и редкие «капли» с эхом; каждый раз звучит немного по-новому.
'use strict';

const Sound = (() => {
  const KEY = 'terra_sound';
  const store = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) {} };
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  let enabled = load(KEY, 'on') !== 'off';
  let musicOn = load('terra_music', 'on') !== 'off';
  let sfxVol = Math.min(1, Math.max(0, parseFloat(load('terra_sfx_vol', '0.8')) || 0));
  let musicVol = Math.min(1, Math.max(0, parseFloat(load('terra_music_vol', '0.5')) || 0));
  let ctx = null, master = null, musicBus = null, noiseBuf = null, unlocked = false, paused = false;
  const lastAt = {};

  function context() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.connect(ctx.destination);
        master = ctx.createGain();
        master.gain.value = 0.55 * sfxVol;
        master.connect(comp);
        musicBus = ctx.createGain();
        musicBus.gain.value = 0;
        musicBus.connect(comp);
      }
      if (ctx.state === 'suspended' && !paused) ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }
  function ensure() { return enabled && unlocked ? context() : null; }
  // Браузеры разрешают звук только после касания экрана — тогда же стартует музыка
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, () => { unlocked = true; if (enabled || musicOn) context(); if (musicOn) Music.start(); }, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else resume(); });
  function suspend() { paused = true; Music.fade(0); try { if (ctx && ctx.state === 'running') setTimeout(() => { if (paused) ctx.suspend(); }, 400); } catch (e) {} }
  function resume() { paused = false; if (!unlocked) return; try { if (ctx) ctx.resume(); } catch (e) {} if (musicOn) Music.start(); }

  // ---------- фоновая музыка ----------
  const Music = (() => {
    const C3 = 130.81;
    const hz = (semi) => C3 * Math.pow(2, semi / 12);
    // Cmaj7 → Am7 → Fmaj7 → Dm9 → Cmaj7/E → Fmaj7 → Am7 → G6 — спокойно и без резких смен
    const CHORDS = [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [2, 5, 9, 12, 16], [4, 7, 11, 12], [-7, -3, 0, 4], [-3, 0, 4, 7], [-5, -1, 2, 4]];
    const PENTA = [12, 14, 16, 19, 21, 24, 26, 28, 31];
    const CHORD_SEC = 9;
    let timer = null, nextChord = 0, nextPluck = 0, idx = 0, delayIn = null, running = false;
    function bus() {
      if (delayIn) return;
      const c = ctx;
      delayIn = c.createGain(); delayIn.gain.value = 1;
      const d = c.createDelay(2); d.delayTime.value = 0.42;
      const fb = c.createGain(); fb.gain.value = 0.38;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      delayIn.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
      lp.connect(musicBus);
    }
    function voice(freq, t0, dur, peak, type, cutoff, detune = 0) {
      const c = ctx, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = type; o.frequency.value = freq; o.detune.value = detune;
      f.type = 'lowpass'; f.frequency.value = cutoff;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 3);
      g.gain.setValueAtTime(peak, t0 + dur - 3.5);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 1);
      o.connect(f); f.connect(g); g.connect(musicBus);
      o.start(t0); o.stop(t0 + dur + 1.2);
    }
    function chord(t0) {
      const ch = CHORDS[idx % CHORDS.length]; idx++;
      const dur = CHORD_SEC + 3;
      ch.forEach((s, i) => {
        voice(hz(s), t0, dur, 0.032, 'sine', 1400, (i % 2 ? 6 : -6));
        voice(hz(s + 12), t0 + 0.3, dur, 0.012, 'triangle', 1800, (i % 2 ? -8 : 8));
      });
      voice(hz(ch[0] - 12), t0, dur, 0.05, 'sine', 400);
    }
    function pluck(t0) {
      const c = ctx, semi = PENTA[Math.floor(Math.random() * PENTA.length)];
      const o = c.createOscillator(), g = c.createGain();
      o.type = Math.random() < 0.5 ? 'triangle' : 'sine'; o.frequency.value = hz(semi);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
      o.connect(g); g.connect(musicBus); g.connect(delayIn);
      o.start(t0); o.stop(t0 + 2.8);
    }
    function tick() {
      if (!running || paused || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (now + 0.6 > nextChord) { chord(Math.max(now + 0.05, nextChord)); nextChord = Math.max(now, nextChord) + CHORD_SEC; }
      if (now + 0.4 > nextPluck) { pluck(Math.max(now + 0.05, nextPluck)); nextPluck = Math.max(now, nextPluck) + 1.3 + Math.random() * 2.6; }
    }
    return {
      start() {
        if (!musicOn || !unlocked || paused) return;
        const c = context(); if (!c) return;
        bus();
        if (!running) { running = true; nextChord = c.currentTime + 0.1; nextPluck = c.currentTime + 2; timer = setInterval(tick, 250); tick(); }
        this.fade(0.22 * musicVol);
      },
      stop() { running = false; clearInterval(timer); timer = null; this.fade(0); },
      fade(v) { if (ctx && musicBus) { const t = ctx.currentTime; musicBus.gain.cancelScheduledValues(t); musicBus.gain.setTargetAtTime(v, t, v > 0 ? 1.2 : 0.25); } },
      get running() { return running; }
    };
  })();

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
    get music() { return musicOn; },
    get sfxVolume() { return sfxVol; },
    get musicVolume() { return musicVol; },
    toggle() {
      enabled = !enabled;
      store(KEY, enabled ? 'on' : 'off');
      if (enabled) { ensure(); this.ui(); }
      return enabled;
    },
    setMusic(on) { musicOn = !!on; store('terra_music', on ? 'on' : 'off'); if (on) Music.start(); else Music.stop(); },
    setSfxVolume(v) { sfxVol = Math.min(1, Math.max(0, v)); store('terra_sfx_vol', sfxVol.toFixed(2)); if (master) master.gain.value = 0.55 * sfxVol; },
    setMusicVolume(v) { musicVol = Math.min(1, Math.max(0, v)); store('terra_music_vol', musicVol.toFixed(2)); if (musicOn && Music.running) Music.fade(0.22 * musicVol); },
    suspend, resume,
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

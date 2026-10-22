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
  // У каждого измерения свой вайб: Солнечная система — спокойный космос; CS2 — тёмный, собранный, с пульсом
  // баса и тихим хай-хэтом; Майнкрафт — неспешное «пианино» с паузами, светло и немного ностальгично.
  const PROFILES = {
    sol: { chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [2, 5, 9, 12, 16], [4, 7, 11, 12], [-7, -3, 0, 4], [-3, 0, 4, 7], [-5, -1, 2, 4]],
      scale: [12, 14, 16, 19, 21, 24, 26, 28, 31], sec: 9, pad: 'sine', padVol: 0.032, pluckGap: [1.3, 2.6], pluck: 'mix', root: 0 },
    cs:  { chords: [[-3, 0, 4, 7], [-7, -3, 0, 5], [-8, -4, -1, 3], [-5, -1, 2, 7], [-3, 0, 4, 7], [-10, -7, -3, 0], [-8, -4, -1, 3], [-5, -1, 2, 5]],
      scale: [9, 12, 14, 16, 19, 21, 24], sec: 6, pad: 'sawtooth', padVol: 0.012, padCut: 700, pluckGap: [0.9, 1.8], pluck: 'triangle', root: -3, beat: true },
    mc:  { chords: [[0, 4, 7, 11], [5, 9, 12, 16], [-3, 0, 4, 7], [5, 9, 12, 14], [0, 4, 7, 14], [-5, -1, 2, 7], [5, 9, 12, 16], [-1, 2, 7, 11]],
      scale: [12, 16, 19, 23, 24, 28, 31, 35], sec: 11, pad: 'sine', padVol: 0.022, pluckGap: [0.5, 1.6], pluck: 'piano', root: 0, phrase: true }
  };
  const Music = (() => {
    const C3 = 130.81;
    const hz = (semi) => C3 * Math.pow(2, semi / 12);
    let P = PROFILES.sol, CHORDS = P.chords, PENTA = P.scale, CHORD_SEC = P.sec;
    let timer = null, nextChord = 0, nextPluck = 0, nextBeat = 0, beatN = 0, idx = 0, delayIn = null, running = false;
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
        voice(hz(s), t0, dur, P.padVol, P.pad, P.padCut || 1400, (i % 2 ? 6 : -6));
        voice(hz(s + 12), t0 + 0.3, dur, P.padVol * 0.38, 'triangle', 1800, (i % 2 ? -8 : 8));
      });
      voice(hz(ch[0] - 12), t0, dur, 0.05, 'sine', 400);
    }
    // одна нота: обычная «капля» или мягкое «пианино» (несколько гармоник, быстрая атака, долгий спад)
    function note(t0, semi, vol, kind) {
      const c = ctx, f = hz(semi);
      const parts = kind === 'piano' ? [[1, 1, 'triangle'], [2, 0.35, 'sine'], [3, 0.12, 'sine']] : [[1, 1, kind === 'mix' ? (Math.random() < 0.5 ? 'triangle' : 'sine') : kind]];
      const len = kind === 'piano' ? 3.2 : 2.6;
      parts.forEach(([m, v, type]) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.value = f * m;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol * v, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + len / m);
        o.connect(g); g.connect(musicBus); g.connect(delayIn);
        o.start(t0); o.stop(t0 + len + 0.2);
      });
    }
    function pluck(t0) {
      const semi = PENTA[Math.floor(Math.random() * PENTA.length)];
      note(t0, semi, P.pluck === 'piano' ? 0.026 : 0.03, P.pluck);
      // в Майнкрафте ноты иногда идут короткой фразой — вверх или вниз по ладу
      if (P.phrase && Math.random() < 0.4) {
        let k = PENTA.indexOf(semi);
        const dir = Math.random() < 0.5 ? -1 : 1;
        for (let j = 1; j <= 2; j++) { k = Math.min(PENTA.length - 1, Math.max(0, k + dir)); note(t0 + j * 0.42, PENTA[k], 0.02, 'piano'); }
      }
    }
    // CS2: приглушённый пульс баса по восьмым и тихий хай-хэт — напряжение перед раундом
    function beat(t0) {
      const c = ctx, ch = CHORDS[(idx + CHORDS.length - 1) % CHORDS.length];
      const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = hz(ch[0] - 12); f.type = 'lowpass'; f.frequency.value = 260;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(beatN % 4 === 0 ? 0.05 : 0.028, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(f); f.connect(g); g.connect(musicBus); o.start(t0); o.stop(t0 + 0.25);
      if (beatN % 2 === 1 && noiseBuf) {
        const src = c.createBufferSource(), hf = c.createBiquadFilter(), hg = c.createGain();
        src.buffer = noiseBuf; hf.type = 'highpass'; hf.frequency.value = 7000;
        hg.gain.setValueAtTime(0.0001, t0); hg.gain.exponentialRampToValueAtTime(0.012, t0 + 0.005); hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
        src.connect(hf); hf.connect(hg); hg.connect(musicBus); src.start(t0); src.stop(t0 + 0.06);
      }
      beatN++;
    }
    function tick() {
      if (!running || paused || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (now + 0.6 > nextChord) { chord(Math.max(now + 0.05, nextChord)); nextChord = Math.max(now, nextChord) + CHORD_SEC; }
      if (now + 0.4 > nextPluck) { pluck(Math.max(now + 0.05, nextPluck)); nextPluck = Math.max(now, nextPluck) + P.pluckGap[0] + Math.random() * P.pluckGap[1]; }
      if (P.beat) while (nextBeat < now + 0.5) { if (nextBeat > now - 0.05) beat(nextBeat); nextBeat = Math.max(nextBeat, now - 0.05) + 0.34; }
    }
    return {
      // смена измерения: со следующего аккорда играет другая музыка
      profile(u) {
        const np = PROFILES[u] || PROFILES.sol;
        if (np === P) return;
        P = np; CHORDS = P.chords; PENTA = P.scale; CHORD_SEC = P.sec; idx = 0;
        if (ctx) { nextChord = Math.min(nextChord, ctx.currentTime + 1.2); nextBeat = ctx.currentTime + 1.5; }
        if (P.beat) getNoise();
      },
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

  function getNoise() {
    if (!ctx || noiseBuf) return noiseBuf;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function noise({ dur = 0.3, vol = 0.3, delay = 0, from = 2000, to = 200, type = 'lowpass', q = 0.8 }) {
    const c = ensure(); if (!c) return;
    getNoise();
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
    // тап по планете; style — звук тапа из магазина, n — номер тапа в серии (для мелодичных звуков)
    tap(crit, style = 'default', n = 0) {
      if (!throttle('tap', 45)) return;
      const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
      const step = (base) => base * Math.pow(2, PENT[(n || 0) % PENT.length] / 12);
      switch (style) {
        case 'keyboard':   // щелчок механической клавиши
          noise({ dur: 0.035, vol: crit ? 0.32 : 0.22, from: 5200, to: 2600, type: 'bandpass', q: 1.5 });
          tone({ freq: 2200, type: 'square', dur: 0.018, vol: 0.04, filter: 4000 });
          if (crit) noise({ dur: 0.03, vol: 0.2, from: 4800, to: 2400, type: 'bandpass', q: 1.5, delay: 0.06 });
          return;
        case 'mouse':
          noise({ dur: 0.016, vol: 0.28, from: 6000, to: 3000, type: 'highpass', q: 0.7 });
          tone({ freq: 1400, type: 'square', dur: 0.012, vol: 0.05, filter: 3000 });
          if (crit) noise({ dur: 0.016, vol: 0.25, from: 6000, to: 3000, type: 'highpass', q: 0.7, delay: 0.07 });
          return;
        case 'bubble':
          tone({ freq: 280 + Math.random() * 80, to: 900 + Math.random() * 300, type: 'sine', dur: 0.09, vol: 0.2 });
          if (crit) tone({ freq: 500, to: 1600, type: 'sine', dur: 0.1, vol: 0.16, delay: 0.07 });
          return;
        case 'drum':
          tone({ freq: crit ? 190 : 150, to: 45, type: 'sine', dur: 0.18, vol: 0.38 });
          noise({ dur: 0.05, vol: 0.12, from: 1200, to: 200 });
          if (crit) noise({ dur: 0.12, vol: 0.2, from: 6000, to: 2000, type: 'highpass', delay: 0.02 });
          return;
        case 'piano': {
          const f = step(262);
          tone({ freq: f, type: 'triangle', dur: 0.5, vol: 0.16, attack: 0.004 });
          tone({ freq: f * 2, type: 'sine', dur: 0.3, vol: 0.05, attack: 0.004 });
          if (crit) tone({ freq: f * 1.5, type: 'triangle', dur: 0.5, vol: 0.12, delay: 0.05 });
          return;
        }
        case 'laser':
          tone({ freq: crit ? 2400 : 1700, to: 180, type: 'sawtooth', dur: crit ? 0.2 : 0.12, vol: 0.09, filter: 3500 });
          return;
        case 'coin':
          tone({ freq: 988, type: 'square', dur: 0.05, vol: 0.07, filter: 5000 });
          tone({ freq: 1319, type: 'square', dur: crit ? 0.3 : 0.16, vol: 0.07, delay: 0.05, filter: 5000 });
          return;
        case 'chip': {
          const f = step(523);
          tone({ freq: f, type: 'square', dur: 0.06, vol: 0.06, filter: 6000 });
          if (crit) { tone({ freq: f * 1.25, type: 'square', dur: 0.06, vol: 0.06, delay: 0.06, filter: 6000 }); tone({ freq: f * 1.5, type: 'square', dur: 0.08, vol: 0.06, delay: 0.12, filter: 6000 }); }
          return;
        }
        case 'wood': {
          const f = step(523);
          tone({ freq: f, type: 'sine', dur: 0.22, vol: 0.2, attack: 0.002 });
          tone({ freq: f * 4, type: 'sine', dur: 0.05, vol: 0.05, attack: 0.002 });
          if (crit) tone({ freq: f * 2, type: 'sine', dur: 0.25, vol: 0.14, delay: 0.06 });
          return;
        }
        case 'glass': {
          const f = 1800 + Math.random() * 900;
          tone({ freq: f, type: 'sine', dur: 0.7, vol: 0.08, attack: 0.003 });
          tone({ freq: f * 1.003, type: 'sine', dur: 0.7, vol: 0.05, attack: 0.003 });
          if (crit) tone({ freq: f * 1.5, type: 'sine', dur: 0.8, vol: 0.06, delay: 0.05 });
          return;
        }
        case 'block':   // кирка по камню
          noise({ dur: 0.07, vol: crit ? 0.4 : 0.28, from: 1600, to: 500, type: 'bandpass', q: 2 });
          tone({ freq: 210 + Math.random() * 40, type: 'square', dur: 0.05, vol: 0.06, filter: 900 });
          return;
        default: {
          const f = 520 + Math.random() * 120;
          if (crit) { tone({ freq: f * 1.5, to: f * 3, type: 'triangle', dur: 0.18, vol: 0.22 }); tone({ freq: f * 2, type: 'sine', dur: 0.25, vol: 0.12, delay: 0.04 }); }
          else tone({ freq: f, to: f * 1.6, type: 'triangle', dur: 0.08, vol: 0.13 });
        }
      }
    },
    // измерение сменилось — другая музыка
    setUniverse(u) { Music.profile(u); },
    // чёрная дыра: гул нарастает, затягивает — и вспышка
    blackhole() {
      noise({ dur: 2.2, vol: 0.22, from: 120, to: 900, type: 'lowpass', q: 4 });
      tone({ freq: 220, to: 40, type: 'sawtooth', dur: 2.1, vol: 0.06, filter: 600, attack: 0.4 });
      tone({ freq: 55, to: 30, type: 'sine', dur: 2.2, vol: 0.3, attack: 0.3 });
      noise({ dur: 1.2, vol: 0.3, from: 400, to: 8000, type: 'bandpass', q: 1, delay: 2.0 });
      notes(392, [0, 7, 12, 19, 24]).forEach((f, i) => tone({ freq: f, type: 'sine', dur: 1.2, vol: 0.09, delay: 2.2 + i * 0.09, attack: 0.02 }));
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

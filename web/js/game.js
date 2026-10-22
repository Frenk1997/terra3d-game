// Terra 3D — движок игры: экономика нескольких планет, графика, интерфейс, аккаунт и синхронизация.
'use strict';

// ============================================================
//  НАСТРОЙКИ (config.js)
// ============================================================
const RAW_CONFIG = window.TERRA_CONFIG || {};
const IS_APP = typeof window.TerraNative === 'object' && window.TerraNative !== null; // запущено внутри APK
// номер сборки APK (v1.0.N) — приложение дописывает его в User-Agent; на сайте 0
const MY_BUILD = IS_APP ? (parseInt((navigator.userAgent.match(/\bTerraBuild\/(\d+)/) || [])[1], 10) || 0) : 0;
const CONFIG = { API_URL: '', APK_URL: String(RAW_CONFIG.APK_URL || '').trim() };
let CONFIGURED = false;

async function resolveApi() {
  let u = String(RAW_CONFIG.API_URL || '').trim().replace(/\/+$/, '');
  if (/YOUR/i.test(u)) u = '';
  if (!u && !IS_APP && /^https?:$/.test(location.protocol)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      const d = await r.json();
      if (d && d.terra) u = location.origin;
    } catch (e) {}
  }
  CONFIG.API_URL = u;
  CONFIGURED = !!u;
}

const $ = (id) => document.getElementById(id);
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ============================================================
//  КОНСТАНТЫ
// ============================================================
const OFFLINE_MAX_SEC = 8 * 3600;
const OFFLINE_EFFICIENCY = 0.5;
const BOSS_FIRST_MIN = 90, BOSS_FIRST_MAX = 150;
const BOSS_MIN = 150, BOSS_MAX = 300;
const BOSS_FLIGHT = 15;
const GOLDEN_CHANCE = 0.12;

// ============================================================
//  СОСТОЯНИЕ
// ============================================================
function defaultPlanet(pid) {
  const P = PLANETS[pid];
  const res = {}, counts = {};
  P.res.forEach(r => res[r] = P.start[r] || 0);
  P.buildings.forEach(b => counts[b.id] = 0);
  return { res, counts, era: 0 };
}
// Статистика за всё время (не сбрасывается перерождением) — для квестов
const STAT_KEYS = ['taps', 'built', 'asteroids', 'golden', 'evolves', 'perks', 'travels', 'playSec', 'chests'];
function defaultStats() {
  const st = { maxEra: {} };
  STAT_KEYS.forEach(k => st[k] = 0);
  PLANET_ORDER.forEach(pid => st.maxEra[pid] = 0);
  return st;
}
function defaultQuests() { return { day: '', list: [], base: {}, claimed: [], bonus: false, ach: [] }; }
function defaultState() {
  const planets = {}, ppk = {}, look = {};
  PLANET_ORDER.forEach(pid => { planets[pid] = defaultPlanet(pid); ppk[pid] = {}; look[pid] = { hat: null, bg: null }; });
  const perks = {};
  GLOBAL_PERKS.forEach(p => perks[p.id] = 0);
  const ppr = {};
  PLANET_ORDER.forEach(pid => ppr[pid] = 0);
  return {
    v: GAME_VERSION, planet: 'earth', unlocked: ['earth'], planets, gems: 0, sapphires: 0,
    perks, ppk, ppr, rebirths: 0, boostUntil: 0, ownedCosmetics: [], look, stats: defaultStats(), quests: defaultQuests(), lastSave: Date.now()
  };
}
let state = defaultState();
const ui = { tab: 'a', shopTab: 'hat', mapSel: null, lbBoard: 'all', lbPeriod: 'all', buyMode: 1 };
try { const bm = localStorage.getItem('terra_buy_mode'); if (bm) ui.buyMode = bm === 'max' ? 'max' : (BUY_MODES.includes(+bm) ? +bm : 1); } catch (e) {}

const num = (x) => (typeof x === 'number' && isFinite(x) && x >= 0) ? x : 0;
const int = (x) => Math.max(0, Math.floor(num(x)));

// Сохранение старой версии (6 эпох, одна планета) → новый формат
function migrateV2(p) {
  const s = defaultState();
  const ERA_MAP = [0, 1, 2, 4, 7, 9];
  const old = p.res || {};
  const e = s.planets.earth;
  PLANETS.earth.res.forEach(r => { if (old[r] !== undefined) e.res[r] = num(old[r]); });
  Object.keys(p.counts || {}).forEach(id => { if (id in e.counts) e.counts[id] = int(p.counts[id]); });
  e.era = ERA_MAP[Math.min(5, int(p.era))];
  s.gems = num(old.gems);
  s.perks = { ...s.perks, ...(p.perks || {}) };
  s.ppr.earth = int(p.rebirths);
  s.ownedCosmetics = Array.isArray(p.ownedCosmetics) ? p.ownedCosmetics : [];
  s.look.earth = { hat: p.equippedHat || null, bg: (p.equippedBg && p.equippedBg !== 'bg-default') ? p.equippedBg : null };
  s.lastSave = Number(p.lastSave) || Date.now();
  return s;
}

function applySave(p) {
  let s = defaultState();
  if (p && typeof p === 'object') {
    if (!p.v || p.v < 3) s = migrateV2(p);
    else {
      const d = s;
      PLANET_ORDER.forEach(pid => {
        const src = (p.planets && p.planets[pid]) || {};
        const P = PLANETS[pid], dst = d.planets[pid];
        P.res.forEach(r => { if (src.res && src.res[r] !== undefined) dst.res[r] = num(src.res[r]); });
        P.buildings.forEach(b => { if (src.counts && src.counts[b.id] !== undefined) dst.counts[b.id] = int(src.counts[b.id]); });
        dst.era = Math.min(P.eras.length - 1, int(src.era));
        if (p.ppk && p.ppk[pid]) P.perks.forEach(k => { d.ppk[pid][k.id] = Math.min(k.max, int(p.ppk[pid][k.id])); });
        if (p.look && p.look[pid]) d.look[pid] = { hat: p.look[pid].hat || null, bg: p.look[pid].bg || null };
      });
      d.gems = num(p.gems);
      GLOBAL_PERKS.forEach(k => { d.perks[k.id] = Math.min(k.max, int((p.perks || {})[k.id])); });
      // престиж у каждой планеты (v5); раньше было общее перерождение — оно становится престижем Земли
      if (p.v >= 5 && p.ppr && typeof p.ppr === 'object') PLANET_ORDER.forEach(pid => d.ppr[pid] = Math.min(100000, int(p.ppr[pid])));
      else d.ppr.earth = int(p.rebirths);
      d.boostUntil = Math.min(Date.now() + 6 * 3600000, num(p.boostUntil));
      d.unlocked = Array.isArray(p.unlocked) ? PLANET_ORDER.filter(x => x === 'earth' || p.unlocked.includes(x)) : ['earth'];
      d.planet = d.unlocked.includes(p.planet) ? p.planet : 'earth';
      d.ownedCosmetics = Array.isArray(p.ownedCosmetics) ? p.ownedCosmetics : [];
      d.lastSave = Number(p.lastSave) || Date.now();
      d.sapphires = int(p.sapphires);
      if (p.stats && typeof p.stats === 'object') {
        STAT_KEYS.forEach(k => d.stats[k] = num(p.stats[k]));
        PLANET_ORDER.forEach(pid => d.stats.maxEra[pid] = int((p.stats.maxEra || {})[pid]));
      }
      const q = p.quests;
      if (q && typeof q === 'object') {
        const strs = (a) => Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, 64) : [];
        d.quests = { day: typeof q.day === 'string' ? q.day : '', list: strs(q.list), claimed: strs(q.claimed), bonus: !!q.bonus, ach: strs(q.ach), base: {} };
        if (q.base && typeof q.base === 'object') STAT_KEYS.forEach(k => { if (q.base[k] !== undefined) d.quests.base[k] = num(q.base[k]); });
      }
    }
  }
  s.rebirths = totalPrestige(s);
  // лучшие эпохи — не ниже текущих (для старых сохранений)
  PLANET_ORDER.forEach(pid => { if (s.unlocked.includes(pid)) s.stats.maxEra[pid] = Math.max(s.stats.maxEra[pid] || 0, s.planets[pid].era); });
  s.ownedCosmetics = s.ownedCosmetics.filter(id => COSMETICS.some(c => c.id === id));
  PLANET_ORDER.forEach(pid => {
    const l = s.look[pid];
    if (l.hat && !s.ownedCosmetics.includes(l.hat)) l.hat = null;
    if (l.bg && !s.ownedCosmetics.includes(l.bg)) l.bg = null;
  });
  state = s;
}

// ============================================================
//  ЭКОНОМИКА
// ============================================================
const PL = (pid) => PLANETS[pid];
const ps = (pid) => state.planets[pid];
const cur = () => state.planet;
const isUnlocked = (pid) => state.unlocked.includes(pid);
const perk = (id) => (state.perks && state.perks[id]) || 0;
const ppk = (pid, id) => (state.ppk[pid] && state.ppk[pid][id]) || 0;
const perkCost = (p, lvl) => Math.ceil(p.base * Math.pow(p.scale, lvl));

function planetPerkBonus(pid, type) {
  let b = 0;
  PL(pid).perks.forEach(p => { if (p.type === type) b += p.step * ppk(pid, p.id); });
  return b;
}
function totalPrestige(st = state) { return PLANET_ORDER.reduce((a, pid) => a + ((st.ppr && st.ppr[pid]) || 0), 0); }
function prestigeCount(pid) { return (state.ppr && state.ppr[pid]) || 0; }
// множитель планеты: каждый её престиж +100% к доходу и тапу на ней
function planetMult(pid = cur()) { return 1 + prestigeCount(pid); }
function boostLeft() { return Math.max(0, (state.boostUntil || 0) - Date.now()); }
function boostMult() { return boostLeft() > 0 ? 2 : 1; }
function speedMult() { return 1 + perk('time_warp') * 0.25; }
function prodMult(pid) { return planetMult(pid) * speedMult() * boostMult() * (1 + planetPerkBonus(pid, 'prod')); }
function clickGain(pid = cur()) { return Math.ceil(PL(pid).eras[ps(pid).era].click * planetMult(pid) * boostMult() * (1 + planetPerkBonus(pid, 'click'))); }
function costMult(pid) { return Math.max(0.3, (1 - perk('cheap_build') * 0.10) * (1 - planetPerkBonus(pid, 'cheap'))); }
function rollCrit() { const l = perk('crit_solar'); return (l > 0 && Math.random() < 0.15) ? (2 + l) : 1; }

// Цена — объект { 'планета:ресурс': n, gems: n }
function spec(pid, cost, mult = 1) {
  const s = {};
  for (const k in cost) s[`${pid}:${k}`] = Math.max(1, Math.ceil(cost[k] * mult));
  return s;
}
function getRes(key) {
  if (key === 'gems') return state.gems;
  if (key === 'sapphire') return state.sapphires;
  const [pid, r] = key.split(':');
  return state.planets[pid].res[r] || 0;
}
function addRes(key, v) {
  if (key === 'gems') { state.gems = Math.max(0, state.gems + v); return; }
  if (key === 'sapphire') { state.sapphires = Math.max(0, state.sapphires + v); return; }
  const [pid, r] = key.split(':');
  state.planets[pid].res[r] = Math.max(0, (state.planets[pid].res[r] || 0) + v);
}
function canPay(s) { if (!s) return false; for (const k in s) if (getRes(k) < s[k]) return false; return true; }
function pay(s) { for (const k in s) addRes(k, -s[k]); }
function resIcon(key) { return RES[(key === 'gems' || key === 'sapphire') ? key : key.split(':')[1]].icon; }

// Цена n построек подряд: сумма геометрической прогрессии (каждая следующая дороже на 18%)
function bulkCost(pid, b, n = 1) {
  const g = BUILD_GROWTH, c = ps(pid).counts[b.id] || 0;
  return spec(pid, b.cost, Math.pow(g, c) * (Math.pow(g, n) - 1) / (g - 1) * costMult(pid));
}
function buildingCost(pid, b) { return bulkCost(pid, b, 1); }
// Сколько построек можно купить на имеющиеся ресурсы (не больше cap)
function maxAffordable(pid, b, cap = 1000) {
  const g = BUILD_GROWTH, c = ps(pid).counts[b.id] || 0, m = costMult(pid);
  let n = cap;
  for (const k in b.cost) {
    const unit = b.cost[k] * m * Math.pow(g, c);
    const have = getRes(`${pid}:${k}`);
    n = Math.min(n, Math.floor(Math.log(have * (g - 1) / unit + 1) / Math.log(g) + 1e-9));
  }
  n = Math.max(0, isFinite(n) ? n : 0);
  while (n > 0 && !canPay(bulkCost(pid, b, n))) n--;   // защита от округления
  return n;
}
// Сколько купит кнопка при текущем режиме (×1/×10/×50/×100/MAX)
function buyCount(pid, b) { return ui.buyMode === 'max' ? Math.max(1, maxAffordable(pid, b)) : ui.buyMode; }
function eraCost(pid) {
  const next = PL(pid).eras[ps(pid).era + 1];
  return next ? spec(pid, next.cost, costMult(pid)) : null;
}
function rates(pid) {
  const r = {};
  PL(pid).res.forEach(k => r[k] = 0);
  if (!isUnlocked(pid)) return r;
  const m = prodMult(pid), counts = ps(pid).counts;
  PL(pid).buildings.forEach(b => {
    const c = counts[b.id] || 0;
    if (c > 0) for (const k in b.prod) r[k] += b.prod[k] * c * m;
  });
  return r;
}

// Требования к экспедиции на планету
function unlockInfo(pid) {
  const U = PL(pid).unlock;
  if (!U) return { reqs: [], cost: null, ready: true };
  const reqs = [];
  reqs.push({ label: `🌍 Земля: эпоха ${U.earthEra + 1} «${PLANETS.earth.eras[U.earthEra].name}»`, ok: ps('earth').era >= U.earthEra });
  for (const p in (U.stages || {})) {
    reqs.push({ label: `${PL(p).icon} ${PL(p).name}: этап ${U.stages[p] + 1} «${PL(p).eras[U.stages[p]].name}»`, ok: isUnlocked(p) && ps(p).era >= U.stages[p] });
  }
  const cost = { ...U.cost };
  return { reqs, cost, ready: reqs.every(r => r.ok) && canPay(cost) };
}

// ---------- Престиж планеты ----------
// У каждой планеты свои престижи и свои цели; чем больше престижей, тем выше цели (см. prestigeGoals в data.js)
function planetBuildings(pid) { return Object.values(ps(pid).counts).reduce((a, b) => a + b, 0); }
function prestigeInfo(pid = cur()) {
  const n = prestigeCount(pid), P = PL(pid), st = ps(pid);
  const goals = prestigeGoals(pid, n).map(g => {
    if (g.kind === 'stage') return { ...g, label: `${P.stageWord} ${g.need + 1} «${P.eras[g.need].name}»`, have: st.era + 1, goal: g.need + 1, ok: st.era >= g.need };
    if (g.kind === 'build') { const b = planetBuildings(pid); return { ...g, label: `Построек на планете: ${fmt(g.need)}`, have: b, goal: g.need, ok: b >= g.need }; }
    const v = st.res[g.res] || 0;
    return { ...g, label: `Накопить ${fmt(g.need)} ${RES[g.res].icon} ${RES[g.res].name.toLowerCase()}`, have: v, goal: g.need, ok: v >= g.need };
  });
  const ready = isUnlocked(pid) && goals.every(g => g.ok);
  return { pid, n, goals, ready, gems: prestigeGems(pid, n, st.era), mult: 1 + n, nextMult: 2 + n };
}
function canPrestige(pid = cur()) { return prestigeInfo(pid).ready; }

// ============================================================
//  ФОРМАТИРОВАНИЕ И МЕЛОЧИ
// ============================================================
function fmt(n) {
  if (n >= 1e15) return (n / 1e15).toFixed(2) + 'Q';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.floor(n);
}
function fmtRate(x) { return x >= 1000 ? fmt(x) : (x >= 100 ? Math.round(x) : x.toFixed(1)); }
function fmtTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m} мин`;
  return `${sec} с`;
}
function fmtCountdown(sec) { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b > 1 && b < 5) return few;
  return many;
}
function stageLabel(pid, era = ps(pid).era) { return `${PL(pid).stageWord} ${era + 1}`; }

let toastTimer = null;
function showToast(text, ms = 3500) {
  const t = $('toast');
  t.innerText = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

function avatarStyle(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `background:linear-gradient(135deg,hsl(${h} 80% 56%),hsl(${(h + 55) % 360} 80% 42%))`;
}
function initialOf(name) { const c = [...String(name || '?')][0] || '?'; return c.toUpperCase(); }
// Фон интерфейса — всегда «родной» для планеты; купленный фон меняет только космос за планетой
function applyBodyBg() { $('bodyBg').className = PL(cur()).defaultBg; $('viewport').dataset.bg = state.look[cur()].bg || ''; }

// ============================================================
//  СЕТЬ / АККАУНТ
// ============================================================
let session = null;
let myProfile = null;
let playing = false;
let demo = false;
let clientOutdated = false;

function loadSession() { try { const s = JSON.parse(localStorage.getItem('terra_session')); return (s && s.token && s.uid) ? s : null; } catch (e) { return null; } }
function saveSession() { try { localStorage.setItem('terra_session', JSON.stringify(session)); } catch (e) {} }
function currentUid() { return session ? session.uid : (demo ? 'demo' : null); }

async function api(path, opts = {}) {
  // X-Terra-Client: эта версия умеет показывать окно «Обновите игру» (ответ 426)
  const headers = { 'Content-Type': 'application/json', 'X-Terra-Client': String(GAME_VERSION) };
  if (session && session.token) headers.Authorization = 'Bearer ' + session.token;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(CONFIG.API_URL + path, {
      method: opts.method || 'GET', headers, cache: 'no-store',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal, keepalive: !!opts.keepalive
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || ('http_' + res.status));
      err.status = res.status; err.data = data;
      if (res.status === 426) showForcedUpdate(data && data.latest);
      throw err;
    }
    return data;
  } finally { clearTimeout(timer); }
}

function readLocal(uid) { try { return JSON.parse(localStorage.getItem('terra_save_' + uid)); } catch (e) { return null; } }
function saveLocal() {
  const uid = currentUid();
  if (!uid || demo) return;   // гость ничего не сохраняет
  try { state.lastSave = Date.now(); localStorage.setItem('terra_save_' + uid, JSON.stringify(state)); } catch (e) {}
}
function pickNewest(a, b) {
  if (a && b) return (Number(b.lastSave) || 0) > (Number(a.lastSave) || 0) ? b : a;
  return a || b || null;
}
function setSync(kind) {
  const d = $('syncDot');
  d.className = 'sync-dot ' + kind;
  d.title = { ok: 'Прогресс сохранён в облаке', sync: 'Синхронизация…', off: 'Нет связи — играете офлайн', demo: 'Демо-режим, без облака' }[kind] || '';
}

let syncing = false, syncTimer = null;
let needsReconcile = false;
// насколько продвинуто сохранение (то же, что общий счёт рейтинга): престиж — 100, эпоха/этап — 1
function progressOf(s) {
  if (!s) return -1;
  if (s.v >= 3) {
    const pr = (s.v >= 5 && s.ppr) ? PLANET_ORDER.reduce((a, p) => a + ((s.ppr[p] | 0)), 0) : (s.rebirths | 0);
    const eras = PLANET_ORDER.reduce((a, p) => a + ((s.planets && s.planets[p] && s.planets[p].era) | 0), 0);
    return pr * 100 + eras;
  }
  return (s.rebirths | 0) * 100 + (s.era | 0);
}
function canSync() { return CONFIGURED && !!session && playing && !demo && !!myProfile && !clientOutdated; }
function queueSync(delay = 1500) { if (!canSync()) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), delay); }
async function syncNow(keepalive = false) {
  if (!canSync() || syncing) return;
  syncing = true; setSync('sync');
  try {
    if (needsReconcile) {
      const me = await api('/api/me');
      needsReconcile = false;
      if (!me.profile) { syncing = false; logout({ ask: false, skipSync: true, message: 'Аккаунт не найден. Войдите снова.' }); return; }
      myProfile = { ...myProfile, ...me.profile };
      updateUserChip();
      if (me.save && progressOf(me.save) > progressOf(state)) {
        applySave(me.save);
        onPlanetChanged();
        showToast('☁️ В облаке был более свежий прогресс — загрузили его', 3500);
      }
    }
    saveLocal();
    const r = await api('/api/sync', { method: 'POST', body: { save: state }, keepalive });
    if (r && myProfile) { myProfile.score = r.score; myProfile.rank = r.rank; myProfile.rebirths = r.rebirths; myProfile.era = r.era; }
    setSync('ok'); renderRankPill();
  } catch (e) {
    if (e.status === 401) { syncing = false; forceLogout('Сессия истекла. Войдите снова.'); return; }
    if (e.status === 404 && e.message === 'no_profile') { syncing = false; logout({ ask: false, skipSync: true, message: 'Аккаунт не найден. Войдите снова.' }); return; }
    if (e.status === 409 && e.message === 'client_outdated') { clientOutdated = true; showToast('Вышла новая версия игры — обновите приложение', 6000); checkUpdate(true); }
    setSync('off');
  } finally { syncing = false; }
}

// ---------- Вход через Google (через браузер: и на сайте, и в APK) ----------
const PENDING_KEY = 'terra_pending_login';
const PENDING_TTL_MS = 15 * 60 * 1000;

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function startGoogleLogin() {
  if (!CONFIGURED) return;
  showLoginError('');
  let url;
  try {
    // verifier знает только эта игра; сервер получит лишь его хэш
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const st = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    localStorage.setItem(PENDING_KEY, JSON.stringify({ state: st, verifier, t: Date.now() }));
    url = `${CONFIG.API_URL}/auth/google/start?state=${st}&challenge=${challenge}&app=${IS_APP ? 1 : 0}${IS_APP ? '&build=' + MY_BUILD : ''}`;
  } catch (e) {
    showLoginError('Этот браузер не поддерживает безопасный вход. Обновите его или откройте игру в Chrome.');
    return;
  }
  if (IS_APP) {
    setLoginBusy(true, 'Продолжите вход в открывшемся окне Google…', true);
    try { window.TerraNative.openExternal(url); }
    catch (e) { setLoginBusy(false); showLoginError('Не удалось открыть браузер для входа.'); }
  } else {
    setLoginBusy(true, 'Переходим в Google…');
    location.href = url;
  }
}

function takePendingLogin() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PENDING_KEY)); } catch (e) {}
  try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
  return p;
}

async function completeLogin(code, st, error) {
  if (playing) return;
  const pending = takePendingLogin();
  if (error) {
    showLogin(error === 'cancelled' ? 'Вход отменён.' : 'Google не подтвердил вход. Попробуйте ещё раз.');
    return;
  }
  if (!code || !pending || pending.state !== st || Date.now() - pending.t > PENDING_TTL_MS) {
    showLogin('Ссылка входа устарела. Нажмите «Войти через Google» ещё раз.');
    return;
  }
  closeAllOverlays();
  $('loginOverlay').classList.add('open');
  setLoginBusy(true, 'Входим…');
  try {
    const r = await api('/api/auth/exchange', { method: 'POST', body: { code, state: st, verifier: pending.verifier } });
    session = { token: r.token, uid: r.uid, nickname: r.profile ? r.profile.nickname : null };
    saveSession();
    await enterGame(r.profile, r.save, false);
  } catch (e) {
    session = null;
    if (e.status === 426) return;
    showLogin(e.status === 401 ? 'Вход не удался или устарел. Попробуйте ещё раз.' : 'Не удалось войти. Проверьте интернет и попробуйте снова.');
  }
}

function readAuthFromHash() {
  const h = location.hash || '';
  const m = h.match(/^#auth=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  const err = h.match(/^#auth_error=([a-z_]+)$/);
  if (!m && !err) return null;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
  return m ? { code: m[1], state: m[2] } : { error: err[1] };
}

let bootPromise = null;
window.onNativeAuth = function (link) {
  let u;
  try { u = new URL(String(link)); } catch (e) { return; }
  const code = u.searchParams.get('code'), st = u.searchParams.get('state'), error = u.searchParams.get('error');
  (bootPromise || Promise.resolve()).then(() => completeLogin(code, st, error));
};

function setLoginBusy(on, text, cancellable) {
  $('loginActions').hidden = on;
  $('loginLoader').hidden = !on;
  $('loginCancel').hidden = !(on && cancellable);
  if (text) $('loginLoaderText').innerText = text;
}
function showLoginError(msg) { $('loginError').innerText = msg || ''; }

function showLogin(message) {
  closeAllOverlays();
  $('loginOverlay').classList.add('open');
  setLoginBusy(false);
  showLoginError(message || '');
  $('demoBtn').hidden = false;
  $('googleBtn').hidden = !CONFIGURED;
  const apk = $('apkLink');
  apk.hidden = IS_APP || !CONFIG.APK_URL;
  if (!apk.hidden) apk.href = CONFIG.APK_URL;
  if (!CONFIGURED) {
    showLoginError(message || (IS_APP
      ? 'Сервер не указан в config.js — доступна только игра гостем.'
      : 'Онлайн не настроен: впишите адрес сервера в web/config.js (см. README).'));
  }
}

async function enterGame(profile, cloudSave, offlineMode) {
  const uid = session.uid;
  let chosen = pickNewest(cloudSave, readLocal(uid));
  if (!chosen && !offlineMode) {
    try {
      const legacy = JSON.parse(localStorage.getItem('terra_mobile_save'));
      if (legacy && legacy.res) { chosen = legacy; localStorage.removeItem('terra_mobile_save'); showToast('Старый локальный прогресс привязан к аккаунту', 4000); }
    } catch (e) {}
  }
  applySave(chosen);
  myProfile = profile ? { ...profile } : null;
  if (!profile) {
    setLoginBusy(false);
    $('loginOverlay').classList.remove('open');
    openNickname();
    return;
  }
  startPlaying(offlineMode);
}

function startPlaying(offline) {
  if (forcedUpdate) return;
  closeAllOverlays();
  const sec = Math.min((Date.now() - (state.lastSave || Date.now())) / 1000, OFFLINE_MAX_SEC);
  grantOffline(sec);
  bossCooldown = BOSS_FIRST_MIN + Math.random() * (BOSS_FIRST_MAX - BOSS_FIRST_MIN);
  endAsteroid(true);
  playing = true;
  lastTick = Date.now();
  ui.tab = 'a';
  onPlanetChanged();
  renderRankPill();
  updateUserChip();
  if (demo) setSync('demo');
  else if (offline) setSync('off');
  else { setSync('sync'); queueSync(800); fetchLeaderboard(); }
  if (CONFIGURED && !demo && offline) queueSync(5000);
  checkUpdate();
}

function grantOffline(sec) {
  sec = Math.min(sec, OFFLINE_MAX_SEC);
  if (sec <= 60) return;
  let shown = 0;
  state.unlocked.forEach(pid => {
    const r = rates(pid);
    for (const k in r) {
      if (r[k] <= 0) continue;
      const add = r[k] * sec * OFFLINE_EFFICIENCY;
      ps(pid).res[k] += add;
      if (pid === cur() && k === PL(pid).clickRes) shown = add;
    }
  });
  if (shown > 0) setTimeout(() => showToast(`😴 Пока вас не было ${fmtTime(sec)}: +${fmt(shown)} ${RES[PL(cur()).clickRes].icon} и другие ресурсы`, 5000), 500);
}

async function boot() {
  initCanvas();
  buildMap();
  setupEvents();
  onPlanetChanged();
  updateUserChip();
  updateSoundBtn();
  setLoginBusy(true, 'Загрузка…');
  await resolveApi();
  if (!CONFIGURED) { showLogin(); return; }
  const fromHash = readAuthFromHash();
  if (fromHash) { await completeLogin(fromHash.code, fromHash.state, fromHash.error); return; }
  session = loadSession();
  if (!session) { showLogin(); return; }
  setLoginBusy(true, 'Загружаем ваш прогресс…');
  try {
    const me = await api('/api/me');
    session.nickname = me.profile ? me.profile.nickname : null;
    saveSession();
    await enterGame(me.profile, me.save, false);
  } catch (e) {
    if (e.status === 426) return;   // версия устарела — уже показано окно обновления
    if (e.status === 401) { clearSession(); session = null; showLogin('Сессия истекла. Войдите снова.'); }
    else if (readLocal(session.uid) && session.nickname) {
      myProfile = { nickname: session.nickname, score: 0, rebirths: 0, era: 0, rank: null };
      applySave(readLocal(session.uid));
      needsReconcile = true;
      startPlaying(true);
      showToast('Нет связи с сервером — играем офлайн', 3000);
    } else { session = null; showLogin('Нет связи с сервером. Проверьте интернет.'); }
  }
}

function clearSession() { try { localStorage.removeItem('terra_session'); } catch (e) {} }

async function logout({ ask = true, skipSync = false, keepCache = false, message = '' } = {}) {
  if (ask) {
    const ok = demo
      ? await askConfirm({ title: 'Выйти из гостевого режима?', text: 'Прогресс гостя не сохраняется и пропадёт. Чтобы играть с сохранением, войдите через Google.', ok: 'Выйти', danger: true })
      : await askConfirm({ title: 'Выйти из аккаунта?', text: 'Прогресс сохранён в облаке — после входа через Google вы продолжите с того же места. На этом устройстве данные будут очищены.', ok: 'Выйти' });
    if (!ok) return;
  }
  if (!skipSync && canSync()) {
    try { await Promise.race([syncNow(), new Promise(r => setTimeout(r, 3500))]); } catch (e) {}
  }
  playing = false;
  clearTimeout(syncTimer);
  const uid = currentUid();
  clearSession();
  try { if (uid && !keepCache) localStorage.removeItem('terra_save_' + uid); } catch (e) {}
  try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
  session = null; myProfile = null; lbData = null; demo = false; needsReconcile = false; clientOutdated = false;
  state = defaultState();
  endAsteroid(true);
  particles = []; ripples = []; debris = [];
  ui.tab = 'a';
  onPlanetChanged(); updateUserChip(); renderRankPill(); setSync('');
  showLogin(message);
}
function forceLogout(msg) { logout({ ask: false, skipSync: true, keepCache: true, message: msg }); }

// Гость: играет без аккаунта, прогресс нигде не сохраняется
async function startDemo() {
  const ok = await askConfirm({
    title: '👤 Играть как гость?',
    text: 'Внимание: прогресс гостя НЕ сохраняется. После выхода или закрытия игры всё начнётся заново.\n\nРейтинг, промокоды и облако доступны только с аккаунтом. Чтобы сохранить прогресс — войдите через Google.',
    ok: 'Играть как гость', cancel: 'Назад'
  });
  if (!ok) return;
  demo = true; session = null;
  try { localStorage.removeItem('terra_save_demo'); } catch (e) {}
  applySave(null);
  myProfile = { nickname: 'Гость', score: 0, rebirths: 0, era: 0, rank: null };
  startPlaying(true);
  showToast('👤 Гостевой режим: прогресс не сохраняется', 4000);
}

// ---------- Ник ----------
const NICK_RE = /^[\p{L}\p{N}_\-. ]{3,16}$/u;
function validateNick(raw) {
  const n = String(raw).normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (n.length < 3) return { ok: false, msg: 'Минимум 3 символа' };
  if (n.length > 16) return { ok: false, msg: 'Максимум 16 символов' };
  if (!NICK_RE.test(n)) return { ok: false, msg: 'Только буквы, цифры, пробел, _ - .' };
  return { ok: true, nick: n };
}
function setNickMsg(t, err) { const m = $('nickMsg'); m.innerText = t || ''; m.className = 'nick-msg' + (err ? ' err' : ''); }
function openNickname() {
  $('nickOverlay').classList.add('open');
  setNickMsg('');
  $('nickInput').value = '';
  $('nickSubmit').disabled = false;
  setTimeout(() => { try { $('nickInput').focus(); } catch (e) {} }, 350);
}
function randomNick() {
  const adj = ['Звёздный', 'Лунный', 'Тихий', 'Яркий', 'Дальний', 'Лихой', 'Мудрый', 'Быстрый'];
  const noun = ['Пилот', 'Творец', 'Капитан', 'Ловец', 'Гость', 'Зодчий', 'Скиталец'];
  let n = adj[Math.floor(Math.random() * adj.length)] + ' ' + noun[Math.floor(Math.random() * noun.length)];
  if (n.length + 3 <= 16) n += ' ' + (10 + Math.floor(Math.random() * 90));
  return n;
}
async function submitNick() {
  const v = validateNick($('nickInput').value);
  if (!v.ok) { setNickMsg(v.msg, true); Sound.error(); return; }
  $('nickSubmit').disabled = true;
  setNickMsg('Сохраняем…');
  try {
    const r = await api('/api/profile', { method: 'POST', body: { nickname: v.nick } });
    myProfile = { ...r.profile };
    session.nickname = r.profile.nickname; saveSession();
    startPlaying(false);
  } catch (e) {
    $('nickSubmit').disabled = false;
    Sound.error();
    if (e.message === 'nickname_taken') setNickMsg('Этот ник уже занят — попробуйте другой', true);
    else if (e.message === 'invalid_nickname') setNickMsg('Недопустимый ник', true);
    else if (e.status === 401) { $('nickOverlay').classList.remove('open'); forceLogout('Сессия истекла. Войдите снова.'); }
    else setNickMsg('Не удалось сохранить. Проверьте интернет.', true);
  }
}

// ---------- Промокоды ----------
// Код проверяет сервер (один раз на аккаунт); награду начисляет игра и сразу сохраняет в облако
function openCodes() {
  if (!playing) return;
  closeAllOverlays();
  $('codeInput').value = '';
  setCodeMsg(demo || !session ? 'Промокоды работают только с аккаунтом Google.' : '', !!(demo || !session));
  $('codeSubmit').disabled = demo || !session;
  $('codeOverlay').classList.add('open');
  Sound.ui();
  setTimeout(() => { try { $('codeInput').focus(); } catch (e) {} }, 250);
}
function setCodeMsg(text, bad) { const m = $('codeMsg'); m.textContent = text; m.className = 'nick-msg' + (bad ? ' err' : text ? ' ok' : ''); }
function applyReward(rw) {
  const chips = [];
  if (!rw || typeof rw !== 'object') return chips;
  if (rw.gems > 0) { state.gems += rw.gems; chips.push(`💎 +${fmt(rw.gems)}`); }
  if (rw.sapphires > 0) { state.sapphires += rw.sapphires; chips.push(`🔷 +${fmt(rw.sapphires)}`); }
  for (const k in (rw.res || {})) {
    const [pid, r] = k.split(':'), v = num(rw.res[k]);
    if (PLANETS[pid] && PL(pid).res.includes(r) && v > 0) { ps(pid).res[r] += v; chips.push(`${RES[r].icon} +${fmt(v)}`); }
  }
  if (rw.all > 0) { state.unlocked.forEach(pid => PL(pid).res.forEach(r => ps(pid).res[r] += rw.all)); chips.push(`🪐 +${fmt(rw.all)} каждого ресурса`); }
  (rw.items || []).forEach(id => {
    const c = COSMETICS.find(x => x.id === id);
    if (c && !state.ownedCosmetics.includes(id)) { state.ownedCosmetics.push(id); chips.push(`${c.icon} ${c.name}`); }
  });
  return chips;
}
const CODE_ERRORS = {
  invalid_code: 'Такого кода нет. Проверьте написание.',
  already_used: 'Вы уже активировали этот код.',
  code_expired: 'Срок действия кода закончился.',
  code_exhausted: 'Этот код уже использовали максимальное число раз.',
  too_many_attempts: 'Слишком много попыток. Подождите 10 минут.',
  bad_request: 'Введите код.'
};
async function submitCode() {
  const code = $('codeInput').value.trim();
  if (!code) { setCodeMsg('Введите код', true); return; }
  if (!canSync()) { setCodeMsg(clientOutdated ? 'Обновите игру, чтобы вводить коды.' : 'Нужен вход через Google и интернет.', true); return; }
  $('codeSubmit').disabled = true; setCodeMsg('Проверяем…');
  try {
    const r = await api('/api/redeem', { method: 'POST', body: { code } });
    const chips = applyReward(r.reward);
    $('codeOverlay').classList.remove('open');
    Sound.unlock(); vibrate([30, 40, 30]);
    saveLocal(); await syncNow();
    showCinema({ kicker: 'Промокод активирован', big: '🎁', title: r.title || 'Подарок', desc: r.text || 'Награда уже у вас!', color: '#a78bfa', chips });
    renderAll();
  } catch (e) {
    Sound.error();
    setCodeMsg(e.status === 401 ? 'Сессия истекла — войдите снова.' : (CODE_ERRORS[e.message] || 'Не удалось проверить код. Проверьте интернет.'), true);
  } finally { $('codeSubmit').disabled = false; }
}

// ---------- Вышло обновление (только в APK) ----------
// Сервер знает номер последней сборки (version.json из релиза на GitHub) и сравнивает его с нашим.
let updateInfo = null, updateShownBuild = 0, updateRetry = null, forcedUpdate = false;
async function checkUpdate(force = false) {
  if (!IS_APP || !MY_BUILD || !CONFIGURED) return;
  try {
    const r = await api('/api/client');
    if (r && r.update && r.latest && r.latest.build > MY_BUILD) {
      updateInfo = r.latest;
      if (r.required) showForcedUpdate(r.latest); else maybeShowUpdate(force);
    }
  } catch (e) {}
}
// Версия устарела, сервер больше не пускает: играть нельзя, только обновиться
function showForcedUpdate(latest) {
  if (latest && latest.build) updateInfo = latest;
  if (forcedUpdate) return;
  forcedUpdate = true;
  if (playing) { saveLocal(); playing = false; }
  endAsteroid(true);
  clearTimeout(updateRetry);
  closeAllOverlays();
  if (cinemaOpen) { cinemaQueue.length = 0; cinemaShownAt = 0; closeCinema(); }
  $('loginOverlay').classList.remove('open');
  $('updateKicker').textContent = 'Нужно обновление';
  $('updateTitle').innerText = 'Terra 3D ' + ((updateInfo && updateInfo.version) || '');
  $('updateNotes').innerText = 'Эта версия игры устарела — играть можно только в новой. ' + ((updateInfo && updateInfo.notes) ? 'Что нового: ' + updateInfo.notes : '');
  $('updateVer').innerText = MY_BUILD ? 'У вас версия 1.0.' + MY_BUILD : 'У вас старая версия';
  $('updateLater').hidden = true;
  $('updateOverlay').classList.add('forced', 'open');
  Sound.alarm();
}
function screenBusy() {
  return cinemaOpen || traveling || !!document.querySelector('.overlay.open');
}
function maybeShowUpdate(force = false) {
  if (!updateInfo || (!force && updateShownBuild === updateInfo.build)) return;
  clearTimeout(updateRetry);
  // не перебиваем заставку эпохи, перелёт и другие окна — подождём
  if (!playing || screenBusy()) { updateRetry = setTimeout(() => maybeShowUpdate(force), 3000); return; }
  updateShownBuild = updateInfo.build;
  $('updateTitle').innerText = 'Terra 3D ' + updateInfo.version;
  $('updateNotes').innerText = updateInfo.notes || 'Новые возможности и исправления.';
  $('updateVer').innerText = 'У вас версия 1.0.' + MY_BUILD;
  $('updateOverlay').classList.add('open');
  Sound.unlock();
}
function downloadUpdate() {
  const url = (updateInfo && updateInfo.url) || CONFIG.APK_URL;
  if (!forcedUpdate) $('updateOverlay').classList.remove('open');
  if (!url) return;
  if (playing) { saveLocal(); syncNow(true); }
  try { window.TerraNative.openExternal(url); } catch (e) { location.href = url; }
  showToast('Скачивается обновление — откройте файл и установите поверх игры', 6000);
}
setInterval(() => { if (playing && !document.hidden) checkUpdate(); }, 30 * 60 * 1000);

// ---------- Диалоги ----------
function closeAllOverlays() {
  ['nickOverlay', 'profileOverlay', 'confirmOverlay', 'loginOverlay', 'mapOverlay', 'questsOverlay', 'shopOverlay', 'codeOverlay', 'chestOverlay'].forEach(id => $(id).classList.remove('open'));
  if (!forcedUpdate) $('updateOverlay').classList.remove('open');
}
function askConfirm({ title, text, ok = 'Да', cancel = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    $('confirmTitle').innerText = title;
    $('confirmText').innerText = text;
    $('confirmOk').innerText = ok;
    $('confirmOk').className = 'btn-main' + (danger ? ' danger' : '');
    $('confirmCancel').innerText = cancel;
    const ov = $('confirmOverlay');
    const done = (v) => { ov.classList.remove('open'); $('confirmOk').onclick = null; $('confirmCancel').onclick = null; resolve(v); };
    $('confirmOk').onclick = () => done(true);
    $('confirmCancel').onclick = () => done(false);
    ov.classList.add('open');
  });
}

function openProfile() {
  if (!myProfile) return;
  const p = myProfile;
  const online = CONFIGURED && !demo && !!session;
  $('profileSheet').innerHTML = `
    <div class="profile-head">
      <div class="avatar lg" style="${avatarStyle(p.nickname)}">${esc(initialOf(p.nickname))}</div>
      <div class="profile-name">${esc(p.nickname)}</div>
      <div class="user-sub">${online ? 'Аккаунт Google · прогресс в облаке' : 'Демо-режим'}</div>
    </div>
    <div class="stat-grid four">
      <div class="stat-box"><div class="stat-val">${p.rank ? '#' + p.rank : '—'}</div><div class="stat-lbl">Место</div></div>
      <div class="stat-box"><div class="stat-val">${totalPrestige()}</div><div class="stat-lbl">Престижи</div></div>
      <div class="stat-box"><div class="stat-val">${ps('earth').era + 1}</div><div class="stat-lbl">Эпоха</div></div>
      <div class="stat-box"><div class="stat-val">${state.unlocked.length}</div><div class="stat-lbl">Планеты</div></div>
    </div>
    <div class="sheet-stack">
      ${updateInfo ? `<button class="btn-main" id="pfUpdate" type="button">⬆️ Обновить до ${esc(updateInfo.version)}</button>` : ''}
      <button class="btn-soft" id="pfCode" type="button">🎁 Ввести промокод</button>
      <button class="btn-soft" id="pfSound" type="button">${Sound.enabled ? '🔊 Звук включён' : '🔇 Звук выключен'}</button>
      ${online ? '<button class="btn-soft" id="pfLogout" type="button">Выйти из аккаунта</button>' : ''}
      <button class="btn-soft danger" id="pfReset" type="button">Сбросить прогресс</button>
      ${online ? '<button class="btn-soft danger" id="pfDelete" type="button">Удалить аккаунт</button>' : ''}
      <button class="btn-main" id="pfClose" type="button">Закрыть</button>
    </div>
    <div class="version">Terra 3D · ${MY_BUILD ? 'версия 1.0.' + MY_BUILD : 'веб-версия'}</div>`;
  $('pfClose').onclick = () => $('profileOverlay').classList.remove('open');
  $('pfSound').onclick = () => { toggleSound(); $('pfSound').innerText = Sound.enabled ? '🔊 Звук включён' : '🔇 Звук выключен'; };
  $('pfReset').onclick = resetGame;
  $('pfCode').onclick = openCodes;
  if (updateInfo) $('pfUpdate').onclick = () => { $('profileOverlay').classList.remove('open'); downloadUpdate(); };
  if (online) { $('pfLogout').onclick = () => { $('profileOverlay').classList.remove('open'); logout(); }; $('pfDelete').onclick = deleteAccount; }
  $('profileOverlay').classList.add('open');
}

async function resetGame() {
  const ok = await askConfirm({ title: 'Сбросить прогресс?', text: 'Все планеты, постройки, кристаллы, перки и перерождения будут удалены, а ваш результат в рейтинге обнулится.', ok: 'Сбросить', danger: true });
  if (!ok) return;
  if (canSync()) {
    try { await api('/api/reset', { method: 'POST' }); myProfile.score = 0; myProfile.rebirths = 0; myProfile.era = 0; myProfile.rank = null; }
    catch (e) { showToast('Не удалось сбросить в облаке. Проверьте интернет.'); return; }
  }
  applySave(null);
  endAsteroid(true);
  bossCooldown = BOSS_FIRST_MIN + Math.random() * (BOSS_FIRST_MAX - BOSS_FIRST_MIN);
  saveLocal();
  $('profileOverlay').classList.remove('open');
  onPlanetChanged(); renderRankPill();
  queueSync(500);
  fetchLeaderboard();
}

async function deleteAccount() {
  const ok = await askConfirm({ title: 'Удалить аккаунт?', text: 'Ник, прогресс и место в рейтинге будут удалены навсегда. Это действие нельзя отменить.', ok: 'Удалить навсегда', danger: true });
  if (!ok) return;
  try { await api('/api/account', { method: 'DELETE' }); }
  catch (e) { showToast('Не удалось удалить аккаунт. Проверьте интернет.'); return; }
  logout({ ask: false, skipSync: true, message: 'Аккаунт удалён.' });
}

// ---------- Рейтинг ----------
// Доски: общий и по планетам; периоды: неделя и всё время
let lbData = null, lbLoading = false, lbError = false, lbVer = 0;
async function fetchLeaderboard() {
  if (!CONFIGURED || demo || !session) return;
  const key = ui.lbBoard + ':' + ui.lbPeriod;
  lbLoading = true; lbVer++;
  if (ui.tab === 'top') renderPanel();
  try {
    const d = await api(`/api/leaderboard?limit=50&board=${ui.lbBoard}&period=${ui.lbPeriod}`);
    if (key === ui.lbBoard + ':' + ui.lbPeriod) { lbData = d; lbError = false; }
  } catch (e) { if (key === ui.lbBoard + ':' + ui.lbPeriod) lbError = true; }
  lbLoading = false; lbVer++;
  if (ui.tab === 'top') renderPanel();
}
setInterval(() => { if (playing && ui.tab === 'top' && !document.hidden) fetchLeaderboard(); }, 30000);
function setLeaderboard(board, period) {
  if (board === ui.lbBoard && period === ui.lbPeriod) return;
  ui.lbBoard = board; ui.lbPeriod = period;
  lbData = null; lbError = false;
  Sound.ui();
  fetchLeaderboard();
}
function fmtLeft(ms) {
  const h = Math.max(0, Math.floor(ms / 3600000)), d = Math.floor(h / 24);
  return d > 0 ? `${d} д ${h % 24} ч` : `${h} ч ${Math.max(0, Math.floor(ms / 60000) % 60)} мин`;
}
function lbStat(p, board, period) {
  if (board === 'all') return period === 'week'
    ? `<span class="lb-pts">+${fmt(p.score)}</span><span>очков</span>`
    : `<span>🌀 ${fmt(p.rebirths)}</span><span>★ ${fmt(p.score)}</span>`;
  return `<span>🌀 ${fmt(p.prestige || 0)} · ${PL(board).stageWord} ${p.era + 1}</span><span>🏗 ${fmt(p.buildings)}</span>`;
}

function renderLeaderboardHtml() {
  if (!CONFIGURED || demo) {
    return `<div class="empty"><div class="empty-ico">🏆</div><div class="empty-title">Рейтинг недоступен</div><div class="empty-text">Войдите через Google, чтобы соревноваться с другими игроками.</div></div>`;
  }
  const board = ui.lbBoard, period = ui.lbPeriod, me = myProfile;
  const d = lbData && lbData.board === board && lbData.period === period ? lbData : null;
  const boardName = board === 'all' ? 'Общий топ' : `Топ: ${PL(board).name}`;
  const note = board === 'all'
    ? (period === 'week' ? 'Очки, набранные с понедельника' : 'Престиж — 100 очков, эпоха или этап — 1')
    : (period === 'week' ? 'Лучший результат на этой неделе' : 'Престижи планеты, затем этап и постройки');
  let html = `<div class="lb-head"><div><div class="lb-title">🏆 ${boardName}</div><div class="lb-sub">${d ? 'Игроков: ' + fmt(d.total) + ' · ' : ''}${note}</div></div><button class="btn-icon" data-action="lbrefresh" type="button">⟳</button></div>
    <div class="lb-boards">${['all', ...PLANET_ORDER].map(b => `<button class="lb-board ${b === board ? 'active' : ''}" data-action="lbboard" data-id="${b}" type="button">${b === 'all' ? '🏆 Общий' : PL(b).icon + ' ' + PL(b).name}</button>`).join('')}</div>
    <div class="seg lb-period">
      <button class="seg-btn ${period === 'week' ? 'active' : ''}" data-action="lbperiod" data-id="week" type="button">📅 За неделю</button>
      <button class="seg-btn ${period === 'all' ? 'active' : ''}" data-action="lbperiod" data-id="all" type="button">♾️ За всё время</button>
    </div>`;
  if (period === 'week' && d && d.week) html += `<div class="lb-week">⏳ Неделя закончится через ${fmtLeft(d.week.endsAt - Date.now())} — тогда топ начнётся заново</div>`;
  if (me) {
    let rank = '—', stat;
    if (board === 'all' && period === 'all') {
      rank = me.rank ? '#' + me.rank : '—';
      const tp = totalPrestige();
      stat = `🌀 ${tp} ${plural(tp, 'престиж', 'престижа', 'престижей')} · ★ ${fmt(me.score || 0)} · 🪐 ${state.unlocked.length}`;
    } else {
      const m = d && d.me;
      if (m && m.rank) rank = '#' + m.rank;
      if (board === 'all') stat = m ? `+${fmt(m.score)} очков за неделю` : 'На этой неделе пока без очков';
      else if (!isUnlocked(board)) stat = `🔒 Планета ещё не открыта`;
      else stat = m ? `🌀 ${fmt(m.prestige || 0)} · ${PL(board).stageWord} ${m.era + 1} · 🏗 ${fmt(m.buildings)}` : 'Пока без результата';
    }
    html += `<div class="lb-me"><div class="lb-me-rank">${rank}</div><div class="avatar" style="${avatarStyle(me.nickname)}">${esc(initialOf(me.nickname))}</div><div class="lb-me-info"><div class="lb-me-name">${esc(me.nickname)}</div><div class="lb-me-stat">${stat}</div></div></div>`;
  }
  if (d && d.players.length) {
    const myLc = me ? me.nickname.toLowerCase() : '';
    html += d.players.map((p, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
      const mine = p.nickname.toLowerCase() === myLc;
      return `<div class="lb-row ${rank <= 3 ? 'top' + rank : ''} ${mine ? 'mine' : ''}" style="--i:${Math.min(i, 12)}"><div class="lb-rank">${medal}</div><div class="avatar sm" style="${avatarStyle(p.nickname)}">${esc(initialOf(p.nickname))}</div><div class="lb-name">${esc(p.nickname)}${mine ? '<span class="you">вы</span>' : ''}</div><div class="lb-stat">${lbStat(p, board, period)}</div></div>`;
    }).join('');
  } else if (lbLoading || (!d && !lbError)) {
    html += '<div class="skeleton"></div>'.repeat(6);
  } else if (lbError) {
    html += `<div class="empty"><div class="empty-ico">📡</div><div class="empty-title">Не удалось загрузить</div><div class="empty-text">Проверьте интернет и нажмите ⟳</div></div>`;
  } else {
    html += `<div class="empty"><div class="empty-ico">🌌</div><div class="empty-title">Пока пусто</div><div class="empty-text">${period === 'week' ? 'На этой неделе ещё никто не набрал очков — станьте первым!' : 'Станьте первым в рейтинге!'}</div></div>`;
  }
  return html;
}

// ============================================================
//  CANVAS: ПЛАНЕТЫ
// ============================================================
const canvas = $('planetCanvas');
const ctx = canvas.getContext('2d');
let cw = 400, ch = 300, cx = 200, cy = 150, planetRadius = 90;
let rotAngle = 0, cloudAngle = 0, moonAngle = 1.2, pulseScale = 1.0;
let particles = [], ripples = [], stars = [], debris = [], shoot = null;
let activeAsteroid = null, bossCooldown = 120, laserBeamTimer = 0;
let shake = 0, planetFlash = 0, evolveFx = 0, evolveColor = '#ffffff';
const autoSat = { x: 0, y: 0, front: true };
const autoFx = { pending: 0, last: 0, flash: 0, beams: [], gain: 0, shown: 0 };
let lastFrameTime = performance.now();

const CONTINENT_BLOBS = [
  { lon: 0.5, lat: -0.25, r: 0.42 }, { lon: 0.75, lat: 0.1, r: 0.35 }, { lon: 0.3, lat: 0.35, r: 0.28 },
  { lon: 2.3, lat: -0.3, r: 0.48 },  { lon: 2.7, lat: 0.05, r: 0.38 }, { lon: 2.1, lat: 0.25, r: 0.32 },
  { lon: 4.2, lat: -0.15, r: 0.40 }, { lon: 4.6, lat: 0.3, r: 0.34 },  { lon: 5.5, lat: -0.4, r: 0.26 }
];
const CLOUD_BLOBS = [
  { lon: 0.2, lat: -0.4, w: 0.55, h: 0.16 }, { lon: 1.5, lat: 0.2, w: 0.65, h: 0.18 },
  { lon: 2.9, lat: -0.1, w: 0.50, h: 0.15 }, { lon: 4.1, lat: 0.35, w: 0.60, h: 0.17 }
];
const MARS_BLOBS = [
  { lon: 0.4, lat: -0.1, r: 0.36 }, { lon: 1.9, lat: 0.25, r: 0.3 }, { lon: 3.1, lat: -0.3, r: 0.42 },
  { lon: 4.4, lat: 0.15, r: 0.33 }, { lon: 5.6, lat: -0.05, r: 0.28 }
];
const JUPITER_STORMS = [
  { lon: 0.6, lat: -0.42, r: 0.07 }, { lon: 1.8, lat: 0.12, r: 0.06 }, { lon: 2.9, lat: -0.18, r: 0.08 },
  { lon: 4.0, lat: 0.5, r: 0.06 }, { lon: 5.2, lat: -0.55, r: 0.05 }, { lon: 3.6, lat: 0.3, r: 0.05 }
];
const EARTH_LOOK = [
  { ocean: ['#fb923c', '#c2410c', '#1c0702'], land: 'lava' },
  { ocean: ['#38bdf8', '#0369a1', '#082f49'], land: '#44403c', landScale: 0.35 },
  { ocean: ['#38bdf8', '#0369a1', '#082f49'], land: '#78716c', clouds: 0.45 },
  { ocean: ['#2dd4bf', '#0e7490', '#083344'], land: '#4d7c0f', clouds: 0.5, landScale: 0.9 },
  { ocean: ['#38bdf8', '#0369a1', '#082f49'], land: '#15803d', clouds: 0.5 },
  { ocean: ['#22d3ee', '#0e7490', '#082f49'], land: '#166534', clouds: 0.55, jungle: true },
  { ocean: ['#38bdf8', '#0369a1', '#082f49'], land: '#15803d', clouds: 0.5, fields: true, lights: 1 },
  { ocean: ['#38bdf8', '#0369a1', '#082f49'], land: '#3f6212', clouds: 0.4, fields: true, lights: 2, smog: true },
  { ocean: ['#38bdf8', '#0369a1', '#082f49'], land: '#15803d', clouds: 0.45, lights: 3, sats: 3 },
  { ocean: ['#38bdf8', '#0369a1', '#082f49'], land: '#16a34a', clouds: 0.4, lights: 4, sats: 6, ring: true },
  // 11–15: орбитальные кольца, планетарный разум, звёздные врата, межзвёздная держава, галактический маяк
  { ocean: ['#38bdf8', '#0369a1', '#082f49'], land: '#16a34a', clouds: 0.35, lights: 4, sats: 6, ring: true, oring: true },
  { ocean: ['#22d3ee', '#0e7490', '#082f49'], land: '#15803d', clouds: 0.35, lights: 4, sats: 6, ring: true, oring: true, grid: true },
  { ocean: ['#22d3ee', '#0e7490', '#082f49'], land: '#15803d', clouds: 0.3, lights: 4, sats: 8, ring: true, oring: true, grid: true, gate: true },
  { ocean: ['#5eead4', '#0f766e', '#042f2e'], land: '#16a34a', clouds: 0.3, lights: 4, sats: 8, ring: true, oring: true, grid: true, gate: true, colonies: true },
  { ocean: ['#5eead4', '#0f766e', '#042f2e'], land: '#22c55e', clouds: 0.3, lights: 4, sats: 10, ring: true, oring: true, grid: true, gate: true, colonies: true, beacon: true }
];

function initCanvas() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe($('viewport'));
    ro.observe(document.querySelector('.era-card'));
  }
  stars = [];
  for (let i = 0; i < 90; i++) stars.push({ x: Math.random(), y: Math.random(), z: Math.random() * 0.8 + 0.2, s: Math.random() * 1.6 + 0.5, a: Math.random() * 0.6 + 0.4, tw: Math.random() * 6.28 });
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!playing) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (activeAsteroid && Math.hypot(mx - activeAsteroid.x, my - activeAsteroid.y) <= activeAsteroid.r + 22) { damageAsteroid(false); return; }
    handlePlanetClick(mx, my);
  });
  requestAnimationFrame(renderFrame);
}

function resizeCanvas() {
  const vp = $('viewport');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cw = vp.clientWidth || 380;
  ch = vp.clientHeight || 260;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const top = document.querySelector('.viewport-top'), card = document.querySelector('.era-card');
  const topH = (top ? top.offsetHeight : 40) + 4;
  const footH = (card ? card.offsetHeight : 92) + 14;
  const avail = Math.max(60, ch - topH - footH);
  planetRadius = Math.max(34, Math.min(cw * 0.29, avail / 2.5));
  cx = cw / 2;
  cy = topH + planetRadius * 0.6 + planetRadius;
}

function spawnParticles(x, y, color, count = 15, speed = 4, size = 3) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, sp = Math.random() * speed + 1;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: Math.random() * size + 1, color, life: 1.0, decay: 0.04 });
  }
}

function projectBlob(b, R, angle = rotAngle) {
  let lon = (b.lon + angle) % (Math.PI * 2);
  if (lon > Math.PI) lon -= Math.PI * 2;
  if (lon <= -1.45 || lon >= 1.45) return null;
  return {
    px: cx + Math.sin(lon) * Math.cos(b.lat) * R,
    py: cy + Math.sin(b.lat) * R,
    radX: Math.max(2, (b.r || 0.3) * R * Math.cos(lon)),
    radY: Math.max(2, (b.r || 0.3) * R * 0.85),
    cos: Math.cos(lon)
  };
}
function fillSphere(R, stops) {
  const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, stops[0]); g.addColorStop(0.55, stops[1]); g.addColorStop(1, stops[2]);
  ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
}
function drawClouds(R, alpha, color = '255,255,255') {
  CLOUD_BLOBS.forEach(c => {
    let lon = (c.lon + cloudAngle) % (Math.PI * 2);
    if (lon > Math.PI) lon -= Math.PI * 2;
    if (lon > -1.4 && lon < 1.4) {
      ctx.fillStyle = `rgba(${color},${alpha})`;
      ctx.beginPath(); ctx.ellipse(cx + Math.sin(lon) * R * 0.9, cy + c.lat * R, Math.max(3, c.w * R * Math.cos(lon)), c.h * R, 0, 0, Math.PI * 2); ctx.fill();
    }
  });
}
// огни на ночной стороне
function drawLights(R, blobs, level, color = '253,224,71') {
  blobs.forEach((b, idx) => {
    const p = projectBlob(b, R);
    if (!p) return;
    const dark = Math.max(0, Math.min(1, ((p.px - cx) * 0.6 + (p.py - cy) * 0.5) / R + 0.25));
    if (dark < 0.05) return;
    ctx.fillStyle = `rgba(${color},${Math.min(1, dark * (0.5 + level * 0.15))})`;
    const n = 2 + level * 2;
    for (let i = 0; i < n; i++) {
      const ox = (((idx * 37 + i * 53) % 100) / 100 - 0.5) * p.radX * 1.5;
      const oy = (((idx * 17 + i * 29) % 100) / 100 - 0.5) * p.radY * 1.5;
      ctx.fillRect(p.px + ox, p.py + oy, level >= 3 ? 2.4 : 2, level >= 3 ? 2.4 : 2);
    }
  });
}

function drawEarth(R, era, now) {
  const L = EARTH_LOOK[era];
  fillSphere(R, L.ocean);
  const scale = L.landScale || 1;
  CONTINENT_BLOBS.forEach((b, idx) => {
    const p = projectBlob({ ...b, r: b.r * scale }, R);
    if (!p) return;
    if (L.land === 'lava') {
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now / 500 + idx);
      ctx.fillStyle = idx % 2 === 0 ? '#facc15' : '#f97316';
    } else ctx.fillStyle = L.land;
    ctx.beginPath(); ctx.ellipse(p.px, p.py, p.radX, p.radY, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    if (L.jungle) { ctx.fillStyle = 'rgba(5,46,22,0.55)'; ctx.beginPath(); ctx.ellipse(p.px + p.radX * 0.2, p.py, p.radX * 0.5, p.radY * 0.45, 0, 0, Math.PI * 2); ctx.fill(); }
    if (L.fields) { ctx.fillStyle = 'rgba(234,179,8,0.45)'; ctx.beginPath(); ctx.ellipse(p.px - p.radX * 0.25, p.py + p.radY * 0.2, p.radX * 0.35, p.radY * 0.25, 0, 0, Math.PI * 2); ctx.fill(); }
  });
  if (L.clouds) drawClouds(R, L.clouds);
  if (L.grid) { // планетарный разум: светящаяся сеть широт и долгот
    ctx.strokeStyle = `rgba(103,232,249,${0.22 + 0.08 * Math.sin(now / 600)})`; ctx.lineWidth = 1;
    for (let k = -2; k <= 2; k++) { const y = cy + k * R * 0.35; const w = Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy))); ctx.beginPath(); ctx.ellipse(cx, y, w, w * 0.12, 0, 0, Math.PI * 2); ctx.stroke(); }
    for (let k = 0; k < 6; k++) { const lon = (k / 6) * Math.PI * 2 + rotAngle; const c = Math.cos(lon); if (c <= 0) continue; ctx.beginPath(); ctx.ellipse(cx + Math.sin(lon) * 0, cy, Math.abs(Math.sin(lon)) * R, R, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  if (L.smog) { ctx.fillStyle = 'rgba(148,140,120,0.16)'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
  return L;
}
function drawMars(R, era, now) {
  // ржаво-красная пустыня; к 5-му этапу становится теплее и зеленее
  fillSphere(R, era >= 4 ? ['#f2683a', '#b3361b', '#300a04'] : ['#ec6a3c', '#a8321a', '#2b0904']);
  MARS_BLOBS.forEach((b, i) => {
    const p = projectBlob(b, R);
    if (!p) return;
    // тёмные низменности
    ctx.fillStyle = 'rgba(74,20,8,0.62)';
    ctx.beginPath(); ctx.ellipse(p.px, p.py, p.radX, p.radY * 0.7, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(p.px + p.radX * 0.45, p.py + p.radY * 0.25, p.radX * 0.5, p.radY * 0.35, -0.4, 0, Math.PI * 2); ctx.fill();
    // кратер
    ctx.strokeStyle = 'rgba(254,178,140,0.35)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(p.px - p.radX * 0.55, p.py - p.radY * 0.45, Math.max(1.5, p.radX * 0.16), p.radY * 0.12, 0, 0, Math.PI * 2); ctx.stroke();
    if (era >= 2 && era < 4) { // ледяные озёра
      ctx.fillStyle = 'rgba(125,211,252,0.9)';
      ctx.beginPath(); ctx.ellipse(p.px + p.radX * 0.25, p.py - p.radY * 0.1, p.radX * 0.42, p.radY * 0.3, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(240,249,255,0.95)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (era >= 4) { // моря и зелень терраформированного Марса
      ctx.fillStyle = 'rgba(14,116,144,0.92)';
      ctx.beginPath(); ctx.ellipse(p.px, p.py, p.radX * 0.95, p.radY * 0.66, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(56,189,248,0.55)';
      ctx.beginPath(); ctx.ellipse(p.px - p.radX * 0.15, p.py - p.radY * 0.1, p.radX * 0.6, p.radY * 0.36, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(34,197,94,0.85)';
      ctx.beginPath(); ctx.ellipse(p.px + p.radX * 0.85, p.py + p.radY * 0.4, p.radX * 0.45, p.radY * 0.32, -0.3, 0, Math.PI * 2); ctx.fill();
    }
    if (era >= 3 && p.cos > 0.2) { // купола городов
      const dr = Math.max(3, R * 0.085 * p.cos);
      const dx = p.px + p.radX * 0.1 - (era >= 4 ? p.radX * 0.9 : 0), dy = p.py + p.radY * 0.45;
      const glow = ctx.createRadialGradient(dx, dy, 0, dx, dy, dr * 1.8);
      glow.addColorStop(0, 'rgba(186,230,253,0.55)'); glow.addColorStop(1, 'rgba(186,230,253,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(dx, dy, dr * 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(224,242,254,0.45)'; ctx.strokeStyle = 'rgba(240,249,255,0.95)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(dx, dy, dr, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(253,224,71,0.9)';
      ctx.fillRect(dx - dr * 0.45, dy - dr * 0.35, dr * 0.22, dr * 0.22);
      ctx.fillRect(dx + dr * 0.15, dy - dr * 0.5, dr * 0.22, dr * 0.22);
    }
  });
  // каньон Долины Маринер и гора Олимп
  const vm = projectBlob({ lon: 2.4, lat: 0.05, r: 0.5 }, R);
  if (vm) {
    ctx.strokeStyle = era >= 4 ? 'rgba(14,116,144,0.8)' : 'rgba(60,14,6,0.75)'; ctx.lineWidth = Math.max(1.5, R * 0.035 * vm.cos);
    ctx.beginPath(); ctx.moveTo(vm.px - vm.radX, vm.py - vm.radY * 0.05);
    ctx.quadraticCurveTo(vm.px, vm.py + vm.radY * 0.18, vm.px + vm.radX, vm.py - vm.radY * 0.12); ctx.stroke();
  }
  const om = projectBlob({ lon: 0.9, lat: -0.42, r: 0.11 }, R);
  if (om) {
    const g = ctx.createRadialGradient(om.px - om.radX * 0.3, om.py - om.radY * 0.3, 0, om.px, om.py, om.radX);
    g.addColorStop(0, 'rgba(253,186,140,0.9)'); g.addColorStop(1, 'rgba(120,35,15,0.85)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(om.px, om.py, om.radX, om.radY, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(60,14,6,0.8)'; ctx.beginPath(); ctx.ellipse(om.px, om.py, om.radX * 0.3, om.radY * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  }
  // полярные шапки растут по мере терраформирования
  const cap = R * (0.2 + era * 0.05);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.ellipse(cx, cy - R * 0.97, cap, cap * 0.45, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, cy + R * 0.97, cap * 0.8, cap * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  if (era >= 5) { // леса
    MARS_BLOBS.forEach((b, i) => {
      const p = projectBlob({ ...b, lon: b.lon + 0.55 }, R);
      if (!p) return;
      ctx.fillStyle = 'rgba(21,128,61,0.8)';
      ctx.beginPath(); ctx.ellipse(p.px, p.py, p.radX * 0.55, p.radY * 0.4, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(74,222,128,0.5)';
      ctx.beginPath(); ctx.ellipse(p.px - p.radX * 0.1, p.py - p.radY * 0.08, p.radX * 0.3, p.radY * 0.2, 0.4, 0, Math.PI * 2); ctx.fill();
    });
  }
  if (era >= 6) { // огни столицы на Олимпе
    const om2 = projectBlob({ lon: 0.9, lat: -0.42, r: 0.11 }, R);
    if (om2) for (let k = 0; k < 9; k++) {
      ctx.fillStyle = `rgba(253,224,71,${0.6 + 0.4 * Math.sin(now / 300 + k)})`;
      ctx.fillRect(om2.px + Math.cos(k * 2.4) * om2.radX * 1.3, om2.py + Math.sin(k * 2.4) * om2.radY * 1.3, 2, 2);
    }
  }
  if (era >= 9) { ctx.fillStyle = 'rgba(125,211,252,0.12)'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
  if (era >= 4) drawClouds(R, era >= 9 ? 0.45 : 0.4);
  else drawClouds(R, 0.14 + era * 0.03, '234,120,70'); // пылевые бури
  if (era >= 1) drawLights(R, MARS_BLOBS, Math.min(4, era), '254,215,170');
}
function drawJupiter(R, era, now) {
  const bands = ['#fef3c7', '#d97706', '#fde68a', '#b45309', '#fef3c7', '#c2410c', '#fcd34d', '#92400e', '#fde68a', '#b45309', '#fef3c7'];
  const bh = (R * 2) / bands.length;
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    const wob = Math.sin(now / 1800 + i * 1.7) * 2;
    ctx.fillRect(cx - R, cy - R + i * bh + wob, R * 2, bh + 2);
  });
  // завихрения
  JUPITER_STORMS.forEach((s, i) => {
    const p = projectBlob({ ...s, r: s.r }, R, rotAngle * 1.6);
    if (!p) return;
    ctx.fillStyle = i % 2 ? 'rgba(255,251,235,0.55)' : 'rgba(120,53,15,0.45)';
    ctx.beginPath(); ctx.ellipse(p.px, p.py, p.radX * 1.6, p.radY * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  });
  // Большое красное пятно
  const grs = projectBlob({ lon: 1.2, lat: 0.32, r: 0.2 }, R, rotAngle * 1.6);
  if (grs) {
    ctx.fillStyle = '#b91c1c';
    ctx.beginPath(); ctx.ellipse(grs.px, grs.py, grs.radX * 1.3, grs.radY * 0.65, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(254,215,170,0.8)'; ctx.lineWidth = 2; ctx.stroke();
  }
  if (era >= 1) drawLights(R, JUPITER_STORMS.map(s => ({ ...s, r: 0.2 })), Math.min(4, era), '125,211,252');
  if (era >= 3) { // полярные сияния
    const t = 0.35 + 0.25 * Math.sin(now / 400);
    ctx.fillStyle = `rgba(167,139,250,${t})`;
    ctx.beginPath(); ctx.ellipse(cx, cy - R * 0.95, R * 0.5, R * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(52,211,153,${t * 0.8})`;
    ctx.beginPath(); ctx.ellipse(cx, cy + R * 0.95, R * 0.4, R * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (era >= 4 && Math.random() < 0.04) { // молнии
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
    const x = cx + (Math.random() - 0.5) * R, y = cy + (Math.random() - 0.5) * R;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6, y + 8); ctx.lineTo(x + 1, y + 10); ctx.lineTo(x + 8, y + 20); ctx.stroke();
  }
  if (era >= 6) drawLights(R, JUPITER_STORMS.map(s2 => ({ ...s2, lon: s2.lon + 0.8, r: 0.25 })), 4, '253,224,71'); // облачные города
  if (era >= 8) { // зажжённое ядро
    const t = 0.32 + 0.1 * Math.sin(now / 350);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, `rgba(253,186,116,${t + 0.3})`); g.addColorStop(0.55, `rgba(249,115,22,${t * 0.7})`); g.addColorStop(1, 'rgba(251,146,60,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  if (era >= 9) { ctx.fillStyle = `rgba(254,249,195,${0.28 + 0.06 * Math.sin(now / 500)})`; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
}

// шапки
function drawHat(R) {
  const id = state.look[cur()].hat;
  if (!id) return;
  const u = R / 100;
  ctx.save();
  ctx.translate(cx, cy - R);
  ctx.lineJoin = 'round';
  if (id === 'hat_crown') {
    ctx.fillStyle = '#facc15'; ctx.strokeStyle = '#a16207'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-28 * u, 6 * u); ctx.lineTo(-28 * u, -18 * u); ctx.lineTo(-14 * u, -6 * u);
    ctx.lineTo(0, -26 * u); ctx.lineTo(14 * u, -6 * u); ctx.lineTo(28 * u, -18 * u); ctx.lineTo(28 * u, 6 * u);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#dc2626';
    [[-18, -2], [0, -4], [18, -2]].forEach(([jx, jy]) => { ctx.beginPath(); ctx.arc(jx * u, jy * u, 3.2 * u, 0, Math.PI * 2); ctx.fill(); });
  } else if (id === 'hat_tophat') {
    ctx.fillStyle = '#111827'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5;
    ctx.fillRect(-22 * u, -42 * u, 44 * u, 42 * u); ctx.strokeRect(-22 * u, -42 * u, 44 * u, 42 * u);
    ctx.fillStyle = '#dc2626'; ctx.fillRect(-22 * u, -14 * u, 44 * u, 7 * u);
    ctx.fillStyle = '#111827';
    ctx.beginPath(); ctx.ellipse(0, 2 * u, 36 * u, 7 * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (id === 'hat_wizard') {
    ctx.fillStyle = '#6d28d9'; ctx.strokeStyle = '#4c1d95'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-30 * u, 4 * u); ctx.lineTo(30 * u, 4 * u); ctx.lineTo(8 * u, -62 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 4 * u, 42 * u, 8 * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fde047';
    ctx.beginPath(); ctx.arc(2 * u, -22 * u, 4 * u, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-8 * u, -8 * u, 2.5 * u, 0, Math.PI * 2); ctx.fill();
  } else if (id === 'hat_ufo') {
    ctx.translate(0, Math.sin(performance.now() / 400) * 3 * u);
    ctx.fillStyle = 'rgba(250, 204, 21, 0.22)';
    ctx.beginPath(); ctx.moveTo(-14 * u, -24 * u); ctx.lineTo(14 * u, -24 * u); ctx.lineTo(34 * u, 8 * u); ctx.lineTo(-34 * u, 8 * u); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(125, 211, 252, 0.85)';
    ctx.beginPath(); ctx.ellipse(0, -34 * u, 14 * u, 12 * u, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#94a3b8'; ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, -28 * u, 36 * u, 9 * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const blink = Math.floor(performance.now() / 250) % 3;
    [-20, 0, 20].forEach((lx, i) => { ctx.fillStyle = i === blink ? '#fde047' : '#f97316'; ctx.beginPath(); ctx.arc(lx * u, -27 * u, 2.4 * u, 0, Math.PI * 2); ctx.fill(); });
  } else if (id === 'hat_halo') {
    ctx.shadowColor = '#fde047'; ctx.shadowBlur = 14;
    ctx.strokeStyle = '#fde047'; ctx.lineWidth = Math.max(2.5, 5 * u);
    ctx.beginPath(); ctx.ellipse(0, -22 * u, 30 * u, 8 * u, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (id === 'hat_party') {
    ctx.fillStyle = '#ec4899'; ctx.strokeStyle = '#9d174d'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-20 * u, 6 * u); ctx.lineTo(20 * u, 6 * u); ctx.lineTo(0, -50 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.clip();
    ['#facc15', '#38bdf8', '#facc15'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(-30 * u, (-38 + i * 15) * u, 60 * u, 5 * u); });
    ctx.restore();
    ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(0, -52 * u, 6 * u, 0, Math.PI * 2); ctx.fill();
  } else if (id === 'hat_helmet') {
    ctx.fillStyle = 'rgba(186,230,253,0.28)'; ctx.strokeStyle = 'rgba(226,232,240,0.95)'; ctx.lineWidth = Math.max(2, 3 * u);
    ctx.beginPath(); ctx.arc(0, 30 * u, 62 * u, Math.PI * 1.1, Math.PI * 1.9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 4 * u, 46 * u, 9 * u, 0, 0, Math.PI * 2); ctx.fillStyle = '#e2e8f0'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.ellipse(-22 * u, -18 * u, 6 * u, 12 * u, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(18 * u, -24 * u); ctx.lineTo(28 * u, -52 * u); ctx.stroke();
    ctx.fillStyle = (Math.floor(performance.now() / 500) % 2) ? '#ef4444' : '#f87171';
    ctx.beginPath(); ctx.arc(28 * u, -54 * u, 4 * u, 0, Math.PI * 2); ctx.fill();
  } else if (id === 'hat_rings') {
    ctx.save(); ctx.rotate(-0.25);
    const g = ctx.createLinearGradient(-60 * u, 0, 60 * u, 0);
    g.addColorStop(0, 'rgba(253,230,138,0.2)'); g.addColorStop(0.5, 'rgba(253,230,138,1)'); g.addColorStop(1, 'rgba(253,230,138,0.2)');
    ctx.strokeStyle = g; ctx.lineWidth = Math.max(2, 4 * u);
    ctx.beginPath(); ctx.ellipse(0, -14 * u, 58 * u, 13 * u, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(216,180,254,0.8)'; ctx.lineWidth = Math.max(1.5, 2 * u);
    ctx.beginPath(); ctx.ellipse(0, -14 * u, 68 * u, 17 * u, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  } else if (id === 'hat_star') { // путеводная звезда парит и мерцает
    const t = performance.now();
    ctx.translate(0, -34 * u + Math.sin(t / 600) * 4 * u);
    ctx.rotate(Math.sin(t / 1400) * 0.25);
    ctx.shadowColor = '#fde047'; ctx.shadowBlur = 18 + 6 * Math.sin(t / 300);
    const g = ctx.createRadialGradient(0, -2 * u, 0, 0, 0, 22 * u);
    g.addColorStop(0, '#fffbeb'); g.addColorStop(0.5, '#fde047'); g.addColorStop(1, '#f59e0b');
    ctx.fillStyle = g; ctx.strokeStyle = '#b45309'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) { const r = (k % 2 ? 9 : 22) * u, a = -Math.PI / 2 + k * Math.PI / 5; k ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (id === 'hat_comet') { // огненный гребень, будто планета летит
    const t = performance.now();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 6; k++) {
      const x = (-30 + k * 12) * u, h = (34 + 14 * Math.sin(t / 140 + k * 1.7)) * u;
      const g = ctx.createLinearGradient(0, 8 * u, 0, -h);
      g.addColorStop(0, 'rgba(250,204,21,0.95)'); g.addColorStop(0.5, 'rgba(249,115,22,0.75)'); g.addColorStop(1, 'rgba(239,68,68,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x - 9 * u, 10 * u); ctx.quadraticCurveTo(x - 4 * u, -h * 0.5, x + 6 * u + Math.sin(t / 200 + k) * 4 * u, -h); ctx.quadraticCurveTo(x + 6 * u, -h * 0.4, x + 9 * u, 10 * u); ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

function drawMoons(R, front, now) {
  const pid = cur(), era = ps(pid).era;
  const list = [];
  if (pid === 'earth' && era >= 2) list.push({ a: moonAngle, s: 0.13, orbit: 1.7, tilt: 0.28, c: ['#f1f5f9', '#64748b'] });
  if (pid === 'mars') { list.push({ a: moonAngle * 2.3, s: 0.07, orbit: 1.45, tilt: 0.3, c: ['#d6d3d1', '#57534e'] }); list.push({ a: moonAngle * 1.1 + 2, s: 0.05, orbit: 1.75, tilt: 0.2, c: ['#e7e5e4', '#78716c'] }); }
  if (pid === 'jupiter') [[1.0, 0.06, 1.35], [0.7, 0.055, 1.55], [0.5, 0.07, 1.75], [0.3, 0.065, 1.95]].forEach(([sp, s, o], i) => list.push({ a: moonAngle * sp * 3 + i * 1.6, s, orbit: o, tilt: 0.12, c: [['#fde047', '#a16207'], ['#f1f5f9', '#94a3b8'], ['#d6d3d1', '#78716c'], ['#a8a29e', '#44403c']][i] }));
  list.forEach(m => {
    const depth = Math.sin(m.a);
    if ((depth > 0) !== front) return;
    const mr = R * m.s * (0.85 + 0.15 * depth);
    const orbit = Math.min(R * m.orbit, cw / 2 - mr - 6);
    const mx = cx + Math.cos(m.a) * orbit;
    const my = cy - R * 0.1 + depth * R * m.tilt;
    const g = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
    g.addColorStop(0, m.c[0]); g.addColorStop(1, m.c[1]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    if (pid === 'jupiter' && era >= 5) { // заводы на лунах
      ctx.fillStyle = `rgba(251,146,60,${0.7 + 0.3 * Math.sin(now / 200 + m.a)})`;
      ctx.fillRect(mx + mr * 0.15, my + mr * 0.1, Math.max(1.5, mr * 0.35), Math.max(1.5, mr * 0.35));
    }
  });
}

// ---------- Постройки на поверхности планеты ----------
// Каждая постройка получает до 3 «мест» на сфере: 1 значок с первой штуки, 2 — с 10, 3 — с 50.
const SURFACE_SLOTS = (() => {
  const N = 72, pts = [];
  for (let i = 0; i < N; i++) pts.push({ lat: Math.asin((1 - 2 * (i + 0.5) / N) * 0.8), lon: (i * 2.399963) % (Math.PI * 2) });
  let seed = 20261022;
  for (let i = N - 1; i > 0; i--) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const j = seed % (i + 1); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  return pts;
})();
const spriteCache = new Map();
function emojiSprite(icon) {
  let c = spriteCache.get(icon);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.font = '46px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(icon, 32, 35);
    spriteCache.set(icon, c);
  }
  return c;
}
function drawSurfaceBuildings(R, pid) {
  const counts = ps(pid).counts, items = [];
  PL(pid).buildings.forEach((b, bi) => {
    const c = counts[b.id] || 0;
    const marks = c <= 0 ? 0 : c < 10 ? 1 : c < 50 ? 2 : 3;
    for (let j = 0; j < marks; j++) {
      const sp = SURFACE_SLOTS[(bi * 3 + j) % SURFACE_SLOTS.length];
      let lon = (sp.lon + rotAngle) % (Math.PI * 2);
      if (lon > Math.PI) lon -= Math.PI * 2;
      const z = Math.cos(lon) * Math.cos(sp.lat);   // насколько место повёрнуто к нам
      if (z < 0.15) continue;
      items.push({ x: cx + Math.sin(lon) * Math.cos(sp.lat) * R, y: cy + Math.sin(sp.lat) * R, z, icon: b.icon });
    }
  });
  if (!items.length) return;
  items.sort((a, b) => a.z - b.z);
  const base = Math.max(12, R * 0.17);
  items.forEach(it => {
    const sz = base * (0.55 + 0.45 * it.z);
    // ночная сторона (справа снизу) — значки тусклее, у края диска — исчезают
    const night = Math.max(0, Math.min(1, ((it.x - cx) * 0.6 + (it.y - cy) * 0.5) / R + 0.25));
    ctx.globalAlpha = Math.min(1, (it.z - 0.15) / 0.25) * (1 - night * 0.55);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(it.x, it.y + sz * 0.38, sz * 0.42, sz * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(emojiSprite(it.icon), it.x - sz / 2, it.y - sz / 2, sz, sz);
  });
  ctx.globalAlpha = 1;
}

function renderFrame(now) {
  requestAnimationFrame(renderFrame);
  const dt = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  const f = dt * 60;
  ctx.setTransform(Math.min(window.devicePixelRatio || 1, 3), 0, 0, Math.min(window.devicePixelRatio || 1, 3), 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (shake > 0.2) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.88, f); } else shake = 0;

  // звёзды
  stars.forEach(st => {
    const x = ((st.x * cw + (now / 1000) * st.z * 5) % cw + cw) % cw;
    const a = st.a * (0.6 + 0.4 * Math.sin(now / 700 + st.tw));
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(x, st.y * ch, st.s * st.z + 0.3, st.s * st.z + 0.3);
  });
  if (!shoot && Math.random() < 0.0025 * f) shoot = { x: Math.random() * cw * 0.7, y: Math.random() * ch * 0.35, life: 1 };
  if (shoot) {
    const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - 46, shoot.y - 22);
    g.addColorStop(0, `rgba(255,255,255,${shoot.life})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x - 46, shoot.y - 22); ctx.stroke();
    shoot.x += 7 * f; shoot.y += 3.4 * f; shoot.life -= 0.025 * f;
    if (shoot.life <= 0) shoot = null;
  }

  const pid = cur(), era = ps(pid).era;
  const speed = speedMult();
  rotAngle = (rotAngle + 0.005 * speed * f) % (Math.PI * 2);
  cloudAngle = (cloudAngle + 0.008 * speed * f) % (Math.PI * 2);
  moonAngle = (moonAngle + 0.004 * speed * f) % (Math.PI * 2);
  pulseScale += (1.0 - pulseScale) * Math.min(1, 0.15 * f);
  const R = planetRadius * pulseScale;
  const halo = PL(pid).eras[era].halo;

  // атмосфера
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const ag = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.34);
  ag.addColorStop(0, halo + '70'); ag.addColorStop(0.5, halo + '24'); ag.addColorStop(1, 'transparent');
  ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(cx, cy, R * 1.34, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Всё, что вращается вокруг планеты, рисуется в два прохода: задняя половина орбиты — до шара (планета её закрывает),
  // передняя — после. Ближе к зрителю нижняя половина эллипса.
  const L = pid === 'earth' ? EARTH_LOOK[era] : null;
  const ringPart = (rx, ry, tilt, back, col, width, glow) => {
    ctx.strokeStyle = col; ctx.lineWidth = width;
    if (glow && !back) { ctx.shadowColor = glow; ctx.shadowBlur = 10; }
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, tilt, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI); ctx.stroke();
    ctx.shadowBlur = 0;
  };
  const rings = (back) => {
    if (L && L.ring) ringPart(R * 1.45, R * 0.32, -0.2, back, back ? 'rgba(253,224,71,0.35)' : 'rgba(253,224,71,0.85)', 2.5);
    if (L && L.oring) ringPart(R * 1.22, R * 0.2, 0.28, back, back ? 'rgba(125,211,252,0.3)' : 'rgba(125,211,252,0.9)', 2, '#7dd3fc');
    if (pid === 'jupiter' && era >= 4) ringPart(R * 1.55, R * 0.28, 0.15, back, back ? 'rgba(103,232,249,0.3)' : 'rgba(103,232,249,0.85)', 3, '#67e8f9');
    if (pid === 'mars' && era >= 8) { // кольцо Фобоса — из обломков
      ctx.setLineDash([2, 5]);
      ringPart(R * 1.42, R * 0.24, -0.15, back, back ? 'rgba(216,180,254,0.35)' : 'rgba(216,180,254,0.95)', 3);
      ctx.setLineDash([]);
    }
  };
  // мелкие спутники/корабли на эллиптических орбитах: front — только те, что ближе к нам
  const orbiters = (front) => {
    if (L && L.sats) for (let i = 0; i < L.sats; i++) {
      const a = rotAngle * (2 + i * 0.3) + i * (Math.PI * 2 / L.sats), sg = i % 2 ? 1 : -1;
      if ((Math.sin(a) * sg > 0) !== front) continue;
      const sx = cx + Math.cos(a) * R * 1.18, sy = cy + Math.sin(a) * R * 0.3 * sg;
      ctx.globalAlpha = front ? 1 : 0.55;
      ctx.fillStyle = '#e2e8f0'; ctx.fillRect(sx - 2, sy - 1, 4, 2);
      ctx.fillStyle = '#60a5fa'; ctx.fillRect(sx - 5, sy - 0.5, 2, 1); ctx.fillRect(sx + 3, sy - 0.5, 2, 1);
      ctx.globalAlpha = 1;
    }
    if (pid === 'jupiter' && era >= 7) for (let i = 0; i < 5; i++) { // корабли гравитационной пращи
      const a = rotAngle * (5 + i) + i * 1.3;
      if ((Math.sin(a) > 0) !== front) continue;
      const sx = cx + Math.cos(a) * R * 1.3, sy = cy + Math.sin(a) * R * 0.38;
      const tx = -Math.sin(a) * 9, ty = Math.cos(a) * 3;
      const g = ctx.createLinearGradient(sx, sy, sx - tx, sy - ty);
      g.addColorStop(0, 'rgba(186,230,253,0.95)'); g.addColorStop(1, 'rgba(186,230,253,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - tx, sy - ty); ctx.stroke();
    }
  };
  // спутник автокликера
  const autoLvl = perk('autoclicker');
  const satA = rotAngle * 2;
  autoSat.x = cx + Math.cos(satA) * R * 1.35; autoSat.y = cy + Math.sin(satA) * R * 0.45; autoSat.front = Math.sin(satA) > 0;
  const drawAutoSat = (front) => {
    if (!autoLvl) return;
    ctx.strokeStyle = front ? 'rgba(250,204,21,0.22)' : 'rgba(250,204,21,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.35, R * 0.45, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); ctx.stroke();
    if (autoSat.front !== front) return;
    const { x: sx, y: sy } = autoSat;
    ctx.globalAlpha = front ? 1 : 0.6;
    ctx.fillStyle = '#60a5fa'; ctx.fillRect(sx - 9, sy - 1.5, 5, 3); ctx.fillRect(sx + 4, sy - 1.5, 5, 3);   // панели
    ctx.fillStyle = '#facc15'; ctx.shadowColor = '#facc15'; ctx.shadowBlur = autoFx.flash > 0 ? 16 : 8;
    ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  };

  rings(true);
  orbiters(false);
  drawAutoSat(false);
  drawMoons(R, false, now);

  // шар планеты
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  if (pid === 'earth') drawEarth(R, era, now);
  else if (pid === 'mars') drawMars(R, era, now);
  else drawJupiter(R, era, now);

  const shade = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx + R * 0.2, cy + R * 0.2, R * 1.1);
  shade.addColorStop(0, 'rgba(255,255,255,0.18)'); shade.addColorStop(1, `rgba(0,0,0,${pid === 'jupiter' && era >= 9 ? 0.45 : 0.86})`);
  ctx.fillStyle = shade; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  if (!(pid === 'earth' && era === 0)) {
    const sx = cx - R * 0.42, sy = cy - R * 0.46;
    const sp = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.42);
    sp.addColorStop(0, 'rgba(255,255,255,0.32)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sp; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  drawSurfaceBuildings(R, pid);
  if (L && L.lights) drawLights(R, CONTINENT_BLOBS, L.lights);
  if (planetFlash > 0.01) { ctx.fillStyle = `rgba(248,113,113,${planetFlash * 0.5})`; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); planetFlash *= Math.pow(0.9, f); }
  if (evolveFx > 0.01) { ctx.fillStyle = `rgba(255,255,255,${evolveFx * 0.7})`; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
  ctx.restore();

  ctx.strokeStyle = halo + '99'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

  // Юпитер-звезда: корона
  if (pid === 'jupiter' && era >= 9) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const cg = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.7);
    cg.addColorStop(0, `rgba(254,240,138,${0.5 + 0.1 * Math.sin(now / 400)})`); cg.addColorStop(1, 'rgba(254,240,138,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, R * 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // Марс: космический лифт — трос от экватора к станции
  if (pid === 'mars' && era >= 7) {
    const ang = -0.55, x1 = cx + Math.cos(ang) * R, y1 = cy + Math.sin(ang) * R, x2 = cx + Math.cos(ang) * R * 1.85, y2 = cy + Math.sin(ang) * R * 1.85;
    ctx.strokeStyle = 'rgba(226,232,240,0.75)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const k = (now / 2500) % 1;
    ctx.fillStyle = '#fde047'; ctx.fillRect(x1 + (x2 - x1) * k - 1.5, y1 + (y2 - y1) * k - 1.5, 3, 3);
    ctx.fillStyle = '#cbd5e1'; ctx.fillRect(x2 - 4, y2 - 3, 8, 6);
  }
  // Земля: звёздные врата, колонии, маяк
  if (L && L.gate) {
    const gx = cx + R * 1.5, gy = cy - R * 0.62, gr = R * 0.26;
    ctx.save(); ctx.translate(gx, gy);
    ctx.strokeStyle = '#c4b5fd'; ctx.lineWidth = 3; ctx.shadowColor = '#a78bfa'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.ellipse(0, 0, gr * 0.55, gr, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    const sw = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
    sw.addColorStop(0, `rgba(237,233,254,${0.7 + 0.2 * Math.sin(now / 250)})`); sw.addColorStop(1, 'rgba(124,58,237,0.15)');
    ctx.fillStyle = sw; ctx.beginPath(); ctx.ellipse(0, 0, gr * 0.5, gr * 0.92, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (L && L.colonies) for (let k = 0; k < 8; k++) {
    const a = now / 9000 * (k % 2 ? 1 : -1) + k * 0.785, rr = R * (1.75 + (k % 3) * 0.12);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.55;
    ctx.fillStyle = ['#f472b6', '#facc15', '#5eead4', '#a78bfa'][k % 4];
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 300 + k);
    ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (L && L.beacon) {
    const bg = ctx.createLinearGradient(0, cy - R, 0, 0);
    bg.addColorStop(0, `rgba(254,240,138,${0.75 + 0.2 * Math.sin(now / 300)})`); bg.addColorStop(1, 'rgba(254,240,138,0)');
    ctx.fillStyle = bg; ctx.fillRect(cx - 2.5, 0, 5, cy - R);
  }

  rings(false);
  drawMoons(R, true, now);
  orbiters(true);
  drawHat(R);

  // волна новой эпохи
  if (evolveFx > 0.01) {
    const rr = R * (1.05 + (1 - evolveFx) * 1.6);
    ctx.strokeStyle = evolveColor; ctx.globalAlpha = evolveFx; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    evolveFx -= 0.012 * f;
  }

  // спутник автокликера (передний проход) и его выстрелы
  drawAutoSat(true);
  if (autoLvl) {
    if (laserBeamTimer > 0 && activeAsteroid) {
      ctx.strokeStyle = '#34d399'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(autoSat.x, autoSat.y); ctx.lineTo(activeAsteroid.x, activeAsteroid.y); ctx.stroke();
      laserBeamTimer--;
    }
    // видимые «тапы» автокликера по планете (не чаще ~8 раз в секунду, чтобы не мельтешило)
    if (autoFx.pending > 0 && now - autoFx.last > 120 && !activeAsteroid) {
      autoFx.pending = 0; autoFx.last = now; autoFx.flash = 1;
      const th = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * R * 0.8;
      const tx = cx + Math.cos(th) * rr, ty = cy + Math.sin(th) * rr;
      autoFx.beams.push({ x1: autoSat.x, y1: autoSat.y, x2: tx, y2: ty, life: 1, show: autoSat.front });
      ripples.push({ x: tx, y: ty, r: 3, life: 0.9, color: '#facc15', speed: 1.8, width: 1.5, decay: 0.06 });
      spawnParticles(tx, ty, '#fde047', 3, 2, 1.5);
    }
    autoFx.flash = Math.max(0, autoFx.flash - 0.1 * f);
    for (let i = autoFx.beams.length - 1; i >= 0; i--) {
      const b = autoFx.beams[i];
      b.life -= 0.12 * f;
      if (b.life <= 0) { autoFx.beams.splice(i, 1); continue; }
      if (!b.show) continue;
      ctx.strokeStyle = `rgba(253,224,71,${b.life * 0.85})`; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    }
  }

  // волны от тапов
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.r += (r.speed || 2.4) * f; r.life -= (r.decay || 0.05) * f;
    if (r.life <= 0) { ripples.splice(i, 1); continue; }
    ctx.globalAlpha = r.life; ctx.strokeStyle = r.color; ctx.lineWidth = r.width || 2;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // осколки
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.x += d.vx * f; d.y += d.vy * f; d.vy += 0.05 * f; d.rot += d.vr * f; d.life -= 0.018 * f;
    if (d.life <= 0) { debris.splice(i, 1); continue; }
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot); ctx.globalAlpha = Math.min(1, d.life * 1.5);
    ctx.fillStyle = d.color; ctx.beginPath();
    d.pts.forEach(([px, py], k) => k ? ctx.lineTo(px * d.s, py * d.s) : ctx.moveTo(px * d.s, py * d.s));
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * f; p.y += p.vy * f; p.life -= (p.decay || 0.04) * f;
    if (p.life <= 0) particles.splice(i, 1);
    else { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (p.shrink ? p.life : 1), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
  }

  if (activeAsteroid) updateAndDrawAsteroid(dt, f, now);
}

// ============================================================
//  АСТЕРОИДЫ
// ============================================================
function nextBossDelay() { return BOSS_MIN + Math.random() * (BOSS_MAX - BOSS_MIN); }
function endAsteroid(silent) {
  activeAsteroid = null;
  if (!silent) bossCooldown = nextBossDelay();
  $('bossAlertBanner').style.display = 'none';
}
function rockShape(n = 13, jitter = 0.32) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = 1 - jitter / 2 + Math.random() * jitter;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}
const ASTEROID_TINTS = {
  earth:   { light: '#a8a29e', mid: '#57534e', dark: '#1c1917', crater: 'rgba(28,25,23,0.55)', glow: '251,146,60', trail: ['#fde047', '#fb923c', '#ef4444'] },
  mars:    { light: '#fdba74', mid: '#9a3412', dark: '#2a0e05', crater: 'rgba(67,20,7,0.55)', glow: '249,115,22', trail: ['#fed7aa', '#f97316', '#b91c1c'] },
  jupiter: { light: '#e0f2fe', mid: '#7dd3fc', dark: '#0c4a6e', crater: 'rgba(12,74,110,0.45)', glow: '125,211,252', trail: ['#ffffff', '#bae6fd', '#38bdf8'] }
};
function spawnAsteroid() {
  if (activeAsteroid || !playing) return;
  const golden = Math.random() < GOLDEN_CHANCE;
  const hp = clickGain() * (golden ? 18 : 14);
  const fromLeft = Math.random() > 0.5;
  const sx = fromLeft ? 52 : cw - 52, sy = 108;   // ниже кнопок «Квесты» и «Магазин»
  activeAsteroid = {
    sx, sy, x: sx, y: sy, px: sx, py: sy,
    // контрольная точка кривой — полёт по дуге
    kx: (sx + cx) / 2 + (fromLeft ? -40 : 40), ky: sy + (cy - sy) * 0.15,
    r: golden ? 22 : 25, rot: 0, spin: (Math.random() - 0.5) * 0.08,
    hp, maxHp: hp, golden, pts: rockShape(), hitFx: 0, wob: 0,
    craters: [[-0.35, -0.2, 0.22], [0.3, 0.25, 0.17], [0.1, -0.45, 0.13], [-0.15, 0.4, 0.12]],
    cracks: [rockShape(5, 0.6), rockShape(5, 0.6)],
    gems: (1 + Math.floor(ps(cur()).era / 3) + PLANET_ORDER.indexOf(cur())) * (golden ? 3 : 1),
    progress: 0, totalTime: BOSS_FLIGHT
  };
  $('bossAlertBanner').classList.toggle('golden', golden);
  $('bossAlertText').innerText = golden ? '✨ ЗОЛОТОЙ АСТЕРОИД! ЖМИ!' : '☄️ АСТЕРОИД! ЖМИ НА НЕГО!';
  $('bossAlertBanner').style.display = 'flex';
  vibrate([40, 60, 40]);
  Sound.alarm();
}

function updateAndDrawAsteroid(dt, f, now) {
  const a = activeAsteroid;
  a.progress += dt / a.totalTime;
  const t = Math.min(1, a.progress), it = 1 - t;
  a.px = a.x; a.py = a.y;
  a.x = it * it * a.sx + 2 * it * t * a.kx + t * t * cx;
  a.y = it * it * a.sy + 2 * it * t * a.ky + t * t * cy;
  a.rot += a.spin * f;
  a.hitFx = Math.max(0, a.hitFx - 0.08 * f);
  const T = a.golden ? { light: '#fef9c3', mid: '#eab308', dark: '#713f12', crater: 'rgba(113,63,18,0.45)', glow: '250,204,21', trail: ['#ffffff', '#fde047', '#f59e0b'] } : ASTEROID_TINTS[cur()];

  // огненный хвост
  const vx = a.x - a.px, vy = a.y - a.py, vl = Math.hypot(vx, vy) || 1;
  for (let i = 0; i < 2; i++) {
    const back = a.r * (0.6 + Math.random() * 0.4);
    particles.push({
      x: a.x - vx / vl * back + (Math.random() - 0.5) * a.r * 0.8, y: a.y - vy / vl * back + (Math.random() - 0.5) * a.r * 0.8,
      vx: -vx / vl * (0.6 + Math.random()), vy: -vy / vl * (0.6 + Math.random()),
      r: 3 + Math.random() * 4, color: T.trail[Math.floor(Math.random() * 3)], life: 1, decay: 0.05, shrink: true
    });
  }
  const jx = a.hitFx > 0 ? (Math.random() - 0.5) * 6 * a.hitFx : 0, jy = a.hitFx > 0 ? (Math.random() - 0.5) * 6 * a.hitFx : 0;
  const X = a.x + jx, Y = a.y + jy;
  // свечение
  const glow = ctx.createRadialGradient(X, Y, a.r * 0.6, X, Y, a.r * 2.4);
  glow.addColorStop(0, `rgba(${T.glow},0.45)`); glow.addColorStop(1, `rgba(${T.glow},0)`);
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(X, Y, a.r * 2.4, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.translate(X, Y); ctx.rotate(a.rot);
  const path = () => { ctx.beginPath(); a.pts.forEach(([px, py], k) => k ? ctx.lineTo(px * a.r, py * a.r) : ctx.moveTo(px * a.r, py * a.r)); ctx.closePath(); };
  const body = ctx.createRadialGradient(-a.r * 0.35, -a.r * 0.35, a.r * 0.1, 0, 0, a.r * 1.1);
  body.addColorStop(0, T.light); body.addColorStop(0.55, T.mid); body.addColorStop(1, T.dark);
  path(); ctx.fillStyle = body; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(${T.glow},0.9)`; ctx.stroke();
  ctx.save(); path(); ctx.clip();
  a.craters.forEach(([kx, ky, kr]) => {
    ctx.fillStyle = T.crater;
    ctx.beginPath(); ctx.arc(kx * a.r, ky * a.r, kr * a.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(kx * a.r + 1, ky * a.r + 1, kr * a.r, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
  });
  // трещины по мере урона
  const dmg = 1 - a.hp / a.maxHp;
  if (dmg > 0.33) {
    ctx.strokeStyle = `rgba(253,186,116,${0.6 + 0.4 * Math.sin(now / 120)})`; ctx.lineWidth = 2; ctx.shadowColor = '#fb923c'; ctx.shadowBlur = 8;
    a.cracks.slice(0, dmg > 0.66 ? 2 : 1).forEach((cr, ci) => {
      ctx.beginPath(); ctx.moveTo(0, 0);
      cr.forEach(([px, py], k) => ctx.lineTo(px * a.r * (0.3 + k * 0.17) * (ci ? -1 : 1), py * a.r * (0.3 + k * 0.17)));
      ctx.stroke();
    });
    ctx.shadowBlur = 0;
  }
  if (a.golden) { ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.25 * Math.sin(now / 150)})`; ctx.fillRect(-a.r, -a.r, a.r * 2, a.r * 2); }
  if (a.hitFx > 0) { ctx.fillStyle = `rgba(255,255,255,${a.hitFx * 0.6})`; ctx.fillRect(-a.r, -a.r, a.r * 2, a.r * 2); }
  ctx.restore();
  ctx.restore();

  // полоска здоровья
  const bw = 80, bh = 7;
  const bx = Math.min(cw - bw - 6, Math.max(6, a.x - bw / 2)), by = a.y + a.r + 12;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx - 1, by - 1, bw + 2, bh + 2, 4) : ctx.rect(bx - 1, by - 1, bw + 2, bh + 2); ctx.fill();
  const hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  hg.addColorStop(0, a.golden ? '#fde047' : '#fb7185'); hg.addColorStop(1, a.golden ? '#f59e0b' : '#e11d48');
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw * Math.max(0, a.hp / a.maxHp), bh, 3) : ctx.rect(bx, by, bw * Math.max(0, a.hp / a.maxHp), bh); ctx.fill();

  $('bossTimerText').innerText = `${Math.max(0, a.totalTime * (1 - a.progress)).toFixed(1)}с`;
  if (a.progress >= 1.0) asteroidImpact();
}

function asteroidImpact() {
  const a = activeAsteroid;
  spawnParticles(a.x, a.y, '#fb923c', 30, 5, 4);
  spawnParticles(a.x, a.y, '#78716c', 20, 3, 3);
  ripples.push({ x: a.x, y: a.y, r: 10, life: 1, color: '#fb923c', speed: 4, width: 4, decay: 0.03 });
  shake = 14; planetFlash = 1;
  vibrate([80, 40, 80]);
  Sound.impact();
  endAsteroid();
}

function damageAsteroid(isAuto) {
  const a = activeAsteroid;
  if (!a) return;
  const crit = isAuto ? 1 : rollCrit();
  const dmg = clickGain() * crit;
  a.hp = Math.max(0, a.hp - dmg);
  a.hitFx = 1;
  spawnParticles(a.x, a.y, crit > 1 ? '#fb7185' : '#d6d3d1', crit > 1 ? 12 : 6, 3, 2);
  if (!isAuto) { vibrate(crit > 1 ? 25 : 10); showFloat(a.x - 10, a.y - 30, `−${fmt(dmg)}`, crit > 1 ? 'crit' : ''); Sound.hit(crit > 1); }
  if (a.hp <= 0) destroyAsteroid();
}

function destroyAsteroid() {
  const a = activeAsteroid;
  const pid = cur();
  const T = a.golden ? '#fde047' : ASTEROID_TINTS[pid].mid;
  // осколки
  for (let i = 0; i < 12; i++) {
    const ang = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 4;
    debris.push({ x: a.x, y: a.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, s: 4 + Math.random() * 7, pts: rockShape(6, 0.5), color: T, life: 1 });
  }
  spawnParticles(a.x, a.y, '#fde047', 25, 6, 3);
  spawnParticles(a.x, a.y, a.golden ? '#ffffff' : '#c084fc', 20, 4, 3);
  ripples.push({ x: a.x, y: a.y, r: 6, life: 1, color: '#ffffff', speed: 5, width: 5, decay: 0.04 });
  ripples.push({ x: a.x, y: a.y, r: 2, life: 1, color: '#fb923c', speed: 3.2, width: 3, decay: 0.035 });
  shake = 6;
  const gems = a.gems;
  stat('asteroids'); if (a.golden) stat('golden');
  const res = PL(pid).clickRes;
  const bonus = Math.max(clickGain() * 40, Math.ceil(rates(pid)[res] * 45));
  state.gems += gems;
  ps(pid).res[res] += bonus;
  flyIcons(a.x, a.y, '💎', Math.min(8, gems + 2));
  showToast(`${a.golden ? '✨ Золотой астероид' : '☄️ Астероид'} уничтожен! +${gems} 💎, +${fmt(bonus)} ${RES[res].icon}`, 3000);
  vibrate(60);
  Sound.explode();
  endAsteroid();
  renderAll();
  queueSync(2500);
}

// летящие к шапке значки награды
function flyIcons(x, y, icon, n) {
  const vp = $('viewport').getBoundingClientRect();
  flyAbs(vp.left + x, vp.top + y, icon, n, document.querySelector('.res-gems'));
}
// значки летят из точки (px, py) экрана к элементу target
function flyAbs(px, py, icon, n, target) {
  if (!target) return;
  const tr = target.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'fly-icon';
    el.textContent = icon;
    el.style.left = px + 'px';
    el.style.top = py + 'px';
    el.style.setProperty('--dx', (tr.left + tr.width / 2 - px + (Math.random() - 0.5) * 20) + 'px');
    el.style.setProperty('--dy', (tr.top + tr.height / 2 - py) + 'px');
    el.style.animationDelay = (i * 60) + 'ms';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200 + i * 60);
  }
  setTimeout(() => { target.classList.remove('pop'); void target.offsetWidth; target.classList.add('pop'); }, 700);
}

// ============================================================
//  ДЕЙСТВИЯ ИГРОКА
// ============================================================
function showFloat(x, y, text, cls) {
  const el = document.createElement('div');
  el.className = 'floating-text' + (cls ? ' ' + cls : '');
  el.innerText = text;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  $('viewport').appendChild(el);
  setTimeout(() => el.remove(), 800);
}

function handlePlanetClick(mx, my) {
  const pid = cur();
  const crit = rollCrit();
  const gain = clickGain(pid) * crit;
  const res = PL(pid).clickRes;
  ps(pid).res[res] += gain;
  pulseScale = 0.94;
  ripples.push({ x: mx, y: my, r: 6, life: 1, color: crit > 1 ? '#fb7185' : '#7dd3fc' });
  spawnParticles(mx, my, crit > 1 ? '#fb7185' : PL(pid).eras[ps(pid).era].halo, crit > 1 ? 12 : 5);
  if (crit > 1) vibrate(20);
  Sound.tap(crit > 1);
  showFloat(mx - 24, my - 28, `+${fmt(gain)} ${RES[res].icon}${crit > 1 ? ' КРИТ!' : ''}`, crit > 1 ? 'crit' : '');
  stat('taps');
  refreshUI();
}

function markBought(sel, text) {
  requestAnimationFrame(() => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.classList.remove('bought'); void el.offsetWidth; el.classList.add('bought');
    if (text) {
      const btn = el.querySelector('.btn-buy') || el;
      const r = btn.getBoundingClientRect();
      const f = document.createElement('div');
      f.className = 'buy-float'; f.textContent = text;
      f.style.left = (r.left + r.width / 2) + 'px'; f.style.top = (r.top) + 'px';
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 900);
    }
  });
}

function buyBuilding(id) {
  const pid = cur();
  const b = PL(pid).buildings.find(x => x.id === id);
  if (!b || b.u > ps(pid).era) return;
  const n = buyCount(pid, b);
  const cost = bulkCost(pid, b, n);
  if (!canPay(cost)) { Sound.error(); return; }
  pay(cost);
  ps(pid).counts[id] = (ps(pid).counts[id] || 0) + n;
  stat('built', n);
  vibrate(n > 1 ? 18 : 8); Sound.buy();
  if (n > 1) spawnParticles(cx, cy, PL(pid).eras[ps(pid).era].halo, Math.min(30, 6 + n / 4), 4, 3);
  renderAll();
  markBought(`[data-card="${id}"]`, '+' + n);
  saveLocal();
}
function setBuyMode(m) {
  m = m === 'max' ? 'max' : (BUY_MODES.includes(+m) ? +m : 1);
  if (ui.buyMode === m) return;
  ui.buyMode = m;
  try { localStorage.setItem('terra_buy_mode', String(m)); } catch (e) {}
  Sound.ui();
  renderPanel();
}
function buyPerk(id) {
  const p = GLOBAL_PERKS.find(x => x.id === id);
  if (!p) return;
  const lvl = perk(id);
  if (lvl >= p.max) return;
  const cost = perkCost(p, lvl);
  if (state.gems < cost) { Sound.error(); return; }
  state.gems -= cost;
  state.perks[id] = lvl + 1;
  stat('perks');
  spawnParticles(cx, cy, '#c084fc', 20);
  Sound.unlock();
  renderAll(); markBought(`[data-card="perk-${id}"]`, '⬆');
  saveLocal(); queueSync();
}
function buyPlanetPerk(id) {
  const pid = cur();
  const p = PL(pid).perks.find(x => x.id === id);
  if (!p) return;
  const lvl = ppk(pid, id);
  if (lvl >= p.max) return;
  const cost = perkCost(p, lvl);
  if (state.gems < cost) { Sound.error(); return; }
  state.gems -= cost;
  state.ppk[pid][id] = lvl + 1;
  stat('perks');
  spawnParticles(cx, cy, PL(pid).eras[ps(pid).era].halo, 20);
  Sound.unlock();
  renderAll(); markBought(`[data-card="pp-${id}"]`, '⬆');
  saveLocal(); queueSync();
}

function evolveEra() {
  const pid = cur();
  const cost = eraCost(pid);
  if (!cost || !canPay(cost)) { Sound.error(); return; }
  const couldPrestige = canPrestige(pid);
  pay(cost);
  ps(pid).era++;
  const era = ps(pid).era;
  stat('evolves');
  state.stats.maxEra[pid] = Math.max(state.stats.maxEra[pid] || 0, era);
  const E = PL(pid).eras[era];
  evolveFx = 1; evolveColor = E.halo; pulseScale = 1.12;
  spawnParticles(cx, cy, E.halo, 40, 6, 4);
  vibrate([30, 40, 30]);
  Sound.evolve();
  const unlocks = PL(pid).buildings.filter(b => b.u === era);
  showCinema({
    kicker: pid === 'earth' ? 'Новая эпоха' : `${PL(pid).name} · новый этап`,
    big: String(era + 1), title: E.name, desc: E.desc, color: E.halo,
    chips: unlocks.map(b => `${b.icon} ${b.name}`),
    extra: (pid === 'earth' && PLANETS.mars.unlock.earthEra === era && !isUnlocked('mars')) ? '🚀 Открыта экспедиция на Марс — загляните на карту!'
         : (!couldPrestige && canPrestige(pid)) ? `🌀 Цели престижа выполнены — раздел «Престиж» (${PL(pid).name})` : ''
  });
  renderAll(); saveLocal(); queueSync(800);
}

async function performPrestige() {
  const pid = cur(), info = prestigeInfo(pid), P = PL(pid);
  if (!info.ready) return;
  const next = prestigeGoals(pid, info.n + 1).map(g => g.kind === 'stage' ? `${P.stageWord.toLowerCase()} ${g.need + 1}` : g.kind === 'build' ? `${fmt(g.need)} построек` : `${fmt(g.need)} ${RES[g.res].icon}`).join(', ');
  const ok = await askConfirm({
    title: `🌀 Престиж: ${P.name}`,
    text: `Ресурсы, постройки и ${P.stageWord === 'Эпоха' ? 'эпохи' : 'этапы'} планеты «${P.name}» сбросятся. Другие планеты, кристаллы, сапфиры и образ не тронутся.\n\nНаграда: +${info.gems} 💎, доход и тап на этой планете ×${info.nextMult}.\n\nСледующий престиж потребует больше: ${next}.`,
    ok: 'Совершить престиж'
  });
  if (!ok || !canPrestige(pid)) return;
  state.gems += info.gems;
  state.ppr[pid] = info.n + 1;
  state.rebirths = totalPrestige();
  state.stats.maxEra[pid] = Math.max(state.stats.maxEra[pid] || 0, ps(pid).era);
  state.planets[pid] = defaultPlanet(pid);
  const starter = perk('starter_pack') * 300;
  P.res.slice(0, 3).forEach(r => ps(pid).res[r] += starter);
  endAsteroid();
  evolveFx = 1; evolveColor = '#c084fc';
  spawnParticles(cx, cy, '#c084fc', 50, 7, 4);
  vibrate([40, 60, 40]);
  Sound.rebirth();
  const goals = prestigeInfo(pid).goals;
  showCinema({ kicker: `${P.name} · престиж №${state.ppr[pid]}`, big: '🌀', title: `Доход ×${planetMult(pid)}`,
    desc: `Планета начала путь заново, но стала сильнее. +${info.gems} 💎 на перки.`, color: '#c084fc', chips: [],
    extra: 'Следующая цель: ' + goals.map(g => g.kind === 'stage' ? `${P.stageWord.toLowerCase()} ${g.need + 1}` : g.kind === 'build' ? `${fmt(g.need)} построек` : `${fmt(g.need)} ${RES[g.res].icon}`).join(', ') });
  onPlanetChanged(); saveLocal(); queueSync(500);
}

function handleCosmetic(id) {
  const item = COSMETICS.find(x => x.id === id);
  if (!item) return;
  const pid = cur();
  if (!state.ownedCosmetics.includes(id)) {
    if (item.code || item.chest || (item.planet && !isUnlocked(item.planet))) { Sound.error(); return; }
    if (!canPay(item.cost)) { Sound.error(); return; }
    pay(item.cost);
    state.ownedCosmetics.push(id);
    Sound.coin();
    showToast(`${item.icon} «${item.name}» — ваше!`, 2200);
  } else Sound.ui();
  const look = state.look[pid];
  if (item.type === 'hat') look.hat = (look.hat === id) ? null : id;
  if (item.type === 'bg') look.bg = (look.bg === id) ? null : id;
  applyBodyBg();
  if (item.type === 'hat' && look.hat) { pulseScale = 1.08; spawnParticles(cx, cy - planetRadius, '#fde047', 14); }
  renderAll(); markBought(`[data-card="c-${id}"]`);
  saveLocal(); queueSync();
}

function launchExpedition(pid) {
  const info = unlockInfo(pid);
  if (isUnlocked(pid) || !info.ready) { Sound.error(); return; }
  pay(info.cost);
  state.unlocked.push(pid);
  saveLocal(); queueSync(500);
  Sound.unlock();
  closeMap();
  travelTo(pid, true);
}

// ============================================================
//  КВЕСТЫ И САПФИРЫ
// ============================================================
function stat(k, n = 1) { state.stats[k] = (state.stats[k] || 0) + n; }
function dayKey(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function questAvailable(q) {
  if (q.need === 'planets') return state.unlocked.length > 1;
  if (q.need === 'gems') return state.gems > 0 || totalPrestige() > 0;
  if (q.need === 'evolve') return PLANET_ORDER.some(pid => isUnlocked(pid) && ps(pid).era < PL(pid).eras.length - 1);
  return true;
}
// Новый день — новые задания; выбор фиксируется до полуночи
function ensureQuestDay() {
  const today = dayKey(), Q = state.quests;
  if (Q.day === today && Q.list.length) return false;
  let seed = hashStr(today + '|' + (currentUid() || ''));
  const pool = DAILY_QUESTS.filter(questAvailable), list = [];
  while (list.length < DAILY_COUNT && pool.length) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const q = pool.splice(seed % pool.length, 1)[0];
    if (list.some(id => DAILY_QUESTS.find(x => x.id === id).stat === q.stat)) continue; // два задания на одно и то же — скучно
    list.push(q.id);
  }
  const base = {};
  STAT_KEYS.forEach(k => base[k] = state.stats[k] || 0);
  state.quests = { ...Q, day: today, list, base, claimed: [], bonus: false };
  return true;
}
function dailyProgress(q) {
  const B = state.quests.base;
  if (q.stat === 'minutes') return Math.floor(((state.stats.playSec || 0) - (B.playSec || 0)) / 60);
  return Math.floor((state.stats[q.stat] || 0) - (B[q.stat] || 0));
}
function achValue(a) {
  if (a.kind === 'stat') return state.stats[a.key] || 0;
  if (a.kind === 'era') return isUnlocked(a.key) ? Math.max(state.stats.maxEra[a.key] || 0, ps(a.key).era) + 1 : 0;
  if (a.kind === 'rebirths') return totalPrestige();
  if (a.kind === 'planet') return isUnlocked(a.key) ? 1 : 0;
  if (a.kind === 'style') return state.ownedCosmetics.length;
  return 0;
}
function questState() {
  ensureQuestDay();
  const Q = state.quests;
  const daily = Q.list.map(id => DAILY_QUESTS.find(q => q.id === id)).filter(Boolean).map(q => {
    const p = Math.max(0, Math.min(q.n, dailyProgress(q)));
    return { q, p, done: p >= q.n, claimed: Q.claimed.includes(q.id) };
  });
  const ach = ACHIEVEMENTS.map(a => { const v = achValue(a); return { a, v: Math.min(a.goal, v), done: v >= a.goal, claimed: Q.ach.includes(a.id) }; });
  const allDone = daily.length > 0 && daily.every(d => d.claimed);
  return { daily, ach, bonusReady: allDone && !Q.bonus, bonusClaimed: Q.bonus, dailyClaimed: daily.filter(d => d.claimed).length };
}
function claimableCount(Q = questState()) {
  return Q.daily.filter(d => d.done && !d.claimed).length + (Q.bonusReady ? 1 : 0) + Q.ach.filter(x => x.done && !x.claimed).length;
}
function updateQuestBadge() {
  const n = claimableCount();
  if (updateQuestBadge.n === n) return;
  updateQuestBadge.n = n;
  const b = $('questBadge');
  b.hidden = n === 0; b.textContent = n;
  $('questBtn').classList.toggle('glow', n > 0);
}
function claimQuest(kind, id, btn) {
  const Q = questState();
  let reward = 0;
  if (kind === 'daily') {
    const d = Q.daily.find(x => x.q.id === id);
    if (!d || !d.done || d.claimed) return;
    state.quests.claimed.push(id); reward = d.q.reward;
  } else if (kind === 'bonus') {
    if (!Q.bonusReady) return;
    state.quests.bonus = true; reward = DAILY_BONUS;
  } else {
    const x = Q.ach.find(y => y.a.id === id);
    if (!x || !x.done || x.claimed) return;
    state.quests.ach.push(id); reward = x.a.reward;
  }
  state.sapphires += reward;
  Sound.coin(); vibrate(20);
  if (btn) { const r = btn.getBoundingClientRect(); flyAbs(r.left + r.width / 2, r.top + r.height / 2, '🔷', Math.min(6, reward + 2), $('qWallet')); }
  setTimeout(() => { const w = $('qWallet'); w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop'); }, 650);
  renderQuests(); renderHeaderAndEra(); updateQuestBadge();
  saveLocal(); queueSync(1500);
}
function openQuests() { if (!playing) return; renderQuests(); $('questsOverlay').classList.add('open'); $('questsBody').scrollTop = 0; Sound.ui(); }
function questRow(kind, id, icon, title, sub, p, goal, reward, done, claimed, i) {
  const pct = Math.round(Math.min(1, p / goal) * 100);
  const btn = claimed ? `<div class="q-claimed">✓</div>`
    : done ? `<button class="q-claim" data-qkind="${kind}" data-qid="${id}" type="button">Забрать<span>+${reward} 🔷</span></button>`
    : `<div class="q-reward">${reward} 🔷</div>`;
  return `<div class="q-row ${done && !claimed ? 'ready' : ''} ${claimed ? 'claimed' : ''}" style="--i:${i}">
    <div class="q-ico">${icon}</div>
    <div class="q-info"><div class="q-title">${esc(title)}</div>${sub ? `<div class="q-desc">${esc(sub)}</div>` : ''}
      <div class="q-bar"><i style="width:${pct}%"></i></div><div class="q-prog">${fmt(Math.min(p, goal))} / ${fmt(goal)}</div></div>
    ${btn}</div>`;
}
function renderQuests() {
  const Q = questState();
  $('qSapph').textContent = fmt(state.sapphires);
  const now = new Date(), mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let i = 0, html = `<div class="q-section"><span>📅 Задания дня</span><span class="q-timer">новые через ${fmtTime((mid - now) / 1000)}</span></div>`;
  html += Q.daily.map(d => questRow('daily', d.q.id, d.q.icon, d.q.text.replace('{n}', fmt(d.q.n)), '', d.p, d.q.n, d.q.reward, d.done, d.claimed, i++)).join('');
  html += questRow('bonus', 'bonus', '🎁', 'Выполните все задания дня', 'Бонус за полный день', Q.dailyClaimed, Q.daily.length || DAILY_COUNT, DAILY_BONUS, Q.bonusReady || Q.bonusClaimed, Q.bonusClaimed, i++);
  const ach = Q.ach.slice().sort((x, y) => {
    const rank = (z) => z.claimed ? 2 : z.done ? 0 : 1;
    return rank(x) - rank(y) || (y.v / y.a.goal) - (x.v / x.a.goal);
  });
  html += `<div class="q-section"><span>🏅 Достижения</span><span class="q-timer">${Q.ach.filter(x => x.claimed).length} / ${ACHIEVEMENTS.length}</span></div>`;
  html += ach.map(x => questRow('ach', x.a.id, x.a.icon, x.a.name, x.a.desc, x.v, x.a.goal, x.a.reward, x.done, x.claimed, i++)).join('');
  $('questsBody').innerHTML = html;
}
// ---------- Магазин и сундуки ----------
function openShop() {
  if (!playing) return;
  renderShop();
  $('shopOverlay').classList.add('open');
  Sound.ui();
}
function renderShop() {
  $('shopSapph').textContent = fmt(state.sapphires);
  const left = boostLeft();
  $('shopBoost').hidden = !left;
  if (left) $('shopBoost').textContent = `⚡ Ускоритель ×2 активен: ещё ${fmtCountdown(left / 1000)}`;
  const chestItems = COSMETICS.filter(c => c.chest);
  const owned = chestItems.filter(c => state.ownedCosmetics.includes(c.id)).length;
  $('chestList').innerHTML = CHESTS.map((c, i) => `
    <div class="chest-card" style="--c:${c.color};--i:${i}">
      <div class="chest-ico">${c.icon}</div>
      <div class="chest-info">
        <div class="chest-name">${c.name}</div>
        <div class="chest-desc">${c.desc}</div>
        <div class="chest-odds">💎 ${c.gems[0]}–${c.gems[1]} · ресурсы за ${c.resMin} мин${c.boostChance >= 1 ? ` · ⚡×2 на ${c.boostMin} мин` : ` · ⚡ ${Math.round(c.boostChance * 100)}%`} · 👑 ${c.itemChance >= 1 ? 'точно' : Math.round(c.itemChance * 100) + '%'}</div>
      </div>
      <button class="chest-buy" data-chest="${c.id}" type="button" ${state.sapphires >= c.price ? '' : 'disabled'}>Открыть<span>${c.price} 🔷</span></button>
    </div>`).join('');
  $('chestNote').textContent = `Редкие образы из сундуков: собрано ${owned} из ${chestItems.length}`;
}
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// Содержимое сундука: кристаллы, ресурсы текущей планеты (доход за N минут), ускоритель ×2, редкий образ
function rollChest(c) {
  const pid = cur(), r = rates(pid), out = { gems: randInt(c.gems[0], c.gems[1]), res: {}, boostMin: 0, item: null };
  PL(pid).res.forEach(k => {
    let v = (r[k] || 0) * 60 * c.resMin;
    if (k === PL(pid).clickRes) v = Math.max(v, clickGain(pid) * 3 * 60 * c.resMin);
    if (v >= 1) out.res[k] = Math.floor(v);
  });
  if (Math.random() < c.boostChance) out.boostMin = c.boostMin;
  if (Math.random() < c.itemChance) {
    const pool = COSMETICS.filter(x => x.chest && !state.ownedCosmetics.includes(x.id));
    if (pool.length) out.item = pool[Math.floor(Math.random() * pool.length)].id;
    else out.gems += Math.round(c.price * 0.6);   // всё собрано — компенсация кристаллами
  }
  return out;
}
let chestPending = null;
function openChest(id) {
  const c = CHESTS.find(x => x.id === id);
  if (!c || !playing || chestPending) return;
  if (state.sapphires < c.price) { Sound.error(); return; }
  state.sapphires -= c.price;
  const rw = rollChest(c);
  state.gems += rw.gems;
  for (const k in rw.res) ps(cur()).res[k] += rw.res[k];
  if (rw.boostMin) state.boostUntil = Math.min(Date.now() + 6 * 3600000, Math.max(Date.now(), state.boostUntil || 0) + rw.boostMin * 60000);
  if (rw.item) state.ownedCosmetics.push(rw.item);
  stat('chests');
  saveLocal(); queueSync(800);
  chestPending = { c, rw };
  // анимация: сундук трясётся, затем раскрывается
  const ov = $('chestOverlay');
  ov.style.setProperty('--c', c.color);
  $('chestBig').textContent = c.icon;
  $('chestTitle').textContent = c.name;
  $('chestRewards').innerHTML = '';
  $('chestTake').hidden = true;
  ov.classList.remove('opened');
  $('shopOverlay').classList.remove('open');
  ov.classList.add('open');
  Sound.ui();
  setTimeout(revealChest, 1100);
}
function revealChest() {
  if (!chestPending) return;
  const { c, rw } = chestPending;
  const ov = $('chestOverlay');
  if (ov.classList.contains('opened')) return;
  ov.classList.add('opened');
  Sound.unlock(); vibrate([30, 40, 60]);
  const items = [`<div class="cr-item"><span>💎</span><b>+${fmt(rw.gems)}</b><i>кристаллов</i></div>`];
  for (const k in rw.res) items.push(`<div class="cr-item"><span>${RES[k].icon}</span><b>+${fmt(rw.res[k])}</b><i>${RES[k].name.toLowerCase()}</i></div>`);
  if (rw.boostMin) items.push(`<div class="cr-item boost"><span>⚡</span><b>×2</b><i>доход и тап ${rw.boostMin} мин</i></div>`);
  if (rw.item) { const it = COSMETICS.find(x => x.id === rw.item); items.push(`<div class="cr-item rare"><span>${it.icon}</span><b>${it.name}</b><i>редкий ${it.type === 'hat' ? 'головной убор' : 'фон'}!</i></div>`); }
  $('chestRewards').innerHTML = items.map((h, i) => h.replace('class="cr-item', `style="--i:${i}" class="cr-item`)).join('');
  setTimeout(() => { $('chestTake').hidden = false; }, 500);
}
function closeChest() {
  $('chestOverlay').classList.remove('open', 'opened');
  const had = chestPending;
  chestPending = null;
  renderAll();
  if (had) { renderShop(); $('shopOverlay').classList.add('open'); }
}

// ============================================================
//  АНИМАЦИИ: КИНЕМАТОГРАФ И ПЕРЕЛЁТ
// ============================================================
const cinemaQueue = [];
let cinemaOpen = false, cinemaShownAt = 0;
function showCinema(c) {
  if (cinemaOpen) { cinemaQueue.push(c); return; }
  cinemaOpen = true; cinemaShownAt = performance.now();
  const el = $('cinema');
  el.style.setProperty('--halo', c.color || '#7dd3fc');
  $('cineKicker').textContent = c.kicker || '';
  $('cineNum').textContent = c.big || '';
  $('cineTitle').textContent = c.title || '';
  $('cineDesc').textContent = c.desc || '';
  $('cineExtra').textContent = c.extra || '';
  $('cineExtra').hidden = !c.extra;
  $('cineUnlocks').innerHTML = (c.chips || []).length
    ? `<div class="cine-unl-title">Открыто</div>` + c.chips.map((t, i) => `<span class="cine-chip" style="--i:${i}">${esc(t)}</span>`).join('') : '';
  const burst = $('cineBurst');
  burst.innerHTML = '';
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('i');
    s.style.setProperty('--a', (i / 28 * 360 + Math.random() * 10) + 'deg');
    s.style.setProperty('--d', (90 + Math.random() * 120) + 'px');
    s.style.animationDelay = (Math.random() * 0.25) + 's';
    burst.appendChild(s);
  }
  el.classList.remove('open'); void el.offsetWidth;
  el.classList.add('open');
}
function closeCinema() {
  if (!cinemaOpen || performance.now() - cinemaShownAt < 700) return;
  $('cinema').classList.remove('open');
  cinemaOpen = false;
  Sound.ui();
  if (cinemaQueue.length) setTimeout(() => showCinema(cinemaQueue.shift()), 250);
}

let traveling = false;
function travelTo(pid, firstTime) {
  if (traveling || !isUnlocked(pid)) return;
  if (pid === cur() && !firstTime) { closeMap(); return; }
  traveling = true;
  const tv = $('travel');
  $('travelText').textContent = `Курс на ${PL(pid).name === 'Земля' ? 'Землю' : PL(pid).name}…`;
  $('travelIcon').textContent = PL(pid).icon;
  tv.classList.remove('open'); void tv.offsetWidth;
  tv.classList.add('open');
  Sound.travel();
  closeMap();
  if (!firstTime) stat('travels');
  setTimeout(() => {
    state.planet = pid;
    endAsteroid(true);
    ui.tab = 'a';
    onPlanetChanged();
    pulseScale = 0.6;
    saveLocal();
  }, 750);
  setTimeout(() => {
    tv.classList.remove('open');
    traveling = false;
    if (firstTime) {
      const E = PL(pid).eras[0];
      showCinema({ kicker: 'Новая планета', big: PL(pid).icon, title: PL(pid).name, desc: E.desc, color: E.halo,
        chips: PL(pid).res.map(r => `${RES[r].icon} ${RES[r].name}`),
        extra: 'У планеты свои ресурсы, постройки, перки и косметика. Все открытые планеты производят ресурсы одновременно.' });
    }
  }, 1500);
}

// ============================================================
//  КАРТА СОЛНЕЧНОЙ СИСТЕМЫ
// ============================================================
const MAP_ORBITS = [
  { id: 'mercury', r: 13, size: 3,   dur: 40,  color: 'radial-gradient(circle at 35% 30%, #d6d3d1, #57534e)', decor: true },
  { id: 'venus',   r: 20, size: 4.6, dur: 70,  color: 'radial-gradient(circle at 35% 30%, #fef3c7, #d97706)', decor: true },
  { id: 'earth',   r: 28, size: 6,   dur: 110, color: 'radial-gradient(circle at 35% 30%, #7dd3fc 0 20%, #16a34a 21% 32%, #0369a1 33% 60%, #082f49)' },
  { id: 'mars',    r: 36, size: 5,   dur: 170, color: 'radial-gradient(circle at 35% 30%, #fdba74, #c2410c 60%, #431407)' },
  { id: 'belt',    r: 42, belt: true },
  { id: 'jupiter', r: 48, size: 10,  dur: 300, color: 'linear-gradient(180deg, #fef3c7 0 14%, #d97706 14% 26%, #fde68a 26% 40%, #b45309 40% 52%, #fef3c7 52% 66%, #c2410c 66% 78%, #fcd34d 78%)' }
];
function buildMap() {
  const sys = $('system');
  let html = '<div class="sun"></div>';
  MAP_ORBITS.forEach((o, i) => {
    if (o.belt) { html += `<div class="orbit belt" style="--r:${o.r}"></div>`; return; }
    const start = -((i * 137) % 360) / 360 * o.dur;
    html += `<div class="orbit" style="--r:${o.r}"></div>
      <div class="arm" style="--r:${o.r};--dur:${o.dur}s;animation-delay:${start}s">
        ${o.decor
          ? `<span class="pl decor" style="--s:${o.size};background:${o.color};--dur:${o.dur}s;animation-delay:${start}s"></span>`
          : `<button class="pl" type="button" data-planet="${o.id}" style="--s:${o.size};--dur:${o.dur}s;animation-delay:${start}s"><span class="pl-ball" style="background:${o.color}"></span><span class="pl-lock">🔒</span><span class="pl-name">${PL(o.id).name}</span></button>`}
      </div>`;
  });
  sys.innerHTML = html;
}
function openMap() {
  if (!playing) return;
  ui.mapSel = ui.mapSel || cur();
  renderMap();
  $('mapOverlay').classList.add('open');
  Sound.ui();
}
function closeMap() { $('mapOverlay').classList.remove('open'); }
// подпись состояния карты: перерисовываем, только когда что-то реально изменилось
function mapSig() {
  return state.unlocked.join() + ui.mapSel + cur() + costSig(unlockInfo(ui.mapSel).cost || {})
    + Object.values(rates(ui.mapSel)).map(v => Math.round(v)).join() + ps(ui.mapSel).era;
}
function renderMap() {
  renderMap.sig = mapSig();
  document.querySelectorAll('#system .pl[data-planet]').forEach(b => {
    const pid = b.dataset.planet;
    b.classList.toggle('locked', !isUnlocked(pid));
    b.classList.toggle('here', pid === cur());
    b.classList.toggle('sel', pid === ui.mapSel);
  });
  $('planetChips').innerHTML = PLANET_ORDER.map(pid => `
    <button class="pchip-btn ${pid === ui.mapSel ? 'sel' : ''} ${isUnlocked(pid) ? '' : 'locked'}" data-planet="${pid}" type="button">
      <span>${isUnlocked(pid) ? PL(pid).icon : '🔒'}</span><span>${PL(pid).name}</span>
    </button>`).join('');
  const pid = ui.mapSel, P = PL(pid);
  let html = `<div class="pi-head"><div class="pi-icon">${P.icon}</div><div><div class="pi-name">${P.name}</div>`;
  if (isUnlocked(pid)) {
    const r = rates(pid);
    html += `<div class="pi-sub">${stageLabel(pid)} · ${P.eras[ps(pid).era].name}</div></div></div>
      <div class="pi-rates">${P.res.map(k => `<span class="chip ok">${r[k] > 0 ? '+' + fmtRate(r[k]) : '0'} ${RES[k].icon}/с</span>`).join('')}</div>
      ${pid === cur() ? '<div class="pi-here">📍 Вы здесь</div>' : `<button class="btn-main" data-action="travel" data-id="${pid}" type="button">🚀 Перелететь</button>`}`;
  } else {
    const info = unlockInfo(pid);
    html += `<div class="pi-sub">Не исследована</div></div></div>
      <div class="pi-reqs">${info.reqs.map(q => `<div class="req ${q.ok ? 'ok' : ''}">${q.ok ? '✅' : '⬜'} ${esc(q.label)}</div>`).join('')}</div>
      <div class="pi-cost"><span class="pi-cost-lbl">Экспедиция:</span>${costChips(info.cost)}</div>
      <button class="btn-main" data-action="expedition" data-id="${pid}" type="button" ${info.ready ? '' : 'disabled'}>🛰️ Снарядить экспедицию</button>`;
  }
  $('planetInfo').innerHTML = html;
}

// ============================================================
//  ИНТЕРФЕЙС
// ============================================================
let lastPanelSig = '';
function costChips(s) {
  return Object.entries(s).map(([k, v]) => `<span class="chip ${getRes(k) >= v ? 'ok' : 'no'}">${fmt(v)}${resIcon(k)}</span>`).join('');
}
function costSig(s) { return Object.entries(s).map(([k, v]) => getRes(k) >= v ? 1 : 0).join(''); }

function panelSig() {
  const t = ui.tab, pid = cur();
  const base = pid + ps(pid).era + t;
  if (t === 'top') return base + lbVer + ui.lbBoard + ui.lbPeriod + (myProfile ? myProfile.rank + ':' + myProfile.score : '') + totalPrestige();
  if (t === 'rebirth') return base + prestigeInfo(pid).goals.map(g => g.ok ? 1 : (g.kind === 'stage' ? 0 : Math.floor(g.have / g.goal * 20))).join('') + prestigeCount(pid)
    + GLOBAL_PERKS.map(p => (perk(p.id) < p.max && state.gems >= perkCost(p, perk(p.id))) ? 1 : 0).join('')
    + PL(pid).perks.map(p => (ppk(pid, p.id) < p.max && state.gems >= perkCost(p, ppk(pid, p.id))) ? 1 : 0).join('');
  if (t === 'shop') return base + ui.shopTab + COSMETICS.map(c => state.ownedCosmetics.includes(c.id) ? 'o' : (c.code || c.chest) ? 'c' : costSig(c.cost)).join('') + state.unlocked.join();
  return base + ui.buyMode + PL(pid).buildings.filter(b => b.tab === t).map(b => b.u <= ps(pid).era
    ? (ui.buyMode === 'max' ? maxAffordable(pid, b) : costSig(bulkCost(pid, b, ui.buyMode))) : 'x').join('|');
}
function refreshUI() { renderHeaderAndEra(); if (panelSig() !== lastPanelSig) renderPanel(); updateQuestBadge(); }

function buildResourceBar() {
  $('resourcesBar').innerHTML = PL(cur()).res.map(k =>
    `<div class="res-card res-${k}"><span class="res-icon" style="background:${RES[k].tint}">${RES[k].icon}</span><div class="res-data"><span class="res-val" id="rv-${k}">0</span><span class="res-rate" id="rr-${k}"></span></div></div>`
  ).join('')
  // кошелёк: кристаллы и сапфиры в одной карточке
  + `<div class="res-card res-wallet res-gems" title="Кристаллы и сапфиры">
       <div class="wallet-line" title="Кристаллы"><span class="w-ico">💎</span><span class="res-val" id="rv-gems">0</span></div>
       <div class="wallet-line sapph" title="Сапфиры"><span class="w-ico">🔷</span><span class="res-val" id="rv-sapphire">0</span></div>
     </div>`;
}
function syncTabButtons() {
  const P = PL(cur());
  P.tabs.forEach(t => {
    const b = document.querySelector(`.tab-btn[data-tab="${t.id}"]`);
    if (b) { b.querySelector('.tab-ico').textContent = t.icon; b.querySelector('.tab-lbl').textContent = t.label; }
  });
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
}
function updateUserChip() {
  const name = myProfile ? myProfile.nickname : 'Гость';
  const av = $('hudAvatar');
  av.innerText = myProfile ? initialOf(name) : '?';
  av.setAttribute('style', myProfile ? avatarStyle(name) : 'background:#334155');
  $('hudName').innerText = name;
  $('logoutBtn').hidden = !(session || demo);
}
function renderRankPill() { $('rankPill').innerText = (myProfile && myProfile.rank) ? `🏆 #${myProfile.rank}` : '🏆 —'; }
function updateSoundBtn() { const b = $('soundBtn'); b.textContent = Sound.enabled ? '🔊' : '🔇'; b.title = Sound.enabled ? 'Выключить звук' : 'Включить звук'; }
function toggleSound() { Sound.toggle(); updateSoundBtn(); }

// Смена планеты: шапка, вкладки, фон, всё остальное
function onPlanetChanged() {
  if (!isUnlocked(state.planet)) state.planet = 'earth';
  buildResourceBar();
  syncTabButtons();
  applyBodyBg();
  document.body.dataset.planet = cur();
  $('mapBtnIcon').textContent = PL(cur()).icon;
  renderAll();
  animatePanel();
}

function renderHeaderAndEra() {
  const pid = cur(), P = PL(pid), st = ps(pid);
  const r = rates(pid);
  const auto = perk('autoclicker') * 2 * clickGain(pid);
  P.res.forEach(k => {
    const v = $('rv-' + k); if (!v) return;
    v.textContent = fmt(st.res[k]);
    const rate = k === P.clickRes ? r[k] + auto : (r[k] || 0);
    $('rr-' + k).textContent = rate > 0 ? `+${fmt(rate)}/с` : RES[k].name;
  });
  if ($('rv-gems')) { $('rv-gems').textContent = fmt(state.gems); $('rv-sapphire').textContent = fmt(state.sapphires); }
  $('hudSub').innerText = `${P.icon} ${stageLabel(pid)} · ×${fmt(planetMult(pid))}${prestigeCount(pid) ? ' · 🌀' + prestigeCount(pid) : ''}`;
  const sp = speedMult(), bl = boostLeft();
  $('speedBadge').hidden = sp <= 1 && !bl;
  $('speedBadge').innerText = [bl ? `⚡×2 ${fmtCountdown(bl / 1000)}` : '', sp > 1 ? `⏳${Math.round(sp * 100)}%` : ''].filter(Boolean).join(' ');
  $('speedBadge').classList.toggle('boost', !!bl);
  const ap = $('astPill');
  if (activeAsteroid) { ap.innerText = activeAsteroid.golden ? '✨ Бой!' : '☄️ Бой!'; ap.className = 'pill alert'; }
  else { ap.innerText = playing ? `☄️ ${fmtCountdown(bossCooldown)}` : '☄️ —'; ap.className = 'pill'; }

  const E = P.eras[st.era], N = P.eras[st.era + 1];
  $('eraTitle').innerHTML = `<span class="era-num" style="--halo:${E.halo}">${stageLabel(pid)}</span> ${esc(E.name)}`;
  $('nextEraTitle').innerText = N ? `Далее: ${N.name} · тап +${fmt(clickGain(pid))} ${RES[P.clickRes].icon}` : `Высшая ступень достигнута · тап +${fmt(clickGain(pid))} ${RES[P.clickRes].icon}`;
  const evolveBtn = $('evolveBtn');
  const dCost = eraCost(pid);
  if (dCost) {
    const ratios = Object.entries(dCost).map(([k, v]) => Math.min(1, getRes(k) / v));
    const pct = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    $('eraFill').style.width = (pct * 100).toFixed(1) + '%';
    $('eraFill').classList.toggle('full', pct >= 1);
    $('nextEraReq').innerHTML = costChips(dCost);
    evolveBtn.style.display = 'block';
    evolveBtn.disabled = !canPay(dCost);
  } else {
    $('eraFill').style.width = '100%';
    $('eraFill').classList.add('full');
    $('nextEraReq').innerHTML = `<span class="chip ok">Максимум достигнут</span>`;
    evolveBtn.style.display = 'none';
  }
  if ($('mapOverlay').classList.contains('open') && mapSig() !== renderMap.sig) renderMap();
}

function buildingCard(pid, b, mult, i) {
  const n = buyCount(pid, b);
  const cost = bulkCost(pid, b, n), count = ps(pid).counts[b.id] || 0, afford = canPay(cost);
  const prod = Object.entries(b.prod).map(([k, v]) => `<span class="pchip">+${fmtRate(v * mult)}${RES[k].icon}/с</span>`).join('');
  return `
    <div class="card ${afford ? 'affordable' : ''}" data-card="${b.id}" style="--i:${i}">
      <div class="icon-tile t-${b.tab}">${b.icon}</div>
      <div class="card-info">
        <div class="card-title"><span>${b.name}</span>${count ? `<span class="card-count">×${count}</span>` : ''}</div>
        <div class="card-desc">${b.desc}</div>
        <div class="card-prod">${prod}</div>
      </div>
      <button class="btn-buy" data-action="build" data-id="${b.id}" type="button" ${afford ? '' : 'disabled'}>
        <span>Построить${n > 1 ? ` <b class="buy-n">×${n}</b>` : ''}</span><span class="buy-cost">${costChips(cost)}</span>
      </button>
    </div>`;
}
function perkCard(p, lvl, action, cardId, i, effectText) {
  const isMax = lvl >= p.max, cost = perkCost(p, lvl), canBuy = !isMax && state.gems >= cost;
  let pips = '';
  for (let k = 0; k < p.max; k++) pips += `<div class="perk-pip ${k < lvl ? 'filled' : ''}"></div>`;
  return `
    <div class="card perk-card" data-card="${cardId}" style="--i:${i}">
      <div class="icon-tile t-perk">${p.icon}</div>
      <div class="card-info">
        <div class="card-title"><span>${p.name}</span><span class="card-count">${lvl}/${p.max}</span></div>
        <div class="card-desc">${p.desc}</div>
        <div class="card-prod"><span class="pchip">${effectText}</span></div>
        <div class="perk-level-bar">${pips}</div>
      </div>
      <button class="btn-buy perk-btn" data-action="${action}" data-id="${p.id}" type="button" ${canBuy ? '' : 'disabled'}>
        <span>${isMax ? 'МАКС' : 'Улучшить'}</span>
        ${isMax ? '' : `<span class="buy-cost"><span class="chip ${state.gems >= cost ? 'ok' : 'no'}">${cost}💎</span></span>`}
      </button>
    </div>`;
}
function planetPerkEffect(p, lvl) {
  if (p.type === 'prod') return lvl ? `Производство +${Math.round(p.step * lvl * 100)}%` : `+${p.step * 100}% за уровень`;
  if (p.type === 'click') return lvl ? `Тап +${Math.round(p.step * lvl * 100)}%` : `+${p.step * 100}% за уровень`;
  return lvl ? `Скидка −${Math.round(p.step * lvl * 100)}%` : `−${Math.round(p.step * 100)}% за уровень`;
}

function renderPanel() {
  const container = $('panelContent');
  const scroll = container.scrollTop;
  const tab = ui.tab, pid = cur(), P = PL(pid), st = ps(pid);

  if (tab === 'top') {
    container.innerHTML = renderLeaderboardHtml();
  } else if (tab === 'rebirth') {
    const info = prestigeInfo(pid);
    let i = 0;
    const others = PLANET_ORDER.filter(x => isUnlocked(x)).map(x => `<span class="pp-chip ${x === pid ? 'cur' : ''}">${PL(x).icon} ${prestigeCount(x)} 🌀 · ×${planetMult(x)}</span>`).join('');
    container.innerHTML = `
      <div class="card rebirth-card" style="--i:${i++}">
        <div class="card-title" style="font-size:0.95rem;color:#f5d0fe;">🌀 Престиж планеты «${P.name}» №${info.n + 1}</div>
        <div class="card-desc" style="color:#e2e8f0;margin:0;">Сбрасывает только эту планету: её ресурсы, постройки и ${P.stageWord === 'Эпоха' ? 'эпохи' : 'этапы'}. Награда — 💎 кристаллы и навсегда +100% к доходу и тапу на ней. Сейчас ×${info.mult} → ×${info.nextMult}.</div>
        <div class="reb-reqs">
          <div class="reb-reqs-title">Цели престижа${info.n ? ' — с каждым престижем выше' : ''}:</div>
          ${info.goals.map(g => `<div class="reb-req ${g.ok ? 'ok' : ''}"><span>${g.ok ? '✅' : '⬜'} ${esc(g.label)}</span><span class="reb-have">${g.kind === 'stage' ? `${g.have}/${g.goal}` : `${fmt(Math.min(g.have, g.goal))}/${fmt(g.goal)}`}</span></div>
            ${g.kind === 'stage' ? '' : `<div class="reb-bar"><i style="width:${Math.min(100, g.have / g.goal * 100).toFixed(1)}%"></i></div>`}`).join('')}
        </div>
        <button class="btn-rebirth-main" data-action="rebirth" type="button" ${info.ready ? '' : 'disabled'}>
          ${info.ready ? `Совершить престиж (+${info.gems} 💎)` : 'Выполните цели'}
        </button>
        <div class="pp-row">${others}</div>
      </div>
      <div class="section-header" style="--i:${i++}"><span>🌳 Древо Вечности · все планеты</span><span>💎 ${fmt(state.gems)}</span></div>
      ${GLOBAL_PERKS.map(p => perkCard(p, perk(p.id), 'perk', 'perk-' + p.id, i++, p.effect(perk(p.id)))).join('')}
      <div class="section-header" style="--i:${i++}"><span>${P.icon} Перки планеты · ${P.name}</span><span></span></div>
      ${P.perks.map(p => perkCard(p, ppk(pid, p.id), 'pperk', 'pp-' + p.id, i++, planetPerkEffect(p, ppk(pid, p.id)))).join('')}`;
  } else if (tab === 'shop') {
    const look = state.look[pid];
    const items = COSMETICS.filter(c => c.type === ui.shopTab);
    container.innerHTML = `
      <div class="seg" style="--i:0">
        <button class="seg-btn ${ui.shopTab === 'hat' ? 'active' : ''}" data-action="shoptab" data-id="hat" type="button">🎩 Шапки</button>
        <button class="seg-btn ${ui.shopTab === 'bg' ? 'active' : ''}" data-action="shoptab" data-id="bg" type="button">🖼️ Фоны</button>
      </div>
      <div class="shop-note" style="--i:1">Образ для планеты <b>${P.icon} ${P.name}</b> — у каждой планеты свой.</div>
      ${items.map((item, idx) => {
        const owned = state.ownedCosmetics.includes(item.id);
        const equipped = item.type === 'hat' ? look.hat === item.id : look.bg === item.id;
        const lockedPlanet = item.planet && !isUnlocked(item.planet);
        const preview = item.type === 'bg'
          ? `<div class="icon-tile swatch" style="background:${item.swatch}"><span>${item.icon}</span></div>`
          : `<div class="icon-tile t-shop">${item.icon}</div>`;
        const badge = item.code ? `<span class="planet-badge code">🎁 эксклюзив</span>` : item.chest ? `<span class="planet-badge chest">🧰 редкий</span>` : item.planet ? `<span class="planet-badge">${PL(item.planet).icon} ${PL(item.planet).name}</span>` : '';
        let btn;
        if (owned) btn = `<button class="btn-buy ${equipped ? 'equipped' : ''}" data-action="cosmetic" data-id="${item.id}" type="button"><span>${equipped ? '✓ Надето' : 'Надеть'}</span>${equipped ? '<span class="buy-sub">снять</span>' : ''}</button>`;
        else if (item.code) btn = `<button class="btn-buy code-btn" data-action="codes" type="button"><span>🎁 Промокод</span><span class="buy-sub">только по коду</span></button>`;
        else if (item.chest) btn = `<button class="btn-buy chest-btn" data-action="chests" type="button"><span>🧰 Сундук</span><span class="buy-sub">только из сундуков</span></button>`;
        else if (lockedPlanet) btn = `<button class="btn-buy" type="button" disabled><span>🔒 ${PL(item.planet).name}</span><span class="buy-sub">откройте планету</span></button>`;
        else btn = `<button class="btn-buy" data-action="cosmetic" data-id="${item.id}" type="button" ${canPay(item.cost) ? '' : 'disabled'}><span>Купить</span><span class="buy-cost">${costChips(item.cost)}</span></button>`;
        return `
          <div class="card ${equipped ? 'equipped-card' : ''}" data-card="c-${item.id}" style="--i:${idx + 2}">
            ${preview}
            <div class="card-info">
              <div class="card-title"><span>${item.name}</span>${badge}</div>
              <div class="card-desc" style="margin:0;">${item.desc}</div>
            </div>
            ${btn}
          </div>`;
      }).join('')}`;
  } else {
    const mult = prodMult(pid);
    const list = P.buildings.filter(b => b.tab === tab);
    const open = list.filter(b => b.u <= st.era);
    const next = list.find(b => b.u > st.era);
    const modes = `<div class="buy-modes" style="--i:0"><span class="bm-lbl">Купить</span>${BUY_MODES.map(m => `<button class="bm-btn ${ui.buyMode === m ? 'active' : ''}" data-action="buymode" data-id="${m}" type="button">${m === 'max' ? 'MAX' : '×' + m}</button>`).join('')}</div>`;
    container.innerHTML = (open.length ? modes : '') + open.map((b, i) => buildingCard(pid, b, mult, i + 1)).join('')
      + (next ? `<div class="card teaser" style="--i:${open.length}"><div class="icon-tile locked-tile">${next.icon}</div><div class="card-info"><div class="card-title"><span>🔒 ${next.name}</span></div><div class="card-desc" style="margin:0;">Откроется: ${stageLabel(pid, next.u)} «${P.eras[next.u].name}»</div></div></div>` : '')
      + (!open.length && !next ? '<div class="empty"><div class="empty-ico">🌌</div><div class="empty-text">Здесь пока пусто</div></div>' : '');
  }
  container.scrollTop = scroll;
  lastPanelSig = panelSig();
}
function renderAll() { renderHeaderAndEra(); renderPanel(); }
function animatePanel() {
  const c = $('panelContent');
  c.classList.remove('anim'); void c.offsetWidth; c.classList.add('anim');
  clearTimeout(animatePanel.t);
  animatePanel.t = setTimeout(() => c.classList.remove('anim'), 900);
}
function selectTab(name) {
  if (ui.tab !== name) Sound.ui();
  ui.tab = name;
  syncTabButtons();
  $('panelContent').scrollTop = 0;
  renderPanel();
  animatePanel();
  if (name === 'top') fetchLeaderboard();
}

function setupEvents() {
  $('tabsBar').addEventListener('click', (e) => { const btn = e.target.closest('.tab-btn'); if (btn) selectTab(btn.dataset.tab); });
  $('panelContent').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const a = btn.dataset.action, id = btn.dataset.id;
    if (a === 'build') buyBuilding(id);
    else if (a === 'perk') buyPerk(id);
    else if (a === 'pperk') buyPlanetPerk(id);
    else if (a === 'cosmetic') handleCosmetic(id);
    else if (a === 'rebirth') performPrestige();
    else if (a === 'shoptab') { if (ui.shopTab !== id) { ui.shopTab = id; Sound.ui(); renderPanel(); animatePanel(); } }
    else if (a === 'lbrefresh') fetchLeaderboard();
    else if (a === 'lbboard') setLeaderboard(id, ui.lbPeriod);
    else if (a === 'lbperiod') setLeaderboard(ui.lbBoard, id);
    else if (a === 'buymode') setBuyMode(id);
    else if (a === 'codes') openCodes();
    else if (a === 'chests') openShop();
  });
  $('evolveBtn').addEventListener('click', evolveEra);
  $('rankPill').addEventListener('click', () => { if (playing) selectTab('top'); });
  $('mapBtn').addEventListener('click', openMap);
  $('mapClose').addEventListener('click', () => { closeMap(); Sound.ui(); });
  $('mapOverlay').addEventListener('click', (e) => {
    const pl = e.target.closest('.pl[data-planet], .pchip-btn[data-planet]');
    if (pl) { ui.mapSel = pl.dataset.planet; Sound.ui(); renderMap(); return; }
    const btn = e.target.closest('button[data-action]');
    if (btn && !btn.disabled) {
      if (btn.dataset.action === 'travel') travelTo(btn.dataset.id);
      if (btn.dataset.action === 'expedition') launchExpedition(btn.dataset.id);
      return;
    }
    if (e.target === $('mapOverlay')) closeMap();
  });
  $('cinema').addEventListener('click', closeCinema);
  $('userChip').addEventListener('click', openProfile);
  $('soundBtn').addEventListener('click', toggleSound);
  $('logoutBtn').addEventListener('click', () => logout());
  $('demoBtn').addEventListener('click', startDemo);
  $('googleBtn').addEventListener('click', startGoogleLogin);
  $('loginCancel').addEventListener('click', () => { takePendingLogin(); showLogin(''); });
  $('nickSubmit').addEventListener('click', submitNick);
  $('nickInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitNick(); });
  $('nickInput').addEventListener('input', () => setNickMsg(''));
  $('nickDice').addEventListener('click', () => { $('nickInput').value = randomNick(); setNickMsg(''); Sound.ui(); });
  $('nickLogout').addEventListener('click', () => { $('nickOverlay').classList.remove('open'); logout({ ask: false, skipSync: true }); });
  $('profileOverlay').addEventListener('click', (e) => { if (e.target === $('profileOverlay')) $('profileOverlay').classList.remove('open'); });
  $('updateGo').addEventListener('click', downloadUpdate);
  // квесты, магазин, промокоды
  $('questBtn').addEventListener('click', openQuests);
  $('shopBtn').addEventListener('click', openShop);
  $('questsClose').addEventListener('click', () => { $('questsOverlay').classList.remove('open'); Sound.ui(); });
  $('questsOverlay').addEventListener('click', (e) => {
    const b = e.target.closest('.q-claim');
    if (b) { claimQuest(b.dataset.qkind, b.dataset.qid, b); return; }
    if (e.target === $('questsOverlay')) $('questsOverlay').classList.remove('open');
  });
  $('shopClose').addEventListener('click', () => { $('shopOverlay').classList.remove('open'); Sound.ui(); });
  $('chestList').addEventListener('click', (e) => { const b = e.target.closest('.chest-buy'); if (b && !b.disabled) openChest(b.dataset.chest); });
  $('chestOverlay').addEventListener('click', (e) => { if (e.target.closest('#chestTake')) return; revealChest(); });
  $('chestTake').addEventListener('click', () => { Sound.coin(); closeChest(); });
  $('shopQuests').addEventListener('click', () => { $('shopOverlay').classList.remove('open'); openQuests(); });
  $('shopCode').addEventListener('click', openCodes);
  $('shopOverlay').addEventListener('click', (e) => { if (e.target === $('shopOverlay')) $('shopOverlay').classList.remove('open'); });
  $('codeCancel').addEventListener('click', () => { $('codeOverlay').classList.remove('open'); Sound.ui(); });
  $('codeSubmit').addEventListener('click', submitCode);
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCode(); });
  $('codeInput').addEventListener('input', () => setCodeMsg(''));
  $('codeOverlay').addEventListener('click', (e) => { if (e.target === $('codeOverlay')) $('codeOverlay').classList.remove('open'); });
  $('updateLater').addEventListener('click', () => { $('updateOverlay').classList.remove('open'); Sound.ui(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { saveLocal(); syncNow(true); } });
  window.addEventListener('pagehide', () => { if (playing) { saveLocal(); syncNow(true); } });
}

// ---------- Мост с Android-приложением ----------
window.__terraPause = function () { if (playing) { saveLocal(); syncNow(true); } };
window.__terraBack = function () {
  if (cinemaOpen) { cinemaShownAt = 0; closeCinema(); return true; }
  if ($('confirmOverlay').classList.contains('open')) { $('confirmCancel').click(); return true; }
  if ($('mapOverlay').classList.contains('open')) { closeMap(); return true; }
  if ($('profileOverlay').classList.contains('open')) { $('profileOverlay').classList.remove('open'); return true; }
  if (forcedUpdate) return true;   // окно «Нужно обновление» не закрывается
  if ($('updateOverlay').classList.contains('open')) { $('updateOverlay').classList.remove('open'); return true; }
  if ($('questsOverlay').classList.contains('open')) { $('questsOverlay').classList.remove('open'); return true; }
  if ($('chestOverlay').classList.contains('open')) { if ($('chestOverlay').classList.contains('opened')) closeChest(); else revealChest(); return true; }
  if ($('shopOverlay').classList.contains('open')) { $('shopOverlay').classList.remove('open'); return true; }
  if ($('codeOverlay').classList.contains('open')) { $('codeOverlay').classList.remove('open'); return true; }
  return false;
};

// ============================================================
//  ГЛАВНЫЙ ЦИКЛ (реальное время)
// ============================================================
let lastTick = Date.now(), autoAcc = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.max(0, (now - lastTick) / 1000);
  lastTick = now;
  if (!playing) return;
  // долгая пауза (приложение было свёрнуто) — офлайн-доход
  if (dt > 60) { grantOffline(dt); refreshUI(); return; }

  state.unlocked.forEach(pid => {
    const r = rates(pid), res = ps(pid).res;
    for (const k in r) res[k] += r[k] * dt;
  });
  if (!document.hidden) state.stats.playSec += dt;

  if (!activeAsteroid && !cinemaOpen && !traveling) {
    bossCooldown -= dt;
    if (bossCooldown <= 0) spawnAsteroid();
  }

  const autoLvl = perk('autoclicker');
  if (autoLvl > 0) {
    autoAcc += autoLvl * 2 * dt;
    let shots = Math.min(Math.floor(autoAcc), 40);
    autoAcc -= Math.floor(autoAcc);
    while (shots-- > 0) {
      if (activeAsteroid) { laserBeamTimer = 4; damageAsteroid(true); }
      else { const g = clickGain(); ps(cur()).res[PL(cur()).clickRes] += g; autoFx.pending++; autoFx.gain += g; }
    }
    // раз в секунду — всплывающая сумма, которую натапал автокликер
    if (autoFx.gain > 0 && now - autoFx.shown > 1000 && !document.hidden) {
      autoFx.shown = now;
      showFloat(Math.min(cw - 90, autoSat.x + 6), Math.max(70, autoSat.y - 26), `🤖 +${fmt(autoFx.gain)} ${RES[PL(cur()).clickRes].icon}`, 'auto');
      autoFx.gain = 0;
    }
  }
  refreshUI();
}, 100);

setInterval(() => { if (playing) saveLocal(); }, 5000);
setInterval(() => { if (playing) syncNow(); }, 30000);

bootPromise = boot();

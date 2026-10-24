// Terra 3D — движок игры: экономика нескольких планет, графика, интерфейс, аккаунт и синхронизация.
'use strict';

// ============================================================
//  НАСТРОЙКИ (config.js)
// ============================================================
const RAW_CONFIG = window.TERRA_CONFIG || {};
const IS_APP = typeof window.TerraNative === 'object' && window.TerraNative !== null; // запущено внутри APK
const IS_TWITCH = !!RAW_CONFIG.TWITCH;   // сборка для панели под трансляцией на Twitch (server/twitch/build.sh)
if (IS_TWITCH) document.documentElement.classList.add('twitch');
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
      if (d && d.terra) { u = location.origin; LOGINS.yandex = !!d.yandex; }
    } catch (e) {}
  } else if (u && !IS_TWITCH) {
    // APK: узнаём, включён ли на сервере вход с Яндекс ID. Запуск не ждём — кнопка появится, когда сервер ответит.
    fetch(u + '/api/health', { cache: 'no-store' }).then(r => r.json()).then(d => {
      LOGINS.yandex = !!(d && d.yandex);
      if ($('loginOverlay').classList.contains('open') && CONFIGURED) $('yandexBtn').hidden = !LOGINS.yandex;
    }).catch(() => {});
  }
  CONFIG.API_URL = u;
  CONFIGURED = !!u;
}
const LOGINS = { yandex: false };

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
// friends и alliance — сколько было друзей и был ли альянс (для достижений; знает сервер)
// combo — лучшая серия тапов, donated — сколько 💎 вложено в альянс, stars — пойманные звёзды,
// chatMsgs — сообщения в чат, streak — лучшая серия дней входа, weekly — полученные награды недели
const STAT_KEYS = ['taps', 'built', 'asteroids', 'golden', 'evolves', 'perks', 'travels', 'playSec', 'chests', 'friends', 'alliance', 'combo', 'donated',
  'stars', 'chatMsgs', 'streak', 'weekly'];
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
    v: GAME_VERSION, planet: 'earth', unlocked: ['earth'], unis: ['sol'], planets, gems: 0, sapphires: 0,
    perks, ppk, ppr, rebirths: 0, boostUntil: 0, ownedCosmetics: [], look, stats: defaultStats(), quests: defaultQuests(),
    tapSound: DEFAULT_TAP_SOUND, tut: 0, login: { day: '', streak: 0 }, legend: 0, lastSave: Date.now()
  };
}
let state = defaultState();
// tab — открытая панель снизу (null — панель закрыта, на экране только планета)
const ui = { tab: null, shopTab: 'hat', mapSel: null, mapUni: 'sol', lbBoard: 'all', lbPeriod: 'all', lbUni: null, buyMode: 1, socialTab: 'friends', allyPeriod: 'all',
  chatTab: 'global', chatWith: null, storeTab: 'chests' };
try { const bm = localStorage.getItem('terra_buy_mode'); if (bm) ui.buyMode = bm === 'max' ? 'max' : (BUY_MODES.includes(+bm) ? +bm : 1); } catch (e) {}

// Настройки на этом устройстве: вибрация, эффекты, запись чисел (звук и музыка — в Sound)
const prefs = { vibrate: true, lowfx: false, sci: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('terra_prefs')) || {}); } catch (e) {}
function savePrefs() { try { localStorage.setItem('terra_prefs', JSON.stringify(prefs)); } catch (e) {} }

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
  s.tut = TUT_DONE;   // старый игрок — обучение не нужно
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
      // открытые измерения (v7); измерение открыто и тогда, когда открыта хоть одна его планета
      const un = Array.isArray(p.unis) ? p.unis : [];
      d.unis = UNIVERSE_ORDER.filter(u => u === 'sol' || un.includes(u) || d.unlocked.some(x => uniOf(x) === u));
      d.tapSound = typeof p.tapSound === 'string' ? p.tapSound : DEFAULT_TAP_SOUND;
      d.tut = Number.isInteger(p.tut) ? p.tut : TUT_DONE;   // старые сохранения — обучение уже не нужно
      if (p.login && typeof p.login === 'object') d.login = { day: typeof p.login.day === 'string' ? p.login.day.slice(0, 10) : '', streak: Math.min(100000, int(p.login.streak)) };
      d.legend = p.legend ? 1 : 0;
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
  if (s.tapSound !== DEFAULT_TAP_SOUND && !s.ownedCosmetics.includes(s.tapSound)) s.tapSound = DEFAULT_TAP_SOUND;
  if (s.tut !== TUT_DONE && (s.stats.taps > 400 || totalPrestige(s) > 0)) s.tut = TUT_DONE;
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
// бонус открытых измерений (+25% за каждое после первого) и уровня альянса (+2% за уровень)
function uniMult() { return 1 + UNIVERSE_BONUS * Math.max(0, (state.unis || ['sol']).length - 1); }
let allyBonus = 0;
try { allyBonus = Math.min(0.5, Math.max(0, parseFloat(localStorage.getItem('terra_ally_bonus')) || 0)); } catch (e) {}
function setAllyBonus(level) {
  const b = Math.min(ALLY_LEVEL_MAX, Math.max(0, level | 0)) * ALLY_LEVEL_BONUS;
  if (b === allyBonus) return;
  allyBonus = b;
  try { localStorage.setItem('terra_ally_bonus', String(b)); } catch (e) {}
}
// Бонусы падающих звёзд: короткие, действуют только пока игра открыта. noBuffs > 0 — считаем без них
// (офлайн-доход, сундуки, клад звезды — иначе ×3 «ветра» попал бы в 8 часов офлайна).
const buffs = { frenzy: 0, wind: 0 };
let noBuffs = 0;
const buffLeft = (k) => Math.max(0, (buffs[k] || 0) - Date.now());
const starBonus = (id) => STAR_BONUS.find(b => b.id === id);
function frenzyMult() { return !noBuffs && buffLeft('frenzy') > 0 ? starBonus('frenzy').mult : 1; }
function windMult() { return !noBuffs && buffLeft('wind') > 0 ? starBonus('wind').mult : 1; }
function withoutBuffs(fn) { noBuffs++; try { return fn(); } finally { noBuffs--; } }
function prodMult(pid) { return planetMult(pid) * speedMult() * boostMult() * uniMult() * windMult() * (1 + allyBonus) * (1 + planetPerkBonus(pid, 'prod')); }
function clickGain(pid = cur()) { return Math.ceil(PL(pid).eras[ps(pid).era].click * planetMult(pid) * boostMult() * uniMult() * frenzyMult() * (1 + planetPerkBonus(pid, 'click'))); }
// серия быстрых тапов (перк «Комбо-тапы»): до ×50, тап сильнее на 20% за уровень перка на полной серии
const COMBO_MAX = 50, COMBO_GAP_MS = 650;
const combo = { n: 0, at: 0 };
function comboMult() { const l = perk('combo'); return l ? 1 + (Math.min(combo.n, COMBO_MAX) / COMBO_MAX) * 0.2 * l : 1; }
function gemMult() { return 1 + perk('gem_res') * 0.2; }
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
  const U = PL(pid).unlock, uni = uniOf(pid);
  if (!U) {
    // первая планета измерения открывается проходом через чёрную дыру
    if (uni !== 'sol' && !state.unis.includes(uni)) return { reqs: [{ label: `🕳️ Откройте ${UNIVERSES[uni].name} на карте`, ok: false }], cost: {}, ready: false };
    return { reqs: [], cost: null, ready: true };
  }
  const reqs = [];
  if (uni !== 'sol') reqs.push({ label: `${UNIVERSES[uni].icon} ${UNIVERSES[uni].name} открыто`, ok: state.unis.includes(uni) });
  if (U.earthEra !== undefined) reqs.push({ label: `🌍 Земля: эпоха ${U.earthEra + 1} «${PLANETS.earth.eras[U.earthEra].name}»`, ok: ps('earth').era >= U.earthEra });
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
  return { pid, n, goals, ready, gems: Math.round(prestigeGems(pid, n, st.era) * gemMult()), mult: 1 + n, nextMult: 2 + n };
}
function canPrestige(pid = cur()) { return prestigeInfo(pid).ready; }

// ---------- Измерения ----------
// «Пул» перехода: в предыдущем измерении все планеты пройдены до последнего этапа, набрано нужное число престижей
// (всего и на каждой планете) — и плата кристаллами. После этого открывается чёрная дыра.
const uniPrestige = (u) => UNIVERSES[u].planets.reduce((a, pid) => a + prestigeCount(pid), 0);
const bestStage = (pid) => isUnlocked(pid) ? Math.max(state.stats.maxEra[pid] || 0, ps(pid).era) : -1;
function universeInfo(u) {
  const U = UNIVERSES[u], N = U.need;
  if (!N) return { reqs: [], ready: true, open: true };
  const F = UNIVERSES[N.from], reqs = [];
  reqs.push({ label: `${F.icon} Открыто: ${F.name}`, ok: state.unis.includes(N.from) });
  F.planets.forEach(pid => {
    const max = PL(pid).eras.length - 1, b = bestStage(pid), pr = prestigeCount(pid);
    reqs.push({ label: `${PL(pid).icon} ${PL(pid).name}: все этапы и ${N.each} ${plural(N.each, 'престиж', 'престижа', 'престижей')}`,
      ok: b >= max && pr >= N.each, have: `${Math.max(0, b + 1)}/${max + 1} · 🌀${pr}` });
  });
  const tp = uniPrestige(N.from);
  reqs.push({ label: `🌀 Престижей в измерении «${F.short}»: ${N.prestige}`, ok: tp >= N.prestige, have: `${tp}/${N.prestige}` });
  reqs.push({ label: `💎 Плата чёрной дыре: ${N.gems}`, ok: state.gems >= N.gems, have: `${fmt(state.gems)}/${N.gems}` });
  return { reqs, ready: reqs.every(r => r.ok), open: state.unis.includes(u), gems: N.gems };
}

// ============================================================
//  ФОРМАТИРОВАНИЕ И МЕЛОЧИ
// ============================================================
function fmt(n) {
  if (prefs.sci && n >= 1e6) return n.toExponential(2).replace('e+', 'e');
  if (n >= 1e21) return n.toExponential(2).replace('e+', 'e');
  if (n >= 1e18) return (n / 1e18).toFixed(2) + 'Qi';
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
function vibrate(p) { if (!prefs.vibrate) return; try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

function avatarStyle(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `background:linear-gradient(135deg,hsl(${h} 80% 56%),hsl(${(h + 55) % 360} 80% 42%))`;
}
function initialOf(name) { const c = [...String(name || '?')][0] || '?'; return c.toUpperCase(); }
// Фон интерфейса — всегда «родной» для планеты; купленный фон меняет только космос за планетой
function applyBodyBg() {
  // у body есть и другие классы (panel-open) — меняем только фон
  const b = document.body, bg = PL(cur()).defaultBg;
  for (const c of [...b.classList]) if (c.startsWith('bg-') && c !== bg) b.classList.remove(c);
  b.classList.add(bg);
  $('viewport').dataset.bg = state.look[cur()].bg || '';
}

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
// Какое сохранение свежее: то, где дальше прогресс (престижи, измерения, планеты, этапы), и только при
// равенстве — более позднее по времени. Часам устройства не доверяем: на втором телефоне они могут
// спешить, и старый прогресс оказался бы «новее» облачного.
function saveAhead(s) {
  if (!s) return [-1];
  const pr = (s.v >= 5 && s.ppr) ? PLANET_ORDER.reduce((a, p) => a + ((s.ppr[p] | 0)), 0) : (s.rebirths | 0);
  return [pr, Array.isArray(s.unis) ? s.unis.length : 1, Array.isArray(s.unlocked) ? s.unlocked.length : 1, progressOf(s)];
}
function pickNewest(a, b) {
  if (a && b) {
    const A = saveAhead(a), B = saveAhead(b);
    for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return B[i] > A[i] ? b : a;
    return (Number(b.lastSave) || 0) > (Number(a.lastSave) || 0) ? b : a;
  }
  return a || b || null;
}
// Сервер не принял сохранение: в облаке прогресс дальше (играли на другом устройстве) — берём облачное
function adoptCloud(save) {
  applySave(save);
  state.lastSave = Date.now();
  endAsteroid(true);
  onPlanetChanged();
  saveLocal();
  setSync('ok');
  showToast('☁️ На другом устройстве прогресс дальше — загрузили его', 4500);
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
function queueSync(delay = 1500) { if (!canSync()) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => { syncTimer = null; syncNow(); }, delay); }
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
    // топ открыт — сразу подтягиваем свежие места (без кнопки ⟳)
    if (!keepalive && ui.tab === 'top' && !document.hidden) setTimeout(() => fetchLeaderboard(), 150);
  } catch (e) {
    if (e.status === 401) { syncing = false; forceLogout('Сессия истекла. Войдите снова.'); return; }
    if (e.status === 404 && e.message === 'no_profile') { syncing = false; logout({ ask: false, skipSync: true, message: 'Аккаунт не найден. Войдите снова.' }); return; }
    if (e.status === 409 && e.message === 'stale_save' && e.data && e.data.save) { syncing = false; adoptCloud(e.data.save); return; }
    if (e.status === 409 && e.message === 'client_outdated') {
      clientOutdated = true;
      if (IS_TWITCH) { showToast('Вышла новая версия игры — на Twitch она появится чуть позже', 6000); setSync('off'); return; }
      if (!IS_APP) { reloadForNewVersion(); return; }   // сайт: просто берём новую версию игры
      showToast('Вышла новая версия игры — обновите приложение', 6000); checkUpdate(true);
    }
    setSync('off');
  } finally { syncing = false; }
}

// ---------- Twitch: вход зрителя в панели под трансляцией ----------
// Twitch сам сообщает игре, кто смотрит (JWT расширения); сервер проверяет его и выдаёт обычную сессию.
// Аккаунт из игры (APK/сайт) привязывается по одноразовому коду — тогда прогресс и топ общие.
let twitchToken = null, twitchUser = '', twitchLinked = false;
function twitchBoot() {
  const ext = window.Twitch && window.Twitch.ext;
  if (!ext) { showLogin('Не удалось подключиться к Twitch. Обновите страницу.'); return; }
  let started = false;
  const t = setTimeout(() => { if (!started) { started = true; showLogin('Twitch не ответил. Обновите страницу.'); } }, 15000);
  ext.onAuthorized((auth) => {
    twitchToken = auth && auth.token; twitchUser = String((auth && auth.userId) || '');
    if (started) { if (!playing && $('loginOverlay').classList.contains('open')) showLogin(); return; }   // токен обновился
    started = true; clearTimeout(t);
    if (/^U/.test(twitchUser)) twitchLogin(); else showLogin();
  });
}
async function twitchLogin() {
  if (!twitchToken) { showLogin(); return; }
  closeAllOverlays();
  $('loginOverlay').classList.add('open');
  setLoginBusy(true, 'Загружаем ваш прогресс…');
  try {
    const r = await api('/api/auth/twitch', { method: 'POST', body: { token: twitchToken } });
    session = { token: r.token, uid: r.uid, nickname: r.profile ? r.profile.nickname : null };
    twitchLinked = !!r.linked;
    saveSession();
    await enterGame(r.profile, r.save, false);
  } catch (e) {
    session = null;
    showLogin(e.status === 503 ? 'Игра на Twitch ещё настраивается — пока можно сыграть гостем.'
      : e.status === 403 ? '' : 'Не удалось войти. Проверьте интернет и попробуйте снова.');
  }
}
// в панели: ввести код из игры — дальше здесь аккаунт из игры
function openTwitchLink() {
  const sheet = $('settingsSheet');
  sheet.innerHTML = `
    <div class="q-head"><div><h2>🔗 Аккаунт из игры</h2></div><button class="btn-icon" id="setClose" type="button">✕</button></div>
    <div class="set-text">Играете в Terra 3D на телефоне или на сайте? Привяжите тот аккаунт — прогресс, друзья, альянс и место в топе станут общими.</div>
    <ol class="set-steps"><li>В игре на телефоне или на сайте: ⚙️ Настройки → «📺 Играть на Twitch»</li><li>Введите показанный там код здесь</li></ol>
    <div class="add-row"><input id="twCodeInput" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Код из игры"><button class="btn-small" id="twLinkBtn" type="button">Привязать</button></div>
    <div class="nick-msg" id="twMsg"></div>
    <div class="set-text dim">Прогресс, набранный здесь, на Twitch, заменится прогрессом из игры.</div>
    <button class="btn-soft" id="twBack" type="button">← Назад</button>`;
  $('setClose').onclick = () => $('settingsOverlay').classList.remove('open');
  $('twBack').onclick = () => renderSettings();
  const msg = (t, bad) => { $('twMsg').textContent = t; $('twMsg').className = 'nick-msg' + (bad ? ' err' : t ? ' ok' : ''); };
  const go = async () => {
    const code = $('twCodeInput').value.trim();
    if (!code) { msg('Введите код из игры', true); Sound.error(); return; }
    if (!twitchToken || !/^U/.test(twitchUser)) { msg('Сначала войдите в Twitch', true); return; }
    $('twLinkBtn').disabled = true; msg('Привязываем…');
    try {
      const r = await api('/api/twitch/link', { method: 'POST', body: { token: twitchToken, code } });
      // переключаемся на аккаунт из игры: Twitch-учётка удалена, её больше не синхронизируем
      playing = false; clearTimeout(syncTimer);
      try { if (session) localStorage.removeItem('terra_save_' + session.uid); } catch (e) {}
      session = { token: r.token, uid: r.uid, nickname: r.profile ? r.profile.nickname : null };
      twitchLinked = true; saveSession();
      Sound.evolve();
      $('settingsOverlay').classList.remove('open');
      ui.tab = null; document.body.classList.remove('panel-open');
      social = null; allyList = null; lbData = null;
      await enterGame(r.profile, r.save, false);
      showToast('🔗 Готово! Здесь теперь ваш аккаунт из игры', 4000);
    } catch (e) {
      $('twLinkBtn').disabled = false; Sound.error();
      msg(e.status === 404 ? 'Код не найден или устарел — получите новый в игре' : e.status === 429 ? 'Слишком много попыток — подождите 10 минут' : 'Не удалось привязать — проверьте интернет', true);
    }
  };
  $('twLinkBtn').onclick = go;
  $('twCodeInput').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
// в игре (APK/сайт): код, чтобы играть этим же аккаунтом в панели на Twitch
async function openTwitchCode() {
  const sheet = $('settingsSheet');
  const head = `<div class="q-head"><div><h2>📺 Играть на Twitch</h2></div><button class="btn-icon" id="setClose" type="button">✕</button></div>`;
  const bind = () => { $('setClose').onclick = () => $('settingsOverlay').classList.remove('open'); if ($('twBack')) $('twBack').onclick = () => renderSettings(); };
  sheet.innerHTML = head + '<div class="pf-cover"><div class="spinner"></div></div>'; bind();
  try {
    const r = await api('/api/twitch/code', { method: 'POST' });
    sheet.innerHTML = head + `
      <div class="set-text">Terra 3D можно играть прямо под трансляцией на Twitch — в панели под видео. Чтобы там был этот же аккаунт (прогресс, друзья, альянс, топ):</div>
      <ol class="set-steps"><li>Откройте канал на Twitch, где под видео есть панель Terra 3D</li><li>В панели: ⚙️ → «🔗 Привязать аккаунт из игры»</li><li>Введите код:</li></ol>
      <div class="code-card"><div class="cc-info"><div class="cc-lbl">Код для Twitch · 10 минут</div><div class="cc-code">${esc(r.code)}</div></div>
        <button class="btn-small soft" id="twCopy" type="button">📋</button></div>
      <button class="btn-soft" id="twBack" type="button">← Назад</button>`;
    bind();
    $('twCopy').onclick = () => copyText(r.code, 'Код скопирован');
  } catch (e) {
    sheet.innerHTML = head + `<div class="set-text">Не удалось получить код — проверьте интернет и попробуйте ещё раз.</div><button class="btn-soft" id="twBack" type="button">← Назад</button>`;
    bind();
  }
}
async function unlinkTwitch() {
  const ok = await askConfirm(IS_TWITCH
    ? { title: 'Отвязать аккаунт из игры?', text: 'Здесь, на Twitch, начнётся отдельная игра с нуля. Аккаунт в игре на телефоне и сайте не изменится.', ok: 'Отвязать', danger: true }
    : { title: 'Отвязать Twitch?', text: 'В панели на Twitch больше не будет этого аккаунта. Прогресс в игре не изменится.', ok: 'Отвязать' });
  if (!ok) return;
  try { await api('/api/twitch/unlink', { method: 'POST' }); } catch (e) { showToast('Не удалось — проверьте интернет', 3000); return; }
  twitchLinked = false;
  if (IS_TWITCH) {
    if (canSync()) { try { await Promise.race([syncNow(), new Promise(r => setTimeout(r, 3000))]); } catch (e) {} }
    playing = false; clearTimeout(syncTimer);
    ui.tab = null; document.body.classList.remove('panel-open');
    social = null; allyList = null; lbData = null;
    twitchLogin();
  } else { showToast('Twitch отвязан', 2500); }
}

// ---------- Вход через Google (через браузер: и на сайте, и в APK) ----------
const PENDING_KEY = 'terra_pending_login';
const PENDING_TTL_MS = 15 * 60 * 1000;

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function startGoogleLogin() { return startOAuthLogin('google'); }
// Вход через Google или Яндекс ID — одинаковая схема: браузер → провайдер → наш сервер → одноразовый код → игра
async function startOAuthLogin(provider) {
  if (!CONFIGURED) return;
  const name = provider === 'yandex' ? 'Яндекс' : 'Google';
  showLoginError('');
  let url;
  try {
    // verifier знает только эта игра; сервер получит лишь его хэш
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const st = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    localStorage.setItem(PENDING_KEY, JSON.stringify({ state: st, verifier, t: Date.now() }));
    url = `${CONFIG.API_URL}/auth/${provider}/start?state=${st}&challenge=${challenge}&app=${IS_APP ? 1 : 0}${IS_APP ? '&build=' + MY_BUILD : ''}`;
  } catch (e) {
    showLoginError('Этот браузер не поддерживает безопасный вход. Обновите его или откройте игру в Chrome.');
    return;
  }
  if (IS_APP) {
    setLoginBusy(true, `Продолжите вход в открывшемся окне ${name}…`, true);
    try { window.TerraNative.openExternal(url); }
    catch (e) { setLoginBusy(false); showLoginError('Не удалось открыть браузер для входа.'); }
  } else {
    setLoginBusy(true, `Переходим в ${name}…`);
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
    showLogin(error === 'cancelled' ? 'Вход отменён.' : 'Вход не подтверждён. Попробуйте ещё раз.');
    return;
  }
  if (!code || !pending || pending.state !== st || Date.now() - pending.t > PENDING_TTL_MS) {
    showLogin('Ссылка входа устарела. Нажмите кнопку входа ещё раз.');
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

// Сайт переехал на новый адрес: старый адрес передаёт сюда вход и сохранение (#move=…), чтобы не входить заново.
// Принимаем, только если пришли именно со старого адреса игры и на новом ещё не вошли.
function adoptMovedSession() {
  const h = location.hash || '';
  if (!h.startsWith('#move=')) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
  try {
    const from = new URL(String(window.TERRA_MOVED_FROM || '')).origin;
    if (!document.referrer || new URL(document.referrer).origin !== from || loadSession()) return;
    const d = JSON.parse(decodeURIComponent(h.slice(6)));
    const s = d && d.session;
    if (!s || typeof s.token !== 'string' || s.token.length > 2000 || typeof s.uid !== 'string' || !/^[\w-]{1,128}$/.test(s.uid)) return;
    localStorage.setItem('terra_session', JSON.stringify({ token: s.token, uid: s.uid, nickname: typeof s.nickname === 'string' ? s.nickname : null }));
    if (d.save && typeof d.save === 'object' && !readLocal(s.uid)) localStorage.setItem('terra_save_' + s.uid, JSON.stringify(d.save));
  } catch (e) {}
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
function showLoginError(msg, hint) { $('loginError').innerText = msg || ''; $('loginError').classList.toggle('hint', !!hint); }

function showLogin(message) {
  closeAllOverlays();
  $('loginOverlay').classList.add('open');
  setLoginBusy(false);
  showLoginError(message || '');
  $('demoBtn').hidden = false;
  $('googleBtn').hidden = !CONFIGURED || IS_TWITCH;
  $('yandexBtn').hidden = !CONFIGURED || IS_TWITCH || !LOGINS.yandex;
  $('twitchBtn').hidden = !(IS_TWITCH && CONFIGURED);
  if (IS_TWITCH) {
    const viewer = /^U/.test(twitchUser) && !!twitchToken;
    $('twitchBtn').disabled = !viewer;
    if (!viewer && !message) showLoginError('Войдите в Twitch (кнопка «Войти» вверху страницы), чтобы играть с сохранением и попасть в топ. Или сыграйте гостем.', true);
  }
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
  grantOffline((Date.now() - (state.lastSave || Date.now())) / 1000);
  bossCooldown = BOSS_FIRST_MIN + Math.random() * (BOSS_FIRST_MAX - BOSS_FIRST_MIN);
  endAsteroid(true);
  star = null; starCooldown = randIn(STAR.first); buffs.frenzy = buffs.wind = 0;
  playing = true;
  lastTick = Date.now();
  ui.tab = null; document.body.classList.remove('panel-open');
  onPlanetChanged();
  renderRankPill();
  updateUserChip();
  if (demo) setSync('demo');
  else if (offline) setSync('off');
  else { setSync('sync'); queueSync(800); fetchLeaderboard(); }
  if (CONFIGURED && !demo && offline) queueSync(5000);
  checkUpdate();
  if (canOnline()) setTimeout(() => { fetchSocial(); fetchChatSummary(); }, 1500);   // бонус альянса и непрочитанные сообщения
  setTimeout(tutStart, 900);
  // награды: за вход (раз в день), недели (с сервера), финал
  popupQueue.length = 0; weeklyChecked = false; weeklyData = null;
  promptLogin();
  if (canOnline()) setTimeout(fetchWeeklyRewards, 2500);
  setTimeout(checkLegend, 2000);
}

// офлайн-доход: 50% дохода до 8 часов; «Капсула времени» добавляет +10% и +2 ч за уровень
function grantOffline(sec) {
  const cap = perk('time_capsule');
  sec = Math.min(sec, OFFLINE_MAX_SEC + cap * 7200);
  if (sec <= 60) return;
  const eff = OFFLINE_EFFICIENCY + cap * 0.1;
  let shown = 0;
  state.unlocked.forEach(pid => {
    const r = withoutBuffs(() => rates(pid));
    for (const k in r) {
      if (r[k] <= 0) continue;
      const add = r[k] * sec * eff;
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
  if (IS_TWITCH) { twitchBoot(); return; }
  adoptMovedSession();
  const fromHash = readAuthFromHash();
  if (fromHash) { await completeLogin(fromHash.code, fromHash.state, fromHash.error); return; }
  session = loadSession();
  if (!session) { showLogin(); return; }
  setLoginBusy(true, 'Загружаем ваш прогресс…');
  try {
    const me = await api('/api/me');
    session.nickname = me.profile ? me.profile.nickname : null;
    twitchLinked = !!me.twitch;
    isAdmin = !!me.admin;
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
  session = null; myProfile = null; lbData = null; demo = false; needsReconcile = false; clientOutdated = false; isAdmin = false;
  chat.lists = {}; chat.summary = null; setAllyBonus(0);
  state = defaultState();
  endAsteroid(true);
  particles = []; ripples = []; debris = []; star = null; buffs.frenzy = buffs.wind = 0; loginPromptDay = ''; popupQueue.length = 0;
  ui.tab = null; document.body.classList.remove('panel-open');
  social = null; allyList = null;
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
    if (r.admin) {   // секретный код администратора — включает чит-меню
      isAdmin = true;
      $('codeOverlay').classList.remove('open');
      Sound.unlock(); vibrate([30, 40, 30]);
      showToast('🛠️ Режим администратора включён: ⚙️ Настройки → Чит-меню', 4000);
      openSettings(); openCheats();
      return;
    }
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
const SITE_VERSION = (typeof window.TERRA_SITE_VERSION === 'string') ? window.TERRA_SITE_VERSION : '';
let lastUpdateCheck = 0;
async function checkUpdate(force = false) {
  if (!CONFIGURED) return;
  if (!IS_APP && !SITE_VERSION) return;          // сайт без отметки версии (локальная сборка) — проверять нечего
  if (IS_APP && !MY_BUILD) return;
  lastUpdateCheck = Date.now();
  try {
    const r = await api('/api/client');
    if (!IS_APP) {
      // на сервере уже другая версия сайта — перезагружаемся, чтобы не играть на старом коде
      if (r && r.site && r.site !== SITE_VERSION) reloadForNewVersion();
      return;
    }
    if (r && r.update && r.latest && r.latest.build > MY_BUILD) {
      updateInfo = r.latest;
      if (r.required) showForcedUpdate(r.latest); else maybeShowUpdate(force);
    }
  } catch (e) {}
}
let reloading = false;
function reloadForNewVersion() {
  if (reloading) return;
  reloading = true;
  if (playing) saveLocal();
  showToast('🔄 Игра обновилась — загружаем новую версию…', 4000);
  setTimeout(() => location.reload(), 1500);
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
setInterval(() => { if (playing && !document.hidden) checkUpdate(); }, 10 * 60 * 1000);
// вернулись в игру (вкладка/приложение снова на экране) — проверить версию и освежить топ
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !playing) return;
  if (Date.now() - lastUpdateCheck > 60000) checkUpdate();
  if (ui.tab === 'top') fetchLeaderboard();
});

// ---------- Диалоги ----------
function closeAllOverlays() {
  ['nickOverlay', 'profileOverlay', 'allyOverlay', 'settingsOverlay', 'confirmOverlay', 'loginOverlay', 'mapOverlay', 'questsOverlay', 'shopOverlay', 'codeOverlay', 'chestOverlay', 'loginRewardOverlay', 'weeklyOverlay'].forEach(id => $(id).classList.remove('open'));
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
// Топ «живой»: обновляется сам каждые 10 с, сразу после каждой синхронизации и при возврате в игру,
// а своя строка между запросами считается по локальному прогрессу — без кнопки ⟳.
let lbData = null, lbLoading = false, lbError = false, lbVer = 0, lbFetching = false, lbAt = 0;
const lbPrevRanks = new Map();   // «доска:ник» → место при прошлом показе (для подсветки, кто поднялся)
async function fetchLeaderboard() {
  if (!CONFIGURED || demo || !session || lbFetching) return;
  if (ui.lbBoard === 'ally') { ui.allyPeriod = ui.lbPeriod; fetchAlliances(); return; }   // топ альянсов
  const key = ui.lbBoard + ':' + ui.lbPeriod;
  lbFetching = true; lbLoading = true;
  if (!lbData) { lbVer++; if (ui.tab === 'top') renderPanel(); }   // скелетон — только при первой загрузке
  try {
    const d = await api(`/api/leaderboard?limit=50&board=${ui.lbBoard}&period=${ui.lbPeriod}`);
    if (key === ui.lbBoard + ':' + ui.lbPeriod) { lbData = d; lbError = false; lbAt = Date.now(); }
    // общий топ знает актуальное место — обновим и плашку 🏆 на главном экране
    if (d && d.board === 'all' && d.period === 'all' && d.me && d.me.rank && myProfile) { myProfile.rank = d.me.rank; renderRankPill(); }
  } catch (e) { if (key === ui.lbBoard + ':' + ui.lbPeriod) lbError = true; }
  lbFetching = false; lbLoading = false; lbVer++;
  if (ui.tab === 'top') renderPanel();
  // пока грузили, переключили доску — догружаем нужную
  if (key !== ui.lbBoard + ':' + ui.lbPeriod) fetchLeaderboard();
}
setInterval(() => { if (playing && ui.tab === 'top' && !document.hidden) fetchLeaderboard(); }, 10000);

// Свой результат прямо сейчас (по локальному прогрессу) — такой же, какой посчитает сервер
const LB_PRESTIGE = 10000000, LB_STAGE = 100000;
function myLocalEntry(board, period) {
  if (!myProfile) return null;
  if (board === 'all') {
    if (period === 'week') return null;   // недельный прирост знает только сервер
    return { score: progressOf(state), rebirths: totalPrestige(), era: ps('earth').era };
  }
  if (board.startsWith('u_')) {   // престижи измерения
    const u = board.slice(2);
    if (period === 'week' || !UNIVERSES[u] || !state.unis.includes(u)) return null;
    return { score: uniPrestige(u), prestige: uniPrestige(u) };
  }
  if (!PLANETS[board] || !isUnlocked(board)) return null;
  const b = Math.min(planetBuildings(board), LB_STAGE - 1), pr = prestigeCount(board), era = ps(board).era;
  return { score: pr * LB_PRESTIGE + era * LB_STAGE + b, prestige: pr, era, buildings: b };
}
// Ответ сервера + свой свежий результат: обновляем свою строку, пересортировываем, пересчитываем своё место
function mergedLeaderboard(d, board, period) {
  const nick = myProfile ? myProfile.nickname : '', lc = nick.toLowerCase();
  let players = d.players.map(p => ({ ...p }));
  let me = d.me ? { ...d.me } : null;
  const local = myLocalEntry(board, period);
  if (local && local.score > 0) {
    const i = players.findIndex(p => p.nickname.toLowerCase() === lc);
    const cur = i >= 0 ? players[i] : null;
    if (!cur || local.score > cur.score) {
      const row = { ...(cur || {}), nickname: nick, ...local, score: Math.max(local.score, cur ? cur.score : 0) };
      if (i >= 0) players[i] = row; else players.push(row);
      players.sort((a, b) => b.score - a.score);
      players = players.slice(0, 50);
      const pos = players.findIndex(p => p.nickname.toLowerCase() === lc);
      me = { ...(me || {}), ...local, score: row.score };
      if (pos >= 0) me.rank = pos + 1;
    }
  }
  return { players, me };
}
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
  if (board.startsWith('u_')) return `<span class="lb-pts">🌀 ${period === 'week' ? '+' : ''}${fmt(p.score)}</span><span>${plural(p.score, 'престиж', 'престижа', 'престижей')}</span>`;
  return `<span>🌀 ${fmt(p.prestige || 0)} · ${PL(board).stageWord} ${p.era + 1}</span><span>🏗 ${fmt(p.buildings)}</span>`;
}

// Доски топа: общий, три измерения (престижи и планеты каждого) и альянсы
function lbBoardsHtml(board) {
  const uni = board.startsWith('u_') ? board.slice(2) : PLANETS[board] ? uniOf(board) : null;
  const top = [['all', '🏆 Общий'], ...UNIVERSE_ORDER.map(u => ['u_' + u, `${UNIVERSES[u].icon} ${UNIVERSES[u].short}`]), ['ally', '🛡️ Альянсы']];
  let html = `<div class="lb-boards top">${top.map(([id, label]) => `<button class="lb-board ${id === board || (id === 'u_' + uni) ? 'active' : ''}" data-action="lbboard" data-id="${id}" type="button">${label}</button>`).join('')}</div>`;
  if (uni) html += `<div class="lb-boards sub">${[['u_' + uni, '🌀 Престижи'], ...UNIVERSES[uni].planets.map(pid => [pid, `${PL(pid).icon} ${PL(pid).name}`])]
    .map(([id, label]) => `<button class="lb-board ${id === board ? 'active' : ''}" data-action="lbboard" data-id="${id}" type="button">${label}</button>`).join('')}</div>`;
  return html;
}
function renderAllyBoardHtml(period) {
  const L = allyList && allyList.period === period ? allyList : null;
  let html = `<div class="lb-head"><div><div class="lb-title">🛡️ Топ альянсов <span class="lb-live ${allyLoading ? 'busy' : ''}">● live</span></div><div class="lb-sub">${L ? 'Альянсов: ' + fmt(L.total) + ' · ' : ''}Мощь = ручные тапы + вложенные 💎 (1 💎 = ${fmt(ALLY_GEM_POWER)} мощи)</div></div><button class="btn-icon ${allyLoading ? 'spin' : ''}" data-action="lbrefresh" type="button">⟳</button></div>
    ${lbBoardsHtml('ally')}
    <div class="seg lb-period">
      <button class="seg-btn ${period === 'week' ? 'active' : ''}" data-action="lbperiod" data-id="week" type="button">📅 За неделю</button>
      <button class="seg-btn ${period === 'all' ? 'active' : ''}" data-action="lbperiod" data-id="all" type="button">♾️ За всё время</button>
    </div>`;
  if (period === 'week' && L && L.week) html += `<div class="lb-week">⏳ Неделя закончится через ${fmtLeft(L.week.endsAt - Date.now())}</div>`;
  if (period === 'week') html += `<div class="lb-prize">🎁 Каждому участнику альянса за место: ${weeklyRewardTable(WEEKLY_ALLY_REWARDS)}</div>`;
  if (!L) html += allyErr ? `<div class="empty"><div class="empty-ico">📡</div><div class="empty-title">Не удалось загрузить</div></div>` : '<div class="skeleton"></div>'.repeat(5);
  else if (!L.alliances.length) html += `<div class="empty"><div class="empty-ico">🛡️</div><div class="empty-title">Пока пусто</div><div class="empty-text">${period === 'week' ? 'На этой неделе альянсы ещё не тапали.' : 'Альянсов пока нет — основатель должен пройти все пять планет.'}</div></div>`;
  else html += allyPodium(L.alliances) + L.alliances.map((a, i) => allyRow(a, i, false)).join('');
  return html;
}
function renderLeaderboardHtml() {
  if (!CONFIGURED || demo) {
    return `<div class="empty"><div class="empty-ico">🏆</div><div class="empty-title">Рейтинг недоступен</div><div class="empty-text">Войдите через Google, чтобы соревноваться с другими игроками.</div></div>`;
  }
  const board = ui.lbBoard, period = ui.lbPeriod, me = myProfile;
  if (board === 'ally') return renderAllyBoardHtml(period);
  const raw = lbData && lbData.board === board && lbData.period === period ? lbData : null;
  const d = raw ? { ...raw, ...mergedLeaderboard(raw, board, period) } : null;
  const ub = board.startsWith('u_') ? UNIVERSES[board.slice(2)] : null;
  const boardName = board === 'all' ? 'Общий топ' : ub ? `Престижи: ${ub.short}` : `Топ: ${PL(board).name}`;
  const note = board === 'all'
    ? (period === 'week' ? 'Очки, набранные с понедельника' : 'Престиж — 100 очков, эпоха или этап — 1')
    : ub ? (period === 'week' ? 'Престижи, сделанные с понедельника' : `Сумма престижей всех планет: ${ub.name}`)
    : (period === 'week' ? 'Лучший результат на этой неделе' : 'Престижи планеты, затем этап и постройки');
  let html = `<div class="lb-head"><div><div class="lb-title">🏆 ${boardName} <span class="lb-live ${lbFetching ? 'busy' : ''}" title="Топ обновляется сам">● live</span></div><div class="lb-sub">${d ? 'Игроков: ' + fmt(d.total) + ' · ' : ''}${note}</div></div><button class="btn-icon ${lbFetching ? 'spin' : ''}" data-action="lbrefresh" type="button">⟳</button></div>
    ${lbBoardsHtml(board)}
    <div class="seg lb-period">
      <button class="seg-btn ${period === 'week' ? 'active' : ''}" data-action="lbperiod" data-id="week" type="button">📅 За неделю</button>
      <button class="seg-btn ${period === 'all' ? 'active' : ''}" data-action="lbperiod" data-id="all" type="button">♾️ За всё время</button>
    </div>`;
  if (period === 'week' && d && d.week) html += `<div class="lb-week">⏳ Неделя закончится через ${fmtLeft(d.week.endsAt - Date.now())} — тогда топ начнётся заново</div>`;
  if (period === 'week' && board === 'all') html += `<div class="lb-prize">🎁 Награды за место в топе недели: ${weeklyRewardTable(WEEKLY_PLAYER_REWARDS)}</div>`;
  if (me) {
    let rank = '—', stat;
    if (board === 'all' && period === 'all') {
      const m = d && d.me;
      rank = (m && m.rank) ? '#' + m.rank : me.rank ? '#' + me.rank : '—';
      const tp = totalPrestige();
      stat = `🌀 ${tp} ${plural(tp, 'престиж', 'престижа', 'престижей')} · ★ ${fmt(Math.max(me.score || 0, progressOf(state)))} · 🪐 ${state.unlocked.length}`;
    } else {
      const m = d && d.me;
      if (m && m.rank) rank = '#' + m.rank;
      if (board === 'all') stat = m ? `+${fmt(m.score)} очков за неделю` : 'На этой неделе пока без очков';
      else if (ub) stat = !state.unis.includes(board.slice(2)) ? '🔒 Измерение ещё не открыто' : m ? `🌀 ${period === 'week' ? '+' : ''}${fmt(m.score)} ${plural(m.score, 'престиж', 'престижа', 'престижей')}` : 'Пока без престижей';
      else if (!isUnlocked(board)) stat = `🔒 Планета ещё не открыта`;
      else stat = m ? `🌀 ${fmt(m.prestige || 0)} · ${PL(board).stageWord} ${m.era + 1} · 🏗 ${fmt(m.buildings)}` : 'Пока без результата';
    }
    const meKey = 'me:' + board + ':' + period, prevMe = lbPrevRanks.get(meKey);
    const meUp = prevMe && rank !== '—' && parseInt(rank.slice(1), 10) < prevMe;
    if (rank !== '—') lbPrevRanks.set(meKey, parseInt(rank.slice(1), 10));
    html += `<div class="lb-me clickable ${meUp ? 'up' : ''}" data-nick="${esc(me.nickname)}"><div class="lb-me-rank">${rank}${meUp ? `<span class="lb-move">▲${prevMe - parseInt(rank.slice(1), 10)}</span>` : ''}</div><div class="avatar" style="${avatarStyle(me.nickname)}">${esc(initialOf(me.nickname))}</div><div class="lb-me-info"><div class="lb-me-name">${esc(me.nickname)}</div><div class="lb-me-stat">${stat}</div></div></div>`;
  }
  if (d && d.players.length) {
    const myLc = me ? me.nickname.toLowerCase() : '';
    html += d.players.map((p, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
      const mine = p.nickname.toLowerCase() === myLc;
      const k = board + ':' + period + ':' + p.nickname.toLowerCase(), prev = lbPrevRanks.get(k);
      lbPrevRanks.set(k, rank);
      const mv = prev && prev !== rank ? (rank < prev ? 'up' : 'down') : '';
      return `<div class="lb-row clickable ${rank <= 3 ? 'top' + rank : ''} ${mine ? 'mine' : ''} ${mv}" data-nick="${esc(p.nickname)}" style="--i:${Math.min(i, 12)}"><div class="lb-rank">${medal}${mv === 'up' ? `<span class="lb-move">▲${prev - rank}</span>` : ''}</div><div class="avatar sm" style="${avatarStyle(p.nickname)}">${esc(initialOf(p.nickname))}</div><div class="lb-name">${esc(p.nickname)}${mine ? '<span class="you">вы</span>' : ''}</div><div class="lb-stat">${lbStat(p, board, period)}</div></div>`;
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
//  ПРОФИЛИ, ДРУЗЬЯ, АЛЬЯНСЫ
// ============================================================
let social = null, socialVer = 0, socialLoading = false, socialErr = false;
const socialMsg = { text: '', kind: '' };
let allyList = null, allyLoading = false, allyErr = false;
const canOnline = () => CONFIGURED && !demo && !!session && !!myProfile;
const ALLY_ERR = {
  already_in_alliance: 'Вы уже в альянсе', need_all_planets: 'Сначала пройдите все этапы на всех планетах', invalid_name: 'Название — от 3 до 20 символов: буквы, цифры, пробел, _ - .',
  name_taken: 'Такое название уже занято', unknown_code: 'Нет альянса с таким кодом', bad_code: 'Проверьте код', closed: 'Альянс закрыт — нужен код приглашения',
  alliance_full: 'В альянсе нет мест', too_many_attempts: 'Слишком много попыток — подождите 10 минут', not_found: 'Альянс не найден', not_leader: 'Это может только лидер'
};
const FRIEND_ERR = {
  own_code: 'Это ваш собственный код 🙂', unknown_code: 'Игрока с таким кодом нет', bad_code: 'Код — это 6 букв и цифр', already_friends: 'Вы уже друзья',
  friends_limit: 'У вас уже 100 друзей', their_friends_limit: 'У этого игрока уже 100 друзей', too_many_attempts: 'Слишком много попыток — подождите 10 минут'
};
function errText(map, e) { return map[e && e.message] || (e && e.status ? 'Не получилось, попробуйте ещё раз' : 'Нет связи с сервером'); }

async function fetchSocial() {
  if (!canOnline() || socialLoading) return;
  socialLoading = true; socialVer++;
  try {
    social = await api('/api/social'); socialErr = false;
    // для достижений «Не один во Вселенной», «Экипаж», «Плечом к плечу»
    const f = social.friends.length;
    if (f > (state.stats.friends || 0)) state.stats.friends = f;
    if (social.alliance && !state.stats.alliance) state.stats.alliance = 1;
    setAllyBonus(social.alliance ? social.alliance.level : 0);
    if (social.admin) isAdmin = true;
  } catch (e) { socialErr = true; }
  socialLoading = false; socialVer++;
  if (ui.tab === 'social') { renderPanel(); if (ui.socialTab === 'ally' && social && !social.alliance && !allyList) fetchAlliances(); }
}
setInterval(() => { if (playing && ui.tab === 'social' && !document.hidden) fetchSocial(); }, 20000);

async function fetchAlliances() {
  if (!canOnline() || allyLoading) return;
  allyLoading = true; socialVer++; lbVer++;
  const period = ui.allyPeriod;
  try { const d = await api(`/api/alliances?period=${period}`); if (period === ui.allyPeriod) { allyList = d; allyErr = false; } } catch (e) { allyErr = true; }
  if (ui.tab === 'top' && ui.lbBoard === 'ally' && ui.lbPeriod !== ui.allyPeriod) { ui.allyPeriod = ui.lbPeriod; }
  allyLoading = false; socialVer++; lbVer++;
  if (ui.tab === 'social' || ui.tab === 'top') renderPanel();
  if (period !== ui.allyPeriod) fetchAlliances();
}

function setSocialMsg(text, kind) { socialMsg.text = text; socialMsg.kind = kind || ''; socialVer++; if (ui.tab === 'social') renderPanel(); }
function copyText(text, toast) {
  const done = () => showToast(toast || 'Скопировано', 2200);
  try { navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); } catch (e) { fallbackCopy(text, done); }
}
function fallbackCopy(text, done) {
  const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); done(); } catch (e) { showToast('Код: ' + text, 5000); }
  t.remove();
}
function shareFriendCode(code) {
  const text = `Давай дружить в Terra 3D! Мой код друга: ${code}`;
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else copyText(text, 'Приглашение скопировано — отправьте другу');
}
async function addFriend() {
  const inp = $('friendCodeInput');
  const code = inp ? inp.value.trim() : '';
  if (!code) { setSocialMsg('Введите код друга', 'err'); return; }
  setSocialMsg('Ищем игрока…');
  try {
    const r = await api('/api/friends', { method: 'POST', body: { code } });
    if (social) social.friends = r.friends;
    if (r.friends.length > (state.stats.friends || 0)) state.stats.friends = r.friends.length;
    Sound.coin(); vibrate(20);
    setSocialMsg(`🤝 ${r.nickname} теперь ваш друг!`, 'ok');
    if (inp) inp.value = '';
    saveLocal(); queueSync(1500);
  } catch (e) { Sound.error(); setSocialMsg(errText(FRIEND_ERR, e), 'err'); }
}
async function removeFriend(nick) {
  const ok = await askConfirm({ title: 'Удалить из друзей?', text: `${nick} пропадёт из вашего списка друзей, а вы — из его.`, ok: 'Удалить', danger: true });
  if (!ok) return;
  try {
    const r = await api('/api/friends/remove', { method: 'POST', body: { nickname: nick } });
    if (social) social.friends = r.friends;
    socialVer++; $('profileOverlay').classList.remove('open');
    if (ui.tab === 'social') renderPanel();
    showToast(`${nick} больше не в друзьях`);
  } catch (e) { showToast('Не удалось удалить. Проверьте интернет.'); }
}

function personRow(p, i, extra) {
  return `<div class="person" data-nick="${esc(p.nickname)}" style="--i:${Math.min(i, 12)}">
    ${extra && extra.rank ? `<div class="p-rank">${extra.rank}</div>` : ''}
    <div class="av-wrap"><div class="avatar sm" style="${avatarStyle(p.nickname)}">${esc(initialOf(p.nickname))}</div><i class="online-dot ${p.online ? 'on' : ''}"></i></div>
    <div class="p-info"><div class="p-name">${esc(p.nickname)}${p.leader ? '<span class="lead-badge">👑 лидер</span>' : ''}${p.me ? '<span class="you">вы</span>' : ''}</div>
      <div class="p-sub">${extra && extra.sub ? extra.sub : `★ ${fmt(p.score || 0)}${p.rebirths ? ' · 🌀 ' + fmt(p.rebirths) : ''}${p.alliance ? ' · ' + p.alliance.emblem + ' ' + esc(p.alliance.name) : ''}`}</div></div>
    ${extra && extra.val ? `<div class="p-val">${extra.val}</div>` : ''}
  </div>`;
}

function renderSocialHtml() {
  if (!canOnline()) return `<div class="empty"><div class="empty-ico">👥</div><div class="empty-title">Друзья и альянсы</div><div class="empty-text">Войдите через Google, чтобы добавлять друзей и вступать в альянсы.</div></div>`;
  const tab = ui.socialTab;
  const nf = social ? social.friends.length : 0;
  let html = `<div class="seg" style="--i:0">
      <button class="seg-btn ${tab === 'friends' ? 'active' : ''}" data-action="socialtab" data-id="friends" type="button">👥 Друзья${nf ? ' · ' + nf : ''}</button>
      <button class="seg-btn ${tab === 'ally' ? 'active' : ''}" data-action="socialtab" data-id="ally" type="button">🛡️ Альянс</button>
    </div>`;
  if (!social) {
    return html + (socialErr ? `<div class="empty"><div class="empty-ico">📡</div><div class="empty-title">Не удалось загрузить</div><div class="empty-text">Проверьте интернет — попробуем ещё раз сами.</div></div>` : '<div class="skeleton"></div>'.repeat(4));
  }
  const msg = `<div class="soc-msg ${socialMsg.kind}">${esc(socialMsg.text)}</div>`;
  if (tab === 'friends') {
    html += `<div class="code-card" style="--i:1"><div class="cc-info"><div class="cc-lbl">Ваш код друга</div><div class="cc-code">${esc(social.code)}</div></div>
        <button class="btn-small soft" data-action="copycode" data-id="${esc(social.code)}" type="button">📋</button>
        <button class="btn-small" data-action="sharecode" data-id="${esc(social.code)}" type="button">Пригласить</button></div>
      <div class="add-row" style="--i:2"><input id="friendCodeInput" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Код друга"><button class="btn-small" data-action="addfriend" type="button">Добавить</button></div>
      ${msg}
      <div class="section-header" style="--i:3"><span>Друзья · ${nf}/${social.friendsMax}</span><span>${social.friends.filter(f => f.online).length} в сети</span></div>`;
    html += nf ? social.friends.map((f, i) => personRow(f, i + 4, { val: `<button class="btn-small soft dm-btn" data-action="chatwith" data-id="${esc(f.nickname)}" type="button" title="Написать">✉️</button>` })).join('')
      : `<div class="empty"><div class="empty-ico">🤝</div><div class="empty-title">Пока никого</div><div class="empty-text">Отправьте другу свой код или введите его код выше — и вы сразу друзья у обоих.</div></div>`;
    return html;
  }
  // ---- альянс ----
  const A = social.alliance;
  if (A) {
    html += allyHeroHtml(A, 1) + `
      <div class="code-card" style="--i:2"><div class="cc-info"><div class="cc-lbl">Код приглашения</div><div class="cc-code">${esc(A.code || '')}</div></div>
        <button class="btn-small soft" data-action="copycode" data-id="${esc(A.code || '')}" type="button">📋</button></div>
      <div class="section-header" style="--i:3"><span>⚡ Вклад участников</span><span>за неделю: ⚡${fmt(A.weekPower || 0)}</span></div>
      ${A.members.map((m, i) => personRow(m, i + 4, { rank: i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1, sub: `👆 ${fmt(m.taps)}${m.gems ? ' · 💎 ' + fmt(m.gems) : ''}`, val: `⚡ ${fmt(m.power || 0)}` })).join('')}
      <div class="sheet-actions" style="--i:6;margin-top:4px">
        <button class="btn-soft" data-action="alliance" data-id="${A.id}" type="button">${A.isLeader ? '⚙️ Управление' : '🛡️ Подробнее'}</button>
        <button class="btn-soft" data-action="chatally" type="button">💬 Чат альянса</button>
      </div>`;
    return html;
  }
  html += `<div class="add-row" style="--i:1"><input id="allyCodeInput" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Код альянса"><button class="btn-small" data-action="allyjoincode" type="button">Вступить</button></div>
    ${msg}`;
  // сервер проверит ещё раз по облачному сохранению; локально — чтобы кнопка появилась сразу
  if (social.canCreate || planetsMaxedCount('sol') === UNIVERSES.sol.planets.length) {
    html += `<div class="ally-lock" style="--i:2;border-style:solid;border-color:rgba(250,204,21,0.6)"><div class="al-title">👑 Вы прошли всю Солнечную систему!</div><div class="al-text">Теперь можно основать свой альянс: игроки вступают по коду или из списка, а альянсы соревнуются по тапам.</div><button class="btn-main" data-action="allycreate" type="button">🛡️ Создать альянс</button></div>`;
  } else {
    const pr = social.planets || {};
    html += `<div class="ally-lock" style="--i:2"><div class="al-title">🔒 Свой альянс</div><div class="al-text">Создать альянс может тот, кто прошёл все этапы на всех пяти планетах. Вступить в чужой можно уже сейчас.</div>
      <div class="pf-planets">${UNIVERSES.sol.planets.map(pid => { const x = pr[pid] || { best: 0, max: PL(pid).eras.length - 1, open: false }; const done = x.open && x.best >= x.max;
        return `<div class="pf-pl ${x.open ? '' : 'locked'} ${done ? 'max' : ''}"><span class="pl-ico">${PL(pid).icon}</span><span class="pl-n">${PL(pid).name}</span><span class="pl-bar"><i style="width:${x.open ? Math.round((x.best + 1) / (x.max + 1) * 100) : 0}%"></i></span><span class="pl-v">${done ? '✅' : x.open ? `${x.best + 1}/${x.max + 1}` : '🔒'}</span></div>`; }).join('')}</div></div>`;
  }
  html += `<div class="section-header" style="--i:3"><span>🏆 Альянсы</span><span>${allyList ? 'всего ' + fmt(allyList.total) : ''}</span></div>`;
  if (!allyList) html += allyErr ? '<div class="empty-text" style="text-align:center">Не удалось загрузить список</div>' : '<div class="skeleton"></div>'.repeat(3);
  else if (!allyList.alliances.length) html += `<div class="empty"><div class="empty-ico">🛡️</div><div class="empty-title">Альянсов пока нет</div><div class="empty-text">Пройдите все планеты и станьте первым основателем!</div></div>`;
  else html += allyList.alliances.map((a, i) => allyRow(a, i, true)).join('');
  return html;
}
// сколько планет пройдено до последнего этапа (для альянса и достижения)
function planetsMaxedCount(u = 'sol') { return UNIVERSES[u].planets.filter(pid => isUnlocked(pid) && Math.max(state.stats.maxEra[pid] || 0, ps(pid).era) >= PL(pid).eras.length - 1).length; }
// Карточка своего альянса: уровень, мощь, бонус, кнопка вклада кристаллов
function allyHeroHtml(A, i) {
  const lvl = A.level || 0, next = allyLevelAt(lvl + 1), prev = allyLevelAt(lvl);
  const pct = lvl >= ALLY_LEVEL_MAX ? 100 : Math.max(0, Math.min(100, (A.power - prev) / (next - prev) * 100));
  return `<div class="ally-hero" data-ally="${A.id}" style="--i:${i}">
      <div class="ally-emblem">${A.emblem}<span class="ally-lvl">${lvl}</span></div><div class="ally-name">${esc(A.name)}</div>
      <div class="pf-status">${A.open ? '🔓 открытый' : '🔒 только по коду'} · лидер ${esc(A.leader || '—')}</div>
      <div class="ally-stats">
        <div class="stat-box"><div class="stat-val">#${A.rank}</div><div class="stat-lbl">в топе</div></div>
        <div class="stat-box"><div class="stat-val">⚡${fmt(A.power || 0)}</div><div class="stat-lbl">мощь</div></div>
        <div class="stat-box"><div class="stat-val">${A.size}/${A.max}</div><div class="stat-lbl">участников</div></div>
      </div>
      <div class="ally-level"><div class="al-row"><span>Уровень ${lvl}${lvl >= ALLY_LEVEL_MAX ? ' · максимум' : ''}</span><span>+${Math.round(lvl * ALLY_LEVEL_BONUS * 100)}% к доходу всех участников</span></div>
        <div class="al-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="al-row dim"><span>👆 ${fmt(A.taps)} · 💎 ${fmt(A.gems || 0)} вложено</span><span>${lvl >= ALLY_LEVEL_MAX ? '' : `до ур. ${lvl + 1}: ⚡${fmt(Math.max(0, next - A.power))}`}</span></div></div>
      ${A.isMember ? `<button class="btn-main donate-btn" data-action="allydonate" type="button">💎 Вложить кристаллы в альянс</button>` : ''}
    </div>`;
}
function allyRow(a, i, joinBtn) {
  const rank = i + 1, medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
  const mine = social && social.alliance && social.alliance.id === a.id || (allyList && allyList.mine === a.id);
  return `<div class="ally-row ${mine ? 'mine' : ''} ${rank <= 3 ? 'top' + rank : ''}" data-ally="${a.id}" style="--i:${Math.min(i + 4, 14)}">
    <div class="lb-rank">${medal}</div><div class="a-emb">${a.emblem}<span class="ally-lvl sm">${a.level || 0}</span></div>
    <div class="p-info"><div class="p-name">${esc(a.name)}</div><div class="p-sub">👥 ${a.members}/${allyList ? allyList.max : 30} · ${a.open ? '🔓 открыт' : '🔒 по коду'}${a.gems ? ' · 💎 ' + fmt(a.gems) : ''}</div></div>
    ${joinBtn && a.open && !(social && social.alliance) && a.members < (allyList ? allyList.max : 30)
      ? `<button class="btn-small" data-action="allyjoin" data-id="${a.id}" type="button">Вступить</button>`
      : `<div class="p-val">⚡ ${fmt(a.power || 0)}</div>`}
  </div>`;
}
// Пьедестал тройки лидеров в топе альянсов
function allyPodium(list) {
  if (list.length < 2) return '';
  const top = [list[1], list[0], list[2]].map((a, k) => a ? { a, place: [2, 1, 3][k] } : null);
  return `<div class="podium">${top.map(x => x ? `<div class="pod p${x.place}" data-ally="${x.a.id}"><div class="pod-emb">${x.a.emblem}</div>
    <div class="pod-name">${esc(x.a.name)}</div><div class="pod-pow">⚡${fmt(x.a.power || 0)}</div><div class="pod-step">${x.place}</div></div>` : '<div class="pod empty"></div>').join('')}</div>`;
}

async function joinAlliance(body) {
  try {
    const r = await api('/api/alliance/join', { method: 'POST', body });
    if (social) social.alliance = r.alliance;
    setAllyBonus(r.alliance.level);
    state.stats.alliance = 1;
    Sound.unlock(); vibrate(30);
    setSocialMsg('');
    showToast(`${r.alliance.emblem} Добро пожаловать в альянс «${r.alliance.name}»!`, 4000);
    $('allyOverlay').classList.remove('open');
    ui.socialTab = 'ally';
    if (ui.tab !== 'social') openPanel('social'); else renderPanel();
    saveLocal(); queueSync(1500);
  } catch (e) { Sound.error(); const t = errText(ALLY_ERR, e); setSocialMsg(t, 'err'); if ($('allyOverlay').classList.contains('open')) showToast(t); }
}
function joinAllianceByCode() {
  const inp = $('allyCodeInput');
  const code = inp ? inp.value.trim() : '';
  if (!code) { setSocialMsg('Введите код приглашения', 'err'); return; }
  joinAlliance({ code });
}

// Окно альянса: участники, тапы; лидер — управление (открыт/закрыт, эмблема, новый код, исключить)
async function openAlliance(id) {
  if (!id || !CONFIGURED) return;
  const sheet = $('allySheet');
  sheet.innerHTML = `<div class="pf-cover"><div class="spinner"></div><div class="pf-status">Загружаем альянс…</div></div>`;
  $('allyOverlay').classList.add('open'); Sound.ui();
  let A;
  try { A = await api(`/api/alliance?id=${id}`); } catch (e) {
    // без onclick в разметке: на Twitch такие обработчики запрещены (CSP)
    sheet.innerHTML = `<div class="pf-cover"><button class="btn-icon" id="allyClose" type="button">✕</button><div class="ally-emblem">🛡️</div><div class="pf-status">${e.status === 404 ? 'Альянс больше не существует' : 'Не удалось загрузить — проверьте интернет'}</div></div>`;
    $('allyClose').onclick = () => $('allyOverlay').classList.remove('open');
    return;
  }
  renderAllianceSheet(A);
}
function renderAllianceSheet(A) {
  const sheet = $('allySheet');
  const inAny = social && social.alliance;
  const canJoin = canOnline() && !inAny && A.open && A.size < A.max;
  sheet.innerHTML = `
    <div class="pf-cover"><button class="btn-icon" id="allyClose" type="button">✕</button>
      <div class="ally-emblem">${A.emblem}</div><div class="pf-name">${esc(A.name)}</div>
      <div class="pf-status">#${A.rank} в топе альянсов · уровень ${A.level || 0} · ${A.open ? '🔓 открытый' : '🔒 только по коду'}</div>
      <div class="ally-stats">
        <div class="stat-box"><div class="stat-val">⚡${fmt(A.power || 0)}</div><div class="stat-lbl">мощь</div></div>
        <div class="stat-box"><div class="stat-val">⚡${fmt(A.weekPower || 0)}</div><div class="stat-lbl">за неделю</div></div>
        <div class="stat-box"><div class="stat-val">${A.size}/${A.max}</div><div class="stat-lbl">участников</div></div>
      </div>
      <div class="pf-status">👆 ${fmt(A.taps)} тапов · 💎 ${fmt(A.gems || 0)} вложено · +${Math.round((A.level || 0) * ALLY_LEVEL_BONUS * 100)}% к доходу</div>
    </div>
    <div class="pf-body">
      ${A.isMember && A.code ? `<div class="code-card"><div class="cc-info"><div class="cc-lbl">Код приглашения</div><div class="cc-code">${esc(A.code)}</div></div><button class="btn-small soft" id="allyCopy" type="button">📋</button></div>` : ''}
      ${A.isLeader ? `<div class="pf-sec">Управление</div>
        <div class="set-group">
          <div class="set-row"><span class="s-ico">🔓</span><span class="s-lbl">Открытый альянс<small>Вступить может любой из списка; иначе — только по коду</small></span><button class="switch ${A.open ? 'on' : ''}" id="allyOpen" type="button"></button></div>
          <div class="set-row"><span class="s-ico">🔑</span><span class="s-lbl">Новый код приглашения<small>Старый перестанет работать</small></span><button class="btn-small soft" id="allyNewCode" type="button">Сменить</button></div>
        </div>
        <div class="emblem-pick" id="allyEmblems">${(social && social.emblems || []).map(e => `<button type="button" class="${e === A.emblem ? 'sel' : ''}" data-emb="${e}">${e}</button>`).join('')}</div>` : ''}
      ${A.isMember ? `<button class="btn-main" id="allyDonate" type="button">💎 Вложить кристаллы</button>` : ''}
      <div class="pf-sec">⚡ Участники по вкладу</div>
      <div class="pf-planets">${A.members.map((m, i) => `<div class="person" data-nick="${esc(m.nickname)}">
        <div class="p-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</div>
        <div class="av-wrap"><div class="avatar sm" style="${avatarStyle(m.nickname)}">${esc(initialOf(m.nickname))}</div><i class="online-dot ${m.online ? 'on' : ''}"></i></div>
        <div class="p-info"><div class="p-name">${esc(m.nickname)}${m.leader ? '<span class="lead-badge">👑 лидер</span>' : ''}${m.me ? '<span class="you">вы</span>' : ''}</div><div class="p-sub">👆 ${fmt(m.taps)}${m.gems ? ' · 💎 ' + fmt(m.gems) : ''}</div></div>
        <div class="p-val">⚡ ${fmt(m.power || 0)}</div>
        ${A.isLeader && !m.me ? `<button class="btn-small danger" data-kick="${esc(m.nickname)}" type="button">✕</button>` : ''}
      </div>`).join('')}</div>
      <div class="sheet-stack">
        ${canJoin ? `<button class="btn-main" id="allyJoin" type="button">🛡️ Вступить</button>` : ''}
        ${A.isMember ? `<button class="btn-soft danger" id="allyLeave" type="button">Выйти из альянса</button>` : ''}
      </div>
    </div>`;
  $('allyClose').onclick = () => $('allyOverlay').classList.remove('open');
  if ($('allyCopy')) $('allyCopy').onclick = () => copyText(A.code, 'Код приглашения скопирован');
  if ($('allyJoin')) $('allyJoin').onclick = () => joinAlliance({ id: A.id });
  if ($('allyDonate')) $('allyDonate').onclick = () => openDonate();
  if ($('allyLeave')) $('allyLeave').onclick = () => leaveAlliance(A);
  const settings = async (body) => {
    try { const r = await api('/api/alliance/settings', { method: 'POST', body }); if (social) social.alliance = r.alliance; socialVer++; renderAllianceSheet(r.alliance); Sound.ui(); if (body.newCode) showToast('Новый код: ' + r.alliance.code); }
    catch (e) { showToast(errText(ALLY_ERR, e)); }
  };
  if ($('allyOpen')) $('allyOpen').onclick = () => settings({ open: !A.open });
  if ($('allyNewCode')) $('allyNewCode').onclick = () => settings({ newCode: true });
  if ($('allyEmblems')) $('allyEmblems').onclick = (e) => { const b = e.target.closest('[data-emb]'); if (b && b.dataset.emb !== A.emblem) settings({ emblem: b.dataset.emb }); };
  sheet.querySelectorAll('[data-kick]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const nick = b.dataset.kick;
    if (!(await askConfirm({ title: 'Исключить из альянса?', text: `${nick} покинет «${A.name}». Его тапы останутся в счёте альянса.`, ok: 'Исключить', danger: true }))) return;
    try { const r = await api('/api/alliance/kick', { method: 'POST', body: { nickname: nick } }); if (social) social.alliance = r.alliance; socialVer++; renderAllianceSheet(r.alliance); }
    catch (err) { showToast(errText(ALLY_ERR, err)); }
  });
  sheet.querySelectorAll('.person[data-nick]').forEach(r => r.onclick = (e) => { if (!e.target.closest('button')) openPlayer(r.dataset.nick); });
}
async function leaveAlliance(A) {
  const last = A.size <= 1;
  const ok = await askConfirm({ title: 'Выйти из альянса?', text: last ? 'Вы последний участник — альянс будет удалён.' : A.isLeader ? 'Лидером станет участник с наибольшим вкладом.' : 'Вступить снова можно будет по коду или из списка.', ok: 'Выйти', danger: true });
  if (!ok) return;
  try {
    await api('/api/alliance/leave', { method: 'POST' });
    if (social) social.alliance = null;
    setAllyBonus(0);
    allyList = null; socialVer++;
    $('allyOverlay').classList.remove('open');
    showToast('Вы вышли из альянса');
    if (ui.tab === 'social') { renderPanel(); fetchAlliances(); }
  } catch (e) { showToast(errText(ALLY_ERR, e)); }
}
// Вклад кристаллов в альянс: навсегда превращаются в мощь (1 💎 = ALLY_GEM_POWER) — альянс растёт в топе и в уровне
function openDonate() {
  const A = social && social.alliance;
  if (!A || !canSync()) { showToast(canSync() ? 'Вы не в альянсе' : 'Нужен интернет', 2500); return; }
  const sheet = $('allySheet');
  let amount = Math.min(state.gems, 10);
  const presets = [10, 50, 100, 500].filter(v => v <= Math.max(10, state.gems));
  const draw = () => {
    sheet.innerHTML = `
      <div class="pf-cover"><button class="btn-icon" id="allyClose" type="button">✕</button>
        <div class="ally-emblem">${A.emblem}<span class="ally-lvl">${A.level || 0}</span></div><div class="pf-name">Вклад в «${esc(A.name)}»</div>
        <div class="pf-status">У вас 💎 ${fmt(state.gems)}</div></div>
      <div class="pf-body">
        <div class="set-text">Кристаллы превращаются в мощь альянса: <b>1 💎 = ⚡${fmt(ALLY_GEM_POWER)}</b>. Мощь поднимает альянс в топе и даёт уровни — каждый уровень +${Math.round(ALLY_LEVEL_BONUS * 100)}% к доходу <b>всем</b> участникам.</div>
        <div class="donate-pick">${presets.map(v => `<button type="button" class="${v === amount ? 'sel' : ''}" data-amt="${v}">${v}</button>`).join('')}<button type="button" class="${amount === Math.floor(state.gems) && amount > 0 ? 'sel' : ''}" data-amt="all">Все</button></div>
        <div class="add-row"><input id="donAmt" type="number" min="1" step="1" inputmode="numeric" value="${amount}"><button class="btn-small" id="donGo" type="button">Вложить</button></div>
        <div class="nick-msg" id="donMsg">+⚡${fmt(amount * ALLY_GEM_POWER)} мощи</div>
        <div class="set-text dim">⚠️ Вклад не возвращается — даже если вы выйдете из альянса.</div>
      </div>`;
    $('allyClose').onclick = () => $('allyOverlay').classList.remove('open');
    sheet.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => { amount = b.dataset.amt === 'all' ? Math.floor(state.gems) : +b.dataset.amt; Sound.ui(); draw(); });
    $('donAmt').oninput = () => { amount = Math.max(0, Math.floor(+$('donAmt').value || 0)); $('donMsg').textContent = `+⚡${fmt(amount * ALLY_GEM_POWER)} мощи`; $('donMsg').className = 'nick-msg'; };
    $('donGo').onclick = go;
  };
  const go = async () => {
    const msg = (t, bad) => { $('donMsg').textContent = t; $('donMsg').className = 'nick-msg' + (bad ? ' err' : ''); };
    if (!(amount >= 1)) { msg('Введите, сколько вложить', true); Sound.error(); return; }
    if (amount > state.gems) { msg('Столько кристаллов нет', true); Sound.error(); return; }
    const ok = await askConfirm({ title: `Вложить ${fmt(amount)} 💎?`, text: `Альянс «${A.name}» получит ⚡${fmt(amount * ALLY_GEM_POWER)} мощи. Кристаллы не вернутся.`, ok: 'Вложить' });
    if (!ok) return;
    $('donGo').disabled = true; msg('Вкладываем…');
    try {
      for (let i = 0; i < 40 && syncing; i++) await new Promise(r => setTimeout(r, 150));
      await syncNow();   // сервер списывает кристаллы из облачного сохранения — сначала отправим свежее
      const r = await api('/api/alliance/donate', { method: 'POST', body: { amount } });
      state.gems = Math.max(0, state.gems - r.amount);
      stat('donated', r.amount);
      if (social) social.alliance = r.alliance;
      setAllyBonus(r.alliance.level); socialVer++;
      Sound.evolve(); vibrate([30, 40, 30]);
      saveLocal(); queueSync(800);
      showToast(`💎 Вложено ${fmt(r.amount)} — альянс получил ⚡${fmt(r.amount * ALLY_GEM_POWER)}!${r.levelUp ? ' Новый уровень альянса!' : ''}`, 4000);
      renderAll();
      renderAllianceSheet(r.alliance);
    } catch (e) {
      $('donGo').disabled = false; Sound.error();
      msg(e.message === 'not_enough_gems' ? 'Сервер видит меньше кристаллов — подождите пару секунд и попробуйте снова' : errText(ALLY_ERR, e), true);
    }
  };
  draw();
  $('allyOverlay').classList.add('open'); Sound.ui();
}
function openAllianceCreate() {
  const emblems = (social && social.emblems) || ['🛡️'];
  let pick = emblems[0];
  const sheet = $('allySheet');
  sheet.innerHTML = `
    <div class="pf-cover"><button class="btn-icon" id="allyClose" type="button">✕</button><div class="ally-emblem" id="acEmb">${pick}</div><div class="pf-name">Новый альянс</div><div class="pf-status">Название и эмблему увидят все игроки</div></div>
    <div class="pf-body">
      <input class="nick-input" id="acName" type="text" maxlength="20" autocomplete="off" spellcheck="false" placeholder="Название альянса">
      <div class="emblem-pick" id="acEmblems">${emblems.map(e => `<button type="button" class="${e === pick ? 'sel' : ''}" data-emb="${e}">${e}</button>`).join('')}</div>
      <div class="set-group"><div class="set-row"><span class="s-ico">🔓</span><span class="s-lbl">Открытый<small>Можно вступить из списка без кода</small></span><button class="switch on" id="acOpen" type="button"></button></div></div>
      <div class="nick-msg" id="acMsg"></div>
      <button class="btn-main" id="acCreate" type="button">🛡️ Основать альянс</button>
    </div>`;
  $('allyOverlay').classList.add('open'); Sound.ui();
  $('allyClose').onclick = () => $('allyOverlay').classList.remove('open');
  $('acEmblems').onclick = (e) => { const b = e.target.closest('[data-emb]'); if (!b) return; pick = b.dataset.emb; $('acEmb').textContent = pick; $('acEmblems').querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b)); };
  $('acOpen').onclick = () => $('acOpen').classList.toggle('on');
  $('acCreate').onclick = async () => {
    const name = $('acName').value.trim();
    $('acCreate').disabled = true;
    try {
      if (!social || !social.canCreate) {   // прогресс мог ещё не дойти до сервера — сначала синхронизация
        for (let i = 0; i < 40 && syncing; i++) await new Promise(r => setTimeout(r, 150));
        await syncNow();
      }
      const r = await api('/api/alliance/create', { method: 'POST', body: { name, emblem: pick, open: $('acOpen').classList.contains('on') } });
      if (social) social.alliance = r.alliance;
      state.stats.alliance = 1; socialVer++;
      Sound.evolve(); vibrate([30, 40, 30]);
      showToast(`${r.alliance.emblem} Альянс «${r.alliance.name}» основан!`, 4000);
      renderAllianceSheet(r.alliance);
      if (ui.tab === 'social') renderPanel();
      saveLocal(); queueSync(1500);
    } catch (e) { $('acMsg').textContent = errText(ALLY_ERR, e); $('acMsg').className = 'nick-msg err'; $('acCreate').disabled = false; Sound.error(); }
  };
}

// ---------- профиль игрока ----------
function fmtPlay(sec) { const h = Math.floor(sec / 3600); return h >= 1 ? `${fmt(h)} ч` : `${Math.floor(sec / 60)} мин`; }
function profileStatsHtml(st, extra) {
  const box = (ico, v, l) => `<div class="stat-box"><div class="stat-ico">${ico}</div><div class="stat-val">${v}</div><div class="stat-lbl">${l}</div></div>`;
  return `<div class="stat-grid three">
    ${box('★', fmt(extra.score || 0), 'очки')}${box('🌀', fmt(extra.rebirths || 0), 'престижи')}${box('🏆', extra.rank ? '#' + extra.rank : '—', 'место')}
    ${box('👆', fmt(st.taps || 0), 'тапы')}${box('🏗️', fmt(st.built || 0), 'постройки')}${box('☄️', fmt(st.asteroids || 0), 'астероиды')}
    ${box('🏅', `${st.achievements || 0}/${ACHIEVEMENTS.length}`, 'достижения')}${box('⏱️', fmtPlay(st.playSec || 0), 'в игре')}${box('🧰', fmt(st.chests || 0), 'сундуки')}
    ${box('🌠', fmt(st.stars || 0), 'звёзды')}${box('🔥', '×' + fmt(st.combo || 0), 'лучшее комбо')}${box('📅', fmt(st.streak || 0), 'дней подряд')}
  </div>`;
}
// прошёл ли игрок все 15 планет (по данным профиля с сервера)
const legendOf = (pl) => !!pl && PLANET_ORDER.every(pid => pl[pid] && pl[pid].open && pl[pid].best >= PL(pid).eras.length - 1);
// чем вошёл игрок: Google, Яндекс ID или Twitch (по виду идентификатора аккаунта)
function accountKind() { const u = currentUid() || ''; return u.startsWith('ya_') ? 'Яндекс ID' : u.startsWith('tw_') ? 'Аккаунт Twitch' : 'Аккаунт Google'; }
function profilePlanetsHtml(pl) {
  // измерения, где у игрока нет ни одной открытой планеты, не показываем (кроме Солнечной)
  return UNIVERSE_ORDER.filter(u => u === 'sol' || UNIVERSES[u].planets.some(pid => pl[pid] && pl[pid].open))
    .map(u => `${u === 'sol' ? '' : `<div class="pf-uni">${UNIVERSES[u].icon} ${UNIVERSES[u].name}</div>`}<div class="pf-planets">${UNIVERSES[u].planets.map(pid => {
    const x = pl[pid] || { open: false, stage: 0, best: 0, prestige: 0 };
    const max = PL(pid).eras.length - 1, done = x.open && x.best >= max;
    return `<div class="pf-pl ${x.open ? '' : 'locked'} ${done ? 'max' : ''}"><span class="pl-ico">${PL(pid).icon}</span><span class="pl-n">${PL(pid).name}</span>
      <span class="pl-bar"><i style="width:${x.open ? Math.round((x.stage + 1) / (max + 1) * 100) : 0}%"></i></span>
      <span class="pl-v">${x.open ? `${PL(pid).stageWord === 'Эпоха' ? 'эп.' : 'эт.'} ${x.stage + 1}${x.prestige ? ' · 🌀' + fmt(x.prestige) : ''}` : '🔒'}</span></div>`;
  }).join('')}</div>`).join('');
}
function localPlanets() {
  const out = {};
  PLANET_ORDER.forEach(pid => { out[pid] = { open: isUnlocked(pid), stage: ps(pid).era, best: Math.max(state.stats.maxEra[pid] || 0, ps(pid).era), prestige: prestigeCount(pid) }; });
  return out;
}

// Свой профиль: статистика по локальному прогрессу (он свежее), место — с сервера
function openProfile() {
  if (!myProfile) return;
  const p = myProfile, online = canOnline();
  const st = { ...state.stats, achievements: (state.quests.ach || []).length };
  const A = social && social.alliance;
  $('profileSheet').innerHTML = `
    <div class="pf-cover"><button class="btn-icon" id="pfClose" type="button">✕</button>
      <div class="avatar lg" style="${avatarStyle(p.nickname)}">${esc(initialOf(p.nickname))}</div>
      <div class="pf-name">${esc(p.nickname)}</div>
      <div class="pf-status">${online ? `<i class="online-dot on"></i> ${accountKind()} · прогресс в облаке` : 'Гость — прогресс не сохраняется'}</div>
      ${planetsMaxedAll() >= PLANET_ORDER.length ? '<div class="pf-legend">♾️ Легенда всех измерений</div>' : ''}
      ${A ? `<div class="pf-ally" data-ally="${A.id}">${A.emblem} ${esc(A.name)}</div>` : ''}
    </div>
    <div class="pf-body">
      ${profileStatsHtml(st, { score: Math.max(p.score || 0, progressOf(state)), rebirths: totalPrestige(), rank: p.rank })}
      <div class="pf-sec">Планеты</div>
      ${profilePlanetsHtml(localPlanets())}
      ${online && social ? `<div class="code-card"><div class="cc-info"><div class="cc-lbl">Ваш код друга</div><div class="cc-code">${esc(social.code)}</div></div><button class="btn-small" id="pfShare" type="button">Пригласить</button></div>` : ''}
      <div class="sheet-stack">
        ${updateInfo ? `<button class="btn-main" id="pfUpdate" type="button">⬆️ Обновить до ${esc(updateInfo.version)}</button>` : ''}
        ${online ? `<button class="btn-soft" id="pfFriends" type="button">👥 Друзья и альянсы</button>` : ''}
        <button class="btn-soft" id="pfSettings" type="button">⚙️ Настройки и аккаунт</button>
      </div>
      <div class="version">Terra 3D · ${MY_BUILD ? 'версия 1.0.' + MY_BUILD : 'веб-версия'}</div>
    </div>`;
  const close = () => $('profileOverlay').classList.remove('open');
  $('pfClose').onclick = close;
  $('pfSettings').onclick = () => { close(); openSettings(); };
  if ($('pfFriends')) $('pfFriends').onclick = () => { close(); ui.socialTab = 'friends'; openPanel('social'); };
  if ($('pfShare')) $('pfShare').onclick = () => shareFriendCode(social.code);
  if (updateInfo) $('pfUpdate').onclick = () => { close(); downloadUpdate(); };
  const ally = $('profileSheet').querySelector('.pf-ally');
  if (ally) ally.onclick = () => openAlliance(+ally.dataset.ally);
  $('profileOverlay').classList.add('open');
  if (online && !social) fetchSocial().then(() => { if ($('profileOverlay').classList.contains('open') && social && !$('pfShare')) openProfile(); });
}

// Чужой профиль (из топа, друзей, альянса)
async function openPlayer(nick) {
  if (!nick) return;
  if (myProfile && nick.toLowerCase() === myProfile.nickname.toLowerCase()) { openProfile(); return; }
  if (!CONFIGURED) return;
  const sheet = $('profileSheet');
  sheet.innerHTML = `<div class="pf-cover"><button class="btn-icon" id="pfClose" type="button">✕</button><div class="avatar lg" style="${avatarStyle(nick)}">${esc(initialOf(nick))}</div><div class="pf-name">${esc(nick)}</div><div class="pf-status"><span class="spinner"></span></div></div>`;
  $('pfClose').onclick = () => $('profileOverlay').classList.remove('open');
  $('profileOverlay').classList.add('open'); Sound.ui();
  let d;
  try { d = await api(`/api/player?nick=${encodeURIComponent(nick)}`); }
  catch (e) { sheet.querySelector('.pf-status').textContent = e.status === 404 ? 'Игрок не найден' : 'Не удалось загрузить профиль'; return; }
  const ago = d.online ? '<i class="online-dot on"></i> в сети' : '<i class="online-dot"></i> не в сети';
  sheet.innerHTML = `
    <div class="pf-cover"><button class="btn-icon" id="pfClose" type="button">✕</button>
      <div class="avatar lg" style="${avatarStyle(d.nickname)}">${esc(initialOf(d.nickname))}</div>
      <div class="pf-name">${esc(d.nickname)}</div>
      <div class="pf-status">${ago} · 👥 ${fmt(d.friends)} ${plural(d.friends, 'друг', 'друга', 'друзей')}${d.friend ? ' · 🤝 ваш друг' : ''}</div>
      ${legendOf(d.planets) ? '<div class="pf-legend">♾️ Легенда всех измерений</div>' : ''}
      ${d.alliance ? `<div class="pf-ally" data-ally="${d.alliance.id}">${d.alliance.emblem} ${esc(d.alliance.name)}</div>` : ''}
    </div>
    <div class="pf-body">
      ${profileStatsHtml(d.stats, d)}
      <div class="pf-sec">Планеты</div>
      ${profilePlanetsHtml(d.planets)}
      <div class="version">В игре с ${new Date(d.since).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      ${d.friend ? `<button class="btn-main" id="pfDm" type="button">✉️ Написать</button><button class="btn-soft danger" id="pfUnfriend" type="button">Удалить из друзей</button>` : ''}
    </div>`;
  $('pfClose').onclick = () => $('profileOverlay').classList.remove('open');
  if ($('pfUnfriend')) $('pfUnfriend').onclick = () => removeFriend(d.nickname);
  if ($('pfDm')) $('pfDm').onclick = () => { $('profileOverlay').classList.remove('open'); openChatWith(d.nickname); };
  const ally = sheet.querySelector('.pf-ally');
  if (ally) ally.onclick = () => openAlliance(+ally.dataset.ally);
}

// ============================================================
//  ЧАТ: общий, альянса и личные сообщения друзьям
// ============================================================
// Сообщения хранит сервер; пока вкладка чата открыта, игра спрашивает новые каждые 3 секунды,
// а раз в 25 секунд — сводку (есть ли непрочитанное), чтобы показать точку на кнопке «Чат».
const CHAT_MAX = 200;
const chat = { lists: {}, loading: false, err: false, summary: null, sendAt: 0, muted: 0 };
let chatShellVer = 0;
const chatKey = () => ui.chatTab === 'dm' ? 'dm:' + (ui.chatWith || '').toLowerCase() : ui.chatTab;
function chatRead() { try { return JSON.parse(localStorage.getItem('terra_chat_read_' + currentUid())) || {}; } catch (e) { return {}; } }
function markChatRead(key, id) {
  if (!id) return;
  const r = chatRead();
  if ((r[key] || 0) >= id) return;
  r[key] = id;
  try { localStorage.setItem('terra_chat_read_' + currentUid(), JSON.stringify(r)); } catch (e) {}
  updateChatBadge();
}
// непрочитанное: альянс и личные (общий чат — без точки, он слишком живой)
function chatUnread() {
  const S = chat.summary, r = chatRead();
  if (!S) return { ally: 0, dm: {}, dmTotal: 0, global: false };
  const dm = {};
  let dmTotal = 0;
  (S.dms || []).forEach(d => { if (d.lastId > (r['dm:' + d.nickname.toLowerCase()] || 0) && !d.lastMine) { dm[d.nickname.toLowerCase()] = 1; dmTotal++; } });
  return { ally: S.ally && S.ally > (r.ally || 0) && !S.allyMine ? 1 : 0, dm, dmTotal, global: S.global > (r.global || 0) };
}
function updateChatBadge() {
  const u = chatUnread(), n = u.ally + u.dmTotal;
  const b = $('dotChat');
  if (b) { b.hidden = n === 0; b.textContent = n > 9 ? '9+' : n || ''; }
}
async function fetchChatSummary() {
  if (!canOnline() || clientOutdated) return;
  try { chat.summary = await api('/api/chat/summary'); updateChatBadge(); if (ui.tab === 'chat' && ui.chatTab === 'dm' && !ui.chatWith) renderChatBody(); } catch (e) {}
}
setInterval(() => { if (playing && !document.hidden && ui.tab !== 'chat') fetchChatSummary(); }, 25000);
async function fetchChat(full) {
  if (!canOnline() || chat.loading) return;
  if (ui.chatTab === 'dm' && !ui.chatWith) { fetchChatSummary(); return; }
  if (ui.chatTab === 'ally' && social && !social.alliance) return;
  const key = chatKey(), L = chat.lists[key] || (chat.lists[key] = { msgs: [], last: 0, loaded: false });
  chat.loading = true;
  try {
    const q = `ch=${ui.chatTab}${ui.chatWith ? '&with=' + encodeURIComponent(ui.chatWith) : ''}${!full && L.loaded ? '&after=' + L.last : ''}`;
    const r = await api('/api/chat?' + q);
    if (key === chatKey()) {
      const known = new Set(L.msgs.map(m => m.id));
      const add = (r.messages || []).filter(m => !known.has(m.id));
      if (full || !L.loaded) L.msgs = r.messages || []; else L.msgs = L.msgs.concat(add);
      if (L.msgs.length > CHAT_MAX) L.msgs = L.msgs.slice(-CHAT_MAX);
      L.last = L.msgs.length ? L.msgs[L.msgs.length - 1].id : L.last;
      L.loaded = true; chat.err = false; chat.muted = r.mutedUntil || 0; chat.noAlly = !!r.noAlly;
      if (add.length || full || !L.rendered) renderChatList();
      if (ui.tab === 'chat' && !document.hidden) markChatRead(key, L.last);
    }
  } catch (e) {
    chat.err = e.status === 403 ? (e.message || 'forbidden') : true;
    if (key === chatKey()) renderChatList();
  }
  chat.loading = false;
}
setInterval(() => { if (playing && ui.tab === 'chat' && !document.hidden) fetchChat(false); }, 3000);

function chatTime(t) { const d = new Date(t), n = new Date(); const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); return d.toDateString() === n.toDateString() ? hm : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + hm; }
function renderChatShell(container) {
  const u = chatUnread();
  if (!canOnline()) {
    container.innerHTML = `<div class="empty"><div class="empty-ico">💬</div><div class="empty-title">Чат</div><div class="empty-text">Войдите в аккаунт, чтобы общаться с игроками, альянсом и друзьями.</div></div>`;
    return;
  }
  const tab = ui.chatTab;
  container.innerHTML = `<div class="chat-wrap">
    <div class="seg seg3x chat-tabs">
      <button class="seg-btn ${tab === 'global' ? 'active' : ''}" data-action="chattab" data-id="global" type="button">🌍 Общий</button>
      <button class="seg-btn ${tab === 'ally' ? 'active' : ''}" data-action="chattab" data-id="ally" type="button">🛡️ Альянс${u.ally ? ' <i class="cb">•</i>' : ''}</button>
      <button class="seg-btn ${tab === 'dm' ? 'active' : ''}" data-action="chattab" data-id="dm" type="button">✉️ Личные${u.dmTotal ? ` <i class="cb">${u.dmTotal}</i>` : ''}</button>
    </div>
    <div class="chat-body" id="chatBody"></div>
  </div>`;
  renderChatBody();
}
function renderChatBody() {
  const body = $('chatBody');
  if (!body) return;
  if (ui.chatTab === 'dm' && !ui.chatWith) {   // список друзей для личных сообщений
    const friends = social ? social.friends : null, S = chat.summary, u = chatUnread();
    if (!friends) { body.innerHTML = '<div class="skeleton"></div>'.repeat(3); if (!socialLoading) fetchSocial(); return; }
    if (!friends.length) { body.innerHTML = `<div class="empty"><div class="empty-ico">✉️</div><div class="empty-title">Личные сообщения</div><div class="empty-text">Писать можно друзьям. Добавьте друга по коду во вкладке «Друзья».</div><button class="btn-small" data-action="gofriends" type="button" style="margin-top:10px">👥 К друзьям</button></div>`; return; }
    const last = {};
    ((S && S.dms) || []).forEach(d => { last[d.nickname.toLowerCase()] = d; });
    const sorted = friends.slice().sort((a, b) => ((last[b.nickname.toLowerCase()] || {}).at || 0) - ((last[a.nickname.toLowerCase()] || {}).at || 0));
    body.innerHTML = `<div class="chat-dms">${sorted.map((f, i) => { const d = last[f.nickname.toLowerCase()], unread = u.dm[f.nickname.toLowerCase()];
      return `<button class="dm-row ${unread ? 'unread' : ''}" data-action="chatwith" data-id="${esc(f.nickname)}" type="button" style="--i:${Math.min(i, 12)}">
        <span class="av-wrap"><span class="avatar sm" style="${avatarStyle(f.nickname)}">${esc(initialOf(f.nickname))}</span><i class="online-dot ${f.online ? 'on' : ''}"></i></span>
        <span class="dm-info"><b>${esc(f.nickname)}</b><i>${d ? (d.lastMine ? 'Вы: ' : '') + esc(d.lastText) : 'Напишите первым 👋'}</i></span>
        <span class="dm-meta">${d ? chatTime(d.at) : ''}${unread ? '<i class="cb">•</i>' : ''}</span></button>`; }).join('')}</div>`;
    return;
  }
  const head = ui.chatTab === 'dm'
    ? `<div class="chat-head"><button class="btn-small soft" data-action="chatback" type="button">←</button><span class="avatar sm" style="${avatarStyle(ui.chatWith)}">${esc(initialOf(ui.chatWith))}</span><b data-nick="${esc(ui.chatWith)}">${esc(ui.chatWith)}</b></div>`
    : ui.chatTab === 'ally' && social && social.alliance ? `<div class="chat-head"><span class="a-emb">${social.alliance.emblem}</span><b>${esc(social.alliance.name)}</b><span class="dim">· ${social.alliance.size} в альянсе</span></div>` : '';
  body.innerHTML = `${head}<div class="chat-list" id="chatList"></div>
    <div class="chat-input"><input id="chatInput" type="text" maxlength="200" autocomplete="off" enterkeyhint="send" placeholder="${ui.chatTab === 'global' ? 'Сообщение всем игрокам…' : ui.chatTab === 'ally' ? 'Сообщение альянсу…' : 'Сообщение для ' + esc(ui.chatWith) + '…'}"><button class="btn-small chat-send" data-action="chatsend" type="button">➤</button></div>
    <div class="chat-note" id="chatNote">${ui.chatTab === 'global' ? 'Будьте вежливы: мат скрывается, ссылки запрещены, за спам — блокировка чата.' : ''}</div>`;
  const L = chat.lists[chatKey()];
  if (L) L.rendered = false;
  renderChatList();
  fetchChat(!L || !L.loaded);
}
function renderChatList() {
  const el = $('chatList');
  if (!el) return;
  const L = chat.lists[chatKey()];
  if (L) L.rendered = true;
  if (ui.chatTab === 'ally' && social && !social.alliance) {
    el.innerHTML = `<div class="empty"><div class="empty-ico">🛡️</div><div class="empty-title">Вы не в альянсе</div><div class="empty-text">Вступите в альянс во вкладке «Друзья» — здесь появится чат альянса.</div><button class="btn-small" data-action="goally" type="button" style="margin-top:10px">🛡️ Найти альянс</button></div>`;
    if ($('chatInput')) $('chatInput').disabled = true;
    return;
  }
  if (!L || !L.loaded) { el.innerHTML = chat.err ? `<div class="empty"><div class="empty-ico">📡</div><div class="empty-text">${chat.err === 'not_friends' ? 'Писать можно только друзьям' : 'Не удалось загрузить — попробуем ещё раз'}</div></div>` : '<div class="chat-loading"><span class="spinner"></span></div>'; return; }
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  const myLc = myProfile ? myProfile.nickname.toLowerCase() : '';
  let prevNick = '', prevAt = 0;
  el.innerHTML = L.msgs.length ? L.msgs.map(m => {
    const mine = m.nickname.toLowerCase() === myLc, cont = m.nickname === prevNick && m.at - prevAt < 120000;
    prevNick = m.nickname; prevAt = m.at;
    return `<div class="msg ${mine ? 'mine' : ''} ${cont ? 'cont' : ''} ${m.sys ? 'sys' : ''}" data-mid="${m.id}">
      ${mine || cont ? '' : `<span class="avatar sm" style="${avatarStyle(m.nickname)}" data-nick="${esc(m.nickname)}">${esc(initialOf(m.nickname))}</span>`}
      <div class="bubble">${mine || cont ? '' : `<div class="m-nick" data-nick="${esc(m.nickname)}">${esc(m.nickname)}${m.admin ? ' <i class="adm">🛡️ админ</i>' : ''}${m.ally ? ` <i class="m-ally">${m.ally}</i>` : ''}</div>`}
        <div class="m-text">${esc(m.text)}</div><div class="m-time">${chatTime(m.at)}${isAdmin && !mine ? ` <button class="m-del" data-action="chatdel" data-id="${m.id}" type="button">🗑</button> <button class="m-del" data-action="chatmute" data-id="${esc(m.nickname)}" type="button">🔇</button>` : ''}</div></div>
    </div>`;
  }).join('') : `<div class="empty"><div class="empty-ico">💬</div><div class="empty-text">${ui.chatTab === 'dm' ? 'Здесь пока пусто — напишите первым!' : 'Сообщений пока нет — начните разговор!'}</div></div>`;
  if (atBottom || !L.scrolled) { el.scrollTop = el.scrollHeight; L.scrolled = true; }
  if ($('chatInput')) $('chatInput').disabled = false;
  if (chat.muted > Date.now() && $('chatNote')) $('chatNote').textContent = `🔇 Чат для вас закрыт до ${new Date(chat.muted).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}
const CHAT_ERR = { too_fast: 'Не так быстро — подождите пару секунд', duplicate: 'Это сообщение уже отправлено', muted: 'Вам временно закрыт чат', empty: 'Пустое сообщение',
  not_friends: 'Писать можно только друзьям', no_alliance: 'Вы не в альянсе', too_long: 'Слишком длинное сообщение' };
async function sendChat() {
  const inp = $('chatInput');
  if (!inp) return;
  const text = inp.value.replace(/\s+/g, ' ').trim();
  if (!text) return;
  if (Date.now() - chat.sendAt < 1200) { showToast(CHAT_ERR.too_fast, 1800); return; }
  chat.sendAt = Date.now();
  inp.value = '';
  try {
    const r = await api('/api/chat', { method: 'POST', body: { ch: ui.chatTab, with: ui.chatWith || undefined, text } });
    const L = chat.lists[chatKey()];
    if (L && r.message && !L.msgs.some(m => m.id === r.message.id)) { L.msgs.push(r.message); L.last = Math.max(L.last, r.message.id); L.scrolled = false; renderChatList(); markChatRead(chatKey(), L.last); }
    stat('chatMsgs'); saveLocal();
    Sound.ui();
    setTimeout(() => fetchChat(false), 400);
  } catch (e) {
    inp.value = text;
    Sound.error();
    showToast(CHAT_ERR[e.message] || 'Не отправлено — проверьте интернет', 2500);
    if (e.data && e.data.mutedUntil) chat.muted = e.data.mutedUntil;
  }
}
function openChatWith(nick) {
  ui.chatTab = 'dm'; ui.chatWith = nick;
  if (ui.tab !== 'chat') openPanel('chat'); else { chatShellVer++; renderPanel(); }
}
async function chatAdmin(action, id) {
  if (!isAdmin) return;
  if (action === 'chatmute' && !(await askConfirm({ title: `Закрыть чат для ${id}?`, text: 'Игрок не сможет писать 24 часа.', ok: 'Закрыть чат', danger: true }))) return;
  try {
    await api(action === 'chatdel' ? '/api/chat/delete' : '/api/chat/mute', { method: 'POST', body: action === 'chatdel' ? { id: +id } : { nickname: id, hours: 24 } });
    if (action === 'chatdel') { const L = chat.lists[chatKey()]; if (L) L.msgs = L.msgs.filter(m => m.id !== +id); renderChatList(); }
    showToast(action === 'chatdel' ? 'Сообщение удалено' : `Чат для ${id} закрыт на сутки`, 2500);
  } catch (e) { showToast('Не получилось: ' + (e.message || 'ошибка'), 2500); }
}

// ============================================================
//  ОБУЧЕНИЕ НОВИЧКА
// ============================================================
// Подсказки по шагам: подсветка нужной кнопки и короткий текст. Где нужно действие (тапнуть, открыть
// вкладку, построить) — ждём его; остальное — кнопка «Дальше». Можно пропустить; пройти заново — в настройках.
const TUT_DONE = 99;
const TUT_REWARD = 3;
const TUT = [
  { title: 'Добро пожаловать, командир! 🚀', text: 'Перед вами молодая планета. Вы проведёте её через эпохи — от лавы до звёздной империи, а потом откроете новые миры.', btn: 'Начать' },
  { target: 'planet', title: 'Тапайте по планете 👆', text: 'Каждый тап приносит ☀️ Солнце — главный ресурс Земли. Сделайте 10 тапов.', wait: 'tap', need: 10 },
  { target: '.tab-btn[data-tab="build"]', title: 'Постройки 🏗️', text: 'Откройте вкладку «Постройки» внизу.', wait: 'tab:build' },
  { target: () => document.querySelector('[data-card="solar_collector"] .btn-buy'), title: 'Первая постройка', text: 'Купите «Поглотитель света»: он сам собирает Солнце — даже когда вас нет в игре.', wait: 'build' },
  { target: '.pp-mini', title: 'Цели престижа 🌀', text: 'Здесь видно, сколько осталось до престижа: он сбрасывает планету, но навсегда удваивает её доход.', btn: 'Дальше' },
  { target: '#eraCard', title: 'Эволюция ⏫', text: 'Копите ресурсы и жмите «Эволюция» — планета перейдёт в новую эпоху и откроет новые постройки.', btn: 'Дальше' },
  { target: '.tab-btn[data-tab="dev"]', title: 'Развитие', text: 'Престиж планеты и улучшения за 💎 кристаллы — в одной вкладке.', btn: 'Дальше' },
  { target: '#astPill', close: true, title: 'Астероиды и звёзды ☄️🌠', text: 'Иногда к планете летит астероид — жмите по нему, за сбитые дают 💎 кристаллы. А если пролетит падающая звезда — поймайте её: будет бонус!', btn: 'Дальше' },
  { target: '#questBtn', title: 'Квесты и магазин', text: 'Задания дают 🔷 сапфиры. В магазине за них — сундуки и новые звуки тапа.', btn: 'Дальше' },
  { target: '#mapBtn', title: 'Карта 🪐', text: 'Новые планеты, а дальше — чёрная дыра в измерение CS2 и вселенную Майнкрафт!', btn: 'Дальше' },
  { target: '.tab-btn[data-tab="chat"]', title: 'Чат, друзья и топ', text: 'Общайтесь с игроками, вступайте в альянс и поднимайтесь в рейтинге. Удачи!', btn: `Готово (+${TUT_REWARD} 🔷)` }
];
let tutCount = 0, tutLoop = 0;
const tutOn = () => playing && state.tut !== TUT_DONE && state.tut < TUT.length;
function tutStart() { if (tutOn()) { tutCount = 0; tutRender(); } }
function tutRender() {
  const el = $('coach');
  if (!tutOn()) { el.classList.remove('open'); cancelAnimationFrame(tutLoop); return; }
  const st = TUT[state.tut];
  if (st.close && ui.tab) closePanel();   // дальше подсказки про кнопки по бокам — их видно, когда панель закрыта
  $('coachTitle').textContent = st.title;
  $('coachText').textContent = st.text + (st.wait === 'tap' ? ` (${Math.min(tutCount, st.need)}/${st.need})` : '');
  $('coachNext').hidden = !st.btn;
  $('coachNext').textContent = st.btn || '';
  $('coachStep').textContent = `${state.tut + 1} / ${TUT.length}`;
  el.classList.add('open');
  cancelAnimationFrame(tutLoop);
  const place = () => {
    if (!tutOn()) { el.classList.remove('open'); return; }
    tutLoop = requestAnimationFrame(place);
    const busy = screenBusy();
    el.classList.toggle('hidden', busy);
    if (busy) return;
    let r = null;
    if (st.target === 'planet') r = { left: cx - planetRadius, top: cy - planetRadius, width: planetRadius * 2, height: planetRadius * 2, round: true };
    else if (st.target) {
      const t = typeof st.target === 'function' ? st.target() : document.querySelector(st.target);
      if (t && t.offsetParent !== null) { const b = t.getBoundingClientRect(); r = { left: b.left, top: b.top, width: b.width, height: b.height }; }
    }
    const spot = $('coachSpot'), bub = $('coachBubble');
    if (r) {
      const pad = 6;
      spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;border-radius:${r.round ? '50%' : '16px'}`;
      spot.hidden = false;
      const below = r.top + r.height / 2 < innerHeight / 2;
      bub.style.top = below ? Math.min(innerHeight - bub.offsetHeight - 10, r.top + r.height + 14) + 'px' : Math.max(10, r.top - bub.offsetHeight - 14) + 'px';
    } else { spot.hidden = true; bub.style.top = Math.max(10, (innerHeight - bub.offsetHeight) / 2) + 'px'; }
  };
  place();
}
function tutEvent(ev) {
  if (!tutOn()) return;
  const st = TUT[state.tut];
  if (st.wait !== ev) return;
  if (ev === 'tap' && ++tutCount < st.need) { $('coachText').textContent = `${st.text} (${tutCount}/${st.need})`; return; }
  // шаг засчитан один раз: лишние тапы, пока ждём перехода, не должны перескакивать следующий шаг
  if (tutEvent.wait === state.tut) return;
  const at = tutEvent.wait = state.tut;
  setTimeout(() => { tutEvent.wait = -1; if (state.tut === at) tutNext(); }, ev === 'tap' ? 200 : 450);
}
tutEvent.wait = -1;
function tutNext() {
  if (!tutOn()) return;
  state.tut++;
  tutCount = 0;
  if (state.tut >= TUT.length) {
    state.tut = TUT_DONE;
    state.sapphires += TUT_REWARD;
    Sound.coin();
    showToast(`🎓 Обучение пройдено! +${TUT_REWARD} 🔷 сапфира`, 3500);
    renderHeaderAndEra();
  } else Sound.ui();
  saveLocal(); queueSync(3000);
  tutRender();
}
function tutSkip() { state.tut = TUT_DONE; saveLocal(); tutRender(); Sound.ui(); }
function tutRestart() { state.tut = 0; closePanel(); tutStart(); }

// ============================================================
//  ЧИТ-МЕНЮ АДМИНИСТРАТОРА
// ============================================================
// Включается секретным кодом в поле «Промокод» (сервер помечает аккаунт админом). Нужно для проверки игры:
// любые валюты, престижи вверх и вниз, этапы, все планеты и измерения, астероиды. Сервер принимает
// прогресс админа без ограничения скорости роста рейтинга.
let isAdmin = false;
const cheat = { res: 'gems', amt: 1e6 };
function cheatDone(msg) { state.rebirths = totalPrestige(); saveLocal(); queueSync(400); onPlanetChanged(); renderHeaderAndEra(); if (msg) showToast('🛠️ ' + msg, 1800); Sound.coin(); }
function openCheats() {
  if (!isAdmin) return;
  const sheet = $('settingsSheet'), pid = cur(), P = PL(pid);
  const keys = [['gems', '💎 Кристаллы'], ['sapphire', '🔷 Сапфиры'], ...P.res.map(r => [`${pid}:${r}`, `${RES[r].icon} ${RES[r].name}`]), ['all', '🪐 Все ресурсы всех планет']];
  if (!keys.some(k => k[0] === cheat.res)) cheat.res = 'gems';
  sheet.innerHTML = `
    <div class="q-head"><div><h2>🛠️ Чит-меню</h2><div class="q-sub">Только для администратора · ${P.icon} ${P.name}</div></div><button class="btn-icon" id="setClose" type="button">✕</button></div>
    <div class="set-title">Валюта и ресурсы</div>
    <div class="set-group cheat">
      <div class="cheat-keys">${keys.map(([k, l]) => `<button type="button" class="${k === cheat.res ? 'sel' : ''}" data-ck="${k}">${l}</button>`).join('')}</div>
      <div class="add-row"><input id="chAmt" type="text" inputmode="decimal" value="${cheat.amt}" placeholder="Сколько (можно 1e9)"></div>
      <div class="cheat-amts">${[100, 1e4, 1e6, 1e9, 1e12, 1e15].map(v => `<button type="button" data-ca="${v}">${fmt(v)}</button>`).join('')}</div>
      <div class="cheat-row"><button class="btn-small" data-cop="add" type="button">＋ Добавить</button><button class="btn-small soft" data-cop="sub" type="button">− Забрать</button><button class="btn-small soft" data-cop="set" type="button">= Сделать столько</button></div>
    </div>
    <div class="set-title">Престиж и этап · ${P.name}</div>
    <div class="set-group cheat">
      <div class="cheat-row"><span class="ch-lbl">🌀 Престижей: <b>${prestigeCount(pid)}</b></span>${[-10, -1, 1, 10].map(v => `<button class="btn-small ${v < 0 ? 'soft' : ''}" data-cpr="${v}" type="button">${v > 0 ? '+' : ''}${v}</button>`).join('')}</div>
      <div class="cheat-row"><span class="ch-lbl">⏫ ${P.stageWord}: <b>${ps(pid).era + 1}/${P.eras.length}</b></span><button class="btn-small soft" data-cst="-1" type="button">−1</button><button class="btn-small" data-cst="1" type="button">+1</button><button class="btn-small" data-cst="max" type="button">Макс</button></div>
      <div class="cheat-row"><span class="ch-lbl">🏗️ Построек: <b>${fmt(planetBuildings(pid))}</b></span><button class="btn-small" data-cb="10" type="button">+10 каждой</button><button class="btn-small" data-cb="100" type="button">+100</button><button class="btn-small soft" data-cb="0" type="button">Снести</button></div>
      <div class="cheat-row"><button class="btn-small" data-cx="prestigeAll" type="button">🌀 +1 престиж всем планетам</button><button class="btn-small soft" data-cx="prestigeZero" type="button">Обнулить престижи планеты</button></div>
    </div>
    <div class="set-title">Мир</div>
    <div class="set-group cheat"><div class="cheat-grid">
      <button class="btn-small" data-cx="unlockAll" type="button">🪐 Открыть все планеты и измерения</button>
      <button class="btn-small" data-cx="maxAll" type="button">⭐ Все этапы всех планет — макс</button>
      <button class="btn-small" data-cx="perks" type="button">🌳 Все перки на максимум</button>
      <button class="btn-small" data-cx="items" type="button">🎩 Все образы и звуки</button>
      <button class="btn-small" data-cx="asteroid" type="button">☄️ Астероид сейчас</button>
      <button class="btn-small" data-cx="golden" type="button">✨ Золотой астероид</button>
      <button class="btn-small" data-cx="boost" type="button">⚡ Ускоритель ×2 на час</button>
      <button class="btn-small" data-cx="offline" type="button">😴 +8 часов офлайн-дохода</button>
      <button class="btn-small soft" data-cx="quests" type="button">📜 Новые задания дня</button>
      <button class="btn-small soft" data-cx="tutorial" type="button">🎓 Обучение заново</button>
      <button class="btn-small" data-cx="star" type="button">🌠 Падающая звезда</button>
      <button class="btn-small soft" data-cx="login" type="button">📅 Награда за вход заново</button>
      <button class="btn-small soft" data-cx="weekly" type="button">🏆 Проверить награды недели</button>
      <button class="btn-small soft" data-cx="legend" type="button">♾️ Финал заново</button>
    </div></div>
    <div class="set-text dim">Изменения сохраняются в облако. Рейтинг админа сервер принимает без ограничений — не забудьте вернуть свой прогресс после проверки.</div>
    <button class="btn-soft" id="chBack" type="button">← Настройки</button>`;
  $('setClose').onclick = () => $('settingsOverlay').classList.remove('open');
  $('chBack').onclick = () => renderSettings();
  const amount = () => { const v = Number(String($('chAmt').value).replace(/\s|,/g, '').replace(/[кk]$/i, 'e3')); return isFinite(v) && v >= 0 ? v : 0; };
  sheet.querySelectorAll('[data-ck]').forEach(b => b.onclick = () => { cheat.res = b.dataset.ck; cheat.amt = amount(); openCheats(); });
  sheet.querySelectorAll('[data-ca]').forEach(b => b.onclick = () => { $('chAmt').value = b.dataset.ca; cheat.amt = +b.dataset.ca; Sound.ui(); });
  sheet.querySelectorAll('[data-cop]').forEach(b => b.onclick = () => {
    const v = amount(), op = b.dataset.cop; cheat.amt = v;
    const apply = (key) => { const have = getRes(key); addRes(key, op === 'add' ? v : op === 'sub' ? -v : v - have); };
    if (cheat.res === 'all') state.unlocked.forEach(x => PL(x).res.forEach(r => apply(`${x}:${r}`)));
    else apply(cheat.res);
    cheatDone(`${op === 'add' ? '+' : op === 'sub' ? '−' : '='}${fmt(v)}`); openCheats();
  });
  sheet.querySelectorAll('[data-cpr]').forEach(b => b.onclick = () => { state.ppr[pid] = Math.max(0, prestigeCount(pid) + (+b.dataset.cpr)); cheatDone(`Престижей: ${state.ppr[pid]}`); openCheats(); });
  sheet.querySelectorAll('[data-cst]').forEach(b => b.onclick = () => {
    const max = P.eras.length - 1, v = b.dataset.cst;
    ps(pid).era = v === 'max' ? max : Math.min(max, Math.max(0, ps(pid).era + (+v)));
    state.stats.maxEra[pid] = Math.max(state.stats.maxEra[pid] || 0, ps(pid).era);
    cheatDone(`${P.stageWord} ${ps(pid).era + 1}`); openCheats();
  });
  sheet.querySelectorAll('[data-cb]').forEach(b => b.onclick = () => {
    const v = +b.dataset.cb;
    P.buildings.forEach(x => { if (x.u <= ps(pid).era || v === 0) ps(pid).counts[x.id] = v === 0 ? 0 : (ps(pid).counts[x.id] || 0) + v; });
    cheatDone(v ? `+${v} каждой постройки` : 'Постройки снесены'); openCheats();
  });
  sheet.querySelectorAll('[data-cx]').forEach(b => b.onclick = () => {
    const a = b.dataset.cx;
    if (a === 'prestigeAll') state.unlocked.forEach(x => { state.ppr[x] = prestigeCount(x) + 1; });
    else if (a === 'prestigeZero') state.ppr[pid] = 0;
    else if (a === 'unlockAll') { state.unis = UNIVERSE_ORDER.slice(); PLANET_ORDER.forEach(x => { if (!isUnlocked(x)) state.unlocked.push(x); }); }
    else if (a === 'maxAll') { state.unlocked.forEach(x => { ps(x).era = PL(x).eras.length - 1; state.stats.maxEra[x] = ps(x).era; }); setTimeout(checkLegend, 300); }
    else if (a === 'perks') { GLOBAL_PERKS.forEach(p => { state.perks[p.id] = p.max; }); state.unlocked.forEach(x => PL(x).perks.forEach(p => { state.ppk[x][p.id] = p.max; })); }
    else if (a === 'items') COSMETICS.forEach(c => { if (!state.ownedCosmetics.includes(c.id) && !c.free) state.ownedCosmetics.push(c.id); });
    else if (a === 'asteroid' || a === 'golden') { $('settingsOverlay').classList.remove('open'); endAsteroid(true); spawnAsteroid(a === 'golden'); return; }
    else if (a === 'boost') state.boostUntil = Math.max(Date.now(), state.boostUntil || 0) + 3600000;
    else if (a === 'offline') grantOffline(8 * 3600);
    else if (a === 'quests') { state.quests.day = ''; ensureQuestDay(); updateQuestBadge.n = -1; }
    else if (a === 'tutorial') { $('settingsOverlay').classList.remove('open'); tutRestart(); return; }
    else if (a === 'star') { $('settingsOverlay').classList.remove('open'); star = null; spawnStar(); return; }
    else if (a === 'login') { state.login = { day: '', streak: (state.login && state.login.streak) || 0 }; $('settingsOverlay').classList.remove('open'); setTimeout(openLoginReward, 200); }
    else if (a === 'weekly') { weeklyChecked = false; $('settingsOverlay').classList.remove('open'); fetchWeeklyRewards().then(() => { if (!weeklyData) showToast('🏆 Наград за прошлую неделю нет (или уже забраны)', 2500); }); return; }
    else if (a === 'legend') { state.legend = 0; state.ownedCosmetics = state.ownedCosmetics.filter(id => id !== 'hat_legend' && id !== 'bg-multiverse'); $('settingsOverlay').classList.remove('open'); setTimeout(checkLegend, 300); }
    cheatDone('Готово'); openCheats();
  });
}

// ============================================================
//  СПРАВОЧНИК «КАК ИГРАТЬ»
// ============================================================
const HELP = [
  ['👆', 'Тапы и постройки', 'Тап по планете приносит её главный ресурс. Постройки добывают ресурсы сами — даже когда игра закрыта (до 8 часов, вполсилы). Покупайте по одной или пачкой: ×10, ×50, ×100, MAX.'],
  ['⏫', 'Эпохи и этапы', 'Накопите ресурсы и нажмите «Эволюция»: планета меняет облик и открывает новые постройки. У Земли 15 эпох, у остальных планет по 10 этапов.'],
  ['🌀', 'Престиж', 'Сбрасывает только текущую планету, но навсегда умножает её доход и тап (×2, ×3…) и даёт 💎. Цели видны над постройками и во вкладке «Развитие».'],
  ['💎', 'Кристаллы и улучшения', 'Кристаллы — за престиж, астероиды, звёзды и сундуки. Тратятся во вкладке «Развитие»: Древо Вечности работает на всех планетах, перки планеты — только на ней.'],
  ['☄️', 'Астероиды', 'Раз в несколько минут к планете летит астероид — тапайте по нему, пока не разобьёте. Золотой даёт втрое больше.'],
  ['🌠', 'Падающие звёзды', 'Поймайте звезду — выпадет бонус: тапы ×7, доход ×3, клад за 15 минут, кристаллы или сапфир.'],
  ['📜', 'Квесты и сапфиры', 'Три задания каждый день, достижения и награда за вход (7 дней подряд — бесплатный сундук). Сапфиры 🔷 тратятся в магазине на сундуки и звуки тапа.'],
  ['🪐', 'Планеты и измерения', 'На карте — экспедиции на новые планеты. Пройдите Солнечную систему, и откроется чёрная дыра в измерение CS2, а из него — портал во вселенную Майнкрафт. Первая планета нового измерения начинается с нуля, а прошлые планеты и все престижи остаются — переключайтесь вкладками вверху карты. Каждое измерение +25% к доходу всех планет.'],
  ['🏆', 'Топы и награды недели', 'Общий топ, престижи каждого измерения, топы планет и альянсов — за неделю и за всё время. В понедельник лучшие игроки и альянсы прошлой недели получают сапфиры.'],
  ['🛡️', 'Друзья и альянсы', 'Друзья — по коду. В альянсе тапы и вложенные 💎 дают мощь: она поднимает альянс в топе и даёт уровни (+2% дохода всем). Основать альянс может прошедший всю Солнечную систему.'],
  ['💬', 'Чат', 'Общий чат, чат альянса и личные сообщения друзьям. Мат скрывается, ссылки запрещены.'],
  ['♾️', 'Финал', 'Пройдите все этапы на всех 15 планетах — получите титул «Легенда всех измерений», корону и фон «Мультивселенная».']
];
function openHelp() {
  const sheet = $('settingsSheet');
  sheet.innerHTML = `
    <div class="q-head"><div><h2>📖 Как играть</h2><div class="q-sub">Всё самое важное — коротко</div></div><button class="btn-icon" id="setClose" type="button">✕</button></div>
    <div class="help-list">${HELP.map(([i, t, d]) => `<div class="help-row"><span class="help-ico">${i}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}</div>
    <button class="btn-soft" id="helpBack" type="button">← Настройки</button>`;
  $('setClose').onclick = () => $('settingsOverlay').classList.remove('open');
  $('helpBack').onclick = () => renderSettings();
  if (!$('settingsOverlay').classList.contains('open')) $('settingsOverlay').classList.add('open');
  sheet.scrollTop = 0;
  Sound.ui();
}

// ============================================================
//  НАСТРОЙКИ
// ============================================================
function openSettings() { renderSettings(); $('settingsOverlay').classList.add('open'); Sound.ui(); }
function renderSettings() {
  const online = canOnline();
  const sw = (id, on) => `<button class="switch ${on ? 'on' : ''}" id="${id}" type="button" aria-pressed="${on}"></button>`;
  $('settingsSheet').innerHTML = `
    <div class="q-head"><div><h2>⚙️ Настройки</h2></div><button class="btn-icon" id="setClose" type="button">✕</button></div>
    <div class="set-title">Звук</div>
    <div class="set-group">
      <div class="set-row"><span class="s-ico">🎵</span><span class="s-lbl">Фоновая музыка<small>Спокойный космический эмбиент</small></span>${sw('setMusic', Sound.music)}</div>
      <div class="set-row vol"><input class="slider" id="setMusicVol" type="range" min="0" max="100" value="${Math.round(Sound.musicVolume * 100)}" ${Sound.music ? '' : 'disabled'}></div>
      <div class="set-row"><span class="s-ico">🔊</span><span class="s-lbl">Звуки<small>Тапы, покупки, астероиды</small></span>${sw('setSfx', Sound.enabled)}</div>
      <div class="set-row vol"><input class="slider" id="setSfxVol" type="range" min="0" max="100" value="${Math.round(Sound.sfxVolume * 100)}" ${Sound.enabled ? '' : 'disabled'}></div>
    </div>
    <div class="set-title">Игра</div>
    <div class="set-group">
      <div class="set-row"><span class="s-ico">📳</span><span class="s-lbl">Вибрация</span>${sw('setVibe', prefs.vibrate)}</div>
      <div class="set-row"><span class="s-ico">🔋</span><span class="s-lbl">Экономия батареи<small>Меньше эффектов и частиц</small></span>${sw('setLowfx', prefs.lowfx)}</div>
      <div class="set-row"><span class="s-ico">🔢</span><span class="s-lbl">Числа<small>${prefs.sci ? 'Научная запись: 1.25e9' : 'Сокращения: 1.25B'}</small></span>
        <div class="seg3"><button type="button" id="setNumShort" class="${prefs.sci ? '' : 'on'}">1.25B</button><button type="button" id="setNumSci" class="${prefs.sci ? 'on' : ''}">1.25e9</button></div></div>
    </div>
    <div class="set-title">Аккаунт</div>
    <div class="sheet-stack">
      ${isAdmin && playing ? '<button class="btn-main" id="setCheats" type="button">🛠️ Чит-меню администратора</button>' : ''}
      ${myProfile ? '<button class="btn-soft" id="setProfile" type="button">👤 Мой профиль и статистика</button>' : ''}
      <button class="btn-soft" id="setCode" type="button">🎁 Ввести промокод</button>
      <button class="btn-soft" id="setHelp" type="button">📖 Как играть — справочник</button>
      ${playing ? '<button class="btn-soft" id="setTut" type="button">🎓 Пройти обучение заново</button>' : ''}
      ${online && !demo && IS_TWITCH && !twitchLinked ? '<button class="btn-main" id="setTwLink" type="button">🔗 Привязать аккаунт из игры</button>' : ''}
      ${online && !demo && IS_TWITCH && twitchLinked ? '<div class="set-text">🔗 Привязан аккаунт из игры — прогресс общий с телефоном и сайтом</div><button class="btn-soft" id="setTwUnlink" type="button">Отвязать аккаунт из игры</button>' : ''}
      ${online && !demo && !IS_TWITCH ? '<button class="btn-soft" id="setTwCode" type="button">📺 Играть на Twitch</button>' : ''}
      ${online && !demo && !IS_TWITCH && twitchLinked ? '<button class="btn-soft" id="setTwUnlink" type="button">Отвязать Twitch</button>' : ''}
      ${updateInfo ? `<button class="btn-main" id="setUpdate" type="button">⬆️ Обновить до ${esc(updateInfo.version)}</button>` : ''}
      ${(session && !IS_TWITCH) || demo ? `<button class="btn-soft" id="setLogout" type="button">🚪 ${demo ? 'Выйти из гостевой игры' : 'Выйти из аккаунта'}</button>` : ''}
      ${playing ? '<button class="btn-soft danger" id="setReset" type="button">♻️ Сбросить прогресс</button>' : ''}
      ${online && !(IS_TWITCH && twitchLinked) ? '<button class="btn-soft danger" id="setDelete" type="button">🗑️ Удалить аккаунт</button>' : ''}
    </div>
    <div class="version">Terra 3D · ${MY_BUILD ? 'версия 1.0.' + MY_BUILD : IS_TWITCH ? 'Twitch' : 'веб-версия'} · <a href="privacy.html" target="_blank" rel="noopener" style="color:inherit">Конфиденциальность</a></div>`;
  const close = () => $('settingsOverlay').classList.remove('open');
  $('setClose').onclick = close;
  $('setMusic').onclick = () => { Sound.setMusic(!Sound.music); renderSettings(); };
  $('setSfx').onclick = () => { Sound.toggle(); renderSettings(); };
  $('setMusicVol').oninput = (e) => Sound.setMusicVolume(e.target.value / 100);
  $('setSfxVol').oninput = (e) => Sound.setSfxVolume(e.target.value / 100);
  $('setSfxVol').onchange = () => Sound.coin();
  $('setVibe').onclick = () => { prefs.vibrate = !prefs.vibrate; savePrefs(); vibrate(25); renderSettings(); };
  $('setLowfx').onclick = () => { prefs.lowfx = !prefs.lowfx; savePrefs(); resizeCanvas(); renderSettings(); };
  $('setNumShort').onclick = () => { prefs.sci = false; savePrefs(); renderSettings(); refreshUIFull(); };
  $('setNumSci').onclick = () => { prefs.sci = true; savePrefs(); renderSettings(); refreshUIFull(); };
  if ($('setProfile')) $('setProfile').onclick = () => { close(); openProfile(); };
  if ($('setCheats')) $('setCheats').onclick = () => openCheats();
  if ($('setTut')) $('setTut').onclick = () => { close(); tutRestart(); };
  $('setHelp').onclick = () => openHelp();
  $('setCode').onclick = () => { close(); openCodes(); };
  if ($('setUpdate')) $('setUpdate').onclick = () => { close(); downloadUpdate(); };
  if ($('setLogout')) $('setLogout').onclick = () => { close(); logout(); };
  if ($('setReset')) $('setReset').onclick = () => { close(); resetGame(); };
  if ($('setDelete')) $('setDelete').onclick = () => { close(); deleteAccount(); };
  if ($('setTwLink')) $('setTwLink').onclick = () => openTwitchLink();
  if ($('setTwCode')) $('setTwCode').onclick = () => openTwitchCode();
  if ($('setTwUnlink')) $('setTwUnlink').onclick = () => { close(); unlinkTwitch(); };
}
function refreshUIFull() { lastPanelSig = ''; buildResourceBar(); refreshUI(); }

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
    ro.observe($('hud'));
    ro.observe($('dock'));
  }
  stars = [];
  for (let i = 0; i < 90; i++) stars.push({ x: Math.random(), y: Math.random(), z: Math.random() * 0.8 + 0.2, s: Math.random() * 1.6 + 0.5, a: Math.random() * 0.6 + 0.4, tw: Math.random() * 6.28 });
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!playing) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (star && Math.hypot(mx - star.x, my - star.y) <= 40) { catchStar(); return; }
    if (activeAsteroid && Math.hypot(mx - activeAsteroid.x, my - activeAsteroid.y) <= activeAsteroid.r + 22) { damageAsteroid(false); return; }
    handlePlanetClick(mx, my);
  });
  requestAnimationFrame(renderFrame);
}

// Планета занимает всё место между верхней панелью и низом экрана (или открытой панелью — тогда она
// плавно уезжает вверх и становится меньше, но по ней можно тапать). Цель — layout, рисуем с плавным переходом.
const layout = { tx: 200, ty: 150, tr: 90, init: false };
let dprNow = 1;
function resizeCanvas() {
  const dpr = dprNow = Math.min(window.devicePixelRatio || 1, prefs.lowfx ? 1.5 : 3);
  cw = window.innerWidth || 380;
  ch = window.innerHeight || 640;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const stage = $('stage');
  const short = ch < 620;
  if (document.body.classList.contains('short') !== short) document.body.classList.toggle('short', short);
  const hudH = $('hud').offsetHeight || 90, dockH = $('dock').offsetHeight || 130;
  stage.style.setProperty('--hud-h', hudH + 'px');
  stage.style.setProperty('--dock-h', dockH + 'px');
  // на низком экране панель — от шапки до меню (планету видно, когда панель закрыта)
  const sheetH = short ? Math.max(160, ch - hudH - dockH - 2) : Math.round(Math.max(230, Math.min(ch * 0.6, ch - hudH - dockH - 170)));
  stage.style.setProperty('--sheet-h', sheetH + 'px');
  const top = hudH + 2, bottom = (ui.tab ? ch - dockH - sheetH : ch - dockH) - 6;
  const areaH = Math.max(80, bottom - top);
  const sideW = cw < 560 ? 66 : 84;   // круглые кнопки по бокам
  layout.tr = Math.max(26, Math.min((cw - 2 * sideW) / 2 / 1.08, areaH / 2.5, 240));
  layout.tx = cw / 2;
  layout.ty = top + areaH / 2 + layout.tr * 0.1;   // чуть ниже середины: сверху место для шапки
  if (!layout.init) { layout.init = true; planetRadius = layout.tr; cx = layout.tx; cy = layout.ty; }
}

function spawnParticles(x, y, color, count = 15, speed = 4, size = 3) {
  if (prefs.lowfx) count = Math.ceil(count / 3);
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

const VENUS_SPOTS = [
  { lon: 0.3, lat: -0.2, r: 0.4 }, { lon: 1.6, lat: 0.3, r: 0.34 }, { lon: 2.8, lat: -0.35, r: 0.38 },
  { lon: 3.9, lat: 0.1, r: 0.42 }, { lon: 5.1, lat: -0.05, r: 0.3 }
];
const MERCURY_CRATERS = [
  { lon: 0.2, lat: -0.3, r: 0.16 }, { lon: 0.9, lat: 0.25, r: 0.1 }, { lon: 1.5, lat: -0.05, r: 0.22 }, { lon: 2.2, lat: 0.45, r: 0.12 },
  { lon: 2.7, lat: -0.4, r: 0.14 }, { lon: 3.3, lat: 0.1, r: 0.26 }, { lon: 4.0, lat: -0.25, r: 0.11 }, { lon: 4.6, lat: 0.35, r: 0.17 },
  { lon: 5.2, lat: -0.1, r: 0.13 }, { lon: 5.8, lat: 0.2, r: 0.2 }, { lon: 1.1, lat: -0.55, r: 0.09 }, { lon: 3.8, lat: 0.55, r: 0.08 }
];
// Венера: под густыми золотистыми облаками — раскалённые равнины; облака редеют, появляются моря и сады
function drawVenus(R, era, now) {
  // поверхность (видна, когда облака поредеют)
  fillSphere(R, era >= 7 ? ['#a16207', '#78350f', '#1c0a02'] : ['#c2410c', '#7c2d12', '#1c0702']);
  VENUS_SPOTS.forEach((b, i) => {
    const p = projectBlob(b, R); if (!p) return;
    if (era >= 7) { // моря
      ctx.fillStyle = 'rgba(14,116,144,0.92)'; ctx.beginPath(); ctx.ellipse(p.px, p.py, p.radX * 0.9, p.radY * 0.62, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(56,189,248,0.45)'; ctx.beginPath(); ctx.ellipse(p.px - p.radX * 0.2, p.py - p.radY * 0.12, p.radX * 0.5, p.radY * 0.3, 0.2, 0, Math.PI * 2); ctx.fill();
    } else { // вулканические равнины
      ctx.fillStyle = `rgba(250,204,21,${0.25 + 0.15 * Math.sin(now / 600 + i)})`; ctx.beginPath(); ctx.ellipse(p.px, p.py, p.radX * 0.35, p.radY * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (era >= 8) { // сады
      ctx.fillStyle = 'rgba(34,197,94,0.85)'; ctx.beginPath(); ctx.ellipse(p.px + p.radX * 0.8, p.py + p.radY * 0.35, p.radX * 0.5, p.radY * 0.35, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(244,114,182,0.7)'; ctx.beginPath(); ctx.arc(p.px + p.radX * 0.75, p.py + p.radY * 0.3, Math.max(1.5, p.radX * 0.08), 0, Math.PI * 2); ctx.fill();
    }
    if (era >= 5 && era < 7) { ctx.fillStyle = 'rgba(41,37,36,0.55)'; ctx.beginPath(); ctx.ellipse(p.px - p.radX * 0.5, p.py + p.radY * 0.3, p.radX * 0.35, p.radY * 0.22, 0, 0, Math.PI * 2); ctx.fill(); } // углеродные шахты
  });
  // облака: волнистые полосы, медленно текут; к 7-му этапу редеют
  const cloudA = era >= 9 ? 0.25 : era >= 8 ? 0.32 : era >= 7 ? 0.42 : era >= 6 ? 0.66 : 0.9;
  const tints = era >= 3 && era < 6 ? ['254,249,195', '217,249,157', '253,224,71'] : ['254,243,199', '253,230,138', '250,204,21'];
  for (let i = 0; i < 9; i++) {
    const y = cy - R + (i + 0.5) * (R * 2 / 9);
    const w = Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy)));
    const wav = Math.sin(now / 2200 + i * 1.3 + cloudAngle * 2) * R * 0.07;
    ctx.fillStyle = `rgba(${tints[i % 3]},${cloudA * (0.6 + 0.4 * ((i * 37) % 10) / 10)})`;
    ctx.beginPath(); ctx.ellipse(cx + wav, y, w * 1.05, R * 0.14, Math.sin(i + now / 4000) * 0.08, 0, Math.PI * 2); ctx.fill();
  }
  drawClouds(R, cloudA * 0.5, '255,251,235');
  if (era >= 6 && era < 9) { // дожди
    ctx.strokeStyle = 'rgba(186,230,253,0.35)'; ctx.lineWidth = 1;
    for (let k = 0; k < 14; k++) { const x = cx - R + ((k * 53 + now / 20) % (R * 2)), y = cy - R * 0.4 + ((k * 31 + now / 9) % (R * 1.2)); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 7); ctx.stroke(); }
  }
  if (era >= 2) drawLights(R, VENUS_SPOTS.map(b => ({ ...b, lat: b.lat * 0.6, r: 0.22 })), Math.min(4, era - 1), '254,240,138'); // парящие города
  if (era >= 4 && era < 9) { ctx.fillStyle = 'rgba(15,23,42,0.18)'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); } // тень зонтика
  if (era >= 9) { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, `rgba(254,249,195,${0.2 + 0.06 * Math.sin(now / 500)})`); g.addColorStop(1, 'rgba(253,230,138,0)'); ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
}
// Меркурий: серые кратеры; рельсовый город на экваторе, солнечные фермы, кузницы
function drawMercury(R, era, now) {
  fillSphere(R, ['#e7e5e4', '#8a8580', '#1c1917']);
  MERCURY_CRATERS.forEach((c, i) => {
    const p = projectBlob(c, R); if (!p) return;
    ctx.fillStyle = 'rgba(41,37,36,0.45)'; ctx.beginPath(); ctx.ellipse(p.px, p.py, p.radX, p.radY * 0.95, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(245,245,244,0.4)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(p.px - p.radX * 0.08, p.py - p.radY * 0.08, p.radX, p.radY * 0.95, 0, Math.PI * 0.9, Math.PI * 1.9); ctx.stroke();
    if (era >= 3 && i % 3 === 0) { // солнечные фермы
      ctx.fillStyle = 'rgba(30,58,138,0.85)'; ctx.fillRect(p.px - p.radX * 0.6, p.py - p.radY * 0.35, p.radX * 1.2, p.radY * 0.7);
      ctx.strokeStyle = 'rgba(147,197,253,0.7)'; ctx.lineWidth = 0.8;
      for (let k = 1; k < 4; k++) { const x = p.px - p.radX * 0.6 + p.radX * 0.3 * k; ctx.beginPath(); ctx.moveTo(x, p.py - p.radY * 0.35); ctx.lineTo(x, p.py + p.radY * 0.35); ctx.stroke(); }
    }
    if (era >= 8 && i % 4 === 1) { ctx.strokeStyle = `rgba(251,146,60,${0.7 + 0.3 * Math.sin(now / 250 + i)})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(p.px - p.radX, p.py); ctx.lineTo(p.px, p.py + p.radY * 0.4); ctx.lineTo(p.px + p.radX, p.py - p.radY * 0.2); ctx.stroke(); } // кузницы
  });
  if (era >= 1) { // лёд в полярных кратерах
    ctx.fillStyle = 'rgba(224,242,254,0.85)';
    ctx.beginPath(); ctx.ellipse(cx, cy - R * 0.96, R * 0.22, R * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy + R * 0.96, R * 0.18, R * 0.07, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (era >= 2) { // рельсы по экватору и город-поезд
    ctx.strokeStyle = 'rgba(203,213,225,0.75)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy + R * 0.05, R, R * 0.1, 0, 0, Math.PI); ctx.stroke();
    const a = (now / 7000) % (Math.PI * 2), x = cx + Math.cos(a) * R * 0.95, y = cy + R * 0.05 + Math.sin(a) * R * 0.1;
    if (Math.sin(a) > 0) { ctx.fillStyle = '#fde047'; ctx.shadowColor = '#fde047'; ctx.shadowBlur = 8; ctx.fillRect(x - 5, y - 2, 10, 4); ctx.shadowBlur = 0; }
  }
  if (era >= 5) drawLights(R, MERCURY_CRATERS.map(c => ({ ...c, r: c.r + 0.15 })), Math.min(4, era - 3), '94,234,212');
  if (era >= 7) { // искры антиматерии
    for (let k = 0; k < 6; k++) { const a = now / 900 + k * 1.05, rr = R * (0.3 + 0.5 * ((k * 7) % 10) / 10); ctx.fillStyle = `rgba(216,180,254,${0.5 + 0.5 * Math.sin(now / 180 + k)})`; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.6, 1.8, 0, Math.PI * 2); ctx.fill(); }
  }
  // раскалённая дневная сторона
  const hot = ctx.createRadialGradient(cx - R * 0.6, cy - R * 0.5, 0, cx - R * 0.6, cy - R * 0.5, R * 1.1);
  hot.addColorStop(0, 'rgba(251,191,36,0.28)'); hot.addColorStop(1, 'rgba(251,191,36,0)');
  ctx.fillStyle = hot; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
}

// ---------- Планеты-карты измерения CS2 ----------
// Песчаная (каменная, зелёная) сфера с кварталами: дома, крыши, пальмы, каналы или ящики — по теме карты.
// С каждым этапом построек больше, ночью горят огни, на последних этапах планета сияет.
const MAP_BLOBS = [
  { lon: 0.2, lat: -0.25, r: 0.34 }, { lon: 1.1, lat: 0.3, r: 0.3 }, { lon: 2.0, lat: -0.05, r: 0.38 }, { lon: 2.9, lat: 0.4, r: 0.26 },
  { lon: 3.7, lat: -0.35, r: 0.32 }, { lon: 4.6, lat: 0.15, r: 0.36 }, { lon: 5.5, lat: -0.15, r: 0.3 }
];
// какие кварталы соединены коридорами (по порядку появления с этапами)
const MAP_LANES = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], [1, 4], [2, 5], [0, 3], [3, 6], [1, 5], [2, 6]];
// линия по поверхности сферы через точки {lon, lat}: обратная сторона не рисуется
function mapPath(R, pts, steps) {
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    let dl = b.lon - a.lon;
    if (dl > Math.PI) dl -= Math.PI * 2; else if (dl < -Math.PI) dl += Math.PI * 2;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, p = projectBlob({ lon: a.lon + dl * t, lat: a.lat + (b.lat - a.lat) * t, r: 0.1 }, R);
      if (!p) { started = false; continue; }
      if (!started) { ctx.moveTo(p.px, p.py); started = true; } else ctx.lineTo(p.px, p.py);
    }
  }
  ctx.stroke();
}
function drawMapPlanet(R, era, now, L) {
  fillSphere(R, L.base);
  // дюны / рельеф
  for (let i = 0; i < 6; i++) {
    const y = cy - R + (i + 0.5) * (R * 2 / 6), w = Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy)));
    ctx.fillStyle = `rgba(255,255,255,${0.05 + 0.03 * (i % 2)})`;
    ctx.beginPath(); ctx.ellipse(cx + Math.sin(rotAngle * 2 + i) * R * 0.1, y, w, R * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (L.feat === 'water' && era >= 2) {   // каналы Анубиса
    ctx.strokeStyle = 'rgba(20,184,166,0.85)'; ctx.lineWidth = Math.max(2, R * 0.05);
    for (let k = 0; k < 2; k++) {
      ctx.beginPath(); let started = false;
      for (let a = 0; a <= 64; a++) {
        const lon = (a / 64) * Math.PI * 2, lat = (k ? 0.32 : -0.18) + Math.sin(lon * 3) * 0.08;
        const p = projectBlob({ lon, lat, r: 0.1 }, R); if (!p) { started = false; continue; }
        if (!started) { ctx.moveTo(p.px, p.py); started = true; } else ctx.lineTo(p.px, p.py);
      }
      ctx.stroke();
    }
  }
  if (L.feat === 'jungle') {   // кроны джунглей Древнего
    MAP_BLOBS.forEach((b, i) => { const p = projectBlob({ ...b, lon: b.lon + 0.5, r: b.r * 0.9 }, R); if (!p) return;
      ctx.fillStyle = i % 2 ? 'rgba(21,128,61,0.75)' : 'rgba(22,101,52,0.7)'; ctx.beginPath(); ctx.ellipse(p.px, p.py, p.radX, p.radY * 0.8, 0.3, 0, Math.PI * 2); ctx.fill(); });
  }
  // сетка радара: как мини-карта в углу экрана
  ctx.strokeStyle = 'rgba(0,0,0,0.09)'; ctx.lineWidth = 1;
  for (let k = 0; k < 12; k++) mapPath(R, [{ lon: k * Math.PI / 6, lat: -1.4 }, { lon: k * Math.PI / 6, lat: 1.4 }], 14);
  for (const lat of [-0.75, -0.25, 0.25, 0.75]) mapPath(R, [0, 1, 2, 3, 4].map(k => ({ lon: k * Math.PI / 2, lat })), 12);
  // коридоры между кварталами: тёмная дорога и светлая середина
  const lanes = MAP_LANES.slice(0, Math.min(MAP_LANES.length, 4 + era));
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? 'rgba(255,255,255,0.16)' : `${L.base[2]}66`;
    ctx.lineWidth = Math.max(1.5, R * (pass ? 0.012 : 0.05));
    ctx.lineCap = 'round';
    lanes.forEach(([a, b]) => mapPath(R, [MAP_BLOBS[a], MAP_BLOBS[b]], 18));
  }
  const houses = Math.min(9, 2 + era);
  MAP_BLOBS.forEach((b, bi) => {
    const p = projectBlob(b, R); if (!p) return;
    ctx.fillStyle = L.blob; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.ellipse(p.px, p.py, p.radX, p.radY * 0.75, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = `${L.base[2]}55`; ctx.lineWidth = Math.max(1, R * 0.012); ctx.stroke();   // стены квартала
    const s = Math.max(2, R * 0.06 * p.cos);
    for (let h = 0; h < houses; h++) {
      const ox = (((bi * 37 + h * 53) % 100) / 100 - 0.5) * p.radX * 1.3, oy = (((bi * 17 + h * 29) % 100) / 100 - 0.5) * p.radY;
      const x = p.px + ox, y = p.py + oy, hh = s * (0.8 + ((h * 7) % 5) * 0.15);
      if (L.feat === 'crate' && h % 2) {   // ящики Даст 2
        ctx.fillStyle = '#a16207'; ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s);
        ctx.strokeStyle = '#713f12'; ctx.lineWidth = 1; ctx.strokeRect(x - s * 0.5, y - s * 0.5, s, s);
        ctx.beginPath(); ctx.moveTo(x - s * 0.5, y - s * 0.5); ctx.lineTo(x + s * 0.5, y + s * 0.5); ctx.moveTo(x + s * 0.5, y - s * 0.5); ctx.lineTo(x - s * 0.5, y + s * 0.5); ctx.stroke();
        continue;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x - s * 0.55 + 1, y - hh + 2, s * 1.1, hh);
      ctx.fillStyle = L.base[0]; ctx.fillRect(x - s * 0.55, y - hh, s * 1.1, hh);
      if (L.feat === 'roof' || L.feat === 'jungle') {   // черепица Инферно / каменные пирамидки Древнего
        ctx.fillStyle = L.roof; ctx.beginPath(); ctx.moveTo(x - s * 0.7, y - hh); ctx.lineTo(x, y - hh - s * 0.55); ctx.lineTo(x + s * 0.7, y - hh); ctx.closePath(); ctx.fill();
      } else if (h % 3 === 0 && era >= 3) {   // купола и арки
        ctx.fillStyle = L.roof; ctx.beginPath(); ctx.arc(x, y - hh, s * 0.5, Math.PI, 0); ctx.fill();
      } else { ctx.fillStyle = L.roof; ctx.fillRect(x - s * 0.55, y - hh, s * 1.1, Math.max(1, s * 0.18)); }
      ctx.fillStyle = 'rgba(30,20,10,0.6)'; ctx.fillRect(x - s * 0.15, y - hh * 0.45, s * 0.3, hh * 0.45);   // дверь
    }
    if ((L.feat === 'palm' && era >= 1) || (L.feat === 'water' && era >= 5)) {   // пальмы
      for (let k = 0; k < 2; k++) {
        const x = p.px + p.radX * (k ? 0.7 : -0.75), y = p.py + p.radY * 0.35, t = Math.max(3, R * 0.07 * p.cos);
        ctx.strokeStyle = '#78350f'; ctx.lineWidth = Math.max(1, t * 0.18); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + t * 0.15, y - t); ctx.stroke();
        ctx.fillStyle = '#16a34a'; for (let f = 0; f < 4; f++) { ctx.beginPath(); ctx.ellipse(x + t * 0.15 + Math.cos(f * 1.6) * t * 0.35, y - t + Math.sin(f * 1.6) * t * 0.15, t * 0.38, t * 0.13, f * 1.6, 0, Math.PI * 2); ctx.fill(); }
      }
    }
  });
  if (L.feat === 'crate' || era < 2) drawClouds(R, era < 2 ? 0.22 : 0.12, '253,230,138');   // песчаные бури
  if (era >= 4) {   // флаги контроля
    const p = projectBlob({ lon: 2.0, lat: -0.05, r: 0.2 }, R);
    if (p && p.cos > 0.3) { const h = R * 0.22 * p.cos; ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.px, p.py - h); ctx.stroke();
      ctx.fillStyle = L.accent; ctx.beginPath(); ctx.moveTo(p.px, p.py - h); ctx.lineTo(p.px + h * 0.5, p.py - h * 0.82 + Math.sin(now / 200) * 2); ctx.lineTo(p.px, p.py - h * 0.64); ctx.closePath(); ctx.fill(); }
  }
  if (era >= 6) drawLights(R, MAP_BLOBS, Math.min(4, era - 4), L.feat === 'roof' ? '251,146,60' : '253,224,71');
  // точки закладки A и B, с 3-го этапа — респауны CT и T
  const marks = [{ b: 1, t: 'A', c: '#ef4444' }, { b: 4, t: 'B', c: '#ef4444' }];
  if (era >= 2) marks.push({ b: 6, t: 'CT', c: '#3b82f6' }, { b: 2, t: 'T', c: '#f59e0b' });
  marks.forEach(m => {
    const p = projectBlob({ ...MAP_BLOBS[m.b], lat: MAP_BLOBS[m.b].lat - 0.12 }, R); if (!p || p.cos < 0.25) return;
    const r = Math.max(5, R * 0.085 * p.cos), pulse = m.t.length === 1 ? 1 + 0.08 * Math.sin(now / 300 + m.b) : 1;
    ctx.globalAlpha = Math.min(1, (p.cos - 0.25) * 3);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(p.px + 1.5, p.py + 2, r * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = m.c; ctx.beginPath(); ctx.arc(p.px, p.py, r * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(1, r * 0.14); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(r * (m.t.length > 1 ? 0.95 : 1.25))}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(m.t, p.px, p.py + r * 0.06);
    ctx.globalAlpha = 1;
  });
  if (era >= 8) { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, `rgba(254,240,138,${0.12 + 0.05 * Math.sin(now / 500)})`); g.addColorStop(1, 'rgba(254,240,138,0)'); ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
}

// ---------- Планеты-биомы вселенной Майнкрафт ----------
// Сфера из «блоков»: сетка широт и долгот, у каждой клетки свой цвет. Вода (или лава в Незере), постройки
// появляются с этапами, ночью светятся окна. Цвета клеток считаются один раз и берутся из кэша.
const VOXEL_ROWS = 14, VOXEL_COLS = 28;
const voxelCache = new Map();
function voxelCells(pid, era, L) {
  const key = pid + ':' + era;
  let cells = voxelCache.get(key);
  if (cells) return cells;
  cells = [];
  let seed = hashStr(pid);
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let r = 0; r < VOXEL_ROWS; r++) for (let c = 0; c < VOXEL_COLS; c++) {
    const lat = -Math.PI / 2 + (r + 0.5) * Math.PI / VOXEL_ROWS, lon = (c / VOXEL_COLS) * Math.PI * 2;
    const n = Math.sin(lon * 2 + 1.3) * Math.cos(lat * 3) + Math.sin(lon * 5 + lat * 4) * 0.4;
    const x = rnd();
    let col = L.pal[Math.floor(x * 4)], kind = 'land';
    if (n < -0.55 && L.water) { col = L.water; kind = 'water'; }
    else if (L.snow && Math.abs(lat) > 1.1) col = '#ffffff';
    else if (!L.snow && Math.abs(lat) > 1.25 && !L.glow) col = '#f8fafc';   // снег на полюсах
    // постройки: чем выше этап, тем больше клеток застроено
    if (kind === 'land' && x > 0.5 && rnd() < era * 0.035) { kind = 'build'; col = era >= 7 ? (L.glow ? '#e9d5ff' : '#94a3b8') : era >= 3 ? '#9ca3af' : '#a16207'; }
    cells.push({ lat, lon, col, kind, k: x });
  }
  voxelCache.set(key, cells);
  return cells;
}
function drawVoxelPlanet(R, era, now, L, pid) {
  fillSphere(R, [L.pal[2], L.pal[1], '#0b0b0b']);
  const cells = voxelCells(pid, era, L);
  const cw2 = (Math.PI * 2 * R) / VOXEL_COLS, ch2 = (Math.PI * R) / VOXEL_ROWS;
  for (const c of cells) {
    let lon = (c.lon + rotAngle) % (Math.PI * 2); if (lon > Math.PI) lon -= Math.PI * 2;
    const z = Math.cos(lon) * Math.cos(c.lat);
    if (z < 0.04) continue;
    const x = cx + Math.sin(lon) * Math.cos(c.lat) * R, y = cy + Math.sin(c.lat) * R;
    const w = Math.max(1, cw2 * Math.cos(c.lat) * Math.cos(lon) * 1.04), h = Math.max(1, ch2 * Math.cos(c.lat) * 1.04 + ch2 * 0.12);
    let col = c.col;
    if (c.kind === 'water' && L.glow) col = `rgb(${249 - (Math.sin(now / 300 + c.k * 9) + 1) * 12},${115 + (Math.sin(now / 400 + c.k * 7) + 1) * 30},22)`;   // лава
    ctx.fillStyle = col; ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x - w / 2, y + h / 2 - Math.max(1, h * 0.14), w, Math.max(1, h * 0.14));   // грань блока
    if (c.kind === 'build') { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - w * 0.15, y - h * 0.1, w * 0.3, h * 0.45); }
    if (c.kind === 'build' && era >= 5) {   // окна светятся на ночной стороне
      const dark = ((x - cx) * 0.6 + (y - cy) * 0.5) / R + 0.25;
      if (dark > 0.1) { ctx.fillStyle = `rgba(253,224,71,${Math.min(0.95, dark)})`; ctx.fillRect(x - w * 0.3, y - h * 0.3, Math.max(1, w * 0.2), Math.max(1, h * 0.2)); ctx.fillRect(x + w * 0.1, y - h * 0.3, Math.max(1, w * 0.2), Math.max(1, h * 0.2)); }
    }
  }
  if (L.glow) {   // искры Незера / Края
    for (let k = 0; k < 10; k++) { const a = now / 1500 + k * 0.63, rr = R * (0.2 + ((k * 37) % 10) / 12); ctx.fillStyle = `${L.glow}${Math.floor(140 + 100 * Math.sin(now / 200 + k)).toString(16).padStart(2, '0')}`; ctx.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a * 1.3) * rr * 0.7, 2.5, 2.5); }
  }
  if (!L.glow && !L.snow && era >= 1) drawClouds(R, 0.35);   // квадратные облака рисуются обычными — так мягче
  if (L.snow && era >= 7) {   // северное сияние
    const t = 0.3 + 0.2 * Math.sin(now / 500);
    ctx.fillStyle = `rgba(74,222,128,${t})`; ctx.beginPath(); ctx.ellipse(cx, cy - R * 0.9, R * 0.6, R * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(167,139,250,${t * 0.8})`; ctx.beginPath(); ctx.ellipse(cx, cy - R * 0.78, R * 0.5, R * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (era >= 9) { ctx.fillStyle = `rgba(255,255,255,${0.06 + 0.04 * Math.sin(now / 600)})`; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
}

// шапки: эти рисуются вручную, остальные — значком над планетой
const DRAWN_HATS = new Set(['hat_crown', 'hat_tophat', 'hat_wizard', 'hat_ufo', 'hat_halo', 'hat_party', 'hat_helmet', 'hat_rings', 'hat_star', 'hat_comet']);
function drawHat(R) {
  const id = state.look[cur()].hat;
  if (!id) return;
  const u = R / 100;
  if (!DRAWN_HATS.has(id)) {   // остальные шапки (венок, очки, образы новых измерений) — значок над планетой
    const it = COSMETICS.find(c => c.id === id); if (!it) return;
    const sz = R * (id === 'hat_shades' ? 0.75 : 0.62);
    const bob = Math.sin(performance.now() / 700) * R * 0.02;
    ctx.drawImage(emojiSprite(it.icon), cx - sz / 2, cy - R - sz * (id === 'hat_shades' ? 0.42 : 0.62) + bob, sz, sz);
    return;
  }
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

// Кадр: ошибка рисования (например, у новой планеты) не должна ломать игру — сбрасываем холст и рисуем дальше.
let renderErrAt = -1e9;
function renderFrame(now) {
  requestAnimationFrame(renderFrame);
  try { drawScene(now); }
  catch (e) {
    if (now - renderErrAt > 5000) { console.error('render', e); renderErrAt = now; }
    canvas.width = canvas.width;   // незакрытые save()/clip() остались бы и на следующих кадрах
  }
}
function drawScene(now) {
  const dt = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  const f = dt * 60;
  // полёт астероида считаем до любого рисования: даже если кадр не дорисуется, таймер идёт и удар случится
  if (activeAsteroid) stepAsteroid(dt);
  ctx.setTransform(dprNow, 0, 0, dprNow, 0, 0);
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

  // плавный переход планеты при открытии/закрытии панели
  const k = Math.min(1, 0.16 * f);
  planetRadius += (layout.tr - planetRadius) * k; cx += (layout.tx - cx) * k; cy += (layout.ty - cy) * k;

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
    if (pid === 'mercury' && era >= 6) { // зеркальное кольцо
      ctx.setLineDash([3, 4]);
      ringPart(R * 1.3, R * 0.24, 0.1, back, back ? 'rgba(224,242,254,0.35)' : 'rgba(240,249,255,0.95)', 2.5, '#e0f2fe');
      ctx.setLineDash([]);
    }
    if (pid === 'mercury' && era >= 9) { // решётка сферы Дайсона
      for (let k = 0; k < 3; k++) ringPart(R * (1.4 + k * 0.05), R * (0.45 + k * 0.28), -0.5 + k * 0.5, back, back ? 'rgba(253,224,71,0.18)' : 'rgba(253,224,71,0.6)', 1.5, '#fde047');
    }
    if (pid === 'venus' && era >= 2) ringPart(R * 1.25, R * 0.22, -0.12, back, back ? 'rgba(254,240,138,0.18)' : 'rgba(254,240,138,0.5)', 1, null); // трассы аэростатов
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
  const LK = PL(pid).look;
  if (pid === 'earth') drawEarth(R, era, now);
  else if (pid === 'mars') drawMars(R, era, now);
  else if (pid === 'venus') drawVenus(R, era, now);
  else if (pid === 'mercury') drawMercury(R, era, now);
  else if (pid === 'jupiter') drawJupiter(R, era, now);
  else if (LK && LK.kind === 'voxel') drawVoxelPlanet(R, era, now, LK, pid);
  else if (LK) drawMapPlanet(R, era, now, LK);

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
  // Венера: солнечный зонтик между планетой и Солнцем
  if (pid === 'venus' && era >= 4) {
    const ux = cx - R * 0.98, uy = cy - R * 1.12, ur = R * 0.27;
    ctx.save(); ctx.translate(ux, uy); ctx.rotate(-0.62);
    ctx.fillStyle = 'rgba(30,41,59,0.92)'; ctx.strokeStyle = 'rgba(203,213,225,0.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, ur, ur * 0.28, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(148,163,184,0.6)'; ctx.lineWidth = 1;
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * ur * 0.4, -ur * 0.25); ctx.lineTo(k * ur * 0.4, ur * 0.25); ctx.stroke(); }
    ctx.restore();
  }
  // Меркурий: рельсотрон швыряет грузы в космос
  if (pid === 'mercury' && era >= 4) {
    const ang = -0.75, x1 = cx + Math.cos(ang) * R, y1 = cy + Math.sin(ang) * R;
    ctx.strokeStyle = 'rgba(147,197,253,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + Math.cos(ang) * R * 0.18, y1 + Math.sin(ang) * R * 0.18); ctx.stroke();
    for (let k = 0; k < 3; k++) {
      const t = ((now / 1400) + k / 3) % 1, d = R * (0.2 + t * 1.6);
      ctx.fillStyle = `rgba(191,219,254,${1 - t})`; ctx.beginPath(); ctx.arc(x1 + Math.cos(ang) * d, y1 + Math.sin(ang) * d, 2, 0, Math.PI * 2); ctx.fill();
    }
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

  if (activeAsteroid) drawAsteroid(f, now);
  if (star) drawStar(now);
}

// ============================================================
//  АСТЕРОИДЫ
// ============================================================
// «Магнит астероидов»: −8% ожидания за уровень
function nextBossDelay() { return (BOSS_MIN + Math.random() * (BOSS_MAX - BOSS_MIN)) * (1 - perk('ast_magnet') * 0.08); }
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
  jupiter: { light: '#e0f2fe', mid: '#7dd3fc', dark: '#0c4a6e', crater: 'rgba(12,74,110,0.45)', glow: '125,211,252', trail: ['#ffffff', '#bae6fd', '#38bdf8'] },
  venus:   { light: '#fef9c3', mid: '#ca8a04', dark: '#3f2a05', crater: 'rgba(63,42,5,0.5)', glow: '250,204,21', trail: ['#fef3c7', '#facc15', '#ea580c'] },
  mercury: { light: '#e7e5e4', mid: '#78716c', dark: '#1c1917', crater: 'rgba(28,25,23,0.55)', glow: '253,186,116', trail: ['#ffffff', '#fdba74', '#f97316'] },
  cs:      { light: '#fde68a', mid: '#b45309', dark: '#2b1606', crater: 'rgba(43,22,6,0.5)', glow: '251,146,60', trail: ['#fef3c7', '#fb923c', '#dc2626'] },
  mc:      { light: '#d6d3d1', mid: '#57534e', dark: '#1c1917', crater: 'rgba(0,0,0,0.45)', glow: '134,239,172', trail: ['#ffffff', '#86efac', '#22c55e'] }
};
// Цвета астероида для любой планеты. Раньше их не было у Венеры и Меркурия: рисование падало посреди кадра,
// астероид становился невидимым, а таймер замирал (полёт и удар считались в том же месте, что и рисование).
// Теперь полёт (stepAsteroid) отделён от рисования (drawAsteroid), а цвета есть у всех планет.
function asteroidTint(pid) { return ASTEROID_TINTS[pid] || ASTEROID_TINTS[uniOf(pid)] || ASTEROID_TINTS.earth; }
function spawnAsteroid(forceGolden) {
  if (activeAsteroid || !playing) return;
  const golden = forceGolden || Math.random() < GOLDEN_CHANCE + perk('ast_magnet') * 0.03;
  const hp = clickGain() * (golden ? 18 : 14);
  const fromLeft = Math.random() > 0.5;
  // вылетает правее/левее боковых кнопок (под кнопкой «Квесты» по астероиду было не попасть)
  const side = Math.min(112, cw * 0.29);
  const sx = fromLeft ? side : cw - side, sy = Math.max(112, ($('hud').offsetHeight || 96) + 66);   // и ниже баннера «Астероид!»
  activeAsteroid = {
    sx, sy, x: sx, y: sy, px: sx, py: sy,
    // контрольная точка кривой — полёт по дуге
    kx: (sx + cx) / 2 + (fromLeft ? -40 : 40), ky: sy + (cy - sy) * 0.15,
    r: golden ? 22 : 25, rot: 0, spin: (Math.random() - 0.5) * 0.08,
    hp, maxHp: hp, golden, pts: rockShape(), hitFx: 0, wob: 0,
    craters: [[-0.35, -0.2, 0.22], [0.3, 0.25, 0.17], [0.1, -0.45, 0.13], [-0.15, 0.4, 0.12]],
    cracks: [rockShape(5, 0.6), rockShape(5, 0.6)],
    gems: Math.round((1 + Math.floor(ps(cur()).era / 3) + UNIVERSES[uniOf(cur())].planets.indexOf(cur()) + UNIVERSE_ORDER.indexOf(uniOf(cur())) * 3) * (golden ? 3 : 1) * gemMult()),
    progress: 0, totalTime: BOSS_FLIGHT
  };
  astStepAt = performance.now();
  $('bossTimerText').textContent = `${BOSS_FLIGHT.toFixed(1)}с`;
  $('bossAlertBanner').classList.toggle('golden', golden);
  $('bossAlertText').innerText = golden ? '✨ ЗОЛОТОЙ АСТЕРОИД! ЖМИ!' : '☄️ АСТЕРОИД! ЖМИ НА НЕГО!';
  $('bossAlertBanner').style.display = 'flex';
  vibrate([40, 60, 40]);
  Sound.alarm();
}

// Шаг полёта: позиция, таймер на баннере, удар о планету. Зовётся из кадра, а если кадры не идут
// (вкладка видна, но рисование застряло) — из главного цикла раз в 100 мс.
let astStepAt = 0;
function stepAsteroid(dt) {
  const a = activeAsteroid;
  if (!a) return;
  astStepAt = performance.now();
  a.progress += dt / a.totalTime;
  const t = Math.min(1, a.progress), it = 1 - t;
  a.px = a.x; a.py = a.y;
  a.x = it * it * a.sx + 2 * it * t * a.kx + t * t * cx;
  a.y = it * it * a.sy + 2 * it * t * a.ky + t * t * cy;
  const left = `${Math.max(0, a.totalTime * (1 - a.progress)).toFixed(1)}с`;
  const tt = $('bossTimerText'); if (tt.textContent !== left) tt.textContent = left;
  if (a.progress >= 1.0) asteroidImpact();
}
function drawAsteroid(f, now) {
  const a = activeAsteroid;
  a.rot += a.spin * f;
  a.hitFx = Math.max(0, a.hitFx - 0.08 * f);
  const T = a.golden ? { light: '#fef9c3', mid: '#eab308', dark: '#713f12', crater: 'rgba(113,63,18,0.45)', glow: '250,204,21', trail: ['#ffffff', '#fde047', '#f59e0b'] } : asteroidTint(cur());

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
  const T = a.golden ? '#fde047' : asteroidTint(pid).mid;
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
//  ПАДАЮЩИЕ ЗВЁЗДЫ
// ============================================================
// Раз в несколько минут над планетой пролетает звезда (STAR.life секунд). Тап по ней — случайный бонус
// из STAR_BONUS: лихорадка тапов, солнечный ветер, клад, кристаллы или сапфир.
const randIn = ([a, b]) => a + Math.random() * (b - a);
let star = null, starCooldown = randIn(STAR.first);
function spawnStar() {
  if (star || !playing) return;
  const top = ($('hud').offsetHeight || 96) + 50;
  const bottom = Math.max(top + 40, cy - planetRadius * 0.55);
  star = { t0: performance.now(), life: STAR.life * 1000, fromLeft: Math.random() < 0.5, y0: top + Math.random() * (bottom - top),
    amp: 14 + Math.random() * 26, x: -100, y: -100, trail: [] };
  Sound.starAppear();
}
function starPos(now) {
  const p = (now - star.t0) / star.life;
  const x = star.fromLeft ? -30 + (cw + 60) * p : cw + 30 - (cw + 60) * p;
  return { p, x, y: star.y0 + Math.sin(p * Math.PI * 2.5) * star.amp };
}
// пятиконечная звезда с хвостом из искр и мягким сиянием
function drawStar(now) {
  const { p, x, y } = starPos(now);
  if (p >= 1) { star = null; return; }
  star.x = x; star.y = y;
  const tr = star.trail;
  tr.push({ x, y }); if (tr.length > 22) tr.shift();
  for (let i = 0; i < tr.length; i++) {
    const k = i / tr.length;
    ctx.fillStyle = `rgba(253,230,138,${k * 0.55})`;
    ctx.beginPath(); ctx.arc(tr[i].x, tr[i].y, 1 + k * 5, 0, Math.PI * 2); ctx.fill();
  }
  const fade = Math.min(1, p * 8, (1 - p) * 6);   // появляется и исчезает плавно
  const r = 12 + Math.sin(now / 110) * 1.6;
  ctx.globalAlpha = fade;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.4);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.25, 'rgba(253,224,71,0.55)'); g.addColorStop(1, 'rgba(253,224,71,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.rotate(now / 500);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath();
  const body = ctx.createLinearGradient(0, -r, 0, r);
  body.addColorStop(0, '#fffbeb'); body.addColorStop(0.5, '#fde047'); body.addColorStop(1, '#f59e0b');
  ctx.fillStyle = body; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
  if (Math.random() < 0.25) particles.push({ x: x + (Math.random() - 0.5) * 10, y: y + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 0.6, vy: 0.4 + Math.random() * 0.6, r: 1 + Math.random() * 1.5, color: '#fef9c3', life: 1, decay: 0.03 });
}
function pickStarBonus() {
  let r = Math.random() * STAR_BONUS.reduce((a, b) => a + b.w, 0);
  for (const b of STAR_BONUS) if ((r -= b.w) < 0) return b;
  return STAR_BONUS[0];
}
function catchStar() {
  if (!star) return;
  const sx = star.x, sy = star.y, pid = cur(), B = pickStarBonus();
  star = null;
  starCooldown = randIn(STAR.every);
  let text = B.desc;
  if (B.id === 'frenzy' || B.id === 'wind') buffs[B.id] = Date.now() + B.sec * 1000;
  else if (B.id === 'loot') {
    const got = withoutBuffs(() => {
      const r = rates(pid), out = {};
      PL(pid).res.forEach(k => {
        let v = (r[k] || 0) * 60 * B.min;
        if (k === PL(pid).clickRes) v = Math.max(v, clickGain(pid) * 300);
        if (v >= 1) out[k] = Math.floor(v);
      });
      return out;
    });
    for (const k in got) ps(pid).res[k] += got[k];
    text = Object.entries(got).slice(0, 3).map(([k, v]) => `+${fmt(v)} ${RES[k].icon}`).join(' ');
  } else if (B.id === 'gems') {
    const g = Math.max(1, Math.round((2 + Math.floor(ps(pid).era / 3) + UNIVERSE_ORDER.indexOf(uniOf(pid)) * 3) * gemMult()));
    state.gems += g; text = `+${fmt(g)} 💎`;
  } else if (B.id === 'sapph') { state.sapphires += 1; text = '+1 🔷'; }
  stat('stars');
  spawnParticles(sx, sy, '#fde047', 26, 6, 3); spawnParticles(sx, sy, '#ffffff', 14, 4, 2);
  ripples.push({ x: sx, y: sy, r: 6, life: 1, color: '#fde68a', speed: 4, width: 4, decay: 0.035 });
  showFloat(Math.max(8, Math.min(cw - 170, sx - 60)), sy - 30, `${B.icon} ${B.name}`, 'star');
  showToast(`🌠 ${B.name}! ${text}`, 3500);
  Sound.star(); vibrate([20, 30, 40]);
  refreshUI(); saveLocal(); queueSync(4000);
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
  setTimeout(() => el.remove(), cls === 'star' ? 1450 : 800);
}

function tapSoundStyle() { const c = COSMETICS.find(x => x.id === state.tapSound); return c ? c.snd : 'default'; }
function handlePlanetClick(mx, my) {
  const pid = cur();
  const now = performance.now();
  combo.n = now - combo.at < COMBO_GAP_MS ? combo.n + 1 : 1;
  combo.at = now;
  if (combo.n > (state.stats.combo || 0)) state.stats.combo = Math.min(9999, combo.n);
  const crit = rollCrit();
  const gain = Math.ceil(clickGain(pid) * crit * comboMult());
  const res = PL(pid).clickRes;
  ps(pid).res[res] += gain;
  pulseScale = 0.94;
  ripples.push({ x: mx, y: my, r: 6, life: 1, color: crit > 1 ? '#fb7185' : '#7dd3fc' });
  spawnParticles(mx, my, crit > 1 ? '#fb7185' : PL(pid).eras[ps(pid).era].halo, crit > 1 ? 12 : 5);
  if (crit > 1) vibrate(20);
  Sound.tap(crit > 1, tapSoundStyle(), combo.n);
  showFloat(mx - 24, my - 28, `+${fmt(gain)} ${RES[res].icon}${crit > 1 ? ' КРИТ!' : ''}`, crit > 1 ? 'crit' : '');
  showCombo();
  stat('taps');
  tutEvent('tap');
  refreshUI();
}
// счётчик серии над планетой (только с перком «Комбо-тапы»)
let comboHideT = null;
function showCombo() {
  const el = $('comboBadge');
  if (!el || !perk('combo') || combo.n < 5) return;
  el.textContent = `🔥 ×${Math.min(combo.n, COMBO_MAX)}${combo.n >= COMBO_MAX ? ' MAX' : ''} · +${Math.round((comboMult() - 1) * 100)}%`;
  el.classList.add('show'); el.classList.toggle('max', combo.n >= COMBO_MAX);
  clearTimeout(comboHideT);
  comboHideT = setTimeout(() => el.classList.remove('show'), COMBO_GAP_MS + 150);
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
  refreshUI();   // карточки обновляются на месте — кнопку можно жать снова сразу, без перестройки панели
  markBought(`[data-card="${id}"]`, '+' + n);
  saveLocal();
  if (!syncTimer) queueSync(5000);   // постройки считаются в топе планеты
  tutEvent('build');
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
         : (!couldPrestige && canPrestige(pid)) ? `🌀 Цели престижа выполнены — вкладка «Развитие» (${PL(pid).name})`
         : nextUnlockHint(pid, era)
  });
  renderAll(); saveLocal(); queueSync(800);
  checkLegend();
}

// подсказка после эволюции: новый этап открыл экспедицию на следующую планету измерения или чёрную дыру
function nextUnlockHint(pid, era) {
  const next = PLANET_ORDER.find(x => PL(x).unlock && PL(x).unlock.stages && PL(x).unlock.stages[pid] === era && !isUnlocked(x));
  if (next) return `🚀 Можно снарядить экспедицию: ${PL(next).icon} ${PL(next).name} — загляните на карту!`;
  const nu = UNIVERSE_ORDER.find(u => UNIVERSES[u].need && UNIVERSES[u].need.from === uniOf(pid) && !state.unis.includes(u));
  if (nu && era === PL(pid).eras.length - 1) return `🕳️ Планета пройдена! Цели для перехода: ${UNIVERSES[nu].name} — на карте`;
  return '';
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

// предмет куплен (звук по умолчанию есть у всех)
const ownsItem = (id) => id === DEFAULT_TAP_SOUND || state.ownedCosmetics.includes(id);
// почему предмет пока нельзя купить (закрыта планета или измерение) — или '' если можно
function itemLock(item) {
  if (item.planet && !isUnlocked(item.planet)) return `🔒 ${PL(item.planet).name}`;
  const u = item.uni || item.uniNeed;
  if (u && !state.unis.includes(u)) return `🔒 ${UNIVERSES[u].short}`;
  return '';
}
function handleCosmetic(id) {
  const item = COSMETICS.find(x => x.id === id);
  if (!item) return;
  const pid = cur();
  if (item.type === 'sound') {   // звук тапа — общий для всех планет
    if (!ownsItem(id)) {
      if (itemLock(item) || !canPay(item.cost)) { Sound.error(); return; }
      pay(item.cost);
      state.ownedCosmetics.push(id);
      showToast(`${item.icon} Звук «${item.name}» — ваш!`, 2200);
    }
    state.tapSound = id;
    Sound.tap(false, item.snd, 1); setTimeout(() => Sound.tap(false, item.snd, 2), 160); setTimeout(() => Sound.tap(true, item.snd, 3), 320);
    renderShop(); renderAll(); saveLocal(); queueSync();
    return;
  }
  if (!state.ownedCosmetics.includes(id)) {
    if (item.code || item.chest || item.legend || itemLock(item)) { Sound.error(); return; }
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
  if (q.need === 'online') return canOnline();
  if (q.need === 'sapphires') return state.sapphires >= 5 || (state.stats.chests || 0) > 0;
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
  if (a.kind === 'hours') return Math.floor((state.stats.playSec || 0) / 3600);
  if (a.kind === 'allmax') return planetsMaxedCount('sol');
  if (a.kind === 'uniall') return planetsMaxedCount(a.key);
  if (a.kind === 'uni') return state.unis.includes(a.key) ? 1 : 0;
  if (a.kind === 'sounds') return state.ownedCosmetics.filter(id => id.startsWith('snd_')).length;
  if (a.kind === 'legend') return planetsMaxedAll();
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
  return Q.daily.filter(d => d.done && !d.claimed).length + (Q.bonusReady ? 1 : 0) + Q.ach.filter(x => x.done && !x.claimed).length + (loginReady() ? 1 : 0);
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
  let i = 0, html = '';
  if (!demo) {   // награда за вход — первой строкой
    const L = loginInfo(), parts = loginRewardParts(LOGIN_REWARDS[L.idx]).map(x => x.t).join(' · ');
    html += `<div class="q-row q-login ${L.claimed ? 'claimed' : 'ready'}" style="--i:${i++}"><div class="q-ico">📅</div>
      <div class="q-info"><div class="q-title">Награда за вход · день ${L.idx + 1} из 7</div><div class="q-desc">${L.claimed ? `Забрано · серия ${L.streak} ${plural(L.streak, 'день', 'дня', 'дней')} подряд` : esc(parts)}</div></div>
      <button class="q-claim" data-qkind="login" data-qid="login" type="button">${L.claimed ? 'Календарь' : 'Забрать'}</button></div>`;
  }
  html += `<div class="q-section"><span>📅 Задания дня</span><span class="q-timer">новые через ${fmtTime((mid - now) / 1000)}</span></div>`;
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
// сундуки текущего измерения и редкие образы из них
const chestUni = (c) => c.uni || 'sol';
const chestPool = (u) => COSMETICS.filter(x => x.chest && (x.uni || 'sol') === u);
function renderShop() {
  $('shopSapph').textContent = fmt(state.sapphires);
  const left = boostLeft();
  $('shopBoost').hidden = !left;
  if (left) $('shopBoost').textContent = `⚡ Ускоритель ×2 активен: ещё ${fmtCountdown(left / 1000)}`;
  document.querySelectorAll('#shopTabs .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.id === ui.storeTab));
  const chestsMode = ui.storeTab !== 'sounds';
  $('chestList').hidden = !chestsMode; $('chestNote').hidden = !chestsMode; $('soundList').hidden = chestsMode;
  if (!chestsMode) { renderSoundShop(); return; }
  const u = uniOf(cur()), U = UNIVERSES[u];
  const chestItems = chestPool(u);
  const owned = chestItems.filter(c => state.ownedCosmetics.includes(c.id)).length;
  $('chestList').innerHTML = (u !== 'sol' ? `<div class="shop-uni">${U.icon} ${U.name}: свои сундуки и редкие образы</div>` : '') + CHESTS.filter(c => chestUni(c) === u).map((c, i) => `
    <div class="chest-card" style="--c:${c.color};--i:${i}">
      <div class="chest-ico">${c.icon}</div>
      <div class="chest-info">
        <div class="chest-name">${c.name}</div>
        <div class="chest-desc">${c.desc}</div>
        <div class="chest-odds">💎 ${c.gems[0]}–${c.gems[1]} · ресурсы за ${c.resMin} мин${c.boostChance >= 1 ? ` · ⚡×2 на ${c.boostMin} мин` : ` · ⚡ ${Math.round(c.boostChance * 100)}%`} · 👑 ${c.itemChance >= 1 ? 'точно' : Math.round(c.itemChance * 100) + '%'}</div>
      </div>
      <button class="chest-buy" data-chest="${c.id}" type="button" ${state.sapphires >= c.price ? '' : 'disabled'}>Открыть<span>${c.price} 🔷</span></button>
    </div>`).join('');
  $('chestNote').textContent = `Редкие образы ${u === 'sol' ? 'из сундуков' : '«' + U.short + '»'}: собрано ${owned} из ${chestItems.length}`;
}
// Звуки тапа: прослушать, купить за сапфиры, выбрать
function renderSoundShop() {
  const items = COSMETICS.filter(c => c.type === 'sound');
  $('soundList').innerHTML = `<div class="shop-uni">🔊 Звук тапа по планете — общий для всех планет</div>` + items.map((it, i) => {
    const owned = ownsItem(it.id), on = state.tapSound === it.id, lock = itemLock(it);
    const btn = owned
      ? `<button class="chest-buy ${on ? 'on' : ''}" data-snd="${it.id}" type="button">${on ? '✓ Выбран' : 'Выбрать'}</button>`
      : lock ? `<button class="chest-buy" type="button" disabled>${lock}</button>`
      : `<button class="chest-buy" data-snd="${it.id}" type="button" ${canPay(it.cost) ? '' : 'disabled'}>Купить<span>${costChips(it.cost)}</span></button>`;
    return `<div class="chest-card snd-card ${on ? 'on' : ''}" style="--c:${on ? '#34d399' : '#60a5fa'};--i:${i}">
      <button class="snd-play" data-play="${it.snd}" type="button" aria-label="Прослушать">${it.icon}<i>▶</i></button>
      <div class="chest-info"><div class="chest-name">${it.name}</div><div class="chest-desc">${it.desc}</div></div>${btn}</div>`;
  }).join('');
}
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// Содержимое сундука: кристаллы, ресурсы текущей планеты (доход за N минут), ускоритель ×2, редкий образ
function rollChest(c) {
  return withoutBuffs(() => rollChestRaw(c));
}
function rollChestRaw(c) {
  const pid = cur(), r = rates(pid), out = { gems: Math.round(randInt(c.gems[0], c.gems[1]) * gemMult()), res: {}, boostMin: 0, item: null };
  const luck = perk('chest_luck');
  PL(pid).res.forEach(k => {
    let v = (r[k] || 0) * 60 * c.resMin * (1 + luck * 0.25);
    if (k === PL(pid).clickRes) v = Math.max(v, clickGain(pid) * 3 * 60 * c.resMin);
    if (v >= 1) out.res[k] = Math.floor(v);
  });
  if (Math.random() < c.boostChance) out.boostMin = c.boostMin;
  if (Math.random() < c.itemChance + luck * 0.05) {
    const pool = chestPool(chestUni(c)).filter(x => !state.ownedCosmetics.includes(x.id));
    if (pool.length) out.item = pool[Math.floor(Math.random() * pool.length)].id;
    else out.gems += Math.round(c.price * 0.6);   // всё собрано — компенсация кристаллами
  }
  return out;
}
let chestPending = null;
function openChest(id, free) {
  const c = CHESTS.find(x => x.id === id);
  if (!c || !playing || chestPending) return;
  if (!free && state.sapphires < c.price) { Sound.error(); return; }
  if (!free) state.sapphires -= c.price;
  const rw = rollChest(c);
  state.gems += rw.gems;
  for (const k in rw.res) ps(cur()).res[k] += rw.res[k];
  if (rw.boostMin) state.boostUntil = Math.min(Date.now() + 6 * 3600000, Math.max(Date.now(), state.boostUntil || 0) + rw.boostMin * 60000);
  if (rw.item) state.ownedCosmetics.push(rw.item);
  stat('chests');
  saveLocal(); queueSync(800);
  chestPending = { c, rw, free: !!free };
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
  if (had && !had.free) { renderShop(); $('shopOverlay').classList.add('open'); }
}

// ============================================================
//  НАГРАДА ЗА ВХОД, НАГРАДЫ НЕДЕЛИ, ФИНАЛ
// ============================================================
// Окна-награды показываются по очереди и только когда экран свободен (нет других окон, обучения, анимаций)
const popupQueue = [];
function queuePopup(fn) { popupQueue.push(fn); }
setInterval(() => { if (popupQueue.length && playing && !screenBusy() && !tutOn()) popupQueue.shift()(); }, 700);

// ---------- Награда за вход: 7 дней подряд ----------
const yesterdayKey = () => dayKey(new Date(Date.now() - 86400000));
function loginInfo() {
  const L = state.login || { day: '', streak: 0 }, today = dayKey();
  if (L.day === today) return { claimed: true, streak: L.streak, idx: (Math.max(1, L.streak) - 1) % 7 };
  const streak = L.day === yesterdayKey() ? L.streak + 1 : 1;
  return { claimed: false, streak, idx: (streak - 1) % 7 };
}
const loginReady = () => playing && !demo && !loginInfo().claimed;
// показать календарь раз в день: при входе и в полночь, если игра так и осталась открытой
let loginPromptDay = '';
function promptLogin() {
  if (demo || loginPromptDay === dayKey()) return;
  loginPromptDay = dayKey();
  queuePopup(() => { if (loginReady()) openLoginReward(); });
}
setInterval(() => { if (playing && loginReady()) promptLogin(); }, 60000);
const loginGems = (R) => (R.gems || 0) * Math.max(1, state.unis.length);
const midChest = () => CHESTS.filter(c => chestUni(c) === uniOf(cur()))[1];
function loginRewardParts(R) {
  const out = [];
  if (R.sapphires) out.push({ ico: '🔷', t: `${R.sapphires} 🔷` });
  if (R.gems) out.push({ ico: '💎', t: `${fmt(loginGems(R))} 💎` });
  if (R.boostMin) out.push({ ico: '⚡', t: `×2 на ${R.boostMin} мин` });
  if (R.chest) out.push({ ico: midChest().icon, t: midChest().name });
  return out;
}
function openLoginReward() {
  if (!playing || demo) return;
  const I = loginInfo();
  $('lrSub').textContent = I.claimed ? `Серия: ${I.streak} ${plural(I.streak, 'день', 'дня', 'дней')} подряд · завтра — новая награда` : `День ${I.idx + 1} из 7 · серия ${I.streak} ${plural(I.streak, 'день', 'дня', 'дней')}`;
  $('lrGrid').innerHTML = LOGIN_REWARDS.map((R, i) => {
    const parts = loginRewardParts(R), cls = i < I.idx || (I.claimed && i === I.idx) ? 'done' : i === I.idx ? 'today' : '';
    return `<div class="lr-day ${cls} ${i === 6 ? 'big' : ''}"><b>${i === I.idx && !I.claimed ? 'Сегодня' : 'День ' + (i + 1)}</b><span class="lr-ico">${parts.map(x => x.ico).slice(0, 2).join('')}</span><i>${parts.map(x => esc(x.t)).join('<br>')}</i></div>`;
  }).join('');
  $('lrClaim').disabled = I.claimed;
  $('lrClaim').textContent = I.claimed ? '✓ Сегодня уже забрано' : `Забрать награду дня ${I.idx + 1}`;
  $('loginRewardOverlay').classList.add('open');
  Sound.ui();
}
function claimLoginReward() {
  const I = loginInfo();
  if (I.claimed || !playing || demo) return;
  const R = LOGIN_REWARDS[I.idx];
  if (R.sapphires) state.sapphires += R.sapphires;
  state.gems += loginGems(R);
  if (R.boostMin) state.boostUntil = Math.min(Date.now() + 6 * 3600000, Math.max(Date.now(), state.boostUntil || 0) + R.boostMin * 60000);
  state.login = { day: dayKey(), streak: I.streak };
  if (I.streak > (state.stats.streak || 0)) state.stats.streak = I.streak;
  Sound.reward(); vibrate([30, 40, 60]);
  showToast(`📅 День ${I.idx + 1}: ${loginRewardParts(R).map(x => x.t).join(' · ')}`, 3500);
  saveLocal(); queueSync(800);
  $('loginRewardOverlay').classList.remove('open');
  renderHeaderAndEra(); updateQuestBadge.n = -1; updateQuestBadge();
  if ($('questsOverlay').classList.contains('open')) renderQuests();
  if (R.chest) setTimeout(() => openChest(midChest().id, true), 450);
}

// ---------- Награды недели за топ игроков и альянсов (считает сервер) ----------
let weeklyChecked = false, weeklyData = null;
async function fetchWeeklyRewards() {
  if (weeklyChecked || !canSync()) return;
  weeklyChecked = true;
  try {
    const r = await api('/api/rewards');
    if (r && r.total > 0) { weeklyData = r; queuePopup(openWeekly); }
  } catch (e) { weeklyChecked = false; }
}
function weeklyRewardTable(table) {
  let prev = 0;
  return table.map(([upTo, v]) => { const t = upTo === prev + 1 ? `${upTo}` : `${prev + 1}–${upTo}`; prev = upTo; return `${t} — ${v} 🔷`; }).join(' · ');
}
function openWeekly() {
  const r = weeklyData;
  if (!r || !r.total) return;
  const rows = [];
  if (r.player) rows.push(`<div class="wk-row"><span class="wk-ico">🏆</span><span class="wk-txt">#${r.player.rank} в общем топе недели<i>топ игроков за прошлую неделю</i></span><span class="wk-val">+${r.player.sapphires} 🔷</span></div>`);
  if (r.ally) rows.push(`<div class="wk-row"><span class="wk-ico">${r.ally.emblem || '🛡️'}</span><span class="wk-txt">«${esc(r.ally.name)}» — #${r.ally.rank} среди альянсов<i>награда каждому участнику</i></span><span class="wk-val">+${r.ally.sapphires} 🔷</span></div>`);
  $('wkList').innerHTML = rows.join('');
  $('wkClaim').disabled = false;
  $('wkClaim').textContent = `Забрать +${r.total} 🔷`;
  $('wkMsg').textContent = '';
  $('weeklyOverlay').classList.add('open');
  Sound.reward(); vibrate([30, 40, 60]);
}
async function claimWeekly() {
  $('wkClaim').disabled = true; $('wkMsg').textContent = 'Забираем…'; $('wkMsg').className = 'nick-msg';
  try {
    const r = await api('/api/rewards/claim', { method: 'POST' });
    if (r.sapphires > 0) {
      state.sapphires += r.sapphires;
      stat('weekly');
      Sound.coin();
      showToast(`🏆 Награда недели: +${r.sapphires} 🔷`, 3000);
      saveLocal(); queueSync(500); renderHeaderAndEra(); updateQuestBadge.n = -1; updateQuestBadge();
    }
    weeklyData = null;
    $('weeklyOverlay').classList.remove('open');
  } catch (e) {
    $('wkClaim').disabled = false;
    $('wkMsg').textContent = 'Не получилось — проверьте интернет и попробуйте ещё раз'; $('wkMsg').className = 'nick-msg err';
  }
}

// ---------- Финал: все этапы на всех 15 планетах ----------
const planetsMaxedAll = () => PLANET_ORDER.filter(pid => bestStage(pid) >= PL(pid).eras.length - 1).length;
function checkLegend() {
  if (state.legend || !playing || planetsMaxedAll() < PLANET_ORDER.length) return;
  state.legend = 1;
  ['hat_legend', 'bg-multiverse'].forEach(id => { if (!state.ownedCosmetics.includes(id)) state.ownedCosmetics.push(id); });
  saveLocal(); queueSync(500);
  Sound.evolve(); vibrate([60, 60, 120, 60, 200]);
  showCinema({ kicker: 'Финал', big: '♾️', title: 'Легенда всех измерений', color: '#fbbf24',
    desc: 'Солнечная система, измерение CS2 и вселенная Майнкрафт пройдены до самого конца. Ваше имя знают во всех мирах.',
    chips: ['🌌 Корона легенды', '♾️ Фон «Мультивселенная»', '🏅 Достижение «Легенда всех измерений»'],
    extra: 'Престижи продолжаются: поднимайтесь в топах всех трёх измерений и ведите свой альянс к вершине!' });
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
  $('travelText').textContent = `Курс на ${({ earth: 'Землю', venus: 'Венеру' })[pid] || PL(pid).acc || PL(pid).name}…`;
  $('travelIcon').textContent = PL(pid).icon;
  tv.classList.remove('open'); void tv.offsetWidth;
  tv.classList.add('open');
  Sound.travel();
  closeMap();
  if (!firstTime) stat('travels');
  setTimeout(() => {
    state.planet = pid;
    endAsteroid(true);
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
//  КАРТА: ИЗМЕРЕНИЯ И ПЛАНЕТЫ
// ============================================================
const MAP_ORBITS = {
  sol: [
    { id: 'mercury', r: 13, size: 3.6, dur: 40,  color: 'radial-gradient(circle at 35% 30%, #e7e5e4, #78716c 55%, #292524)' },
    { id: 'venus',   r: 20, size: 4.8, dur: 70,  color: 'radial-gradient(circle at 35% 30%, #fef9c3, #facc15 45%, #a16207)' },
    { id: 'earth',   r: 28, size: 6,   dur: 110, color: 'radial-gradient(circle at 35% 30%, #7dd3fc 0 20%, #16a34a 21% 32%, #0369a1 33% 60%, #082f49)' },
    { id: 'mars',    r: 36, size: 5,   dur: 170, color: 'radial-gradient(circle at 35% 30%, #fdba74, #c2410c 60%, #431407)' },
    { id: 'belt',    r: 42, belt: true },
    { id: 'jupiter', r: 48, size: 10,  dur: 300, color: 'linear-gradient(180deg, #fef3c7 0 14%, #d97706 14% 26%, #fde68a 26% 40%, #b45309 40% 52%, #fef3c7 52% 66%, #c2410c 66% 78%, #fcd34d 78%)' }
  ],
  cs: UNIVERSES.cs.planets.map((id, i) => ({ id, r: 14 + i * 8, size: 4.6 + (i % 2) * 1.4, dur: 60 + i * 45, color: PLANETS[id].mapColor })),
  mc: UNIVERSES.mc.planets.map((id, i) => ({ id, r: 14 + i * 8, size: 4.8 + (i % 3) * 1.1, dur: 70 + i * 50, color: PLANETS[id].mapColor, cube: true }))
};
let mapBuiltFor = '';
function buildMap(u = 'sol') {
  mapBuiltFor = u;
  const sys = $('system');
  sys.dataset.uni = u;
  if (u !== 'sol' && !state.unis.includes(u)) {   // измерение закрыто — на карте чёрная дыра
    sys.innerHTML = `<div class="hole-map"><div class="hm-disk"></div><div class="hm-core"></div><div class="hm-ico">${UNIVERSES[u].icon}</div></div>`;
    return;
  }
  let html = `<div class="sun ${u}"></div>`;
  MAP_ORBITS[u].forEach((o, i) => {
    if (o.belt) { html += `<div class="orbit belt" style="--r:${o.r}"></div>`; return; }
    const start = -((i * 137) % 360) / 360 * o.dur;
    html += `<div class="orbit" style="--r:${o.r}"></div>
      <div class="arm" style="--r:${o.r};--dur:${o.dur}s;animation-delay:${start}s">
        <button class="pl ${o.cube ? 'cube' : ''}" type="button" data-planet="${o.id}" style="--s:${o.size};--dur:${o.dur}s;animation-delay:${start}s"><span class="pl-ball" style="background:${o.color}"></span><span class="pl-lock">🔒</span><span class="pl-name">${PL(o.id).name}</span></button>
      </div>`;
  });
  sys.innerHTML = html;
}
function openMap() {
  if (!playing) return;
  ui.mapUni = uniOf(cur());
  ui.mapSel = cur();
  renderMap();
  $('mapOverlay').classList.add('open');
  Sound.ui();
  tutEvent('map');
}
function closeMap() { $('mapOverlay').classList.remove('open'); }
function setMapUni(u) {
  if (!UNIVERSES[u] || ui.mapUni === u) return;
  ui.mapUni = u;
  ui.mapSel = UNIVERSES[u].planets.includes(cur()) ? cur() : UNIVERSES[u].planets[0];
  Sound.ui();
  renderMap();
}
// подпись состояния карты: перерисовываем, только когда что-то реально изменилось
function mapSig() {
  const u = ui.mapUni;
  if (u !== 'sol' && !state.unis.includes(u)) return u + universeInfo(u).reqs.map(r => r.ok ? 1 : 0).join('') + Math.floor(state.gems);
  return u + state.unlocked.join() + state.unis.join() + ui.mapSel + cur() + costSig(unlockInfo(ui.mapSel).cost || {})
    + Object.values(rates(ui.mapSel)).map(v => Math.round(v)).join() + ps(ui.mapSel).era;
}
function renderMap() {
  renderMap.sig = mapSig();
  const u = ui.mapUni, U = UNIVERSES[u], open = state.unis.includes(u);
  if (mapBuiltFor !== u + (open ? '' : '!')) { buildMap(u); mapBuiltFor = u + (open ? '' : '!'); }
  $('mapTitle').textContent = `${U.icon} ${U.title}`;
  $('mapSub').textContent = open ? U.mapSub : 'Измерение закрыто — выполните цели и пройдите через чёрную дыру';
  $('uniTabs').innerHTML = UNIVERSE_ORDER.map(x => `<button class="uni-tab ${x === u ? 'sel' : ''} ${state.unis.includes(x) ? '' : 'locked'}" data-uni="${x}" type="button" style="--uc:${UNIVERSES[x].color}">
    <span>${state.unis.includes(x) ? UNIVERSES[x].icon : '🕳️'}</span><span>${UNIVERSES[x].short}</span></button>`).join('');
  if (!open) {
    const info = universeInfo(u);
    $('planetChips').innerHTML = '';
    $('planetInfo').innerHTML = `<div class="pi-head"><div class="pi-icon">🕳️</div><div><div class="pi-name">${U.hole}</div><div class="pi-sub">${esc(U.arrive)}</div></div></div>
      <div class="pi-reqs">${info.reqs.map(q => `<div class="req ${q.ok ? 'ok' : ''}"><span>${q.ok ? '✅' : '⬜'} ${esc(q.label)}</span>${q.have ? `<b>${esc(q.have)}</b>` : ''}</div>`).join('')}</div>
      <div class="pi-bonus">Бонус: +${Math.round(UNIVERSE_BONUS * 100)}% к доходу всех планет во всех измерениях</div>
      <button class="btn-main hole-btn" data-action="universe" data-id="${u}" type="button" ${info.ready ? '' : 'disabled'}>🕳️ Войти в чёрную дыру (${info.gems} 💎)</button>`;
    return;
  }
  document.querySelectorAll('#system .pl[data-planet]').forEach(b => {
    const pid = b.dataset.planet;
    b.classList.toggle('locked', !isUnlocked(pid));
    b.classList.toggle('here', pid === cur());
    b.classList.toggle('sel', pid === ui.mapSel);
  });
  $('planetChips').innerHTML = U.planets.map(pid => `
    <button class="pchip-btn ${pid === ui.mapSel ? 'sel' : ''} ${isUnlocked(pid) ? '' : 'locked'}" data-planet="${pid}" type="button">
      <span>${isUnlocked(pid) ? PL(pid).icon : '🔒'}</span><span>${PL(pid).name}</span>
    </button>`).join('');
  const pid = U.planets.includes(ui.mapSel) ? ui.mapSel : U.planets[0], P = PL(pid);
  ui.mapSel = pid;
  let html = `<div class="pi-head"><div class="pi-icon">${P.icon}</div><div><div class="pi-name">${P.name}</div>`;
  if (isUnlocked(pid)) {
    const r = rates(pid);
    html += `<div class="pi-sub">${stageLabel(pid)} · ${P.eras[ps(pid).era].name}${prestigeCount(pid) ? ' · 🌀' + prestigeCount(pid) : ''}</div></div></div>
      <div class="pi-rates">${P.res.map(k => `<span class="chip ok">${r[k] > 0 ? '+' + fmtRate(r[k]) : '0'} ${RES[k].icon}/с</span>`).join('')}</div>
      ${pid === cur() ? '<div class="pi-here">📍 Вы здесь</div>' : `<button class="btn-main" data-action="travel" data-id="${pid}" type="button">🚀 Перелететь</button>`}`;
  } else {
    const info = unlockInfo(pid);
    html += `<div class="pi-sub">Не исследована</div></div></div>
      <div class="pi-reqs">${info.reqs.map(q => `<div class="req ${q.ok ? 'ok' : ''}"><span>${q.ok ? '✅' : '⬜'} ${esc(q.label)}</span></div>`).join('')}</div>
      ${info.cost && Object.keys(info.cost).length ? `<div class="pi-cost"><span class="pi-cost-lbl">Экспедиция:</span>${costChips(info.cost)}</div>` : ''}
      <button class="btn-main" data-action="expedition" data-id="${pid}" type="button" ${info.ready ? '' : 'disabled'}>🛰️ Снарядить экспедицию</button>`;
  }
  // следующее измерение: напоминание о чёрной дыре
  const nu = UNIVERSE_ORDER.find(x => UNIVERSES[x].need && UNIVERSES[x].need.from === u && !state.unis.includes(x));
  if (nu) {
    const inf = universeInfo(nu), done = inf.reqs.filter(r => r.ok).length;
    html += `<button class="hole-teaser ${inf.ready ? 'ready' : ''}" data-uni="${nu}" type="button"><span class="ht-ico">🕳️</span><span class="ht-txt"><b>${UNIVERSES[nu].hole}</b><i>${inf.ready ? 'Всё готово — можно входить!' : `Цели: ${done} из ${inf.reqs.length}`}</i></span><span>›</span></button>`;
  }
  $('planetInfo').innerHTML = html;
}

// ---------- Чёрная дыра: переход в новое измерение ----------
let holeBusy = false;
function enterUniverse(u) {
  const info = universeInfo(u);
  if (holeBusy || info.open || !info.ready) { Sound.error(); return; }
  state.gems -= info.gems;
  state.unis.push(u);
  const first = UNIVERSES[u].planets[0];
  if (!isUnlocked(first)) state.unlocked.push(first);
  saveLocal(); queueSync(500);
  closeMap();
  playBlackHole(u, () => {
    state.planet = first;
    endAsteroid(true);
    onPlanetChanged();
    pulseScale = 0.5;
    Sound.setUniverse(u);
    saveLocal();
  }, () => {
    const E = PL(first).eras[0];
    showCinema({ kicker: 'Новое измерение', big: UNIVERSES[u].icon, title: UNIVERSES[u].name, desc: UNIVERSES[u].arrive, color: UNIVERSES[u].color,
      chips: [`${PL(first).icon} ${PL(first).name}`, `🧰 Новые сундуки`, `🎩 Новые образы`, `🏆 Топ престижей «${UNIVERSES[u].short}»`],
      extra: `+${Math.round(UNIVERSE_BONUS * 100)}% к доходу всех планет! ${PL(first).name} начинается с первого этапа, а прошлые планеты и все ${fmt(totalPrestige())} ${plural(totalPrestige(), 'престиж', 'престижа', 'престижей')} остаются с вами — вернуться можно на карте.` });
  });
}
// анимация: экран засасывает в воронку с огненным диском, звёзды растягиваются, вспышка — и новое измерение
function playBlackHole(u, onMid, onEnd) {
  holeBusy = true;
  const el = $('blackhole');
  $('bhText').textContent = `Переход: ${UNIVERSES[u].name}`;
  $('bhIcon').textContent = UNIVERSES[u].icon;
  el.style.setProperty('--uc', UNIVERSES[u].color);
  el.classList.remove('open'); void el.offsetWidth;
  el.classList.add('open');
  Sound.blackhole();
  vibrate([60, 80, 120, 80, 200]);
  setTimeout(onMid, 2100);
  setTimeout(() => { el.classList.remove('open'); holeBusy = false; onEnd && onEnd(); }, 3600);
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
  if (!t) return '';
  const base = pid + ps(pid).era + t;
  if (t === 'social') return base + socialVer;
  if (t === 'chat') return 'chat' + ui.chatTab + (ui.chatWith || '') + chatShellVer;
  if (t === 'dev') return base + Math.floor(state.gems) + GLOBAL_PERKS.map(p => perk(p.id)).join() + PL(pid).perks.map(p => ppk(pid, p.id)).join()
    + prestigeInfo(pid).goals.map(g => g.ok ? 1 : (g.kind === 'stage' ? 0 : Math.floor(g.have / g.goal * 20))).join('') + prestigeCount(pid) + state.unlocked.join();
  if (t === 'top') { const l = myLocalEntry(ui.lbBoard, ui.lbPeriod); return base + lbVer + ui.lbBoard + ui.lbPeriod + (myProfile ? myProfile.rank + ':' + myProfile.score : '') + totalPrestige() + (l ? ':' + l.score : ''); }
  if (t === 'shop') return base + ui.shopTab + COSMETICS.map(c => state.ownedCosmetics.includes(c.id) ? 'o' : (c.code || c.chest) ? 'c' : costSig(c.cost || {})).join('') + state.unlocked.join() + state.unis.join();
  return buildStructSig();
}
// Вкладка «Постройки» перестраивается целиком, только когда меняется набор карточек (этап, режим покупки, престиж).
// Всё остальное — цены, «×N» в режиме MAX, доступность кнопки, цели престижа — обновляется на месте:
// раньше панель пересобиралась ~10 раз в секунду, и нажатие на кнопку терялось (задержка в режиме MAX).
function buildStructSig() { const pid = cur(); return 'build' + pid + ps(pid).era + ui.buyMode + prestigeCount(pid); }
function refreshUI() {
  renderHeaderAndEra();
  if (ui.tab === 'build' && lastPanelSig === buildStructSig()) patchBuildPanel();
  else if (ui.tab && panelSig() !== lastPanelSig) renderPanel();
  updateQuestBadge();
}

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
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  if (ui.tab) $('panelTitle').innerHTML = panelTitle();
}
function updateUserChip() {
  const name = myProfile ? myProfile.nickname : 'Гость';
  const av = $('hudAvatar');
  av.innerText = myProfile ? initialOf(name) : '?';
  av.setAttribute('style', myProfile ? avatarStyle(name) : 'background:#334155');
  $('hudName').innerText = name;
}
function renderRankPill() { $('rankText').innerText = (myProfile && myProfile.rank) ? `#${myProfile.rank}` : 'Топ'; }
function updateSoundBtn() { if ($('settingsOverlay').classList.contains('open')) renderSettings(); }
function toggleSound() { Sound.toggle(); updateSoundBtn(); }

// Смена планеты: шапка, вкладки, фон, всё остальное
function onPlanetChanged() {
  if (!isUnlocked(state.planet)) state.planet = 'earth';
  buildResourceBar();
  requestAnimationFrame(resizeCanvas);
  syncTabButtons();
  applyBodyBg();
  document.body.dataset.planet = cur();
  $('mapBtnIcon').textContent = PL(cur()).icon;
  document.body.dataset.uni = uniOf(cur());
  Sound.setUniverse(uniOf(cur()));
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
  // престижи этой планеты; если в других (например, после чёрной дыры здесь ещё 0) — и сколько всего
  const prAll = totalPrestige(), prHere = prestigeCount(pid);
  const hs = `${P.icon} ${stageLabel(pid)} · ×${fmt(planetMult(pid))}${prHere ? ' · 🌀' + prHere : ''}${prAll > prHere ? ` · всего 🌀${fmt(prAll)}` : ''}`;
  if ($('hudSub').innerText !== hs) $('hudSub').innerText = hs;
  const sp = speedMult(), bl = boostLeft(), fl = buffLeft('frenzy'), wl = buffLeft('wind');
  $('speedBadge').hidden = sp <= 1 && !bl && !fl && !wl;
  const sbt = [fl ? `🔥×${starBonus('frenzy').mult} ${fmtCountdown(fl / 1000)}` : '', wl ? `🌬️×${starBonus('wind').mult} ${fmtCountdown(wl / 1000)}` : '',
    bl ? `⚡×2 ${fmtCountdown(bl / 1000)}` : '', sp > 1 ? `⏳${Math.round(sp * 100)}%` : ''].filter(Boolean).join(' ');
  if ($('speedBadge').textContent !== sbt) $('speedBadge').textContent = sbt;
  $('speedBadge').classList.toggle('boost', !!(bl || fl || wl));
  $('astText').innerText = activeAsteroid ? 'Бой!' : playing ? fmtCountdown(bossCooldown) : '—';
  $('astPill').classList.toggle('alert', !!activeAsteroid);
  // подсказки на кнопках меню: престиж готов, есть на что улучшить
  const devDot = canPrestige(pid) || GLOBAL_PERKS.some(p => perk(p.id) < p.max && state.gems >= perkCost(p, perk(p.id)))
    || P.perks.some(p => ppk(pid, p.id) < p.max && state.gems >= perkCost(p, ppk(pid, p.id)));
  if ($('dotDev').hidden === devDot) $('dotDev').hidden = !devDot;
  $('dotDev').classList.toggle('pr', canPrestige(pid));

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
        <div class="card-title"><span>${b.name}</span><span class="card-count" ${count ? '' : 'hidden'}>×${count}</span></div>
        <div class="card-desc">${b.desc}</div>
        <div class="card-prod">${prod}</div>
      </div>
      <button class="btn-buy" data-action="build" data-id="${b.id}" type="button" ${afford ? '' : 'disabled'}>
        <span>Построить <b class="buy-n">${n > 1 ? '×' + n : ''}</b></span><span class="buy-cost">${costChips(cost)}</span>
      </button>
    </div>`;
}
// Сколько осталось до престижа планеты — коротко, прямо над постройками
function prestigeMiniHtml(pid) {
  const info = prestigeInfo(pid);
  return `<div class="pp-mini ${info.ready ? 'ready' : ''}" data-action="gotodev" style="--i:1">
    <div class="ppm-head"><span>🌀 До престижа №${info.n + 1}</span><span>${info.ready ? 'Готово! Нажмите →' : `×${info.mult} → ×${info.nextMult} · +${info.gems} 💎`}</span></div>
    ${info.goals.map((g, k) => `<div class="ppm-goal ${g.ok ? 'ok' : ''}" data-g="${k}"><span class="ppm-l">${g.ok ? '✅' : '⬜'} ${esc(g.label)}</span>
      <span class="ppm-v">${g.kind === 'stage' ? `${g.have}/${g.goal}` : `${fmt(Math.min(g.have, g.goal))}/${fmt(g.goal)}`}</span>
      <span class="ppm-bar"><i style="width:${Math.min(100, (g.kind === 'stage' ? g.have / g.goal : g.have / g.goal) * 100).toFixed(1)}%"></i></span></div>`).join('')}
  </div>`;
}
// Обновить карточки построек на месте, не пересоздавая кнопки
function patchBuildPanel() {
  const pid = cur(), c = $('panelContent');
  for (const b of PL(pid).buildings) {
    if (b.u > ps(pid).era) continue;
    const card = c.querySelector(`[data-card="${b.id}"]`);
    if (!card) continue;
    const n = buyCount(pid, b), cost = bulkCost(pid, b, n), afford = canPay(cost), count = ps(pid).counts[b.id] || 0;
    card.classList.toggle('affordable', afford);
    const btn = card.querySelector('.btn-buy');
    if (btn.disabled === afford) btn.disabled = !afford;
    const nTxt = n > 1 ? '×' + n : '';
    const bn = card.querySelector('.buy-n'); if (bn.textContent !== nTxt) bn.textContent = nTxt;
    const chips = costChips(cost), bc = card.querySelector('.buy-cost');
    if (bc._html !== chips) { bc.innerHTML = chips; bc._html = chips; }
    const cc = card.querySelector('.card-count'), cTxt = '×' + count;
    if (cc.textContent !== cTxt) cc.textContent = cTxt;
    if (cc.hidden !== !count) cc.hidden = !count;
  }
  const mini = c.querySelector('.pp-mini');
  if (mini) {
    const info = prestigeInfo(pid);
    mini.classList.toggle('ready', info.ready);
    info.goals.forEach((g, k) => {
      const row = mini.querySelector(`[data-g="${k}"]`); if (!row) return;
      row.classList.toggle('ok', g.ok);
      const v = g.kind === 'stage' ? `${g.have}/${g.goal}` : `${fmt(Math.min(g.have, g.goal))}/${fmt(g.goal)}`;
      const vEl = row.querySelector('.ppm-v'); if (vEl.textContent !== v) vEl.textContent = v;
      const l = `${g.ok ? '✅' : '⬜'} ${g.label}`, lEl = row.querySelector('.ppm-l'); if (lEl.textContent !== l) lEl.textContent = l;
      row.querySelector('.ppm-bar i').style.width = Math.min(100, g.have / g.goal * 100).toFixed(1) + '%';
    });
    const head = mini.querySelector('.ppm-head span:last-child'), ht = info.ready ? 'Готово! Нажмите →' : `×${info.mult} → ×${info.nextMult} · +${info.gems} 💎`;
    if (head.textContent !== ht) head.textContent = ht;
  }
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

function panelTitle() {
  const P = PL(cur()), at = `<small>${P.icon} ${P.name}</small>`;
  return ({ build: '🏗️ Постройки ' + at, dev: '🌀 Развитие ' + at, top: '🏆 Рейтинг', chat: '💬 Чат',
    social: '👥 Друзья и альянсы', shop: '🎩 Образ ' + at })[ui.tab] || '';
}

function renderPanel() {
  if (!ui.tab) return;
  const container = $('panelContent');
  const scroll = container.scrollTop;
  const tab = ui.tab, pid = cur(), P = PL(pid), st = ps(pid);
  container.classList.toggle('chat-mode', tab === 'chat');

  if (tab === 'top') {
    container.innerHTML = renderLeaderboardHtml();
  } else if (tab === 'social') {
    container.innerHTML = renderSocialHtml();
  } else if (tab === 'chat') {
    renderChatShell(container);
    lastPanelSig = panelSig();
    return;
  } else if (tab === 'dev') {
    // Престиж и улучшения — в одной вкладке: сначала престиж планеты, ниже перки
    const info = prestigeInfo(pid);
    let i = 0;
    // престижи всех открытых планет — по измерениям (прошлые измерения никуда не деваются)
    const others = UNIVERSE_ORDER.filter(u => state.unlocked.some(x => uniOf(x) === u)).map(u => {
      const chips = state.unlocked.filter(x => uniOf(x) === u).map(x => `<span class="pp-chip ${x === pid ? 'cur' : ''}">${PL(x).icon} ${prestigeCount(x)} 🌀 · ×${planetMult(x)}</span>`).join('');
      return state.unis.length > 1 ? `<div class="pp-uni">${UNIVERSES[u].icon} ${UNIVERSES[u].short}</div>${chips}` : chips;
    }).join('') + (totalPrestige() ? `<div class="pp-total">Всего престижей во всех измерениях: 🌀 ${fmt(totalPrestige())}</div>` : '');
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
      ${P.perks.map(p => perkCard(p, ppk(pid, p.id), 'pperk', 'pp-' + p.id, i++, planetPerkEffect(p, ppk(pid, p.id)))).join('')}
      <div class="shop-note" style="--i:${i++}">Кристаллы дают престиж, астероиды, сундуки и квесты.${allyBonus ? ` Бонус альянса: +${Math.round(allyBonus * 100)}% к доходу.` : ''}${uniMult() > 1 ? ` Бонус измерений: +${Math.round((uniMult() - 1) * 100)}%.` : ''}</div>`;
  } else if (tab === 'shop') {
    const look = state.look[pid];
    // образы закрытых измерений не показываем — пусть будут сюрпризом
    const items = COSMETICS.filter(c => c.type === ui.shopTab && (!c.uni || state.unis.includes(c.uni)));
    container.innerHTML = `
      <div class="seg" style="--i:0">
        <button class="seg-btn ${ui.shopTab === 'hat' ? 'active' : ''}" data-action="shoptab" data-id="hat" type="button">🎩 Шапки</button>
        <button class="seg-btn ${ui.shopTab === 'bg' ? 'active' : ''}" data-action="shoptab" data-id="bg" type="button">🖼️ Фоны</button>
      </div>
      <div class="shop-note" style="--i:1">Образ для планеты <b>${P.icon} ${P.name}</b> — у каждой планеты свой.</div>
      ${items.map((item, idx) => {
        const owned = state.ownedCosmetics.includes(item.id);
        const equipped = item.type === 'hat' ? look.hat === item.id : look.bg === item.id;
        const lockedPlanet = !!itemLock(item);
        const preview = item.type === 'bg'
          ? `<div class="icon-tile swatch" style="background:${item.swatch}"><span>${item.icon}</span></div>`
          : `<div class="icon-tile t-shop">${item.icon}</div>`;
        const badge = item.legend ? `<span class="planet-badge legend">♾️ финал</span>` : item.code ? `<span class="planet-badge code">🎁 эксклюзив</span>` : item.chest ? `<span class="planet-badge chest">🧰 ${item.uni ? UNIVERSES[item.uni].short : 'редкий'}</span>` : item.planet ? `<span class="planet-badge">${PL(item.planet).icon} ${PL(item.planet).name}</span>` : item.uni ? `<span class="planet-badge">${UNIVERSES[item.uni].icon} ${UNIVERSES[item.uni].short}</span>` : '';
        let btn;
        if (owned) btn = `<button class="btn-buy ${equipped ? 'equipped' : ''}" data-action="cosmetic" data-id="${item.id}" type="button"><span>${equipped ? '✓ Надето' : 'Надеть'}</span>${equipped ? '<span class="buy-sub">снять</span>' : ''}</button>`;
        else if (item.legend) btn = `<button class="btn-buy" type="button" disabled><span>♾️ Финал</span><span class="buy-sub">${planetsMaxedAll()}/${PLANET_ORDER.length} планет пройдено</span></button>`;
        else if (item.code) btn = `<button class="btn-buy code-btn" data-action="codes" type="button"><span>🎁 Промокод</span><span class="buy-sub">только по коду</span></button>`;
        else if (item.chest) btn = `<button class="btn-buy chest-btn" data-action="chests" type="button"><span>🧰 Сундук</span><span class="buy-sub">только из сундуков</span></button>`;
        else if (lockedPlanet) btn = `<button class="btn-buy" type="button" disabled><span>${itemLock(item)}</span><span class="buy-sub">ещё закрыто</span></button>`;
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
    // все постройки планеты в одной вкладке — по порядку открытия; сверху — сколько осталось до престижа
    const mult = prodMult(pid);
    const list = P.buildings.map((b, k) => ({ b, k })).sort((x, y) => x.b.u - y.b.u || x.k - y.k).map(x => x.b);
    const open = list.filter(b => b.u <= st.era);
    const next = list.find(b => b.u > st.era);
    const modes = `<div class="buy-modes" style="--i:0"><span class="bm-lbl">Купить</span>${BUY_MODES.map(m => `<button class="bm-btn ${ui.buyMode === m ? 'active' : ''}" data-action="buymode" data-id="${m}" type="button">${m === 'max' ? 'MAX' : '×' + m}</button>`).join('')}</div>`;
    container.innerHTML = (open.length ? modes : '') + prestigeMiniHtml(pid) + open.map((b, i) => buildingCard(pid, b, mult, Math.min(i + 2, 14))).join('')
      + (next ? `<div class="card teaser" style="--i:${Math.min(open.length + 2, 15)}"><div class="icon-tile locked-tile">${next.icon}</div><div class="card-info"><div class="card-title"><span>🔒 ${next.name}</span></div><div class="card-desc" style="margin:0;">Откроется: ${stageLabel(pid, next.u)} «${P.eras[next.u].name}»</div></div></div>` : '')
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
// Кнопка меню открывает свою панель; повторное нажатие — закрывает (на экране снова только планета)
function openPanel(name) {
  const was = ui.tab;
  ui.tab = name;
  document.body.classList.add('panel-open');
  $('panelSheet').setAttribute('aria-hidden', 'false');
  syncTabButtons();
  if (was !== name) { $('panelContent').scrollTop = 0; renderPanel(); animatePanel(); Sound.ui(); }
  resizeCanvas();
  if (name === 'top') fetchLeaderboard();
  if (name === 'social') fetchSocial();
  if (name === 'chat') { if (!social && canOnline()) fetchSocial(); fetchChatSummary(); }
  tutEvent('tab:' + name);
}
function closePanel() {
  if (!ui.tab) return;
  ui.tab = null;
  document.body.classList.remove('panel-open');
  $('panelSheet').setAttribute('aria-hidden', 'true');
  syncTabButtons();
  resizeCanvas();
  Sound.ui();
}
function selectTab(name) { if (ui.tab === name) closePanel(); else openPanel(name); }

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
    else if (a === 'player') openPlayer(btn.dataset.nick || id);
    else if (a === 'alliance') openAlliance(+id);
    else if (a === 'socialtab') { if (ui.socialTab !== id) { ui.socialTab = id; socialMsg.text = ''; Sound.ui(); renderPanel(); animatePanel(); if (id === 'ally') fetchAlliances(); } }
    else if (a === 'copycode') copyText(id, 'Код скопирован — отправьте его другу');
    else if (a === 'sharecode') shareFriendCode(id);
    else if (a === 'addfriend') addFriend();
    else if (a === 'allyjoin') joinAlliance({ id: +id });
    else if (a === 'allyjoincode') joinAllianceByCode();
    else if (a === 'allycreate') openAllianceCreate();
    else if (a === 'allyperiod') { if (ui.allyPeriod !== id) { ui.allyPeriod = id; Sound.ui(); fetchAlliances(); } }
    else if (a === 'allydonate') openDonate();
    else if (a === 'chatally') { ui.chatTab = 'ally'; ui.chatWith = null; openPanel('chat'); }
    else if (a === 'chattab') { if (ui.chatTab !== id || ui.chatWith) { ui.chatTab = id; ui.chatWith = null; chatShellVer++; Sound.ui(); renderPanel(); } }
    else if (a === 'chatwith') { Sound.ui(); openChatWith(id); }   // из списка личных сообщений и из друзей
    else if (a === 'chatback') { ui.chatWith = null; chatShellVer++; Sound.ui(); renderPanel(); fetchChatSummary(); }
    else if (a === 'chatsend') sendChat();
    else if (a === 'chatdel' || a === 'chatmute') chatAdmin(a, id);
    else if (a === 'gofriends') { ui.socialTab = 'friends'; openPanel('social'); }
    else if (a === 'goally') { ui.socialTab = 'ally'; openPanel('social'); }
  });
  // карточка «До престижа» в постройках — переход во вкладку «Развитие»
  $('panelContent').addEventListener('click', (e) => { if (e.target.closest('.pp-mini')) { Sound.ui(); openPanel('dev'); } });
  // строки рейтинга, друзья, участники альянса — открывают профиль (вся строка, а не только кнопка)
  $('panelContent').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    const row = e.target.closest('[data-nick], [data-ally]');
    if (!row) return;
    if (row.dataset.nick) openPlayer(row.dataset.nick); else openAlliance(+row.dataset.ally);
  });
  $('panelContent').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'friendCodeInput') addFriend();
    if (e.target.id === 'allyCodeInput') joinAllianceByCode();
    if (e.target.id === 'chatInput') { e.preventDefault(); sendChat(); }
  });
  $('panelClose').addEventListener('click', closePanel);
  // смахнуть панель вниз — закрыть
  let dragY = null;
  $('panelHead').addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; dragY = e.clientY; });
  window.addEventListener('pointermove', (e) => {
    if (dragY === null) return;
    const dy = Math.max(0, e.clientY - dragY);
    $('panelSheet').style.transform = dy ? `translateY(${dy}px)` : '';
  });
  window.addEventListener('pointerup', (e) => {
    if (dragY === null) return;
    const dy = e.clientY - dragY; dragY = null;
    $('panelSheet').style.transform = '';
    if (dy > 70) closePanel();
  });
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsOverlay').addEventListener('click', (e) => { if (e.target === $('settingsOverlay')) $('settingsOverlay').classList.remove('open'); });
  $('allyOverlay').addEventListener('click', (e) => { if (e.target === $('allyOverlay')) $('allyOverlay').classList.remove('open'); });
  $('evolveBtn').addEventListener('click', evolveEra);
  $('rankPill').addEventListener('click', () => { if (playing) openPanel('top'); });
  $('mapBtn').addEventListener('click', openMap);
  $('mapClose').addEventListener('click', () => { closeMap(); Sound.ui(); });
  $('mapOverlay').addEventListener('click', (e) => {
    const pl = e.target.closest('.pl[data-planet], .pchip-btn[data-planet]');
    if (pl) { ui.mapSel = pl.dataset.planet; Sound.ui(); renderMap(); return; }
    const ut = e.target.closest('.uni-tab[data-uni], .hole-teaser[data-uni]');   // не body[data-uni]!
    if (ut) { setMapUni(ut.dataset.uni); return; }
    const btn = e.target.closest('button[data-action]');
    if (btn && !btn.disabled) {
      if (btn.dataset.action === 'travel') travelTo(btn.dataset.id);
      if (btn.dataset.action === 'expedition') launchExpedition(btn.dataset.id);
      if (btn.dataset.action === 'universe') enterUniverse(btn.dataset.id);
      return;
    }
    if (e.target === $('mapOverlay')) closeMap();
  });
  $('cinema').addEventListener('click', closeCinema);
  $('userChip').addEventListener('click', openProfile);
  $('demoBtn').addEventListener('click', startDemo);
  $('googleBtn').addEventListener('click', startGoogleLogin);
  $('yandexBtn').addEventListener('click', () => startOAuthLogin('yandex'));
  $('twitchBtn').addEventListener('click', twitchLogin);
  if (IS_TWITCH) $('loginNote').textContent = 'Мы храним только ваш ник и игровой прогресс. Имя и почту из Twitch игра не получает.';
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
    if (b && b.dataset.qkind === 'login') { $('questsOverlay').classList.remove('open'); openLoginReward(); return; }
    if (b) { claimQuest(b.dataset.qkind, b.dataset.qid, b); return; }
    if (e.target === $('questsOverlay')) $('questsOverlay').classList.remove('open');
  });
  $('shopClose').addEventListener('click', () => { $('shopOverlay').classList.remove('open'); Sound.ui(); });
  $('chestList').addEventListener('click', (e) => { const b = e.target.closest('.chest-buy'); if (b && !b.disabled) openChest(b.dataset.chest); });
  $('shopTabs').addEventListener('click', (e) => { const b = e.target.closest('.seg-btn'); if (b && ui.storeTab !== b.dataset.id) { ui.storeTab = b.dataset.id; Sound.ui(); renderShop(); } });
  $('soundList').addEventListener('click', (e) => {
    const pl = e.target.closest('[data-play]');
    if (pl) { const st = pl.dataset.play; Sound.tap(false, st, 1); setTimeout(() => Sound.tap(false, st, 2), 170); setTimeout(() => Sound.tap(true, st, 3), 340); return; }
    const b = e.target.closest('[data-snd]'); if (b && !b.disabled) handleCosmetic(b.dataset.snd);
  });
  $('coachNext').addEventListener('click', tutNext);
  $('coachSkip').addEventListener('click', tutSkip);
  $('chestOverlay').addEventListener('click', (e) => { if (e.target.closest('#chestTake')) return; revealChest(); });
  $('chestTake').addEventListener('click', () => { Sound.coin(); closeChest(); });
  $('lrClose').addEventListener('click', () => { $('loginRewardOverlay').classList.remove('open'); Sound.ui(); });
  $('lrClaim').addEventListener('click', claimLoginReward);
  $('loginRewardOverlay').addEventListener('click', (e) => { if (e.target === $('loginRewardOverlay')) $('loginRewardOverlay').classList.remove('open'); });
  $('wkClaim').addEventListener('click', claimWeekly);
  $('weeklyOverlay').addEventListener('click', (e) => { if (e.target === $('weeklyOverlay')) $('weeklyOverlay').classList.remove('open'); });
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
window.__terraPause = function () { Sound.suspend(); if (playing) { saveLocal(); syncNow(true); } };
window.__terraResume = function () { Sound.resume(); };
window.__terraBack = function () {
  if (cinemaOpen) { cinemaShownAt = 0; closeCinema(); return true; }
  if ($('confirmOverlay').classList.contains('open')) { $('confirmCancel').click(); return true; }
  if ($('mapOverlay').classList.contains('open')) { closeMap(); return true; }
  if ($('allyOverlay').classList.contains('open')) { $('allyOverlay').classList.remove('open'); return true; }
  if ($('profileOverlay').classList.contains('open')) { $('profileOverlay').classList.remove('open'); return true; }
  if ($('settingsOverlay').classList.contains('open')) { $('settingsOverlay').classList.remove('open'); return true; }
  if (forcedUpdate) return true;   // окно «Нужно обновление» не закрывается
  if ($('updateOverlay').classList.contains('open')) { $('updateOverlay').classList.remove('open'); return true; }
  if ($('questsOverlay').classList.contains('open')) { $('questsOverlay').classList.remove('open'); return true; }
  if ($('chestOverlay').classList.contains('open')) { if ($('chestOverlay').classList.contains('opened')) closeChest(); else revealChest(); return true; }
  if ($('shopOverlay').classList.contains('open')) { $('shopOverlay').classList.remove('open'); return true; }
  if ($('codeOverlay').classList.contains('open')) { $('codeOverlay').classList.remove('open'); return true; }
  if (ui.tab) { closePanel(); return true; }
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
  } else if (activeAsteroid && !document.hidden && performance.now() - astStepAt > 600) {
    stepAsteroid(dt);   // кадры не идут — двигаем астероид отсюда, чтобы таймер не замирал
  }
  if (!star && !cinemaOpen && !traveling && !document.hidden && !tutOn()) {
    starCooldown -= dt;
    if (starCooldown <= 0) spawnStar();
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

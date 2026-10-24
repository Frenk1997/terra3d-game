// История сохранения игрока по ежедневным копиям базы и восстановление из копии. Запускается на VPS
// сценарием .github/workflows/player.yml (Actions → Player save → Run workflow), вручную ничего делать не нужно.
//
//   node player.mjs history <ник>            — сводка по живой базе и каждой копии в /var/lib/terra/backups
//   node player.mjs restore <ник> <ГГГГ-ММ-ДД> — вернуть сохранение из копии этого дня (перед этим — копия базы)
//
// В журнал попадают только игровые числа (престижи, этапы, измерения, кристаллы) — то же, что видно в профиле.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA = process.env.TERRA_DATA || '/var/lib/terra';
const LIVE = join(DATA, 'terra.db'), BACKUPS = join(DATA, 'backups');
const [, , action, nickRaw, day] = process.argv;
const nick = String(nickRaw || '').trim().toLowerCase();
if (!nick || !['history', 'restore'].includes(action)) { console.log('usage: player.mjs history|restore <nick> [YYYY-MM-DD]'); process.exit(2); }

const PLANETS = ['earth', 'mars', 'jupiter', 'venus', 'mercury', 'mirage', 'anubis', 'dust2', 'inferno', 'ancient', 'plains', 'jungle', 'tundra', 'nether', 'end'];
const short = { earth: 'Зем', mars: 'Мар', jupiter: 'Юп', venus: 'Вен', mercury: 'Мер', mirage: 'Мир', anubis: 'Ану', dust2: 'Даст', inferno: 'Инф', ancient: 'Древ', plains: 'Рав', jungle: 'Джу', tundra: 'Тун', nether: 'Нез', end: 'Край' };
const time = (t) => t ? new Date(Number(t)).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '—';

function readPlayer(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('SELECT sub, nickname, score, rebirths, save, updated_at FROM players WHERE nickname_lc = ?').get(nick) || null; }
  finally { db.close(); }
}
function summary(label, row) {
  if (!row) return `${label}: игрока нет`;
  let s = null;
  try { s = row.save ? JSON.parse(row.save) : null; } catch (e) {}
  if (!s) return `${label}: сохранения нет (score ${row.score}, обновлено ${time(row.updated_at)})`;
  const ppr = s.ppr || {}, pl = s.planets || {}, unl = Array.isArray(s.unlocked) ? s.unlocked : [];
  const totalPr = PLANETS.reduce((a, p) => a + (Number(ppr[p]) || 0), 0);
  const planets = PLANETS.filter(p => p === 'earth' || unl.includes(p)).map(p => `${short[p]} эт.${((pl[p] && pl[p].era) | 0) + 1}${ppr[p] ? '/🌀' + ppr[p] : ''}`).join(', ');
  const st = s.stats || {};
  return `${label}: v${s.v} · 🌀${totalPr} · измерения ${(s.unis || ['sol']).join('+')} · 💎${Math.floor(s.gems || 0)} 🔷${Math.floor(s.sapphires || 0)} · тапы ${Math.floor(st.taps || 0)} · в игре ${Math.round((st.playSec || 0) / 60)} мин
    сохранено игрой ${time(s.lastSave)} · сервером ${time(row.updated_at)} · счёт ${row.score}
    ${planets}`;
}

const backups = existsSync(BACKUPS) ? readdirSync(BACKUPS).filter(n => /^terra-\d{4}-\d\d-\d\d\.db$/.test(n)).sort() : [];

if (action === 'history') {
  for (const b of backups) {
    try { console.log(summary('📦 ' + b.slice(6, 16), readPlayer(join(BACKUPS, b)))); } catch (e) { console.log(`📦 ${b}: не прочитать (${e.message})`); }
  }
  console.log(summary('🟢 сейчас', readPlayer(LIVE)));
  process.exit(0);
}

// ---- восстановление ----
if (!/^\d{4}-\d\d-\d\d$/.test(day || '')) { console.log('Укажите дату копии: ГГГГ-ММ-ДД'); process.exit(2); }
const file = join(BACKUPS, `terra-${day}.db`);
if (!existsSync(file)) { console.log(`Копии за ${day} нет. Есть: ${backups.map(b => b.slice(6, 16)).join(', ')}`); process.exit(2); }
const old = readPlayer(file), cur = readPlayer(LIVE);
if (!old || !old.save) { console.log(`В копии за ${day} у игрока нет сохранения`); process.exit(2); }
if (!cur || cur.sub !== old.sub) { console.log('Игрок в живой базе не найден (или это другой аккаунт с тем же ником)'); process.exit(2); }
console.log(summary('было в копии', old));
console.log(summary('сейчас', cur));
// страховка: копия живой базы перед изменением
mkdirSync(join(DATA, 'restore'), { recursive: true });
const safety = join(DATA, 'restore', `before-restore-${nick}-${Date.now()}.db`);
{
  const live = new DatabaseSync(LIVE);
  live.exec(`VACUUM INTO '${safety.replace(/'/g, "''")}'`);
  const s = JSON.parse(old.save);
  s.lastSave = Date.now();   // восстановленное сохранение — самое свежее: устройства возьмут его
  const PR = PLANETS.reduce((a, p) => a + (Number((s.ppr || {})[p]) || 0), 0);
  live.exec('PRAGMA busy_timeout = 10000');
  live.prepare('UPDATE players SET save = ?, rebirths = ?, updated_at = ? WHERE sub = ?').run(JSON.stringify(s), PR, Date.now(), cur.sub);
  live.close();
}
console.log(`✅ Сохранение игрока ${cur.nickname} восстановлено из копии за ${day}. Копия базы до восстановления: ${safety}`);
console.log(summary('теперь', readPlayer(LIVE)));

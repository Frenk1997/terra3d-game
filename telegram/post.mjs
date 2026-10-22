// Ежедневный пост в Telegram-канал Terra 3D. Запускается сценарием .github/workflows/telegram.yml (каждый день в 18:07 МСК).
//
// Расписание (по московскому времени):
//   Пн — совет · Вт — факт о планете · Ср — история и достижения · Чт — топ альянсов
//   Пт — опрос · Сб — зал славы (общий топ) · Вс — итоги недели (недельный топ обнуляется в полночь)
//   Если за прошедшие сутки вышла новая версия игры — вместо обычного поста выходит новость об обновлении.
// Тексты рубрик — в telegram/content.mjs, картинки — в telegram/img.
//
// Переменные окружения:
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather (секрет), TELEGRAM_CHANNEL — @имя_канала или числовой id
//   TERRA_API — адрес игры (сайт и сервер), POST_KIND — auto | release | week | alliances | hall | tip | fact | lore | poll
//   DRY_RUN=true — только показать пост, ничего не отправлять; POST_DATE — «сегодня» для проверки расписания
import { readFileSync, appendFileSync } from 'node:fs';
import { TIPS, FACTS, LORE, POLLS } from './content.mjs';

const env = process.env;
const SITE = String(env.TERRA_API || '').trim().replace(/\/+$/, '');
const APK = SITE ? SITE + '/download/terra3d.apk' : '';
const REPO = env.GITHUB_REPOSITORY || 'Frenk1997/terra3d-game';
const GH_API = env.GITHUB_API || 'https://api.github.com';
const TG_API = env.TELEGRAM_API || 'https://api.telegram.org';
const TOKEN = String(env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT = String(env.TELEGRAM_CHANNEL || '').trim();
const KIND = env.POST_KIND || 'auto';
const DRY = /^(1|true|yes)$/i.test(env.DRY_RUN || '');
const IMG_DIR = new URL('./img/', import.meta.url);

const MSK = 3 * 3600000, DAY = 86400000;
const NOW = env.POST_DATE ? new Date(env.POST_DATE).getTime() : Date.now();
const dayNo = Math.floor((NOW + MSK) / DAY);            // номер дня по Москве
const weekday = new Date(NOW + MSK).getUTCDay();          // 0 — воскресенье
const weekNo = Math.floor((dayNo + 3) / 7);               // недели с понедельника
const anchor = dayNo * DAY - MSK + 18 * 3600000;          // сегодня 18:00 по Москве
const pick = (list, shift = 0) => list[(weekNo + shift) % list.length];

const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const num = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/ /g, ' ');
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many; };
const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
const footer = () => SITE ? `\n\n🌍 <a href="${SITE}">Играть в браузере</a> · 📱 <a href="${APK}">APK для Android</a>` : '';

async function getJson(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------- посты из живых данных игры ----------
async function releasePost(force) {
  const h = { Accept: 'application/vnd.github+json', ...(env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + env.GITHUB_TOKEN } : {}) };
  const rel = await getJson(`${GH_API}/repos/${REPO}/releases/latest`, h);
  const at = Date.parse(rel.published_at || rel.created_at || 0);
  if (!force && !(at > anchor - DAY && at <= anchor)) return null;   // ровно одни сутки до сегодняшних 18:00
  let info = {};
  const asset = (rel.assets || []).find(a => a.name === 'version.json');
  if (asset) { try { info = await getJson(asset.browser_download_url); } catch (e) {} }
  const version = info.version || String(rel.tag_name || '').replace(/^v/, '');
  const notes = String(info.notes || '').trim();
  return { text: `🚀 <b>Обновление Terra 3D ${esc(version)}</b>

${notes ? esc(notes) : 'Исправления и улучшения.'}

Игра сама предложит обновиться при запуске.${footer()}` };
}

async function weekPost() {
  const d = await getJson(`${SITE}/api/leaderboard?board=all&period=week&limit=10`);
  const rows = (d.players || []).filter(p => p.score > 0);
  if (rows.length < 3) return null;
  return { text: `🏁 <b>Итоги недели</b>

Кто вырос сильнее всех за неделю:

${rows.map((p, i) => `${medal(i)} ${esc(p.nickname)} — +${num(p.score)} ${plural(p.score, 'очко', 'очка', 'очков')}`).join('\n')}

Всего в недельной гонке: ${num(d.total)} ${plural(d.total, 'игрок', 'игрока', 'игроков')}.
В полночь недельный топ обнулится — новая неделя, новый шанс! 🔥${footer()}` };
}

async function hallPost() {
  const d = await getJson(`${SITE}/api/leaderboard?board=all&period=all&limit=10`);
  const rows = (d.players || []).filter(p => p.score > 0);
  if (rows.length < 3) return null;
  return { text: `🏆 <b>Зал славы Terra 3D</b>

Лучшие игроки за всё время:

${rows.map((p, i) => `${medal(i)} ${esc(p.nickname)} — ★ ${num(p.score)}${p.rebirths ? ` · 🌀 ${num(p.rebirths)} ${plural(p.rebirths, 'престиж', 'престижа', 'престижей')}` : ''}`).join('\n')}

Всего игроков: ${num(d.total)}. Престиж — 100 очков, каждая эпоха или этап — 1 очко.${footer()}` };
}

async function alliancesPost() {
  let d = await getJson(`${SITE}/api/alliances?period=week`), title = 'Топ альянсов недели';
  if ((d.alliances || []).length < 2) { d = await getJson(`${SITE}/api/alliances?period=all`); title = 'Топ альянсов'; }
  const rows = (d.alliances || []).filter(a => a.taps > 0).slice(0, 10);
  if (rows.length < 2) return null;
  return { text: `🛡️ <b>${title}</b>

По тапам участников (только руками, без автокликера):

${rows.map((a, i) => `${medal(i)} ${esc(a.emblem)} ${esc(a.name)} — 👆 ${num(a.taps)} · 👥 ${a.members}`).join('\n')}

Всего альянсов: ${num(d.total)}. Вступить можно во вкладке «Друзья» → «Альянс» — по коду или из списка открытых.${footer()}` };
}

// ---------- выбор поста ----------
const content = (item) => ({ text: item.text + footer(), img: item.img });
const fallback = () => content(pick(LORE, 5));   // если данных для топа пока мало
const BY_DAY = { 0: 'week', 1: 'tip', 2: 'fact', 3: 'lore', 4: 'alliances', 5: 'poll', 6: 'hall' };

async function build(kind) {
  if (kind === 'auto') {
    try { const r = await releasePost(false); if (r) return { kind: 'release', post: r }; } catch (e) { console.log('Не удалось проверить релиз:', e.message); }
    kind = BY_DAY[weekday];
  }
  const live = { week: weekPost, hall: hallPost, alliances: alliancesPost };
  if (kind === 'release') return { kind, post: await releasePost(true) };
  if (live[kind]) {
    let post = null;
    try { post = SITE ? await live[kind]() : null; } catch (e) { console.log('Нет данных с сервера игры:', e.message); }
    return post ? { kind, post } : { kind: kind + '→lore', post: fallback() };
  }
  if (kind === 'tip') return { kind, post: content(pick(TIPS)) };
  if (kind === 'fact') return { kind, post: content(pick(FACTS)) };
  if (kind === 'lore') return { kind, post: content(pick(LORE)) };
  if (kind === 'poll') return { kind, post: { poll: pick(POLLS) } };
  throw new Error('Неизвестный вид поста: ' + kind);
}

// ---------- Telegram ----------
async function tg(method, payload) {
  const isForm = payload instanceof FormData;
  const r = await fetch(`${TG_API}/bot${TOKEN}/${method}`, isForm
    ? { method: 'POST', body: payload }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || 'HTTP ' + r.status}`);
  return j.result;
}
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt);/g, 'x');
async function publish(post) {
  if (post.poll) {
    return tg('sendPoll', { chat_id: CHAT, question: post.poll.question, options: post.poll.options.map(text => ({ text })), is_anonymous: true });
  }
  if (post.img) {
    const fd = new FormData();
    fd.append('chat_id', CHAT);
    const fits = plain(post.text).length <= 1024;
    if (fits) { fd.append('caption', post.text); fd.append('parse_mode', 'HTML'); }
    fd.append('photo', new Blob([readFileSync(new URL(post.img, IMG_DIR))], { type: 'image/jpeg' }), post.img);
    const m = await tg('sendPhoto', fd);
    if (fits) return m;   // длинный текст — отдельным сообщением под картинкой
  }
  return tg('sendMessage', { chat_id: CHAT, text: post.text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
}

const { kind, post } = await build(KIND);
const preview = post.poll ? `📊 ${post.poll.question}\n${post.poll.options.map(o => '  • ' + o).join('\n')}` : `${post.img ? `[картинка ${post.img}]\n` : ''}${post.text}`;
console.log(`Пост на ${new Date(NOW + MSK).toISOString().slice(0, 10)} (${kind}):\n\n${preview}\n`);
const summary = (s) => { if (env.GITHUB_STEP_SUMMARY) try { appendFileSync(env.GITHUB_STEP_SUMMARY, s + '\n'); } catch (e) {} };
if (DRY) { summary(`### Предпросмотр (${kind})\n\n\`\`\`\n${preview}\n\`\`\``); process.exit(0); }
if (!TOKEN || !CHAT) {
  console.log('::notice title=Telegram не настроен::Добавьте секреты TELEGRAM_BOT_TOKEN и TELEGRAM_CHANNEL (см. SETUP.md → «Telegram-канал»)');
  summary('Telegram не настроен — пост не отправлен (нужны секреты TELEGRAM_BOT_TOKEN и TELEGRAM_CHANNEL).');
  process.exit(0);
}
await publish(post);
console.log('Опубликовано ✅');
summary(`### Опубликовано в ${CHAT} (${kind}) ✅\n\n\`\`\`\n${preview}\n\`\`\``);

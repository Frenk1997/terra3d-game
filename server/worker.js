// Terra 3D — сервер на Cloudflare Workers + D1.
// • Вход через Google по схеме «браузер → Google → наш /auth/google/callback» (работает и в APK, и на сайте).
// • Сессии, ник, облачный прогресс, рейтинг.
// • Веб-версию игры (папка web/) Cloudflare раздаёт сам — см. [assets] в wrangler.toml.
//
// Переменные окружения:
//   GOOGLE_CLIENT_ID      — Client ID (тип «Web application») из Google Cloud Console
//   GOOGLE_CLIENT_SECRET  — секрет этого клиента (wrangler secret)
//   SESSION_SECRET        — любая длинная случайная строка для подписи сессий (wrangler secret)
//   APP_PACKAGE           — (необязательно) имя пакета Android-приложения, по умолчанию com.terra3d.game
//   GITHUB_REPO           — (необязательно) «владелец/репозиторий»: откуда брать номер последней версии APK
//   FORCE_UPDATE          — (необязательно) '0' — пускать в игру устаревшие APK; по умолчанию играть можно только в последней версии
//   PROMO_CODES           — (необязательно, секрет) свои промокоды, по одному в строке (формат — в README)

const enc = new TextEncoder();
const dec = new TextDecoder();

const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // сессия живёт 30 дней
const LOGIN_TTL_MS = 10 * 60 * 1000;       // на вход через Google даётся 10 минут
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SAVE_BYTES = 40000;
// Какие поля сохранения хранятся (остальное отбрасывается). Последние пять — старый формат v2.
const SAVE_KEYS = ['v', 'planet', 'unlocked', 'planets', 'gems', 'sapphires', 'perks', 'ppk', 'ppr', 'rebirths', 'boostUntil', 'ownedCosmetics', 'look',
                   'stats', 'quests', 'lastSave', 'res', 'counts', 'era', 'equippedHat', 'equippedBg'];
const MAX_REBIRTHS = 100000;
const SCORE_PER_MIN = 150;       // на сколько очков рейтинг может вырасти за минуту (престиж = 100 очков)
const FIRST_SYNC_ALLOWANCE = 600; // стартовый запас для нового аккаунта (перенос старого прогресса)
const APP_SCHEME = 'terra3d';
const DEFAULT_APP_PACKAGE = 'com.terra3d.game';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Terra-Client',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra }
  });
}
const fail = (status, error) => json({ error }, status);

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

// ---------- base64url / криптография ----------
function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlToStr = (s) => dec.decode(b64urlToBytes(s));
const randomToken = (n = 32) => b64urlEncode(crypto.getRandomValues(new Uint8Array(n)));
async function sha256b64url(text) {
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signSession(sub, env) {
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const body = b64urlEncode(enc.encode(JSON.stringify({ sub, iat: now, exp: now + SESSION_TTL_SEC })));
  const data = `${header}.${body}`;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(data)));
  return `${data}.${b64urlEncode(sig)}`;
}
async function verifySession(token, env) {
  try {
    if (!env.SESSION_SECRET) return null;
    const p = token.split('.');
    if (p.length !== 3) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), b64urlToBytes(p[2]), enc.encode(`${p[0]}.${p[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(b64urlToStr(p[1]));
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub;
  } catch (e) { return null; }
}

// ---------- Google ----------
async function getGoogleKeys() {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs', { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error('jwks_unavailable');
  return (await res.json()).keys || [];
}
async function verifyGoogleIdToken(idToken, env) {
  const p = String(idToken).split('.');
  if (p.length !== 3) throw new Error('bad_token');
  const header = JSON.parse(b64urlToStr(p[0]));
  const payload = JSON.parse(b64urlToStr(p[1]));
  if (header.alg !== 'RS256') throw new Error('bad_alg');
  const jwk = (await getGoogleKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown_key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(p[2]), enc.encode(`${p[0]}.${p[1]}`));
  if (!valid) throw new Error('bad_signature');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('bad_issuer');
  if (payload.aud !== env.GOOGLE_CLIENT_ID) throw new Error('bad_audience');
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error('expired');
  if (!payload.sub) throw new Error('no_sub');
  return String(payload.sub);
}

// ---------- помощники ----------
function cleanNickname(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (n.length < 3 || n.length > 16) return null;
  if (!/^[\p{L}\p{N}_\-. ]+$/u.test(n)) return null;
  return n;
}
async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) return null;
  try { return await request.json(); } catch (e) { return null; }
}
async function authedSub(request, env) {
  const h = request.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  return verifySession(h.slice(7), env);
}
const getPlayer = (env, sub) => env.DB.prepare('SELECT * FROM players WHERE sub = ?1').bind(sub).first();

async function rankOf(env, p) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS c FROM players WHERE score > ?1 OR (score = ?1 AND score_updated_at < ?2)')
    .bind(p.score, p.score_updated_at).first();
  return (r ? r.c : 0) + 1;
}
async function profileView(env, p) {
  return { nickname: p.nickname, score: p.score, rebirths: p.rebirths, era: p.era, rank: await rankOf(env, p) };
}
function parseSave(p) {
  if (!p || !p.save) return null;
  try { return JSON.parse(p.save); } catch (e) { return null; }
}
const isConfigured = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Небольшая страница, которую игрок видит в браузере после Google.
function htmlPage(status, { title, text, primary, primaryLabel, secondary, secondaryLabel, auto }) {
  const btn = (href, label, main) => href
    ? `<a class="btn${main ? '' : ' soft'}" href="${escHtml(href)}">${escHtml(label)}</a>` : '';
  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${escHtml(title)} · Terra 3D</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(120% 80% at 50% 0%,#17235a 0%,#060b1d 55%,#02040d 100%);color:#f4f7ff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:20px;box-sizing:border-box}
  .card{max-width:360px;width:100%;text-align:center;background:rgba(14,20,42,.85);border:1px solid rgba(148,177,255,.3);border-radius:22px;padding:26px 20px}
  .planet{width:64px;height:64px;margin:0 auto 14px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#7dd3fc,#0369a1 55%,#082f49);box-shadow:0 0 24px rgba(56,189,248,.5)}
  h1{font-size:1.2rem;margin:0 0 8px} p{color:#b6c4ee;font-size:.9rem;line-height:1.45;margin:0 0 18px}
  .btn{display:block;padding:13px;border-radius:14px;background:linear-gradient(135deg,#2f6bff,#7c3aed);color:#fff;text-decoration:none;font-weight:800;margin-top:10px}
  .btn.soft{background:rgba(255,255,255,.07);border:1px solid rgba(148,177,255,.3);color:#dbe4ff;font-weight:700}
</style></head><body><div class="card"><div class="planet"></div>
<h1>${escHtml(title)}</h1><p>${escHtml(text)}</p>
${btn(primary, primaryLabel, true)}${btn(secondary, secondaryLabel, false)}
</div>${auto && primary ? `<script>setTimeout(function(){location.href=${JSON.stringify(primary)}},350)</script>` : ''}</body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

// Вернуть игрока в игру: в APK — через ссылку terra3d://, на сайте — на главную с #auth=...
function backToGame(url, env, row, params) {
  if (row && row.app) {
    const q = new URLSearchParams({ ...params, state: row.state }).toString();
    const pkg = env.APP_PACKAGE || DEFAULT_APP_PACKAGE;
    const intentUrl = `intent://auth?${q}#Intent;scheme=${APP_SCHEME};package=${pkg};end`;
    const ok = !!params.code;
    return htmlPage(200, {
      title: ok ? 'Вход выполнен!' : 'Вход не завершён',
      text: ok ? 'Возвращаемся в игру… Если ничего не произошло, нажмите кнопку ниже.' : 'Вернитесь в игру и попробуйте ещё раз.',
      primary: intentUrl, primaryLabel: 'Вернуться в игру',
      secondary: `${APP_SCHEME}://auth?${q}`, secondaryLabel: 'Открыть другим способом',
      auto: true
    });
  }
  const frag = params.code
    ? `auth=${encodeURIComponent(params.code)}.${encodeURIComponent(row.state)}`
    : `auth_error=${encodeURIComponent(params.error || 'failed')}`;
  return redirect(`${url.origin}/#${frag}`);
}

// ---------- вход через Google ----------
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

async function handleAuthStart(url, env) {
  if (!isConfigured(env)) {
    return htmlPage(503, { title: 'Сервер ещё не настроен', text: 'Владельцу игры: задайте GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET и SESSION_SECRET (см. README).' });
  }
  const state = url.searchParams.get('state') || '';
  const challenge = url.searchParams.get('challenge') || '';
  const app = url.searchParams.get('app') === '1' ? 1 : 0;
  if (app) {
    // вход открывается в браузере: старые версии игры (без номера сборки или со старым) получают страницу «Обновите игру»
    const old = await blockingRelease(parseInt(url.searchParams.get('build') || '0', 10) || 0, env);
    if (old) return updatePage(old);
  }
  if (!STATE_RE.test(state) || !CHALLENGE_RE.test(challenge)) {
    return htmlPage(400, { title: 'Неверная ссылка входа', text: 'Вернитесь в игру и нажмите «Войти через Google» ещё раз.' });
  }
  const now = Date.now();
  await env.DB.prepare('DELETE FROM logins WHERE created_at < ?1').bind(now - 2 * LOGIN_TTL_MS).run();
  try {
    await env.DB.prepare('INSERT INTO logins (state, challenge, app, created_at) VALUES (?1, ?2, ?3, ?4)').bind(state, challenge, app, now).run();
  } catch (e) {
    return htmlPage(400, { title: 'Ссылка входа уже использована', text: 'Вернитесь в игру и нажмите «Войти через Google» ещё раз.' });
  }
  const g = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  g.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  g.searchParams.set('redirect_uri', `${url.origin}/auth/google/callback`);
  g.searchParams.set('response_type', 'code');
  g.searchParams.set('scope', 'openid');          // нужен только идентификатор аккаунта — ни почты, ни имени
  g.searchParams.set('state', state);
  g.searchParams.set('prompt', 'select_account'); // после выхода Google снова спросит, каким аккаунтом войти
  g.searchParams.set('access_type', 'online');
  return redirect(g.toString());
}

async function handleAuthCallback(url, env) {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const row = STATE_RE.test(state) ? await env.DB.prepare('SELECT * FROM logins WHERE state = ?1').bind(state).first() : null;
  if (!row || row.code || Date.now() - row.created_at > LOGIN_TTL_MS) {
    return htmlPage(400, { title: 'Ссылка входа устарела', text: 'Вернитесь в игру и нажмите «Войти через Google» ещё раз.' });
  }
  if (error || !code) {
    await env.DB.prepare('DELETE FROM logins WHERE state = ?1').bind(state).run();
    return backToGame(url, env, row, { error: error === 'access_denied' ? 'cancelled' : 'google' });
  }
  let sub;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${url.origin}/auth/google/callback`,
        grant_type: 'authorization_code'
      }).toString()
    });
    if (!res.ok) throw new Error('token_exchange_' + res.status);
    const tok = await res.json();
    sub = await verifyGoogleIdToken(tok.id_token, env);
  } catch (e) {
    console.error('google callback', e && e.message);
    await env.DB.prepare('DELETE FROM logins WHERE state = ?1').bind(state).run();
    return backToGame(url, env, row, { error: 'google' });
  }
  const loginCode = randomToken(32);
  await env.DB.prepare('UPDATE logins SET code = ?1, sub = ?2 WHERE state = ?3').bind(loginCode, sub, state).run();
  return backToGame(url, env, row, { code: loginCode });
}

// Игра обменивает одноразовый код на сессию, доказывая, что именно она начала вход (verifier → challenge).
async function handleExchange(request, env) {
  if (!isConfigured(env)) return fail(503, 'server_not_configured');
  const body = await readJson(request);
  const code = body && body.code, state = body && body.state, verifier = body && body.verifier;
  if (typeof code !== 'string' || typeof state !== 'string' || typeof verifier !== 'string' || !STATE_RE.test(state) || verifier.length < 32 || verifier.length > 128) {
    return fail(400, 'bad_request');
  }
  const row = await env.DB.prepare('SELECT * FROM logins WHERE state = ?1').bind(state).first();
  if (!row || !row.code || !row.sub) return fail(401, 'invalid_login');
  const fresh = Date.now() - row.created_at <= LOGIN_TTL_MS;
  const ok = fresh && safeEqual(row.code, code) && safeEqual(await sha256b64url(verifier), row.challenge);
  await env.DB.prepare('DELETE FROM logins WHERE state = ?1').bind(state).run(); // код одноразовый
  if (!ok) return fail(401, 'invalid_login');
  const token = await signSession(row.sub, env);
  const p = await getPlayer(env, row.sub);
  return json({ token, uid: row.sub, profile: p ? await profileView(env, p) : null, save: parseSave(p) });
}


// ---------- версии приложения ----------
// APK пишет в User-Agent «Terra3DApp/1 TerraBuild/<номер сборки>» (сборки до 1.0.5 номер не передают — для них это 0).
// Номер последней версии — из version.json, который GitHub-сценарий кладёт в каждый релиз рядом с APK.
// Играть можно только в последней версии APK (FORCE_UPDATE='0' отключает). Сайт всегда свежий — его не трогаем.
const RELEASE_CACHE_MS = 10 * 60 * 1000;
const RELEASE_RETRY_MS = 2 * 60 * 1000;
let releaseCache = { at: 0, data: null };

function clientInfo(request) {
  const ua = request.headers.get('User-Agent') || '';
  const m = ua.match(/\bTerraBuild\/(\d{1,7})\b/);
  return { app: /\bTerra3DApp\//.test(ua), build: m ? parseInt(m[1], 10) : 0 };
}
const repoOf = (env) => (env.GITHUB_REPO && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO) ? env.GITHUB_REPO : '');
const forceUpdate = (env) => String(env.FORCE_UPDATE ?? '1') !== '0';

async function latestRelease(env) {
  const repo = repoOf(env);
  if (!repo) return null;
  const now = Date.now();
  const ttl = env.RELEASE_CACHE_MS !== undefined ? Number(env.RELEASE_CACHE_MS) : (releaseCache.data ? RELEASE_CACHE_MS : RELEASE_RETRY_MS);
  if (releaseCache.at && now - releaseCache.at < ttl) return releaseCache.data;
  let data = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(`https://github.com/${repo}/releases/latest/download/version.json`, {
      headers: { 'User-Agent': 'terra-api', Accept: 'application/json, application/octet-stream' },
      signal: ctrl.signal, cf: { cacheTtl: 300, cacheEverything: true }
    });
    if (r.ok) {
      const j = await r.json();
      const build = Number(j && j.build);
      if (Number.isInteger(build) && build > 0 && build < 1e7) {
        data = {
          build,
          version: String(j.version || '1.0.' + build).slice(0, 20),
          notes: String(j.notes || '').slice(0, 300),
          url: `https://github.com/${repo}/releases/latest/download/terra3d.apk`
        };
      }
    }
  } catch (e) {} finally { clearTimeout(timer); }
  releaseCache = { at: now, data: data || releaseCache.data };
  return releaseCache.data;
}
// Последняя версия, если сборка build устарела и устаревшие версии не пускаем; иначе null
async function blockingRelease(build, env) {
  if (!forceUpdate(env)) return null;
  const latest = await latestRelease(env);
  return latest && build < latest.build ? latest : null;
}
async function outdatedApp(request, env) {
  const c = clientInfo(request);
  return c.app ? blockingRelease(c.build, env) : null;
}
function updatePage(latest) {
  return htmlPage(200, {
    title: 'Обновите игру',
    text: `Эта версия Terra 3D устарела — играть можно только в новой ${latest.version}. Скачайте её и установите поверх старой: прогресс хранится в аккаунте и никуда не пропадёт.`,
    primary: latest.url, primaryLabel: `⬇️ Скачать Terra 3D ${latest.version}`
  });
}

// ---------- недели и доски рейтинга ----------
// Неделя начинается в понедельник 00:00 по Москве (эпоха Unix — четверг)
const WEEK_MS = 7 * 86400000;
const WEEK_OFFSET = 4 * 86400000 - 3 * 3600000;
const weekId = (t) => Math.floor((t - WEEK_OFFSET) / WEEK_MS);
const weekEnd = (w) => (w + 1) * WEEK_MS + WEEK_OFFSET;
const PLANET_MAX = { earth: 14, mars: 9, jupiter: 9 };  // последняя эпоха/этап (с нуля)
const PLANET_IDS = ['earth', 'mars', 'jupiter'];
const BOARDS = ['all', ...PLANET_IDS];
// Счёт планеты = престижи * 10 000 000 + этап * 100 000 + постройки — сначала престижи, потом этап, потом постройки
const PLANET_STEP = 100000;
const PRESTIGE_STEP = 10000000;
const MAX_PRESTIGE = 100000;
const clampInt = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isInteger(x) ? x : 0));
function planetValue(pid, pl, earthEra, prestige = 0) {
  if (!pl || typeof pl !== 'object') return 0;
  const raw = pid === 'earth' ? earthEra : pl.era;
  const stage = clampInt(raw, 0, PLANET_MAX[pid]);
  let b = 0, n = 0;
  if (pl.counts && typeof pl.counts === 'object') {
    for (const k in pl.counts) {
      if (++n > 60) break;
      const c = pl.counts[k];
      if (Number.isInteger(c) && c > 0) b += Math.min(c, PLANET_STEP);
    }
  }
  return prestige * PRESTIGE_STEP + stage * PLANET_STEP + Math.min(b, PLANET_STEP - 1);
}

// ---------- промокоды ----------
// В открытом репозитории лежит только SHA-256 кода (заглавными, без пробелов и дефисов) — сами коды знает владелец игры.
// Свои коды можно добавить секретом PROMO_CODES (README). once — один раз на аккаунт, limit — всего активаций.
const PROMO_BUILTIN = [
  { id: 'start', hash: '45d58eab1347a918668959179d2ba158a17d9e1011996dca57019b347f84dfb2', once: true, title: 'Начальный пак',
    text: 'Добро пожаловать в Terra 3D! Немного ресурсов и кристаллов для старта.',
    reward: { gems: 3, sapphires: 3, res: { 'earth:solar': 3000, 'earth:water': 1500, 'earth:air': 800 }, items: ['bg-founder'] } },
  { id: 'first100', hash: 'cc99f79d21d8ffeffd61182c1ca36812f6976f6722c5cc6fcbdb14d45979af6c', once: true, limit: 100, title: 'Пак первой сотни',
    text: 'Вы среди первых ста игроков, активировавших этот код!',
    reward: { gems: 5, sapphires: 5 } },
  { id: 'discord', hash: 'f19f2f307a5d681f0c8ed3f15cc5566e898ce1ea572e2a21bb447347936cc36e', once: true, title: 'Пак сообщества',
    text: 'Спасибо, что вы с нами в сообществе игры!',
    reward: { gems: 5, sapphires: 10, items: ['bg-community'] } },
  { id: 'blogger', hash: '96dc74e8d25afbee0d7199a594f8732ed74c8a9d9fb46ae5ff052a5c9173c90e', once: true, title: 'Пак блогера',
    text: 'Подарок от любимого автора — ускорьте развитие планеты.',
    reward: { gems: 4, sapphires: 6, res: { 'earth:solar': 20000, 'earth:water': 10000 } } },
  { id: 'admin', hash: 'f4a3cd5e347961fb4770f31372f210c35ca6beb84b25e79be12ea2977fffe89d', once: false, title: 'Пак администрации',
    text: 'Режим администратора: огромный запас всего для проверки игры.',
    reward: { gems: 1000, sapphires: 1000, all: 100000000, items: ['bg-admin'] } }
];
const RES_PLANET = {
  solar: 'earth', water: 'earth', air: 'earth', biomass: 'earth', science: 'earth',
  regolith: 'mars', ice: 'mars', iron: 'mars', oxygen: 'mars',
  hydrogen: 'jupiter', energy: 'jupiter', helium: 'jupiter', metal: 'jupiter'
};
const PROMO_ITEMS = ['bg-founder', 'bg-community', 'bg-admin', 'hat_crown', 'hat_party', 'hat_wizard', 'hat_ufo', 'hat_halo',
  'bg-nebula', 'bg-deep', 'bg-emerald', 'bg-supernova', 'bg-cyber', 'hat_star', 'hat_comet', 'bg-galaxy', 'bg-blackhole', 'bg-rainbow'];
function normCode(c) {
  const s = String(c || '').toUpperCase().replace(/[\s\-_]+/g, '');
  return /^[A-Z0-9А-ЯЁ]{3,40}$/.test(s) ? s : '';
}
async function sha256hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Строка секрета: КОД | Название | gems=5 sapphires=3 solar=1000 item=bg-founder | multi | limit=100 | until=2026-12-31
function parsePromoLine(line) {
  const parts = line.split('|').map(x => x.trim());
  const code = normCode(parts[0]);
  if (!code) return null;
  const promo = { id: 'c:' + code, code, once: true, title: (parts[1] || 'Подарок').slice(0, 40), text: 'Награда уже у вас!', reward: {} };
  const rw = promo.reward;
  for (const tok of (parts[2] || '').split(/[\s,;]+/)) {
    const m = tok.match(/^([a-z_-]+)=([\w.-]+)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2];
    const n = Math.min(1e12, Math.max(0, Math.floor(Number(v)) || 0));
    if (k === 'gems' || k === 'sapphires' || k === 'all') { if (n) rw[k] = n; }
    else if (k === 'item' && PROMO_ITEMS.includes(v)) (rw.items = rw.items || []).push(v);
    else if (RES_PLANET[k] && n) (rw.res = rw.res || {})[`${RES_PLANET[k]}:${k}`] = n;
  }
  for (const f of parts.slice(3)) {
    if (/^multi$/i.test(f)) promo.once = false;
    const l = f.match(/^limit=(\d+)$/i); if (l) promo.limit = parseInt(l[1], 10);
    const u = f.match(/^until=(\d{4}-\d{2}-\d{2})$/i); if (u) promo.until = Date.parse(u[1] + 'T23:59:59+03:00');
  }
  return promo;
}
async function findPromo(code, env) {
  if (env.PROMO_CODES) {
    for (const line of String(env.PROMO_CODES).split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const pr = parsePromoLine(line);
      if (pr && pr.code === code) return pr;
    }
  }
  const h = await sha256hex(code);
  return PROMO_BUILTIN.find(x => x.hash === h) || null;
}
async function handleRedeem(request, sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const body = await readJson(request);
  const code = normCode(body && body.code);
  if (!code) return fail(400, 'bad_request');
  const now = Date.now();
  // защита от перебора: не больше 10 неверных кодов за 10 минут
  const fails = await env.DB.prepare('SELECT COUNT(*) AS c FROM promo_fails WHERE sub = ?1 AND at > ?2').bind(sub, now - 600000).first();
  if (fails && fails.c >= 10) return fail(429, 'too_many_attempts');
  const promo = await findPromo(code, env);
  if (!promo) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO promo_fails (sub, at) VALUES (?1, ?2)').bind(sub, now),
      env.DB.prepare('DELETE FROM promo_fails WHERE at < ?1').bind(now - 3600000)
    ]);
    return fail(404, 'invalid_code');
  }
  if (promo.until && now > promo.until) return fail(410, 'code_expired');
  const limit = promo.limit || 0;
  // одна атомарная вставка: не даёт активировать дважды даже при двойном нажатии
  const r = await env.DB.prepare(
    'INSERT INTO promo_uses (code_id, sub, at) SELECT ?1, ?2, ?3 WHERE (?4 = 0 OR NOT EXISTS (SELECT 1 FROM promo_uses WHERE code_id = ?1 AND sub = ?2))'
    + ' AND (?5 = 0 OR (SELECT COUNT(*) FROM promo_uses WHERE code_id = ?1) < ?5)'
  ).bind(promo.id, sub, now, promo.once ? 1 : 0, limit).run();
  if (!r.meta || !r.meta.changes) {
    const used = promo.once && await env.DB.prepare('SELECT 1 AS x FROM promo_uses WHERE code_id = ?1 AND sub = ?2').bind(promo.id, sub).first();
    return fail(409, used ? 'already_used' : 'code_exhausted');
  }
  return json({ ok: true, id: promo.id, title: promo.title, text: promo.text, reward: promo.reward });
}

// ---------- игровое API ----------
async function handleMe(sub, env) {
  const p = await getPlayer(env, sub);
  return json({ uid: sub, profile: p ? await profileView(env, p) : null, save: parseSave(p) });
}

async function handleProfile(request, sub, env) {
  const body = await readJson(request);
  const nick = cleanNickname(body && body.nickname);
  if (!nick) return fail(400, 'invalid_nickname');
  if (await getPlayer(env, sub)) return fail(409, 'already_has_profile');
  const taken = await env.DB.prepare('SELECT 1 AS x FROM players WHERE nickname_lc = ?1').bind(nick.toLowerCase()).first();
  if (taken) return fail(409, 'nickname_taken');
  const now = Date.now();
  try {
    await env.DB.prepare(
      'INSERT INTO players (sub, nickname, nickname_lc, score, rebirths, era, save, created_at, updated_at, score_updated_at) VALUES (?1, ?2, ?3, 0, 0, 0, NULL, ?4, ?4, ?4)'
    ).bind(sub, nick, nick.toLowerCase(), now).run();
  } catch (e) {
    if (String((e && e.message) || e).includes('UNIQUE')) return fail(409, 'nickname_taken');
    throw e;
  }
  return json({ profile: await profileView(env, await getPlayer(env, sub)) });
}

async function handleSync(request, sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const body = await readJson(request);
  const s = body && body.save;
  if (!s || typeof s !== 'object') return fail(400, 'bad_request');

  // Версия формата: 2 — одна планета и 6 эпох, 3 — несколько планет и 10 эпох Земли, 4 — сапфиры и квесты.
  const v = Number.isInteger(s.v) ? s.v : 2;
  const stored = parseSave(p);
  const storedV = stored ? (Number(stored.v) || 2) : 0;
  if (storedV >= 3 && v < storedV) {
    // старое приложение не должно затереть прогресс, сохранённый новой версией
    return fail(409, 'client_outdated');
  }
  const rebirths = Math.min(MAX_REBIRTHS, Math.max(0, Number.isInteger(s.rebirths) ? s.rebirths : 0));
  const eraRaw = v >= 3 ? (s.planets && s.planets.earth && s.planets.earth.era) : s.era;
  const era = Math.min(v >= 5 ? PLANET_MAX.earth : v >= 3 ? 9 : 5, Math.max(0, Number.isInteger(eraRaw) ? eraRaw : 0));
  // v5: у каждой планеты свои престижи
  const ppr = {};
  for (const pid of PLANET_IDS) ppr[pid] = v >= 5 && s.ppr && typeof s.ppr === 'object' ? clampInt(s.ppr[pid], 0, MAX_PRESTIGE) : 0;
  const clean = {};
  for (const k of SAVE_KEYS) if (s[k] !== undefined) clean[k] = s[k];
  clean.v = v;
  clean.rebirths = rebirths;
  if (v >= 5) clean.ppr = ppr;
  if (v >= 3) {
    if (!clean.planets || typeof clean.planets !== 'object') return fail(400, 'bad_request');
    clean.planets = { ...clean.planets, earth: { ...(clean.planets.earth || {}), era } };
  } else clean.era = era;
  const raw = JSON.stringify(clean);
  if (raw.length > MAX_SAVE_BYTES) return fail(413, 'save_too_large');

  // Рейтинг = перерождения*10 + эпоха. В обычной игре он только растёт (перерождение сбрасывает эпоху,
  // но добавляет +10), поэтому при синхронизации счёт не уменьшается: устаревшее устройство не может
  // опустить игрока. Обнулить счёт можно только через /api/reset. Рост ограничен по времени,
  // чтобы нельзя было выставить себе рекорд одним запросом.
  // v5: престиж = 100 очков, каждая эпоха/этап любой планеты = 1; раньше: перерождение = 10, эпоха Земли = 1
  const unlockedList = Array.isArray(clean.unlocked) ? clean.unlocked : [];
  let claimed, totalPr = 0;
  if (v >= 5) {
    let stages = 0;
    for (const pid of PLANET_IDS) {
      totalPr += ppr[pid];
      if (pid === 'earth') stages += era;
      else if (unlockedList.includes(pid) && clean.planets && clean.planets[pid]) stages += clampInt(clean.planets[pid].era, 0, PLANET_MAX[pid]);
    }
    claimed = totalPr * 100 + stages;
  } else claimed = rebirths * 10 + era;
  const now = Date.now();
  let newScore = p.score;
  if (claimed > p.score) {
    const elapsedMin = Math.max(0, (now - p.updated_at) / 60000);
    let allowed = Math.floor(SCORE_PER_MIN * elapsedMin) + 1;
    if (p.score === 0) allowed = Math.max(allowed, FIRST_SYNC_ALLOWANCE);
    newScore = Math.min(claimed, p.score + allowed);
  }
  const scoreUpdatedAt = newScore !== p.score ? now : p.score_updated_at;

  const week = weekId(now);
  const stmts = [
    env.DB.prepare('UPDATE players SET save = ?1, score = ?2, rebirths = ?3, era = ?4, updated_at = ?5, score_updated_at = ?6 WHERE sub = ?7')
      .bind(raw, newScore, v >= 5 ? totalPr : Math.floor(newScore / 10), v >= 5 ? era : newScore % 10, now, scoreUpdatedAt, sub),
    // недельный общий топ: прирост очков с первой синхронизации на этой неделе
    env.DB.prepare(`INSERT INTO weekly_scores (week, board, sub, score, base, at) VALUES (?1, 'all', ?2, ?3 - ?4, ?4, ?5)
      ON CONFLICT (week, board, sub) DO UPDATE SET score = ?3 - weekly_scores.base, at = ?5 WHERE ?3 - weekly_scores.base > weekly_scores.score`)
      .bind(week, sub, newScore, p.score, now)
  ];
  // топы планет: лучший этап + постройки (за всё время и за неделю)
  if (v >= 3 && clean.planets) {
    const unlocked = Array.isArray(clean.unlocked) ? clean.unlocked : [];
    for (const pid of PLANET_IDS) {
      if (pid !== 'earth' && !unlocked.includes(pid)) continue;
      const val = planetValue(pid, clean.planets[pid], era, ppr[pid]);
      if (val <= 0) continue;
      stmts.push(env.DB.prepare(`INSERT INTO planet_scores (sub, planet, best, best_at) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT (sub, planet) DO UPDATE SET best = ?3, best_at = ?4 WHERE ?3 > planet_scores.best`).bind(sub, pid, val, now));
      stmts.push(env.DB.prepare(`INSERT INTO weekly_scores (week, board, sub, score, base, at) VALUES (?1, ?2, ?3, ?4, 0, ?5)
        ON CONFLICT (week, board, sub) DO UPDATE SET score = ?4, at = ?5 WHERE ?4 > weekly_scores.score`).bind(week, pid, sub, val, now));
    }
  }
  if (Math.random() < 0.02) stmts.push(env.DB.prepare('DELETE FROM weekly_scores WHERE week < ?1').bind(week - 3));
  await env.DB.batch(stmts);

  const fresh = await getPlayer(env, sub);
  return json({ ok: true, score: fresh.score, rebirths: fresh.rebirths, era: fresh.era, rank: await rankOf(env, fresh) });
}

async function handleReset(sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE players SET save = NULL, score = 0, rebirths = 0, era = 0, updated_at = ?1, score_updated_at = ?1 WHERE sub = ?2').bind(now, sub),
    env.DB.prepare('DELETE FROM planet_scores WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM weekly_scores WHERE sub = ?1').bind(sub)
  ]);
  return json({ ok: true });
}

async function handleDelete(sub, env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM players WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM logins WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM planet_scores WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM weekly_scores WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM promo_uses WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM promo_fails WHERE sub = ?1').bind(sub)
  ]);
  return json({ ok: true });
}

async function handleLeaderboard(request, url, env) {
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const board = BOARDS.includes(url.searchParams.get('board')) ? url.searchParams.get('board') : 'all';
  const period = url.searchParams.get('period') === 'week' ? 'week' : 'all';
  const now = Date.now(), week = weekId(now);
  let sub = null;
  try { sub = await authedSub(request, env); } catch (e) {}
  const DB = env.DB;
  let rows, total, me = null;
  if (board === 'all' && period === 'all') {
    [rows, total] = await DB.batch([
      DB.prepare('SELECT nickname, score, rebirths, era FROM players ORDER BY score DESC, score_updated_at ASC LIMIT ?1').bind(limit),
      DB.prepare('SELECT COUNT(*) AS c FROM players')
    ]);
    if (sub) { const p = await getPlayer(env, sub); if (p) me = { rank: await rankOf(env, p), score: p.score, rebirths: p.rebirths, era: p.era }; }
  } else if (period === 'all') {
    [rows, total] = await DB.batch([
      DB.prepare('SELECT p.nickname, s.best AS score FROM planet_scores s JOIN players p ON p.sub = s.sub WHERE s.planet = ?1 AND s.best > 0 ORDER BY s.best DESC, s.best_at ASC LIMIT ?2').bind(board, limit),
      DB.prepare('SELECT COUNT(*) AS c FROM planet_scores WHERE planet = ?1 AND best > 0').bind(board)
    ]);
    if (sub) {
      const m = await DB.prepare('SELECT best AS score, best_at AS at FROM planet_scores WHERE sub = ?1 AND planet = ?2').bind(sub, board).first();
      if (m && m.score > 0) {
        const r = await DB.prepare('SELECT COUNT(*) AS c FROM planet_scores WHERE planet = ?1 AND (best > ?2 OR (best = ?2 AND best_at < ?3))').bind(board, m.score, m.at).first();
        me = { rank: (r ? r.c : 0) + 1, score: m.score };
      }
    }
  } else {
    const sel = board === 'all'
      ? 'SELECT p.nickname, w.score, p.rebirths, p.era FROM weekly_scores w JOIN players p ON p.sub = w.sub'
      : 'SELECT p.nickname, w.score FROM weekly_scores w JOIN players p ON p.sub = w.sub';
    [rows, total] = await DB.batch([
      DB.prepare(sel + ' WHERE w.week = ?1 AND w.board = ?2 AND w.score > 0 ORDER BY w.score DESC, w.at ASC LIMIT ?3').bind(week, board, limit),
      DB.prepare('SELECT COUNT(*) AS c FROM weekly_scores WHERE week = ?1 AND board = ?2 AND score > 0').bind(week, board)
    ]);
    if (sub) {
      const m = await DB.prepare('SELECT score, at FROM weekly_scores WHERE week = ?1 AND board = ?2 AND sub = ?3').bind(week, board, sub).first();
      if (m && m.score > 0) {
        const r = await DB.prepare('SELECT COUNT(*) AS c FROM weekly_scores WHERE week = ?1 AND board = ?2 AND (score > ?3 OR (score = ?3 AND at < ?4))').bind(week, board, m.score, m.at).first();
        me = { rank: (r ? r.c : 0) + 1, score: m.score };
      }
    }
  }
  let players = rows.results || [];
  if (board !== 'all') {
    const split = (x) => ({ ...x, prestige: Math.floor(x.score / PRESTIGE_STEP), era: Math.floor((x.score % PRESTIGE_STEP) / PLANET_STEP), buildings: x.score % PLANET_STEP });
    players = players.map(split);
    if (me) me = split(me);
  }
  return json({
    board, period, players, me,
    total: (total.results && total.results[0] && total.results[0].c) || 0,
    week: { id: week, endsAt: weekEnd(week) }
  });
}

// Новые версии сами спрашивают, не вышло ли обновление
async function handleClient(request, env) {
  const c = clientInfo(request);
  const latest = await latestRelease(env);
  const update = !!(latest && c.app && c.build > 0 && c.build < latest.build);
  return json({ latest, update, required: update && forceUpdate(env) });
}

const PROTECTED = ['/api/me', '/api/profile', '/api/sync', '/api/reset', '/api/account', '/api/redeem'];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const m = request.method;
    try {
      if (path === '/api/health' && m === 'GET') return json({ terra: true, configured: isConfigured(env) });
      if (path === '/api/leaderboard' && m === 'GET') return await handleLeaderboard(request, url, env);
      if (path === '/api/client' && m === 'GET') return await handleClient(request, env);
      // устаревшие APK: новые версии получают 426 и показывают окно обновления,
      // старые (не знают 426) — 401: их выкидывает на экран входа, а вход открывает страницу «Обновите игру»
      if (path === '/api/auth/exchange' || PROTECTED.includes(path)) {
        const old = await outdatedApp(request, env);
        if (old) return request.headers.get('X-Terra-Client') ? json({ error: 'update_required', latest: old }, 426) : fail(401, 'update_required');
      }
      if (path === '/api/auth/exchange' && m === 'POST') return await handleExchange(request, env);
      if (path === '/auth/google/start' && m === 'GET') return await handleAuthStart(url, env);
      if (path === '/auth/google/callback' && m === 'GET') return await handleAuthCallback(url, env);

      if (PROTECTED.includes(path)) {
        const sub = await authedSub(request, env);
        if (!sub) return fail(401, 'unauthorized');
        if (path === '/api/me' && m === 'GET') return await handleMe(sub, env);
        if (path === '/api/profile' && m === 'POST') return await handleProfile(request, sub, env);
        if (path === '/api/sync' && m === 'POST') return await handleSync(request, sub, env);
        if (path === '/api/reset' && m === 'POST') return await handleReset(sub, env);
        if (path === '/api/account' && m === 'DELETE') return await handleDelete(sub, env);
        if (path === '/api/redeem' && m === 'POST') return await handleRedeem(request, sub, env);
      }
      return fail(404, 'not_found');
    } catch (e) {
      console.error('worker error', (e && e.stack) || e);
      return fail(500, 'server_error');
    }
  }
};

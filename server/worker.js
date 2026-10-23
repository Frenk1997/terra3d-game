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
//   TWITCH_EXT_SECRET     — (необязательно, секрет) секрет расширения Twitch (base64, из кабинета разработчика):
//                           вход зрителей в игру в панели под трансляцией; при смене секрета — оба через запятую
//   YANDEX_CLIENT_ID      — (необязательно) ClientID приложения Яндекс ID (oauth.yandex.ru): кнопка «Войти с Яндекс ID»
//   YANDEX_CLIENT_SECRET  — (необязательно, секрет) Client secret этого приложения
//   ADMIN_CODE            — (необязательно, секрет) свой код администратора вместо встроенного: открывает чит-меню

const enc = new TextEncoder();
const dec = new TextDecoder();

const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // сессия живёт 30 дней
const LOGIN_TTL_MS = 10 * 60 * 1000;       // на вход через Google даётся 10 минут
const MAX_BODY_BYTES = 192 * 1024;
const MAX_SAVE_BYTES = 120000;    // 15 планет в трёх измерениях
// Какие поля сохранения хранятся (остальное отбрасывается). Последние пять — старый формат v2.
const SAVE_KEYS = ['v', 'planet', 'unlocked', 'unis', 'planets', 'gems', 'sapphires', 'perks', 'ppk', 'ppr', 'rebirths', 'boostUntil', 'ownedCosmetics', 'look',
                   'stats', 'quests', 'tapSound', 'tut', 'login', 'legend', 'lastSave', 'res', 'counts', 'era', 'equippedHat', 'equippedBg'];
const MAX_REBIRTHS = 100000;
const SCORE_PER_MIN = 150;       // на сколько очков рейтинг может вырасти за минуту (престиж = 100 очков)
const FIRST_SYNC_ALLOWANCE = 600; // стартовый запас для нового аккаунта (перенос старого прогресса)
const MAX_SCORE_JUMP = 5000;      // больше этого за одну синхронизацию счёт не растёт
const SCORE_BURST = 120;          // один престиж (+100) всегда засчитывается сразу
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

const yandexConfigured = (env) => !!(env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET && env.SESSION_SECRET);
async function handleAuthStart(url, env, provider = 'google') {
  if (provider === 'yandex' ? !yandexConfigured(env) : !isConfigured(env)) {
    return htmlPage(503, { title: 'Сервер ещё не настроен', text: provider === 'yandex'
      ? 'Владельцу игры: задайте YANDEX_CLIENT_ID и YANDEX_CLIENT_SECRET (см. SETUP.md).'
      : 'Владельцу игры: задайте GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET и SESSION_SECRET (см. README).' });
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
    return htmlPage(400, { title: 'Неверная ссылка входа', text: 'Вернитесь в игру и нажмите кнопку входа ещё раз.' });
  }
  const now = Date.now();
  await env.DB.prepare('DELETE FROM logins WHERE created_at < ?1').bind(now - 2 * LOGIN_TTL_MS).run();
  try {
    await env.DB.prepare('INSERT INTO logins (state, challenge, app, created_at) VALUES (?1, ?2, ?3, ?4)').bind(state, challenge, app, now).run();
  } catch (e) {
    return htmlPage(400, { title: 'Ссылка входа уже использована', text: 'Вернитесь в игру и нажмите кнопку входа ещё раз.' });
  }
  if (provider === 'yandex') {
    // Яндекс ID: нужен только постоянный идентификатор аккаунта (почта и имя не сохраняются)
    const y = new URL('https://oauth.yandex.ru/authorize');
    y.searchParams.set('response_type', 'code');
    y.searchParams.set('client_id', env.YANDEX_CLIENT_ID);
    y.searchParams.set('redirect_uri', `${url.origin}/auth/yandex/callback`);
    y.searchParams.set('state', state);
    y.searchParams.set('force_confirm', 'yes');   // после выхода Яндекс снова спросит, каким аккаунтом войти
    return redirect(y.toString());
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

// Ответ Яндекса: код → токен → id аккаунта. Учётка в игре — «ya_<id>».
async function handleYandexCallback(url, env) {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const row = STATE_RE.test(state) ? await env.DB.prepare('SELECT * FROM logins WHERE state = ?1').bind(state).first() : null;
  if (!row || row.code || Date.now() - row.created_at > LOGIN_TTL_MS) {
    return htmlPage(400, { title: 'Ссылка входа устарела', text: 'Вернитесь в игру и нажмите «Войти с Яндекс ID» ещё раз.' });
  }
  if (error || !code) {
    await env.DB.prepare('DELETE FROM logins WHERE state = ?1').bind(state).run();
    return backToGame(url, env, row, { error: error === 'access_denied' ? 'cancelled' : 'yandex' });
  }
  let sub;
  try {
    const res = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: env.YANDEX_CLIENT_ID, client_secret: env.YANDEX_CLIENT_SECRET }).toString()
    });
    if (!res.ok) throw new Error('token_exchange_' + res.status);
    const tok = await res.json();
    if (!tok.access_token) throw new Error('no_token');
    const info = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + tok.access_token } });
    if (!info.ok) throw new Error('info_' + info.status);
    const id = String((await info.json()).id || '');
    if (!/^\d{1,32}$/.test(id)) throw new Error('no_id');
    sub = 'ya_' + id;
  } catch (e) {
    console.error('yandex callback', e && e.message);
    await env.DB.prepare('DELETE FROM logins WHERE state = ?1').bind(state).run();
    return backToGame(url, env, row, { error: 'yandex' });
  }
  const loginCode = randomToken(32);
  await env.DB.prepare('UPDATE logins SET code = ?1, sub = ?2 WHERE state = ?3').bind(loginCode, sub, state).run();
  return backToGame(url, env, row, { code: loginCode });
}

// Игра обменивает одноразовый код на сессию, доказывая, что именно она начала вход (verifier → challenge).
async function handleExchange(request, env) {
  if (!env.SESSION_SECRET) return fail(503, 'server_not_configured');
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
const httpsBase = (v) => { const u = String(v || '').trim().replace(/\/+$/, ''); return /^https:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[\w.-]+)*$/i.test(u) ? u : ''; };
const apkBase = (env) => httpsBase(env.APK_BASE);

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
          // ссылка на конкретную версию: «latest» браузер может запомнить и снова скачать старый APK.
          // APK_BASE — свой сервер раздаёт копию APK (в России так надёжнее, чем с GitHub)
          url: /^\d+\.\d+\.\d+$/.test(String(j.version || ''))
            ? (apkBase(env) ? `${apkBase(env)}/terra3d-${j.version}.apk` : `https://github.com/${repo}/releases/download/v${j.version}/terra3d.apk`)
            : `https://github.com/${repo}/releases/latest/download/terra3d.apk`
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
// Измерения и их планеты (как UNIVERSES в web/js/data.js)
const UNIVERSE_PLANETS = {
  sol: ['earth', 'mars', 'jupiter', 'venus', 'mercury'],
  cs:  ['mirage', 'anubis', 'dust2', 'inferno', 'ancient'],
  mc:  ['plains', 'jungle', 'tundra', 'nether', 'end']
};
const UNIVERSE_IDS = Object.keys(UNIVERSE_PLANETS);
const PLANET_IDS = UNIVERSE_IDS.flatMap(u => UNIVERSE_PLANETS[u]);
const SOL_IDS = UNIVERSE_PLANETS.sol;
const PLANET_MAX = Object.fromEntries(PLANET_IDS.map(pid => [pid, pid === 'earth' ? 14 : 9]));  // последняя эпоха/этап (с нуля)
// доски топа: общий, планеты и престижи каждого измерения (u_sol, u_cs, u_mc)
const BOARDS = ['all', ...PLANET_IDS, ...UNIVERSE_IDS.map(u => 'u_' + u)];
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
  hydrogen: 'jupiter', energy: 'jupiter', helium: 'jupiter', metal: 'jupiter',
  cloud: 'venus', heat: 'venus', sulfur: 'venus', carbon: 'venus', ore: 'mercury', plasma: 'mercury', silicon: 'mercury', alloy: 'mercury'
};
// ресурсы планет новых измерений начинаются с приставки планеты: mi_coin — Мираж, pl_wood — Равнины…
const RES_PREFIX = { mi: 'mirage', an: 'anubis', du: 'dust2', in: 'inferno', ac: 'ancient', pl: 'plains', ju: 'jungle', tu: 'tundra', ne: 'nether', en: 'end' };
for (const k of ['mi_coin', 'mi_brick', 'mi_smoke', 'mi_skin', 'an_gold', 'an_water', 'an_stone', 'an_relic', 'du_sand', 'du_crate', 'du_tunnel', 'du_legend',
  'in_grape', 'in_tile', 'in_banana', 'in_bell', 'ac_vine', 'ac_jade', 'ac_mask', 'ac_sun', 'pl_wood', 'pl_wheat', 'pl_stone', 'pl_iron',
  'ju_bamboo', 'ju_cocoa', 'ju_melon', 'ju_emerald', 'tu_snow', 'tu_ice', 'tu_coal', 'tu_fish', 'ne_rack', 'ne_gold', 'ne_quartz', 'ne_blaze',
  'en_stone', 'en_pearl', 'en_chorus', 'en_breath']) RES_PLANET[k] = RES_PREFIX[k.slice(0, 2)];
const PROMO_ITEMS = ['bg-founder', 'bg-community', 'bg-admin', 'hat_crown', 'hat_party', 'hat_wizard', 'hat_ufo', 'hat_halo',
  'bg-nebula', 'bg-deep', 'bg-emerald', 'bg-supernova', 'bg-cyber', 'hat_star', 'hat_comet', 'bg-galaxy', 'bg-blackhole', 'bg-rainbow',
  'hat_trophy', 'hat_fire', 'bg-neon', 'bg-gold-skin', 'hat_pickaxe', 'hat_cube_crown', 'bg-void', 'bg-blocks',
  'snd_keyboard', 'snd_mouse', 'snd_bubble', 'snd_drum', 'snd_piano', 'snd_laser', 'snd_coin', 'snd_8bit', 'snd_wood', 'snd_glass', 'snd_block'];
// Код администратора (в репозитории — только SHA-256). Открывает чит-меню; свой код можно задать секретом ADMIN_CODE.
const ADMIN_CODE_HASH = '36c935cd9ee22f1a97262942bb75436612233d6b5f6af4575781275a4755362d';
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
  // код администратора: аккаунт помечается админом (чит-меню, модерация чата)
  const adminCode = env.ADMIN_CODE ? normCode(env.ADMIN_CODE) : '';
  if (adminCode ? safeEqual(code, adminCode) : safeEqual(await sha256hex(code), ADMIN_CODE_HASH)) {
    await touchMeta(env, sub, p);
    await env.DB.prepare('UPDATE player_meta SET admin = 1 WHERE sub = ?1').bind(sub).run();
    return json({ ok: true, admin: true, title: 'Режим администратора', text: 'Чит-меню включено.' });
  }
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
  const m = p ? await touchMeta(env, sub, p) : null;
  const tw = await env.DB.prepare('SELECT 1 AS x FROM twitch_links WHERE sub = ?1 LIMIT 1').bind(sub).first();
  return json({ uid: sub, profile: p ? await profileView(env, p) : null, save: parseSave(p), twitch: !!tw, admin: !!(m && m.admin) });
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
  // v5: у каждой планеты свои престижи (v7 — 15 планет в трёх измерениях)
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
  // Админ (чит-меню) — без ограничений: счёт может и расти скачком, и уменьшаться.
  const now = Date.now();
  const meta = await touchMeta(env, sub, p, now);
  const admin = !!meta.admin;
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
  let newScore = p.score;
  if (admin) newScore = claimed;
  else if (claimed > p.score) {
    // время считаем от последнего роста счёта, а не от последней синхронизации: иначе частые
    // синхронизации (каждые 30 с) душили бы честный престиж (+100) и рейтинг отставал на минуты
    const elapsedMin = Math.max(0, (now - (p.score_updated_at || p.updated_at)) / 60000);
    let allowed = Math.min(MAX_SCORE_JUMP, Math.floor(SCORE_PER_MIN * elapsedMin) + SCORE_BURST);
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
  // у админа лучший результат может и уменьшаться (престижи «откручиваются» в чит-меню)
  const bestSql = admin
    ? `INSERT INTO planet_scores (sub, planet, best, best_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (sub, planet) DO UPDATE SET best = ?3, best_at = ?4 WHERE ?3 != planet_scores.best`
    : `INSERT INTO planet_scores (sub, planet, best, best_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (sub, planet) DO UPDATE SET best = ?3, best_at = ?4 WHERE ?3 > planet_scores.best`;
  // топы планет: лучший этап + постройки (за всё время и за неделю)
  if (v >= 3 && clean.planets) {
    for (const pid of PLANET_IDS) {
      if (pid !== 'earth' && !unlockedList.includes(pid)) continue;
      const val = planetValue(pid, clean.planets[pid], era, ppr[pid]);
      if (val <= 0) continue;
      stmts.push(env.DB.prepare(bestSql).bind(sub, pid, val, now));
      stmts.push(env.DB.prepare(`INSERT INTO weekly_scores (week, board, sub, score, base, at) VALUES (?1, ?2, ?3, ?4, 0, ?5)
        ON CONFLICT (week, board, sub) DO UPDATE SET score = ?4, at = ?5 WHERE ?4 > weekly_scores.score`).bind(week, pid, sub, val, now));
    }
  }
  // топы престижей измерений: сумма престижей всех планет измерения (за неделю — прирост с понедельника)
  if (v >= 5) {
    const prev = await env.DB.prepare("SELECT planet, best FROM planet_scores WHERE sub = ?1 AND planet IN ('u_sol', 'u_cs', 'u_mc')").bind(sub).all();
    const old = Object.fromEntries((prev.results || []).map(r => [r.planet, r.best]));
    // не больше престижей, чем уже засчитано в общем счёте (его рост ограничен по времени)
    const prCap = admin ? MAX_PRESTIGE * PLANET_IDS.length : Math.floor(newScore / 100);
    for (const u of UNIVERSE_IDS) {
      const val = Math.min(prCap, UNIVERSE_PLANETS[u].reduce((a, pid) => a + (unlockedList.includes(pid) || pid === 'earth' ? ppr[pid] : 0), 0));
      if (val <= 0 && !old['u_' + u]) continue;
      stmts.push(env.DB.prepare(bestSql).bind(sub, 'u_' + u, val, now));
      stmts.push(env.DB.prepare(`INSERT INTO weekly_scores (week, board, sub, score, base, at) VALUES (?1, ?2, ?3, ?4 - ?5, ?5, ?6)
        ON CONFLICT (week, board, sub) DO UPDATE SET score = ?4 - weekly_scores.base, at = ?6 WHERE ?4 - weekly_scores.base > weekly_scores.score`)
        .bind(week, 'u_' + u, sub, val, old['u_' + u] || 0, now));
    }
  }
  if (Math.random() < 0.02) stmts.push(env.DB.prepare('DELETE FROM weekly_scores WHERE week < ?1').bind(week - 3));
  // тапы для топа альянсов: засчитываем прирост счётчика из сохранения, но не быстрее TAPS_PER_SEC
  const st = clean.stats && typeof clean.stats === 'object' ? clean.stats : null;
  const clientTaps = st && Number.isFinite(st.taps) && st.taps >= 0 ? Math.floor(Math.min(st.taps, 1e12)) : null;
  if (clientTaps !== null) {
    let add = 0;
    if (clientTaps > meta.taps_seen) {
      const sec = Math.max(0, (now - (meta.taps_at || now)) / 1000);
      add = Math.min(clientTaps - meta.taps_seen, Math.floor(sec * TAPS_PER_SEC) + TAPS_BURST);
    }
    stmts.push(env.DB.prepare('UPDATE player_meta SET taps = taps + ?1, taps_seen = ?2, taps_at = ?3, ally_taps = ally_taps + (CASE WHEN alliance_id IS NULL THEN 0 ELSE ?1 END) WHERE sub = ?4')
      .bind(add, clientTaps, now, sub));
    if (add > 0 && meta.alliance_id) {
      stmts.push(env.DB.prepare('UPDATE alliances SET taps = taps + ?1 WHERE id = ?2').bind(add, meta.alliance_id));
      stmts.push(env.DB.prepare(`INSERT INTO alliance_weekly (week, alliance_id, taps, at) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT (week, alliance_id) DO UPDATE SET taps = alliance_weekly.taps + ?3, at = ?4`).bind(week, meta.alliance_id, add, now));
    }
  }
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
  await deleteAccount(env, sub);
  return json({ ok: true });
}
async function deleteAccount(env, sub) {
  await leaveAlliance(env, sub);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM twitch_links WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM link_codes WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM friends WHERE a = ?1 OR b = ?1').bind(sub),
    env.DB.prepare('DELETE FROM player_meta WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM players WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM logins WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM planet_scores WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM weekly_scores WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM promo_uses WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM promo_fails WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM chat_messages WHERE sub = ?1').bind(sub)
  ]);
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
  if (board !== 'all' && !board.startsWith('u_')) {
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

// ============================================================
//  ПРОФИЛИ, ДРУЗЬЯ, АЛЬЯНСЫ
// ============================================================
const TAPS_PER_SEC = 15;         // быстрее человек не тапает — остальное не засчитываем
const TAPS_BURST = 300;
const FRIENDS_MAX = 100;
const ALLY_MAX = 30;             // участников в альянсе
const ONLINE_MS = 5 * 60 * 1000;
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // без похожих O/0 и I/1
const ALLY_EMBLEMS = ['🛡️', '⚔️', '🚀', '🌟', '🔥', '🌊', '🌙', '🪐', '👑', '🐉', '🦅', '💎', '⚡', '🌀', '☄️', '🌋'];

function randomCode(n = 6) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_ABC[b[i] % CODE_ABC.length];
  return s;
}
const normFriendCode = (c) => { const s = String(c || '').toUpperCase().replace(/[\s\-_#]+/g, ''); return /^[A-Z0-9]{4,12}$/.test(s) ? s : ''; };

// Запись игрока для друзей и альянсов: создаётся при первом входе. Счётчик тапов начинается с того,
// что уже есть в сохранении (старые тапы в топ альянсов не идут). Заодно отмечает «в сети».
async function touchMeta(env, sub, p, now = Date.now()) {
  let m = await env.DB.prepare('SELECT * FROM player_meta WHERE sub = ?1').bind(sub).first();
  if (m) {
    if (now - (m.seen_at || 0) > 30000) await env.DB.prepare('UPDATE player_meta SET seen_at = ?1 WHERE sub = ?2').bind(now, sub).run();
    return m;
  }
  const save = parseSave(p);
  const t = save && save.stats && Number.isFinite(save.stats.taps) ? Math.max(0, Math.floor(save.stats.taps)) : 0;
  for (let i = 0; i < 6 && !m; i++) {
    try {
      await env.DB.prepare('INSERT INTO player_meta (sub, code, taps, taps_seen, taps_at, seen_at) VALUES (?1, ?2, 0, ?3, ?4, ?4)')
        .bind(sub, randomCode(6 + (i > 3 ? 1 : 0)), t, now).run();
    } catch (e) {
      if (!String((e && e.message) || e).includes('UNIQUE')) throw e;
    }
    m = await env.DB.prepare('SELECT * FROM player_meta WHERE sub = ?1').bind(sub).first();
  }
  if (!m) throw new Error('meta_failed');
  return m;
}
const isOnline = (m, now = Date.now()) => !!(m && m.seen_at && now - m.seen_at < ONLINE_MS);
const intOr0 = (x) => (Number.isFinite(x) && x > 0 ? Math.floor(Math.min(x, 1e15)) : 0);

// Пройдены ли все этапы на всех планетах (нужно, чтобы создать альянс)
function planetsProgress(save) {
  const out = {};
  const unlocked = save && Array.isArray(save.unlocked) ? save.unlocked : [];
  for (const pid of PLANET_IDS) {
    const pl = save && save.planets && save.planets[pid];
    const open = pid === 'earth' || unlocked.includes(pid);
    const era = open && pl ? clampInt(pl.era, 0, PLANET_MAX[pid]) : 0;
    const best = open ? Math.max(era, clampInt(save && save.stats && save.stats.maxEra && save.stats.maxEra[pid], 0, PLANET_MAX[pid])) : 0;
    out[pid] = { open, stage: era, best, max: PLANET_MAX[pid], prestige: clampInt(save && save.ppr && save.ppr[pid], 0, MAX_PRESTIGE) };
  }
  return out;
}
// альянс может основать тот, кто прошёл всю Солнечную систему
const allPlanetsMaxed = (save) => { const pr = planetsProgress(save); return SOL_IDS.every(pid => pr[pid].open && pr[pid].best >= pr[pid].max); };

async function allianceBrief(env, id) {
  if (!id) return null;
  const a = await env.DB.prepare('SELECT id, name, emblem FROM alliances WHERE id = ?1').bind(id).first();
  return a ? { id: a.id, name: a.name, emblem: a.emblem } : null;
}

// Публичный профиль игрока (по нику): статистика из сохранения, место, альянс, друзья
async function handlePlayer(request, url, env) {
  const nick = String(url.searchParams.get('nick') || '').trim().toLowerCase().slice(0, 32);
  if (!nick) return fail(400, 'bad_request');
  const p = await env.DB.prepare('SELECT * FROM players WHERE nickname_lc = ?1').bind(nick).first();
  if (!p) return fail(404, 'not_found');
  let viewer = null;
  try { viewer = await authedSub(request, env); } catch (e) {}
  const save = parseSave(p) || {};
  const st = save.stats && typeof save.stats === 'object' ? save.stats : {};
  const meta = await env.DB.prepare('SELECT * FROM player_meta WHERE sub = ?1').bind(p.sub).first();
  const fc = await env.DB.prepare('SELECT COUNT(*) AS c FROM friends WHERE a = ?1').bind(p.sub).first();
  const isFriend = viewer && viewer !== p.sub
    ? !!(await env.DB.prepare('SELECT 1 AS x FROM friends WHERE a = ?1 AND b = ?2').bind(viewer, p.sub).first()) : false;
  const quests = save.quests && typeof save.quests === 'object' ? save.quests : {};
  return json({
    nickname: p.nickname, me: viewer === p.sub, friend: isFriend, online: isOnline(meta),
    score: p.score, rank: await rankOf(env, p), rebirths: p.rebirths, since: p.created_at,
    planets: planetsProgress(save),
    stats: {
      taps: intOr0(st.taps), built: intOr0(st.built), asteroids: intOr0(st.asteroids), golden: intOr0(st.golden),
      chests: intOr0(st.chests), playSec: intOr0(st.playSec), evolves: intOr0(st.evolves),
      achievements: Array.isArray(quests.ach) ? quests.ach.length : 0,
      cosmetics: Array.isArray(save.ownedCosmetics) ? save.ownedCosmetics.length : 0,
      gems: intOr0(save.gems), allianceTaps: meta ? meta.ally_taps : 0,
      stars: intOr0(st.stars), combo: intOr0(st.combo), streak: intOr0(st.streak)
    },
    friends: fc ? fc.c : 0,
    alliance: meta ? await allianceBrief(env, meta.alliance_id) : null
  });
}

async function friendList(env, sub) {
  const r = await env.DB.prepare(`SELECT p.nickname, p.score, p.rebirths, m.seen_at, m.alliance_id, a.name AS ally_name, a.emblem AS ally_emblem
    FROM friends f JOIN players p ON p.sub = f.b LEFT JOIN player_meta m ON m.sub = f.b LEFT JOIN alliances a ON a.id = m.alliance_id
    WHERE f.a = ?1 ORDER BY p.score DESC LIMIT ?2`).bind(sub, FRIENDS_MAX).all();
  const now = Date.now();
  return (r.results || []).map(x => ({
    nickname: x.nickname, score: x.score, rebirths: x.rebirths, online: !!(x.seen_at && now - x.seen_at < ONLINE_MS),
    alliance: x.alliance_id ? { id: x.alliance_id, name: x.ally_name, emblem: x.ally_emblem } : null
  }));
}

// Всё для вкладки «Друзья»: свой код, друзья, свой альянс, можно ли создать альянс
async function handleSocial(sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const meta = await touchMeta(env, sub, p);
  const save = parseSave(p);
  return json({
    code: meta.code, friends: await friendList(env, sub), friendsMax: FRIENDS_MAX,
    alliance: meta.alliance_id ? await allianceView(env, meta.alliance_id, sub) : null,
    canCreate: allPlanetsMaxed(save), planets: planetsProgress(save), emblems: ALLY_EMBLEMS, allyMax: ALLY_MAX, admin: !!meta.admin
  });
}

async function tooManyFails(env, key, now) {
  const f = await env.DB.prepare('SELECT COUNT(*) AS c FROM promo_fails WHERE sub = ?1 AND at > ?2').bind(key, now - 600000).first();
  return f && f.c >= 10;
}
async function addFail(env, key, now) {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO promo_fails (sub, at) VALUES (?1, ?2)').bind(key, now),
    env.DB.prepare('DELETE FROM promo_fails WHERE at < ?1').bind(now - 3600000)
  ]);
}

async function handleFriendAdd(request, sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const me = await touchMeta(env, sub, p);
  const body = await readJson(request);
  const code = normFriendCode(body && body.code);
  if (!code) return fail(400, 'bad_code');
  const now = Date.now(), key = 'f:' + sub;
  if (await tooManyFails(env, key, now)) return fail(429, 'too_many_attempts');
  const other = await env.DB.prepare('SELECT m.sub, p.nickname FROM player_meta m JOIN players p ON p.sub = m.sub WHERE m.code = ?1').bind(code).first();
  if (!other) { await addFail(env, key, now); return fail(404, 'unknown_code'); }
  if (other.sub === sub) return fail(400, 'own_code');
  if (await env.DB.prepare('SELECT 1 AS x FROM friends WHERE a = ?1 AND b = ?2').bind(sub, other.sub).first()) return fail(409, 'already_friends');
  const counts = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS c FROM friends WHERE a = ?1').bind(sub),
    env.DB.prepare('SELECT COUNT(*) AS c FROM friends WHERE a = ?1').bind(other.sub)
  ]);
  if (counts[0].results[0].c >= FRIENDS_MAX) return fail(409, 'friends_limit');
  if (counts[1].results[0].c >= FRIENDS_MAX) return fail(409, 'their_friends_limit');
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO friends (a, b, at) VALUES (?1, ?2, ?3)').bind(sub, other.sub, now),
    env.DB.prepare('INSERT OR IGNORE INTO friends (a, b, at) VALUES (?1, ?2, ?3)').bind(other.sub, sub, now)
  ]);
  return json({ ok: true, nickname: other.nickname, friends: await friendList(env, sub), code: me.code });
}

async function handleFriendRemove(request, sub, env) {
  const body = await readJson(request);
  const nick = String((body && body.nickname) || '').trim().toLowerCase();
  const other = nick ? await env.DB.prepare('SELECT sub FROM players WHERE nickname_lc = ?1').bind(nick).first() : null;
  if (!other) return fail(404, 'not_found');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM friends WHERE a = ?1 AND b = ?2').bind(sub, other.sub),
    env.DB.prepare('DELETE FROM friends WHERE a = ?1 AND b = ?2').bind(other.sub, sub)
  ]);
  return json({ ok: true, friends: await friendList(env, sub) });
}

// ---------- альянсы ----------
function cleanAllianceName(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (n.length < 3 || n.length > 20) return null;
  if (!/^[\p{L}\p{N}_\-. ]+$/u.test(n)) return null;
  return n;
}
// Мощь альянса = ручные тапы участников + вложенные кристаллы × ALLY_GEM_POWER. Мощь даёт место в топе и уровень
// (каждый уровень — +2% к доходу всем участникам; формулы те же, что в web/js/data.js).
const ALLY_GEM_POWER = 500, ALLY_LEVEL_STEP = 50000, ALLY_LEVEL_MAX = 20;
const POWER_SQL = '(taps + gems * 500)';
const allyPower = (a) => (a.taps || 0) + (a.gems || 0) * ALLY_GEM_POWER;
const allyLevel = (power) => Math.min(ALLY_LEVEL_MAX, Math.floor(Math.sqrt(Math.max(0, power) / ALLY_LEVEL_STEP)));
async function allianceRank(env, a) {
  const pw = allyPower(a);
  const r = await env.DB.prepare(`SELECT COUNT(*) AS c FROM alliances WHERE ${POWER_SQL} > ?1 OR (${POWER_SQL} = ?1 AND id < ?2)`).bind(pw, a.id).first();
  return (r ? r.c : 0) + 1;
}
async function allianceView(env, id, viewer) {
  const a = await env.DB.prepare('SELECT * FROM alliances WHERE id = ?1').bind(id).first();
  if (!a) return null;
  const week = weekId(Date.now());
  const [mem, wk] = await env.DB.batch([
    env.DB.prepare(`SELECT m.sub, p.nickname, p.score, m.ally_taps, m.ally_gems, m.seen_at, m.ally_at FROM player_meta m JOIN players p ON p.sub = m.sub
      WHERE m.alliance_id = ?1 ORDER BY (m.ally_taps + m.ally_gems * 500) DESC, m.ally_at ASC`).bind(id),
    env.DB.prepare('SELECT taps, gems FROM alliance_weekly WHERE week = ?1 AND alliance_id = ?2').bind(week, id)
  ]);
  const now = Date.now();
  const members = (mem.results || []).map(x => ({ nickname: x.nickname, score: x.score, taps: x.ally_taps, gems: x.ally_gems || 0, power: x.ally_taps + (x.ally_gems || 0) * ALLY_GEM_POWER,
    online: !!(x.seen_at && now - x.seen_at < ONLINE_MS), leader: x.sub === a.leader, me: x.sub === viewer }));
  const isMember = (mem.results || []).some(x => x.sub === viewer);
  const leader = (mem.results || []).find(x => x.sub === a.leader);
  const w = wk.results[0] || {};
  const power = allyPower(a);
  return {
    id: a.id, name: a.name, emblem: a.emblem, open: !!a.open, taps: a.taps, gems: a.gems || 0, power, level: allyLevel(power),
    weekTaps: w.taps || 0, weekPower: (w.taps || 0) + (w.gems || 0) * ALLY_GEM_POWER,
    rank: await allianceRank(env, a), created: a.created_at, leader: leader ? leader.nickname : null,
    members, size: members.length, max: ALLY_MAX, isMember, isLeader: viewer === a.leader,
    code: isMember ? a.code : null
  };
}

async function handleAlliances(request, url, env) {
  const period = url.searchParams.get('period') === 'week' ? 'week' : 'all';
  const week = weekId(Date.now());
  let viewer = null;
  try { viewer = await authedSub(request, env); } catch (e) {}
  // топ по мощи: за неделю — тапы и кристаллы этой недели, за всё время — всё вместе
  const rows = period === 'week'
    ? await env.DB.prepare(`SELECT a.id, a.name, a.emblem, a.open, w.taps, w.gems, a.taps AS all_taps, a.gems AS all_gems, (SELECT COUNT(*) FROM player_meta m WHERE m.alliance_id = a.id) AS members
        FROM alliance_weekly w JOIN alliances a ON a.id = w.alliance_id WHERE w.week = ?1 AND (w.taps > 0 OR w.gems > 0) ORDER BY (w.taps + w.gems * 500) DESC, w.at ASC LIMIT 50`).bind(week).all()
    : await env.DB.prepare(`SELECT a.id, a.name, a.emblem, a.open, a.taps, a.gems, a.taps AS all_taps, a.gems AS all_gems, (SELECT COUNT(*) FROM player_meta m WHERE m.alliance_id = a.id) AS members
        FROM alliances a ORDER BY (a.taps + a.gems * 500) DESC, a.id ASC LIMIT 50`).all();
  const total = await env.DB.prepare('SELECT COUNT(*) AS c FROM alliances').first();
  let mine = null;
  if (viewer) {
    const m = await env.DB.prepare('SELECT alliance_id FROM player_meta WHERE sub = ?1').bind(viewer).first();
    if (m && m.alliance_id) mine = m.alliance_id;
  }
  return json({
    period, mine, total: total ? total.c : 0, max: ALLY_MAX,
    alliances: (rows.results || []).map(x => ({ id: x.id, name: x.name, emblem: x.emblem, open: !!x.open, taps: x.taps, gems: x.gems || 0,
      power: (x.taps || 0) + (x.gems || 0) * ALLY_GEM_POWER, level: allyLevel((x.all_taps || 0) + (x.all_gems || 0) * ALLY_GEM_POWER), members: x.members })),
    week: { id: week, endsAt: weekEnd(week) }
  });
}

async function handleAlliance(request, url, env) {
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!(id > 0)) return fail(400, 'bad_request');
  let viewer = null;
  try { viewer = await authedSub(request, env); } catch (e) {}
  const v = await allianceView(env, id, viewer);
  return v ? json(v) : fail(404, 'not_found');
}

async function handleAllianceCreate(request, sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const meta = await touchMeta(env, sub, p);
  if (meta.alliance_id) return fail(409, 'already_in_alliance');
  if (!allPlanetsMaxed(parseSave(p))) return fail(403, 'need_all_planets');
  const body = await readJson(request);
  const name = cleanAllianceName(body && body.name);
  if (!name) return fail(400, 'invalid_name');
  const emblem = ALLY_EMBLEMS.includes(body && body.emblem) ? body.emblem : ALLY_EMBLEMS[0];
  const open = body && body.open === false ? 0 : 1;
  if (await env.DB.prepare('SELECT 1 AS x FROM alliances WHERE name_lc = ?1').bind(name.toLowerCase()).first()) return fail(409, 'name_taken');
  const now = Date.now();
  let id = null;
  for (let i = 0; i < 6 && !id; i++) {
    try {
      const code = randomCode(7);
      await env.DB.prepare('INSERT INTO alliances (name, name_lc, emblem, code, leader, open, taps, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)')
        .bind(name, name.toLowerCase(), emblem, code, sub, open, now).run();
      const r = await env.DB.prepare('SELECT id FROM alliances WHERE code = ?1').bind(code).first();
      id = r && r.id;
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg.includes('name_lc')) return fail(409, 'name_taken');
      if (!msg.includes('UNIQUE')) throw e;
    }
  }
  if (!id) return fail(500, 'server_error');
  await env.DB.prepare('UPDATE player_meta SET alliance_id = ?1, ally_taps = 0, ally_at = ?2 WHERE sub = ?3').bind(id, now, sub).run();
  return json({ ok: true, alliance: await allianceView(env, id, sub) });
}

async function handleAllianceJoin(request, sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const meta = await touchMeta(env, sub, p);
  if (meta.alliance_id) return fail(409, 'already_in_alliance');
  const body = await readJson(request);
  const now = Date.now(), key = 'a:' + sub;
  let a = null;
  if (body && body.code !== undefined) {
    const code = normFriendCode(body.code);
    if (!code) return fail(400, 'bad_code');
    if (await tooManyFails(env, key, now)) return fail(429, 'too_many_attempts');
    a = await env.DB.prepare('SELECT * FROM alliances WHERE code = ?1').bind(code).first();
    if (!a) { await addFail(env, key, now); return fail(404, 'unknown_code'); }
  } else {
    const id = parseInt(body && body.id, 10);
    a = id > 0 ? await env.DB.prepare('SELECT * FROM alliances WHERE id = ?1').bind(id).first() : null;
    if (!a) return fail(404, 'not_found');
    if (!a.open) return fail(403, 'closed');
  }
  // место проверяем и занимаем одним запросом — двое не займут последнее место одновременно
  const r = await env.DB.prepare(`UPDATE player_meta SET alliance_id = ?1, ally_taps = 0, ally_at = ?2 WHERE sub = ?3 AND alliance_id IS NULL
    AND (SELECT COUNT(*) FROM player_meta WHERE alliance_id = ?1) < ?4`).bind(a.id, now, sub, ALLY_MAX).run();
  if (!r.meta || !r.meta.changes) return fail(409, 'alliance_full');
  return json({ ok: true, alliance: await allianceView(env, a.id, sub) });
}

// Выход из альянса: лидерство переходит к самому полезному участнику, пустой альянс удаляется
async function leaveAlliance(env, sub) {
  const meta = await env.DB.prepare('SELECT alliance_id FROM player_meta WHERE sub = ?1').bind(sub).first();
  if (!meta || !meta.alliance_id) return false;
  const id = meta.alliance_id;
  await env.DB.prepare('UPDATE player_meta SET alliance_id = NULL, ally_taps = 0, ally_gems = 0, ally_at = 0 WHERE sub = ?1').bind(sub).run();
  const a = await env.DB.prepare('SELECT leader FROM alliances WHERE id = ?1').bind(id).first();
  if (!a) return true;
  const next = await env.DB.prepare('SELECT sub FROM player_meta WHERE alliance_id = ?1 ORDER BY (ally_taps + ally_gems * 500) DESC, ally_at ASC LIMIT 1').bind(id).first();
  if (!next) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM alliances WHERE id = ?1').bind(id),
      env.DB.prepare('DELETE FROM alliance_weekly WHERE alliance_id = ?1').bind(id),
      env.DB.prepare('DELETE FROM chat_messages WHERE channel = ?1').bind('a:' + id)
    ]);
  } else if (a.leader === sub) {
    await env.DB.prepare('UPDATE alliances SET leader = ?1 WHERE id = ?2').bind(next.sub, id).run();
  }
  return true;
}
async function handleAllianceLeave(sub, env) {
  if (!(await leaveAlliance(env, sub))) return fail(409, 'not_in_alliance');
  return json({ ok: true });
}
async function handleAllianceKick(request, sub, env) {
  const meta = await env.DB.prepare('SELECT alliance_id FROM player_meta WHERE sub = ?1').bind(sub).first();
  const a = meta && meta.alliance_id ? await env.DB.prepare('SELECT * FROM alliances WHERE id = ?1').bind(meta.alliance_id).first() : null;
  if (!a || a.leader !== sub) return fail(403, 'not_leader');
  const body = await readJson(request);
  const nick = String((body && body.nickname) || '').trim().toLowerCase();
  const t = nick ? await env.DB.prepare('SELECT p.sub FROM players p JOIN player_meta m ON m.sub = p.sub WHERE p.nickname_lc = ?1 AND m.alliance_id = ?2').bind(nick, a.id).first() : null;
  if (!t || t.sub === sub) return fail(404, 'not_found');
  await env.DB.prepare('UPDATE player_meta SET alliance_id = NULL, ally_taps = 0, ally_gems = 0, ally_at = 0 WHERE sub = ?1').bind(t.sub).run();
  return json({ ok: true, alliance: await allianceView(env, a.id, sub) });
}
// Вклад кристаллов в альянс (не возвращается). Кристаллы списываются из облачного сохранения игрока —
// игра перед вкладом отправляет свежее сохранение, после — сама уменьшает свой счётчик.
const MAX_DONATE = 1e9;
async function handleAllianceDonate(request, sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const meta = await touchMeta(env, sub, p);
  if (!meta.alliance_id) return fail(409, 'not_in_alliance');
  const body = await readJson(request);
  const amount = Math.floor(Number(body && body.amount));
  if (!(amount >= 1 && amount <= MAX_DONATE)) return fail(400, 'bad_amount');
  const save = parseSave(p);
  const gems = save && Number.isFinite(save.gems) ? Math.floor(save.gems) : 0;
  if (gems < amount) return fail(409, 'not_enough_gems');
  save.gems = gems - amount;
  const before = await env.DB.prepare('SELECT * FROM alliances WHERE id = ?1').bind(meta.alliance_id).first();
  if (!before) return fail(404, 'not_found');
  const now = Date.now(), week = weekId(now);
  await env.DB.batch([
    // сохранение меняем, только если с момента чтения его никто не перезаписал
    env.DB.prepare('UPDATE players SET save = ?1 WHERE sub = ?2 AND updated_at = ?3').bind(JSON.stringify(save), sub, p.updated_at),
    env.DB.prepare('UPDATE alliances SET gems = gems + ?1 WHERE id = ?2').bind(amount, meta.alliance_id),
    env.DB.prepare('UPDATE player_meta SET ally_gems = ally_gems + ?1 WHERE sub = ?2').bind(amount, sub),
    env.DB.prepare(`INSERT INTO alliance_weekly (week, alliance_id, taps, gems, at) VALUES (?1, ?2, 0, ?3, ?4)
      ON CONFLICT (week, alliance_id) DO UPDATE SET gems = alliance_weekly.gems + ?3, at = ?4`).bind(week, meta.alliance_id, amount, now)
  ]);
  const view = await allianceView(env, meta.alliance_id, sub);
  return json({ ok: true, amount, alliance: view, levelUp: view.level > allyLevel(allyPower(before)) });
}
async function handleAllianceSettings(request, sub, env) {
  const meta = await env.DB.prepare('SELECT alliance_id FROM player_meta WHERE sub = ?1').bind(sub).first();
  const a = meta && meta.alliance_id ? await env.DB.prepare('SELECT * FROM alliances WHERE id = ?1').bind(meta.alliance_id).first() : null;
  if (!a || a.leader !== sub) return fail(403, 'not_leader');
  const body = await readJson(request);
  const emblem = ALLY_EMBLEMS.includes(body && body.emblem) ? body.emblem : a.emblem;
  const open = body && typeof body.open === 'boolean' ? (body.open ? 1 : 0) : a.open;
  const code = body && body.newCode ? randomCode(7) : a.code;
  await env.DB.prepare('UPDATE alliances SET emblem = ?1, open = ?2, code = ?3 WHERE id = ?4').bind(emblem, open, code, a.id).run();
  return json({ ok: true, alliance: await allianceView(env, a.id, sub) });
}

// ============================================================
//  НАГРАДЫ НЕДЕЛИ: топ игроков и топ альянсов прошлой недели
// ============================================================
// В понедельник игрок забирает 🔷 за место прошлой недели: в общем недельном топе и (каждый участник) за место
// своего альянса — если вступил в него до конца той недели. Один раз в неделю (player_meta.reward_week).
// Таблицы такие же, как WEEKLY_PLAYER_REWARDS / WEEKLY_ALLY_REWARDS в web/js/data.js: [до места, сапфиры].
const WEEKLY_PLAYER_REWARDS = [[1, 15], [2, 10], [3, 8], [10, 5], [50, 2]];
const WEEKLY_ALLY_REWARDS = [[1, 10], [2, 7], [3, 5], [10, 2]];
const rewardFor = (table, rank) => { for (const [upTo, v] of table) if (rank <= upTo) return v; return 0; };
async function weeklyRewards(env, sub, meta) {
  const week = weekId(Date.now()) - 1;
  if ((meta.reward_week || 0) >= week) return { week, total: 0, claimed: true };
  const out = { week, total: 0, player: null, ally: null };
  const me = await env.DB.prepare("SELECT score, at FROM weekly_scores WHERE week = ?1 AND board = 'all' AND sub = ?2").bind(week, sub).first();
  if (me && me.score > 0) {
    const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM weekly_scores WHERE week = ?1 AND board = 'all' AND (score > ?2 OR (score = ?2 AND at < ?3))")
      .bind(week, me.score, me.at).first();
    const rank = (r ? r.c : 0) + 1, v = rewardFor(WEEKLY_PLAYER_REWARDS, rank);
    if (v) { out.player = { rank, sapphires: v }; out.total += v; }
  }
  if (meta.alliance_id && (meta.ally_at || 0) < weekEnd(week)) {
    const a = await env.DB.prepare('SELECT w.taps, w.gems, w.at, al.name, al.emblem FROM alliance_weekly w JOIN alliances al ON al.id = w.alliance_id WHERE w.week = ?1 AND w.alliance_id = ?2')
      .bind(week, meta.alliance_id).first();
    if (a && (a.taps > 0 || a.gems > 0)) {
      const pw = a.taps + a.gems * ALLY_GEM_POWER;
      const r = await env.DB.prepare(`SELECT COUNT(*) AS c FROM alliance_weekly WHERE week = ?1 AND ((taps + gems * ${ALLY_GEM_POWER}) > ?2 OR ((taps + gems * ${ALLY_GEM_POWER}) = ?2 AND at < ?3))`)
        .bind(week, pw, a.at).first();
      const rank = (r ? r.c : 0) + 1, v = rewardFor(WEEKLY_ALLY_REWARDS, rank);
      if (v) { out.ally = { rank, sapphires: v, name: a.name, emblem: a.emblem }; out.total += v; }
    }
  }
  return out;
}
async function handleRewards(sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  return json(await weeklyRewards(env, sub, await touchMeta(env, sub, p)));
}
async function handleRewardsClaim(sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const r = await weeklyRewards(env, sub, await touchMeta(env, sub, p));
  if (r.claimed || !r.total) return json({ ok: true, ...r, sapphires: 0 });
  // помечаем неделю забранной; второй запрос (двойное нажатие, два устройства) ничего не получит
  const u = await env.DB.prepare('UPDATE player_meta SET reward_week = ?1 WHERE sub = ?2 AND reward_week < ?1').bind(r.week, sub).run();
  if (!(u && u.meta && u.meta.changes)) return json({ ok: true, week: r.week, total: 0, claimed: true, sapphires: 0 });
  return json({ ok: true, ...r, sapphires: r.total });
}

// ============================================================
//  ЧАТ: общий, альянса и личные сообщения между друзьями
// ============================================================
// Каналы: 'g' — общий, 'a:<id альянса>', 'd:<sub1>|<sub2>' — личный (sub по алфавиту). Игра опрашивает сервер
// раз в несколько секунд (WebSocket не нужен). Мат прячется звёздочками, ссылки вырезаются, есть ограничение
// частоты и блокировка чата админом.
const CHAT_LEN = 200, CHAT_PAGE = 60, CHAT_AFTER_MAX = 100;
const CHAT_MIN_GAP_MS = 1200, CHAT_WINDOW_MS = 30000, CHAT_WINDOW_MAX = 8;
const CHAT_KEEP_MS = 30 * 86400000, CHAT_GLOBAL_KEEP = 3000;
// корни бранных слов (с границей слова — чтобы «небо» и «страхуй» не пострадали)
const BAD_WORDS = /(?<![\p{L}])(?:(?:на|по|от|за|вы|до|об|ра[зс]|при|у|ни)?ху[йеёияю]\p{L}*|(?:рас|за|от|вы|с)?пизд\p{L}*|бля\p{L}*|(?:за|вы|у|от|на|по|раз)?[её]б(?:а|у|ал|ан|ат|ло|лан|ну|ыр)\p{L}*|муда[кч]\p{L}*|пид[оа]р\p{L}*|сук[аи](?![\p{L}])|шлюх\p{L}*|fuck\p{L}*|shit\p{L}*|bitch\p{L}*|cunt\p{L}*)/giu;
function cleanChatText(raw) {
  if (typeof raw !== 'string') return '';
  let t = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/(?:https?:\/\/|www\.)\S+/gi, '[ссылка]').replace(/\b[\w-]+\.(?:ru|com|net|org|io|gg|me|xyz|рф|su|ly|to|link|site|online)(?:\/\S*)?/gi, '[ссылка]');
  t = t.replace(/(.)\1{7,}/gu, '$1$1$1$1$1$1');   // ааааааааааа → аааааа
  t = t.replace(BAD_WORDS, (w) => w[0] + '*'.repeat(Math.max(2, [...w].length - 1)));
  return [...t].slice(0, CHAT_LEN).join('');
}
const escLike = (x) => String(x).replace(/[\\%_]/g, (c) => '\\' + c);
// Канал по запросу игрока: ch = global | ally | dm (+ with — ник друга)
async function chatChannel(env, sub, meta, ch, withNick) {
  if (ch === 'global') return { channel: 'g' };
  if (ch === 'ally') return meta.alliance_id ? { channel: 'a:' + meta.alliance_id } : { err: fail(403, 'no_alliance') };
  if (ch === 'dm') {
    const nick = String(withNick || '').trim().toLowerCase().slice(0, 32);
    const other = nick ? await env.DB.prepare('SELECT sub, nickname FROM players WHERE nickname_lc = ?1').bind(nick).first() : null;
    if (!other || other.sub === sub) return { err: fail(404, 'not_found') };
    if (!(await env.DB.prepare('SELECT 1 AS x FROM friends WHERE a = ?1 AND b = ?2').bind(sub, other.sub).first())) return { err: fail(403, 'not_friends') };
    return { channel: 'd:' + [sub, other.sub].sort().join('|'), other };
  }
  return { err: fail(400, 'bad_request') };
}
function chatRow(x, viewer) {
  return { id: x.id, nickname: x.nickname, text: x.text, at: x.at, admin: !!x.admin, ally: x.emblem || null, me: x.sub === viewer };
}
async function handleChatGet(url, sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const meta = await touchMeta(env, sub, p);
  const { channel, err } = await chatChannel(env, sub, meta, url.searchParams.get('ch'), url.searchParams.get('with'));
  if (err) return err;
  const after = Math.max(0, parseInt(url.searchParams.get('after') || '0', 10) || 0);
  const sel = `SELECT c.id, c.sub, c.nickname, c.text, c.at, m.admin, a.emblem FROM chat_messages c
    LEFT JOIN player_meta m ON m.sub = c.sub LEFT JOIN alliances a ON a.id = m.alliance_id WHERE c.channel = ?1`;
  const r = after
    ? await env.DB.prepare(sel + ' AND c.id > ?2 ORDER BY c.id ASC LIMIT ?3').bind(channel, after, CHAT_AFTER_MAX).all()
    : await env.DB.prepare(sel + ' ORDER BY c.id DESC LIMIT ?2').bind(channel, CHAT_PAGE).all();
  let rows = r.results || [];
  if (!after) rows = rows.reverse();
  return json({ messages: rows.map(x => chatRow(x, sub)), mutedUntil: meta.muted_until > Date.now() ? meta.muted_until : 0 });
}
async function handleChatPost(request, sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const meta = await touchMeta(env, sub, p);
  const now = Date.now();
  if (meta.muted_until > now) return json({ error: 'muted', mutedUntil: meta.muted_until }, 403);
  const body = await readJson(request);
  const text = cleanChatText(body && body.text);
  if (!text) return fail(400, 'empty');
  const { channel, err } = await chatChannel(env, sub, meta, body && body.ch, body && body.with);
  if (err) return err;
  const [last, recent] = await env.DB.batch([
    env.DB.prepare('SELECT channel, text, at FROM chat_messages WHERE sub = ?1 ORDER BY id DESC LIMIT 1').bind(sub),
    env.DB.prepare('SELECT COUNT(*) AS c FROM chat_messages WHERE sub = ?1 AND at > ?2').bind(sub, now - CHAT_WINDOW_MS)
  ]);
  const l = last.results[0];
  if (!meta.admin) {
    if (l && now - l.at < CHAT_MIN_GAP_MS) return fail(429, 'too_fast');
    if (recent.results[0].c >= CHAT_WINDOW_MAX) return fail(429, 'too_fast');
    if (l && l.channel === channel && l.text === text && now - l.at < 60000) return fail(409, 'duplicate');
  }
  const stmts = [env.DB.prepare('INSERT INTO chat_messages (channel, sub, nickname, text, at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(channel, sub, p.nickname, text, now)];
  if (Math.random() < 0.02) {
    stmts.push(env.DB.prepare('DELETE FROM chat_messages WHERE at < ?1').bind(now - CHAT_KEEP_MS));
    stmts.push(env.DB.prepare("DELETE FROM chat_messages WHERE channel = 'g' AND id < (SELECT id FROM chat_messages WHERE channel = 'g' ORDER BY id DESC LIMIT 1 OFFSET ?1)").bind(CHAT_GLOBAL_KEEP));
  }
  await env.DB.batch(stmts);
  const row = await env.DB.prepare(`SELECT c.id, c.sub, c.nickname, c.text, c.at, m.admin, a.emblem FROM chat_messages c
    LEFT JOIN player_meta m ON m.sub = c.sub LEFT JOIN alliances a ON a.id = m.alliance_id WHERE c.sub = ?1 ORDER BY c.id DESC LIMIT 1`).bind(sub).first();
  return json({ ok: true, message: chatRow(row, sub) });
}
// Сводка для значка «непрочитано»: последние сообщения общего чата, альянса и личных переписок с друзьями
async function handleChatSummary(sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const meta = await touchMeta(env, sub, p);
  const [g, a, fr, dm] = await env.DB.batch([
    env.DB.prepare("SELECT MAX(id) AS id FROM chat_messages WHERE channel = 'g'"),
    env.DB.prepare('SELECT id, sub FROM chat_messages WHERE channel = ?1 ORDER BY id DESC LIMIT 1').bind('a:' + (meta.alliance_id || 0)),
    env.DB.prepare('SELECT p.sub, p.nickname FROM friends f JOIN players p ON p.sub = f.b WHERE f.a = ?1').bind(sub),
    env.DB.prepare(`SELECT c.channel, c.id, c.sub, c.text, c.at FROM chat_messages c JOIN (SELECT channel, MAX(id) AS mid FROM chat_messages
      WHERE channel LIKE ?1 ESCAPE '\\' OR channel LIKE ?2 ESCAPE '\\' GROUP BY channel) t ON t.mid = c.id`)
      .bind('d:' + escLike(sub) + '|%', 'd:%|' + escLike(sub))
  ]);
  const nickOf = Object.fromEntries((fr.results || []).map(x => [x.sub, x.nickname]));
  const dms = [];
  for (const x of dm.results || []) {
    const other = x.channel.slice(2).split('|').find(v => v !== sub);
    if (!nickOf[other]) continue;   // уже не друзья — переписку не показываем
    dms.push({ nickname: nickOf[other], lastId: x.id, lastText: x.text.slice(0, 60), at: x.at, lastMine: x.sub === sub });
  }
  const al = a.results[0];
  return json({ global: (g.results[0] && g.results[0].id) || 0, ally: meta.alliance_id && al ? al.id : 0, allyMine: !!(al && al.sub === sub), dms });
}
async function requireAdmin(env, sub) {
  const m = await env.DB.prepare('SELECT admin FROM player_meta WHERE sub = ?1').bind(sub).first();
  return !!(m && m.admin);
}
async function handleChatDelete(request, sub, env) {
  if (!(await requireAdmin(env, sub))) return fail(403, 'not_admin');
  const body = await readJson(request);
  const id = parseInt(body && body.id, 10);
  if (!(id > 0)) return fail(400, 'bad_request');
  await env.DB.prepare('DELETE FROM chat_messages WHERE id = ?1').bind(id).run();
  return json({ ok: true });
}
async function handleChatMute(request, sub, env) {
  if (!(await requireAdmin(env, sub))) return fail(403, 'not_admin');
  const body = await readJson(request);
  const nick = String((body && body.nickname) || '').trim().toLowerCase();
  const h = Number(body && body.hours);
  const hours = Math.min(24 * 365, Math.max(0, Number.isFinite(h) ? h : 24));   // 0 — снять блокировку
  const t = nick ? await env.DB.prepare('SELECT sub FROM players WHERE nickname_lc = ?1').bind(nick).first() : null;
  if (!t) return fail(404, 'not_found');
  await env.DB.prepare('UPDATE player_meta SET muted_until = ?1 WHERE sub = ?2').bind(hours ? Date.now() + hours * 3600000 : 0, t.sub).run();
  return json({ ok: true });
}

// ---------- новые столбцы в старой базе ----------
// CREATE TABLE IF NOT EXISTS не добавляет столбцы в уже созданные таблицы — добавляем их сами (один раз за запуск).
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) schemaReady = (async () => {
    const add = [
      'ALTER TABLE player_meta ADD COLUMN admin INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE player_meta ADD COLUMN muted_until INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE player_meta ADD COLUMN ally_gems INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE alliances ADD COLUMN gems INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE alliance_weekly ADD COLUMN gems INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE player_meta ADD COLUMN reward_week INTEGER NOT NULL DEFAULT 0',
      `CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, sub TEXT NOT NULL,
        nickname TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)`,
      'CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages (channel, id)',
      'CREATE INDEX IF NOT EXISTS idx_chat_sub ON chat_messages (sub, id)'
    ];
    for (const sql of add) {
      try { await env.DB.prepare(sql).run(); }
      catch (e) { if (!/duplicate column|already exists/i.test(String((e && e.message) || e))) console.error('schema', sql.slice(0, 60), e && e.message); }
    }
  })().catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}

// Новые версии сами спрашивают, не вышло ли обновление
async function handleClient(request, env) {
  const c = clientInfo(request);
  const latest = await latestRelease(env);
  const update = !!(latest && c.app && c.build > 0 && c.build < latest.build);
  // site — версия веб-игры на сервере: открытая вкладка со старым кодом сама перезагрузится
  return json({ latest, update, required: update && forceUpdate(env), site: env.SITE_VERSION || null });
}

// ============================================================
//  TWITCH: игра в панели под трансляцией
// ============================================================
// Twitch передаёт игре в панели JWT зрителя, подписанный секретом расширения (HS256, секрет в base64).
// opaque_user_id на «U…» — постоянный id вошедшего зрителя (один и тот же на всех каналах), «A…» — аноним.
// Своя учётка зрителя — sub «tw_U…»; по коду из игры (APK/сайт) зритель привязывается к своему аккаунту Google.
const TWITCH_PREFIX = 'tw_';
const LINK_TTL_MS = 10 * 60 * 1000;   // код привязки живёт 10 минут

// последняя попытка входа из панели — для проверки настройки (GET /api/twitch/status, без секретов и личных данных)
let twitchLast = null;
async function verifyTwitchJwt(token, env) {
  const secrets = String(env.TWITCH_EXT_SECRET || '').split(/[\s,]+/).filter(Boolean);
  token = String(token || '');
  const p = token.split('.');
  if (!secrets.length) return { fail: 'no_secret' };
  if (p.length !== 3 || token.length > 4000) return { fail: 'malformed' };
  let header, payload, sig;
  try { header = JSON.parse(b64urlToStr(p[0])); payload = JSON.parse(b64urlToStr(p[1])); sig = b64urlToBytes(p[2]); } catch (e) { return { fail: 'malformed' }; }
  if (!header || header.alg !== 'HS256' || !payload || typeof payload !== 'object') return { fail: 'bad_alg' };
  const data = enc.encode(`${p[0]}.${p[1]}`);
  let ok = false;
  for (let i = 0; i < secrets.length && !ok; i++) {
    let raw;
    try { raw = Uint8Array.from(atob(secrets[i]), c => c.charCodeAt(0)); } catch (e) { continue; }
    if (!raw.length) continue;
    const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (await crypto.subtle.verify('HMAC', key, sig, data)) ok = 'secret' + (i + 1);
  }
  if (!ok) return { fail: 'bad_signature', claims: twitchClaims(header, payload) };
  if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return { fail: 'expired' };
  const id = String(payload.opaque_user_id || '');
  return { id, logged: /^U[A-Za-z0-9]{1,64}$/.test(id), by: ok };
}
// для проверки настройки: только тип токена и роль, без идентификаторов зрителя
function twitchClaims(header, payload) {
  return { alg: String(header.alg || '').slice(0, 10), role: String(payload.role || '').slice(0, 20),
    ttl: Number.isFinite(payload.exp) ? Math.round(payload.exp - Date.now() / 1000) : null, channel: !!payload.channel_id };
}
async function twitchViewer(request, env) {
  const body = await readJson(request);
  const tw = await verifyTwitchJwt(body && body.token, env);
  twitchLast = { at: Date.now(), result: tw.fail || (tw.logged ? 'ok' : 'anonymous'), by: tw.by || null, claims: tw.claims || null };
  if (tw.fail === 'no_secret') return { err: fail(503, 'twitch_not_configured') };
  if (tw.fail) return { err: fail(401, 'invalid_twitch_token') };
  if (!tw.logged) return { err: fail(403, 'twitch_login_required') };
  return { tw, body };
}
function handleTwitchStatus(env) {
  const secrets = String(env.TWITCH_EXT_SECRET || '').split(/[\s,]+/).filter(Boolean);
  const b64 = secrets.map(s => { try { return /^[A-Za-z0-9+/]+={0,2}$/.test(s) && atob(s).length >= 16; } catch (e) { return false; } });
  // длина строки и число байт после base64 (секрет расширения Twitch — обычно 44 символа / 32 байта); сами секреты не показываются
  const shape = secrets.map(s => { let n = 0; try { n = atob(s).length; } catch (e) {} return `${s.length}/${n}`; });
  return json({ configured: secrets.length > 0, secrets: secrets.length, secretsBase64: b64, shape, last: twitchLast });
}
async function sessionReply(env, sub, extra = {}) {
  const token = await signSession(sub, env);
  const p = await getPlayer(env, sub);
  if (p) await touchMeta(env, sub, p);
  return json({ token, uid: sub, profile: p ? await profileView(env, p) : null, save: parseSave(p), ...extra });
}

// вход из панели: привязанный зритель играет своим аккаунтом из игры, остальные — своей Twitch-учёткой
async function handleTwitchAuth(request, env) {
  const { tw, err } = await twitchViewer(request, env);
  if (err) return err;
  const l = await env.DB.prepare('SELECT sub FROM twitch_links WHERE twitch_id = ?1').bind(tw.id).first();
  return sessionReply(env, l ? l.sub : TWITCH_PREFIX + tw.id, { linked: !!l });
}

// в игре (APK/сайт): одноразовый код, чтобы войти этим же аккаунтом в панели на Twitch
async function handleTwitchCode(sub, env) {
  if (sub.startsWith(TWITCH_PREFIX)) return fail(400, 'not_game_account');
  if (!(await getPlayer(env, sub))) return fail(404, 'no_profile');
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const code = randomCode(6);
    try {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM link_codes WHERE sub = ?1 OR expires_at < ?2').bind(sub, now),
        env.DB.prepare('INSERT INTO link_codes (code, sub, expires_at) VALUES (?1, ?2, ?3)').bind(code, sub, now + LINK_TTL_MS)
      ]);
      return json({ code, expiresAt: now + LINK_TTL_MS });
    } catch (e) {
      if (!String((e && e.message) || e).includes('UNIQUE')) throw e;
    }
  }
  return fail(500, 'server_error');
}

// в панели: ввод кода — дальше этот зритель Twitch играет аккаунтом из игры (общий прогресс и топ)
async function handleTwitchLink(request, env) {
  const { tw, body, err } = await twitchViewer(request, env);
  if (err) return err;
  const now = Date.now(), failKey = 'l:' + tw.id;
  if (await tooManyFails(env, failKey, now)) return fail(429, 'too_many_attempts');
  const code = normFriendCode(body.code);
  const row = code ? await env.DB.prepare('SELECT sub, expires_at FROM link_codes WHERE code = ?1').bind(code).first() : null;
  if (!row || row.expires_at < now || !(await getPlayer(env, row.sub))) {
    await addFail(env, failKey, now);
    return fail(404, 'code_not_found');
  }
  // отдельная Twitch-учётка этого зрителя больше не нужна — её прогресс заменяется прогрессом из игры
  await deleteAccount(env, TWITCH_PREFIX + tw.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM link_codes WHERE code = ?1').bind(code),
    env.DB.prepare(`INSERT INTO twitch_links (twitch_id, sub, created_at) VALUES (?1, ?2, ?3)
      ON CONFLICT (twitch_id) DO UPDATE SET sub = ?2, created_at = ?3`).bind(tw.id, row.sub, now)
  ]);
  return sessionReply(env, row.sub, { linked: true });
}

async function handleTwitchUnlink(sub, env) {
  await env.DB.prepare('DELETE FROM twitch_links WHERE sub = ?1').bind(sub).run();
  return json({ ok: true });
}

const PROTECTED = ['/api/me', '/api/profile', '/api/sync', '/api/reset', '/api/account', '/api/redeem', '/api/social',
  '/api/friends', '/api/friends/remove', '/api/alliance/create', '/api/alliance/join', '/api/alliance/leave', '/api/alliance/kick', '/api/alliance/settings',
  '/api/alliance/donate', '/api/chat', '/api/chat/summary', '/api/chat/delete', '/api/chat/mute', '/api/rewards', '/api/rewards/claim',
  '/api/twitch/code', '/api/twitch/unlink'];

// ---------- переезд на другой сервер ----------
// MOVED_TO = 'https://новый-адрес' — игра переехала (например, на сервер в России, где Cloudflare ограничен).
// Эта копия больше не трогает свою базу: страницы и вход уводят на новый адрес, запросы игры
// пересылаются туда же, а устаревшие APK получают «Обновите игру» (новая версия ходит на новый адрес сама).
async function handleMoved(request, url, path, env, to) {
  if (path === '/api/health') return json({ terra: true, configured: true, moved: to });
  if (path === '/api/client' && request.method === 'GET') return handleClient(request, env);
  if (path.startsWith('/api/')) {
    const old = await outdatedApp(request, env);
    if (old) return request.headers.get('X-Terra-Client') ? json({ error: 'update_required', latest: old }, 426) : fail(401, 'update_required');
    return proxyTo(to, request, url);
  }
  if ((path === '/auth/google/start' || path === '/auth/yandex/start') && url.searchParams.get('app') === '1') {
    const old = await blockingRelease(parseInt(url.searchParams.get('build') || '0', 10) || 0, env);
    if (old) return updatePage(old);
  }
  return redirect(to + url.pathname + url.search);
}
async function proxyTo(to, request, url) {
  const headers = new Headers();
  for (const k of ['authorization', 'content-type', 'user-agent', 'x-terra-client']) {
    const v = request.headers.get(k);
    if (v) headers.set(k, v);
  }
  const init = { method: request.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
  try {
    const r = await fetch(to + url.pathname + url.search, init);
    const h = new Headers(r.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    h.set('Cache-Control', 'no-store');
    return new Response(r.body, { status: r.status, headers: h });
  } catch (e) {
    console.error('proxy', e && e.message);
    return fail(502, 'server_unreachable');
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const m = request.method;
    try {
      const moved = httpsBase(env.MOVED_TO);
      if (moved) return await handleMoved(request, url, path, env, moved);
      if (path === '/api/health' && m === 'GET') return json({ terra: true, configured: isConfigured(env), yandex: yandexConfigured(env) });
      await ensureSchema(env);
      if (path === '/api/leaderboard' && m === 'GET') return await handleLeaderboard(request, url, env);
      if (path === '/api/client' && m === 'GET') return await handleClient(request, env);
      if (path === '/api/player' && m === 'GET') return await handlePlayer(request, url, env);
      if (path === '/api/alliances' && m === 'GET') return await handleAlliances(request, url, env);
      if (path === '/api/alliance' && m === 'GET') return await handleAlliance(request, url, env);
      // устаревшие APK: новые версии получают 426 и показывают окно обновления,
      // старые (не знают 426) — 401: их выкидывает на экран входа, а вход открывает страницу «Обновите игру»
      if (path === '/api/auth/exchange' || PROTECTED.includes(path)) {
        const old = await outdatedApp(request, env);
        if (old) return request.headers.get('X-Terra-Client') ? json({ error: 'update_required', latest: old }, 426) : fail(401, 'update_required');
      }
      if (path === '/api/auth/exchange' && m === 'POST') return await handleExchange(request, env);
      if (path === '/api/auth/twitch' && m === 'POST') return await handleTwitchAuth(request, env);
      if (path === '/api/twitch/link' && m === 'POST') return await handleTwitchLink(request, env);
      if (path === '/api/twitch/status' && m === 'GET') return handleTwitchStatus(env);
      if (path === '/auth/google/start' && m === 'GET') return await handleAuthStart(url, env, 'google');
      if (path === '/auth/google/callback' && m === 'GET') return await handleAuthCallback(url, env);
      if (path === '/auth/yandex/start' && m === 'GET') return await handleAuthStart(url, env, 'yandex');
      if (path === '/auth/yandex/callback' && m === 'GET') return await handleYandexCallback(url, env);

      if (PROTECTED.includes(path)) {
        const sub = await authedSub(request, env);
        if (!sub) return fail(401, 'unauthorized');
        if (path === '/api/me' && m === 'GET') return await handleMe(sub, env);
        if (path === '/api/profile' && m === 'POST') return await handleProfile(request, sub, env);
        if (path === '/api/sync' && m === 'POST') return await handleSync(request, sub, env);
        if (path === '/api/reset' && m === 'POST') return await handleReset(sub, env);
        if (path === '/api/account' && m === 'DELETE') return await handleDelete(sub, env);
        if (path === '/api/redeem' && m === 'POST') return await handleRedeem(request, sub, env);
        if (path === '/api/social' && m === 'GET') return await handleSocial(sub, env);
        if (path === '/api/friends' && m === 'POST') return await handleFriendAdd(request, sub, env);
        if (path === '/api/friends/remove' && m === 'POST') return await handleFriendRemove(request, sub, env);
        if (path === '/api/alliance/create' && m === 'POST') return await handleAllianceCreate(request, sub, env);
        if (path === '/api/alliance/join' && m === 'POST') return await handleAllianceJoin(request, sub, env);
        if (path === '/api/alliance/leave' && m === 'POST') return await handleAllianceLeave(sub, env);
        if (path === '/api/alliance/kick' && m === 'POST') return await handleAllianceKick(request, sub, env);
        if (path === '/api/alliance/settings' && m === 'POST') return await handleAllianceSettings(request, sub, env);
        if (path === '/api/alliance/donate' && m === 'POST') return await handleAllianceDonate(request, sub, env);
        if (path === '/api/chat' && m === 'GET') return await handleChatGet(url, sub, env);
        if (path === '/api/chat' && m === 'POST') return await handleChatPost(request, sub, env);
        if (path === '/api/chat/summary' && m === 'GET') return await handleChatSummary(sub, env);
        if (path === '/api/chat/delete' && m === 'POST') return await handleChatDelete(request, sub, env);
        if (path === '/api/chat/mute' && m === 'POST') return await handleChatMute(request, sub, env);
        if (path === '/api/rewards' && m === 'GET') return await handleRewards(sub, env);
        if (path === '/api/rewards/claim' && m === 'POST') return await handleRewardsClaim(sub, env);
        if (path === '/api/twitch/code' && m === 'POST') return await handleTwitchCode(sub, env);
        if (path === '/api/twitch/unlink' && m === 'POST') return await handleTwitchUnlink(sub, env);
      }
      return fail(404, 'not_found');
    } catch (e) {
      console.error('worker error', (e && e.stack) || e);
      return fail(500, 'server_error');
    }
  }
};

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

const enc = new TextEncoder();
const dec = new TextDecoder();

const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // сессия живёт 30 дней
const LOGIN_TTL_MS = 10 * 60 * 1000;       // на вход через Google даётся 10 минут
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SAVE_BYTES = 20000;
const MAX_REBIRTHS = 100000;
const SCORE_PER_MIN = 10;        // на сколько очков рейтинг может вырасти за минуту
const FIRST_SYNC_ALLOWANCE = 25; // стартовый запас для нового аккаунта (перенос старого прогресса)
const APP_SCHEME = 'terra3d';
const DEFAULT_APP_PACKAGE = 'com.terra3d.game';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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

  const rebirths = Math.min(MAX_REBIRTHS, Math.max(0, Number.isInteger(s.rebirths) ? s.rebirths : 0));
  const era = Math.min(5, Math.max(0, Number.isInteger(s.era) ? s.era : 0));
  const clean = {
    v: s.v, res: s.res, counts: s.counts, perks: s.perks, era, rebirths,
    ownedCosmetics: s.ownedCosmetics, equippedHat: s.equippedHat, equippedBg: s.equippedBg, lastSave: s.lastSave
  };
  const raw = JSON.stringify(clean);
  if (raw.length > MAX_SAVE_BYTES) return fail(413, 'save_too_large');

  // Рейтинг = перерождения*10 + эпоха. В обычной игре он только растёт (перерождение сбрасывает эпоху,
  // но добавляет +10), поэтому при синхронизации счёт не уменьшается: устаревшее устройство не может
  // опустить игрока. Обнулить счёт можно только через /api/reset. Рост ограничен по времени,
  // чтобы нельзя было выставить себе рекорд одним запросом.
  const claimed = rebirths * 10 + era;
  const now = Date.now();
  let newScore = p.score;
  if (claimed > p.score) {
    const elapsedMin = Math.max(0, (now - p.updated_at) / 60000);
    let allowed = Math.floor(SCORE_PER_MIN * elapsedMin) + 1;
    if (p.score === 0) allowed = Math.max(allowed, FIRST_SYNC_ALLOWANCE);
    newScore = Math.min(claimed, p.score + allowed);
  }
  const scoreUpdatedAt = newScore !== p.score ? now : p.score_updated_at;

  await env.DB.prepare('UPDATE players SET save = ?1, score = ?2, rebirths = ?3, era = ?4, updated_at = ?5, score_updated_at = ?6 WHERE sub = ?7')
    .bind(raw, newScore, Math.floor(newScore / 10), newScore % 10, now, scoreUpdatedAt, sub).run();

  const fresh = await getPlayer(env, sub);
  return json({ ok: true, score: fresh.score, rebirths: fresh.rebirths, era: fresh.era, rank: await rankOf(env, fresh) });
}

async function handleReset(sub, env) {
  const p = await getPlayer(env, sub);
  if (!p) return fail(404, 'no_profile');
  const now = Date.now();
  await env.DB.prepare('UPDATE players SET save = NULL, score = 0, rebirths = 0, era = 0, updated_at = ?1, score_updated_at = ?1 WHERE sub = ?2').bind(now, sub).run();
  return json({ ok: true });
}

async function handleDelete(sub, env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM players WHERE sub = ?1').bind(sub),
    env.DB.prepare('DELETE FROM logins WHERE sub = ?1').bind(sub)
  ]);
  return json({ ok: true });
}

async function handleLeaderboard(url, env) {
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const [rows, total] = await env.DB.batch([
    env.DB.prepare('SELECT nickname, score, rebirths, era FROM players ORDER BY score DESC, score_updated_at ASC LIMIT ?1').bind(limit),
    env.DB.prepare('SELECT COUNT(*) AS c FROM players')
  ]);
  return json({ players: rows.results || [], total: (total.results && total.results[0] && total.results[0].c) || 0 });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const m = request.method;
    try {
      if (path === '/api/health' && m === 'GET') return json({ terra: true, configured: isConfigured(env) });
      if (path === '/api/leaderboard' && m === 'GET') return await handleLeaderboard(url, env);
      if (path === '/api/auth/exchange' && m === 'POST') return await handleExchange(request, env);
      if (path === '/auth/google/start' && m === 'GET') return await handleAuthStart(url, env);
      if (path === '/auth/google/callback' && m === 'GET') return await handleAuthCallback(url, env);

      const protectedRoutes = ['/api/me', '/api/profile', '/api/sync', '/api/reset', '/api/account'];
      if (protectedRoutes.includes(path)) {
        const sub = await authedSub(request, env);
        if (!sub) return fail(401, 'unauthorized');
        if (path === '/api/me' && m === 'GET') return await handleMe(sub, env);
        if (path === '/api/profile' && m === 'POST') return await handleProfile(request, sub, env);
        if (path === '/api/sync' && m === 'POST') return await handleSync(request, sub, env);
        if (path === '/api/reset' && m === 'POST') return await handleReset(sub, env);
        if (path === '/api/account' && m === 'DELETE') return await handleDelete(sub, env);
      }
      return fail(404, 'not_found');
    } catch (e) {
      console.error('worker error', (e && e.stack) || e);
      return fail(500, 'server_error');
    }
  }
};

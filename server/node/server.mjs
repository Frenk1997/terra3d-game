// Terra 3D на своём сервере (VPS) — например, в России, где провайдеры ограничивают Cloudflare.
// Работает тот же server/worker.js, что и на Cloudflare, только база — файл SQLite вместо D1,
// а сайт (папка public) и APK (зеркало релизов GitHub) раздаются отсюда же.
//
// Запуск: TERRA_CONFIG=/etc/terra/config.json node server.mjs
// Всё настраивает и обновляет сценарий server/vps/deploy.sh — вручную запускать не нужно.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import {
  readFileSync, existsSync, statSync, createReadStream, createWriteStream,
  mkdirSync, readdirSync, unlinkSync, renameSync, openSync, readSync, closeSync
} from 'node:fs';
import { join, dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { makeD1 } from './d1.mjs';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));   // папка с worker.js, schema.sql и public/
const MAX_BODY = 1 << 20;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'
};
const APK_TYPE = 'application/vnd.android.package-archive';
const APK_RE = /^\/download\/terra3d(?:-(\d{1,4}\.\d{1,4}\.\d{1,7}))?\.apk$/;
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'http2-settings']);
const CORS = { 'Access-Control-Allow-Origin': '*' };

function sendJson(res, status, data, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra });
  res.end(JSON.stringify(data));
}
function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}
async function readBody(req) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > MAX_BODY) { const e = new Error('too_large'); e.status = 413; throw e; }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// Отдать файл целиком или кусок (Range — чтобы загрузка APK могла продолжиться после обрыва)
function sendFile(req, res, file, st, headers) {
  const size = st.size;
  let start = 0, end = size - 1, status = 200;
  const etag = `W/"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const h = { ...headers, ETag: etag, 'Last-Modified': st.mtime.toUTCString(), 'X-Content-Type-Options': 'nosniff' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); res.end(); return; }
  if (headers['Accept-Ranges']) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), size - 1); }
      else start = Math.max(0, size - Number(m[2]));
      if (start > end || start >= size) { res.writeHead(416, { ...h, 'Content-Range': `bytes */${size}` }); res.end(); return; }
      status = 206;
      h['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
  }
  h['Content-Length'] = String(end - start + 1);
  res.writeHead(status, h);
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

/**
 * Обработчик запросов: файлы сайта → зеркало APK → worker.js (API и вход через Google).
 *   worker, env  — модуль worker.js и его окружение (env.DB — база)
 *   publicDir    — сайт (копия web/ с настройками)
 *   apkDir       — куда складывать скачанные с GitHub APK
 *   migrating()  — true, пока база переносится с Cloudflare: API отвечает «техработы»
 */
export function createHandler({ worker, env, publicDir, apkDir, migrating = () => false }) {
  const root = resolve(publicDir);
  const repo = env.GITHUB_REPO && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO) ? env.GITHUB_REPO : '';
  const inflight = new Map();

  function findStatic(pathname) {
    let p;
    try { p = decodeURIComponent(pathname); } catch (e) { return null; }
    if (p.includes('\0')) return null;
    if (p.endsWith('/')) p += 'index.html';
    const f = resolve(root, '.' + p);
    if (f !== root && !f.startsWith(root + sep)) return null;
    try {
      let st = statSync(f);
      if (st.isDirectory()) { const i = join(f, 'index.html'); st = statSync(i); return st.isFile() ? { f: i, st } : null; }
      return st.isFile() ? { f, st } : null;
    } catch (e) { return null; }
  }

  async function latest() {
    const r = await worker.fetch(new Request('http://127.0.0.1/api/client'), env);
    const j = await r.json().catch(() => null);
    return (j && j.latest && /^\d+\.\d+\.\d+$/.test(j.latest.version)) ? j.latest : null;
  }
  const apkFile = (ver) => join(apkDir, `terra3d-${ver}.apk`);

  // Скачать APK этой версии с GitHub (один раз; параллельные запросы ждут ту же загрузку)
  function mirror(ver) {
    const file = apkFile(ver);
    if (existsSync(file)) return Promise.resolve(file);
    if (!inflight.has(ver)) {
      inflight.set(ver, (async () => {
        mkdirSync(apkDir, { recursive: true });
        const url = `https://github.com/${repo}/releases/download/v${ver}/terra3d.apk`;
        const r = await fetch(url, { headers: { 'User-Agent': 'terra-server' }, redirect: 'follow', signal: AbortSignal.timeout(180000) });
        if (!r.ok || !r.body) throw new Error('apk_http_' + r.status);
        const tmp = file + '.part';
        try {
          await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
          const head = Buffer.alloc(2);
          const fd = openSync(tmp, 'r'); readSync(fd, head, 0, 2, 0); closeSync(fd);
          if (statSync(tmp).size < 100000 || head.toString('latin1') !== 'PK') throw new Error('apk_bad_file');
          renameSync(tmp, file);
        } catch (e) { try { unlinkSync(tmp); } catch (e2) {} throw e; }
        // храним три последние версии
        const old = readdirSync(apkDir).filter(n => /^terra3d-[\d.]+\.apk$/.test(n))
          .map(n => ({ n, t: statSync(join(apkDir, n)).mtimeMs })).sort((a, b) => b.t - a.t).slice(3);
        for (const o of old) { try { unlinkSync(join(apkDir, o.n)); } catch (e) {} }
        console.log(`APK ${ver} скачан с GitHub`);
        return file;
      })().finally(() => inflight.delete(ver)));
    }
    return inflight.get(ver);
  }

  async function handleApk(req, res, ver) {
    if (!repo) return sendJson(res, 404, { error: 'not_found' });
    if (!ver) {
      // «последняя версия» — переадресация на ссылку с номером, чтобы браузер не взял старый файл из кэша
      const l = await latest();
      return redirect(res, l ? `/download/terra3d-${l.version}.apk` : `https://github.com/${repo}/releases/latest/download/terra3d.apk`);
    }
    const gh = `https://github.com/${repo}/releases/download/v${ver}/terra3d.apk`;
    let file = apkFile(ver);
    if (!existsSync(file)) {
      const l = await latest();
      if (!l || l.version !== ver) return redirect(res, gh);     // старые версии — прямо с GitHub
      try { file = await mirror(ver); } catch (e) { console.error('APK mirror', e.message); return redirect(res, gh); }
    }
    let st;
    try { st = statSync(file); } catch (e) { return redirect(res, gh); }
    sendFile(req, res, file, st, {
      'Content-Type': APK_TYPE, 'Accept-Ranges': 'bytes',
      'Content-Disposition': `attachment; filename="terra3d-${ver}.apk"`,
      'Cache-Control': 'public, max-age=86400'
    });
  }

  async function callWorker(req, res, url) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || HOP.has(k)) continue;
      if (Array.isArray(v)) v.forEach(x => headers.append(k, x)); else headers.set(k, v);
    }
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const body = hasBody ? await readBody(req) : undefined;
    const r = await worker.fetch(new Request(url, { method: req.method, headers, body, redirect: 'manual' }), env);
    const out = {};
    r.headers.forEach((v, k) => { out[k] = v; });
    const buf = r.body ? Buffer.from(await r.arrayBuffer()) : null;
    res.writeHead(r.status, out);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  const handler = async (req, res) => {
    try {
      // настоящий адрес сайта (сервер стоит за Caddy, который принимает HTTPS)
      const xfp = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      const proto = xfp === 'https' ? 'https' : 'http';
      let host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) host = 'localhost';
      const url = new URL(req.url || '/', `${proto}://${host}`);
      const path = url.pathname;
      const isGet = req.method === 'GET' || req.method === 'HEAD';

      const apk = APK_RE.exec(path);
      if (apk && isGet) return await handleApk(req, res, apk[1]);

      const api = path.startsWith('/api/') || path.startsWith('/auth/');
      if (api && migrating() && path !== '/api/health' && path !== '/api/client' && req.method !== 'OPTIONS') {
        return sendJson(res, 503, { error: 'maintenance' }, { 'Retry-After': '30' });
      }
      if (!api && isGet) {
        const s = findStatic(path);
        if (s) {
          return sendFile(req, res, s.f, s.st, {
            'Content-Type': MIME[extname(s.f).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache'   // сайт всегда свежий: старый код не застревает в кэше
          });
        }
      }
      await callWorker(req, res, url.toString());
    } catch (e) {
      if (e && e.status === 413) return sendJson(res, 413, { error: 'too_large' });
      console.error('server error', (e && e.stack) || e);
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' }); else res.destroy();
    }
  };
  handler.prefetchApk = async () => {
    if (!repo) return;
    const l = await latest();
    if (l && !existsSync(apkFile(l.version))) await mirror(l.version);
  };
  return handler;
}

// Ежедневная копия базы (хранится 14 дней)
function backupDaily(db, dir) {
  const day = new Date().toISOString().slice(0, 10);
  const file = join(dir, `terra-${day}.db`);
  if (existsSync(file)) return;
  mkdirSync(dir, { recursive: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = readdirSync(dir).filter(n => /^terra-\d{4}-\d\d-\d\d\.db$/.test(n)).sort().reverse().slice(14);
  for (const n of old) { try { unlinkSync(join(dir, n)); } catch (e) {} }
  console.log('Резервная копия базы:', file);
}

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  db.exec(readFileSync(join(APP, 'schema.sql'), 'utf8'));
  return db;
}

async function main() {
  const cfg = JSON.parse(readFileSync(process.env.TERRA_CONFIG || '/etc/terra/config.json', 'utf8'));
  const dataDir = cfg.dataDir || '/var/lib/terra';
  mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(join(dataDir, 'terra.db'));
  const worker = (await import(pathToFileURL(join(APP, 'worker.js')).href)).default;

  const env = {};
  for (const [k, v] of Object.entries(cfg.env || {})) if (v !== null && v !== undefined && v !== '') env[k] = String(v);
  env.DB = makeD1(db);
  const publicUrl = String(cfg.publicUrl || '').replace(/\/+$/, '');
  if (publicUrl && env.GITHUB_REPO) env.APK_BASE = publicUrl + '/download';   // кнопка «Скачать обновление» — с этого сервера

  const marker = join(dataDir, '.migrated');
  let migrated = !cfg.awaitMigration;
  const migrating = () => !(migrated || (migrated = existsSync(marker)));

  const handler = createHandler({ worker, env, publicDir: join(APP, 'public'), apkDir: join(dataDir, 'apk'), migrating });
  const server = http.createServer(handler);
  server.keepAliveTimeout = 65000;
  server.requestTimeout = 60000;
  const port = Number(cfg.port || 8787), host = cfg.host || '127.0.0.1';
  server.listen(port, host, () => console.log(`Terra 3D: http://${host}:${port} → ${publicUrl || '(адрес не задан)'}${migrating() ? ' — ждём перенос базы' : ''}`));

  const tick = () => {
    try { backupDaily(db, join(dataDir, 'backups')); } catch (e) { console.error('backup', e.message); }
    handler.prefetchApk().catch(e => console.error('APK prefetch', e.message));
  };
  setTimeout(tick, 10000).unref();
  setInterval(tick, 10 * 60 * 1000).unref();

  const stop = () => {
    server.close();
    setTimeout(() => { try { db.close(); } catch (e) {} process.exit(0); }, 1500).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}

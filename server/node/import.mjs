// Переносит базу из Cloudflare D1 в файл SQLite для своего сервера.
//   node import.mjs dump.sql terra.db
// dump.sql — выгрузка «wrangler d1 export terra --remote --output dump.sql» (делает server/vps/migrate.sh).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.error('использование: node import.mjs dump.sql terra.db'); process.exit(2); }
for (const f of [dst, dst + '-wal', dst + '-shm']) if (existsSync(f)) unlinkSync(f);

const db = new DatabaseSync(dst);
db.exec('PRAGMA journal_mode = DELETE;');
// вся выгрузка — одной транзакцией (свои BEGIN/COMMIT выгрузки, если есть, убираем)
const sql = readFileSync(src, 'utf8').replace(/^\s*(BEGIN( TRANSACTION)?|COMMIT|END( TRANSACTION)?)\s*;\s*$/gim, '');
db.exec('BEGIN');
db.exec(sql);
db.exec('COMMIT');
// новые таблицы и индексы, которых могло не быть в старой базе
db.exec(readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'schema.sql'), 'utf8'));
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
for (const t of tables) {
  const n = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name.replace(/"/g, '""')}"`).get().c;
  console.log(`${t.name}: ${n}`);
}
const check = db.prepare('PRAGMA integrity_check').get();
db.close();
if (Object.values(check)[0] !== 'ok') { console.error('база повреждена:', check); process.exit(1); }

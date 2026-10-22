#!/usr/bin/env bash
# Один раз переносит базу игроков из Cloudflare D1 на свой сервер (VPS).
# Запускается сценарием «Deploy server» после server/vps/deploy.sh и после того, как Cloudflare
# переключён в режим переадресации (MOVED_TO) — значит, в D1 уже никто не пишет и ничего не потеряется.
# Если база уже перенесена — ничего не делает.
set -euo pipefail
cd "$(dirname "$0")/.."     # папка server/

[ -n "$(printf '%s' "${VPS_HOST:-}" | tr -d '[:space:]')" ] || exit 0
source vps/ssh.sh

if rssh 'test -f /var/lib/terra/.migrated'; then
  echo "База уже на сервере — переносить нечего"
  exit 0
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "Cloudflare не настроен — начинаем с пустой базы"
  rssh 'touch /var/lib/terra/.migrated && chown terra:terra /var/lib/terra/.migrated'
  exit 0
fi

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
echo "== Выгрузка базы из Cloudflare D1"
npx --yes wrangler@4 d1 export terra --remote --output "$T/terra.sql"
echo "Выгружено: $(wc -c < "$T/terra.sql") байт, строк INSERT: $(grep -c '^INSERT' "$T/terra.sql" || true)"
gzip -9 "$T/terra.sql"

echo "== Загрузка на сервер"
rssh 'cat > /tmp/terra-import.sql.gz' < "$T/terra.sql.gz"
rssh 'bash -s' <<'REMOTE'
set -euo pipefail
cd /var/lib/terra
gunzip -f /tmp/terra-import.sql.gz
chown terra:terra /tmp/terra-import.sql
runuser -u terra -- /opt/terra/bin/node --no-warnings /opt/terra/app/node/import.mjs /tmp/terra-import.sql /var/lib/terra/terra.db.import
systemctl stop terra
if [ -f terra.db ]; then cp terra.db "backups/before-import-$(date +%Y%m%d-%H%M%S).db"; fi
rm -f terra.db-wal terra.db-shm
mv -f terra.db.import terra.db
touch .migrated
chown terra:terra terra.db .migrated
rm -f "backups/terra-$(date -u +%F).db"   # сегодняшняя копия была пустой базы — сервер сделает новую
systemctl start terra
rm -f /tmp/terra-import.sql
echo "База перенесена, сервер игры перезапущен"
REMOTE

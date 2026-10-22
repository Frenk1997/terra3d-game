#!/usr/bin/env bash
# Выкладывает игру на свой сервер (VPS) — например, в России, где провайдеры ограничивают Cloudflare
# и без VPN игра не грузится. Запускается GitHub-сценарием «Deploy server», когда задан секрет VPS_HOST.
#
# Первый запуск сам настраивает чистый сервер (Ubuntu/Debian): Node.js, HTTPS-сертификат, автозапуск.
# Дальше — просто обновляет игру. Секреты:
#   VPS_HOST, VPS_PASSWORD (или VPS_SSH_KEY)   доступ к серверу (см. ssh.sh)
#   SERVER_DOMAIN       (необязательно) свой домен; без него адрес будет https://<IP-через-дефисы>.sslip.io
#   ACME_EMAIL          (необязательно) почта для писем Let's Encrypt о сертификате
#   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET, PROMO_CODES, FORCE_UPDATE, TWITCH_EXT_SECRET — как для Cloudflare
#   YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET (вход с Яндекс ID), ADMIN_CODE (свой код чит-меню) — необязательные
set -euo pipefail
cd "$(dirname "$0")/.."     # папка server/

NODE_VERSION=22.22.0
CADDY_VERSION=2.10.2

if [ -z "$(printf '%s' "${VPS_HOST:-}" | tr -d '[:space:]')" ]; then
  if [ -n "${VPS_PASSWORD:-}${VPS_SSH_KEY:-}" ]; then
    echo "::warning title=Нет секрета VPS_HOST::Пароль сервера задан, а IP-адрес — нет. Добавьте секрет VPS_HOST (Settings → Secrets and variables → Actions → Repository secrets)."
  else
    echo "Свой сервер не настроен: секретов VPS_HOST и VPS_PASSWORD нет (Settings → Secrets and variables → Actions → Repository secrets) — выкладываю только на Cloudflare"
  fi
  exit 0
fi
missing=()
for v in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SESSION_SECRET; do [ -n "${!v:-}" ] || missing+=("$v"); done
if [ ${#missing[@]} -gt 0 ]; then
  echo "::error title=Не хватает секретов::${missing[*]} — те же, что для Cloudflare (SETUP.md)"
  exit 1
fi

PUBLIC_URL="$(bash vps/public-url.sh)"
PUBLIC_HOST="${PUBLIC_URL#https://}"
HOSTS="$PUBLIC_HOST"
IP="$(printf '%s' "$VPS_HOST" | tr -d '[:space:]')"
if printf '%s' "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
  SSLIP="${IP//./-}.sslip.io"
  # адрес sslip.io работает всегда — и для старых сборок, если потом появится свой домен
  [ "$SSLIP" = "$PUBLIC_HOST" ] || HOSTS="$PUBLIC_HOST, $SSLIP"
fi
echo "Адрес игры: $PUBLIC_URL"

source vps/ssh.sh
vps_check_login

echo "== 1/4 Сервер"
probe="$(rssh 'uname -m
  if [ -x /opt/terra/bin/node ]; then /opt/terra/bin/node --version; else echo none; fi
  if [ -x /usr/local/bin/caddy ]; then /usr/local/bin/caddy version | cut -d" " -f1; else echo none; fi
  if [ -f /var/lib/terra/.migrated ]; then echo migrated; else echo fresh; fi
  (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || echo "?"')"
ARCH="$(sed -n 1p <<<"$probe")"; R_NODE="$(sed -n 2p <<<"$probe")"; R_CADDY="$(sed -n 3p <<<"$probe")"
R_STATE="$(sed -n 4p <<<"$probe")"; R_OS="$(sed -n 5p <<<"$probe")"
echo "Система: $R_OS ($ARCH); Node.js: $R_NODE; Caddy: $R_CADDY; база: $R_STATE"
case "$ARCH" in
  x86_64|amd64) NA=x64; CA=amd64 ;;
  aarch64|arm64) NA=arm64; CA=arm64 ;;
  *) echo "::error title=Неподдерживаемый процессор::$ARCH — нужен x86_64 или arm64"; exit 1 ;;
esac

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
B="$T/terra-deploy"
mkdir -p "$B/app/node"

# Node.js и Caddy ставятся один раз. Сначала сервер пробует скачать их сам (быстрее), проверяя
# контрольные суммы; не вышло — скачиваем здесь и загружаем на сервер вместе с игрой.
NEED_NODE=0; NEED_CADDY=0; NF=""; NSUM=""; CF=""; CSUM=""
CBASE="https://github.com/caddyserver/caddy/releases/download/v$CADDY_VERSION"
if [ "$R_NODE" != "v$NODE_VERSION" ]; then
  NEED_NODE=1
  NF="node-v$NODE_VERSION-linux-$NA.tar.xz"
  NSUM="$(curl -fsSL --retry 3 "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | awk -v f="$NF" '$2 == f { print $1 }')"
fi
if [ "$R_CADDY" != "v$CADDY_VERSION" ]; then
  NEED_CADDY=1
  CF="caddy_${CADDY_VERSION}_linux_$CA.tar.gz"
  CSUM="$(curl -fsSL --retry 3 "$CBASE/caddy_${CADDY_VERSION}_checksums.txt" | awk -v f="$CF" '$2 == f { print $1 }')"
fi
if [ "$NEED_NODE$NEED_CADDY" != "00" ]; then
  echo "Сервер скачивает Node.js и Caddy сам…"
  got="$(rssh "NEED_NODE=$NEED_NODE NEED_CADDY=$NEED_CADDY NV=$NODE_VERSION NA=$NA NF=$NF NSUM=$NSUM CF=$CF CSUM=$CSUM CBASE=$CBASE bash -s" <<'REMOTE' || true
set -u
rm -rf /tmp/terra-dl && mkdir -p /tmp/terra-dl && cd /tmp/terra-dl
dl() {
  local out="$1"; shift
  for u in "$@"; do
    if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 10 --max-time 240 -o "$out" "$u" && return 0
    elif command -v wget >/dev/null 2>&1; then wget -q -T 60 -O "$out" "$u" && return 0; fi
  done
  return 1
}
if [ "$NEED_NODE" = 1 ] && [ -n "$NSUM" ] && command -v xz >/dev/null 2>&1; then
  if dl "$NF" "https://nodejs.org/dist/v$NV/$NF" "https://npmmirror.com/mirrors/node/v$NV/$NF" \
     && echo "$NSUM  $NF" | sha256sum -c --quiet - && tar -xJf "$NF" --strip-components=2 "node-v$NV-linux-$NA/bin/node"; then echo NODE_OK; fi
fi
if [ "$NEED_CADDY" = 1 ] && [ -n "$CSUM" ]; then
  if dl "$CF" "$CBASE/$CF" && echo "$CSUM  $CF" | sha512sum -c --quiet - && tar -xzf "$CF" caddy; then echo CADDY_OK; fi
fi
rm -f /tmp/terra-dl/*.tar.*
REMOTE
)"
  if grep -q NODE_OK <<<"$got"; then NEED_NODE=0; echo "Node.js $NODE_VERSION — скачан сервером"; fi
  if grep -q CADDY_OK <<<"$got"; then NEED_CADDY=0; echo "Caddy $CADDY_VERSION — скачан сервером"; fi
fi
if [ "$NEED_NODE" = 1 ]; then
  echo "Скачиваю Node.js $NODE_VERSION (загружу на сервер вместе с игрой)"
  curl -fsSL --retry 3 -o "$T/$NF" "https://nodejs.org/dist/v$NODE_VERSION/$NF"
  (cd "$T" && echo "$NSUM  $NF" | sha256sum -c --quiet -)
  tar -xJf "$T/$NF" -C "$T" "node-v$NODE_VERSION-linux-$NA/bin/node"
  mv "$T/node-v$NODE_VERSION-linux-$NA/bin/node" "$B/node"
fi
if [ "$NEED_CADDY" = 1 ]; then
  echo "Скачиваю Caddy $CADDY_VERSION (загружу на сервер вместе с игрой)"
  curl -fsSL --retry 3 -o "$T/$CF" "$CBASE/$CF"
  (cd "$T" && echo "$CSUM  $CF" | sha512sum -c --quiet -)
  tar -xzf "$T/$CF" -C "$B" caddy
fi

echo "== 2/4 Сборка"
cp worker.js schema.sql "$B/app/"
cp node/*.mjs "$B/app/node/"
cp -R ../web "$B/app/public"
REPO="${GITHUB_REPO:-${GITHUB_REPOSITORY:-}}"
SITE_VERSION="$(printf '%s' "${GITHUB_SHA:-$(date +%s)}" | cut -c1-12)"
# сайт: сервер — этот же адрес, APK — с этого же сервера
CFG="$B/app/public/config.js"
OLD_API="$(sed -nE "s/^[[:space:]]*API_URL:[[:space:]]*'([^']*)'.*/\1/p" "$CFG" | head -1)"
sed -i -E "s#^([[:space:]]*API_URL:).*#\1 location.origin,#" "$CFG"
if [ -n "$REPO" ]; then sed -i "s#APK_URL: ''#APK_URL: '/download/terra3d.apk'#" "$CFG"; fi
printf "\nwindow.TERRA_SITE_VERSION = '%s';\n" "$SITE_VERSION" >> "$CFG"
# откуда игра переехала: оттуда принимаем вход, чтобы игрокам сайта не входить заново
if printf '%s' "$OLD_API" | grep -Eq '^https://[A-Za-z0-9.-]+$' && [ "$OLD_API" != "$PUBLIC_URL" ]; then
  printf "window.TERRA_MOVED_FROM = '%s';\n" "$OLD_API" >> "$CFG"
fi
sed -i -E "s#(src=\"(config|js/[a-z]+)\.js)\"#\1?v=${SITE_VERSION}\"#g" "$B/app/public/index.html"
grep -q "location.origin" "$CFG" || { echo "::error::Не удалось настроить config.js"; exit 1; }

AWAIT=false
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && AWAIT=true    # пока база не перенесена с Cloudflare — техработы
PUBLIC_URL="$PUBLIC_URL" GITHUB_REPO="$REPO" SITE_VERSION="$SITE_VERSION" AWAIT="$AWAIT" OUT="$B/config.json" node -e '
  const e = process.env, env = {};
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET", "PROMO_CODES", "FORCE_UPDATE", "TWITCH_EXT_SECRET", "YANDEX_CLIENT_ID", "YANDEX_CLIENT_SECRET", "ADMIN_CODE", "GITHUB_REPO", "SITE_VERSION"]) if (e[k]) env[k] = e[k];
  const cfg = { port: 8787, host: "127.0.0.1", dataDir: "/var/lib/terra", publicUrl: e.PUBLIC_URL, awaitMigration: e.AWAIT === "true", env };
  require("fs").writeFileSync(e.OUT, JSON.stringify(cfg, null, 2), { mode: 0o600 });'
chmod 600 "$B/config.json"

{
  echo "# Создан сценарием server/vps/deploy.sh — ручные правки перезапишутся при следующем деплое"
  if [ -n "${ACME_EMAIL:-}" ]; then printf '{\n\temail %s\n}\n\n' "$ACME_EMAIL"; fi
  printf '%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:8787\n}\n' "$HOSTS"
} > "$B/Caddyfile"
cp vps/setup.sh "$B/"

echo "== 3/4 Выкладка на сервер"
tar -C "$T" -czf "$T/bundle.tgz" terra-deploy
echo "Загружаю $(du -h "$T/bundle.tgz" | cut -f1) на сервер…"
t0=$(date +%s)
rssh 'umask 077 && rm -rf /tmp/terra-deploy /tmp/terra-deploy.tgz && cat > /tmp/terra-deploy.tgz' < "$T/bundle.tgz"
echo "Загружено за $(( $(date +%s) - t0 )) с"
rssh 'tar -xzf /tmp/terra-deploy.tgz -C /tmp && rm -f /tmp/terra-deploy.tgz && bash /tmp/terra-deploy/setup.sh'

echo "== 4/4 Проверка: $PUBLIC_URL"
ok=0
for i in $(seq 1 36); do
  if body="$(curl -fsS --max-time 10 "$PUBLIC_URL/api/health" 2>/dev/null)" && printf '%s' "$body" | grep -q '"terra":true'; then ok=1; break; fi
  sleep 5
done
if [ "$ok" != 1 ]; then
  rssh 'journalctl -u caddy -n 25 --no-pager' || true
  echo "::error title=Сайт не открывается::Сервер игры запущен, но $PUBLIC_URL не отвечает. Проверьте в панели хостинга, что файрвол пропускает порты 80 и 443$( [ -n "${SERVER_DOMAIN:-}" ] && echo ", и что A-запись домена указывает на $IP" )."
  exit 1
fi
echo "Работает: $body"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "url=$PUBLIC_URL" >> "$GITHUB_OUTPUT"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### 🇷🇺 Игра на своём сервере: $PUBLIC_URL"
    echo "Открывается без VPN. В Google Cloud → Credentials → ваш OAuth Client должен быть адрес перенаправления:"
    echo '```'
    echo "$PUBLIC_URL/auth/google/callback"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi

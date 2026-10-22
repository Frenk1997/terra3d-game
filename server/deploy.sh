#!/usr/bin/env bash
# Выкладывает сервер и веб-версию игры на Cloudflare. Запускается GitHub-сценарием «Deploy server»,
# но можно запустить и вручную (нужен Node.js), задав те же переменные окружения.
#
#   CLOUDFLARE_API_TOKEN   токен Cloudflare (Workers + D1)
#   CLOUDFLARE_ACCOUNT_ID  ID аккаунта Cloudflare (желательно)
#   GOOGLE_CLIENT_ID       Client ID Google (Web application)
#   GOOGLE_CLIENT_SECRET   секрет этого клиента
#   SESSION_SECRET         любая длинная случайная строка
#   APK_URL                (необязательно) ссылка «Скачать для Android» на сайте
#   GITHUB_REPO            (необязательно) «владелец/репозиторий» с релизами APK; в GitHub Actions берётся сам
#   PROMO_CODES            (необязательно) свои промокоды, по одному в строке
#   FORCE_UPDATE           (необязательно) 0 — пускать в игру устаревшие версии APK
#   TWITCH_EXT_SECRET      (необязательно) секрет расширения Twitch — игра в панели под трансляцией
#   MOVED_TO               (необязательно) https://адрес своего сервера (VPS): игра переехала туда,
#                          Cloudflare только переадресует (ставит сценарий, когда настроен VPS)
set -euo pipefail
cd "$(dirname "$0")"

missing=()
for v in CLOUDFLARE_API_TOKEN GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SESSION_SECRET; do
  [ -n "${!v:-}" ] || missing+=("$v")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "::warning title=Сервер не выложен::Не заданы секреты: ${missing[*]}. Добавьте их в Settings → Secrets and variables → Actions (README, шаги 3–5)."
  exit 0
fi

WRANGLER=(npx --yes wrangler@4)

find_db_id() {
  "${WRANGLER[@]}" d1 list --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const list = JSON.parse(s.slice(s.indexOf("[")));
        const db = list.find(x => x.name === "terra");
        process.stdout.write(db ? String(db.uuid || db.id || "") : "");
      } catch (e) {}
    });'
}

echo "== 1/4 База данных D1"
DB_ID="$(find_db_id)"
if [ -z "$DB_ID" ]; then
  echo "Базы «terra» нет — создаю"
  "${WRANGLER[@]}" d1 create terra
  DB_ID="$(find_db_id)"
fi
if [ -z "$DB_ID" ]; then
  echo "::error title=Нет базы D1::Не удалось найти или создать базу «terra». Проверьте, что у токена есть право D1 → Edit."
  exit 1
fi
sed -i.bak "s/^database_id = .*/database_id = \"$DB_ID\"/" wrangler.toml && rm -f wrangler.toml.bak
echo "База: $DB_ID"

echo "== 2/4 Таблицы"
"${WRANGLER[@]}" d1 execute terra --remote --file=schema.sql

MOVED_TO="$(printf '%s' "${MOVED_TO:-}" | sed -E 's#/+$##')"
if [ -n "$MOVED_TO" ] && ! printf '%s' "$MOVED_TO" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
  echo "::error title=Неверный MOVED_TO::Нужен адрес вида https://example.ru, а не «$MOVED_TO»"; exit 1
fi

echo "== 3/4 Веб-версия игры"
# Версия сайта: открытая вкладка со старым кодом увидит, что вышло новое, и перезагрузится сама.
# Тот же номер — в адресах скриптов, чтобы браузер не взял старые файлы из кэша.
SITE_VERSION="$(printf '%s' "${GITHUB_SHA:-$(date +%s)}" | cut -c1-12)"
rm -rf public
if [ -n "$MOVED_TO" ]; then
  # игра переехала на свой сервер: здесь — только страница-переадресация (переносит вход на новый адрес)
  mkdir public
  sed "s#__TO__#${MOVED_TO}#g" vps/moved.html > public/index.html
  cp ../web/privacy.html ../web/icon-192.png public/
  echo "Игра переехала на ${MOVED_TO} — Cloudflare только переадресует туда"
else
  cp -R ../web public
  if [ -n "${APK_URL:-}" ]; then
    sed -i.bak "s#APK_URL: ''#APK_URL: '${APK_URL}'#" public/config.js && rm -f public/config.js.bak
  fi
  printf '\nwindow.TERRA_SITE_VERSION = %s;\n' "'${SITE_VERSION}'" >> public/config.js
  sed -i.bak -E "s#(src=\"(config|js/[a-z]+)\.js)\"#\1?v=${SITE_VERSION}\"#g" public/index.html && rm -f public/index.html.bak
fi
printf '/*\n  Cache-Control: no-cache\n' > public/_headers
echo "Версия сайта: ${SITE_VERSION}"

echo "== 4/4 Выкладка"
# GITHUB_REPO — откуда сервер узнаёт номер последней версии APK (для окна «Вышло обновление»)
REPO="${GITHUB_REPO:-${GITHUB_REPOSITORY:-}}"
VARS=(--var "GOOGLE_CLIENT_ID:${GOOGLE_CLIENT_ID}" --var "SITE_VERSION:${SITE_VERSION}")
if [ -n "$REPO" ]; then VARS+=(--var "GITHUB_REPO:${REPO}"); fi
# FORCE_UPDATE=0 — пускать в игру устаревшие APK (по умолчанию играть можно только в последней версии)
if [ -n "${FORCE_UPDATE:-}" ]; then VARS+=(--var "FORCE_UPDATE:${FORCE_UPDATE}"); fi
# MOVED_TO — игра переехала на свой сервер (без него — обычный режим, игра на Cloudflare)
if [ -n "$MOVED_TO" ]; then VARS+=(--var "MOVED_TO:${MOVED_TO}"); fi
"${WRANGLER[@]}" deploy "${VARS[@]}"
printf '%s' "$GOOGLE_CLIENT_SECRET" | "${WRANGLER[@]}" secret put GOOGLE_CLIENT_SECRET
printf '%s' "$SESSION_SECRET" | "${WRANGLER[@]}" secret put SESSION_SECRET
# свои промокоды (необязательно): секрет PROMO_CODES, формат — в README
if [ -n "${PROMO_CODES:-}" ]; then printf '%s' "$PROMO_CODES" | "${WRANGLER[@]}" secret put PROMO_CODES; fi
# секрет расширения Twitch (необязательно): вход зрителей в игру в панели под трансляцией
if [ -n "${TWITCH_EXT_SECRET:-}" ]; then printf '%s' "$TWITCH_EXT_SECRET" | "${WRANGLER[@]}" secret put TWITCH_EXT_SECRET; fi

echo "Готово. Адрес сервера — строка с workers.dev выше (его нужно вписать в web/config.js)."

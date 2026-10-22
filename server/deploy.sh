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

echo "== 3/4 Веб-версия игры"
rm -rf public
cp -R ../web public
if [ -n "${APK_URL:-}" ]; then
  sed -i.bak "s#APK_URL: ''#APK_URL: '${APK_URL}'#" public/config.js && rm -f public/config.js.bak
fi

echo "== 4/4 Выкладка"
"${WRANGLER[@]}" deploy --var "GOOGLE_CLIENT_ID:${GOOGLE_CLIENT_ID}"
printf '%s' "$GOOGLE_CLIENT_SECRET" | "${WRANGLER[@]}" secret put GOOGLE_CLIENT_SECRET
printf '%s' "$SESSION_SECRET" | "${WRANGLER[@]}" secret put SESSION_SECRET

echo "Готово. Адрес сервера — строка с workers.dev выше (его нужно вписать в web/config.js)."

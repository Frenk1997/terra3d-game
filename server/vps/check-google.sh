#!/usr/bin/env bash
# Проверяет, что Google разрешает вход на новом адресе (адрес перенаправления добавлен в Google Cloud).
# Только предупреждает — ничего не меняет.
set -uo pipefail
URL="${1:?адрес игры}"
st="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
ch="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32)[:43])')"
loc="$(curl -s -o /dev/null --max-time 20 -w '%{redirect_url}' "$URL/auth/google/start?state=$st&challenge=$ch&app=0")"
case "$loc" in
  https://accounts.google.com/*) ;;
  *) echo "Не удалось начать вход (ответ: ${loc:-нет переадресации}) — пропускаю проверку"; exit 0 ;;
esac
body="$(curl -sL --max-time 25 -A 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' -w '\n%{http_code}' "$loc")"
code="$(tail -n1 <<<"$body")"
if grep -q 'redirect_uri_mismatch' <<<"$body"; then
  echo "::warning title=Добавьте адрес в Google::Вход через Google на ${URL} пока не работает. Google Cloud Console → APIs & Services → Credentials → ваш OAuth Client (Web application) → Authorized redirect URIs → Add URI: ${URL}/auth/google/callback → Save. Через 5 минут вход заработает."
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "> ⚠️ **Вход через Google пока не работает** — добавьте \`${URL}/auth/google/callback\` в Authorized redirect URIs (Google Cloud → Credentials)." >> "$GITHUB_STEP_SUMMARY"
  fi
else
  echo "Google не сообщил об ошибке адреса (ответ $code). Проверьте вход в игре: ${URL}"
fi

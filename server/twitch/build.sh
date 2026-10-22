#!/usr/bin/env bash
# Собирает игру для панели под трансляцией на Twitch: zip, который загружается в кабинет разработчика Twitch
# (dev.twitch.tv → Extensions → ваше расширение → Files → Upload Version).
#   bash server/twitch/build.sh https://адрес-сервера terra3d-twitch.zip
# Twitch сам раздаёт эти файлы зрителям, а игра ходит на наш сервер за входом, сохранениями и топом —
# поэтому адрес сервера нужно добавить в «Allowlist for URL Fetching Domains» (см. SETUP.md).
set -euo pipefail
API="${1:?адрес сервера, например https://example.ru}"
OUT="${2:-terra3d-twitch.zip}"
# библиотека Twitch для расширений — обязательна (для проверки на своём компьютере её можно подменить)
HELPER="${TWITCH_HELPER_URL:-https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
case "$API" in https://*) ;; *) [ -n "${TWITCH_ALLOW_HTTP:-}" ] || { echo "Адрес сервера должен начинаться с https://" >&2; exit 1; } ;; esac
API="${API%/}"

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/p/js"
cp "$ROOT/web/js/data.js" "$ROOT/web/js/sound.js" "$ROOT/web/js/game.js" "$T/p/js/"
cp "$ROOT/web/icon-192.png" "$ROOT/web/privacy.html" "$ROOT/web/terms.html" "$T/p/"
cat > "$T/p/config.js" <<CFG
// Сборка для Twitch (server/twitch/build.sh): вход через аккаунт Twitch, сервер игры:
window.TERRA_CONFIG = { API_URL: '$API', APK_URL: '', TWITCH: true };
// под трансляцией фоновая музыка по умолчанию выключена — не мешает звуку стрима (включается в ⚙️)
try { if (localStorage.getItem('terra_music') === null) localStorage.setItem('terra_music', 'off'); } catch (e) {}
CFG
# библиотека Twitch подключается первой; других внешних скриптов у игры нет
python3 - "$ROOT/web/index.html" "$T/p/index.html" "$HELPER" <<'PY'
import sys
src, dst, helper = sys.argv[1:4]
s = open(src, encoding='utf-8').read()
tag = '<script src="config.js"></script>'
assert s.count(tag) == 1, 'в index.html не найден config.js'
s = s.replace(tag, f'<script src="{helper}"></script>\n{tag}')
open(dst, 'w', encoding='utf-8').write(s)
PY
# страница настройки для владельца канала (настраивать ничего не нужно)
cat > "$T/p/config.html" <<HTML
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Terra 3D — настройка</title>
<script src="$HELPER"></script>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 20px; background: #0b1026; color: #e5e7eb; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0 0 10px; color: #c7cbe0; }
  b { color: #fff; }
</style>
</head>
<body>
<h1>🌍 Terra 3D</h1>
<p>Настраивать ничего не нужно — игра уже готова.</p>
<p>Включите расширение как <b>панель</b> (Расширения → Мои расширения → Активировать → Панель), и зрители смогут играть прямо под трансляцией.</p>
<p>Зрители входят через свой аккаунт Twitch. Кто уже играет в Terra 3D на телефоне или на сайте, может привязать тот аккаунт: в игре ⚙️ → «📺 Играть на Twitch» → ввести код в панели.</p>
</body>
</html>
HTML
rm -f "$OUT"
(cd "$T/p" && zip -qr -X "$T/out.zip" .)
mv "$T/out.zip" "$OUT"
echo "Готово: $OUT ($(du -h "$OUT" | cut -f1)), сервер игры: $API"

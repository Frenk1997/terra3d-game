#!/usr/bin/env bash
# Настраивает VPS для Terra 3D и выкладывает новую версию. Запускает server/vps/deploy.sh по SSH
# (от root, на Ubuntu/Debian); повторный запуск безопасен — просто обновляет игру.
#
# Что ставится:
#   /opt/terra/bin/node      Node.js (одна программа, без npm)
#   /opt/terra/app           игра: worker.js, schema.sql, node/*.mjs, public/ (сайт)
#   /etc/terra/config.json   настройки и секреты (читает только сервис terra)
#   /var/lib/terra           база terra.db, резервные копии (backups/), зеркало APK (apk/)
#   /usr/local/bin/caddy     веб-сервер: HTTPS-сертификат Let's Encrypt, сам продлевает
#   сервисы systemd: terra (игра, 127.0.0.1:8787) и caddy (порты 80 и 443)
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
trap 'rm -rf "$D"' EXIT   # во временной папке секреты — не оставляем её
say() { printf '\n== %s\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Нужен вход под root (VPS_USER=root)"; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "Нужна система с systemd — например, Ubuntu 22.04/24.04 или Debian 12"; exit 1; }

say "Пользователи и папки"
id terra >/dev/null 2>&1 || useradd --system --home-dir /var/lib/terra --no-create-home --shell /usr/sbin/nologin terra
id caddy >/dev/null 2>&1 || useradd --system --home-dir /var/lib/caddy --no-create-home --shell /usr/sbin/nologin caddy
install -d -o terra -g terra -m 750 /var/lib/terra /var/lib/terra/backups /var/lib/terra/apk
install -d -o caddy -g caddy -m 750 /var/lib/caddy
install -d -m 755 /opt/terra /opt/terra/bin /etc/caddy
install -d -m 750 -o root -g terra /etc/terra

if [ -f "$D/node" ]; then
  say "Node.js $("$D/node" --version)"
  install -m 755 "$D/node" /opt/terra/bin/node.new && mv -f /opt/terra/bin/node.new /opt/terra/bin/node
fi
CADDY_NEW=0
if [ -f "$D/caddy" ]; then
  say "Caddy $("$D/caddy" version | cut -d' ' -f1)"
  install -m 755 "$D/caddy" /usr/local/bin/caddy.new && mv -f /usr/local/bin/caddy.new /usr/local/bin/caddy
  CADDY_NEW=1
fi
[ -x /opt/terra/bin/node ] || { echo "Node.js не установлен"; exit 1; }
[ -x /usr/local/bin/caddy ] || { echo "Caddy не установлен"; exit 1; }

say "Игра"
rm -rf /opt/terra/app.new /opt/terra/app.old
cp -R "$D/app" /opt/terra/app.new
chown -R root:root /opt/terra/app.new
chmod -R u=rwX,go=rX /opt/terra/app.new
if [ -d /opt/terra/app ]; then mv /opt/terra/app /opt/terra/app.old; fi
mv /opt/terra/app.new /opt/terra/app
rm -rf /opt/terra/app.old
install -m 640 -o root -g terra "$D/config.json" /etc/terra/config.json
install -m 644 -o root -g root "$D/Caddyfile" /etc/caddy/Caddyfile
if ! out="$(/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1)"; then
  echo "$out" | tail -20; echo "Ошибка в настройках Caddy"; exit 1
fi

cat > /etc/systemd/system/terra.service <<'UNIT'
[Unit]
Description=Terra 3D — сервер игры
After=network-online.target
Wants=network-online.target

[Service]
User=terra
Group=terra
Environment=TERRA_CONFIG=/etc/terra/config.json
ExecStart=/opt/terra/bin/node --no-warnings /opt/terra/app/node/server.mjs
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/terra

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy — HTTPS для Terra 3D
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
Environment=XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

say "Порты 80 и 443"
# на некоторых VPS сразу стоит другой веб-сервер — он занял бы порты, нужные игре
for svc in apache2 nginx httpd lighttpd; do
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    echo "Останавливаю $svc: порты 80 и 443 нужны игре"
    systemctl disable --now "$svc" >/dev/null 2>&1 || true
  fi
done
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  echo "ufw: открыл 80 и 443"
fi

say "Запуск"
systemctl daemon-reload
systemctl enable terra caddy >/dev/null 2>&1
systemctl restart terra
if [ "$CADDY_NEW" = 1 ] || ! systemctl is-active --quiet caddy; then
  systemctl restart caddy
else
  systemctl reload caddy || systemctl restart caddy
fi

ok=0
for i in $(seq 1 20); do
  if /opt/terra/bin/node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  echo "Сервер игры не запустился. Журнал:"
  journalctl -u terra -n 40 --no-pager || true
  exit 1
fi
if ! systemctl is-active --quiet caddy; then
  echo "Caddy не запустился. Журнал:"
  journalctl -u caddy -n 40 --no-pager || true
  exit 1
fi
echo "Сервер игры работает"
df -h / | tail -1 | awk '{print "Диск: занято " $3 " из " $2}'

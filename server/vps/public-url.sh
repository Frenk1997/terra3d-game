#!/usr/bin/env bash
# Печатает адрес игры на своём сервере (VPS), например https://terra3d.ru
#   SERVER_DOMAIN — свой домен (необязательно); если его нет или он ещё не указывает на сервер —
#   бесплатный адрес https://<IP-через-дефисы>.sslip.io (работает сразу, домен покупать не нужно)
#   VPS_HOST      — IP-адрес сервера
# Ничего не печатает, если VPS не настроен.
set -euo pipefail

clean() { printf '%s' "$1" | tr -d '[:space:]' | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#[/:].*$##'; }
ip="$(clean "${VPS_HOST:-}")"
domain="$(clean "${SERVER_DOMAIN:-}")"
[ -n "$ip" ] || exit 0

is_ip=0
if printf '%s' "$ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then is_ip=1; fi
sslip=""
if [ "$is_ip" = 1 ]; then sslip="${ip//./-}.sslip.io"; fi

host=""
if [ -n "$domain" ]; then
  if ! printf '%s' "$domain" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'; then
    echo "::warning title=Неверный SERVER_DOMAIN::«${domain}» не похож на домен — использую ${sslip:-$ip}" >&2
  elif [ "$is_ip" = 1 ] && command -v getent >/dev/null 2>&1 && ! getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | grep -qx "$ip"; then
    echo "::warning title=Домен ещё не настроен::${domain} не указывает на ${ip} (нужна A-запись в DNS; после покупки домена это может занять до суток). Пока использую ${sslip}" >&2
  else
    host="$domain"
  fi
fi
[ -n "$host" ] || host="${sslip:-$ip}"
printf 'https://%s\n' "$host"

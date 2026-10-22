# Подключение к VPS по SSH (подключается из deploy.sh и migrate.sh через «source»).
#   VPS_HOST      IP-адрес сервера
#   VPS_PASSWORD  пароль root (его присылает хостинг)  — или —
#   VPS_SSH_KEY   закрытый SSH-ключ (если хостинг выдал доступ по ключу)
#   VPS_USER      (необязательно) пользователь, по умолчанию root
#   VPS_PORT      (необязательно) порт SSH, по умолчанию 22

VPS_HOST="$(printf '%s' "${VPS_HOST:-}" | tr -d '[:space:]')"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
SSH_OPTS=(-p "$VPS_PORT" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$HOME/.ssh/known_hosts_terra"
          -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o LogLevel=ERROR)
if [ -n "${VPS_SSH_KEY:-}" ]; then
  printf '%s\n' "$VPS_SSH_KEY" | tr -d '\r' > "$HOME/.ssh/terra_vps"
  chmod 600 "$HOME/.ssh/terra_vps"
  SSH_CMD=(ssh -i "$HOME/.ssh/terra_vps" -o BatchMode=yes -o IdentitiesOnly=yes)
elif [ -n "${VPS_PASSWORD:-}" ]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    sudo apt-get update -qq >/dev/null 2>&1 || true
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sshpass >/dev/null
  fi
  export SSHPASS="$VPS_PASSWORD"
  SSH_CMD=(sshpass -e ssh -o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no)
else
  echo "::error title=Нет доступа к серверу::Добавьте секрет VPS_PASSWORD (пароль root от VPS) или VPS_SSH_KEY"
  exit 1
fi
rssh() { "${SSH_CMD[@]}" "${SSH_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" "$@"; }

vps_check_login() {
  local out
  if ! out="$(rssh 'echo terra-ok' 2>&1)" || ! printf '%s' "$out" | grep -q terra-ok; then
    echo "$out"
    echo "::error title=Не удалось войти на сервер::Проверьте секреты VPS_HOST (IP) и VPS_PASSWORD (пароль root). Если хостинг выдал доступ только по ключу — секрет VPS_SSH_KEY."
    exit 1
  fi
  if [ "$VPS_USER" != root ]; then
    echo "::error title=Нужен root::Сценарий настраивает сервер от имени root. Укажите VPS_USER=root (или удалите этот секрет)."
    exit 1
  fi
}

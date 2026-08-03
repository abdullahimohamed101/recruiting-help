#!/usr/bin/env bash
# Idempotent Ubuntu LTS host bootstrap for Phase 7 (VPS foundation).
#
# Safe defaults:
# - Does NOT create cloud provider resources
# - Does NOT run `tailscale up` (requires operator auth)
# - Does NOT write production secrets
#
# Usage (on a fresh x86 Ubuntu LTS VPS as root or with sudo):
#   sudo ./infra/bootstrap/bootstrap-ubuntu.sh
#   sudo DEPLOY_USER=deploy ./infra/bootstrap/bootstrap-ubuntu.sh
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SWAP_SIZE_MB="${SWAP_SIZE_MB:-2048}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"
TAILSCALE_INSTALL="${TAILSCALE_INSTALL:-1}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "error: run as root (sudo)" >&2
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then
  echo "error: /etc/os-release missing" >&2
  exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "error: Ubuntu LTS required (found ID=${ID:-unknown})" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Updating packages"
apt-get update -y
apt-get upgrade -y

echo "==> Installing base packages"
apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  ufw \
  fail2ban \
  unattended-upgrades \
  chrony \
  logrotate \
  jq \
  git \
  htop

echo "==> Ensuring deploy user: ${DEPLOY_USER}"
if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG sudo "${DEPLOY_USER}"

DEPLOY_HOME="$(getent passwd "${DEPLOY_USER}" | cut -d: -f6)"
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_HOME}/.ssh"
AUTH_KEYS="${DEPLOY_HOME}/.ssh/authorized_keys"
if [[ ! -f "${AUTH_KEYS}" ]]; then
  install -m 600 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /dev/null "${AUTH_KEYS}"
  echo "warning: ${AUTH_KEYS} is empty — add your SSH public key before disabling password auth"
fi

echo "==> SSH hardening (PasswordAuthentication no once keys exist)"
SSHD_DROPIN="/etc/ssh/sshd_config.d/99-recruiting-help.conf"
cat >"${SSHD_DROPIN}" <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
X11Forwarding no
AllowTcpForwarding yes
EOF
if [[ ! -s "${AUTH_KEYS}" ]]; then
  echo "warning: skipping ssh reload because authorized_keys is empty"
else
  systemctl reload ssh || systemctl reload sshd || true
fi

echo "==> Firewall default-deny (allow OpenSSH; Tailscale later)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
# Tailscale interface rules are applied after join; keep SSH available for recovery.
ufw --force enable

echo "==> Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    ${VERSION_CODENAME} stable" >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker "${DEPLOY_USER}"
systemctl enable --now docker

echo "==> Swap (${SWAP_SIZE_MB} MB) with conservative swappiness"
if ! swapon --show | grep -q "${SWAP_FILE}"; then
  if [[ ! -f "${SWAP_FILE}" ]]; then
    fallocate -l "${SWAP_SIZE_MB}M" "${SWAP_FILE}" || dd if=/dev/zero of="${SWAP_FILE}" bs=1M count="${SWAP_SIZE_MB}"
    chmod 600 "${SWAP_FILE}"
    mkswap "${SWAP_FILE}"
  fi
  swapon "${SWAP_FILE}"
fi
if ! grep -q "^${SWAP_FILE} " /etc/fstab; then
  echo "${SWAP_FILE} none swap sw 0 0" >>/etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
if ! grep -q '^vm.swappiness=' /etc/sysctl.d/99-recruiting-help.conf 2>/dev/null; then
  echo 'vm.swappiness=10' >/etc/sysctl.d/99-recruiting-help.conf
fi

echo "==> Time sync + unattended upgrades"
systemctl enable --now chrony
dpkg-reconfigure -f noninteractive unattended-upgrades || true

if [[ "${TAILSCALE_INSTALL}" == "1" ]]; then
  echo "==> Installing Tailscale package (does NOT authenticate)"
  if ! command -v tailscale >/dev/null 2>&1; then
    curl -fsSL https://tailscale.com/install.sh | sh
  fi
  echo
  echo "NEXT (operator): authenticate Tailscale, then preferably restrict SSH to Tailscale:"
  echo "  sudo tailscale up"
  echo "  # after confirming Tailscale SSH/access works:"
  echo "  # sudo ufw delete allow OpenSSH && sudo ufw allow in on tailscale0"
fi

install -d -m 755 /opt/recruiting-help
echo
echo "Bootstrap complete."
echo "Clone the repo to /opt/recruiting-help as ${DEPLOY_USER}, copy infra/env.example -> .env.production (mode 0600),"
echo "then follow docs/vps-foundation.md. Stop for approval before any paid/provider write."

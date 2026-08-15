# Nearventure — one-shot VPS preparation (run once on a fresh Ubuntu 22.04).
# Installs Docker + compose, grows swap to 4 GB (GraphHopper needs headroom),
# and opens host firewall ports 80/443 plus SSH ($SSH_PORT, default 22).
# Idempotent-ish; safe to re-run.
#
# Usage:  bash scripts/deploy/prepare-server.sh
set -euo pipefail

echo "==> [1/4] Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
  echo "  docker installed (log out/in to use docker without sudo, or use 'sudo docker')"
else
  echo "  docker already present: $(docker --version)"
fi
docker compose version >/dev/null 2>&1 || {
  echo "  installing compose plugin…"
  sudo apt-get update -qq && sudo apt-get install -y -qq docker-compose-plugin
}

echo "==> [2/4] Swap → 4 GB (GraphHopper -Xmx1500m + db + app need the cushion)"
CURRENT_KB=$(grep SwapTotal /proc/meminfo | awk '{print $2}')
if [ "${CURRENT_KB:-0}" -lt 3800000 ]; then
  # Reuse an existing swapfile if present, otherwise create the standard one.
  if sudo test -f /swapfile2; then SWP=/swapfile2; else SWP=/swapfile; fi
  sudo swapoff "$SWP" 2>/dev/null || true
  sudo fallocate -l 4G "$SWP"
  sudo chmod 600 "$SWP"
  sudo mkswap "$SWP" >/dev/null
  sudo swapon "$SWP"
  grep -q "$SWP" /etc/fstab || echo "$SWP none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
  echo "  swap grown to 4 GB"
else
  echo "  swap already ≥ 4 GB"
fi

echo "==> [3/4] Host firewall (ufw) — 80/443 + SSH"
SSH_PORT="${SSH_PORT:-22}"
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 80/tcp comment "HTTP (Let's Encrypt + redirect)"
  sudo ufw allow 443/tcp comment 'HTTPS (Nearventure)'
  sudo ufw allow "${SSH_PORT}"/tcp comment 'SSH'
  sudo ufw --force enable 2>/dev/null || true
  echo "  ufw status:"; sudo ufw status | sed 's/^/    /'
else
  echo "  ufw not installed — skipping (your cloud firewall handles ports)"
fi

echo "==> [4/4] Done."
echo "  NOTE: you must ALSO open 80 + 443 in your cloud provider's firewall."
echo "  SSH (${SSH_PORT}) is already open."

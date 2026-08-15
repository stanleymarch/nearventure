#!/usr/bin/env bash
# Obtain the first Let's Encrypt certificate for the Nearventure prod stack.
#
# Flow (run ONCE, on a fresh VPS, after `docker compose up -d`):
#   1. Plant a temporary self-signed cert so nginx can boot with the HTTPS block.
#   2. Start nginx.
#   3. certbot certonly --webroot → real certificate (validates via :80).
#   4. Reload nginx so it serves the real cert.
#   certbot (separate container) then renews every 12h automatically.
#
# Usage:  DOMAIN=… LETSENCRYPT_EMAIL=… bash scripts/deploy/init-letsencrypt.sh
# Run from the repo root on the VPS. Reads DOMAIN/EMAIL from .env.prod if unset.

set -euo pipefail

# Load .env.prod if present (so DOMAIN/EMAIL come from there).
if [ -f .env.prod ]; then set -a; . ./.env.prod; set +a; fi

: "${DOMAIN:?DOMAIN is required (set it in .env.prod)}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL is required (set it in .env.prod)}"
COMPOSE="docker compose --env-file .env.prod -f docker/docker-compose.prod.yml"

RSA_KEY=${RSA_KEY_SIZE:-2048}

echo "==> First-time TLS setup for ${DOMAIN}"

echo "==> 1/4  Planting temporary self-signed certificate (lets nginx boot)…"
# Create the expected dir layout on the certbot_conf volume and drop a dummy cert.
${COMPOSE} run --rm --entrypoint "/bin/sh" certbot -c "
  set -e
  mkdir -p /etc/letsencrypt/live/${DOMAIN}
  if [ ! -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ]; then
    openssl req -x509 -nodes -newkey rsa:${RSA_KEY} -days 1 \
      -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem \
      -out    /etc/letsencrypt/live/${DOMAIN}/fullchain.pem \
      -subj '/CN=localhost' >/dev/null 2>&1
    echo '  dummy cert created'
  else
    echo '  existing cert found — keeping it'
  fi
"

echo "==> 2/4  (Re)starting nginx with the dummy cert…"
${COMPOSE} up -d --force-recreate nginx
sleep 3

echo "==> 3/4  Requesting the real Let's Encrypt certificate…"
# Note: www subdomain omitted unless it has its own DNS A record (NXDOMAIN would
# fail the whole issuance). Add -d "www.${DOMAIN}" only if www DNS is configured.
${COMPOSE} run --rm --entrypoint "certbot" certbot \
  certonly --webroot -w /var/www/certbot \
  --email "${LETSENCRYPT_EMAIL}" \
  -d "${DOMAIN}" \
  --rsa-key-size ${RSA_KEY} \
  --agree-tos --no-eff-email \
  --non-interactive \
  --keep-until-expiring

echo "==> 4/4  Reloading nginx to serve the real certificate…"
${COMPOSE} exec nginx nginx -s reload

echo
echo "✅ HTTPS ready: https://${DOMAIN}"
echo "   Renewals run automatically (certbot container, every 12h)."

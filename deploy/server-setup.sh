#!/usr/bin/env bash
# Ilmak: one-machine install for Oracle Linux 9 (Riyadh region). Postgres + Redis + API + web behind Caddy.
# Idempotent: safe to run again to redeploy. Run as root.
#
#   curl -fsSL https://raw.githubusercontent.com/khalid-karar/edu360/<BRANCH>/deploy/oracle/bootstrap.sh | BRANCH=<BRANCH> bash
#
# Options (environment):
#   BRANCH       git branch to deploy (default main)
#   DOMAIN       real domain pointing at this machine; default <ip>.sslip.io (works with no domain)
#   AUTO_UPDATE  1 = every 5 minutes pull BRANCH and redeploy (default 1 while providers are mocks; set 0 before real users)
#
# Secrets are generated here, kept in /etc/ilmak/api.env (root:ilmak, mode 0640) and never printed or committed.
set -Eeuo pipefail
cd /tmp
export HOME="${HOME:-/root}"
BRANCH="${BRANCH:-main}"
AUTO_UPDATE="${AUTO_UPDATE:-1}"
REPO="https://github.com/khalid-karar/edu360.git"
APP=/opt/ilmak
ENVF=/etc/ilmak/api.env
LOG=/var/log/ilmak-setup.log
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
exec > >(tee -a "$LOG") 2>&1

# Progress and errors are also published at https://<host>/_setup.txt while this runs, because the first run may happen with no
# SSH access. Long hex strings are masked. The file is removed when the run succeeds.
BEACON="$APP/apps/web/out/_setup.txt"
publish_log() {
  { mkdir -p "$(dirname "$BEACON")" \
    && tail -n 300 "$LOG" | sed -E 's/[0-9a-fA-F]{32,}/[redacted]/g' >"$BEACON.tmp" \
    && mv "$BEACON.tmp" "$BEACON" && chmod a+r "$BEACON"; } 2>/dev/null || true
}
stage() { echo "== $*"; sleep 0.3; publish_log; }
trap 'rc=$?; echo "!! FAILED at line $LINENO (exit $rc)"; sleep 1; publish_log' ERR
stage "$(date -u +%FT%TZ) bootstrap branch=$BRANCH"

case "$(uname -m)" in
  aarch64) CADDY_ARCH=arm64 ;;
  x86_64) CADDY_ARCH=amd64 ;;
  *) echo "unsupported CPU $(uname -m)"; exit 1 ;;
esac

PUBIP="$(curl -fsS -m 10 https://ifconfig.me || curl -fsS -m 10 https://api.ipify.org)"
HOST="${DOMAIN:-${PUBIP//./-}.sslip.io}"
stage "host: $HOST"

stage "packages"
dnf -y install git tar curl openssl >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  dnf -y module reset nodejs >/dev/null || true
  dnf -y module enable nodejs:22 >/dev/null || dnf -y module enable nodejs:20 >/dev/null
  dnf -y install nodejs >/dev/null
fi
command -v npm >/dev/null || dnf -y install npm >/dev/null
node -v

stage "postgresql 16"
if ! command -v postgres >/dev/null && [ ! -x /usr/bin/postgres ]; then
  dnf -y module enable postgresql:16 >/dev/null
  dnf -y install postgresql-server >/dev/null
fi
if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
  postgresql-setup --initdb
fi
# Local connections only, password required (scram) even from this machine.
PGHBA=/var/lib/pgsql/data/pg_hba.conf
if ! grep -q "ilmak-managed" "$PGHBA"; then
  cat >"$PGHBA" <<'HBA'
# ilmak-managed: local socket for the postgres OS user only; everything else needs a password over loopback.
local   all   postgres                 peer
host    all   all       127.0.0.1/32   scram-sha-256
host    all   all       ::1/128        scram-sha-256
HBA
fi
sed -i "s/^#\?listen_addresses.*/listen_addresses = '127.0.0.1'/" /var/lib/pgsql/data/postgresql.conf
systemctl enable --now postgresql >/dev/null
systemctl reload postgresql

stage "redis"
command -v redis-server >/dev/null || dnf -y install redis >/dev/null
RCONF=/etc/redis/redis.conf

stage "secrets"
mkdir -p /etc/ilmak
id ilmak >/dev/null 2>&1 || useradd --system --home "$APP" --shell /sbin/nologin ilmak
if [ ! -f "$ENVF" ]; then
  PGPASS="$(openssl rand -hex 24)"
  REDISPASS="$(openssl rand -hex 24)"
  umask 077
  cat >"$ENVF" <<ENV
PORT=3000
NODE_ENV=production
DATABASE_URL=postgres://ilmak:${PGPASS}@127.0.0.1:5432/ilmak
REDIS_URL=redis://:${REDISPASS}@127.0.0.1:6379
# ID_HASH_KEY must never change once real users exist (it enforces one account per national ID). Back this file up.
ID_HASH_KEY=$(openssl rand -hex 32)
MFA_ENC_KEY=$(openssl rand -hex 32)
OTP_KEY=$(openssl rand -hex 32)
PROVIDERS=mock
PAYMENTS=mock
VIDEO=mock
UPLOAD_DIR=/var/lib/ilmak/files
WAITLIST_FILE=/var/lib/ilmak/waitlist.jsonl
ENV
  FIRST_RUN=1
fi
chown root:ilmak "$ENVF"
chmod 0640 "$ENVF"
# Read back what services need (works on first run and on re-runs).
PGPASS="$(sed -n 's#^DATABASE_URL=postgres://ilmak:\([0-9a-f]*\)@.*#\1#p' "$ENVF")"
REDISPASS="$(sed -n 's#^REDIS_URL=redis://:\([0-9a-f]*\)@.*#\1#p' "$ENVF")"

stage "database role and schema"
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='ilmak'" | grep -q 1; then
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 >/dev/null <<SQL
CREATE ROLE ilmak LOGIN PASSWORD '${PGPASS}';
SQL
fi
runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='ilmak'" | grep -q 1 \
  || runuser -u postgres -- createdb -O ilmak ilmak

stage "redis config"
if ! grep -q "ilmak-managed" "$RCONF"; then
  cat >>"$RCONF" <<RCFG

# ilmak-managed (later lines win): loopback only, password, used for rate-limit counters so nothing needs to persist.
bind 127.0.0.1
protected-mode yes
requirepass ${REDISPASS}
save ""
appendonly no
maxmemory 128mb
maxmemory-policy volatile-lru
RCFG
fi
systemctl enable --now redis >/dev/null
systemctl restart redis

stage "caddy"
if ! command -v caddy >/dev/null; then
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v2.8.4/caddy_2.8.4_linux_${CADDY_ARCH}.tar.gz" | tar -xz -C /usr/local/bin caddy
  chmod +x /usr/local/bin/caddy
fi
id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --shell /sbin/nologin caddy
mkdir -p /var/lib/caddy /etc/caddy && chown caddy:caddy /var/lib/caddy

stage "os firewall (80/443 only; also open them in the Oracle network rules)"
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http --add-service=https >/dev/null
  firewall-cmd --reload >/dev/null
else
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT 4 -p tcp --dport 80 -j ACCEPT
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 4 -p tcp --dport 443 -j ACCEPT
fi

stage "code"
git config --global --add safe.directory "$APP"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch --depth 1 origin "$BRANCH" && git -C "$APP" checkout -q -f FETCH_HEAD
else
  rm -rf "$APP"; git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP"
fi
(cd "$APP/apps/api" && npm ci --no-audit --no-fund && npm run build)
(cd "$APP/apps/web" && npm ci --no-audit --no-fund && npm run build)
test -f "$APP/apps/web/out/index.html"
mkdir -p /var/lib/ilmak/files /var/backups/ilmak
chown -R ilmak:ilmak /var/lib/ilmak "$APP"
chown ilmak:ilmak /var/backups/ilmak && chmod 700 /var/backups/ilmak
# Caddy must be able to read the built site.
chmod -R a+rX "$APP/apps/web/out"

stage "services"
cat >/etc/systemd/system/ilmak-api.service <<UNIT
[Unit]
Description=Ilmak API
After=network.target postgresql.service redis.service
Requires=postgresql.service
[Service]
User=ilmak
WorkingDirectory=$APP/apps/api
EnvironmentFile=$ENVF
ExecStart=/usr/bin/node dist/http/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/ilmak
PrivateTmp=true
[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/caddy/Caddyfile <<CADDY
$HOST {
	encode gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy strict-origin-when-cross-origin
		-Server
	}
	@form {
		method POST
		path /thanks
	}
	rewrite @form /api/waitlist
	handle /api/* {
		reverse_proxy 127.0.0.1:3000
	}
	handle {
		root * $APP/apps/web/out
		try_files {path} {path}.html {path}/index.html
		file_server
	}
}
CADDY

cat >/etc/systemd/system/caddy.service <<UNIT
[Unit]
Description=Caddy
After=network-online.target
[Service]
User=caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure
Environment=XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy
[Install]
WantedBy=multi-user.target
UNIT

# Nightly database backup, 14 days kept on this machine. Copy them off the machine too (see deploy/oracle/README.md).
cat >/usr/local/bin/ilmak-backup <<'BAK'
#!/bin/bash
set -euo pipefail
OUT=/var/backups/ilmak/ilmak-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
runuser -u postgres -- pg_dump -d ilmak | gzip > "$OUT"
chown ilmak:ilmak "$OUT"; chmod 600 "$OUT"
find /var/backups/ilmak -name 'ilmak-*.sql.gz' -mtime +14 -delete
BAK
chmod +x /usr/local/bin/ilmak-backup
cat >/etc/systemd/system/ilmak-backup.service <<UNIT
[Unit]
Description=Ilmak database backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/ilmak-backup
UNIT
cat >/etc/systemd/system/ilmak-backup.timer <<UNIT
[Unit]
Description=Ilmak nightly backup
[Timer]
OnCalendar=*-*-* 01:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT

# Optional self-update: pull the branch every 5 minutes and re-run this script. Turn off before real users (AUTO_UPDATE=0).
cat >/usr/local/bin/ilmak-update <<UPD
#!/bin/bash
set -e
export HOME=/root
git config --global --add safe.directory $APP
git -C $APP fetch -q --depth 1 origin $BRANCH
[ "\$(git -C $APP rev-parse FETCH_HEAD)" = "\$(git -C $APP rev-parse HEAD)" ] && exit 0
cp <(git -C $APP show FETCH_HEAD:deploy/oracle/bootstrap.sh) /tmp/ilmak-update.sh
BRANCH=$BRANCH DOMAIN=${DOMAIN:-} AUTO_UPDATE=$AUTO_UPDATE bash /tmp/ilmak-update.sh >> /var/log/ilmak-update.log 2>&1
UPD
chmod +x /usr/local/bin/ilmak-update
cat >/etc/systemd/system/ilmak-update.service <<UNIT
[Unit]
Description=Ilmak self-update
[Service]
Type=oneshot
ExecStart=/usr/local/bin/ilmak-update
TimeoutStartSec=1800
UNIT
cat >/etc/systemd/system/ilmak-update.timer <<UNIT
[Unit]
Description=Ilmak self-update timer
[Timer]
OnBootSec=15min
OnUnitInactiveSec=5min
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now ilmak-backup.timer >/dev/null
if [ "$AUTO_UPDATE" = 1 ]; then systemctl enable --now ilmak-update.timer >/dev/null; else systemctl disable --now ilmak-update.timer >/dev/null 2>&1 || true; fi
systemctl enable --now ilmak-api >/dev/null
systemctl restart ilmak-api
systemctl enable --now caddy >/dev/null
systemctl reload-or-restart caddy

stage "health"
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:3000/api/health && break || sleep 2; done
echo
if [ "${FIRST_RUN:-}" = 1 ]; then
  echo "== FIRST RUN: back up $ENVF somewhere safe and private (it holds the keys that cannot be regenerated)."
fi
trap - ERR
rm -f "$BEACON"
echo "== DONE https://$HOST   (auto-update: $AUTO_UPDATE)"

#!/usr/bin/env bash
# Ilmak test-server bootstrap for Oracle Linux 9 (arm64). Idempotent: safe to re-run to redeploy.
# Usage: BRANCH=deploy/oracle-test bash server-setup.sh
set -euo pipefail
BRANCH="${BRANCH:-main}"
# On failure, publish the (secret-free) log on port 80 so the problem can be read from a browser.
fail() {
  mkdir -p /var/ilmak-fail && cp /var/log/ilmak-setup.log /var/ilmak-fail/log.txt 2>/dev/null || true
  (firewall-cmd --add-service=http >/dev/null 2>&1 || iptables -I INPUT 4 -p tcp --dport 80 -j ACCEPT) || true
  cd /var/ilmak-fail && nohup python3 -m http.server 80 >/dev/null 2>&1 &
}
[ -n "${UPDATE:-}" ] || trap fail ERR
REPO="https://github.com/khalid-karar/edu360.git"
APP=/opt/ilmak
PUBIP="$(curl -fsS -m 10 https://ifconfig.me || curl -fsS -m 10 https://api.ipify.org)"
HOST="${PUBIP//./-}.sslip.io"
echo "== host: $HOST"

echo "== packages"
dnf -y install git tar >/dev/null
git config --global --add safe.directory /opt/ilmak
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  dnf -y module reset nodejs >/dev/null || true
  dnf -y module enable nodejs:22 >/dev/null || dnf -y module enable nodejs:20 >/dev/null
  dnf -y install nodejs >/dev/null
fi
command -v npm >/dev/null || dnf -y install npm >/dev/null
command -v npm >/dev/null || { echo "npm missing"; false; }
node -v; npm -v

if ! command -v caddy >/dev/null; then
  echo "== caddy"
  curl -fsSL https://github.com/caddyserver/caddy/releases/download/v2.8.4/caddy_2.8.4_linux_arm64.tar.gz | tar -xz -C /usr/local/bin caddy
  chmod +x /usr/local/bin/caddy
  id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --shell /sbin/nologin caddy
  mkdir -p /var/lib/caddy /etc/caddy && chown caddy:caddy /var/lib/caddy
fi

echo "== os firewall (80/443 only)"
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http --add-service=https >/dev/null
  firewall-cmd --reload >/dev/null
else
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT 4 -p tcp --dport 80 -j ACCEPT
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 4 -p tcp --dport 443 -j ACCEPT
fi

echo "== code"
id ilmak >/dev/null 2>&1 || useradd --system --home "$APP" --shell /sbin/nologin ilmak
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch --depth 1 origin "$BRANCH" && git -C "$APP" checkout -q -f FETCH_HEAD
else
  rm -rf "$APP"; git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP"
fi
cd "$APP/apps/api"
npm ci --no-audit --no-fund
npm run build
cd "$APP/apps/web"
npm ci --no-audit --no-fund
npm run build
test -f "$APP/apps/web/out/index.html"
mkdir -p /var/lib/ilmak && chown -R ilmak:ilmak /var/lib/ilmak "$APP"

echo "== services"
cat >/etc/systemd/system/ilmak-api.service <<UNIT
[Unit]
Description=Ilmak API (test, mock providers)
After=network.target
[Service]
User=ilmak
WorkingDirectory=$APP/apps/api
Environment=PORT=3000 PROVIDERS=mock WAITLIST_FILE=/var/lib/ilmak/waitlist.jsonl
ExecStart=/usr/bin/node dist/http/server.js
Restart=always
NoNewPrivileges=true
ProtectSystem=strict
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

# Self-update: every 5 min, if the branch has new commits, pull and re-run this script (no console access needed).
cat >/usr/local/bin/ilmak-update <<UPD
#!/bin/bash
set -e
cd $APP
git fetch -q --depth 1 origin $BRANCH
[ "\$(git rev-parse FETCH_HEAD)" = "\$(git rev-parse HEAD)" ] && exit 0
git checkout -q -f FETCH_HEAD
cp deploy/server-setup.sh /tmp/ilmak-update.sh
UPDATE=1 BRANCH=$BRANCH bash /tmp/ilmak-update.sh >> /var/log/ilmak-update.log 2>&1
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
systemctl enable --now ilmak-update.timer >/dev/null
systemctl enable --now ilmak-api >/dev/null
systemctl restart ilmak-api
systemctl enable --now caddy >/dev/null
systemctl reload-or-restart caddy
sleep 3
curl -fsS http://127.0.0.1:3000/api/health && echo
echo "== DONE https://$HOST"

#!/usr/bin/env bash
# Ilmak first-server install. Run as: sudo bash install-oracle.sh   (Oracle Linux 9, from the folder holding ilmak-src.tgz and ilmak-storage.env)
# Safe to re-run. Keys are generated ON the server and stay in /etc/ilmak/ilmak.env.
set -euo pipefail
DOMAIN="${DOMAIN:-ilmak.elevantec.sa}"
HERE="$(pwd)"
[ -f "$HERE/ilmak-src.tgz" ] || { echo "ilmak-src.tgz not found in $HERE"; exit 1; }

echo "== 1/8 packages"
dnf module enable -y postgresql:16 >/dev/null
dnf module enable -y nodejs:22 >/dev/null 2>&1 || true
dnf install -y postgresql-server redis git tar nodejs npm policycoreutils-python-utils firewalld
if ! command -v caddy >/dev/null; then
  dnf install -y 'dnf-command(copr)'
  if dnf copr enable -y @caddy/caddy && dnf install -y caddy; then :; else
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=arm64" -o /usr/bin/caddy && chmod +x /usr/bin/caddy
    id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --shell /sbin/nologin caddy
    mkdir -p /etc/caddy /var/lib/caddy && chown caddy /var/lib/caddy
    cat > /etc/systemd/system/caddy.service <<'U'
[Unit]
Description=Caddy
After=network.target
[Service]
User=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure
[Install]
WantedBy=multi-user.target
U
    systemctl daemon-reload
  fi
fi
node -v | grep -q '^v2[2-9]' || { echo "Node 22+ needed, got $(node -v)"; exit 1; }

echo "== 2/8 firewall"
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=http --add-service=https --add-service=ssh >/dev/null
firewall-cmd --reload >/dev/null

echo "== 3/8 postgres + redis"
[ -f /var/lib/pgsql/data/PG_VERSION ] || postgresql-setup --initdb
sed -i -E 's#^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)\S+#\1scram-sha-256#; s#^(host\s+all\s+all\s+::1/128\s+)\S+#\1scram-sha-256#' /var/lib/pgsql/data/pg_hba.conf
systemctl enable --now postgresql redis
mkdir -p /etc/ilmak
if [ -f /etc/ilmak/ilmak.env ]; then
  echo "existing /etc/ilmak/ilmak.env kept"
  DBPASS="$(grep -oP '^DATABASE_URL=postgres://ilmak:\K[^@]+' /etc/ilmak/ilmak.env)"
else
  DBPASS="$(openssl rand -hex 16)"
fi
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='ilmak'" | grep -q 1 || sudo -u postgres createuser ilmak
sudo -u postgres psql -c "ALTER USER ilmak PASSWORD '$DBPASS'" >/dev/null
sudo -u postgres psql -lqt | cut -d'|' -f1 | grep -qw ilmak || sudo -u postgres createdb -O ilmak ilmak
systemctl restart postgresql

echo "== 4/8 code"
id ilmak >/dev/null 2>&1 || useradd --system --home /opt/ilmak --shell /sbin/nologin ilmak
mkdir -p /opt/ilmak /var/lib/ilmak/uploads
tar -xzf "$HERE/ilmak-src.tgz" -C /opt/ilmak
cd /opt/ilmak/apps/api && npm ci --no-audit --no-fund && npm run build
cd /opt/ilmak/apps/web && npm ci --no-audit --no-fund && npm run build
chown -R ilmak /var/lib/ilmak
chmod -R a+rX /opt/ilmak

echo "== 5/8 config"
if [ ! -f /etc/ilmak/ilmak.env ]; then
  cp /opt/ilmak/deploy/templates/ilmak.env.example /etc/ilmak/ilmak.env
  sed -i "s#CHANGE_ME#$DBPASS#" /etc/ilmak/ilmak.env
  for k in ID_HASH_KEY MFA_ENC_KEY OTP_KEY; do sed -i "s#^$k=.*#$k=$(openssl rand -hex 32)#" /etc/ilmak/ilmak.env; done
  echo "METRICS_TOKEN=$(openssl rand -hex 16)" >> /etc/ilmak/ilmak.env
  if [ -f "$HERE/ilmak-storage.env" ]; then
    # uncomment/set the S3 lines from the storage file
    sed -i '/^#\?S3_\(BUCKET\|ENDPOINT\|REGION\|ACCESS_KEY\|SECRET_KEY\)=/d' /etc/ilmak/ilmak.env
    grep -E '^S3_(BUCKET|ENDPOINT|ACCESS_KEY|SECRET_KEY)=' "$HERE/ilmak-storage.env" >> /etc/ilmak/ilmak.env
    echo "S3_REGION=me-riyadh-1" >> /etc/ilmak/ilmak.env
    echo "S3 settings added"
  fi
fi
chmod 600 /etc/ilmak/ilmak.env; chown root:root /etc/ilmak/ilmak.env
grep -E '^(PROVIDERS|PAYMENTS|VIDEO)=mock$' /etc/ilmak/ilmak.env | wc -l | grep -q 3 || { echo "PROVIDERS/PAYMENTS/VIDEO must stay mock"; exit 1; }

echo "== 6/8 api service"
cp /opt/ilmak/deploy/templates/ilmak-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable ilmak-api
systemctl restart ilmak-api

echo "== 7/8 caddy"
sed "s#app.example.sa#$DOMAIN#" /opt/ilmak/deploy/templates/Caddyfile > /etc/caddy/Caddyfile
setsebool -P httpd_can_network_connect 1 || true
semanage fcontext -a -t httpd_sys_content_t '/opt/ilmak/apps/web/out(/.*)?' 2>/dev/null || true
restorecon -R /opt/ilmak/apps/web/out || true
systemctl enable caddy
systemctl restart caddy

echo "== 8/8 checks"
sleep 6
echo -n "api health: "; curl -fsS http://127.0.0.1:3000/api/health || echo FAILED
echo; echo -n "api ready:  "; curl -fsS http://127.0.0.1:3000/api/ready || echo FAILED
echo; echo -n "https:      "; curl -fsS -o /dev/null -w '%{http_code}\n' "https://$DOMAIN/api/health" || echo "not yet (DNS/cert may need a minute; see: journalctl -u caddy -n 30)"
echo
echo "DONE. Open https://$DOMAIN"
echo "Back up /etc/ilmak/ilmak.env somewhere safe (MFA_ENC_KEY lost = staff authenticators unusable)."

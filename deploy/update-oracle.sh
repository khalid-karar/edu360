#!/usr/bin/env bash
# Ilmak update: new code (email login), LiveKit video, storage test, antivirus, nightly backups.
# Run as: sudo bash update-oracle.sh   from the folder holding ilmak-src.tgz and livekit.env. Safe to re-run.
set -uo pipefail
HERE="$(pwd)"
ENVF=/etc/ilmak/ilmak.env
DOMAIN="${DOMAIN:-ilmak.elevantec.sa}"
[ -f "$HERE/ilmak-src.tgz" ] || { echo "ilmak-src.tgz not found in $HERE"; exit 1; }
[ -f "$ENVF" ] || { echo "$ENVF missing: run install.sh first"; exit 1; }
RESULTS=()
note() { RESULTS+=("$1"); }

setenv() { # setenv KEY VALUE  (replaces any existing or commented line)
  sed -i "/^#\?$1=/d" "$ENVF"
  printf '%s=%s\n' "$1" "$2" >> "$ENVF"
}

echo "== 1/6 new code"
mkdir -p /opt/ilmak
tar -xzf "$HERE/ilmak-src.tgz" -C /opt/ilmak || { echo "extract failed"; exit 1; }
( cd /opt/ilmak/apps/api && npm ci --no-audit --no-fund && npm run build ) || { echo "API build failed"; exit 1; }
( cd /opt/ilmak/apps/web && npm ci --no-audit --no-fund && npm run build ) || { echo "web build failed"; exit 1; }
chmod -R a+rX /opt/ilmak
restorecon -R /opt/ilmak/apps/web/out 2>/dev/null || true
cp /opt/ilmak/deploy/templates/ilmak-api.service /etc/systemd/system/ && systemctl daemon-reload

echo "== 2/6 settings"
cp "$ENVF" "$ENVF.bak-$(date +%s)"
setenv PUBLIC_URL "https://$DOMAIN"
OLDMAIL="$(grep -oP '^MAIL=\K\w+' "$ENVF" || true)"
sed -i '/^MAIL=/d' "$ENVF"   # old name, clashed with the Unix MAIL variable
grep -q '^MAIL_MODE=' "$ENVF" || setenv MAIL_MODE "${OLDMAIL:-mock}"
if [ -f "$HERE/livekit.env" ]; then
  while IFS='=' read -r k v; do
    case "$k" in LIVEKIT_URL|LIVEKIT_API_KEY|LIVEKIT_API_SECRET) setenv "$k" "$v";; esac
  done < "$HERE/livekit.env"
  setenv VIDEO livekit
  note "video: LiveKit settings applied"
fi
if [ -f "$HERE/mail.env" ]; then
  while IFS='=' read -r k v; do
    case "$k" in SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|MAIL_FROM) setenv "$k" "$v";; esac
  done < "$HERE/mail.env"
  setenv MAIL_MODE smtp
  note "email: SMTP settings applied"
fi
chmod 600 "$ENVF"; chown root:root "$ENVF"

echo "== 3/6 antivirus (ClamAV)"
if ! command -v clamd >/dev/null 2>&1 && ! rpm -q clamd >/dev/null 2>&1; then
  dnf install -y oracle-epel-release-el9 >/dev/null 2>&1 || true
  dnf config-manager --set-enabled ol9_developer_EPEL >/dev/null 2>&1 || true
  dnf install -y clamav clamd clamav-update || echo "ClamAV install failed"
fi
if rpm -q clamd >/dev/null 2>&1; then
  sed -i 's/^Example/#Example/' /etc/clamd.d/scan.conf /etc/freshclam.conf
  sed -i 's/^#\?TCPSocket .*/TCPSocket 3310/; s/^#\?TCPAddr .*/TCPAddr 127.0.0.1/' /etc/clamd.d/scan.conf
  grep -q '^TCPSocket' /etc/clamd.d/scan.conf || echo "TCPSocket 3310" >> /etc/clamd.d/scan.conf
  grep -q '^TCPAddr' /etc/clamd.d/scan.conf || echo "TCPAddr 127.0.0.1" >> /etc/clamd.d/scan.conf
  setsebool -P antivirus_can_scan_system 1 2>/dev/null || true
  freshclam || echo "freshclam failed (will retry via its timer)"
  systemctl enable --now clamav-freshclam 2>/dev/null || true
  systemctl enable --now clamd@scan
  for i in $(seq 1 30); do (echo PING | timeout 2 bash -c 'cat > /dev/tcp/127.0.0.1/3310' 2>/dev/null) && break; sleep 4; done
  setenv CLAMD_HOST 127.0.0.1; setenv CLAMD_PORT 3310
  note "antivirus: ClamAV installed, uploads are scanned"
else
  note "antivirus: NOT installed (uploads are not scanned)"
fi

echo "== 4/6 restart api"
systemctl restart ilmak-api
sleep 8
HEALTH="$(curl -fsS http://127.0.0.1:3000/api/ready 2>&1 || echo FAILED)"
note "api ready: $HEALTH"
journalctl -u ilmak-api -n 5 --no-pager | tail -3

echo "== 5/6 storage test (real Object Storage bucket)"
export $(grep -E '^S3_[A-Z_]+=' "$ENVF" | xargs)
( cd /opt/ilmak/apps/api && node dist/cli/storage-check.js ) && note "storage: round trip OK" || note "storage: FAILED (see output above)"

echo "== 6/6 nightly backups"
mkdir -p /var/backups/ilmak && chown postgres:postgres /var/backups/ilmak && chmod 700 /var/backups/ilmak
{
  echo "S3_BUCKET=$S3_BUCKET"; echo "S3_ENDPOINT=$S3_ENDPOINT"; echo "S3_REGION=${S3_REGION:-me-riyadh-1}"
  echo "S3_ACCESS_KEY=$S3_ACCESS_KEY"; echo "S3_SECRET_KEY=$S3_SECRET_KEY"
  echo "OFFSITE_CMD=node /opt/ilmak/apps/api/dist/cli/upload-file.js {file}"
} > /etc/ilmak/backup.env
chmod 600 /etc/ilmak/backup.env
chmod +x /opt/ilmak/deploy/templates/backup.sh /opt/ilmak/deploy/templates/restore.sh
cp /opt/ilmak/deploy/templates/ilmak-backup.service /opt/ilmak/deploy/templates/ilmak-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ilmak-backup.timer
if systemctl start ilmak-backup.service; then
  note "backup: test run OK, copy stored in the bucket under backups/"
else
  note "backup: test run FAILED"; journalctl -u ilmak-backup -n 15 --no-pager
fi
systemctl list-timers ilmak-backup.timer --no-pager | head -3

echo; echo "=========== RESULT ==========="
for r in "${RESULTS[@]}"; do echo " - $r"; done
echo -n "https: "; curl -fsS -o /dev/null -w '%{http_code}\n' "https://$DOMAIN/api/health" || echo "failed"

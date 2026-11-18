# Deploying Ilmak on Oracle Cloud (Riyadh)

This is the checklist for the first real server. It describes what the code supports today; items marked **needs you** depend on accounts, a domain or a decision that only the owner can make. Nothing here has been run on an Oracle machine yet: the scripts in `deploy/templates/` were checked for syntax, and the backup and restore scripts were run against a real PostgreSQL 16.

## 0. Know what is still mock

`PROVIDERS` (Nafath) must stay `mock`: the API refuses to start otherwise. `PAYMENTS` stays `mock` until Moyasar is activated. `VIDEO=livekit` and `MAIL_MODE=smtp` are real and need their values in the env file. Sign-in is by **email code**: with `MAIL=mock` the code is shown on screen and anyone can sign in as anyone, so do not put real customers on a server until `MAIL_MODE=smtp` works. Staff are created with `node dist/cli/create-staff.js --email ... --name ... --role super_admin`.

## 1. Machine and network

- Oracle Cloud region **Saudi Arabia (Riyadh)**, `me-riyadh-1`, so personal data stays in the Kingdom.
- Oracle Linux 9. A small ARM instance (2 OCPU, 12 GB) is enough for a pilot.
- Open only ports 80 and 443 in the security list and in the OS firewall. PostgreSQL (5432), Redis (6379), the API (3000) and ClamAV (3310) listen on `127.0.0.1` only.
- **Needs you:** a domain, with an A record to the server's public IP. Caddy then gets the certificate by itself.

## 2. Software

```
dnf install -y postgresql16-server redis git
# Node 22 (the code is tested on 22), Caddy 2.8+, optionally ClamAV (clamd) for upload scanning
postgresql-setup --initdb && systemctl enable --now postgresql redis
sudo -u postgres createuser ilmak && sudo -u postgres createdb -O ilmak ilmak
sudo -u postgres psql -c "ALTER USER ilmak PASSWORD '...'"
```

Redis is optional with one API process (rate limits and live chat then work in memory) but required as soon as there is more than one.

## 3. Code and configuration

```
git clone --branch <branch> https://github.com/khalid-karar/edu360.git /opt/ilmak
cd /opt/ilmak/apps/api && npm ci && npm run build
cd ../web && npm ci && npm run build        # static site in apps/web/out
useradd --system --home /opt/ilmak --shell /sbin/nologin ilmak
mkdir -p /var/lib/ilmak/uploads /etc/ilmak && chown -R ilmak /var/lib/ilmak
cp deploy/templates/ilmak.env.example /etc/ilmak/ilmak.env && chmod 600 /etc/ilmak/ilmak.env   # then fill it in
cp deploy/templates/ilmak-api.service /etc/systemd/system/ && systemctl enable --now ilmak-api
cp deploy/templates/Caddyfile /etc/caddy/Caddyfile   # set the real domain, then reload Caddy
```

Migrations run when the API starts. Generate each key with `openssl rand -hex 32` and store a copy outside the server. **`MFA_ENC_KEY` lost = every staff authenticator is unusable.** `ID_HASH_KEY` changed = national-ID duplicate checks stop matching.

### Things that fail quietly if missed

- **Uploads folder.** The service runs with `ProtectSystem=strict`, so the API can only write under `/var/lib/ilmak`. `UPLOAD_DIR` must point there (the template does). The older `deploy/server-setup.sh` unit does not set it, and its default folder is read-only for the service, so uploads would answer 500 there. That script was left untouched on purpose.
- **Cookies need https.** `COOKIE_SECURE=true` is the default; sign-in from a browser fails over plain http. This is why the real domain with a certificate comes first.
- **Live chat through Caddy.** `reverse_proxy` upgrades WebSocket connections by itself, so `/api/ws` needs no extra rule. Not yet verified on a real server; if chat only updates every few seconds, the socket is not getting through and the page has fallen back to polling.
- **Client address.** The rate limiter uses the address Caddy forwards. The API must be reachable only through Caddy (port 3000 closed to the outside), or a caller can forge it.
- **Metrics** are off unless `METRICS_TOKEN` is set, and the template Caddyfile hides `/api/metrics` from the internet. Scrape it from the server itself.

## 4. File storage

Two choices:

1. **Local disk** (`UPLOAD_DIR`): fine for a test machine. The files are lost with the machine, so include the folder in backups (the backup script does).
2. **Oracle Object Storage** (recommended before real users): create a **private** bucket in Riyadh, a "Customer Secret Key" for a service user limited to that bucket, and set `S3_BUCKET`, `S3_ENDPOINT` (`https://<namespace>.compat.objectstorage.me-riyadh-1.oraclecloud.com`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Files are never exposed by link; the API reads them after an owner or staff check. Not yet tried against Oracle itself, only against a stand-in S3 server, so test one upload and one download first.

Antivirus: install `clamav-server`, run `clamd` on `127.0.0.1:3310`, set `CLAMD_HOST=127.0.0.1`. When it is set, a file is **refused** if the scanner is down (fail closed). Keep the signature database updating (`freshclam`).

## 5. Backups

```
cp deploy/templates/ilmak-backup.{service,timer} /etc/systemd/system/
systemctl enable --now ilmak-backup.timer
```

Nightly at 02:30 Riyadh: a PostgreSQL dump (checked by listing it) and the uploads folder, kept 14 days. A backup on the same machine does not survive losing the machine, so set `OFFSITE_CMD` in `/etc/ilmak/backup.env` to copy each file to a second bucket (another region or tenancy). Restore into a new database, check it, then switch:

```
deploy/templates/restore.sh /var/backups/ilmak/ilmak-db-XXXX.dump ilmak_check
```

**Test a restore before launch and every quarter.** A backup nobody has restored is a guess.

## 6. Watching it

- `GET /api/health` answers while the process and database are up. `GET /api/ready` also checks Redis and returns 503 with the name of what failed; Caddy uses it for its health check.
- `GET /api/metrics` (bearer `METRICS_TOKEN`): request counts by route pattern and status, latency histogram, open WebSocket connections, uptime. Nothing in it identifies a person.
- Logs: `journalctl -u ilmak-api`. Alerts and a dashboard are not set up.

## 7. Before real users (owner decisions)

Real Nafath and payment accounts, and a working email relay with SPF/DKIM on the sending domain; a lawyer's review of the terms, privacy notice and the schools channel; an independent penetration test; an Arabic child-safety classifier; Terraform or similar so the server can be rebuilt from code; a decision on who is on call.

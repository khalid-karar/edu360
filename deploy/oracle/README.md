# Ilmak on Oracle Cloud (Riyadh): one-machine install

Runs the real backend, not the old mock holding page: PostgreSQL 16, Redis, the API and the built web app behind Caddy (automatic HTTPS), all on one Oracle Linux 9 machine. Payments, SMS, Nafath and video are still the built-in mocks until their accounts exist; the web app is served from the same address as the API, so the real `/portal` screens work.

**Status:** written and the database part is tested (all 10 migrations run as a normal, non-superuser database owner on PostgreSQL 16). The script as a whole has **not yet been run on Oracle Linux 9**. Expect the first run to need one or two fixes; the log is `/var/log/ilmak-setup.log`.

## 1. Create the machine (Oracle Console)

- Region: **Saudi Arabia Central (Riyadh)**.
- Image: **Oracle Linux 9**. Shape: 2 OCPU / 12-16 GB RAM (Ampere A1 Flex or E4/E5 Flex, whichever your account has). Boot volume 100 GB.
- Public subnet with a public IPv4 address. Add your SSH public key.
- Network rules (security list or NSG), ingress: TCP **80** and **443** from anywhere, TCP **22** from your own IP only. Do **not** open 5432 or 6379; the database and Redis listen on the machine itself only.
- Under *Show advanced options > Management > Cloud-init script* paste:

```bash
#!/bin/bash
curl -fsSL https://raw.githubusercontent.com/khalid-karar/edu360/phase10-oracle-deploy/deploy/oracle/bootstrap.sh | BRANCH=phase10-oracle-deploy bash
```

## 2. Wait about 10 minutes, then open

`https://<public-ip-with-dashes>.sslip.io` (for 129.1.2.3 that is `129-1-2-3.sslip.io`). `/api/health` should answer `{"ok":true,...}`.
With a real domain later: point an A record at the IP and re-run the script with `DOMAIN=your.domain`.

## 3. Create the first admin (SSH in)

```bash
cd /opt/ilmak/apps/api
sudo -u ilmak bash -c 'set -a; . /etc/ilmak/api.env; set +a; node dist/cli/create-staff.js --phone +9665XXXXXXXX --name "Full Name" --role super_admin'
```
It prints the authenticator-app setup once. Scan it straight away.

## 4. Save the keys (important)

`/etc/ilmak/api.env` holds `ID_HASH_KEY` and `MFA_ENC_KEY`. **If they are lost, one-account-per-national-ID and every staff login break and cannot be rebuilt.** Copy the file to a private place (password manager). Never commit it.

## What is where

| Thing | Location |
| --- | --- |
| App code | `/opt/ilmak` |
| Secrets and settings | `/etc/ilmak/api.env` (root:ilmak, 0640) |
| Uploaded scans, waitlist | `/var/lib/ilmak` |
| Database backups | `/var/backups/ilmak`, nightly 01:30 UTC, 14 days kept |
| Logs | `journalctl -u ilmak-api`, `/var/log/ilmak-setup.log`, `/var/log/ilmak-update.log` |

## Before real users or real money

1. Set `AUTO_UPDATE=0` and redeploy by hand. The default pulls the branch every 5 minutes, which is fine for a mock-only test box and wrong for live data.
2. Copy backups off the machine (Oracle Object Storage bucket in Riyadh, or Jeddah) and do one restore drill. Backups only on the same disk are not a backup.
3. Move the database to Oracle's managed PostgreSQL (point-in-time recovery) and uploads to Object Storage. The code already has the interface for storage; the database only needs a new `DATABASE_URL`.
4. Switch the providers in `/etc/ilmak/api.env` one at a time as accounts arrive (`PAYMENTS=moyasar`, SMS, Nafath, `VIDEO=livekit`). Only Moyasar and LiveKit have adapters today; SMS and Nafath do not.
5. Penetration test, then a lawyer pass on the PDPL points in `docs/`.

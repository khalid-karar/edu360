# Security self-audit and load test

Done by the development team on the phase 7 branch, before any outside review. It is not a penetration test and does not replace one.

## What was checked, and how it stays checked

| Area | Result | Kept in place by |
|---|---|---|
| Who can reach each route | All 98 non-public routes (count on 2026-11-18) refuse anonymous callers. The table of which role gets past each guard was reviewed by hand against intent (staff routes: one role each; money and bank routes: finance only; banned and suspended users reach only their record, appeals, notifications, data export and deletion). | `test/access-matrix.test.ts` pins the table in `test/access-matrix.json`. A new or changed route fails the test until the table is updated on purpose. |
| Other people's records | A signed-in stranger (learner, teacher or guardian) gets 404 or 403 on every booking route, cannot attach someone else's card hold, book for someone else's child, read or mark others' notifications, or appeal others' strikes. No owner id leaks in the replies. | `test/idor.test.ts` |
| Bad input | No route answers 500 to empty, oversized or wrongly typed bodies, for any role. | `test/access-matrix.test.ts` |
| Test-only routes | `/api/dev/*` and `/api/mock-pay/*` do not exist unless the mock payment provider is wired. | `test/idor.test.ts`, and `PAYMENTS=moyasar` never wires it |
| Browser hardening | `apps/web/public/_headers` sets CSP (no framing, no object, same-origin forms), X-Frame-Options, nosniff, referrer policy, a camera and microphone policy and HSTS. The browser tests run under these headers and fail on any CSP violation or console error. | `e2e/portal.spec.ts` |
| Dependencies | `npm audit --omit=dev`: 0 known vulnerabilities in API and web on 2026-11-06. | Run again before launch |
| Races (real PostgreSQL 16) | 50 learners booking one slot: exactly 1 wins. 20 simultaneous guarantee claims: 1 refund, 1 claim row. Accept, decline and cancel at once: a consistent final state with the card hold released or kept to match. 5 simultaneous payout runs over 60 ready payments: each payment in exactly one payout, no teacher paid twice. | `node dist/dev/load.js` (see below) |

## Load test (real PostgreSQL 16, one small machine, load generator on the same machine)

200 teachers, 1000 learners, 50 parallel clients, mock providers.

| Scenario | Throughput | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| Reads: search, teacher page, slots, my bookings, unread count | about 720 requests/s | 60 ms | 130 ms | 160 ms | 0 of 10,800 |
| Book, pay, accept (3 requests per lesson, 1000 lessons) | about 510 requests/s | 57 ms | 85 ms | 106 ms | 0 of 3,000 |

This shows the code and queries hold up and there is no lock contention at pilot scale. It is not a capacity plan: real traffic, a network between app and database and a smaller server will differ. Re-run on the real server.

Run it: `createdb ilmak_load && DATABASE_URL=postgres://localhost/ilmak_load node dist/dev/load.js` (after `npm run build` in `apps/api`). Env: `TEACHERS`, `LEARNERS`, `CONCURRENCY`, `READ_SECONDS`.

## Added in phases 9 to 14 (self-checked on 2026-11-18)

| Area | Result | Kept in place by |
|---|---|---|
| Session cookie | Sign-in sets an HttpOnly, SameSite=Strict, Secure cookie on `/api` only; scripts in a page cannot read it. A cookie-authenticated change must carry the `x-ilmak-client` header and an allowed Origin (CSRF); bearer tokens are still accepted for non-browser clients. Login returns no token to the web client. | `test/cookie-session.test.ts`, browser test "the session is an HttpOnly cookie" |
| WebSocket | The socket needs a valid session and, with a cookie, an allowed Origin (cross-site hijacking). It carries signals only ("something changed in booking X"); content is fetched over REST, so every read still passes the normal owner check. Connection attempts and sockets per user are capped. A signed-out or banned user's socket is dropped. | `test/realtime.test.ts` |
| Uploads | Type is read from the file's bytes, not the header or name; server-chosen keys; owner-only read; staff reads are audited; size, count and video caps; raw bodies are only parsed after sign-in. With ClamAV configured every file is scanned and refused if the scanner is down. | `test/uploads.test.ts`, `test/storage-scan.test.ts` |
| Object storage | The S3 adapter uses signed requests, path-style addressing, a private bucket and no public links. Only tested against a stand-in S3 server. | `test/storage-scan.test.ts` |
| Schools | A public application form (strict per-address limit) creates nothing but a pending row; only the super admin approves. A school sees counts only, and lesson figures only from 5 families; subjects with fewer than 5 families are folded into "other". A wrong invite code is refused before the one-time code is spent. | `test/schools.test.ts` |
| Reports and exports | A teacher's statement names no learner and is owner-only. The finance CSV is finance-officer-only, each export is written to the audit log, and a text cell starting with `=`, `+`, `-` or `@` is defused so a name cannot run as a spreadsheet formula. | `test/reports.test.ts` |
| Metrics | `/api/metrics` does not exist without `METRICS_TOKEN`, then needs the bearer token (constant-time compare). Labels are route patterns, so ids never appear. | `test/ops.test.ts` |
| Dependencies | `npm audit --omit=dev`: 0 known vulnerabilities in API and web on 2026-11-18. | Run again before launch |

## Not fixed, for a decision or later work

1. **Caddy on the old Oracle test server sends no CSP or X-Frame-Options,** and its systemd unit gives the API no writable upload folder. `deploy/server-setup.sh` was left alone on purpose. The new `deploy/templates/` and `docs/DEPLOY-ORACLE.md` describe the intended setup; the API must stay bound to 127.0.0.1 behind Caddy, because it trusts the forwarded client address.
2. **Without Redis, rate limits are per process** and reset on restart. With `REDIS_URL` they are shared; if Redis drops they fall back to per-process memory rather than failing requests. Redis is not yet installed on any server.
3. **`script-src` keeps `'unsafe-inline'`** because Next's static export needs inline scripts. The session is now an HttpOnly cookie, so an injected script can no longer steal it, but it could still act as the user while the page is open.
4. **Videos are held in memory while saved** (up to `UPLOAD_VIDEO_MAX_BYTES`, 50 MB by default). Per-user caps and rate limits bound it, but many parallel uploads could pressure a small server. Streaming to object storage would remove this.
5. **A school invite code (8 characters from 32) can be guessed only by repeated registration attempts,** which the sign-in limits slow down. A correct guess only attributes a new family to that school; it reveals nothing else. Acceptable for a pilot.
6. **The audit log is append-only by database trigger,** but a database administrator can still disable the trigger. Ship the log off the server for tamper evidence.
7. **Hosting-level controls are not covered:** disk encryption, SSH access, alerting, a tested restore on the real server. The backup and restore scripts were run on a real PostgreSQL 16 but not on Oracle.
8. **An independent penetration test** is still needed before real payments and real children's data go live.

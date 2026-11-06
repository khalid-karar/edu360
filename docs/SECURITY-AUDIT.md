# Security self-audit and load test

Done by the development team on the phase 7 branch, before any outside review. It is not a penetration test and does not replace one.

## What was checked, and how it stays checked

| Area | Result | Kept in place by |
|---|---|---|
| Who can reach each route | All 83 non-public routes refuse anonymous callers. The table of which role gets past each guard was reviewed by hand against intent (staff routes: one role each; money and bank routes: finance only; banned and suspended users reach only their record, appeals, notifications, data export and deletion). | `test/access-matrix.test.ts` pins the table in `test/access-matrix.json`. A new or changed route fails the test until the table is updated on purpose. |
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

## Not fixed, for a decision or later work

1. **Caddy on the Oracle server sends no CSP or X-Frame-Options.** `deploy/server-setup.sh` was left alone on purpose. Add the same header block as `apps/web/public/_headers` when the server is next updated. The API also relies on Caddy overwriting `X-Forwarded-For`; keep the API bound to 127.0.0.1 so nothing can reach it directly.
2. **Rate limits are in memory, per IP, per process.** They reset on restart and do not span two API processes. Sign-in codes are also limited per phone number in the database. Fine for one server; move to the database or a proxy before scaling out.
3. **Session token lives in browser storage.** A script injected into a page could read it. The CSP narrows where scripts load from, but Next's static export needs inline scripts, so `script-src` keeps `'unsafe-inline'`. A later change to HttpOnly cookies would remove this class of risk.
4. **File uploads are a placeholder** (only the file name is recorded). Real storage needs size and type limits, virus scanning and private access links before teachers can upload credentials.
5. **The audit log is append-only by database trigger,** but a database administrator can still disable the trigger. Ship the log off the server for tamper evidence.
6. **Nothing here covers hosting-level controls:** data residency in Saudi Arabia, backup and restore drills, disk encryption, SSH access. Those belong to the server work and the pilot-hardening step.
7. **An independent penetration test** is still needed before real payments and real children's data go live.

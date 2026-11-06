# Ilmak (عِلمك)

An Arabic-first marketplace where verified home-based teachers deliver paid live lessons to learners, with the money held until the lesson happens.

**Status:** phase 1 (domain core) and phase 2a (API foundation) phase 2b (child accounts, availability, search, bookings with the payment hold, Moyasar webhook, chat) and phase 2c (reports, strikes, disputes, refunds, payout runs, safety and finance queues) done. The web app is next. The public site is a coming-soon page with a waitlist.

## What is here

| Path | Contents |
| --- | --- |
| `apps/web` | Next.js site (static coming-soon page on Netlify) |
| `apps/api` | TypeScript API on Fastify and PostgreSQL: domain rules (money, bookings, chat filter, payouts, strikes, vetting), login and staff MFA, Nafath identity, teacher onboarding and vetting, audit log. 110 tests |
| `apps/api/migrations` | PostgreSQL schema as numbered SQL migrations |
| `docs/API.md` | Endpoint reference for the web app |
| `docs/MVP_PLAN.md` | Product plan: scope, roles, workflows, trust and safety, compliance |
| `docs/ARCHITECTURE.md` | Moyasar money flow, Oracle Cloud hosting, build phases, open items for Moyasar |
| `docs/IMAGE_PROMPTS.md` | Prompts used for the page photos |

## How the money works

Learner's card is **authorized** at booking (nothing charged) → teacher accepts → lesson happens → **captured** → 48-hour dispute window → weekly payout. Declines, no-shows and early cancellations are plain voids. Bookings are limited to 10 days ahead because a mada authorization lives 14 days. Details in `docs/ARCHITECTURE.md`.

## Run the tests

No database needed: the API tests run on PostgreSQL inside the test process.

```
cd apps/api
npm install
npm test
npm run typecheck
```

## Run the API

```
cd apps/api
cp .env.example .env        # fill in DATABASE_URL and the two keys (openssl rand -hex 32)
npm run build
npm run migrate              # also runs automatically when the server starts
npm start                    # listens on 127.0.0.1:3000
```

Staff accounts cannot be created through the API. Someone with server access creates the first one, which prints an authenticator setup once:

```
npm run create-staff -- --phone +9665XXXXXXXX --name "Full Name" --role super_admin
```

`PROVIDERS=mock` is the only mode for SMS and Nafath today, and `PAYMENTS=mock` (default) or `PAYMENTS=moyasar` (needs `MOYASAR_SECRET_KEY` and `MOYASAR_WEBHOOK_SECRET`) for payments: the fakes, and the one-time code is returned in the response. The server refuses to start with any other value.

## Next

Next: deploy the test server, verify the payment flow against the Moyasar sandbox (manual and partial capture, refunds), then the web app. See the phase table in `docs/ARCHITECTURE.md`.

## Try it locally (no database, no accounts)

```
cd apps/api && npm install && npm run build && node dist/dev/local.js      # API with demo teachers on port 3000
cd apps/web && npm install && npm run build                                  # static site in out/
```

The sandbox keeps everything in memory, fakes SMS, Nafath and card payments, and prints demo teacher and staff logins. The web app is under `/portal` (login, identity, search, booking, chat, children and approvals, teacher availability and earnings). Staff consoles live at `/portal/staff` (one per role: vetting, safety, finance, super admin; sign in with the staff phone, then the authenticator code printed at startup). The sandbox seeds a pending teacher application, a learner with two paid lessons (one inside the dispute window) and two finance officers, so the first-payout second-approver rule can be exercised. Teacher onboarding is at `/portal/apply` (profile, categories and prices, credentials, code of conduct, IBAN, submit); file upload is a placeholder that records only the file name until object storage is connected. Serve `apps/web/out` behind any static server that forwards `/api/*` to the API (Netlify: a `/api/*` proxy rule to the server).


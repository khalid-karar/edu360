# Ilmak (عِلمك)

An Arabic-first marketplace where verified home-based teachers deliver paid live lessons to learners, with the money held until the lesson happens.

**Status:** phase 1 (domain core) and phase 2a (API foundation) and phase 2b (child accounts, availability, search, bookings with the payment hold, Moyasar webhook, chat) done. Reports, strikes, disputes, payouts and refunds are next. The public site is a coming-soon page with a waitlist.

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

Phase 2c: reports, strikes, disputes, payout runs, refunds, admin queues. Before any real money: verify the payment flow against the Moyasar sandbox (manual capture and partial capture). See the phase table in `docs/ARCHITECTURE.md`.

# Ilmak (عِلمك)

An Arabic-first marketplace where verified home-based teachers deliver paid live lessons to learners, with the money held until the lesson happens.

**Status:** phase 1 (domain core) done. The public site is a coming-soon page with a waitlist.

## What is here

| Path | Contents |
| --- | --- |
| `apps/web` | Next.js site (static coming-soon page on Netlify) |
| `apps/api` | TypeScript domain core: money and commission, booking policy and state machine, Moyasar adapter and webhook checks, chat filter, payout rules, strike policy. 57 unit tests |
| `db/schema.sql` | PostgreSQL schema for the core data objects |
| `docs/MVP_PLAN.md` | Product plan: scope, roles, workflows, trust and safety, compliance |
| `docs/ARCHITECTURE.md` | Moyasar money flow, Oracle Cloud hosting, build phases, open items for Moyasar |
| `docs/IMAGE_PROMPTS.md` | Prompts used for the page photos |

## How the money works

Learner's card is **authorized** at booking (nothing charged) → teacher accepts → lesson happens → **captured** → 48-hour dispute window → weekly payout. Declines, no-shows and early cancellations are plain voids. Bookings are limited to 10 days ahead because a mada authorization lives 14 days. Details in `docs/ARCHITECTURE.md`.

## Run the tests

```
cd apps/api
npm install
npm test
npm run typecheck
```

## Next

Phase 2: HTTP API with PostgreSQL (auth, teacher onboarding and vetting, bookings, payments and webhook endpoint, chat, reports, disputes, admin queues, audit log). See the phase table in `docs/ARCHITECTURE.md`.

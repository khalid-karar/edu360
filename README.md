# Edu360

An Arabic-first marketplace where verified home-based teachers deliver paid live lessons to learners, with the platform holding the money until the lesson happens.

**Status:** planning phase. No application code yet.

## What is here

| Path | Contents |
| --- | --- |
| `docs/MVP_PLAN.md` | Full MVP plan: scope, roles, workflows, trust and safety, payments, compliance, architecture, roadmap, open decisions |
| `db/schema.sql` | First draft of the PostgreSQL schema for the core data objects |

## MVP in one line

Verified home teachers can deliver paid live lessons to learners, safely, with funds held by a SAMA-licensed payment provider until the lesson is delivered and the 48-hour dispute window closes.

## Planned stack

Next.js (Arabic RTL first) · NestJS modular monolith · PostgreSQL + Redis · LiveKit self-hosted video with recordings in Saudi object storage · Nafath identity · licensed PSP marketplace/split-payout API · Saudi-region cloud hosting.

## Next steps

1. Legal opinion on NeLC licensing classification (week 1).
2. Confirm payment provider supports individual teachers as sub-merchants.
3. Resolve the open decisions at the end of `docs/MVP_PLAN.md`.
4. Scaffold the app (`apps/web`, `apps/api`) once the legal gate is passed.

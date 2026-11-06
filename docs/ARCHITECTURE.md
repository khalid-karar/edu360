# Architecture decisions

Decided 2026-11-05. Payment provider: **Moyasar**. Hosting: **Oracle Cloud (OCI), Saudi regions**. Legal clearance for the NeLC and teacher-status questions is treated as done by the owner.

## 1. Money flow with Moyasar (authorize, then capture)

Moyasar supports four payment operations ([payment flows](https://docs.moyasar.com/guides/payment-operations)):

| Operation | Effect |
| --- | --- |
| Authorize (`manual: true` on the source) | Holds the amount on the card without charging |
| Capture | Charges an authorized payment, fully or partially |
| Void | Releases an authorization (voiding a captured payment works only within about 2 hours) |
| Refund | Returns money for a paid or captured payment, fully or partially |

An authorization must be captured within **14 days on mada**, otherwise it expires and the money returns to the cardholder.

**Design that follows from this**

```
Learner pays (authorize) -> teacher accepts -> session happens -> capture -> 48 h dispute window -> payout
                                    |                 |
                                  decline        no-show / cancel
                                    v                 v
                                  void              void (or partial capture)
```

- Nothing is charged until the lesson is actually delivered. Declines, expiries, teacher no-shows and early cancellations are plain **voids** with no refund fees or delays.
- Disputes after capture are handled with **refunds** during the 48-hour window.
- **Booking horizon: at most 10 days ahead.** This leaves 4 days of the 14-day mada window for the session, capture and retries. Enforced in `booking.ts`.
- The browser sends card data straight to Moyasar with the publishable key. The server never sees card numbers.
- Webhooks tell us a payment changed state, but the server **never trusts the payload alone**: it fetches the payment from Moyasar and checks status, amount, currency and the `booking_id` metadata before accepting it.

**Moyasar webhooks** ([reference](https://docs.moyasar.com/api/other/webhooks/webhook-reference)): events include `payment_authorized`, `payment_captured`, `payment_voided`, `payment_refunded`, `payment_paid` and `payment_faild` (spelled that way in their docs). Authenticity is a shared `secret_token` field in the payload; no signature header is documented. Endpoint must return 2xx fast; Moyasar retries up to 5 more times.

### Open items to settle with Moyasar sales (before go-live)

Their marketplace page ([source](https://moyasar.com/en/solutions/platforms-and-marketplaces/)) lists split payments at checkout, sub-merchant onboarding with KYC, and optional payouts to sellers. Full activation is by request, and the page does not mention holding funds.

1. Can **individual teachers** (Freelance Document holders, no commercial registration) be onboarded as sub-merchants, or must payouts go to the platform's account and out by bank transfer?
2. Is it acceptable that **captured funds sit with the platform** for the 48-hour window before payout, or do splits and holds need to happen inside Moyasar?
3. Do **Apple Pay, STC Pay and mada** all support manual capture? (Confirmed for cards and the mada window only.)
4. Partial capture behaviour: is the unused remainder of the authorization released automatically?
5. Fees, settlement timing, payout fees and whether a signed webhook is available.

The code isolates all of this behind the `PaymentProvider` interface, so answers to these questions change one adapter, not the product.

## 2. Hosting on Oracle Cloud

Oracle has public regions in **Jeddah** and **Riyadh** (opened 6 Aug 2024); NEOM is planned ([Oracle announcement](https://www.oracle.com/news/announcement/oracle-strengthens-saudi-arabias-ai-economy-with-opening-of-second-public-cloud-region-2024-08-06)). Oracle presents the pair for data-residency and disaster recovery.

| Piece | OCI service | Notes |
| --- | --- | --- |
| Primary region | Riyadh | Jeddah as disaster-recovery region |
| API and web app | Compute instances running containers (start small, move to OKE if needed) | Behind a load balancer with WAF |
| Database | Managed PostgreSQL, private subnet | Daily backups, point-in-time recovery, cross-region copy to Jeddah |
| Redis | Managed cache or container | Rate limits, slot locks, sessions |
| Video | LiveKit on a dedicated compute instance with a public IP | UDP media ports open; server-side recording |
| Recordings | Object Storage bucket in Riyadh, private | Signed URLs only; retention job deletes at 90 days |
| Secrets | OCI Vault | Moyasar keys, Nafath credentials, JWT keys |
| Infrastructure as code | Terraform | Added once the first environment is up |

The coming-soon site stays on Netlify until launch. **Note:** the waitlist form stores names and contact details on Netlify (outside the Kingdom). Treat that as a PDPL cross-border-transfer item for your lawyer, or move the form to the OCI API once it exists.

## 3. Code layout

```
apps/web        Next.js site (static holding page today; becomes the app)
apps/api        TypeScript API (Fastify + PostgreSQL)
  src/domain      pure business rules: money, bookings, chat filter, payouts, strikes, vetting, IBAN
  src/payments    provider interface, Moyasar adapter, webhook verification
  src/providers   SMS and Nafath interfaces with local fakes
  src/http        app, route guards (roles, MFA), rate limits, routes
  src/services    one-time codes, login sessions, audit log
  src/security    hashing, encryption, TOTP
  src/cli         create-staff (staff accounts are never created through the public API)
  migrations      numbered SQL files, applied in order at start-up or with `npm run migrate`
  test            unit tests plus API tests on a real PostgreSQL (PGlite, in process)
```

Business rules live in pure functions with no framework or database, so they are fast to test and cannot be bypassed by a controller forgetting a check.

## 4. Build phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1. Domain core | Commission, booking policy and state machine, payment adapter and verification, chat filter, payout rules, strike policy, all tested | Done |
| 2a. HTTP API: foundation | PostgreSQL and migrations, login by one-time code, sessions, staff MFA, Nafath identity, teacher onboarding, vetting, categories, audit log | Done |
| 2b. HTTP API: marketplace | Child accounts and guardian approvals, availability, search, bookings with authorize-then-capture, Moyasar webhook, chat with filter | Done (not yet verified against the Moyasar sandbox) |
| 2c. HTTP API: trust and money | Reports, strikes, disputes, payout runs, refunds, admin queues for safety and finance | Done (refunds and payout transfers untested against Moyasar and a real bank) |
| 3. Web app | Arabic RTL learner, guardian, teacher and admin screens (including staff consoles and teacher application) | Done against the local sandbox; real card form and file upload wait on Moyasar and Oracle |
| 4a. Notifications | In-app inbox with bell, reminders, SMS for urgent events | Done (SMS gateway is a mock until a provider is chosen) |
| 4b. Suspension and appeals | Suspending a learner or guardian cancels their lessons; appeal against any strike decided by a second officer; banned users get an appeal-only session | Done |
| 4c. First-lesson guarantee | Full refund of a first lesson inside the dispute window; platform pays the teacher half of the normal net; per-learner and per-teacher caps | Done |
| 4d. Data rights | PDPL export and erasure with cooling-off; legally required records kept and anonymised | Done |
| 5a. Lesson room | Room tickets, entry window, attendance log used as evidence for no-shows and disputes, in-room whiteboard | Built against a mock; real LiveKit not yet tried |
| 5b. Recording and identity | Opt-in recording (mandatory for minors) via LiveKit egress; Nafath integration (needs an integrator contract and credentials) | Not started |
| 5. Pilot hardening | Penetration test, load test, backups restore drill, policies published | Before pilot |

Integrations that need outside contracts (Nafath, Moyasar activation, SMS gateway) are built against interfaces with local fakes, so development does not wait on them.

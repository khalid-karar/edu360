# Education Marketplace — MVP Plan

Planning document, 2026-11-05. Not legal advice: every compliance item must be confirmed with a Saudi lawyer before go-live.

## 1. The idea and who it serves

A Saudi, Arabic-first marketplace where anyone with a teachable skill (school subjects, Quran and tajweed, languages, arts, crafts, cooking, tech) teaches paying learners online, verified, paid safely, and protected by the platform.

**Core thesis:** many capable people are outside the workforce or under-earning (homemakers, retirees, graduates waiting for jobs, people with disabilities, people in smaller cities). They have skills others will pay for but no safe, legal, trusted channel. The platform is that channel.

| Who | What they get |
| --- | --- |
| Home-based teacher | Income from home on their own schedule; verified profile that builds reputation; guaranteed payment; legal cover through the Freelance Document; zero setup cost |
| Learner / parent | Verified teachers; recorded and monitored sessions; pay only for lessons delivered; refunds and dispute handling; Arabic-first experience |
| Female learners and teachers | Women-teach-women by default |
| The Kingdom | Female labor participation and Saudization (Vision 2030); formalizing the informal private-tutoring market |

**Positioning:** a trusted, regulated way for people at home to become productive earners. Trust is the product; the marketplace is the delivery mechanism.

## 2. MVP scope

Launch wedge: 3–4 categories, e.g. Quran and tajweed, English conversation, school math/science, one arts or skills category.

| In v1 | Out of v1 |
| --- | --- |
| Web app (mobile-responsive), Arabic RTL + English | Native iOS/Android apps (v2) |
| Teacher onboarding with Nafath + Freelance Document check | Recorded course store |
| Teacher profiles, categories, search, filters | AI matching and recommendations |
| Booking 1:1 live sessions | Group classes (v1.5) |
| In-platform recorded video classroom | In-person sessions (never at MVP) |
| Moderated in-platform chat, no contact sharing | Subscriptions and bundles |
| Held payments, released after session | Payouts to wallets other than IBAN |
| Reviews from verified bookings only | Certificates, B2B training |
| Guardian accounts for under-18 learners | Referral / affiliate |
| Reports, disputes, refunds | Advanced analytics |
| Admin console: vetting, moderation, payouts, disputes | |

Rule: anything touching trust or money is in v1; anything that only adds convenience waits.

## 3. Roles and permissions

| Role | Can do | Cannot do |
| --- | --- | --- |
| Learner (18+) | Search, book, pay, attend, chat with booked teachers, review, report | See teacher's contact or ID; pay outside the platform |
| Guardian | Create and control child accounts, book and pay, see all child chats and recordings, approve each new teacher | |
| Minor learner | Attend sessions and chat under a guardian account | Book or pay alone; chat with unapproved teachers |
| Teacher | Manage profile, availability, prices (within bands), teach, chat with booked learners, view earnings, request payout | See learner contact data; message unbooked learners; teach outside approved categories |
| Vetting officer | Review ID, credentials, interview, approve/reject | Release payouts |
| Trust & Safety officer | Review reports, recordings, flags; warn, suspend, ban; refer to authorities | Change payouts or prices |
| Finance officer | Approve payouts, issue refunds, reconcile with PSP, VAT | Approve teachers or close safety cases |
| Super admin | Configure categories, fees, policies; read audit log | Delete audit logs |

Every admin action writes to an immutable audit log.

## 4. Teacher workflow

Sign-up to first paid lesson: about 3–5 working days.

**Onboarding**

1. Sign up with mobile OTP, verify identity through Nafath (data pulled from the government record).
2. Legal status: Freelance Document number, or guided to issue it on freelance.sa; employer no-objection where required.
3. Choose up to 3 categories and upload proof for each (degree, ijazah, certificate, portfolio, sample video).
4. Profile: real photo (face-matched), bio, languages, intro video (60–90 s).
5. E-sign the Teacher Code of Conduct (versioned).
6. Video interview and 15-minute demo lesson, scored on a rubric.
7. Decision: approved, rejected (re-apply after 90 days), or approved with conditions.
8. Payout setup: Saudi IBAN in the teacher's own name, matched to the Nafath record.

**Daily operation**

1. Set weekly availability and price within the category band.
2. Accept or decline booking requests within 12 hours.
3. Chat with the learner inside the platform.
4. Teach in the recorded in-platform classroom.
5. Add a short lesson note and optional homework.
6. Funds go held → available 48 h after the session if no dispute; weekly payout to IBAN.
7. Reputation grows through reviews, completion rate and response time.

**Probation:** the first 10 sessions are spot-checked by Trust & Safety.

## 5. Learner and guardian workflow

**Adult learner:** sign up (mobile OTP) → browse and filter (category, price, rating, teacher gender, language) → view profile → book and pay (mada, Apple Pay, STC Pay, cards; funds held) → chat in-platform → join classroom from the booking page → confirm, review or report within 48 h → rebook.

**Guardian with child:** guardian verifies via Nafath (mandatory) → adds child profiles → searches and books (default: same-gender teachers approved for minors) → approves each new teacher before chat opens → sees every message and recording → child chat limited to lesson text, no files or images → optional silent join → receives a lesson note after each session.

## 6. Admin workflow

| Queue | Trigger | Target time | Actions |
| --- | --- | --- | --- |
| Vetting | Teacher completes onboarding steps 1–5 | 3 working days | Check documents, interview, score, decide |
| Trust & Safety | Report, AI flag, guardian complaint | 24 h (child-related: 2 h) | Review evidence, warn, suspend, ban, freeze payouts, refer to authorities |
| Disputes | Report within 48 h of session | 3 working days | Review recording and chat; full refund, partial refund or release |
| Payouts | Weekly run | Weekly | Review flagged payouts, approve, reconcile |

Daily routine: clear child-safety flags first; work vetting; resolve disputes; review a 5% random sample of recordings; check the off-platform-leakage dashboard.

KPIs: teachers pending vetting, approval rate, sessions/day, no-show rate, dispute rate (target under 3%), refund rate, reports per 100 sessions, GMV, take rate, time-to-payout.

## 7. Trust and safety

Five layers: (1) real identity, (2) everything stays inside the platform, (3) money is held, (4) everything is recorded, (5) detection and enforcement.

| Threat | Controls |
| --- | --- |
| Fake teacher or credentials | Nafath, face match, document review, live interview, probation |
| Off-platform leakage | Filters for numbers, emails, handles and links; strike system; declining commission and pack discounts |
| Upfront-payment scam | Held funds; release only after session and 48 h window |
| No-shows | Auto-refund on teacher no-show; reliability score; cancellation policy |
| Child grooming | Guardian-controlled accounts, per-teacher approval, full guardian visibility, no private media, same-gender default, AI flagging, 2 h SLA, permanent ban and referral |
| Cheating services | Prohibited in Terms; keyword flags; repeat ban |
| Prohibited content | Category whitelist, profile review, recording sampling, report button |
| Fake reviews | Reviews only from paid completed sessions; device/IBAN/card link detection |
| Payment fraud | 3-D Secure, velocity limits, payout hold for new teachers |
| Money laundering | Session must happen (recording and attendance); price bands; flag self-dealing patterns |
| Unlicensed practice | Freelance Document check, employer NOC, declaration, revocation |
| Harassment | Either side can end and report instantly; recording review |

**Strikes:** 1 = warning; 2 = 14-day suspension and payout freeze; 3 = permanent ban. Instant permanent ban for sexual or grooming behaviour with minors, fraud, threats or impersonation.

## 8. Payments and money flow

A SAMA-licensed payment provider collects, holds and splits funds; the platform only instructs release or refund. Candidates to evaluate: Moyasar, HyperPay, PayTabs, Tap. Confirm each supports individual teachers as sub-merchants.

- Learner pays full price at booking.
- Status: held → session happens → 48 h dispute window → available → weekly payout.
- Teacher no-show: full refund. Learner cancels over 24 h before: full refund; under 24 h: 50% to teacher.
- New teachers: first payout after 14 days.
- Commission is deducted at split; statements show gross, commission, net.
- ZATCA e-invoicing for every transaction; VAT treatment of lessons to be confirmed with a tax advisor.

## 9. Saudi regulatory checklist

| Area | Requirement | MVP action |
| --- | --- | --- |
| NeLC e-learning licensing | Licenses e-learning institutions and programs; online providers integrate with FutureX | Legal opinion on whether a tutoring marketplace needs an institution license or provider accreditation |
| Teacher legal status (HRSD) | Freelance Document lists private tutoring | Require document number for Saudi teachers; decide policy for non-Saudi residents |
| Government-employed teachers | May be restricted from paid private work | Declaration and employer NOC; legal confirmation |
| Payments (SAMA) | Banks deal only with licensed payment providers | Use licensed PSP marketplace product; never pool funds |
| PDPL | Consent, minimization, breach notification, child data care | Saudi-hosted data, privacy notice, recording consent, retention policy, DPO |
| ZATCA | 15% VAT and e-invoicing | E-invoice on commission; advisor to confirm lesson VAT |
| CR / MISA | CR must include the activity | Add e-learning / online marketplace activity |
| Content and conduct | Anti-cybercrime law, public morals, child protection | Terms, Code of Conduct, authority-referral process |

Sources: [NeLC e-learning regulation](https://nelc.gov.sa/en/regulations-and-standards/elearning-regulation), [NeLC implementing rules](https://nelc.gov.sa/en/regulations-and-standards/elearning-executive-rules), [Freelance Document guide](https://www.wdeftksa.com/sa/guides/freelance), [SAMA rulebook](https://www.rulebook.sama.gov.sa/en/node/4793).

## 10. Technical architecture

| Component | Choice |
| --- | --- |
| Frontend | Next.js, Tailwind, RTL-first, PWA |
| Backend | NestJS modular monolith |
| Data | PostgreSQL, Redis |
| Hosting | Saudi-region cloud (PDPL residency) |
| Video | LiveKit self-hosted, server-side recording to Saudi object storage |
| Identity | Nafath via approved integrator, plus face match |
| Payments | Licensed PSP marketplace / split-payout API |
| Chat | WebSocket in-app chat with moderation pipeline |
| Moderation | Regex rules plus Arabic-capable classifier hosted in KSA |
| Notifications | Saudi SMS gateway, email, in-app |
| Admin | Role-guarded area in the same app |
| Observability | Central logs, append-only audit log, uptime alerts |

Security baseline: MFA for admins, encryption at rest and in transit, role-based access, signed URLs for recordings, penetration test before launch.

## 11. Business model

| Revenue line | MVP proposal |
| --- | --- |
| Commission | 20% on a learner's first 5 sessions with a teacher, 12% after |
| Learner fee | None |
| Teacher onboarding fee | None |
| Featured listings | v2 |
| Packs / subscriptions | v1.5 |
| B2B / government | v2 |

Price bands per category are set by admins after a market scan of current Saudi tutoring prices.

## 12. Build plan

Four phases, each behind a gate: Foundations (weeks 1–3) → Build core (4–11) → Closed pilot (12–15) → Public launch (week 16).

Pilot success criteria:

- [ ] 40 approved teachers, at least half women teaching from home
- [ ] 300+ completed paid sessions
- [ ] Dispute rate under 3%, teacher no-show under 2%
- [ ] Zero unresolved child-safety reports
- [ ] 60%+ of learners book a second session
- [ ] Leakage flags trending down week on week

## 13. Risks and open decisions

| Risk | Mitigation |
| --- | --- |
| NeLC requires an institution license | Legal opinion in week 1 |
| Off-platform leakage | Declining commission, held funds, on-platform reviews, chat filters |
| Child-safety incident | Guardian controls, same-gender default, recordings, 2 h SLA |
| Supply without demand | Cap pilot supply at 40; seed demand via schools and community groups |
| PSP will not onboard individuals | Confirm with 2–3 PSPs early; fallback licensed payout partner |
| Recording consent pushback | Make it an upfront condition; it protects teachers too |

Decisions needed:

- [ ] Launch categories (3–4)
- [ ] Non-Saudi resident teachers at MVP?
- [ ] Cross-gender adult lessons allowed, or same-gender only?
- [ ] Operating entity: current Saudi company or new
- [ ] Brand name
- [ ] Build team: in-house, TelNova, or mix

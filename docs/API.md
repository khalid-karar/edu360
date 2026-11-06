# Ilmak API reference (phase 2a)

All routes are under `/api`. JSON in, JSON out. Errors are `{ "ok": false, "error": "<code>", "details"?: ... }`.
Signed-in calls send `Authorization: Bearer <token>`. Roles in the "Who" column are enforced on the server.
A staff member's session only works for `/auth/*` until they pass `/auth/mfa/verify`.

## Login

| Method and path | Who | What |
| --- | --- | --- |
| `POST /auth/otp/request` `{phone}` | anyone | Sends a 6-digit code to `+9665XXXXXXXX`. Max 3 per phone per 10 min. Mock mode also returns `mock_code`. |
| `POST /auth/otp/verify` `{phone, code, role?, displayName?}` | anyone | Logs in. A new number must also send `role` (`learner`, `guardian` or `teacher`) and `displayName`; without them the answer is `409 registration_required` and the code stays valid. Returns `{token, expiresAt, user, next}` where `next` is `identity`, `mfa` or `null`. |
| `POST /auth/mfa/verify` `{code}` | staff | Accepts the authenticator code and completes the staff session. 5 wrong codes end the session. |
| `GET /auth/me` | signed in | Current user. |
| `POST /auth/logout` | signed in | Ends the session. |

Adult learners are active straight away. Guardians and teachers are `pending` until Nafath verification succeeds. Pending users get `403 identity_required` everywhere except identity routes.

## Identity

| Method and path | Who | What |
| --- | --- | --- |
| `POST /identity/nafath/start` `{nationalId}` | learner, guardian, teacher | Starts Nafath. Returns `{requestId, number}`: the person picks `number` in the Nafath app. One account per national ID (`409 national_id_in_use`). |
| `GET /identity/nafath/status/:requestId` | the same user | `waiting`, `approved`, `rejected` or `expired`. On `approved` the name, gender and birth date come from the government record, the user becomes active. Under 18 gets `403 underage`. |

Mock Nafath: an ID ending in `0` is rejected, ending in `9` is a minor, anything else is an adult. Approval takes 4 seconds.

## Teacher onboarding (role `teacher`, identity verified)

| Method and path | What |
| --- | --- |
| `GET /teacher/me` | Status, profile, categories, credentials, last decision with its reason, and `missing` (what blocks submitting). |
| `PUT /teacher/profile` | `bio` (40+ chars), `languages`, `freelanceDocumentNo`, `introVideoKey`, optional `employerNocKey`. |
| `PUT /teacher/categories` | Up to 3 `{categoryId, priceHalalas}`, each inside the category's price band. |
| `POST /teacher/credentials` | `{categoryId, kind, fileKey}`; kind is `degree`, `ijazah`, `certificate`, `portfolio` or `sample_video`. |
| `POST /teacher/code-of-conduct/sign` | `{version}` must be the current version (shown in `GET /teacher/me`). |
| `PUT /teacher/payout` | `{iban, holderName}`. Valid Saudi IBAN, and the name must match the Nafath name. |
| `POST /teacher/submit` | Moves `draft` to `submitted`, or `409 incomplete` with the missing list. After a rejection, `409 reapply_too_soon` for 90 days. |

Upload keys must look like `uploads/<your user id>/<file>`; anything else is refused. The upload endpoint itself (Oracle Object Storage) comes later.
Editing is locked while the application is `submitted` or `interview`.

## Vetting (role `vetting_officer` only)

| Method and path | What |
| --- | --- |
| `GET /admin/vetting/queue` | Submitted and in-interview applications, oldest first. |
| `GET /admin/vetting/teachers/:id` | Application detail. No national ID, IBAN or mobile is shown. |
| `POST /admin/vetting/credentials/:id/review` | `{verdict: accepted \| rejected}`. |
| `POST /admin/vetting/teachers/:id/interview` | `submitted` to `interview`. |
| `POST /admin/vetting/teachers/:id/decision` | `{decision: approved \| conditional \| rejected, rubric: {knowledge, communication, conduct, tech}, reason?}`. Each score 0 to 5. Approval needs 16 of 20 and at least one accepted credential. `conditional` needs a reason and makes the teacher adults-only. `rejected` needs a reason. Only categories with an accepted credential go live. |

## Catalog and audit

| Method and path | Who | What |
| --- | --- | --- |
| `GET /categories` | anyone | Active categories with price bands. |
| `POST /admin/categories` | super admin | Create a category. |
| `PATCH /admin/categories/:id` | super admin | Change names, band, minors, active. Existing teacher prices are not rewritten. |
| `GET /admin/audit-log?limit=&before=` | super admin | Newest first, 100 max per page. |

Every admin action and every identity, code-of-conduct, IBAN and submission event is written to the audit log in the same transaction as the change. The table refuses updates and deletes.

## Guardian: children and approved teachers (role `guardian`)

| Method and path | What |
| --- | --- |
| `POST /guardian/children` | `{displayName, birthYear, gender}`. Age 4 to 17, at most 6 children. A child has no mobile and no login. |
| `GET /guardian/children` | The guardian's own children only. |
| `POST /guardian/approvals` | `{teacherId, allowCrossGender?}`. The teacher must be live and not adults-only. Posting again changes the cross-gender consent. |
| `GET /guardian/approvals` | Approved teachers. |
| `DELETE /guardian/approvals/:teacherId` | Withdraw. Stops new bookings and the chat for that teacher. |

## Teacher availability (role `teacher`, approved or conditional)

| Method and path | What |
| --- | --- |
| `GET /teacher/availability` | Future windows. |
| `POST /teacher/availability` | `{startsAt, endsAt}`. 15-minute aligned, 60 to 720 minutes, within 60 days, max 100 future windows, no overlaps. |
| `DELETE /teacher/availability/:id` | `409 window_has_bookings` while a live booking sits inside. |

## Search (roles `learner`, `guardian`)

| Method and path | What |
| --- | --- |
| `GET /teachers?categoryId=&language=&gender=&maxPriceHalalas=&childId=&limit=&offset=` | Live teachers with categories, prices, reliability and `nextSlotAt`. With `childId` (guardian only) adults-only teachers and categories closed to minors are hidden and `forChild` shows `sameGender`, `approved`, `crossGenderApproved`. `nextOffset` is null on the last page. |
| `GET /teachers/:id?childId=` | Full public profile. |
| `GET /teachers/:id/slots?limit=` | Open 15-minute-aligned start times inside windows, excluding live bookings. |

No contact, identity or payout data is ever returned.

## Bookings

A lesson is 60 minutes. Bookable from 2 hours to 10 days ahead.

| Method and path | Who | What |
| --- | --- | --- |
| `POST /bookings` | learner, guardian | `{teacherId, categoryId, startsAt, learnerId?}`. `learnerId` is one of the guardian's children. Returns `201 {bookingId, amountHalalas, currency, payBy}` and holds the slot for 15 minutes in `awaiting_payment`. For a child: the teacher must be approved by the guardian, a different-gender teacher needs `allowCrossGender`. |
| `POST /bookings/:id/payment` | payer | `{paymentId}`. The server asks Moyasar: status authorized, SAR, exact amount, `metadata.booking_id` equal to this booking. Then `requested`. Safe to repeat. |
| `GET /bookings`, `GET /bookings/:id` | both sides | The teacher never sees `awaiting_payment`. Only the teacher sees commission and net. |
| `POST /bookings/:id/accept`, `/decline` | teacher | Accept opens the lesson room. Decline voids the hold. |
| `POST /bookings/:id/cancel` | either side | Before acceptance: free. After: teacher cancels, learner pays nothing; learner cancels inside 24 hours, teacher gets 50% less commission. |
| `POST /bookings/:id/complete` | teacher | After the lesson ends. Captures the amount; commission 20% for a learner's first 5 lessons with that teacher, 12% after. |
| `POST /bookings/:id/no-show` | teacher or payer | `{absent: learner \| teacher}`, from 15 minutes after the start until 24 hours. Learner absent: paid in full. Teacher absent: void and a reliability penalty. Audited. |

Unpaid holds lapse after 15 minutes. Requests the teacher never answers are declined and the hold released. A sweep runs every minute.

## Chat (per booking)

| Method and path | What |
| --- | --- |
| `POST /bookings/:id/messages` | `{body}` up to 1000 characters, 30 per minute. Phone numbers, emails, links and handles are refused with `422 message_blocked`; the attempt is stored and flagged (severity 4 for a teacher writing to a child, or three repeats in a day). Open while `requested` or `confirmed`, and 7 days after the lesson. For a child's booking the teacher must still be approved. |
| `GET /bookings/:id/messages?after=` | Delivered messages only. |

## Moyasar webhook

`POST /api/webhooks/moyasar` with the shared `secret_token` in the body (`503` when `MOYASAR_WEBHOOK_SECRET` is not set, `401` for a wrong token, `400` for an unknown or malformed event). Nothing in the body is trusted: the payment is fetched from Moyasar and checked the same way as `/bookings/:id/payment`. The webhook and the client may both report the same payment. Other events only bring our payment record in line with Moyasar.

## Trust: reports, disputes, reviews, own record (learner, guardian, teacher)

| Method and path | What |
| --- | --- |
| `POST /reports` | `{bookingId, category: conduct \| safety \| no_show \| payment \| other, reason}` (10 to 1000 chars). The reported person is the other party of that booking. One open report per booking, 5 per day. |
| `GET /reports/mine` | Status only. |
| `POST /bookings/:id/dispute` | Payer only, `{reason}`, within 48 hours of the charge, completed or learner-no-show bookings. Stops the payout until finance decides. |
| `GET /bookings/:id/dispute` | Either side: `open` or `decided`, outcome and refund amount. |
| `POST /bookings/:id/review` | Payer only, `{rating 1-5, comment?}`, once, within 30 days, completed lessons. The comment goes through the chat filter. Teacher profiles show `rating {average, count}`. |
| `GET /account/strikes` | Own strikes and suspension, also while suspended. |
| `GET /teacher/earnings` | Held in the dispute window, available for the next run, in a payout, paid, whether payouts are frozen, and recent payouts. Works while suspended. |

## Safety (role `safety_officer` only)

| Method and path | What |
| --- | --- |
| `GET /admin/safety/queue` | Open reports (safety category first, then oldest) and open rule flags (highest severity first). |
| `GET /admin/safety/reports/:id` | Report, the last 50 messages of the booking including blocked ones, prior strikes. Reading is audited. |
| `POST /admin/safety/reports/:id/claim`, `/resolve` | `resolve` takes `{outcome: resolved \| dismissed, note}` and only the officer who claimed it can resolve. |
| `GET /admin/safety/flags/:id`, `POST .../review` | The flagged message with sender role and whether the lesson is a child's. `review` takes `{outcome: confirmed \| dismissed, note}`. |
| `POST /admin/safety/users/:id/strike` | `{reason, zeroTolerance?, reportId?}`. Applies the ladder from strikes in the last 12 months: warning, 14-day suspension, ban. Zero tolerance is an instant ban. A suspended or banned teacher leaves search, payouts freeze, and every upcoming lesson is cancelled with the hold released. Suspensions end by themselves after 14 days; bans do not. Staff and children cannot be struck. |
| `GET /admin/safety/users/:id/strikes` | History. |

## Finance (role `finance_officer` only)

| Method and path | What |
| --- | --- |
| `GET /admin/finance/disputes?status=open\|decided`, `GET .../:id` | Dispute with booking and payment figures. |
| `POST /admin/finance/disputes/:id/decide` | `{outcome: full_refund \| partial_refund \| release_to_teacher, refundHalalas? (partial only), note}`. The provider refunds first and the call is safe to retry. The teacher's commission is recomputed on what was kept. Refused with `already_paid_out` once the money has left. |
| `GET /admin/finance/payout-runs/preview` | What a run would pay and why other payments are skipped. |
| `POST /admin/finance/payout-runs` | Creates one payout per teacher for payments past the 48-hour window. Skips disputed payments, frozen teachers, and a new teacher's first 14 days. A teacher's first payout is `pending` and needs a different finance officer to approve it; later ones are approved by the run. Runs never overlap. |
| `GET /admin/finance/payouts?status=`, `GET .../:id` | The detail shows the full IBAN and holder name; each read is audited. |
| `POST /admin/finance/payouts/:id/approve`, `/hold`, `/mark-paid`, `/fail` | `mark-paid` takes the bank reference (transfers are made outside the system for now). `fail` releases the payments for the next run. |

## Suspension cascade and appeals

A suspension or ban (strike 2, strike 3 or zero tolerance) cancels every upcoming lesson of the person: a teacher's students and a learner's or guardian's teachers. Holds are voided, the other side is notified, nothing is charged. A warning changes nothing.

A banned person can still sign in, but the session (`next: "appeal"`) only opens `GET /api/auth/me`, `GET /api/account/strikes`, `POST /api/appeals`, notifications and sign-out; every other route answers `account_banned`.

`GET /api/account/strikes` lists own strikes with `id`, `voided`, `appealStatus` (`open | upheld | reversed | null`) and `canAppeal`.
`POST /api/appeals` `{ strikeId, reason (20-2000 chars) }`: one appeal per strike, within 30 days of issue (`appeal_exists`, `appeal_window_closed`, `strike_already_voided`). Safety officers are notified.

Safety officers: `GET /api/admin/safety/appeals?status=open|upheld|reversed`, `GET /api/admin/safety/appeals/:id` (audited), `POST /api/admin/safety/appeals/:id/decide` `{ outcome: "upheld" | "reversed", note (10+ chars) }`. The officer who issued the strike cannot decide it (`cannot_decide_own_strike`). `reversed` voids the strike: it stops counting toward the ladder (the next strike is a warning again) and, if no other live ban or suspension remains, the account (and a teacher's profile and payouts) is restored. Lessons already cancelled stay cancelled. The person is notified either way.

## First-lesson guarantee (learner or guardian who booked)

A learner's first completed lesson with a teacher can be refunded in full, no questions asked, while the 48h dispute window is open.

- `GET /bookings/:id/guarantee` (participants) returns `{eligible, reason?, until?}`.
- `POST /bookings/:id/guarantee {why}` (booker only; `why` is `not_a_good_fit|teacher_unprepared|teaching_style|technical|other`) refunds provider-first and returns `{refundedHalalas, booking}`. Error `guarantee_unavailable` carries `details.reason`.
- Eligible when: booking completed, payment captured, not paid out, window open, no dispute on the booking, no earlier completed lesson with this teacher, learner used fewer than 3 guarantees (`GUARANTEE_MAX_PER_LEARNER`), teacher has fewer than 5 claims in 30 days (`GUARANTEE_TEACHER_MONTHLY_CAP`).
- Accounting: commission is 0, and the platform pays the teacher half of the normal net (`platform_credit_halalas`). Net = captured - refunded - commission + credit. Payout runs and teacher earnings include these rows.
- A claim writes a `disputes` row with `kind='guarantee'`, `outcome='full_refund'`, no decider. The finance disputes list exposes `kind`. The booking view payment includes `refundedHalalas` (and `platformCreditHalalas` for the teacher). Both sides are notified (`guarantee_claimed`) and an audit entry is written.

## Data rights (any signed-in user, including suspended, banned and unverified)

- `GET /account/export` returns the caller's own data as JSON (account, identity, teacher profile with IBAN, children, bookings, payments, payouts, messages, reviews, reports filed, strikes, appeals, notifications, recent sign-ins). Other parties appear by display name only; the national-ID hash, reporters' identities and staff notes are excluded. Limited to 3 per day (`export_limit`), each audited.
- `GET /account/deletion` returns `{requested, dueAt?, blockedReasons?}`.
- `POST /account/deletion {confirm:true}` starts a 14-day cooling-off (`DELETION_COOLING_DAYS`) and sends an SMS-flagged notice. Refused with `deletion_blocked` (`details.reasons`) while there are upcoming bookings, an open dispute, unsettled money (teacher not yet paid out, payer card hold) or an open safety report. Staff accounts get `staff_cannot_self_delete`.
- `DELETE /account/deletion` cancels during the cooling-off.
- A sweep (every minute) erases due requests, or records why it postponed. Erasure blanks name, email, birth year, mobile (placeholder), identity, bank details, bio, availability, credential files, notifications and message bodies; delists teachers; erases a guardian's children too; revokes sessions. Kept: bookings, payments, payouts, disputes, strikes, appeals, reports, audit log, flagged messages (evidence), star ratings, and, for banned people, the hashed national ID. Audited as `account.erased`.

## Notifications (any signed-in user, including suspended or unverified)

`GET /api/notifications?limit=&unread=` → `{ unread, items: [{ id, kind, title, body, link, read, createdAt }] }` (own only, newest first).
`GET /api/notifications/unread-count` → `{ unread }`. `POST /api/notifications/read` with `{ ids?: uuid[] }` marks those (or all) read; other people's ids are ignored.

Notifications are written in the same transaction as the event they announce. Sent for: new paid request (teacher), accepted / declined / cancelled / expired unpaid / unanswered, lesson completed, no-show report, one-hour reminder (both sides, once), new chat message (one unread per booking), vetting decision, strike, dispute opened and decided, payout updates, report resolved. The text of every notice lives in `src/domain/notifications.ts`. Kinds flagged `sms` are also texted by the sweep (3 attempts, dropped after 6 hours). Strike notices never include the internal reason.

## Test-mode only

`POST /dev/pay {bookingId}` exists only when `PAYMENTS=mock`. It plays the card form: it authorizes a hold for the booking's exact price and attaches it, for the payer only. It is not registered when `PAYMENTS=moyasar`.


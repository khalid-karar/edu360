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

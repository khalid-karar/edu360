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

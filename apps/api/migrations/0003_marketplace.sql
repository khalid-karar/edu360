-- Phase 2b: child accounts, guardian approvals, availability, bookings with a payment hold, webhooks, chat.

-- A booking now waits for the learner's card hold before the teacher sees it.
-- (Not used as a column default here: a new enum value cannot be used in the transaction that adds it.)
ALTER TYPE booking_status ADD VALUE 'awaiting_payment' BEFORE 'requested';

-- Children have no login, so no mobile. A guardian creates them and speaks for them.
ALTER TABLE users ALTER COLUMN mobile DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_mobile_required CHECK (role = 'minor' OR mobile IS NOT NULL);
ALTER TABLE users ADD COLUMN birth_year int CHECK (birth_year BETWEEN 1900 AND 2100);
ALTER TABLE users ADD COLUMN gender text CHECK (gender IN ('female','male'));  -- children: set by the guardian; adults: from Nafath

-- Same-gender teachers are the default for children; a different gender needs this explicit opt-in per teacher.
ALTER TABLE guardian_teacher_approvals ADD COLUMN cross_gender_ok boolean NOT NULL DEFAULT false;

-- Deadline for the current state: card hold while awaiting_payment, teacher answer while requested.
ALTER TABLE bookings ADD COLUMN expires_at timestamptz;
ALTER TABLE bookings ADD COLUMN cancelled_by text CHECK (cancelled_by IN ('learner','teacher','system'));
CREATE INDEX bookings_teacher_status_start ON bookings (teacher_id, status, starts_at);
CREATE INDEX bookings_payer ON bookings (payer_id, created_at DESC);

CREATE INDEX availability_teacher_start ON availability (teacher_id, starts_at);
CREATE INDEX messages_booking_created ON messages (booking_id, created_at);

-- Every provider event we receive, once. The handler is idempotent anyway; this is the audit trail.
CREATE TABLE webhook_events (
  id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'moyasar',
  type text NOT NULL,
  payment_id text,
  received_at timestamptz NOT NULL
);

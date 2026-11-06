-- Phase 4a: in-app notifications, with optional SMS for the few that cannot wait.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text,                          -- app path, e.g. /portal/booking?id=...
  dedupe_key text UNIQUE,             -- makes reminders and repeated events idempotent
  sms boolean NOT NULL DEFAULT false, -- also send as text
  sms_sent_at timestamptz,
  sms_attempts int NOT NULL DEFAULT 0,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_sms_due ON notifications (created_at) WHERE sms AND sms_sent_at IS NULL;

ALTER TABLE bookings ADD COLUMN reminded_at timestamptz;

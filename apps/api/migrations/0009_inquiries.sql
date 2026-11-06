-- Questions to a teacher before booking. One thread per (payer, teacher). The messages live in the same table as
-- lesson chat so the filter, the flags and the safety console treat them identically.
CREATE TABLE inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id uuid NOT NULL REFERENCES users(id),
  teacher_id uuid NOT NULL REFERENCES teacher_profiles(user_id),
  created_at timestamptz NOT NULL,
  last_message_at timestamptz NOT NULL,
  payer_seen_at timestamptz,
  teacher_seen_at timestamptz,
  UNIQUE (payer_id, teacher_id)
);
CREATE INDEX inquiries_teacher ON inquiries (teacher_id, last_message_at DESC);
CREATE INDEX inquiries_payer ON inquiries (payer_id, last_message_at DESC);

ALTER TABLE messages ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE messages ADD COLUMN inquiry_id uuid REFERENCES inquiries(id);
ALTER TABLE messages ADD CONSTRAINT messages_one_thread CHECK ((booking_id IS NULL) <> (inquiry_id IS NULL));
CREATE INDEX messages_inquiry_created ON messages (inquiry_id, created_at);

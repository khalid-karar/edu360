-- PDPL data rights: export and erasure. Rows that law or safety requires us to keep are
-- anonymised, never dropped, so every foreign key stays valid.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;

CREATE TABLE deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','cancelled','completed')),
  requested_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,                 -- cooling-off period; the user can cancel until then
  completed_at timestamptz,
  cancelled_at timestamptz,
  blocked_reasons text[] NOT NULL DEFAULT '{}' -- why the last attempt to erase was postponed
);
-- One live request per user.
CREATE UNIQUE INDEX deletion_requests_live ON deletion_requests (user_id) WHERE status = 'requested';
CREATE INDEX deletion_requests_due ON deletion_requests (due_at) WHERE status = 'requested';

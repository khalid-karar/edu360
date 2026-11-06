-- Phase 4b: appeals against strikes, and voiding a strike when an appeal succeeds.
ALTER TABLE strikes ADD COLUMN voided_at timestamptz;
ALTER TABLE strikes ADD COLUMN voided_by uuid REFERENCES users(id);

CREATE TABLE appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strike_id uuid NOT NULL UNIQUE REFERENCES strikes(id),   -- one appeal per strike
  user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','reversed')),
  decided_by uuid REFERENCES users(id),
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX appeals_open ON appeals (created_at) WHERE status = 'open';
CREATE INDEX appeals_user ON appeals (user_id, created_at DESC);

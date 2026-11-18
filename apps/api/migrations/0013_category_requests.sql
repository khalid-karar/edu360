-- A teacher who cannot find their subject asks for it; the super admin approves (which creates the category) or rejects with a reason.
CREATE TABLE category_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  category_id int REFERENCES categories(id),
  reject_reason text,
  decided_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
-- The same teacher cannot have the same subject waiting twice.
CREATE UNIQUE INDEX category_requests_one_pending ON category_requests (teacher_id, lower(name)) WHERE status = 'pending';
CREATE INDEX category_requests_status ON category_requests (status, created_at);

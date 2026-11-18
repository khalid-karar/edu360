-- Schools channel: a school applies, staff approve it, and it gets an invite code. Families who sign up with the code are
-- attributed to the school, which sees only aggregate numbers about them.
-- (The new role value is not used in this migration: a new enum value cannot be used in the transaction that adds it.)
ALTER TYPE user_role ADD VALUE 'school';

CREATE TABLE schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text NOT NULL,
  contact_name text NOT NULL,
  contact_mobile text NOT NULL,
  license_no text,                                  -- Ministry of Education licence, when the school has one
  student_estimate int CHECK (student_estimate BETWEEN 1 AND 100000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  invite_code text UNIQUE,                          -- set on approval
  owner_id uuid REFERENCES users(id),               -- the school's login, created on approval
  reject_reason text,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL
);
-- One live application or school per contact mobile; a rejected one does not block a new try.
CREATE UNIQUE INDEX schools_one_live_per_mobile ON schools (contact_mobile) WHERE status IN ('pending','approved');

ALTER TABLE users ADD COLUMN school_id uuid REFERENCES schools(id);
CREATE INDEX users_school ON users (school_id) WHERE school_id IS NOT NULL;
